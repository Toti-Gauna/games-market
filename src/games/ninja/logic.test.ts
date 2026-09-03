import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import { schemaDefaults } from "@/core/contract/settings";
import { ninjaSettings } from "./settings";
import {
  beginStroke,
  bombChance,
  comboPoints,
  createNinjaWorld,
  createSliceResult,
  endStroke,
  segmentHitsCircle,
  sliceFruits,
  spawnWave,
  stepNinja,
  streakAward,
  tuningFromSettings,
  type Fruit,
  type NinjaTuning,
  type NinjaWorld,
} from "./logic";

const TUNING: NinjaTuning = tuningFromSettings(schemaDefaults(ninjaSettings));
const STEP = 1 / 60;
/** Cualquier velocidad por encima del minimo alcanza para cortar. */
const FAST = TUNING.minSliceSpeed * 4;

function fresh(seed: string, tuning: NinjaTuning = TUNING) {
  const rng = createRng(seed);
  return { world: createNinjaWorld(tuning), rng };
}

/** Coloca una fruta a mano para que el test no dependa del azar. */
function placeFruit(world: NinjaWorld, x: number, y: number, bomb = false, radius = 30): Fruit {
  for (let i = 0; i < world.fruits.length; i++) {
    const fruit = world.fruits[i];
    if (!fruit || fruit.alive) continue;
    fruit.alive = true;
    fruit.x = x;
    fruit.px = x;
    fruit.y = y;
    fruit.py = y;
    fruit.vx = 0;
    fruit.vy = 0;
    fruit.radius = radius;
    fruit.shape = 0;
    fruit.color = 0;
    fruit.bomb = bomb;
    fruit.rot = 0;
    fruit.prot = 0;
    fruit.spin = 0;
    return fruit;
  }
  throw new Error("no hay lugar para otra fruta");
}

function trace(seed: string, steps = 900): number[] {
  const { world, rng } = fresh(seed);
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    stepNinja(world, STEP, rng);
    if (i % 30 === 0) {
      out.push(world.waves, world.lives, world.missed);
      for (const fruit of world.fruits) {
        out.push(fruit.alive ? 1 : 0, Math.round(fruit.x * 100), Math.round(fruit.y * 100));
      }
    }
  }
  return out;
}

describe("determinismo", () => {
  it("la misma semilla lanza las mismas frutas en el mismo orden", () => {
    const a = fresh("abc7");
    const b = fresh("abc7");
    spawnWave(a.world, a.rng);
    spawnWave(b.world, b.rng);
    for (let i = 0; i < a.world.fruits.length; i++) {
      expect(a.world.fruits[i]?.alive).toBe(b.world.fruits[i]?.alive);
      expect(a.world.fruits[i]?.x).toBe(b.world.fruits[i]?.x);
      expect(a.world.fruits[i]?.vy).toBe(b.world.fruits[i]?.vy);
      expect(a.world.fruits[i]?.shape).toBe(b.world.fruits[i]?.shape);
    }
  });

  it("la misma semilla da la misma partida completa", () => {
    expect(trace("mismo")).toEqual(trace("mismo"));
  });

  it("semillas distintas divergen", () => {
    expect(trace("abc7")).not.toEqual(trace("zzz9"));
  });
});

describe("interseccion trazo-fruta", () => {
  it("un trazo que pasa por el centro corta", () => {
    expect(segmentHitsCircle(0, 100, 400, 100, 200, 100, 30)).toBe(true);
  });

  it("un trazo que pasa lejos no corta", () => {
    expect(segmentHitsCircle(0, 100, 400, 100, 200, 200, 30)).toBe(false);
  });

  it("roza el borde: la distancia al segmento cuenta, no al centro", () => {
    expect(segmentHitsCircle(0, 100, 400, 100, 200, 129, 30)).toBe(true);
    expect(segmentHitsCircle(0, 100, 400, 100, 200, 131, 30)).toBe(false);
  });

  it("la proyeccion se acota al segmento: la recta infinita no cuenta", () => {
    // El circulo esta sobre la prolongacion del segmento, pero fuera de el.
    expect(segmentHitsCircle(0, 100, 100, 100, 300, 100, 30)).toBe(false);
    // Y contra el extremo mas cercano, si.
    expect(segmentHitsCircle(0, 100, 100, 100, 120, 100, 30)).toBe(true);
  });

  it("un trazo de longitud cero se resuelve como punto contra circulo", () => {
    expect(segmentHitsCircle(200, 100, 200, 100, 210, 100, 30)).toBe(true);
    expect(segmentHitsCircle(200, 100, 200, 100, 400, 100, 30)).toBe(false);
  });

  it("la prueba del corte: un trazo rapido sobre tres frutas alineadas corta las tres", () => {
    const { world } = fresh("tres");
    placeFruit(world, 120, 400);
    placeFruit(world, 240, 400);
    placeFruit(world, 360, 400);

    // El dedo salta 400 px en un frame: con deteccion por punto, fallaria.
    const out = sliceFruits(world, 40, 400, 440, 400, FAST, createSliceResult());
    expect(out.count).toBe(3);
    expect(world.cut).toBe(3);
    expect(world.strokeCut).toBe(3);
  });

  it("apoyar el dedo y moverlo despacio no corta", () => {
    const { world } = fresh("lento");
    placeFruit(world, 240, 400);
    const out = sliceFruits(world, 200, 400, 280, 400, TUNING.minSliceSpeed - 1, createSliceResult());
    expect(out.count).toBe(0);
    expect(world.cut).toBe(0);
  });

  it("el angulo del trazo viaja en el resultado: define como se separan las mitades", () => {
    const { world } = fresh("angulo");
    placeFruit(world, 240, 400);
    const out = sliceFruits(world, 200, 360, 280, 440, FAST, createSliceResult());
    expect(out.angle).toBeCloseTo(Math.PI / 4, 5);
  });
});

describe("bombas", () => {
  it("cortar una bomba termina la partida en el acto", () => {
    const { world } = fresh("bomba");
    placeFruit(world, 240, 400, true);
    const out = sliceFruits(world, 40, 400, 440, 400, FAST, createSliceResult());
    expect(out.bomb).toBe(true);
    expect(world.over).toBe(true);
    expect(world.overReason).toBe("bomba");
  });

  it("la bomba corta el trazo: lo que estaba detras no se cobra", () => {
    const { world } = fresh("bomba-corta");
    placeFruit(world, 120, 400, true);
    placeFruit(world, 360, 400);
    sliceFruits(world, 40, 400, 440, 400, FAST, createSliceResult());
    expect(world.cut).toBe(0);
    expect(world.points).toBe(0);
  });

  it("terminada la partida no se corta mas nada", () => {
    const { world } = fresh("cerrado");
    world.over = true;
    placeFruit(world, 240, 400);
    const out = sliceFruits(world, 40, 400, 440, 400, FAST, createSliceResult());
    expect(out.count).toBe(0);
  });

  it("la probabilidad de bomba arranca en cero y crece hasta su techo", () => {
    expect(bombChance(0, TUNING)).toBe(0);
    expect(bombChance(TUNING.bombFromPoints - 1, TUNING)).toBe(0);
    expect(bombChance(TUNING.bombFromPoints, TUNING)).toBe(0);
    expect(bombChance(TUNING.bombFromPoints + TUNING.bombRamp / 2, TUNING)).toBeCloseTo(
      TUNING.bombMaxChance / 2,
      6,
    );
    expect(bombChance(999_999, TUNING)).toBeCloseTo(TUNING.bombMaxChance, 6);
  });

  it("una bomba que cae sola no cuesta vidas", () => {
    const { world, rng } = fresh("bomba-cae");
    world.spawnTimer = 999;
    placeFruit(world, 240, TUNING.worldHeight + 60, true);
    for (let i = 0; i < 60; i++) stepNinja(world, STEP, rng);
    expect(world.lives).toBe(TUNING.lives);
    expect(world.missed).toBe(0);
  });
});

describe("vidas y caidas", () => {
  it("una fruta que cae sin cortar cuesta una vida y corta la racha", () => {
    const { world, rng } = fresh("caida");
    world.spawnTimer = 999;
    world.streak = 5;
    placeFruit(world, 240, TUNING.worldHeight + 60);
    for (let i = 0; i < 60 && world.missed === 0; i++) stepNinja(world, STEP, rng);
    expect(world.missed).toBe(1);
    expect(world.lives).toBe(TUNING.lives - 1);
    expect(world.streak).toBe(0);
  });

  it("sin vidas se termina la partida", () => {
    const { world, rng } = fresh("sin-vidas");
    world.spawnTimer = 999;
    world.lives = 1;
    placeFruit(world, 240, TUNING.worldHeight + 60);
    for (let i = 0; i < 60 && !world.over; i++) stepNinja(world, STEP, rng);
    expect(world.over).toBe(true);
    expect(world.overReason).toBe("vidas");
  });

  it("la fruta sube y vuelve: la parabola no se va para arriba para siempre", () => {
    const { world, rng } = fresh("parabola");
    world.spawnTimer = 999;
    const fruit = placeFruit(world, 240, TUNING.worldHeight);
    fruit.vy = -800;
    let apex = fruit.y;
    for (let i = 0; i < 60; i++) {
      stepNinja(world, STEP, rng);
      if (fruit.y < apex) apex = fruit.y;
    }
    expect(apex).toBeLessThan(TUNING.worldHeight - 200);
    expect(fruit.vy).toBeGreaterThan(0);
  });
});

describe("puntaje", () => {
  it("cada fruta paga lo suyo", () => {
    const { world } = fresh("puntos");
    placeFruit(world, 240, 400);
    sliceFruits(world, 40, 400, 440, 400, FAST, createSliceResult());
    expect(world.points).toBe(TUNING.pointsPerFruit);
  });

  it("menos de tres en un trazo no dan combo", () => {
    expect(comboPoints(2, TUNING)).toBe(0);
    expect(comboPoints(3, TUNING)).toBe(3 * TUNING.comboPerFruit);
    expect(comboPoints(5, TUNING)).toBe(5 * TUNING.comboPerFruit);
  });

  it("el combo se paga al cerrar el trazo", () => {
    const { world } = fresh("combo");
    beginStroke(world);
    placeFruit(world, 120, 400);
    placeFruit(world, 240, 400);
    placeFruit(world, 360, 400);
    sliceFruits(world, 40, 400, 440, 400, FAST, createSliceResult());
    expect(world.points).toBe(3 * TUNING.pointsPerFruit);

    const combo = endStroke(world);
    expect(combo).toBe(3 * TUNING.comboPerFruit);
    expect(world.points).toBe(3 * TUNING.pointsPerFruit + 3 * TUNING.comboPerFruit);
    expect(world.bestCombo).toBe(3);
    expect(world.strokeCut).toBe(0);
  });

  it("la racha paga cada vez que cruza el multiplo", () => {
    expect(streakAward(0, TUNING)).toBe(0);
    expect(streakAward(9, TUNING)).toBe(0);
    expect(streakAward(TUNING.streakLength, TUNING)).toBe(TUNING.streakBonus);
    expect(streakAward(TUNING.streakLength * 2, TUNING)).toBe(TUNING.streakBonus);
  });

  it("diez cortes seguidos suman el bono de racha una sola vez", () => {
    const { world } = fresh("racha");
    const out = createSliceResult();
    for (let i = 0; i < TUNING.streakLength; i++) {
      beginStroke(world);
      placeFruit(world, 240, 400);
      sliceFruits(world, 40, 400, 440, 400, FAST, out);
      endStroke(world);
    }
    expect(world.streak).toBe(TUNING.streakLength);
    expect(world.bestStreak).toBe(TUNING.streakLength);
    expect(world.points).toBe(TUNING.streakLength * TUNING.pointsPerFruit + TUNING.streakBonus);
  });
});
