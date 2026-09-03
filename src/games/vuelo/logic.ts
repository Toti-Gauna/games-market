import { clamp } from "@/core/engine/collide";
import type { Rng } from "@/core/engine/rng";
import { bool, num, str, type SettingsValues } from "@/core/contract/settings";

/**
 * Vuelo (M3) - la simulacion, sin React ni canvas.
 *
 * Todo lo que decide la partida vive aca: generacion de tubos con el PRNG
 * sembrado, colision y scoring. Separado del componente porque es lo unico que
 * hay que testear, y porque con la misma semilla dos participantes tienen que
 * recorrer exactamente el mismo corredor.
 *
 * Ninguna funcion que corre por frame asigna objetos: mutan estructuras
 * creadas al iniciar. Es la regla de cero basura dentro del loop.
 */

/** Mundo vertical: se juega con el telefono como esta. */
export const WORLD_WIDTH = 480;
export const WORLD_HEIGHT = 720;
/** La nave no se mueve en x; el mundo viene hacia ella. */
export const SHIP_X = 140;
/** Seis alcanzan para llenar la pantalla y el margen de la derecha. */
export const PIPE_COUNT = 6;

const EDGE_MARGIN = 56;
const FIRST_PIPE_OFFSET = 220;
/** Aire libre arriba del borde: tocar el techo no mata de una. */
const CEILING_SLACK = 60;
/** Empujon hacia arriba al chocar un tubo, para que la caida se lea. */
const CRASH_POP = -150;

export type FlappyTuning = {
  worldWidth: number;
  worldHeight: number;
  shipX: number;
  gravity: number;
  /** Negativo: en canvas el eje y crece hacia abajo. */
  flapImpulse: number;
  maxFallSpeed: number;
  hitRadius: number;
  pipeGap: number;
  gapShrink: number;
  minGap: number;
  pipeSpacing: number;
  pipeWidth: number;
  scrollSpeed: number;
  speedStep: number;
  maxSpeed: number;
  /** Fraccion central del hueco que cuenta como paso perfecto, 0..1. */
  perfectZone: number;
  pointsPerPipe: number;
  perfectBonus: number;
  timeBonus: boolean;
  maxTimeBonus: number;
  trail: boolean;
  parallax: boolean;
};

export type Pipe = {
  /** Los tubos se reciclan: siempre vivos, nunca creados ni destruidos. */
  alive: boolean;
  index: number;
  x: number;
  /** x del paso anterior, para interpolar el dibujo con el alpha del loop. */
  px: number;
  gapY: number;
  gapH: number;
  scored: boolean;
};

/** Se reescriben en cada paso: el componente los lee para sonido y HUD. */
export type FlappyEvents = {
  scored: boolean;
  perfect: boolean;
  crashed: boolean;
};

export type FlappyWorld = {
  shipY: number;
  shipPrevY: number;
  shipVy: number;
  /** La gravedad no corre hasta el primer impulso. */
  started: boolean;
  dead: boolean;
  deathMs: number;
  elapsedMs: number;
  pipesPassed: number;
  perfectPasses: number;
  /** Cuantos tubos se generaron: define el hueco del proximo reciclado. */
  spawned: number;
  speed: number;
  pipes: Pipe[];
  events: FlappyEvents;
};

const DIFFICULTY: Record<string, { gap: number; speed: number }> = {
  relaxed: { gap: 1.15, speed: 0.9 },
  classic: { gap: 1, speed: 1 },
  hard: { gap: 0.85, speed: 1.15 },
};

/** Los administrables entran una sola vez y salen tipados. */
export function tuningFromSettings(values: SettingsValues): FlappyTuning {
  const preset = DIFFICULTY[str(values, "difficulty", "classic")];
  const gapScale = preset ? preset.gap : 1;
  const speedScale = preset ? preset.speed : 1;
  const minGap = num(values, "minGap", 130) * gapScale;
  const gap = num(values, "pipeGap", 190) * gapScale;

  return {
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    shipX: SHIP_X,
    gravity: num(values, "gravity", 1800),
    flapImpulse: -Math.abs(num(values, "flapImpulse", 520)),
    maxFallSpeed: num(values, "maxFallSpeed", 780),
    hitRadius: num(values, "hitRadius", 14),
    pipeGap: Math.max(gap, minGap),
    gapShrink: num(values, "gapShrink", 1.5),
    minGap,
    pipeSpacing: num(values, "pipeSpacing", 260),
    pipeWidth: num(values, "pipeWidth", 62),
    scrollSpeed: num(values, "scrollSpeed", 160) * speedScale,
    speedStep: num(values, "speedStep", 2),
    maxSpeed: num(values, "maxSpeed", 260) * speedScale,
    perfectZone: clamp(num(values, "perfectZone", 30) / 100, 0.05, 1),
    pointsPerPipe: num(values, "pointsPerPipe", 100),
    perfectBonus: num(values, "perfectBonus", 25),
    timeBonus: bool(values, "timeBonus", true),
    maxTimeBonus: num(values, "maxTimeBonus", 200),
    trail: bool(values, "trail", true),
    parallax: bool(values, "parallax", true),
  };
}

/** El hueco se cierra de a poco y tiene piso: nunca se vuelve imposible. */
export function gapForIndex(tuning: FlappyTuning, index: number): number {
  return Math.max(tuning.minGap, tuning.pipeGap - tuning.gapShrink * index);
}

export function speedForPassed(tuning: FlappyTuning, passed: number): number {
  return Math.min(tuning.maxSpeed, tuning.scrollSpeed + tuning.speedStep * passed);
}

/** Altura del centro del hueco. Unica fuente de azar del juego. */
export function randomGapY(tuning: FlappyTuning, rng: Rng, gapH: number): number {
  const min = EDGE_MARGIN + gapH / 2;
  const max = tuning.worldHeight - EDGE_MARGIN - gapH / 2;
  return max <= min ? tuning.worldHeight / 2 : rng.range(min, max);
}

export function isPerfect(shipY: number, pipe: Pipe, zone: number): boolean {
  return Math.abs(shipY - pipe.gapY) <= (pipe.gapH * zone) / 2;
}

/**
 * Circulo contra los dos rectangulos del tubo, en numeros sueltos.
 * No usa `circleHitsBox` de la base porque armar dos cajas por tubo y por
 * frame es basura para el GC; la cuenta es la misma y reusa su `clamp`.
 */
export function circleHitsPipe(
  cx: number,
  cy: number,
  r: number,
  pipe: Pipe,
  tuning: FlappyTuning,
): boolean {
  const nx = clamp(cx, pipe.x, pipe.x + tuning.pipeWidth);
  const dx = cx - nx;
  if (dx * dx >= r * r) return false;

  const topEnd = pipe.gapY - pipe.gapH / 2;
  const bottomStart = pipe.gapY + pipe.gapH / 2;

  // El tubo de arriba nace fuera de pantalla y el de abajo muere fuera.
  const dyTop = cy - clamp(cy, -tuning.worldHeight, topEnd);
  if (dx * dx + dyTop * dyTop < r * r) return true;

  const dyBottom = cy - clamp(cy, bottomStart, tuning.worldHeight * 2);
  return dx * dx + dyBottom * dyBottom < r * r;
}

export function runPoints(pipesPassed: number, perfectPasses: number, tuning: FlappyTuning): number {
  return pipesPassed * tuning.pointsPerPipe + perfectPasses * tuning.perfectBonus;
}

/** Mismo resultado, misma frase: el cierre no se sortea. */
export function pickLoseMessage(messages: readonly string[], pipesPassed: number): string {
  const fallback = "Se terminó el vuelo.";
  if (messages.length === 0) return fallback;
  const index = Math.abs(Math.trunc(pipesPassed)) % messages.length;
  return messages[index] ?? fallback;
}

export function createWorld(tuning: FlappyTuning, rng: Rng): FlappyWorld {
  const pipes: Pipe[] = new Array<Pipe>(PIPE_COUNT);
  for (let i = 0; i < PIPE_COUNT; i++) {
    const gapH = gapForIndex(tuning, i);
    const x = tuning.worldWidth + FIRST_PIPE_OFFSET + i * tuning.pipeSpacing;
    pipes[i] = {
      alive: true,
      index: i,
      x,
      px: x,
      gapY: randomGapY(tuning, rng, gapH),
      gapH,
      scored: false,
    };
  }

  return {
    shipY: tuning.worldHeight / 2,
    shipPrevY: tuning.worldHeight / 2,
    shipVy: 0,
    started: false,
    dead: false,
    deathMs: 0,
    elapsedMs: 0,
    pipesPassed: 0,
    perfectPasses: 0,
    spawned: PIPE_COUNT,
    speed: tuning.scrollSpeed,
    pipes,
    events: { scored: false, perfect: false, crashed: false },
  };
}

/** Devuelve si el impulso conto, para que el componente suene una sola vez. */
export function flap(world: FlappyWorld, tuning: FlappyTuning): boolean {
  if (world.dead) return false;
  world.started = true;
  world.shipVy = tuning.flapImpulse;
  return true;
}

function rightmostX(pipes: readonly Pipe[]): number {
  let max = -Infinity;
  for (let i = 0; i < pipes.length; i++) {
    const pipe = pipes[i];
    if (pipe && pipe.x > max) max = pipe.x;
  }
  return max;
}

function crash(world: FlappyWorld, pop: number): void {
  world.dead = true;
  world.events.crashed = true;
  world.shipVy = pop;
}

/**
 * Un paso de simulacion. `dt` es siempre el mismo: con delta variable la
 * misma pulsacion daria alturas distintas en un telefono lento y en el
 * proyector, y dejaria de ser el mismo juego.
 */
export function stepWorld(world: FlappyWorld, dt: number, tuning: FlappyTuning, rng: Rng): void {
  const events = world.events;
  events.scored = false;
  events.perfect = false;
  events.crashed = false;

  world.shipPrevY = world.shipY;

  if (world.dead) {
    world.deathMs += dt * 1000;
    world.shipVy = Math.min(world.shipVy + tuning.gravity * dt, tuning.maxFallSpeed);
    world.shipY += world.shipVy * dt;
    return;
  }

  // Antes del primer toque la nave flota: nadie pierde mientras lee la pantalla.
  if (!world.started) return;

  world.elapsedMs += dt * 1000;
  world.speed = speedForPassed(tuning, world.pipesPassed);
  world.shipVy = Math.min(world.shipVy + tuning.gravity * dt, tuning.maxFallSpeed);
  world.shipY += world.shipVy * dt;

  const advance = world.speed * dt;
  const half = tuning.pipeWidth / 2;

  for (let i = 0; i < world.pipes.length; i++) {
    const pipe = world.pipes[i];
    if (!pipe) continue;
    pipe.px = pipe.x;
    pipe.x -= advance;

    if (pipe.x + tuning.pipeWidth < 0) {
      // Reciclado: el que sale por la izquierda vuelve a la derecha con hueco nuevo.
      const gapH = gapForIndex(tuning, world.spawned);
      pipe.index = world.spawned;
      pipe.gapH = gapH;
      pipe.gapY = randomGapY(tuning, rng, gapH);
      pipe.x = rightmostX(world.pipes) + tuning.pipeSpacing;
      pipe.px = pipe.x;
      pipe.scored = false;
      world.spawned++;
      continue;
    }

    if (!pipe.scored && pipe.x + half <= tuning.shipX) {
      pipe.scored = true;
      world.pipesPassed++;
      events.scored = true;
      if (isPerfect(world.shipY, pipe, tuning.perfectZone)) {
        world.perfectPasses++;
        events.perfect = true;
      }
    }
  }

  if (world.shipY + tuning.hitRadius >= tuning.worldHeight) {
    world.shipY = tuning.worldHeight - tuning.hitRadius;
    crash(world, 0);
    return;
  }
  if (world.shipY < -CEILING_SLACK) {
    crash(world, 0);
    return;
  }

  for (let i = 0; i < world.pipes.length; i++) {
    const pipe = world.pipes[i];
    if (!pipe) continue;
    if (circleHitsPipe(tuning.shipX, world.shipY, tuning.hitRadius, pipe, tuning)) {
      crash(world, CRASH_POP);
      return;
    }
  }
}
