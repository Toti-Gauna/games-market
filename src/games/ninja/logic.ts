import type { Rng } from "@/core/engine/rng";
import { num, type SettingsValues } from "@/core/contract/settings";

/**
 * Ninja (M5) - la simulacion, sin React ni canvas.
 *
 * Lo que define al juego es el corte, y esta resuelto por segmento: el
 * movimiento del dedo entre dos frames es un segmento y se prueba contra el
 * circulo de cada fruta. Preguntar en cada frame si el dedo esta encima falla
 * justo cuando el jugador es rapido, que es cuando el juego se pone bueno.
 *
 * Nada de lo que corre por frame asigna objetos: las frutas viven en un
 * arreglo predimensionado y el resultado del corte se escribe en buffers
 * creados al iniciar.
 */

/** Mundo vertical: se juega con el telefono como esta. */
export const WORLD_WIDTH = 480;
export const WORLD_HEIGHT = 800;

/** Cinco por tanda y hasta tres tandas en el aire: 16 alcanzan y sobran. */
export const MAX_FRUITS = 16;
/** Cuantos cortes puede devolver un solo trazo. Mas que eso no pasa. */
export const MAX_SLICES = 8;

/** Formas: circulo, hexagono, gota, rombo. */
export const FRUIT_SHAPES = 4;
/** Cuantos colores de fruta define la paleta del componente. */
export const FRUIT_COLORS = 5;

export type NinjaTuning = {
  worldWidth: number;
  worldHeight: number;
  gravity: number;
  waveMinDelay: number;
  waveMaxDelay: number;
  waveMinCount: number;
  waveMaxCount: number;
  fruitRadiusMin: number;
  fruitRadiusMax: number;
  launchSpeedMin: number;
  launchSpeedMax: number;
  lives: number;
  bombFromPoints: number;
  /** 0..1 */
  bombMaxChance: number;
  /** Puntos que tarda la probabilidad de bomba en llegar a su techo. */
  bombRamp: number;
  pointsPerFruit: number;
  comboMin: number;
  comboPerFruit: number;
  streakLength: number;
  streakBonus: number;
  /** px/s: apoyar el dedo y moverlo despacio no corta. */
  minSliceSpeed: number;
};

export type Fruit = {
  alive: boolean;
  x: number;
  /** Posicion del paso anterior, para interpolar el dibujo con el alpha. */
  px: number;
  y: number;
  py: number;
  vx: number;
  vy: number;
  radius: number;
  shape: number;
  color: number;
  bomb: boolean;
  rot: number;
  prot: number;
  spin: number;
};

/** Se reescriben en cada paso: el componente los lee para sonido y HUD. */
export type NinjaEvents = { missed: number; spawned: number };

export type NinjaWorld = {
  fruits: Fruit[];
  spawnTimer: number;
  waves: number;
  lives: number;
  cut: number;
  missed: number;
  points: number;
  streak: number;
  bestStreak: number;
  bestCombo: number;
  /** Frutas cortadas por el trazo en curso. El combo se paga al soltar. */
  strokeCut: number;
  strokeX: number;
  strokeY: number;
  over: boolean;
  overReason: "" | "vidas" | "bomba";
  events: NinjaEvents;
  tuning: NinjaTuning;
};

/** Lo que un trazo corto en un paso. Buffers fijos: el corte no asigna. */
export type SliceResult = {
  count: number;
  xs: Float32Array;
  ys: Float32Array;
  radii: Float32Array;
  shapes: Int32Array;
  colors: Int32Array;
  gained: number;
  bomb: boolean;
  /** Angulo del trazo: define como se separan las mitades. */
  angle: number;
};

/** Los administrables entran una sola vez y salen tipados. */
export function tuningFromSettings(values: SettingsValues): NinjaTuning {
  const minCount = Math.round(num(values, "waveMinCount", 1));
  const minRadius = num(values, "fruitRadiusMin", 26);
  const minDelay = num(values, "waveMinDelay", 1.2);
  const minSpeed = num(values, "launchSpeedMin", 760);
  return {
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    gravity: num(values, "gravity", 900),
    waveMinDelay: minDelay,
    waveMaxDelay: Math.max(minDelay, num(values, "waveMaxDelay", 2.5)),
    waveMinCount: minCount,
    waveMaxCount: Math.max(minCount, Math.round(num(values, "waveMaxCount", 5))),
    fruitRadiusMin: minRadius,
    fruitRadiusMax: Math.max(minRadius, num(values, "fruitRadiusMax", 38)),
    launchSpeedMin: minSpeed,
    launchSpeedMax: Math.max(minSpeed, num(values, "launchSpeedMax", 980)),
    lives: Math.round(num(values, "lives", 3)),
    bombFromPoints: num(values, "bombFromPoints", 300),
    bombMaxChance: num(values, "bombMaxChance", 17) / 100,
    bombRamp: num(values, "bombRamp", 900),
    pointsPerFruit: num(values, "pointsPerFruit", 50),
    comboMin: Math.round(num(values, "comboMin", 3)),
    comboPerFruit: num(values, "comboPerFruit", 30),
    streakLength: Math.round(num(values, "streakLength", 10)),
    streakBonus: num(values, "streakBonus", 200),
    minSliceSpeed: num(values, "minSliceSpeed", 300),
  };
}

/* ------------------------------------------------------------------ */
/* Geometria del corte                                                 */
/* ------------------------------------------------------------------ */

/**
 * Distancia minima del centro de la fruta al segmento del trazo.
 *
 * Es la funcion que hace o rompe el juego. Con deteccion por punto, un
 * deslizamiento rapido salta 200 px entre frames y pasa por arriba de tres
 * frutas sin tocar ninguna.
 */
export function segmentHitsCircle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  // Proyeccion del centro sobre el segmento, acotada a [0,1]: fuera de ese
  // rango el punto mas cercano es un extremo, no la recta infinita.
  let t = 0;
  if (lengthSq > 1e-9) {
    t = ((cx - x1) * dx + (cy - y1) * dy) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }

  const nx = cx - (x1 + dx * t);
  const ny = cy - (y1 + dy * t);
  return nx * nx + ny * ny <= radius * radius;
}

/* ------------------------------------------------------------------ */
/* Puntaje                                                             */
/* ------------------------------------------------------------------ */

/**
 * El combo por trazo es lo que hace que valga esperar a que se junten tres
 * frutas en vez de cortar apenas aparecen. Le da decision a un juego que si no
 * seria reflejo puro.
 */
export function comboPoints(strokeCut: number, tuning: NinjaTuning): number {
  return strokeCut >= tuning.comboMin ? strokeCut * tuning.comboPerFruit : 0;
}

/** Bono de racha: se paga cada vez que la cuenta cruza un multiplo. */
export function streakAward(streak: number, tuning: NinjaTuning): number {
  if (tuning.streakLength <= 0 || streak <= 0) return 0;
  return streak % tuning.streakLength === 0 ? tuning.streakBonus : 0;
}

/** Las bombas aparecen desde cierto puntaje, con probabilidad creciente. */
export function bombChance(points: number, tuning: NinjaTuning): number {
  if (points < tuning.bombFromPoints) return 0;
  if (tuning.bombRamp <= 0) return tuning.bombMaxChance;
  const ramp = Math.min(1, (points - tuning.bombFromPoints) / tuning.bombRamp);
  return tuning.bombMaxChance * ramp;
}

/* ------------------------------------------------------------------ */
/* Mundo                                                               */
/* ------------------------------------------------------------------ */

export function createSliceResult(): SliceResult {
  return {
    count: 0,
    xs: new Float32Array(MAX_SLICES),
    ys: new Float32Array(MAX_SLICES),
    radii: new Float32Array(MAX_SLICES),
    shapes: new Int32Array(MAX_SLICES),
    colors: new Int32Array(MAX_SLICES),
    gained: 0,
    bomb: false,
    angle: 0,
  };
}

export function createNinjaWorld(tuning: NinjaTuning): NinjaWorld {
  const fruits: Fruit[] = new Array<Fruit>(MAX_FRUITS);
  for (let i = 0; i < MAX_FRUITS; i++) {
    fruits[i] = {
      alive: false,
      x: 0,
      px: 0,
      y: 0,
      py: 0,
      vx: 0,
      vy: 0,
      radius: 30,
      shape: 0,
      color: 0,
      bomb: false,
      rot: 0,
      prot: 0,
      spin: 0,
    };
  }

  return {
    fruits,
    // La primera tanda sale enseguida: nadie quiere mirar una pantalla vacia.
    spawnTimer: 0.4,
    waves: 0,
    lives: tuning.lives,
    cut: 0,
    missed: 0,
    points: 0,
    streak: 0,
    bestStreak: 0,
    bestCombo: 0,
    strokeCut: 0,
    strokeX: tuning.worldWidth / 2,
    strokeY: tuning.worldHeight / 2,
    over: false,
    overReason: "",
    events: { missed: 0, spawned: 0 },
    tuning,
  };
}

function freeFruit(world: NinjaWorld): Fruit | null {
  for (let i = 0; i < world.fruits.length; i++) {
    const fruit = world.fruits[i];
    if (fruit && !fruit.alive) return fruit;
  }
  return null;
}

/**
 * Una tanda. Consume una cantidad fija de numeros del PRNG por fruta, asi que
 * con la misma semilla salen las mismas frutas en el mismo orden.
 */
export function spawnWave(world: NinjaWorld, rng: Rng): void {
  const tuning = world.tuning;
  const count = rng.int(tuning.waveMinCount, tuning.waveMaxCount);
  const chance = bombChance(world.points, tuning);

  for (let i = 0; i < count; i++) {
    const radius = rng.range(tuning.fruitRadiusMin, tuning.fruitRadiusMax);
    const x = rng.range(70, tuning.worldWidth - 70);
    const speed = rng.range(tuning.launchSpeedMin, tuning.launchSpeedMax);
    const drift = rng.range(-70, 70);
    const shape = rng.int(0, FRUIT_SHAPES - 1);
    const color = rng.int(0, FRUIT_COLORS - 1);
    const spin = rng.range(-3.4, 3.4);
    const bomb = rng.next() < chance;

    const fruit = freeFruit(world);
    if (!fruit) continue;
    fruit.alive = true;
    fruit.x = x;
    fruit.px = x;
    fruit.y = tuning.worldHeight + radius;
    fruit.py = fruit.y;
    // Empujon hacia el centro: sin esto la mitad de la tanda sale de pantalla.
    fruit.vx = drift + (tuning.worldWidth / 2 - x) * 0.35;
    fruit.vy = -speed;
    fruit.radius = radius;
    fruit.shape = shape;
    fruit.color = color;
    fruit.bomb = bomb;
    fruit.rot = 0;
    fruit.prot = 0;
    fruit.spin = spin;
    world.events.spawned++;
  }

  world.waves++;
}

/**
 * Un paso de simulacion. `dt` es siempre el mismo: con delta variable la
 * parabola de la fruta cambia entre un telefono lento y el proyector.
 */
export function stepNinja(world: NinjaWorld, dt: number, rng: Rng): void {
  const events = world.events;
  events.missed = 0;
  events.spawned = 0;

  // Al cortar una bomba, todo se detiene. Es lo que hace que se lea el error.
  if (world.over) return;

  const tuning = world.tuning;

  world.spawnTimer -= dt;
  if (world.spawnTimer <= 0) {
    spawnWave(world, rng);
    world.spawnTimer = rng.range(tuning.waveMinDelay, tuning.waveMaxDelay);
  }

  const floor = tuning.worldHeight + 90;
  for (let i = 0; i < world.fruits.length; i++) {
    const fruit = world.fruits[i];
    if (!fruit || !fruit.alive) continue;

    fruit.px = fruit.x;
    fruit.py = fruit.y;
    fruit.prot = fruit.rot;
    fruit.vy += tuning.gravity * dt;
    fruit.x += fruit.vx * dt;
    fruit.y += fruit.vy * dt;
    fruit.rot += fruit.spin * dt;

    if (fruit.y - fruit.radius <= floor) continue;

    fruit.alive = false;
    // Una bomba que cae sola no cuesta nada: dejarla pasar es la jugada.
    if (fruit.bomb) continue;
    world.missed++;
    world.lives--;
    world.streak = 0;
    events.missed++;
  }

  if (world.lives <= 0) {
    world.over = true;
    world.overReason = "vidas";
  }
}

/* ------------------------------------------------------------------ */
/* Corte                                                               */
/* ------------------------------------------------------------------ */

/** Un trazo nuevo: el combo se cuenta por trazo, no por partida. */
export function beginStroke(world: NinjaWorld): void {
  world.strokeCut = 0;
}

/** Cierra el trazo y paga el combo. Devuelve los puntos que sumo. */
export function endStroke(world: NinjaWorld): number {
  const gained = comboPoints(world.strokeCut, world.tuning);
  if (world.strokeCut > world.bestCombo) world.bestCombo = world.strokeCut;
  world.points += gained;
  world.strokeCut = 0;
  return gained;
}

/**
 * Prueba el segmento del trazo contra cada fruta viva.
 *
 * `speed` es la velocidad del trazo en px/s: por debajo del minimo no corta,
 * porque si no la estrategia optima es dejar el dedo quieto en el medio.
 * El resultado se escribe en `out`, que se crea una vez y se reusa.
 */
export function sliceFruits(
  world: NinjaWorld,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  speed: number,
  out: SliceResult,
): SliceResult {
  out.count = 0;
  out.gained = 0;
  out.bomb = false;

  if (world.over || speed < world.tuning.minSliceSpeed) return out;

  out.angle = Math.atan2(y2 - y1, x2 - x1);

  for (let i = 0; i < world.fruits.length; i++) {
    const fruit = world.fruits[i];
    if (!fruit || !fruit.alive) continue;
    if (!segmentHitsCircle(x1, y1, x2, y2, fruit.x, fruit.y, fruit.radius)) continue;

    fruit.alive = false;
    if (out.count < MAX_SLICES) {
      out.xs[out.count] = fruit.x;
      out.ys[out.count] = fruit.y;
      out.radii[out.count] = fruit.radius;
      out.shapes[out.count] = fruit.shape;
      out.colors[out.count] = fruit.bomb ? -1 : fruit.color;
      out.count++;
    }
    world.strokeX = fruit.x;
    world.strokeY = fruit.y;

    if (fruit.bomb) {
      // Cortar una bomba termina la partida en el acto.
      out.bomb = true;
      world.over = true;
      world.overReason = "bomba";
      world.streak = 0;
      return out;
    }

    world.cut++;
    world.strokeCut++;
    world.streak++;
    if (world.streak > world.bestStreak) world.bestStreak = world.streak;
    out.gained += world.tuning.pointsPerFruit;
    out.gained += streakAward(world.streak, world.tuning);
  }

  world.points += out.gained;
  return out;
}
