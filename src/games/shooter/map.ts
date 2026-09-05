import type { Rng } from "@/core/engine/rng";

/**
 * X4 · Supernova Arena — el mapa, generado por codigo.
 *
 * Todo sale de la semilla y **nada se transfiere por red**: el host manda un
 * string y los diez clientes construyen el mismo mapa. Es lo que hace viable
 * un shooter 3D en celulares sin descargar geometria.
 *
 * Es logica pura a proposito. Un mapa que se genera distinto en dos aparatos
 * no se nota al mirarlo: se nota cuando alguien se cubre detras de un bloque
 * que en la pantalla del rival no existe, y eso es imposible de depurar sin
 * poder reproducirlo en un test.
 *
 * Las decisiones de diseno vienen de la guia y ninguna es arbitraria:
 *
 * - **80 x 80 unidades.** Con diez jugadores, un mapa grande son cuatro
 *   minutos de caminar sin ver a nadie.
 * - **Rampas, nunca escaleras.** Subir escalones con control tactil es una
 *   tortura.
 * - **Cobertura repartida con ruido, no en grilla.** Una grilla regular se lee
 *   como deposito y se juega peor.
 * - **Un hito central alto.** En un mapa chico sin referencia, la gente se
 *   pierde.
 * - **El centro del anillo cambia por partida.** Si siempre cerrara en el
 *   medio, la posicion optima seria la misma siempre.
 */

/** Lado del mapa, en unidades. 1 unidad ~ 1 metro. */
export const MAP_SIZE = 80;
const HALF = MAP_SIZE / 2;

/** Margen contra las paredes: nada se genera pegado al borde. */
const EDGE_MARGIN = 4;

/** Cuantos jugadores entran. Define cuantos puntos de aparicion hacen falta. */
export const MAX_PLAYERS = 10;

/**
 * Separacion minima entre dos apariciones.
 *
 * La guia la fija en 15: aparecer al lado de otro es perder sin jugar, y en un
 * mapa de 80 x 80 con diez personas es facil que pase por azar.
 */
export const MIN_SPAWN_DISTANCE = 15;

/** Alto del hito central. Tiene que verse por encima de toda la cobertura. */
const LANDMARK_HEIGHT = 18;

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

/** Una rampa sube hacia +x en su sistema local; `yaw` la orienta. */
export type MapRamp = MapBox & { yaw: number };

export type Vec2 = { x: number; z: number };

export type ShooterMap = {
  size: number;
  /** Bloques de cobertura. Se dibujan instanciados: un draw call para todos. */
  cover: readonly MapBox[];
  /** Dos plataformas elevadas. */
  platforms: readonly MapBox[];
  ramps: readonly MapRamp[];
  /** El hito central, para orientarse. */
  landmark: MapBox;
  /** Adonde cierra el anillo en esta partida. */
  ringCenter: Vec2;
  /** Diez puntos separados, en el orden en que se reparten. */
  spawns: readonly Vec2[];
};

/** Los tres tamanos de cobertura. Tres y no cinco: mas variedad no se lee. */
const COVER_SIZES: readonly { w: number; h: number; d: number }[] = [
  { w: 2, h: 2, d: 2 },
  { w: 4, h: 3, d: 2 },
  { w: 6, h: 4, d: 3 },
];

const COVER_MIN = 25;
const COVER_MAX = 35;

/** Radio libre alrededor del hito: sirve de referencia, no de escondite. */
const LANDMARK_CLEARANCE = 8;

/**
 * Distancia horizontal entre dos puntos.
 *
 * Se compara al cuadrado donde se puede, pero aca la claridad gana: se llama
 * en la generacion, que corre una vez por partida, no por cuadro.
 */
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

/**
 * Arma el mapa completo.
 *
 * El orden importa: primero lo fijo —hito y plataformas—, despues las
 * apariciones, y la cobertura al final, que es lo unico que puede esquivar a
 * todo lo demas. Generar la cobertura primero obligaria a mover apariciones
 * despues, que es como se termina con dos personas apareciendo juntas.
 */
export function createShooterMap(rng: Rng): ShooterMap {
  const landmark: MapBox = {
    x: 0,
    y: LANDMARK_HEIGHT / 2,
    z: 0,
    w: 4,
    h: LANDMARK_HEIGHT,
    d: 4,
  };

  /*
   * Dos plataformas en esquinas opuestas, con la diagonal elegida por la
   * semilla. Elevar siempre las mismas dos esquinas hace que la partida se
   * juegue igual todas las veces.
   */
  const flip = rng.chance(0.5);
  const platformOffset = 22;
  const platformHeight = 4;
  /*
   * Macizas desde el piso, no losas flotantes. Una losa a cuatro metros deja
   * pasar por abajo, no corta ninguna linea de tiro y se ve como un error de
   * fisica; un bloque es cobertura grande, tapa a quien esta detras y se sube
   * por la rampa. La tapa queda a `platformTop`, que es donde llega la rampa.
   */
  const platformTop = platformHeight + 0.5;
  const platforms: MapBox[] = [
    {
      x: flip ? -platformOffset : platformOffset,
      y: platformTop / 2,
      z: -platformOffset,
      w: 16,
      h: platformTop,
      d: 16,
    },
    {
      x: flip ? platformOffset : -platformOffset,
      y: platformTop / 2,
      z: platformOffset,
      w: 16,
      h: platformTop,
      d: 16,
    },
  ];

  /*
   * Una rampa por plataforma, del lado del centro. Es la unica forma de subir:
   * la guia descarta las escaleras porque con control tactil son intratables.
   *
   * Tres numeros que tienen que cerrar entre si o la rampa no sirve:
   *
   * - **Sube hacia la plataforma.** La geometria sube hacia +x local, asi que
   *   el `yaw` apunta desde el centro del mapa hacia la plataforma, no al reves.
   * - **Su punta alta coincide con el borde de la plataforma.** El centro va a
   *   media plataforma mas media rampa: si la rampa se metiera adentro de la
   *   plataforma, el cuerpo chocaria contra el costado antes de llegar arriba.
   * - **Llega a la altura de la tapa**, no a la del centro de la plataforma:
   *   con medio metro de escalon al final, nadie sube sin saltar.
   */
  const rampLength = 10;
  const platformHalf = 8;
  const ramps: MapRamp[] = platforms.map((platform) => {
    const toCenter = Math.atan2(-platform.z, -platform.x);
    const distance = platformHalf + rampLength / 2;
    return {
      x: platform.x + Math.cos(toCenter) * distance,
      y: platformTop / 2,
      z: platform.z + Math.sin(toCenter) * distance,
      w: rampLength,
      h: platformTop,
      d: 6,
      yaw: toCenter + Math.PI,
    };
  });

  const spawns = placeSpawns(rng, landmark);
  const cover = placeCover(rng, landmark, platforms, ramps, spawns);

  /*
   * El centro del anillo se mueve dentro de un radio moderado. Lejos del borde
   * a proposito: un anillo que cierra contra una pared deja media zona final
   * fuera del mapa y la pelea se vuelve un pasillo.
   */
  const ringAngle = rng.range(0, Math.PI * 2);
  const ringRadius = rng.range(0, 16);
  const ringCenter: Vec2 = {
    x: Math.cos(ringAngle) * ringRadius,
    z: Math.sin(ringAngle) * ringRadius,
  };

  return { size: MAP_SIZE, cover, platforms, ramps, landmark, ringCenter, spawns };
}

/**
 * Diez puntos separados por al menos `MIN_SPAWN_DISTANCE`.
 *
 * Muestreo por rechazo con un tope de intentos. El tope no es pesimismo: sin
 * el, una semilla desafortunada deja el generador girando para siempre, y eso
 * es una pantalla negra sin explicacion. Si se agotan los intentos se relaja
 * la distancia en vez de fallar — un mapa jugable con dos apariciones algo
 * cerca es mejor que ningun mapa.
 */
function placeSpawns(rng: Rng, landmark: MapBox): Vec2[] {
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

    if (distance(candidate, { x: landmark.x, z: landmark.z }) < LANDMARK_CLEARANCE) continue;
    if (spawns.some((spawn) => distance(spawn, candidate) < minDistance)) continue;
    spawns.push(candidate);
  }

  return spawns;
}

/**
 * La cobertura, esquivando todo lo demas.
 *
 * Deja libre el hito, las plataformas y un radio alrededor de cada aparicion:
 * aparecer adentro de una caja es el bug mas vergonzoso posible.
 */
function placeCover(
  rng: Rng,
  landmark: MapBox,
  platforms: readonly MapBox[],
  ramps: readonly MapRamp[],
  spawns: readonly Vec2[],
): MapBox[] {
  const target = rng.int(COVER_MIN, COVER_MAX);
  const cover: MapBox[] = [];
  const limit = HALF - EDGE_MARGIN;
  let attempts = 0;

  /*
   * Las rampas estan giradas, asi que su caja en planta no es su `w x d`. Se
   * reservan con un cuadrado del lado mayor: sobra un poco de aire alrededor,
   * que es preferible a un bloque sentado sobre la subida. Un bloque en la
   * rampa es la unica forma de subir tapada, y no se ve hasta que se juega.
   */
  const rampFootprints: MapBox[] = ramps.map((ramp) => {
    const side = Math.max(ramp.w, ramp.d);
    return { x: ramp.x, y: ramp.y, z: ramp.z, w: side, h: ramp.h, d: side };
  });

  while (cover.length < target && attempts < 6000) {
    attempts++;
    const size = rng.pick(COVER_SIZES);
    const candidate: MapBox = {
      x: rng.range(-limit, limit),
      y: size.h / 2,
      z: rng.range(-limit, limit),
      ...size,
    };

    if (distance(candidate, { x: landmark.x, z: landmark.z }) < LANDMARK_CLEARANCE) continue;
    if (spawns.some((spawn) => distance(spawn, candidate) < 5)) continue;
    if (platforms.some((platform) => overlaps(candidate, platform, 1))) continue;
    if (rampFootprints.some((ramp) => overlaps(candidate, ramp, 1))) continue;
    if (cover.some((placed) => overlaps(candidate, placed, 1.5))) continue;

    cover.push(candidate);
  }

  return cover;
}
