import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import { isPlayable, type GameEntry } from "@/core/contract/catalog";
import type { GameOutcome, GameProps, GameRuntimeConfig } from "@/core/contract/game";
import { loadLabPreferences, loadSettings } from "@/core/admin/settingsStore";
import { randomSeed } from "@/core/engine/rng";
import { GAMES } from "@/games/registry";

/**
 * Modo quiosco.
 *
 * Es la bateria convertida en producto: una notebook en la recepcion de un
 * evento, sin sidebar, sin filtros y sin nada que se pueda romper tocando.
 * Solo los juegos habilitados, y vuelve sola a la grilla cuando una partida
 * termina, porque no hay nadie atendiendo la maquina.
 *
 * Igual que el banco de pruebas, **no escribe nada**: lee los administrables
 * que dejo configurados el operador y descarta el resultado.
 */

/** Lo que tarda en volver a la grilla si nadie toca nada. */
const RETURN_AFTER_S = 10;

export default function KioskPage() {
  const [selected, setSelected] = useState<GameEntry | null>(null);

  const games = useMemo(() => GAMES.filter((game) => game.enabled && isPlayable(game)), []);

  if (selected) {
    return <KioskRun key={selected.id} entry={selected} onExit={() => setSelected(null)} />;
  }

  return (
    <div className="sn-nebula flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <div>
          <span className="block bg-gradient-to-r from-sn-violet-300 via-sn-magenta-300 to-sn-cyan-300 bg-clip-text font-display text-lg font-bold tracking-tight text-transparent">
            SUPERNOVA
          </span>
          <span className="text-xs text-sn-dim">Elegí un juego y jugá</span>
        </div>
        <div className="flex items-center gap-2">
          <FullscreenButton />
          {/* Discreto a proposito: es para el que puso el stand, no para el publico. */}
          <Link to="/" className="sn-btn sn-btn--ghost text-[11px]">
            Salir
          </Link>
        </div>
      </header>

      <div className="flex flex-1 items-center px-6 pb-10 sm:px-10">
        {games.length === 0 ? (
          <p className="w-full text-center text-sm text-sn-dim">
            No hay ningún juego habilitado. Prendé alguno desde el catálogo.
          </p>
        ) : (
          <ul className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {games.map((game) => (
              <li key={game.id}>
                <button
                  type="button"
                  onClick={() => setSelected(game)}
                  className="sn-card group flex h-full w-full flex-col gap-2 p-6 text-left transition-transform hover:border-sn-violet hover:-translate-y-0.5"
                >
                  <span className="sn-num text-[10px] tracking-widest text-sn-dim">{game.code}</span>
                  <h2 className="text-xl leading-tight group-hover:text-sn-cyan">{game.title}</h2>
                  <p className="flex-1 text-sm leading-relaxed text-sn-muted">{game.tagline}</p>
                  <span className="sn-num mt-2 text-xs text-sn-dim">~{game.estimatedMin} min</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function KioskRun({ entry, onExit }: { entry: GameEntry; onExit: () => void }) {
  const [outcome, setOutcome] = useState<GameOutcome | null>(null);
  const [runId, setRunId] = useState(0);
  const [seed, setSeed] = useState(randomSeed);
  const [returnIn, setReturnIn] = useState(RETURN_AFTER_S);

  const abortRef = useRef<AbortController>(new AbortController());

  // El operador configura duracion y administrables en el banco de pruebas;
  // el quiosco los respeta en vez de inventar los suyos.
  const settings = useMemo(() => loadSettings(entry.id, entry.settings), [entry]);
  const durationMs = useMemo(() => {
    const seconds = loadLabPreferences(entry.id).durationSec;
    return seconds > 0 ? seconds * 1000 : null;
  }, [entry.id]);

  const config: GameRuntimeConfig = useMemo(
    () => ({ roomId: `kiosk-${entry.id}`, seed, durationMs, seat: 0, isHost: true, playerCount: 1, settings, debug: false }),
    [entry.id, seed, durationMs, settings],
  );

  const GameComponent = useMemo(
    () => (entry.load ? lazy(entry.load as () => Promise<{ default: ComponentType<GameProps> }>) : null),
    [entry],
  );

  const playAgain = useCallback(() => {
    abortRef.current.abort();
    abortRef.current = new AbortController();
    setOutcome(null);
    setReturnIn(RETURN_AFTER_S);
    setSeed(randomSeed());
    setRunId((n) => n + 1);
  }, []);

  const leave = useCallback(() => {
    abortRef.current.abort();
    onExit();
  }, [onExit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

  useEffect(() => {
    const controller = abortRef.current;
    return () => controller.abort();
  }, []);

  /* Nadie atiende la maquina: la partida terminada vuelve sola a la grilla. */
  useEffect(() => {
    if (!outcome) return;
    const timer = window.setInterval(() => {
      setReturnIn((left) => {
        if (left <= 1) {
          window.clearInterval(timer);
          onExit();
          return 0;
        }
        return left - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [outcome, onExit]);

  return (
    <div className="relative flex h-full min-h-full flex-col bg-sn-bg p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h1 className="text-base">{entry.title}</h1>
        <button type="button" className="sn-btn sn-btn--ghost text-[11px]" onClick={leave}>
          Volver a los juegos
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {GameComponent && (
          <Suspense fallback={<div className="grid h-full place-items-center text-xs text-sn-dim">Cargando…</div>}>
            <GameComponent
              key={runId}
              config={config}
              net={null}
              signal={abortRef.current.signal}
              onFinish={setOutcome}
            />
          </Suspense>
        )}
      </div>

      {outcome && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-sn-bg/90 p-6 backdrop-blur-sm">
          <div className="sn-card w-full max-w-sm p-7 text-center">
            <h2 className="mb-1 text-xl">Terminó</h2>
            <p className="sn-num mb-6 text-4xl font-semibold text-sn-cyan">{outcome.points}</p>
            <div className="flex flex-col gap-2">
              <button type="button" className="sn-btn sn-btn--primary h-11" onClick={playAgain} autoFocus>
                Jugar de nuevo
              </button>
              <button type="button" className="sn-btn h-11" onClick={onExit}>
                Elegir otro juego
              </button>
            </div>
            <p className="sn-num mt-4 text-[11px] text-sn-dim" aria-live="polite">
              Vuelve solo en {returnIn}s
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FullscreenButton() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onChange = () => setActive(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    // Los navegadores solo lo permiten dentro de un gesto del usuario, por eso
    // esto es un boton y no algo que el modo quiosco haga solo al entrar.
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  return (
    <button type="button" className="sn-btn text-[11px]" onClick={toggle} aria-pressed={active}>
      {active ? "Salir de pantalla completa" : "Pantalla completa"}
    </button>
  );
}
