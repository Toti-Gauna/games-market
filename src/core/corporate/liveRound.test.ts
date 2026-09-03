import { describe, expect, it } from "vitest";
import type { Question } from "./question.types";
import {
  addParticipant,
  advanceLiveRound,
  answerProgress,
  awardPoints,
  closeWindowNow,
  createLiveRound,
  liveRanking,
  publicCurrentQuestion,
  streakBonus,
  submitAnswer,
  timedAnswerPoints,
  triviaScorer,
  TRIVIA_ROUND_CONFIG,
  type LiveRoundState,
} from "./liveRound";

/**
 * Estos casos NO son opcionales: son los criterios de aceptacion de
 * C1-TRIVIA-RELAMPAGO.md y de la seccion 5 de 03-BASES-CORPORATIVAS.md.
 *
 * El que mas importa es el de confianza: si el cliente pudiera influir en el
 * tiempo medido, el juego se rompe entero y en un evento real no se nota
 * hasta que alguien gana siempre.
 */

function question(id: string, correct = "a"): Question {
  return {
    id,
    kind: "single",
    prompt: `Pregunta ${id}`,
    correct,
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
      { id: "d", label: "D" },
    ],
  };
}

function round(count = 3): LiveRoundState {
  const state = createLiveRound({
    config: TRIVIA_ROUND_CONFIG,
    questions: Array.from({ length: count }, (_, i) => question(String(i))),
    scorer: triviaScorer,
  });
  return state;
}

/** Lleva la ronda hasta que la ventana este abierta, sin pasarse. */
function openWindow(state: LiveRoundState) {
  advanceLiveRound(state, TRIVIA_ROUND_CONFIG.announceMs);
  advanceLiveRound(state, TRIVIA_ROUND_CONFIG.readMs);
  expect(state.phase).toBe("respuesta");
}

describe("puntaje contra la ventana", () => {
  it("al instante da 1000 y sobre la chicharra 500", () => {
    expect(timedAnswerPoints(1000, 0, 10_000)).toBe(1000);
    expect(timedAnswerPoints(1000, 10_000, 10_000)).toBe(500);
    expect(timedAnswerPoints(1000, 5_000, 10_000)).toBe(750);
  });

  it("errar no resta nunca", () => {
    const score = triviaScorer({
      participantId: "p",
      question: question("x"),
      value: "b",
      correct: false,
      elapsedMs: 100,
      windowMs: 10_000,
      streak: 0,
      itemIndex: 0,
      pointsBefore: 0,
    });
    expect(score.base).toBe(0);
    expect(score.bonus).toBe(0);
  });
});

describe("racha", () => {
  it("suma desde el tercer acierto y topea en 500", () => {
    expect(streakBonus(1)).toBe(0);
    expect(streakBonus(2)).toBe(0);
    expect(streakBonus(3)).toBe(100);
    expect(streakBonus(4)).toBe(200);
    expect(streakBonus(7)).toBe(500);
    expect(streakBonus(40)).toBe(500);
  });
});

describe("el cliente no puede mentir el tiempo", () => {
  it("submitAnswer no acepta ningun tiempo del cliente", () => {
    const state = round();
    addParticipant(state, "p1", "Ana");
    openWindow(state);
    advanceLiveRound(state, 4000);

    // Un cliente malicioso mandaria esto. La firma no lo admite, y aunque se
    // cuele por JSON, el tiempo sale del reloj del host.
    const hostile = { participantId: "p1", value: "a", elapsedMs: 1, clientTime: 0 };
    const result = submitAnswer(state, hostile as unknown as Parameters<typeof submitAnswer>[1]);

    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      // 4 s reales, no el 1 ms que dijo el cliente.
      expect(result.elapsedMs).toBeCloseTo(4000, 0);
    }
  });

  it("el puntaje sale del reloj del host, no de lo declarado", () => {
    const state = round();
    addParticipant(state, "p1", "Ana");
    openWindow(state);
    advanceLiveRound(state, 10_000 - 1);
    submitAnswer(state, {
      participantId: "p1",
      value: "a",
      // @ts-expect-error el tipo no admite un tiempo, y este test lo fija
      elapsedMs: 0,
    });
    advanceLiveRound(state, 5000);

    // Contesto sobre la chicharra: ~500, no los 1000 que pediria mintiendo.
    const points = state.participants.get("p1")?.points ?? 0;
    expect(points).toBeGreaterThan(480);
    expect(points).toBeLessThan(520);
  });
});

describe("compensacion de latencia", () => {
  it("300 ms y 50 ms de RTT contestando igual de rapido quedan dentro del 5 %", () => {
    const state = round();
    addParticipant(state, "lento", "Lento");
    addParticipant(state, "rapido", "Rapido");
    openWindow(state);

    // Los dos apretaron a los 2 s; a uno el paquete le tardo mas en llegar.
    advanceLiveRound(state, 2000 + 150);
    submitAnswer(state, { participantId: "lento", value: "a", rttMs: 300 });
    advanceLiveRound(state, 0);
    submitAnswer(state, { participantId: "rapido", value: "a", rttMs: 50 });

    advanceLiveRound(state, 10_000);

    const slow = state.participants.get("lento")?.points ?? 0;
    const fast = state.participants.get("rapido")?.points ?? 0;
    const gap = Math.abs(slow - fast) / Math.max(slow, fast);
    expect(gap).toBeLessThan(0.05);
  });
});

describe("la ventana la maneja el host", () => {
  it("no se puede contestar durante la lectura", () => {
    const state = round();
    addParticipant(state, "p1", "Ana");
    advanceLiveRound(state, TRIVIA_ROUND_CONFIG.announceMs);
    expect(state.phase).toBe("lectura");
    expect(submitAnswer(state, { participantId: "p1", value: "a" }).status).toBe("not-open");
  });

  it("una respuesta posterior al cierre se descarta y se reporta como tardia", () => {
    const state = round();
    addParticipant(state, "p1", "Ana");
    openWindow(state);
    advanceLiveRound(state, TRIVIA_ROUND_CONFIG.answerMs + 1);
    expect(state.phase).toBe("cierre");
    expect(submitAnswer(state, { participantId: "p1", value: "a" }).status).toBe("late");
    expect(state.participants.get("p1")?.points).toBe(0);
  });

  it("no se puede contestar dos veces el mismo item", () => {
    const state = round();
    addParticipant(state, "p1", "Ana");
    openWindow(state);
    submitAnswer(state, { participantId: "p1", value: "a" });
    expect(submitAnswer(state, { participantId: "p1", value: "b" }).status).toBe("duplicate");
  });

  it("el host puede cortar la ventana antes de tiempo", () => {
    const state = round();
    addParticipant(state, "p1", "Ana");
    openWindow(state);
    submitAnswer(state, { participantId: "p1", value: "a" });
    closeWindowNow(state);
    const events = advanceLiveRound(state, 1);
    expect(events.some((e) => e.type === "closed")).toBe(true);
  });
});

describe("entrada tardia", () => {
  it("quien entra en el item 1 juega del 2 en adelante y no rompe el ranking", () => {
    const state = round(3);
    addParticipant(state, "p1", "Ana");
    openWindow(state);
    submitAnswer(state, { participantId: "p1", value: "a" });
    advanceLiveRound(state, TRIVIA_ROUND_CONFIG.answerMs + TRIVIA_ROUND_CONFIG.revealMs + 1);

    // Llega con el item 1 en curso.
    const late = addParticipant(state, "p2", "Beto");
    expect(late.fromItem).toBe(2);
    expect(state.itemIndex).toBe(1);

    openWindow(state);
    expect(submitAnswer(state, { participantId: "p2", value: "a" }).status).toBe("not-playing");
    // Y no cuenta como "falta que conteste" para el corte de la ventana.
    expect(answerProgress(state).eligible).toBe(1);

    const table = liveRanking(state);
    expect(table).toHaveLength(2);
    expect(table[0]?.participantId).toBe("p1");
  });
});

describe("la maquina de fases", () => {
  it("recorre anuncio, lectura, respuesta y cierre", () => {
    const state = round(1);
    expect(state.phase).toBe("anuncio");
    advanceLiveRound(state, TRIVIA_ROUND_CONFIG.announceMs);
    expect(state.phase).toBe("lectura");
    advanceLiveRound(state, TRIVIA_ROUND_CONFIG.readMs);
    expect(state.phase).toBe("respuesta");
    advanceLiveRound(state, TRIVIA_ROUND_CONFIG.answerMs);
    expect(state.phase).toBe("cierre");
  });

  it("un dt enorme no deja la ventana abierta ni saltea el cierre", () => {
    // Es el caso de la pestana que estuvo oculta y vuelve.
    const state = round(2);
    addParticipant(state, "p1", "Ana");
    const events = advanceLiveRound(state, 120_000);
    expect(events.some((e) => e.type === "closed")).toBe(true);
    expect(events.some((e) => e.type === "finished")).toBe(true);
    expect(state.windowOpenedAtMs).toBeNull();
    expect(state.finished).toBe(true);
  });

  it("termina despues del ultimo item", () => {
    const state = round(1);
    const events = advanceLiveRound(state, 60_000);
    expect(events.some((e) => e.type === "finished")).toBe(true);
  });
});

describe("lo que viaja al celular", () => {
  it("la pregunta publica no lleva la respuesta correcta", () => {
    const state = round(1);
    const publicQ = publicCurrentQuestion(state);
    expect(publicQ).not.toBeNull();
    expect(JSON.stringify(publicQ)).not.toContain('"correct"');
  });
});

describe("puntos fuera del cuestionario", () => {
  it("awardPoints suma sin pasar por el scorer", () => {
    const state = round(1);
    addParticipant(state, "p1", "Ana");
    awardPoints(state, "p1", 150);
    expect(state.participants.get("p1")?.points).toBe(150);
  });
});
