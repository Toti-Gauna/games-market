import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "@/core/engine/rng";
import {
  advanceOf,
  applyMove,
  autoMove,
  blockReasonText,
  chooseBotMove,
  createLudoState,
  currentMoves,
  entrySquare,
  finishMove,
  finishProgress,
  isSafeSquare,
  leaderSeat,
  legalCount,
  ludoPoints,
  moveHintText,
  movesFor,
  onlyLegalMove,
  passTurn,
  placeText,
  rollDie,
  tokenIndex,
  tokensAtGoal,
  trackSquareOf,
  DEFAULT_RULES,
  MAX_EXTRA_ROLLS,
  type LudoRules,
  type LudoState,
  type MoveOption,
} from "./logic";

/**
 * Las pruebas salen una a una de los criterios de aceptacion de
 * games-guide/X3-LUDO.md. Dos merecen el lugar que ocupan:
 *
 * - **El motivo de cada movimiento ilegal.** Es lo que el mando muestra en
 *   `disabledReason`, y es lo unico que ensena las reglas sin tutorial. Si el
 *   motivo se pierde, el juego sigue "funcionando" y se vuelve incomprensible.
 * - **La secuencia de dados con la misma semilla.** Es lo que hace la partida
 *   reproducible, y por lo tanto depurable.
 */

/** Un dado de laboratorio: siempre el mismo numero, para armar situaciones. */
function fixedRng(value: number): Rng {
  return {
    next: () => 0,
    range: (min) => min,
    int: () => value,
    pick: (items) => {
      const first = items[0];
      if (first === undefined) throw new Error("pick sobre una lista vacia");
      return first;
    },
    shuffle: (items) => [...items],
    chance: () => false,
  };
}

function makeState(overrides: Partial<LudoRules> = {}, firstTurn = 0): LudoState {
  const rules: LudoRules = { ...DEFAULT_RULES, ...overrides };
  return createLudoState(rules, fixedRng(firstTurn));
}

function roll(state: LudoState, value: number): number {
  return rollDie(state, fixedRng(value));
}

function place(state: LudoState, seat: number, token: number, progress: number): void {
  state.progress[tokenIndex(state.rules, seat, token)] = progress;
}

function optionOf(options: readonly MoveOption[], token: number): MoveOption {
  const option = options[token];
  if (!option) throw new Error("no hay opcion para la ficha " + token);
  return option;
}

/**
 * Una partida entera jugada sola: tira, elige con la misma prioridad que el
 * reloj y cierra la animacion. Es lo que permite comparar dos corridas de la
 * misma semilla sin montar nada.
 */
function simulate(seed: string, maxSteps = 4000) {
  const rng = createRng(seed);
  const state = createLudoState(DEFAULT_RULES, rng);
  const dice: number[] = [];
  const moved: number[] = [];

  for (let i = 0; i < maxSteps && !state.over; i++) {
    if (state.phase === "roll") {
      dice.push(rollDie(state, rng));
    } else if (state.phase === "choose") {
      const token = autoMove(state, currentMoves(state));
      moved.push(token);
      if (token < 0) passTurn(state);
      else applyMove(state, token);
    } else if (state.phase === "moving") {
      finishMove(state);
    } else {
      break;
    }
  }

  const advance = [0, 1, 2, 3].map((seat) => advanceOf(state, seat));
  return { dice, moved, advance, winner: state.winner, over: state.over, rolls: state.rolls };
}

/* ------------------------------------------------------------------ */

describe("determinismo", () => {
  it("la misma semilla da la misma secuencia de dados y el mismo ganador", () => {
    const a = simulate("ludo-7");
    const b = simulate("ludo-7");

    expect(a.dice).toEqual(b.dice);
    expect(a.moved).toEqual(b.moved);
    expect(a.advance).toEqual(b.advance);
    expect(a.winner).toBe(b.winner);
  });

  it("dos semillas distintas dan partidas distintas", () => {
    const a = simulate("ludo-7");
    const b = simulate("ludo-8");
    expect(a.dice).not.toEqual(b.dice);
  });

  it("quien arranca sale del PRNG sembrado", () => {
    const a = createLudoState(DEFAULT_RULES, createRng("arranque"));
    const b = createLudoState(DEFAULT_RULES, createRng("arranque"));
    expect(a.turn).toBe(b.turn);
    expect(a.turn).toBeGreaterThanOrEqual(0);
    expect(a.turn).toBeLessThan(DEFAULT_RULES.seats);
  });

  it("una partida jugada sola termina con un ganador, no se cuelga", () => {
    const run = simulate("ludo-final");
    expect(run.over).toBe(true);
    expect(run.winner).toBeGreaterThanOrEqual(0);
  });

  /**
   * Los tres recortes de la spec —2 fichas, 32 casillas, salir con 6 o 5— no
   * son cosmeticos: son lo que mete un parchis de 30 a 60 minutos en la
   * pantalla de 8 a 10 que tiene un tour.
   *
   * Medido sobre 40 semillas, una partida son entre 46 y 195 tiradas, mediana
   * 110. Con ~1,4 s por tirada mas la animacion, eso son 3 a 6 minutos de
   * maquina, y el resto lo pone la gente pensando. El tope de 300 es la
   * alarma: si algun cambio de reglas lo cruza, la partida ya no entra.
   */
  it("las partidas entran en el presupuesto de una pantalla de tour", () => {
    let longest = 0;
    for (let i = 0; i < 12; i++) {
      const run = simulate("presupuesto-" + i);
      expect(run.over).toBe(true);
      longest = Math.max(longest, run.rolls);
    }
    expect(longest).toBeLessThan(300);
  });

  it("el dado nunca sale fuera de rango", () => {
    const run = simulate("ludo-rango");
    for (const value of run.dice) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(DEFAULT_RULES.dieFaces);
    }
  });
});

describe("salir de casa", () => {
  it("se sale con 6 o con 5, y con ningun otro numero", () => {
    for (let die = 1; die <= 6; die++) {
      const state = makeState();
      roll(state, die);
      const option = optionOf(currentMoves(state), 0);

      if (die === 5 || die === 6) {
        expect(option.legal).toBe(true);
        expect(option.to).toBe(0);
        expect(option.reason).toBeNull();
      } else {
        expect(option.legal).toBe(false);
        expect(option.reason).toBe("needs-entry");
      }
    }
  });

  it("salir deja la ficha en la casilla de entrada del color, sin gastar el resto", () => {
    const state = makeState({}, 2);
    roll(state, 6);
    applyMove(state, 0);
    expect(state.progress[tokenIndex(state.rules, 2, 0)]).toBe(0);
    expect(trackSquareOf(state.rules, 2, 0)).toBe(entrySquare(state.rules, 2));
  });

  it("con el administrable en 'solo 6' el 5 ya no saca", () => {
    const state = makeState({ entryRolls: [6] });
    roll(state, 5);
    expect(optionOf(currentMoves(state), 0).reason).toBe("needs-entry");
    expect(blockReasonText(optionOf(currentMoves(state), 0), state.rules)).toContain("6");
  });
});

describe("cada movimiento ilegal devuelve su motivo", () => {
  it("en casa sin numero de entrada: needs-entry, con el numero en el texto", () => {
    const state = makeState();
    roll(state, 3);
    const option = optionOf(currentMoves(state), 0);
    expect(option.reason).toBe("needs-entry");
    expect(blockReasonText(option, state.rules)).toBe("en casa, necesitás 5 o 6");
  });

  it("ya en la meta: finished", () => {
    const state = makeState();
    place(state, 0, 0, finishProgress(state.rules));
    roll(state, 3);
    const option = optionOf(currentMoves(state), 0);
    expect(option.reason).toBe("finished");
    expect(blockReasonText(option, state.rules)).toBe("ya llegó a la meta");
  });

  it("se pasaria de la meta: overshoot, y dice con que numero entra justo", () => {
    const state = makeState();
    const goal = finishProgress(state.rules);
    place(state, 0, 0, goal - 2);
    roll(state, 5);
    const option = optionOf(currentMoves(state), 0);
    expect(option.reason).toBe("overshoot");
    expect(option.exact).toBe(2);
    expect(blockReasonText(option, state.rules)).toBe("te pasarías de la meta: entra justo con 2");
  });

  it("la propia ficha en el destino: own-token", () => {
    const state = makeState();
    place(state, 0, 0, 10);
    place(state, 0, 1, 7);
    roll(state, 3);
    const option = optionOf(currentMoves(state), 1);
    expect(option.reason).toBe("own-token");
    expect(blockReasonText(option, state.rules)).toBe("tu otra ficha ya está ahí");
  });

  it("la meta si admite las dos fichas: no la bloquea la propia", () => {
    const state = makeState();
    const goal = finishProgress(state.rules);
    place(state, 0, 0, goal);
    place(state, 0, 1, goal - 3);
    roll(state, 3);
    const option = optionOf(currentMoves(state), 1);
    expect(option.legal).toBe(true);
    expect(option.reachesGoal).toBe(true);
  });

  it("toda opcion ilegal trae motivo, y toda legal no lo trae", () => {
    const state = makeState();
    place(state, 0, 0, finishProgress(state.rules));
    roll(state, 4);
    for (const option of currentMoves(state)) {
      if (option.legal) expect(option.reason).toBeNull();
      else {
        expect(option.reason).not.toBeNull();
        expect(blockReasonText(option, state.rules).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("captura", () => {
  it("caer en una ficha rival la manda a casa y da tirada extra", () => {
    const state = makeState();
    place(state, 0, 0, 9);
    place(state, 1, 0, 3); // casilla absoluta 11, que no es segura
    expect(isSafeSquare(state.rules, trackSquareOf(state.rules, 1, 3))).toBe(false);

    roll(state, 2);
    const option = optionOf(currentMoves(state), 0);
    expect(option.captures).toBe(tokenIndex(state.rules, 1, 0));

    applyMove(state, 0);
    expect(state.progress[tokenIndex(state.rules, 1, 0)]).toBe(-1);
    expect(state.capturesBy[0]).toBe(1);
    expect(state.lastCaptured).toBe(tokenIndex(state.rules, 1, 0));

    finishMove(state);
    // Tirada extra: sigue el mismo, con el reloj entero de nuevo.
    expect(state.turn).toBe(0);
    expect(state.phase).toBe("roll");
    expect(state.extras).toBe(1);
    expect(state.turnMsLeft).toBe(state.rules.turnMs);
  });

  it("en las casillas seguras no se captura: conviven", () => {
    const state = makeState();
    const safe = entrySquare(state.rules, 1);
    expect(isSafeSquare(state.rules, safe)).toBe(true);

    place(state, 1, 0, 0); // parada en su propia entrada, que es segura
    place(state, 0, 0, safe - 2);
    roll(state, 2);

    const option = optionOf(currentMoves(state), 0);
    expect(option.legal).toBe(true);
    expect(option.captures).toBe(-1);

    applyMove(state, 0);
    expect(state.progress[tokenIndex(state.rules, 1, 0)]).toBe(0);
    expect(state.capturesBy[0]).toBe(0);
  });

  it("en la recta final no alcanza ningun rival", () => {
    const state = makeState();
    place(state, 0, 0, state.rules.trackLength - 1);
    place(state, 1, 0, 5);
    roll(state, 2);
    const option = optionOf(currentMoves(state), 0);
    expect(option.to).toBe(state.rules.trackLength + 1);
    expect(option.captures).toBe(-1);
  });
});

describe("tirada extra", () => {
  it("sacar 6 la da", () => {
    const state = makeState();
    place(state, 0, 0, 4);
    roll(state, 6);
    applyMove(state, 0);
    finishMove(state);
    expect(state.turn).toBe(0);
    expect(state.phase).toBe("roll");
    expect(state.die).toBe(0);
    expect(state.extras).toBe(1);
  });

  it("sacar cualquier otro numero no la da", () => {
    const state = makeState();
    place(state, 0, 0, 4);
    roll(state, 3);
    applyMove(state, 0);
    finishMove(state);
    expect(state.turn).toBe(1);
    expect(state.extras).toBe(0);
  });

  it("un 6 sin movimiento posible igual da otra tirada", () => {
    const state = makeState();
    const goal = finishProgress(state.rules);
    place(state, 0, 0, goal);
    place(state, 0, 1, goal);
    roll(state, 6);
    expect(legalCount(currentMoves(state))).toBe(0);
    passTurn(state);
    expect(state.turn).toBe(0);
    expect(state.extras).toBe(1);
  });

  it("tres seises seguidos pierden el turno", () => {
    const state = makeState();
    place(state, 0, 0, 0);
    for (let i = 0; i <= MAX_EXTRA_ROLLS; i++) {
      roll(state, 6);
      applyMove(state, 0);
      finishMove(state);
    }
    expect(state.turn).toBe(1);
  });

  it("con el administrable apagado no hay extra ni por 6 ni por captura", () => {
    const state = makeState({ extraRoll: false });
    place(state, 0, 0, 4);
    roll(state, 6);
    applyMove(state, 0);
    finishMove(state);
    expect(state.turn).toBe(1);
  });
});

describe("entrada a la meta", () => {
  it("entra con el numero exacto", () => {
    const state = makeState();
    const goal = finishProgress(state.rules);
    place(state, 0, 0, goal - 3);
    roll(state, 3);
    const option = optionOf(currentMoves(state), 0);
    expect(option.legal).toBe(true);
    expect(option.reachesGoal).toBe(true);
    applyMove(state, 0);
    expect(tokensAtGoal(state, 0)).toBe(1);
  });

  it("si se pasa, no se mueve", () => {
    const state = makeState();
    const goal = finishProgress(state.rules);
    place(state, 0, 0, goal - 3);
    roll(state, 4);
    const option = optionOf(currentMoves(state), 0);
    expect(option.legal).toBe(false);
    expect(option.reason).toBe("overshoot");
    expect(applyMove(state, 0)).toBe(false);
    expect(state.progress[tokenIndex(state.rules, 0, 0)]).toBe(goal - 3);
  });

  it("la recta final se recorre casilla por casilla, no de un salto", () => {
    const state = makeState();
    place(state, 0, 0, state.rules.trackLength - 2);
    roll(state, 3);
    const option = optionOf(currentMoves(state), 0);
    expect(option.to).toBe(state.rules.trackLength + 1);
    expect(option.reachesGoal).toBe(false);
    expect(placeText(state.rules, 0, option.to)).toBe("recta final 2 de 4");
  });
});

describe("un solo movimiento posible", () => {
  it("se detecta cual es, para moverlo solo", () => {
    const state = makeState();
    place(state, 0, 0, finishProgress(state.rules));
    place(state, 0, 1, 10);
    roll(state, 3);
    const options = currentMoves(state);
    expect(legalCount(options)).toBe(1);
    expect(onlyLegalMove(options)).toBe(1);
  });

  it("con dos posibles no se elige por nadie", () => {
    const state = makeState();
    place(state, 0, 0, 4);
    place(state, 0, 1, 12);
    roll(state, 3);
    const options = currentMoves(state);
    expect(legalCount(options)).toBe(2);
    expect(onlyLegalMove(options)).toBe(-1);
  });

  it("sin ninguno posible tampoco", () => {
    const state = makeState();
    roll(state, 2);
    expect(onlyLegalMove(currentMoves(state))).toBe(-1);
    expect(legalCount(currentMoves(state))).toBe(0);
  });
});

describe("victoria", () => {
  it("se gana con las dos fichas en la meta", () => {
    const state = makeState();
    const goal = finishProgress(state.rules);
    place(state, 0, 0, goal);
    place(state, 0, 1, goal - 2);
    roll(state, 2);
    applyMove(state, 0 + 1);
    expect(state.winner).toBe(0);
    finishMove(state);
    expect(state.over).toBe(true);
    expect(state.phase).toBe("over");
  });

  it("con una sola ficha adentro todavia no se gana", () => {
    const state = makeState();
    const goal = finishProgress(state.rules);
    place(state, 0, 1, goal - 2);
    roll(state, 2);
    applyMove(state, 1);
    expect(state.winner).toBe(-1);
    finishMove(state);
    expect(state.over).toBe(false);
  });

  it("si se acaba el tiempo gana quien tenga mas avance", () => {
    const state = makeState();
    place(state, 2, 0, 20);
    place(state, 2, 1, 6);
    place(state, 1, 0, 12);
    expect(advanceOf(state, 2)).toBe(28);
    expect(leaderSeat(state)).toBe(2);
  });
});

describe("puntaje", () => {
  it("suma avance, capturas, metas y victoria", () => {
    const state = makeState();
    const goal = finishProgress(state.rules);
    place(state, 0, 0, goal); // 36 casillas recorridas
    place(state, 0, 1, 9); // 10 casillas recorridas
    state.capturesBy[0] = 2;

    const rules = state.rules;
    const expected = 46 * rules.pointsPerStep + 2 * rules.pointsPerCapture + rules.pointsPerToken;
    expect(ludoPoints(state, 0, false)).toBe(expected);
    expect(ludoPoints(state, 0, true)).toBe(expected + rules.pointsWin);
  });

  it("quien no salio de casa no puntua, pero tampoco queda en negativo", () => {
    const state = makeState();
    expect(ludoPoints(state, 3, false)).toBe(0);
  });
});

describe("bots", () => {
  it("captura si puede, aunque la otra ficha este mas adelantada", () => {
    const state = makeState();
    place(state, 0, 0, 9); // con un 2 come en la casilla 11
    place(state, 0, 1, 20);
    place(state, 1, 0, 3);
    roll(state, 2);
    const options = currentMoves(state);
    expect(chooseBotMove(state, options, createRng("bot"), "normal")).toBe(0);
  });

  it("si no puede capturar, mete la ficha en la meta", () => {
    const state = makeState();
    const goal = finishProgress(state.rules);
    place(state, 0, 0, goal - 3);
    place(state, 0, 1, 20);
    roll(state, 3);
    expect(chooseBotMove(state, currentMoves(state), createRng("bot"), "normal")).toBe(0);
  });

  it("si no puede ninguna de las dos, saca una ficha de casa", () => {
    const state = makeState();
    place(state, 0, 1, 2);
    roll(state, 6);
    expect(chooseBotMove(state, currentMoves(state), createRng("bot"), "normal")).toBe(0);
  });

  it("en igualdad de condiciones avanza la mas adelantada", () => {
    const state = makeState();
    place(state, 0, 0, 3);
    place(state, 0, 1, 17);
    roll(state, 2);
    expect(chooseBotMove(state, currentMoves(state), createRng("bot"), "normal")).toBe(1);
  });

  it("con un solo movimiento posible mueve ese, sea cual sea la dificultad", () => {
    const state = makeState();
    place(state, 0, 0, finishProgress(state.rules));
    place(state, 0, 1, 4);
    roll(state, 2);
    for (const skill of ["calmo", "normal", "filoso"] as const) {
      expect(chooseBotMove(state, currentMoves(state), createRng("bot"), skill)).toBe(1);
    }
  });

  it("sin movimientos devuelve -1 y el turno se pasa", () => {
    const state = makeState();
    roll(state, 2);
    expect(chooseBotMove(state, currentMoves(state), createRng("bot"), "normal")).toBe(-1);
  });

  it("el bot es determinista con la misma semilla", () => {
    const state = makeState();
    place(state, 0, 0, 4);
    place(state, 0, 1, 12);
    roll(state, 3);
    const options = currentMoves(state);
    const a = chooseBotMove(state, options, createRng("mismo"), "calmo");
    const b = chooseBotMove(state, options, createRng("mismo"), "calmo");
    expect(a).toBe(b);
  });
});

describe("jugada automatica del reloj", () => {
  it("elige capturar antes que avanzar", () => {
    const state = makeState();
    place(state, 0, 0, 9);
    place(state, 0, 1, 24);
    place(state, 1, 0, 3);
    roll(state, 2);
    expect(autoMove(state, currentMoves(state))).toBe(0);
  });

  it("sin movimiento legal devuelve -1: el turno se pasa", () => {
    const state = makeState();
    roll(state, 1);
    expect(autoMove(state, currentMoves(state))).toBe(-1);
  });

  it("no consume azar: dos llamadas dan lo mismo", () => {
    const state = makeState();
    place(state, 0, 0, 4);
    place(state, 0, 1, 12);
    roll(state, 3);
    const options = currentMoves(state);
    expect(autoMove(state, options)).toBe(autoMove(state, options));
  });
});

describe("textos del mando", () => {
  it("describen donde esta cada ficha", () => {
    const rules = DEFAULT_RULES;
    expect(placeText(rules, 0, -1)).toBe("en casa");
    expect(placeText(rules, 0, 13)).toBe("casilla 14");
    expect(placeText(rules, 0, finishProgress(rules))).toBe("en la meta");
  });

  it("describen que pasaria al mover", () => {
    const state = makeState();
    place(state, 0, 0, 9);
    place(state, 1, 0, 3);
    roll(state, 2);
    const options = movesFor(state, 0, 2);
    expect(moveHintText(optionOf(options, 0), state.rules, 0)).toContain("come una ficha");
    expect(moveHintText(optionOf(options, 1), state.rules, 0)).toBe("en casa");
  });
});
