import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { ComponentType } from "react";
import QRCode from "qrcode";
import {
  ENGINE_LABEL,
  INPUT_LABEL,
  isPlayable,
  phoneRoleOf,
  TOPOLOGY_LABEL,
  type GameEntry,
} from "@/core/contract/catalog";
import type { GameOutcome, GameProps, GameRuntimeConfig } from "@/core/contract/game";
import type { SettingValue, SettingsValues } from "@/core/contract/settings";
import { randomSeed } from "@/core/engine/rng";
import { createBroadcastNet, type BroadcastNetPort } from "@/core/net/broadcastNet";
import {
  hasCustomSettings,
  loadLabPreferences,
  loadSettings,
  resetSettings,
  saveLabPreferences,
  saveSettings,
  type LabPreferences,
} from "@/core/admin/settingsStore";
import { getGame } from "@/games/registry";
import { SettingsPanel } from "@/ui/admin/SettingsPanel";
import { EffortChip, StatusChip, TopologyChip } from "@/ui/catalog/badges";

/**
 * El banco de pruebas.
 *
 * Lo que lo hace valer: semilla editable (misma semilla, misma partida, bug
 * reportable), "forzar fin" que dispara el mismo camino que usaria un host, y
 * el outcome mostrado CRUDO tal como lo emitio el juego.
 *
 * Jugar aca no escribe nada: se muestra y se descarta.
 */

type Tab = "run" | "settings" | "result";

export default function GameLabPage() {
  const { id } = useParams();
  const entry = getGame(id);

  if (!entry) {
    return (
      <EmptyState title="Ese juego no existe">
        <Link to="/" className="sn-btn">
          Volver al catálogo
        </Link>
      </EmptyState>
    );
  }

  // La key remonta todo el laboratorio al cambiar de juego: sin esto quedan
  // administrables y outcome del juego anterior.
  return <GameLab key={entry.id} entry={entry} />;
}

function GameLab({ entry }: { entry: GameEntry }) {
  const [tab, setTab] = useState<Tab>("run");
  const [prefs, setPrefs] = useState<LabPreferences>(() => loadLabPreferences(entry.id));
  const [settings, setSettings] = useState<SettingsValues>(() => loadSettings(entry.id, entry.settings));
  const [custom, setCustom] = useState(() => hasCustomSettings(entry.id));
  const [outcome, setOutcome] = useState<GameOutcome | null>(null);
  const [runId, setRunId] = useState(0);
  const [runSeed, setRunSeed] = useState(() => prefs.seed || randomSeed());
  const [qr, setQr] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  const abortRef = useRef<AbortController>(new AbortController());
  const netRef = useRef<BroadcastNetPort | null>(null);

  const playable = isPlayable(entry);

  const patchPrefs = useCallback(
    (patch: Partial<LabPreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        saveLabPreferences(entry.id, next);
        return next;
      });
    },
    [entry.id],
  );

  const patchSetting = useCallback(
    (key: string, value: SettingValue) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        saveSettings(entry.id, next);
        return next;
      });
      setCustom(true);
    },
    [entry.id],
  );

  const restoreSettings = useCallback(() => {
    setSettings(resetSettings(entry.id, entry.settings));
    setCustom(false);
    setRunId((n) => n + 1);
  }, [entry.id, entry.settings]);

  const startRun = useCallback(
    (seed?: string) => {
      abortRef.current.abort();
      abortRef.current = new AbortController();
      setOutcome(null);
      setRunSeed(seed ?? (prefs.seed || randomSeed()));
      setRunId((n) => n + 1);
    },
    [prefs.seed],
  );

  const forceEnd = useCallback(() => {
    // Es el mismo camino que usa un host al cortar la ronda. Siempre se rompe
    // y nadie lo prueba: por eso esta a un click.
    abortRef.current.abort();
  }, []);

  /* Puerto de red solo si el juego lo pide. Los `solo` reciben null. */
  useEffect(() => {
    if (!entry.needsNet) {
      netRef.current = null;
      return;
    }
    const port = createBroadcastNet({
      roomId: `lab-${entry.id}`,
      seat: prefs.seat,
      role: prefs.seat === 0 ? "host" : "client",
    });
    netRef.current = port;
    return () => {
      port.close();
      netRef.current = null;
    };
  }, [entry.id, entry.needsNet, prefs.seat]);

  useEffect(() => {
    netRef.current?.setSimulation({
      latencyMs: prefs.latencyMs,
      lossRate: prefs.lossPercent / 100,
    });
  }, [prefs.latencyMs, prefs.lossPercent]);

  useEffect(() => {
    const controller = abortRef.current;
    return () => controller.abort();
  }, []);

  /*
   * El asiento puede venir en la URL: es como el QR reparte los puestos. El
   * numero de la URL es 1-based porque es el que ve una persona en pantalla.
   */
  const urlSeat = searchParams.get("asiento");
  useEffect(() => {
    if (urlSeat === null) return;
    const parsed = Number(urlSeat);
    if (!Number.isFinite(parsed)) return;
    patchPrefs({ seat: Math.min(entry.maxPlayers - 1, Math.max(0, Math.round(parsed) - 1)) });
  }, [urlSeat, entry.maxPlayers, patchPrefs]);

  /*
   * La semilla tambien viene en el QR, y manda sobre la que genera este
   * navegador: es lo que hace que todos jueguen la misma pista, el mismo
   * tablero y el mismo orden inicial. Sin esto cada aparato inventaba el suyo
   * y los puntajes dejaban de ser comparables.
   */
  const urlSeed = searchParams.get("semilla");
  useEffect(() => {
    if (urlSeed) setRunSeed(urlSeed.slice(0, 16));
  }, [urlSeed]);

  const config: GameRuntimeConfig = useMemo(
    () => ({
      roomId: `lab-${entry.id}`,
      seed: runSeed,
      durationMs: prefs.durationSec > 0 ? prefs.durationSec * 1000 : null,
      seat: prefs.seat,
      // El asiento 0 es el proyector. El contenedor lo decide; el juego lo lee.
      isHost: prefs.seat === 0,
      playerCount: prefs.playerCount,
      // El mismo que viaja en el QR. Si el proyector y el celular no coinciden
      // aca, no hay forma de que se vean.
      transport: prefs.transport,
      settings,
      debug: true,
    }),
    [entry.id, runSeed, prefs.durationSec, prefs.seat, prefs.playerCount, prefs.transport, settings],
  );

  const GameComponent = useMemo(
    () => (entry.load ? lazy(entry.load as () => Promise<{ default: ComponentType<GameProps> }>) : null),
    [entry],
  );

  const showQr = useCallback(async () => {
    if (qr) {
      setQr(null);
      return;
    }
    // El parametro va DENTRO del hash: con createHashRouter, lo que queda
    // antes del `#` no lo ve el router y el asiento se perderia.
    const url = new URL(window.location.href);
    // Adonde manda el QR depende de que hace el telefono, no de la topologia:
    // hay juegos `arena` donde el celular es un mando y otros donde corre la
    // partida entera. Ver `phoneRoleOf`.
    // La semilla viaja SIEMPRE. Sin ella cada navegador genera la suya, y se
    // cae la premisa de medio catalogo: la misma pista para todos en Corredor,
    // el mismo tablero en Match-3, el mismo orden inicial en Prioridades.
    const seedParam = `&semilla=${encodeURIComponent(runSeed)}`;
    if (phoneRoleOf(entry) === "player") {
      // Un juego en red donde el celular juega: el banco ya ocupa su asiento,
      // asi que el QR invita al siguiente. En un `solo` no hay con quien
      // chocar y el asiento es el mismo.
      const seat = entry.needsNet ? prefs.seat + 2 : prefs.seat + 1;
      url.hash = `#/juego/${entry.id}?asiento=${seat}${seedParam}`;
    } else {
      /*
       * `asientos` son los del JUEGO, no los que simula el banco de pruebas.
       *
       * Antes viajaba `prefs.playerCount`, que es otra cosa: cuantos jugadores
       * simula esta maquina, con 1 por defecto. El celular usaba ese numero
       * como techo de lo que podia pedir, asi que con el valor por defecto
       * todo lugar que la persona tocara se recortaba al asiento 0 —el unico
       * ocupado— y la pantalla de elegir volvia sola, para siempre. El host
       * abre `maxPlayers` asientos: eso es lo que hay que decirle al telefono.
       */
      url.hash = `#/control/lab-${entry.id}?asiento=${prefs.seat + 1}&asientos=${entry.maxPlayers}&transporte=${prefs.transport}`;
    }
    try {
      setQr(await QRCode.toDataURL(url.toString(), { margin: 1, width: 220 }));
    } catch {
      setQr(null);
    }
  }, [qr, prefs.seat, prefs.transport, entry, runSeed]);

  return (
    <div className="flex min-h-full flex-col xl:h-full xl:flex-row">
      <section className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="sn-num text-[10px] tracking-widest text-sn-dim">{entry.code}</span>
              <StatusChip status={entry.status} />
              {!entry.enabled && <span className="sn-chip">Apagado</span>}
            </div>
            <h1 className="mt-0.5 text-xl">{entry.title}</h1>
            <p className="mt-0.5 max-w-xl text-xs text-sn-muted">{entry.tagline}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            <TopologyChip topology={entry.topology} />
            <span className="sn-chip">{ENGINE_LABEL[entry.engine]}</span>
            <EffortChip entry={entry} />
            <span className="sn-chip">Tanda {entry.batch}</span>
          </div>
        </header>

        <div className="min-h-[420px] flex-1">
          {playable && GameComponent ? (
            <Suspense fallback={<LoadingStage />}>
              <GameComponent
                key={runId}
                config={config}
                net={netRef.current}
                signal={abortRef.current.signal}
                onFinish={setOutcome}
              />
            </Suspense>
          ) : (
            <PendingSpec entry={entry} />
          )}
        </div>
      </section>

      <aside className="w-full shrink-0 border-t border-sn-line-soft bg-sn-bg-elev xl:h-full xl:w-[336px] xl:border-l xl:border-t-0">
        <div className="flex border-b border-sn-line-soft">
          <TabButton active={tab === "run"} onClick={() => setTab("run")}>
            Partida
          </TabButton>
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
            Administrables
          </TabButton>
          <TabButton active={tab === "result"} onClick={() => setTab("result")}>
            Resultado
          </TabButton>
        </div>

        <div className="sn-scroll-y p-4 xl:h-[calc(100%-41px)]">
          {tab === "run" && (
            <RunPanel
              entry={entry}
              prefs={prefs}
              runSeed={runSeed}
              playable={playable}
              qr={qr}
              onPatch={patchPrefs}
              onRestart={() => startRun()}
              onNewSeed={() => startRun(randomSeed())}
              onForceEnd={forceEnd}
              onToggleQr={showQr}
            />
          )}

          {tab === "settings" && (
            <SettingsPanel
              schema={entry.settings}
              values={settings}
              onChange={patchSetting}
              onReset={restoreSettings}
              hasCustom={custom}
            />
          )}

          {tab === "result" && <ResultPanel outcome={outcome} />}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RunPanel({
  entry,
  prefs,
  runSeed,
  playable,
  qr,
  onPatch,
  onRestart,
  onNewSeed,
  onForceEnd,
  onToggleQr,
}: {
  entry: GameEntry;
  prefs: LabPreferences;
  runSeed: string;
  playable: boolean;
  qr: string | null;
  onPatch: (patch: Partial<LabPreferences>) => void;
  onRestart: () => void;
  onNewSeed: () => void;
  onForceEnd: () => void;
  onToggleQr: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Row label="Duración" hint="0 = sin límite de tiempo">
        <div className="flex items-center gap-2">
          <input
            type="range"
            className="sn-range"
            min={0}
            max={300}
            step={15}
            value={prefs.durationSec}
            onChange={(e) => onPatch({ durationSec: Number(e.target.value) })}
            aria-label="Duración en segundos"
          />
          <span className="sn-num w-12 shrink-0 text-right text-[11px] text-sn-cyan">
            {prefs.durationSec === 0 ? "libre" : `${prefs.durationSec}s`}
          </span>
        </div>
      </Row>

      <Row label="Semilla" hint="Vacía = una nueva por partida. Fija = partida reproducible.">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            className="sn-input"
            placeholder={runSeed}
            maxLength={16}
            value={prefs.seed}
            onChange={(e) => onPatch({ seed: e.target.value.trim() })}
            aria-label="Semilla"
          />
          <button type="button" className="sn-btn h-8 shrink-0 text-xs" onClick={onNewSeed}>
            Nueva
          </button>
        </div>
        <p className="mt-1 text-[11px] text-sn-dim">
          En juego: <span className="sn-num text-sn-cyan">{runSeed}</span>
        </p>
      </Row>

      {entry.maxPlayers > 1 && (
        <>
          <Row label={`Asiento · ${prefs.seat + 1}`}>
            <input
              type="range"
              className="sn-range"
              min={0}
              max={entry.maxPlayers - 1}
              value={prefs.seat}
              onChange={(e) => onPatch({ seat: Number(e.target.value) })}
              aria-label="Asiento"
            />
          </Row>
          <Row label={`Jugadores · ${prefs.playerCount}`}>
            <input
              type="range"
              className="sn-range"
              min={entry.minPlayers}
              max={entry.maxPlayers}
              value={prefs.playerCount}
              onChange={(e) => onPatch({ playerCount: Number(e.target.value) })}
              aria-label="Cantidad de jugadores"
            />
          </Row>
        </>
      )}

      {entry.needsNet && (
        <>
          <Row
            label="Transporte"
            hint={
              prefs.transport === "webrtc"
                ? "Celulares de verdad. Necesita HTTPS: npm run dev:https"
                : "Dos pestañas de esta misma máquina. Alcanza para desarrollar."
            }
          >
            <div className="flex gap-1">
              {(["local", "webrtc"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onPatch({ transport: kind })}
                  aria-pressed={prefs.transport === kind}
                  className={`flex-1 rounded-sn border px-2 py-1.5 text-[11px] transition-colors ${
                    prefs.transport === kind
                      ? "border-transparent bg-sn-violet text-white"
                      : "border-sn-line bg-sn-bg-elev text-sn-muted hover:text-sn-text"
                  }`}
                >
                  {kind === "local" ? "Pestañas" : "WebRTC"}
                </button>
              ))}
            </div>
          </Row>
          <Row label={`Latencia · ${prefs.latencyMs} ms`} hint="Un juego de red probado a 0 ms no está probado.">
            <input
              type="range"
              className="sn-range"
              min={0}
              max={300}
              step={10}
              value={prefs.latencyMs}
              onChange={(e) => onPatch({ latencyMs: Number(e.target.value) })}
              aria-label="Latencia simulada"
            />
          </Row>
          <Row label={`Pérdida · ${prefs.lossPercent}%`}>
            <input
              type="range"
              className="sn-range"
              min={0}
              max={25}
              value={prefs.lossPercent}
              onChange={(e) => onPatch({ lossPercent: Number(e.target.value) })}
              aria-label="Pérdida de paquetes simulada"
            />
          </Row>
        </>
      )}

      <div className="flex flex-col gap-2 border-t border-sn-line-soft pt-4">
        <button type="button" className="sn-btn sn-btn--primary" onClick={onRestart} disabled={!playable}>
          Reiniciar partida
        </button>
        <button type="button" className="sn-btn sn-btn--danger" onClick={onForceEnd} disabled={!playable}>
          Forzar fin
        </button>
        <button type="button" className="sn-btn" onClick={onToggleQr}>
          {qr ? "Ocultar QR" : "Abrir en el celular"}
        </button>
        {qr && (
          <figure className="flex flex-col items-center gap-2 rounded-sn border border-sn-line-soft bg-white p-3">
            <img src={qr} alt="Código QR con la dirección de esta prueba" width={200} height={200} />
            <figcaption className="text-[10px] text-black">
              Mismo banco de pruebas, misma semilla.
            </figcaption>
          </figure>
        )}
      </div>

      <div className="border-t border-sn-line-soft pt-4">
        <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sn-dim">Ficha</h4>
        <dl className="flex flex-col gap-1 text-[11px]">
          <Spec term="Topología" value={TOPOLOGY_LABEL[entry.topology]} />
          <Spec term="Motor" value={ENGINE_LABEL[entry.engine]} />
          <Spec term="Controles" value={entry.inputs.map((i) => INPUT_LABEL[i]).join(", ")} />
          <Spec term="Necesita red" value={entry.needsNet ? "Sí" : "No"} />
          <Spec term="Spec" value={`games-guide/${entry.guide}`} />
        </dl>
      </div>
    </div>
  );
}

function ResultPanel({ outcome }: { outcome: GameOutcome | null }) {
  if (!outcome) {
    return (
      <p className="py-8 text-center text-xs text-sn-dim">
        Todavía no terminó ninguna partida. El resultado se muestra crudo, tal como lo emite el
        juego, y no se guarda en ningún lado.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Puntos" value={outcome.points} tone="cyan" />
        <Metric label="Duración" value={`${(outcome.durationMs / 1000).toFixed(2)} s`} />
      </div>
      <div className="rounded-sn border border-sn-line-soft bg-sn-bg px-3 py-2 text-[11px]">
        <span className="text-sn-dim">completed: </span>
        <span className={outcome.completed ? "text-sn-success" : "text-sn-warn"}>
          {String(outcome.completed)}
        </span>
      </div>
      <div>
        <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sn-dim">meta</h4>
        <pre className="sn-num overflow-x-auto rounded-sn border border-sn-line-soft bg-sn-bg p-3 text-[11px] leading-relaxed text-sn-muted">
          {JSON.stringify(outcome.meta ?? {}, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function PendingSpec({ entry }: { entry: GameEntry }) {
  return (
    <div className="sn-card sn-grid-floor grid h-full min-h-[420px] place-items-center p-8 text-center">
      <div className="max-w-md">
        <p className="sn-chip mb-3">Tanda {entry.batch}</p>
        <h2 className="mb-2 text-lg">Todavía no está implementado</h2>
        <p className="text-sm text-sn-muted">
          Está especificado en <span className="sn-num text-sn-cyan">games-guide/{entry.guide}</span> y
          entra en la tanda {entry.batch} del roadmap. Cuando exista, se juega desde acá sin tocar
          nada más.
        </p>
        <Link to="/roadmap" className="sn-btn mt-5">
          Ver el roadmap
        </Link>
      </div>
    </div>
  );
}

function LoadingStage() {
  return (
    <div className="sn-card grid h-full min-h-[420px] place-items-center">
      <span className="text-xs text-sn-dim">Cargando el juego…</span>
    </div>
  );
}

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center p-8 text-center">
      <div>
        <h1 className="mb-4 text-xl">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 border-b-2 px-2 py-2.5 text-[11px] font-medium transition-colors ${
        active
          ? "border-sn-violet text-sn-text"
          : "border-transparent text-sn-dim hover:text-sn-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-sn-text">{label}</span>
      {children}
      {hint && <p className="text-[11px] leading-snug text-sn-dim">{hint}</p>}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "cyan" }) {
  return (
    <div className="rounded-sn border border-sn-line-soft bg-sn-bg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-sn-dim">{label}</div>
      <div className={`sn-num text-lg ${tone === "cyan" ? "text-sn-cyan" : "text-sn-text"}`}>{value}</div>
    </div>
  );
}

function Spec({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-sn-dim">{term}</dt>
      <dd className="truncate text-right text-sn-muted">{value}</dd>
    </div>
  );
}
