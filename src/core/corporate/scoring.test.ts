import { describe, expect, it } from "vitest";
import {
  aggregateProfile,
  isCorrect,
  scoreQuestion,
  scoreQuestions,
  speedBonusPoints,
} from "./scoring";
import type {
  Answer,
  AnswerMap,
  BooleanQuestion,
  MultipleQuestion,
  OrderQuestion,
  Question,
  ScaleQuestion,
  SingleQuestion,
  TextQuestion,
} from "./question.types";

function answer(questionId: string, value: Answer["value"], elapsedMs = 0, skipped = false): Answer {
  return { questionId, value, elapsedMs, skipped };
}

function map(...list: Answer[]): AnswerMap {
  const out: AnswerMap = {};
  for (const item of list) out[item.questionId] = item;
  return out;
}

const single: SingleQuestion = {
  kind: "single",
  id: "q1",
  prompt: "¿Cuál es la capital?",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ],
  correct: "b",
  points: 100,
  timeLimitMs: 10_000,
};

const multiple: MultipleQuestion = {
  kind: "multiple",
  id: "q2",
  prompt: "Elegí dos",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
  correct: ["a", "c"],
};

const boolQuestion: BooleanQuestion = {
  kind: "boolean",
  id: "q3",
  prompt: "¿Verdadero?",
  correct: true,
};

const scale: ScaleQuestion = {
  kind: "scale",
  id: "q4",
  prompt: "Del 1 al 5",
  min: 1,
  max: 5,
  correct: 4,
};

const text: TextQuestion = {
  kind: "text",
  id: "q5",
  prompt: "Una palabra",
  correct: ["Colaboración"],
};

const order: OrderQuestion = {
  kind: "order",
  id: "q6",
  prompt: "Ordená",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
  correct: ["c", "a", "b"],
};

const survey: SingleQuestion = {
  kind: "single",
  id: "s1",
  prompt: "Sin correcta",
  options: [{ id: "a", label: "A" }],
  correct: null,
};

describe("isCorrect", () => {
  it("corrige opción única", () => {
    expect(isCorrect(single, "b")).toBe(true);
    expect(isCorrect(single, "a")).toBe(false);
  });

  it("corrige múltiple sin importar el orden y exige el conjunto exacto", () => {
    expect(isCorrect(multiple, ["c", "a"])).toBe(true);
    expect(isCorrect(multiple, ["a"])).toBe(false);
    expect(isCorrect(multiple, ["a", "b", "c"])).toBe(false);
  });

  it("corrige verdadero/falso y escala", () => {
    expect(isCorrect(boolQuestion, true)).toBe(true);
    expect(isCorrect(boolQuestion, false)).toBe(false);
    expect(isCorrect(scale, 4)).toBe(true);
    expect(isCorrect(scale, 3)).toBe(false);
  });

  it("corrige texto sin acentos ni mayúsculas", () => {
    expect(isCorrect(text, "  colaboracion ")).toBe(true);
    expect(isCorrect(text, "COLABORACIÓN")).toBe(true);
    expect(isCorrect(text, "cooperación")).toBe(false);
  });

  it("corrige orden exacto", () => {
    expect(isCorrect(order, ["c", "a", "b"])).toBe(true);
    expect(isCorrect(order, ["a", "c", "b"])).toBe(false);
  });

  it("devuelve null cuando la pregunta no corrige", () => {
    expect(isCorrect(survey, "a")).toBeNull();
  });

  it("una respuesta vacía nunca es correcta", () => {
    expect(isCorrect(single, null)).toBe(false);
    expect(isCorrect(text, "   ")).toBe(false);
  });
});

describe("speedBonusPoints", () => {
  it("da hasta el 50 % de la base con el tiempo entero disponible", () => {
    expect(speedBonusPoints(100, 0, 10_000)).toBe(50);
  });

  it("decrece proporcionalmente al tiempo usado", () => {
    expect(speedBonusPoints(100, 5_000, 10_000)).toBe(25);
    expect(speedBonusPoints(100, 8_000, 10_000)).toBe(10);
  });

  it("no da bono sin límite de tiempo ni con el tiempo agotado", () => {
    expect(speedBonusPoints(100, 1_000, null)).toBe(0);
    expect(speedBonusPoints(100, 12_000, 10_000)).toBe(0);
  });
});

describe("scoreQuestion", () => {
  it("suma base más bono cuando acierta rápido", () => {
    const score = scoreQuestion(single, answer("q1", "b", 2_000));
    expect(score.base).toBe(100);
    expect(score.bonus).toBe(40);
    expect(score.points).toBe(140);
  });

  it("no puntúa un error, aunque conteste al instante", () => {
    expect(scoreQuestion(single, answer("q1", "a", 0)).points).toBe(0);
  });

  it("no puntúa una salteada", () => {
    expect(scoreQuestion(single, answer("q1", "b", 0, true)).points).toBe(0);
  });

  it("permite apagar el bono por velocidad", () => {
    expect(scoreQuestion(single, answer("q1", "b", 0), { speedBonus: false }).points).toBe(100);
  });

  it("con las mismas respuestas y tiempos da siempre el mismo puntaje", () => {
    const a = scoreQuestion(single, answer("q1", "b", 3_210));
    const b = scoreQuestion(single, answer("q1", "b", 3_210));
    expect(a.points).toBe(b.points);
  });
});

describe("scoreQuestions", () => {
  const questions: Question[] = [single, multiple, boolQuestion];

  it("agrega puntos, aciertos y contestadas", () => {
    const result = scoreQuestions(
      questions,
      map(answer("q1", "b", 5_000), answer("q2", ["a", "c"]), answer("q3", false)),
    );
    expect(result.total).toBe(3);
    expect(result.answered).toBe(3);
    expect(result.correct).toBe(2);
    expect(result.points).toBe(100 + 25 + 100);
  });

  it("una pregunta sin responder no suma ni rompe", () => {
    const result = scoreQuestions(questions, map(answer("q1", "b", 0)));
    expect(result.answered).toBe(1);
    expect(result.correct).toBe(1);
    expect(result.perQuestion).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ */

const DIMENSIONS = ["explorer", "builder", "connector", "guardian", "strategist"];

function profileQuestion(id: string): SingleQuestion {
  return {
    kind: "single",
    id,
    prompt: `Situación ${id}`,
    correct: null,
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
      { id: "d", label: "D" },
    ],
    weights: {
      a: { explorer: 3, builder: 1 },
      b: { connector: 3, strategist: 1 },
      c: { guardian: 3, strategist: 1 },
      d: { strategist: 3, builder: 1 },
    },
  };
}

describe("aggregateProfile", () => {
  it("devuelve el arquetipo que más pesos acumuló", () => {
    const questions = [profileQuestion("p1"), profileQuestion("p2"), profileQuestion("p3")];
    const result = aggregateProfile(
      questions,
      map(answer("p1", "a"), answer("p2", "a"), answer("p3", "d")),
      DIMENSIONS,
    );
    expect(result.topId).toBe("explorer");
    expect(result.answered).toBe(3);
    // explorer 6, builder 2+1=3, strategist 3 -> total 12
    expect(result.totalScore).toBe(12);
  });

  it("devuelve la mezcla completa y los porcentajes suman 100", () => {
    const questions = [profileQuestion("p1"), profileQuestion("p2"), profileQuestion("p3")];
    const result = aggregateProfile(
      questions,
      map(answer("p1", "a"), answer("p2", "b"), answer("p3", "c")),
      DIMENSIONS,
    );
    expect(result.ranking).toHaveLength(DIMENSIONS.length);
    expect(result.ranking.reduce((sum, row) => sum + row.percent, 0)).toBe(100);
  });

  it("marca el segundo cuando está dentro de los 5 puntos", () => {
    const question: SingleQuestion = {
      kind: "single",
      id: "p1",
      prompt: "x",
      correct: null,
      options: [{ id: "a", label: "A" }],
      weights: { a: { explorer: 51, builder: 49 } },
    };
    const result = aggregateProfile([question], map(answer("p1", "a")), DIMENSIONS);
    expect(result.topId).toBe("explorer");
    expect(result.closeSecondId).toBe("builder");
  });

  it("no marca el segundo cuando la diferencia es grande", () => {
    const question: SingleQuestion = {
      kind: "single",
      id: "p1",
      prompt: "x",
      correct: null,
      options: [{ id: "a", label: "A" }],
      weights: { a: { explorer: 90, builder: 10 } },
    };
    expect(aggregateProfile([question], map(answer("p1", "a")), DIMENSIONS).closeSecondId).toBeNull();
  });

  it("resuelve el empate por el orden declarado, no al azar", () => {
    const question: SingleQuestion = {
      kind: "single",
      id: "p1",
      prompt: "x",
      correct: null,
      options: [{ id: "a", label: "A" }],
      weights: { a: { builder: 5, explorer: 5 } },
    };
    const result = aggregateProfile([question], map(answer("p1", "a")), DIMENSIONS);
    expect(result.topId).toBe("explorer");
    expect(result.closeSecondId).toBe("builder");
  });

  it("sin respuestas no inventa un arquetipo", () => {
    const result = aggregateProfile([profileQuestion("p1")], {}, DIMENSIONS);
    expect(result.topId).toBeNull();
    expect(result.closeSecondId).toBeNull();
    expect(result.totalScore).toBe(0);
  });

  it("suma múltiple por opción elegida y orden por posición", () => {
    const multi: MultipleQuestion = {
      kind: "multiple",
      id: "m1",
      prompt: "x",
      correct: null,
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      weights: { a: { explorer: 2 }, b: { builder: 2 } },
    };
    const ranked: OrderQuestion = {
      kind: "order",
      id: "o1",
      prompt: "x",
      correct: null,
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      weights: { a: { explorer: 2 }, b: { builder: 2 } },
    };
    const result = aggregateProfile(
      [multi, ranked],
      map(answer("m1", ["a", "b"]), answer("o1", ["b", "a"])),
      DIMENSIONS,
    );
    // multiple: explorer 2, builder 2. order: builder 2 x 1, explorer 2 x 0.5.
    const explorer = result.ranking.find((row) => row.id === "explorer");
    const builder = result.ranking.find((row) => row.id === "builder");
    expect(explorer?.score).toBe(3);
    expect(builder?.score).toBe(4);
    expect(result.topId).toBe("builder");
  });

  it("ignora las salteadas", () => {
    const questions = [profileQuestion("p1"), profileQuestion("p2")];
    const result = aggregateProfile(
      questions,
      map(answer("p1", "a"), answer("p2", "c", 0, true)),
      DIMENSIONS,
    );
    expect(result.answered).toBe(1);
    expect(result.totalScore).toBe(4);
  });
});
