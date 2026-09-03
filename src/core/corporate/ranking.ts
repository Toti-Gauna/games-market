/**
 * Agregacion de ordenamientos. Pura: entra dato plano, sale dato plano.
 *
 * Un ranking promedio del equipo es un dato tibio ("lo mas importante es la
 * calidad"): nadie discute con eso y nadie aprende nada. Lo que abre
 * conversacion es el DESACUERDO, asi que ademas del consenso se calcula el
 * desvio por item y se destaca el mas dividido. Si algo quedo primero para la
 * mitad del equipo y ultimo para la otra mitad, eso significa que dos partes de
 * la organizacion estan optimizando cosas distintas y no lo sabian.
 *
 * El anonimato se resuelve ACA, no en la vista: con `anonymous: true` el
 * `participantId` se descarta durante la agregacion y no llega al resultado.
 * Prometer anonimato y limitarse a no mostrarlo es no cumplirlo.
 */

export type RankableItem = {
  id: string;
  label: string;
};

export type RankingResponse = {
  /** Ids del item, de mas importante a menos. Puede venir incompleto. */
  order: readonly string[];
  /** Quien respondio. Se descarta si la ronda es anonima. */
  participantId?: string;
};

export type RankingItem = {
  id: string;
  label: string;
  /** Cuantas respuestas le asignaron una posicion. */
  samples: number;
  /** Posicion media, 1-based. 0 si nadie lo posiciono. */
  avgPosition: number;
  /** Desvio estandar poblacional de las posiciones. Cuanto mas alto, mas dividido. */
  deviation: number;
  minPosition: number;
  maxPosition: number;
  /** Cuantos lo pusieron en el podio. */
  topCount: number;
  /** Cuantos lo pusieron ultimo. */
  bottomCount: number;
  /** Veces en cada posicion. El indice 0 es el primer puesto. */
  distribution: readonly number[];
  /** Puesto en el consenso, 1-based. */
  consensusPosition: number;
};

export type RankingAggregate = {
  type: "ranking";
  /** El consenso: por posicion media ascendente. */
  items: readonly RankingItem[];
  /** Los mismos, por desvio descendente. El primero es el mas discutido. */
  byDivision: readonly RankingItem[];
  /** null si no hay respuestas o si el equipo coincidio en todo. */
  mostDividedId: string | null;
  responses: number;
  anonymous: boolean;
  /**
   * Quienes respondieron. SIEMPRE vacio en una ronda anonima: el id no se
   * copia, se descarta al entrar.
   */
  participants: readonly string[];
};

export type RankingOptions = {
  anonymous?: boolean;
  /** Cuantos primeros puestos cuentan como podio. */
  podiumSize?: number;
};

export const DEFAULT_PODIUM_SIZE = 3;

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Desvio poblacional: se agrega toda la poblacion que respondio, no una muestra. */
function standardDeviation(values: readonly number[], average: number): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += (value - average) ** 2;
  return Math.sqrt(sum / values.length);
}

/**
 * Posiciones que cada respuesta le dio a cada item.
 *
 * Una respuesta parcial (la que deja un `force-end` a mitad) aporta lo que
 * tenga: los items que no menciona simplemente no suman muestra. Ids repetidos
 * o desconocidos se ignoran, que es la unica forma de que un cliente no pueda
 * inflar un item mandando su id ocho veces.
 */
function positionsByItem(
  items: readonly RankableItem[],
  responses: readonly RankingResponse[],
): Map<string, number[]> {
  const known = new Set(items.map((item) => item.id));
  const out = new Map<string, number[]>(items.map((item) => [item.id, []]));

  for (const response of responses) {
    const seen = new Set<string>();
    let position = 0;
    for (const id of response.order) {
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      position += 1;
      out.get(id)?.push(position);
    }
  }

  return out;
}

export function aggregateRanking(
  items: readonly RankableItem[],
  responses: readonly RankingResponse[],
  options: RankingOptions = {},
): RankingAggregate {
  const anonymous = options.anonymous ?? false;
  const podium = Math.max(1, options.podiumSize ?? DEFAULT_PODIUM_SIZE);
  const positions = positionsByItem(items, responses);
  const size = items.length;

  const rows = items.map((item, index) => {
    const values = positions.get(item.id) ?? [];
    const average = mean(values);
    const distribution = new Array<number>(size).fill(0);
    let topCount = 0;
    let bottomCount = 0;

    for (const value of values) {
      const slot = value - 1;
      if (slot >= 0 && slot < size) distribution[slot] = (distribution[slot] ?? 0) + 1;
      if (value <= podium) topCount += 1;
      if (value === size) bottomCount += 1;
    }

    return {
      id: item.id,
      label: item.label,
      index,
      samples: values.length,
      avgPosition: average,
      deviation: standardDeviation(values, average),
      minPosition: values.length > 0 ? Math.min(...values) : 0,
      maxPosition: values.length > 0 ? Math.max(...values) : 0,
      topCount,
      bottomCount,
      distribution,
    };
  });

  // Empates resueltos por el orden declarado: dos maquinas con las mismas
  // respuestas tienen que dibujar exactamente lo mismo. Lo que nadie posiciono
  // va al final: no tiene consenso que mostrar.
  const consensus = [...rows].sort((a, b) => {
    if (a.samples === 0 || b.samples === 0) return a.samples === b.samples ? a.index - b.index : a.samples === 0 ? 1 : -1;
    return a.avgPosition - b.avgPosition || a.index - b.index;
  });

  const withPosition: RankingItem[] = consensus.map((row, position) => ({
    id: row.id,
    label: row.label,
    samples: row.samples,
    avgPosition: row.avgPosition,
    deviation: row.deviation,
    minPosition: row.minPosition,
    maxPosition: row.maxPosition,
    topCount: row.topCount,
    bottomCount: row.bottomCount,
    distribution: row.distribution,
    consensusPosition: position + 1,
  }));

  const byIndex = new Map(rows.map((row) => [row.id, row.index]));
  const byDivision = [...withPosition].sort(
    (a, b) => b.deviation - a.deviation || (byIndex.get(a.id) ?? 0) - (byIndex.get(b.id) ?? 0),
  );

  const leader = byDivision[0];
  // Desvio cero es acuerdo total: no hay nada que destacar como discutido.
  const mostDividedId = leader && leader.deviation > 0 ? leader.id : null;

  const participants = anonymous
    ? []
    : responses
        .map((response) => response.participantId)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

  return {
    type: "ranking",
    items: withPosition,
    byDivision,
    mostDividedId,
    responses: responses.length,
    anonymous,
    participants,
  };
}
