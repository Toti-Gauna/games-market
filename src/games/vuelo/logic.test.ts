import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import { schemaDefaults } from "@/core/contract/settings";
import { flappySettings } from "./settings";
import {
  circleHitsPipe,
  createWorld,
  flap,
  gapForIndex,
  isPerfect,
  pickLoseMessage,
  runPoints,
  speedForPassed,
  stepWorld,
  tuningFromSettings,
  WORLD_HEIGHT,
  type FlappyTuning,
  type FlappyWorld,
  type Pipe,
} from "./logic";

const STEP = 1 / 60;

function defaultTuning(): FlappyTuning {
  return tuningFromSettings(schemaDefaults(flappySettings));
}

function pipeAt(world: FlappyWorld, index: number): Pipe {
  const pipe = world.pipes[index];
  if (!pipe) throw new Error("el mundo tiene que tener sus tubos pre-dimensionados");
  return pipe;
}

/** Corre una partida con un guion de aleteos fijo: sin azar de entrada. */
function playScripted(seed: string, steps: number, flapEvery: number): FlappyWorld {
  const tuning = defaultTuning();
  const rng = createRng(seed);
  const world = createWorld(tuning, rng);
  for (let i = 0; i < steps; i++) {
    if (i % flapEvery === 0) flap(world, tuning);
    stepWorld(world, STEP, tuning, rng);
  }
  return world;
}

function gapSequence(world: FlappyWorld): number[] {
  return world.pipes.map((pipe) => Math.round(pipe.gapY * 1000) / 1000);
}

describe("determinismo", () => {
  it("con la misma semilla y el mismo guion, dos partidas terminan idénticas", () => {
    const a = playScripted("supernova-7", 900, 22);
    const b = playScripted("supernova-7", 900, 22);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.pipesPassed).toBe(b.pipesPassed);
  });

  it("los huecos iniciales dependen de la semilla", () => {
    const tuning = defaultTuning();
    const one = createWorld(tuning, createRng("aaa"));
    const other = createWorld(tuning, createRng("zzz"));
    expect(gapSequence(one)).not.toEqual(gapSequence(other));
  });

  it("cada hueco cae dentro del mundo, con margen contra el techo y el piso", () => {
    const tuning = defaultTuning();
    const world = createWorld(tuning, createRng("margenes"));
    for (const pipe of world.pipes) {
      expect(pipe.gapY - pipe.gapH / 2).toBeGreaterThan(0);
      expect(pipe.gapY + pipe.gapH / 2).toBeLessThan(WORLD_HEIGHT);
    }
  });
});

describe("arranque", () => {
  it("no hay gravedad ni scroll hasta el primer impulso", () => {
    const tuning = defaultTuning();
    const rng = createRng("quieto");
    const world = createWorld(tuning, rng);
    const startX = pipeAt(world, 0).x;

    for (let i = 0; i < 120; i++) stepWorld(world, STEP, tuning, rng);

    expect(world.shipY).toBe(tuning.worldHeight / 2);
    expect(world.shipVy).toBe(0);
    expect(world.elapsedMs).toBe(0);
    expect(pipeAt(world, 0).x).toBe(startX);
  });

  it("el primer aleteo arranca la partida y aplica el impulso hacia arriba", () => {
    const tuning = defaultTuning();
    const world = createWorld(tuning, createRng("arranque"));
    expect(flap(world, tuning)).toBe(true);
    expect(world.started).toBe(true);
    expect(world.shipVy).toBe(tuning.flapImpulse);
    expect(tuning.flapImpulse).toBeLessThan(0);
  });
});

describe("scoring", () => {
  it("suma los puntos base más el bono por centrar", () => {
    const tuning = defaultTuning();
    expect(runPoints(10, 4, tuning)).toBe(10 * tuning.pointsPerPipe + 4 * tuning.perfectBonus);
    expect(runPoints(0, 0, tuning)).toBe(0);
  });

  it("un tubo se cobra una sola vez al cruzarlo", () => {
    const tuning = defaultTuning();
    const rng = createRng("cobro");
    const world = createWorld(tuning, rng);
    // Todos lejos menos uno, alineado con el centro de la nave.
    for (const pipe of world.pipes) pipe.x = 4000;
    const target = pipeAt(world, 0);
    target.x = tuning.shipX + tuning.pipeWidth;
    target.gapY = world.shipY;
    target.scored = false;
    world.started = true;

    for (let i = 0; i < 120; i++) {
      world.shipVy = 0;
      world.shipY = target.gapY;
      stepWorld(world, STEP, tuning, rng);
    }

    expect(world.pipesPassed).toBe(1);
    expect(world.perfectPasses).toBe(1);
  });

  it("pasar pegado al borde del hueco no cuenta como perfecto", () => {
    const pipe: Pipe = { alive: true, index: 0, x: 100, px: 100, gapY: 360, gapH: 200, scored: false };
    // Zona premiada del 30%: 30 px a cada lado de un hueco de 200.
    expect(isPerfect(360, pipe, 0.3)).toBe(true);
    expect(isPerfect(360 + 29, pipe, 0.3)).toBe(true);
    expect(isPerfect(360 + 31, pipe, 0.3)).toBe(false);
    expect(isPerfect(360 - 90, pipe, 0.3)).toBe(false);
  });

  it("el hueco se cierra con tope y la velocidad tiene techo", () => {
    const tuning = defaultTuning();
    expect(gapForIndex(tuning, 0)).toBe(tuning.pipeGap);
    expect(gapForIndex(tuning, 3)).toBeCloseTo(tuning.pipeGap - tuning.gapShrink * 3, 6);
    expect(gapForIndex(tuning, 10_000)).toBe(tuning.minGap);
    expect(speedForPassed(tuning, 0)).toBe(tuning.scrollSpeed);
    expect(speedForPassed(tuning, 10_000)).toBe(tuning.maxSpeed);
  });

  it("la frase de cierre es estable para el mismo resultado", () => {
    const messages = ["una", "dos", "tres"];
    expect(pickLoseMessage(messages, 4)).toBe(pickLoseMessage(messages, 4));
    expect(pickLoseMessage(messages, 4)).toBe("dos");
    expect(pickLoseMessage([], 4)).not.toBe("");
  });
});

describe("colisión", () => {
  const tuning = defaultTuning();
  const pipe: Pipe = { alive: true, index: 0, x: 130, px: 130, gapY: 360, gapH: 190, scored: false };

  it("volar por el centro del hueco no choca", () => {
    expect(circleHitsPipe(tuning.shipX, 360, tuning.hitRadius, pipe, tuning)).toBe(false);
  });

  it("el cuerpo del tubo choca arriba y abajo", () => {
    expect(circleHitsPipe(tuning.shipX, 40, tuning.hitRadius, pipe, tuning)).toBe(true);
    expect(circleHitsPipe(tuning.shipX, 690, tuning.hitRadius, pipe, tuning)).toBe(true);
  });

  it("el radio perdona: la punta del dibujo puede solapar el tubo sin morir", () => {
    const noseAhead = 18; // la punta de la nave, medida desde su centro
    const bodyY = 40; // a la altura del cuerpo del tubo, para aislar el eje x
    const grazing = pipe.x - (tuning.hitRadius + 2);
    expect(grazing + noseAhead).toBeGreaterThan(pipe.x); // el sprite entra en el tubo
    expect(circleHitsPipe(grazing, bodyY, tuning.hitRadius, pipe, tuning)).toBe(false);
    const inside = pipe.x - (tuning.hitRadius - 2);
    expect(circleHitsPipe(inside, bodyY, tuning.hitRadius, pipe, tuning)).toBe(true);
  });

  it("un tubo que todavía no llegó no colisiona", () => {
    const far: Pipe = { ...pipe, x: 400, px: 400 };
    expect(circleHitsPipe(tuning.shipX, 40, tuning.hitRadius, far, tuning)).toBe(false);
  });

  it("tocar el piso termina la partida", () => {
    const rng = createRng("piso");
    const world = createWorld(tuning, rng);
    for (const p of world.pipes) p.x = 4000;
    world.started = true;
    world.shipY = tuning.worldHeight - 40;
    world.shipVy = 400;

    for (let i = 0; i < 60 && !world.dead; i++) stepWorld(world, STEP, tuning, rng);

    expect(world.dead).toBe(true);
    expect(world.shipY).toBeLessThanOrEqual(tuning.worldHeight);
  });

  it("una vez muerta, la nave sigue cayendo y no suma más tubos", () => {
    const rng = createRng("caida");
    const world = createWorld(tuning, rng);
    world.started = true;
    world.dead = true;
    const before = world.shipY;
    for (let i = 0; i < 30; i++) stepWorld(world, STEP, tuning, rng);
    expect(world.shipY).toBeGreaterThan(before);
    expect(world.pipesPassed).toBe(0);
    expect(world.events.scored).toBe(false);
  });
});
