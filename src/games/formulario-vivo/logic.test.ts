import { describe, expect, it } from "vitest";
import { schemaDefaults, type SettingsRecord } from "@/core/contract/settings";
import { createRng } from "@/core/engine/rng";
import type { Answer, AnswerMap, Question } from "@/core/corporate/question.types";
import { livePollSettings } from "./settings";
import {
  buildSurveyDeck,
  formatAnswer,
  parseSurveyQuestions,
  pendingIndexes,
  surveyMeta,
} from "./logic";

const defaults = schemaDefaults(livePollSettings);
const defaultRows = defaults["questions"] as SettingsRecord[];
const PARSE = { scaleMax: 5, textMaxLength: 40 };

function answer(questionId: string, value: Answer["value"], skipped = false): Answer {
  return { questionId, value, elapsedMs: 0, skipped };
}

function map(...list: Answer[]): AnswerMap {
  const out: AnswerMap = {};
  for (const item of list) out[item.questionId] = item;
  return out;
}

function byKind(questions: readonly Question[], kind: Question["kind"]): Question | undefined {
  return questions.find((question) => question.kind === kind);
}

describe("parseSurveyQuestions", () => {
  const questions = parseSurveyQuestions(defaultRows, PARSE);

  it("la encuesta de ejemplo ejercita los seis tipos de ítem", () => {
    expect(questions).toHaveLength(6);
    expect(questions.map((question) => question.kind).sort()).toEqual(
      ["boolean", "multiple", "order", "scale", "single", "text"].sort(),
    );
  });

  it("ninguna pregunta corrige: es una encuesta, no un trivia", () => {
    expect(
      questions.every((question) => (question as { correct?: unknown }).correct === null),
    ).toBe(true);
  });

  it("arma la escala con el máximo configurado y sus etiquetas", () => {
    const scale = byKind(questions, "scale");
    expect(scale?.kind === "scale" && scale.min).toBe(1);
    expect(scale?.kind === "scale" && scale.max).toBe(5);
    expect(scale?.kind === "scale" && scale.minLabel).toBe("Nada claro");
    expect(scale?.required).toBe(true);

    const wider = parseSurveyQuestions(defaultRows, { ...PARSE, scaleMax: 7 });
    const scale7 = byKind(wider, "scale");
    expect(scale7?.kind === "scale" && scale7.max).toBe(7);
  });

  it("respeta las etiquetas del verdadero/falso y el largo del texto", () => {
    const boolean = byKind(questions, "boolean");
    expect(boolean?.kind === "boolean" && boolean.labels?.yes).toBe("Sí, se ve");

    const text = byKind(questions, "text");
    expect(text?.kind === "text" && text.maxLength).toBe(40);
  });

  it("numera las opciones y conserva las etiquetas escritas", () => {
    const single = byKind(questions, "single");
    expect(single?.kind === "single" && single.options.map((option) => option.id)).toEqual([
      "o1",
      "o2",
      "o3",
      "o4",
    ]);
    expect(single?.kind === "single" && single.options[0]?.label).toBe("El tiempo");
  });

  it("descarta filas sin enunciado, con tipo inválido o sin opciones suficientes", () => {
    expect(parseSurveyQuestions([{ kind: "single", prompt: "", options: ["a", "b"] }], PARSE)).toHaveLength(0);
    expect(parseSurveyQuestions([{ kind: "raro", prompt: "Hola", options: [] }], PARSE)).toHaveLength(0);
    expect(parseSurveyQuestions([{ kind: "order", prompt: "Hola", options: ["solo una"] }], PARSE)).toHaveLength(0);
    // Escala, texto y booleana no necesitan opciones.
    expect(parseSurveyQuestions([{ kind: "scale", prompt: "Hola" }], PARSE)).toHaveLength(1);
  });
});

describe("buildSurveyDeck", () => {
  it("con la misma semilla baraja las opciones igual", () => {
    const a = buildSurveyDeck(defaults, createRng("abc7")).questions;
    const b = buildSurveyDeck(defaults, createRng("abc7")).questions;
    const idsOf = (questions: readonly Question[]) =>
      questions.map((question) =>
        "options" in question ? question.options.map((option) => option.id).join("") : question.kind,
      );
    expect(idsOf(a)).toEqual(idsOf(b));
  });

  it("sin barajar respeta el orden escrito de opciones y preguntas", () => {
    const deck = buildSurveyDeck({ ...defaults, shuffleOptions: false }, createRng("abc7"));
    const single = byKind(deck.questions, "single");
    expect(single?.kind === "single" && single.options.map((option) => option.label)[0]).toBe(
      "El tiempo",
    );
    expect(deck.questions.map((question) => question.id)).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
      "q5",
      "q6",
    ]);
  });

  it("barajar preguntas conserva el conjunto completo", () => {
    const deck = buildSurveyDeck({ ...defaults, shuffleQuestions: true }, createRng("abc7"));
    expect([...deck.questions.map((question) => question.id)].sort()).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
      "q5",
      "q6",
    ]);
  });

  it("lee los administrables de privacidad", () => {
    const deck = buildSurveyDeck(defaults, createRng("abc7"));
    expect(deck.anonymous).toBe(true);
    expect(deck.allowSkip).toBe(true);
  });
});

describe("surveyMeta", () => {
  const questions = parseSurveyQuestions(defaultRows, PARSE);

  it("lleva las respuestas y cuenta contestadas y salteadas", () => {
    const meta = surveyMeta(
      questions,
      map(answer("q1", 4), answer("q2", "o1"), answer("q6", "tiempo")),
      true,
    );
    expect(meta["answered"]).toBe(3);
    expect(meta["skipped"]).toBe(3);
    expect(meta["total"]).toBe(6);
    expect(meta["answers"]).toEqual({ q1: 4, q2: "o1", q6: "tiempo" });
  });

  it("una salteada explícita no entra en las respuestas", () => {
    const meta = surveyMeta(questions, map(answer("q2", "o1", true)), true);
    expect(meta["answers"]).toEqual({});
    expect(meta["skipped"]).toBe(6);
  });

  it("no hay forma de saber quién respondió: el meta solo tiene respuestas", () => {
    const meta = surveyMeta(questions, map(answer("q1", 3)), true);
    expect(Object.keys(meta).sort()).toEqual([
      "anonymous",
      "answered",
      "answers",
      "skipped",
      "total",
    ]);
    expect(JSON.stringify(meta)).not.toContain("participant");
  });

  it("copia los arrays en vez de compartir la referencia", () => {
    const chosen = ["o1", "o3"];
    const meta = surveyMeta(questions, map(answer("q3", chosen)), false);
    const stored = (meta["answers"] as Record<string, unknown>)["q3"] as string[];
    expect(stored).toEqual(chosen);
    expect(stored).not.toBe(chosen);
    expect(meta["anonymous"]).toBe(false);
  });
});

describe("formatAnswer", () => {
  const questions = parseSurveyQuestions(defaultRows, PARSE);

  it("muestra etiquetas, nunca ids", () => {
    const single = byKind(questions, "single");
    const multiple = byKind(questions, "multiple");
    const order = byKind(questions, "order");
    const boolean = byKind(questions, "boolean");
    const scale = byKind(questions, "scale");

    expect(single && formatAnswer(single, "o1")).toBe("El tiempo");
    expect(multiple && formatAnswer(multiple, ["o1", "o2"])).toBe("Definir prioridades, Herramientas");
    expect(order && formatAnswer(order, ["o2", "o1", "o3", "o4", "o5"])).toBe(
      "Velocidad › Calidad › Aprendizaje › Clima de equipo › Alcance",
    );
    expect(boolean && formatAnswer(boolean, true)).toBe("Sí, se ve");
    expect(scale && formatAnswer(scale, 4)).toBe("4 de 5");
  });

  it("una respuesta vacía se lee como sin responder", () => {
    const text = byKind(questions, "text");
    expect(text && formatAnswer(text, "   ")).toBe("Sin responder");
  });
});

describe("pendingIndexes", () => {
  const questions = parseSurveyQuestions(defaultRows, PARSE);

  it("devuelve las posiciones que quedaron sin responder", () => {
    const pending = pendingIndexes(questions, map(answer("q1", 4), answer("q3", ["o1"])));
    expect(pending).toEqual([1, 3, 4, 5]);
  });

  it("con todo respondido no queda nada pendiente", () => {
    const all = map(
      answer("q1", 4),
      answer("q2", "o1"),
      answer("q3", ["o1"]),
      answer("q4", false),
      answer("q5", ["o1", "o2", "o3", "o4", "o5"]),
      answer("q6", "claridad"),
    );
    expect(pendingIndexes(questions, all)).toEqual([]);
  });
});
