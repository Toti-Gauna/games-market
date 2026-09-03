import type { Rng } from "@/core/engine/rng";

/**
 * Logica de Serpiente. Sin React, sin canvas: se testea sola.
 *
 * El cuerpo es un ring buffer sobre dos Int16Array mas una grilla de ocupacion.
 * Es lo que permite cumplir la regla de cero asignaciones en el loop y ademas
 * detectar el choque contra uno mismo en O(1) en vez de recorrer el cuerpo.
 */

export type Direction = "up" | "down" | "left" | "right";

export type SnakeRules = {
  cols: number;
  rows: number;
  startSpeed: number;
  speedGain: number;
  maxSpeed: number;
  growth: number;
};

export type SnakeState = {
  cols: number;
  rows: number;
  capacity: number;
  xs: Int16Array;
  ys: Int16Array;
  /** Indice del ring donde esta la cabeza. */
  head: number;
  length: number;
  occupied: Uint8Array;
  dir: Direction;
  /** Cola de un solo giro: sin esto, en velocidad alta se pierden entradas. */
  queued: Direction | null;
  pendingGrowth: number;
  speed: number;
  /** Segundos acumulados hacia el proximo paso de grilla. */
  stepClock: number;
  eaten: number;
  foodX: number;
  foodY: number;
  /** Indice del principio que esta en el tablero. */
  foodWord: number;
  dead: boolean;
  rules: SnakeRules;
};

const DELTA: Record<Direction, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export function createSnakeState(rules: SnakeRules, rng: Rng, wordCount: number): SnakeState {
  const capacity = rules.cols * rules.rows;
  const state: SnakeState = {
    cols: rules.cols,
    rows: rules.rows,
    capacity,
    xs: new Int16Array(capacity),
    ys: new Int16Array(capacity),
    head: 0,
    length: 3,
    occupied: new Uint8Array(capacity),
    dir: "right",
    queued: null,
    pendingGrowth: 0,
    speed: rules.startSpeed,
    stepClock: 0,
    eaten: 0,
    foodX: 0,
    foodY: 0,
    foodWord: 0,
    dead: false,
    rules,
  };

  // Arranca horizontal en el centro, mirando a la derecha, con lugar por delante.
  const startX = Math.floor(rules.cols / 4);
  const startY = Math.floor(rules.rows / 2);
  for (let i = 0; i < state.length; i++) {
    const x = startX + i;
    const y = startY;
    state.xs[i] = x;
    state.ys[i] = y;
    state.occupied[y * rules.cols + x] = 1;
  }
  state.head = state.length - 1;

  placeFood(state, rng, wordCount);
  return state;
}

export function queueTurn(state: SnakeState, dir: Direction): void {
  // El giro se compara contra el ultimo giro encolado, no contra la direccion
  // actual: si no, dos deslizadas rapidas se pisan y una se pierde.
  const reference = state.queued ?? state.dir;
  if (dir === reference || dir === OPPOSITE[reference]) return;
  state.queued = dir;
}

/** Elige una celda libre con el PRNG sembrado. Recorre, no asigna. */
export function placeFood(state: SnakeState, rng: Rng, wordCount: number): void {
  const total = state.cols * state.rows;
  const free = total - state.length;
  if (free <= 0) return;

  let target = rng.int(0, free - 1);
  for (let i = 0; i < total; i++) {
    if (state.occupied[i] === 1) continue;
    if (target === 0) {
      state.foodX = i % state.cols;
      state.foodY = Math.floor(i / state.cols);
      state.foodWord = wordCount > 0 ? rng.int(0, wordCount - 1) : 0;
      return;
    }
    target--;
  }
}

export type StepResult = "moved" | "ate" | "died";

/** Un paso de grilla. Es la unica funcion que mueve la serpiente. */
export function stepSnake(state: SnakeState, rng: Rng, wordCount: number): StepResult {
  if (state.dead) return "died";

  if (state.queued) {
    state.dir = state.queued;
    state.queued = null;
  }

  const delta = DELTA[state.dir];
  const nx = (state.xs[state.head] ?? 0) + delta[0];
  const ny = (state.ys[state.head] ?? 0) + delta[1];

  // Sin wrap-around: atravesar bordes hace el juego mas facil y mas aburrido.
  if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows) {
    state.dead = true;
    return "died";
  }

  const nextIndex = ny * state.cols + nx;
  const tailSlot = (state.head - state.length + 1 + state.capacity) % state.capacity;
  const tailIndex = (state.ys[tailSlot] ?? 0) * state.cols + (state.xs[tailSlot] ?? 0);
  const tailFreesUp = state.pendingGrowth === 0;

  // La celda de la cola deja de estar ocupada en este mismo paso, asi que
  // pisarla es legal. Sin esta excepcion, la serpiente muere persiguiendose.
  if (state.occupied[nextIndex] === 1 && !(tailFreesUp && nextIndex === tailIndex)) {
    state.dead = true;
    return "died";
  }

  if (state.pendingGrowth > 0) {
    state.pendingGrowth--;
    state.length++;
  } else {
    state.occupied[tailIndex] = 0;
  }

  state.head = (state.head + 1) % state.capacity;
  state.xs[state.head] = nx;
  state.ys[state.head] = ny;
  state.occupied[nextIndex] = 1;

  if (nx === state.foodX && ny === state.foodY) {
    state.eaten++;
    state.pendingGrowth += state.rules.growth;
    state.speed = Math.min(state.rules.maxSpeed, state.speed + state.rules.speedGain);
    placeFood(state, rng, wordCount);
    return "ate";
  }

  return "moved";
}

/** Posicion de un segmento contando desde la cabeza (0 = cabeza). */
export function segmentAt(state: SnakeState, fromHead: number): { x: number; y: number } {
  const slot = (state.head - fromHead + state.capacity * 2) % state.capacity;
  return { x: state.xs[slot] ?? 0, y: state.ys[slot] ?? 0 };
}

export function snakePoints(
  eaten: number,
  pointsPerPrinciple: number,
  survivedMs: number,
  durationMs: number | null,
  maxTimeBonus: number,
): number {
  const base = eaten * pointsPerPrinciple;
  if (durationMs === null || durationMs <= 0 || maxTimeBonus <= 0) return base;
  const ratio = Math.min(1, survivedMs / durationMs);
  return Math.floor(base + ratio * maxTimeBonus);
}
