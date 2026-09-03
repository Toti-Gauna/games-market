import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ControlInput, ControlSpec, OptionShape } from "@/core/contract/control";
import type { GameProps } from "@/core/contract/game";
import { aggregateBars, type BarsAggregate } from "@/core/corporate/aggregate";
import { useDeadline } from "@/core/corporate/hooks";
import { LiveBars, LiveRankingTable, LiveStage } from "@/core/corporate/LiveStage";
import {
  addParticipant,
  advanceLiveRound,
  answerProgress,
  closeWindowNow,
  createLiveRound,
  liveRanking,
  submitAnswer,
  DEFAULT_RANKING_MS,
  type LiveRankEntry,
  type LiveRoundPhase,
  type LiveRoundState,
} from "@/core/corporate/liveRound";
import type { QuestionOption, SingleQuestion } from "@/core/corporate/question.types";
import { createRng } from "@/core/engine/rng";
import type { BotPolicy } from "@/core/net/mockNet";
import { useGameNet } from "@/core/net/useGameNet";
import {
  buildTriviaDeck,
  optionColor,
  optionShape,
  participantKey,
  personalNotice,
  roomSummary,
  toControlOptions,
  triviaMeta,
  triviaPoints,
  TRIVIA_SEATS,
} from "./logic";

/**
 * C1 · Trivia relampago.
 *
 * Este archivo no inventa nada: une piezas que ya existen y estan probadas.
 *
 * - La maquina de fases, la medicion del tiempo en el host, el cierre de la
 *   ventana, el descarte de las tardias, la entrada tardia, el puntaje con
 *   racha y el ranking vienen enteros de `core/corporate/liveRound.ts`.
 * - El proyector es `LiveStage` + `LiveBars` + `LiveRankingTable`.
 * - El telefono es `GamepadController`, que ya trae los botones grandes con
 *   color Y forma, el "Ver pregunta" y el bloqueo de cambio de respuesta.
 *
 * Lo propio de C1 son cuatro decisiones:
 *
 * 1. **El host recibe input, nunca resultados.** El celular manda la opcion
 *    elegida y nada mas; el tiempo lo marca `advanceLiveRound` contra el reloj
 *    de la ronda y se le descuenta medio RTT. Un cliente modificado que
 *    declarara "conteste en 0,01 s" no tiene donde escribir ese numero.
 * 2. **La pregunta va en la pantalla grande.** El `ControlSpec` de la ventana
 *    lleva el enunciado solo para el boton "Ver pregunta": la experiencia por
 *    defecto empuja a mirar arriba, y quien no llega a leer de lejos lo tiene
 *    a un toque.
 * 3. **Dos canales al telefono, y cada uno con lo suyo.** Durante la ventana
 *    se difunde el mismo spec para todos, con la ventana y lo que queda de
 *    ella, porque el reloj es igual para la sala. Al cerrar sale ademas un
 *    spec dirigido por persona con su resultado —acertaste, cuanto sumaste,
 *    en que puesto vas—, una sola vez por pregunta. Difundir eso mostraria el
 *    resultado de otro; personalizar la ventana entera serian cientos de
 *    mensajes por segundo para dibujar la misma barra.
 * 4. **Sin canvas y sin `useGame2D`.** El juego es `engine: "dom"`: no hay
 *    nada que rasterizar, y `GameStage` esta armado alrededor de un `<canvas>`
 *    con instrucciones y pausa que en un proyector estorban. La ronda avanza
 *    con un `requestAnimationFrame` propio que le pasa el `dt` a la maquina de
 *    fases —el mismo contrato que un loop de juego— y publica a React a 25 Hz,
 *    que es lo que la barra de tiempo necesita para leerse continua.
 */

/** Deuda maxima por cuadro. Una pestana que vuelve no corre preguntas que nadie vio. */
const MAX_FRAME_MS = 250;

/** 25 Hz: la barra del proyector se lee continua y React no re-renderiza 60 veces por segundo. */
const PUBLISH_MS = 40;

/** Cada cuanto se refresca el `remainingMs` del telefono durante la ventana. */
const CONTROL_TICK_MS = 120;

/**
 * Gracia antes de cortar cuando ya contestaron todos. Cortar en el mismo
 * cuadro del ultimo toque se siente como un cuelgue, no como un cierre.
 */
const EARLY_CLOSE_MS = 600;

/**
 * Cuanto se espera entre difundir el cierre y mandar el aviso personal.
 *
 * Son dos mensajes por el mismo canal y el ultimo que llega es el que se ve;
 * con jitter, mandarlos juntos deja a alguien con el aviso general encima del
 * suyo. Este margen es varias veces el jitter tipico. De paso alcanza para que
 * una respuesta en vuelo llegue y se cuente como tardia en el aviso correcto.
 */
const PERSONAL_DELAY_MS = 140;

type Stage = "lobby" | "playing" | "done";

type View = {
  phase: LiveRoundPhase;
  itemIndex: number;
  /** 0..1 de la fase en curso, para la barra de tiempo. */
  progress: number;
  answered: number;
  eligible: number;
  ranking: readonly LiveRankEntry[];
  /** Solo al cerrar: el reparto de respuestas con la correcta marcada. */
  bars: BarsAggregate | null;
};

const EMPTY_VIEW: View = {
  phase: "anuncio",
  itemIndex: 0,
  progress: 0,
  answered: 0,
  eligible: 0,
  ranking: [],
  bars: null,
};

/** Lo que sobrevive del cierre para armar el aviso del telefono y el reveal. */
type CloseInfo = {
  correctLabel: string;
  explanation: string;
  correctCount: number;
  answeredCount: number;
  bestPoints: number;
};

const EMPTY_CLOSE: CloseInfo = {
  correctLabel: "",
  explanation: "",
  correctCount: 0,
  answeredCount: 0,
  bestPoints: 0,
};

export default function TriviaGame({ config, signal, onFinish }: GameProps) {
  const deck = useMemo(
    () => buildTriviaDeck(config.settings, createRng(config.seed)),
    [config.settings, config.seed],
  );
  const total = deck.questions.length;

  const [stage, setStage] = useState<Stage>("lobby");
  const [view, setView] = useState<View>(EMPTY_VIEW);

  /* La ronda es un objeto mutable que avanza con `dt`: vive en un ref y no en
     el estado, igual que la simulacion de cualquier juego. React solo recibe
     la foto que hay que dibujar. */
  const roundRef = useRef<LiveRoundState | null>(null);
  if (roundRef.current === null) {
    roundRef.current = createLiveRound({
      config: deck.round,
      questions: deck.questions,
      scorer: deck.scorer,
    });
  }

  const stageRef = useRef<Stage>("lobby");
  const startedAtRef = useRef(performance.now());
  const finishedRef = useRef(false);
  const closeRef = useRef<CloseInfo>(EMPTY_CLOSE);
  const barsRef = useRef<BarsAggregate | null>(null);
  /** Quienes contestaron con la ventana ya cerrada, en el item en curso. */
  const lateIdsRef = useRef<Set<string>>(new Set());
  /** Cuando toca mandar los avisos personales. null = ya se mandaron. */
  const personalAtRef = useRef<number | null>(null);
  const allInMsRef = useRef(0);
  const lastPublishRef = useRef(0);
  const lastControlAtRef = useRef(0);
  const controlKeyRef = useRef("");
  /** Asiento por id de red: el id cambia con cada refresh del telefono, el asiento no. */
  const seatByPlayerRef = useRef<Map<string, { seat: number; bot: boolean }>>(new Map());

  /* ---------------------------------------------------------------- */
  /* Red                                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Simulados de banco de pruebas: sin esto, ver el proyector con 40 filas de
   * ranking exige 40 telefonos. Llegan apagados, porque en un evento real
   * meterian nombres inventados en el ranking de la sala.
   */
  const botPolicy = useMemo<BotPolicy<ControlInput>>(
    () => ({
      hz: 2,
      policy: (bot) => {
        const round = roundRef.current;
        const question = round ? round.questions[round.itemIndex] : undefined;
        const id = participantKey(bot.seat);
        // Sin opcion valida la respuesta se descarta en `submitAnswer`: es la
        // forma de decir "este turno no contesto" sin ensanchar `ControlInput`.
        const silence: ControlInput = { kind: "pick", optionId: "" };

        if (!round || !question || question.kind !== "single") return silence;
        if (round.phase !== "respuesta" || round.answers.has(id)) return silence;
        // Cada uno tarda distinto: si todos contestaran juntos, el reparto de
        // puntos del proyector seria una linea plana y no probaria nada.
        if (round.phaseMs < 500 + (bot.seat % 7) * 900) return silence;

        const correct = typeof question.correct === "string" ? question.correct : null;
        // Aciertan mas o menos la mitad. Una sala real no acierta todo.
        const pick = bot.rng.next() < 0.55 && correct ? correct : bot.rng.pick(question.options).id;
        return { kind: "pick", optionId: pick };
      },
    }),
    [],
  );

  const netHandle = useGameNet<ControlInput, never>({
    // La sala la elige el contenedor: es la que esta en el QR que escanean.
    roomId: config.roomId,
    role: "host",
    // -1 = proyector que no juega. Los 40 asientos quedan para los celulares.
    seat: -1,
    seats: TRIVIA_SEATS,
    name: "Proyector",
    bot: deck.demoBots ? botPolicy : undefined,

    onInput: (playerId, input) => {
      // El telefono puede mandar cualquier control; aca solo interesa la
      // opcion elegida. Y es lo UNICO que se acepta: ningun tiempo, ningun
      // puntaje. El reloj es el de la ronda y lo lleva el host.
      if (input.kind !== "pick") return;
      const round = roundRef.current;
      const entry = seatByPlayerRef.current.get(playerId);
      if (!round || !entry) return;

      const participantId = participantKey(entry.seat);
      const result = submitAnswer(round, {
        participantId,
        value: input.optionId,
        // El RTT sale del ping del puerto, no de lo que diga el telefono.
        rttMs: netHandle.net?.rttMs ?? 0,
      });
      // Se anota por persona: el aviso de "llegaste tarde" va dirigido a quien
      // le paso, no a la sala entera.
      if (result.status === "late") lateIdsRef.current.add(participantId);
    },

    onPlayerJoin: (player) => {
      seatByPlayerRef.current.set(player.id, { seat: player.seat, bot: player.bot });
      if (player.bot && !deck.demoBots) return;
      const round = roundRef.current;
      if (!round) return;
      // La clave es el asiento: quien vuelve tras un refresh recupera sus
      // puntos en vez de aparecer dos veces en el ranking.
      const participant = addParticipant(round, participantKey(player.seat), player.name);
      participant.name = player.name;
    },

    onPlayerLeave: (playerId) => {
      seatByPlayerRef.current.delete(playerId);
      // No se lo saca de la ronda a proposito: los puntos que hizo son suyos y
      // un telefono que se bloqueo no es alguien que no jugo.
    },
  });

  const netPort = netHandle.net;

  /* ---------------------------------------------------------------- */
  /* Fin                                                               */
  /* ---------------------------------------------------------------- */

  const finish = useCallback(
    (completed: boolean, reason: string) => {
      if (finishedRef.current) return; // el contrato pide exactamente una vez
      finishedRef.current = true;
      const round = roundRef.current;
      const ranking = round ? liveRanking(round) : [];
      setStage("done");
      stageRef.current = "done";
      onFinish({
        completed,
        points: triviaPoints(ranking),
        durationMs: Math.round(performance.now() - startedAtRef.current),
        meta: triviaMeta(
          {
            quizId: deck.quizId,
            askedItems: round ? askedItems(round, total) : 0,
            totalItems: total,
            participants: round ? round.participants.size : 0,
            ranking,
          },
          reason,
        ),
      });
    },
    [deck.quizId, onFinish, total],
  );

  /* Forzar fin: emite lo acumulado hasta ahi, en el acto. */
  useEffect(() => {
    if (signal.aborted) {
      finish(false, "forzado");
      return;
    }
    const onAbort = () => finish(false, "forzado");
    signal.addEventListener("abort", onAbort);
    return () => signal.removeEventListener("abort", onAbort);
  }, [finish, signal]);

  /* El limite duro del contenedor corta con lo respondido hasta el momento. */
  useDeadline(
    config.durationMs,
    useCallback(() => finish(false, "tiempo"), [finish]),
  );

  /* ---------------------------------------------------------------- */
  /* Lo que ve el telefono                                             */
  /* ---------------------------------------------------------------- */

  const buildSpec = useCallback((): ControlSpec => {
    const round = roundRef.current;
    if (!round) return { layout: "wait", message: "Preparando la ronda…" };
    if (stageRef.current === "lobby") {
      return { layout: "wait", message: "Listo. Mirá la pantalla grande: ya arranca." };
    }
    if (stageRef.current === "done" || round.finished) {
      return { layout: "wait", message: "Terminó. Las posiciones están en la pantalla grande." };
    }

    const question = deck.questions[round.itemIndex];
    if (!question) return { layout: "wait", message: "Esperando la próxima pregunta…" };

    switch (round.phase) {
      case "anuncio":
        return {
          layout: "wait",
          message: `Pregunta ${round.itemIndex + 1} de ${total}. Preparate.`,
        };

      case "lectura":
        // Los botones se ven pero no responden: el pulgar ubica las formas
        // mientras los ojos leen arriba. Sin estos segundos gana quien toca al
        // azar apenas aparecen, y la velocidad deja de medir conocimiento.
        return {
          layout: "buttons",
          options: toControlOptions(question, null),
          enabled: false,
          picked: null,
        };

      case "respuesta":
        return {
          layout: "buttons",
          options: toControlOptions(question, null),
          enabled: true,
          // El host no sabe que toco cada uno hasta que llega: la marca
          // inmediata la pone el propio telefono.
          picked: null,
          question: question.prompt,
          remainingMs: Math.max(0, deck.round.answerMs - round.phaseMs),
          // Sin esto el telefono tendria que asumir 10 s, y el panel deja
          // mover la ventana entre 5 y 30: la barra mentiria en casi todas.
          windowMs: deck.round.answerMs,
        };

      case "cierre":
        // Difundido va solo la correcta marcada, sin aviso: el resultado es
        // personal y sale dirigido a cada telefono en `sendPersonalResults`.
        // Ademas este es el spec que el puerto guarda como "lo ultimo", asi
        // que a quien toma asiento durante el cierre le llega la correccion y
        // no el resultado de otra persona.
        return {
          layout: "buttons",
          options: toControlOptions(question, question.correct ?? null),
          enabled: false,
          picked: null,
          question: question.prompt,
        };

      case "ranking":
        return { layout: "wait", message: "Posiciones en la pantalla grande." };
    }
  }, [deck.questions, deck.round.answerMs, total]);

  const pushControl = useCallback(
    (now: number) => {
      const port = netPort;
      const round = roundRef.current;
      if (!port || !round) return;

      // Firma barata: si no cambio ni la etapa, ni la fase, ni el item, no
      // hay nada nuevo que dibujar en el telefono.
      const key = `${stageRef.current}|${round.phase}|${round.itemIndex}`;
      const answering = stageRef.current === "playing" && round.phase === "respuesta";
      const stale = answering && now - lastControlAtRef.current >= CONTROL_TICK_MS;
      if (key === controlKeyRef.current && !stale) return;

      controlKeyRef.current = key;
      lastControlAtRef.current = now;
      port.sendControl(buildSpec());
    },
    [buildSpec, netPort],
  );

  /* Al conectar el puerto, el telefono que ya escaneo tiene que ver algo. */
  useEffect(() => {
    controlKeyRef.current = "";
    pushControl(performance.now());
  }, [pushControl]);

  /**
   * El resultado de cada uno, a su telefono y a ninguno mas.
   *
   * Se manda UNA vez por item, al cerrar, que es el unico momento en que el
   * contenido es personal. Durante la ventana se difunde el spec comun: hacer
   * esto a 8 Hz por participante serian cientos de mensajes por segundo para
   * dibujar una barra que es igual para todos.
   *
   * El host sigue sin recibir resultados: los puntos y la posicion salen de la
   * ronda, que es la unica que corrige y la unica que mide el tiempo.
   */
  const sendPersonalResults = useCallback(() => {
    const port = netPort;
    const round = roundRef.current;
    if (!port || !round) return;

    const question = deck.questions[round.itemIndex];
    if (!question) return;

    const correctId = question.correct ?? null;
    const options = toControlOptions(question, correctId);
    const correctLabel = labelOf(question, correctId);
    const ranking = liveRanking(round);
    const positions = new Map(ranking.map((row) => [row.participantId, row.position]));

    for (const [playerId, entry] of seatByPlayerRef.current) {
      // Un simulado no mira su telefono. Con la sala llena de bots serian 40
      // mensajes por pregunta para nadie.
      if (entry.bot) continue;
      const participantId = participantKey(entry.seat);
      const participant = round.participants.get(participantId);
      // Quien entro en este item todavia no jugaba: decirle "no contestaste"
      // seria mentirle.
      if (!participant || round.itemIndex < participant.fromItem) continue;

      const answer = round.answers.get(participantId);
      const status = lateIdsRef.current.has(participantId)
        ? "late"
        : !answer
          ? "missed"
          : answer.correct === true
            ? "correct"
            : "wrong";

      port.sendControl(
        {
          layout: "buttons",
          options,
          enabled: false,
          picked: null,
          question: question.prompt,
          notice: personalNotice({
            status,
            points: answer ? answer.base + answer.bonus : 0,
            bonus: answer?.bonus ?? 0,
            correctLabel,
            position: positions.get(participantId) ?? 0,
            total: ranking.length,
          }),
        },
        playerId,
      );
    }
  }, [deck.questions, netPort]);

  /* ---------------------------------------------------------------- */
  /* El loop                                                           */
  /* ---------------------------------------------------------------- */

  const publish = useCallback(
    (now: number, force: boolean) => {
      const round = roundRef.current;
      if (!round) return;
      if (!force && now - lastPublishRef.current < PUBLISH_MS) return;
      lastPublishRef.current = now;

      const progress = round.finished
        ? 1
        : Math.min(1, round.phaseMs / Math.max(1, phaseTotalMs(round)));
      const counts = answerProgress(round);

      setView({
        phase: round.phase,
        itemIndex: Math.min(round.itemIndex, Math.max(0, total - 1)),
        progress,
        answered: counts.answered,
        eligible: counts.eligible,
        ranking: liveRanking(round),
        bars: round.phase === "cierre" ? barsRef.current : null,
      });
    },
    [total],
  );

  const tick = useCallback(
    (dtMs: number, now: number) => {
      const round = roundRef.current;
      if (!round) return;

      if (stageRef.current !== "playing") {
        pushControl(now);
        return;
      }

      const events = advanceLiveRound(round, dtMs);
      let phaseChanged = false;

      for (const event of events) {
        if (event.type === "closed") {
          const question = deck.questions[event.itemIndex];
          if (question) {
            const picks = event.results.map((answer) =>
              typeof answer.value === "string" ? answer.value : "",
            );
            barsRef.current = aggregateBars({
              options: question.options,
              picks,
              correctId: question.correct ?? null,
            });
            closeRef.current = {
              correctLabel: labelOf(question, question.correct ?? null),
              explanation: deck.explanations.get(question.id) ?? "",
              correctCount: event.results.filter((answer) => answer.correct === true).length,
              answeredCount: event.results.length,
              bestPoints: event.results.reduce(
                (best, answer) => Math.max(best, answer.base + answer.bonus),
                0,
              ),
            };
          }
        } else if (event.type === "phase") {
          phaseChanged = true;
          if (event.phase === "respuesta") {
            // Ventana nueva: las tardias del item anterior ya se avisaron.
            lateIdsRef.current.clear();
            allInMsRef.current = 0;
          }
          // El aviso personal no sale en el mismo cuadro que el difundido: si
          // el jitter los cruza, el general le tapa el suyo a alguien.
          if (event.phase === "cierre") personalAtRef.current = now + PERSONAL_DELAY_MS;
        } else if (event.type === "finished") {
          finish(true, "completa");
        }
      }

      /* Cortar cuando ya contestaron todos. Es para lo que existe
         `closeWindowNow`: el contador "23 de 41" del proyector es justamente
         la senal de que no queda nadie pensando. */
      if (round.phase === "respuesta") {
        const counts = answerProgress(round);
        if (counts.eligible > 0 && counts.answered >= counts.eligible) {
          allInMsRef.current += dtMs;
          if (allInMsRef.current >= EARLY_CLOSE_MS) closeWindowNow(round);
        } else {
          allInMsRef.current = 0;
        }
      }

      publish(now, phaseChanged);
      pushControl(now);

      if (personalAtRef.current !== null && now >= personalAtRef.current) {
        personalAtRef.current = null;
        sendPersonalResults();
      }
    },
    [deck.explanations, deck.questions, finish, publish, pushControl, sendPersonalResults],
  );

  /* El loop se monta UNA vez y lee el `tick` de turno por referencia. Si
     dependiera de `tick`, un `onFinish` que cambia de identidad en cada render
     reiniciaria el cuadro 25 veces por segundo, el `dt` daria casi cero y la
     ronda no avanzaria nunca. */
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = window.requestAnimationFrame(frame);
      const dt = Math.min(MAX_FRAME_MS, now - last);
      last = now;
      tickRef.current(dt, now);
    };
    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const start = () => {
    startedAtRef.current = performance.now();
    lastPublishRef.current = 0;
    stageRef.current = "playing";
    setStage("playing");
  };

  /* ---------------------------------------------------------------- */
  /* El proyector                                                      */
  /* ---------------------------------------------------------------- */

  const humans = netHandle.players.filter((player) => !player.bot || deck.demoBots);

  if (total === 0) {
    return (
      <Frame>
        <div className="sn-card p-6 text-center">
          <h2 className="text-xl text-sn-text">No hay preguntas cargadas</h2>
          <p className="mt-2 text-sm text-sn-muted">
            Elegí un cuestionario con preguntas en los administrables.
          </p>
        </div>
      </Frame>
    );
  }

  if (stage === "lobby") {
    return (
      <Frame>
        <div className="sn-card flex flex-col gap-5 p-8 text-center">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sn-dim">Trivia relámpago</p>
            <h2 className="mt-1 font-display text-3xl text-sn-text">{deck.title}</h2>
          </div>
          <p className="text-sm text-sn-muted">
            {total} preguntas · {Math.round(deck.round.answerMs / 1000)} segundos para contestar ·
            se puntúa por acertar y por ser rápido.
          </p>
          <p className="rounded-sn border border-sn-line-soft bg-sn-bg-elev px-4 py-3 text-sm text-sn-text">
            Escaneá el QR con el celular. La pregunta va acá arriba; en el teléfono están las
            opciones.
          </p>
          <p className="sn-num text-2xl text-sn-cyan" aria-live="polite">
            {humans.length} {humans.length === 1 ? "conectado" : "conectados"}
          </p>
          <button type="button" className="sn-btn sn-btn--primary h-12 w-full" onClick={start}>
            Empezar
          </button>
          <p className="text-[11px] text-sn-dim">
            Quien llegue tarde entra en la pregunta siguiente, sin romper el ranking.
          </p>
        </div>
      </Frame>
    );
  }

  const question = deck.questions[Math.min(view.itemIndex, total - 1)];
  const finished = stage === "done";

  if (finished) {
    return (
      <Frame>
        <div className="flex w-full max-w-3xl flex-col gap-6">
          <header className="text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-sn-dim">Terminó</p>
            <h2 className="mt-1 font-display text-4xl text-sn-text">
              {view.ranking[0] ? `Ganó ${view.ranking[0].name}` : "Sin participantes"}
            </h2>
            {view.ranking[0] && (
              <p className="sn-num mt-1 text-2xl text-sn-cyan">{view.ranking[0].points} puntos</p>
            )}
          </header>
          <LiveRankingTable rows={view.ranking} limit={10} title="Posiciones finales" />
        </div>
      </Frame>
    );
  }

  const headline = (
    <span className="text-[clamp(0.8rem,1.2vw,1.2rem)] text-sn-dim">
      {deck.title}
      {netHandle.rttMs > 200 && <span className="ml-3 text-sn-warn">latencia alta</span>}
    </span>
  );

  return (
    <div className="h-full w-full">
      <LiveStage
        phase={view.phase}
        itemIndex={view.itemIndex}
        totalItems={total}
        question={stageText(view.phase, view.itemIndex, total, question)}
        progress={view.progress}
        answered={view.answered}
        eligible={view.eligible}
        headline={headline}
        {...(view.phase === "cierre"
          ? {
              reveal: (
                <Reveal info={closeRef.current} lateCount={lateIdsRef.current.size} />
              ),
            }
          : {})}
        {...(view.phase === "ranking"
          ? {}
          : { aside: <LiveRankingTable rows={view.ranking} limit={5} /> })}
      >
        {view.phase === "respuesta" && question && (
          <OptionGrid options={question.options} correctId={null} />
        )}
        {view.phase === "cierre" && view.bars && <LiveBars data={view.bars} />}
        {view.phase === "ranking" && (
          <div className="mx-auto w-full max-w-2xl">
            <LiveRankingTable rows={view.ranking} limit={5} title="Top 5" />
          </div>
        )}
      </LiveStage>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vistas auxiliares                                                    */
/* ------------------------------------------------------------------ */

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-xl">{children}</div>
    </div>
  );
}

/**
 * Las cuatro opciones del proyector, iguales a las del telefono: mismo orden,
 * mismo color y misma forma. La forma no es decoracion: en escala de grises
 * tienen que seguir distinguiendose.
 */
function OptionGrid({
  options,
  correctId,
}: {
  options: readonly QuestionOption[];
  correctId: string | null;
}) {
  return (
    <ul className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((option, index) => {
        const color = optionColor(index);
        const isCorrect = correctId !== null && option.id === correctId;
        return (
          <li
            key={option.id}
            className="flex items-center gap-4 rounded-sn-lg border-2 px-5 py-4"
            style={{
              borderColor: isCorrect ? "var(--sn-success)" : color,
              background: `color-mix(in oklab, ${color} 12%, transparent)`,
              opacity: correctId !== null && !isCorrect ? 0.3 : 1,
              transition: "opacity var(--sn-dur) var(--sn-ease)",
            }}
          >
            <ShapeIcon shape={optionShape(index)} color={isCorrect ? "var(--sn-success)" : color} />
            <span className="min-w-0 flex-1 text-[clamp(1rem,1.8vw,2rem)] leading-tight text-sn-text">
              {option.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ShapeIcon({ shape, color }: { shape: OptionShape; color: string }) {
  const fill = { fill: color, stroke: "none" };
  return (
    <svg viewBox="0 0 24 24" className="size-[clamp(1.5rem,2.4vw,2.6rem)] shrink-0" aria-hidden="true">
      {shape === "circle" && <circle cx="12" cy="12" r="9" {...fill} />}
      {shape === "square" && <rect x="4" y="4" width="16" height="16" rx="2" {...fill} />}
      {shape === "triangle" && <polygon points="12,3 22,20 2,20" {...fill} />}
      {shape === "diamond" && <polygon points="12,2 22,12 12,22 2,12" {...fill} />}
    </svg>
  );
}

/**
 * El cierre en el proyector: la correcta, la unica linea donde el juego ensena
 * algo, y como le fue a la sala. Lo de cada uno va a su telefono.
 */
function Reveal({ info, lateCount }: { info: CloseInfo; lateCount: number }) {
  return (
    <div className="mx-auto max-w-4xl text-center">
      <p className="font-display text-[clamp(1.2rem,2.4vw,2.4rem)] font-semibold text-sn-success">
        <span aria-hidden="true">✓ </span>
        {info.correctLabel}
      </p>
      {info.explanation && (
        <p className="mt-3 text-[clamp(0.9rem,1.4vw,1.5rem)] text-sn-muted">{info.explanation}</p>
      )}
      <p className="sn-num mt-3 text-[clamp(0.8rem,1.1vw,1.2rem)] text-sn-dim">
        {roomSummary({
          correctCount: info.correctCount,
          answeredCount: info.answeredCount,
          bestPoints: info.bestPoints,
          lateCount,
        })}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ayudas puras de la vista                                             */
/* ------------------------------------------------------------------ */

function stageText(
  phase: LiveRoundPhase,
  itemIndex: number,
  total: number,
  question: SingleQuestion | undefined,
): string {
  if (phase === "anuncio") return `Pregunta ${Math.min(itemIndex + 1, total)} de ${total}`;
  if (phase === "ranking") return "Así va la sala";
  return question?.prompt ?? "";
}

function labelOf(question: SingleQuestion, optionId: string | null): string {
  if (optionId === null) return "";
  return question.options.find((option) => option.id === optionId)?.label ?? "";
}

/**
 * Cuanto dura la fase en curso.
 *
 * La maquina de fases no lo expone porque no lo necesita: es un dato de la
 * vista, para saber que tan llena va la barra. Se lee de la misma
 * configuracion que usa la ronda, asi que no puede desincronizarse.
 */
function phaseTotalMs(round: LiveRoundState): number {
  switch (round.phase) {
    case "anuncio":
      return round.config.announceMs;
    case "lectura":
      return round.config.readMs;
    case "respuesta":
      return round.config.answerMs;
    case "cierre":
      return round.config.revealMs;
    case "ranking":
      return round.config.rankingMs ?? DEFAULT_RANKING_MS;
  }
}

/** Cuantas preguntas se llegaron a jugar. Un `force-end` a mitad emite esto. */
function askedItems(round: LiveRoundState, total: number): number {
  if (round.finished) return total;
  const closed = round.phase === "cierre" || round.phase === "ranking" ? 1 : 0;
  return Math.min(total, round.itemIndex + closed);
}
