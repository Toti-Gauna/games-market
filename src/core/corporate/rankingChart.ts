/**
 * El grafico de dispersion de un ranking, armado como DATO.
 *
 * `ranking.ts` calcula el consenso y el desvio; esto traduce ese resultado a lo
 * que hay que dibujar: donde cae cada punto sobre el eje 1..N, cuanto pesa, y
 * la frase que explica la grieta en castellano.
 *
 * Vive aca y no en el componente por dos razones. La primera es que se puede
 * testear a mano: un item que la mitad puso primero y la otra mitad ultimo
 * tiene que dar dos puntos en los extremos y nada en el medio, y eso se
 * verifica sin montar React. La segunda es que la va a reusar cualquier
 * pregunta `order` del formulario vivo, no solo Prioridades.
 *
 * Nada de esto agrega informacion: solo reordena la que ya calculo el agregado.
 */

import { DEFAULT_PODIUM_SIZE, type RankingAggregate, type RankingItem } from "./ranking";

/** Un punto del grafico: una posicion concreta y cuanta gente la eligio. */
export type ScatterDot = {
  /** Posicion 1-based. 1 es el primer puesto. */
  position: number;
  /** Cuantas personas lo pusieron ahi. */
  count: number;
  /** Lugar sobre el eje, 0..1. 0 es el extremo del primer puesto. */
  at: number;
  /**
   * Tamano relativo, 0..1, contra el pico de la MISMA fila. Es una comparacion
   * dentro del item, no entre items: cada fila tiene su propia cantidad de
   * respuestas y un tamano global haria ilegibles las filas chicas.
   */
  weight: number;
  /** Porcentaje de las respuestas del item, redondeado. */
  pct: number;
};

export type DivisionRow = {
  id: string;
  label: string;
  /** Cuantas respuestas lo posicionaron. */
  samples: number;
  /** Desvio estandar de las posiciones. Es lo que ordena las filas. */
  deviation: number;
  avgPosition: number;
  /** Lugar de la media sobre el eje, 0..1. */
  avgAt: number;
  minPosition: number;
  maxPosition: number;
  /** El tramo del eje que ocupa el desacuerdo, 0..1. */
  spanFrom: number;
  spanTo: number;
  dots: readonly ScatterDot[];
  /** "14 personas lo pusieron en el podio, 11 lo pusieron último." */
  headline: string;
  /** El de mayor desvio, cuando efectivamente hubo desacuerdo. */
  leader: boolean;
};

export type DivisionOptions = {
  /** Cuantas filas entran en la pantalla. El resto no se lee. */
  limit?: number;
  /**
   * Cuantos primeros puestos contaron como podio. Tiene que ser el mismo que
   * recibio `aggregateRanking`: solo cambia como se redacta la frase.
   */
  podiumSize?: number;
};

/**
 * Lugar de una posicion sobre el eje, 0..1.
 *
 * Con un solo item no hay eje que recorrer: el punto va al centro en vez de
 * dividir por cero.
 */
export function axisPosition(position: number, size: number): number {
  if (size <= 1) return 0.5;
  const clamped = Math.min(size, Math.max(1, position));
  return (clamped - 1) / (size - 1);
}

/**
 * Coma decimal: "2,4". Es como se escribe un promedio en castellano, y vive
 * aca porque el formato es del dato y no del componente que lo dibuja.
 */
export function decimal(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

function subject(count: number): string {
  return count === 1 ? "1 persona" : `${count} personas`;
}

function verb(count: number): string {
  return count === 1 ? "lo puso" : "lo pusieron";
}

/**
 * La frase que acompana al grafico.
 *
 * Es la que abre la conversacion: el grafico muestra que hay dos grupos, la
 * frase dice de que tamano es cada uno. Con `podiumSize` de 1 no se dice
 * "podio" porque seria mentira: es el primer puesto y nada mas.
 */
export function divisionHeadline(
  item: Pick<RankingItem, "samples" | "topCount" | "bottomCount">,
  podiumSize: number = DEFAULT_PODIUM_SIZE,
): string {
  if (item.samples === 0) return "Nadie lo posicionó.";

  const top = item.topCount;
  const bottom = item.bottomCount;
  const where = podiumSize <= 1 ? "primero" : "en el podio";

  if (top > 0 && bottom > 0) {
    return `${subject(top)} ${verb(top)} ${where}, ${bottom} ${verb(bottom)} último.`;
  }
  if (top > 0) return `${subject(top)} ${verb(top)} ${where}.`;
  if (bottom > 0) return `${subject(bottom)} ${verb(bottom)} último.`;
  return "Nadie lo mandó a un extremo.";
}

/** Los puntos de una fila, de primer puesto a ultimo. Las posiciones vacias no ocupan. */
export function scatterDots(item: RankingItem): ScatterDot[] {
  const size = item.distribution.length;
  let peak = 0;
  for (const count of item.distribution) if (count > peak) peak = count;
  if (peak === 0) return [];

  const dots: ScatterDot[] = [];
  for (let index = 0; index < size; index += 1) {
    const count = item.distribution[index] ?? 0;
    if (count === 0) continue;
    dots.push({
      position: index + 1,
      count,
      at: axisPosition(index + 1, size),
      weight: count / peak,
      pct: item.samples > 0 ? Math.round((count / item.samples) * 100) : 0,
    });
  }
  return dots;
}

/**
 * Las filas del grafico, ya ordenadas: la primera es la mas discutida.
 *
 * El orden lo trae `byDivision` del agregado, que ya resuelve los empates por
 * el orden declarado. Aca no se vuelve a ordenar: dos maquinas con las mismas
 * respuestas tienen que dibujar exactamente lo mismo.
 *
 * Lo que nadie posiciono se descarta: una fila sin un solo punto no es
 * desacuerdo, es una tarjeta que no llego a nadie.
 */
export function buildDivisionRows(
  aggregate: RankingAggregate,
  options: DivisionOptions = {},
): DivisionRow[] {
  const podiumSize = Math.max(1, options.podiumSize ?? DEFAULT_PODIUM_SIZE);
  const limit = options.limit ?? aggregate.byDivision.length;
  const rows: DivisionRow[] = [];

  for (const item of aggregate.byDivision) {
    if (rows.length >= limit) break;
    if (item.samples === 0) continue;

    const size = item.distribution.length;
    rows.push({
      id: item.id,
      label: item.label,
      samples: item.samples,
      deviation: item.deviation,
      avgPosition: item.avgPosition,
      avgAt: axisPosition(item.avgPosition, size),
      minPosition: item.minPosition,
      maxPosition: item.maxPosition,
      spanFrom: axisPosition(item.minPosition, size),
      spanTo: axisPosition(item.maxPosition, size),
      dots: scatterDots(item),
      headline: divisionHeadline(item, podiumSize),
      leader: item.id === aggregate.mostDividedId,
    });
  }

  return rows;
}
