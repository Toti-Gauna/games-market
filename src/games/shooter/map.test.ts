import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import {
  CAR_COUNT,
  CHEST_COUNT,
  MAP_SIZE,
  MAX_MOUNTAINS,
  MAX_PLAYERS,
  MIN_MOUNTAINS,
  MIN_SPAWN_DISTANCE,
  MOUNTAIN_CORE,
  WEAPON_ASPERSOR,
  WEAPON_CANON,
  WEAPON_PISTOLA,
  createShooterMap,
  insideMountain,
  mountainHeight,
  terrainHeight,
  terrainSlope,
  type MapBox,
  type Vec2,
} from "./map";

/**
 * El mapa se genera igual en los diez aparatos o no se genera.
 *
 * Es el criterio de aceptacion que sostiene todo el juego en red: el host
 * manda una semilla y nadie transfiere geometria. Un mapa que difiere entre
 * clientes no se ve mal — se ve bien y se juega roto, con gente cubriendose
 * detras de rocas que en la otra pantalla no existen.
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

  it("ninguna aparicion queda pegada a otra ni en una ladera", () => {
    for (const seed of SEEDS) {
      const map = createShooterMap(createRng(seed));
      const { spawns } = map;
      for (let i = 0; i < spawns.length; i++) {
        expect(insideMountain(map, spawns[i]!.x, spawns[i]!.z, 0.9)).toBe(false);
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
      for (const box of map.cover) {
        expect(Math.abs(box.x) + box.w / 2).toBeLessThanOrEqual(half);
        expect(Math.abs(box.z) + box.d / 2).toBeLessThanOrEqual(half);
      }
      for (const point of [...map.spawns, ...map.chests, ...map.cars]) {
        expect(Math.abs(point.x)).toBeLessThan(half);
        expect(Math.abs(point.z)).toBeLessThan(half);
      }
      for (const mountain of map.mountains) {
        expect(Math.abs(mountain.x) + mountain.radius).toBeLessThanOrEqual(half + 1e-6);
        expect(Math.abs(mountain.z) + mountain.radius).toBeLessThanOrEqual(half + 1e-6);
      }
    }
  });

  it("la cobertura entra en el rango del mapa grande", () => {
    for (const seed of SEEDS) {
      const { cover } = createShooterMap(createRng(seed));
      expect(cover.length).toBeGreaterThanOrEqual(40);
      expect(cover.length).toBeLessThanOrEqual(80);
    }
  });

  it("ninguna roca se pisa con otra y todas se apoyan en el terreno", () => {
    for (const seed of SEEDS) {
      const map = createShooterMap(createRng(seed));
      const { cover } = map;
      for (let i = 0; i < cover.length; i++) {
        const box = cover[i]!;
        // La base queda apenas enterrada: ni flota ni desaparece.
        const ground = terrainHeight(map, box.x, box.z);
        expect(box.y - box.h / 2).toBeLessThanOrEqual(ground + 1e-6);
        expect(box.y + box.h / 2).toBeGreaterThan(ground + 1);
        for (let j = i + 1; j < cover.length; j++) {
          expect(planOverlap(box, cover[j]!)).toBe(false);
        }
      }
    }
  });

  it("nadie aparece adentro de una roca", () => {
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

  it("hay entre cinco y nueve montanias y la mas alta es el hito, cerca del centro", () => {
    for (const seed of SEEDS) {
      const { mountains, landmark } = createShooterMap(createRng(seed));
      expect(mountains.length).toBeGreaterThanOrEqual(MIN_MOUNTAINS);
      expect(mountains.length).toBeLessThanOrEqual(MAX_MOUNTAINS);
      expect(Math.hypot(landmark.x, landmark.z)).toBeLessThan(20);
      for (const mountain of mountains) expect(landmark.height).toBeGreaterThanOrEqual(mountain.height);
      // Separadas: dos montanias encimadas se leen como una sola deforme.
      for (let i = 0; i < mountains.length; i++) {
        for (let j = i + 1; j < mountains.length; j++) {
          const a = mountains[i]!;
          const b = mountains[j]!;
          expect(distance(a, b)).toBeGreaterThan((a.radius + b.radius) * 0.5);
        }
      }
    }
  });

  it("el terreno es una campana suave: alto en el centro, cero fuera del radio", () => {
    const mountain = { x: 10, z: -5, radius: 20, height: 12 };
    expect(mountainHeight(mountain, 10, -5)).toBeCloseTo(12, 6);
    expect(mountainHeight(mountain, 10 + 10, -5)).toBeCloseTo(6, 6);
    expect(mountainHeight(mountain, 10 + 20, -5)).toBe(0);
    expect(mountainHeight(mountain, 10 + 25, -5)).toBe(0);
    // Y cae con la distancia: monotona hacia afuera.
    let previous = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= 20; d += 1) {
      const h = mountainHeight(mountain, 10 + d, -5);
      expect(h).toBeLessThanOrEqual(previous + 1e-9);
      previous = h;
    }
  });

  it("la altura del terreno es determinista y el pasto ondula poco", () => {
    const a = createShooterMap(createRng("terreno"));
    const b = createShooterMap(createRng("terreno"));
    for (let i = 0; i < 50; i++) {
      const x = -90 + i * 3.7;
      const z = 80 - i * 3.1;
      expect(terrainHeight(a, x, z)).toBe(terrainHeight(b, x, z));
    }
    // Lejos de toda montania, el terreno se queda en +-0.5.
    let checked = 0;
    for (let x = -95; x <= 95; x += 7) {
      for (let z = -95; z <= 95; z += 7) {
        if (a.mountains.some((m) => Math.hypot(x - m.x, z - m.z) < m.radius)) continue;
        expect(Math.abs(terrainHeight(a, x, z))).toBeLessThanOrEqual(0.5 + 1e-6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("la pendiente es grande en la ladera y chica en el llano", () => {
    const map = createShooterMap(createRng("pendiente"));
    const mountain = map.landmark;
    // A media ladera de la montania mas alta la pendiente es considerable.
    const mid = terrainSlope(map, mountain.x + mountain.radius * 0.5, mountain.z);
    expect(mid).toBeGreaterThan(0.4);
    // En el llano, apenas la ondulacion del pasto.
    let flat = -1;
    for (const spawn of map.spawns) {
      if (!insideMountain(map, spawn.x, spawn.z, 1.2)) {
        flat = terrainSlope(map, spawn.x, spawn.z);
        break;
      }
    }
    if (flat >= 0) expect(flat).toBeLessThan(0.25);
  });

  it("los cofres traen armas de cofre, no la pistola, y se reparten por semilla", () => {
    for (const seed of SEEDS) {
      const map = createShooterMap(createRng(seed));
      expect(map.chests.length).toBeGreaterThanOrEqual(CHEST_COUNT - 4);
      expect(map.chests.length).toBeLessThanOrEqual(CHEST_COUNT);
      for (const chest of map.chests) {
        expect(chest.weapon).not.toBe(WEAPON_PISTOLA);
        expect(chest.weapon).toBeGreaterThanOrEqual(WEAPON_ASPERSOR);
        expect(chest.weapon).toBeLessThanOrEqual(WEAPON_CANON);
        expect(chest.y).toBeCloseTo(terrainHeight(map, chest.x, chest.z), 6);
        expect(insideMountain(map, chest.x, chest.z, MOUNTAIN_CORE)).toBe(false);
      }
    }
    // Dos semillas no reparten el mismo botin.
    const a = createShooterMap(createRng("botin-1")).chests.map((c) => c.weapon);
    const b = createShooterMap(createRng("botin-2")).chests.map((c) => c.weapon);
    expect(a).not.toEqual(b);
  });

  it("los autos quedan en llano, separados y lejos de las apariciones", () => {
    for (const seed of SEEDS) {
      const map = createShooterMap(createRng(seed));
      expect(map.cars.length).toBeGreaterThanOrEqual(2);
      expect(map.cars.length).toBeLessThanOrEqual(CAR_COUNT);
      for (const car of map.cars) {
        expect(terrainSlope(map, car.x, car.z)).toBeLessThan(0.2);
        for (const spawn of map.spawns) expect(distance(car, spawn)).toBeGreaterThanOrEqual(8);
      }
      for (let i = 0; i < map.cars.length; i++) {
        for (let j = i + 1; j < map.cars.length; j++) {
          expect(distance(map.cars[i]!, map.cars[j]!)).toBeGreaterThan(15);
        }
      }
    }
  });

  it("el anillo no cierra siempre en el mismo lugar", () => {
    const centers = SEEDS.map((seed) => createShooterMap(createRng(seed)).ringCenter);
    const unique = new Set(centers.map((c) => `${c.x.toFixed(3)}:${c.z.toFixed(3)}`));
    expect(unique.size).toBe(SEEDS.length);
  });

  it("el centro del anillo no se va contra una pared", () => {
    for (const seed of SEEDS) {
      const { ringCenter } = createShooterMap(createRng(seed));
      expect(Math.hypot(ringCenter.x, ringCenter.z)).toBeLessThanOrEqual(40);
    }
  });
});
