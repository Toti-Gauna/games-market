import type { Rng } from "@/core/engine/rng";

/**
 * X4 · Bubble Shooter Game — el mapa, generado por codigo.
 *
 * Todo sale de la semilla y **nada se transfiere por red**: el host manda un
 * string y los diez clientes construyen el mismo mundo. Es lo que hace viable
 * un battle royale 3D en celulares sin descargar geometria.
 *
 * Es logica pura a proposito. Un mapa que se genera distinto en dos aparatos
 * no se nota al mirarlo: se nota cuando alguien se cubre detras de una roca
 * que en la pantalla del rival no existe, y eso es imposible de depurar sin
 * poder reproducirlo en un test.
 *
 * Lo que hay en el mundo, y por que:
 *
 * - **200 x 200 unidades.** Mundo abierto: con un auto para cruzarlo y un
 *   anillo que obliga al encuentro, el tamano no dispersa la partida.
 * - **Montanias, no plataformas.** Son las estructuras del mapa: cobertura
 *   grande, altura tactica y referencia visual. Cada una es una campana
 *   suave con posicion, radio y altura propios; el terreno es la suma.
 * - **Rocas repartidas con ruido.** La cobertura chica de siempre, apoyada
 *   sobre el terreno. Sin ellas el pasto abierto no tendria donde pelear de
 *   cerca.
 * - **Cofres con armas.** El botin se decide ACA, con la semilla: host y
 *   clientes saben que hay en cada cofre sin transmitirlo. Por red viaja
 *   solo si ya se abrio.
 * - **Autos.** Pocos, en llano, lejos de las apariciones.
 * - **El centro del anillo cambia por partida.**
 */

/** Lado del mapa, en unidades. 1 unidad ~ 1 metro. */
export const MAP_SIZE = 200;
const HALF = MAP_SIZE / 2;

/** Margen contra las paredes: nada se genera pegado al borde. */
const EDGE_MARGIN = 6;

/** Cuantos jugadores entran. Define cuantos puntos de aparicion hacen falta. */
export const MAX_PLAYERS = 10;

/**
 * Separacion minima entre dos apariciones. Por encima del alcance de combate
 * de los bots (34): nadie aparece ya adentro de un duelo.
 */
export const MIN_SPAWN_DISTANCE = 45;

export const MIN_MOUNTAINS = 5;
export const MAX_MOUNTAINS = 9;
/**
 * Fraccion del radio que es roca dura: un auto no entra, una persona solo si
 * la pendiente la deja. Afuera de eso es falda transitable.
 */
export const MOUNTAIN_CORE = 0.55;

/** Autos en el mapa y capacidad maxima (lo que reserva el snapshot). */
export const CAR_COUNT = 3;
export const MAX_CARS = 4;

/** Cofres en el mapa y tope de la mascara de bits que viaja por red. */
export const CHEST_COUNT = 18;
export const MAX_CHESTS = 32;

/* Las armas, como numeros: el mapa las reparte y `logic.ts` les pone reglas. */
export const WEAPON_PISTOLA = 0;
export const WEAPON_ASPERSOR = 1;
export const WEAPON_MANGUERA = 2;
export const WEAPON_CANON = 3;
export const WEAPON_KINDS = 4;

/** Caja alineada a los ejes: centro y tamano. Es lo que dibuja y lo que choca. */
export type MapBox = {
  x: number;
  y: number;
  z: number;
  /** Tamanos completos, no medios. */
  w: number;
  h: number;
  d: number;
};

export type Vec2 = { x: number; z: number };

/** Una montania: campana suave centrada en (x, z). */
export type Mountain = {
  x: number;
  z: number;
  radius: number;
  height: number;
};

export type Chest = {
  x: number;
  z: number;
  /** Altura del terreno en ese punto, precalculada. */
  y: number;
  /** Que arma da. Se decide con la semilla, nunca al abrirlo. */
  weapon: number;
};

export type CarSpawn = { x: number; z: number; yaw: number };

export type ShooterMap = {
  size: number;
  /** Semilla entera de la ondulacion del pasto. */
  noiseSeed: number;
  /** Rocas: bloques de cobertura instanciados. */
  cover: readonly MapBox[];
  mountains: readonly Mountain[];
  /** La montania mas alta, cerca del centro: la referencia para orientarse. */
  landmark: Mountain;
  /** Adonde cierra el anillo en esta partida. */
  ringCenter: Vec2;
  /** Diez puntos separados, en el orden en que se reparten. */
  spawns: readonly Vec2[];
  chests: readonly Chest[];
  cars: readonly CarSpawn[];
};

/** Los tamanos de roca. Cuatro y no ocho: mas variedad no se lee. */
const COVER_SIZES: readonly { w: number; h: number; d: number }[] = [
  { w: 2, h: 2, d: 2 },
  { w: 4, h: 3, d: 2 },
  { w: 6, h: 4, d: 3 },
  { w: 9, h: 5, d: 4 },
];

export const COVER_MIN = 55;
export const COVER_MAX = 80;

/** Pendiente maxima sobre la que se apoya una roca, un cofre o un auto. */
const COVER_MAX_SLOPE = 0.35;
const CAR_MAX_SLOPE = 0.15;

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Si dos cajas se pisan en planta, con un margen de aire. */
function overlaps(a: MapBox, b: MapBox, margin: number): boolean {
  return (
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + margin &&
    Math.abs(a.z - b.z) < (a.d + b.d) / 2 + margin
  );
}

/* ------------------------------------------------------------------ */
/* El terreno como funcion                                             */
/* ------------------------------------------------------------------ */

/**
 * Hash entero determinista para el ruido de valor. Sin `Math.random`, sin
 * tablas: dos aparatos con la misma semilla dan el mismo pasto.
 */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Ruido de valor en 0..1 con interpolacion suave. */
function valueNoise(x: number, z: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sz;
}

/** La ondulacion del pasto entre montanias: +-0.5, dos octavos. */
function rolling(seed: number, x: number, z: number): number {
  return (valueNoise(x, z, 26, seed) - 0.5) * 0.7 + (valueNoise(x, z, 9, seed + 7) - 0.5) * 0.3;
}

/** Lo que aporta una montania en un punto: campana suave, 0 fuera del radio. */
export function mountainHeight(mountain: Mountain, x: number, z: number): number {
  const d = Math.hypot(x - mountain.x, z - mountain.z);
  if (d >= mountain.radius) return 0;
  const t = 1 - d / mountain.radius;
  return mountain.height * t * t * (3 - 2 * t);
}

/**
 * Altura del terreno en un punto. Es LA funcion del mundo: la consultan el
 * movimiento, el auto, el hitscan, la generacion y la escena.
 */
export function terrainHeight(map: ShooterMap, x: number, z: number): number {
  let h = 0;
  for (const mountain of map.mountains) h += mountainHeight(mountain, x, z);
  return h + rolling(map.noiseSeed, x, z);
}

/** Pendiente local (|gradiente|) por diferencias finitas. 1 = 45 grados. */
export function terrainSlope(map: ShooterMap, x: number, z: number): number {
  const e = 0.6;
  const hx = terrainHeight(map, x + e, z) - terrainHeight(map, x - e, z);
  const hz = terrainHeight(map, x, z + e) - terrainHeight(map, x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}

/** Si el punto cae dentro de la fraccion `core` del radio de alguna montania. */
export function insideMountain(map: ShooterMap, x: number, z: number, core: number): boolean {
  for (const mountain of map.mountains) {
    if (Math.hypot(x - mountain.x, z - mountain.z) < mountain.radius * core) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Generacion                                                          */
/* ------------------------------------------------------------------ */

/**
 * Arma el mapa completo.
 *
 * El orden importa y consume el PRNG en un orden fijo: montanias, apariciones,
 * rocas, cofres, autos, anillo. Cambiarlo cambia todos los mapas.
 */
export function createShooterMap(rng: Rng): ShooterMap {
  const noiseSeed = rng.int(1, 1_000_000_000);
  const mountains = placeMountains(rng);
  const landmark = mountains[0] ?? { x: 0, z: 0, radius: 30, height: 20 };

  // Un mapa parcial alcanza para consultar el terreno mientras se genera.
  const partial: ShooterMap = {
    size: MAP_SIZE,
    noiseSeed,
    cover: [],
    mountains,
    landmark,
    ringCenter: { x: 0, z: 0 },
    spawns: [],
    chests: [],
    cars: [],
  };

  const spawns = placeSpawns(rng, partial);
  const cover = placeCover(rng, partial, spawns);
  partial.cover = cover;
  const chests = placeChests(rng, partial, spawns);
  const cars = placeCars(rng, partial, spawns, chests);

  // Lejos del borde a proposito: un anillo que cierra contra una pared deja
  // media zona final fuera del mapa.
  const ringAngle = rng.range(0, Math.PI * 2);
  const ringRadius = rng.range(0, 40);
  const ringCenter: Vec2 = {
    x: Math.cos(ringAngle) * ringRadius,
    z: Math.sin(ringAngle) * ringRadius,
  };

  return { size: MAP_SIZE, noiseSeed, cover, mountains, landmark, ringCenter, spawns, chests, cars };
}

/**
 * Entre 5 y 9 montanias. La primera es la mas alta y queda cerca del centro:
 * es el hito para orientarse. Las demas se reparten por rechazo, con
 * separacion proporcional a los radios.
 *
 * La relacion alto/radio decide si se sube o no: por debajo de ~0.7 la
 * ladera entera es caminable; por encima aparece una franja de acantilado
 * (ver `MAX_WALK_SLOPE` en logic.ts). Se mezclan a proposito: cerros que se
 * suben y penias que solo tapan.
 */
function placeMountains(rng: Rng): Mountain[] {
  const count = rng.int(MIN_MOUNTAINS, MAX_MOUNTAINS);
  const mountains: Mountain[] = [];

  const landmarkRadius = rng.range(26, 32);
  mountains.push({
    x: rng.range(-14, 14),
    z: rng.range(-14, 14),
    radius: landmarkRadius,
    height: landmarkRadius * rng.range(0.62, 0.72),
  });

  let attempts = 0;
  let separation = 0.9;
  while (mountains.length < count) {
    if (attempts++ > 3000) {
      separation *= 0.9;
      attempts = 0;
    }
    const radius = rng.range(14, 26);
    const ratio = rng.range(0.45, 1.0);
    const limit = HALF - EDGE_MARGIN - radius;
    const landmarkHeight = mountains[0]?.height ?? 20;
    const candidate: Mountain = {
      x: rng.range(-limit, limit),
      z: rng.range(-limit, limit),
      radius,
      // Ninguna le gana en altura al hito: es la referencia para orientarse.
      height: Math.min(radius * ratio, landmarkHeight - 1),
    };
    let ok = true;
    for (const placed of mountains) {
      if (distance(candidate, placed) < (candidate.radius + placed.radius) * separation) {
        ok = false;
        break;
      }
    }
    if (ok) mountains.push(candidate);
  }
  return mountains;
}

/**
 * Diez puntos separados por al menos `MIN_SPAWN_DISTANCE`, en pasto llano.
 *
 * Muestreo por rechazo con un tope de intentos. Si se agotan se relaja la
 * distancia en vez de fallar: un mapa jugable con dos apariciones algo cerca
 * es mejor que ningun mapa.
 */
function placeSpawns(rng: Rng, map: ShooterMap): Vec2[] {
  const spawns: Vec2[] = [];
  const radius = HALF - EDGE_MARGIN - 2;
  let minDistance = MIN_SPAWN_DISTANCE;
  let attempts = 0;

  while (spawns.length < MAX_PLAYERS) {
    if (attempts++ > 4000) {
      minDistance *= 0.85;
      attempts = 0;
    }
    const angle = rng.range(0, Math.PI * 2);
    // Raiz para repartir parejo en area: sin ella se amontonan en el centro.
    const r = Math.sqrt(rng.next()) * radius;
    const candidate: Vec2 = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };

    // Nadie aparece en una ladera: se aparece en el llano y se sube despues.
    if (insideMountain(map, candidate.x, candidate.z, 0.95)) continue;
    if (spawns.some((spawn) => distance(spawn, candidate) < minDistance)) continue;
    spawns.push(candidate);
  }

  return spawns;
}

/**
 * Las rocas, esquivando todo lo demas y apoyadas en el terreno.
 *
 * Deja libre un radio alrededor de cada aparicion y no se sube a laderas
 * empinadas: una caja en pendiente flota de un lado y se entierra del otro.
 */
function placeCover(rng: Rng, map: ShooterMap, spawns: readonly Vec2[]): MapBox[] {
  const target = rng.int(COVER_MIN, COVER_MAX);
  const cover: MapBox[] = [];
  const limit = HALF - EDGE_MARGIN;
  let attempts = 0;

  while (cover.length < target && attempts < 9000) {
    attempts++;
    const size = rng.pick(COVER_SIZES);
    const x = rng.range(-limit, limit);
    const z = rng.range(-limit, limit);
    if (terrainSlope(map, x, z) > COVER_MAX_SLOPE) continue;
    if (insideMountain(map, x, z, MOUNTAIN_CORE)) continue;
    // Apenas hundida: la base queda enterrada y no se ve el filo flotando.
    const candidate: MapBox = { x, y: terrainHeight(map, x, z) + size.h / 2 - 0.25, z, ...size };

    if (spawns.some((spawn) => distance(spawn, candidate) < 6)) continue;
    if (cover.some((placed) => overlaps(candidate, placed, 1.5))) continue;

    cover.push(candidate);
  }

  return cover;
}

/**
 * Los cofres. La mayoria cerca de una montania —es donde vale la pena ir—,
 * el resto sueltos en el llano. Que arma dan se decide aca.
 */
function placeChests(rng: Rng, map: ShooterMap, spawns: readonly Vec2[]): Chest[] {
  const chests: Chest[] = [];
  const limit = HALF - EDGE_MARGIN;
  const footprint: MapBox = { x: 0, y: 0, z: 0, w: 1.4, h: 1, d: 1 };
  let attempts = 0;

  while (chests.length < CHEST_COUNT && attempts < 9000) {
    attempts++;
    let x: number;
    let z: number;
    if (rng.chance(0.6)) {
      const mountain = rng.pick(map.mountains);
      const angle = rng.range(0, Math.PI * 2);
      const d = mountain.radius * rng.range(0.85, 1.5);
      x = mountain.x + Math.cos(angle) * d;
      z = mountain.z + Math.sin(angle) * d;
    } else {
      x = rng.range(-limit, limit);
      z = rng.range(-limit, limit);
    }
    if (Math.abs(x) > limit || Math.abs(z) > limit) continue;
    if (terrainSlope(map, x, z) > 0.3) continue;
    if (insideMountain(map, x, z, MOUNTAIN_CORE)) continue;
    footprint.x = x;
    footprint.z = z;
    if (spawns.some((spawn) => distance(spawn, footprint) < 6)) continue;
    if (map.cover.some((box) => overlaps(footprint, box, 1.2))) continue;
    if (chests.some((chest) => distance(chest, footprint) < 6)) continue;

    // Reparto del botin: las armas de cerca abundan, el canion es raro.
    const roll = rng.next();
    const weapon = roll < 0.42 ? WEAPON_ASPERSOR : roll < 0.84 ? WEAPON_MANGUERA : WEAPON_CANON;
    chests.push({ x, z, y: terrainHeight(map, x, z), weapon });
  }

  return chests;
}

/** Los autos: en llano, lejos de todo, separados entre si. */
function placeCars(rng: Rng, map: ShooterMap, spawns: readonly Vec2[], chests: readonly Chest[]): CarSpawn[] {
  const cars: CarSpawn[] = [];
  const limit = HALF - EDGE_MARGIN - 6;
  const footprint: MapBox = { x: 0, y: 0, z: 0, w: 4, h: 1, d: 4 };
  let attempts = 0;
  let spacing = 40;

  while (cars.length < CAR_COUNT && attempts < 9000) {
    attempts++;
    if (attempts % 3000 === 0) spacing *= 0.75;
    const x = rng.range(-limit, limit);
    const z = rng.range(-limit, limit);
    if (terrainSlope(map, x, z) > CAR_MAX_SLOPE) continue;
    if (insideMountain(map, x, z, 0.95)) continue;
    footprint.x = x;
    footprint.z = z;
    if (spawns.some((spawn) => distance(spawn, footprint) < 8)) continue;
    if (map.cover.some((box) => overlaps(footprint, box, 3))) continue;
    if (chests.some((chest) => distance(chest, footprint) < 4)) continue;
    if (cars.some((car) => distance(car, footprint) < spacing)) continue;
    cars.push({ x, z, yaw: rng.range(0, Math.PI * 2) });
  }

  return cars;
}
