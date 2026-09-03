import type { Rng } from "@/core/engine/rng";
import { clamp } from "@/core/engine/collide";
import { isBoostArc, sampleAtArc, wrapAngle, type TrackGeometry } from "./track";

/**
 * La carrera entera: fisica, vueltas, IA y puntaje. Sin React, sin Pixi, sin
 * WebGL y sin DOM. El Mode 7 es una forma de mirar esto, no el juego.
 *
 * La decision que ordena todo el archivo: **el auto no se ubica leyendo
 * pixeles, se proyecta sobre la linea central**. De esa proyeccion salen tres
 * numeros —avance de arco, desvio lateral y muestra mas cercana— y con esos
 * tres se resuelve estar en pista, chocar el muro, contar vueltas, ordenar el
 * puesto y manejar a los rivales. Es exacto, es barato y, sobre todo, es
 * testeable sin montar una GPU.
 *
 * La busqueda de la muestra mas cercana mira solo una ventana alrededor de la
 * ultima: el auto se mueve poco por paso, asi que buscar en las 400 muestras
 * seria pagar 400 veces por una respuesta que esta a dos indices.
 *
 * Manejo **arcade**: velocidad escalar, angulo del auto y angulo del
 * movimiento. El derrape es la diferencia entre esos dos angulos. Nada de
 * neumaticos ni suspension.
 */

/* ------------------------------------------------------------------ */
/* Constantes del modelo                                                */
/* ------------------------------------------------------------------ */

/** Radianes por segundo con autoridad total de giro. */
const TURN_RATE = 2.35;
/** Derrapando se dobla mas: es el premio por asumir el riesgo. */
const DRIFT_TURN_MULT = 1.5;
/** Debajo de este porcentaje de la maxima no se dobla: parado no se gira. */
const TURN_AUTHORITY_SPEED = 0.22;
/** Con cuanta fuerza el movimiento se alinea al morro. Mas alto, mas agarre. */
const GRIP_RATE = 11;
/** Derrapando el agarre se cae a esta fraccion. Es lo que hace deslizar. */
const DRIFT_GRIP_MULT = 0.2;
/** Fuera de pista tambien se pierde agarre, no solo velocidad. */
const OFF_TRACK_GRIP_MULT = 0.55;
/** Angulo maximo entre el morro y el movimiento. Sin tope, el auto trompea. */
const MAX_SLIP = 0.66;
/** Multiplicador de velocidad maxima con turbo activo. */
const BOOST_SPEED_MULT = 1.45;
/** Cuanto dura el impulso de una rampa del piso. */
const BOOST_PAD_MS = 950;
/** Velocidad minima para poder empezar a derrapar, como fraccion de la maxima. */
const MIN_DRIFT_SPEED = 0.42;
/** Cuanto hay que sostener el derrape para cada nivel de carga, en ms. */
const DRIFT_LEVEL_MS = [420, 950, 1500] as const;
/** Duracion del turbo que suelta cada nivel, en ms. Indice 0 = sin carga. */
const TURBO_MS = [0, 460, 780, 1150] as const;
/** Que fraccion de la velocidad sobrevive a un golpe contra el muro. */
const WALL_SPEED_KEEP = 0.45;
/** Frenada extra fuera de pista, como fraccion de la maxima por segundo. */
const OFF_TRACK_DRAG = 1.15;
/** Freno del jugador, como fraccion de la maxima por segundo. */
const BRAKE_DRAG = 1.9;
/** Muestras a cada lado que mira la proyeccion. */
const PROJECT_WINDOW = 18;
/** Cuanto tolera el juego a alguien trabado o de contramano antes de reubicarlo. */
const STUCK_MS = 5000;
/** Por debajo de esto se considera trabado, como fraccion de la maxima. */
const STUCK_SPEED = 0.12;
/** Radio de los autos para el empujon entre rivales, en unidades. */
const CAR_RADIUS = 13;

/** Cuantos portones tiene una vuelta, contando la meta. */
export const CHECKPOINTS = 4;
/** Tope duro de vueltas, para dimensionar el buffer de tiempos sin asignar. */
export const MAX_LAPS = 9;
/** Tope duro de rivales. */
export const MAX_RIVALS = 7;

/* ------------------------------------------------------------------ */
/* Tipos                                                                */
/* ------------------------------------------------------------------ */

export type RaceRules = {
  /** Aceleracion nominal en unidades/s². La curva es asintotica. */
  accel: number;
  maxSpeed: number;
  /** 0..1. Cuanto agarra en curva antes de empezar a deslizar. */
  grip: number;
  /** 0..1. Techo de velocidad fuera de la pista. */
  offTrackFactor: number;
  laps: number;
  rivalCount: number;
  /** 0..1. Fraccion de la velocidad maxima que persigue la IA. */
  aiSkill: number;
  /** Tiempo de referencia del puntaje, en ms. */
  targetTotalMs: number;
};

export type Car = {
  /* --- estado fisico --- */
  x: number;
  y: number;
  /** Hacia donde apunta el morro, en radianes. */
  heading: number;
  /** Hacia donde se mueve de verdad. La diferencia con `heading` es el derrape. */
  velAngle: number;
  speed: number;
  /** Copia del cuadro anterior, para interpolar el dibujo. */
  px: number;
  py: number;
  pheading: number;

  /* --- ubicacion sobre la pista --- */
  /** Muestra mas cercana de la linea central. */
  sample: number;
  /** Avance de arco, en [0, length). */
  s: number;
  /** Desvio con signo respecto del centro. Positivo hacia la izquierda. */
  lateral: number;
  /** Normal de la pista en la muestra actual. Se guarda para no recalcularla. */
  nx: number;
  ny: number;
  onTrack: boolean;

  /* --- carrera --- */
  /** Avance desenrollado dentro de la vuelta actual. */
  lapDist: number;
  /** Proximo porton que hay que cruzar. 0 es la meta. */
  nextGate: number;
  lap: number;
  lapMs: number;
  totalMs: number;
  bestLapMs: number;
  lapTimes: Float64Array;
  finished: boolean;

  /* --- manejo --- */
  steer: number;
  driftDir: number;
  driftMs: number;
  driftLevel: number;
  turboMs: number;
  boostMs: number;
  /** Techo de velocidad propio. La IA lo baja en curva; el jugador va en 1. */
  speedScale: number;
  stuckMs: number;

  /* --- estadisticas --- */
  offTrackCount: number;
  wasOffTrack: boolean;
  topSpeed: number;

  /* --- IA --- */
  isAi: boolean;
  aiOffset: number;
  aiSkill: number;
};

export type RaceEvents = {
  lapDone: boolean;
  wallHit: boolean;
  wentOffTrack: boolean;
  boostPad: boolean;
  /** Nivel de turbo que se acaba de soltar, 0 si ninguno. */
  turboLaunch: number;
  respawn: boolean;
  finished: boolean;
};

export type Race = {
  track: TrackGeometry;
  rules: RaceRules;
  player: Car;
  rivals: Car[];
  events: RaceEvents;
  elapsedMs: number;
  finished: boolean;
};

/* ------------------------------------------------------------------ */
/* Construccion                                                         */
/* ------------------------------------------------------------------ */

function createCar(isAi: boolean): Car {
  return {
    x: 0,
    y: 0,
    heading: 0,
    velAngle: 0,
    speed: 0,
    px: 0,
    py: 0,
    pheading: 0,
    sample: 0,
    s: 0,
    lateral: 0,
    nx: 0,
    ny: 1,
    onTrack: true,
    lapDist: 0,
    nextGate: 1,
    lap: 0,
    lapMs: 0,
    totalMs: 0,
    bestLapMs: 0,
    lapTimes: new Float64Array(MAX_LAPS),
    finished: false,
    steer: 0,
    driftDir: 0,
    driftMs: 0,
    driftLevel: 0,
    turboMs: 0,
    boostMs: 0,
    speedScale: 1,
    stuckMs: 0,
    offTrackCount: 0,
    wasOffTrack: false,
    topSpeed: 0,
    isAi,
    aiOffset: 0,
    aiSkill: 1,
  };
}

/** Deja el auto sobre la linea central en la posicion de arco pedida. */
function placeCar(car: Car, track: TrackGeometry, arc: number, lateral: number): void {
  const i = sampleAtArc(track, arc);
  const h = track.headings[i] ?? 0;
  const nx = -Math.sin(h);
  const ny = Math.cos(h);
  car.x = (track.xs[i] ?? 0) + nx * lateral;
  car.y = (track.ys[i] ?? 0) + ny * lateral;
  car.heading = h;
  car.velAngle = h;
  car.px = car.x;
  car.py = car.y;
  car.pheading = h;
  car.sample = i;
  car.nx = nx;
  car.ny = ny;
  car.lateral = lateral;
  car.s = arc;
  car.onTrack = Math.abs(lateral) <= track.halfWidth;
}

/**
 * Arma la carrera. Todo el azar sale de `rng`, asi que la misma semilla da
 * exactamente la misma grilla de rivales — que es, junto con la pista
 * compartida, lo unico que hace comparables los tiempos entre celulares.
 */
export function createRace(track: TrackGeometry, rules: RaceRules, rng: Rng): Race {
  const player = createCar(false);
  placeCar(player, track, 0, 0);

  const rivals: Car[] = [];
  const count = Math.min(MAX_RIVALS, Math.max(0, Math.round(rules.rivalCount)));
  for (let i = 0; i < count; i++) {
    const rival = createCar(true);
    // Salen adelante en grilla escalonada: si salieran atras nadie los veria,
    // y estan justamente para dar referencia de velocidad.
    const lane = i % 2 === 0 ? 1 : -1;
    placeCar(rival, track, 26 + i * 22, lane * track.halfWidth * 0.5);
    // Siempre corridos a un costado: el carril del medio queda libre para
    // pasarlos. Un peloton clavado en el centro convierte la primera vuelta en
    // un embudo, y eso no es dificultad, es un tapon.
    rival.aiOffset = lane * rng.range(0.34, 0.6) * track.halfWidth;
    // Cada rival corre a un ritmo apenas distinto: un peloton clonado se lee
    // como un error de render, no como una carrera.
    rival.aiSkill = clamp(rules.aiSkill + rng.range(-0.07, 0.07), 0.25, 1.1);
    rivals.push(rival);
  }

  return {
    track,
    rules,
    player,
    rivals,
    events: {
      lapDone: false,
      wallHit: false,
      wentOffTrack: false,
      boostPad: false,
      turboLaunch: 0,
      respawn: false,
      finished: false,
    },
    elapsedMs: 0,
    finished: false,
  };
}

/* ------------------------------------------------------------------ */
/* Proyeccion sobre la pista                                            */
/* ------------------------------------------------------------------ */

/**
 * Ubica el auto sobre la linea central.
 *
 * Mira solo `PROJECT_WINDOW` muestras a cada lado de la ultima conocida: a
 * velocidad maxima el auto avanza menos de media muestra por paso, asi que la
 * respuesta siempre esta ahi. Buscar en todo el circuito seria pagar cien
 * veces mas por el mismo numero.
 */
export function projectCar(car: Car, track: TrackGeometry): void {
  const count = track.count;
  let bestD2 = Infinity;
  let bestI = car.sample;
  let bestT = 0;
  let bestNx = car.nx;
  let bestNy = car.ny;

  for (let k = -PROJECT_WINDOW; k <= PROJECT_WINDOW; k++) {
    const i = (car.sample + k + count * 2) % count;
    const j = (i + 1) % count;
    const ax = track.xs[i] ?? 0;
    const ay = track.ys[i] ?? 0;
    const ex = (track.xs[j] ?? 0) - ax;
    const ey = (track.ys[j] ?? 0) - ay;
    const len2 = ex * ex + ey * ey;
    if (len2 <= 0) continue;
    let t = ((car.x - ax) * ex + (car.y - ay) * ey) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = car.x - (ax + ex * t);
    const dy = car.y - (ay + ey * t);
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestI = i;
      bestT = t;
      const len = Math.sqrt(len2);
      bestNx = -ey / len;
      bestNy = ex / len;
    }
  }

  const ax = track.xs[bestI] ?? 0;
  const ay = track.ys[bestI] ?? 0;
  car.sample = bestI;
  car.nx = bestNx;
  car.ny = bestNy;
  car.lateral = (car.x - ax) * bestNx + (car.y - ay) * bestNy;
  let s = (bestI + bestT) * track.spacing;
  if (s >= track.length) s -= track.length;
  car.s = s;
  car.onTrack = Math.abs(car.lateral) <= track.halfWidth;
}

/* ------------------------------------------------------------------ */
/* Vueltas y portones                                                   */
/* ------------------------------------------------------------------ */

/** Nivel de carga del derrape: 0, 1, 2 o 3. */
export function driftLevelOf(driftMs: number): number {
  if (driftMs >= (DRIFT_LEVEL_MS[2] ?? 0)) return 3;
  if (driftMs >= (DRIFT_LEVEL_MS[1] ?? 0)) return 2;
  if (driftMs >= (DRIFT_LEVEL_MS[0] ?? 0)) return 1;
  return 0;
}

/**
 * Avanza los portones con el desplazamiento de arco del paso.
 *
 * Los portones se cruzan **en orden**: sin eso, alguien corta campo traviesa,
 * cruza la meta de contramano y se lleva la vuelta. Y como solo se mira el
 * proximo, ir para atras no descuenta nada ni vuelve a contar lo mismo.
 */
function advanceGates(race: Race, car: Car, fromS: number, ds: number): void {
  if (ds <= 0) return;
  const { track, rules } = race;
  let cursor = fromS;
  let left = ds;

  for (let guard = 0; guard < CHECKPOINTS + 1; guard++) {
    const gateArc = car.nextGate === 0 ? 0 : (car.nextGate * track.length) / CHECKPOINTS;
    let rel = gateArc - cursor;
    while (rel <= 0) rel += track.length;
    if (rel > left) return;

    cursor = gateArc;
    left -= rel;

    if (car.nextGate === 0) {
      // Cruzo la meta con todos los portones hechos: la vuelta vale.
      if (car.lap < MAX_LAPS) car.lapTimes[car.lap] = car.lapMs;
      if (car.bestLapMs === 0 || car.lapMs < car.bestLapMs) car.bestLapMs = car.lapMs;
      car.lap++;
      car.lapMs = 0;
      car.lapDist = 0;
      if (!car.isAi) race.events.lapDone = true;
      if (car.lap >= rules.laps) {
        car.finished = true;
        return;
      }
    }
    car.nextGate = (car.nextGate + 1) % CHECKPOINTS;
  }
}

/* ------------------------------------------------------------------ */
/* Fisica de un auto                                                    */
/* ------------------------------------------------------------------ */

function stepCar(
  race: Race,
  car: Car,
  dt: number,
  steer: number,
  drift: boolean,
  brake: boolean,
): void {
  if (car.finished) return;
  const { track, rules } = race;
  const ms = dt * 1000;

  car.px = car.x;
  car.py = car.y;
  car.pheading = car.heading;
  car.totalMs += ms;
  car.lapMs += ms;
  car.steer = steer;

  /* --- Derrape: carga mientras se sostiene, dispara al soltar -------- */
  const canDrift = car.speed > rules.maxSpeed * MIN_DRIFT_SPEED && Math.abs(steer) > 0.25;
  if (drift && canDrift) {
    const dir = steer > 0 ? 1 : -1;
    if (car.driftDir === 0) car.driftDir = dir;
    if (car.driftDir === dir) car.driftMs += ms;
    else {
      // Cambiar de lado corta la carga: si no, se sostiene el boton y listo.
      car.driftDir = dir;
      car.driftMs = 0;
    }
  } else if (car.driftDir !== 0) {
    const level = driftLevelOf(car.driftMs);
    if (level > 0) {
      car.turboMs = TURBO_MS[level] ?? 0;
      if (!car.isAi) race.events.turboLaunch = level;
    }
    car.driftDir = 0;
    car.driftMs = 0;
  }
  car.driftLevel = driftLevelOf(car.driftMs);
  const drifting = car.driftDir !== 0;

  if (car.turboMs > 0) car.turboMs = Math.max(0, car.turboMs - ms);
  if (car.boostMs > 0) car.boostMs = Math.max(0, car.boostMs - ms);
  const boosting = car.turboMs > 0 || car.boostMs > 0;

  /* --- Acelerador: automatico y con curva asintotica ---------------- */
  // Sin boton de gas: en movil el pulgar que lo sostendria es el que hace
  // falta para doblar.
  const surface = car.onTrack ? 1 : rules.offTrackFactor;
  const cap = rules.maxSpeed * surface * car.speedScale * (boosting ? BOOST_SPEED_MULT : 1);
  const approach = rules.accel / rules.maxSpeed;
  car.speed += (cap - car.speed) * Math.min(1, approach * dt);
  if (!car.onTrack) car.speed -= rules.maxSpeed * OFF_TRACK_DRAG * dt;
  if (brake) car.speed -= rules.maxSpeed * BRAKE_DRAG * dt;
  if (car.speed < 0) car.speed = 0;
  if (car.speed > car.topSpeed) car.topSpeed = car.speed;

  /* --- Direccion ----------------------------------------------------- */
  const authority = Math.min(1, car.speed / (rules.maxSpeed * TURN_AUTHORITY_SPEED));
  const turn = TURN_RATE * authority * (drifting ? DRIFT_TURN_MULT : 1);
  car.heading = wrapAngle(car.heading + steer * turn * dt);

  /* --- Agarre: el movimiento persigue al morro ----------------------- */
  const gripRate =
    GRIP_RATE *
    rules.grip *
    (drifting ? DRIFT_GRIP_MULT : 1) *
    (car.onTrack ? 1 : OFF_TRACK_GRIP_MULT);
  const slip = wrapAngle(car.heading - car.velAngle);
  car.velAngle = wrapAngle(car.velAngle + slip * Math.min(1, gripRate * dt));
  // Tope de deslizamiento: sin esto el auto trompea y deja de ser manejable.
  const excess = wrapAngle(car.heading - car.velAngle);
  if (excess > MAX_SLIP) car.velAngle = wrapAngle(car.heading - MAX_SLIP);
  else if (excess < -MAX_SLIP) car.velAngle = wrapAngle(car.heading + MAX_SLIP);

  /* --- Integracion --------------------------------------------------- */
  const fromS = car.s;
  car.x += Math.cos(car.velAngle) * car.speed * dt;
  car.y += Math.sin(car.velAngle) * car.speed * dt;

  projectCar(car, track);

  /* --- Muro ---------------------------------------------------------- */
  const limit = track.halfWidth + track.shoulder;
  if (Math.abs(car.lateral) > limit) {
    const sign = car.lateral > 0 ? 1 : -1;
    const over = Math.abs(car.lateral) - limit;
    car.x -= car.nx * over * sign;
    car.y -= car.ny * over * sign;
    car.lateral = limit * sign;
    car.speed *= WALL_SPEED_KEEP;
    // Rebote: el movimiento se refleja hacia adentro y el morro acompana.
    const tangent = track.headings[car.sample] ?? car.heading;
    car.velAngle = wrapAngle(tangent - wrapAngle(car.velAngle - tangent) * 0.3);
    car.heading = wrapAngle(tangent + wrapAngle(car.heading - tangent) * 0.4);
    car.driftDir = 0;
    car.driftMs = 0;
    if (!car.isAi) race.events.wallHit = true;
  }

  /* --- Salidas de pista y rampas ------------------------------------- */
  if (!car.onTrack && !car.wasOffTrack) {
    car.offTrackCount++;
    if (!car.isAi) race.events.wentOffTrack = true;
  }
  car.wasOffTrack = !car.onTrack;

  if (car.onTrack && isBoostArc(track, car.s) && Math.abs(car.lateral) < track.halfWidth * 0.9) {
    if (car.boostMs < BOOST_PAD_MS * 0.6) {
      car.boostMs = BOOST_PAD_MS;
      if (!car.isAi) race.events.boostPad = true;
    }
  }

  /* --- Avance de arco y portones ------------------------------------- */
  let ds = car.s - fromS;
  const half = track.length / 2;
  if (ds < -half) ds += track.length;
  else if (ds > half) ds -= track.length;
  car.lapDist += ds;
  advanceGates(race, car, fromS, ds);

  /* --- Trabado o de contramano --------------------------------------- */
  const tangent = track.headings[car.sample] ?? car.heading;
  const forward = Math.cos(wrapAngle(car.heading - tangent));
  if (car.speed < rules.maxSpeed * STUCK_SPEED || forward < -0.2) car.stuckMs += ms;
  else car.stuckMs = 0;

  if (car.stuckMs >= STUCK_MS) {
    // Reubicar mirando bien es menos frustrante que dejar a alguien girando
    // contra un muro hasta que se acabe el tiempo.
    placeCar(car, track, car.s, clamp(car.lateral, -track.halfWidth * 0.6, track.halfWidth * 0.6));
    car.speed = rules.maxSpeed * 0.3;
    car.stuckMs = 0;
    car.turboMs = 0;
    car.driftDir = 0;
    car.driftMs = 0;
    if (!car.isAi) race.events.respawn = true;
  }
}

/* ------------------------------------------------------------------ */
/* IA                                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un rival mira un punto adelante sobre la linea central, corrido a su carril,
 * y dobla hacia el. Antes de la curva levanta el pie segun la severidad ya
 * precalculada en la pista.
 *
 * No hace falta mas: los rivales no compiten por el puntaje, estan para dar
 * referencia de velocidad y para que la pista no se sienta vacia.
 */
function driveAi(race: Race, car: Car, dt: number): void {
  const track = race.track;
  const look = 42 + car.speed * 0.6;

  // Severidad de la curva que viene: 0 en recta, ~2.8 rad en una horquilla.
  const ahead = sampleAtArc(track, car.s + look * 0.8);
  const severity = track.corners[ahead] ?? 0;
  const cornerCap = 1 / (1 + severity * severity * 0.22);

  // En curva cerrada el rival se vuelve al centro. Mantener el carril en una
  // horquilla es exactamente como se termina en el pasto.
  const offset = car.aiOffset * (1 - Math.min(0.85, severity * 0.38));
  const target = sampleAtArc(track, car.s + look);
  const th = track.headings[target] ?? 0;
  const tx = (track.xs[target] ?? 0) - Math.sin(th) * offset;
  const ty = (track.ys[target] ?? 0) + Math.cos(th) * offset;

  const desired = Math.atan2(ty - car.y, tx - car.x);
  const steer = clamp(wrapAngle(desired - car.heading) * 3, -1, 1);

  car.speedScale = clamp(car.aiSkill * cornerCap, 0.28, 1.1);

  // Derrapa sola en las curvas cerradas: se ve, y ademas es lo que le permite
  // pasarlas sin irse afuera.
  const drift = severity > 1.15 && Math.abs(steer) > 0.45;
  stepCar(race, car, dt, steer, drift, false);
}

/* ------------------------------------------------------------------ */
/* Paso de la carrera                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un paso de simulacion. `steer` en -1..1, el resto booleanos.
 * No asigna nada: los eventos viven en un objeto reusado.
 */
export function stepRace(
  race: Race,
  dt: number,
  steer: number,
  drift: boolean,
  brake: boolean,
): void {
  const events = race.events;
  events.lapDone = false;
  events.wallHit = false;
  events.wentOffTrack = false;
  events.boostPad = false;
  events.turboLaunch = 0;
  events.respawn = false;
  events.finished = false;

  if (race.finished) return;
  race.elapsedMs += dt * 1000;

  stepCar(race, race.player, dt, clamp(steer, -1, 1), drift, brake);
  for (let i = 0; i < race.rivals.length; i++) {
    const rival = race.rivals[i];
    if (rival) driveAi(race, rival, dt);
  }
  separateCars(race);

  if (race.player.finished) {
    race.finished = true;
    events.finished = true;
  }
}

/**
 * Empujon entre autos. No es fisica de choque: es lo minimo para que no se
 * atraviesen, que es lo que rompe la ilusion de que hay alguien ahi.
 */
function separateCars(race: Race): void {
  const player = race.player;
  const minDist = CAR_RADIUS * 2;
  for (let i = 0; i < race.rivals.length; i++) {
    const rival = race.rivals[i];
    if (!rival) continue;
    const dx = player.x - rival.x;
    const dy = player.y - rival.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minDist * minDist || d2 <= 1e-6) continue;
    const d = Math.sqrt(d2);
    const push = (minDist - d) / 2;
    const ux = dx / d;
    const uy = dy / d;
    player.x += ux * push;
    player.y += uy * push;
    rival.x -= ux * push;
    rival.y -= uy * push;
    // El roce cuesta poco a proposito: si costara mucho, quedar pegado a un
    // rival un segundo arruinaria la vuelta entera y el jugador nunca sabria
    // por que. Molesta, empuja, no castiga.
    player.speed *= 0.99;
    rival.speed *= 0.99;
  }
}

/* ------------------------------------------------------------------ */
/* Lectura para el HUD y el puntaje                                     */
/* ------------------------------------------------------------------ */

/** Avance total de un auto, para ordenar el puesto. */
export function progressOf(car: Car, track: TrackGeometry): number {
  return car.lap * track.length + car.s;
}

/** Puesto del jugador, 1-based. */
export function playerPosition(race: Race): number {
  const own = progressOf(race.player, race.track);
  let ahead = 0;
  for (let i = 0; i < race.rivals.length; i++) {
    const rival = race.rivals[i];
    if (rival && progressOf(rival, race.track) > own) ahead++;
  }
  return ahead + 1;
}

/**
 * Puntaje.
 *
 * Es contrarreloj, pero el ranking del tour es por puntos: el tiempo se
 * convierte con la formula de la spec. Quien no termina recibe puntos
 * proporcionales al avance y **nunca cero**, porque si no la mitad de la sala
 * no se ve en la tabla y deja de mirarla.
 */
export function racePoints(race: Race): number {
  const { player, rules, track } = race;

  if (player.lap >= rules.laps) {
    const timeBonus = Math.max(0, (rules.targetTotalMs - player.totalMs) / 1000) * 6;
    const targetLap = rules.targetTotalMs / rules.laps;
    const lapBonus = Math.max(0, (targetLap - player.bestLapMs) / 1000) * 4;
    const penalty = player.offTrackCount * 5;
    return Math.max(50, Math.round(300 + timeBonus + lapBonus - penalty));
  }

  const total = rules.laps * track.length;
  const done = clamp(progressOf(player, track) / total, 0, 1);
  return Math.max(50, Math.round(50 + done * 250));
}

/** Los datos propios que el shell muestra crudos al terminar. */
export function raceMeta(race: Race): Record<string, unknown> {
  const { player, track } = race;
  return {
    circuito: track.name,
    vueltas: player.lap,
    tiempoTotalMs: Math.round(player.totalMs),
    mejorVueltaMs: Math.round(player.bestLapMs),
    salidasDePista: player.offTrackCount,
    velocidadMaxima: Math.round(player.topSpeed),
    puesto: playerPosition(race),
  };
}
