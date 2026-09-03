import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ControlInput } from "@/core/contract/control";
import type { GameProps } from "@/core/contract/game";
import { aggregateBars, type BarsAggregate } from "@/core/corporate/aggregate";
import { useDeadline, usePrefersReducedMotion } from "@/core/corporate/hooks";
import { LiveBars, LiveRankingTable, LiveStage } from "@/core/corporate/LiveStage";
import {
  addParticipant,
  advanceLiveRound,
  answerProgress,
  awardPoints,
  createLiveRound,
  liveRanking,
  submitAnswer,
  survivalScorer,
  SURVIVAL_ROUND_CONFIG,
  type LiveAnswer,
  type LiveRoundPhase,
} from "@/core/corporate/liveRound";
import { createRng } from "@/core/engine/rng";
import { useGameNet } from "@/core/net/useGameNet";
import {
  aliveCount,
  buildRound,
  closeSurvivalItem,
  controlSpecFor,
  createSurvivalState,
  finishSurvival,
  honorRanking,
  joinSurvival,
  parsePick,
  survivorRanking,
  toQuestion,
  verdictsFrom,
  type SurvivalRankEntry,
} from "./logic";

/**
 * C6 · Verdadero o falso
 *
 * Diez afirmaciones, cinco segundos cada una. El proyector es el host
 * autoritativo (`role: "host"`, `seat: -1`): mide el tiempo, cierra la ventana
 * y puntua. Los celulares mandan la opcion elegida y nada mas.
 *
 * **Casi todo el juego ya estaba escrito.** La maquina de fases, la medicion
 * de tiempo en el host, el descuento de medio RTT, el cierre de ventana, el
 * descarte de tardias, la entrada tardia y el puntaje por acierto viven en
 * `core/corporate/liveRound.ts` y se usan enteros, con `SURVIVAL_ROUND_CONFIG`
 * (1,5 / 2 / 5 / 2,5) y `survivalScorer` (200 por acierto, sin racha).
 *
 * Lo propio de C6 es el formato de supervivencia, y vive en `logic.ts`. Este
 * archivo solo lo conecta: le pasa los veredictos de cada cierre, aplica los
 * bonos con `awardPoints` y dibuja.
 *
 * Tres reglas que no se negocian:
 *
 * 1. **El host recibe input, nunca resultados.** Del celular llega un
 *    `optionId` y se descarta si no es de la afirmacion en curso.
 * 2. **Los botones no responden durante los 2 s de lectura.** Con una ventana
 *    de 5 s ese margen es lo unico que separa medir criterio de medir reflejo.
 * 3. **Nadie deja de jugar.** Caer cambia de carrera; el celular lo dice asi.
 */

/** Espeja `maxPlayers` de la entrada del registry: una sala, no cuatro asientos. */
const MAX_PLAYERS = 40;

/** Cuanto se sostiene la pantalla final antes de emitir el outcome. */
const FINAL_HOLD_MS = 6000;
/** El proyector no necesita 60 renders por segundo: la barra ya se ve fluida. */
const COMMIT_MS = 80;
/** Cada cuantos ms se le refresca la barra al telefono durante la ventana. */
const BAR_STEP_MS = 200;
/** Mas nombres que estos no se leen desde el fondo de la sala. */
const ALIVE_LIMIT = 12;
/** Tope de tiempo por cuadro: volver de una pestana oculta no saltea una ventana. */
const MAX_FRAME_MS = 250;

const BAR_OPTIONS = [
  { id: "v", label: "Verdadero" },
  { id: "f", label: "Falso" },
] as const;

type Reveal = {
  answer: boolean;
  explain: string;
  fell: number;
  fellPct: number;
  wipeout: boolean;
  revived: number;
  bars: BarsAggregate;
};

type View = {
  phase: LiveRoundPhase;
  itemIndex: number;
  progress: number;
  answered: number;
  eligible: number;
  alive: number;
  players: number;
  reveal: Reveal | null;
  survivors: readonly SurvivalRankEntry[];
  honor: readonly SurvivalRankEntry[];
  finished: boolean;
};

const EMPTY_VIEW: View = {
  phase: "anuncio",
  itemIndex: 0,
  progress: 0,
  answered: 0,
  eligible: 0,
  alive: 0,
  players: 0,
  reveal: null,
  survivors: [],
  honor: [],
  finished: false,
};

export default function VerdaderoOFalsoGame({ config, signal, onFinish, onReady }: GameProps) {
  const reduced = usePrefersReducedMotion();

  /* La ronda se arma una sola vez, con el PRNG sembrado por `config.seed`: dos
     proyectores con la misma semilla juegan las mismas afirmaciones en el
     mismo orden. Nada de azar fuera de aca. */
  const [engine] = useState(() => {
    const content = buildRound(config.settings, createRng(config.seed));
    return {
      content,
      round: createLiveRound({
        config: { ...SURVIVAL_ROUND_CONFIG, answerMs: content.answerMs },
        questions: content.statements.map(toQuestion),
        scorer: survivalScorer,
      }),
      survival: createSurvivalState({
        rules: content.rules,
        totalItems: content.statements.length,
      }),
    };
  });

  const { content, round, survival } = engine;
  const totalItems = content.statements.length;
  const survivalMode = content.rules.mode === "supervivencia";

  const [view, setView] = useState<View>(EMPTY_VIEW);
  const viewRef = useRef<View>(EMPTY_VIEW);
  const revealRef = useRef<Reveal | null>(null);
  /** Quienes contestaron despues del cierre de la afirmacion en curso. */
  const lateIdsRef = useRef<Set<string>>(new Set());
  const finalHoldRef = useRef(0);
  const commitRef = useRef(0);
  const startedAtRef = useRef(performance.now());
  const finishedRef = useRef(false);
  /** Lo ultimo difundido a la sala, y lo ultimo mandado a cada telefono. */
  const broadcastKeyRef = useRef("");
  const directedKeysRef = useRef<Map<string, string>>(new Map());
  /** Firma de "nada cambio para nadie": ahorra recorrer la sala por cuadro. */
  const fanoutKeyRef = useRef("");
  const rttRef = useRef(0);
  /** Historial para el `meta`: que afirmacion volteo a cuanta gente. */
  const fallsRef = useRef<Array<{ item: number; fell: number; pct: number }>>([]);

  /* ---------------------------------------------------------------- */
  /* Red                                                               */
  /* ---------------------------------------------------------------- */

  /**
   * El puerto del proyector.
   *
   * `onInput` es la unica puerta por la que entra algo de un celular, y lo
   * unico que acepta es "toque esta opcion". El tiempo lo mide `submitAnswer`
   * contra el reloj de la ronda, con el RTT que midio el propio puerto: nada
   * de lo que diga el telefono puede mover el puntaje.
   */
  const netHandle = useGameNet<ControlInput, never>({
    roomId: config.roomId,
    role: "host",
    // -1 = el proyector no juega. Todos los asientos son de la sala.
    seat: -1,
    seats: MAX_PLAYERS,
    name: "Proyector",

    onInput: (playerId, input) => {
      if (input.kind !== "pick") return;
      // Un id de otra afirmacion es una respuesta de la ronda anterior: no
      // cuenta, y no hay forma de que cuente por error.
      const value = parsePick(input.optionId, round.itemIndex + 1);
      if (value === null) return;

      const result = submitAnswer(round, {
        participantId: playerId,
        value,
        rttMs: rttRef.current,
      });
      // Llegar tarde no es culpa de nadie, pero hay que decirlo.
      if (result.status === "late") lateIdsRef.current.add(playerId);
    },
  });

  const { net, players, rttMs } = netHandle;

  /* Alta de participantes. No se da de baja a nadie: los puntos ganados no se
     borran porque a alguien se le apago el telefono, y quien vuelve recupera
     su asiento y su lugar en los dos rankings. */
  useEffect(() => {
    rttRef.current = rttMs;
    for (const player of players) {
      if (player.bot) continue;
      addParticipant(round, player.id, player.name);
      joinSurvival(survival, player.id, player.name);
    }
  }, [players, rttMs, round, survival]);

  /* ---------------------------------------------------------------- */
  /* Cierre                                                            */
  /* ---------------------------------------------------------------- */

  const finish = useCallback(
    (completed: boolean) => {
      if (finishedRef.current) return; // el contrato pide exactamente una vez
      finishedRef.current = true;
      const totals = liveRanking(round);
      const honor = honorRanking(survival);
      const survivors = survivorRanking(survival);

      onFinish({
        completed,
        // El proyector no juega: el marcador de la sala es el del primero.
        points: totals[0]?.points ?? 0,
        durationMs: Math.round(performance.now() - startedAtRef.current),
        meta: {
          deck: content.deckId,
          mode: content.rules.mode,
          totalItems,
          closedItems: survival.closedItems,
          survivors: survivors.map((row) => row.name),
          ranking: totals.map((row) => ({
            name: row.name,
            points: row.points,
            correct: row.correctCount,
          })),
          honor: honor.map((row) => ({
            name: row.name,
            points: row.points,
            correct: row.correctCount,
            fellAt: row.fellAt,
          })),
          falls: fallsRef.current,
        },
      });
    },
    [content.deckId, content.rules.mode, onFinish, round, survival, totalItems],
  );

  /* Forzar fin: emite lo acumulado en el acto, con `completed: false`. */
  useEffect(() => {
    if (signal.aborted) {
      finish(false);
      return;
    }
    const onAbort = () => finish(false);
    signal.addEventListener("abort", onAbort);
    return () => signal.removeEventListener("abort", onAbort);
  }, [finish, signal]);

  useDeadline(
    config.durationMs,
    useCallback(() => finish(false), [finish]),
  );

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  /* ---------------------------------------------------------------- */
  /* El loop del host                                                  */
  /* ---------------------------------------------------------------- */

  /** Corrige la afirmacion que cerro y resuelve la supervivencia. */
  const closeItem = useCallback(
    (itemIndex: number, results: readonly LiveAnswer[]) => {
      const statement = content.statements[itemIndex];
      if (!statement) return;

      const report = closeSurvivalItem(
        survival,
        itemIndex + 1,
        verdictsFrom(round.participants.values(), itemIndex, results),
      );
      // Los +150 por seguir vivo son el unico puntaje propio de C6, y entran
      // por la puerta que la base dejo abierta justo para esto.
      for (const award of report.awards) awardPoints(round, award.participantId, award.points);

      if (report.fell.length > 0) {
        fallsRef.current.push({
          item: itemIndex + 1,
          fell: report.fell.length,
          pct: report.fellPct,
        });
      }

      revealRef.current = {
        answer: statement.answer,
        explain: statement.explain,
        fell: report.fell.length,
        fellPct: report.fellPct,
        wipeout: report.wipeout,
        revived: report.revived.length,
        bars: aggregateBars({
          options: BAR_OPTIONS,
          picks: results.map((result) => (result.value === true ? "v" : "f")),
          correctId: statement.answer ? "v" : "f",
        }),
      };
    },
    [content.statements, round, survival],
  );

  /**
   * Le dice a cada celular que dibujar.
   *
   * El aviso de este juego es personal: "seguis jugando por puntos" lo tiene
   * que leer el que cayo y nadie mas, porque a quien sigue en carrera le
   * estaria mintiendo. Por eso el spec de `controlSpecFor` viaja **dirigido**,
   * con el id del participante.
   *
   * Lo unico que se difunde es la pantalla de espera del anuncio, y se difunde
   * a proposito: es lo que el puerto le reenvia a quien escanea el QR a mitad
   * de una afirmacion, y para esa persona es la verdad —entra en la proxima,
   * asi que unos botones que no puede usar serian peor que un cartel.
   *
   * Lo que si es de cada aparato y no del host —la opcion tocada— lo resuelve
   * el mando con su marca local, y por eso `picked` viaja en null.
   */
  const publishControl = useCallback(
    (waiting: boolean) => {
      if (!net) return;

      // Sin sala, o con la ronda terminada, todos ven lo mismo: una difusion.
      if (waiting || round.finished) {
        const key = waiting ? "wait" : "end";
        if (broadcastKeyRef.current === key) return;
        broadcastKeyRef.current = key;
        directedKeysRef.current.clear();
        net.sendControl({
          layout: "wait",
          message: waiting
            ? "Ya casi. Mirá la pantalla grande."
            : "Se terminó. Mirá la pantalla grande.",
        });
        return;
      }

      const itemNumber = round.itemIndex + 1;
      const statement = content.statements[round.itemIndex]?.text ?? "";

      if (round.phase === "anuncio") {
        const key = `anuncio:${itemNumber}`;
        if (broadcastKeyRef.current === key) return;
        broadcastKeyRef.current = key;
        net.sendControl({
          layout: "wait",
          message: `Afirmación ${itemNumber} de ${totalItems}`,
        });
        // En el anuncio nadie tiene nada que tocar: la difusion alcanza y se
        // ahorra un paquete por telefono.
        return;
      }

      const remainingMs =
        round.phase === "respuesta" ? Math.max(0, content.answerMs - round.phaseMs) : 0;
      /* La barra se refresca por tramos. Un spec por cuadro serian 60 paquetes
         por segundo y por telefono para mover unos pixeles; en tramos de
         `BAR_STEP_MS` la barra igual se ve corriendo. */
      const step = round.phase === "respuesta" ? Math.ceil(remainingMs / BAR_STEP_MS) : -1;

      /* Nada cambio para nadie: no hace falta recorrer la sala. Sin esta
         guarda, 40 participantes son 2400 claves armadas por segundo para
         descubrir que no hay nada que mandar. `closedItems` alcanza como
         version del estado de supervivencia: los vivos solo cambian al
         cerrar una afirmacion. */
      const fanout = `${round.phase}:${itemNumber}:${step}:${lateIdsRef.current.size}:${survival.closedItems}`;
      if (fanoutKeyRef.current === fanout) return;
      fanoutKeyRef.current = fanout;

      for (const participant of round.participants.values()) {
        // Quien todavia no entro a la ronda se queda con la difusion del
        // anuncio, que es exactamente lo que le corresponde.
        if (round.itemIndex < participant.fromItem) continue;

        const entry = survival.entries.get(participant.id);
        const eliminated = survivalMode && entry !== undefined && !entry.alive;
        const discarded = lateIdsRef.current.has(participant.id);

        const key = `${round.phase}:${itemNumber}:${eliminated ? 1 : 0}:${discarded ? 1 : 0}:${step}`;
        if (directedKeysRef.current.get(participant.id) === key) continue;
        directedKeysRef.current.set(participant.id, key);

        net.sendControl(
          controlSpecFor({
            phase: round.phase,
            itemNumber,
            totalItems,
            statement,
            eliminated,
            revivePending: eliminated && content.rules.reviveAt === itemNumber,
            discarded,
            remainingMs,
            windowMs: content.answerMs,
          }),
          participant.id,
        );
      }
    },
    [
      content.answerMs,
      content.rules.reviveAt,
      content.statements,
      net,
      round,
      survival,
      survivalMode,
      totalItems,
    ],
  );

  const commitView = useCallback(() => {
    const next: View = {
      phase: round.phase,
      itemIndex: round.itemIndex,
      progress:
        round.phase === "respuesta"
          ? Math.min(1, round.phaseMs / Math.max(1, content.answerMs))
          : 0,
      ...answerProgress(round),
      alive: aliveCount(survival),
      players: survival.entries.size,
      reveal: round.phase === "cierre" ? revealRef.current : null,
      survivors: survivorRanking(survival),
      honor: honorRanking(survival),
      finished: round.finished,
    };
    viewRef.current = next;
    setView(next);
  }, [content.answerMs, round, survival]);

  const stepRef = useRef<(dtMs: number) => void>(() => {});
  useEffect(() => {
    stepRef.current = (dtMs: number) => {
      if (finishedRef.current) return;

      // Sala vacia: la ronda no arranca. Diez afirmaciones corriendo solas
      // mientras la gente todavia escanea el QR queman el contenido entero.
      const waiting = round.participants.size === 0 && round.clockMs === 0;

      if (!waiting && !round.finished) {
        for (const event of advanceLiveRound(round, dtMs)) {
          if (event.type === "closed") {
            closeItem(event.itemIndex, event.results);
          } else if (event.type === "phase" && event.phase === "anuncio") {
            // El aviso de "llegaste tarde" se apaga recien cuando arranca la
            // afirmacion siguiente: si se limpiara al abrir la ventana, el que
            // llego tarde lo leeria durante la lectura de la proxima.
            lateIdsRef.current.clear();
          } else if (event.type === "finished") {
            for (const award of finishSurvival(survival)) {
              awardPoints(round, award.participantId, award.points);
            }
          }
        }
      }

      if (round.finished) {
        finalHoldRef.current += dtMs;
        if (finalHoldRef.current >= (reduced ? 0 : FINAL_HOLD_MS)) finish(true);
      }

      publishControl(waiting);

      const previous = viewRef.current;
      const changed =
        previous.phase !== round.phase ||
        previous.itemIndex !== round.itemIndex ||
        previous.finished !== round.finished ||
        previous.players !== survival.entries.size;

      commitRef.current += dtMs;
      // Mientras la sala se llena no hay nada que animar: se rinde solo cuando
      // entra alguien. Ya jugando, la barra pide un ritmo fijo.
      if (changed || (!waiting && commitRef.current >= COMMIT_MS)) {
        commitRef.current = 0;
        commitView();
      }
    };
  });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(MAX_FRAME_MS, now - last);
      last = now;
      if (dt > 0) stepRef.current(dt);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Proyector                                                         */
  /* ---------------------------------------------------------------- */

  const aside = useMemo(
    () => (
      <div className="flex h-full flex-col gap-5 overflow-hidden">
        {survivalMode && <AliveList rows={view.survivors} total={view.alive} reduced={reduced} />}
        <LiveRankingTable rows={view.honor} limit={5} title="Puntaje de honor" />
      </div>
    ),
    [reduced, survivalMode, view.alive, view.honor, view.survivors],
  );

  if (view.players === 0 && !view.finished) {
    return <WaitingRoom roomId={config.roomId} title={content.title} />;
  }

  if (view.finished) {
    return (
      <FinalScreen
        survivors={view.survivors}
        honor={view.honor}
        survivalMode={survivalMode}
        totalItems={totalItems}
      />
    );
  }

  const statement = content.statements[view.itemIndex];

  return (
    <section className="h-full w-full bg-sn-bg">
      <LiveStage
        phase={view.phase}
        itemIndex={view.itemIndex}
        totalItems={totalItems}
        // En el anuncio la afirmacion todavia no se muestra: si se leyera
        // durante el anuncio, los 2 s de lectura no servirian de nada.
        question={
          view.phase === "anuncio"
            ? `Afirmación ${view.itemIndex + 1}`
            : statement?.text ?? ""
        }
        progress={view.progress}
        answered={view.answered}
        eligible={view.eligible}
        headline={
          <span className="flex items-baseline gap-3">
            <span className="text-[clamp(0.8rem,1.2vw,1.2rem)] uppercase tracking-[0.16em] text-sn-dim">
              {survivalMode ? "Quedan" : "Jugando"}
            </span>
            {/* El marcador real de este juego no son los puntos: es este
                numero bajando. Por eso domina la barra superior. */}
            <span className="sn-num text-[clamp(2rem,5vw,5rem)] font-semibold leading-none text-sn-cyan">
              {survivalMode ? view.alive : view.players}
            </span>
          </span>
        }
        reveal={view.reveal ? <RevealPanel reveal={view.reveal} /> : undefined}
        aside={aside}
      >
        {/* El reparto se dibuja recien al cerrar: mostrarlo antes le regala la
            respuesta a quien todavia esta pensando. */}
        {view.reveal ? <LiveBars data={view.reveal.bars} /> : undefined}
      </LiveStage>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Piezas del proyector                                                 */
/* ------------------------------------------------------------------ */

function WaitingRoom({ roomId, title }: { roomId: string; title: string }) {
  return (
    <section className="grid h-full w-full place-items-center bg-sn-bg p-8 text-center">
      <div>
        <p className="text-[clamp(0.9rem,1.4vw,1.4rem)] uppercase tracking-[0.2em] text-sn-dim">
          Verdadero o falso · {title}
        </p>
        <p className="sn-num mt-5 text-[clamp(2rem,6vw,6rem)] font-semibold leading-none text-sn-cyan">
          {roomId}
        </p>
        <p className="mt-5 text-[clamp(0.9rem,1.4vw,1.4rem)] text-sn-muted">
          Escaneá el QR para entrar. Arrancamos con la primera persona.
        </p>
      </div>
    </section>
  );
}

function RevealPanel({ reveal }: { reveal: Reveal }) {
  return (
    <div className="text-center">
      <p
        className="font-display text-[clamp(1.8rem,4.2vw,4.2rem)] font-bold leading-none"
        style={{ color: reveal.answer ? "var(--sn-success)" : "var(--sn-magenta-400)" }}
      >
        {/* Simbolo ademas de color: dice lo mismo en escala de grises. */}
        {reveal.answer ? "✓ VERDADERO" : "✕ FALSO"}
      </p>
      <p className="mx-auto mt-3 max-w-4xl text-balance text-[clamp(0.9rem,1.5vw,1.5rem)] text-sn-muted">
        {reveal.explain}
      </p>

      {reveal.wipeout ? (
        /* El momento que genera conversacion, y el dato que le sirve a quien
           capacita: esta afirmacion se llevo puesta a media sala. */
        <p
          className="sn-num mt-5 inline-block rounded-sn border px-5 py-2 text-[clamp(1rem,1.9vw,1.9rem)] font-semibold"
          style={{
            borderColor: "var(--sn-warn)",
            color: "var(--sn-warn)",
            background: "color-mix(in oklab, var(--sn-warn) 12%, transparent)",
          }}
        >
          Esa la falló el {reveal.fellPct} % de los que seguían
        </p>
      ) : (
        reveal.fell > 0 && (
          <p className="sn-num mt-5 text-[clamp(0.9rem,1.5vw,1.5rem)] text-sn-dim">
            Cayeron {reveal.fell}
          </p>
        )
      )}

      {reveal.revived > 0 && (
        <p className="sn-num mt-2 text-[clamp(0.9rem,1.5vw,1.5rem)] text-sn-cyan">
          Vuelven {reveal.revived} por la repesca
        </p>
      )}
    </div>
  );
}

/**
 * Los que siguen en pie.
 *
 * Con 40 participantes la lista entera no entra ni se lee: se muestran los
 * primeros y se cuenta el resto. Una lista desbordada es peor que una corta.
 */
function AliveList({
  rows,
  total,
  reduced,
}: {
  rows: readonly SurvivalRankEntry[];
  total: number;
  reduced: boolean;
}) {
  const visible = rows.slice(0, ALIVE_LIMIT);

  return (
    <div className="min-h-0">
      <h2 className="mb-3 text-[clamp(0.7rem,1vw,1rem)] font-semibold uppercase tracking-[0.14em] text-sn-dim">
        En pie · <span className="sn-num">{total}</span>
      </h2>
      <ul className="flex flex-col gap-1.5">
        {visible.map((row) => (
          <li
            key={row.participantId}
            className={`truncate rounded-sn border border-sn-line-soft bg-sn-bg-elev px-3 py-1.5 text-[clamp(0.8rem,1.1vw,1.2rem)] text-sn-text ${
              // Verlo caer es parte del juego, pero no para quien pide menos
              // movimiento.
              reduced ? "" : "transition-opacity duration-200"
            }`}
          >
            {row.name}
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-3 py-1.5 text-[clamp(0.8rem,1.1vw,1.1rem)] text-sn-dim">
            No quedó nadie en pie.
          </li>
        )}
      </ul>
      {rows.length > visible.length && (
        <p className="sn-num mt-2 px-3 text-[clamp(0.7rem,0.9vw,0.9rem)] text-sn-dim">
          +{rows.length - visible.length} más
        </p>
      )}
    </div>
  );
}

function FinalScreen({
  survivors,
  honor,
  survivalMode,
  totalItems,
}: {
  survivors: readonly SurvivalRankEntry[];
  honor: readonly SurvivalRankEntry[];
  survivalMode: boolean;
  totalItems: number;
}) {
  // Primero los que pasaron las diez sin caer; si no quedo ninguno, los que
  // siguen en pie despues de la repesca.
  const champions = survivors.filter((row) => row.survivedItems >= totalItems);
  const standing = champions.length > 0 ? champions : survivors;
  const headline = survivalMode
    ? standing.length === 0
      ? "No quedó nadie en pie"
      : standing.length === 1
        ? "Quedó en pie"
        : "Quedaron en pie"
    : "Se terminó";

  return (
    <section className="flex h-full w-full gap-6 bg-sn-bg p-8">
      <div className="flex min-w-0 flex-1 flex-col justify-center text-center">
        <p className="text-[clamp(0.8rem,1.2vw,1.2rem)] uppercase tracking-[0.2em] text-sn-dim">
          {headline}
        </p>
        <p className="mt-6 text-balance font-display text-[clamp(1.6rem,3.6vw,3.6rem)] font-semibold leading-tight text-sn-text">
          {survivalMode && standing.length > 0
            ? standing
                .slice(0, 6)
                .map((row) => row.name)
                .join(" · ")
            : (honor[0]?.name ?? "Sin respuestas")}
        </p>
        {survivalMode && standing.length > 6 && (
          <p className="sn-num mt-3 text-[clamp(0.9rem,1.4vw,1.4rem)] text-sn-dim">
            +{standing.length - 6} más
          </p>
        )}
      </div>
      <aside className="w-[clamp(18rem,26vw,30rem)] shrink-0">
        {/* Las dos carreras terminan juntas: el que cayo primero pero acerto
            nueve de diez tiene su lugar en la pantalla. */}
        <LiveRankingTable rows={honor} limit={8} title="Puntaje de honor" />
      </aside>
    </section>
  );
}
