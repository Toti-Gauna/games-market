import { clamp } from "@/core/engine/collide";
import type { Rng } from "@/core/engine/rng";
import { num, type SettingsValues } from "@/core/contract/settings";

/**
 * Saltarin (M4) - la simulacion, sin React ni canvas.
 *
 * Todo lo que decide la partida vive aca: la curva del giroscopio, la fisica
 * del salto, el reciclado de plataformas con el PRNG sembrado y el puntaje.
 * Separado del componente porque es lo unico que hay que testear, y porque con
 * la misma semilla dos participantes tienen que subir por el mismo recorrido.
 *
 * Ninguna funcion que corre por frame asigna objetos: mutan estructuras
 * creadas al iniciar. Es la regla de cero basura dentro del loop.
 */

/** Mundo vertical: se juega con el telefono como esta. */
export const WORLD_WIDTH = 480;
export const WORLD_HEIGHT = 800;

/** Catorce llenan la pantalla con margen arriba y abajo. Se reciclan. */
export const PLATFORM_COUNT = 14;

/** Tipos de plataforma como numeros: comparar enteros no asigna nada. */
export const KIND_NORMAL = 0;
export const KIND_MOVING = 1;
export const KIND_FRAGILE = 2;
export const KIND_BOOST = 3;

/** Cuantas lecturas del sensor entran en la media movil. */
export const TILT_SAMPLES = 3;

/** Altura de la nave sobre el piso al arrancar. */
const START_OFFSET = 120;
/** Fraccion de la pantalla donde la camara empieza a empujar hacia arriba. */
const FOLLOW_LINE = 0.42;
/** Margen bajo la vista antes de dar la caida por perdida. */
const FALL_MARGIN = 40;
/** Techo de la velocidad de caida: sin esto la caida final se vuelve absurda. */
const MAX_FALL_SPEED = 1700;
/** El ancho de colision es menor que el dibujo: rozar el borde perdona. */
const FOOT_RATIO = 0.8;

export type JumperTuning = {
  worldWidth: number;
  worldHeight: number;
  gravity: number;
  /** Negativo: en canvas el eje y crece hacia abajo. */
  jumpImpulse: number;
  boostMultiplier: number;
  maxSpeedX: number;
  tiltRangeDeg: number;
  tiltDeadzoneDeg: number;
  minGap: number;
  maxGap: number;
  /** Altura a la que la separacion llega a su maximo. */
  gapRamp: number;
  platformWidth: number;
  platformHeight: number;
  playerRadius: number;
  movingFrom: number;
  fragileFrom: number;
  boostFrom: number;
  movingSpeed: number;
  pixelsPerPoint: number;
  boostBonus: number;
};

export type Platform = {
  /** Siempre viva: el arreglo se recicla, nunca se crea ni se destruye una. */
  alive: boolean;
  x: number;
  /** x del paso anterior, para interpolar el dibujo con el alpha del loop. */
  px: number;
  y: number;
  kind: number;
  vx: number;
  broken: boolean;
  breakMs: number;
};

/** Se reescriben en cada paso: el componente los lee para sonido y particulas. */
export type JumperEvents = {
  jumped: boolean;
  boosted: boolean;
  broke: boolean;
  died: boolean;
  /** Punto del ultimo contacto, para las particulas. */
  x: number;
  y: number;
};

export type JumperWorld = {
  x: number;
  px: number;
  y: number;
  py: number;
  vx: number;
  vy: number;
  startY: number;
  climb: number;
  maxClimb: number;
  cameraY: number;
  cameraPrevY: number;
  platforms: Platform[];
  /** y de la ultima plataforma colocada: la proxima nace mas arriba. */
  nextY: number;
  boosts: number;
  landings: number;
  breaks: number;
  dead: boolean;
  deathMs: number;
  /** Media movil de gamma. El sensor es ruidoso y sin esto la nave tiembla. */
  tiltSamples: Float32Array;
  tiltAt: number;
  tiltFilled: number;
  /** Angulo que el jugador declaro como "recto". Nunca el cero absoluto. */
  tiltZero: number;
  tiltReady: boolean;
  events: JumperEvents;
  tuning: JumperTuning;
};

/** Los administrables entran una sola vez y salen tipados. */
export function tuningFromSettings(values: SettingsValues): JumperTuning {
  const minGap = num(values, "minGap", 70);
  const maxGap = Math.max(minGap, num(values, "maxGap", 130));
  return {
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    gravity: num(values, "gravity", 1400),
    jumpImpulse: -Math.abs(num(values, "jumpImpulse", 620)),
    boostMultiplier: num(values, "boostMultiplier", 1.8),
    maxSpeedX: num(values, "maxSpeedX", 420),
    tiltRangeDeg: num(values, "tiltRange", 25),
    tiltDeadzoneDeg: num(values, "tiltDeadzone", 2),
    minGap,
    maxGap,
    gapRamp: num(values, "gapRamp", 6000),
    platformWidth: num(values, "platformWidth", 80),
    platformHeight: 14,
    playerRadius: num(values, "playerRadius", 18),
    movingFrom: num(values, "movingFrom", 1500),
    fragileFrom: num(values, "fragileFrom", 3000),
    boostFrom: num(values, "boostFrom", 5000),
    movingSpeed: num(values, "movingSpeed", 70),
    pixelsPerPoint: num(values, "pixelsPerPoint", 10),
    boostBonus: num(values, "boostBonus", 50),
  };
}

/* ------------------------------------------------------------------ */
/* Giroscopio                                                          */
/* ------------------------------------------------------------------ */

/**
 * Angulo del sensor a eje -1..1.
 *
 * La zona muerta es lo que hace que quieto sea quieto, y la curva cuadratica
 * lo que separa un control preciso de uno nervioso: inclinaciones chicas
 * mueven poco, grandes mucho.
 */
export function tiltToAxis(
  gamma: number,
  zero: number,
  deadzoneDeg: number,
  rangeDeg: number,
): number {
  const delta = gamma - zero;
  const magnitude = Math.abs(delta);
  if (magnitude <= deadzoneDeg) return 0;
  const span = Math.max(1, rangeDeg - deadzoneDeg);
  const normalized = Math.min(1, (magnitude - deadzoneDeg) / span);
  const curved = normalized * normalized;
  return delta < 0 ? -curved : curved;
}

/** Escribe una lectura en el buffer circular de la media movil. */
export function pushTiltSample(world: JumperWorld, gamma: number): void {
  world.tiltSamples[world.tiltAt] = gamma;
  world.tiltAt = (world.tiltAt + 1) % world.tiltSamples.length;
  if (world.tiltFilled < world.tiltSamples.length) world.tiltFilled++;
}

export function smoothedTilt(world: JumperWorld): number {
  if (world.tiltFilled === 0) return world.tiltZero;
  let sum = 0;
  for (let i = 0; i < world.tiltFilled; i++) sum += world.tiltSamples[i] ?? 0;
  return sum / world.tiltFilled;
}

/** Fija el cero donde el jugador tiene el telefono ahora mismo. */
export function calibrateTilt(world: JumperWorld): void {
  world.tiltZero = smoothedTilt(world);
  world.tiltReady = true;
}

export function tiltAxis(world: JumperWorld): number {
  if (!world.tiltReady) return 0;
  return tiltToAxis(
    smoothedTilt(world),
    world.tiltZero,
    world.tuning.tiltDeadzoneDeg,
    world.tuning.tiltRangeDeg,
  );
}

/* ------------------------------------------------------------------ */
/* Generacion de plataformas                                           */
/* ------------------------------------------------------------------ */

/** La separacion crece con la altura: es lo que evita que el juego se agote. */
export function gapForClimb(climb: number, tuning: JumperTuning): number {
  if (tuning.gapRamp <= 0) return tuning.maxGap;
  const t = clamp(climb / tuning.gapRamp, 0, 1);
  return tuning.minGap + (tuning.maxGap - tuning.minGap) * t;
}

/**
 * Tipo de plataforma segun la altura alcanzada.
 * Una sola tirada y umbrales disjuntos: la progresion es reproducible con la
 * semilla y no cambia si manana se agrega un tipo mas.
 */
export function pickPlatformKind(roll: number, climb: number, tuning: JumperTuning): number {
  if (climb >= tuning.boostFrom && roll < 0.1) return KIND_BOOST;
  if (climb >= tuning.fragileFrom && roll < 0.26) return KIND_FRAGILE;
  if (climb >= tuning.movingFrom && roll < 0.48) return KIND_MOVING;
  return KIND_NORMAL;
}

/**
 * Recolocacion de una plataforma arriba de todo.
 * Consume siempre tres numeros del PRNG, tenga el tipo que tenga: si el
 * consumo dependiera del tipo, la serie seria mucho mas dificil de razonar.
 */
export function resetPlatform(plat: Platform, world: JumperWorld, rng: Rng): void {
  const tuning = world.tuning;
  const span = Math.max(0, tuning.worldWidth - tuning.platformWidth);
  const x = rng.next() * span;
  const kind = pickPlatformKind(rng.next(), world.maxClimb, tuning);
  const dir = rng.next() < 0.5 ? -1 : 1;

  world.nextY -= gapForClimb(world.maxClimb, tuning);
  plat.x = x;
  plat.px = x;
  plat.y = world.nextY;
  plat.kind = kind;
  plat.vx = kind === KIND_MOVING ? dir * tuning.movingSpeed : 0;
  plat.broken = false;
  plat.breakMs = 0;
}

export function createJumperWorld(tuning: JumperTuning, rng: Rng): JumperWorld {
  const startY = tuning.worldHeight - START_OFFSET;
  const platforms: Platform[] = new Array<Platform>(PLATFORM_COUNT);
  for (let i = 0; i < PLATFORM_COUNT; i++) {
    platforms[i] = {
      alive: true,
      x: 0,
      px: 0,
      y: 0,
      kind: KIND_NORMAL,
      vx: 0,
      broken: false,
      breakMs: 0,
    };
  }

  const world: JumperWorld = {
    x: tuning.worldWidth / 2,
    px: tuning.worldWidth / 2,
    y: startY,
    py: startY,
    vx: 0,
    vy: 0,
    startY,
    climb: 0,
    maxClimb: 0,
    cameraY: 0,
    cameraPrevY: 0,
    platforms,
    nextY: startY + 46,
    boosts: 0,
    landings: 0,
    breaks: 0,
    dead: false,
    deathMs: 0,
    tiltSamples: new Float32Array(TILT_SAMPLES),
    tiltAt: 0,
    tiltFilled: 0,
    tiltZero: 0,
    tiltReady: false,
    events: { jumped: false, boosted: false, broke: false, died: false, x: 0, y: 0 },
    tuning,
  };

  // La primera plataforma va fija debajo de la nave: nadie tiene que perder
  // por como cayo el azar en el primer segundo.
  const first = platforms[0];
  if (first) {
    first.x = (tuning.worldWidth - tuning.platformWidth) / 2;
    first.px = first.x;
    first.y = world.nextY;
  }
  for (let i = 1; i < PLATFORM_COUNT; i++) {
    const plat = platforms[i];
    if (plat) resetPlatform(plat, world, rng);
  }

  return world;
}

/* ------------------------------------------------------------------ */
/* Colision                                                            */
/* ------------------------------------------------------------------ */

/**
 * Contacto con una plataforma, barrido entre el paso anterior y el actual.
 *
 * Solo cuenta cayendo. Si contara siempre, la nave se pegaria a la plataforma
 * al subir: es el bug clasico del genero. Y comparar `prevFoot` contra `foot`
 * en vez de mirar solo la posicion final evita que un salto rapido atraviese
 * la plataforma entre dos pasos.
 */
export function landsOnPlatform(
  prevFoot: number,
  foot: number,
  vy: number,
  centerX: number,
  halfWidth: number,
  plat: Platform,
  platformWidth: number,
): boolean {
  if (vy <= 0 || plat.broken) return false;
  if (prevFoot > plat.y || foot < plat.y) return false;
  return centerX + halfWidth > plat.x && centerX - halfWidth < plat.x + platformWidth;
}

/* ------------------------------------------------------------------ */
/* Paso de simulacion                                                  */
/* ------------------------------------------------------------------ */

/**
 * Un paso. `dt` es siempre el mismo: con delta variable la altura del salto
 * cambiaria entre un telefono lento y el proyector, y dejaria de ser el mismo
 * juego. `axis` va de -1 a 1 y lo arma el componente con el giroscopio o con
 * el fallback de toque y teclado.
 */
export function stepJumper(world: JumperWorld, dt: number, axis: number, rng: Rng): void {
  const tuning = world.tuning;
  const events = world.events;
  events.jumped = false;
  events.boosted = false;
  events.broke = false;
  events.died = false;

  world.px = world.x;
  world.py = world.y;
  world.cameraPrevY = world.cameraY;

  if (world.dead) {
    // Ver la caida es parte del juego: la camara la acompana solo al morir.
    world.deathMs += dt * 1000;
    world.vy = Math.min(world.vy + tuning.gravity * dt, MAX_FALL_SPEED);
    world.y += world.vy * dt;
    const target = world.y - tuning.worldHeight * FOLLOW_LINE;
    world.cameraY += (target - world.cameraY) * Math.min(1, dt * 3);
    return;
  }

  const targetVx = clamp(axis, -1, 1) * tuning.maxSpeedX;
  world.vx += (targetVx - world.vx) * Math.min(1, dt * 16);
  world.x += world.vx * dt;

  // Wrap horizontal: salir por un costado y volver por el otro es parte del
  // movimiento y evita quedar trabado contra un borde. `px` se corre igual
  // para que la interpolacion del dibujo no cruce la pantalla entera.
  if (world.x < 0) {
    world.x += tuning.worldWidth;
    world.px += tuning.worldWidth;
  } else if (world.x > tuning.worldWidth) {
    world.x -= tuning.worldWidth;
    world.px -= tuning.worldWidth;
  }

  world.vy = Math.min(world.vy + tuning.gravity * dt, MAX_FALL_SPEED);
  world.y += world.vy * dt;

  const maxX = Math.max(0, tuning.worldWidth - tuning.platformWidth);
  for (let i = 0; i < world.platforms.length; i++) {
    const plat = world.platforms[i];
    if (!plat) continue;
    plat.px = plat.x;
    if (plat.broken) {
      plat.breakMs += dt * 1000;
      continue;
    }
    if (plat.vx === 0) continue;
    plat.x += plat.vx * dt;
    if (plat.x < 0) {
      plat.x = 0;
      plat.vx = -plat.vx;
    } else if (plat.x > maxX) {
      plat.x = maxX;
      plat.vx = -plat.vx;
    }
  }

  const prevFoot = world.py + tuning.playerRadius;
  const foot = world.y + tuning.playerRadius;
  const halfWidth = tuning.playerRadius * FOOT_RATIO;

  for (let i = 0; i < world.platforms.length; i++) {
    const plat = world.platforms[i];
    if (!plat) continue;
    if (!landsOnPlatform(prevFoot, foot, world.vy, world.x, halfWidth, plat, tuning.platformWidth)) {
      continue;
    }

    events.x = world.x;
    events.y = plat.y;

    if (plat.kind === KIND_FRAGILE) {
      // Se rompe y no rebota. Un fragil que igual impulsa es un adorno: lo que
      // le da sentido es que haya que decidir no pisarlo.
      plat.broken = true;
      world.breaks++;
      events.broke = true;
      break;
    }

    world.y = plat.y - tuning.playerRadius;
    world.vy =
      plat.kind === KIND_BOOST ? tuning.jumpImpulse * tuning.boostMultiplier : tuning.jumpImpulse;
    world.landings++;
    if (plat.kind === KIND_BOOST) {
      world.boosts++;
      events.boosted = true;
    } else {
      events.jumped = true;
    }
    break;
  }

  // La camara sube con la nave y nunca baja.
  const follow = world.y - tuning.worldHeight * FOLLOW_LINE;
  if (follow < world.cameraY) world.cameraY = follow;

  world.climb = Math.max(0, world.startY - world.y);
  if (world.climb > world.maxClimb) world.maxClimb = world.climb;

  // Reciclado: la que sale por abajo reaparece arriba con tipo y posicion
  // nuevos del PRNG sembrado. Nunca se crea ni se destruye una.
  const bottom = world.cameraY + tuning.worldHeight + tuning.platformHeight;
  for (let i = 0; i < world.platforms.length; i++) {
    const plat = world.platforms[i];
    if (plat && plat.y > bottom) resetPlatform(plat, world, rng);
  }

  if (world.y - world.cameraY > tuning.worldHeight + FALL_MARGIN) {
    world.dead = true;
    events.died = true;
  }
}

/* ------------------------------------------------------------------ */
/* Puntaje                                                             */
/* ------------------------------------------------------------------ */

/**
 * Altura como metrica principal, directa y comparable. El bono por impulso
 * premia buscar las plataformas de rebote doble en vez de ir a lo seguro.
 */
export function jumperPoints(maxClimb: number, boosts: number, tuning: JumperTuning): number {
  const perPoint = tuning.pixelsPerPoint > 0 ? tuning.pixelsPerPoint : 10;
  return Math.floor(Math.max(0, maxClimb) / perPoint) + boosts * tuning.boostBonus;
}

/** Altura en metros de mentira: 100 px = 1 m. Se lee mejor que "4320 px". */
export function climbToMeters(climb: number): number {
  return Math.round(Math.max(0, climb) / 10) / 10;
}
