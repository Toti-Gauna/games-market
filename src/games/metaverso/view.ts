import type { PaletteToken } from "@/core/engine/palette";
import type { NetSnapshot } from "@/core/net/snapshot";
import { createPrediction, type Prediction } from "@/core/net/prediction";
import {
  EYE_HEIGHT,
  MAX_AVATARS,
  MAX_STATIONS,
  S_ACTIVE_COUNT,
  S_OCCUPANCY,
  S_TIME,
  createMutableSnapshot,
  createSpaceWorld,
  entityActive,
  entityMoving,
  joinAvatar,
  leaveAvatar,
  moveAvatar,
  nearestStation,
  readAvatar,
  setAvatarInput,
  stepSpace,
  writeSpaceSnapshot,
  zoneAt,
  type AvatarBody,
  type AvatarInput,
  type MutableSnapshot,
  type SpaceLayout,
  type SpaceWorld,
} from "./space";

/**
 * X5 · Espacio — el estado tal como se dibuja.
 *
 * Mismo reparto que en el shooter y por las mismas razones: la simulacion
 * (`space.ts`) corre solo en el host, la red la arma `MetaversoGame` afuera
 * del canvas, y la escena adentro del canvas lee de aca. Nada de esto pasa
 * por React: son arrays que se mutan a 60 Hz.
 *
 * Es mucho mas simple que el shooter porque no hay nada que ganar: sin
 * disparos, sin eventos, sin compensacion de latencia. Lo unico que se
 * predice es el propio avatar, para que caminar responda al dedo y no a los
 * 150 ms del estado de vuelta. El estado va a 10 Hz —la guia lo fija asi—,
 * y a esa cadencia el buffer de interpolacion pide mas retraso que a 20.
 */

export { EYE_HEIGHT };

/** El color de cada zona, en el orden de `ZONE_NAMES`. */
export const ZONE_TOKENS: readonly PaletteToken[] = [
  "--sn-cyan-400",
  "--sn-magenta-400",
  "--sn-violet-400",
  "--sn-success",
  "--sn-warn",
  "--sn-violet-300",
];

/** Un color por avatar. Diez y se repiten: mas no se distinguen. */
export const AVATAR_TOKENS: readonly PaletteToken[] = [
  "--sn-cyan-400",
  "--sn-magenta-400",
  "--sn-violet-300",
  "--sn-success",
  "--sn-warn",
  "--sn-cyan-300",
  "--sn-magenta-300",
  "--sn-violet-400",
  "--sn-cyan-500",
  "--sn-magenta-500",
];

/**
 * Etiquetas en DOM: una por avatar y una por estacion. La escena proyecta
 * cada una a pantalla por cuadro y escribe aca; el overlay las posiciona.
 * Sin `Html` de drei a proposito: importar drei arrastra su copia vieja de
 * three-mesh-bvh y sus tipos chocan con la del proyecto.
 */
export const LABEL_COUNT = MAX_AVATARS + MAX_STATIONS;
export const STATION_LABEL_OFFSET = MAX_AVATARS;

export const VIEW_DELAY_MS = 160;
const STATE_STEP = 1 / 10;
const STEP = 1 / 60;
const LOOK_SENS = 0.0042;
const INPUT_BUFFERS = 4;

export type StickSample = { mx: number; my: number; lookX: number; lookY: number };

export type SpaceView = {
  readonly layout: SpaceLayout;
  readonly isHost: boolean;
  readonly seat: number;
  readonly world: SpaceWorld | null;
  showNames: boolean;
  reducedMotion: boolean;
  /** El proyector camina como asiento 0 con teclado y mouse, sin red. */
  hostPlaying: boolean;
  elapsed: number;

  /* Lo que se dibuja, por asiento. */
  readonly active: Uint8Array;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly yaw: Float32Array;
  readonly moving: Uint8Array;
  readonly names: string[];

  /* Etiquetas proyectadas: fraccion de pantalla 0..1, escala y visibilidad. */
  readonly labelX: Float32Array;
  readonly labelY: Float32Array;
  readonly labelScale: Float32Array;
  readonly labelOn: Uint8Array;

  /* El espacio. */
  readonly occupancy: Int32Array;
  activeCount: number;
  timeS: number;

  /* El avatar local (cliente). */
  readonly body: AvatarBody;
  readonly prediction: Prediction<AvatarBody, AvatarInput> | null;
  readonly inputs: AvatarInput[];
  inputCursor: number;
  camYaw: number;
  send: ((input: AvatarInput, sequence: number) => void) | null;
  publish: ((snapshot: NetSnapshot, tick: number) => void) | null;
  readonly snapshots: MutableSnapshot[];
  snapshotCursor: number;
  stateTimer: number;

  /* Lo que el celular sabe de si mismo. */
  zone: number;
  /** Estacion en cuyo radio esta, o -1. */
  atStation: number;
  /** Estacion cuyo contenido esta abierto en pantalla, o -1. */
  stationOpen: number;
  /** Mascara de estaciones visitadas. Va al outcome. */
  visitedMask: number;
  distance: number;
};

function yawTowards(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

export function createSpaceView(options: {
  layout: SpaceLayout;
  isHost: boolean;
  seat: number;
  showNames: boolean;
}): SpaceView {
  const { layout, isHost, seat } = options;
  const n = MAX_AVATARS;
  const spawn = layout.spawn;
  const body: AvatarBody = { x: spawn.x, z: spawn.z, yaw: yawTowards(spawn.x, spawn.z, 0, 0) };

  const names: string[] = [];
  for (let i = 0; i < n; i++) names.push(`Persona ${i + 1}`);
  const inputs: AvatarInput[] = [];
  for (let i = 0; i < INPUT_BUFFERS; i++) inputs.push({ mx: 0, my: 0, yaw: 0 });

  const view: SpaceView = {
    layout,
    isHost,
    seat,
    world: isHost ? createSpaceWorld(layout) : null,
    showNames: options.showNames,
    reducedMotion: false,
    hostPlaying: false,
    elapsed: 0,

    active: new Uint8Array(n),
    x: new Float32Array(n),
    z: new Float32Array(n),
    yaw: new Float32Array(n),
    moving: new Uint8Array(n),
    names,

    labelX: new Float32Array(LABEL_COUNT),
    labelY: new Float32Array(LABEL_COUNT),
    labelScale: new Float32Array(LABEL_COUNT),
    labelOn: new Uint8Array(LABEL_COUNT),

    occupancy: new Int32Array(MAX_STATIONS),
    activeCount: 0,
    timeS: 0,

    body,
    prediction: null,
    inputs,
    inputCursor: 0,
    camYaw: body.yaw,
    send: null,
    publish: null,
    snapshots: [createMutableSnapshot(), createMutableSnapshot()],
    snapshotCursor: 0,
    stateTimer: 0,

    zone: zoneAt(layout, spawn.x, spawn.z),
    atStation: -1,
    stationOpen: -1,
    visitedMask: 0,
    distance: 0,
  };

  if (!isHost) {
    const prediction = createPrediction<AvatarBody, AvatarInput>(body, {
      dt: STEP,
      step: (state, input, dt) => {
        const next: AvatarBody = { x: state.x, z: state.z, yaw: state.yaw };
        moveAvatar(layout, next, input, dt);
        return next;
      },
    });
    (view as { prediction: Prediction<AvatarBody, AvatarInput> | null }).prediction = prediction;
    view.active[seat] = 1;
    copyBodyToArrays(view);
  }
  return view;
}

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

export function hostJoin(view: SpaceView, seat: number, name: string): void {
  if (seat < 0 || seat >= MAX_AVATARS) return;
  view.names[seat] = name;
  if (view.world) joinAvatar(view.world, seat);
}

export function hostLeave(view: SpaceView, seat: number): void {
  if (view.world) leaveAvatar(view.world, seat);
}

export function hostInput(view: SpaceView, seat: number, input: AvatarInput): void {
  if (view.world) setAvatarInput(view.world, seat, input);
}

export function hostStep(view: SpaceView, dt: number, sticks: StickSample): void {
  const world = view.world;
  if (!world) return;
  if (view.hostPlaying) {
    integrateLook(view, sticks.lookX);
    const input = view.inputs[0];
    if (input) {
      input.mx = sticks.mx;
      input.my = sticks.my;
      input.yaw = view.camYaw;
      setAvatarInput(world, 0, input);
    }
  }
  stepSpace(world, dt);
  for (let seat = 0; seat < MAX_AVATARS; seat++) {
    view.active[seat] = world.active[seat] ?? 0;
    view.x[seat] = world.x[seat] ?? 0;
    view.z[seat] = world.z[seat] ?? 0;
    view.yaw[seat] = world.yaw[seat] ?? 0;
    view.moving[seat] = world.moving[seat] ?? 0;
  }
  for (let i = 0; i < MAX_STATIONS; i++) view.occupancy[i] = world.occupancy[i] ?? 0;
  view.activeCount = world.activeCount;
  view.timeS = Math.floor(world.time);

  // El asiento 0, del mundo a lo local: es lo que mira la camara del proyector
  // cuando la persona de la PC camina.
  if (view.hostPlaying) {
    view.body.x = world.x[0] ?? 0;
    view.body.z = world.z[0] ?? 0;
    view.body.yaw = world.yaw[0] ?? 0;
    view.zone = world.zone[0] ?? 0;
    trackStation(view, world.station[0] ?? -1);
    view.visitedMask = world.visited[0] ?? 0;
    view.distance = world.distance[0] ?? 0;
  }

  view.stateTimer += dt;
  if (view.stateTimer >= STATE_STEP) {
    view.stateTimer -= STATE_STEP;
    if (view.stateTimer > STATE_STEP) view.stateTimer = 0;
    const snapshot = view.snapshots[view.snapshotCursor];
    view.snapshotCursor ^= 1;
    if (!snapshot) return;
    writeSpaceSnapshot(world, snapshot);
    view.publish?.(snapshot as NetSnapshot, world.tick);
  }
}

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

export function clientStep(view: SpaceView, dt: number, sticks: StickSample): void {
  const prediction = view.prediction;
  if (!prediction) return;

  integrateLook(view, sticks.lookX);

  const input = view.inputs[view.inputCursor];
  view.inputCursor = (view.inputCursor + 1) % INPUT_BUFFERS;
  if (!input) return;
  input.mx = sticks.mx;
  input.my = sticks.my;
  input.yaw = view.camYaw;

  const beforeX = view.body.x;
  const beforeZ = view.body.z;
  const sequence = prediction.predict(input);
  view.send?.(input, sequence);
  copyPredicted(view, prediction.predicted);
  const moved = Math.hypot(view.body.x - beforeX, view.body.z - beforeZ);
  view.distance += moved;
  view.moving[view.seat] = moved > 1e-4 ? 1 : 0;

  view.zone = zoneAt(view.layout, view.body.x, view.body.z);
  trackStation(view, nearestStation(view.layout, view.body.x, view.body.z));
  void dt;
}

/**
 * La persona de la PC entra (o sale) como asiento 0.
 *
 * Al entrar aparece en la entrada como cualquiera; al salir su avatar
 * desaparece, porque un avatar sin nadie es un maniqui en medio del lobby.
 */
export function setHostPlaying(view: SpaceView, playing: boolean): void {
  const world = view.world;
  if (!world || view.hostPlaying === playing) return;
  view.hostPlaying = playing;
  if (playing) {
    joinAvatar(world, 0);
    view.names[0] = "Proyector";
    view.camYaw = world.yaw[0] ?? 0;
    view.body.x = world.x[0] ?? 0;
    view.body.z = world.z[0] ?? 0;
    view.body.yaw = view.camYaw;
  } else {
    leaveAvatar(world, 0);
    view.atStation = -1;
    view.stationOpen = -1;
  }
}

function integrateLook(view: SpaceView, lookX: number): void {
  view.camYaw -= lookX * LOOK_SENS;
  if (view.camYaw > Math.PI) view.camYaw -= Math.PI * 2;
  else if (view.camYaw < -Math.PI) view.camYaw += Math.PI * 2;
}

/**
 * Entrar a una estacion abre el contenido; salir lo cierra. Cerrarlo a mano
 * y quedarse adentro no lo vuelve a abrir: eso seria un panel que no se
 * puede cerrar.
 */
function trackStation(view: SpaceView, station: number): void {
  if (station === view.atStation) return;
  view.atStation = station;
  view.stationOpen = station;
  if (station >= 0) view.visitedMask |= 1 << station;
}

function copyPredicted(view: SpaceView, predicted: AvatarBody): void {
  view.body.x = predicted.x;
  view.body.z = predicted.z;
  view.body.yaw = predicted.yaw;
  copyBodyToArrays(view);
}

function copyBodyToArrays(view: SpaceView): void {
  view.x[view.seat] = view.body.x;
  view.z[view.seat] = view.body.z;
  view.yaw[view.seat] = view.body.yaw;
}

const avatarScratch: AvatarBody = { x: 0, z: 0, yaw: 0 };

export function clientOnState(view: SpaceView, state: NetSnapshot, ackedSequence: number): void {
  const s = state.scalars;
  for (let i = 0; i < MAX_STATIONS; i++) view.occupancy[i] = s[S_OCCUPANCY + i] ?? 0;
  view.activeCount = s[S_ACTIVE_COUNT] ?? 0;
  view.timeS = s[S_TIME] ?? 0;

  if (!view.prediction) return;
  for (const entity of state.entities) {
    if (entity.id !== view.seat) continue;
    // Hasta que el host lo sume, el celular camina solo por su cuenta.
    if (!entityActive(entity)) return;
    readAvatar(entity, avatarScratch);
    const confirmed: AvatarBody = { x: avatarScratch.x, z: avatarScratch.z, yaw: view.camYaw };
    copyPredicted(view, view.prediction.reconcile(confirmed, ackedSequence));
    return;
  }
}

export function applySampled(view: SpaceView, sampled: NetSnapshot | null): void {
  if (!sampled) return;
  for (const entity of sampled.entities) {
    const seat = entity.id;
    if (seat < 0 || seat >= MAX_AVATARS || seat === view.seat) continue;
    const active = entityActive(entity);
    view.active[seat] = active ? 1 : 0;
    if (!active) continue;
    readAvatar(entity, avatarScratch);
    view.x[seat] = avatarScratch.x;
    view.z[seat] = avatarScratch.z;
    view.yaw[seat] = avatarScratch.yaw;
    view.moving[seat] = entityMoving(entity) ? 1 : 0;
  }
}

/** Por cuadro, en los dos roles. */
export function frameView(view: SpaceView, dt: number, sampled: NetSnapshot | null): void {
  view.elapsed += dt;
  if (!view.isHost) applySampled(view, sampled);
}

/** Cuantas estaciones visito el asiento local. */
export function visitedCount(view: SpaceView): number {
  let count = 0;
  for (let i = 0; i < MAX_STATIONS; i++) if (view.visitedMask & (1 << i)) count++;
  return count;
}

export function visitedIds(view: SpaceView): number[] {
  const out: number[] = [];
  for (let i = 0; i < MAX_STATIONS; i++) if (view.visitedMask & (1 << i)) out.push(i);
  return out;
}
