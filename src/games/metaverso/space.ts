import type { Rng } from "@/core/engine/rng";
import type { NetEntity, NetSnapshot, QuantConfig } from "@/core/net/snapshot";

/**
 * X5 · Espacio — el lugar, como logica pura.
 *
 * Sin React, sin three y sin red: se testea sola. Aca vive todo lo que decide
 * como es el espacio y como se camina por el: la planta generada por semilla,
 * las paredes contra las que se choca, las estaciones y a que distancia se
 * activan, y el paso de la simulacion que corre el proyector.
 *
 * `moveAvatar` es la MISMA funcion que corre cada celular para predecir su
 * propio avatar. Es lo que hace que la reconciliacion no salte.
 *
 * Decisiones que vienen de la guia, y por que:
 *
 * - **Una sola planta, sin desniveles.** Los desniveles multiplican los
 *   problemas de camara, colision y orientacion, y no aportan nada a un
 *   espacio para charlar.
 * - **Los avatares se atraviesan entre si.** Un espacio social donde la gente
 *   se bloquea es un espacio donde la gente se traba en las puertas.
 * - **Cada zona tiene un color.** Es lo que permite decir "nos vemos en la
 *   zona violeta" sin coordenadas.
 * - **Estaciones en las paredes, con radio de activacion.** Acercarse muestra
 *   el contenido; alejarse lo cierra. Cuanta gente hay en cada una es la
 *   metrica que le interesa a quien organiza.
 */

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

export const SPACE_SIZE = 60;
const HALF = SPACE_SIZE / 2;

export const WALL_HEIGHT = 3.4;
export const WALL_THICKNESS = 0.6;
/** Ancho de una puerta. Generoso: por acá pasa gente que no mira por donde va. */
export const DOOR_WIDTH = 4.4;

export const AVATAR_RADIUS = 0.35;
export const AVATAR_HEIGHT = 1.7;
export const EYE_HEIGHT = 1.55;
export const AVATAR_SPEED = 3.5;

/** Tope de la sala. El snapshot reserva una entidad por asiento. */
export const MAX_AVATARS = 30;
/** Los mas cercanos que se dibujan. Mas que esto en un telefono es tirones. */
export const RENDER_AVATARS = 20;

export const STATION_RADIUS = 3.4;
export const MAX_STATIONS = 8;
export const MAX_ZONES = 6;

/** Separacion tras el empuje: sin esto el cuerpo queda vibrando en la pared. */
const SKIN = 0.01;

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type Zone = {
  id: number;
  col: number;
  row: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  cx: number;
  cz: number;
  /** Indice de color, 0..5. La escena lo traduce a un token de la paleta. */
  color: number;
  name: string;
};

/** Caja alineada a los ejes: centro y tamano completo. */
export type Wall = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  /** Zona a la que pertenece el color de su franja. -1 = perimetro. */
  zone: number;
};

export type StationContent = { title: string; body: string };

export type Station = {
  id: number;
  zone: number;
  x: number;
  z: number;
  /** Hacia donde mira el panel: la normal que entra a la sala. */
  yaw: number;
  radius: number;
  title: string;
  body: string;
};

export type Door = { x: number; z: number; /** true si el hueco corta una pared vertical (paralela a z). */ vertical: boolean };

export type SpaceLayout = {
  size: number;
  cols: number;
  rows: number;
  zones: readonly Zone[];
  walls: readonly Wall[];
  doors: readonly Door[];
  stations: readonly Station[];
  spawn: { x: number; z: number };
};

/** Nombres de las zonas por color, en el orden de `ZONE_TOKENS` de la escena. */
export const ZONE_NAMES: readonly string[] = ["cian", "magenta", "violeta", "verde", "ámbar", "lila"];

/* ------------------------------------------------------------------ */
/* Generacion                                                          */
/* ------------------------------------------------------------------ */

/**
 * Arma la planta. Todo sale de la semilla: dos celulares con el mismo
 * `config.seed` construyen el mismo lugar sin transferir geometria.
 *
 * Orden de consumo del PRNG fijo: primero la grilla, despues las puertas por
 * particion y al final las estaciones. Cambiarlo rompe la reproducibilidad.
 */
export function createSpace(rng: Rng, content: readonly StationContent[]): SpaceLayout {
  // 2 x 2 o 3 x 2: cuatro o seis zonas, que es lo que la guia pide.
  const cols = rng.chance(0.5) ? 3 : 2;
  const rows = 2;
  const cellW = SPACE_SIZE / cols;
  const cellD = SPACE_SIZE / rows;

  // Los colores se reparten barajados: que la zona de entrada no sea siempre
  // cian es lo que hace que dos eventos no se vean iguales.
  const palette = rng.shuffle([0, 1, 2, 3, 4, 5]);

  const zones: Zone[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const id = zones.length;
      const x0 = -HALF + col * cellW;
      const z0 = -HALF + row * cellD;
      const color = palette[id % palette.length] ?? 0;
      zones.push({
        id,
        col,
        row,
        x0,
        z0,
        x1: x0 + cellW,
        z1: z0 + cellD,
        cx: x0 + cellW / 2,
        cz: z0 + cellD / 2,
        color,
        name: ZONE_NAMES[color] ?? "zona",
      });
    }
  }

  const walls: Wall[] = [];
  const doors: Door[] = [];
  const wallY = WALL_HEIGHT / 2;

  // Perimetro: cuatro paredes solidas. Del espacio no se sale.
  walls.push({ x: 0, y: wallY, z: -HALF, w: SPACE_SIZE + WALL_THICKNESS, h: WALL_HEIGHT, d: WALL_THICKNESS, zone: -1 });
  walls.push({ x: 0, y: wallY, z: HALF, w: SPACE_SIZE + WALL_THICKNESS, h: WALL_HEIGHT, d: WALL_THICKNESS, zone: -1 });
  walls.push({ x: -HALF, y: wallY, z: 0, w: WALL_THICKNESS, h: WALL_HEIGHT, d: SPACE_SIZE, zone: -1 });
  walls.push({ x: HALF, y: wallY, z: 0, w: WALL_THICKNESS, h: WALL_HEIGHT, d: SPACE_SIZE, zone: -1 });

  /*
   * Particiones interiores con una puerta cada una. La puerta nunca va en los
   * extremos: una puerta pegada a la esquina es un pasillo ciego.
   */
  for (let col = 1; col < cols; col++) {
    const x = -HALF + col * cellW;
    for (let row = 0; row < rows; row++) {
      const z0 = -HALF + row * cellD;
      const door = z0 + rng.range(cellD * 0.3, cellD * 0.7);
      const zone = row * cols + col;
      pushSplitWall(walls, { vertical: true, at: x, from: z0, to: z0 + cellD, door, zone });
      doors.push({ x, z: door, vertical: true });
    }
  }
  for (let row = 1; row < rows; row++) {
    const z = -HALF + row * cellD;
    for (let col = 0; col < cols; col++) {
      const x0 = -HALF + col * cellW;
      const door = x0 + rng.range(cellW * 0.3, cellW * 0.7);
      const zone = row * cols + col;
      pushSplitWall(walls, { vertical: false, at: z, from: x0, to: x0 + cellW, door, zone });
      doors.push({ x: door, z, vertical: false });
    }
  }

  const stations = placeStations(rng, zones, cols, rows, content);

  // Se entra por la primera zona, en su centro: nadie aparece contra una pared.
  const first = zones[0];
  const spawn = first ? { x: first.cx, z: first.cz } : { x: 0, z: 0 };

  return { size: SPACE_SIZE, cols, rows, zones, walls, doors, stations, spawn };
}

type SplitWall = {
  vertical: boolean;
  /** Coordenada fija de la pared (x si es vertical, z si no). */
  at: number;
  from: number;
  to: number;
  /** Centro del hueco, sobre el eje libre. */
  door: number;
  zone: number;
};

/** Una pared con un hueco: dos cajas, una a cada lado de la puerta. */
function pushSplitWall(walls: Wall[], spec: SplitWall): void {
  const y = WALL_HEIGHT / 2;
  const a0 = spec.from;
  const a1 = spec.door - DOOR_WIDTH / 2;
  const b0 = spec.door + DOOR_WIDTH / 2;
  const b1 = spec.to;
  const segments: Array<[number, number]> = [
    [a0, a1],
    [b0, b1],
  ];
  for (const [start, end] of segments) {
    const length = end - start;
    if (length <= 0.01) continue;
    const center = (start + end) / 2;
    if (spec.vertical) {
      walls.push({ x: spec.at, y, z: center, w: WALL_THICKNESS, h: WALL_HEIGHT, d: length, zone: spec.zone });
    } else {
      walls.push({ x: center, y, z: spec.at, w: length, h: WALL_HEIGHT, d: WALL_THICKNESS, zone: spec.zone });
    }
  }
}

/**
 * Las estaciones, una por zona sobre una pared del perimetro, hasta agotar el
 * contenido o llegar a ocho. Sin contenido no hay estaciones, y entonces es
 * un lobby: la guia es honesta sobre eso y aca no se inventa nada.
 */
function placeStations(
  rng: Rng,
  zones: readonly Zone[],
  cols: number,
  rows: number,
  content: readonly StationContent[],
): Station[] {
  const stations: Station[] = [];
  const total = Math.min(MAX_STATIONS, content.length);
  if (total === 0) return stations;

  const inset = WALL_THICKNESS / 2 + 0.35;
  for (let i = 0; i < total; i++) {
    const zone = zones[i % zones.length];
    const item = content[i];
    if (!zone || !item) continue;

    // Que paredes del perimetro toca esta zona. Todas tocan al menos una.
    const sides: Array<"north" | "south" | "west" | "east"> = [];
    if (zone.row === 0) sides.push("north");
    if (zone.row === rows - 1) sides.push("south");
    if (zone.col === 0) sides.push("west");
    if (zone.col === cols - 1) sides.push("east");
    const side = rng.pick(sides);

    // A lo largo de la pared, lejos de las esquinas y de la puerta de al lado.
    const t = rng.range(0.3, 0.7);
    let x = 0;
    let z = 0;
    let yaw = 0;
    if (side === "north") {
      x = zone.x0 + (zone.x1 - zone.x0) * t;
      z = zone.z0 + inset;
      yaw = Math.PI; // mira hacia +z
    } else if (side === "south") {
      x = zone.x0 + (zone.x1 - zone.x0) * t;
      z = zone.z1 - inset;
      yaw = 0; // mira hacia -z
    } else if (side === "west") {
      x = zone.x0 + inset;
      z = zone.z0 + (zone.z1 - zone.z0) * t;
      yaw = -Math.PI / 2; // mira hacia +x
    } else {
      x = zone.x1 - inset;
      z = zone.z0 + (zone.z1 - zone.z0) * t;
      yaw = Math.PI / 2; // mira hacia -x
    }

    stations.push({
      id: i,
      zone: zone.id,
      x,
      z,
      yaw,
      radius: STATION_RADIUS,
      title: item.title,
      body: item.body,
    });
  }
  return stations;
}

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

export function zoneAt(layout: SpaceLayout, x: number, z: number): number {
  const cellW = layout.size / layout.cols;
  const cellD = layout.size / layout.rows;
  const col = Math.min(layout.cols - 1, Math.max(0, Math.floor((x + HALF) / cellW)));
  const row = Math.min(layout.rows - 1, Math.max(0, Math.floor((z + HALF) / cellD)));
  return row * layout.cols + col;
}

/** La estacion dentro de cuyo radio esta el punto, o -1. La mas cercana si hay dos. */
export function nearestStation(layout: SpaceLayout, x: number, z: number): number {
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const station of layout.stations) {
    const d = Math.hypot(station.x - x, station.z - z);
    if (d <= station.radius && d < bestDist) {
      best = station.id;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Que tan cerca de una pared esta un punto, 0..1, dentro de `reach`.
 *
 * Es la oclusion ambiental horneada: el piso se oscurece contra las paredes y
 * la sensacion de volumen sale gratis, sin una sola sombra dinamica. Corre al
 * armar el nivel, nunca por cuadro.
 */
export function wallProximity(layout: SpaceLayout, x: number, z: number, reach: number): number {
  let nearest = reach;
  for (const wall of layout.walls) {
    const dx = Math.max(0, Math.abs(x - wall.x) - wall.w / 2);
    const dz = Math.max(0, Math.abs(z - wall.z) - wall.d / 2);
    const d = Math.hypot(dx, dz);
    if (d < nearest) nearest = d;
  }
  return 1 - nearest / reach;
}

/* ------------------------------------------------------------------ */
/* Movimiento: la funcion que comparten host y cliente                 */
/* ------------------------------------------------------------------ */

export type AvatarBody = { x: number; z: number; yaw: number };

export type AvatarInput = { mx: number; my: number; yaw: number };

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clampAxis(value: number): number {
  return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
}

/**
 * Un paso de un avatar. **Muta `body`.** Sin inercia: en un espacio para
 * charlar, la aceleracion se siente como que el avatar no obedece.
 *
 * Adelante es (-sin yaw, -cos yaw), la convencion de camara de three.
 */
export function moveAvatar(layout: SpaceLayout, body: AvatarBody, input: AvatarInput, dt: number): void {
  if (Number.isFinite(input.yaw)) body.yaw = input.yaw;
  const mx = clampAxis(input.mx);
  const my = clampAxis(input.my);
  const length = Math.hypot(mx, my);
  const scale = length > 1 ? 1 / length : 1;
  const sin = Math.sin(body.yaw);
  const cos = Math.cos(body.yaw);
  body.x += (-sin * my + cos * mx) * scale * AVATAR_SPEED * dt;
  body.z += (-cos * my - sin * mx) * scale * AVATAR_SPEED * dt;

  // Dos pasadas: salir de una pared puede meter el cuerpo en la de al lado,
  // que en una esquina pasa siempre.
  for (let pass = 0; pass < 2; pass++) {
    let touched = false;
    for (const wall of layout.walls) touched = pushOut(body, wall) || touched;
    if (!touched) break;
  }
  const limit = HALF - WALL_THICKNESS / 2 - AVATAR_RADIUS;
  body.x = clamp(body.x, -limit, limit);
  body.z = clamp(body.z, -limit, limit);
}

/** Empuja un circulo fuera de una caja, en planta. Devuelve si hubo contacto. */
function pushOut(body: AvatarBody, wall: Wall): boolean {
  const halfW = wall.w / 2 + AVATAR_RADIUS;
  const halfD = wall.d / 2 + AVATAR_RADIUS;
  const dx = body.x - wall.x;
  const dz = body.z - wall.z;
  if (Math.abs(dx) >= halfW || Math.abs(dz) >= halfD) return false;
  const penX = halfW - Math.abs(dx);
  const penZ = halfD - Math.abs(dz);
  if (penX < penZ) body.x = wall.x + (dx < 0 ? -halfW - SKIN : halfW + SKIN);
  else body.z = wall.z + (dz < 0 ? -halfD - SKIN : halfD + SKIN);
  return true;
}

/* ------------------------------------------------------------------ */
/* El mundo del host                                                   */
/* ------------------------------------------------------------------ */

export type SpaceWorld = {
  layout: SpaceLayout;
  tick: number;
  time: number;
  active: Uint8Array;
  x: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  /** 1 si se movio en el ultimo paso. Para el balanceo al caminar. */
  moving: Uint8Array;
  zone: Uint8Array;
  /** Estacion en la que esta cada uno, o -1. */
  station: Int8Array;
  /** Mascara de estaciones visitadas por asiento. Es lo que va al outcome. */
  visited: Uint32Array;
  distance: Float32Array;
  /** Segundos por zona y asiento: `seat * MAX_ZONES + zone`. */
  zoneTime: Float32Array;
  inMx: Float32Array;
  inMy: Float32Array;
  inYaw: Float32Array;
  /** Cuantos hay en cada estacion ahora mismo. */
  occupancy: Int32Array;
  activeCount: number;
};

export function createSpaceWorld(layout: SpaceLayout): SpaceWorld {
  const n = MAX_AVATARS;
  const world: SpaceWorld = {
    layout,
    tick: 0,
    time: 0,
    active: new Uint8Array(n),
    x: new Float32Array(n),
    z: new Float32Array(n),
    yaw: new Float32Array(n),
    moving: new Uint8Array(n),
    zone: new Uint8Array(n),
    station: new Int8Array(n).fill(-1),
    visited: new Uint32Array(n),
    distance: new Float32Array(n),
    zoneTime: new Float32Array(n * MAX_ZONES),
    inMx: new Float32Array(n),
    inMy: new Float32Array(n),
    inYaw: new Float32Array(n),
    occupancy: new Int32Array(MAX_STATIONS),
    activeCount: 0,
  };
  for (let seat = 0; seat < n; seat++) {
    world.x[seat] = layout.spawn.x;
    world.z[seat] = layout.spawn.z;
  }
  return world;
}

/** Entra alguien: aparece en la zona de entrada, mirando al centro del espacio. */
export function joinAvatar(world: SpaceWorld, seat: number): void {
  if (seat < 0 || seat >= MAX_AVATARS || world.active[seat] === 1) return;
  world.active[seat] = 1;
  world.activeCount++;
  const spawn = world.layout.spawn;
  world.x[seat] = spawn.x;
  world.z[seat] = spawn.z;
  world.yaw[seat] = Math.atan2(-(0 - spawn.x), -(0 - spawn.z));
  world.inYaw[seat] = world.yaw[seat] ?? 0;
  world.inMx[seat] = 0;
  world.inMy[seat] = 0;
  world.station[seat] = -1;
  world.zone[seat] = zoneAt(world.layout, spawn.x, spawn.z);
}

/** Se fue: su avatar deja de existir. Sin bots, sin pausas. */
export function leaveAvatar(world: SpaceWorld, seat: number): void {
  if (seat < 0 || seat >= MAX_AVATARS || world.active[seat] !== 1) return;
  world.active[seat] = 0;
  world.activeCount--;
  world.moving[seat] = 0;
  world.station[seat] = -1;
}

/** Lo que pidio un celular, saneado aca. */
export function setAvatarInput(world: SpaceWorld, seat: number, input: AvatarInput): void {
  if (seat < 0 || seat >= MAX_AVATARS) return;
  world.inMx[seat] = clampAxis(input.mx);
  world.inMy[seat] = clampAxis(input.my);
  if (Number.isFinite(input.yaw)) world.inYaw[seat] = input.yaw;
}

const bodyScratch: AvatarBody = { x: 0, z: 0, yaw: 0 };
const inputScratch: AvatarInput = { mx: 0, my: 0, yaw: 0 };

/** Un paso del espacio entero. Es la unica funcion que mueve algo en el host. */
export function stepSpace(world: SpaceWorld, dt: number): void {
  world.tick++;
  world.time += dt;
  world.occupancy.fill(0);

  for (let seat = 0; seat < MAX_AVATARS; seat++) {
    if (world.active[seat] !== 1) continue;
    const beforeX = world.x[seat] ?? 0;
    const beforeZ = world.z[seat] ?? 0;

    bodyScratch.x = beforeX;
    bodyScratch.z = beforeZ;
    bodyScratch.yaw = world.yaw[seat] ?? 0;
    inputScratch.mx = world.inMx[seat] ?? 0;
    inputScratch.my = world.inMy[seat] ?? 0;
    inputScratch.yaw = world.inYaw[seat] ?? 0;
    moveAvatar(world.layout, bodyScratch, inputScratch, dt);

    world.x[seat] = bodyScratch.x;
    world.z[seat] = bodyScratch.z;
    world.yaw[seat] = bodyScratch.yaw;

    const moved = Math.hypot(bodyScratch.x - beforeX, bodyScratch.z - beforeZ);
    world.moving[seat] = moved > 1e-4 ? 1 : 0;
    world.distance[seat] = (world.distance[seat] ?? 0) + moved;

    const zone = zoneAt(world.layout, bodyScratch.x, bodyScratch.z);
    world.zone[seat] = zone;
    const zoneIndex = seat * MAX_ZONES + zone;
    world.zoneTime[zoneIndex] = (world.zoneTime[zoneIndex] ?? 0) + dt;

    const station = nearestStation(world.layout, bodyScratch.x, bodyScratch.z);
    world.station[seat] = station;
    if (station >= 0) {
      world.visited[seat] = (world.visited[seat] ?? 0) | (1 << station);
      world.occupancy[station] = (world.occupancy[station] ?? 0) + 1;
    }
  }
}

/** Las estaciones visitadas por un asiento, como ids. */
export function visitedStations(world: SpaceWorld, seat: number): number[] {
  const mask = world.visited[seat] ?? 0;
  const out: number[] = [];
  for (let i = 0; i < MAX_STATIONS; i++) if (mask & (1 << i)) out.push(i);
  return out;
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

/** El espacio mide 60: con posicion x10 entra en +-1024 con 3 mm de paso. */
export const POS_SCALE = 10;

export const SPACE_QUANT: QuantConfig = {
  posMin: -1024,
  posMax: 1024,
  velMin: -4096,
  velMax: 4096,
};

export const ENTITY_COUNT = MAX_AVATARS;
/** Ocupacion de cada estacion, y despues los enteros sueltos. */
export const SCALAR_COUNT = MAX_STATIONS + 2;
export const S_OCCUPANCY = 0;
export const S_ACTIVE_COUNT = MAX_STATIONS;
export const S_TIME = MAX_STATIONS + 1;

/** `flags`: bits 0-2 zona, bit 3 se mueve, bit 4 en una estacion, bit 5 activo. */
export const FLAG_MOVING = 1 << 3;
export const FLAG_AT_STATION = 1 << 4;
export const FLAG_ACTIVE = 1 << 5;

export type MutableSnapshot = { tick: number; entities: NetEntity[]; scalars: number[] };

export function createMutableSnapshot(): MutableSnapshot {
  const entities: NetEntity[] = new Array(ENTITY_COUNT);
  for (let i = 0; i < ENTITY_COUNT; i++) {
    entities[i] = { id: i, x: 0, y: 0, vx: 0, vy: 0, angle: 0, flags: 0 };
  }
  return { tick: 0, entities, scalars: new Array<number>(SCALAR_COUNT).fill(0) };
}

export function writeSpaceSnapshot(world: SpaceWorld, out: MutableSnapshot): void {
  out.tick = world.tick;
  for (let seat = 0; seat < ENTITY_COUNT; seat++) {
    const entity = out.entities[seat];
    if (!entity) continue;
    entity.id = seat;
    entity.x = (world.x[seat] ?? 0) * POS_SCALE;
    entity.y = (world.z[seat] ?? 0) * POS_SCALE;
    entity.vx = 0;
    entity.vy = 0;
    entity.angle = world.yaw[seat] ?? 0;
    entity.flags =
      ((world.zone[seat] ?? 0) & 7) |
      ((world.moving[seat] ?? 0) === 1 ? FLAG_MOVING : 0) |
      ((world.station[seat] ?? -1) >= 0 ? FLAG_AT_STATION : 0) |
      ((world.active[seat] ?? 0) === 1 ? FLAG_ACTIVE : 0);
  }
  for (let i = 0; i < MAX_STATIONS; i++) out.scalars[S_OCCUPANCY + i] = world.occupancy[i] ?? 0;
  out.scalars[S_ACTIVE_COUNT] = world.activeCount;
  out.scalars[S_TIME] = Math.floor(world.time);
}

export function readAvatar(entity: NetEntity, out: AvatarBody): void {
  out.x = entity.x / POS_SCALE;
  out.z = entity.y / POS_SCALE;
  out.yaw = entity.angle;
}

export function entityActive(entity: NetEntity): boolean {
  return (entity.flags & FLAG_ACTIVE) !== 0;
}

export function entityMoving(entity: NetEntity): boolean {
  return (entity.flags & FLAG_MOVING) !== 0;
}

export function entityZone(entity: NetEntity): number {
  return entity.flags & 7;
}

export function snapshotOccupancy(snapshot: NetSnapshot, station: number): number {
  return snapshot.scalars[S_OCCUPANCY + station] ?? 0;
}
