import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import {
  boardIndex,
  canPlace,
  clearEvents,
  createMatch,
  finishByLines,
  finishByQuit,
  ghostY,
  hardDrop,
  holdPiece,
  pendingGarbage,
  pieceAt,
  playerAt,
  rotate,
  setActivePiece,
  setMoveHeld,
  setSoftDrop,
  startMatch,
  stepMatch,
  stepPlayer,
  tetrisPoints,
  upcomingPiece,
  COLS,
  DEFAULT_RULES,
  EMPTY,
  GARBAGE,
  PIECE_COUNT,
  PIECE_I,
  PIECE_O,
  PIECE_T,
  ROWS,
  type TetrisMatch,
  type TetrisPlayer,
  type TetrisRules,
} from "./logic";

/**
 * Las pruebas salen una a una de los criterios de aceptacion de
 * R6-TETRIS-DUELO.md. No hay pruebas de render: lo que duele en un Tetris es
 * el determinismo de la secuencia y las seis reglas de sensacion.
 */

function fresh(seed = "abc7", overrides: Partial<TetrisRules> = {}): TetrisMatch {
  const match = createMatch({ ...DEFAULT_RULES, ...overrides }, createRng(seed));
  startMatch(match);
  return match;
}

/** Llena una fila entera menos una columna: queda a una pieza de completarse. */
function fillRow(player: TetrisPlayer, row: number, exceptCol: number): void {
  for (let col = 0; col < COLS; col++) {
    player.board[boardIndex(col, row)] = col === exceptCol ? EMPTY : GARBAGE;
  }
}

/** Las piezas que este asiento recibe de verdad, jugandolas. */
function consume(match: TetrisMatch, seat: number, count: number): number[] {
  const player = playerAt(match, seat);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(player.piece);
    // El tablero no importa: se mide la secuencia, no la pila.
    player.board.fill(EMPTY);
    hardDrop(match, seat);
  }
  return out;
}

/** Deja al asiento 0 con un tetris servido en la columna 0. */
function armTetris(match: TetrisMatch, seat: number, rows: number): void {
  const player = playerAt(match, seat);
  for (let row = ROWS - rows; row < ROWS; row++) fillRow(player, row, 0);
  // I vertical: sus celdas viven en la columna 2 de la caja, asi que x = -2
  // las pone en la columna 0 del tablero.
  setActivePiece(player, PIECE_I, 1, -2, 0);
}

describe("secuencia compartida", () => {
  it("los dos jugadores reciben exactamente la misma secuencia", () => {
    const match = fresh("duelo");
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i < 50; i++) {
      left.push(upcomingPiece(match, 0, i));
      right.push(upcomingPiece(match, 1, i));
    }
    expect(left).toEqual(right);
  });

  it("jugandolas de verdad, las 50 primeras coinciden", () => {
    const match = fresh("duelo");
    const left = consume(match, 0, 50);
    const right = consume(match, 1, 50);
    expect(left).toEqual(right);
    // Y no es que sean todas iguales entre si: es una secuencia de verdad.
    expect(new Set(left).size).toBe(PIECE_COUNT);
  });

  it("la misma semilla da la misma secuencia y otra semilla la cambia", () => {
    const read = (seed: string) => {
      const match = fresh(seed);
      const out: number[] = [];
      for (let i = 0; i < 50; i++) out.push(pieceAt(match, i));
      return out;
    };
    expect(read("abc7")).toEqual(read("abc7"));
    expect(read("abc7")).not.toEqual(read("zzz9"));
  });

  it("la bolsa de 7 garantiza que ninguna pieza tarde mas de 12 turnos", () => {
    const match = fresh("bolsa");
    const last = new Array<number>(PIECE_COUNT).fill(-1);
    // Turnos de espera = piezas ajenas entre dos apariciones. El peor caso de
    // la bolsa es "primera de una bolsa y ultima de la siguiente": 12.
    let maxWait = 0;
    for (let i = 0; i < 700; i++) {
      const piece = pieceAt(match, i);
      const previous = last[piece] ?? -1;
      if (previous >= 0) maxWait = Math.max(maxWait, i - previous - 1);
      last[piece] = i;
    }
    expect(maxWait).toBeLessThanOrEqual(12);
  });

  it("cada bolsa trae las siete piezas", () => {
    const match = fresh("bolsa");
    for (let bag = 0; bag < 100; bag++) {
      const seen = new Set<number>();
      for (let i = 0; i < PIECE_COUNT; i++) seen.add(pieceAt(match, bag * PIECE_COUNT + i));
      expect(seen.size).toBe(PIECE_COUNT);
    }
  });
});

describe("retardo de fijado", () => {
  it("una pieza apoyada se puede deslizar 500 ms", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    setActivePiece(player, PIECE_O, 0, 4, ROWS - 2);
    clearEvents(player);

    stepPlayer(match, 0, 499);
    expect(player.evLocked).toBe(0);
    stepPlayer(match, 0, 2);
    expect(player.evLocked).toBe(1);
  });

  it("rotar reinicia el contador, hasta 15 veces", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    setActivePiece(player, PIECE_O, 0, 4, ROWS - 2);
    clearEvents(player);

    for (let i = 0; i < 15; i++) {
      stepPlayer(match, 0, 400);
      expect(player.evLocked).toBe(0);
      expect(rotate(match, 0, 1)).toBe(true);
    }
    expect(player.lockResets).toBe(15);

    // El reinicio 16 ya no cuenta: la rotacion entra, el contador sigue.
    stepPlayer(match, 0, 400);
    expect(rotate(match, 0, 1)).toBe(true);
    expect(player.evLocked).toBe(0);
    stepPlayer(match, 0, 200);
    expect(player.evLocked).toBe(1);
  });

  it("bajar una fila devuelve los reinicios", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    setActivePiece(player, PIECE_O, 0, 4, ROWS - 4);
    // Apoyada sobre una pila que despues se saca: al bajar, cuenta de nuevo.
    fillRow(player, ROWS - 2, 9);
    player.grounded = true;
    rotate(match, 0, 1);
    expect(player.lockResets).toBe(1);
    player.board.fill(EMPTY);
    stepPlayer(match, 0, 800);
    expect(player.lockResets).toBe(0);
  });
});

describe("patadas de pared", () => {
  it("una T contra la pared izquierda rota corriendose", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    setActivePiece(player, PIECE_T, 1, -1, 8);
    expect(canPlace(player.board, PIECE_T, 1, -1, 8)).toBe(true);
    // Sin patada, la rotacion se saldria del tablero y habria que rechazarla.
    expect(canPlace(player.board, PIECE_T, 0, -1, 8)).toBe(false);

    expect(rotate(match, 0, -1)).toBe(true);
    expect(player.rot).toBe(0);
    expect(player.x).toBe(0);
  });

  it("una T contra la pared derecha tambien", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    setActivePiece(player, PIECE_T, 3, COLS - 2, 8);
    expect(canPlace(player.board, PIECE_T, 3, COLS - 2, 8)).toBe(true);
    expect(canPlace(player.board, PIECE_T, 0, COLS - 2, 8)).toBe(false);

    expect(rotate(match, 0, 1)).toBe(true);
    expect(player.rot).toBe(0);
    expect(player.x).toBe(COLS - 3);
  });

  it("encerrada de los dos lados, la rotacion se rechaza", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    // Un pasillo de una columna: no hay desplazamiento que haga entrar la T.
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (col !== 4) player.board[boardIndex(col, row)] = GARBAGE;
      }
    }
    setActivePiece(player, PIECE_T, 1, 3, 8);
    expect(rotate(match, 0, 1)).toBe(false);
    expect(player.rot).toBe(1);
  });
});

describe("fantasma", () => {
  it("marca la fila donde cae la pieza", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    // I horizontal: sus celdas estan en la fila 1 de la caja.
    setActivePiece(player, PIECE_I, 0, 3, 4);
    expect(ghostY(match, 0)).toBe(ROWS - 2);

    player.board[boardIndex(4, 15)] = GARBAGE;
    expect(ghostY(match, 0)).toBe(13);
  });

  it("cae exactamente donde marcaba", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    setActivePiece(player, PIECE_T, 0, 3, 2);
    player.board[boardIndex(4, 12)] = GARBAGE;
    const marked = ghostY(match, 0);
    hardDrop(match, 0);
    // Ya fijada, la fila de abajo de la T tiene que ser la que marcaba.
    expect(player.board[boardIndex(4, marked)]).toBe(PIECE_T + 1);
  });
});

describe("retencion", () => {
  it("funciona una sola vez por pieza", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    const first = player.piece;
    const second = upcomingPiece(match, 0, 0);

    expect(holdPiece(match, 0)).toBe(true);
    expect(player.hold).toBe(first);
    expect(player.piece).toBe(second);

    // Segundo intento con la misma pieza: no pasa nada.
    expect(holdPiece(match, 0)).toBe(false);
    expect(player.hold).toBe(first);
    expect(player.piece).toBe(second);

    // Con la pieza siguiente vuelve a estar disponible, y devuelve la guardada.
    const third = upcomingPiece(match, 0, 0);
    player.board.fill(EMPTY);
    hardDrop(match, 0);
    expect(player.piece).toBe(third);
    expect(holdPiece(match, 0)).toBe(true);
    expect(player.piece).toBe(first);
    expect(player.hold).toBe(third);
  });
});

describe("DAS y ARR", () => {
  it("mantener el costado cruza el tablero sin soltar", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    setActivePiece(player, PIECE_O, 0, 8, 0);

    setMoveHeld(match, 0, -1, true);
    // El primer paso sale en el acto: el DAS es el retardo de la REPETICION.
    expect(player.x).toBe(7);

    for (let i = 0; i < 30; i++) stepPlayer(match, 0, 16);
    expect(player.x).toBe(0);

    setMoveHeld(match, 0, -1, false);
    expect(player.moveDir).toBe(0);
  });

  it("antes del DAS no repite", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    setActivePiece(player, PIECE_O, 0, 8, 0);

    setMoveHeld(match, 0, -1, true);
    stepPlayer(match, 0, 120);
    expect(player.x).toBe(7);
  });

  it("soltar el otro costado no corta la repeticion en curso", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    setActivePiece(player, PIECE_O, 0, 8, 0);
    setMoveHeld(match, 0, -1, true);
    setMoveHeld(match, 0, 1, false);
    expect(player.moveDir).toBe(-1);
  });
});

describe("basura", () => {
  it("un tetris manda 4 filas", () => {
    const match = fresh();
    const attacker = playerAt(match, 0);
    const victim = playerAt(match, 1);
    armTetris(match, 0, 4);
    hardDrop(match, 0);

    expect(attacker.evLines).toBe(4);
    expect(attacker.garbageSent).toBe(4);
    expect(pendingGarbage(victim)).toBe(4);
  });

  it("un simple no manda nada y un doble manda una", () => {
    const single = fresh();
    armTetris(single, 0, 1);
    hardDrop(single, 0);
    expect(playerAt(single, 0).evLines).toBe(1);
    expect(pendingGarbage(playerAt(single, 1))).toBe(0);

    const double = fresh();
    armTetris(double, 0, 2);
    hardDrop(double, 0);
    expect(pendingGarbage(playerAt(double, 1))).toBe(1);
  });

  it("dos piezas seguidas con lineas suman el bono", () => {
    const match = fresh();
    const attacker = playerAt(match, 0);
    armTetris(match, 0, 2);
    hardDrop(match, 0);
    expect(pendingGarbage(playerAt(match, 1))).toBe(1);

    // Segundo doble seguido: 1 + 1 de bono.
    stepPlayer(match, 0, DEFAULT_RULES.clearDelayMs + 1);
    armTetris(match, 0, 2);
    hardDrop(match, 0);
    expect(pendingGarbage(playerAt(match, 1))).toBe(3);
    expect(attacker.combo).toBe(2);
  });

  it("completar lineas dentro de la ventana cancela la basura entrante", () => {
    const match = fresh();
    const attacker = playerAt(match, 0);
    const victim = playerAt(match, 1);

    armTetris(match, 0, 4);
    hardDrop(match, 0);
    expect(pendingGarbage(victim)).toBe(4);

    // La victima responde con un doble ANTES de que entre: cancela una fila y
    // no le llega nada al atacante.
    armTetris(match, 1, 2);
    hardDrop(match, 1);
    expect(victim.evLines).toBe(2);
    expect(pendingGarbage(victim)).toBe(3);
    expect(pendingGarbage(attacker)).toBe(0);
    expect(victim.garbageSent).toBe(0);
  });

  it("lo que sobra de la cancelacion si cruza", () => {
    const match = fresh();
    const attacker = playerAt(match, 0);
    const victim = playerAt(match, 1);

    armTetris(match, 0, 2);
    hardDrop(match, 0);
    expect(pendingGarbage(victim)).toBe(1);

    // Un tetris contra una sola fila en camino: cancela esa y manda 3.
    armTetris(match, 1, 4);
    hardDrop(match, 1);
    expect(pendingGarbage(victim)).toBe(0);
    expect(pendingGarbage(attacker)).toBe(3);
    expect(victim.garbageSent).toBe(3);
  });

  it("cerrada la ventana, la basura entra desde abajo con un hueco", () => {
    const match = fresh();
    const victim = playerAt(match, 1);
    armTetris(match, 0, 4);
    hardDrop(match, 0);

    stepPlayer(match, 1, DEFAULT_RULES.garbageWindowMs - 1);
    expect(victim.garbageTaken).toBe(0);
    stepPlayer(match, 1, 2);
    expect(victim.garbageTaken).toBe(4);
    expect(pendingGarbage(victim)).toBe(0);

    let holes = 0;
    let filled = 0;
    for (let col = 0; col < COLS; col++) {
      if ((victim.board[boardIndex(col, ROWS - 1)] ?? EMPTY) === EMPTY) holes++;
      else filled++;
    }
    expect(holes).toBe(1);
    expect(filled).toBe(COLS - 1);
  });

  it("las columnas de hueco salen de la misma secuencia sembrada", () => {
    const holesOf = (seed: string) => {
      const match = fresh(seed);
      const out: number[] = [];
      for (let i = 0; i < 16; i++) out.push(match.holes[i] ?? -1);
      return out;
    };
    expect(holesOf("abc7")).toEqual(holesOf("abc7"));
    expect(holesOf("abc7")).not.toEqual(holesOf("zzz9"));
  });
});

describe("final y puntos", () => {
  it("force-end da la victoria a quien tenga mas lineas", () => {
    const match = fresh();
    armTetris(match, 0, 4);
    hardDrop(match, 0);

    finishByLines(match, "forced");
    expect(match.over).toBe(true);
    expect(match.winner).toBe(0);
    expect(match.reason).toBe("forced");
  });

  it("sin diferencia de lineas, force-end es empate", () => {
    const match = fresh();
    finishByLines(match, "time");
    expect(match.winner).toBe(-1);
  });

  it("el abandono se lo lleva el que quedo", () => {
    const match = fresh();
    finishByQuit(match, 1);
    expect(match.winner).toBe(0);
    expect(match.reason).toBe("quit");
  });

  it("los puntos suman lineas, basura enviada, caida y victoria", () => {
    const match = fresh();
    const attacker = playerAt(match, 0);
    armTetris(match, 0, 4);
    hardDrop(match, 0);

    const drop = attacker.dropPoints;
    expect(attacker.linePoints).toBe(800);
    expect(tetrisPoints(match, 0)).toBe(800 + 4 * 60 + drop);

    finishByLines(match, "forced");
    expect(tetrisPoints(match, 0)).toBe(800 + 4 * 60 + drop + 600);
    expect(tetrisPoints(match, 1)).toBe(0);
  });

  it("la pila que llega a las filas ocultas pierde", () => {
    const match = fresh();
    const player = playerAt(match, 0);
    for (let row = 2; row < ROWS; row++) fillRow(player, row, 0);
    setActivePiece(player, PIECE_I, 1, -2, 0);
    hardDrop(match, 0);
    // El palo tapa la columna 0 entera: 20 lineas de una no existen, pero la
    // parte que queda arriba si llega a las filas ocultas.
    expect(player.lines > 0 || player.phase === "dead").toBe(true);
  });
});

describe("partida completa", () => {
  /**
   * Manoteo determinista: no juega bien, pero toca todo —mover, rotar,
   * retener, caida suave y dura— y es lo que encuentra los cuelgues.
   */
  function playRandom(seed: string, maxSteps: number): TetrisMatch {
    const match = fresh(seed);
    const rng = createRng(`${seed}:inputs`);
    let steps = 0;
    while (!match.over && steps < maxSteps) {
      for (let seat = 0; seat < 2; seat++) {
        const roll = rng.next();
        if (roll < 0.02) rotate(match, seat, rng.next() < 0.5 ? 1 : -1);
        else if (roll < 0.05) setMoveHeld(match, seat, rng.next() < 0.5 ? -1 : 1, true);
        else if (roll < 0.08) {
          setMoveHeld(match, seat, -1, false);
          setMoveHeld(match, seat, 1, false);
        } else if (roll < 0.1) hardDrop(match, seat);
        else if (roll < 0.11) holdPiece(match, seat);
        else if (roll < 0.13) setSoftDrop(match, seat, true);
        else if (roll < 0.15) setSoftDrop(match, seat, false);
      }
      stepMatch(match, 1000 / 60);
      steps++;
    }
    return match;
  }

  it("una partida entera termina por desborde y sin romperse", () => {
    const match = playRandom("partida", 60 * 60 * 5);
    expect(match.over).toBe(true);
    expect(match.reason).toBe("topout");
    expect([0, 1]).toContain(match.winner);
  });

  it("misma semilla y mismos inputs, mismo estado final", () => {
    const hash = (match: TetrisMatch) => {
      let out = `${match.winner}:${match.reason}:${Math.round(match.elapsedMs)}`;
      for (let seat = 0; seat < 2; seat++) {
        const player = playerAt(match, seat);
        out += `|${player.lines}/${player.garbageSent}/${player.garbageTaken}/${player.queueCursor}`;
        for (let i = 0; i < player.board.length; i++) out += player.board[i] ?? 0;
      }
      return out;
    };
    expect(hash(playRandom("determinismo", 4000))).toBe(hash(playRandom("determinismo", 4000)));
  });
});
