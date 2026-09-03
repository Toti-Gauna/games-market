import { describe, expect, it } from "vitest";
import { schemaDefaults, type SettingsRecord } from "@/core/contract/settings";
import { createRng } from "@/core/engine/rng";
import { aggregateProfile } from "@/core/corporate/scoring";
import type { Answer, AnswerMap } from "@/core/corporate/question.types";
import { profileTestSettings } from "./settings";
import {
  ARCHETYPE_IDS,
  PRIMARY_WEIGHT,
  SECONDARY_WEIGHT,
  buildProfileDeck,
  describeProfile,
  parseArchetypes,
  parseProfileQuestions,
  profileMeta,
} from "./logic";

const defaults = schemaDefaults(profileTestSettings);

function row(partial: Partial<SettingsRecord>): SettingsRecord {
  return {
    prompt: "Situación",
    a: "Opción A",
    aMain: "explorer",
    aAlt: "builder",
    b: "Opción B",
    bMain: "connector",
    bAlt: "none",
    c: "",
    cMain: "guardian",
    cAlt: "none",
    d: "",
    dMain: "strategist",
    dAlt: "none",
    ...partial,
  };
}

function answerAll(questions: readonly { id: string }[], optionId: string): AnswerMap {
  const out: AnswerMap = {};
  for (const question of questions) {
    const answer: Answer = { questionId: question.id, value: optionId, elapsedMs: 0, skipped: false };
    out[question.id] = answer;
  }
  return out;
}

describe("parseProfileQuestions", () => {
  it("convierte cada registro en un ítem de opción única sin respuesta correcta", () => {
    const questions = parseProfileQuestions([row({})]);
    expect(questions).toHaveLength(1);
    const first = questions[0];
    expect(first?.kind).toBe("single");
    expect(first?.correct).toBeNull();
    expect(first?.options).toHaveLength(2); // c y d quedaron vacías
  });

  it("reparte 3 al arquetipo fuerte y 1 al flojo", () => {
    const questions = parseProfileQuestions([row({})]);
    expect(questions[0]?.weights?.["a"]).toEqual({
      explorer: PRIMARY_WEIGHT,
      builder: SECONDARY_WEIGHT,
    });
    expect(questions[0]?.weights?.["b"]).toEqual({ connector: PRIMARY_WEIGHT });
  });

  it("descarta filas sin enunciado o con una sola salida", () => {
    expect(parseProfileQuestions([row({ prompt: "  " })])).toHaveLength(0);
    expect(parseProfileQuestions([row({ b: "" })])).toHaveLength(0);
  });

  it("lee las doce situaciones que trae el panel por defecto", () => {
    const questions = parseProfileQuestions(defaults["questions"] as SettingsRecord[]);
    expect(questions).toHaveLength(12);
    expect(questions.every((question) => question.options.length === 4)).toBe(true);
    expect(questions.every((question) => question.correct === null)).toBe(true);
  });
});

describe("parseArchetypes", () => {
  it("respeta los nombres editados", () => {
    const archetypes = parseArchetypes([
      { id: "explorer", name: "Pionera", description: "Va primero." },
    ]);
    expect(archetypes[0]).toEqual({ id: "explorer", name: "Pionera", description: "Va primero." });
  });

  it("completa los que falten para que la mezcla siga sumando 100", () => {
    const archetypes = parseArchetypes([{ id: "explorer", name: "", description: "" }]);
    expect(archetypes).toHaveLength(ARCHETYPE_IDS.length);
    expect(archetypes.map((archetype) => archetype.id).sort()).toEqual([...ARCHETYPE_IDS].sort());
  });

  it("ignora ids desconocidos y duplicados", () => {
    const archetypes = parseArchetypes([
      { id: "explorer", name: "Uno", description: "" },
      { id: "explorer", name: "Dos", description: "" },
      { id: "inventado", name: "Tres", description: "" },
    ]);
    expect(archetypes.filter((archetype) => archetype.id === "explorer")).toHaveLength(1);
    expect(archetypes.find((archetype) => archetype.id === "explorer")?.name).toBe("Uno");
  });
});

describe("buildProfileDeck", () => {
  it("sin barajar conserva el orden escrito", () => {
    const deck = buildProfileDeck(defaults, createRng("semilla"));
    expect(deck.questions.map((question) => question.id)).toEqual(
      parseProfileQuestions(defaults["questions"] as SettingsRecord[]).map((q) => q.id),
    );
  });

  it("con la misma semilla baraja siempre igual", () => {
    const values = { ...defaults, shuffleQuestions: true };
    const a = buildProfileDeck(values, createRng("abc7")).questions.map((q) => q.id);
    const b = buildProfileDeck(values, createRng("abc7")).questions.map((q) => q.id);
    const c = buildProfileDeck(values, createRng("otra")).questions.map((q) => q.id);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([...c].sort());
  });
});

/** Suma los pesos a mano, sin pasar por el motor: sirve de contraste. */
function tallyByHand(
  questions: readonly { weights?: Readonly<Record<string, Readonly<Record<string, number>>>> }[],
  optionId: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const question of questions) {
    const bucket = question.weights?.[optionId];
    if (!bucket) continue;
    for (const [dimension, amount] of Object.entries(bucket)) {
      out[dimension] = (out[dimension] ?? 0) + amount;
    }
  }
  return out;
}

describe("resultado del test", () => {
  it("el arquetipo devuelto es el que más pesos acumuló en el contenido real", () => {
    const deck = buildProfileDeck(defaults, createRng("semilla"));
    const result = aggregateProfile(
      deck.questions,
      answerAll(deck.questions, "a"),
      ARCHETYPE_IDS as unknown as string[],
    );

    const byHand = tallyByHand(deck.questions, "a");
    const expected = Object.entries(byHand).sort((x, y) => y[1] - x[1])[0]?.[0];

    expect(result.topId).toBe(expected);
    expect(result.answered).toBe(12);
    expect(result.ranking.reduce((sum, tally) => sum + tally.percent, 0)).toBe(100);
  });

  it("un test armado a mano devuelve el arquetipo verificable a ojo", () => {
    const questions = parseProfileQuestions([
      row({ prompt: "Uno" }),
      row({ prompt: "Dos" }),
      row({ prompt: "Tres" }),
    ]);
    const result = aggregateProfile(
      questions,
      answerAll(questions, "a"),
      ARCHETYPE_IDS as unknown as string[],
    );
    // Tres veces 3 a Explorador y 1 a Constructor: 9 contra 3, o sea 75 % y 25 %.
    expect(result.topId).toBe("explorer");
    expect(result.closeSecondId).toBeNull();
    expect(result.ranking[0]).toEqual({ id: "explorer", score: 9, percent: 75 });
    expect(result.ranking[1]).toEqual({ id: "builder", score: 3, percent: 25 });
  });

  it("nombra el segundo cuando quedó pegado", () => {
    const archetypes = parseArchetypes([]);
    const close = describeProfile(
      { ranking: [], topId: "explorer", closeSecondId: "builder", totalScore: 10, answered: 2 },
      archetypes,
    );
    expect(close.headline).toBe("Explorador con mucho de Constructor");

    const solo = describeProfile(
      { ranking: [], topId: "explorer", closeSecondId: null, totalScore: 10, answered: 2 },
      archetypes,
    );
    expect(solo.headline).toBe("Explorador");
  });

  it("sin respuestas no inventa un perfil", () => {
    const empty = describeProfile(
      { ranking: [], topId: null, closeSecondId: null, totalScore: 0, answered: 0 },
      parseArchetypes([]),
    );
    expect(empty.headline).toBe("Sin perfil todavía");
  });

  it("el meta lleva el perfil y la mezcla, no un puntaje", () => {
    const deck = buildProfileDeck(defaults, createRng("semilla"));
    const result = aggregateProfile(
      deck.questions,
      answerAll(deck.questions, "a"),
      ARCHETYPE_IDS as unknown as string[],
    );
    const meta = profileMeta(result, deck.archetypes, deck.questions.length);
    expect(meta["profile"]).toBe(result.topId);
    expect(typeof meta["profileName"]).toBe("string");
    expect(meta["answered"]).toBe(12);
    expect(Object.keys(meta["scores"] as Record<string, number>)).toHaveLength(5);
    expect(meta["points"]).toBeUndefined();
  });
});
