import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import {
  applyMove,
  applySwap,
  areAdjacent,
  beginClear,
  cascadePoints,
  collapseAndRefill,
  createBoard,
  createReport,
  createWork,
  finishClear,
  findMove,
  generateSolvableBoard,
  hasAnyMove,
  hashBoard,
  isLegalSwap,
  SPECIAL_BOMB,
  SPECIAL_COL,
  SPECIAL_NONE,
  SPECIAL_PRISM,
  SPECIAL_ROW,
  type Board,
  type MatchRules,
} from "./logic";

const RULES: MatchRules = {
  cols: 8,
  rows: 8,
  typeCount: 6,
  pointsPerTile: 20,
  specialPoints: 150,
  cascadeMultiplier: 0.5,
  bombRadius: 1,
  specialsEnabled: true,
};

/** Tablero escrito a mano: un digito por celda, los espacios se ignoran. */
function makeBoard(lines: readonly string[], typeCount = 6): Board {
  const rows = lines.map((line) => line.replace(/\s/g, ""));
  const cols = (rows[0] ?? "").length;
  const size = cols * rows.length;
  const tiles = new Int8Array(size);
  for (let y = 0; y < rows.length; y++) {
    const line = rows[y] ?? "";
    for (let x = 0; x < cols; x++) tiles[y * cols + x] = Number(line[x] ?? 0);
  }
  return {
    cols,
    rows: rows.length,
    typeCount,
    tiles,
    specials: new Uint8Array(size),
    fallFrom: new Int8Array(size),
  };
}

function rulesFor(board: Board, patch: Partial<MatchRules> = {}): MatchRules {
  return { ...RULES, cols: board.cols, rows: board.rows, typeCount: board.typeCount, ...patch };
}

/** Cuenta cuantas lineas de 3 o mas hay sin tocar el tablero. */
function matchesOn(board: Board): number {
  const work = createWork(board);
  return beginClear(board, work, rulesFor(board, { specialsEnabled: false }), -1, -1);
}

/* ------------------------------------------------------------------ */

describe("determinismo", () => {
  it("la misma semilla da el mismo tablero inicial", () => {
    const a = createBoard(RULES, createRng("abc7"));
    const b = createBoard(RULES, createRng("abc7"));
    expect(hashBoard(a)).toBe(hashBoard(b));
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
  });

  it("semillas distintas dan tableros distintos", () => {
    const a = createBoard(RULES, createRng("abc7"));
    const b = createBoard(RULES, createRng("zzz9"));
    expect(hashBoard(a)).not.toBe(hashBoard(b));
  });

  it("la misma semilla y los mismos movimientos terminan en el mismo tablero", () => {
    // La prueba que define M1: sin esto, comparar puntajes entre jugadores no
    // significa nada.
    const play = (seed: string) => {
      const rng = createRng(seed);
      const board = createBoard(RULES, rng);
      const work = createWork(board);
      const report = createReport();
      const pair = new Int32Array(2);
      let points = 0;
      for (let move = 0; move < 20; move++) {
        if (!findMove(board, RULES.specialsEnabled, pair)) break;
        applyMove(board, work, RULES, rng, pair[0] as number, pair[1] as number, report);
        points += report.points;
      }
      return { hash: hashBoard(board), points };
    };

    const first = play("mismo");
    const second = play("mismo");
    expect(first.hash).toBe(second.hash);
    expect(first.points).toBe(second.points);
    expect(first.points).toBeGreaterThan(0);
    expect(play("otro").hash).not.toBe(first.hash);
  });

  it("el relleno consume el generador en orden fijo: columna por columna, de abajo hacia arriba", () => {
    const board = makeBoard([
      "012345",
      "123450",
      "234501",
      "345012",
      "450123",
      "501234",
    ]);
    const twin = makeBoard([
      "012345",
      "123450",
      "234501",
      "345012",
      "450123",
      "501234",
    ]);
    // Se vacia la misma columna en los dos y el relleno tiene que coincidir.
    for (const target of [board, twin]) {
      target.tiles[2] = -1;
      target.tiles[8] = -1;
      target.tiles[14] = -1;
    }
    collapseAndRefill(board, createRng("relleno"));
    collapseAndRefill(twin, createRng("relleno"));
    expect(Array.from(board.tiles)).toEqual(Array.from(twin.tiles));
    expect(Array.from(board.tiles).some((t) => t < 0)).toBe(false);
  });
});

describe("tablero inicial", () => {
  it("nunca trae combinaciones ya hechas ni queda sin movimientos", () => {
    for (let i = 0; i < 60; i++) {
      const board = createBoard(RULES, createRng("semilla-" + i));
      expect(matchesOn(board)).toBe(0);
      expect(hasAnyMove(board, RULES.specialsEnabled)).toBe(true);
    }
  });

  it("tambien cumple con tableros chicos y pocos tipos", () => {
    const rules = { ...RULES, cols: 6, rows: 6, typeCount: 4 };
    for (let i = 0; i < 30; i++) {
      const board = createBoard(rules, createRng("chico-" + i));
      expect(matchesOn(board)).toBe(0);
      expect(hasAnyMove(board, rules.specialsEnabled)).toBe(true);
    }
  });

  it("no deja fichas fuera de rango", () => {
    const board = createBoard(RULES, createRng("rango"));
    for (const tile of board.tiles) {
      expect(tile).toBeGreaterThanOrEqual(0);
      expect(tile).toBeLessThan(RULES.typeCount);
    }
  });
});

describe("intercambios", () => {
  it("un intercambio que no forma linea es ilegal y deja el tablero intacto", () => {
    const board = makeBoard([
      "012345",
      "123450",
      "234501",
      "345012",
      "450123",
      "501234",
    ]);
    const rules = rulesFor(board);
    const work = createWork(board);
    const report = createReport();
    const before = hashBoard(board);

    expect(isLegalSwap(board, 0, 1, rules.specialsEnabled)).toBe(false);
    expect(applyMove(board, work, rules, createRng("x"), 0, 1, report)).toBe(false);
    expect(hashBoard(board)).toBe(before);
    expect(report.points).toBe(0);
  });

  it("rechaza celdas no adyacentes y fuera del tablero", () => {
    const board = createBoard(RULES, createRng("adyacencia"));
    expect(areAdjacent(board.cols, 0, 2)).toBe(false);
    expect(isLegalSwap(board, 0, 2, true)).toBe(false);
    expect(isLegalSwap(board, -1, 0, true)).toBe(false);
    expect(isLegalSwap(board, 0, board.tiles.length, true)).toBe(false);
  });

  it("un intercambio que forma linea es legal y limpia", () => {
    // Subir el 0 de (1,2) a (0,2) cierra la fila de arriba.
    const board = makeBoard([
      "001345",
      "120450",
      "234501",
      "345012",
      "450123",
      "501234",
    ]);
    const rules = rulesFor(board);
    const work = createWork(board);
    const report = createReport();

    expect(matchesOn(board)).toBe(0);
    expect(isLegalSwap(board, 2, 8, rules.specialsEnabled)).toBe(true);
    expect(applyMove(board, work, rules, createRng("ok"), 2, 8, report)).toBe(true);
    expect(report.cleared).toBeGreaterThanOrEqual(3);
    expect(report.points).toBeGreaterThan(0);
  });
});

describe("deteccion de lineas", () => {
  it("encuentra una linea horizontal de 3", () => {
    const board = makeBoard([
      "00012",
      "12345",
      "23451",
      "34512",
      "45123",
    ]);
    const work = createWork(board);
    expect(beginClear(board, work, rulesFor(board), -1, -1)).toBe(3);
    expect(work.spawnCount).toBe(0);
  });

  it("encuentra una linea vertical de 3", () => {
    const board = makeBoard([
      "01234",
      "02345",
      "03451",
      "14512",
      "25123",
    ]);
    const work = createWork(board);
    expect(beginClear(board, work, rulesFor(board), -1, -1)).toBe(3);
  });

  it("una L o T limpia las cinco fichas y deja una bomba en el cruce", () => {
    const board = makeBoard([
      "00012",
      "01234",
      "02345",
      "13451",
      "24512",
    ]);
    const work = createWork(board);
    expect(beginClear(board, work, rulesFor(board), -1, -1)).toBe(5);
    expect(work.spawnCount).toBe(1);
    expect(work.spawnKind[0]).toBe(SPECIAL_BOMB);
    expect(work.spawnIndex[0]).toBe(0);
  });

  it("cuatro en linea horizontal dejan un rayo vertical", () => {
    const board = makeBoard([
      "00001",
      "12345",
      "23451",
      "34512",
      "45123",
    ]);
    const work = createWork(board);
    expect(beginClear(board, work, rulesFor(board), -1, -1)).toBe(4);
    expect(work.spawnCount).toBe(1);
    expect(work.spawnKind[0]).toBe(SPECIAL_COL);
  });

  it("cuatro en linea vertical dejan un rayo horizontal", () => {
    const board = makeBoard([
      "01234",
      "02345",
      "03451",
      "04512",
      "15123",
    ]);
    const work = createWork(board);
    expect(beginClear(board, work, rulesFor(board), -1, -1)).toBe(4);
    expect(work.spawnKind[0]).toBe(SPECIAL_ROW);
  });

  it("cinco en linea dejan un prisma", () => {
    const board = makeBoard([
      "00000",
      "12345",
      "23451",
      "34512",
      "45123",
    ]);
    const work = createWork(board);
    expect(beginClear(board, work, rulesFor(board), -1, -1)).toBe(5);
    expect(work.spawnKind[0]).toBe(SPECIAL_PRISM);
  });

  it("la especial nace bajo el dedo del jugador cuando la celda movida es parte de la linea", () => {
    const board = makeBoard([
      "00001",
      "12345",
      "23451",
      "34512",
      "45123",
    ]);
    const work = createWork(board);
    beginClear(board, work, rulesFor(board), 3, 8);
    expect(work.spawnIndex[0]).toBe(3);
  });

  it("con las especiales apagadas no nace ninguna", () => {
    const board = makeBoard([
      "00000",
      "12345",
      "23451",
      "34512",
      "45123",
    ]);
    const work = createWork(board);
    expect(beginClear(board, work, rulesFor(board, { specialsEnabled: false }), -1, -1)).toBe(5);
    expect(work.spawnCount).toBe(0);
  });
});

describe("cascadas", () => {
  // Tablero armado para que la caida de la columna 2 arme sola una segunda
  // linea en la fila de abajo.
  const CASCADE_ROWS = [
    "123123",
    "234234",
    "341345",
    "405452",
    "510513",
    "210124",
  ] as const;
  const SWAP_A = 19;
  const SWAP_B = 20;

  it("el tablero de prueba arranca sin combinaciones", () => {
    expect(matchesOn(makeBoard(CASCADE_ROWS))).toBe(0);
  });

  it("un movimiento encadena dos pasos y el segundo vale mas", () => {
    const board = makeBoard(CASCADE_ROWS);
    const rules = rulesFor(board);
    const work = createWork(board);
    const rng = createRng("cascada");

    expect(isLegalSwap(board, SWAP_A, SWAP_B, rules.specialsEnabled)).toBe(true);
    applySwap(board, SWAP_A, SWAP_B);

    const first = beginClear(board, work, rules, SWAP_A, SWAP_B);
    expect(first).toBe(3);
    const firstPoints = cascadePoints(first, work.specialsUsed, 0, rules);
    finishClear(board, work, rng);

    const second = beginClear(board, work, rules, -1, -1);
    expect(second).toBeGreaterThanOrEqual(3);
    const secondPoints = cascadePoints(second, work.specialsUsed, 1, rules);

    // Misma cantidad de fichas, mas puntos: el multiplicador se aplico.
    expect(secondPoints).toBeGreaterThan(second * rules.pointsPerTile);
    expect(secondPoints / second).toBeGreaterThan(firstPoints / first);
  });

  it("resolveCascades deja el tablero estable y reporta los niveles", () => {
    const board = makeBoard(CASCADE_ROWS);
    const rules = rulesFor(board);
    const work = createWork(board);
    const report = createReport();

    expect(applyMove(board, work, rules, createRng("cascada"), SWAP_A, SWAP_B, report)).toBe(true);
    expect(report.levels).toBeGreaterThanOrEqual(2);
    expect(report.cleared).toBeGreaterThanOrEqual(6);
    expect(beginClear(board, work, rules, -1, -1)).toBe(0);
  });

  it("resolver paso a paso da lo mismo que resolver de una", () => {
    // Es la garantia de que el componente animado y el resolvedor puro no
    // pueden divergir: recorren las mismas primitivas en el mismo orden.
    const stepped = makeBoard(CASCADE_ROWS);
    const whole = makeBoard(CASCADE_ROWS);
    const rules = rulesFor(stepped);
    const work = createWork(stepped);
    const report = createReport();

    applySwap(stepped, SWAP_A, SWAP_B);
    const rng = createRng("igual");
    let points = 0;
    let preferA = SWAP_A;
    let preferB = SWAP_B;
    for (let level = 0; level < 32; level++) {
      const marked = beginClear(stepped, work, rules, preferA, preferB);
      preferA = -1;
      preferB = -1;
      if (marked === 0) break;
      points += cascadePoints(marked, work.specialsUsed, level, rules);
      finishClear(stepped, work, rng);
    }

    applyMove(whole, createWork(whole), rules, createRng("igual"), SWAP_A, SWAP_B, report);
    expect(hashBoard(stepped)).toBe(hashBoard(whole));
    expect(points).toBe(report.points);
  });
});

describe("puntaje", () => {
  it("suma base por ficha y premio por especial", () => {
    expect(cascadePoints(5, 0, 0, RULES)).toBe(100);
    expect(cascadePoints(5, 1, 0, RULES)).toBe(250);
  });

  it("cada nivel de cascada multiplica", () => {
    expect(cascadePoints(4, 0, 0, RULES)).toBe(80);
    expect(cascadePoints(4, 0, 1, RULES)).toBe(120);
    expect(cascadePoints(4, 0, 2, RULES)).toBe(160);
  });

  it("con el multiplicador en 0 encadenar no rinde", () => {
    const flat = { ...RULES, cascadeMultiplier: 0 };
    expect(cascadePoints(4, 0, 3, flat)).toBe(cascadePoints(4, 0, 0, flat));
  });
});

describe("sin movimientos posibles", () => {
  // Diagonales de periodo 3: ningun intercambio adyacente arma una linea.
  const STUCK = [
    "012012",
    "120120",
    "201201",
    "012012",
    "120120",
    "201201",
  ] as const;

  it("detecta el tablero trabado", () => {
    const board = makeBoard(STUCK);
    expect(matchesOn(board)).toBe(0);
    expect(hasAnyMove(board, false)).toBe(false);
    expect(hasAnyMove(board, true)).toBe(false);
  });

  it("ningun intercambio del tablero trabado es legal", () => {
    const board = makeBoard(STUCK);
    for (let index = 0; index < board.tiles.length; index++) {
      const x = index % board.cols;
      const y = (index / board.cols) | 0;
      if (x + 1 < board.cols) expect(isLegalSwap(board, index, index + 1, true)).toBe(false);
      if (y + 1 < board.rows) {
        expect(isLegalSwap(board, index, index + board.cols, true)).toBe(false);
      }
    }
  });

  it("rebarajar con el generador sembrado lo destraba y es reproducible", () => {
    const first = makeBoard(STUCK);
    const second = makeBoard(STUCK);
    const rules = rulesFor(first);
    generateSolvableBoard(first, createRng("rebaraja"), rules);
    generateSolvableBoard(second, createRng("rebaraja"), rules);

    expect(hasAnyMove(first, rules.specialsEnabled)).toBe(true);
    expect(matchesOn(first)).toBe(0);
    expect(hashBoard(first)).toBe(hashBoard(second));
  });
});

describe("piezas especiales", () => {
  const PLAIN = [
    "012345",
    "123450",
    "234501",
    "345012",
    "450123",
    "501234",
  ] as const;

  it("un prisma se puede intercambiar con cualquier vecina", () => {
    const board = makeBoard(PLAIN);
    board.specials[7] = SPECIAL_PRISM;
    expect(isLegalSwap(board, 7, 8, true)).toBe(true);
    // Con las especiales apagadas vuelve a mandar la regla de la linea.
    expect(isLegalSwap(board, 7, 8, false)).toBe(false);
  });

  it("el prisma limpia todas las fichas del color con el que se lo cambia", () => {
    const board = makeBoard(PLAIN);
    const rules = rulesFor(board);
    const work = createWork(board);
    board.specials[7] = SPECIAL_PRISM;
    const targetType = board.tiles[8] as number;

    applySwap(board, 7, 8);
    beginClear(board, work, rules, 7, 8);

    for (let i = 0; i < board.tiles.length; i++) {
      if (board.tiles[i] === targetType) expect(work.cleared[i]).toBe(1);
    }
    expect(work.specialsUsed).toBe(1);
  });

  it("dos especiales juntas se encadenan", () => {
    const board = makeBoard(PLAIN);
    const rules = rulesFor(board);
    const work = createWork(board);
    board.specials[7] = SPECIAL_ROW;
    board.specials[8] = SPECIAL_COL;

    expect(isLegalSwap(board, 7, 8, true)).toBe(true);
    applySwap(board, 7, 8);
    const cleared = beginClear(board, work, rules, 7, 8);

    // Una fila mas una columna, sin contar dos veces el cruce.
    expect(cleared).toBe(board.cols + board.rows - 1);
    expect(work.specialsUsed).toBe(2);
  });

  it("la bomba limpia su bloque y respeta el radio administrable", () => {
    const board = makeBoard(PLAIN);
    const work = createWork(board);
    board.specials[7] = SPECIAL_ROW;
    board.specials[8] = SPECIAL_BOMB;
    applySwap(board, 7, 8);
    const cleared = beginClear(board, work, rulesFor(board, { bombRadius: 1 }), 7, 8);
    // La fila entera mas las dos filas vecinas dentro del bloque de 3x3.
    expect(cleared).toBeGreaterThan(board.cols);
    expect(work.specialsUsed).toBe(2);
  });

  it("la especial que nace sobrevive al derrumbe", () => {
    const board = makeBoard([
      "00001",
      "12345",
      "23451",
      "34512",
      "45123",
    ]);
    const work = createWork(board);
    const rules = rulesFor(board);
    beginClear(board, work, rules, -1, -1);
    finishClear(board, work, createRng("nace"));
    let specials = 0;
    for (const kind of board.specials) if (kind !== SPECIAL_NONE) specials++;
    expect(specials).toBe(1);
  });
});
