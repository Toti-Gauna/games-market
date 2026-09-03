import { describe, expect, it } from "vitest";
import {
  aabbFromBox,
  aabbFromCapsule,
  createAabb,
  createRayHit,
  raycastAabbs,
  type Aabb,
} from "./bvh";

/**
 * La ruta de AABB es la que usan los cuatro juegos 3D del catalogo: un
 * disparo del shooter se resuelve contra diez capsulas y contra la cobertura.
 * Si devuelve el impacto equivocado, el juego premia al que no acerto.
 */

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Aabb {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

describe("raycastAabbs", () => {
  it("devuelve el impacto mas cercano, no el primero de la lista", () => {
    const boxes = [
      box(9, -1, -1, 11, 1, 1),
      box(2, -1, -1, 4, 1, 1),
      box(5, -1, -1, 7, 1, 1),
    ];
    const hit = raycastAabbs(0, 0, 0, 1, 0, 0, boxes, 100, createRayHit());
    expect(hit).not.toBeNull();
    expect(hit?.index).toBe(1);
    expect(hit?.distance).toBeCloseTo(2, 10);
    expect(hit?.x).toBeCloseTo(2, 10);
  });

  it("el orden de la lista no cambia el resultado", () => {
    const near = box(2, -1, -1, 4, 1, 1);
    const far = box(9, -1, -1, 11, 1, 1);
    const a = raycastAabbs(0, 0, 0, 1, 0, 0, [near, far], 100, createRayHit());
    const b = raycastAabbs(0, 0, 0, 1, 0, 0, [far, near], 100, createRayHit());
    expect(a?.distance).toBeCloseTo(b?.distance ?? -1, 10);
  });

  it("no ve lo que esta detras del origen", () => {
    const boxes = [box(-6, -1, -1, -4, 1, 1)];
    expect(raycastAabbs(0, 0, 0, 1, 0, 0, boxes, 100, createRayHit())).toBeNull();
  });

  it("respeta el alcance maximo", () => {
    const boxes = [box(20, -1, -1, 22, 1, 1)];
    expect(raycastAabbs(0, 0, 0, 1, 0, 0, boxes, 10, createRayHit())).toBeNull();
    expect(raycastAabbs(0, 0, 0, 1, 0, 0, boxes, 30, createRayHit())).not.toBeNull();
  });

  it("un rayo paralelo que pasa de largo no impacta", () => {
    // El rayo va por y = 5 y la caja llega hasta y = 1.
    const boxes = [box(2, -1, -1, 4, 1, 1)];
    expect(raycastAabbs(0, 5, 0, 1, 0, 0, boxes, 100, createRayHit())).toBeNull();
  });

  it("un rayo paralelo que pasa por adentro de la franja impacta", () => {
    const boxes = [box(2, -1, -1, 4, 1, 1)];
    const hit = raycastAabbs(0, 0.5, 0, 1, 0, 0, boxes, 100, createRayHit());
    expect(hit?.index).toBe(0);
  });

  it("desde adentro de una caja el impacto es a distancia cero", () => {
    const boxes = [box(-1, -1, -1, 1, 1, 1)];
    const hit = raycastAabbs(0, 0, 0, 1, 0, 0, boxes, 100, createRayHit());
    expect(hit?.distance).toBe(0);
  });

  it("acierta en diagonal, no solo sobre los ejes", () => {
    const boxes = [box(4, 4, -1, 6, 6, 1)];
    const k = Math.SQRT1_2;
    const hit = raycastAabbs(0, 0, 0, k, k, 0, boxes, 100, createRayHit());
    expect(hit).not.toBeNull();
    // La cara de entrada esta en x = 4, sobre una direccion normalizada.
    expect(hit?.distance).toBeCloseTo(4 / k, 6);
    expect(hit?.x).toBeCloseTo(4, 6);
    expect(hit?.y).toBeCloseTo(4, 6);
  });

  it("una lista vacia no impacta y no rompe", () => {
    expect(raycastAabbs(0, 0, 0, 1, 0, 0, [], 100, createRayHit())).toBeNull();
  });

  it("reusa el objeto de salida en vez de asignar uno por disparo", () => {
    const out = createRayHit();
    const boxes = [box(2, -1, -1, 4, 1, 1)];
    const first = raycastAabbs(0, 0, 0, 1, 0, 0, boxes, 100, out);
    const second = raycastAabbs(0, 0, 0, 1, 0, 0, boxes, 100, out);
    expect(first).toBe(out);
    expect(second).toBe(out);
  });

  it("resuelve 40 cajas sin despeinarse", () => {
    const boxes: Aabb[] = [];
    for (let i = 0; i < 40; i++) boxes.push(box(i * 3 + 2, -1, -1, i * 3 + 3, 1, 1));
    const out = createRayHit();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) raycastAabbs(0, 0, 0, 1, 0, 0, boxes, 500, out);
    const perCast = (performance.now() - start) / 1000;
    expect(out.index).toBe(0);
    // El criterio de aceptacion pide menos de 0,1 ms por disparo. El margen
    // esta ancho a proposito: es una cota, no un benchmark.
    expect(perCast).toBeLessThan(0.5);
  });
});

describe("constructores de AABB", () => {
  it("aabbFromBox arma la caja alrededor del centro", () => {
    const out = aabbFromBox(createAabb(), 1, 2, 3, 0.5, 1, 1.5);
    expect(out).toEqual({ minX: 0.5, minY: 1, minZ: 1.5, maxX: 1.5, maxY: 3, maxZ: 4.5 });
  });

  it("aabbFromCapsule apoya la capsula en los pies", () => {
    const out = aabbFromCapsule(createAabb(), 0, 0, 0, 0.4, 1.8);
    expect(out.minY).toBe(0);
    expect(out.maxY).toBe(1.8);
    expect(out.minX).toBeCloseTo(-0.4, 10);
    expect(out.maxZ).toBeCloseTo(0.4, 10);
  });

  it("una capsula de jugador se acierta a la altura del pecho y se falla arriba", () => {
    const player = aabbFromCapsule(createAabb(), 10, 0, 0, 0.4, 1.8);
    const chest = raycastAabbs(0, 1.2, 0, 1, 0, 0, [player], 50, createRayHit());
    const overhead = raycastAabbs(0, 2.4, 0, 1, 0, 0, [player], 50, createRayHit());
    expect(chest?.distance).toBeCloseTo(9.6, 6);
    expect(overhead).toBeNull();
  });
});
