import type { Rng } from "@/core/engine/rng";

/**
 * Los items de las experiencias corporativas.
 *
 * Todo es dato plano y serializable: una pregunta se puede guardar en
 * localStorage, mandar por la red o escribir a mano en un archivo de
 * contenido. Nada de clases, funciones ni JSX adentro del item, porque el
 * mismo objeto viaja del panel de administrables al juego y del juego al
 * proyector.
 *
 * `correct` y `weights` viven en el item pero NO se le pasan a la UI hasta
 * que corresponde: `publicQuestion()` los saca. En una sala llena siempre hay
 * alguien mirando el inspector.
 */

export type QuestionKind =
  | "single"
  | "multiple"
  | "scale"
  | "boolean"
  | "text"
  | "order"
  | "match";

export type QuestionOption = {
  id: string;
  label: string;
  /** Segunda linea opcional, mas chica. */
  hint?: string;
};

/** dimension -> peso. Una dimension es un arquetipo, un eje o una categoria. */
export type DimensionWeights = Readonly<Record<string, number>>;

/** id de opcion -> pesos que aporta. Solo se usa en modo perfil. */
export type OptionWeights = Readonly<Record<string, DimensionWeights>>;

type QuestionBase = {
  id: string;
  prompt: string;
  /** Una linea de ayuda debajo del enunciado. */
  help?: string;
  /** Una pregunta obligatoria no se puede saltear. */
  required?: boolean;
  /** Base de puntos cuando la pregunta corrige. */
  points?: number;
  /** ms para responder. null = sin limite propio. */
  timeLimitMs?: number | null;
  /** Modo perfil: cuanto suma cada opcion a cada dimension. */
  weights?: OptionWeights;
};

export type SingleQuestion = QuestionBase & {
  kind: "single";
  options: readonly QuestionOption[];
  /** null = no hay correcta (perfil, encuesta). */
  correct?: string | null;
};

export type MultipleQuestion = QuestionBase & {
  kind: "multiple";
  options: readonly QuestionOption[];
  /** El conjunto exacto de opciones correctas. El orden no importa. */
  correct?: readonly string[] | null;
  minChoices?: number;
  maxChoices?: number;
};

export type BooleanQuestion = QuestionBase & {
  kind: "boolean";
  labels?: { yes: string; no: string };
  correct?: boolean | null;
};

export type ScaleQuestion = QuestionBase & {
  kind: "scale";
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
  correct?: number | null;
};

export type TextQuestion = QuestionBase & {
  kind: "text";
  maxLength?: number;
  placeholder?: string;
  /** Respuestas aceptadas, comparadas sin acentos ni mayusculas. */
  correct?: readonly string[] | null;
};

export type OrderQuestion = QuestionBase & {
  kind: "order";
  options: readonly QuestionOption[];
  /** El orden exacto esperado, de primero a ultimo. */
  correct?: readonly string[] | null;
};

/** Una fila del tablero de unir pares: un mismo id sostiene los dos lados. */
export type MatchPair = {
  id: string;
  /** Lo que se lee en la columna izquierda. */
  left: string;
  /** Lo que se lee en la columna derecha. */
  right: string;
};

/**
 * Unir pares.
 *
 * La respuesta se codifica como `readonly string[]`, con un
 * `"<leftId>|<rightId>"` por union hecha. Es a proposito: `AnswerValue` ya
 * admite `readonly string[]`, asi que el tablero entra sin ensanchar la union
 * de tipos y sin tocar los otros cinco renderers. Ademas una respuesta a
 * medias es una lista corta, que es exactamente lo que necesita el puntaje por
 * par: no hace falta un formato aparte para el parcial.
 */
export type MatchQuestion = QuestionBase & {
  kind: "match";
  pairs: readonly MatchPair[];
  /**
   * Orden de la columna derecha, por id de par. Sin esto sale alineada con la
   * izquierda y la solucion se lee de arriba abajo.
   */
  rightOrder?: readonly string[];
  /**
   * Las uniones esperadas. Si no se declara, la correcta es la del mismo par.
   * `null` apaga la correccion, como en el resto de los tipos.
   */
  correct?: readonly string[] | null;
};

export type Question =
  | SingleQuestion
  | MultipleQuestion
  | BooleanQuestion
  | ScaleQuestion
  | TextQuestion
  | OrderQuestion
  | MatchQuestion;

/** Lo que devuelve cualquier renderer. `null` = sin responder. */
export type AnswerValue = string | readonly string[] | number | boolean | null;

export type Answer = {
  questionId: string;
  value: AnswerValue;
  /** ms desde que se mostro la pregunta. Alimenta el bono por velocidad. */
  elapsedMs: number;
  /** true si la persona la salteo a proposito. */
  skipped: boolean;
};

export type AnswerMap = Record<string, Answer | undefined>;

/* ------------------------------------------------------------------ */
/* Guardas y utilidades de dato plano                                   */
/* ------------------------------------------------------------------ */

export const QUESTION_KINDS: readonly QuestionKind[] = [
  "single",
  "multiple",
  "scale",
  "boolean",
  "text",
  "order",
  "match",
];

export function isQuestionKind(value: unknown): value is QuestionKind {
  return typeof value === "string" && (QUESTION_KINDS as readonly string[]).includes(value);
}

export type OptionQuestion = SingleQuestion | MultipleQuestion | OrderQuestion;

export function hasOptions(question: Question): question is OptionQuestion {
  return question.kind === "single" || question.kind === "multiple" || question.kind === "order";
}

/** El valor con el que arranca cada tipo, para no arrastrar `undefined`. */
export function emptyValue(question: Question): AnswerValue {
  switch (question.kind) {
    // Un tablero sin uniones tambien arranca como lista vacia, no como `null`.
    case "multiple":
    case "match":
      return [];
    // El orden arranca mostrado tal cual viene: ya es una respuesta valida.
    case "order":
      return question.options.map((option) => option.id);
    case "text":
      return "";
    default:
      return null;
  }
}

/** Si el valor cuenta como respuesta. Un texto en blanco no cuenta. */
export function isAnswered(question: Question, value: AnswerValue): boolean {
  switch (question.kind) {
    case "single":
      return typeof value === "string" && value.length > 0;
    case "multiple":
      return Array.isArray(value) && value.length > 0;
    case "order":
      return Array.isArray(value) && value.length === question.options.length;
    // Una union alcanza para que cuente: el tablero puntua por par, asi que un
    // parcial tambien es una respuesta.
    case "match":
      return Array.isArray(value) && value.length > 0;
    case "text":
      return typeof value === "string" && value.trim().length > 0;
    case "scale":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
  }
}

/**
 * La version que se le puede dar a la UI: sin respuesta correcta y sin pesos.
 * El renderer no necesita ninguna de las dos para dibujar.
 */
export function publicQuestion(question: Question): Question {
  const { correct: _correct, weights: _weights, ...rest } = question as Question & {
    correct?: unknown;
    weights?: unknown;
  };
  return rest as Question;
}

/** Sin acentos, sin mayusculas y sin espacios de mas. Para comparar texto. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Baraja las opciones con el PRNG sembrado. Nunca con `Math.random()`: dos
 * personas con la misma semilla tienen que ver lo mismo.
 */
export function shuffleOptions<Q extends Question>(question: Q, rng: Rng): Q {
  if (!hasOptions(question)) return question;
  return { ...question, options: rng.shuffle(question.options) };
}

/** Busca una opcion por id sin depender del indice. */
export function findOption(
  question: Question,
  optionId: string,
): QuestionOption | undefined {
  if (!hasOptions(question)) return undefined;
  return question.options.find((option) => option.id === optionId);
}

/* ------------------------------------------------------------------ */
/* Unir pares — codificacion de la respuesta                            */
/* ------------------------------------------------------------------ */

/** Nunca aparece en un id de par: los ids los genera el juego, no el usuario. */
export const MATCH_LINK_SEPARATOR = "|";

export function matchLink(leftId: string, rightId: string): string {
  return `${leftId}${MATCH_LINK_SEPARATOR}${rightId}`;
}

export function parseMatchLink(link: string): { leftId: string; rightId: string } | null {
  const at = link.indexOf(MATCH_LINK_SEPARATOR);
  if (at <= 0 || at === link.length - 1) return null;
  return { leftId: link.slice(0, at), rightId: link.slice(at + 1) };
}

/** true si los dos lados son del mismo par. Es toda la regla del tablero. */
export function isMatchingPair(leftId: string, rightId: string): boolean {
  return leftId === rightId;
}

/**
 * Las uniones esperadas. Cada par se cierra consigo mismo, asi que la solucion
 * no hace falta escribirla a mano en el contenido.
 */
export function matchSolution(question: MatchQuestion): readonly string[] {
  if (Array.isArray(question.correct)) return question.correct;
  return question.pairs.map((pair) => matchLink(pair.id, pair.id));
}

/**
 * Los pares en el orden en que se dibuja la columna derecha. Un id repetido o
 * desconocido en `rightOrder` no puede dejar la columna incompleta.
 */
export function orderedRightPairs(
  pairs: readonly MatchPair[],
  rightOrder?: readonly string[],
): readonly MatchPair[] {
  if (!rightOrder || rightOrder.length === 0) return pairs;
  const seen = new Set<string>();
  const out: MatchPair[] = [];
  for (const id of rightOrder) {
    if (seen.has(id)) continue;
    const pair = pairs.find((candidate) => candidate.id === id);
    if (!pair) continue;
    seen.add(id);
    out.push(pair);
  }
  for (const pair of pairs) if (!seen.has(pair.id)) out.push(pair);
  return out;
}

/**
 * Baraja las dos columnas con el PRNG sembrado. Nunca con `Math.random()`: con
 * la misma semilla todos reciben la misma disposicion, que es lo que hace
 * comparables los puntajes.
 */
export function shuffleMatchPairs(question: MatchQuestion, rng: Rng): MatchQuestion {
  const pairs = rng.shuffle(question.pairs);
  const right = rng.shuffle(pairs);

  // Con tres pares, una de cada seis semillas deja las dos columnas alineadas y
  // la solucion se leeria de arriba abajo sin jugar. Rotar una posicion la
  // rompe y sigue dependiendo solo de la semilla.
  const aligned = pairs.length > 1 && right.every((pair, index) => pair.id === pairs[index]?.id);
  const ordered = aligned ? [...right.slice(1), ...right.slice(0, 1)] : right;

  return { ...question, pairs, rightOrder: ordered.map((pair) => pair.id) };
}
