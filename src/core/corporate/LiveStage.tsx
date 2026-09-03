import type { ReactNode } from "react";
import type { BarsAggregate } from "./aggregate";
import type { LiveRankEntry, LiveRoundPhase } from "./liveRound";

/**
 * La pantalla del proyector durante una ronda en vivo.
 *
 * La comparten Trivia relampago y Verdadero o falso: cambia lo que cada uno
 * pone al costado, no el marco.
 *
 * Es un PROYECTOR, no un monitor. Todo lo de aca esta dimensionado para leerse
 * desde el fondo de una sala: el enunciado arranca en 48 px sobre un lienzo de
 * 1920 y crece con la pantalla. Si algo se lee comodo en un portatil a 40 cm,
 * esta chico.
 */

export type LiveStageProps = {
  phase: LiveRoundPhase;
  /** 0-based. Se muestra +1. */
  itemIndex: number;
  totalItems: number;
  question: string;
  /** 0..1 de la ventana ya consumida. */
  progress: number;
  answered: number;
  eligible: number;
  /** Arriba a la derecha. "Quedan 24" en C6; el reloj en C1. */
  headline?: ReactNode;
  /** Debajo del enunciado: las opciones, el reparto, lo que sea. */
  children?: ReactNode;
  /** Solo en el cierre: la correcta y la explicacion. */
  reveal?: ReactNode;
  /** Columna lateral: ranking, lista de vivos. */
  aside?: ReactNode;
};

export function LiveStage({
  phase,
  itemIndex,
  totalItems,
  question,
  progress,
  answered,
  eligible,
  headline,
  children,
  reveal,
  aside,
}: LiveStageProps) {
  const answering = phase === "respuesta";

  return (
    <div className="flex h-full min-h-0 w-full gap-6 p-6">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="mb-4 flex shrink-0 items-baseline justify-between gap-6">
          <span className="sn-num text-[clamp(0.9rem,1.4vw,1.4rem)] tracking-widest text-sn-dim">
            {phaseLabel(phase)} · {Math.min(itemIndex + 1, totalItems)} de {totalItems}
          </span>
          {headline}
        </header>

        {/* El enunciado es lo unico dominante de la pantalla. */}
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <p className="text-balance text-center font-display text-[clamp(1.6rem,3.4vw,3.6rem)] font-semibold leading-tight text-sn-text">
            {question}
          </p>

          {reveal && <div className="mt-8">{reveal}</div>}
          {children && <div className="mt-8">{children}</div>}
        </div>

        <footer className="mt-4 shrink-0">
          {/* Reloj como barra, no como numero: se lee de reojo sin dejar de
              pensar la respuesta. */}
          <div className="h-3 overflow-hidden rounded-full bg-sn-line" aria-hidden="true">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, (1 - progress) * 100))}%`,
                background: progress > 0.8 ? "var(--sn-magenta-400)" : "var(--sn-cyan-400)",
              }}
            />
          </div>
          {answering && (
            <p
              className="sn-num mt-3 text-center text-[clamp(1rem,1.8vw,1.8rem)] text-sn-muted"
              aria-live="polite"
            >
              {/* Es lo que le dice al host cuando puede cortar. */}
              {answered} de {eligible} respondieron
            </p>
          )}
        </footer>
      </section>

      {aside && (
        <aside className="hidden w-[clamp(16rem,22vw,26rem)] shrink-0 overflow-hidden lg:block">
          {aside}
        </aside>
      )}
    </div>
  );
}

function phaseLabel(phase: LiveRoundPhase): string {
  switch (phase) {
    case "anuncio":
      return "PREPARENSE";
    case "lectura":
      return "LEAN";
    case "respuesta":
      return "RESPONDAN";
    case "cierre":
      return "RESULTADO";
    case "ranking":
      return "POSICIONES";
  }
}

/* ------------------------------------------------------------------ */

/**
 * El reparto de respuestas.
 *
 * Se dibuja recien al cerrar: mostrarlo mientras la sala responde le regala la
 * respuesta a quien todavia esta pensando.
 */
export function LiveBars({ data }: { data: BarsAggregate }) {
  return (
    <ul className="flex flex-col gap-2">
      {data.options.map((option) => {
        const isCorrect = option.correct === true;
        return (
          <li key={option.id} className="flex items-center gap-3">
            <span
              className={`w-[clamp(6rem,14vw,16rem)] shrink-0 truncate text-[clamp(0.85rem,1.4vw,1.4rem)] ${
                isCorrect ? "font-semibold text-sn-success" : "text-sn-muted"
              }`}
            >
              {/* La correcta se marca con simbolo ademas de color. */}
              {isCorrect && <span aria-hidden="true">✓ </span>}
              {option.label}
            </span>
            <span className="h-4 min-w-0 flex-1 overflow-hidden rounded-full bg-sn-line">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${option.pct}%`,
                  background: isCorrect ? "var(--sn-success)" : "var(--sn-violet-500)",
                }}
              />
            </span>
            <span className="sn-num w-16 shrink-0 text-right text-[clamp(0.8rem,1.2vw,1.2rem)] text-sn-dim">
              {option.pct}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */

export type LiveRankingTableProps = {
  rows: readonly LiveRankEntry[];
  /** Cuantos entran. Mas de los que entran no se leen. */
  limit?: number;
  title?: string;
};

/**
 * El ranking del proyector.
 *
 * Los nombres se recortan: la lista completa de 40 personas no entra ni se
 * lee, y una tabla que se desborda es peor que una tabla corta.
 */
export function LiveRankingTable({ rows, limit = 5, title = "Posiciones" }: LiveRankingTableProps) {
  const visible = rows.slice(0, limit);

  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-3 text-[clamp(0.7rem,1vw,1rem)] font-semibold uppercase tracking-[0.14em] text-sn-dim">
        {title}
      </h2>
      <ol className="flex flex-col gap-2">
        {visible.map((row) => (
          <li
            key={row.participantId}
            className="flex items-center gap-3 rounded-sn border border-sn-line-soft bg-sn-bg-elev px-3 py-2"
          >
            <span className="sn-num w-8 shrink-0 text-[clamp(0.9rem,1.4vw,1.5rem)] text-sn-cyan">
              {row.position}
            </span>
            <span className="min-w-0 flex-1 truncate text-[clamp(0.85rem,1.2vw,1.3rem)] text-sn-text">
              {row.name}
            </span>
            <span className="sn-num shrink-0 text-[clamp(0.85rem,1.2vw,1.3rem)] text-sn-muted">
              {row.points}
            </span>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-3 py-2 text-[clamp(0.8rem,1.1vw,1.1rem)] text-sn-dim">
            Todavía no hay nadie.
          </li>
        )}
      </ol>
      {rows.length > visible.length && (
        <p className="sn-num mt-2 px-3 text-[clamp(0.7rem,0.9vw,0.9rem)] text-sn-dim">
          +{rows.length - visible.length} más
        </p>
      )}
    </div>
  );
}
