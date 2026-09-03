import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameProps } from "@/core/contract/game";
import { createRng } from "@/core/engine/rng";
import { MatchBoard } from "@/core/corporate/MatchBoard";
import { useDeadline } from "@/core/corporate/hooks";
import {
  buildMemoriaBoard,
  computeMemoriaPoints,
  countCorrectLinks,
  memoriaMeta,
} from "./logic";

/**
 * C4 - Memoria de valores.
 *
 * Unir cada principio de la cultura con lo que significa, contra reloj. La
 * mecanica entera es MatchBoard, de core/corporate: aca viven el reloj, el
 * puntaje y el cierre, que es lo unico que el tablero no puede saber.
 *
 * La disposicion sale del PRNG sembrado con `config.seed`. Todos los que juegan
 * la misma partida reciben los mismos pares en el mismo lugar, que es lo que
 * hace que dos puntajes se puedan comparar.
 */
export default function MemoriaGame({ config, signal, onFinish, onReady }: GameProps) {
  const board = useMemo(
    () => buildMemoriaBoard(config.settings, createRng(config.seed)),
    [config.settings, config.seed],
  );
  const totalPairs = board.pairs.length;

  const [phase, setPhase] = useState<"intro" | "playing" | "done">("intro");
  const [links, setLinks] = useState<readonly string[]>([]);
  const [misses, setMisses] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);

  // Lo que lee el cierre por `force-end` va en refs: el listener se registra una
  // vez y tiene que ver lo ultimo unido, no lo del montaje.
  const linksRef = useRef<readonly string[]>([]);
  const missesRef = useRef(0);
  const startedAtRef = useRef(performance.now());
  const finishedRef = useRef(false);

  const finish = useCallback(
    (completed: boolean) => {
      if (finishedRef.current) return; // el contrato pide exactamente una vez
      finishedRef.current = true;

      const elapsedMs = Math.round(performance.now() - startedAtRef.current);
      const matchedPairs = countCorrectLinks(board, linksRef.current);
      const points = computeMemoriaPoints({
        matchedPairs,
        completed,
        elapsedMs,
        durationMs: config.durationMs,
        pointsPerPair: board.pointsPerPair,
        bonusPerSecond: board.bonusPerSecond,
      });

      setSummary({ points, matchedPairs, misses: missesRef.current, completed, elapsedMs });
      setPhase("done");
      onFinish({
        completed,
        points,
        durationMs: elapsedMs,
        meta: memoriaMeta({
          matchedPairs,
          totalPairs: board.pairs.length,
          misses: missesRef.current,
          completed,
          points,
          pointsPerPair: board.pointsPerPair,
          limitMs: config.durationMs,
        }),
      });
    },
    [board, config.durationMs, onFinish],
  );

  /* Forzar fin: emite el parcial en el acto, con los pares logrados hasta aca. */
  useEffect(() => {
    if (signal.aborted) {
      finish(false);
      return;
    }
    const onAbort = () => finish(false);
    signal.addEventListener("abort", onAbort);
    return () => signal.removeEventListener("abort", onAbort);
  }, [finish, signal]);

  // El reloj arranca al empezar, no al montar: la pantalla de intro no puede
  // comerse segundos que despues se cobran como bono.
  const remainingMs = useDeadline(
    phase === "playing" ? config.durationMs : null,
    useCallback(() => finish(false), [finish]),
  );

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  const handleMatch = (link: string, correct: boolean) => {
    if (!correct) {
      missesRef.current += 1;
      setMisses(missesRef.current);
      return;
    }
    if (linksRef.current.includes(link)) return;

    const next = [...linksRef.current, link];
    linksRef.current = next;
    setLinks(next);
    if (next.length === totalPairs) finish(true);
  };

  const start = () => {
    if (totalPairs === 0) {
      finish(false); // sin contenido no hay partida que jugar
      return;
    }
    startedAtRef.current = performance.now();
    setPhase("playing");
  };

  // El hook recien publica el restante en su primer tic: hasta ahi se muestra el
  // limite completo, para que el reloj no aparezca un cuarto de segundo tarde.
  const shownRemainingMs = remainingMs ?? config.durationMs;
  const showClock = board.showTimer && shownRemainingMs !== null;
  const lowTime = shownRemainingMs !== null && shownRemainingMs <= 10_000;

  /* ---------------------------------------------------------------- */

  if (phase === "intro") {
    return (
      <Shell>
        <div className="sn-card flex flex-col gap-4 p-6 text-center">
          <span className="sn-chip self-center">Memoria de valores</span>
          <h2 className="text-xl text-sn-text">{board.prompt}</h2>
          <p className="text-sm text-sn-muted">
            {totalPairs === 0
              ? "Todavía no hay pares cargados en el panel."
              : `${totalPairs} pares. Cada uno suma ${board.pointsPerPair} puntos${
                  config.durationMs !== null
                    ? `, y completar antes de tiempo suma ${board.bonusPerSecond} por segundo que sobre.`
                    : "."
                }`}
          </p>
          <button
            type="button"
            className="sn-btn sn-btn--primary h-11 w-full"
            onClick={start}
            autoFocus
          >
            {totalPairs === 0 ? "Terminar" : "Empezar"}
          </button>
        </div>
      </Shell>
    );
  }

  if (phase === "playing") {
    return (
      <Shell>
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="sn-num text-lg text-sn-cyan">{links.length}</span>
            <span className="text-xs text-sn-muted">de {totalPairs} pares</span>
          </div>
          <div className="flex items-center gap-2">
            {misses > 0 && (
              <span className="sn-chip">
                <span aria-hidden="true">✕</span>
                <span className="sn-num">{misses}</span>
                <span className="sr-only">errores</span>
              </span>
            )}
            {showClock && (
              <span className={`sn-num text-sm ${lowTime ? "text-sn-danger" : "text-sn-muted"}`}>
                <span className="sr-only">Tiempo restante </span>
                {formatClock(shownRemainingMs ?? 0)}
              </span>
            )}
          </div>
        </header>

        <div className="sn-card flex flex-col gap-3 p-4">
          <h2 className="text-base leading-snug text-sn-text">{board.prompt}</h2>
          <MatchBoard
            pairs={board.pairs}
            rightOrder={board.rightOrder}
            matched={links}
            onMatch={handleMatch}
            wrongFeedbackMs={board.wrongFeedbackMs}
            leftLabel="Principio"
            rightLabel="Qué significa"
          />
        </div>

        {board.showTimer && lowTime && (
          <p className="sn-num text-center text-xs text-sn-danger" aria-live="polite">
            Quedan {Math.ceil((shownRemainingMs ?? 0) / 1000)} s
          </p>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <MemoriaSummary summary={summary} totalPairs={totalPairs} />
    </Shell>
  );
}

/* ------------------------------------------------------------------ */

type Summary = {
  points: number;
  matchedPairs: number;
  misses: number;
  completed: boolean;
  elapsedMs: number;
};

/**
 * Centrado cuando entra y con scroll cuando no: un tablero de diez pares en un
 * telefono no puede quedar cortado por arriba, que es lo que pasa al centrar
 * con flex sin el `min-h-full` de adentro.
 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="sn-scroll-y h-full w-full">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-4 p-4">
        {children}
      </div>
    </div>
  );
}

/** mm:ss, tabular, para que el ancho no tiemble segundo a segundo. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function MemoriaSummary({
  summary,
  totalPairs,
}: {
  summary: Summary | null;
  totalPairs: number;
}) {
  if (!summary) return null;

  return (
    <div className="sn-card flex flex-col gap-5 p-6" aria-live="polite">
      <header className="flex flex-col items-center gap-2 text-center">
        <span className="sn-chip">
          <span aria-hidden="true">{summary.completed ? "✓" : "•"}</span>
          {summary.completed ? "Tablero completo" : "Se cortó el tiempo"}
        </span>
        <p className="sn-num text-3xl text-sn-cyan">{summary.points}</p>
        <p className="text-xs text-sn-muted">puntos</p>
      </header>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Pares" value={`${summary.matchedPairs}/${totalPairs}`} />
        <Stat label="Errores" value={String(summary.misses)} />
        <Stat label="Tiempo" value={formatClock(summary.elapsedMs)} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sn border border-sn-line-soft bg-sn-bg-elev p-3">
      <dt className="text-[11px] uppercase tracking-wider text-sn-dim">{label}</dt>
      <dd className="sn-num text-base text-sn-text">{value}</dd>
    </div>
  );
}
