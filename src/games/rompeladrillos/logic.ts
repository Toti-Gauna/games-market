import { clamp, sweepCircleBox, type Box, type Circle } from "@/core/engine/collide";
import type { Rng } from "@/core/engine/rng";

/**
 * Logica de Rompeladrillos. Sin React, sin canvas, sin red: se testea sola.
 *
 * Tres decisiones cargan el archivo entero:
 *
 * 1. **La paleta es una sola, partida al medio.** No son dos paletas: son dos
 *    segmentos atados por una correa (`maxSeparation`) que no se pueden
 *    cruzar y que se empujan entre si. De ahi sale todo el juego: el espacio
 *    es un recurso que hay que repartir a los gritos.
 * 2. **Colision barrida contra segmentos y ladrillos.** Preguntar "esta la
 *    pelota adentro este paso" la deja pasar de largo: a velocidad maxima
 *    recorre mas que el alto de un segmento entre dos pasos. El tunel es EL
 *    bug del Breakout y se resuelve buscando el instante exacto del impacto
 *    con `sweepCircleBox`.
 * 3. **El hueco no es un objeto.** Es la ausencia de uno: la colision se hace
 *    contra cada segmento por separado y en el medio, simplemente, no hay
 *    nada contra que chocar.
 *
 * Cero asignaciones: la grilla de ladrillos es un array plano, las pelotas y
 * las capsulas viven en arrays tipados de tamano fijo, los scratch de
 * colision viven en el estado y los eventos salen como una mascara de bits en
 * vez de un objeto.
 */

export const BREAKOUT_SEATS = 2;
export const MAX_BALLS = 3;
export const MAX_CAPSULES = 10;
export const BRICK_COLS = 14;
export const LEVEL_COUNT = 5;

/** Cuantos impactos se resuelven dentro de un mismo paso. */
const MAX_RESOLVES = 6;
/** Separacion tras el impacto. Sin esto la pelota queda vibrando pegada. */
const SKIN = 0.02;
/** Restar 180 veces 1/120 a 1,5 no da 0 exacto. Sin margen la pausa dura un paso de mas. */
const TIMER_EPS = 1e-6;

/** Duraciones fijas por spec: no son administrables porque son el equilibrio del juego. */
const WIDE_MS = 20_000;
const SLOW_MS = 15_000;
const JOINT_MS = 10_000;
/** El iman suelta solo: nadie encuentra el boton con la pelota pegada. */
const MAGNET_HOLD_MS = 2200;
const WIDE_BONUS = 40;
const SLOW_FACTOR = 0.7;
/** Desde donde un rebote cuenta como rescate, en fraccion del medio segmento. */
const RESCUE_EDGE = 0.72;

/* ------------------------------------------------------------------ */
/* Ladrillos y capsulas                                                 */
/* ------------------------------------------------------------------ */

export const BRICK_NORMAL = 0;
export const BRICK_TOUGH = 1;
export const BRICK_ARMORED = 2;
export const BRICK_BOMB = 3;
export const BRICK_KINDS = 4;

const BRICK_HP: readonly number[] = [1, 2, 3, 1];
const BRICK_POINTS: readonly number[] = [50, 120, 250, 100];

export const CAP_WIDE = 0;
export const CAP_SLOW = 1;
export const CAP_MULTI = 2;
export const CAP_MAGNET = 3;
export const CAP_JOINT = 4;
export const CAPSULE_KINDS = 5;

/** Texto visible: el mando y el proyector muestran el mismo nombre. */
export const CAPSULE_LABELS: readonly string[] = ["Ancho", "Lento", "Multi", "Imán", "Junta"];

/** Medidas de la capsula. El render dibuja exactamente esto. */
export const CAPSULE_HALF_W = 30;
export const CAPSULE_HALF_H = 13;

/* ------------------------------------------------------------------ */
/* Eventos                                                              */
/* ------------------------------------------------------------------ */

/** Mascara de bits: un paso puede disparar varias cosas y un objeto por paso asigna. */
export const EV_WALL = 1;
export const EV_SEGMENT = 2;
export const EV_BRICK = 4;
export const EV_CAPSULE_DROP = 8;
export const EV_CAPSULE_CATCH = 16;
export const EV_LIFE_LOST = 32;
export const EV_LEVEL_CLEAR = 64;
export const EV_OVER = 128;
export const EV_RESCUE = 256;
export const EV_LAUNCH = 512;
export const EV_STICK = 1024;

/* ------------------------------------------------------------------ */
/* Tipos                                                                */
/* ------------------------------------------------------------------ */

export type BreakoutRules = {
  width: number;
  height: number;
  ballRadius: number;
  /** u/s al lanzar. */
  ballSpeed: number;
  /** Multiplicador por rebote, por ejemplo 1.03. */
  accelPerHit: number;
  /** Techo, en multiplos de `ballSpeed`. */
  maxSpeedFactor: number;
  /** Radianes desde la vertical, con la pelota en la punta del segmento. */
  maxBounceRad: number;
  /** Ancho base de CADA segmento. La capsula Ancho le suma a los dos. */
  segmentWidth: number;
  segmentHeight: number;
  /** Y del borde superior de los segmentos. */
  segmentY: number;
  /** Lerp por cuadro de 60 Hz hacia la posicion recibida. */
  segmentFollow: number;
  /** Separacion minima entre bordes internos. En 0 forman una paleta solida. */
  minGap: number;
  /** Correa: distancia maxima entre centros. Es lo que obliga a coordinar. */
  maxSeparation: number;
  rows: number;
  cols: number;
  brickTop: number;
  brickSide: number;
  brickCellHeight: number;
  cellGap: number;
  /** 0..1. Probabilidad de que un ladrillo suelte capsula. */
  capsuleChance: number;
  capsuleSpeed: number;
  lives: number;
  /** Pausa tras perder una vida y antes del primer lanzamiento. */
  loseDelayS: number;
};

/** Rango permitido de un segmento. Se escribe sobre un destino para no asignar. */
export type Range = { min: number; max: number };

export type BreakoutState = {
  rules: BreakoutRules;
  /** 0-based. Al superar el ultimo, la partida termina ganada. */
  level: number;
  levelsCleared: number;
  lives: number;
  over: boolean;
  won: boolean;

  /** Centro actual de cada segmento, en unidades del mundo. */
  segX: Float32Array;
  /** Centro al que persigue, ya recortado al rango permitido. */
  segTarget: Float32Array;
  /** Lo ultimo que pidio el celular, 0..1 sobre el recorrido completo. */
  segWish: Float32Array;
  /** Ancho actual de CADA segmento. Cambia con la capsula Ancho. */
  segWidth: number;

  ballX: Float32Array;
  ballY: Float32Array;
  ballVx: Float32Array;
  ballVy: Float32Array;
  /** Modulo de la velocidad: el rebote conserva el modulo y cambia el angulo. */
  ballSpeed: Float32Array;
  ballAlive: Uint8Array;
  /** Asiento que la reboto por ultima vez. -1 si todavia nadie. */
  ballOwner: Int8Array;
  /** Asiento al que esta pegada por el iman. -1 si esta libre. */
  ballStuck: Int8Array;
  ballStuckOffset: Float32Array;
  ballStuckMs: Float32Array;
  maxSpeed: number;

  /** Grilla plana: romper un ladrillo es marcar un indice. */
  brickHp: Uint8Array;
  brickType: Uint8Array;
  brickMaxHp: Uint8Array;
  /** -1 sin capsula; si no, el tipo que suelta. Sembrado al armar el nivel. */
  brickCapsule: Int8Array;
  bricksLeft: number;
  cellW: number;
  cellH: number;

  capX: Float32Array;
  capY: Float32Array;
  capType: Int8Array;
  capAlive: Uint8Array;

  wideMs: number;
  slowMs: number;
  jointMs: number;
  magnetCharges: number;

  /** Puntos de ladrillo por asiento: se los lleva quien la reboto ultimo. */
  brickPoints: Int32Array;
  rescues: Int32Array;
  /** Contadores para el mando: cambian y el telefono se entera. */
  bounces: Int32Array;
  catches: Int32Array;

  /** Segundos hasta el proximo lanzamiento. 0 = pelota en juego. */
  serveTimerS: number;

  /* Ultimo evento, para que el render lo pinte sin asignar nada. */
  lastHitSeat: number;
  lastHitX: number;
  lastHitY: number;
  lastHitOffset: number;
  lastBrickX: number;
  lastBrickY: number;
  lastBrickType: number;
  lastCatchSeat: number;
  lastCatchType: number;

  /** Scratch de colision. Vive aca para no crear un objeto por paso. */
  circle: Circle;
  box: Box;
};

/* ------------------------------------------------------------------ */
/* Construccion                                                         */
/* ------------------------------------------------------------------ */

export function createBreakoutState(rules: BreakoutRules, rng: Rng): BreakoutState {
  const cells = rules.rows * rules.cols;
  const state: BreakoutState = {
    rules,
    level: 0,
    levelsCleared: 0,
    lives: rules.lives,
    over: false,
    won: false,

    segX: new Float32Array(BREAKOUT_SEATS),
    segTarget: new Float32Array(BREAKOUT_SEATS),
    segWish: new Float32Array(BREAKOUT_SEATS),
    segWidth: rules.segmentWidth,

    ballX: new Float32Array(MAX_BALLS),
    ballY: new Float32Array(MAX_BALLS),
    ballVx: new Float32Array(MAX_BALLS),
    ballVy: new Float32Array(MAX_BALLS),
    ballSpeed: new Float32Array(MAX_BALLS),
    ballAlive: new Uint8Array(MAX_BALLS),
    ballOwner: new Int8Array(MAX_BALLS).fill(-1),
    ballStuck: new Int8Array(MAX_BALLS).fill(-1),
    ballStuckOffset: new Float32Array(MAX_BALLS),
    ballStuckMs: new Float32Array(MAX_BALLS),
    maxSpeed: rules.ballSpeed * rules.maxSpeedFactor,

    brickHp: new Uint8Array(cells),
    brickType: new Uint8Array(cells),
    brickMaxHp: new Uint8Array(cells),
    brickCapsule: new Int8Array(cells).fill(-1),
    bricksLeft: 0,
    cellW: (rules.width - rules.brickSide * 2) / rules.cols,
    cellH: rules.brickCellHeight,

    capX: new Float32Array(MAX_CAPSULES),
    capY: new Float32Array(MAX_CAPSULES),
    capType: new Int8Array(MAX_CAPSULES).fill(-1),
    capAlive: new Uint8Array(MAX_CAPSULES),

    wideMs: 0,
    slowMs: 0,
    jointMs: 0,
    magnetCharges: 0,

    brickPoints: new Int32Array(BREAKOUT_SEATS),
    rescues: new Int32Array(BREAKOUT_SEATS),
    bounces: new Int32Array(BREAKOUT_SEATS),
    catches: new Int32Array(BREAKOUT_SEATS),

    serveTimerS: rules.loseDelayS,

    lastHitSeat: -1,
    lastHitX: 0,
    lastHitY: 0,
    lastHitOffset: 0,
    lastBrickX: 0,
    lastBrickY: 0,
    lastBrickType: 0,
    lastCatchSeat: -1,
    lastCatchType: -1,

    circle: { x: 0, y: 0, r: rules.ballRadius },
    box: { x: 0, y: 0, w: rules.segmentWidth, h: rules.segmentHeight },
  };

  // Arrancan lo mas juntos que las reglas permiten y en el medio: que el hueco
  // aparezca recien cuando alguien se mueve es la primera leccion del juego.
  const center = rules.width / 2;
  const half = (state.segWidth + rules.minGap) / 2;
  state.segX[0] = center - half;
  state.segX[1] = center + half;
  state.segTarget[0] = state.segX[0] ?? center;
  state.segTarget[1] = state.segX[1] ?? center;
  state.segWish[0] = normalizeCenter(state, state.segX[0] ?? center);
  state.segWish[1] = normalizeCenter(state, state.segX[1] ?? center);

  buildLevel(state, rng);
  parkBall(state);
  return state;
}

/**
 * Arma la grilla del nivel actual.
 *
 * Consume el RNG en orden fijo, celda por celda: con la misma semilla las
 * capsulas caen siempre de los mismos ladrillos, que es criterio de
 * aceptacion de la spec.
 */
export function buildLevel(state: BreakoutState, rng: Rng): void {
  const r = state.rules;
  let left = 0;
  for (let row = 0; row < r.rows; row++) {
    for (let col = 0; col < r.cols; col++) {
      const index = row * r.cols + col;
      state.brickHp[index] = 0;
      state.brickType[index] = BRICK_NORMAL;
      state.brickMaxHp[index] = 0;
      state.brickCapsule[index] = -1;
      if (!levelHasBrick(state.level, row, col, r.rows, r.cols)) continue;

      // El tipo se sortea SIEMPRE que hay ladrillo, aunque el nivel no use
      // blindados: asi la serie del PRNG no depende del patron y dos niveles
      // distintos con la misma semilla siguen siendo reproducibles.
      const roll = rng.next();
      const type = brickTypeFor(state.level, row, r.rows, roll);
      const hp = BRICK_HP[type] ?? 1;
      state.brickType[index] = type;
      state.brickHp[index] = hp;
      state.brickMaxHp[index] = hp;
      if (rng.chance(r.capsuleChance)) {
        state.brickCapsule[index] = rng.int(0, CAPSULE_KINDS - 1);
      }
      left++;
    }
  }
  state.bricksLeft = left;
}

/** Los cinco patrones. Sin huecos de diseno el tablero es una pared aburrida. */
function levelHasBrick(level: number, row: number, col: number, rows: number, cols: number): boolean {
  switch (level) {
    case 0:
      // Muro macizo pero corto: el nivel de aprender a no abrir el hueco.
      return row < Math.max(3, rows - 3);
    case 1:
      // Damero: obliga a rebotes largos y diagonales.
      return (row + col) % 2 === 0;
    case 2: {
      // Piramide centrada: el centro es lo ultimo que queda, justo donde esta
      // la junta de la paleta.
      const half = cols / 2;
      const reach = ((row + 1) / rows) * half;
      return Math.abs(col + 0.5 - half) <= reach;
    }
    case 3:
      // Columnas: pasillos verticales por donde la pelota se cuela hasta arriba.
      return col % 3 !== 1;
    default:
      // Fortaleza: marco lleno y nucleo macizo, con dos pasillos.
      return row === 0 || row === rows - 1 || col < 2 || col >= cols - 2 || (row > 2 && row < rows - 2);
  }
}

function brickTypeFor(level: number, row: number, rows: number, roll: number): number {
  // Explosivos escasos y repartidos: uno de cada quince y nunca en la fila de
  // abajo, donde reventaria medio tablero de arranque.
  if (roll < 0.07 && row > 0) return BRICK_BOMB;
  const depth = rows > 1 ? 1 - row / (rows - 1) : 0;
  // Cuanto mas arriba (mas dificil de alcanzar) mas duro, y solo desde el
  // segundo nivel: el primero tiene que poder terminarse.
  if (level >= 3 && depth > 0.75) return BRICK_ARMORED;
  if (level >= 1 && depth > 0.45) return BRICK_TOUGH;
  return BRICK_NORMAL;
}

/* ------------------------------------------------------------------ */
/* Segmentos: rango, orden y empuje                                     */
/* ------------------------------------------------------------------ */

function travelLo(state: BreakoutState): number {
  return state.segWidth / 2;
}

function travelHi(state: BreakoutState): number {
  return state.rules.width - state.segWidth / 2;
}

function normalizeCenter(state: BreakoutState, x: number): number {
  const lo = travelLo(state);
  const span = travelHi(state) - lo;
  if (span <= 0) return 0.5;
  return clamp((x - lo) / span, 0, 1);
}

function denormalizeCenter(state: BreakoutState, p: number): number {
  const lo = travelLo(state);
  return lo + clamp(p, 0, 1) * (travelHi(state) - lo);
}

/** Distancia minima entre centros. Con junta activa, la unica posible. */
function requiredDistance(state: BreakoutState): number {
  return state.jointMs > 0 ? state.segWidth : state.segWidth + state.rules.minGap;
}

/**
 * Margen de empuje: cuanto puede pedir un segmento MAS ALLA del borde interno
 * del companero.
 *
 * Sin margen, el recorte al rango permitido seria tan estricto que empujar
 * seria imposible, y la spec lo pide: "cuando uno empuja contra el otro, el
 * otro se corre". Con margen, ese excedente es exactamente lo que corre al
 * companero cuando `resolveTargets` reparte el conflicto.
 */
function pushMargin(state: BreakoutState): number {
  return state.segWidth;
}

/**
 * El rango permitido de un segmento, en unidades del mundo.
 *
 * Es la pieza que hace jugable el mando: el rango del dedo mapea a esto, y
 * esto cambia segun donde esta el companero. Si el companero se te viene
 * encima, el techo propio baja con el y el rango se achica contra la pared;
 * del otro lado tira la correa (`maxSeparation`), que impide separarse mas de
 * lo que la paleta aguanta.
 *
 * Con la capsula Junta el par se mueve como una sola paleta, asi que el rango
 * deja de depender del otro y pasa a ser el recorrido del par entero.
 */
export function segmentRange(state: BreakoutState, seat: number, out: Range): Range {
  const lo = travelLo(state);
  const hi = travelHi(state);
  const width = state.segWidth;

  if (state.jointMs > 0) {
    out.min = seat === 0 ? lo : lo + width;
    out.max = seat === 0 ? hi - width : hi;
    if (out.max < out.min) out.max = out.min;
    return out;
  }

  const req = requiredDistance(state);
  const maxD = Math.max(req, state.rules.maxSeparation);
  const margin = pushMargin(state);
  const other = state.segX[seat === 0 ? 1 : 0] ?? state.rules.width / 2;

  if (seat === 0) {
    out.min = Math.max(lo, other - maxD);
    out.max = Math.min(hi - req, other - req + margin);
  } else {
    out.min = Math.max(lo + req, other + req - margin);
    out.max = Math.min(hi, other + maxD);
  }
  // Si el companero esta contra una pared el rango puede degenerar; mejor un
  // punto que un rango invertido, que en el mando se dibujaria al reves.
  if (out.max < out.min) out.max = out.min;
  return out;
}

/** El mismo rango en 0..1, que es lo que entiende el slider del mando. */
export function segmentRangeNorm(state: BreakoutState, seat: number, out: Range): Range {
  segmentRange(state, seat, out);
  const min = normalizeCenter(state, out.min);
  const max = normalizeCenter(state, out.max);
  out.min = min;
  out.max = max < min ? min : max;
  return out;
}

/** Posicion normalizada actual de un segmento. Es lo que marca al companero. */
export function segmentPosition(state: BreakoutState, seat: number): number {
  return normalizeCenter(state, state.segX[seat] ?? state.rules.width / 2);
}

/**
 * Lo que pidio el celular.
 *
 * El host no confia en el payload: un cliente puede mandar NaN, 1e9 o nada.
 * Se saneia y se recorta al rango permitido ACA, que es donde se testea, y se
 * vuelve a recortar en cada paso porque el rango se mueve con el companero.
 */
export function setSegmentTarget(state: BreakoutState, seat: number, position: number): void {
  if (seat < 0 || seat >= BREAKOUT_SEATS) return;
  if (!Number.isFinite(position)) return;
  state.segWish[seat] = clamp(position, 0, 1);
  resolveTargets(state);
}

const rangeScratch: Range = { min: 0, max: 0 };

/**
 * Los dos destinos a la vez: recorte al rango permitido, orden, empuje y correa.
 *
 * Se resuelve sobre los DESTINOS y no sobre las posiciones, y eso es lo que
 * hace que la restriccion no se pueda violar nunca: los segmentos persiguen su
 * destino con un lerp, y un lerp entre dos configuraciones validas es valido
 * (la separacion resultante es una combinacion convexa de dos separaciones que
 * ya cumplen).
 */
function resolveTargets(state: BreakoutState): void {
  const lo = travelLo(state);
  const hi = travelHi(state);
  const req = requiredDistance(state);

  if (state.jointMs > 0) {
    // Con junta activa el par es rigido y cada uno tiene media autoridad sobre
    // el centro. Es lo que convierte esos 10 s en un Breakout normal de dos
    // personas moviendo una sola paleta.
    const width = state.segWidth;
    const wish0 = denormalizeCenter(state, state.segWish[0] ?? 0.5) + width / 2;
    const wish1 = denormalizeCenter(state, state.segWish[1] ?? 0.5) - width / 2;
    const center = clamp((wish0 + wish1) / 2, lo + width / 2, hi - width / 2);
    state.segTarget[0] = center - width / 2;
    state.segTarget[1] = center + width / 2;
    return;
  }

  const maxD = Math.max(req, state.rules.maxSeparation);

  segmentRange(state, 0, rangeScratch);
  let a = clamp(denormalizeCenter(state, state.segWish[0] ?? 0.5), rangeScratch.min, rangeScratch.max);
  segmentRange(state, 1, rangeScratch);
  let b = clamp(denormalizeCenter(state, state.segWish[1] ?? 0.5), rangeScratch.min, rangeScratch.max);

  // Los dos pueden pedir el mismo lugar por el margen de empuje. Se reparte
  // desde el medio: los dos empujan, el que insiste gana terreno, y ninguno
  // puede atravesar al otro.
  const distance = b - a;
  if (distance < req) {
    const mid = (a + b) / 2;
    a = mid - req / 2;
    b = mid + req / 2;
  } else if (distance > maxD) {
    const mid = (a + b) / 2;
    a = mid - maxD / 2;
    b = mid + maxD / 2;
  }
  if (a < lo) {
    b += lo - a;
    a = lo;
  }
  if (b > hi) {
    a -= b - hi;
    b = hi;
  }
  state.segTarget[0] = clamp(a, lo, hi);
  state.segTarget[1] = clamp(b, lo, hi);
}

/** Caja de un segmento, escrita sobre un destino ya existente. */
export function writeSegmentBox(state: BreakoutState, seat: number, box: Box): void {
  const r = state.rules;
  box.x = (state.segX[seat] ?? r.width / 2) - state.segWidth / 2;
  box.y = r.segmentY;
  box.w = state.segWidth;
  box.h = r.segmentHeight;
}

/** Hueco real entre bordes internos. 0 = paleta solida. Es lo que se dibuja. */
export function segmentGap(state: BreakoutState): number {
  const a = state.segX[0] ?? 0;
  const b = state.segX[1] ?? 0;
  return Math.max(0, b - a - state.segWidth);
}

function moveSegments(state: BreakoutState, dt: number): void {
  // Cambiar el ancho en caliente (capsula Ancho) o vencer la junta mueve las
  // reglas bajo los pies, asi que se corrige la configuracion antes de mover.
  enforcePositions(state);
  resolveTargets(state);
  const alpha = Math.min(1, state.rules.segmentFollow * dt * 60);
  for (let seat = 0; seat < BREAKOUT_SEATS; seat++) {
    const current = state.segX[seat] ?? 0;
    const goal = state.segTarget[seat] ?? current;
    state.segX[seat] = current + (goal - current) * alpha;
  }
}

/**
 * La red de seguridad de las posiciones.
 *
 * En marcha no hace nada —los destinos ya son validos y el lerp los preserva—
 * pero el invariante "nunca se superponen" no puede depender de que nadie
 * cambie el ancho ni la junta en el medio de una partida.
 */
function enforcePositions(state: BreakoutState): void {
  const lo = travelLo(state);
  const hi = travelHi(state);
  const req = requiredDistance(state);
  const maxD = state.jointMs > 0 ? req : Math.max(req, state.rules.maxSeparation);

  let a = clamp(state.segX[0] ?? lo, lo, hi);
  let b = clamp(state.segX[1] ?? hi, lo, hi);
  const distance = b - a;
  if (distance < req) {
    const mid = (a + b) / 2;
    a = mid - req / 2;
    b = mid + req / 2;
  } else if (distance > maxD) {
    const mid = (a + b) / 2;
    a = mid - maxD / 2;
    b = mid + maxD / 2;
  }
  if (a < lo) {
    b += lo - a;
    a = lo;
  }
  if (b > hi) {
    a -= b - hi;
    b = hi;
  }
  state.segX[0] = clamp(a, lo, hi);
  state.segX[1] = clamp(b, lo, hi);
}

/* ------------------------------------------------------------------ */
/* Pelotas                                                              */
/* ------------------------------------------------------------------ */

function pairCenter(state: BreakoutState): number {
  return ((state.segX[0] ?? 0) + (state.segX[1] ?? 0)) / 2;
}

/** Deja la pelota apoyada sobre la junta, esperando el lanzamiento. */
function parkBall(state: BreakoutState): void {
  const r = state.rules;
  for (let i = 0; i < MAX_BALLS; i++) {
    state.ballAlive[i] = 0;
    state.ballStuck[i] = -1;
  }
  state.ballAlive[0] = 1;
  state.ballOwner[0] = -1;
  state.ballX[0] = pairCenter(state);
  state.ballY[0] = r.segmentY - r.ballRadius - 1;
  state.ballVx[0] = 0;
  state.ballVy[0] = 0;
  state.ballSpeed[0] = r.ballSpeed;
}

/** Lanza la pelota parada, con angulo sembrado dentro de la cuna permitida. */
function launchBall(state: BreakoutState, rng: Rng): void {
  const r = state.rules;
  const angle = rng.range(-r.maxBounceRad * 0.5, r.maxBounceRad * 0.5);
  state.ballSpeed[0] = r.ballSpeed;
  state.ballVx[0] = r.ballSpeed * Math.sin(angle);
  state.ballVy[0] = -r.ballSpeed * Math.cos(angle);
}

function aliveBalls(state: BreakoutState): number {
  let n = 0;
  for (let i = 0; i < MAX_BALLS; i++) {
    if (state.ballAlive[i] === 1) n++;
  }
  return n;
}

/** Dos pelotas mas, en abanico desde la primera viva. La capsula Multi. */
function splitBalls(state: BreakoutState): void {
  let source = -1;
  for (let i = 0; i < MAX_BALLS; i++) {
    if (state.ballAlive[i] === 1 && (state.ballStuck[i] ?? -1) < 0) {
      source = i;
      break;
    }
  }
  if (source < 0) return;
  const speed = state.ballSpeed[source] ?? state.rules.ballSpeed;
  const vx = state.ballVx[source] ?? 0;
  const vy = state.ballVy[source] ?? -speed;
  const base = Math.atan2(vy, vx);
  let spawned = 0;
  for (let i = 0; i < MAX_BALLS && spawned < 2; i++) {
    if (state.ballAlive[i] === 1) continue;
    const angle = base + (spawned === 0 ? 0.42 : -0.42);
    state.ballAlive[i] = 1;
    state.ballStuck[i] = -1;
    state.ballOwner[i] = state.ballOwner[source] ?? -1;
    state.ballX[i] = state.ballX[source] ?? 0;
    state.ballY[i] = state.ballY[source] ?? 0;
    state.ballSpeed[i] = speed;
    state.ballVx[i] = speed * Math.cos(angle);
    state.ballVy[i] = speed * Math.sin(angle);
    spawned++;
  }
}

/** Suelta lo que el iman tenga pegado a ese asiento. */
export function releaseStuck(state: BreakoutState, seat: number): boolean {
  let released = false;
  for (let i = 0; i < MAX_BALLS; i++) {
    if (state.ballAlive[i] !== 1 || state.ballStuck[i] !== seat) continue;
    bounceAngle(state, i, seat);
    state.ballStuck[i] = -1;
    state.ballStuckMs[i] = 0;
    released = true;
  }
  return released;
}

/** Reescribe la velocidad segun donde pego en el segmento. Centro recto, punta abierta. */
function bounceAngle(state: BreakoutState, ball: number, seat: number): number {
  const r = state.rules;
  const half = state.segWidth / 2;
  const center = state.segX[seat] ?? r.width / 2;
  const offset = clamp(((state.ballX[ball] ?? center) - center) / half, -1, 1);
  const angle = offset * r.maxBounceRad;
  const speed = Math.min(state.maxSpeed, (state.ballSpeed[ball] ?? r.ballSpeed) * r.accelPerHit);
  state.ballSpeed[ball] = speed;
  // El segmento NO aporta su propia velocidad, solo angulo: con input remoto
  // y ruidoso, sumar la velocidad de la paleta se descontrola.
  state.ballVx[ball] = speed * Math.sin(angle);
  state.ballVy[ball] = -speed * Math.cos(angle);
  state.ballY[ball] = r.segmentY - r.ballRadius - SKIN;
  return offset;
}

function writeBrickBox(state: BreakoutState, index: number, box: Box): void {
  const r = state.rules;
  const col = index % r.cols;
  const row = (index - col) / r.cols;
  box.x = r.brickSide + col * state.cellW + r.cellGap / 2;
  box.y = r.brickTop + row * state.cellH + r.cellGap / 2;
  box.w = state.cellW - r.cellGap;
  box.h = state.cellH - r.cellGap;
}

/** Caja de un ladrillo por fila y columna. La usa el render y los tests. */
export function brickBox(state: BreakoutState, row: number, col: number, box: Box): Box {
  writeBrickBox(state, row * state.rules.cols + col, box);
  return box;
}

/** Caja envolvente del recorrido contra una caja. Descarte barato antes del barrido. */
function sweptTouchesBox(x: number, y: number, dx: number, dy: number, r: number, box: Box): boolean {
  const minX = (dx < 0 ? x + dx : x) - r;
  const maxX = (dx < 0 ? x : x + dx) + r;
  const minY = (dy < 0 ? y + dy : y) - r;
  const maxY = (dy < 0 ? y : y + dy) + r;
  return maxX >= box.x && minX <= box.x + box.w && maxY >= box.y && minY <= box.y + box.h;
}

/**
 * Un paso de una pelota, con barrido continuo.
 *
 * Se busca el impacto MAS TEMPRANO del tramo entre paredes, segmentos y
 * ladrillos, se avanza hasta ahi, se resuelve y se sigue con lo que queda del
 * paso. Sin esto, a velocidad maxima la pelota aparece del otro lado del
 * segmento y la vida se pierde sin que nadie vea por que.
 */
function moveBall(state: BreakoutState, ball: number, dt: number): number {
  const r = state.rules;
  const radius = r.ballRadius;
  const mul = state.slowMs > 0 ? SLOW_FACTOR : 1;
  let mask = 0;
  let remaining = 1;

  for (let pass = 0; pass < MAX_RESOLVES && remaining > 0; pass++) {
    const x = state.ballX[ball] ?? 0;
    const y = state.ballY[ball] ?? 0;
    const dx = (state.ballVx[ball] ?? 0) * dt * mul * remaining;
    const dy = (state.ballVy[ball] ?? 0) * dt * mul * remaining;
    if (dx === 0 && dy === 0) break;

    let bestT = 1;
    // 0 nada, 1 pared lateral, 2 techo, 3 segmento, 4 ladrillo.
    let bestKind = 0;
    let bestSeat = -1;
    let bestBrick = -1;

    // Paredes: analitico. Barrer una caja contra un plano infinito seria
    // pagar de mas por el mismo resultado.
    if (dx < 0) {
      const t = (radius - x) / dx;
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestKind = 1;
      }
    } else if (dx > 0) {
      const t = (r.width - radius - x) / dx;
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestKind = 1;
      }
    }
    if (dy < 0) {
      const t = (radius - y) / dy;
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestKind = 2;
      }
    }

    // Segmentos: solo bajando. Si no, una pelota que sale del segmento y
    // todavia lo solapa rebota de nuevo hacia abajo.
    if (dy > 0) {
      for (let seat = 0; seat < BREAKOUT_SEATS; seat++) {
        writeSegmentBox(state, seat, state.box);
        if (!sweptTouchesBox(x, y, dx, dy, radius, state.box)) continue;
        state.circle.x = x;
        state.circle.y = y;
        state.circle.r = radius;
        const t = sweepCircleBox(state.circle, dx, dy, state.box);
        if (t !== null && t >= 0 && t < bestT) {
          bestT = t;
          bestKind = 3;
          bestSeat = seat;
          bestBrick = -1;
        }
      }
    }

    // Ladrillos: descarte por rango de la grilla. Sin esto serian 112 barridos
    // por paso y por pelota.
    if (state.bricksLeft > 0) {
      const minX = (dx < 0 ? x + dx : x) - radius;
      const maxX = (dx < 0 ? x : x + dx) + radius;
      const minY = (dy < 0 ? y + dy : y) - radius;
      const maxY = (dy < 0 ? y : y + dy) + radius;
      const c0 = Math.max(0, Math.floor((minX - r.brickSide) / state.cellW));
      const c1 = Math.min(r.cols - 1, Math.floor((maxX - r.brickSide) / state.cellW));
      const r0 = Math.max(0, Math.floor((minY - r.brickTop) / state.cellH));
      const r1 = Math.min(r.rows - 1, Math.floor((maxY - r.brickTop) / state.cellH));

      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const index = row * r.cols + col;
          if ((state.brickHp[index] ?? 0) === 0) continue;
          writeBrickBox(state, index, state.box);
          if (!sweptTouchesBox(x, y, dx, dy, radius, state.box)) continue;
          state.circle.x = x;
          state.circle.y = y;
          state.circle.r = radius;
          const t = sweepCircleBox(state.circle, dx, dy, state.box);
          if (t !== null && t >= 0 && t < bestT) {
            bestT = t;
            bestKind = 4;
            bestBrick = index;
            bestSeat = -1;
          }
        }
      }
    }

    state.ballX[ball] = x + dx * bestT;
    state.ballY[ball] = y + dy * bestT;
    if (bestKind === 0) break;
    remaining *= 1 - bestT;

    if (bestKind === 1) {
      // Correccion ANTES de invertir: si no, en el paso siguiente sigue del
      // lado de afuera y queda vibrando contra el borde.
      state.ballX[ball] =
        (state.ballX[ball] ?? 0) < r.width / 2 ? radius + SKIN : r.width - radius - SKIN;
      state.ballVx[ball] = -(state.ballVx[ball] ?? 0);
      mask |= EV_WALL;
    } else if (bestKind === 2) {
      state.ballY[ball] = radius + SKIN;
      state.ballVy[ball] = -(state.ballVy[ball] ?? 0);
      mask |= EV_WALL;
    } else if (bestKind === 3) {
      mask |= hitSegment(state, ball, bestSeat);
      if ((state.ballStuck[ball] ?? -1) >= 0) break;
    } else if (bestBrick >= 0) {
      mask |= hitBrick(state, ball, bestBrick);
    }
  }

  if ((state.ballY[ball] ?? 0) > r.height + radius) {
    state.ballAlive[ball] = 0;
    state.ballStuck[ball] = -1;
  }
  return mask;
}

function hitSegment(state: BreakoutState, ball: number, seat: number): number {
  const r = state.rules;
  writeSegmentBox(state, seat, state.box);
  const cy = state.ballY[ball] ?? 0;
  // Impacto de costado: el borde del segmento devuelve la pelota de lado, no
  // hacia arriba. Sin esto se puede "levantar" una pelota desde abajo.
  if (cy > state.box.y - r.ballRadius + 0.5) {
    state.ballVx[ball] = -(state.ballVx[ball] ?? 0);
    const push = (state.ballX[ball] ?? 0) < (state.segX[seat] ?? 0) ? -SKIN : SKIN;
    state.ballX[ball] = (state.ballX[ball] ?? 0) + push;
    return EV_WALL;
  }

  let mask = EV_SEGMENT;
  state.ballOwner[ball] = seat;
  state.bounces[seat] = (state.bounces[seat] ?? 0) + 1;

  const half = state.segWidth / 2;
  const center = state.segX[seat] ?? r.width / 2;
  const offset = clamp(((state.ballX[ball] ?? center) - center) / half, -1, 1);

  // Rescate: rebote en el borde EXTERNO, el que da a la pared. Premia
  // estirarse hasta el limite de la correa en vez de quedarse en el centro.
  const outward = seat === 0 ? offset < 0 : offset > 0;
  if (outward && Math.abs(offset) >= RESCUE_EDGE) {
    state.rescues[seat] = (state.rescues[seat] ?? 0) + 1;
    mask |= EV_RESCUE;
  }

  if (state.magnetCharges > 0) {
    state.magnetCharges--;
    state.ballStuck[ball] = seat;
    state.ballStuckOffset[ball] = clamp((state.ballX[ball] ?? center) - center, -half, half);
    state.ballStuckMs[ball] = MAGNET_HOLD_MS;
    state.ballVx[ball] = 0;
    state.ballVy[ball] = 0;
    state.ballY[ball] = r.segmentY - r.ballRadius - SKIN;
    mask |= EV_STICK;
  } else {
    bounceAngle(state, ball, seat);
  }

  state.lastHitSeat = seat;
  state.lastHitX = state.ballX[ball] ?? 0;
  state.lastHitY = r.segmentY;
  state.lastHitOffset = offset;
  return mask;
}

function hitBrick(state: BreakoutState, ball: number, index: number): number {
  writeBrickBox(state, index, state.box);
  const cx = state.ballX[ball] ?? 0;
  const cy = state.ballY[ball] ?? 0;
  const nx = cx < state.box.x ? -1 : cx > state.box.x + state.box.w ? 1 : 0;
  const ny = cy < state.box.y ? -1 : cy > state.box.y + state.box.h ? 1 : 0;

  if (nx !== 0) state.ballVx[ball] = -(state.ballVx[ball] ?? 0);
  if (ny !== 0 || nx === 0) state.ballVy[ball] = -(state.ballVy[ball] ?? 0);
  state.ballX[ball] = cx + nx * SKIN;
  state.ballY[ball] = cy + ny * SKIN;

  const owner = state.ballOwner[ball] ?? -1;
  return damageBrick(state, index, owner, true) | EV_BRICK;
}

/**
 * Le saca un golpe a un ladrillo y, si lo rompe, paga y suelta la capsula.
 *
 * `chain` en false corta la cadena de los explosivos: un explosivo revienta a
 * sus ocho vecinos, pero los vecinos explosivos no vuelven a explotar. Sin ese
 * corte, un tablero denso se limpia entero de un solo golpe.
 */
function damageBrick(state: BreakoutState, index: number, owner: number, chain: boolean): number {
  const hp = state.brickHp[index] ?? 0;
  if (hp === 0) return 0;
  const next = hp - 1;
  state.brickHp[index] = next;
  if (next > 0) return 0;

  const type = state.brickType[index] ?? BRICK_NORMAL;
  state.bricksLeft--;
  if (owner >= 0) {
    state.brickPoints[owner] = (state.brickPoints[owner] ?? 0) + (BRICK_POINTS[type] ?? 0);
  }
  writeBrickBox(state, index, state.box);
  state.lastBrickX = state.box.x + state.box.w / 2;
  state.lastBrickY = state.box.y + state.box.h / 2;
  state.lastBrickType = type;

  let mask = 0;
  const capsule = state.brickCapsule[index] ?? -1;
  if (capsule >= 0) {
    state.brickCapsule[index] = -1;
    if (dropCapsule(state, state.lastBrickX, state.lastBrickY, capsule)) mask |= EV_CAPSULE_DROP;
  }

  if (type === BRICK_BOMB && chain) {
    const cols = state.rules.cols;
    const col = index % cols;
    const row = (index - col) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= state.rules.rows || nc < 0 || nc >= cols) continue;
        const neighbour = nr * cols + nc;
        // Un ladrillo ya roto no se vuelve a romper: sin esta guarda, resucitarlo
        // para reventarlo pagaria sus puntos dos veces y descontaria de mas.
        if ((state.brickHp[neighbour] ?? 0) === 0) continue;
        // Los vecinos revientan enteros, sin importar cuantos golpes les
        // quedaban: es lo que hace que valga la pena buscar el explosivo.
        state.brickHp[neighbour] = 1;
        mask |= damageBrick(state, neighbour, owner, false);
      }
    }
  }
  return mask;
}

/* ------------------------------------------------------------------ */
/* Capsulas                                                             */
/* ------------------------------------------------------------------ */

function dropCapsule(state: BreakoutState, x: number, y: number, type: number): boolean {
  for (let i = 0; i < MAX_CAPSULES; i++) {
    if (state.capAlive[i] === 1) continue;
    state.capAlive[i] = 1;
    state.capX[i] = x;
    state.capY[i] = y;
    state.capType[i] = type;
    return true;
  }
  return false;
}

function applyCapsule(state: BreakoutState, type: number): void {
  if (type === CAP_WIDE) {
    state.wideMs = WIDE_MS;
    setSegmentWidth(state, state.rules.segmentWidth + WIDE_BONUS);
  } else if (type === CAP_SLOW) {
    state.slowMs = SLOW_MS;
  } else if (type === CAP_MULTI) {
    splitBalls(state);
  } else if (type === CAP_MAGNET) {
    state.magnetCharges++;
  } else if (type === CAP_JOINT) {
    state.jointMs = JOINT_MS;
  }
}

function setSegmentWidth(state: BreakoutState, width: number): void {
  if (state.segWidth === width) return;
  state.segWidth = width;
  // El ancho nuevo puede dejar los segmentos superpuestos o fuera de la
  // cancha: se reordenan en el acto, no en el paso siguiente.
  enforcePositions(state);
  resolveTargets(state);
}

function updateCapsules(state: BreakoutState, dt: number): number {
  const r = state.rules;
  let mask = 0;
  for (let i = 0; i < MAX_CAPSULES; i++) {
    if (state.capAlive[i] !== 1) continue;
    const y = (state.capY[i] ?? 0) + r.capsuleSpeed * dt;
    state.capY[i] = y;
    if (y > r.height + 30) {
      state.capAlive[i] = 0;
      continue;
    }
    // La agarra CUALQUIERA de los dos segmentos: es cooperativo, no una
    // carrera por quedarse con el premio.
    for (let seat = 0; seat < BREAKOUT_SEATS; seat++) {
      writeSegmentBox(state, seat, state.box);
      const x = state.capX[i] ?? 0;
      // Las medias medidas son las que dibuja el proyector: lo que se ve es
      // exactamente lo que agarra, o la capsula que "pasa rozando" se siente
      // robada.
      if (
        y + CAPSULE_HALF_H < state.box.y ||
        y - CAPSULE_HALF_H > state.box.y + state.box.h ||
        x + CAPSULE_HALF_W < state.box.x ||
        x - CAPSULE_HALF_W > state.box.x + state.box.w
      ) {
        continue;
      }
      const type = state.capType[i] ?? -1;
      state.capAlive[i] = 0;
      state.catches[seat] = (state.catches[seat] ?? 0) + 1;
      state.lastCatchSeat = seat;
      state.lastCatchType = type;
      if (type >= 0) applyCapsule(state, type);
      mask |= EV_CAPSULE_CATCH;
      break;
    }
  }
  return mask;
}

function clearCapsules(state: BreakoutState): void {
  for (let i = 0; i < MAX_CAPSULES; i++) state.capAlive[i] = 0;
}

/* ------------------------------------------------------------------ */
/* El paso                                                              */
/* ------------------------------------------------------------------ */

/**
 * Un paso de simulacion. Es la unica funcion que mueve algo.
 *
 * `dt` es fijo por contrato: con delta variable la simulacion deja de ser
 * determinista y el barrido trabaja sobre tramos de largo distinto.
 *
 * Devuelve una mascara de bits con lo que paso, no un objeto: un objeto de
 * evento por paso son 120 asignaciones por segundo.
 */
export function stepBreakout(state: BreakoutState, dt: number, rng: Rng): number {
  if (state.over) return 0;
  let mask = 0;
  const ms = dt * 1000;

  if (state.wideMs > 0) {
    state.wideMs -= ms;
    if (state.wideMs <= 0) {
      state.wideMs = 0;
      setSegmentWidth(state, state.rules.segmentWidth);
    }
  }
  if (state.slowMs > 0) state.slowMs = Math.max(0, state.slowMs - ms);
  if (state.jointMs > 0) state.jointMs = Math.max(0, state.jointMs - ms);

  moveSegments(state, dt);

  if (state.serveTimerS > 0) {
    state.serveTimerS -= dt;
    // La pelota espera apoyada sobre la junta y se mueve con ella: asi se ve
    // desde donde va a salir.
    state.ballX[0] = pairCenter(state);
    state.ballY[0] = state.rules.segmentY - state.rules.ballRadius - 1;
    if (state.serveTimerS <= TIMER_EPS) {
      state.serveTimerS = 0;
      launchBall(state, rng);
      mask |= EV_LAUNCH;
    }
    return mask;
  }

  for (let i = 0; i < MAX_BALLS; i++) {
    if (state.ballAlive[i] !== 1) continue;
    const seat = state.ballStuck[i] ?? -1;
    if (seat >= 0) {
      state.ballX[i] = (state.segX[seat] ?? 0) + (state.ballStuckOffset[i] ?? 0);
      state.ballY[i] = state.rules.segmentY - state.rules.ballRadius - SKIN;
      const left = (state.ballStuckMs[i] ?? 0) - ms;
      state.ballStuckMs[i] = left;
      // Suelta sola: con la pelota pegada, buscar el boton cuesta la partida.
      if (left <= 0) {
        bounceAngle(state, i, seat);
        state.ballStuck[i] = -1;
        mask |= EV_LAUNCH;
      }
      continue;
    }
    mask |= moveBall(state, i, dt);
  }

  mask |= updateCapsules(state, dt);

  if (state.bricksLeft === 0) {
    state.levelsCleared++;
    if (state.level + 1 >= LEVEL_COUNT) {
      state.over = true;
      state.won = true;
      return mask | EV_LEVEL_CLEAR | EV_OVER;
    }
    state.level++;
    startRound(state, rng);
    return mask | EV_LEVEL_CLEAR;
  }

  if (aliveBalls(state) === 0) {
    state.lives--;
    if (state.lives <= 0) {
      state.lives = 0;
      state.over = true;
      state.won = false;
      return mask | EV_LIFE_LOST | EV_OVER;
    }
    startRound(state, rng);
    return mask | EV_LIFE_LOST;
  }

  return mask;
}

/** Nivel nuevo o vida nueva: se limpian los efectos y vuelve la pausa. */
function startRound(state: BreakoutState, rng: Rng): void {
  const fresh = state.bricksLeft === 0;
  if (fresh) buildLevel(state, rng);
  clearCapsules(state);
  state.wideMs = 0;
  state.slowMs = 0;
  state.jointMs = 0;
  state.magnetCharges = 0;
  setSegmentWidth(state, state.rules.segmentWidth);
  parkBall(state);
  state.serveTimerS = state.rules.loseDelayS;
}

/* ------------------------------------------------------------------ */
/* Puntaje                                                              */
/* ------------------------------------------------------------------ */

/**
 * Formula de R5-ROMPELADRILLOS.md.
 *
 * Los ladrillos son de quien la reboto por ultima vez —competencia sana
 * adentro de un juego cooperativo— pero el bono por nivel es colectivo e
 * identico para los dos.
 */
export function breakoutPoints(brickPoints: number, levelsCleared: number, rescues: number): number {
  return Math.max(0, Math.round(brickPoints + levelsCleared * 400 + rescues * 30));
}

/** Puntos de un asiento, leidos del estado. Es lo que va al outcome. */
export function seatPoints(state: BreakoutState, seat: number): number {
  return breakoutPoints(
    state.brickPoints[seat] ?? 0,
    state.levelsCleared,
    state.rescues[seat] ?? 0,
  );
}
