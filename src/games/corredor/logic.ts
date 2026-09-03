import type { Rng } from "@/core/engine/rng";
import { eligiblePatterns, type ObstacleKind, type Pattern } from "./patterns";

/**
 * Logica de Corredor. Sin React, sin Pixi, sin DOM.
 *
 * Dos cosas que parecen detalles y son el juego:
 *
 * 1. **La pista se genera por tramos validados**, no obstaculo por obstaculo.
 * 2. **Buffer de entrada y perdon de coyote.** Son la diferencia entre un
 *    runner justo y uno sordo: sin ellos el jugador toca, no pasa nada, y
 *    culpa al juego — con razon.
 *
 * Y una tercera que hace honesto al multijugador: como la pista es identica
 * para todos, de una silueta solo hace falta su distancia. La altura **se
 * deriva**; mandarla seria mandar informacion que el otro ya tiene.
 */

/* ------------------------------------------------------------------ */
/* Constantes del mundo                                                 */
/* ------------------------------------------------------------------ */

export const WORLD_W = 960;
export const WORLD_H = 540;
/** Altura del piso. Debajo de esto no hay nada. */
export const GROUND_Y = 430;
/** Donde corre el jugador, fijo: la camara lo sigue. */
export const RUNNER_X = 180;
export const RUNNER_W = 34;
export const RUNNER_H = 64;
/** Agachado mide la mitad. */
export const SLIDE_H = 32;

export const PX_PER_METER = 20;

export const JUMP_VY = -680;
export const GRAVITY = 2000;
export const SLIDE_MS = 500;
/** Si se toca hasta 120 ms antes de aterrizar, el salto sale al tocar el piso. */
export const JUMP_BUFFER_MS = 120;
/** Se puede saltar hasta 100 ms despues de haber dejado el piso. */
export const COYOTE_MS = 100;
/** Pasar a menos de esto de un obstaculo cuenta como roce. */
export const GRAZE_PX = 20;

export type RunnerState = "running" | "jumping" | "sliding" | "dead";

/* ------------------------------------------------------------------ */
/* La pista                                                             */
/* ------------------------------------------------------------------ */

export type Obstacle = {
  kind: ObstacleKind;
  /** Posicion absoluta en px desde el arranque de la carrera. */
  x: number;
  width: number;
  /** Alto de la caja de colision. Para `gap` es 0: el peligro es el vacio. */
  height: number;
  /** Base de la caja. Para `highBar` cuelga del techo. */
  top: number;
  /** Ya se sumo su roce: no se cobra dos veces. */
  grazed: boolean;
  /** Fase para los moviles, en radianes. */
  phase: number;
};

export type Track = {
  obstacles: Obstacle[];
  /** Hasta donde esta generada, en px. */
  generatedTo: number;
  /** Ids de los tramos emitidos, en orden. Es lo que compara el test de semilla. */
  emitted: string[];
};

export function speedAt(meters: number, base: number, gain: number, cap: number): number {
  return Math.min(cap, base + Math.floor(meters / 100) * gain);
}

/**
 * Separacion minima entre tramos: el tiempo de reaccion a la velocidad actual.
 * A 900 px/s son unos 400 px, y crece con la velocidad porque el jugador
 * necesita el mismo tiempo, no la misma distancia.
 */
export function reactionGap(speed: number): number {
  const REACTION_S = 0.45;
  return Math.max(220, speed * REACTION_S);
}

function boxFor(kind: ObstacleKind, x: number, width: number): Obstacle {
  switch (kind) {
    case "lowBlock":
      return { kind, x, width, height: 48, top: GROUND_Y - 48, grazed: false, phase: 0 };
    case "doubleBlock":
      return { kind, x, width, height: 130, top: GROUND_Y - 130, grazed: false, phase: 0 };
    case "highBar":
      // Cuelga del techo: por debajo se pasa agachado y nada mas.
      return { kind, x, width, height: 150, top: GROUND_Y - 150 - SLIDE_H, grazed: false, phase: 0 };
    case "movingBlock":
      return { kind, x, width, height: 54, top: GROUND_Y - 54, grazed: false, phase: 0 };
    case "gap":
      return { kind, x, width, height: 0, top: GROUND_Y, grazed: false, phase: 0 };
  }
}

export function createTrack(): Track {
  return { obstacles: [], generatedTo: WORLD_W, emitted: [] };
}

/**
 * Genera hasta `untilX`. Determinista: con la misma semilla y la misma
 * secuencia de llamadas sale exactamente la misma pista, que es lo que hace
 * comparables los puntajes y honestas a las siluetas.
 */
export function generateTrack(
  track: Track,
  untilX: number,
  rng: Rng,
  rules: { baseSpeed: number; speedGain: number; maxSpeed: number },
): void {
  while (track.generatedTo < untilX) {
    const meters = track.generatedTo / PX_PER_METER;
    const speed = speedAt(meters, rules.baseSpeed, rules.speedGain, rules.maxSpeed);
    const options = eligiblePatterns(meters, speed);
    if (options.length === 0) {
      track.generatedTo += reactionGap(speed);
      continue;
    }

    const pattern = rng.pick(options) as Pattern;
    const startX = track.generatedTo + reactionGap(speed);
    for (const piece of pattern.pieces) {
      track.obstacles.push(boxFor(piece.kind, startX + piece.dx, piece.width));
    }
    track.emitted.push(pattern.id);
    track.generatedTo = startX + pattern.length;
  }
}

/** Suelta los obstaculos que ya quedaron muy atras. Evita que la lista crezca sin fin. */
export function pruneTrack(track: Track, cameraX: number): void {
  const cutoff = cameraX - WORLD_W;
  let keep = 0;
  for (let i = 0; i < track.obstacles.length; i++) {
    const obstacle = track.obstacles[i] as Obstacle;
    if (obstacle.x + obstacle.width >= cutoff) {
      track.obstacles[keep++] = obstacle;
    }
  }
  track.obstacles.length = keep;
}

/** true si en esa X hay vacio en el piso. */
export function isGapAt(track: Track, x: number): boolean {
  for (const obstacle of track.obstacles) {
    if (obstacle.kind !== "gap") continue;
    if (x >= obstacle.x && x <= obstacle.x + obstacle.width) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* El corredor                                                          */
/* ------------------------------------------------------------------ */

export type Runner = {
  /** Distancia recorrida en px. Es tambien la X del mundo. */
  x: number;
  /** Altura del pie sobre el piso. 0 = apoyado. */
  y: number;
  vy: number;
  onGround: boolean;
  /** Saltos que quedan en el aire. El doble salto es uno solo. */
  airJumps: number;
  slideMs: number;
  /** ms desde que dejo el piso. Alimenta el perdon de coyote. */
  sinceGroundMs: number;
  /** ms que le quedan de vida al pedido de salto. Alimenta el buffer. */
  bufferMs: number;
  dead: boolean;
  coins: number;
  grazes: number;
};

export function createRunner(): Runner {
  return {
    x: 0,
    y: 0,
    vy: 0,
    onGround: true,
    airJumps: 1,
    slideMs: 0,
    sinceGroundMs: 0,
    bufferMs: 0,
    dead: false,
    coins: 0,
    grazes: 0,
  };
}

/** El jugador pidio saltar. Se guarda: puede que todavia no se pueda. */
export function requestJump(runner: Runner): void {
  runner.bufferMs = JUMP_BUFFER_MS;
}

export function requestSlide(runner: Runner): void {
  if (runner.onGround && runner.slideMs <= 0) runner.slideMs = SLIDE_MS;
}

export function runnerState(runner: Runner): RunnerState {
  if (runner.dead) return "dead";
  if (!runner.onGround) return "jumping";
  return runner.slideMs > 0 ? "sliding" : "running";
}

export function runnerHeight(runner: Runner): number {
  return runner.slideMs > 0 && runner.onGround ? SLIDE_H : RUNNER_H;
}

/**
 * Un paso de simulacion.
 *
 * `dt` es fijo: con gravedad, un delta variable cambia la altura del salto y
 * dos personas con distintos fps no correrian la misma carrera.
 */
export function stepRunner(runner: Runner, dt: number, speed: number, track: Track): void {
  if (runner.dead) return;

  const dtMs = dt * 1000;
  runner.x += speed * dt;

  if (runner.slideMs > 0) runner.slideMs = Math.max(0, runner.slideMs - dtMs);
  if (runner.bufferMs > 0) runner.bufferMs = Math.max(0, runner.bufferMs - dtMs);

  // El salto se resuelve ANTES de mover en Y: asi un pedido guardado que se
  // vuelve valido justo al aterrizar sale en el mismo paso, sin un cuadro de
  // retraso que se siente como que el juego no escucho.
  if (runner.bufferMs > 0) {
    const forgiven = runner.onGround || runner.sinceGroundMs <= COYOTE_MS;
    if (forgiven) {
      runner.vy = JUMP_VY;
      runner.onGround = false;
      runner.airJumps = 1;
      runner.slideMs = 0;
      runner.bufferMs = 0;
      runner.sinceGroundMs = COYOTE_MS + 1;
    } else if (runner.airJumps > 0) {
      runner.vy = JUMP_VY;
      runner.airJumps--;
      runner.bufferMs = 0;
    }
  }

  if (!runner.onGround) {
    runner.sinceGroundMs += dtMs;
    runner.vy += GRAVITY * dt;
    runner.y += runner.vy * dt;

    if (runner.y >= 0) {
      // Aterriza, salvo que abajo no haya piso.
      if (isGapAt(track, runner.x)) {
        runner.y = 0;
        runner.dead = true;
        return;
      }
      runner.y = 0;
      runner.vy = 0;
      runner.onGround = true;
      runner.airJumps = 1;
      runner.sinceGroundMs = 0;
    }
  } else {
    runner.sinceGroundMs = 0;
    // Salir de un borde no mata: empieza a caer, y ahi entra el coyote.
    if (isGapAt(track, runner.x)) {
      runner.onGround = false;
      runner.vy = 0;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Colisiones                                                           */
/* ------------------------------------------------------------------ */

/** La caja del corredor en coordenadas de mundo. `y` crece hacia abajo. */
export function runnerBox(runner: Runner): { x: number; y: number; w: number; h: number } {
  const h = runnerHeight(runner);
  return { x: runner.x, y: GROUND_Y + runner.y - h, w: RUNNER_W, h };
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  o: Obstacle,
): boolean {
  if (o.kind === "gap") return false;
  return (
    a.x < o.x + o.width && a.x + a.w > o.x && a.y < o.top + o.height && a.y + a.h > o.top
  );
}

export type HitResult = { hit: boolean; grazes: number };

/**
 * Colision del paso, con barrido.
 *
 * A 900 px/s el corredor avanza 15 px por cuadro a 60 fps, y un obstaculo de
 * 46 px no se atraviesa. Pero el barrido igual importa para los huecos y para
 * el dia que la velocidad suba: comprobar solo la posicion final es el bug
 * clasico de todo runner.
 */
export function checkHits(runner: Runner, prevX: number, track: Track): HitResult {
  const box = runnerBox(runner);
  const swept = { ...box, x: Math.min(prevX, runner.x), w: box.w + Math.abs(runner.x - prevX) };
  let grazes = 0;

  for (const obstacle of track.obstacles) {
    if (obstacle.kind === "gap") continue;
    if (overlaps(swept, obstacle)) {
      runner.dead = true;
      return { hit: true, grazes };
    }
    // Roce: se paso cerca y ya quedo atras. Premia jugar al limite en vez de
    // saltar por las dudas con mucha anticipacion.
    if (!obstacle.grazed && obstacle.x + obstacle.width < runner.x) {
      const dy = Math.min(
        Math.abs(box.y + box.h - obstacle.top),
        Math.abs(box.y - (obstacle.top + obstacle.height)),
      );
      if (dy <= GRAZE_PX) {
        obstacle.grazed = true;
        grazes++;
      }
    }
  }
  return { hit: false, grazes };
}

/* ------------------------------------------------------------------ */
/* Siluetas                                                             */
/* ------------------------------------------------------------------ */

/**
 * La altura de una silueta ajena, derivada.
 *
 * **Esto es lo que hace que la red de este juego cueste 6 bytes por jugador.**
 * La Y no viaja: como la pista es identica para todos y el estado dice si esta
 * saltando o agachado, el cliente puede calcular donde deberia estar. Mandarla
 * seria mandar informacion que ya se tiene.
 *
 * No reproduce la parabola exacta —para eso haria falta la fase del salto—,
 * pero una silueta al 35 % de opacidad no necesita precision: necesita leerse
 * como "esta en el aire" y estar en la distancia correcta.
 */
export function deriveGhostY(state: RunnerState): number {
  switch (state) {
    case "jumping":
      return -90;
    case "sliding":
      return 0;
    case "dead":
      return 0;
    case "running":
      return 0;
  }
}

export function ghostHeight(state: RunnerState): number {
  return state === "sliding" ? SLIDE_H : RUNNER_H;
}

/* ------------------------------------------------------------------ */
/* Puntaje                                                              */
/* ------------------------------------------------------------------ */

export type ScoreRules = {
  perMeter: number;
  perCoin: number;
  perGraze: number;
};

export function runnerPoints(runner: Runner, rules: ScoreRules): number {
  const meters = Math.floor(runner.x / PX_PER_METER);
  return meters * rules.perMeter + runner.coins * rules.perCoin + runner.grazes * rules.perGraze;
}

export function metersOf(px: number): number {
  return px / PX_PER_METER;
}
