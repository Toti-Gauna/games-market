import { describe, expect, it } from "vitest";
import { schemaDefaults, type SettingsRecord } from "@/core/contract/settings";
import { createRng } from "@/core/engine/rng";
import { isCorrect, countMatchedPairs } from "@/core/corporate/scoring";
import { matchLink, matchSolution } from "@/core/corporate/question.types";
import { memoriaSettings } from "./settings";
import {
  buildMemoriaBoard,
  computeMemoriaPoints,
  countCorrectLinks,
  parseMemoriaPairs,
} from "./logic";

const defaults = schemaDefaults(memoriaSettings);

/** La disposicion completa: que pares entraron y donde quedo cada columna. */
function layoutOf(seed: string, values = defaults): string {
  const board = buildMemoriaBoard(values, createRng(seed));
  return `${board.pairs.map((pair) => pair.id).join(",")}|${board.rightOrder.join(",")}`;
}

describe("parseMemoriaPairs", () => {
  it("arma un par por fila completa", () => {
    const pairs = parseMemoriaPairs([
      { principle: "Confianza", definition: "Se pregunta antes de suponer." },
    ]);
    expect(pairs).toEqual([
      { id: "p1", left: "Confianza", right: "Se pregunta antes de suponer." },
    ]);
  });

  it("descarta las filas a las que les falta un lado", () => {
    const rows: SettingsRecord[] = [
      { principle: "Solo el principio", definition: "  " },
      { principle: "", definition: "Solo la definición" },
      { principle: "Completo", definition: "Con las dos partes" },
    ];
    const pairs = parseMemoriaPairs(rows);
    expect(pairs).toHaveLength(1);
    // El id sigue al indice de la fila: renombrar no cambia de par estamos hablando.
    expect(pairs[0]?.id).toBe("p3");
  });

  it("lee los ocho pares que trae el panel por defecto", () => {
    expect(parseMemoriaPairs(defaults["pairs"] as SettingsRecord[])).toHaveLength(8);
  });
});

describe("buildMemoriaBoard", () => {
  it("con la misma semilla arma exactamente el mismo tablero", () => {
    // Es la razon de ser del PRNG sembrado: sin esto los puntajes de un tour no
    // se pueden comparar.
    expect(layoutOf("abc7")).toBe(layoutOf("abc7"));
    expect(layoutOf("semilla-de-la-sala")).toBe(layoutOf("semilla-de-la-sala"));
  });

  it("con semillas distintas la disposición cambia", () => {
    expect(layoutOf("abc7")).not.toBe(layoutOf("zzz9"));
  });

  it("respeta la cantidad de pares en juego", () => {
    const board = buildMemoriaBoard({ ...defaults, pairCount: 3 }, createRng("abc7"));
    expect(board.pairs).toHaveLength(3);
    expect(board.rightOrder).toHaveLength(3);
    expect([...board.rightOrder].sort()).toEqual(board.pairs.map((pair) => pair.id).sort());
  });

  it("nunca pide más pares de los que hay escritos", () => {
    const board = buildMemoriaBoard({ ...defaults, pairCount: 40 }, createRng("abc7"));
    expect(board.pairs).toHaveLength(8);
  });

  it("sin barajar conserva el orden escrito y las dos columnas alineadas", () => {
    const board = buildMemoriaBoard({ ...defaults, shuffle: false }, createRng("abc7"));
    expect(board.pairs.map((pair) => pair.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(board.rightOrder).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("barajado, la derecha nunca queda alineada con la izquierda", () => {
    // Alineadas, la solución se leería de arriba abajo sin jugar. Con tres
    // pares eso pasaría en una de cada seis semillas, así que se prueban varias.
    for (const seed of ["abc7", "zzz9", "a", "b", "c", "d", "e", "f", "g", "h"]) {
      for (const pairCount of [3, 4, 5, 8]) {
        const board = buildMemoriaBoard({ ...defaults, pairCount }, createRng(seed));
        expect(board.rightOrder).not.toEqual(board.pairs.map((pair) => pair.id));
      }
    }
  });
});

describe("unir un par", () => {
  const board = buildMemoriaBoard(defaults, createRng("abc7"));
  const first = board.pairs[0];
  const second = board.pairs[1];

  it("el par correcto es el que cierra consigo mismo", () => {
    const link = matchLink(first?.id ?? "", first?.id ?? "");
    expect(matchSolution(board.question)).toContain(link);
    expect(countCorrectLinks(board, [link])).toBe(1);
  });

  it("un par cruzado no suma, y repetir el mismo tampoco suma dos veces", () => {
    const wrong = matchLink(first?.id ?? "", second?.id ?? "");
    const right = matchLink(first?.id ?? "", first?.id ?? "");
    expect(countCorrectLinks(board, [wrong])).toBe(0);
    expect(countCorrectLinks(board, [right, right])).toBe(1);
  });

  it("el tablero solo está correcto con todos los pares unidos", () => {
    const all = board.pairs.map((pair) => matchLink(pair.id, pair.id));
    expect(isCorrect(board.question, all.slice(0, -1))).toBe(false);
    expect(isCorrect(board.question, all)).toBe(true);
    expect(countMatchedPairs(board.question, all)).toBe(board.pairs.length);
  });
});

describe("computeMemoriaPoints", () => {
  it("cobra los pares logrados aunque se haya cortado el tiempo", () => {
    const points = computeMemoriaPoints({
      matchedPairs: 3,
      completed: false,
      elapsedMs: 60_000,
      durationMs: 60_000,
      pointsPerPair: 100,
      bonusPerSecond: 2,
    });
    expect(points).toBe(300);
  });

  it("suma 2 puntos por segundo restante cuando se completa a tiempo", () => {
    const points = computeMemoriaPoints({
      matchedPairs: 5,
      completed: true,
      elapsedMs: 40_000,
      durationMs: 60_000,
      pointsPerPair: 100,
      bonusPerSecond: 2,
    });
    // 5 x 100 + ceil(20 s) x 2
    expect(points).toBe(540);
  });

  it("sin límite de tiempo no hay bono, aunque esté completo", () => {
    const points = computeMemoriaPoints({
      matchedPairs: 5,
      completed: true,
      elapsedMs: 40_000,
      durationMs: null,
      pointsPerPair: 100,
      bonusPerSecond: 2,
    });
    expect(points).toBe(500);
  });

  it("pasarse del límite no descuenta puntos", () => {
    const points = computeMemoriaPoints({
      matchedPairs: 2,
      completed: true,
      elapsedMs: 90_000,
      durationMs: 60_000,
      pointsPerPair: 100,
      bonusPerSecond: 2,
    });
    expect(points).toBe(200);
  });

  it("usa los valores del panel", () => {
    const points = computeMemoriaPoints({
      matchedPairs: 4,
      completed: true,
      elapsedMs: 5_000,
      durationMs: 15_000,
      pointsPerPair: 50,
      bonusPerSecond: 5,
    });
    // 4 x 50 + ceil(10 s) x 5
    expect(points).toBe(250);
  });

  it("un tablero vacío vale cero", () => {
    expect(
      computeMemoriaPoints({
        matchedPairs: 0,
        completed: false,
        elapsedMs: 1_000,
        durationMs: 60_000,
      }),
    ).toBe(0);
  });
});
