import type { PaletteToken } from "@/core/engine/palette";
import { createRng, type Rng } from "@/core/engine/rng";
import type { NetSnapshot } from "@/core/net/snapshot";
import { createPrediction, type Prediction } from "@/core/net/prediction";
import { MAX_CARS, MAX_PLAYERS, terrainHeight, type ShooterMap } from "./map";
import {
  EYE_HEIGHT,
  FLAG_FIRED,
  HP_MAX,
  INTERACT_RADIUS,
  S_ACTIVE,
  S_ALIVE,
  S_CHESTS_OPENED,
  S_DEPLOY,
  S_LAST_HIT,
  S_LAST_KILL,
  S_RING_PHASE,
  S_RING_R,
  S_RING_X,
  S_RING_Z,
  S_STATE,
  S_TIME,
  S_WINNER,
  activateSeat,
  createInput,
  createMutableSnapshot,
  createShooterWorld,
  encodeKill,
  entityFired,
  entityHp,
  groundHeight,
  isCarEntity,
  lookDirection,
  markHuman,
  nearestClosedChest,
  readCar,
  readEntity,
  ringDistance,
  setInput,
  simulateBody,
  snapshotSkin,
  snapshotWeapon,
  stepWorld,
  weaponSpec,
  writeSnapshot,
  type CarBody,
  type MutableSnapshot,
  type PlayerBody,
  type ShooterInput,
  type ShooterRules,
  type ShooterWorld,
  type WeaponSpec,
} from "./logic";

/**
 * X4 · Bubble Shooter Game — el estado de la partida tal como se DIBUJA.
 *
 * Es la pieza que junta las tres cosas que no pueden vivir en el mismo lugar:
 * la simulacion autoritativa (`logic.ts`, solo en el host), la red (que la
 * arma `ShooterGame`, afuera del canvas) y la escena (`ShooterScene`, adentro
 * del canvas, que no tiene acceso a nada de lo anterior). Los tres escriben y
 * leen de aca, sin React en el medio: son arrays y numeros que se mutan a 60
 * Hz, y un `useState` por cuadro seria exactamente el problema de rendimiento
 * numero uno de R3F.
 *
 * Dos roles, un solo tipo:
 *
 * - **Host (el proyector).** Corre `stepWorld`, copia el mundo a los arrays
 *   de dibujo, cosecha los eventos del paso (tiros, impactos, muertes, cofres)
 *   como efectos, y publica un snapshot a 20 Hz. Puede jugar el asiento 0.
 * - **Cliente (el celular).** Predice su propio cuerpo con el mismo
 *   `simulateBody` del host, manda su input con secuencia, y dibuja a los
 *   demas y a los autos desde el estado interpolado ~100 ms atras que entrega
 *   `useGameNet`. Los escalares y los eventos los toma del estado crudo apenas
 *   llega. Manejando no predice: el auto es del host y la camara lo sigue.
 *
 * Cero asignaciones por paso, salvo las que se eligen a proposito: el cuerpo
 * predicho de cada paso (la prediccion exige una funcion pura), una entrada en
 * el feed cuando alguien muere, y una especificacion de arma al cambiarla.
 */

/**
 * La paleta de colores de personaje: diez, todos de la marca.
 *
 * Cada uno elige el suyo en la pantalla de inicio; quien no elige se queda
 * con el de su asiento, que es como se veia antes de que hubiera eleccion.
 * El indice es lo que viaja por red (`skin`), nunca el color.
 */
export const SEAT_TOKENS: readonly PaletteToken[] = [
  "--sn-cyan-400",
  "--sn-magenta-400",
  "--sn-violet-300",
  "--sn-success",
  "--sn-warn",
  "--sn-danger",
  "--sn-cyan-300",
  "--sn-magenta-300",
  "--sn-violet-400",
  "--sn-cyan-500",
];

export const VIEW_DELAY_MS = 100;
export const OVER_HOLD_S = 4.5;
export const TRACER_MAX = 48;
export const TRACER_STRIDE = 8; // x0 y0 z0 x1 y1 z1 edad asiento
export const SPARK_MAX = 160;
export const SPARK_STRIDE = 7; // x y z vx vy vz edad
export const FEED_MAX = 4;
export const FEED_LIFE_S = 6;

/** Que interaccion tiene al alcance el jugador local. */
export const HINT_NONE = 0;
export const HINT_CHEST = 1;
export const HINT_ENTER_CAR = 2;
export const HINT_EXIT_CAR = 3;

/** Radianes por pixel de arrastre. Un giro completo son ~1500 px. */
const LOOK_SENS = 0.0042;
const PITCH_LIMIT = 1.4;
const STEP = 1 / 60;
const STATE_STEP = 1 / 20;
const TRACER_LIFE_S = 0.24;
const SPARK_LIFE_S = 0.45;
const FLASH_LIFE_S = 0.07;
const SPARK_GRAVITY = 14;
/**
 * Cuatro buffers de input, no dos: `sendInput` se toma por referencia y el
 * limitador lo puede diferir hasta 33 ms, que son dos pasos mas.
 */
const INPUT_BUFFERS = 4;

export type FeedEntry = { victim: number; killer: number; age: number };

/** Lo que el juego lee de los sticks cada paso. Es la forma de `SticksState`. */
export type StickSample = {
  mx: number;
  my: number;
  lookX: number;
  lookY: number;
  fire: boolean;
  jump: boolean;
};

export type ShooterView = {
  readonly map: ShooterMap;
  readonly rules: ShooterRules;
  readonly isHost: boolean;
  /** Asiento local. En el proyector es 0 y no juega salvo `hostPlaying`. */
  readonly seat: number;
  /** Solo en el host. */
  readonly world: ShooterWorld | null;
  readonly rng: Rng;
  reducedMotion: boolean;
  /**
   * El proyector juega el asiento 0 con teclado y mouse. Sin red de por
   * medio: su input entra directo al mundo y su cuerpo se lee del mundo,
   * asi que no predice nada.
   */
  hostPlaying: boolean;
  /** Segundos desde que se creo la vista. Es el reloj de los efectos. */
  elapsed: number;

  /* Lo que se dibuja, por asiento. */
  readonly active: Uint8Array;
  readonly alive: Uint8Array;
  readonly hp: Float32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly yaw: Float32Array;
  readonly pitch: Float32Array;
  readonly weapon: Uint8Array;
  /** El color de cada asiento: indice en `SEAT_TOKENS`. */
  readonly skin: Uint8Array;
  /** Auto que maneja cada asiento, o -1. */
  readonly driving: Int8Array;
  readonly names: string[];
  /** Lo que eligio esta persona en la pantalla de inicio. */
  ownSkin: number;
  ownName: string;
  /** El nombre del proyector, para cuando toma el asiento 0. */
  hostName: string;

  /* Los autos. */
  readonly carCount: number;
  readonly carX: Float32Array;
  readonly carY: Float32Array;
  readonly carZ: Float32Array;
  readonly carYaw: Float32Array;
  readonly carSpeed: Float32Array;
  readonly carDriver: Int8Array;

  /* Los cofres: mascara de abiertos, como viaja por red. */
  chestOpened: number;

  /* La partida. 0 esperando, 1 despliegue, 2 jugando, 3 terminada. */
  state: number;
  timeS: number;
  deployLeft: number;
  aliveCount: number;
  winner: number;
  ringPhase: number;
  ringX: number;
  ringZ: number;
  ringRadius: number;

  /* El jugador local. */
  readonly body: PlayerBody;
  readonly prediction: Prediction<PlayerBody, ShooterInput> | null;
  readonly inputs: ShooterInput[];
  inputCursor: number;
  camYaw: number;
  camPitch: number;
  /** El arma en mano y su especificacion (se renueva solo al cambiar de arma). */
  ownWeapon: number;
  ownSpec: WeaponSpec;
  ammo: number;
  reloadLeft: number;
  cooldown: number;
  /** Auto que maneja el jugador local, o -1. */
  ownDriving: number;
  /** El boton/tecla de interactuar pidio algo desde el ultimo paso. */
  interactQueued: boolean;
  /** Idem para la recarga a mano. */
  reloadQueued: boolean;
  /** Que se puede hacer ahora (`HINT_*`). Para el aviso en pantalla. */
  interactHint: number;
  /** Cofres que abrio el jugador local. */
  chestsOpened: number;
  /**
   * Sonido. Lo conecta `ShooterGame` con el del ciclo de vida, que ya sabe
   * si esta silenciado. Suena lo propio —el chorro y lo que se acierta o se
   * recibe—, no los tiros de los diez: a catorce por segundo cada uno seria
   * una lavadora.
   */
  playSfx: ((name: "squirt" | "splash") => void) | null;
  /** Cliente → host. Lo conecta `ShooterGame` cuando existe el puerto. */
  send: ((input: ShooterInput, sequence: number) => void) | null;
  /** Host → todos. Idem. */
  publish: ((snapshot: NetSnapshot, tick: number) => void) | null;

  /* Publicacion (host). */
  readonly snapshots: MutableSnapshot[];
  snapshotCursor: number;
  stateTimer: number;
  /** Quien disparo desde el ultimo snapshot: a 60 Hz de paso y 20 de red, un
   *  `fired` de un solo paso se perderia dos de cada tres veces. */
  readonly firedSince: Uint8Array;
  lastHitCode: number;
  lastKillCode: number;
  killCounter: number;

  /* Eventos vistos (cliente), para detectar los nuevos. */
  hitCodeSeen: number;
  killCodeSeen: number;
  chestsSeen: number;
  readonly firedTick: Int32Array;

  /* Resultado local. */
  spectating: boolean;
  placement: number;
  kills: number;
  damageDealt: number;
  ownHp: number;
  ownAlive: boolean;
  outsideRing: boolean;
  /** Momento (elapsed) en que termino la partida, o -1. */
  overAt: number;

  /* Sensaciones. Todas bajan solas a 0. */
  hitMarkerAge: number;
  hurtAge: number;
  damageAge: number;
  /** Rumbo del atacante, en radianes de mundo. NaN si vino del anillo. */
  damageYaw: number;
  shake: number;
  recoil: number;
  /** Contadores para que el HUD en DOM dispare animaciones por cambio. */
  hitCount: number;
  hurtCount: number;
  readonly feed: FeedEntry[];

  /* Efectos instanciados. */
  readonly tracers: Float32Array;
  tracerCursor: number;
  readonly sparks: Float32Array;
  sparkCursor: number;
  readonly flashes: Float32Array;
};

const dirScratch = new Float32Array(3);
const carScratch: CarBody = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, driver: -1 };

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Rumbo (yaw de three) desde un punto hacia otro. */
function yawTowards(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

export function createView(options: {
  map: ShooterMap;
  rules: ShooterRules;
  isHost: boolean;
  seat: number;
  seed: string;
}): ShooterView {
  const { map, rules, isHost, seat } = options;
  const n = MAX_PLAYERS;
  const spawn = map.spawns[Math.max(0, Math.min(n - 1, seat))] ?? { x: 0, z: 40 };

  const body: PlayerBody = {
    x: spawn.x,
    y: terrainHeight(map, spawn.x, spawn.z),
    z: spawn.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: yawTowards(spawn.x, spawn.z, map.landmark.x, map.landmark.z),
    pitch: 0,
    onGround: true,
  };

  const names: string[] = [];
  for (let i = 0; i < n; i++) names.push(`Jugador ${i + 1}`);

  // Sin eleccion, el color es el del asiento: diez asientos, diez colores.
  const skins = new Uint8Array(n);
  for (let i = 0; i < n; i++) skins[i] = i % n;

  const inputs: ShooterInput[] = [];
  for (let i = 0; i < INPUT_BUFFERS; i++) inputs.push(createInput());

  const pistol = weaponSpec(rules, 0);

  const view: ShooterView = {
    map,
    rules,
    isHost,
    seat,
    world: isHost ? createShooterWorld(map, rules) : null,
    rng: createRng(`${options.seed}:sim`),
    reducedMotion: false,
    hostPlaying: false,
    elapsed: 0,

    active: new Uint8Array(n),
    alive: new Uint8Array(n),
    hp: new Float32Array(n),
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    yaw: new Float32Array(n),
    pitch: new Float32Array(n),
    weapon: new Uint8Array(n),
    skin: skins,
    driving: new Int8Array(n).fill(-1),
    names,
    ownSkin: seat % n,
    ownName: names[seat] ?? "Jugador",
    hostName: "Proyector",

    carCount: Math.min(MAX_CARS, map.cars.length),
    carX: new Float32Array(MAX_CARS),
    carY: new Float32Array(MAX_CARS),
    carZ: new Float32Array(MAX_CARS),
    carYaw: new Float32Array(MAX_CARS),
    carSpeed: new Float32Array(MAX_CARS),
    carDriver: new Int8Array(MAX_CARS).fill(-1),

    chestOpened: 0,

    state: 0,
    timeS: 0,
    deployLeft: rules.deploySeconds,
    aliveCount: 0,
    winner: -1,
    ringPhase: 0,
    ringX: map.ringCenter.x,
    ringZ: map.ringCenter.z,
    ringRadius: 0,

    body,
    prediction: null,
    inputs,
    inputCursor: 0,
    camYaw: body.yaw,
    camPitch: 0,
    ownWeapon: 0,
    ownSpec: pistol,
    ammo: pistol.magazine,
    reloadLeft: 0,
    cooldown: 0,
    ownDriving: -1,
    interactQueued: false,
    reloadQueued: false,
    interactHint: HINT_NONE,
    chestsOpened: 0,
    playSfx: null,
    send: null,
    publish: null,

    snapshots: [createMutableSnapshot(), createMutableSnapshot()],
    snapshotCursor: 0,
    stateTimer: 0,
    firedSince: new Uint8Array(n),
    lastHitCode: 0,
    lastKillCode: 0,
    killCounter: 0,

    hitCodeSeen: 0,
    killCodeSeen: 0,
    chestsSeen: 0,
    firedTick: new Int32Array(n).fill(-1),

    spectating: false,
    placement: 0,
    kills: 0,
    damageDealt: 0,
    ownHp: HP_MAX,
    ownAlive: true,
    outsideRing: false,
    overAt: -1,

    hitMarkerAge: 0,
    hurtAge: 0,
    damageAge: 0,
    damageYaw: Number.NaN,
    shake: 0,
    recoil: 0,
    hitCount: 0,
    hurtCount: 0,
    feed: [],

    tracers: new Float32Array(TRACER_MAX * TRACER_STRIDE),
    tracerCursor: 0,
    sparks: new Float32Array(SPARK_MAX * SPARK_STRIDE),
    sparkCursor: 0,
    flashes: new Float32Array(n),
  };

  // Los autos arrancan donde dice el mapa, en los dos roles: hasta que llegue
  // estado, el celular los dibuja quietos en su lugar.
  for (let car = 0; car < view.carCount; car++) {
    const spot = map.cars[car];
    if (!spot) continue;
    view.carX[car] = spot.x;
    view.carZ[car] = spot.z;
    view.carY[car] = terrainHeight(map, spot.x, spot.z);
    view.carYaw[car] = spot.yaw;
  }

  if (!isHost) {
    /*
     * La prediccion pide una funcion pura, asi que cada paso devuelve un
     * cuerpo nuevo. Son diez numeros sesenta veces por segundo: el recolector
     * de la generacion joven ni se entera. La alternativa —mutar `state`—
     * corromperia el estado confirmado al re-simular.
     *
     * Manejando no se predice: el auto es del host, y el cuerpo lo sigue en
     * `applySampled`. Devolver el estado tal cual deja la cola de inputs
     * inerte hasta que se baje.
     */
    const prediction = createPrediction<PlayerBody, ShooterInput>(body, {
      dt: STEP,
      step: (state, input, dt) => {
        const next: PlayerBody = {
          x: state.x,
          y: state.y,
          z: state.z,
          vx: state.vx,
          vy: state.vy,
          vz: state.vz,
          yaw: state.yaw,
          pitch: state.pitch,
          onGround: state.onGround,
        };
        if (view.ownDriving < 0) simulateBody(next, input, dt, map, rules, view.state === 2);
        return next;
      },
    });
    (view as { prediction: Prediction<PlayerBody, ShooterInput> | null }).prediction = prediction;
    // El asiento local se dibuja desde el cuerpo predicho ya desde el primer
    // cuadro, antes de que llegue estado alguno.
    view.active[seat] = 1;
    view.alive[seat] = 1;
    view.hp[seat] = HP_MAX;
    copyBodyToArrays(view);
  }

  return view;
}

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

export type RosterEntry = { seat: number; name: string; bot: boolean };

/**
 * Arranca la partida en el host: los diez asientos entran, y los que tienen
 * una persona conectada se marcan como tales. El resto lo juega el bot del
 * mundo, y si alguien entra tarde toma ese cuerpo (ver `hostSetHuman`).
 */
export function hostStart(view: ShooterView, roster: Iterable<RosterEntry>): void {
  const world = view.world;
  if (!world) return;
  for (let seat = 0; seat < MAX_PLAYERS; seat++) activateSeat(world, seat);
  for (const player of roster) hostSetHuman(view, player.seat, !player.bot, player.name);
  view.state = 1;
  view.deployLeft = view.rules.deploySeconds;
  copyWorldToArrays(view);
}

export function hostSetHuman(view: ShooterView, seat: number, human: boolean, name: string): void {
  if (seat < 0 || seat >= MAX_PLAYERS) return;
  // El asiento 0 es el proyector: lo juega un bot salvo que la persona de la
  // PC tome el control (`setHostPlaying`), nunca un celular.
  if (seat === 0) {
    view.names[0] = view.hostPlaying ? view.ownName : "Bot 1";
    return;
  }
  if (view.world) markHuman(view.world, seat, human);
  view.names[seat] = human ? name : `Bot ${seat + 1}`;
}

/** Bit del escalar `S_ACTIVE` que dice que el proyector esta jugando. */
const HOST_PLAYING_BIT = 1 << 12;

/**
 * La persona de la PC toma (o suelta) el asiento 0.
 *
 * Al tomarlo, el bot que lo jugaba se apaga y el input pasa a venir del
 * teclado y el mouse; al soltarlo, el bot sigue desde donde quedo. Si el
 * asiento ya murio, se toma como espectador: no hay resurrecciones.
 */
export function setHostPlaying(view: ShooterView, playing: boolean): void {
  const world = view.world;
  if (!world || view.hostPlaying === playing) return;
  view.hostPlaying = playing;
  markHuman(world, 0, playing);
  view.names[0] = playing ? view.ownName : "Bot 1";
  if (playing) {
    world.skin[0] = view.ownSkin;
    view.camYaw = world.yaw[0] ?? 0;
    view.camPitch = 0;
    view.spectating = world.active[0] === 1 && world.alive[0] !== 1 && view.state >= 2;
    if (view.spectating) view.placement = world.placement[0] || world.aliveCount + 1;
    hostLocalMirror(view, world);
  } else {
    view.spectating = false;
    view.interactHint = HINT_NONE;
  }
}

function hostLocalInput(view: ShooterView, world: ShooterWorld, sticks: StickSample): void {
  view.camYaw -= sticks.lookX * LOOK_SENS;
  view.camPitch = clamp(view.camPitch - sticks.lookY * LOOK_SENS, -PITCH_LIMIT, PITCH_LIMIT);
  if (view.camYaw > Math.PI) view.camYaw -= Math.PI * 2;
  else if (view.camYaw < -Math.PI) view.camYaw += Math.PI * 2;
  const input = view.inputs[0];
  if (!input) return;
  input.mx = sticks.mx;
  input.my = sticks.my;
  input.yaw = view.camYaw;
  input.pitch = view.camPitch;
  input.fire = sticks.fire;
  input.jump = sticks.jump;
  input.interact = view.interactQueued;
  input.reload = view.reloadQueued;
  input.skin = view.ownSkin;
  view.interactQueued = false;
  view.reloadQueued = false;
  setInput(world, 0, input);
}

/** El asiento 0, del mundo a lo local: cuerpo, arma, vida, golpes. */
function hostLocalMirror(view: ShooterView, world: ShooterWorld): void {
  const body = view.body;
  body.x = world.x[0] ?? 0;
  body.y = world.y[0] ?? 0;
  body.z = world.z[0] ?? 0;
  body.vx = world.vx[0] ?? 0;
  body.vy = world.vy[0] ?? 0;
  body.vz = world.vz[0] ?? 0;
  body.yaw = world.yaw[0] ?? 0;
  body.pitch = world.pitch[0] ?? 0;
  body.onGround = world.onGround[0] === 1;

  view.ownHp = world.hp[0] ?? 0;
  view.ownAlive = world.active[0] === 1 && world.alive[0] === 1;
  setOwnWeapon(view, world.weapon[0] ?? 0);
  view.ammo = world.ammo[0] ?? 0;
  view.reloadLeft = world.reload[0] ?? 0;
  view.ownDriving = world.driving[0] ?? -1;
  if (world.fired[0] === 1) view.recoil = 1;
  view.kills = world.kills[0] ?? 0;
  view.damageDealt = world.damage[0] ?? 0;
  view.outsideRing = view.state >= 1 && view.ringRadius > 0 && ringDistance(world, body.x, body.z) > 0;
  if (world.fired[0] === 1) view.playSfx?.("squirt");

  if (!view.ownAlive && !view.spectating && view.state >= 2 && world.active[0] === 1) {
    view.spectating = true;
    view.placement = world.placement[0] || world.aliveCount + 1;
  }

  for (let i = 0; i < world.hitCount; i++) {
    const victim = world.hitVictim[i] ?? -1;
    const attacker = world.hitAttacker[i] ?? -1;
    if (victim === 0) {
      view.hurtAge = 1;
      view.damageAge = 1;
      view.hurtCount++;
      if (!view.reducedMotion) view.shake = Math.max(view.shake, 0.6);
      view.damageYaw =
        attacker >= 0 && attacker < MAX_PLAYERS
          ? yawTowards(body.x, body.z, world.x[attacker] ?? 0, world.z[attacker] ?? 0)
          : Number.NaN;
    }
    if (attacker === 0 && victim !== 0) {
      view.hitMarkerAge = 1;
      view.hitCount++;
    }
    if (victim === 0 || attacker === 0) view.playSfx?.("splash");
  }
  for (let i = 0; i < world.chestEventCount; i++) {
    if ((world.chestEventSeat[i] ?? -1) === 0) view.chestsOpened++;
  }
  view.interactHint = computeHint(view);
}

/** Un paso fijo del host. Simula, cosecha efectos y publica cuando toca. */
export function hostStep(view: ShooterView, dt: number, sticks: StickSample): void {
  const world = view.world;
  if (!world) return;
  if (view.hostPlaying && !view.spectating) hostLocalInput(view, world, sticks);
  else view.interactQueued = false;
  stepWorld(world, dt, view.rng);

  // Tiros: estela exacta, del canio al punto de impacto o al final del rayo.
  for (let i = 0; i < world.shotCount; i++) {
    const seat = world.shotSeat[i] ?? 0;
    spawnTracer(
      view,
      world.shotFrom[i * 3] ?? 0,
      world.shotFrom[i * 3 + 1] ?? 0,
      world.shotFrom[i * 3 + 2] ?? 0,
      world.shotTo[i * 3] ?? 0,
      world.shotTo[i * 3 + 1] ?? 0,
      world.shotTo[i * 3 + 2] ?? 0,
      seat,
    );
    view.flashes[seat] = 1;
    view.firedSince[seat] = 1;
  }
  for (let i = 0; i < world.hitCount; i++) {
    spawnSparks(
      view,
      world.hitPoint[i * 3] ?? 0,
      world.hitPoint[i * 3 + 1] ?? 0,
      world.hitPoint[i * 3 + 2] ?? 0,
      (world.hitHead[i] ?? 0) === 1 ? 10 : 6,
    );
    const victim = world.hitVictim[i] ?? 0;
    const attacker = world.hitAttacker[i] ?? -1;
    view.lastHitCode =
      (victim & 15) | ((attacker < 0 ? 15 : attacker & 15) << 4) | ((world.hitCounter & 255) << 8);
  }
  for (let i = 0; i < world.killCount; i++) {
    const victim = world.killVictim[i] ?? 0;
    const killer = world.killKiller[i] ?? -1;
    view.killCounter++;
    view.lastKillCode = encodeKill(victim, killer, view.killCounter);
    pushFeed(view, victim, killer);
  }
  for (let i = 0; i < world.chestEventCount; i++) {
    const chest = world.map.chests[world.chestEventIndex[i] ?? -1];
    if (chest) spawnSparks(view, chest.x, chest.y + 0.9, chest.z, 14);
  }

  copyWorldToArrays(view);
  if (view.hostPlaying) hostLocalMirror(view, world);

  if (view.state === 3 && view.overAt < 0) view.overAt = view.elapsed;

  // A 20 Hz, alternando dos snapshots: `broadcastState` se queda con la
  // referencia y la codifica despues, asi que el siguiente no puede pisarlo.
  view.stateTimer += dt;
  if (view.stateTimer >= STATE_STEP) {
    view.stateTimer -= STATE_STEP;
    if (view.stateTimer > STATE_STEP) view.stateTimer = 0;
    const snapshot = view.snapshots[view.snapshotCursor];
    view.snapshotCursor ^= 1;
    if (!snapshot) return;
    writeSnapshot(world, snapshot, view.lastKillCode);
    for (let seat = 0; seat < MAX_PLAYERS; seat++) {
      const entity = snapshot.entities[seat];
      if (entity && view.firedSince[seat] === 1) entity.flags |= FLAG_FIRED;
    }
    view.firedSince.fill(0);
    // El ultimo impacto se mantiene entre snapshots: con dos buffers que se
    // alternan, dejar el que escribio `writeSnapshot` haria parpadear el
    // codigo entre dos valores viejos y el cliente veria golpes fantasma.
    snapshot.scalars[S_LAST_HIT] = view.lastHitCode;
    // Los celulares nombran al asiento 0 segun quien lo juegue.
    if (view.hostPlaying) snapshot.scalars[S_ACTIVE] = (snapshot.scalars[S_ACTIVE] ?? 0) | HOST_PLAYING_BIT;
    view.publish?.(snapshot as NetSnapshot, world.tick);
  }
}

function copyWorldToArrays(view: ShooterView): void {
  const world = view.world;
  if (!world) return;
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    view.active[seat] = world.active[seat] ?? 0;
    view.alive[seat] = world.alive[seat] ?? 0;
    view.hp[seat] = world.hp[seat] ?? 0;
    view.x[seat] = world.x[seat] ?? 0;
    view.y[seat] = world.y[seat] ?? 0;
    view.z[seat] = world.z[seat] ?? 0;
    view.yaw[seat] = world.yaw[seat] ?? 0;
    view.pitch[seat] = world.pitch[seat] ?? 0;
    view.weapon[seat] = world.weapon[seat] ?? 0;
    view.skin[seat] = world.skin[seat] ?? seat;
    view.driving[seat] = world.driving[seat] ?? -1;
  }
  for (let car = 0; car < MAX_CARS; car++) {
    view.carX[car] = world.carX[car] ?? 0;
    view.carY[car] = world.carY[car] ?? 0;
    view.carZ[car] = world.carZ[car] ?? 0;
    view.carYaw[car] = world.carYaw[car] ?? 0;
    view.carSpeed[car] = world.carSpeed[car] ?? 0;
    view.carDriver[car] = world.carDriver[car] ?? -1;
  }
  view.chestOpened = world.chestOpened;
  view.state = world.phase === "deploy" ? 1 : world.phase === "playing" ? 2 : 3;
  view.timeS = Math.max(0, Math.floor(world.time - view.rules.deploySeconds));
  view.deployLeft = Math.ceil(world.deployLeft);
  view.aliveCount = world.aliveCount;
  view.winner = world.winner;
  view.ringPhase = world.ringPhase;
  view.ringX = world.ringX;
  view.ringZ = world.ringZ;
  view.ringRadius = world.ringRadius;
}

/* ------------------------------------------------------------------ */
/* Compartido                                                          */
/* ------------------------------------------------------------------ */

/** Cambia el arma local, renovando la especificacion solo si es otra. */
function setOwnWeapon(view: ShooterView, kind: number): void {
  if (kind === view.ownWeapon) return;
  view.ownWeapon = kind;
  view.ownSpec = weaponSpec(view.rules, kind);
  view.ammo = view.ownSpec.magazine;
  view.reloadLeft = 0;
  view.cooldown = 0;
}

/** Que puede hacer el jugador local ahora mismo con el boton de interactuar. */
function computeHint(view: ShooterView): number {
  if (!view.ownAlive || view.state !== 2 || view.spectating) return HINT_NONE;
  if (view.ownDriving >= 0) return HINT_EXIT_CAR;
  const x = view.body.x;
  const z = view.body.z;
  if (nearestClosedChest(view.map, view.chestOpened, x, z) >= 0) return HINT_CHEST;
  for (let car = 0; car < view.carCount; car++) {
    if ((view.carDriver[car] ?? -1) >= 0) continue;
    if (Math.hypot((view.carX[car] ?? 0) - x, (view.carZ[car] ?? 0) - z) < INTERACT_RADIUS) return HINT_ENTER_CAR;
  }
  return HINT_NONE;
}

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

/**
 * Un paso fijo del celular: mirar, moverse (predicho), disparar (simulado
 * localmente solo para el HUD y el arma en pantalla) y mandar el input.
 * Manejando, el mismo stick es volante y acelerador y viaja igual.
 */
export function clientStep(view: ShooterView, dt: number, sticks: StickSample): void {
  const prediction = view.prediction;
  if (!prediction) return;

  if (!view.spectating) {
    view.camYaw -= sticks.lookX * LOOK_SENS;
    view.camPitch = clamp(view.camPitch - sticks.lookY * LOOK_SENS, -PITCH_LIMIT, PITCH_LIMIT);
    // Normalizado para que el angulo nunca crezca sin tope: se cuantiza a 8
    // bits en el aire y el envoltorio de `atan2` lo espera en -PI..PI.
    if (view.camYaw > Math.PI) view.camYaw -= Math.PI * 2;
    else if (view.camYaw < -Math.PI) view.camYaw += Math.PI * 2;

    const input = view.inputs[view.inputCursor];
    view.inputCursor = (view.inputCursor + 1) % INPUT_BUFFERS;
    if (!input) return;
    input.mx = sticks.mx;
    input.my = sticks.my;
    input.yaw = view.camYaw;
    input.pitch = view.camPitch;
    input.fire = sticks.fire;
    input.jump = sticks.jump;
    input.interact = view.interactQueued;
    input.reload = view.reloadQueued;
    input.skin = view.ownSkin;
    view.interactQueued = false;
    const reloadNow = view.reloadQueued;
    view.reloadQueued = false;
    // El color propio se ve en el acto, sin esperar a que vuelva por red.
    view.skin[view.seat] = view.ownSkin;

    const sequence = prediction.predict(input);
    view.send?.(input, sequence);
    if (view.ownDriving < 0) copyPredicted(view, prediction.predicted);
    stepLocalWeapon(view, dt, input.fire, reloadNow);
  } else {
    view.interactQueued = false;
    view.reloadQueued = false;
  }

  view.outsideRing =
    view.state >= 1 &&
    view.ringRadius > 0 &&
    Math.hypot(view.body.x - view.ringX, view.body.z - view.ringZ) > view.ringRadius;
  view.interactHint = computeHint(view);
}

function copyPredicted(view: ShooterView, predicted: PlayerBody): void {
  const body = view.body;
  body.x = predicted.x;
  body.y = predicted.y;
  body.z = predicted.z;
  body.vx = predicted.vx;
  body.vy = predicted.vy;
  body.vz = predicted.vz;
  body.yaw = predicted.yaw;
  body.pitch = predicted.pitch;
  body.onGround = predicted.onGround;
  copyBodyToArrays(view);
}

function copyBodyToArrays(view: ShooterView): void {
  const seat = view.seat;
  view.x[seat] = view.body.x;
  view.y[seat] = view.body.y;
  view.z[seat] = view.body.z;
  view.yaw[seat] = view.body.yaw;
  view.pitch[seat] = view.body.pitch;
}

/**
 * El arma, del lado del celular. Es una copia de las reglas del host para
 * que el cargador, la recarga y el retroceso se sientan en el acto en vez de
 * 100 ms despues; si difiere en un tiro, el host tiene razon y no se nota.
 */
function stepLocalWeapon(view: ShooterView, dt: number, fire: boolean, reloadNow: boolean): void {
  const spec = view.ownSpec;
  if (view.cooldown > 0) view.cooldown -= dt;
  if (view.reloadLeft > 0) {
    view.reloadLeft -= dt;
    if (view.reloadLeft <= 0) {
      view.reloadLeft = 0;
      view.ammo = spec.magazine;
    }
    return;
  }
  // A mano, con el mismo criterio que el host: solo si falta agua.
  if (reloadNow && view.ammo < spec.magazine) {
    view.reloadLeft = spec.reloadS;
    return;
  }
  if (view.ammo <= 0) {
    view.reloadLeft = spec.reloadS;
    return;
  }
  if (!fire || view.cooldown > 0 || view.state !== 2 || !view.ownAlive || view.ownDriving >= 0) return;

  view.ammo--;
  view.cooldown = spec.fireIntervalS;
  view.recoil = 1;
  view.flashes[view.seat] = 1;
  view.playSfx?.("squirt");
  if (!view.reducedMotion) view.shake = Math.max(view.shake, 0.25);

  const body = view.body;
  lookDirection(view.camYaw, view.camPitch, dirScratch);
  const dx = dirScratch[0] ?? 0;
  const dy = dirScratch[1] ?? 0;
  const dz = dirScratch[2] ?? 0;
  // Nace un poco adelante y a la derecha del ojo, donde esta el arma dibujada.
  const rx = Math.cos(view.camYaw);
  const rz = -Math.sin(view.camYaw);
  const ox = body.x + dx * 0.7 + rx * 0.22;
  const oy = body.y + EYE_HEIGHT - 0.16 + dy * 0.7;
  const oz = body.z + dz * 0.7 + rz * 0.22;
  // El cliente no sabe donde pega: la estela llega hasta el alcance del arma.
  const reach = spec.maxRange;
  for (let ray = 0; ray < spec.rays; ray++) {
    const jx = spec.rays > 1 ? view.rng.range(-spec.cone, spec.cone) : 0;
    const jy = spec.rays > 1 ? view.rng.range(-spec.cone, spec.cone) * 0.7 : 0;
    spawnTracer(view, ox, oy, oz, ox + (dx + jx) * reach, oy + (dy + jy) * reach, oz + (dz + jx * 0.5) * reach, view.seat);
  }
}

const confirmedScratch: PlayerBody = {
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

/**
 * Llego estado autoritativo (crudo, no interpolado). Escalares, eventos, los
 * autos y la reconciliacion del cuerpo propio.
 */
export function clientOnState(view: ShooterView, state: NetSnapshot, ackedSequence: number): void {
  const s = state.scalars;
  const wasState = view.state;
  view.state = s[S_STATE] ?? 0;
  view.ringPhase = s[S_RING_PHASE] ?? 0;
  view.ringRadius = (s[S_RING_R] ?? 0) / 10;
  view.ringX = (s[S_RING_X] ?? 0) / 10;
  view.ringZ = (s[S_RING_Z] ?? 0) / 10;
  view.aliveCount = s[S_ALIVE] ?? 0;
  view.timeS = s[S_TIME] ?? 0;
  view.deployLeft = s[S_DEPLOY] ?? 0;
  view.winner = (s[S_WINNER] ?? 0) - 1;
  const activeMask = s[S_ACTIVE] ?? 0;
  // El asiento 0 lo juega el proyector o su bot; el nombre del proyector sale
  // del roster (`hostName`), que es lo que eligio la persona de esa PC.
  view.names[0] = (activeMask & HOST_PLAYING_BIT) !== 0 ? view.hostName : "Bot 1";

  if (view.state === 3 && view.overAt < 0) view.overAt = view.elapsed;
  // Partida nueva desde el host (reinicio): el celular vuelve a su aparicion.
  if (wasState === 3 && view.state < 3) resetLocal(view);

  const seat = view.seat;

  // Los cofres: los que se abrieron desde el ultimo estado salpican.
  const opened = s[S_CHESTS_OPENED] ?? 0;
  const fresh = opened & ~view.chestsSeen;
  if (fresh !== 0) {
    for (let i = 0; i < view.map.chests.length; i++) {
      if ((fresh & (1 << i)) === 0) continue;
      const chest = view.map.chests[i];
      if (chest) spawnSparks(view, chest.x, chest.y + 0.9, chest.z, 14);
    }
    view.chestsSeen = opened;
  }
  view.chestOpened = opened;

  // El arma propia: si el host dice otra, es que un cofre la dio.
  const weapon = snapshotWeapon(state, seat);
  if (weapon !== view.ownWeapon) {
    setOwnWeapon(view, weapon);
    view.chestsOpened++;
  }

  // Los autos, crudos: solo para saber si el propio esta arriba de uno.
  let driving = -1;
  for (const entity of state.entities) {
    if (!isCarEntity(entity)) continue;
    readCar(entity, carScratch);
    if (carScratch.driver === seat) driving = entity.id - 16;
  }
  const wasDriving = view.ownDriving;
  view.ownDriving = driving;

  let own: (typeof state.entities)[number] | undefined;
  for (const entity of state.entities) {
    if (entity.id === seat) {
      own = entity;
      break;
    }
  }
  if (own) {
    const active = (activeMask & (1 << seat)) !== 0;
    view.ownHp = entityHp(own);
    view.ownAlive = active && view.ownHp > 0;
    view.hp[seat] = view.ownHp;

    if (view.ownAlive && view.prediction) {
      readEntity(own, confirmedScratch);
      confirmedScratch.vx = 0;
      confirmedScratch.vz = 0;
      confirmedScratch.vy = driving >= 0 ? 0 : view.body.vy;
      const ground = groundHeight(view.map, confirmedScratch.x, confirmedScratch.z, confirmedScratch.y);
      confirmedScratch.onGround = confirmedScratch.y <= ground + 0.03;
      // El rumbo lo manda el celular, no el host: lo confirmado es la posicion.
      confirmedScratch.yaw = view.camYaw;
      confirmedScratch.pitch = view.camPitch;
      const confirmed: PlayerBody = { ...confirmedScratch };
      if (driving >= 0) {
        // Arriba del auto la cola de inputs es volante, no pasos: se descarta.
        view.prediction.reset(confirmed);
        copyPredicted(view, confirmed);
      } else if (wasDriving >= 0) {
        // Recien se bajo: el host lo puso al costado del auto. Desde ahi.
        view.prediction.reset(confirmed);
        copyPredicted(view, confirmed);
      } else {
        copyPredicted(view, view.prediction.reconcile(confirmed, ackedSequence));
      }
    } else if (!view.ownAlive && !view.spectating && view.state >= 2 && active) {
      // Muerto: se mira la partida desde arriba. El puesto es cuantos quedan
      // vivos mas uno, que es lo que el host escribio al matarlo.
      view.spectating = true;
      view.placement = view.aliveCount + 1;
      view.alive[seat] = 0;
    }
  }

  const hit = s[S_LAST_HIT] ?? 0;
  if (hit !== view.hitCodeSeen) {
    view.hitCodeSeen = hit;
    if (hit !== 0) {
      const victim = hit & 15;
      const attacker = (hit >> 4) & 15;
      if (victim === seat) {
        view.hurtAge = 1;
        view.damageAge = 1;
        view.hurtCount++;
        if (!view.reducedMotion) view.shake = Math.max(view.shake, 0.6);
        view.damageYaw = attacker < MAX_PLAYERS ? yawTo(view, state, attacker) : Number.NaN;
      }
      if (attacker === seat) {
        view.hitMarkerAge = 1;
        view.hitCount++;
        view.damageDealt += view.ownSpec.bodyDamage;
      }
      if (victim === seat || attacker === seat) view.playSfx?.("splash");
    }
  }

  const kill = s[S_LAST_KILL] ?? 0;
  if (kill !== view.killCodeSeen) {
    view.killCodeSeen = kill;
    if (kill !== 0) {
      const victim = kill & 15;
      const killer = (kill >> 4) & 15;
      pushFeed(view, victim, killer >= MAX_PLAYERS ? -1 : killer);
      if (killer === seat && victim !== seat) view.kills++;
    }
  }
}

function yawTo(view: ShooterView, state: NetSnapshot, attacker: number): number {
  for (const entity of state.entities) {
    if (entity.id !== attacker) continue;
    readEntity(entity, confirmedScratch);
    return yawTowards(view.body.x, view.body.z, confirmedScratch.x, confirmedScratch.z);
  }
  return Number.NaN;
}

function resetLocal(view: ShooterView): void {
  const spawn = view.map.spawns[view.seat] ?? { x: 0, z: 40 };
  const body = view.body;
  body.x = spawn.x;
  body.y = terrainHeight(view.map, spawn.x, spawn.z);
  body.z = spawn.z;
  body.vx = 0;
  body.vy = 0;
  body.vz = 0;
  body.yaw = yawTowards(spawn.x, spawn.z, view.map.landmark.x, view.map.landmark.z);
  body.pitch = 0;
  body.onGround = true;
  view.camYaw = body.yaw;
  view.camPitch = 0;
  view.prediction?.reset({ ...body });
  view.spectating = false;
  view.placement = 0;
  view.kills = 0;
  view.damageDealt = 0;
  view.ownWeapon = -1;
  setOwnWeapon(view, 0);
  view.ownDriving = -1;
  view.chestsOpened = 0;
  view.chestsSeen = 0;
  view.chestOpened = 0;
  view.overAt = -1;
  view.feed.length = 0;
  view.alive[view.seat] = 1;
  copyBodyToArrays(view);
}

/**
 * Lo que el celular dibuja de LOS DEMAS y de los autos: el estado interpolado
 * que entrega `useGameNet`, ~100 ms atras. Corre por cuadro, no por paso.
 */
export function applySampled(view: ShooterView, sampled: NetSnapshot | null): void {
  if (!sampled) return;
  const activeMask = sampled.scalars[S_ACTIVE] ?? 0;
  for (let seat = 0; seat < MAX_PLAYERS; seat++) view.driving[seat] = -1;

  for (const entity of sampled.entities) {
    if (isCarEntity(entity)) {
      const car = entity.id - 16;
      if (car < 0 || car >= MAX_CARS) continue;
      readCar(entity, carScratch);
      view.carX[car] = carScratch.x;
      view.carY[car] = carScratch.y;
      view.carZ[car] = carScratch.z;
      view.carYaw[car] = carScratch.yaw;
      view.carSpeed[car] = carScratch.speed;
      view.carDriver[car] = carScratch.driver;
      if (carScratch.driver >= 0 && carScratch.driver < MAX_PLAYERS) view.driving[carScratch.driver] = car;
      continue;
    }
    const seat = entity.id;
    if (seat < 0 || seat >= MAX_PLAYERS) continue;
    const active = (activeMask & (1 << seat)) !== 0;
    const hp = entityHp(entity);
    view.weapon[seat] = snapshotWeapon(sampled, seat);
    if (seat === view.seat) {
      // El propio se dibuja predicho, no interpolado: solo la vida viene de
      // aca, y el color sale de lo elegido, que ya se ve sin esperar la red.
      view.active[seat] = 1;
      view.skin[seat] = view.ownSkin;
      continue;
    }
    view.skin[seat] = snapshotSkin(sampled, seat);
    view.active[seat] = active ? 1 : 0;
    view.hp[seat] = hp;
    view.alive[seat] = active && hp > 0 ? 1 : 0;
    readEntity(entity, confirmedScratch);
    view.x[seat] = confirmedScratch.x;
    view.y[seat] = confirmedScratch.y;
    view.z[seat] = confirmedScratch.z;
    view.yaw[seat] = confirmedScratch.yaw;
    view.pitch[seat] = confirmedScratch.pitch;

    // Disparo ajeno: un destello y una estela en la direccion en que mira.
    // Se deduplica por tick porque el mismo snapshot se muestrea tres cuadros.
    if (entityFired(entity) && view.firedTick[seat] !== sampled.tick) {
      view.firedTick[seat] = sampled.tick;
      view.flashes[seat] = 1;
      lookDirection(confirmedScratch.yaw, confirmedScratch.pitch, dirScratch);
      const dx = dirScratch[0] ?? 0;
      const dy = dirScratch[1] ?? 0;
      const dz = dirScratch[2] ?? 0;
      const rx = Math.cos(confirmedScratch.yaw);
      const rz = -Math.sin(confirmedScratch.yaw);
      const ox = confirmedScratch.x + dx * 0.9 + rx * 0.3;
      const oy = confirmedScratch.y + EYE_HEIGHT - 0.3 + dy * 0.9;
      const oz = confirmedScratch.z + dz * 0.9 + rz * 0.3;
      const reach = weaponSpecCached(view, view.weapon[seat] ?? 0).maxRange;
      spawnTracer(view, ox, oy, oz, ox + dx * reach, oy + dy * reach, oz + dz * reach, seat);
    }
  }

  // Manejando, el cuerpo propio va donde va el auto interpolado.
  if (view.ownDriving >= 0) {
    const car = view.ownDriving;
    view.body.x = view.carX[car] ?? 0;
    view.body.y = (view.carY[car] ?? 0) + 0.3;
    view.body.z = view.carZ[car] ?? 0;
    view.body.yaw = view.camYaw;
    view.body.pitch = view.camPitch;
    copyBodyToArrays(view);
  }
}

/** Alcance por tipo de arma, para las estelas ajenas. Sin asignar por cuadro. */
const reachByKind: WeaponSpec[] = [];
function weaponSpecCached(view: ShooterView, kind: number): WeaponSpec {
  let spec = reachByKind[kind];
  if (!spec || spec.kind !== kind) {
    spec = weaponSpec(view.rules, kind);
    reachByKind[kind] = spec;
  }
  return spec;
}

/* ------------------------------------------------------------------ */
/* Por cuadro                                                          */
/* ------------------------------------------------------------------ */

/** Lo que corre por cuadro de render, en los dos roles: efectos y muestreo. */
export function frameView(view: ShooterView, dt: number, sampled: NetSnapshot | null): void {
  view.elapsed += dt;
  if (!view.isHost) applySampled(view, sampled);
  ageEffects(view, dt);
}

function ageEffects(view: ShooterView, dt: number): void {
  const tracers = view.tracers;
  for (let i = 0; i < TRACER_MAX; i++) {
    const at = i * TRACER_STRIDE + 6;
    const age = tracers[at] ?? 0;
    if (age > 0) tracers[at] = age - dt / TRACER_LIFE_S;
  }
  const sparks = view.sparks;
  for (let i = 0; i < SPARK_MAX; i++) {
    const base = i * SPARK_STRIDE;
    const age = sparks[base + 6] ?? 0;
    if (age <= 0) continue;
    sparks[base] = (sparks[base] ?? 0) + (sparks[base + 3] ?? 0) * dt;
    sparks[base + 1] = (sparks[base + 1] ?? 0) + (sparks[base + 4] ?? 0) * dt;
    sparks[base + 2] = (sparks[base + 2] ?? 0) + (sparks[base + 5] ?? 0) * dt;
    sparks[base + 4] = (sparks[base + 4] ?? 0) - SPARK_GRAVITY * dt;
    sparks[base + 6] = age - dt / SPARK_LIFE_S;
  }
  const flashes = view.flashes;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const age = flashes[i] ?? 0;
    if (age > 0) flashes[i] = age - dt / FLASH_LIFE_S;
  }
  view.hitMarkerAge = Math.max(0, view.hitMarkerAge - dt * 4);
  view.hurtAge = Math.max(0, view.hurtAge - dt * 2.5);
  view.damageAge = Math.max(0, view.damageAge - dt * 0.8);
  view.shake = Math.max(0, view.shake - dt * 3);
  view.recoil = Math.max(0, view.recoil - dt * 9);
  for (let i = view.feed.length - 1; i >= 0; i--) {
    const entry = view.feed[i];
    if (!entry) continue;
    entry.age += dt;
    if (entry.age > FEED_LIFE_S) view.feed.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ */
/* Efectos                                                             */
/* ------------------------------------------------------------------ */

function spawnTracer(
  view: ShooterView,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  seat: number,
): void {
  const base = view.tracerCursor * TRACER_STRIDE;
  view.tracerCursor = (view.tracerCursor + 1) % TRACER_MAX;
  const t = view.tracers;
  t[base] = x0;
  t[base + 1] = y0;
  t[base + 2] = z0;
  t[base + 3] = x1;
  t[base + 4] = y1;
  t[base + 5] = z1;
  t[base + 6] = 1;
  t[base + 7] = seat;
}

function spawnSparks(view: ShooterView, x: number, y: number, z: number, count: number): void {
  const rng = view.rng;
  for (let i = 0; i < count; i++) {
    const base = view.sparkCursor * SPARK_STRIDE;
    view.sparkCursor = (view.sparkCursor + 1) % SPARK_MAX;
    const s = view.sparks;
    const angle = rng.range(0, Math.PI * 2);
    const speed = rng.range(2, 6);
    s[base] = x;
    s[base + 1] = y;
    s[base + 2] = z;
    s[base + 3] = Math.cos(angle) * speed;
    s[base + 4] = rng.range(2, 7);
    s[base + 5] = Math.sin(angle) * speed;
    s[base + 6] = 1;
  }
}

function pushFeed(view: ShooterView, victim: number, killer: number): void {
  view.feed.push({ victim, killer, age: 0 });
  while (view.feed.length > FEED_MAX) view.feed.shift();
}

/** Nombre corto para el feed y el marcador. */
export function seatName(view: ShooterView, seat: number): string {
  if (seat < 0 || seat >= MAX_PLAYERS) return "el anillo";
  return view.names[seat] ?? `Jugador ${seat + 1}`;
}
