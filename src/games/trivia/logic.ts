import type { ControlOption, OptionShape } from "@/core/contract/control";
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
  createTimedScorer,
  triviaScorer,
  TRIVIA_ROUND_CONFIG,
  type LiveRankEntry,
  type LiveRoundConfig,
  type LiveScorer,
} from "@/core/corporate/liveRound";
import {
  shuffleOptions,
  type QuestionOption,
  type SingleQuestion,
} from "@/core/corporate/question.types";
import { findQuizSeed } from "./content";

/**
 * Lo unico propio de C1.
 *
 * La maquina de fases, la medicion del tiempo en el host, el cierre de la
 * ventana, el descarte de las tardias, la formula de puntos, la racha y el
 * ranking ya viven en `core/corporate/liveRound.ts` y no se repiten aca. Lo
 * que falta —y es lo que este archivo hace— es pasar de los administrables al
 * cuestionario y barajar con la semilla de la partida.
 *
 * Todo puro: entra dato plano y sale dato plano, sin React y sin relojes.
 */

/** Los asientos del registry: el tope de gente que puede tomar el QR. */
export const TRIVIA_SEATS = 40;

/** Las cuatro columnas de cada fila del panel. */
export const OPTION_KEYS = ["a", "b", "c", "d"] as const;

export type OptionKey = (typeof OPTION_KEYS)[number];

/**
 * Forma por posicion, en el mismo orden en que `GamepadController` reparte los
 * colores. Es lo que hace que la opcion de arriba del telefono sea la misma
 * que la de arriba del proyector, y lo que permite distinguirlas en escala de
 * grises: el color solo deja afuera a la gente daltonica, que en una sala de
 * 40 personas siempre hay.
 */
export const OPTION_SHAPES: readonly OptionShape[] = ["circle", "triangle", "square", "diamond"];

/** Los mismos tokens que usa el telefono, en el mismo orden. Cero hex. */
export const OPTION_COLORS: readonly string[] = [
  "var(--sn-cyan-400)",
  "var(--sn-magenta-400)",
  "var(--sn-violet-400)",
  "var(--sn-warn)",
];

export function optionShape(index: number): OptionShape {
  return OPTION_SHAPES[index % OPTION_SHAPES.length] ?? "circle";
}

export function optionColor(index: number): string {
  return OPTION_COLORS[index % OPTION_COLORS.length] ?? "var(--sn-cyan-400)";
}

/* ------------------------------------------------------------------ */
/* Del panel al cuestionario                                            */
/* ------------------------------------------------------------------ */

export type TriviaDeck = {
  quizId: string;
  title: string;
  questions: readonly SingleQuestion[];
  /**
   * La explicacion NO viaja adentro de la pregunta.
   *
   * `publicQuestion()` saca `correct` y `weights`, pero no un `help`, y la
   * explicacion casi siempre delata la respuesta. Vive aparte, la lee solo el
   * proyector y recien en el cierre.
   */
  explanations: ReadonlyMap<string, string>;
  round: LiveRoundConfig;
  scorer: LiveScorer;
  streak: boolean;
  demoBots: boolean;
};

function text(row: SettingsRecord, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

export type ParsedQuiz = {
  questions: SingleQuestion[];
  explanations: Map<string, string>;
};

/**
 * Cada fila del panel es una pregunta de opcion unica.
 *
 * Se descartan las filas que no se pueden jugar: sin enunciado, con menos de
 * dos opciones o con la correcta apuntando a una opcion vacia. Proyectar una
 * pregunta que nadie puede acertar es peor que tener una pregunta menos.
 */
export function parseTriviaQuestions(rows: readonly SettingsRecord[]): ParsedQuiz {
  const questions: SingleQuestion[] = [];
  const explanations = new Map<string, string>();

  rows.forEach((row, index) => {
    const prompt = text(row, "prompt");
    if (!prompt) return;

    // Ids por fila y no por contenido: si alguien reescribe el enunciado, la
    // pregunta sigue siendo la misma para el ranking de la ronda en curso.
    const id = `q${index + 1}`;
    const options: QuestionOption[] = [];
    for (const key of OPTION_KEYS) {
      const label = text(row, key);
      if (label) options.push({ id: `${id}${key}`, label });
    }
    if (options.length < 2) return;

    const correct = `${id}${text(row, "correct")}`;
    if (!options.some((option) => option.id === correct)) return;

    questions.push({ kind: "single", id, prompt, options, correct });
    explanations.set(id, text(row, "explanation"));
  });

  return { questions, explanations };
}

/**
 * Arma la partida entera desde los administrables.
 *
 * El barajado sale del PRNG sembrado con `config.seed` y nunca de
 * `Math.random()`: con la misma semilla la sala entera ve el mismo orden, que
 * es lo unico que hace comparables los puntajes de dos corridas.
 */
export function buildTriviaDeck(values: SettingsValues, rng: Rng): TriviaDeck {
  const quizId = str(values, "quiz", "cultura");
  const parsed = parseTriviaQuestions(records(values, quizId));

  let questions: readonly SingleQuestion[] = parsed.questions;
  if (bool(values, "shuffleQuestions", false)) questions = rng.shuffle(questions);
  if (bool(values, "shuffleOptions", true)) {
    questions = questions.map((question) => shuffleOptions(question, rng));
  }

  const streak = bool(values, "streak", true);

  return {
    quizId,
    title: findQuizSeed(quizId)?.title ?? quizId,
    questions,
    explanations: parsed.explanations,
    round: {
      ...TRIVIA_ROUND_CONFIG,
      readMs: Math.round(num(values, "readSec", 3) * 1000),
      answerMs: Math.round(num(values, "answerSec", 10) * 1000),
      rankingEvery: Math.round(num(values, "rankingEvery", 5)),
    },
    // La racha se apaga sin tocar la formula: `streakStep: 0` es lo que hace
    // C6 con el mismo puntaje parametrizable.
    scorer: streak ? triviaScorer : createTimedScorer({ streakStep: 0 }),
    streak,
    demoBots: bool(values, "demoBots", false),
  };
}

/* ------------------------------------------------------------------ */
/* Lo que se le manda al telefono                                       */
/* ------------------------------------------------------------------ */

/**
 * Las opciones tal como las dibuja el celular.
 *
 * `correctId` llega en `null` mientras la ventana esta abierta: mandar la
 * correcta antes de cerrar la deja en el DOM del telefono y en un evento real
 * siempre hay alguien mirando el inspector. Al cerrar, la correcta se marca
 * con un signo ademas del color.
 */
export function toControlOptions(
  question: SingleQuestion,
  correctId: string | null,
): ControlOption[] {
  return question.options.map((option, index) => ({
    id: option.id,
    label: correctId !== null && option.id === correctId ? `✓ ${option.label}` : option.label,
    shape: optionShape(index),
  }));
}

/** Clave de participante. Es el asiento, no el id de red: sobrevive a un refresh. */
export function participantKey(seat: number): string {
  return `s${seat}`;
}

/* ------------------------------------------------------------------ */
/* Cierre                                                               */
/* ------------------------------------------------------------------ */

/**
 * El resumen de la sala, para el proyector.
 *
 * Lo compartido se cuenta arriba —cuantos acertaron, cuanto pago lo mejor,
 * cuantos llegaron tarde— y lo personal viaja a cada telefono por separado con
 * `personalNotice`. Antes esto era un solo aviso difundido porque el puerto no
 * tenia canal por jugador; ahora que lo tiene, cada cosa esta donde se lee.
 */
export function roomSummary(input: {
  correctCount: number;
  answeredCount: number;
  bestPoints: number;
  lateCount: number;
}): string {
  const parts = [`${input.correctCount} de ${input.answeredCount} acertaron`];
  if (input.bestPoints > 0) parts.push(`lo mejor pagó ${input.bestPoints}`);
  // Llegar tarde no es un error de nadie: se dice, no se esconde.
  if (input.lateCount > 0) {
    parts.push(
      input.lateCount === 1
        ? "1 llegó después del cierre"
        : `${input.lateCount} llegaron después del cierre`,
    );
  }
  return parts.join(" · ");
}

/** Como le fue a una persona en el item que acaba de cerrar. */
export type PersonalStatus = "correct" | "wrong" | "missed" | "late";

export type PersonalResult = {
  status: PersonalStatus;
  /** Base mas racha del item. 0 si no cobro. */
  points: number;
  /** Cuanto de esos puntos vino de la racha. */
  bonus: number;
  correctLabel: string;
  /** 1-based. 0 cuando todavia no hay tabla. */
  position: number;
  total: number;
};

/**
 * El aviso que recibe UN telefono al cerrar.
 *
 * Es lo que pide la spec: acertaste o erraste, puntos ganados y posicion. Va
 * dirigido, asi que nadie ve el resultado de otro, y se manda una sola vez por
 * item: personalizar los 8 Hz de la ventana serian decenas de mensajes por
 * segundo para dibujar una barra que es igual para todos.
 *
 * Llegar tarde se nombra como lo que es —llegaste despues del cierre— y no
 * como un error: el que contesto y no entro tiene que entender por que.
 */
export function personalNotice(result: PersonalResult): string {
  const place = result.position > 0 ? ` · vas ${result.position}º de ${result.total}` : "";
  const correcta = result.correctLabel ? ` · la correcta era ${result.correctLabel}` : "";

  switch (result.status) {
    case "correct": {
      const racha = result.bonus > 0 ? ` (racha +${result.bonus})` : "";
      return `Acertaste · +${result.points}${racha}${place}`;
    }
    case "wrong":
      return `Erraste${correcta}${place}`;
    case "late":
      return `Llegaste después del cierre${correcta}${place}`;
    case "missed":
      return `No llegaste a contestar${correcta}${place}`;
  }
}

/* ------------------------------------------------------------------ */
/* Resultado                                                            */
/* ------------------------------------------------------------------ */

export type TriviaSummary = {
  quizId: string;
  askedItems: number;
  totalItems: number;
  participants: number;
  ranking: readonly LiveRankEntry[];
};

/** Plano y serializable: el shell lo muestra crudo, no lo interpreta. */
export function triviaMeta(summary: TriviaSummary, reason: string): Record<string, unknown> {
  return {
    cuestionario: summary.quizId,
    preguntasJugadas: summary.askedItems,
    preguntasTotales: summary.totalItems,
    participantes: summary.participants,
    motivo: reason,
    podio: summary.ranking.slice(0, 5).map((row) => ({
      posicion: row.position,
      nombre: row.name,
      puntos: row.points,
      aciertos: row.correctCount,
    })),
  };
}

/**
 * Los puntos del `GameOutcome`.
 *
 * Es una arena: el proyector no juega, asi que no hay un puntaje propio que
 * emitir. Se emite el del ganador, que es el numero que la sala se lleva.
 */
export function triviaPoints(ranking: readonly LiveRankEntry[]): number {
  return ranking[0]?.points ?? 0;
}
