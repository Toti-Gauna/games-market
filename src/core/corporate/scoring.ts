import {
  isAnswered,
  matchSolution,
  normalizeText,
  type Answer,
  type AnswerMap,
  type AnswerValue,
  type MatchQuestion,
  type Question,
} from "./question.types";

/**
 * Correccion, puntaje y agregacion de perfil. Puro: entra dato plano, sale
 * dato plano. Sin React, sin DOM, sin fechas del sistema.
 *
 * Vive en un solo lugar porque los seis juegos corporativos comparten la misma
 * formula, que es la que ya funcionaba en principios-culturales generalizada:
 *
 *   puntos = base x acierto + (bono ? restante/limite x base x 0.5 : 0)
 *
 * Hasta 50 % extra por velocidad: premia al rapido sin dejar afuera al que
 * sabe pero piensa, que es el defecto tipico de los trivias.
 */

export const DEFAULT_QUESTION_POINTS = 100;
export const MAX_SPEED_BONUS_RATIO = 0.5;
/** Puntos porcentuales dentro de los que el segundo arquetipo tambien se muestra. */
export const CLOSE_PROFILE_MARGIN = 5;

export type ScoreOptions = {
  /** Si false, el tiempo no suma nada. */
  speedBonus?: boolean;
  maxBonusRatio?: number;
  defaultPoints?: number;
};

export type QuestionScore = {
  questionId: string;
  /** null cuando la pregunta no tiene respuesta correcta. */
  correct: boolean | null;
  base: number;
  bonus: number;
  points: number;
};

export type QuizScore = {
  points: number;
  correct: number;
  answered: number;
  total: number;
  perQuestion: readonly QuestionScore[];
};

/* ------------------------------------------------------------------ */
/* Correccion                                                           */
/* ------------------------------------------------------------------ */

/** true si la pregunta declara una respuesta correcta. */
export function hasCorrection(question: Question): boolean {
  // Unir pares corrige solo: la union buena es la del mismo par y no hay que
  // escribirla en el contenido. `correct: null` sigue apagando la correccion.
  if (question.kind === "match") return question.correct !== null;
  const correct = (question as { correct?: unknown }).correct;
  return correct !== undefined && correct !== null;
}

/**
 * Cuantos pares quedaron bien unidos. Lo exporta el motor porque el puntaje
 * parcial de un tablero a medias lo necesita: un juego que corte por tiempo
 * cobra los pares que llego a cerrar.
 *
 * Las uniones repetidas no suman dos veces.
 */
export function countMatchedPairs(question: MatchQuestion, value: AnswerValue): number {
  if (!Array.isArray(value)) return 0;
  const solution = new Set(matchSolution(question));
  const seen = new Set<string>();
  for (const link of value as readonly unknown[]) {
    if (typeof link !== "string" || !solution.has(link)) continue;
    seen.add(link);
  }
  return seen.size;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(b);
  return a.every((id) => seen.has(id));
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Corrige una respuesta. `null` = la pregunta no corrige (perfil o encuesta),
 * que no es lo mismo que "esta mal".
 */
export function isCorrect(question: Question, value: AnswerValue): boolean | null {
  if (!hasCorrection(question)) return null;
  if (!isAnswered(question, value)) return false;

  switch (question.kind) {
    case "single":
      return value === question.correct;

    case "multiple":
      return (
        Array.isArray(value) &&
        Array.isArray(question.correct) &&
        sameSet(value as readonly string[], question.correct)
      );

    case "boolean":
      return value === question.correct;

    case "scale":
      return value === question.correct;

    case "text":
      return (
        typeof value === "string" &&
        Array.isArray(question.correct) &&
        question.correct.some((accepted) => normalizeText(accepted) === normalizeText(value))
      );

    case "order":
      return (
        Array.isArray(value) &&
        Array.isArray(question.correct) &&
        sameOrder(value as readonly string[], question.correct)
      );

    // Todos los pares unidos, no alcanza con la mayoria. El puntaje parcial
    // sale de countMatchedPairs, que es otra pregunta.
    case "match":
      return countMatchedPairs(question, value) === matchSolution(question).length;
  }
}

/* ------------------------------------------------------------------ */
/* Puntaje                                                              */
/* ------------------------------------------------------------------ */

/**
 * Bono por velocidad. Sin limite de tiempo no hay bono: sin techo no se puede
 * decir cuanto sobro.
 */
export function speedBonusPoints(
  base: number,
  elapsedMs: number,
  timeLimitMs: number | null | undefined,
  maxRatio: number = MAX_SPEED_BONUS_RATIO,
): number {
  if (timeLimitMs === null || timeLimitMs === undefined || timeLimitMs <= 0) return 0;
  const remaining = 1 - Math.max(0, elapsedMs) / timeLimitMs;
  if (remaining <= 0) return 0;
  return Math.round(base * Math.min(1, remaining) * maxRatio);
}

export function scoreQuestion(
  question: Question,
  answer: Answer | undefined,
  options: ScoreOptions = {},
): QuestionScore {
  const base = question.points ?? options.defaultPoints ?? DEFAULT_QUESTION_POINTS;
  const value = answer && !answer.skipped ? answer.value : null;
  const correct = isCorrect(question, value);

  if (correct !== true) {
    return { questionId: question.id, correct, base, bonus: 0, points: 0 };
  }

  const bonus =
    options.speedBonus === false
      ? 0
      : speedBonusPoints(
          base,
          answer?.elapsedMs ?? 0,
          question.timeLimitMs,
          options.maxBonusRatio ?? MAX_SPEED_BONUS_RATIO,
        );

  return { questionId: question.id, correct: true, base, bonus, points: base + bonus };
}

export function scoreQuestions(
  questions: readonly Question[],
  answers: AnswerMap,
  options: ScoreOptions = {},
): QuizScore {
  const perQuestion = questions.map((question) =>
    scoreQuestion(question, answers[question.id], options),
  );

  let points = 0;
  let correct = 0;
  let answered = 0;

  for (const question of questions) {
    const answer = answers[question.id];
    if (answer && !answer.skipped && isAnswered(question, answer.value)) answered += 1;
  }
  for (const row of perQuestion) {
    points += row.points;
    if (row.correct === true) correct += 1;
  }

  return { points, correct, answered, total: questions.length, perQuestion };
}

/* ------------------------------------------------------------------ */
/* Agregacion de arquetipo                                              */
/* ------------------------------------------------------------------ */

export type DimensionTally = {
  id: string;
  score: number;
  /** Entero. Los porcentajes de una agregacion suman exactamente 100. */
  percent: number;
};

export type ProfileResult = {
  /** De mayor a menor. Los empates respetan el orden declarado de dimensiones. */
  ranking: readonly DimensionTally[];
  /** null si nadie sumo nada. */
  topId: string | null;
  /** El segundo, solo si esta dentro del margen. Nadie es 100 % de una cosa. */
  closeSecondId: string | null;
  totalScore: number;
  answered: number;
};

export type ProfileOptions = {
  /** Puntos porcentuales de diferencia para mostrar tambien el segundo. */
  closeMargin?: number;
};

/** Reparto entero por resto mayor: evita que la mezcla sume 99 o 101. */
function toPercents(values: readonly number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return values.map(() => 0);

  const exact = values.map((v) => (v / total) * 100);
  const floors = exact.map((v) => Math.floor(v));
  let left = 100 - floors.reduce((sum, v) => sum + v, 0);

  const order = exact
    .map((v, i) => ({ i, rest: v - Math.floor(v) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);

  const out = [...floors];
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

/**
 * Suma los pesos de lo respondido y devuelve la mezcla completa, no solo el
 * ganador: un 34 contra 32 mostrado como un unico arquetipo se siente
 * arbitrario a quien lo recibe.
 */
export function aggregateProfile(
  questions: readonly Question[],
  answers: AnswerMap,
  dimensions: readonly string[],
  options: ProfileOptions = {},
): ProfileResult {
  const raw = new Map<string, number>(dimensions.map((id) => [id, 0]));
  let answered = 0;

  const add = (dimension: string, amount: number) => {
    if (!raw.has(dimension)) return; // una dimension no declarada no entra al reparto
    raw.set(dimension, (raw.get(dimension) ?? 0) + amount);
  };

  for (const question of questions) {
    const weights = question.weights;
    const answer = answers[question.id];
    if (!weights || !answer || answer.skipped) continue;
    if (!isAnswered(question, answer.value)) continue;

    answered += 1;
    const value = answer.value;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const bucket = weights[String(value)];
      if (bucket) for (const [dim, amount] of Object.entries(bucket)) add(dim, amount);
      continue;
    }

    if (Array.isArray(value)) {
      const ids = value as readonly string[];
      // En `order` el primer puesto pesa mas que el ultimo; en `multiple`
      // todas las elegidas pesan igual.
      const positional = question.kind === "order";
      ids.forEach((id, index) => {
        const bucket = weights[id];
        if (!bucket) return;
        const factor = positional ? (ids.length - index) / ids.length : 1;
        for (const [dim, amount] of Object.entries(bucket)) add(dim, amount * factor);
      });
    }
  }

  const scores = dimensions.map((id) => raw.get(id) ?? 0);
  const percents = toPercents(scores);

  const ranking: DimensionTally[] = dimensions
    .map((id, index) => ({
      id,
      score: scores[index] ?? 0,
      percent: percents[index] ?? 0,
      index,
    }))
    // Empate resuelto por el orden declarado: el resultado tiene que ser el
    // mismo en dos telefonos con las mismas respuestas.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ id, score, percent }) => ({ id, score, percent }));

  const totalScore = scores.reduce((sum, v) => sum + v, 0);
  const top = ranking[0];
  const second = ranking[1];
  const margin = options.closeMargin ?? CLOSE_PROFILE_MARGIN;

  return {
    ranking,
    topId: totalScore > 0 && top ? top.id : null,
    closeSecondId:
      totalScore > 0 && top && second && second.score > 0 && top.percent - second.percent <= margin
        ? second.id
        : null,
    totalScore,
    answered,
  };
}
