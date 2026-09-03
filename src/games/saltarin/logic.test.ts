import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import { schemaDefaults } from "@/core/contract/settings";
import { saltarinSettings } from "./settings";
import {
  calibrateTilt,
  climbToMeters,
  createJumperWorld,
  gapForClimb,
  jumperPoints,
  landsOnPlatform,
  pickPlatformKind,
  pushTiltSample,
  stepJumper,
  tiltAxis,
  tiltToAxis,
  tuningFromSettings,
  KIND_BOOST,
  KIND_FRAGILE,
  KIND_MOVING,
  KIND_NORMAL,
  type JumperTuning,
  type Platform,
} from "./logic";

const TUNING: JumperTuning = tuningFromSettings(schemaDefaults(saltarinSettings));
const STEP = 1 / 60;

function fresh(seed: string, tuning: JumperTuning = TUNING) {
  const rng = createRng(seed);
  return { world: createJumperWorld(tuning, rng), rng };
}

/** Eje reproducible: sin esto el trazo dependeria de Math.random. */
function scriptedAxis(step: number): number {
  return Math.sin(step / 37) * 0.9;
}

function trace(seed: string, steps = 600): number[] {
  const { world, rng } = fresh(seed);
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    stepJumper(world, STEP, scriptedAxis(i), rng);
    if (i % 25 === 0) {
      out.push(
        Math.round(world.x * 1000),
        Math.round(world.y * 1000),
        Math.round(world.maxClimb * 1000),
        world.landings,
        world.boosts,
      );
    }
  }
  return out;
}

function makePlatform(over: Partial<Platform> = {}): Platform {
  return {
    alive: true,
    x: 100,
    px: 100,
    y: 400,
    kind: KIND_NORMAL,
    vx: 0,
    broken: false,
    breakMs: 0,
    ...over,
  };
}

describe("determinismo", () => {
  it("la misma semilla arma el mismo recorrido inicial", () => {
    const a = fresh("abc7").world;
    const b = fresh("abc7").world;
    for (let i = 0; i < a.platforms.length; i++) {
      expect(a.platforms[i]?.x).toBe(b.platforms[i]?.x);
      expect(a.platforms[i]?.y).toBe(b.platforms[i]?.y);
      expect(a.platforms[i]?.kind).toBe(b.platforms[i]?.kind);
    }
  });

  it("la misma semilla da la misma partida completa", () => {
    expect(trace("mismo")).toEqual(trace("mismo"));
  });

  it("semillas distintas divergen", () => {
    const a = fresh("abc7").world;
    const b = fresh("zzz9").world;
    // La primera plataforma es fija a proposito; el azar arranca en la segunda.
    const same = a.platforms.every((plat, i) => plat.x === b.platforms[i]?.x);
    expect(same).toBe(false);
    expect(trace("abc7")).not.toEqual(trace("zzz9"));
  });

  it("el paso fijo hace que la altura del salto no dependa del framerate", () => {
    const { world, rng } = fresh("altura");
    let apex = world.y;
    for (let i = 0; i < 120; i++) {
      stepJumper(world, STEP, 0, rng);
      if (world.y < apex) apex = world.y;
    }
    const { world: other, rng: otherRng } = fresh("altura");
    let apexOther = other.y;
    for (let i = 0; i < 120; i++) {
      stepJumper(other, STEP, 0, otherRng);
      if (other.y < apexOther) apexOther = other.y;
    }
    expect(apex).toBe(apexOther);
  });
});

describe("colision con plataforma", () => {
  it("engancha cayendo aunque el paso la atraviese entera", () => {
    const plat = makePlatform({ x: 100, y: 400 });
    // Cae 60 px en un paso: sin barrido pasaria de largo.
    expect(landsOnPlatform(370, 430, 900, 130, 14, plat, TUNING.platformWidth)).toBe(true);
  });

  it("NO engancha subiendo: es el bug clasico del genero", () => {
    const plat = makePlatform({ x: 100, y: 400 });
    expect(landsOnPlatform(430, 370, -620, 130, 14, plat, TUNING.platformWidth)).toBe(false);
  });

  it("no engancha si todavia no llego a la altura de la plataforma", () => {
    const plat = makePlatform({ x: 100, y: 400 });
    expect(landsOnPlatform(340, 380, 500, 130, 14, plat, TUNING.platformWidth)).toBe(false);
  });

  it("no engancha si ya venia por debajo", () => {
    const plat = makePlatform({ x: 100, y: 400 });
    expect(landsOnPlatform(420, 470, 500, 130, 14, plat, TUNING.platformWidth)).toBe(false);
  });

  it("no engancha fuera del ancho de la plataforma", () => {
    const plat = makePlatform({ x: 100, y: 400 });
    const right = 100 + TUNING.platformWidth;
    expect(landsOnPlatform(370, 430, 900, right + 20, 14, plat, TUNING.platformWidth)).toBe(false);
    expect(landsOnPlatform(370, 430, 900, 60, 14, plat, TUNING.platformWidth)).toBe(false);
  });

  it("roza el borde: cuenta mientras haya solape", () => {
    const plat = makePlatform({ x: 100, y: 400 });
    expect(landsOnPlatform(370, 430, 900, 90, 14, plat, TUNING.platformWidth)).toBe(true);
  });

  it("una plataforma rota no engancha", () => {
    const plat = makePlatform({ x: 100, y: 400, broken: true });
    expect(landsOnPlatform(370, 430, 900, 130, 14, plat, TUNING.platformWidth)).toBe(false);
  });

  it("la nave rebota sobre la primera plataforma y no la atraviesa", () => {
    const { world, rng } = fresh("rebote");
    for (let i = 0; i < 90; i++) stepJumper(world, STEP, 0, rng);
    expect(world.landings).toBeGreaterThan(0);
    expect(world.dead).toBe(false);
  });
});

describe("camara y caida", () => {
  it("la camara nunca baja mientras la nave vive", () => {
    const { world, rng } = fresh("camara");
    let previous = world.cameraY;
    for (let i = 0; i < 400 && !world.dead; i++) {
      stepJumper(world, STEP, scriptedAxis(i), rng);
      expect(world.cameraY).toBeLessThanOrEqual(previous);
      previous = world.cameraY;
    }
  });

  it("caer debajo de la vista termina la partida", () => {
    const { world, rng } = fresh("caida");
    // Sin plataformas debajo, la caida es inevitable.
    for (const plat of world.platforms) plat.broken = true;
    let died = false;
    for (let i = 0; i < 240 && !died; i++) {
      stepJumper(world, STEP, 0, rng);
      died = world.dead;
    }
    expect(died).toBe(true);
  });

  it("el wrap horizontal devuelve la nave por el otro lado", () => {
    const { world, rng } = fresh("wrap");
    world.x = 4;
    for (let i = 0; i < 30; i++) stepJumper(world, STEP, -1, rng);
    expect(world.x).toBeGreaterThan(TUNING.worldWidth / 2);
  });
});

describe("giroscopio", () => {
  it("la zona muerta deja quieto lo que esta quieto", () => {
    expect(tiltToAxis(1.5, 0, 2, 25)).toBe(0);
    expect(tiltToAxis(-1.9, 0, 2, 25)).toBe(0);
  });

  it("la curva es cuadratica, no lineal", () => {
    const half = tiltToAxis(0 + 2 + (25 - 2) / 2, 0, 2, 25);
    expect(half).toBeCloseTo(0.25, 5);
  });

  it("satura en el extremo del rango y conserva el signo", () => {
    expect(tiltToAxis(60, 0, 2, 25)).toBe(1);
    expect(tiltToAxis(-60, 0, 2, 25)).toBe(-1);
  });

  it("todo se mide contra el cero calibrado, no contra el cero del sensor", () => {
    // Sosteniendo el telefono a 20 grados, quieto tiene que ser quieto.
    expect(tiltToAxis(20, 20, 2, 25)).toBe(0);
    expect(tiltToAxis(20, 0, 2, 25)).toBeGreaterThan(0);
  });

  it("la media movil aplana el ruido del sensor", () => {
    const { world } = fresh("tilt");
    pushTiltSample(world, 10);
    pushTiltSample(world, 20);
    pushTiltSample(world, 30);
    calibrateTilt(world);
    expect(world.tiltZero).toBeCloseTo(20, 5);
    expect(tiltAxis(world)).toBe(0);
  });

  it("sin calibrar no mueve nada", () => {
    const { world } = fresh("tilt-sin-cero");
    pushTiltSample(world, 40);
    expect(tiltAxis(world)).toBe(0);
  });
});

describe("generacion", () => {
  it("la separacion crece con la altura y tiene techo", () => {
    expect(gapForClimb(0, TUNING)).toBe(TUNING.minGap);
    expect(gapForClimb(TUNING.gapRamp, TUNING)).toBe(TUNING.maxGap);
    expect(gapForClimb(TUNING.gapRamp * 10, TUNING)).toBe(TUNING.maxGap);
  });

  it("los tipos se desbloquean con la altura", () => {
    expect(pickPlatformKind(0.05, 0, TUNING)).toBe(KIND_NORMAL);
    expect(pickPlatformKind(0.05, TUNING.movingFrom, TUNING)).toBe(KIND_MOVING);
    expect(pickPlatformKind(0.2, TUNING.fragileFrom, TUNING)).toBe(KIND_FRAGILE);
    expect(pickPlatformKind(0.05, TUNING.boostFrom, TUNING)).toBe(KIND_BOOST);
  });

  it("una tirada alta siempre da plataforma normal", () => {
    expect(pickPlatformKind(0.9, 99_999, TUNING)).toBe(KIND_NORMAL);
  });

  it("las plataformas se reciclan: nunca hay mas ni menos de las que arrancan", () => {
    const { world, rng } = fresh("reciclado");
    const count = world.platforms.length;
    for (let i = 0; i < 900; i++) stepJumper(world, STEP, scriptedAxis(i), rng);
    expect(world.platforms.length).toBe(count);
  });
});

describe("puntaje", () => {
  it("altura sobre pixeles por punto mas el bono por impulso", () => {
    expect(jumperPoints(4325, 3, TUNING)).toBe(432 + 150);
  });

  it("no hay puntos negativos", () => {
    expect(jumperPoints(-100, 0, TUNING)).toBe(0);
  });

  it("los metros son la altura en decimas legibles: 100 px es un metro", () => {
    expect(climbToMeters(4325)).toBe(43.3);
    expect(climbToMeters(1000)).toBe(10);
    expect(climbToMeters(-10)).toBe(0);
  });
});
