import {
  bool,
  num,
  records,
  str,
  type SettingsRecord,
  type SettingsValues,
} from "@/core/contract/settings";
import type { Rng } from "@/core/engine/rng";
import {
  shuffleMatchPairs,
  type MatchPair,
  type MatchQuestion,
} from "@/core/corporate/question.types";
import { countMatchedPairs } from "@/core/corporate/scoring";

/**
 * Lo unico propio de Memoria de valores: pasar de los registros del panel a un
 * tablero de unir pares, y calcular el puntaje. Sin React y sin DOM, para que
 * los tests puedan correr las dos cosas que importan —determinismo y puntaje—
 * sin montar nada.
 *
 * La mecanica del tablero y la correccion viven en core/corporate: aca no se
 * repite ninguna de las dos.
 */

export const QUESTION_ID = "memoria";
export const DEFAULT_PAIR_COUNT = 5;
export const DEFAULT_POINTS_PER_PAIR = 100;
export const DEFAULT_BONUS_PER_SECOND = 2;
export const DEFAULT_WRONG_FEEDBACK_MS = 900;

export type MemoriaBoard = {
  /** El item del motor corporativo. Lo consumen el tablero y la correccion. */
  question: MatchQuestion;
  /** Columna izquierda, ya en el orden en que se dibuja. */
  pairs: readonly MatchPair[];
  /** Columna derecha, por id de par. */
  rightOrder: readonly string[];
  prompt: string;
  pointsPerPair: number;
  bonusPerSecond: number;
  showTimer: boolean;
  wrongFeedbackMs: number;
};

function text(row: SettingsRecord, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Un par por fila. El id sale del indice de la fila, no del texto: renombrar un
 * principio no puede cambiar de que par estamos hablando.
 */
export function parseMemoriaPairs(rows: readonly SettingsRecord[]): MatchPair[] {
  const out: MatchPair[] = [];
  rows.forEach((row, index) => {
    const left = text(row, "principle");
    const right = text(row, "definition");
    // Media fila no es un par: sin los dos lados la tarjeta quedaria sin pareja.
    if (!left || !right) return;
    out.push({ id: `p${index + 1}`, left, right });
  });
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Arma la partida.
 *
 * TODO lo aleatorio sale del PRNG sembrado: que pares entran, en que orden va
 * la columna izquierda y en que orden va la derecha. Con la misma semilla todos
 * reciben la misma disposicion, que es lo unico que hace comparables los
 * puntajes de un tour. Con `Math.random()` el ranking no significaria nada.
 */
export function buildMemoriaBoard(values: SettingsValues, rng: Rng): MemoriaBoard {
  const all = parseMemoriaPairs(records(values, "pairs"));
  const wanted = clamp(Math.round(num(values, "pairCount", DEFAULT_PAIR_COUNT)), 1, all.length);
  const shuffle = bool(values, "shuffle", true);
  const pointsPerPair = num(values, "pointsPerPair", DEFAULT_POINTS_PER_PAIR);

  const picked = (shuffle ? rng.shuffle(all) : all).slice(0, wanted);
  const base: MatchQuestion = {
    kind: "match",
    id: QUESTION_ID,
    prompt: str(values, "prompt", "Uní cada principio con lo que significa."),
    pairs: picked,
    points: pointsPerPair,
  };
  const question = shuffle ? shuffleMatchPairs(base, rng) : base;

  return {
    question,
    pairs: question.pairs,
    rightOrder: question.rightOrder ?? question.pairs.map((pair) => pair.id),
    prompt: question.prompt,
    pointsPerPair,
    bonusPerSecond: num(values, "bonusPerSecond", DEFAULT_BONUS_PER_SECOND),
    showTimer: bool(values, "showTimer", true),
    wrongFeedbackMs: num(values, "wrongFeedbackMs", DEFAULT_WRONG_FEEDBACK_MS),
  };
}

/** Cuantos pares cerro bien lo que se lleva unido hasta ahora. */
export function countCorrectLinks(board: MemoriaBoard, links: readonly string[]): number {
  return countMatchedPairs(board.question, links);
}

export type MemoriaScoreInput = {
  matchedPairs: number;
  /** true solo si se unieron todos los pares del tablero. */
  completed: boolean;
  elapsedMs: number;
  /** null = la partida no tiene limite de tiempo. */
  durationMs: number | null;
  pointsPerPair?: number;
  bonusPerSecond?: number;
};

/**
 * La formula que ya funcionaba en el juego original, con los dos numeros
 * abiertos al panel:
 *
 *   pares x puntosPorPar + (completo y con limite ? segundos restantes x bono : 0)
 *
 * Sin limite de tiempo no hay bono, porque sin techo no se puede decir cuanto
 * sobro. Y sin completar tampoco: cobrar velocidad por un tablero a medias
 * premiaria abandonar temprano.
 */
export function computeMemoriaPoints(input: MemoriaScoreInput): number {
  const perPair = input.pointsPerPair ?? DEFAULT_POINTS_PER_PAIR;
  const base = Math.max(0, input.matchedPairs) * perPair;
  if (!input.completed || input.durationMs === null) return base;

  const secondsLeft = Math.max(0, Math.ceil((input.durationMs - input.elapsedMs) / 1000));
  return base + secondsLeft * (input.bonusPerSecond ?? DEFAULT_BONUS_PER_SECOND);
}

/** Lo que viaja en `meta`. Plano y serializable: el shell lo muestra crudo. */
export function memoriaMeta(input: {
  matchedPairs: number;
  totalPairs: number;
  misses: number;
  completed: boolean;
  points: number;
  pointsPerPair: number;
  /** El limite de la partida, para poder leer el bono sin recalcularlo. */
  limitMs: number | null;
}): Record<string, unknown> {
  const basePoints = input.matchedPairs * input.pointsPerPair;
  return {
    matchedPairs: input.matchedPairs,
    totalPairs: input.totalPairs,
    misses: input.misses,
    completed: input.completed,
    basePoints,
    timeBonus: Math.max(0, input.points - basePoints),
    limitMs: input.limitMs,
  };
}
