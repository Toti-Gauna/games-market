import { bool, num, records, type SettingsRecord, type SettingsValues } from "@/core/contract/settings";
import type { Rng } from "@/core/engine/rng";
import {
  hasOptions,
  isAnswered,
  isQuestionKind,
  shuffleOptions,
  type AnswerMap,
  type AnswerValue,
  type Question,
  type QuestionKind,
  type QuestionOption,
} from "@/core/corporate/question.types";

/**
 * Lo unico propio del formulario vivo: pasar de los registros editables del
 * panel a items del motor corporativo, y armar el `meta` que se lleva las
 * respuestas.
 *
 * No corrige nada: en modo encuesta ninguna pregunta tiene respuesta correcta.
 */

export const SURVEY_KIND_OPTIONS: ReadonlyArray<{ value: QuestionKind; label: string }> = [
  { value: "single", label: "Opción única" },
  { value: "multiple", label: "Opción múltiple" },
  { value: "scale", label: "Escala (Likert)" },
  { value: "boolean", label: "Verdadero / falso" },
  { value: "text", label: "Texto corto" },
  { value: "order", label: "Ordenar" },
];

export type SurveyDeck = {
  questions: readonly Question[];
  /** Con true, ni el meta ni la agregacion pueden decir quien respondio que. */
  anonymous: boolean;
  allowSkip: boolean;
  showOwnSummary: boolean;
};

type ParseOptions = {
  scaleMax: number;
  textMaxLength: number;
};

function text(row: SettingsRecord, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

function flag(row: SettingsRecord, key: string): boolean {
  return row[key] === true;
}

function optionsOf(row: SettingsRecord): QuestionOption[] {
  const raw = row["options"];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((label): label is string => typeof label === "string" && label.trim().length > 0)
    .map((label, index) => ({ id: `o${index + 1}`, label: label.trim() }));
}

/** Cada registro del panel es una pregunta. Lo que no se puede responder, no entra. */
export function parseSurveyQuestions(
  rows: readonly SettingsRecord[],
  options: ParseOptions,
): Question[] {
  const out: Question[] = [];

  rows.forEach((row, index) => {
    const prompt = text(row, "prompt");
    const kind = row["kind"];
    if (!prompt || !isQuestionKind(kind)) return;

    const id = `q${index + 1}`;
    const required = flag(row, "required");
    const list = optionsOf(row);

    switch (kind) {
      // Una pregunta de opciones con menos de dos no se puede responder.
      case "single":
        if (list.length < 2) return;
        out.push({ kind: "single", id, prompt, required, options: list, correct: null });
        return;

      case "multiple":
        if (list.length < 2) return;
        out.push({ kind: "multiple", id, prompt, required, options: list, correct: null });
        return;

      case "order":
        if (list.length < 2) return;
        out.push({ kind: "order", id, prompt, required, options: list, correct: null });
        return;

      case "scale":
        out.push({
          kind,
          id,
          prompt,
          required,
          min: 1,
          max: Math.max(2, options.scaleMax),
          minLabel: text(row, "minLabel"),
          maxLabel: text(row, "maxLabel"),
          correct: null,
        });
        return;

      case "boolean":
        out.push({
          kind,
          id,
          prompt,
          required,
          labels: { yes: text(row, "yesLabel") || "Sí", no: text(row, "noLabel") || "No" },
          correct: null,
        });
        return;

      case "text":
        out.push({
          kind,
          id,
          prompt,
          required,
          maxLength: options.textMaxLength,
          placeholder: text(row, "minLabel"),
          correct: null,
        });
        return;
    }
  });

  return out;
}

/** Todo lo aleatorio sale del PRNG sembrado: dos personas ven lo mismo. */
export function buildSurveyDeck(values: SettingsValues, rng: Rng): SurveyDeck {
  const parsed = parseSurveyQuestions(records(values, "questions"), {
    scaleMax: num(values, "scaleMax", 5),
    textMaxLength: num(values, "textMaxLength", 40),
  });

  const ordered = bool(values, "shuffleQuestions", false) ? rng.shuffle(parsed) : parsed;
  const questions = bool(values, "shuffleOptions", true)
    ? ordered.map((question) => shuffleOptions(question, rng))
    : ordered;

  return {
    questions,
    anonymous: bool(values, "anonymous", true),
    allowSkip: bool(values, "allowSkip", true),
    showOwnSummary: bool(values, "showOwnSummary", true),
  };
}

/* ------------------------------------------------------------------ */

function serializable(value: AnswerValue): string | string[] | number | boolean | null {
  return Array.isArray(value) ? [...value] : (value as string | number | boolean | null);
}

/**
 * El `meta` del outcome: las respuestas y nada mas.
 *
 * Nunca viaja quien respondio. Prometer anonimato y no cumplirlo es peor que
 * no prometerlo, asi que el juego directamente no tiene con que romperlo.
 */
export function surveyMeta(
  questions: readonly Question[],
  answers: AnswerMap,
  anonymous: boolean,
): Record<string, unknown> {
  const collected: Record<string, string | string[] | number | boolean | null> = {};
  let answered = 0;
  let skipped = 0;

  for (const question of questions) {
    const answer = answers[question.id];
    if (!answer || answer.skipped || !isAnswered(question, answer.value)) {
      skipped += 1;
      continue;
    }
    collected[question.id] = serializable(answer.value);
    answered += 1;
  }

  return {
    answers: collected,
    answered,
    skipped,
    total: questions.length,
    anonymous,
  };
}

/** Como se lee una respuesta en la pantalla final. Etiquetas, no ids. */
export function formatAnswer(question: Question, value: AnswerValue): string {
  if (!isAnswered(question, value)) return "Sin responder";

  const labelOf = (id: string): string => {
    if (!hasOptions(question)) return id;
    return question.options.find((option) => option.id === id)?.label ?? id;
  };

  switch (question.kind) {
    case "single":
      return labelOf(String(value));
    case "multiple":
      return (value as readonly string[]).map(labelOf).join(", ");
    case "order":
      return (value as readonly string[]).map(labelOf).join(" › ");
    case "boolean":
      return value === true ? (question.labels?.yes ?? "Sí") : (question.labels?.no ?? "No");
    case "scale":
      return `${String(value)} de ${question.max}`;
    case "text":
      return String(value);
    // El formulario no arma tableros de unir pares, pero el tipo vive en el
    // motor compartido: se resume por uniones cerradas.
    case "match":
      return `${(value as readonly string[]).length} de ${question.pairs.length} pares unidos`;
  }
}

/** Indices de las que quedaron salteadas, para volver a ellas al final. */
export function pendingIndexes(questions: readonly Question[], answers: AnswerMap): number[] {
  const out: number[] = [];
  questions.forEach((question, index) => {
    const answer = answers[question.id];
    if (!answer || answer.skipped || !isAnswered(question, answer.value)) out.push(index);
  });
  return out;
}
