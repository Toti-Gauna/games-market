import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import {
  MAP_SIZE,
  MAX_PLAYERS,
  MIN_SPAWN_DISTANCE,
  createShooterMap,
  type MapBox,
  type Vec2,
} from "./map";

/**
 * El mapa se genera igual en los diez aparatos o no se genera.
 *
 * Es el criterio de aceptacion que sostiene todo el juego en red: el host
 * manda una semilla y nadie transfiere geometria. Un mapa que difiere entre
 * clientes no se ve mal — se ve bien y se juega roto, con gente cubriendose
 * detras de bloques que en la otra pantalla no existen.
 */

const SEEDS = ["a", "b", "c", "d", "e", "arena-1", "arena-2"];

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function planOverlap(a: MapBox, b: MapBox): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
}

describe("createShooterMap", () => {
  it("la misma semilla da exactamente el mismo mapa", () => {
    expect(createShooterMap(createRng("igual"))).toEqual(createShooterMap(createRng("igual")));
  });

  it("semillas distintas dan mapas distintos", () => {
    expect(createShooterMap(createRng("uno"))).not.toEqual(createShooterMap(createRng("dos")));
  });

  it("reparte los diez puntos de aparicion", () => {
    for (const seed of SEEDS) {
      expect(createShooterMap(createRng(seed)).spawns).toHaveLength(MAX_PLAYERS);
    }
  });

  it("ninguna aparicion queda pegada a otra", () => {
    for (const seed of SEEDS) {
      const { spawns } = createShooterMap(createRng(seed));
      for (let i = 0; i < spawns.length; i++) {
        for (let j = i + 1; j < spawns.length; j++) {
          // El generador afloja la distancia si una semilla es imposible, pero
          // nunca hasta el punto de que dos personas aparezcan encima.
          expect(distance(spawns[i]!, spawns[j]!)).toBeGreaterThan(MIN_SPAWN_DISTANCE * 0.6);
        }
      }
    }
  });

  it("todo queda dentro de las paredes", () => {
    const half = MAP_SIZE / 2;
    for (const seed of SEEDS) {
      const map = createShooterMap(createRng(seed));
      for (const box of [...map.cover, ...map.platforms]) {
        expect(Math.abs(box.x) + box.w / 2).toBeLessThanOrEqual(half);
        expect(Math.abs(box.z) + box.d / 2).toBeLessThanOrEqual(half);
      }
      for (const spawn of map.spawns) {
        expect(Math.abs(spawn.x)).toBeLessThan(half);
        expect(Math.abs(spawn.z)).toBeLessThan(half);
      }
    }
  });

  it("la cobertura entra en el rango que pide la guia", () => {
    for (const seed of SEEDS) {
      const { cover } = createShooterMap(createRng(seed));
      expect(cover.length).toBeGreaterThanOrEqual(20);
      expect(cover.length).toBeLessThanOrEqual(35);
    }
  });

  it("ningun bloque de cobertura se pisa con otro", () => {
    for (const seed of SEEDS) {
      const { cover } = createShooterMap(createRng(seed));
      for (let i = 0; i < cover.length; i++) {
        for (let j = i + 1; j < cover.length; j++) {
          expect(planOverlap(cover[i]!, cover[j]!)).toBe(false);
        }
      }
    }
  });

  it("nadie aparece adentro de un bloque", () => {
    for (const seed of SEEDS) {
      const { cover, spawns } = createShooterMap(createRng(seed));
      for (const spawn of spawns) {
        for (const box of cover) {
          const inside =
            Math.abs(spawn.x - box.x) < box.w / 2 && Math.abs(spawn.z - box.z) < box.d / 2;
          expect(inside).toBe(false);
        }
      }
    }
  });

  it("el hito central queda despejado y se ve por encima de la cobertura", () => {
    for (const seed of SEEDS) {
      const { landmark, cover } = createShooterMap(createRng(seed));
      expect(landmark.x).toBe(0);
      expect(landmark.z).toBe(0);
      for (const box of cover) {
        expect(distance({ x: box.x, z: box.z }, { x: 0, z: 0 })).toBeGreaterThanOrEqual(8);
        expect(landmark.h).toBeGreaterThan(box.h);
      }
    }
  });

  it("hay dos plataformas y una rampa para cada una", () => {
    const map = createShooterMap(createRng("rampas"));
    expect(map.platforms).toHaveLength(2);
    expect(map.ramps).toHaveLength(2);
  });

  it("el anillo no cierra siempre en el mismo lugar", () => {
    const centers = SEEDS.map((seed) => createShooterMap(createRng(seed)).ringCenter);
    const unique = new Set(centers.map((c) => `${c.x.toFixed(3)}:${c.z.toFixed(3)}`));
    expect(unique.size).toBe(SEEDS.length);
  });

  it("el centro del anillo no se va contra una pared", () => {
    for (const seed of SEEDS) {
      const { ringCenter } = createShooterMap(createRng(seed));
      expect(Math.hypot(ringCenter.x, ringCenter.z)).toBeLessThanOrEqual(16);
    }
  });
});
