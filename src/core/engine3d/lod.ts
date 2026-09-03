/**
 * Niveles de detalle por distancia.
 *
 * Tres niveles y nada mas: cerca, medio y lejos. Con geometria de primitivas
 * no hay nada que ganar en una escalera mas fina, y cada nivel extra es otro
 * escritor de instancias, otro draw call y otra cosa que mantener.
 *
 * Todo trabaja en distancia AL CUADRADO: la raiz cuadrada por objeto y por
 * cuadro no aporta nada porque lo unico que se hace con el numero es
 * compararlo. Con 500 objetos son 500 raices por cuadro regaladas.
 *
 * No usa `THREE.LOD` a proposito: ese resuelve por objeto, y aca los objetos
 * van instanciados. La decision es "en que escritor entra este objeto", que
 * es una comparacion, no un grafo de escena.
 */

export type LodLevel = 0 | 1 | 2;

export type LodBands = {
  /** Hasta aca, nivel 0. Al cuadrado. */
  nearSq: number;
  /** Hasta aca, nivel 1. Mas alla, nivel 2. Al cuadrado. */
  farSq: number;
};

export function createLodBands(near: number, far: number): LodBands {
  return { nearSq: near * near, farSq: far * far };
}

/**
 * Aplica el `lodBias` del guardia de rendimiento.
 *
 * `bias > 1` acerca los cortes, o sea baja el detalle antes. Escribe sobre
 * `out` para no asignar por cuadro.
 */
export function applyLodBias(bands: LodBands, bias: number, out: LodBands): LodBands {
  const factor = 1 / (bias * bias);
  out.nearSq = bands.nearSq * factor;
  out.farSq = bands.farSq * factor;
  return out;
}

export function lodLevel(distanceSq: number, bands: LodBands): LodLevel {
  if (distanceSq <= bands.nearSq) return 0;
  if (distanceSq <= bands.farSq) return 1;
  return 2;
}

/**
 * Igual, pero con histeresis.
 *
 * Sin esto, un objeto parado justo en el corte cambia de nivel en cada cuadro
 * y parpadea. El margen obliga a cruzar el umbral con ganas para subir de
 * nivel, y a volver bastante mas aca para bajarlo.
 *
 * `margin` es una proporcion: 0.1 son diez por ciento de banda muerta.
 */
export function lodLevelStable(
  distanceSq: number,
  bands: LodBands,
  previous: LodLevel,
  margin = 0.1,
): LodLevel {
  const grow = (1 + margin) * (1 + margin);
  const shrink = (1 - margin) * (1 - margin);

  // Para quedarse donde esta alcanza con no haberse ido lo suficiente.
  if (previous === 0) return distanceSq <= bands.nearSq * grow ? 0 : lodLevel(distanceSq, bands);
  if (previous === 2) return distanceSq >= bands.farSq * shrink ? 2 : lodLevel(distanceSq, bands);
  if (distanceSq <= bands.nearSq * shrink) return 0;
  if (distanceSq >= bands.farSq * grow) return 2;
  return 1;
}

/** Distancia al cuadrado, sin raiz y sin `Vector3`. */
export function distanceSq(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}
