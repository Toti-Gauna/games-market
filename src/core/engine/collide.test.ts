import { describe, expect, it } from "vitest";
import { boxHitsBox, circleHitsBox, circleHitsCircle, clamp, lerp, pointInBox, sweepCircleBox } from "./collide";

describe("boxHitsBox", () => {
  it("detecta solape", () => {
    expect(boxHitsBox({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it("dos cajas que se tocan por el borde no colisionan", () => {
    // Importa: si tocarse contara, un personaje apoyado en el piso estaria
    // siempre en colision y no podria caminar.
    expect(boxHitsBox({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe("circulos", () => {
  it("circulo contra circulo", () => {
    expect(circleHitsCircle({ x: 0, y: 0, r: 5 }, { x: 8, y: 0, r: 5 })).toBe(true);
    expect(circleHitsCircle({ x: 0, y: 0, r: 5 }, { x: 11, y: 0, r: 5 })).toBe(false);
  });

  it("circulo contra caja por la esquina", () => {
    const box = { x: 10, y: 10, w: 10, h: 10 };
    // La esquina esta a distancia sqrt(2)*2 ~= 2.83 del centro.
    expect(circleHitsBox({ x: 8, y: 8, r: 3 }, box)).toBe(true);
    expect(circleHitsBox({ x: 8, y: 8, r: 2 }, box)).toBe(false);
  });
});

describe("sweepCircleBox", () => {
  it("agarra el tunel: un movil rapido no atraviesa la pared", () => {
    const wall = { x: 100, y: 0, w: 10, h: 100 };
    const ball = { x: 0, y: 50, r: 5 };
    // Un salto de 200 px en un paso pasaria de largo con un test estatico.
    const t = sweepCircleBox(ball, 200, 0, wall);
    expect(t).not.toBeNull();
    expect(t as number).toBeCloseTo(0.475, 3);
  });

  it("devuelve null cuando el movimiento no llega", () => {
    const wall = { x: 100, y: 0, w: 10, h: 100 };
    expect(sweepCircleBox({ x: 0, y: 50, r: 5 }, 10, 0, wall)).toBeNull();
  });

  it("devuelve null cuando el movimiento pasa por al lado", () => {
    const wall = { x: 100, y: 0, w: 10, h: 100 };
    expect(sweepCircleBox({ x: 0, y: 500, r: 5 }, 200, 0, wall)).toBeNull();
  });
});

describe("utilidades", () => {
  it("clamp", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("lerp", () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });

  it("pointInBox incluye los bordes", () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    expect(pointInBox(0, 0, box)).toBe(true);
    expect(pointInBox(10, 10, box)).toBe(true);
    expect(pointInBox(10.1, 5, box)).toBe(false);
  });
});
