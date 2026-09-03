import { describe, expect, it } from "vitest";
import { records, schemaDefaults, type SettingsRecord } from "@/core/contract/settings";
import { createRng } from "@/core/engine/rng";
import type { Question } from "@/core/corporate/question.types";
import { TRIVIA_QUIZZES, TRIVIA_QUIZ_IDS } from "./content";
import { triviaSettings } from "./settings";
import {
  OPTION_KEYS,
  OPTION_SHAPES,
  buildTriviaDeck,
  parseTriviaQuestions,
  personalNotice,
  roomSummary,
  toControlOptions,
} from "./logic";

/**
 * Dos cosas se testean aca y ninguna es la maquina de fases, que ya tiene sus
 * propios casos en `core/corporate/liveRound.test.ts`:
 *
 * 1. El contenido cumple las reglas de escritura de C1. La spec pide que sea
 *    verificable con un test, y lo es: un enunciado de 130 caracteres no se
 *    lee desde el fondo de la sala y eso no se descubre en el evento.
 * 2. El barajado es determinista. Con la misma semilla toda la sala ve el
 *    mismo orden, que es lo unico que hace comparables dos puntajes.
 */

const MAX_PROMPT = 120;
const MAX_OPTION = 40;

const defaults = schemaDefaults(triviaSettings);

function row(partial: Partial<SettingsRecord> = {}): SettingsRecord {
  return {
    prompt: "¿Cuál es la correcta?",
    a: "Primera",
    b: "Segunda",
    c: "Tercera",
    d: "Cuarta",
    correct: "b",
    explanation: "Porque sí.",
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Reglas de escritura del contenido                                    */
/* ------------------------------------------------------------------ */

describe("contenido de los cuatro cuestionarios", () => {
  it("trae los cuatro cuestionarios de la spec con diez preguntas cada uno", () => {
    expect(TRIVIA_QUIZZES.map((quiz) => quiz.id)).toEqual([...TRIVIA_QUIZ_IDS]);
    for (const quiz of TRIVIA_QUIZZES) {
      expect(quiz.questions).toHaveLength(10);
    }
  });

  it("ningún enunciado llega a 120 caracteres", () => {
    for (const quiz of TRIVIA_QUIZZES) {
      for (const question of quiz.questions) {
        expect(
          question.prompt.length,
          `${quiz.id}/${question.id}: "${question.prompt}"`,
        ).toBeLessThan(MAX_PROMPT);
      }
    }
  });

  it("ninguna opción llega a 40 caracteres", () => {
    for (const quiz of TRIVIA_QUIZZES) {
      for (const question of quiz.questions) {
        expect(question.options).toHaveLength(4);
        for (const option of question.options) {
          expect(option.length, `${quiz.id}/${question.id}: "${option}"`).toBeLessThan(MAX_OPTION);
          expect(option.trim()).not.toBe("");
        }
      }
    }
  });

  it("toda pregunta tiene explicación de una línea, que es donde el juego enseña", () => {
    for (const quiz of TRIVIA_QUIZZES) {
      for (const question of quiz.questions) {
        expect(question.explanation.trim(), `${quiz.id}/${question.id}`).not.toBe("");
        expect(question.explanation).not.toContain("\n");
        expect(question.explanation.length).toBeLessThan(MAX_PROMPT);
      }
    }
  });

  it("la correcta apunta a una opción existente y las cuatro son distintas", () => {
    for (const quiz of TRIVIA_QUIZZES) {
      for (const question of quiz.questions) {
        expect(question.correct).toBeGreaterThanOrEqual(0);
        expect(question.correct).toBeLessThan(question.options.length);
        expect(new Set(question.options).size).toBe(question.options.length);
      }
    }
  });

  it("los ids de pregunta no se repiten dentro de un cuestionario", () => {
    for (const quiz of TRIVIA_QUIZZES) {
      const ids = quiz.questions.map((question) => question.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Lo mismo, pero sobre lo que realmente llega al juego                 */
/* ------------------------------------------------------------------ */

describe("defaults del panel", () => {
  it("publica un campo de registros por cuestionario y respeta los límites", () => {
    for (const quizId of TRIVIA_QUIZ_IDS) {
      const rows = records(defaults, quizId);
      expect(rows, quizId).toHaveLength(10);

      for (const current of rows) {
        expect(String(current["prompt"]).length).toBeLessThan(MAX_PROMPT);
        expect(String(current["explanation"]).trim()).not.toBe("");
        for (const key of OPTION_KEYS) {
          expect(String(current[key]).length).toBeLessThan(MAX_OPTION);
        }
        expect(OPTION_KEYS).toContain(current["correct"]);
      }
    }
  });

  it("los defaults arman un cuestionario jugable", () => {
    const deck = buildTriviaDeck(defaults, createRng("semilla"));
    expect(deck.quizId).toBe("cultura");
    expect(deck.questions).toHaveLength(10);
    expect(deck.round.answerMs).toBe(10_000);
    expect(deck.round.readMs).toBe(3000);
    expect(deck.round.rankingEvery).toBe(5);

    for (const question of deck.questions) {
      expect(question.correct).toBeTruthy();
      expect(deck.explanations.get(question.id)).toBeTruthy();
      expect(question.options.some((option) => option.id === question.correct)).toBe(true);
    }
  });

  it("los ids de opción no se repiten en todo el cuestionario", () => {
    // Es lo que hace que el telefono limpie la eleccion anterior al cambiar de
    // pregunta: `GamepadController` se da cuenta por los ids.
    const deck = buildTriviaDeck(defaults, createRng("semilla"));
    const ids = deck.questions.flatMap((question) => question.options.map((option) => option.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ------------------------------------------------------------------ */
/* Armado desde los administrables                                      */
/* ------------------------------------------------------------------ */

describe("parseTriviaQuestions", () => {
  it("convierte cada fila en una pregunta de opción única", () => {
    const parsed = parseTriviaQuestions([row()]);
    expect(parsed.questions).toHaveLength(1);
    const question = parsed.questions[0];
    expect(question?.kind).toBe("single");
    expect(question?.options).toHaveLength(4);
    expect(question?.correct).toBe("q1b");
  });

  it("guarda la explicación afuera de la pregunta, para que no viaje al celular", () => {
    const parsed = parseTriviaQuestions([row({ explanation: "La razón" })]);
    const question = parsed.questions[0];
    expect(parsed.explanations.get("q1")).toBe("La razón");
    expect(question && "help" in question).toBe(false);
  });

  it("descarta filas sin enunciado, con una sola opción o sin correcta válida", () => {
    expect(parseTriviaQuestions([row({ prompt: "   " })]).questions).toHaveLength(0);
    expect(
      parseTriviaQuestions([row({ b: "", c: "", d: "", correct: "a" })]).questions,
    ).toHaveLength(0);
    // La correcta apunta a una opcion vacia: nadie podria acertarla.
    expect(parseTriviaQuestions([row({ d: "", correct: "d" })]).questions).toHaveLength(0);
  });
});

describe("buildTriviaDeck", () => {
  it("respeta el cuestionario elegido", () => {
    const deck = buildTriviaDeck({ ...defaults, quiz: "seguridad" }, createRng("s"));
    expect(deck.quizId).toBe("seguridad");
    expect(deck.questions[0]?.prompt).toBeTruthy();
    expect(deck.title).toBe("Seguridad de la información");
  });

  it("traduce ventana, lectura y ranking a la configuración de la ronda", () => {
    const deck = buildTriviaDeck(
      { ...defaults, answerSec: 20, readSec: 0, rankingEvery: 0 },
      createRng("s"),
    );
    expect(deck.round.answerMs).toBe(20_000);
    expect(deck.round.readMs).toBe(0);
    expect(deck.round.rankingEvery).toBe(0);
    // El anuncio y el cierre no son administrables: los fija el ritmo de C1.
    expect(deck.round.announceMs).toBe(2000);
    expect(deck.round.revealMs).toBe(3000);
  });

  it("apaga la racha sin tocar la fórmula del ítem", () => {
    const question = parseTriviaQuestions([row()]).questions[0] as Question;
    const input = {
      participantId: "s1",
      question,
      value: "q1b",
      correct: true,
      elapsedMs: 0,
      windowMs: 10_000,
      streak: 5,
      itemIndex: 4,
      pointsBefore: 0,
    };

    const withStreak = buildTriviaDeck(defaults, createRng("s")).scorer(input);
    const without = buildTriviaDeck({ ...defaults, streak: false }, createRng("s")).scorer(input);

    expect(withStreak.base).toBe(1000);
    expect(withStreak.bonus).toBe(300);
    expect(without.base).toBe(1000);
    expect(without.bonus).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Determinismo                                                         */
/* ------------------------------------------------------------------ */

function fingerprint(values = defaults, seed = "abc7"): string {
  const deck = buildTriviaDeck({ ...values, shuffleQuestions: true }, createRng(seed));
  return deck.questions
    .map((question) => `${question.id}:${question.options.map((o) => o.id).join(",")}`)
    .join("|");
}

describe("barajado sembrado", () => {
  it("la misma semilla da exactamente el mismo orden de preguntas y opciones", () => {
    expect(fingerprint()).toBe(fingerprint());
  });

  it("semillas distintas dan órdenes distintos", () => {
    const seeds = ["abc7", "def8", "ghi9", "jkl1"];
    const prints = new Set(seeds.map((seed) => fingerprint(defaults, seed)));
    expect(prints.size).toBeGreaterThan(1);
  });

  it("barajar las opciones no despega la correcta de su texto", () => {
    const plain = buildTriviaDeck({ ...defaults, shuffleOptions: false }, createRng("x"));
    const mixed = buildTriviaDeck({ ...defaults, shuffleOptions: true }, createRng("x"));

    for (const question of plain.questions) {
      const twin = mixed.questions.find((candidate) => candidate.id === question.id);
      const before = question.options.find((option) => option.id === question.correct);
      const after = twin?.options.find((option) => option.id === twin.correct);
      expect(after?.label).toBe(before?.label);
    }
  });

  it("sin barajar, el orden es el que escribió quien redactó el cuestionario", () => {
    const deck = buildTriviaDeck(
      { ...defaults, shuffleQuestions: false, shuffleOptions: false },
      createRng("x"),
    );
    const first = TRIVIA_QUIZZES[0]?.questions[0];
    expect(deck.questions[0]?.prompt).toBe(first?.prompt);
    expect(deck.questions[0]?.options[0]?.label).toBe(first?.options[0]);
  });
});

/* ------------------------------------------------------------------ */
/* Lo que se le manda al telefono                                       */
/* ------------------------------------------------------------------ */

describe("toControlOptions", () => {
  const question = parseTriviaQuestions([row()]).questions[0];

  it("no revela la correcta mientras la ventana está abierta", () => {
    const options = toControlOptions(question as never, null);
    expect(options.map((option) => option.label)).toEqual([
      "Primera",
      "Segunda",
      "Tercera",
      "Cuarta",
    ]);
    expect(options.some((option) => option.label.includes("✓"))).toBe(false);
  });

  it("al cerrar marca la correcta con un signo, no sólo con color", () => {
    const options = toControlOptions(question as never, "q1b");
    expect(options[1]?.label).toBe("✓ Segunda");
    expect(options[0]?.label).toBe("Primera");
  });

  it("reparte una forma distinta por posición, para que se distingan en gris", () => {
    const options = toControlOptions(question as never, null);
    expect(options.map((option) => option.shape)).toEqual([...OPTION_SHAPES]);
    expect(new Set(options.map((option) => option.shape)).size).toBe(4);
  });
});

describe("roomSummary", () => {
  const base = { correctCount: 12, answeredCount: 30, bestPoints: 980, lateCount: 0 };

  it("cuenta cuántos acertaron y cuánto pagó lo mejor", () => {
    expect(roomSummary(base)).toBe("12 de 30 acertaron · lo mejor pagó 980");
  });

  it("avisa de las que llegaron después del cierre en vez de esconderlas", () => {
    expect(roomSummary({ ...base, lateCount: 1 })).toContain("1 llegó después del cierre");
    expect(roomSummary({ ...base, lateCount: 3 })).toContain("3 llegaron después del cierre");
  });

  it("no habla de puntos cuando nadie acertó", () => {
    expect(roomSummary({ ...base, correctCount: 0, bestPoints: 0 })).toBe("0 de 30 acertaron");
  });

  it("nunca nombra a nadie: es la línea de la sala, no la de una persona", () => {
    expect(roomSummary({ ...base, lateCount: 2 })).not.toContain("vos");
  });
});

describe("personalNotice", () => {
  const base = {
    points: 840,
    bonus: 0,
    correctLabel: "Segunda",
    position: 3,
    total: 24,
  } as const;

  it("al acertar dice los puntos y la posición", () => {
    expect(personalNotice({ ...base, status: "correct" })).toBe("Acertaste · +840 · vas 3º de 24");
  });

  it("nombra la racha aparte, porque no salió de contestar rápido", () => {
    expect(personalNotice({ ...base, status: "correct", points: 1040, bonus: 200 })).toBe(
      "Acertaste · +1040 (racha +200) · vas 3º de 24",
    );
  });

  it("al errar dice cuál era y no habla de puntos: errar no resta", () => {
    const notice = personalNotice({ ...base, status: "wrong", points: 0 });
    expect(notice).toBe("Erraste · la correcta era Segunda · vas 3º de 24");
    expect(notice).not.toContain("-");
  });

  it("distingue no haber contestado de haber llegado tarde", () => {
    expect(personalNotice({ ...base, status: "missed", points: 0 })).toContain(
      "No llegaste a contestar",
    );
    expect(personalNotice({ ...base, status: "late", points: 0 })).toContain(
      "Llegaste después del cierre",
    );
  });

  it("omite la posición mientras no haya tabla", () => {
    expect(personalNotice({ ...base, status: "correct", position: 0 })).toBe("Acertaste · +840");
  });
});
