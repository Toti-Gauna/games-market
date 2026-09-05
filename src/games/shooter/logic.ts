import { num, type SettingsValues } from "@/core/contract/settings";
import type { Rng } from "@/core/engine/rng";
import type { NetEntity, NetSnapshot, QuantConfig } from "@/core/net/snapshot";
import { MAP_SIZE, MAX_PLAYERS, type MapBox, type MapRamp, type ShooterMap } from "./map";

/**
 * X4 · Supernova Arena — la simulacion.
 *
 * Sin React, sin three y sin red: se testea sola. Es lo que corre el proyector
 * como autoridad, y `simulateBody` es ademas lo que corre cada celular para
 * predecir su propio movimiento —la MISMA funcion, con el mismo paso fijo, que
 * es lo que hace que la reconciliacion no salte.
 *
 * Las decisiones que cargan el archivo:
 *
 * 1. **Todo en arrays tipados, indexados por asiento.** Diez jugadores son
 *    diez posiciones en un `Float32Array`, no diez objetos. Es lo que permite
 *    cero asignaciones por paso y lo que hace trivial escribir el snapshot.
 * 2. **Hitscan contra capsulas y cajas, no contra mallas.** Un rayo contra
 *    diez capsulas y cuarenta cajas se resuelve en microsegundos sin BVH.
 * 3. **Compensacion de latencia.** El host guarda ~270 ms de posiciones y, al
 *    resolver un disparo, retrocede a los demas al instante en que el tirador
 *    los vio. Sin esto, con 100 ms de ping hay que apuntarle adelante al rival
 *    y el juego se siente roto.
 * 4. **El anillo es lo que garantiza que la partida termine.** Cuatro fases
 *    que achican hacia un centro que cambia por semilla.
 *
 * Convencion de camara, que es la de three: con `rotation.y = yaw` la camara
 * mira hacia `(-sin yaw, 0, -cos yaw)`. Todo lo que aca calcula una direccion
 * usa esa misma formula, asi la escena no convierte nada.
 */

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

export const HP_MAX = 100;
export const PLAYER_RADIUS = 0.4;
/** De los pies a la coronilla. */
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.6;
/**
 * Desde donde un impacto cuenta como cabeza, medido desde los pies.
 *
 * Por encima de los ojos a proposito: un tiro a la altura de la mira, de
 * frente y en llano, es cuerpo. La cabeza hay que buscarla apuntando arriba,
 * que es lo que la vuelve un merito y no el tiro por defecto.
 */
export const HEAD_FROM = 1.62;

export const MATCH_SECONDS = 240;
export const DEPLOY_SECONDS = 5;
/** Radio inicial: cubre la diagonal del mapa entera. */
export const RING_START_RADIUS = 57;

/** Cuantos pasos de historia se guardan para la compensacion de latencia. */
export const HISTORY_TICKS = 16;
/** Cuantos pasos se retrocede al resolver un disparo: ~100 ms a 60 Hz. */
export const LAG_COMP_TICKS = 6;

/** Cuantos eventos de cada tipo caben en un paso. */
const MAX_SHOTS_PER_TICK = 16;
const MAX_HITS_PER_TICK = 16;
const MAX_KILLS_PER_TICK = 8;

const HALF = MAP_SIZE / 2;
/** Separacion tras el empuje: sin esto el cuerpo queda vibrando en la pared. */
const SKIN = 0.01;
/** Cuanto puede subir un escalon sin saltar. Las rampas se resuelven aparte. */
const STEP_UP = 0.35;

/**
 * El cronograma del anillo, de la guia. `at` es cuando empieza a achicar,
 * `shrink` cuanto tarda y `radius` a que fraccion del inicial llega.
 */
export const RING_SCHEDULE: readonly { at: number; shrink: number; radius: number }[] = [
  { at: 45, shrink: 40, radius: 0.7 },
  { at: 100, shrink: 35, radius: 0.45 },
  { at: 150, shrink: 30, radius: 0.22 },
  { at: 195, shrink: 25, radius: 0.06 },
];

/* ------------------------------------------------------------------ */
/* Reglas                                                              */
/* ------------------------------------------------------------------ */

export type ShooterRules = {
  moveSpeed: number;
  jumpSpeed: number;
  gravity: number;
  bodyDamage: number;
  headDamage: number;
  fireIntervalS: number;
  magazine: number;
  reloadS: number;
  ringDps: number;
  /** Radianes de error de punteria de los bots. 0 = no fallan nunca. */
  botAimError: number;
  /** 0..1: que tan seguido un bot decide disparar cuando tiene tiro. */
  botTrigger: number;
  matchSeconds: number;
  deploySeconds: number;
};

export const DEFAULT_RULES: ShooterRules = {
  moveSpeed: 6.5,
  jumpSpeed: 6.4,
  gravity: 19,
  bodyDamage: 25,
  headDamage: 45,
  fireIntervalS: 0.15,
  magazine: 20,
  reloadS: 1.2,
  ringDps: 4,
  botAimError: 0.05,
  botTrigger: 0.75,
  matchSeconds: MATCH_SECONDS,
  deploySeconds: DEPLOY_SECONDS,
};

/**
 * Tres niveles y no dos numeros: "5 % de error de punteria" no le dice nada
 * a quien administra; "dificil" si. Los valores del nivel normal son los de
 * la guia.
 */
const BOT_PRESETS: Record<string, { aimError: number; trigger: number }> = {
  facil: { aimError: 0.1, trigger: 0.5 },
  normal: { aimError: 0.05, trigger: 0.75 },
  dificil: { aimError: 0.02, trigger: 0.92 },
};

function botDifficultyOf(values: SettingsValues): string {
  const raw = values["botDifficulty"];
  return typeof raw === "string" && raw in BOT_PRESETS ? raw : "normal";
}

export function rulesFromSettings(values: SettingsValues): ShooterRules {
  return {
    moveSpeed: num(values, "moveSpeed", DEFAULT_RULES.moveSpeed),
    jumpSpeed: DEFAULT_RULES.jumpSpeed,
    gravity: DEFAULT_RULES.gravity,
    bodyDamage: num(values, "bodyDamage", DEFAULT_RULES.bodyDamage),
    headDamage: num(values, "headDamage", DEFAULT_RULES.headDamage),
    fireIntervalS: num(values, "fireIntervalMs", DEFAULT_RULES.fireIntervalS * 1000) / 1000,
    magazine: Math.round(num(values, "magazine", DEFAULT_RULES.magazine)),
    reloadS: num(values, "reloadMs", DEFAULT_RULES.reloadS * 1000) / 1000,
    ringDps: num(values, "ringDps", DEFAULT_RULES.ringDps),
    botAimError: BOT_PRESETS[botDifficultyOf(values)]?.aimError ?? DEFAULT_RULES.botAimError,
    botTrigger: BOT_PRESETS[botDifficultyOf(values)]?.trigger ?? DEFAULT_RULES.botTrigger,
    matchSeconds: num(values, "matchSeconds", DEFAULT_RULES.matchSeconds),
    deploySeconds: DEFAULT_RULES.deploySeconds,
  };
}

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

/** Lo que manda un celular, 30 veces por segundo. Intencion, nunca resultado. */
export type ShooterInput = {
  /** Movimiento, -1..1. `my` positivo es hacia adelante. */
  mx: number;
  my: number;
  yaw: number;
  pitch: number;
  fire: boolean;
  jump: boolean;
};

export function createInput(): ShooterInput {
  return { mx: 0, my: 0, yaw: 0, pitch: 0, fire: false, jump: false };
}

/**
 * El cuerpo de un jugador, como objeto: es lo que predice el celular. El host
 * no lo usa; tiene todo en arrays.
 */
export type PlayerBody = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
};

export type MatchPhase = "deploy" | "playing" | "over";

export type ShooterWorld = {
  map: ShooterMap;
  rules: ShooterRules;
  phase: MatchPhase;
  /** Segundos de partida, contados desde que arranco el despliegue. */
  time: number;
  tick: number;
  deployLeft: number;

  /** 1 si el asiento esta en juego (persona o bot). */
  active: Uint8Array;
  alive: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  yaw: Float32Array;
  pitch: Float32Array;
  onGround: Uint8Array;
  hp: Float32Array;
  ammo: Int16Array;
  reload: Float32Array;
  cooldown: Float32Array;
  /** Dispersion acumulada por disparar sostenido, en radianes. */
  spread: Float32Array;
  /** 1 en el paso en que ese asiento disparo. Para el destello. */
  fired: Uint8Array;

  kills: Int32Array;
  damage: Float32Array;
  shots: Int32Array;
  hits: Int32Array;
  /** 0 mientras vive; al morir, el puesto (10 = primero en caer). */
  placement: Int16Array;
  killer: Int8Array;
  /** Ultimo asiento que hirio a cada uno. Para el indicador de direccion. */
  lastAttacker: Int8Array;
  lastHitAt: Float32Array;

  /* Ultimo input recibido de cada asiento. */
  inMx: Float32Array;
  inMy: Float32Array;
  inYaw: Float32Array;
  inPitch: Float32Array;
  inFire: Uint8Array;
  inJump: Uint8Array;

  /* Historia de posiciones para la compensacion de latencia. */
  histX: Float32Array;
  histY: Float32Array;
  histZ: Float32Array;
  histHead: number;
  histFilled: number;

  /* El anillo. */
  ringX: number;
  ringZ: number;
  ringRadius: number;
  ringPhase: number;
  ringFrom: number;
  ringTarget: number;
  ringShrinkStart: number;
  ringShrinkEnd: number;

  aliveCount: number;
  activeCount: number;
  winner: number;
  /** Cuantos murieron en total. Sube en cada muerte. */
  deaths: number;
  /** Cuenta acumulada de impactos, para que el cliente detecte uno nuevo. */
  hitCounter: number;

  /* Eventos del paso. Se pisan en el siguiente. */
  events: number;
  shotCount: number;
  shotSeat: Int8Array;
  shotFrom: Float32Array;
  shotTo: Float32Array;
  shotHit: Int8Array;
  hitCount: number;
  hitVictim: Int8Array;
  hitAttacker: Int8Array;
  hitHead: Uint8Array;
  hitPoint: Float32Array;
  killCount: number;
  killVictim: Int8Array;
  killKiller: Int8Array;

  /* Memoria de los bots. */
  botTarget: Int8Array;
  botWanderX: Float32Array;
  botWanderZ: Float32Array;
  botRetarget: Float32Array;
  botAimYaw: Float32Array;
  botAimPitch: Float32Array;
  botStrafe: Float32Array;
  botStrafeLeft: Float32Array;
  botStuck: Float32Array;
  botLastX: Float32Array;
  botLastZ: Float32Array;
  botBurst: Float32Array;
  /** Segundos que le faltan para reaccionar a un objetivo recien visto. */
  botReact: Float32Array;
};

export const EVENT_NONE = 0;
export const EVENT_SHOT = 1 << 0;
export const EVENT_HIT = 1 << 1;
export const EVENT_KILL = 1 << 2;
export const EVENT_RING_PHASE = 1 << 3;
export const EVENT_DEPLOYED = 1 << 4;
export const EVENT_OVER = 1 << 5;
export const EVENT_RELOAD = 1 << 6;

/* ------------------------------------------------------------------ */
/* Construccion                                                        */
/* ------------------------------------------------------------------ */

export function createShooterWorld(map: ShooterMap, rules: ShooterRules): ShooterWorld {
  const n = MAX_PLAYERS;
  const world: ShooterWorld = {
    map,
    rules,
    phase: "deploy",
    time: 0,
    tick: 0,
    deployLeft: rules.deploySeconds,

    active: new Uint8Array(n),
    alive: new Uint8Array(n),
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    vz: new Float32Array(n),
    yaw: new Float32Array(n),
    pitch: new Float32Array(n),
    onGround: new Uint8Array(n),
    hp: new Float32Array(n),
    ammo: new Int16Array(n),
    reload: new Float32Array(n),
    cooldown: new Float32Array(n),
    spread: new Float32Array(n),
    fired: new Uint8Array(n),

    kills: new Int32Array(n),
    damage: new Float32Array(n),
    shots: new Int32Array(n),
    hits: new Int32Array(n),
    placement: new Int16Array(n),
    killer: new Int8Array(n).fill(-1),
    lastAttacker: new Int8Array(n).fill(-1),
    lastHitAt: new Float32Array(n).fill(-99),

    inMx: new Float32Array(n),
    inMy: new Float32Array(n),
    inYaw: new Float32Array(n),
    inPitch: new Float32Array(n),
    inFire: new Uint8Array(n),
    inJump: new Uint8Array(n),

    histX: new Float32Array(n * HISTORY_TICKS),
    histY: new Float32Array(n * HISTORY_TICKS),
    histZ: new Float32Array(n * HISTORY_TICKS),
    histHead: 0,
    histFilled: 0,

    ringX: map.ringCenter.x,
    ringZ: map.ringCenter.z,
    ringRadius: RING_START_RADIUS,
    ringPhase: 0,
    ringFrom: RING_START_RADIUS,
    ringTarget: RING_START_RADIUS,
    ringShrinkStart: 0,
    ringShrinkEnd: 0,

    aliveCount: 0,
    activeCount: 0,
    winner: -1,
    deaths: 0,
    hitCounter: 0,

    events: EVENT_NONE,
    shotCount: 0,
    shotSeat: new Int8Array(MAX_SHOTS_PER_TICK),
    shotFrom: new Float32Array(MAX_SHOTS_PER_TICK * 3),
    shotTo: new Float32Array(MAX_SHOTS_PER_TICK * 3),
    shotHit: new Int8Array(MAX_SHOTS_PER_TICK),
    hitCount: 0,
    hitVictim: new Int8Array(MAX_HITS_PER_TICK),
    hitAttacker: new Int8Array(MAX_HITS_PER_TICK),
    hitHead: new Uint8Array(MAX_HITS_PER_TICK),
    hitPoint: new Float32Array(MAX_HITS_PER_TICK * 3),
    killCount: 0,
    killVictim: new Int8Array(MAX_KILLS_PER_TICK),
    killKiller: new Int8Array(MAX_KILLS_PER_TICK),

    botTarget: new Int8Array(n).fill(-1),
    botWanderX: new Float32Array(n),
    botWanderZ: new Float32Array(n),
    botRetarget: new Float32Array(n),
    botAimYaw: new Float32Array(n),
    botAimPitch: new Float32Array(n),
    botStrafe: new Float32Array(n),
    botStrafeLeft: new Float32Array(n),
    botStuck: new Float32Array(n),
    botLastX: new Float32Array(n),
    botLastZ: new Float32Array(n),
    botBurst: new Float32Array(n),
    botReact: new Float32Array(n),
  };

  // Todos en su punto de aparicion, mirando al centro: asi lo primero que ven
  // es el hito y no una pared.
  for (let seat = 0; seat < n; seat++) {
    const spawn = map.spawns[seat];
    if (!spawn) continue;
    world.x[seat] = spawn.x;
    world.z[seat] = spawn.z;
    world.y[seat] = 0;
    world.yaw[seat] = Math.atan2(-(0 - spawn.x), -(0 - spawn.z));
    world.inYaw[seat] = world.yaw[seat] ?? 0;
    world.hp[seat] = HP_MAX;
    world.ammo[seat] = rules.magazine;
    world.botWanderX[seat] = spawn.x;
    world.botWanderZ[seat] = spawn.z;
  }
  return world;
}

/** Sienta a un asiento en la partida. Idempotente. */
export function activateSeat(world: ShooterWorld, seat: number): void {
  if (seat < 0 || seat >= MAX_PLAYERS || world.active[seat] === 1) return;
  world.active[seat] = 1;
  world.alive[seat] = 1;
  world.activeCount++;
  world.aliveCount++;
}

/**
 * Lo que pidio un celular. Se sanea aca, que es donde se testea: un cliente
 * puede mandar NaN o un `mx` de 40, y eso no puede mover a nadie a 40 veces
 * la velocidad.
 */
export function setInput(world: ShooterWorld, seat: number, input: ShooterInput): void {
  if (seat < 0 || seat >= MAX_PLAYERS) return;
  world.inMx[seat] = clampAxis(input.mx);
  world.inMy[seat] = clampAxis(input.my);
  if (Number.isFinite(input.yaw)) world.inYaw[seat] = input.yaw;
  if (Number.isFinite(input.pitch)) world.inPitch[seat] = clamp(input.pitch, -1.45, 1.45);
  world.inFire[seat] = input.fire ? 1 : 0;
  // El salto es un flanco: se guarda hasta que un paso lo consuma.
  if (input.jump) world.inJump[seat] = 1;
}

function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, -1, 1);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/* ------------------------------------------------------------------ */
/* El mapa como colision                                               */
/* ------------------------------------------------------------------ */

/**
 * Altura del suelo bajo un punto, considerando piso, plataformas y rampas.
 *
 * `fromY` es de donde viene el cuerpo: una plataforma solo lo sostiene si
 * estaba por encima de ella (o apenas por debajo, el escalon que se sube sin
 * saltar). Si no, es una pared y la resuelve el empuje horizontal.
 */
export function groundHeight(map: ShooterMap, x: number, z: number, fromY: number): number {
  let ground = 0;
  for (const platform of map.platforms) {
    if (!insideXZ(platform, x, z, 0)) continue;
    const top = platform.y + platform.h / 2;
    if (fromY >= top - STEP_UP && top > ground) ground = top;
  }
  for (const cover of map.cover) {
    if (!insideXZ(cover, x, z, 0)) continue;
    const top = cover.y + cover.h / 2;
    if (fromY >= top - STEP_UP && top > ground) ground = top;
  }
  for (const ramp of map.ramps) {
    const h = rampHeight(ramp, x, z);
    if (h >= 0 && fromY >= h - STEP_UP - 0.5 && h > ground) ground = h;
  }
  return ground;
}

/** Altura de la rampa en ese punto, o -1 si el punto no esta sobre ella. */
export function rampHeight(ramp: MapRamp, x: number, z: number): number {
  // La rampa sube hacia +x en su sistema local, girado `yaw` en el mundo.
  const dx = x - ramp.x;
  const dz = z - ramp.z;
  const cos = Math.cos(ramp.yaw);
  const sin = Math.sin(ramp.yaw);
  const u = dx * cos + dz * sin;
  const v = -dx * sin + dz * cos;
  if (Math.abs(u) > ramp.w / 2 || Math.abs(v) > ramp.d / 2) return -1;
  const t = (u + ramp.w / 2) / ramp.w;
  return ramp.y - ramp.h / 2 + t * ramp.h;
}

function insideXZ(box: MapBox, x: number, z: number, margin: number): boolean {
  return Math.abs(x - box.x) <= box.w / 2 + margin && Math.abs(z - box.z) <= box.d / 2 + margin;
}

/**
 * Empuja un circulo fuera de una caja, en planta. Devuelve si hubo contacto.
 *
 * Solo cuenta si el cuerpo esta a la altura de la caja: parado arriba de un
 * bloque no se choca con el bloque.
 */
function pushOutOfBox(body: PlayerBody, box: MapBox): boolean {
  const bottom = box.y - box.h / 2;
  const top = box.y + box.h / 2;
  // Si los pies estan (casi) sobre la tapa, se camina encima; si la cabeza
  // esta por debajo de la base, se pasa por abajo.
  if (body.y >= top - STEP_UP || body.y + PLAYER_HEIGHT <= bottom) return false;

  const halfW = box.w / 2 + PLAYER_RADIUS;
  const halfD = box.d / 2 + PLAYER_RADIUS;
  const dx = body.x - box.x;
  const dz = body.z - box.z;
  if (Math.abs(dx) >= halfW || Math.abs(dz) >= halfD) return false;

  const penX = halfW - Math.abs(dx);
  const penZ = halfD - Math.abs(dz);
  if (penX < penZ) {
    body.x = box.x + (dx < 0 ? -halfW - SKIN : halfW + SKIN);
    body.vx = 0;
  } else {
    body.z = box.z + (dz < 0 ? -halfD - SKIN : halfD + SKIN);
    body.vz = 0;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Movimiento: la funcion que comparten host y cliente                 */
/* ------------------------------------------------------------------ */

/**
 * Un paso de un cuerpo. **Muta `body`.** Es la unica fuente de verdad del
 * movimiento: el host la corre para los diez, el celular para si mismo.
 *
 * Sin inercia horizontal a proposito: en un shooter tactil, la aceleracion se
 * siente como retraso. El cuerpo va a la velocidad que pide el stick, ya.
 */
export function simulateBody(
  body: PlayerBody,
  input: ShooterInput,
  dt: number,
  map: ShooterMap,
  rules: ShooterRules,
  canMove: boolean,
): void {
  if (Number.isFinite(input.yaw)) body.yaw = input.yaw;
  if (Number.isFinite(input.pitch)) body.pitch = clamp(input.pitch, -1.45, 1.45);

  const mx = canMove ? clampAxis(input.mx) : 0;
  const my = canMove ? clampAxis(input.my) : 0;
  const length = Math.hypot(mx, my);
  const scale = length > 1 ? 1 / length : 1;

  // Adelante es (-sin yaw, -cos yaw); derecha es (cos yaw, -sin yaw).
  const sin = Math.sin(body.yaw);
  const cos = Math.cos(body.yaw);
  const speed = rules.moveSpeed * (body.onGround ? 1 : 0.85);
  body.vx = (-sin * my + cos * mx) * scale * speed;
  body.vz = (-cos * my - sin * mx) * scale * speed;

  if (canMove && input.jump && body.onGround) {
    body.vy = rules.jumpSpeed;
    body.onGround = false;
  }
  body.vy -= rules.gravity * dt;

  const prevY = body.y;
  body.x += body.vx * dt;
  body.z += body.vz * dt;
  body.y += body.vy * dt;

  // Paredes del mapa: del mapa no se sale.
  const limit = HALF - 0.5 - PLAYER_RADIUS;
  if (body.x < -limit) {
    body.x = -limit;
    body.vx = 0;
  } else if (body.x > limit) {
    body.x = limit;
    body.vx = 0;
  }
  if (body.z < -limit) {
    body.z = -limit;
    body.vz = 0;
  } else if (body.z > limit) {
    body.z = limit;
    body.vz = 0;
  }

  // Empuje horizontal contra todo lo solido. Dos pasadas: salir de una caja
  // puede meter el cuerpo en la de al lado.
  for (let pass = 0; pass < 2; pass++) {
    let touched = false;
    for (const box of map.cover) touched = pushOutOfBox(body, box) || touched;
    for (const box of map.platforms) touched = pushOutOfBox(body, box) || touched;
    touched = pushOutOfBox(body, map.landmark) || touched;
    if (!touched) break;
  }

  // Suelo. Se mide desde donde venia, no desde donde quedo: es lo que decide
  // si una plataforma sostiene o bloquea.
  const ground = groundHeight(map, body.x, body.z, Math.max(prevY, body.y));
  if (body.y <= ground) {
    body.y = ground;
    body.vy = 0;
    body.onGround = true;
  } else {
    body.onGround = body.y - ground < 0.02;
  }

  // Techo: debajo de una plataforma no se salta a traves de ella.
  for (const platform of map.platforms) {
    if (!insideXZ(platform, body.x, body.z, PLAYER_RADIUS * 0.5)) continue;
    const bottom = platform.y - platform.h / 2;
    const top = platform.y + platform.h / 2;
    if (body.y < bottom && body.y + PLAYER_HEIGHT > bottom && body.y < top - STEP_UP) {
      body.y = bottom - PLAYER_HEIGHT - SKIN;
      if (body.vy > 0) body.vy = 0;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Hitscan                                                             */
/* ------------------------------------------------------------------ */

/** Direccion de la mirada, con la convencion de camara de three. */
export function lookDirection(yaw: number, pitch: number, out: Float32Array): void {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp;
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(yaw) * cp;
}

/** Rayo contra una caja alineada. Devuelve el `t` de entrada o -1. */
export function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  box: MapBox,
): number {
  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;
  const min = [box.x - box.w / 2, box.y - box.h / 2, box.z - box.d / 2];
  const max = [box.x + box.w / 2, box.y + box.h / 2, box.z + box.d / 2];
  const origin = [ox, oy, oz];
  const dir = [dx, dy, dz];
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis] ?? 0;
    const d = dir[axis] ?? 0;
    const lo = min[axis] ?? 0;
    const hi = max[axis] ?? 0;
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }
  return tMin;
}

/**
 * Rayo contra la capsula vertical de un jugador parado en (px, py, pz).
 *
 * Aproximacion suficiente para un hitscan: se busca el punto del rayo mas
 * cercano al eje de la capsula y se compara con el radio. Devuelve el `t` del
 * impacto (menos el radio, para que la marca quede en la superficie) o -1.
 * `outHead` recibe 1 si peg0 a la altura de la cabeza.
 */
export function rayCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  px: number,
  py: number,
  pz: number,
  out: Float32Array,
): number {
  // Eje de la capsula: de (px, py + r, pz) a (px, py + H - r, pz).
  const ax = px;
  const ay0 = py + PLAYER_RADIUS;
  const ay1 = py + PLAYER_HEIGHT - PLAYER_RADIUS;
  const az = pz;

  // Distancia minima entre el rayo y el segmento vertical. Como el segmento es
  // vertical, el problema se reduce: primero en planta, despues en altura.
  const wx = ox - ax;
  const wz = oz - az;
  const dxz = dx * dx + dz * dz;
  let t: number;
  if (dxz < 1e-8) {
    // Rayo vertical: solo pega si esta encima.
    if (wx * wx + wz * wz > PLAYER_RADIUS * PLAYER_RADIUS) return -1;
    t = 0;
  } else {
    t = -(wx * dx + wz * dz) / dxz;
    if (t < 0) return -1;
  }
  const cx = ox + dx * t;
  const cz = oz + dz * t;
  const planar = Math.hypot(cx - ax, cz - az);
  if (planar > PLAYER_RADIUS) return -1;

  // Altura del rayo en ese punto, recortada al tramo recto de la capsula.
  const cy = oy + dy * t;
  if (cy < ay0 - PLAYER_RADIUS || cy > ay1 + PLAYER_RADIUS) return -1;

  // Retrocede hasta la superficie: t es el centro, no la entrada.
  const back = Math.sqrt(Math.max(0, PLAYER_RADIUS * PLAYER_RADIUS - planar * planar)) / Math.sqrt(dxz);
  const hitT = Math.max(0, t - back);
  out[0] = cy >= py + HEAD_FROM ? 1 : 0;
  return hitT;
}

const rayDir = new Float32Array(3);
const capsuleOut = new Float32Array(1);

/**
 * Resuelve un disparo desde `seat`. Escribe el resultado en los eventos del
 * paso y devuelve el asiento alcanzado o -1.
 *
 * Los demas se prueban en la posicion que tenian hace `LAG_COMP_TICKS`
 * pasos: es lo que el tirador vio en su pantalla cuando apreto.
 */
export function fireHitscan(world: ShooterWorld, seat: number, rewindTicks: number): number {
  const ox = world.x[seat] ?? 0;
  const oy = (world.y[seat] ?? 0) + EYE_HEIGHT;
  const oz = world.z[seat] ?? 0;
  lookDirection(world.yaw[seat] ?? 0, world.pitch[seat] ?? 0, rayDir);
  const dx = rayDir[0] ?? 0;
  const dy = rayDir[1] ?? 0;
  const dz = rayDir[2] ?? 0;

  // Lo mas lejos que puede llegar un tiro: el mapa entero.
  let best = 200;
  let bestSeat = -1;
  let head = 0;

  for (const box of world.map.cover) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, box);
    if (t >= 0 && t < best) best = t;
  }
  for (const box of world.map.platforms) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, box);
    if (t >= 0 && t < best) best = t;
  }
  {
    const t = rayBox(ox, oy, oz, dx, dy, dz, world.map.landmark);
    if (t >= 0 && t < best) best = t;
  }

  const back = Math.min(rewindTicks, world.histFilled);
  const slot = (world.histHead - back + HISTORY_TICKS * 2) % HISTORY_TICKS;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === seat || world.alive[other] !== 1) continue;
    const index = other * HISTORY_TICKS + slot;
    const px = back > 0 ? (world.histX[index] ?? 0) : (world.x[other] ?? 0);
    const py = back > 0 ? (world.histY[index] ?? 0) : (world.y[other] ?? 0);
    const pz = back > 0 ? (world.histZ[index] ?? 0) : (world.z[other] ?? 0);
    const t = rayCapsule(ox, oy, oz, dx, dy, dz, px, py, pz, capsuleOut);
    if (t >= 0 && t < best) {
      best = t;
      bestSeat = other;
      head = capsuleOut[0] ?? 0;
    }
  }

  if (world.shotCount < MAX_SHOTS_PER_TICK) {
    const i = world.shotCount++;
    world.shotSeat[i] = seat;
    world.shotFrom[i * 3] = ox;
    world.shotFrom[i * 3 + 1] = oy;
    world.shotFrom[i * 3 + 2] = oz;
    world.shotTo[i * 3] = ox + dx * best;
    world.shotTo[i * 3 + 1] = oy + dy * best;
    world.shotTo[i * 3 + 2] = oz + dz * best;
    world.shotHit[i] = bestSeat;
    world.events |= EVENT_SHOT;
  }

  if (bestSeat >= 0) {
    applyDamage(world, bestSeat, seat, head === 1 ? world.rules.headDamage : world.rules.bodyDamage, head === 1);
    if (world.hitCount < MAX_HITS_PER_TICK) {
      const i = world.hitCount++;
      world.hitVictim[i] = bestSeat;
      world.hitAttacker[i] = seat;
      world.hitHead[i] = head;
      world.hitPoint[i * 3] = ox + dx * best;
      world.hitPoint[i * 3 + 1] = oy + dy * best;
      world.hitPoint[i * 3 + 2] = oz + dz * best;
    }
    world.hits[seat] = (world.hits[seat] ?? 0) + 1;
  }
  return bestSeat;
}

/** Linea de vision entre dos ojos, contra el mapa solamente. */
export function hasLineOfSight(world: ShooterWorld, from: number, to: number): boolean {
  const ox = world.x[from] ?? 0;
  const oy = (world.y[from] ?? 0) + EYE_HEIGHT;
  const oz = world.z[from] ?? 0;
  const tx = world.x[to] ?? 0;
  const ty = (world.y[to] ?? 0) + EYE_HEIGHT * 0.7;
  const tz = world.z[to] ?? 0;
  let dx = tx - ox;
  let dy = ty - oy;
  let dz = tz - oz;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return true;
  dx /= length;
  dy /= length;
  dz /= length;
  for (const box of world.map.cover) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, box);
    if (t >= 0 && t < length) return false;
  }
  for (const box of world.map.platforms) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, box);
    if (t >= 0 && t < length) return false;
  }
  const t = rayBox(ox, oy, oz, dx, dy, dz, world.map.landmark);
  return !(t >= 0 && t < length);
}

/* ------------------------------------------------------------------ */
/* Dano, muerte y puntaje                                              */
/* ------------------------------------------------------------------ */

function applyDamage(world: ShooterWorld, victim: number, attacker: number, amount: number, head: boolean): void {
  if (world.alive[victim] !== 1 || world.phase !== "playing") return;
  const before = world.hp[victim] ?? 0;
  const after = Math.max(0, before - amount);
  world.hp[victim] = after;
  world.hitCounter++;
  world.events |= EVENT_HIT;
  if (attacker >= 0) {
    world.damage[attacker] = (world.damage[attacker] ?? 0) + (before - after);
    world.lastAttacker[victim] = attacker;
    world.lastHitAt[victim] = world.time;
  }
  void head;
  if (after <= 0) killPlayer(world, victim, attacker);
}

function killPlayer(world: ShooterWorld, victim: number, killer: number): void {
  if (world.alive[victim] !== 1) return;
  world.alive[victim] = 0;
  world.hp[victim] = 0;
  world.aliveCount--;
  world.deaths++;
  // El puesto es cuantos quedaban en pie al caer, contandose: el primero en
  // caer de diez es decimo.
  world.placement[victim] = world.aliveCount + 1;
  world.killer[victim] = killer;
  if (killer >= 0 && killer !== victim) world.kills[killer] = (world.kills[killer] ?? 0) + 1;
  if (world.killCount < MAX_KILLS_PER_TICK) {
    const i = world.killCount++;
    world.killVictim[i] = victim;
    world.killKiller[i] = killer;
  }
  world.events |= EVENT_KILL;
}

/** Puntos de un jugador. La formula de la guia. */
export function shooterPoints(
  placement: number,
  kills: number,
  damageDealt: number,
  survivedToEnd: boolean,
): number {
  const place = Math.max(1, Math.min(MAX_PLAYERS, placement));
  return Math.round(
    (MAX_PLAYERS + 1 - place) * 45 + kills * 40 + (damageDealt / 100) * 8 + (survivedToEnd ? 100 : 0),
  );
}

/**
 * El puesto de un asiento ahora mismo. Los caidos ya lo tienen; los vivos se
 * ordenan por vida y despues por dano hecho, que es tambien como se desempata
 * al acabarse el tiempo.
 */
export function placementOf(world: ShooterWorld, seat: number): number {
  if (world.alive[seat] !== 1) return world.placement[seat] || MAX_PLAYERS;
  let ahead = 0;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === seat || world.alive[other] !== 1) continue;
    const hpDiff = (world.hp[other] ?? 0) - (world.hp[seat] ?? 0);
    if (hpDiff > 0 || (hpDiff === 0 && (world.damage[other] ?? 0) > (world.damage[seat] ?? 0))) ahead++;
  }
  return ahead + 1;
}

/* ------------------------------------------------------------------ */
/* El anillo                                                           */
/* ------------------------------------------------------------------ */

function updateRing(world: ShooterWorld): void {
  const t = world.time - world.rules.deploySeconds;
  const scale = world.rules.matchSeconds / MATCH_SECONDS;

  // Fase siguiente: arranca a achicar cuando toca.
  const next = RING_SCHEDULE[world.ringPhase];
  if (next && t >= next.at * scale) {
    world.ringPhase++;
    world.ringFrom = world.ringRadius;
    world.ringTarget = RING_START_RADIUS * next.radius;
    world.ringShrinkStart = next.at * scale;
    world.ringShrinkEnd = (next.at + next.shrink) * scale;
    world.events |= EVENT_RING_PHASE;
  }

  if (world.ringShrinkEnd > world.ringShrinkStart) {
    const progress = clamp(
      (t - world.ringShrinkStart) / (world.ringShrinkEnd - world.ringShrinkStart),
      0,
      1,
    );
    world.ringRadius = world.ringFrom + (world.ringTarget - world.ringFrom) * progress;
  }
}

/** Distancia al borde del anillo. Negativa adentro, positiva afuera. */
export function ringDistance(world: ShooterWorld, x: number, z: number): number {
  return Math.hypot(x - world.ringX, z - world.ringZ) - world.ringRadius;
}

/* ------------------------------------------------------------------ */
/* El paso                                                             */
/* ------------------------------------------------------------------ */

const bodyScratch: PlayerBody = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: 0,
  pitch: 0,
  onGround: false,
};
const inputScratch: ShooterInput = createInput();

/**
 * Un paso de la partida. Es la unica funcion que mueve algo en el host.
 *
 * `dt` es fijo por contrato. Los eventos del paso anterior se pisan; quien los
 * quiera tiene que leerlos entre paso y paso.
 */
export function stepWorld(world: ShooterWorld, dt: number, rng: Rng): number {
  world.events = EVENT_NONE;
  world.shotCount = 0;
  world.hitCount = 0;
  world.killCount = 0;
  world.fired.fill(0);
  if (world.phase === "over") return EVENT_NONE;

  world.tick++;
  world.time += dt;

  if (world.phase === "deploy") {
    world.deployLeft -= dt;
    if (world.deployLeft <= 1e-6) {
      world.deployLeft = 0;
      world.phase = "playing";
      world.events |= EVENT_DEPLOYED;
    }
  }
  const playing = world.phase === "playing";

  // Los bots deciden antes de moverse, como una persona que ya apreto.
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (world.active[seat] !== 1 || world.alive[seat] !== 1) continue;
    if (world.botTarget[seat] === -2) continue; // -2 = persona: su input llega de afuera
    botThink(world, seat, dt, rng, inputScratch);
    setInput(world, seat, inputScratch);
  }

  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (world.active[seat] !== 1 || world.alive[seat] !== 1) continue;

    // Del array al objeto, se simula, y del objeto al array. Es el mismo
    // `simulateBody` que corre el celular.
    bodyScratch.x = world.x[seat] ?? 0;
    bodyScratch.y = world.y[seat] ?? 0;
    bodyScratch.z = world.z[seat] ?? 0;
    bodyScratch.vx = world.vx[seat] ?? 0;
    bodyScratch.vy = world.vy[seat] ?? 0;
    bodyScratch.vz = world.vz[seat] ?? 0;
    bodyScratch.yaw = world.yaw[seat] ?? 0;
    bodyScratch.pitch = world.pitch[seat] ?? 0;
    bodyScratch.onGround = world.onGround[seat] === 1;

    inputScratch.mx = world.inMx[seat] ?? 0;
    inputScratch.my = world.inMy[seat] ?? 0;
    inputScratch.yaw = world.inYaw[seat] ?? 0;
    inputScratch.pitch = world.inPitch[seat] ?? 0;
    inputScratch.fire = world.inFire[seat] === 1;
    inputScratch.jump = world.inJump[seat] === 1;
    world.inJump[seat] = 0;

    simulateBody(bodyScratch, inputScratch, dt, world.map, world.rules, playing);

    world.x[seat] = bodyScratch.x;
    world.y[seat] = bodyScratch.y;
    world.z[seat] = bodyScratch.z;
    world.vx[seat] = bodyScratch.vx;
    world.vy[seat] = bodyScratch.vy;
    world.vz[seat] = bodyScratch.vz;
    world.yaw[seat] = bodyScratch.yaw;
    world.pitch[seat] = bodyScratch.pitch;
    world.onGround[seat] = bodyScratch.onGround ? 1 : 0;
  }

  // Historia: despues de mover, antes de disparar. Lo que se guarda es lo que
  // los demas van a ver en su proximo cuadro.
  world.histHead = (world.histHead + 1) % HISTORY_TICKS;
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    const index = seat * HISTORY_TICKS + world.histHead;
    world.histX[index] = world.x[seat] ?? 0;
    world.histY[index] = world.y[seat] ?? 0;
    world.histZ[index] = world.z[seat] ?? 0;
  }
  if (world.histFilled < HISTORY_TICKS - 1) world.histFilled++;

  // Armas: cadencia, recarga, dispersion y el disparo en si.
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (world.active[seat] !== 1 || world.alive[seat] !== 1) continue;
    if ((world.cooldown[seat] ?? 0) > 0) world.cooldown[seat] = Math.max(0, (world.cooldown[seat] ?? 0) - dt);
    if ((world.reload[seat] ?? 0) > 0) {
      world.reload[seat] = Math.max(0, (world.reload[seat] ?? 0) - dt);
      if ((world.reload[seat] ?? 0) === 0) world.ammo[seat] = world.rules.magazine;
    }
    // La dispersion se cierra sola al dejar de disparar.
    world.spread[seat] = Math.max(0, (world.spread[seat] ?? 0) - 0.18 * dt);

    if (!playing || world.inFire[seat] !== 1) continue;
    if ((world.cooldown[seat] ?? 0) > 0 || (world.reload[seat] ?? 0) > 0) continue;

    world.cooldown[seat] = world.rules.fireIntervalS;
    world.ammo[seat] = (world.ammo[seat] ?? 0) - 1;
    world.shots[seat] = (world.shots[seat] ?? 0) + 1;
    world.fired[seat] = 1;

    // La dispersion desvia el tiro real, no solo la mira: se aplica al yaw y
    // al pitch con los que se resuelve el rayo, y se vuelve despues.
    const spread = world.spread[seat] ?? 0;
    const yawBefore = world.yaw[seat] ?? 0;
    const pitchBefore = world.pitch[seat] ?? 0;
    if (spread > 0) {
      world.yaw[seat] = yawBefore + rng.range(-spread, spread);
      world.pitch[seat] = pitchBefore + rng.range(-spread, spread);
    }
    fireHitscan(world, seat, world.botTarget[seat] === -2 ? LAG_COMP_TICKS : 0);
    world.yaw[seat] = yawBefore;
    world.pitch[seat] = pitchBefore;
    world.spread[seat] = Math.min(0.06, spread + 0.012);

    if ((world.ammo[seat] ?? 0) <= 0) {
      world.reload[seat] = world.rules.reloadS;
      world.events |= EVENT_RELOAD;
    }
  }

  if (playing) {
    updateRing(world);
    // Fuera del anillo se pierde vida de a poco: es lo que obliga al
    // encuentro y lo que garantiza que la partida termine.
    for (let seat = 0; seat < MAX_PLAYERS; seat++) {
      if (world.active[seat] !== 1 || world.alive[seat] !== 1) continue;
      if (ringDistance(world, world.x[seat] ?? 0, world.z[seat] ?? 0) > 0) {
        applyDamage(world, seat, -1, world.rules.ringDps * dt, false);
      }
    }
    resolveEnd(world);
  }

  return world.events;
}

function resolveEnd(world: ShooterWorld): void {
  const elapsed = world.time - world.rules.deploySeconds;
  const timeUp = elapsed >= world.rules.matchSeconds;
  if (world.aliveCount > 1 && !timeUp) return;

  // Gana el ultimo vivo; con tiempo agotado, el de mas vida y despues el que
  // hizo mas dano.
  let winner = -1;
  let bestHp = -1;
  let bestDamage = -1;
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (world.active[seat] !== 1 || world.alive[seat] !== 1) continue;
    const hp = world.hp[seat] ?? 0;
    const damage = world.damage[seat] ?? 0;
    if (hp > bestHp || (hp === bestHp && damage > bestDamage)) {
      winner = seat;
      bestHp = hp;
      bestDamage = damage;
    }
  }
  world.winner = winner;
  // Los que siguen vivos al final reciben su puesto por ranking.
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (world.active[seat] === 1 && world.alive[seat] === 1) {
      world.placement[seat] = placementOf(world, seat);
    }
  }
  world.phase = "over";
  world.events |= EVENT_OVER;
}

/* ------------------------------------------------------------------ */
/* Bots                                                                */
/* ------------------------------------------------------------------ */

/** Marca un asiento como persona: sus inputs llegan de afuera. */
export function markHuman(world: ShooterWorld, seat: number, human: boolean): void {
  if (seat < 0 || seat >= MAX_PLAYERS) return;
  world.botTarget[seat] = human ? -2 : -1;
}

export function isHuman(world: ShooterWorld, seat: number): boolean {
  return world.botTarget[seat] === -2;
}

/**
 * La cabeza de un bot. Escribe su intencion en `out`, como si fuera un celular.
 *
 * No es inteligente y no hace falta: patrulla, persigue al mas cercano que ve,
 * le dispara con punteria imperfecta y se mete en el anillo. Lo que si tiene
 * que hacer bien es no quedarse trabado contra una caja, porque un bot quieto
 * en un rincon es un blanco y un bot atascado en el medio es un bug visible.
 */
export function botThink(world: ShooterWorld, seat: number, dt: number, rng: Rng, out: ShooterInput): void {
  const x = world.x[seat] ?? 0;
  const z = world.z[seat] ?? 0;

  // Objetivo: el vivo mas cercano con linea de vision, hasta 34 unidades.
  // Mas lejos que eso, una persona con stick tactil no tiene forma de
  // responder, y el bot ganaria todos los duelos a distancia.
  let target = -1;
  let bestDist = 34;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === seat || world.active[other] !== 1 || world.alive[other] !== 1) continue;
    const d = Math.hypot((world.x[other] ?? 0) - x, (world.z[other] ?? 0) - z);
    if (d < bestDist && hasLineOfSight(world, seat, other)) {
      bestDist = d;
      target = other;
    }
  }
  const previousTarget = world.botTarget[seat] ?? -1;
  if (target >= 0) {
    // Recien lo vio: tarda en reaccionar, como una persona. Sin esto diez
    // bots se matan entre ellos en los primeros tres segundos y la partida
    // termina antes de que nadie juegue.
    if (target !== previousTarget) world.botReact[seat] = rng.range(0.5, 1.1);
    world.botTarget[seat] = target;
  } else if (previousTarget >= 0) {
    world.botTarget[seat] = -1;
  }
  world.botReact[seat] = Math.max(0, (world.botReact[seat] ?? 0) - dt);

  // Error de punteria que se renueva cada tanto: con error fijo el bot es
  // predecible, con error por cuadro tiembla.
  world.botRetarget[seat] = (world.botRetarget[seat] ?? 0) - dt;
  if ((world.botRetarget[seat] ?? 0) <= 0) {
    world.botRetarget[seat] = rng.range(0.4, 1.1);
    // El error crece con la distancia: de cerca acierta, de lejos abanica.
    const spreadScale = target >= 0 ? 1 + bestDist / 20 : 1;
    world.botAimYaw[seat] = rng.range(-1, 1) * world.rules.botAimError * spreadScale;
    world.botAimPitch[seat] = rng.range(-1, 1) * world.rules.botAimError * 0.6 * spreadScale;
    if (target < 0) {
      // Punto de paseo: adentro del anillo, con margen, y no demasiado cerca.
      const angle = rng.range(0, Math.PI * 2);
      const radius = rng.range(4, Math.max(6, world.ringRadius * 0.7));
      world.botWanderX[seat] = clamp(world.ringX + Math.cos(angle) * radius, -HALF + 4, HALF - 4);
      world.botWanderZ[seat] = clamp(world.ringZ + Math.sin(angle) * radius, -HALF + 4, HALF - 4);
    }
  }

  world.botStrafeLeft[seat] = (world.botStrafeLeft[seat] ?? 0) - dt;
  if ((world.botStrafeLeft[seat] ?? 0) <= 0) {
    world.botStrafeLeft[seat] = rng.range(0.8, 1.8);
    world.botStrafe[seat] = rng.chance(0.5) ? 1 : -1;
  }

  let aimX: number;
  let aimZ: number;
  let wantFire = false;
  let strafe = 0;
  let forward = 0;

  if (target >= 0) {
    const tx = world.x[target] ?? 0;
    const tz = world.z[target] ?? 0;
    aimX = tx;
    aimZ = tz;
    // Distancia comoda: ni encima, ni tan lejos que la dispersion lo haga
    // perder todo.
    forward = bestDist > 14 ? 1 : bestDist < 7 ? -0.6 : 0.2;
    strafe = world.botStrafe[seat] ?? 1;
    // Dispara en rafagas, no todo el tiempo: con el gatillo apretado siempre,
    // la dispersion lo deja tirando al aire.
    world.botBurst[seat] = (world.botBurst[seat] ?? 0) - dt;
    if ((world.botBurst[seat] ?? 0) <= 0) {
      world.botBurst[seat] = rng.range(0.3, 0.9);
      wantFire = rng.chance(world.rules.botTrigger);
    } else {
      wantFire = (world.inFire[seat] ?? 0) === 1;
    }
    // Todavia reaccionando: apunta, pero no aprieta.
    if ((world.botReact[seat] ?? 0) > 0) wantFire = false;
  } else {
    aimX = world.botWanderX[seat] ?? 0;
    aimZ = world.botWanderZ[seat] ?? 0;
    // Fuera del anillo, todo lo demas espera.
    if (ringDistance(world, x, z) > -3) {
      aimX = world.ringX;
      aimZ = world.ringZ;
    }
    const d = Math.hypot(aimX - x, aimZ - z);
    forward = d > 1.5 ? 1 : 0;
  }

  // Mira: hacia el objetivo, con el error del momento. Adelante es
  // (-sin yaw, -cos yaw), asi que yaw = atan2(-dx, -dz).
  const dx = aimX - x;
  const dz = aimZ - z;
  const desiredYaw = Math.atan2(-dx, -dz) + (world.botAimYaw[seat] ?? 0);
  let desiredPitch = 0;
  if (target >= 0) {
    const dy = (world.y[target] ?? 0) + EYE_HEIGHT * 0.8 - ((world.y[seat] ?? 0) + EYE_HEIGHT);
    desiredPitch = Math.atan2(dy, Math.hypot(dx, dz)) + (world.botAimPitch[seat] ?? 0);
  }
  // Gira con un tope: un bot que se da vuelta instantaneamente no se puede
  // flanquear, y flanquear es la mitad del juego.
  const currentYaw = world.yaw[seat] ?? 0;
  let delta = desiredYaw - currentYaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const turn = 4.5 * dt;
  out.yaw = currentYaw + clamp(delta, -turn, turn);
  out.pitch = desiredPitch;
  // Solo dispara cuando ya apunta mas o menos ahi.
  out.fire = wantFire && Math.abs(delta) < 0.12;

  // Atascado: si empujo hacia adelante y no avanzo, salta y cambia de lado.
  const moved = Math.hypot(x - (world.botLastX[seat] ?? x), z - (world.botLastZ[seat] ?? z));
  world.botLastX[seat] = x;
  world.botLastZ[seat] = z;
  if (forward !== 0 && moved < 0.02) {
    world.botStuck[seat] = (world.botStuck[seat] ?? 0) + dt;
  } else {
    world.botStuck[seat] = 0;
  }
  out.jump = false;
  if ((world.botStuck[seat] ?? 0) > 0.4) {
    out.jump = true;
    world.botStrafe[seat] = -(world.botStrafe[seat] ?? 1);
    strafe = world.botStrafe[seat] ?? 1;
    world.botStuck[seat] = 0;
  }

  out.mx = strafe * 0.8;
  out.my = forward;
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

/** El mapa mide 80: con posicion x10 entra en +-1024 con resolucion de 3 mm. */
export const POS_SCALE = 10;
export const HEIGHT_SCALE = 100;
export const PITCH_SCALE = 1000;

export const SHOOTER_QUANT: QuantConfig = {
  posMin: -1024,
  posMax: 1024,
  velMin: -4096,
  velMax: 4096,
};

export const ENTITY_COUNT = MAX_PLAYERS;
export const SCALAR_COUNT = 12;

/** Los escalares del snapshot, por indice. */
export const S_STATE = 0; // 0 lobby, 1 deploy, 2 playing, 3 over
export const S_RING_PHASE = 1;
export const S_RING_R = 2; // x10
export const S_RING_X = 3; // x10
export const S_RING_Z = 4; // x10
export const S_ALIVE = 5;
export const S_TIME = 6; // segundos de partida, enteros
export const S_DEPLOY = 7; // segundos que faltan del despliegue, enteros
export const S_LAST_HIT = 8; // victima | atacante << 4 | contador << 8
export const S_LAST_KILL = 9; // victima | killer << 4 | contador << 8
export const S_WINNER = 10; // asiento + 1, 0 = nadie
export const S_ACTIVE = 11; // mascara de asientos activos

/** Bit 7 de `flags`: disparo en este paso. Los otros 7 bits son la vida. */
export const FLAG_FIRED = 1 << 7;

export type MutableSnapshot = { tick: number; entities: NetEntity[]; scalars: number[] };

export function createMutableSnapshot(): MutableSnapshot {
  const entities: NetEntity[] = new Array(ENTITY_COUNT);
  for (let i = 0; i < ENTITY_COUNT; i++) {
    entities[i] = { id: i, x: 0, y: 0, vx: 0, vy: 0, angle: 0, flags: 0 };
  }
  return { tick: 0, entities, scalars: new Array<number>(SCALAR_COUNT).fill(0) };
}

/** Escribe el estado del paso sobre un snapshot ya reservado. */
export function writeSnapshot(world: ShooterWorld, out: MutableSnapshot, lastKillCode: number): void {
  out.tick = world.tick;
  let activeMask = 0;
  for (let seat = 0; seat < ENTITY_COUNT; seat++) {
    const entity = out.entities[seat];
    if (!entity) continue;
    entity.id = seat;
    entity.x = (world.x[seat] ?? 0) * POS_SCALE;
    entity.y = (world.z[seat] ?? 0) * POS_SCALE;
    entity.vx = (world.y[seat] ?? 0) * HEIGHT_SCALE;
    entity.vy = (world.pitch[seat] ?? 0) * PITCH_SCALE;
    entity.angle = world.yaw[seat] ?? 0;
    const hp = Math.round(clamp(world.hp[seat] ?? 0, 0, 127));
    entity.flags = hp | ((world.fired[seat] ?? 0) === 1 ? FLAG_FIRED : 0);
    if (world.active[seat] === 1) activeMask |= 1 << seat;
  }
  const s = out.scalars;
  s[S_STATE] = world.phase === "deploy" ? 1 : world.phase === "playing" ? 2 : 3;
  s[S_RING_PHASE] = world.ringPhase;
  s[S_RING_R] = Math.round(world.ringRadius * 10);
  s[S_RING_X] = Math.round(world.ringX * 10);
  s[S_RING_Z] = Math.round(world.ringZ * 10);
  s[S_ALIVE] = world.aliveCount;
  s[S_TIME] = Math.max(0, Math.floor(world.time - world.rules.deploySeconds));
  s[S_DEPLOY] = Math.ceil(world.deployLeft);
  // Ultimo impacto del paso, si hubo: el celular de la victima lo usa para
  // apuntar el indicador de dano hacia el atacante.
  if (world.hitCount > 0) {
    const i = world.hitCount - 1;
    const attacker = world.hitAttacker[i] ?? -1;
    s[S_LAST_HIT] = ((world.hitVictim[i] ?? 0) & 15) | ((attacker < 0 ? 15 : attacker & 15) << 4) | ((world.hitCounter & 255) << 8);
  }
  s[S_LAST_KILL] = lastKillCode;
  s[S_WINNER] = world.winner + 1;
  s[S_ACTIVE] = activeMask;
}

/** Codifica una muerte para viajar en un escalar. */
export function encodeKill(victim: number, killer: number, counter: number): number {
  return (victim & 15) | ((killer < 0 ? 15 : killer & 15) << 4) | ((counter & 255) << 8);
}

/** Lo que un cliente lee de una entidad. Escribe sobre `out` sin asignar. */
export function readEntity(entity: NetEntity, out: PlayerBody): void {
  out.x = entity.x / POS_SCALE;
  out.z = entity.y / POS_SCALE;
  out.y = entity.vx / HEIGHT_SCALE;
  out.pitch = entity.vy / PITCH_SCALE;
  out.yaw = entity.angle;
}

export function entityHp(entity: NetEntity): number {
  return entity.flags & 127;
}

export function entityFired(entity: NetEntity): boolean {
  return (entity.flags & FLAG_FIRED) !== 0;
}

export function snapshotActive(snapshot: NetSnapshot, seat: number): boolean {
  return ((snapshot.scalars[S_ACTIVE] ?? 0) & (1 << seat)) !== 0;
}
