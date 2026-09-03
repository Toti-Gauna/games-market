import {
  isAnswered,
  publicQuestion,
  type AnswerValue,
  type Question,
} from "./question.types";
import { MAX_SPEED_BONUS_RATIO, isCorrect, speedBonusPoints } from "./scoring";

/**
 * Rondas en vivo: la maquina de fases que comparten Trivia relampago (C1) y
 * Verdadero o falso (C6). No es un juego; es lo que los dos juegos usan entero.
 *
 * Pura y determinista: no lee ningun reloj del sistema, no abre timers, no
 * toca la red y no conoce React ni el DOM. El host la hace avanzar con un `dt`,
 * igual que a un juego, y le pasa la marca de llegada de cada respuesta
 * traducida al reloj de la ronda.
 *
 * Las tres reglas que justifican que esto viva en un solo lugar:
 *
 * 1. El tiempo lo mide el host. El celular manda SOLO la opcion elegida.
 *    `readClientAnswer` recorta el payload a `{ participantId, value }`, asi que
 *    no hay forma de que un tiempo declarado por el cliente entre al puntaje.
 *    Si el celular pudiera decir cuanto tardo, cualquiera con las herramientas
 *    de desarrollo abiertas diria 0,01 s y ganaria siempre.
 * 2. La ventana cierra en el host, no en cada telefono. Un celular con el reloj
 *    corrido no puede regalarse dos segundos.
 * 3. La lectura va ANTES de habilitar. Sin esos 2-3 segundos gana el reflejo y
 *    no el criterio, que es justo lo que el juego dice medir.
 */

/* ------------------------------------------------------------------ */
/* Fases y ritmo                                                        */
/* ------------------------------------------------------------------ */

export type LiveRoundPhase = "anuncio" | "lectura" | "respuesta" | "cierre" | "ranking";

export type LiveRoundConfig = {
  announceMs: number;
  /** Ventana de lectura ANTES de habilitar. Sin esto gana el reflejo, no el criterio. */
  readMs: number;
  answerMs: number;
  revealMs: number;
  /** Cada cuantos items se muestra el ranking completo. 0 = nunca. */
  rankingEvery: number;
  /** Cuanto dura esa pantalla. La base no lo fija: C1 la muestra 4 s. */
  rankingMs?: number;
};

export const DEFAULT_RANKING_MS = 4000;

/** El ritmo de C1: 2 / 3 / 10 / 3, con ranking completo cada 5 preguntas. */
export const TRIVIA_ROUND_CONFIG: LiveRoundConfig = {
  announceMs: 2000,
  readMs: 3000,
  answerMs: 10000,
  revealMs: 3000,
  rankingEvery: 5,
  rankingMs: DEFAULT_RANKING_MS,
};

/**
 * El ritmo de C6: 1,5 / 2 / 5 / 2,5 y sin pantalla de ranking, porque su
 * marcador real es "quedan 24" y no una tabla de puntos.
 */
export const SURVIVAL_ROUND_CONFIG: LiveRoundConfig = {
  announceMs: 1500,
  readMs: 2000,
  answerMs: 5000,
  revealMs: 2500,
  rankingEvery: 0,
};

/* ------------------------------------------------------------------ */
/* Puntaje parametrizable                                               */
/* ------------------------------------------------------------------ */

export type LiveScoreInput = {
  participantId: string;
  question: Question;
  /** null cuando no contesto. */
  value: AnswerValue | null;
  /** null cuando el item no corrige. */
  correct: boolean | null;
  /** ms medidos por el host, ya con medio RTT descontado. null si no contesto. */
  elapsedMs: number | null;
  /** La ventana de este item: es el "total" de la formula. */
  windowMs: number;
  /** Aciertos consecutivos contando este. 0 si erro o no contesto. */
  streak: number;
  itemIndex: number;
  /** Puntos acumulados antes de este item. */
  pointsBefore: number;
};

/** `base` es lo que se cobra por el item; `bonus`, lo que suma la racha. */
export type LiveScore = { base: number; bonus: number };

export type LiveScorer = (input: LiveScoreInput) => LiveScore;

export const TRIVIA_BASE_POINTS = 1000;
export const SURVIVAL_BASE_POINTS = 200;
export const STREAK_STEP = 100;
export const STREAK_CAP = 500;
export const STREAK_FROM = 3;

/**
 * La formula de la base corporativa: mitad por saber, mitad por velocidad.
 *
 *   puntos = base/2 + base/2 x restante/total
 *
 * Con base 1000 y ventana de 10 s da 1000 al instante y 500 sobre la chicharra,
 * que es exactamente lo que pide C1. El bono por velocidad sale de `scoring.ts`,
 * que ya lo resuelve para los seis juegos corporativos.
 */
export function timedAnswerPoints(base: number, elapsedMs: number, windowMs: number): number {
  const knowledge = Math.round(base * (1 - MAX_SPEED_BONUS_RATIO));
  return knowledge + speedBonusPoints(base, elapsedMs, windowMs, MAX_SPEED_BONUS_RATIO);
}

/**
 * +100 por cada acierto consecutivo a partir del tercero, tope +500. Errar no
 * resta nunca: solo corta la racha.
 */
export function streakBonus(
  streak: number,
  step: number = STREAK_STEP,
  cap: number = STREAK_CAP,
  from: number = STREAK_FROM,
): number {
  if (step <= 0 || streak < from) return 0;
  return Math.min(cap, (streak - from + 1) * step);
}

export type TimedScorerOptions = {
  /** Puntos del item entero. 1000 en C1, 200 en C6. */
  base?: number;
  /** 0 apaga la racha, que es lo que hace C6: ahi el bono es sobrevivir. */
  streakStep?: number;
  streakCap?: number;
  streakFrom?: number;
};

/**
 * El puntaje se inyecta porque C1 y C6 comparten el ritmo pero no la formula.
 * `question.points` pisa la base, asi que una pregunta puede valer distinto sin
 * tocar el juego.
 */
export function createTimedScorer(options: TimedScorerOptions = {}): LiveScorer {
  const base = options.base ?? TRIVIA_BASE_POINTS;
  const step = options.streakStep ?? STREAK_STEP;
  const cap = options.streakCap ?? STREAK_CAP;
  const from = options.streakFrom ?? STREAK_FROM;

  return (input) => {
    if (input.correct !== true || input.elapsedMs === null) return { base: 0, bonus: 0 };
    const points = input.question.points ?? base;
    return {
      base: timedAnswerPoints(points, input.elapsedMs, input.windowMs),
      bonus: streakBonus(input.streak, step, cap, from),
    };
  };
}

/** C1: 1000 por acierto con mitad por velocidad, y racha desde el tercero. */
export const triviaScorer: LiveScorer = createTimedScorer();

/**
 * C6: 200 por acierto y sin racha. Los +150 por sobrevivir y los +500 del
 * ganador son propios del formato de supervivencia y se suman con
 * `awardPoints`, que es lo unico que C6 tiene que escribir de puntaje.
 */
export const survivalScorer: LiveScorer = createTimedScorer({
  base: SURVIVAL_BASE_POINTS,
  streakStep: 0,
});

/* ------------------------------------------------------------------ */
/* La ronda                                                             */
/* ------------------------------------------------------------------ */

export type LiveParticipant = {
  id: string;
  name: string;
  /**
   * Primer item que le cuenta. Quien entra en el 4 juega del 5 en adelante:
   * dejarlo contestar el que ya empezo le daria menos tiempo que a los demas y
   * ensuciaria el ranking.
   */
  fromItem: number;
  points: number;
  streak: number;
  correctCount: number;
  answeredCount: number;
};

export type LiveAnswer = {
  participantId: string;
  value: AnswerValue;
  /** ms desde que abrio la ventana, medidos por el host y ya sin medio RTT. */
  elapsedMs: number;
  correct: boolean | null;
  base: number;
  bonus: number;
};

export type LiveRoundState = {
  readonly config: LiveRoundConfig;
  readonly questions: readonly Question[];
  readonly scorer: LiveScorer;
  itemIndex: number;
  phase: LiveRoundPhase;
  /** ms dentro de la fase actual. */
  phaseMs: number;
  /** Reloj monotono de la ronda. Es contra esto que se mide todo. */
  clockMs: number;
  /** Momento en que abrio la ventana, en `clockMs`. null = cerrada. */
  windowOpenedAtMs: number | null;
  participants: Map<string, LiveParticipant>;
  /** Respuestas del item en curso. */
  answers: Map<string, LiveAnswer>;
  finished: boolean;
};

export type LiveRoundEvent =
  | { type: "phase"; phase: LiveRoundPhase; itemIndex: number }
  /** La ventana cerro y ya estan los puntos de todos. */
  | { type: "closed"; itemIndex: number; results: readonly LiveAnswer[] }
  | { type: "finished" };

export function createLiveRound(options: {
  config: LiveRoundConfig;
  questions: readonly Question[];
  scorer: LiveScorer;
}): LiveRoundState {
  return {
    config: options.config,
    questions: options.questions,
    scorer: options.scorer,
    itemIndex: 0,
    phase: "anuncio",
    phaseMs: 0,
    clockMs: 0,
    windowOpenedAtMs: null,
    participants: new Map(),
    answers: new Map(),
    finished: options.questions.length === 0,
  };
}

/** El item en curso, o null si la ronda termino. */
export function currentQuestion(state: LiveRoundState): Question | null {
  return state.questions[state.itemIndex] ?? null;
}

/**
 * El item tal como puede viajar al celular: sin la respuesta correcta ni los
 * pesos. En un evento real alguien va a abrir el inspector.
 */
export function publicCurrentQuestion(state: LiveRoundState): Question | null {
  const question = currentQuestion(state);
  return question ? publicQuestion(question) : null;
}

export function addParticipant(state: LiveRoundState, id: string, name: string): LiveParticipant {
  const existing = state.participants.get(id);
  if (existing) return existing;
  // Si la ronda ya arranco, entra en el proximo item, no en el que corre.
  const started = state.phase !== "anuncio" || state.itemIndex > 0 || state.clockMs > 0;
  const participant: LiveParticipant = {
    id,
    name,
    fromItem: started ? state.itemIndex + 1 : 0,
    points: 0,
    streak: 0,
    correctCount: 0,
    answeredCount: 0,
  };
  state.participants.set(id, participant);
  return participant;
}

export function removeParticipant(state: LiveRoundState, id: string): void {
  state.participants.delete(id);
  state.answers.delete(id);
}

/** Puntos que no salen de contestar: sobrevivir una ronda, ganar el juego. */
export function awardPoints(state: LiveRoundState, id: string, points: number): void {
  const participant = state.participants.get(id);
  if (participant) participant.points += points;
}

export function isPlaying(state: LiveRoundState, id: string): boolean {
  const participant = state.participants.get(id);
  return participant !== undefined && state.itemIndex >= participant.fromItem;
}

/** Cuantos pueden contestar este item, y cuantos ya lo hicieron. */
export function answerProgress(state: LiveRoundState): { answered: number; eligible: number } {
  let eligible = 0;
  for (const participant of state.participants.values()) {
    if (state.itemIndex >= participant.fromItem) eligible++;
  }
  return { answered: state.answers.size, eligible };
}

/* ------------------------------------------------------------------ */
/* Respuestas                                                           */
/* ------------------------------------------------------------------ */

export type SubmitResult =
  | { status: "accepted"; elapsedMs: number }
  /** Llego despues del cierre. No es un error: hay que decirlo, no ocultarlo. */
  | { status: "late" }
  | { status: "duplicate" }
  | { status: "not-open" }
  | { status: "not-playing" }
  | { status: "invalid" };

/**
 * El host registra una respuesta.
 *
 * Fijate que NO hay ningun parametro de tiempo del cliente: el celular manda
 * la opcion y nada mas. El unico reloj es `state.clockMs`, que avanza el host.
 * `rttMs` sale del ping continuo del `GameNetPort`, no de lo que diga el
 * telefono, y se descuenta a la mitad para compensar el viaje del paquete: sin
 * eso pierde quien tiene peor WiFi.
 */
export function submitAnswer(
  state: LiveRoundState,
  input: { participantId: string; value: AnswerValue; rttMs?: number },
): SubmitResult {
  const question = currentQuestion(state);
  if (!question) return { status: "not-open" };

  const participant = state.participants.get(input.participantId);
  if (!participant) return { status: "not-playing" };
  if (state.itemIndex < participant.fromItem) return { status: "not-playing" };

  if (state.phase !== "respuesta" || state.windowOpenedAtMs === null) {
    // Cerrada por tiempo es "tarde"; todavia no abierta es otra cosa.
    return state.phase === "cierre" || state.phase === "ranking"
      ? { status: "late" }
      : { status: "not-open" };
  }

  if (state.answers.has(input.participantId)) return { status: "duplicate" };
  if (!isAnswered(question, input.value)) return { status: "invalid" };

  const halfTrip = Math.max(0, (input.rttMs ?? 0) / 2);
  const elapsedMs = Math.max(0, state.clockMs - state.windowOpenedAtMs - halfTrip);

  state.answers.set(input.participantId, {
    participantId: input.participantId,
    value: input.value,
    elapsedMs,
    // Se corrige al cerrar, junto con todos: antes seria filtrar la respuesta.
    correct: null,
    base: 0,
    bonus: 0,
  });

  return { status: "accepted", elapsedMs };
}

/* ------------------------------------------------------------------ */
/* La maquina de fases                                                  */
/* ------------------------------------------------------------------ */

function phaseDuration(state: LiveRoundState, phase: LiveRoundPhase): number {
  const { config } = state;
  switch (phase) {
    case "anuncio":
      return config.announceMs;
    case "lectura":
      return config.readMs;
    case "respuesta":
      return config.answerMs;
    case "cierre":
      return config.revealMs;
    case "ranking":
      return config.rankingMs ?? DEFAULT_RANKING_MS;
  }
}

function showsRanking(state: LiveRoundState): boolean {
  const every = state.config.rankingEvery;
  if (every <= 0) return false;
  const shown = state.itemIndex + 1;
  return shown % every === 0 || shown === state.questions.length;
}

/**
 * Corrige y puntua todo el item de una vez.
 *
 * Se hace al cerrar y no al llegar cada respuesta, por dos motivos: la racha
 * necesita saber si acerto antes de sumar, y difundir la correccion de a una
 * le contaria la respuesta a los que todavia estan pensando.
 */
function closeItem(state: LiveRoundState): LiveAnswer[] {
  const question = currentQuestion(state);
  const windowMs = state.config.answerMs;
  const results: LiveAnswer[] = [];
  if (!question) return results;

  for (const participant of state.participants.values()) {
    if (state.itemIndex < participant.fromItem) continue;
    const answer = state.answers.get(participant.id);

    if (!answer) {
      // No contestar corta la racha, pero no resta: ya se pierde el item.
      participant.streak = 0;
      continue;
    }

    const correct = isCorrect(question, answer.value);
    participant.answeredCount++;
    if (correct === true) {
      participant.correctCount++;
      participant.streak++;
    } else {
      participant.streak = 0;
    }

    const score = state.scorer({
      participantId: participant.id,
      question,
      value: answer.value,
      correct,
      elapsedMs: answer.elapsedMs,
      windowMs,
      streak: participant.streak,
      itemIndex: state.itemIndex,
      pointsBefore: participant.points,
    });

    answer.correct = correct;
    answer.base = score.base;
    answer.bonus = score.bonus;
    participant.points += score.base + score.bonus;
    results.push(answer);
  }

  state.windowOpenedAtMs = null;
  return results;
}

/** Cierra la ventana antes de tiempo. Lo usa el host cuando ya contestaron todos. */
export function closeWindowNow(state: LiveRoundState): void {
  if (state.phase === "respuesta") state.phaseMs = state.config.answerMs;
}

/**
 * Avanza la ronda. El host la llama con el `dt` de su loop y actua sobre los
 * eventos que devuelve.
 */
export function advanceLiveRound(state: LiveRoundState, dtMs: number): LiveRoundEvent[] {
  const events: LiveRoundEvent[] = [];
  if (state.finished || dtMs <= 0) return events;

  state.clockMs += dtMs;
  state.phaseMs += dtMs;

  // `while` y no `if`: con un dt grande —una pestana que vuelve— puede haber
  // que atravesar varias fases de una, y saltear una dejaria la ventana
  // abierta para siempre.
  let guard = 0;
  while (!state.finished && state.phaseMs >= phaseDuration(state, state.phase) && guard++ < 16) {
    const overflow = state.phaseMs - phaseDuration(state, state.phase);

    switch (state.phase) {
      case "anuncio":
        state.phase = "lectura";
        break;

      case "lectura":
        state.phase = "respuesta";
        // El t0 de la ventana es el reloj de la ronda menos lo que ya se paso
        // de largo, o quien conteste primero cobraria un tiempo negativo.
        state.windowOpenedAtMs = state.clockMs - overflow;
        break;

      case "respuesta": {
        const results = closeItem(state);
        state.phase = "cierre";
        events.push({ type: "closed", itemIndex: state.itemIndex, results });
        break;
      }

      case "cierre":
        if (showsRanking(state)) {
          state.phase = "ranking";
        } else {
          advanceItem(state, events);
        }
        break;

      case "ranking":
        advanceItem(state, events);
        break;
    }

    state.phaseMs = overflow;
    if (!state.finished) events.push({ type: "phase", phase: state.phase, itemIndex: state.itemIndex });
  }

  return events;
}

function advanceItem(state: LiveRoundState, events: LiveRoundEvent[]): void {
  state.answers.clear();
  state.itemIndex++;
  if (state.itemIndex >= state.questions.length) {
    state.finished = true;
    state.phase = "ranking";
    events.push({ type: "finished" });
    return;
  }
  state.phase = "anuncio";
}

/* ------------------------------------------------------------------ */
/* Ranking                                                              */
/* ------------------------------------------------------------------ */

export type LiveRankEntry = {
  participantId: string;
  name: string;
  points: number;
  correctCount: number;
  position: number;
};

/**
 * Empates por cantidad de aciertos y despues por nombre, nunca al azar: dos
 * corridas con los mismos datos tienen que dar la misma tabla.
 */
export function liveRanking(state: LiveRoundState): LiveRankEntry[] {
  const rows = [...state.participants.values()].sort(
    (a, b) =>
      b.points - a.points || b.correctCount - a.correctCount || a.name.localeCompare(b.name, "es"),
  );
  return rows.map((row, index) => ({
    participantId: row.id,
    name: row.name,
    points: row.points,
    correctCount: row.correctCount,
    position: index + 1,
  }));
}
