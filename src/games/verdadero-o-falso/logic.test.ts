import { describe, expect, it } from "vitest";
import type { SettingsValues } from "@/core/contract/settings";
import { schemaDefaults } from "@/core/contract/settings";
import { createRng } from "@/core/engine/rng";
import {
  addParticipant,
  advanceLiveRound,
  awardPoints,
  createLiveRound,
  submitAnswer,
  survivalScorer,
  SURVIVAL_ROUND_CONFIG,
  type LiveRoundConfig,
  type LiveRoundState,
} from "@/core/corporate/liveRound";
import {
  DECKS,
  DECK_IDS,
  MAX_EXPLAIN_LENGTH,
  MAX_SAME_ANSWER_RUN,
  MAX_STATEMENT_LENGTH,
  type Statement,
} from "./content";
import { verdaderoOFalsoSettings } from "./settings";
import {
  buildRound,
  closeSurvivalItem,
  controlSpecFor,
  createSurvivalState,
  finishSurvival,
  honorRanking,
  joinSurvival,
  NOTICE_ELIMINATED,
  NOTICE_LATE,
  NOTICE_REVIVE,
  optionsFor,
  orderStatements,
  parsePick,
  survivorRanking,
  toQuestion,
  verdictsFrom,
  type ItemVerdict,
  type PhoneView,
  type SurvivalRules,
  type SurvivalState,
} from "./logic";

/**
 * Estos casos son los criterios de aceptacion de C6-VERDADERO-O-FALSO.md.
 *
 * Los dos primeros bloques miran el CONTENIDO, no el codigo: en este juego las
 * reglas de escritura son parte de la mecanica. Una afirmacion de 140
 * caracteres con una ventana de 5 s no es una pregunta dificil, es una
 * pregunta injusta, y eso no se ve en un typecheck.
 */

/* ------------------------------------------------------------------ */

function runsOf(answers: readonly boolean[]): number {
  let longest = 1;
  let run = 1;
  for (let i = 1; i < answers.length; i++) {
    run = answers[i] === answers[i - 1] ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  return answers.length === 0 ? 0 : longest;
}

describe("reglas de escritura del contenido", () => {
  it("ninguna afirmación pasa de 90 caracteres", () => {
    for (const deckId of DECK_IDS) {
      for (const statement of DECKS[deckId].statements) {
        expect(
          statement.text.length,
          `${deckId} · ${statement.id}: ${statement.text.length} caracteres`,
        ).toBeLessThanOrEqual(MAX_STATEMENT_LENGTH);
      }
    }
  });

  it("toda afirmación tiene explicación de una línea", () => {
    for (const deckId of DECK_IDS) {
      for (const statement of DECKS[deckId].statements) {
        expect(statement.explain.trim(), `${deckId} · ${statement.id}`).not.toBe("");
        expect(statement.explain.length).toBeLessThanOrEqual(MAX_EXPLAIN_LENGTH);
        expect(statement.explain).not.toContain("\n");
      }
    }
  });

  it("cada juego reparte parejo y no deja tres seguidas iguales", () => {
    for (const deckId of DECK_IDS) {
      const answers = DECKS[deckId].statements.map((statement) => statement.answer);
      const trues = answers.filter(Boolean).length;
      // Parejo de verdad: con diez afirmaciones, cinco y cinco.
      expect(Math.abs(trues * 2 - answers.length), `${deckId}: ${trues} verdaderas`).toBeLessThanOrEqual(1);
      expect(runsOf(answers), `${deckId}: tirada de ${runsOf(answers)}`).toBeLessThanOrEqual(
        MAX_SAME_ANSWER_RUN,
      );
    }
  });

  it("los cuatro juegos tienen diez afirmaciones y ningún id repetido", () => {
    const seen = new Set<string>();
    for (const deckId of DECK_IDS) {
      const deck = DECKS[deckId];
      expect(deck.statements).toHaveLength(10);
      for (const statement of deck.statements) {
        expect(seen.has(statement.id)).toBe(false);
        seen.add(statement.id);
      }
    }
  });

  it("los administrables llegan con los cuatro juegos cargados", () => {
    const values = schemaDefaults(verdaderoOFalsoSettings);
    for (const deckId of DECK_IDS) {
      const rows = values[deckId];
      expect(Array.isArray(rows) && rows.length === 10).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("orden mezclado", () => {
  const statements = DECKS.seguridad.statements;

  it("la misma semilla da siempre el mismo orden", () => {
    const first = orderStatements(statements, createRng("abc7")).map((s) => s.id);
    const second = orderStatements(statements, createRng("abc7")).map((s) => s.id);
    expect(first).toEqual(second);
  });

  it("no pierde ni repite afirmaciones", () => {
    const ordered = orderStatements(statements, createRng("xyz1"));
    expect(ordered).toHaveLength(statements.length);
    expect(new Set(ordered.map((s) => s.id)).size).toBe(statements.length);
  });

  it("ninguna semilla deja tres respuestas iguales seguidas", () => {
    for (let seed = 0; seed < 200; seed++) {
      const ordered = orderStatements(statements, createRng(`s${seed}`));
      expect(runsOf(ordered.map((s) => s.answer)), `semilla s${seed}`).toBeLessThanOrEqual(
        MAX_SAME_ANSWER_RUN,
      );
    }
  });

  it("la ronda entera es determinista con la misma semilla", () => {
    const values = schemaDefaults(verdaderoOFalsoSettings);
    const a = buildRound(values, createRng("evento-9"));
    const b = buildRound(values, createRng("evento-9"));
    expect(a.statements.map((s) => s.text)).toEqual(b.statements.map((s) => s.text));
    expect(a.deckId).toBe(b.deckId);
  });

  it("el juego al azar sale del PRNG, no del reloj", () => {
    const values: SettingsValues = { ...schemaDefaults(verdaderoOFalsoSettings), deck: "aleatorio" };
    const a = buildRound(values, createRng("k4"));
    const b = buildRound(values, createRng("k4"));
    expect(a.deckId).toBe(b.deckId);
    expect(DECK_IDS).toContain(a.deckId);
  });
});

/* ------------------------------------------------------------------ */

const RULES: SurvivalRules = {
  mode: "supervivencia",
  reviveAt: 6,
  survivedBonus: 150,
  finisherBonus: 500,
};

function survivalWith(names: readonly string[], rules: Partial<SurvivalRules> = {}): SurvivalState {
  const state = createSurvivalState({ rules: { ...RULES, ...rules }, totalItems: 10 });
  for (const name of names) joinSurvival(state, name, name.toUpperCase());
  return state;
}

function verdicts(map: Record<string, boolean | null>, points = 200): ItemVerdict[] {
  return Object.entries(map).map(([participantId, correct]) => ({
    participantId,
    correct,
    points: correct === true ? points : 0,
  }));
}

describe("caer y seguir jugando", () => {
  it("errar saca de la carrera y no resta puntos", () => {
    const state = survivalWith(["ana", "beto"]);
    const report = closeSurvivalItem(state, 1, verdicts({ ana: true, beto: false }));

    expect(report.fell).toEqual(["beto"]);
    expect(state.entries.get("beto")?.alive).toBe(false);
    expect(state.entries.get("beto")?.fellAt).toBe(1);
    // Errar no resta: ya cuesta la eliminacion.
    expect(state.entries.get("beto")?.answerPoints).toBe(0);
    expect(report.awards).toEqual([{ participantId: "ana", points: 150, reason: "sobrevivio" }]);
  });

  it("no contestar cuenta como error", () => {
    const state = survivalWith(["ana"]);
    closeSurvivalItem(state, 1, verdicts({ ana: null }));
    expect(state.entries.get("ana")?.alive).toBe(false);
    expect(state.entries.get("ana")?.answeredCount).toBe(0);
  });

  it("el eliminado sigue sumando y entra al ranking de honor", () => {
    const state = survivalWith(["ana", "beto"], { reviveAt: 0 });
    closeSurvivalItem(state, 1, verdicts({ ana: true, beto: true }));
    closeSurvivalItem(state, 2, verdicts({ ana: true, beto: false }));
    for (let item = 3; item <= 10; item++) {
      closeSurvivalItem(state, item, verdicts({ ana: true, beto: true }));
    }

    const beto = state.entries.get("beto");
    expect(beto?.alive).toBe(false);
    expect(beto?.fellAt).toBe(2);
    // Nueve aciertos de diez: cayo en la 2 y jugo las ocho restantes.
    expect(beto?.correctCount).toBe(9);
    expect(beto?.answerPoints).toBe(1800);

    const honor = honorRanking(state);
    expect(honor.map((row) => row.participantId)).toEqual(["ana", "beto"]);
    expect(honor[1]?.points).toBe(1800);
    // El marcador real, en cambio, lo perdio.
    expect(survivorRanking(state).map((row) => row.participantId)).toEqual(["ana"]);
  });

  it("sobrevivir las diez paga el bono del final; volver por repesca no", () => {
    const state = survivalWith(["ana", "beto"]);
    for (let item = 1; item <= 10; item++) {
      const report = closeSurvivalItem(state, item, verdicts({ ana: true, beto: item !== 2 }));
      expect(report.itemNumber).toBe(item);
    }
    expect(finishSurvival(state)).toEqual([
      { participantId: "ana", points: 500, reason: "final" },
    ]);
    expect(state.entries.get("ana")?.survivedItems).toBe(10);
  });
});

describe("repesca", () => {
  it("devuelve a la carrera a quien acierta esa afirmación", () => {
    const state = survivalWith(["ana", "beto", "caro"]);
    closeSurvivalItem(state, 2, verdicts({ ana: true, beto: false, caro: false }));
    expect(state.entries.get("beto")?.alive).toBe(false);

    const report = closeSurvivalItem(state, 6, verdicts({ ana: true, beto: true, caro: false }));
    expect(report.revived).toEqual(["beto"]);
    expect(state.entries.get("beto")?.alive).toBe(true);
    expect(state.entries.get("beto")?.revivedAt).toBe(6);
    // Quien erro la repesca sigue afuera, y quien vuelve no cobra el +150 de
    // una afirmacion que no corrio estando vivo.
    expect(state.entries.get("caro")?.alive).toBe(false);
    expect(report.awards.map((award) => award.participantId)).toEqual(["ana"]);
  });

  it("sólo repesca en la afirmación configurada", () => {
    const state = survivalWith(["beto"]);
    closeSurvivalItem(state, 1, verdicts({ beto: false }));
    closeSurvivalItem(state, 5, verdicts({ beto: true }));
    expect(state.entries.get("beto")?.alive).toBe(false);
    closeSurvivalItem(state, 6, verdicts({ beto: true }));
    expect(state.entries.get("beto")?.alive).toBe(true);
  });

  it("con repesca en 0 no vuelve nadie", () => {
    const state = survivalWith(["beto"], { reviveAt: 0 });
    closeSurvivalItem(state, 1, verdicts({ beto: false }));
    closeSurvivalItem(state, 6, verdicts({ beto: true }));
    expect(state.entries.get("beto")?.alive).toBe(false);
  });
});

describe("modo puntos", () => {
  it("nadie sale de carrera y no hay bonos de supervivencia", () => {
    const state = survivalWith(["ana", "beto"], { mode: "puntos" });
    const report = closeSurvivalItem(state, 1, verdicts({ ana: true, beto: false }));
    expect(report.fell).toEqual([]);
    expect(report.awards).toEqual([]);
    expect(state.entries.get("beto")?.alive).toBe(true);
    expect(finishSurvival(state)).toEqual([]);
  });
});

describe("la caída masiva se destaca", () => {
  it("marca la afirmación en la que cae más de la mitad", () => {
    const state = survivalWith(["a", "b", "c", "d", "e"]);
    const report = closeSurvivalItem(
      state,
      3,
      verdicts({ a: true, b: false, c: false, d: false, e: true }),
    );
    expect(report.aliveBefore).toBe(5);
    expect(report.aliveAfter).toBe(2);
    expect(report.fellPct).toBe(60);
    expect(report.wipeout).toBe(true);
  });

  it("la mitad justa no es más de la mitad", () => {
    const state = survivalWith(["a", "b", "c", "d"]);
    const report = closeSurvivalItem(state, 1, verdicts({ a: true, b: true, c: false, d: false }));
    expect(report.fellPct).toBe(50);
    expect(report.wipeout).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe("lo que ve el celular", () => {
  const base: PhoneView = {
    phase: "respuesta",
    itemNumber: 3,
    totalItems: 10,
    statement: "Una planilla adjunta no puede ejecutar código.",
    eliminated: false,
    revivePending: false,
    discarded: false,
    remainingMs: 3200,
    windowMs: 5000,
  };

  it("los botones no responden durante la lectura", () => {
    const reading = controlSpecFor({ ...base, phase: "lectura" });
    expect(reading.layout).toBe("buttons");
    // Se ven durante los 2 s de lectura y no responden: sin ese margen, con
    // una ventana de 5 s, gana el reflejo y no el criterio.
    expect(reading.layout === "buttons" && reading.enabled).toBe(false);

    const answering = controlSpecFor(base);
    expect(answering.layout === "buttons" && answering.enabled).toBe(true);
  });

  it("la barra viaja con su ventana, no con una asumida", () => {
    const answering = controlSpecFor(base);
    expect(answering.layout === "buttons" && answering.remainingMs).toBe(3200);
    // Sin `windowMs` el telefono asumiria una duracion y una ventana de 5 s
    // arrancaria la barra por la mitad.
    expect(answering.layout === "buttons" && answering.windowMs).toBe(5000);

    // Durante la lectura no hay barra: el tiempo todavia no corre.
    const reading = controlSpecFor({ ...base, phase: "lectura" });
    expect(reading.layout === "buttons" && reading.remainingMs).toBeUndefined();
  });

  it("el anuncio no adelanta la afirmación", () => {
    const spec = controlSpecFor({ ...base, phase: "anuncio" });
    expect(spec.layout).toBe("wait");
  });

  it("las dos opciones se distinguen sin color", () => {
    const options = optionsFor(3);
    expect(options.map((option) => option.shape)).toEqual(["circle", "diamond"]);
    expect(options.map((option) => option.label)).toEqual(["Verdadero", "Falso"]);
  });

  it("caer no es un cartel de derrota", () => {
    const spec = controlSpecFor({ ...base, eliminated: true });
    expect(spec.layout === "buttons" && spec.notice).toBe(NOTICE_ELIMINATED);
  });

  it("la repesca se avisa antes de la afirmación", () => {
    const spec = controlSpecFor({ ...base, itemNumber: 6, eliminated: true, revivePending: true });
    expect(spec.layout === "buttons" && spec.notice).toBe(NOTICE_REVIVE);
  });

  it("llegar tarde se dice, no se esconde", () => {
    const spec = controlSpecFor({ ...base, phase: "cierre", eliminated: true, discarded: true });
    expect(spec.layout === "buttons" && spec.notice).toBe(NOTICE_LATE);
    expect(spec.layout === "buttons" && spec.enabled).toBe(false);
  });

  it("una respuesta de la afirmación anterior no cuenta en esta", () => {
    expect(parsePick("v3", 3)).toBe(true);
    expect(parsePick("f3", 3)).toBe(false);
    expect(parsePick("v2", 3)).toBeNull();
    expect(parsePick("cualquier-cosa", 3)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* La ronda entera, contra la maquina compartida                        */
/* ------------------------------------------------------------------ */

const CONFIG: LiveRoundConfig = { ...SURVIVAL_ROUND_CONFIG, answerMs: 5000 };

function liveRound(statements: readonly Statement[]): LiveRoundState {
  return createLiveRound({
    config: CONFIG,
    questions: statements.map(toQuestion),
    scorer: survivalScorer,
  });
}

/** Juega una afirmacion completa: anuncio, lectura, respuestas, cierre. */
function playItem(
  round: LiveRoundState,
  survival: SurvivalState,
  picks: Record<string, boolean | undefined>,
) {
  advanceLiveRound(round, CONFIG.announceMs);
  advanceLiveRound(round, CONFIG.readMs);
  expect(round.phase).toBe("respuesta");

  for (const [participantId, value] of Object.entries(picks)) {
    if (value === undefined) continue;
    submitAnswer(round, { participantId, value });
  }

  const itemNumber = round.itemIndex + 1;
  const events = advanceLiveRound(round, CONFIG.answerMs);
  const closed = events.find((event) => event.type === "closed");
  expect(closed).toBeDefined();
  if (closed?.type !== "closed") throw new Error("la ventana no cerró");

  const report = closeSurvivalItem(
    survival,
    itemNumber,
    verdictsFrom(round.participants.values(), round.itemIndex, closed.results),
  );
  for (const award of report.awards) awardPoints(round, award.participantId, award.points);
  advanceLiveRound(round, CONFIG.revealMs);
  return report;
}

describe("nadie deja de jugar", () => {
  it("quien cae en la 2 contesta las ocho restantes y suma", () => {
    const statements = DECKS.seguridad.statements;
    const round = liveRound(statements);
    const survival = createSurvivalState({
      rules: { ...RULES, reviveAt: 0 },
      totalItems: statements.length,
    });
    for (const id of ["ana", "beto"]) {
      addParticipant(round, id, id.toUpperCase());
      joinSurvival(survival, id, id.toUpperCase());
    }

    statements.forEach((statement, index) => {
      const item = index + 1;
      playItem(round, survival, {
        ana: statement.answer,
        // Beto se equivoca en la 2 y acierta el resto.
        beto: item === 2 ? !statement.answer : statement.answer,
      });
    });
    for (const award of finishSurvival(survival)) {
      awardPoints(round, award.participantId, award.points);
    }

    const beto = survival.entries.get("beto");
    expect(beto?.fellAt).toBe(2);
    expect(beto?.answeredCount).toBe(10);
    expect(beto?.correctCount).toBe(9);
    // 200 por acierto con la ventana recien abierta: 9 x 200.
    expect(beto?.answerPoints).toBe(1800);
    expect(honorRanking(survival).map((row) => row.participantId)).toContain("beto");

    // Ana: 2000 de aciertos + 10 x 150 por seguir viva + 500 del final.
    expect(round.participants.get("ana")?.points).toBe(4000);
    // Beto cobro un solo +150, el de la afirmacion que sobrevivio.
    expect(round.participants.get("beto")?.points).toBe(1950);
    expect(survivorRanking(survival).map((row) => row.participantId)).toEqual(["ana"]);
  });

  it("la repesca de la 6 lo devuelve a la carrera", () => {
    const statements = DECKS.mitos.statements;
    const round = liveRound(statements);
    const survival = createSurvivalState({ rules: RULES, totalItems: statements.length });
    for (const id of ["ana", "beto"]) {
      addParticipant(round, id, id.toUpperCase());
      joinSurvival(survival, id, id.toUpperCase());
    }

    statements.forEach((statement, index) => {
      const item = index + 1;
      const report = playItem(round, survival, {
        ana: statement.answer,
        beto: item === 2 ? !statement.answer : statement.answer,
      });
      if (item === 2) expect(report.fell).toEqual(["beto"]);
      if (item === 6) expect(report.revived).toEqual(["beto"]);
    });

    const beto = survival.entries.get("beto");
    expect(beto?.alive).toBe(true);
    expect(beto?.revivedAt).toBe(6);
    // Vivo al final, pero no sobrevivio las diez: el +500 no le corresponde.
    expect(finishSurvival(survival).map((award) => award.participantId)).toEqual(["ana"]);
    expect(survivorRanking(survival).map((row) => row.participantId)).toEqual(["ana", "beto"]);
  });

  it("quien entra tarde no arrastra eliminaciones de lo que no jugó", () => {
    const statements = DECKS.cultura.statements;
    const round = liveRound(statements);
    const survival = createSurvivalState({ rules: RULES, totalItems: statements.length });
    addParticipant(round, "ana", "ANA");
    joinSurvival(survival, "ana", "ANA");

    const first = statements[0];
    if (!first) throw new Error("mazo vacío");
    playItem(round, survival, { ana: first.answer });

    // Entra con la ronda empezada: juega desde la proxima.
    const late = addParticipant(round, "tarde", "TARDE");
    joinSurvival(survival, "tarde", "TARDE");
    expect(late.fromItem).toBeGreaterThan(0);

    const second = statements[1];
    if (!second) throw new Error("mazo corto");
    const report = playItem(round, survival, { ana: second.answer, tarde: second.answer });
    expect(report.fell).toEqual([]);
    expect(survival.entries.get("tarde")?.alive).toBe(true);
  });
});
