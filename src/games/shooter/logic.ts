import { num, type SettingsValues } from "@/core/contract/settings";
import type { Rng } from "@/core/engine/rng";
import type { NetEntity, NetSnapshot, QuantConfig } from "@/core/net/snapshot";
import {
  MAP_SIZE,
  MAX_CARS,
  MAX_PLAYERS,
  MOUNTAIN_CORE,
  WEAPON_ASPERSOR,
  WEAPON_CANON,
  WEAPON_KINDS,
  WEAPON_MANGUERA,
  WEAPON_PISTOLA,
  terrainHeight,
  terrainSlope,
  type MapBox,
  type ShooterMap,
} from "./map";

/**
 * X4 · Bubble Shooter Game — la simulacion.
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
 * 2. **El terreno es una funcion.** `terrainHeight(map, x, z)` decide el piso
 *    en todo el mapa; las montanias son cobertura porque la pendiente no se
 *    camina y porque el rayo del disparo se marcha contra ella.
 * 3. **Hitscan contra capsulas, cajas y terreno, no contra mallas.** Con
 *    compensacion de latencia: el host retrocede a los demas al instante en
 *    que el tirador los vio. Las pistolas de agua son hitscan; el agua se
 *    DIBUJA arqueada, pero el impacto se decide en el momento.
 * 4. **Armas por tabla.** Cada asiento carga una; la pistola con la que todos
 *    aparecen sale de los administrables, las otras tres de los cofres.
 * 5. **El anillo es lo que garantiza que la partida termine.**
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

export const MATCH_SECONDS = 300;
export const DEPLOY_SECONDS = 5;
/** Radio inicial: cubre la diagonal del mapa entera. */
export const RING_START_RADIUS = 140;

/** Cuantos pasos de historia se guardan para la compensacion de latencia. */
export const HISTORY_TICKS = 16;
/** Cuantos pasos se retrocede al resolver un disparo: ~100 ms a 60 Hz. */
export const LAG_COMP_TICKS = 6;

/**
 * Pendiente maxima que se camina. 1 = 45 grados. Mas empinado es pared: una
 * montania con alto/radio por encima de ~0.7 tiene una franja de acantilado.
 */
export const MAX_WALK_SLOPE = 1.05;

/* El auto: fisica de arcade. */
export const CAR_ACCEL = 14;
export const CAR_MAX_SPEED = 24;
export const CAR_MAX_REVERSE = 8;
export const CAR_TURN_RATE = 2.2;
export const CAR_FRICTION = 1.4;
export const CAR_RADIUS = 1.6;
/** Hasta donde se llega a subir/abrir. */
export const INTERACT_RADIUS = 3.2;
export const CHEST_RADIUS = 2.8;
/** Pendiente maxima que trepa el auto. */
const CAR_MAX_SLOPE = 0.7;

/** Cuantos eventos de cada tipo caben en un paso. */
const MAX_SHOTS_PER_TICK = 64;
const MAX_HITS_PER_TICK = 64;
const MAX_KILLS_PER_TICK = 8;
const MAX_CHEST_EVENTS_PER_TICK = 8;

const HALF = MAP_SIZE / 2;
/** Separacion tras el empuje: sin esto el cuerpo queda vibrando en la pared. */
const SKIN = 0.01;
/** Cuanto puede subir un escalon (el borde de una roca) sin saltar. */
const STEP_UP = 0.35;
/** Pegado al terreno bajando: hasta esta distancia no se despega del suelo. */
const STICK_DOWN = 0.6;

/**
 * El cronograma del anillo, de la guia. `at` es cuando empieza a achicar,
 * `shrink` cuanto tarda y `radius` a que fraccion del inicial llega. Todo se
 * escala con `matchSeconds` sobre `MATCH_SECONDS`.
 */
export const RING_SCHEDULE: readonly { at: number; shrink: number; radius: number }[] = [
  { at: 56, shrink: 50, radius: 0.7 },
  { at: 125, shrink: 44, radius: 0.45 },
  { at: 188, shrink: 38, radius: 0.22 },
  { at: 244, shrink: 31, radius: 0.06 },
];

/* ------------------------------------------------------------------ */
/* Reglas                                                              */
/* ------------------------------------------------------------------ */

export type ShooterRules = {
  moveSpeed: number;
  jumpSpeed: number;
  gravity: number;
  /** Dano de la pistola inicial; las demas armas salen de `WEAPON_TABLE`. */
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
/* Armas                                                               */
/* ------------------------------------------------------------------ */

export type WeaponSpec = {
  kind: number;
  name: string;
  fireIntervalS: number;
  magazine: number;
  reloadS: number;
  bodyDamage: number;
  headDamage: number;
  /** Mas alla, el agua no llega. El dano cae desde `FALLOFF_FROM` del alcance. */
  maxRange: number;
  /** Cuantos rayos por tiro. El aspersor rocia varios en un cono. */
  rays: number;
  /** Medio angulo del cono de los rayos, en radianes. */
  cone: number;
  /** Cuanto crece la dispersion por tiro sostenido y hasta donde. */
  spreadGrow: number;
  spreadMax: number;
};

/** Fraccion del alcance hasta la que el dano es completo. */
export const FALLOFF_FROM = 0.7;

/**
 * La tabla de armas de agua. La pistola se completa con las reglas (es lo que
 * tocan los administrables); las de cofre son fijas.
 */
const WEAPON_TABLE: readonly Omit<WeaponSpec, "kind">[] = [
  { name: "Pistola", fireIntervalS: 0.15, magazine: 20, reloadS: 1.2, bodyDamage: 25, headDamage: 45, maxRange: 22, rays: 1, cone: 0, spreadGrow: 0.012, spreadMax: 0.06 },
  { name: "Aspersor", fireIntervalS: 0.55, magazine: 6, reloadS: 1.6, bodyDamage: 14, headDamage: 14, maxRange: 10, rays: 5, cone: 0.12, spreadGrow: 0.02, spreadMax: 0.06 },
  { name: "Manguera", fireIntervalS: 0.07, magazine: 40, reloadS: 1.8, bodyDamage: 10, headDamage: 18, maxRange: 26, rays: 1, cone: 0, spreadGrow: 0.006, spreadMax: 0.09 },
  { name: "Cañón", fireIntervalS: 1.1, magazine: 4, reloadS: 2.2, bodyDamage: 45, headDamage: 100, maxRange: 40, rays: 1, cone: 0, spreadGrow: 0, spreadMax: 0 },
];

/** La especificacion de un arma bajo estas reglas. */
export function weaponSpec(rules: ShooterRules, kind: number): WeaponSpec {
  const safe = kind >= 0 && kind < WEAPON_KINDS ? kind : WEAPON_PISTOLA;
  const base = WEAPON_TABLE[safe] ?? WEAPON_TABLE[0]!;
  if (safe === WEAPON_PISTOLA) {
    return {
      ...base,
      kind: safe,
      fireIntervalS: rules.fireIntervalS,
      magazine: rules.magazine,
      reloadS: rules.reloadS,
      bodyDamage: rules.bodyDamage,
      headDamage: rules.headDamage,
    };
  }
  return { ...base, kind: safe };
}

export { WEAPON_ASPERSOR, WEAPON_CANON, WEAPON_KINDS, WEAPON_MANGUERA, WEAPON_PISTOLA };

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

/**
 * Cuantos colores hay para elegir. Tiene que coincidir con `SEAT_TOKENS` de
 * `view.ts`, que es la paleta: uno cualquiera de esos diez, elegido por la
 * persona en la pantalla de inicio, en vez de asignado por numero de asiento.
 */
export const SKIN_COUNT = 10;

/** Lo que manda un celular, 30 veces por segundo. Intencion, nunca resultado. */
export type ShooterInput = {
  /** Movimiento, -1..1. `my` positivo es hacia adelante. Manejando: volante y acelerador. */
  mx: number;
  my: number;
  yaw: number;
  pitch: number;
  fire: boolean;
  jump: boolean;
  /** Subir/bajar del auto o abrir un cofre. Es un flanco, como `jump`. */
  interact: boolean;
  /** Recargar a mano, sin esperar a quedarse sin agua. Tambien un flanco. */
  reload: boolean;
  /**
   * Color elegido, 0..SKIN_COUNT-1. Viaja con el input y no por un canal
   * aparte: son cuatro bits sobre un paquete que ya sale 30 veces por
   * segundo, y asi quien entra tarde tampoco se pierde el color de nadie.
   */
  skin: number;
};

export function createInput(): ShooterInput {
  return { mx: 0, my: 0, yaw: 0, pitch: 0, fire: false, jump: false, interact: false, reload: false, skin: 0 };
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

/** Un auto, como objeto. Para el test y para leer el snapshot. */
export type CarBody = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  /** Asiento que lo maneja, o -1. */
  driver: number;
};

export type MatchPhase = "deploy" | "playing" | "over";

export type ShooterWorld = {
  map: ShooterMap;
  rules: ShooterRules;
  /** Una especificacion por tipo de arma, bajo estas reglas. */
  weapons: readonly WeaponSpec[];
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
  /** Que arma carga cada asiento (indice de `weapons`). */
  weapon: Uint8Array;
  /** El color de cada asiento. Cosmetico: no lo lee ninguna regla. */
  skin: Uint8Array;
  ammo: Int16Array;
  reload: Float32Array;
  cooldown: Float32Array;
  /** Dispersion acumulada por disparar sostenido, en radianes. */
  spread: Float32Array;
  /** 1 en el paso en que ese asiento disparo. Para el destello. */
  fired: Uint8Array;
  /** Auto que maneja cada asiento, o -1. */
  driving: Int8Array;

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
  inInteract: Uint8Array;
  inReload: Uint8Array;

  /* Historia de posiciones para la compensacion de latencia. */
  histX: Float32Array;
  histY: Float32Array;
  histZ: Float32Array;
  histHead: number;
  histFilled: number;

  /* Los autos. */
  carCount: number;
  carX: Float32Array;
  carY: Float32Array;
  carZ: Float32Array;
  carYaw: Float32Array;
  carSpeed: Float32Array;
  carDriver: Int8Array;

  /* Los cofres: mascara de abiertos. */
  chestOpened: number;

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
  chestEventCount: number;
  chestEventSeat: Int8Array;
  chestEventIndex: Int8Array;

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
export const EVENT_CHEST = 1 << 7;
export const EVENT_CAR = 1 << 8;

/* ------------------------------------------------------------------ */
/* Construccion                                                        */
/* ------------------------------------------------------------------ */

export function createShooterWorld(map: ShooterMap, rules: ShooterRules): ShooterWorld {
  const n = MAX_PLAYERS;
  const weapons: WeaponSpec[] = [];
  for (let kind = 0; kind < WEAPON_KINDS; kind++) weapons.push(weaponSpec(rules, kind));

  const world: ShooterWorld = {
    map,
    rules,
    weapons,
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
    weapon: new Uint8Array(n),
    skin: new Uint8Array(n),
    ammo: new Int16Array(n),
    reload: new Float32Array(n),
    cooldown: new Float32Array(n),
    spread: new Float32Array(n),
    fired: new Uint8Array(n),
    driving: new Int8Array(n).fill(-1),

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
    inInteract: new Uint8Array(n),
    inReload: new Uint8Array(n),

    histX: new Float32Array(n * HISTORY_TICKS),
    histY: new Float32Array(n * HISTORY_TICKS),
    histZ: new Float32Array(n * HISTORY_TICKS),
    histHead: 0,
    histFilled: 0,

    carCount: Math.min(MAX_CARS, map.cars.length),
    carX: new Float32Array(MAX_CARS),
    carY: new Float32Array(MAX_CARS),
    carZ: new Float32Array(MAX_CARS),
    carYaw: new Float32Array(MAX_CARS),
    carSpeed: new Float32Array(MAX_CARS),
    carDriver: new Int8Array(MAX_CARS).fill(-1),

    chestOpened: 0,

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
    chestEventCount: 0,
    chestEventSeat: new Int8Array(MAX_CHEST_EVENTS_PER_TICK),
    chestEventIndex: new Int8Array(MAX_CHEST_EVENTS_PER_TICK),

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

  // Todos en su punto de aparicion, sobre el terreno, mirando al hito: asi lo
  // primero que ven es la montania grande y saben donde esta el centro.
  const pistol = weapons[WEAPON_PISTOLA] ?? weapons[0]!;
  for (let seat = 0; seat < n; seat++) {
    const spawn = map.spawns[seat];
    if (!spawn) continue;
    world.x[seat] = spawn.x;
    world.z[seat] = spawn.z;
    world.y[seat] = terrainHeight(map, spawn.x, spawn.z);
    world.onGround[seat] = 1;
    world.yaw[seat] = Math.atan2(-(map.landmark.x - spawn.x), -(map.landmark.z - spawn.z));
    world.inYaw[seat] = world.yaw[seat] ?? 0;
    world.hp[seat] = HP_MAX;
    world.weapon[seat] = WEAPON_PISTOLA;
    // Sin eleccion, el color es el del asiento: diez asientos, diez colores.
    world.skin[seat] = seat % SKIN_COUNT;
    world.ammo[seat] = pistol.magazine;
    world.botWanderX[seat] = spawn.x;
    world.botWanderZ[seat] = spawn.z;
  }
  for (let car = 0; car < world.carCount; car++) {
    const spawn = map.cars[car];
    if (!spawn) continue;
    world.carX[car] = spawn.x;
    world.carZ[car] = spawn.z;
    world.carY[car] = terrainHeight(map, spawn.x, spawn.z);
    world.carYaw[car] = spawn.yaw;
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
  // El salto y la interaccion son flancos: se guardan hasta que un paso los consuma.
  if (input.jump) world.inJump[seat] = 1;
  if (input.interact) world.inInteract[seat] = 1;
  if (input.reload) world.inReload[seat] = 1;
  // El color entra directo: no lo lee ninguna regla, asi que no necesita
  // esperar al paso. Un indice fuera de rango se ignora en vez de pintar
  // negro: es la diferencia entre un cliente viejo y un jugador invisible.
  if (Number.isFinite(input.skin)) {
    const skin = Math.round(input.skin);
    if (skin >= 0 && skin < SKIN_COUNT) world.skin[seat] = skin;
  }
}

/** El arma actual de un asiento. Siempre devuelve algo valido. */
export function weaponOf(world: ShooterWorld, seat: number): WeaponSpec {
  return world.weapons[world.weapon[seat] ?? 0] ?? world.weapons[0]!;
}

/** Le da un arma a un asiento, con el cargador lleno. */
export function giveWeapon(world: ShooterWorld, seat: number, kind: number): void {
  if (seat < 0 || seat >= MAX_PLAYERS) return;
  const spec = world.weapons[kind] ?? world.weapons[0]!;
  world.weapon[seat] = spec.kind;
  world.ammo[seat] = spec.magazine;
  world.reload[seat] = 0;
  world.cooldown[seat] = 0;
  world.spread[seat] = 0;
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
 * Altura del suelo bajo un punto: el terreno, o la tapa de una roca si el
 * cuerpo venia de arriba de ella (o apenas por debajo, el escalon que se sube
 * sin saltar). Si no, la roca es pared y la resuelve el empuje horizontal.
 */
export function groundHeight(map: ShooterMap, x: number, z: number, fromY: number): number {
  let ground = terrainHeight(map, x, z);
  for (const cover of map.cover) {
    if (!insideXZ(cover, x, z, 0)) continue;
    const top = cover.y + cover.h / 2;
    if (fromY >= top - STEP_UP && top > ground) ground = top;
  }
  return ground;
}

function insideXZ(box: MapBox, x: number, z: number, margin: number): boolean {
  return Math.abs(x - box.x) <= box.w / 2 + margin && Math.abs(z - box.z) <= box.d / 2 + margin;
}

/**
 * Empuja un circulo fuera de una caja, en planta. Devuelve si hubo contacto.
 *
 * Solo cuenta si el cuerpo esta a la altura de la caja: parado arriba de una
 * roca no se choca con la roca.
 */
function pushOutOfBox(body: PlayerBody, box: MapBox): boolean {
  const bottom = box.y - box.h / 2;
  const top = box.y + box.h / 2;
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

/**
 * Si el terreno bloquea el paso de (fx, fz) a (tx, tz).
 *
 * Bloquea cuando el suelo sube mas de lo que permite `MAX_WALK_SLOPE`. Un
 * cuerpo en el aire por encima del terreno no choca con nada: cae y aterriza
 * en la ladera si es transitable.
 */
export function terrainBlocks(
  map: ShooterMap,
  fx: number,
  fz: number,
  fromTerrain: number,
  tx: number,
  tz: number,
  bodyY: number,
): boolean {
  const run = Math.hypot(tx - fx, tz - fz);
  if (run < 1e-6) return false;
  const to = terrainHeight(map, tx, tz);
  // Por encima del terreno destino no hay con que chocar.
  if (to <= bodyY + 0.02) return false;
  return (to - fromTerrain) / run > MAX_WALK_SLOPE;
}

/* ------------------------------------------------------------------ */
/* Movimiento: la funcion que comparten host y cliente                 */
/* ------------------------------------------------------------------ */

/**
 * Un paso de un cuerpo a pie. **Muta `body`.** Es la unica fuente de verdad
 * del movimiento: el host la corre para los diez, el celular para si mismo.
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

  const prevX = body.x;
  const prevZ = body.z;
  const prevY = body.y;
  const wasOnGround = body.onGround;
  const fromTerrain = terrainHeight(map, prevX, prevZ);

  // Horizontal contra el terreno: se prueba el paso entero, y si una ladera
  // lo bloquea, cada eje por separado, para deslizar por el borde en vez de
  // frenar en seco contra la montania.
  const nx = prevX + body.vx * dt;
  const nz = prevZ + body.vz * dt;
  if (!terrainBlocks(map, prevX, prevZ, fromTerrain, nx, nz, prevY)) {
    body.x = nx;
    body.z = nz;
  } else if (!terrainBlocks(map, prevX, prevZ, fromTerrain, nx, prevZ, prevY)) {
    body.x = nx;
    body.vz = 0;
  } else if (!terrainBlocks(map, prevX, prevZ, fromTerrain, prevX, nz, prevY)) {
    body.z = nz;
    body.vx = 0;
  } else {
    body.vx = 0;
    body.vz = 0;
  }
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

  // Empuje horizontal contra las rocas. Dos pasadas: salir de una caja puede
  // meter el cuerpo en la de al lado.
  for (let pass = 0; pass < 2; pass++) {
    let touched = false;
    for (const box of map.cover) touched = pushOutOfBox(body, box) || touched;
    if (!touched) break;
  }

  // Suelo. Se mide desde donde venia, no desde donde quedo: es lo que decide
  // si una roca sostiene o bloquea.
  const ground = groundHeight(map, body.x, body.z, Math.max(prevY, body.y));
  if (body.y <= ground) {
    body.y = ground;
    body.vy = 0;
    body.onGround = true;
  } else if (wasOnGround && body.vy <= 0 && body.y - ground < STICK_DOWN) {
    // Bajando una ladera el suelo se aleja mas rapido que la gravedad en un
    // paso: sin esto el cuerpo rebota en el aire a cada cuadro.
    body.y = ground;
    body.vy = 0;
    body.onGround = true;
  } else {
    body.onGround = body.y - ground < 0.02;
  }
}

/* ------------------------------------------------------------------ */
/* El auto                                                             */
/* ------------------------------------------------------------------ */

/**
 * Un paso de un auto. Fisica de arcade: acelera con `my`, gira con `mx`
 * proporcional a la velocidad (no gira en el lugar), roza hasta frenar solo,
 * y no entra en el nucleo de una montania, en una roca ni fuera del mapa.
 * Sin chofer, solo roza.
 */
export function stepVehicle(world: ShooterWorld, car: number, throttle: number, steer: number, dt: number): void {
  const map = world.map;
  let speed = world.carSpeed[car] ?? 0;
  let yaw = world.carYaw[car] ?? 0;
  const my = clampAxis(throttle);
  const mx = clampAxis(steer);

  if (my !== 0) speed += my * CAR_ACCEL * dt;
  else speed -= speed * CAR_FRICTION * dt;
  speed = clamp(speed, -CAR_MAX_REVERSE, CAR_MAX_SPEED);
  if (Math.abs(speed) < 0.05 && my === 0) speed = 0;

  // Girar a la derecha (mx > 0) es yaw negativo: horario visto desde arriba.
  const grip = clamp(Math.abs(speed) / 10, 0, 1);
  yaw -= mx * CAR_TURN_RATE * grip * (speed >= 0 ? 1 : -1) * dt;

  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const px = world.carX[car] ?? 0;
  const pz = world.carZ[car] ?? 0;
  let nx = px + fx * speed * dt;
  let nz = pz + fz * speed * dt;

  const limit = HALF - 2.5;
  if (nx < -limit || nx > limit) {
    nx = clamp(nx, -limit, limit);
    speed *= -0.3;
  }
  if (nz < -limit || nz > limit) {
    nz = clamp(nz, -limit, limit);
    speed *= -0.3;
  }

  // Nucleo de las montanias: roca dura.
  for (const mountain of map.mountains) {
    const core = mountain.radius * MOUNTAIN_CORE + CAR_RADIUS;
    const dx = nx - mountain.x;
    const dz = nz - mountain.z;
    const d = Math.hypot(dx, dz);
    if (d < core && d > 1e-6) {
      nx = mountain.x + (dx / d) * core;
      nz = mountain.z + (dz / d) * core;
      speed *= 0.25;
    }
  }
  // Ladera empinada: el auto no trepa.
  if (terrainSlope(map, nx, nz) > CAR_MAX_SLOPE) {
    nx = px;
    nz = pz;
    speed *= 0.3;
  }
  // Rocas: circulo contra caja, en planta.
  for (const box of map.cover) {
    const halfW = box.w / 2 + CAR_RADIUS;
    const halfD = box.d / 2 + CAR_RADIUS;
    const dx = nx - box.x;
    const dz = nz - box.z;
    if (Math.abs(dx) >= halfW || Math.abs(dz) >= halfD) continue;
    const penX = halfW - Math.abs(dx);
    const penZ = halfD - Math.abs(dz);
    if (penX < penZ) nx = box.x + (dx < 0 ? -halfW - SKIN : halfW + SKIN);
    else nz = box.z + (dz < 0 ? -halfD - SKIN : halfD + SKIN);
    speed *= 0.3;
  }

  world.carX[car] = nx;
  world.carZ[car] = nz;
  world.carY[car] = terrainHeight(map, nx, nz);
  world.carYaw[car] = yaw;
  world.carSpeed[car] = speed;
}

/** El auto libre mas cercano a un punto dentro de `INTERACT_RADIUS`, o -1. */
export function nearestFreeCar(world: ShooterWorld, x: number, z: number): number {
  let best = -1;
  let bestDist = INTERACT_RADIUS;
  for (let car = 0; car < world.carCount; car++) {
    if ((world.carDriver[car] ?? -1) >= 0) continue;
    const d = Math.hypot((world.carX[car] ?? 0) - x, (world.carZ[car] ?? 0) - z);
    if (d < bestDist) {
      bestDist = d;
      best = car;
    }
  }
  return best;
}

/** El cofre cerrado mas cercano a un punto dentro de `CHEST_RADIUS`, o -1. */
export function nearestClosedChest(map: ShooterMap, opened: number, x: number, z: number): number {
  let best = -1;
  let bestDist = CHEST_RADIUS;
  for (let i = 0; i < map.chests.length; i++) {
    if ((opened & (1 << i)) !== 0) continue;
    const chest = map.chests[i];
    if (!chest) continue;
    const d = Math.hypot(chest.x - x, chest.z - z);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Abre un cofre para un asiento. Host-autoritativo: el primero que llega se
 * lo lleva. Devuelve el arma que dio, o -1 si ya estaba abierto.
 */
export function openChest(world: ShooterWorld, seat: number, chest: number): number {
  const entry = world.map.chests[chest];
  if (!entry || chest >= 32) return -1;
  const bit = 1 << chest;
  if ((world.chestOpened & bit) !== 0) return -1;
  world.chestOpened |= bit;
  giveWeapon(world, seat, entry.weapon);
  world.events |= EVENT_CHEST;
  if (world.chestEventCount < MAX_CHEST_EVENTS_PER_TICK) {
    const i = world.chestEventCount++;
    world.chestEventSeat[i] = seat;
    world.chestEventIndex[i] = chest;
  }
  return entry.weapon;
}

/** Sube a un asiento a un auto libre. Devuelve si pudo. */
export function enterCar(world: ShooterWorld, seat: number, car: number): boolean {
  if (car < 0 || car >= world.carCount || (world.carDriver[car] ?? -1) >= 0) return false;
  if ((world.driving[seat] ?? -1) >= 0) return false;
  world.carDriver[car] = seat;
  world.driving[seat] = car;
  world.events |= EVENT_CAR;
  return true;
}

/** Baja a un asiento de su auto, al costado. */
export function exitCar(world: ShooterWorld, seat: number): void {
  const car = world.driving[seat] ?? -1;
  if (car < 0) return;
  world.carDriver[car] = -1;
  world.driving[seat] = -1;
  const yaw = world.carYaw[car] ?? 0;
  // A la derecha del auto, sobre el terreno.
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const limit = HALF - 1;
  const x = clamp((world.carX[car] ?? 0) + rx * 2.4, -limit, limit);
  const z = clamp((world.carZ[car] ?? 0) + rz * 2.4, -limit, limit);
  world.x[seat] = x;
  world.z[seat] = z;
  world.y[seat] = terrainHeight(world.map, x, z);
  world.vx[seat] = 0;
  world.vy[seat] = 0;
  world.vz[seat] = 0;
  world.onGround[seat] = 1;
  world.events |= EVENT_CAR;
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
 * Rayo contra el terreno: se marcha en pasos y, al hundirse, se afina por
 * biseccion. Devuelve el `t` de entrada o -1 si no toca antes de `maxT`.
 *
 * `step` grande alcanza para linea de vision (las montanias son grandes);
 * para el disparo se afina, asi la salpicadura queda sobre la ladera.
 */
export function rayTerrain(
  map: ShooterMap,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
  step: number,
  refine: boolean,
): number {
  // Un rayo que sube por encima de la montania mas alta no toca nunca.
  let previous = 0;
  for (let t = step; t <= maxT + step; t += step) {
    const at = t > maxT ? maxT : t;
    const h = terrainHeight(map, ox + dx * at, oz + dz * at);
    if (oy + dy * at < h) {
      if (!refine) return at;
      let lo = previous;
      let hi = at;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (oy + dy * mid < terrainHeight(map, ox + dx * mid, oz + dz * mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    if (at >= maxT) break;
    previous = at;
  }
  return -1;
}

/**
 * Rayo contra la capsula vertical de un jugador parado en (px, py, pz).
 *
 * Aproximacion suficiente para un hitscan: se busca el punto del rayo mas
 * cercano al eje de la capsula y se compara con el radio. Devuelve el `t` del
 * impacto (menos el radio, para que la marca quede en la superficie) o -1.
 * `outHead` recibe 1 si pego a la altura de la cabeza.
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
  const ax = px;
  const ay0 = py + PLAYER_RADIUS;
  const ay1 = py + PLAYER_HEIGHT - PLAYER_RADIUS;
  const az = pz;

  const wx = ox - ax;
  const wz = oz - az;
  const dxz = dx * dx + dz * dz;
  let t: number;
  if (dxz < 1e-8) {
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

  const cy = oy + dy * t;
  if (cy < ay0 - PLAYER_RADIUS || cy > ay1 + PLAYER_RADIUS) return -1;

  const back = Math.sqrt(Math.max(0, PLAYER_RADIUS * PLAYER_RADIUS - planar * planar)) / Math.sqrt(dxz);
  const hitT = Math.max(0, t - back);
  out[0] = cy >= py + HEAD_FROM ? 1 : 0;
  return hitT;
}

const rayDir = new Float32Array(3);
const capsuleOut = new Float32Array(1);

/**
 * Resuelve UN rayo del disparo de `seat` con el arma que carga. Escribe el
 * resultado en los eventos del paso y devuelve el asiento alcanzado o -1.
 *
 * Los demas se prueban en la posicion que tenian hace `rewindTicks` pasos:
 * es lo que el tirador vio en su pantalla cuando apreto. El alcance es el del
 * arma, y el dano cae linealmente desde `FALLOFF_FROM` del alcance a 0.
 */
export function fireHitscan(world: ShooterWorld, seat: number, rewindTicks: number): number {
  const spec = weaponOf(world, seat);
  const ox = world.x[seat] ?? 0;
  const oy = (world.y[seat] ?? 0) + EYE_HEIGHT;
  const oz = world.z[seat] ?? 0;
  lookDirection(world.yaw[seat] ?? 0, world.pitch[seat] ?? 0, rayDir);
  const dx = rayDir[0] ?? 0;
  const dy = rayDir[1] ?? 0;
  const dz = rayDir[2] ?? 0;

  let best = spec.maxRange;
  let bestSeat = -1;
  let head = 0;

  for (const box of world.map.cover) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, box);
    if (t >= 0 && t < best) best = t;
  }
  {
    const t = rayTerrain(world.map, ox, oy, oz, dx, dy, dz, best, 1, true);
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
    const base = head === 1 ? spec.headDamage : spec.bodyDamage;
    applyDamage(world, bestSeat, seat, base * damageFalloff(spec, best), head === 1);
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

/** Factor de dano por distancia: 1 hasta `FALLOFF_FROM` del alcance, 0 en el alcance. */
export function damageFalloff(spec: WeaponSpec, distance: number): number {
  const from = spec.maxRange * FALLOFF_FROM;
  if (distance <= from) return 1;
  if (distance >= spec.maxRange) return 0;
  return 1 - (distance - from) / (spec.maxRange - from);
}

/** Linea de vision entre dos ojos, contra rocas y terreno solamente. */
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
  // El terreno se marcha grueso: una montania no se esconde entre dos pasos.
  const t = rayTerrain(world.map, ox, oy, oz, dx, dy, dz, length - 0.5, 2.5, false);
  return t < 0;
}

/* ------------------------------------------------------------------ */
/* Dano, muerte y puntaje                                              */
/* ------------------------------------------------------------------ */

function applyDamage(world: ShooterWorld, victim: number, attacker: number, amount: number, head: boolean): void {
  if (world.alive[victim] !== 1 || world.phase !== "playing" || amount <= 0) return;
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
  // Un muerto suelta el volante: el auto queda para quien lo agarre.
  if ((world.driving[victim] ?? -1) >= 0) {
    world.carDriver[world.driving[victim] ?? 0] = -1;
    world.driving[victim] = -1;
  }
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
  world.chestEventCount = 0;
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

  // Interacciones: abrir un cofre gana al auto si hay los dos al alcance.
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (world.inInteract[seat] !== 1) continue;
    world.inInteract[seat] = 0;
    if (!playing || world.active[seat] !== 1 || world.alive[seat] !== 1) continue;
    if ((world.driving[seat] ?? -1) >= 0) {
      exitCar(world, seat);
      continue;
    }
    const x = world.x[seat] ?? 0;
    const z = world.z[seat] ?? 0;
    const chest = nearestClosedChest(world.map, world.chestOpened, x, z);
    if (chest >= 0) {
      openChest(world, seat, chest);
      continue;
    }
    const car = nearestFreeCar(world, x, z);
    if (car >= 0) enterCar(world, seat, car);
  }

  // Los autos: con chofer obedecen su stick; sin chofer, rozan hasta parar.
  for (let car = 0; car < world.carCount; car++) {
    const driver = world.carDriver[car] ?? -1;
    const throttle = driver >= 0 && playing ? (world.inMy[driver] ?? 0) : 0;
    const steer = driver >= 0 && playing ? (world.inMx[driver] ?? 0) : 0;
    stepVehicle(world, car, throttle, steer, dt);
  }

  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (world.active[seat] !== 1 || world.alive[seat] !== 1) continue;

    const car = world.driving[seat] ?? -1;
    if (car >= 0) {
      // Manejando, el cuerpo va donde va el auto. Sigue siendo blanco.
      const yaw = world.carYaw[car] ?? 0;
      const speed = world.carSpeed[car] ?? 0;
      world.x[seat] = world.carX[car] ?? 0;
      world.z[seat] = world.carZ[car] ?? 0;
      world.y[seat] = (world.carY[car] ?? 0) + 0.3;
      world.vx[seat] = -Math.sin(yaw) * speed;
      world.vz[seat] = -Math.cos(yaw) * speed;
      world.vy[seat] = 0;
      world.onGround[seat] = 1;
      if (Number.isFinite(world.inYaw[seat] ?? 0)) world.yaw[seat] = world.inYaw[seat] ?? 0;
      world.pitch[seat] = world.inPitch[seat] ?? 0;
      world.inJump[seat] = 0;
      continue;
    }

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
    inputScratch.interact = false;
    inputScratch.reload = false;
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

  // Armas: cadencia, recarga, dispersion y el disparo en si, con el arma que
  // cada uno carga. Manejando no se dispara: una mano en el volante.
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (world.active[seat] !== 1 || world.alive[seat] !== 1) continue;
    const spec = weaponOf(world, seat);
    if ((world.cooldown[seat] ?? 0) > 0) world.cooldown[seat] = Math.max(0, (world.cooldown[seat] ?? 0) - dt);
    if ((world.reload[seat] ?? 0) > 0) {
      world.reload[seat] = Math.max(0, (world.reload[seat] ?? 0) - dt);
      if ((world.reload[seat] ?? 0) === 0) world.ammo[seat] = spec.magazine;
    }
    // La dispersion se cierra sola al dejar de disparar.
    world.spread[seat] = Math.max(0, (world.spread[seat] ?? 0) - 0.18 * dt);

    /*
     * Recarga a mano: se consume el flanco aunque no se pueda usar, para que
     * no quede guardado y salte solo tres segundos despues. Solo entra si
     * falta agua y no se esta recargando ya.
     */
    if (world.inReload[seat] === 1) {
      world.inReload[seat] = 0;
      if (playing && (world.reload[seat] ?? 0) <= 0 && (world.ammo[seat] ?? 0) < spec.magazine) {
        world.reload[seat] = spec.reloadS;
        world.events |= EVENT_RELOAD;
      }
    }

    if (!playing || world.inFire[seat] !== 1 || (world.driving[seat] ?? -1) >= 0) continue;
    if ((world.cooldown[seat] ?? 0) > 0 || (world.reload[seat] ?? 0) > 0) continue;

    world.cooldown[seat] = spec.fireIntervalS;
    world.ammo[seat] = (world.ammo[seat] ?? 0) - 1;
    world.shots[seat] = (world.shots[seat] ?? 0) + 1;
    world.fired[seat] = 1;

    // La dispersion desvia el tiro real, no solo la mira: se aplica al yaw y
    // al pitch con los que se resuelve el rayo, y se vuelve despues. El
    // aspersor ademas abre varios rayos en un cono.
    const spread = world.spread[seat] ?? 0;
    const yawBefore = world.yaw[seat] ?? 0;
    const pitchBefore = world.pitch[seat] ?? 0;
    const rewind = world.botTarget[seat] === -2 ? LAG_COMP_TICKS : 0;
    for (let ray = 0; ray < spec.rays; ray++) {
      const cone = spec.rays > 1 ? spec.cone : 0;
      const jitter = spread + cone;
      if (jitter > 0) {
        world.yaw[seat] = yawBefore + rng.range(-jitter, jitter);
        world.pitch[seat] = pitchBefore + rng.range(-jitter, jitter) * 0.7;
      }
      fireHitscan(world, seat, rewind);
    }
    world.yaw[seat] = yawBefore;
    world.pitch[seat] = pitchBefore;
    world.spread[seat] = Math.min(spec.spreadMax, spread + spec.spreadGrow);

    if ((world.ammo[seat] ?? 0) <= 0) {
      world.reload[seat] = spec.reloadS;
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
 * que hacer bien es no quedarse trabado contra una roca o una ladera, porque
 * un bot quieto en un rincon es un blanco y un bot atascado en el medio es un
 * bug visible. No maneja ni abre cofres: eso queda para mas adelante.
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
      /*
       * Punto de paseo: cerca de donde ya esta, no del centro del anillo.
       *
       * Es la diferencia entre una partida de cinco minutos y una de treinta
       * segundos. Con el anillo abierto —que al principio es el mapa entero—
       * pasear "hacia adentro del anillo" manda a los diez al mismo lugar, y
       * se matan entre todos antes de que nadie llegue a jugar. Paseando
       * cerca se quedan repartidos, y lo que los junta es el anillo cuando
       * cierra, que es de donde tiene que venir el encuentro.
       *
       * Tres intentos por si cae en una ladera; si todos fallan, se va igual
       * y el detector de atasco lo saca.
       */
      for (let attempt = 0; attempt < 3; attempt++) {
        const angle = rng.range(0, Math.PI * 2);
        const radius = rng.range(10, 34);
        let wx = x + Math.cos(angle) * radius;
        let wz = z + Math.sin(angle) * radius;
        // Que el destino quede adentro del anillo: el anillo si manda.
        const keep = Math.max(4, world.ringRadius - 8);
        const d = Math.hypot(wx - world.ringX, wz - world.ringZ);
        if (d > keep && d > 1e-6) {
          wx = world.ringX + ((wx - world.ringX) / d) * keep;
          wz = world.ringZ + ((wz - world.ringZ) / d) * keep;
        }
        wx = clamp(wx, -HALF + 4, HALF - 4);
        wz = clamp(wz, -HALF + 4, HALF - 4);
        world.botWanderX[seat] = wx;
        world.botWanderZ[seat] = wz;
        if (terrainSlope(world.map, wx, wz) < 0.6) break;
      }
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
    // Distancia comoda para el arma que carga: ni encima, ni tan lejos que el
    // agua no llegue.
    const reach = weaponOf(world, seat).maxRange * 0.6;
    forward = bestDist > reach ? 1 : bestDist < reach * 0.4 ? -0.6 : 0.2;
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
  out.reload = false;
  /*
   * Un bot abre el cofre que le queda al paso, si no tiene a nadie a la
   * vista. No lo busca: se lo lleva el que pasa. Alcanza para que los cofres
   * se usen en una partida sin gente y para que el que llega tarde no
   * encuentre el valle intacto. Manejar, no maneja: queda pendiente.
   */
  out.interact =
    target < 0 && nearestClosedChest(world.map, world.chestOpened, x, z) >= 0;
  // Un bot no elige color: se queda con el de su asiento. Sin esto, el
  // scratch de input compartido los pintaria a todos del mismo.
  out.skin = seat % SKIN_COUNT;
  if ((world.botStuck[seat] ?? 0) > 0.4) {
    out.jump = true;
    world.botStrafe[seat] = -(world.botStrafe[seat] ?? 1);
    strafe = world.botStrafe[seat] ?? 1;
    world.botStuck[seat] = 0;
    // Contra una ladera, un punto de paseo nuevo sirve mas que saltar.
    if (target < 0) world.botRetarget[seat] = 0;
  }

  out.mx = strafe * 0.8;
  out.my = forward;
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

/** El mapa mide 200: con posicion x10 entra en +-1024 con resolucion de 3 mm. */
export const POS_SCALE = 10;
export const HEIGHT_SCALE = 100;
export const PITCH_SCALE = 1000;
/** Velocidad del auto x100 en el canal `vx` de su entidad. */
export const CAR_SPEED_SCALE = 100;

export const SHOOTER_QUANT: QuantConfig = {
  posMin: -1024,
  posMax: 1024,
  velMin: -4096,
  velMax: 4096,
};

/** Los autos viajan como entidades con id por encima de los asientos. */
export const CAR_ENTITY_BASE = 16;
export const ENTITY_COUNT = MAX_PLAYERS + MAX_CARS;
/**
 * Los 16 escalares del contrato, todos usados. Si hiciera falta uno mas, el
 * lugar donde buscarlo es `S_WEAPONS`: gasta 2 bits por asiento sobre 32, o
 * sea 12 libres.
 */
export const SCALAR_COUNT = 16;

/* Escalares. */
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
export const S_CHESTS_OPENED = 12; // mascara de cofres abiertos
export const S_WEAPONS = 13; // 2 bits por asiento: que arma carga
/**
 * Los colores elegidos, 4 bits por asiento. Diez colores no entran en tres
 * bits y cuarenta bits no entran en un escalar, asi que van en dos: los
 * asientos 0 a 4 en el primero y el 5 al 9 en el segundo.
 */
export const S_SKINS_A = 14;
export const S_SKINS_B = 15;
/** Cuantos asientos entran en cada uno de los dos escalares de color. */
const SKINS_PER_SCALAR = 5;
const SKIN_BITS = 4;

/** Bit 7 del byte de flags de un jugador: disparo en este tick. Los bits 0-6 son la vida. */
export const FLAG_FIRED = 1 << 7;

export type MutableSnapshot = { tick: number; entities: NetEntity[]; scalars: number[] };

export function createMutableSnapshot(): MutableSnapshot {
  const entities: NetEntity[] = new Array(ENTITY_COUNT);
  for (let i = 0; i < MAX_PLAYERS; i++) {
    entities[i] = { id: i, x: 0, y: 0, vx: 0, vy: 0, angle: 0, flags: 0 };
  }
  for (let car = 0; car < MAX_CARS; car++) {
    entities[MAX_PLAYERS + car] = { id: CAR_ENTITY_BASE + car, x: 0, y: 0, vx: 0, vy: 0, angle: 0, flags: 0 };
  }
  return { tick: 0, entities, scalars: new Array<number>(SCALAR_COUNT).fill(0) };
}

/** Escribe el estado del paso sobre un snapshot ya reservado. */
export function writeSnapshot(world: ShooterWorld, out: MutableSnapshot, lastKillCode: number): void {
  out.tick = world.tick;
  let activeMask = 0;
  let weapons = 0;
  let skinsA = 0;
  let skinsB = 0;
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
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
    weapons |= ((world.weapon[seat] ?? 0) & 3) << (seat * 2);
    const skin = (world.skin[seat] ?? 0) & 15;
    if (seat < SKINS_PER_SCALAR) skinsA |= skin << (seat * SKIN_BITS);
    else skinsB |= skin << ((seat - SKINS_PER_SCALAR) * SKIN_BITS);
  }
  for (let car = 0; car < MAX_CARS; car++) {
    const entity = out.entities[MAX_PLAYERS + car];
    if (!entity) continue;
    entity.id = CAR_ENTITY_BASE + car;
    entity.x = (world.carX[car] ?? 0) * POS_SCALE;
    entity.y = (world.carZ[car] ?? 0) * POS_SCALE;
    entity.vx = (world.carSpeed[car] ?? 0) * CAR_SPEED_SCALE;
    entity.vy = (world.carY[car] ?? 0) * HEIGHT_SCALE;
    entity.angle = world.carYaw[car] ?? 0;
    // 0 = libre; asiento + 1 = quien maneja.
    entity.flags = car < world.carCount ? (world.carDriver[car] ?? -1) + 1 : 0;
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
  s[S_CHESTS_OPENED] = world.chestOpened;
  s[S_WEAPONS] = weapons;
  s[S_SKINS_A] = skinsA;
  s[S_SKINS_B] = skinsB;
}

/** Codifica una muerte para viajar en un escalar. */
export function encodeKill(victim: number, killer: number, counter: number): number {
  return (victim & 15) | ((killer < 0 ? 15 : killer & 15) << 4) | ((counter & 255) << 8);
}

/** Lo que un cliente lee de una entidad-jugador. Escribe sobre `out` sin asignar. */
export function readEntity(entity: NetEntity, out: PlayerBody): void {
  out.x = entity.x / POS_SCALE;
  out.z = entity.y / POS_SCALE;
  out.y = entity.vx / HEIGHT_SCALE;
  out.pitch = entity.vy / PITCH_SCALE;
  out.yaw = entity.angle;
}

/** Lo que un cliente lee de una entidad-auto. */
export function readCar(entity: NetEntity, out: CarBody): void {
  out.x = entity.x / POS_SCALE;
  out.z = entity.y / POS_SCALE;
  out.speed = entity.vx / CAR_SPEED_SCALE;
  out.y = entity.vy / HEIGHT_SCALE;
  out.yaw = entity.angle;
  out.driver = (entity.flags & 0xff) - 1;
}

export function isCarEntity(entity: NetEntity): boolean {
  return entity.id >= CAR_ENTITY_BASE && entity.id < CAR_ENTITY_BASE + MAX_CARS;
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

/** El arma de un asiento segun el escalar empaquetado. */
export function snapshotWeapon(snapshot: NetSnapshot, seat: number): number {
  return ((snapshot.scalars[S_WEAPONS] ?? 0) >> (seat * 2)) & 3;
}

export function snapshotChestOpened(snapshot: NetSnapshot, chest: number): boolean {
  return ((snapshot.scalars[S_CHESTS_OPENED] ?? 0) & (1 << chest)) !== 0;
}

/** El color elegido por un asiento, segun los dos escalares empaquetados. */
export function snapshotSkin(snapshot: NetSnapshot, seat: number): number {
  const first = seat < SKINS_PER_SCALAR;
  const packed = snapshot.scalars[first ? S_SKINS_A : S_SKINS_B] ?? 0;
  const shift = (first ? seat : seat - SKINS_PER_SCALAR) * SKIN_BITS;
  const skin = (packed >> shift) & 15;
  // Un valor imposible (cliente viejo, escalar sin escribir) cae al color del
  // asiento, que es lo que se veia antes de que hubiera colores elegibles.
  return skin < SKIN_COUNT ? skin : seat % SKIN_COUNT;
}
