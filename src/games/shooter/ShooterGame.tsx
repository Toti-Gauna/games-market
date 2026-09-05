import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "@/core/contract/game";
import type { NetPlayer } from "@/core/contract/gameNet";
import { createRng } from "@/core/engine/rng";
import { useGameLifecycle } from "@/core/engine/useGameLifecycle";
import { Stage } from "@/core/engine3d/Stage";
import { lerpAngle } from "@/core/net/interpolation";
import { createSnapshotCodec, type NetSnapshot } from "@/core/net/snapshot";
import { useGameNet } from "@/core/net/useGameNet";
import { HudStat } from "@/ui/game/GameStage";
import { TouchSticks } from "@/ui/game/TouchSticks";
import { createSticksState, type SticksState } from "@/ui/game/sticks";
import { ShooterScene } from "./ShooterScene";
import { MAX_PLAYERS, WEAPON_ASPERSOR, WEAPON_CANON, WEAPON_MANGUERA, createShooterMap } from "./map";
import {
  MATCH_SECONDS,
  RING_SCHEDULE,
  SHOOTER_QUANT,
  createMutableSnapshot,
  rulesFromSettings,
  setInput,
  shooterPoints,
  type MutableSnapshot,
  type ShooterInput,
} from "./logic";
import {
  HINT_CHEST,
  HINT_EXIT_CAR,
  HINT_NONE,
  OVER_HOLD_S,
  SEAT_TOKENS,
  VIEW_DELAY_MS,
  clientOnState,
  clientStep,
  createView,
  hostSetHuman,
  hostStart,
  hostStep,
  seatName,
  setHostPlaying,
  type ShooterView,
} from "./view";

/**
 * X4 · Supernova Arena — el juego.
 *
 * Battle royale de diez en un mapa de 80 x 80 generado por semilla. El
 * proyector es el host autoritativo y mira desde arriba; cada celular entra
 * por el QR como jugador con su asiento, ve en primera persona y manda su
 * intencion 30 veces por segundo. Los asientos sin persona los juega el bot
 * del mundo, y si alguien entra tarde toma ese cuerpo.
 *
 * Reparto del trabajo, para no perderse:
 *
 * - `logic.ts`: la simulacion, pura y testeada. Solo corre en el host.
 * - `view.ts`: lo que se dibuja, mutado a 60 Hz sin pasar por React.
 * - `ShooterScene.tsx`: adentro del canvas. Lee la vista y escribe buffers.
 * - Este archivo: afuera del canvas. Arma la red, el ciclo de vida, los
 *   sticks y el HUD en DOM, y le da a la escena una funcion `tick`.
 */

const EMPTY_ACKS: Readonly<Record<string, number>> = Object.freeze({});

/* Nombre y color elegidos, recordados entre partidas. */
const NAME_KEY = "sn-shooter-name";
const SKIN_KEY = "sn-shooter-skin";
const NAME_MAX = 16;

/**
 * `localStorage` tira en modo privado y en algunos navegadores embebidos, y
 * un nombre guardado no vale una pantalla en blanco.
 */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Sin persistencia se juega igual: la eleccion vale para esta partida.
  }
}

/** Sin espacios de mas ni nombres kilometricos que rompan el feed. */
function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

function defaultName(seat: number, isHost: boolean): string {
  return isHost ? "Proyector" : `Jugador ${seat + 1}`;
}

function loadName(seat: number, isHost: boolean): string {
  return cleanName(readStored(NAME_KEY) ?? "") || defaultName(seat, isHost);
}

function loadSkin(seat: number): number {
  const raw = Number(readStored(SKIN_KEY));
  if (Number.isInteger(raw) && raw >= 0 && raw < SEAT_TOKENS.length) return raw;
  return seat % SEAT_TOKENS.length;
}

/** El HUD se muestrea a 10 Hz: es lo que un ojo distingue en una barra. */
const HUD_SAMPLE_MS = 100;

type ShooterHud = { alive: number };

type FeedLine = { id: number; victim: string; killer: string; victimSeat: number; killerSeat: number };

/** Lo que el DOM muestra. Se lee de la vista, nunca al reves. */
type HudState = {
  state: number;
  hp: number;
  ammo: number;
  magazine: number;
  /** Nombre corto del arma en mano y cual es, para el color. */
  weapon: string;
  weaponKind: number;
  /** Que puede hacer el boton de interactuar ahora (`HINT_*` de view.ts). */
  interactHint: number;
  driving: boolean;
  /** 0 = no recarga; si no, progreso 0..1. */
  reloading: number;
  alive: number;
  timeS: number;
  deployLeft: number;
  ringPhase: number;
  /** Segundos hasta que el anillo vuelva a cerrar. -1 = ya no cierra mas. */
  ringIn: number;
  outside: boolean;
  spectating: boolean;
  placement: number;
  kills: number;
  winnerSeat: number;
  winner: string;
  hitCount: number;
  hurtCount: number;
  /** Grados en pantalla hacia el atacante, o null. 0 = de frente. */
  damageDeg: number | null;
  damageAlpha: number;
  feed: FeedLine[];
  connected: number;
  /** Vida de cada asiento, para la tabla del proyector. -1 = no juega. */
  seats: number[];
  names: string[];
};

function readHud(view: ShooterView, connected: number): HudState {
  const scale = view.rules.matchSeconds / MATCH_SECONDS;
  const next = RING_SCHEDULE[view.ringPhase];
  const ringIn = next ? Math.max(0, Math.ceil(next.at * scale - view.timeS)) : -1;
  let rel = Number.NaN;
  if (Number.isFinite(view.damageYaw)) {
    rel = view.damageYaw - view.camYaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  }
  const seats: number[] = [];
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    seats.push(view.active[seat] === 1 ? (view.alive[seat] === 1 ? view.hp[seat] ?? 0 : 0) : -1);
  }
  return {
    state: view.state,
    hp: Math.round(view.ownHp),
    ammo: view.ammo,
    magazine: view.ownSpec.magazine,
    weapon: view.ownSpec.name,
    weaponKind: view.ownWeapon,
    interactHint: view.interactHint,
    driving: view.ownDriving >= 0,
    reloading: view.reloadLeft > 0 ? 1 - view.reloadLeft / Math.max(0.01, view.ownSpec.reloadS) : 0,
    alive: view.aliveCount,
    timeS: view.timeS,
    deployLeft: view.deployLeft,
    ringPhase: view.ringPhase,
    ringIn,
    outside: view.outsideRing,
    spectating: view.spectating,
    placement: view.placement,
    kills: view.kills,
    winnerSeat: view.winner,
    winner: view.winner >= 0 ? seatName(view, view.winner) : "",
    hitCount: view.hitCount,
    hurtCount: view.hurtCount,
    damageDeg: Number.isFinite(rel) ? (-rel * 180) / Math.PI : null,
    damageAlpha: view.damageAge,
    feed: view.feed.map((entry, index) => ({
      id: index + Math.floor(entry.age * 1000) * 0,
      victim: seatName(view, entry.victim),
      killer: seatName(view, entry.killer),
      victimSeat: entry.victim,
      killerSeat: entry.killer,
    })),
    connected,
    seats,
    names: view.names.slice(),
  };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/**
 * Mezcla dos snapshots sobre uno reservado, sin asignar. Es lo que
 * `useGameNet` usa para entregar el estado de hace ~100 ms.
 */
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
      eo.vx = ea.vx + (eb.vx - ea.vx) * t;
      eo.vy = ea.vy + (eb.vy - ea.vy) * t;
      eo.angle = lerpAngle(ea.angle, eb.angle, t);
      eo.flags = ea.flags;
    }
    for (let i = 0; i < out.scalars.length; i++) out.scalars[i] = a.scalars[i] ?? 0;
    return out;
  };
}

/** Celular en vertical: el juego es apaisado por contrato. */
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

export default function ShooterGame({ config, signal, onFinish, onReady }: GameProps) {
  const isHost = config.isHost;
  const seat = config.seat;
  const rules = useMemo(() => rulesFromSettings(config.settings), [config.settings]);
  const map = useMemo(() => createShooterMap(createRng(config.seed)), [config.seed]);

  const viewRef = useRef<ShooterView | null>(null);
  const rosterRef = useRef(new Map<string, NetPlayer>());

  const life = useGameLifecycle<ShooterHud>({
    hud: { alive: 0 },
    // La partida la termina el mundo (ultimo vivo o tiempo), no el reloj.
    durationMs: null,
    countdown: 0,
    countdownDriver: "internal",
    signal,
    onFinish,
    outcome: (completed) => {
      const view = viewRef.current;
      if (!view) return { completed, points: 0 };
      if (view.isHost && !view.hostPlaying) {
        return {
          completed,
          points: 0,
          meta: { winner: view.winner, winnerName: seatName(view, view.winner), alive: view.aliveCount },
        };
      }
      const survived = view.state === 3 && !view.spectating && view.ownAlive;
      const placement = view.spectating ? view.placement : survived ? 1 : Math.max(1, view.aliveCount);
      return {
        completed,
        points: shooterPoints(placement, view.kills, view.damageDealt, survived),
        meta: { placement, kills: view.kills, damage: Math.round(view.damageDealt), survived },
      };
    },
  });

  /*
   * La vista se rehace por partida (`generation` sube al reiniciar): un mundo
   * nuevo, un cuerpo nuevo, efectos en cero. Todo lo demas —red, sticks—
   * sobrevive al reinicio.
   */
  const generation = life.generation;
  const view = useMemo(
    () => createView({ map, rules, isHost, seat, seed: `${config.seed}:${generation}` }),
    [map, rules, isHost, seat, config.seed, generation],
  );
  viewRef.current = view;
  view.reducedMotion = life.reducedMotion;

  /*
   * Nombre y color: se eligen en la pantalla de inicio y se recuerdan entre
   * partidas. El nombre tiene DOS estados a proposito: `nameDraft` es lo que
   * se esta tecleando y `name` es lo que sabe la red. `useGameNet` rehace la
   * sesion entera cuando cambia el nombre —esta en las dependencias del
   * efecto que crea el puerto—, asi que escribir letra por letra sobre el
   * nombre de red seria reconectar en cada tecla. Se confirma al salir del
   * campo o al empezar a jugar.
   */
  const [nameDraft, setNameDraft] = useState(() => loadName(seat, isHost));
  const [name, setName] = useState(nameDraft);
  const [skin, setSkin] = useState(() => loadSkin(seat));

  const commitName = useCallback(() => {
    const clean = cleanName(nameDraft) || defaultName(seat, isHost);
    setNameDraft(clean);
    setName(clean);
    writeStored(NAME_KEY, clean);
  }, [nameDraft, seat, isHost]);

  const chooseSkin = useCallback((next: number) => {
    setSkin(next);
    writeStored(SKIN_KEY, String(next));
  }, []);

  // La vista es la que lleva lo elegido al input y a la escena, sin React en
  // el medio: se escribe en cada render, como `reducedMotion`.
  view.ownSkin = skin;
  view.ownName = name;

  const sticks = useMemo<SticksState>(() => createSticksState(), []);

  const viewScratch = useMemo(() => createMutableSnapshot(), []);
  const viewLerp = useMemo(() => makeScratchLerp(viewScratch), [viewScratch]);
  const wireCodec = useMemo(() => createSnapshotCodec({ keyframeEvery: 20, quant: SHOOTER_QUANT }), []);

  const netHandle = useGameNet<ShooterInput, NetSnapshot>({
    roomId: config.roomId,
    transport: config.transport,
    role: isHost ? "host" : "client",
    seat,
    seats: MAX_PLAYERS,
    name,
    codec: wireCodec,
    interpolate: { lerp: viewLerp, delayMs: VIEW_DELAY_MS },

    // Solo en el host: el input de un celular entra al mundo por su asiento.
    onInput: (playerId, input) => {
      const current = viewRef.current;
      const player = rosterRef.current.get(playerId);
      if (!current?.world || !player) return;
      setInput(current.world, player.seat, input);
    },

    // Solo en un cliente: estado crudo, para escalares, eventos y reconciliar.
    onState: (state, _tick, ackedSequence) => {
      const current = viewRef.current;
      if (current) clientOnState(current, state, ackedSequence);
    },

    onPlayerJoin: (player) => {
      rosterRef.current.set(player.id, player);
      const current = viewRef.current;
      if (current) hostSetHuman(current, player.seat, !player.bot, player.name);
    },
    onPlayerLeave: (playerId) => {
      const player = rosterRef.current.get(playerId);
      rosterRef.current.delete(playerId);
      const current = viewRef.current;
      if (current && player && !player.bot) hostSetHuman(current, player.seat, false, player.name);
    },
  });

  // Los nombres del roster, en los dos roles: el feed dice quien mato a quien.
  useEffect(() => {
    for (const player of netHandle.players) {
      // El asiento 0 se nombra segun quien lo juegue (bot o la PC), no por el
      // roster; pero de ahi sale como se llama la persona del proyector, que
      // es lo que ven los celulares cuando toma el asiento con Tab.
      if (player.seat === 0) {
        if (!player.bot) view.hostName = player.name;
        continue;
      }
      view.names[player.seat] = player.bot ? `Bot ${player.seat + 1}` : player.name;
    }
  }, [netHandle.players, view]);

  // El sonido sale del ciclo de vida, que ya sabe si esta silenciado.
  const sfx = life.sfx;
  useEffect(() => {
    view.playSfx = (nombre) => sfx.play(nombre);
    return () => {
      view.playSfx = null;
    };
  }, [sfx, view]);

  const net = netHandle.net;
  useEffect(() => {
    view.send = net ? (input, sequence) => net.sendInput(input, sequence) : null;
    view.publish = net ? (snapshot, tick) => net.broadcastState(snapshot, tick, EMPTY_ACKS) : null;
    return () => {
      view.send = null;
      view.publish = null;
    };
  }, [net, view]);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  const phase = life.phase;
  const playing = phase === "playing";

  // El host arranca la partida cuando el proyector aprieta empezar.
  useEffect(() => {
    if (!isHost || !playing || view.state !== 0) return;
    hostStart(view, rosterRef.current.values());
  }, [isHost, playing, view]);

  const tick = useCallback(
    (dt: number) => {
      life.tick(dt, () => {
        if (view.isHost) hostStep(view, dt, sticks);
        else clientStep(view, dt, sticks);
        // El arrastre y el salto son deltas: se consumen por paso.
        sticks.lookX = 0;
        sticks.lookY = 0;
        sticks.jump = false;
        const hold = view.reducedMotion ? 1 : OVER_HOLD_S;
        if (view.overAt >= 0 && view.elapsed - view.overAt >= hold) life.finish(true);
      });
    },
    [life, view, sticks],
  );

  const connected = netHandle.players.filter((player) => !player.bot && player.connected).length;
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  const [hud, setHud] = useState<HudState>(() => readHud(view, 0));
  useEffect(() => {
    setHud(readHud(view, connectedRef.current));
    if (!playing) return;
    const id = window.setInterval(() => setHud(readHud(view, connectedRef.current)), HUD_SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [playing, view]);

  // Empezar confirma el nombre: es la ultima oportunidad de que la red se
  // entere antes de que la pantalla de inicio desaparezca.
  const startMatch = useCallback(() => {
    commitName();
    life.start();
  }, [commitName, life]);

  const portrait = usePortrait();

  /*
   * El proyector tambien puede jugar: la persona de la PC toma el asiento 0
   * con teclado y mouse (boton o tecla P) y lo suelta para volver a mirar
   * desde arriba. Es lo que permite probar el juego sin un celular, y en un
   * evento, que quien proyecta juegue una partida.
   */
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

  // Interactuar: E en la PC, el boton contextual en el celular. Es un flanco
  // que la vista consume en el proximo paso, en el rol que sea.
  const interact = useCallback(() => {
    view.interactQueued = true;
  }, [view]);
  const reload = useCallback(() => {
    view.reloadQueued = true;
  }, [view]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.code === "KeyE") interact();
      else if (event.code === "KeyR") reload();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interact, reload]);

  const ringLabel =
    hud.state < 2
      ? "—"
      : hud.ringIn < 0
        ? "cerrado"
        : hud.ringIn === 0
          ? "cerrando"
          : `${hud.ringIn}s`;

  const instructions = isHost
    ? "El proyector muestra el valle y los celulares entran por el QR. Para jugar desde esta PC: «Jugar desde acá» o tecla Tab, WASD para moverse, mouse para apuntar y disparar, espacio para saltar, E para abrir cofres y subir al auto."
    : "Stick izquierdo: moverse. Arrastrá a la derecha: mirar. Disparar y saltar con los botones. Acercate a un cofre o a un auto y tocá el botón. Quedate dentro del anillo.";

  return (
    <Stage
      phase={phase}
      countdownLeft={life.countdownLeft}
      instructions={instructions}
      muted={life.muted}
      onToggleMuted={life.toggleMuted}
      onStart={startMatch}
      onResume={life.resume}
      onPause={life.pause}
      onRestart={life.restart}
      aspect={16 / 9}
      // El intro muestra el personaje sobre el pedestal: el panel se corre.
      introShowcase
      camera={{ position: [0, 60, 90], fov: 58, near: 0.1, far: 460 }}
      lights={false}
      background="var(--sn-bg)"
      {...(config.debug ? { debug: true } : {})}
      hud={
        <>
          <HudStat label="Vivos" value={hud.alive} dominant />
          <HudStat label="Tiempo" value={formatTime(hud.timeS)} />
          <HudStat
            label="Anillo"
            value={ringLabel}
            tone={hud.outside ? "danger" : hud.ringIn >= 0 && hud.ringIn <= 10 && hud.state === 2 ? "warn" : "default"}
          />
          {isHost && <HudStat label="Conectados" value={hud.connected} tone="cyan" />}
        </>
      }
      introExtra={
        <div className="flex flex-col gap-3 text-left">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-sn-dim">Tu nombre</span>
            <input
              type="text"
              value={nameDraft}
              maxLength={NAME_MAX}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitName();
                }
              }}
              className="h-9 rounded-md px-2 text-sm"
              style={{
                background: "var(--sn-bg-elev)",
                color: "var(--sn-text)",
                border: "1px solid var(--sn-line)",
              }}
              placeholder={defaultName(seat, isHost)}
              data-game-ui
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-sn-dim">Tu color</span>
            <div className="flex flex-wrap gap-1.5">
              {SEAT_TOKENS.map((token, index) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => chooseSkin(index)}
                  aria-label={`Color ${index + 1}`}
                  aria-pressed={skin === index}
                  className="h-7 w-7 rounded-full transition-transform"
                  style={{
                    background: `var(${token})`,
                    // El elegido se nota por el aro y el tamano, no solo por
                    // el color: dos de la paleta son parecidos entre si.
                    outline: skin === index ? "2px solid var(--sn-text)" : "none",
                    outlineOffset: "2px",
                    transform: skin === index ? "scale(1.12)" : "none",
                  }}
                  data-game-ui
                />
              ))}
            </div>
          </div>

          <p className="text-xs text-sn-muted">
            {netHandle.transportError
              ? `Red: ${netHandle.transportError}`
              : isHost
                ? `${connected} ${connected === 1 ? "celular conectado" : "celulares conectados"} · los lugares vacíos los juegan bots`
                : `Puesto ${seat + 1} · ${netHandle.status === "live" ? "conectado al proyector" : "conectando…"}`}
          </p>
        </div>
      }
      overlay={
        <ShooterOverlay
          hud={hud}
          sticks={sticks}
          fpv={fpv}
          portrait={portrait}
          isHost={isHost}
          hostPlaying={hostPlaying}
          onToggleHost={toggleHostPlaying}
          onInteract={interact}
          onReload={reload}
          view={view}
        />
      }
      summary={<Summary hud={hud} isHost={isHost} seat={seat} />}
    >
      <ShooterScene
        view={view}
        enabled={playing}
        tick={tick}
        sampleState={netHandle.sampleState}
        lobby={phase === "intro"}
      />
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* HUD en DOM                                                           */
/* ------------------------------------------------------------------ */

const STYLE = `
@keyframes sn-shooter-hit { 0% { opacity: 1; transform: translate(-50%,-50%) scale(1.35); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1); } }
@keyframes sn-shooter-hurt { 0% { opacity: 0.85; } 100% { opacity: 0; } }
@keyframes sn-shooter-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes sn-shooter-rise { 0% { opacity: 0; transform: translateY(6px); } 100% { opacity: 1; transform: none; } }
`;

function seatColor(seat: number): string {
  const token = SEAT_TOKENS[seat];
  return token ? `var(${token})` : "var(--sn-text)";
}

/**
 * El color de cada arma, el mismo que lleva el cofre que la da: se aprende
 * una vez mirando el halo y despues se sabe que hay adentro antes de abrirlo.
 */
function weaponColor(kind: number): string {
  if (kind === WEAPON_CANON) return "var(--sn-warn)";
  if (kind === WEAPON_MANGUERA) return "var(--sn-violet-300)";
  if (kind === WEAPON_ASPERSOR) return "var(--sn-cyan-400)";
  return "var(--sn-text)";
}

function ShooterOverlay({
  hud,
  sticks,
  fpv,
  portrait,
  isHost,
  hostPlaying,
  onToggleHost,
  onInteract,
  onReload,
  view,
}: {
  hud: HudState;
  sticks: SticksState;
  fpv: boolean;
  portrait: boolean;
  isHost: boolean;
  hostPlaying: boolean;
  onToggleHost: () => void;
  onInteract: () => void;
  onReload: () => void;
  view: ShooterView;
}) {
  const inPlay = fpv && !hud.spectating && hud.state >= 1 && hud.state < 3;
  const interactLabel =
    hud.interactHint === HINT_CHEST
      ? "Abrir cofre · E"
      : hud.interactHint === HINT_EXIT_CAR
        ? "Bajar del auto · E"
        : "Subir al auto · E";
  const hpTone = hud.hp > 60 ? "var(--sn-cyan-400)" : hud.hp > 30 ? "var(--sn-warn)" : "var(--sn-danger)";

  return (
    <div className="absolute inset-0 select-none" style={{ fontFamily: "inherit" }}>
      <style>{STYLE}</style>

      {fpv && <TouchSticks state={sticks} enabled={inPlay && !portrait} />}

      {/* Golpes recibidos: vineta roja y flecha hacia el atacante. */}
      {fpv && hud.hurtCount > 0 && (
        <div
          key={`hurt-${hud.hurtCount}`}
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(ellipse at center, transparent 45%, color-mix(in srgb, var(--sn-danger) 70%, transparent) 100%)",
            animation: "sn-shooter-hurt 0.55s ease-out forwards",
          }}
        />
      )}
      {fpv && hud.damageDeg !== null && hud.damageAlpha > 0 && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2"
          style={{
            width: 0,
            height: 0,
            transform: `translate(-50%,-50%) rotate(${hud.damageDeg}deg)`,
            opacity: Math.min(1, hud.damageAlpha * 1.4),
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -14,
              top: -92,
              width: 0,
              height: 0,
              borderLeft: "14px solid transparent",
              borderRight: "14px solid transparent",
              borderBottom: "22px solid var(--sn-danger)",
              filter: "drop-shadow(0 0 6px var(--sn-danger))",
            }}
          />
        </div>
      )}

      {/* La mira y el marcador de impacto. */}
      {inPlay && (
        <div className="pointer-events-none absolute left-1/2 top-1/2" style={{ transform: "translate(-50%,-50%)" }}>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "var(--sn-text)",
              boxShadow: "0 0 6px var(--sn-cyan-400)",
              opacity: 0.9,
            }}
          />
        </div>
      )}
      {fpv && hud.hitCount > 0 && (
        <div
          key={`hit-${hud.hitCount}`}
          className="pointer-events-none absolute left-1/2 top-1/2"
          style={{
            width: 34,
            height: 34,
            animation: "sn-shooter-hit 0.28s ease-out forwards",
            color: "var(--sn-warn)",
          }}
        >
          {[45, -45, 135, -135].map((angle) => (
            <div
              key={angle}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 2,
                height: 12,
                background: "currentColor",
                transformOrigin: "50% 0",
                transform: `rotate(${angle}deg) translate(-50%, 6px)`,
                boxShadow: "0 0 4px currentColor",
              }}
            />
          ))}
        </div>
      )}

      {/* Vida y municion. Abajo, donde no tapan la mira ni los sticks. */}
      {fpv && !hud.spectating && hud.state >= 1 && (
        <>
          <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-end gap-4 sm:bottom-4">
            <div className="flex flex-col items-end">
              <span className="sn-num text-2xl font-bold leading-none" style={{ color: hpTone }}>
                {hud.hp}
              </span>
              <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full" style={{ background: "var(--sn-line-soft)" }}>
                <div
                  className="h-full rounded-full transition-[width] duration-150"
                  style={{ width: `${Math.max(0, Math.min(100, hud.hp))}%`, background: hpTone }}
                />
              </div>
            </div>
            <div className="flex flex-col items-start">
              <span
                className="text-[10px] uppercase tracking-[0.18em]"
                style={{ color: hud.driving ? "var(--sn-text-muted)" : weaponColor(hud.weaponKind) }}
              >
                {hud.driving ? "Al volante" : hud.weapon}
              </span>
              <span className="sn-num text-2xl font-bold leading-none" style={{ color: hud.ammo === 0 ? "var(--sn-warn)" : "var(--sn-text)" }}>
                {hud.reloading > 0 ? "…" : hud.ammo}
                <span className="text-sm text-sn-muted"> / {hud.magazine}</span>
              </span>
              <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full" style={{ background: "var(--sn-line-soft)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${hud.reloading > 0 ? hud.reloading * 100 : (hud.ammo / Math.max(1, hud.magazine)) * 100}%`,
                    background: hud.reloading > 0 ? "var(--sn-warn)" : weaponColor(hud.weaponKind),
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* El minimapa, mientras se juega en primera persona. */}
      {inPlay && <Minimap view={view} />}

      {/* Recargar a mano, sin esperar a quedarse seco. */}
      {inPlay && !hud.driving && hud.reloading === 0 && hud.ammo < hud.magazine && (
        <button
          type="button"
          onClick={onReload}
          className="pointer-events-auto absolute bottom-3 right-3 rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{
            background: "color-mix(in srgb, var(--sn-panel) 88%, transparent)",
            color: hud.ammo === 0 ? "var(--sn-warn)" : "var(--sn-text-muted)",
            border: `1px solid ${hud.ammo === 0 ? "var(--sn-warn)" : "var(--sn-line)"}`,
          }}
          data-game-ui
        >
          Recargar · R
        </button>
      )}

      {/* Interactuar: un cofre cerrado o un auto al alcance. */}
      {fpv && inPlay && hud.interactHint !== HINT_NONE && (
        <button
          type="button"
          onClick={onInteract}
          className="pointer-events-auto absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold"
          style={{
            background: "color-mix(in srgb, var(--sn-panel) 88%, transparent)",
            color: "var(--sn-water-400)",
            border: "1px solid var(--sn-water-400)",
            animation: "sn-shooter-rise 0.25s ease-out",
          }}
          data-game-ui
        >
          {interactLabel}
        </button>
      )}

      {/* Avisos centrales: despliegue, anillo, espera, resultado. */}
      <div className="pointer-events-none absolute left-1/2 top-12 flex -translate-x-1/2 flex-col items-center gap-1 text-center">
        {isHost && hud.state < 3 && (
          <button
            type="button"
            onClick={onToggleHost}
            className="pointer-events-auto rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              background: hostPlaying ? "var(--sn-panel)" : "var(--sn-violet-500)",
              color: "var(--sn-text)",
              border: "1px solid var(--sn-line)",
            }}
            data-game-ui
          >
            {hostPlaying ? "Ver desde arriba · Tab" : "Jugar desde acá · Tab"}
          </button>
        )}
        {hud.state === 0 && fpv && (
          <span className="rounded-full px-3 py-1 text-xs" style={{ background: "var(--sn-panel)", color: "var(--sn-text-muted)" }}>
            Esperando a que el proyector empiece…
          </span>
        )}
        {hud.state === 1 && (
          <>
            <span className="sn-num text-4xl font-bold" style={{ color: "var(--sn-cyan-300)", textShadow: "0 0 18px var(--sn-cyan-500)" }}>
              {hud.deployLeft}
            </span>
            <span className="text-xs uppercase tracking-[0.2em] text-sn-muted">Despliegue · buscá cobertura</span>
          </>
        )}
        {hud.state === 2 && hud.outside && fpv && !hud.spectating && (
          <span
            className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.15em]"
            style={{
              color: "var(--sn-danger)",
              border: "1px solid var(--sn-danger)",
              animation: "sn-shooter-pulse 0.9s ease-in-out infinite",
            }}
          >
            Fuera del anillo
          </span>
        )}
        {hud.state === 2 && hud.ringIn >= 0 && hud.ringIn <= 5 && hud.ringIn > 0 && (
          <span className="text-xs text-sn-muted">El anillo cierra en {hud.ringIn}</span>
        )}
        {hud.spectating && hud.state < 3 && (
          <span className="rounded-full px-3 py-1 text-xs" style={{ background: "var(--sn-panel)", color: "var(--sn-text)", animation: "sn-shooter-rise 0.4s ease-out" }}>
            Quedaste {hud.placement}.º · mirás la partida
          </span>
        )}
        {hud.state === 3 && (
          <span
            className="text-2xl font-bold"
            style={{ color: seatColor(hud.winnerSeat), textShadow: "0 0 16px currentColor", animation: "sn-shooter-rise 0.5s ease-out" }}
          >
            {hud.winnerSeat < 0 ? "Sin ganador" : `Ganó ${hud.winner}`}
          </span>
        )}
      </div>

      {/* Feed de bajas, arriba a la derecha. */}
      <div className="pointer-events-none absolute right-3 top-12 flex flex-col items-end gap-1 text-xs">
        {hud.feed.map((line, index) => (
          <div
            key={`${line.victimSeat}-${line.killerSeat}-${index}`}
            className="rounded-md px-2 py-0.5"
            style={{ background: "color-mix(in srgb, var(--sn-panel) 80%, transparent)", animation: "sn-shooter-rise 0.3s ease-out" }}
          >
            <span style={{ color: seatColor(line.killerSeat) }}>{line.killer}</span>
            <span className="text-sn-muted"> ▸ </span>
            <span style={{ color: seatColor(line.victimSeat), textDecoration: "line-through" }}>{line.victim}</span>
          </div>
        ))}
      </div>

      {/* Tabla del proyector: quien vive y con cuanta vida. Abajo, lejos de los chips. */}
      {(!fpv || hud.spectating) && hud.state >= 1 && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-xs">
          {hud.seats.map((hp, seatIndex) =>
            hp < 0 ? null : (
              <div key={seatIndex} className="flex items-center gap-2" style={{ opacity: hp === 0 ? 0.45 : 1 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: seatColor(seatIndex) }} />
                <span className="w-24 truncate" style={{ textDecoration: hp === 0 ? "line-through" : "none" }}>
                  {hud.names[seatIndex] ?? `Jugador ${seatIndex + 1}`}
                </span>
                <div className="h-1 w-16 overflow-hidden rounded-full" style={{ background: "var(--sn-line-soft)" }}>
                  <div className="h-full" style={{ width: `${hp}%`, background: seatColor(seatIndex) }} />
                </div>
              </div>
            ),
          )}
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
          <span className="text-xs text-sn-muted">El juego es apaisado: el stick a la izquierda y la mira a la derecha.</span>
        </div>
      )}
    </div>
  );
}

/** Cuanto lado tiene el minimapa en pixeles. */
const MINIMAP_PX = 132;
/** Hasta que distancia se ven los cofres y los autos. El resto se busca. */
const MINIMAP_REVEAL = 55;

/**
 * El minimapa: el valle entero visto de arriba, con el anillo, lo que hay
 * cerca y hacia donde se esta mirando.
 *
 * Dibuja en un `<canvas>` 2D con su propio rAF en vez de re-renderizar React:
 * la posicion cambia sesenta veces por segundo y el HUD se muestrea diez.
 *
 * Muestra el anillo siempre —es lo que hay que saber para no morirse— pero
 * los cofres y los autos solo cerca: un mapa que revela los dieciocho cofres
 * de entrada convierte la exploracion en una lista de mandados.
 */
function Minimap({ view }: { view: ShooterView }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const styles = getComputedStyle(document.documentElement);
    const color = (token: string) => styles.getPropertyValue(token).trim() || "#fff";
    const panel = color("--sn-bg-elev");
    const line = color("--sn-line");
    const water = color("--sn-water-400");
    const grass = color("--sn-grass-600");
    const rock = color("--sn-rock-600");
    const text = color("--sn-text");

    const size = view.map.size;
    const scale = MINIMAP_PX / size;
    const toPx = (world: number) => (world + size / 2) * scale;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, MINIMAP_PX, MINIMAP_PX);
      ctx.fillStyle = panel;
      ctx.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);

      // El valle: un rectangulo de pasto con las montanias marcadas.
      ctx.fillStyle = grass;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = rock;
      for (const mountain of view.map.mountains) {
        ctx.beginPath();
        ctx.arc(toPx(mountain.x), toPx(mountain.z), mountain.radius * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // El anillo: donde hay que estar.
      if (view.ringRadius > 0) {
        ctx.strokeStyle = water;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(toPx(view.ringX), toPx(view.ringZ), view.ringRadius * scale, 0, Math.PI * 2);
        ctx.stroke();
      }

      const px = view.body.x;
      const pz = view.body.z;

      // Cofres cerrados y autos libres, solo los de cerca.
      for (let i = 0; i < view.map.chests.length; i++) {
        const chest = view.map.chests[i];
        if (!chest || (view.chestOpened & (1 << i)) !== 0) continue;
        if (Math.hypot(chest.x - px, chest.z - pz) > MINIMAP_REVEAL) continue;
        ctx.fillStyle = text;
        ctx.fillRect(toPx(chest.x) - 1.5, toPx(chest.z) - 1.5, 3, 3);
      }
      for (let car = 0; car < view.carCount; car++) {
        const cx = view.carX[car] ?? 0;
        const cz = view.carZ[car] ?? 0;
        if (Math.hypot(cx - px, cz - pz) > MINIMAP_REVEAL) continue;
        ctx.strokeStyle = text;
        ctx.lineWidth = 1;
        ctx.strokeRect(toPx(cx) - 2.5, toPx(cz) - 2.5, 5, 5);
      }

      // Uno mismo: un triangulo que apunta hacia donde mira. Adelante es
      // (-sin yaw, -cos yaw), la convencion de camara de three.
      const yaw = view.camYaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const cx = toPx(px);
      const cz = toPx(pz);
      ctx.fillStyle = text;
      ctx.beginPath();
      ctx.moveTo(cx + fx * 5, cz + fz * 5);
      ctx.lineTo(cx - fx * 3 - fz * 3, cz - fz * 3 + fx * 3);
      ctx.lineTo(cx - fx * 3 + fz * 3, cz - fz * 3 - fx * 3);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, MINIMAP_PX - 1, MINIMAP_PX - 1);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [view]);

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP_PX}
      height={MINIMAP_PX}
      // Debajo de los chips del HUD, que ocupan dos filas en el proyector.
      className="pointer-events-none absolute left-3 top-32 rounded-lg"
      style={{ border: "1px solid var(--sn-line)", opacity: 0.92 }}
    />
  );
}

function Summary({ hud, isHost, seat }: { hud: HudState; isHost: boolean; seat: number }) {
  if (isHost) {
    return (
      <div className="text-left text-xs text-sn-muted">
        <p className="mb-2">
          {hud.winnerSeat < 0 ? "Nadie quedó en pie." : (
            <>
              Ganó <span style={{ color: seatColor(hud.winnerSeat) }}>{hud.winner}</span>.
            </>
          )}
        </p>
        <p>Los celulares ven su puesto y sus puntos. Reiniciá para otra partida con el mismo mapa.</p>
      </div>
    );
  }
  const won = hud.winnerSeat === seat;
  return (
    <div className="text-left text-xs text-sn-muted">
      <p className="mb-2">
        {won ? "¡Ganaste! Último en pie." : hud.placement > 0 ? `Quedaste ${hud.placement}.º de ${MAX_PLAYERS}.` : "Terminó la partida."}
        {" "}
        Bajas: <span className="sn-num">{hud.kills}</span>.
      </p>
      <p>Puesto, bajas y daño suman puntos; sobrevivir hasta el final, más.</p>
    </div>
  );
}
