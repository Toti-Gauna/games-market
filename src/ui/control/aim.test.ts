import { describe, expect, it } from "vitest";
import type { AimBall, AimTable } from "@/core/contract/control";
import { clampToTable, cueBallOf, overlapsBall, projectAim, tableBounds } from "./aim";

/**
 * La linea de tiro proyectada.
 *
 * El criterio de aceptacion 5 pide que la linea del mando coincida con la
 * trayectoria real. Como la trayectoria real la calcula Rapier y aca no hay
 * solver, lo que se comprueba es lo que la hace coincidir: que el contacto se
 * resuelva a `2r` entre centros y que la bola golpeada salga por la linea de
 * centros.
 */

const RADIUS = 0.02;

function makeTable(balls: readonly AimBall[]): AimTable {
  return {
    balls,
    // 2.54 / 1.27: la mesa de 9 pies es exactamente el doble de larga que ancha.
    aspect: 2,
    ballRadius: RADIUS,
    pockets: [],
    pocketRadius: 0.05,
    own: null,
  };
}

const cue: AimBall = { id: 0, x: 0.25, z: 0.25, kind: "cue" };

describe("tableBounds", () => {
  it("normaliza los dos ejes con la misma escala", () => {
    // Con aspect 2, el ancho es la mitad del largo: z llega a 0.5, no a 1.
    expect(tableBounds(makeTable([cue]))).toEqual({ maxX: 1, maxZ: 0.5 });
  });
});

describe("cueBallOf", () => {
  it("encuentra la blanca", () => {
    expect(cueBallOf(makeTable([cue]))).toEqual({ x: 0.25, z: 0.25 });
  });

  it("devuelve null si la blanca no esta en la mesa", () => {
    expect(cueBallOf(makeTable([{ id: 3, x: 0.5, z: 0.25, kind: "solids" }]))).toBeNull();
  });
});

describe("projectAim", () => {
  it("sin bolas delante, la linea termina en la banda", () => {
    const table = makeTable([cue]);
    const shot = projectAim(table, 0);
    expect(shot.hitId).toBeNull();
    expect(shot.hitDir).toBeNull();
    // Apuntando a +x, el centro se detiene a un radio de la banda derecha.
    expect(shot.end.x).toBeCloseTo(1 - RADIUS, 6);
    expect(shot.end.z).toBeCloseTo(0.25, 6);
  });

  it("un tiro de frente golpea y se detiene a dos radios del centro", () => {
    const target: AimBall = { id: 5, x: 0.6, z: 0.25, kind: "solids" };
    const shot = projectAim(makeTable([cue, target]), 0);
    expect(shot.hitId).toBe(5);
    expect(shot.end.x).toBeCloseTo(target.x - RADIUS * 2, 6);
    expect(shot.end.z).toBeCloseTo(0.25, 6);
  });

  it("la bola golpeada sale por la linea de centros", () => {
    const target: AimBall = { id: 5, x: 0.6, z: 0.25, kind: "solids" };
    const shot = projectAim(makeTable([cue, target]), 0);
    expect(shot.hitDir?.x).toBeCloseTo(1, 6);
    expect(shot.hitDir?.z).toBeCloseTo(0, 6);
  });

  it("un corte manda la bola en diagonal, no en la direccion del tiro", () => {
    // Objetivo desplazado en z: la blanca la toma de costado.
    const target: AimBall = { id: 5, x: 0.6, z: 0.25 + RADIUS, kind: "solids" };
    const shot = projectAim(makeTable([cue, target]), 0);
    expect(shot.hitId).toBe(5);
    expect(shot.hitDir).not.toBeNull();
    // Sale abierta hacia +z, y el tiro iba derecho por +x.
    expect(shot.hitDir!.z).toBeGreaterThan(0);
    expect(shot.hitDir!.x).toBeGreaterThan(0);
    expect(Math.hypot(shot.hitDir!.x, shot.hitDir!.z)).toBeCloseTo(1, 6);
  });

  it("golpea la mas cercana de dos alineadas", () => {
    const near: AimBall = { id: 5, x: 0.5, z: 0.25, kind: "solids" };
    const far: AimBall = { id: 9, x: 0.8, z: 0.25, kind: "stripes" };
    expect(projectAim(makeTable([cue, near, far]), 0).hitId).toBe(5);
  });

  it("ignora lo que queda detras del tiro", () => {
    const behind: AimBall = { id: 5, x: 0.1, z: 0.25, kind: "solids" };
    // Apuntando a +x con la bola en -x: no la toca.
    expect(projectAim(makeTable([cue, behind]), 0).hitId).toBeNull();
  });

  it("ignora la que pasa de largo por un pelo", () => {
    // Separacion en z apenas mayor que 2r: el rayo no llega a rozarla.
    const target: AimBall = { id: 5, x: 0.6, z: 0.25 + RADIUS * 2.05, kind: "solids" };
    expect(projectAim(makeTable([cue, target]), 0).hitId).toBeNull();
  });

  it("un tiro paralelo a una banda termina en la banda del fondo", () => {
    // Angulo pi/2 = hacia +z, que es el lado corto.
    const shot = projectAim(makeTable([cue]), Math.PI / 2);
    expect(shot.hitId).toBeNull();
    expect(shot.end.z).toBeCloseTo(0.5 - RADIUS, 6);
    expect(shot.end.x).toBeCloseTo(0.25, 6);
  });

  it("una bola detras de la banda no se golpea", () => {
    // Mas lejos que el cruce con la banda derecha: primero pega la banda.
    const table = makeTable([{ id: 0, x: 0.9, z: 0.25, kind: "cue" }]);
    const shot = projectAim(table, 0);
    expect(shot.hitId).toBeNull();
    expect(shot.end.x).toBeCloseTo(1 - RADIUS, 6);
  });

  it("sin blanca no proyecta nada", () => {
    const shot = projectAim(makeTable([{ id: 5, x: 0.5, z: 0.25, kind: "solids" }]), 0);
    expect(shot.hitId).toBeNull();
    expect(shot.end).toEqual({ x: 0, z: 0 });
  });
});

describe("clampToTable", () => {
  it("encierra el punto dentro del borde util", () => {
    const table = makeTable([cue]);
    expect(clampToTable(table, { x: -5, z: -5 })).toEqual({ x: RADIUS, z: RADIUS });
    expect(clampToTable(table, { x: 5, z: 5 })).toEqual({ x: 1 - RADIUS, z: 0.5 - RADIUS });
  });

  it("deja quieto lo que ya esta adentro", () => {
    expect(clampToTable(makeTable([cue]), { x: 0.4, z: 0.2 })).toEqual({ x: 0.4, z: 0.2 });
  });
});

describe("overlapsBall", () => {
  const table = makeTable([cue, { id: 5, x: 0.6, z: 0.25, kind: "solids" }]);

  it("detecta que el punto pisa otra bola", () => {
    expect(overlapsBall(table, { x: 0.6, z: 0.25 })).toBe(true);
    expect(overlapsBall(table, { x: 0.6 + RADIUS, z: 0.25 })).toBe(true);
  });

  it("acepta un punto libre", () => {
    expect(overlapsBall(table, { x: 0.3, z: 0.1 })).toBe(false);
  });

  it("no cuenta la blanca como estorbo de si misma", () => {
    expect(overlapsBall(table, { x: cue.x, z: cue.z })).toBe(false);
  });
});
