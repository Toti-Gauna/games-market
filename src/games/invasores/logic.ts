import { boxHitsBox, clamp, type Box } from "@/core/engine/collide";
import type { Rng } from "@/core/engine/rng";

/**
 * Logica de Invasores. Sin React, sin canvas y sin red: se testea sola.
 *
 * Cuatro decisiones cargan el peso del archivo:
 *
 * 1. **La horda es una grilla, no una lista de entidades.** Cada invasor es un
 *    bit en `invaderAlive` y su fila y su columna estan implicitas en el
 *    indice. La posicion sale de `hordeX/hordeY` mas la celda, asi que mover 55
 *    invasores es mover dos numeros. Sin esto no hay forma de cumplir cero
 *    asignaciones ni de sostener 60 fps con la horda completa.
 * 2. **Los escudos son mascaras de bits, no entidades.** Erosionar es apagar
 *    celdas: 4 escudos por 200 celdas en un solo `Uint8Array`. Un escudo que
 *    desaparece de golpe no da la lectura de "aca ya no me puedo esconder".
 * 3. **El fracaso es compartido.** Las vidas son una sola variable de estado.
 *    Un cooperativo sin derrota comun es gente jugando al lado de otra gente.
 * 4. **Los eventos del paso viajan como bitmask mas contadores**, no como
 *    objetos: en un paso pueden morir tres invasores y no se puede asignar un
 *    array de eventos por cuadro.
 *
 * Todo lo que entra desde la red se saneia aca, que es donde se testea, y no en
 * el componente: el host recibe input, nunca resultados.
 */

export const INVADERS_SEATS = 4;

/**
 * Tope de la grilla. La horda mas grande de la tabla de la guia es 5 x 11; el
 * resto es aire para que mover un administrable no desborde un array.
 */
export const MAX_ROWS = 7;
export const MAX_COLS = 14;
export const MAX_INVADERS = MAX_ROWS * MAX_COLS;

/** Un proyectil propio en vuelo por cañon. Es regla del juego, no limite tecnico. */
export const MAX_BULLETS = INVADERS_SEATS;
export const MAX_BOMBS = 8;

export const SHIELD_COUNT = 4;
export const SHIELD_COLS = 20;
export const SHIELD_ROWS = 10;
export const SHIELD_CELLS = SHIELD_COLS * SHIELD_ROWS;

/** Tipos de invasor. Solo cambian la forma dibujada: todos valen lo mismo. */
export const INVADER_TYPES = 3;

/** Margen lateral del campo. La horda rebota contra esto, no contra el borde. */
export const FIELD_MARGIN = 70;

/** Distancia recorrida entre fotogramas de la horda: el paso del original. */
const MARCH_DISTANCE = 34;

/** Restar 90 veces 1/60 a 1,5 no da 0 exacto. Sin margen la pausa dura un paso de mas. */
const TIMER_EPS = 1e-6;

/** Tope de sub-eventos por paso: un administrable absurdo no puede colgar el `while`. */
const MAX_EVENTS_PER_STEP = 4;

/* ------------------------------------------------------------------ */
/* Eventos                                                              */
/* ------------------------------------------------------------------ */

/**
 * Bitmask de lo que paso en el paso. Un literal de union no alcanza: en un
 * mismo paso puede morir un invasor, romperse un escudo y caer un cañon.
 */
export const EVENT_NONE = 0;
export const EVENT_KILL = 1 << 0;
export const EVENT_SHIELD = 1 << 1;
export const EVENT_CANNON_HIT = 1 << 2;
export const EVENT_WAVE_CLEARED = 1 << 3;
export const EVENT_INVADED = 1 << 4;
export const EVENT_OVER = 1 << 5;
export const EVENT_MARCH = 1 << 6;
export const EVENT_STEP_DOWN = 1 << 7;
export const EVENT_WAVE_STARTED = 1 << 8;

export type InvadersPhase = "marching" | "regroup" | "banner" | "over";

/** Por que termino. "" mientras la partida sigue. */
export type InvadersReason = "" | "invaded" | "lives";

/* ------------------------------------------------------------------ */
/* Reglas                                                               */
/* ------------------------------------------------------------------ */

export type InvadersRules = {
  width: number;
  height: number;
  /** Altura a la que llegar es invasion. Coincide con el techo de los cañones. */
  floorY: number;

  /** Horda de un solo cañon. El crecimiento por cañon lo calcula `hordeShape`. */
  baseRows: number;
  baseCols: number;
  cellW: number;
  cellH: number;
  invaderW: number;
  invaderH: number;
  /** Y de la primera fila en la oleada 1. */
  hordeTopY: number;
  /** Cuanto mas abajo arranca cada oleada. */
  waveDropY: number;
  /** Tope de descensos acumulados: sin tope, la oleada 12 nace invadiendo. */
  maxWaveDrops: number;

  marchSpeed: number;
  /** velocidad = base x (1 + (1 - vivos/total) x accelFactor). */
  accelFactor: number;
  stepDown: number;
  /** Fraccion extra de velocidad por oleada superada. */
  waveSpeedGain: number;
  /** Fraccion extra de velocidad por cañon conectado al empezar la oleada. */
  playerSpeedGain: number;

  cannonW: number;
  cannonH: number;
  cannonY: number;
  /** Lerp por cuadro de 60 Hz hacia la posicion recibida. */
  cannonFollow: number;
  fireCooldownS: number;

  bulletSpeed: number;
  bulletW: number;
  bulletH: number;

  bombSpeed: number;
  bombW: number;
  bombH: number;
  /** Bombas por segundo con la horda completa en la primera oleada. */
  hordeFireRate: number;
  hordeFireWaveGain: number;

  /** Compartidas. Un cañon alcanzado le cuesta una vida a la sala. */
  lives: number;
  regroupS: number;
  waveBannerS: number;

  pointsPerInvader: number;
  pointsPerWave: number;
  accuracyBonus: number;

  shieldTopY: number;
  shieldCellW: number;
  shieldCellH: number;
};

/* ------------------------------------------------------------------ */
/* Estado                                                               */
/* ------------------------------------------------------------------ */

export type InvadersState = {
  rules: InvadersRules;

  phase: InvadersPhase;
  /** Segundos que faltan de la pausa actual. 0 = jugando. */
  pauseS: number;

  /** Oleadas superadas. La oleada en curso es esta mas 1. */
  wavesCleared: number;
  /** Cañones con los que se dimensiono la oleada EN CURSO. No se toca en caliente. */
  waveCannons: number;
  /** Cañones ocupados ahora mismo. Solo se lee al empezar la oleada siguiente. */
  activeCannons: number;
  /** Multiplicador de velocidad que dejo `hordeShape` para esta oleada. */
  waveSpeedMult: number;

  rows: number;
  cols: number;
  totalCount: number;
  aliveCount: number;
  invaderAlive: Uint8Array;
  invaderType: Uint8Array;
  /** Extremos vivos, cacheados: recalcularlos por cuadro seria recorrer 98 celdas. */
  minCol: number;
  maxCol: number;
  maxRow: number;

  hordeX: number;
  hordeY: number;
  hordeDir: number;
  /** u/s efectivos del ultimo paso. Los miran el HUD y el bot. */
  hordeSpeed: number;
  /** Alterna 0/1 con el avance: el paso caracteristico del original. */
  animFrame: number;
  animAccum: number;
  fireClock: number;

  cannonActive: Uint8Array;
  /** Centro del cañon, en unidades del mundo. */
  cannonX: Float32Array;
  cannonTargetX: Float32Array;
  cannonCooldown: Float32Array;

  bulletAlive: Uint8Array;
  bulletX: Float32Array;
  bulletY: Float32Array;
  bulletSeat: Uint8Array;

  bombAlive: Uint8Array;
  bombX: Float32Array;
  bombY: Float32Array;

  /** 4 escudos por 200 celdas. 1 = queda material. */
  shieldCell: Uint8Array;
  shieldX: Float32Array;
  shieldY: Float32Array;

  lives: number;
  seatKills: Int32Array;
  seatShots: Int32Array;
  seatHits: Int32Array;

  over: boolean;
  reason: InvadersReason;

  /* Eventos del paso. Se pisan en el paso siguiente: leerlos es cosa del cuadro. */
  events: number;
  killCount: number;
  killX: Float32Array;
  killY: Float32Array;
  killSeat: Uint8Array;
  /** Asiento alcanzado en este paso, -1 si ninguno. */
  hitSeat: number;
  shieldHitCount: number;
  shieldHitX: Float32Array;
  shieldHitY: Float32Array;

  /* Scratch de colision. Vive aca para no crear un objeto por paso. */
  boxA: Box;
  boxB: Box;
};

/* ------------------------------------------------------------------ */
/* Construccion                                                         */
/* ------------------------------------------------------------------ */

/**
 * Cuantos cañones cuentan para dimensionar la horda.
 *
 * El roster llega de la red y puede estar a medio armar: un NaN no puede
 * convertirse en una horda de NaN columnas y dejar la pantalla vacia sin
 * explicacion.
 */
function sanitizeCannons(cannons: number): number {
  const raw = Math.round(cannons);
  return Number.isFinite(raw) ? clamp(raw, 1, INVADERS_SEATS) : 1;
}

/**
 * Forma de la horda segun cuantos cañones hay.
 *
 * Escala **sublineal a proposito**: cuatro personas no matan cuatro veces mas
 * rapido porque se pisan los disparos y se estorban. Duplicar la horda con el
 * doble de gente la haria mas facil, no mas dificil.
 *
 * Con los defaults reproduce la tabla de la guia: 3x8, 4x9, 4x10, 5x11 y
 * velocidad 1,0 / 1,1 / 1,2 / 1,3.
 */
export function hordeShape(
  cannons: number,
  rules: InvadersRules,
): { rows: number; cols: number; speedMult: number } {
  const players = sanitizeCannons(cannons);
  return {
    // Una fila cada dos cañones: 1 y 2 comparten alto, 3 y 4 tambien.
    rows: clamp(rules.baseRows + Math.floor(players / 2), 1, MAX_ROWS),
    cols: clamp(rules.baseCols + (players - 1), 1, MAX_COLS),
    speedMult: 1 + (players - 1) * rules.playerSpeedGain,
  };
}

export function createInvadersState(rules: InvadersRules, cannons: number): InvadersState {
  const state: InvadersState = {
    rules,
    phase: "marching",
    pauseS: 0,

    wavesCleared: 0,
    waveCannons: 1,
    activeCannons: sanitizeCannons(cannons),
    waveSpeedMult: 1,

    rows: 0,
    cols: 0,
    totalCount: 0,
    aliveCount: 0,
    invaderAlive: new Uint8Array(MAX_INVADERS),
    invaderType: new Uint8Array(MAX_INVADERS),
    minCol: 0,
    maxCol: 0,
    maxRow: 0,

    hordeX: 0,
    hordeY: rules.hordeTopY,
    hordeDir: 1,
    hordeSpeed: 0,
    animFrame: 0,
    animAccum: 0,
    fireClock: 0,

    cannonActive: new Uint8Array(INVADERS_SEATS),
    cannonX: new Float32Array(INVADERS_SEATS),
    cannonTargetX: new Float32Array(INVADERS_SEATS),
    cannonCooldown: new Float32Array(INVADERS_SEATS),

    bulletAlive: new Uint8Array(MAX_BULLETS),
    bulletX: new Float32Array(MAX_BULLETS),
    bulletY: new Float32Array(MAX_BULLETS),
    bulletSeat: new Uint8Array(MAX_BULLETS),

    bombAlive: new Uint8Array(MAX_BOMBS),
    bombX: new Float32Array(MAX_BOMBS),
    bombY: new Float32Array(MAX_BOMBS),

    shieldCell: new Uint8Array(SHIELD_COUNT * SHIELD_CELLS),
    shieldX: new Float32Array(SHIELD_COUNT),
    shieldY: new Float32Array(SHIELD_COUNT),

    lives: Math.max(1, Math.round(rules.lives)),
    seatKills: new Int32Array(INVADERS_SEATS),
    seatShots: new Int32Array(INVADERS_SEATS),
    seatHits: new Int32Array(INVADERS_SEATS),

    over: false,
    reason: "",

    events: EVENT_NONE,
    killCount: 0,
    killX: new Float32Array(MAX_BULLETS),
    killY: new Float32Array(MAX_BULLETS),
    killSeat: new Uint8Array(MAX_BULLETS),
    hitSeat: -1,
    shieldHitCount: 0,
    shieldHitX: new Float32Array(MAX_BULLETS + MAX_BOMBS),
    shieldHitY: new Float32Array(MAX_BULLETS + MAX_BOMBS),

    boxA: { x: 0, y: 0, w: 0, h: 0 },
    boxB: { x: 0, y: 0, w: 0, h: 0 },
  };

  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    const home = homeX(rules, seat);
    state.cannonX[seat] = home;
    state.cannonTargetX[seat] = home;
  }
  // El primer cañon siempre existe: si no, la horda baja sobre un campo vacio
  // mientras el primer celular todavia esta escaneando el QR.
  state.cannonActive[0] = 1;

  startWave(state);
  return state;
}

/** Posicion de reposo de un asiento: repartidos parejo a lo ancho. */
export function homeX(rules: InvadersRules, seat: number): number {
  const slot = (seat + 1) / (INVADERS_SEATS + 1);
  const travel = rules.width - 2 * FIELD_MARGIN - rules.cannonW;
  return FIELD_MARGIN + rules.cannonW / 2 + slot * travel;
}

/**
 * Arma la oleada siguiente.
 *
 * Lee `activeCannons` SOLO aca: si alguien entra o se va a mitad de oleada la
 * horda no cambia, porque reescalarla en caliente es injusto en las dos
 * direcciones.
 */
export function startWave(state: InvadersState): void {
  const rules = state.rules;
  state.waveCannons = sanitizeCannons(state.activeCannons);

  const shape = hordeShape(state.waveCannons, rules);
  state.rows = shape.rows;
  state.cols = shape.cols;
  state.waveSpeedMult = shape.speedMult;
  state.totalCount = shape.rows * shape.cols;
  state.aliveCount = state.totalCount;

  state.invaderAlive.fill(0);
  for (let row = 0; row < shape.rows; row++) {
    // El tipo es solo la forma dibujada: la fila de arriba es la mas chica.
    const type = row === 0 ? 0 : row < 3 ? 1 : 2;
    for (let col = 0; col < shape.cols; col++) {
      const index = row * shape.cols + col;
      state.invaderAlive[index] = 1;
      state.invaderType[index] = type % INVADER_TYPES;
    }
  }

  const hordeWidth = (shape.cols - 1) * rules.cellW + rules.invaderW;
  state.hordeX = (rules.width - hordeWidth) / 2;
  const drops = Math.min(state.wavesCleared, Math.max(0, Math.round(rules.maxWaveDrops)));
  state.hordeY = rules.hordeTopY + drops * rules.waveDropY;
  state.hordeDir = 1;
  state.animAccum = 0;
  state.animFrame = 0;
  state.fireClock = 0;

  recomputeBounds(state);
  clearProjectiles(state);
  // Escudos nuevos cada oleada. Conservarlos erosionados suena mas "puro", pero
  // a la tercera oleada no queda refugio y la dificultad deja de venir de la
  // horda para venir de en que oleada te tocó entrar.
  rebuildShields(state);
  state.events |= EVENT_WAVE_STARTED;
}

/* ------------------------------------------------------------------ */
/* Entrada saneada                                                      */
/* ------------------------------------------------------------------ */

/**
 * Objetivo de un cañon, desde la posicion normalizada que manda el celular.
 *
 * El host no confia en el payload: un cliente puede mandar NaN, 1e9 o nada. Se
 * saneia aca, que es donde se testea, y no en el componente.
 */
export function setCannonTarget(state: InvadersState, seat: number, position: number): void {
  if (!Number.isInteger(seat) || seat < 0 || seat >= INVADERS_SEATS) return;
  if (!Number.isFinite(position)) return;
  const rules = state.rules;
  const travel = rules.width - 2 * FIELD_MARGIN - rules.cannonW;
  state.cannonTargetX[seat] = FIELD_MARGIN + rules.cannonW / 2 + clamp(position, 0, 1) * travel;
}

/** Posicion normalizada actual de un cañon. Es la inversa de `setCannonTarget`. */
export function cannonPosition(state: InvadersState, seat: number): number {
  if (seat < 0 || seat >= INVADERS_SEATS) return 0.5;
  const rules = state.rules;
  const travel = rules.width - 2 * FIELD_MARGIN - rules.cannonW;
  if (travel <= 0) return 0.5;
  const left = FIELD_MARGIN + rules.cannonW / 2;
  return clamp(((state.cannonX[seat] ?? left) - left) / travel, 0, 1);
}

/** Prende o apaga un cañon. Al prenderlo vuelve a su lugar de reposo. */
export function setCannonActive(state: InvadersState, seat: number, active: boolean): void {
  if (seat < 0 || seat >= INVADERS_SEATS) return;
  const was = state.cannonActive[seat] === 1;
  state.cannonActive[seat] = active ? 1 : 0;
  if (active && !was) {
    const home = homeX(state.rules, seat);
    state.cannonX[seat] = home;
    state.cannonTargetX[seat] = home;
    state.cannonCooldown[seat] = 0;
  }
}

/**
 * Dispara. Devuelve si salio el tiro.
 *
 * El disparo es un evento y no una posicion: perder un "disparé" se nota mucho
 * mas que perder un cuadro de posicion. Se cuenta aca mismo como disparo aunque
 * todavia no haya impactado, porque la precision se mide sobre lo que la
 * persona apreto.
 */
export function fireCannon(state: InvadersState, seat: number): boolean {
  if (state.over || state.phase !== "marching") return false;
  if (!Number.isInteger(seat) || seat < 0 || seat >= INVADERS_SEATS) return false;
  if (state.cannonActive[seat] !== 1) return false;
  if ((state.cannonCooldown[seat] ?? 0) > 0) return false;

  // Un proyectil propio en vuelo a la vez. Con cuatro cañones sin este limite
  // la pantalla se llena y dejan de leerse las bombas que bajan.
  for (let i = 0; i < MAX_BULLETS; i++) {
    if (state.bulletAlive[i] === 1 && state.bulletSeat[i] === seat) return false;
  }

  const rules = state.rules;
  for (let i = 0; i < MAX_BULLETS; i++) {
    if (state.bulletAlive[i] === 1) continue;
    state.bulletAlive[i] = 1;
    state.bulletX[i] = (state.cannonX[seat] ?? 0) - rules.bulletW / 2;
    state.bulletY[i] = rules.cannonY - rules.bulletH;
    state.bulletSeat[i] = seat;
    state.cannonCooldown[seat] = rules.fireCooldownS;
    state.seatShots[seat] = (state.seatShots[seat] ?? 0) + 1;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Lecturas para el render y para el bot                                */
/* ------------------------------------------------------------------ */

export function invaderX(state: InvadersState, col: number): number {
  return state.hordeX + col * state.rules.cellW;
}

export function invaderY(state: InvadersState, row: number): number {
  return state.hordeY + row * state.rules.cellH;
}

/** Y del borde inferior del invasor vivo mas bajo. Es lo que decide la invasion. */
export function hordeBottom(state: InvadersState): number {
  if (state.aliveCount === 0) return state.hordeY;
  return invaderY(state, state.maxRow) + state.rules.invaderH;
}

/**
 * Velocidad actual de la horda.
 *
 * Es lo que da la tension del original: cuanto menos invasores quedan, mas
 * rapido se mueven los que quedan. El ultimo va mas de tres veces mas rapido
 * que la horda completa.
 */
export function hordeSpeedOf(state: InvadersState): number {
  const rules = state.rules;
  const total = state.totalCount > 0 ? state.totalCount : 1;
  const waveMult = 1 + state.wavesCleared * rules.waveSpeedGain;
  const emptiness = 1 - state.aliveCount / total;
  return rules.marchSpeed * state.waveSpeedMult * waveMult * (1 + emptiness * rules.accelFactor);
}

/* ------------------------------------------------------------------ */
/* Paso de simulacion                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un paso. Es la unica funcion que mueve algo.
 *
 * `dt` es fijo por contrato: con delta variable la simulacion deja de ser
 * determinista y la misma semilla deja de dar la misma partida.
 */
export function stepInvaders(state: InvadersState, dt: number, rng: Rng): number {
  state.events = EVENT_NONE;
  state.killCount = 0;
  state.shieldHitCount = 0;
  state.hitSeat = -1;
  if (state.over) return EVENT_NONE;

  moveCannons(state, dt);
  tickCooldowns(state, dt);

  // Durante la pausa los cañones se siguen moviendo: es justamente el momento
  // de reacomodarse. Lo que no corre es la horda ni los proyectiles.
  if (state.pauseS > 0) {
    state.pauseS -= dt;
    if (state.pauseS <= TIMER_EPS) {
      state.pauseS = 0;
      if (state.phase === "banner") startWave(state);
      state.phase = "marching";
    }
    return state.events;
  }

  moveHorde(state, dt);
  moveBullets(state, dt);
  moveBombs(state, dt);
  hordeFire(state, dt, rng);
  resolveBullets(state);
  resolveBombs(state);

  if (state.aliveCount === 0 && !state.over) {
    state.wavesCleared++;
    state.phase = "banner";
    state.pauseS = state.rules.waveBannerS;
    clearProjectiles(state);
    state.events |= EVENT_WAVE_CLEARED;
    return state.events;
  }

  if (!state.over && hordeBottom(state) >= state.rules.floorY) {
    endGame(state, "invaded");
    state.events |= EVENT_INVADED;
  }

  return state.events;
}

/* ------------------------------------------------------------------ */
/* Interno                                                              */
/* ------------------------------------------------------------------ */

function moveCannons(state: InvadersState, dt: number): void {
  // `cannonFollow` esta expresado por cuadro de 60 Hz porque es como se
  // percibe; aca se convierte al paso real para que cambiar el timestep no
  // cambie la sensacion del mando.
  const alpha = Math.min(1, state.rules.cannonFollow * dt * 60);
  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    if (state.cannonActive[seat] !== 1) continue;
    const current = state.cannonX[seat] ?? 0;
    const goal = state.cannonTargetX[seat] ?? current;
    state.cannonX[seat] = current + (goal - current) * alpha;
  }
}

function tickCooldowns(state: InvadersState, dt: number): void {
  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    const left = state.cannonCooldown[seat] ?? 0;
    if (left > 0) state.cannonCooldown[seat] = Math.max(0, left - dt);
  }
}

function moveHorde(state: InvadersState, dt: number): void {
  if (state.aliveCount === 0) return;
  const rules = state.rules;
  const speed = hordeSpeedOf(state);
  state.hordeSpeed = speed;
  state.hordeX += state.hordeDir * speed * dt;

  // Los limites se calculan sobre las columnas VIVAS: cuando se vacia una
  // columna del borde, la horda gana recorrido, igual que en el original.
  const leftLimit = FIELD_MARGIN - state.minCol * rules.cellW;
  const rightLimit = rules.width - FIELD_MARGIN - rules.invaderW - state.maxCol * rules.cellW;

  if (leftLimit <= rightLimit) {
    if (state.hordeX < leftLimit) {
      state.hordeX = leftLimit;
      stepHordeDown(state);
    } else if (state.hordeX > rightLimit) {
      state.hordeX = rightLimit;
      stepHordeDown(state);
    }
  }

  state.animAccum += speed * dt;
  let guard = 0;
  while (state.animAccum >= MARCH_DISTANCE && guard < MAX_EVENTS_PER_STEP) {
    state.animAccum -= MARCH_DISTANCE;
    state.animFrame ^= 1;
    state.events |= EVENT_MARCH;
    guard++;
  }
  if (state.animAccum >= MARCH_DISTANCE) state.animAccum = 0;
}

function stepHordeDown(state: InvadersState): void {
  state.hordeDir = -state.hordeDir;
  state.hordeY += state.rules.stepDown;
  state.events |= EVENT_STEP_DOWN;
  // La horda come escudo al bajar sobre el. Sin esto, esconderse abajo del
  // escudo es una estrategia ganadora y el juego se vuelve estatico.
  crushShields(state);
}

function moveBullets(state: InvadersState, dt: number): void {
  const rules = state.rules;
  for (let i = 0; i < MAX_BULLETS; i++) {
    if (state.bulletAlive[i] !== 1) continue;
    const y = (state.bulletY[i] ?? 0) - rules.bulletSpeed * dt;
    state.bulletY[i] = y;
    if (y + rules.bulletH < 0) state.bulletAlive[i] = 0;
  }
}

function moveBombs(state: InvadersState, dt: number): void {
  const rules = state.rules;
  for (let i = 0; i < MAX_BOMBS; i++) {
    if (state.bombAlive[i] !== 1) continue;
    const y = (state.bombY[i] ?? 0) + rules.bombSpeed * dt;
    state.bombY[i] = y;
    if (y > rules.height) state.bombAlive[i] = 0;
  }
}

/**
 * Quien dispara y cuando sale del PRNG sembrado: con la misma semilla los
 * invasores disparan en el mismo orden, que es criterio de aceptacion.
 */
function hordeFire(state: InvadersState, dt: number, rng: Rng): void {
  if (state.aliveCount === 0) return;
  const rules = state.rules;
  const rate = rules.hordeFireRate * (1 + state.wavesCleared * rules.hordeFireWaveGain);
  state.fireClock += dt * rate;

  let guard = 0;
  while (state.fireClock >= 1 && guard < MAX_EVENTS_PER_STEP) {
    state.fireClock -= 1;
    guard++;
    spawnBomb(state, rng);
  }
  if (state.fireClock >= 1) state.fireClock = 0;
}

function spawnBomb(state: InvadersState, rng: Rng): void {
  const cols = state.cols;
  if (cols <= 0) return;
  // Se consume UN valor del PRNG siempre, elija la columna que elija: si la
  // cantidad de valores consumidos dependiera de que columnas quedan vivas, la
  // serie dejaria de ser reproducible entre dos partidas con la misma semilla.
  const start = rng.int(0, cols - 1);

  for (let offset = 0; offset < cols; offset++) {
    const col = (start + offset) % cols;
    const row = lowestAliveRow(state, col);
    if (row < 0) continue;
    for (let i = 0; i < MAX_BOMBS; i++) {
      if (state.bombAlive[i] === 1) continue;
      state.bombAlive[i] = 1;
      state.bombX[i] = invaderX(state, col) + state.rules.invaderW / 2 - state.rules.bombW / 2;
      state.bombY[i] = invaderY(state, row) + state.rules.invaderH;
      return;
    }
    // Sin lugar en el pool: el disparo se pierde. Encolarlo lo haria salir
    // tarde y desde un invasor que a esa altura ya puede estar muerto.
    return;
  }
}

function lowestAliveRow(state: InvadersState, col: number): number {
  for (let row = state.rows - 1; row >= 0; row--) {
    if (state.invaderAlive[row * state.cols + col] === 1) return row;
  }
  return -1;
}

function resolveBullets(state: InvadersState): void {
  const rules = state.rules;
  for (let i = 0; i < MAX_BULLETS; i++) {
    if (state.bulletAlive[i] !== 1) continue;
    const bx = state.bulletX[i] ?? 0;
    const by = state.bulletY[i] ?? 0;
    const seat = state.bulletSeat[i] ?? 0;

    state.boxA.x = bx;
    state.boxA.y = by;
    state.boxA.w = rules.bulletW;
    state.boxA.h = rules.bulletH;

    if (hitInvader(state, seat)) {
      state.bulletAlive[i] = 0;
      continue;
    }
    // Los invasores se testean antes que el escudo: cuando la horda ya bajo
    // sobre los escudos, matarla tiene que seguir siendo posible.
    if (damageShields(state, bx, by, rules.bulletW, rules.bulletH, 1.6)) {
      state.bulletAlive[i] = 0;
      state.events |= EVENT_SHIELD;
    }
  }
}

/** El proyectil ya viaja en `boxA`. Devuelve si mato a alguien. */
function hitInvader(state: InvadersState, seat: number): boolean {
  if (state.aliveCount === 0) return false;
  const rules = state.rules;
  const box = state.boxB;
  box.w = rules.invaderW;
  box.h = rules.invaderH;

  // De abajo hacia arriba: el proyectil sube, asi que el primer impacto posible
  // es el invasor mas bajo de esa columna.
  for (let row = state.maxRow; row >= 0; row--) {
    for (let col = state.minCol; col <= state.maxCol; col++) {
      const index = row * state.cols + col;
      if (state.invaderAlive[index] !== 1) continue;
      box.x = invaderX(state, col);
      box.y = invaderY(state, row);
      if (!boxHitsBox(state.boxA, box)) continue;

      state.invaderAlive[index] = 0;
      state.aliveCount--;
      state.seatKills[seat] = (state.seatKills[seat] ?? 0) + 1;
      state.seatHits[seat] = (state.seatHits[seat] ?? 0) + 1;
      recordKill(state, box.x + rules.invaderW / 2, box.y + rules.invaderH / 2, seat);
      recomputeBounds(state);
      state.events |= EVENT_KILL;
      return true;
    }
  }
  return false;
}

function resolveBombs(state: InvadersState): void {
  const rules = state.rules;
  for (let i = 0; i < MAX_BOMBS; i++) {
    if (state.bombAlive[i] !== 1) continue;
    const x = state.bombX[i] ?? 0;
    const y = state.bombY[i] ?? 0;

    if (damageShields(state, x, y, rules.bombW, rules.bombH, 2.1)) {
      state.bombAlive[i] = 0;
      state.events |= EVENT_SHIELD;
      continue;
    }

    state.boxA.x = x;
    state.boxA.y = y;
    state.boxA.w = rules.bombW;
    state.boxA.h = rules.bombH;

    const box = state.boxB;
    box.w = rules.cannonW;
    box.h = rules.cannonH;
    for (let seat = 0; seat < INVADERS_SEATS; seat++) {
      if (state.cannonActive[seat] !== 1) continue;
      box.x = (state.cannonX[seat] ?? 0) - rules.cannonW / 2;
      box.y = rules.cannonY;
      if (!boxHitsBox(state.boxA, box)) continue;

      state.bombAlive[i] = 0;
      hitCannon(state, seat);
      break;
    }
  }
}

/** Un cañon alcanzado cuesta una vida de TODOS. Es la mecanica del juego. */
function hitCannon(state: InvadersState, seat: number): void {
  state.hitSeat = seat;
  state.lives = Math.max(0, state.lives - 1);
  state.events |= EVENT_CANNON_HIT;
  clearProjectiles(state);

  if (state.lives <= 0) {
    endGame(state, "lives");
    return;
  }
  state.phase = "regroup";
  state.pauseS = state.rules.regroupS;
}

function endGame(state: InvadersState, reason: InvadersReason): void {
  state.over = true;
  state.reason = reason;
  state.phase = "over";
  state.pauseS = 0;
  clearProjectiles(state);
  state.events |= EVENT_OVER;
}

function recordKill(state: InvadersState, x: number, y: number, seat: number): void {
  if (state.killCount >= state.killX.length) return;
  state.killX[state.killCount] = x;
  state.killY[state.killCount] = y;
  state.killSeat[state.killCount] = seat;
  state.killCount++;
}

function recordShieldHit(state: InvadersState, x: number, y: number): void {
  if (state.shieldHitCount >= state.shieldHitX.length) return;
  state.shieldHitX[state.shieldHitCount] = x;
  state.shieldHitY[state.shieldHitCount] = y;
  state.shieldHitCount++;
}

export function clearProjectiles(state: InvadersState): void {
  state.bulletAlive.fill(0);
  state.bombAlive.fill(0);
}

function recomputeBounds(state: InvadersState): void {
  let minCol = state.cols;
  let maxCol = -1;
  let maxRow = 0;
  for (let row = 0; row < state.rows; row++) {
    for (let col = 0; col < state.cols; col++) {
      if (state.invaderAlive[row * state.cols + col] !== 1) continue;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row > maxRow) maxRow = row;
    }
  }
  if (maxCol < 0) {
    // Horda vacia: dejar los limites en un rango valido evita NaN en el paso
    // que va entre la ultima baja y el cartel de oleada.
    state.minCol = 0;
    state.maxCol = Math.max(0, state.cols - 1);
    state.maxRow = 0;
    return;
  }
  state.minCol = minCol;
  state.maxCol = maxCol;
  state.maxRow = maxRow;
}

/* ------------------------------------------------------------------ */
/* Escudos: mascaras de bits, no entidades                              */
/* ------------------------------------------------------------------ */

/** Forma del escudo: domo con bisel arriba y muesca triangular abajo. */
function shieldMask(col: number, row: number): number {
  const bevel = 3;
  if (row < bevel && (col < bevel - row || col >= SHIELD_COLS - (bevel - row))) return 0;
  const notchTop = SHIELD_ROWS - 4;
  if (row >= notchTop) {
    const spread = row - notchTop + 1;
    if (Math.abs(col - SHIELD_COLS / 2 + 0.5) < spread) return 0;
  }
  return 1;
}

export function rebuildShields(state: InvadersState): void {
  const rules = state.rules;
  const shieldW = SHIELD_COLS * rules.shieldCellW;
  const usable = rules.width - 2 * FIELD_MARGIN;
  for (let s = 0; s < SHIELD_COUNT; s++) {
    state.shieldX[s] = FIELD_MARGIN + (usable * (s + 0.5)) / SHIELD_COUNT - shieldW / 2;
    state.shieldY[s] = rules.shieldTopY;
    const base = s * SHIELD_CELLS;
    for (let row = 0; row < SHIELD_ROWS; row++) {
      for (let col = 0; col < SHIELD_COLS; col++) {
        state.shieldCell[base + row * SHIELD_COLS + col] = shieldMask(col, row);
      }
    }
  }
}

/** Celdas de escudo que quedan. Para el HUD y para los tests de erosion. */
export function shieldCellsLeft(state: InvadersState): number {
  let left = 0;
  for (let i = 0; i < state.shieldCell.length; i++) {
    if (state.shieldCell[i] === 1) left++;
  }
  return left;
}

function erodeShield(
  state: InvadersState,
  shield: number,
  worldX: number,
  worldY: number,
  radius: number,
): void {
  const rules = state.rules;
  const sx = state.shieldX[shield] ?? 0;
  const sy = state.shieldY[shield] ?? 0;
  const cc = (worldX - sx) / rules.shieldCellW;
  const cr = (worldY - sy) / rules.shieldCellH;
  const base = shield * SHIELD_CELLS;
  const r2 = radius * radius;

  const rowFrom = Math.max(0, Math.floor(cr - radius));
  const rowTo = Math.min(SHIELD_ROWS - 1, Math.ceil(cr + radius));
  const colFrom = Math.max(0, Math.floor(cc - radius));
  const colTo = Math.min(SHIELD_COLS - 1, Math.ceil(cc + radius));

  for (let row = rowFrom; row <= rowTo; row++) {
    for (let col = colFrom; col <= colTo; col++) {
      const dx = col + 0.5 - cc;
      const dy = row + 0.5 - cr;
      if (dx * dx + dy * dy > r2) continue;
      state.shieldCell[base + row * SHIELD_COLS + col] = 0;
    }
  }
}

/**
 * Impacto contra un escudo. Erosiona por celdas alrededor del punto y devuelve
 * si hubo choque. Los escudos NO desaparecen de golpe: se comen por zonas.
 */
function damageShields(
  state: InvadersState,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): boolean {
  const rules = state.rules;
  const cw = rules.shieldCellW;
  const ch = rules.shieldCellH;
  const shieldW = SHIELD_COLS * cw;
  const shieldH = SHIELD_ROWS * ch;

  for (let s = 0; s < SHIELD_COUNT; s++) {
    const sx = state.shieldX[s] ?? 0;
    const sy = state.shieldY[s] ?? 0;
    if (x + w <= sx || x >= sx + shieldW || y + h <= sy || y >= sy + shieldH) continue;

    const colFrom = Math.max(0, Math.floor((x - sx) / cw));
    const colTo = Math.min(SHIELD_COLS - 1, Math.floor((x + w - sx) / cw));
    const rowFrom = Math.max(0, Math.floor((y - sy) / ch));
    const rowTo = Math.min(SHIELD_ROWS - 1, Math.floor((y + h - sy) / ch));
    const base = s * SHIELD_CELLS;

    for (let row = rowFrom; row <= rowTo; row++) {
      for (let col = colFrom; col <= colTo; col++) {
        if (state.shieldCell[base + row * SHIELD_COLS + col] !== 1) continue;
        const hx = sx + (col + 0.5) * cw;
        const hy = sy + (row + 0.5) * ch;
        erodeShield(state, s, hx, hy, radius);
        recordShieldHit(state, hx, hy);
        return true;
      }
    }
  }
  return false;
}

/** La horda pisa el escudo al bajar. Solo corre en el escalon, no por cuadro. */
function crushShields(state: InvadersState): void {
  if (state.aliveCount === 0) return;
  const rules = state.rules;
  const shieldW = SHIELD_COLS * rules.shieldCellW;
  const shieldH = SHIELD_ROWS * rules.shieldCellH;
  const top = invaderY(state, 0);
  const bottom = hordeBottom(state);

  for (let s = 0; s < SHIELD_COUNT; s++) {
    const sy = state.shieldY[s] ?? 0;
    if (bottom <= sy || top >= sy + shieldH) continue;
    const sx = state.shieldX[s] ?? 0;
    for (let row = 0; row < state.rows; row++) {
      for (let col = state.minCol; col <= state.maxCol; col++) {
        if (state.invaderAlive[row * state.cols + col] !== 1) continue;
        const ix = invaderX(state, col);
        const iy = invaderY(state, row);
        if (ix + rules.invaderW <= sx || ix >= sx + shieldW) continue;
        if (iy + rules.invaderH <= sy || iy >= sy + shieldH) continue;
        erodeShield(state, s, ix + rules.invaderW / 2, iy + rules.invaderH / 2, 3);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Puntaje                                                              */
/* ------------------------------------------------------------------ */

/**
 * Puntaje de un asiento.
 *
 * Propios y precision son individuales; el bono por oleada es **identico para
 * todos los conectados**, incluido el que jugo peor: si la sala supero la
 * oleada, la supero la sala.
 *
 * El bono por precision existe para que disparar sin mirar no sea gratis: con
 * cuatro personas apretando, sin el la pantalla se llena de proyectiles.
 */
export function invadersPoints(
  kills: number,
  hits: number,
  shots: number,
  wavesCleared: number,
  rules: InvadersRules,
): number {
  const own = kills * rules.pointsPerInvader;
  const accuracy = shots > 0 ? Math.floor((hits / shots) * rules.accuracyBonus) : 0;
  const waves = wavesCleared * rules.pointsPerWave;
  return Math.max(0, own + accuracy + waves);
}

export function seatPoints(state: InvadersState, seat: number): number {
  if (seat < 0 || seat >= INVADERS_SEATS) return 0;
  return invadersPoints(
    state.seatKills[seat] ?? 0,
    state.seatHits[seat] ?? 0,
    state.seatShots[seat] ?? 0,
    state.wavesCleared,
    state.rules,
  );
}

/** Puntaje de la sala. Es el numero que importa en un cooperativo. */
export function roomPoints(state: InvadersState): number {
  let total = 0;
  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    if (state.cannonActive[seat] !== 1) continue;
    total += seatPoints(state, seat);
  }
  return total;
}
