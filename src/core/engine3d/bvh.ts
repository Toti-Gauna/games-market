import type { BufferGeometry, Raycaster } from "three";
import type * as ThreeMeshBvh from "three-mesh-bvh";

/**
 * Raycast, por las dos rutas que existen.
 *
 * Cual usar NO es una regla general, es una decision por juego:
 *
 * - **Lista de AABB** (`raycastAabbs`, todo lo de arriba de este archivo).
 *   Cuando el objetivo son unos pocos volumenes simples. En el shooter el
 *   disparo se resuelve contra diez capsulas de jugador y contra la
 *   cobertura, que son cajas instanciadas: rayar contra 40 AABB son 40
 *   pruebas de slabs, no llega a 0,1 ms, no reserva memoria y no hay nada que
 *   reconstruir cuando algo se mueve. **Es la ruta que usan hoy los cuatro
 *   juegos 3D del catalogo.**
 *
 * - **BVH** (`enableBvh`, abajo). Cuando hay que rayar contra una malla de
 *   miles de triangulos: geometria de nivel detallada, terreno, una escena
 *   importada. Ahi el arbol se paga una vez y ahorra milisegundos por
 *   disparo.
 *
 * Regla practica: menos de ~100 volumenes simples, lista de AABB. Miles de
 * triangulos, BVH. Construir un BVH para 40 cajas es mas lento que no
 * construirlo.
 */

/* ------------------------------------------------------------------ */
/* Ruta 1: lista de AABB                                               */
/* ------------------------------------------------------------------ */

export type Aabb = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type RayHit = {
  /** Indice dentro de la lista consultada. -1 si no hubo impacto. */
  index: number;
  /** Distancia en unidades de mundo, con la direccion normalizada. */
  distance: number;
  x: number;
  y: number;
  z: number;
};

/** El resultado se reusa: el raycast corre por disparo y no puede asignar. */
export function createRayHit(): RayHit {
  return { index: -1, distance: 0, x: 0, y: 0, z: 0 };
}

export function createAabb(): Aabb {
  return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
}

/** AABB de una caja centrada, con sus medias medidas. */
export function aabbFromBox(
  out: Aabb,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
): Aabb {
  out.minX = cx - hx;
  out.minY = cy - hy;
  out.minZ = cz - hz;
  out.maxX = cx + hx;
  out.maxY = cy + hy;
  out.maxZ = cz + hz;
  return out;
}

/**
 * AABB de una capsula vertical: es lo que envuelve a un jugador.
 *
 * `y` son los pies y `height` es el alto total. Es una aproximacion generosa
 * en las esquinas, y esta bien que lo sea: un disparo que roza el hombro
 * cuenta como impacto y nadie se queja de eso; al reves si.
 */
export function aabbFromCapsule(
  out: Aabb,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
): Aabb {
  out.minX = x - radius;
  out.minY = y;
  out.minZ = z - radius;
  out.maxX = x + radius;
  out.maxY = y + height;
  out.maxZ = z + radius;
  return out;
}

const EPSILON = 1e-8;

/**
 * El impacto mas cercano contra una lista de AABB, o null.
 *
 * La direccion tiene que venir NORMALIZADA o la distancia sale en unidades de
 * la direccion en vez de unidades de mundo.
 *
 * Si el origen esta adentro de una caja, esa caja devuelve distancia 0: es lo
 * correcto para un disparo desde adentro de la cobertura.
 */
export function raycastAabbs(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  boxes: readonly Aabb[],
  maxDistance: number,
  out: RayHit,
): RayHit | null {
  let bestDistance = maxDistance;
  let bestIndex = -1;

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (!box) continue;

    // Slabs: se recorta el intervalo [0, bestDistance] eje por eje. Se corta
    // contra `bestDistance` y no contra `maxDistance` para que las cajas mas
    // lejanas que la mejor encontrada se descarten en el primer eje.
    let tMin = 0;
    let tMax = bestDistance;
    let miss = false;

    for (let axis = 0; axis < 3; axis++) {
      const origin = axis === 0 ? ox : axis === 1 ? oy : oz;
      const direction = axis === 0 ? dx : axis === 1 ? dy : dz;
      const lo = axis === 0 ? box.minX : axis === 1 ? box.minY : box.minZ;
      const hi = axis === 0 ? box.maxX : axis === 1 ? box.maxY : box.maxZ;

      if (direction > -EPSILON && direction < EPSILON) {
        // Rayo paralelo a este par de planos: o esta adentro de la franja o
        // no toca nunca. Sin este caso aparte, 0/0 da NaN y el test miente.
        if (origin < lo || origin > hi) {
          miss = true;
          break;
        }
        continue;
      }

      const inverse = 1 / direction;
      let t1 = (lo - origin) * inverse;
      let t2 = (hi - origin) * inverse;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) {
        miss = true;
        break;
      }
    }

    if (miss) continue;
    bestDistance = tMin;
    bestIndex = i;
  }

  if (bestIndex < 0) return null;

  out.index = bestIndex;
  out.distance = bestDistance;
  out.x = ox + dx * bestDistance;
  out.y = oy + dy * bestDistance;
  out.z = oz + dz * bestDistance;
  return out;
}

/* ------------------------------------------------------------------ */
/* Ruta 2: BVH, solo para mallas complejas                             */
/* ------------------------------------------------------------------ */

/**
 * El tipo se importa estatico y el modulo NO.
 *
 * `import type` se borra al compilar, asi que no mete a `three-mesh-bvh` en
 * ningun chunk; lo unico que deja es la ampliacion de tipos de three, que es
 * la que le agrega `computeBoundsTree` a `BufferGeometry`.
 */
type BvhModule = typeof ThreeMeshBvh;

let bvhModule: BvhModule | null = null;

/**
 * Carga `three-mesh-bvh` y parcha los prototipos de three.
 *
 * El import es dinamico a proposito. Hoy ningun juego 3D del catalogo lo
 * necesita —todos generan geometria con primitivas instanciadas— asi que
 * dejarlo estatico seria meter la libreria en el chunk de juegos que no van a
 * llamarla nunca. Cuando entre una malla detallada, esto se resuelve una vez
 * al cargar el nivel, no por disparo.
 */
export async function loadBvh(): Promise<BvhModule> {
  if (bvhModule) return bvhModule;
  const module = await import("three-mesh-bvh");
  const three = await import("three");
  three.BufferGeometry.prototype.computeBoundsTree = module.computeBoundsTree;
  three.BufferGeometry.prototype.disposeBoundsTree = module.disposeBoundsTree;
  three.Mesh.prototype.raycast = module.acceleratedRaycast;
  bvhModule = module;
  return module;
}

/**
 * Construye el arbol de una malla complicada.
 *
 * Vale la pena a partir de unos miles de triangulos. Por debajo de eso el
 * arbol cuesta mas de construir y de recorrer que probar los triangulos
 * derecho viejo, y encima ocupa memoria.
 */
export async function enableBvh(geometry: BufferGeometry): Promise<void> {
  await loadBvh();
  if (geometry.boundsTree) return;
  geometry.computeBoundsTree();
}

/** Libera el arbol. Va con el resto del descarte al desmontar. */
export function disposeBvh(geometry: BufferGeometry): void {
  // Puede correr sin que `loadBvh` haya pasado nunca: el metodo lo agrega el
  // parche, asi que sin el no existe.
  if (!bvhModule || !geometry.boundsTree) return;
  geometry.disposeBoundsTree();
}

/**
 * Con `firstHitOnly` el raycast corta en el primer triangulo en vez de juntar
 * todos y ordenar. Para un disparo es exactamente lo que se quiere y es
 * varias veces mas rapido.
 */
export function firstHitOnly(raycaster: Raycaster, value = true): void {
  raycaster.firstHitOnly = value;
}
