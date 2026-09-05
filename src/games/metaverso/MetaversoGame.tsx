import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "@/core/contract/game";
import type { NetPlayer } from "@/core/contract/gameNet";
import { bool, num, records } from "@/core/contract/settings";
import { createRng } from "@/core/engine/rng";
import { useGameLifecycle } from "@/core/engine/useGameLifecycle";
import { Stage } from "@/core/engine3d/Stage";
import { lerpAngle } from "@/core/net/interpolation";
import { createSnapshotCodec, type NetSnapshot } from "@/core/net/snapshot";
import { useGameNet } from "@/core/net/useGameNet";
import { HudStat } from "@/ui/game/GameStage";
import { TouchSticks } from "@/ui/game/TouchSticks";
import { createSticksState, type SticksState } from "@/ui/game/sticks";
import { SpaceScene } from "./SpaceScene";
import {
  MAX_AVATARS,
  SPACE_QUANT,
  createMutableSnapshot,
  createSpace,
  type AvatarInput,
  type MutableSnapshot,
  type SpaceLayout,
  type StationContent,
} from "./space";
import {
  AVATAR_TOKENS,
  LABEL_COUNT,
  STATION_LABEL_OFFSET,
  VIEW_DELAY_MS,
  ZONE_TOKENS,
  clientOnState,
  clientStep,
  createSpaceView,
  hostInput,
  hostJoin,
  hostLeave,
  hostStep,
  setHostPlaying,
  visitedCount,
  visitedIds,
  type SpaceView,
} from "./view";

/**
 * X5 · Espacio — el juego.
 *
 * Un lobby 3D recorrible, sin objetivo. El proyector es el host: simula el
 * espacio, muestra la vista aerea y publica estado a 10 Hz. Cada celular
 * entra por el QR, camina en primera persona con un stick y un arrastre, y
 * al acercarse a un panel lee su contenido. Lo unico que se "gana" es haber
 * recorrido: el outcome lleva que estaciones visito cada quien.
 */

const EMPTY_ACKS: Readonly<Record<string, number>> = Object.freeze({});
const HUD_SAMPLE_MS = 150;

type SpaceHud = { people: number };

type HudState = {
  people: number;
  zone: number;
  zoneName: string;
  stationOpen: number;
  stationTitle: string;
  stationBody: string;
  stationPeople: number;
  visited: number;
  stations: number;
  occupancy: number[];
  timeS: number;
};

function readHud(view: SpaceView): HudState {
  const zone = view.layout.zones[view.zone];
  const station = view.stationOpen >= 0 ? view.layout.stations[view.stationOpen] : undefined;
  return {
    people: view.activeCount,
    zone: zone?.color ?? 0,
    zoneName: zone?.name ?? "",
    stationOpen: view.stationOpen,
    stationTitle: station?.title ?? "",
    stationBody: station?.body ?? "",
    stationPeople: station ? view.occupancy[station.id] ?? 0 : 0,
    visited: visitedCount(view),
    stations: view.layout.stations.length,
    occupancy: view.layout.stations.map((entry) => view.occupancy[entry.id] ?? 0),
    timeS: view.timeS,
  };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function makeScratchLerp(out: MutableSnapshot) {
  return (a: NetSnapshot, b: NetSnapshot, t: number): NetSnapshot => {
    const count = out.entities.length;
    if (a.entities.length !== count || b.entities.length !== count) return b;
    out.tick = a.tick;
    for (let i = 0; i < count; i++) {
      const ea = a.entities[i];
      const eb = b.entities[i];
      const eo = out.entities[i];
      if (!ea || !eb || !eo) continue;
      eo.id = ea.id;
      eo.x = ea.x + (eb.x - ea.x) * t;
      eo.y = ea.y + (eb.y - ea.y) * t;
      eo.vx = 0;
      eo.vy = 0;
      eo.angle = lerpAngle(ea.angle, eb.angle, t);
      eo.flags = ea.flags;
    }
    for (let i = 0; i < out.scalars.length; i++) out.scalars[i] = a.scalars[i] ?? 0;
    return out;
  };
}

function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const coarse = matchMedia("(pointer: coarse)");
    const orientation = matchMedia("(orientation: portrait)");
    const update = () => setPortrait(coarse.matches && orientation.matches);
    update();
    orientation.addEventListener("change", update);
    return () => orientation.removeEventListener("change", update);
  }, []);
  return portrait;
}

export default function MetaversoGame({ config, signal, onFinish, onReady }: GameProps) {
  const isHost = config.isHost;
  const seat = config.seat;

  const content = useMemo<StationContent[]>(
    () =>
      records(config.settings, "stations")
        .map((record) => ({ title: String(record.title ?? "").trim(), body: String(record.body ?? "").trim() }))
        .filter((station) => station.title.length > 0),
    [config.settings],
  );
  const layout = useMemo(() => createSpace(createRng(config.seed), content), [config.seed, content]);
  const showNames = bool(config.settings, "showNames", true);
  const sessionMinutes = num(config.settings, "sessionMinutes", 0);
  const durationMs = sessionMinutes > 0 ? sessionMinutes * 60_000 : config.durationMs;

  const viewRef = useRef<SpaceView | null>(null);
  const rosterRef = useRef(new Map<string, NetPlayer>());

  const life = useGameLifecycle<SpaceHud>({
    hud: { people: 0 },
    durationMs,
    countdown: 0,
    countdownDriver: "internal",
    signal,
    onFinish,
    // Sin puntaje: el espacio no se gana. Lo que vale es el recorrido.
    outcome: (completed) => {
      const view = viewRef.current;
      if (!view) return { completed, points: 0 };
      if (view.isHost && !view.hostPlaying) {
        return {
          completed,
          points: 0,
          meta: { people: view.activeCount, occupancy: Array.from(view.occupancy) },
        };
      }
      return {
        completed,
        points: 0,
        meta: {
          visited: visitedIds(view),
          stations: view.layout.stations.length,
          distance: Math.round(view.distance),
        },
      };
    },
  });

  // La vista se rehace por sesion (`generation` sube al reiniciar).
  const generation = life.generation;
  const view = useMemo(() => {
    void generation;
    return createSpaceView({ layout, isHost, seat, showNames });
  }, [layout, isHost, seat, showNames, generation]);
  viewRef.current = view;
  view.reducedMotion = life.reducedMotion;

  const sticks = useMemo<SticksState>(() => createSticksState(), []);
  const viewScratch = useMemo(() => createMutableSnapshot(), []);
  const viewLerp = useMemo(() => makeScratchLerp(viewScratch), [viewScratch]);
  const wireCodec = useMemo(() => createSnapshotCodec({ keyframeEvery: 10, quant: SPACE_QUANT }), []);

  const netHandle = useGameNet<AvatarInput, NetSnapshot>({
    roomId: config.roomId,
    transport: config.transport,
    role: isHost ? "host" : "client",
    seat,
    seats: MAX_AVATARS,
    name: isHost ? "Proyector" : `Persona ${seat + 1}`,
    codec: wireCodec,
    interpolate: { lerp: viewLerp, delayMs: VIEW_DELAY_MS },
    onInput: (playerId, input) => {
      const current = viewRef.current;
      const player = rosterRef.current.get(playerId);
      if (current && player) hostInput(current, player.seat, input);
    },
    onState: (state, _tick, ackedSequence) => {
      const current = viewRef.current;
      if (current) clientOnState(current, state, ackedSequence);
    },
    // Los bots que `mockNet` sienta en los lugares vacios no son personas:
    // en un lobby, un avatar que nadie maneja es un maniqui.
    onPlayerJoin: (player) => {
      rosterRef.current.set(player.id, player);
      const current = viewRef.current;
      if (current && !player.bot && player.seat !== 0) hostJoin(current, player.seat, player.name);
    },
    onPlayerLeave: (playerId) => {
      const player = rosterRef.current.get(playerId);
      rosterRef.current.delete(playerId);
      const current = viewRef.current;
      if (current && player && !player.bot) hostLeave(current, player.seat);
    },
  });

  useEffect(() => {
    for (const player of netHandle.players) {
      if (!player.bot && player.seat !== 0) view.names[player.seat] = player.name;
    }
  }, [netHandle.players, view]);

  const net = netHandle.net;
  useEffect(() => {
    view.send = net ? (input, sequence) => net.sendInput(input, sequence) : null;
    view.publish = net ? (snapshot, tick) => net.broadcastState(snapshot, tick, EMPTY_ACKS) : null;
    return () => {
      view.send = null;
      view.publish = null;
    };
  }, [net, view]);

  // Una vista nueva (reinicio) tiene que volver a sumar a los que ya estaban.
  useEffect(() => {
    if (!isHost) return;
    for (const player of rosterRef.current.values()) {
      if (!player.bot && player.seat !== 0) hostJoin(view, player.seat, player.name);
    }
  }, [isHost, view]);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  const phase = life.phase;
  const playing = phase === "playing";

  const tick = useCallback(
    (dt: number) => {
      life.tick(dt, () => {
        if (view.isHost) hostStep(view, dt, sticks);
        else clientStep(view, dt, sticks);
        sticks.lookX = 0;
        sticks.lookY = 0;
      });
    },
    [life, view, sticks],
  );

  const [hud, setHud] = useState<HudState>(() => readHud(view));
  useEffect(() => {
    setHud(readHud(view));
    if (!playing) return;
    const id = window.setInterval(() => setHud(readHud(view)), HUD_SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [playing, view]);

  const closeStation = useCallback(() => {
    view.stationOpen = -1;
    setHud(readHud(view));
  }, [view]);

  const portrait = usePortrait();

  // La persona de la PC entra al espacio como asiento 0 (boton o tecla P) y
  // sale para volver a la vista aerea. Sin esto, el proyector solo mira.
  const [hostPlaying, setHostPlayingState] = useState(false);
  const toggleHostPlaying = useCallback(() => {
    if (!isHost) return;
    setHostPlayingState((current) => !current);
  }, [isHost]);
  useEffect(() => {
    if (isHost) setHostPlaying(view, hostPlaying);
  }, [isHost, hostPlaying, view]);
  useEffect(() => {
    if (!isHost) return;
    const onKey = (event: KeyboardEvent) => {
      // Tab y no P: P ya es pausa en el escenario.
      if (event.code !== "Tab" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      toggleHostPlaying();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isHost, toggleHostPlaying]);
  const fpv = !isHost || hostPlaying;

  const connected = netHandle.players.filter((player) => !player.bot && player.connected).length;
  const timeLeft = life.timeLeftMs;
  const lastMinute = timeLeft !== null && timeLeft <= 60_000;

  const instructions = isHost
    ? "Vista aérea del espacio; los celulares entran por el QR. Para recorrerlo desde esta PC: «Entrar desde acá» o tecla Tab, WASD para caminar y mouse para mirar."
    : "Stick izquierdo para caminar, arrastrá a la derecha para mirar. Acercate a un panel para leerlo.";

  return (
    <Stage
      phase={phase}
      countdownLeft={life.countdownLeft}
      instructions={instructions}
      muted={life.muted}
      onToggleMuted={life.toggleMuted}
      onStart={life.start}
      onResume={life.resume}
      onPause={life.pause}
      onRestart={life.restart}
      aspect={16 / 9}
      camera={{ position: [0, 46, 22], fov: 46, near: 0.1, far: 220 }}
      lights={false}
      background="var(--sn-bg)"
      {...(config.debug ? { debug: true } : {})}
      hud={
        <>
          <HudStat label="Personas" value={hud.people} dominant />
          {fpv && (
            <HudStat label="Estaciones" value={`${hud.visited}/${hud.stations}`} tone={hud.visited === hud.stations && hud.stations > 0 ? "cyan" : "default"} />
          )}
          <HudStat
            label={timeLeft !== null ? "Queda" : "Tiempo"}
            value={formatTime(timeLeft !== null ? Math.ceil(timeLeft / 1000) : hud.timeS)}
            tone={lastMinute ? "warn" : "default"}
          />
          {isHost && <HudStat label="Conectados" value={connected} tone="cyan" />}
        </>
      }
      introExtra={
        <p className="text-xs text-sn-muted">
          {netHandle.transportError
            ? `Red: ${netHandle.transportError}`
            : isHost
              ? `${connected} ${connected === 1 ? "persona conectada" : "personas conectadas"} · ${layout.stations.length} estaciones en ${layout.zones.length} zonas`
              : `${netHandle.status === "live" ? "Conectado al proyector" : "Conectando…"} · ${layout.stations.length} estaciones para recorrer`}
        </p>
      }
      overlay={
        <SpaceOverlay
          hud={hud}
          view={view}
          sticks={sticks}
          fpv={fpv}
          portrait={portrait}
          layout={layout}
          onClose={closeStation}
          isHost={isHost}
          hostPlaying={hostPlaying}
          onToggleHost={toggleHostPlaying}
        />
      }
      summary={<Summary hud={hud} isHost={isHost} />}
    >
      <SpaceScene view={view} enabled={playing} tick={tick} sampleState={netHandle.sampleState} />
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* HUD en DOM                                                           */
/* ------------------------------------------------------------------ */

const STYLE = `
@keyframes sn-space-rise { 0% { opacity: 0; transform: translate(-50%, 8px); } 100% { opacity: 1; transform: translate(-50%, 0); } }
`;

function zoneColor(index: number): string {
  return `var(${ZONE_TOKENS[index % ZONE_TOKENS.length] ?? "--sn-text"})`;
}

function SpaceOverlay({
  hud,
  view,
  sticks,
  fpv,
  portrait,
  layout,
  onClose,
  isHost,
  hostPlaying,
  onToggleHost,
}: {
  hud: HudState;
  view: SpaceView;
  sticks: SticksState;
  fpv: boolean;
  portrait: boolean;
  layout: SpaceLayout;
  onClose: () => void;
  isHost: boolean;
  hostPlaying: boolean;
  onToggleHost: () => void;
}) {
  return (
    <div className="absolute inset-0 select-none">
      <style>{STYLE}</style>
      <Labels view={view} layout={layout} />
      {fpv && <TouchSticks state={sticks} enabled={!portrait} showFire={false} showJump={false} />}

      {isHost && (
        <div className="pointer-events-none absolute left-1/2 top-12 -translate-x-1/2" style={{ marginTop: fpv ? 34 : 0 }}>
          <button
            type="button"
            onClick={onToggleHost}
            className="pointer-events-auto rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              background: hostPlaying ? "var(--sn-panel)" : "var(--sn-cyan-500)",
              color: "var(--sn-text)",
              border: "1px solid var(--sn-line)",
            }}
            data-game-ui
          >
            {hostPlaying ? "Ver desde arriba · Tab" : "Entrar desde acá · Tab"}
          </button>
        </div>
      )}

      {fpv && (
        <div className="pointer-events-none absolute left-1/2 top-12 -translate-x-1/2">
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
            style={{
              color: zoneColor(hud.zone),
              border: `1px solid ${zoneColor(hud.zone)}`,
              background: "color-mix(in srgb, var(--sn-bg) 70%, transparent)",
            }}
          >
            Zona {hud.zoneName}
          </span>
        </div>
      )}

      {fpv && hud.stationOpen >= 0 && (
        <div
          className="absolute bottom-4 left-1/2 w-[min(92%,420px)] rounded-2xl p-4 text-left"
          style={{
            transform: "translateX(-50%)",
            background: "color-mix(in srgb, var(--sn-panel) 92%, transparent)",
            border: `1px solid ${zoneColor(layout.stations[hud.stationOpen]?.zone ?? 0)}`,
            boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
            animation: "sn-space-rise 0.28s ease-out",
          }}
          data-game-ui
        >
          <div className="mb-1 flex items-start justify-between gap-3">
            <h3 className="text-base font-bold" style={{ color: zoneColor(layout.stations[hud.stationOpen]?.zone ?? 0) }}>
              {hud.stationTitle}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-2 text-lg leading-none text-sn-muted"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "var(--sn-text)" }}>
            {hud.stationBody || "Sin contenido todavía."}
          </p>
          <p className="mt-2 text-xs text-sn-muted">
            {hud.stationPeople <= 1 ? "Estás acá solo" : `${hud.stationPeople} personas acá`}
          </p>
        </div>
      )}

      {!fpv && (
        <div className="pointer-events-none absolute right-3 top-12 flex flex-col gap-1 text-xs">
          {layout.stations.map((station, index) => (
            <div
              key={station.id}
              className="flex items-center gap-2 rounded-md px-2 py-1"
              style={{ background: "color-mix(in srgb, var(--sn-panel) 75%, transparent)" }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 999, background: zoneColor(station.zone) }} />
              <span className="w-32 truncate">{station.title}</span>
              <span className="sn-num" style={{ color: (hud.occupancy[index] ?? 0) > 0 ? "var(--sn-text)" : "var(--sn-text-dim)" }}>
                {hud.occupancy[index] ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}

      {portrait && fpv && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center"
          style={{ background: "color-mix(in srgb, var(--sn-bg) 92%, transparent)" }}
          data-game-ui
        >
          <span className="text-3xl">⟳</span>
          <span className="text-sm font-semibold">Girá el celular</span>
          <span className="text-xs text-sn-muted">El espacio se recorre apaisado.</span>
        </div>
      )}
    </div>
  );
}

/**
 * Nombres sobre los avatares y titulos sobre los paneles.
 *
 * La escena proyecta cada punto a fraccion de pantalla por cuadro y lo deja
 * en la vista; aca un rAF mueve los `div` con `left/top`. Es DOM y no un
 * sprite de texto porque el texto en DOM se ve nitido a cualquier tamano y
 * no cuesta un atlas. Treinta y ocho elementos como mucho.
 */
function Labels({ view, layout }: { view: SpaceView; layout: SpaceLayout }) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      for (let i = 0; i < LABEL_COUNT; i++) {
        const el = refs.current[i];
        if (!el) continue;
        if (view.labelOn[i] !== 1) {
          if (el.style.display !== "none") el.style.display = "none";
          continue;
        }
        el.style.display = "";
        el.style.left = `${((view.labelX[i] ?? 0) * 100).toFixed(2)}%`;
        el.style.top = `${((view.labelY[i] ?? 0) * 100).toFixed(2)}%`;
        el.style.transform = `translate(-50%, -100%) scale(${(view.labelScale[i] ?? 1).toFixed(3)})`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: MAX_AVATARS }, (_, seat) => (
        <div
          key={`avatar-${seat}`}
          ref={(el) => {
            refs.current[seat] = el;
          }}
          className="absolute whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
          style={{
            display: "none",
            background: "color-mix(in srgb, var(--sn-bg) 75%, transparent)",
            color: `var(${AVATAR_TOKENS[seat % AVATAR_TOKENS.length] ?? "--sn-text"})`,
          }}
        >
          {view.names[seat] ?? ""}
        </div>
      ))}
      {layout.stations.map((station) => (
        <div
          key={`station-${station.id}`}
          ref={(el) => {
            refs.current[STATION_LABEL_OFFSET + station.id] = el;
          }}
          className="absolute whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold"
          style={{
            display: "none",
            background: "color-mix(in srgb, var(--sn-bg) 80%, transparent)",
            color: zoneColor(station.zone),
            border: `1px solid ${zoneColor(station.zone)}`,
          }}
        >
          {station.title}
        </div>
      ))}
    </div>
  );
}

function Summary({ hud, isHost }: { hud: HudState; isHost: boolean }) {
  if (isHost) {
    return (
      <p className="text-left text-xs text-sn-muted">
        {hud.people} {hud.people === 1 ? "persona recorrió" : "personas recorrieron"} el espacio. Reiniciá para abrirlo de nuevo.
      </p>
    );
  }
  return (
    <p className="text-left text-xs text-sn-muted">
      Visitaste <span className="sn-num">{hud.visited}</span> de {hud.stations} estaciones
      {hud.visited === hud.stations && hud.stations > 0 ? " · recorrido completo" : ""}.
    </p>
  );
}
