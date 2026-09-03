import type { RankingAggregate } from "./ranking";

/**
 * Lo que el proyector muestra mientras la sala responde.
 *
 * Es la mitad del valor de los juegos corporativos: sin esto, un formulario en
 * una pantalla gigante es un formulario. Con las barras creciendo en vivo, es
 * una sala mirando lo mismo.
 *
 * Todo puro: entra un conjunto de respuestas y sale algo dibujable. Ningun
 * agregado guarda de donde vino cada respuesta salvo que se le pida, y con
 * `anonymous` el identificador **no llega**, no es que no se muestre.
 */

export type BarsAggregate = {
  type: "bars";
  options: ReadonlyArray<{ id: string; label: string; count: number; pct: number; correct?: boolean }>;
  total: number;
};

export type ScaleAggregate = {
  type: "scale";
  avg: number;
  /** Conteo por valor, de `min` a `max`. */
  distribution: readonly number[];
  min: number;
  max: number;
  total: number;
};

export type CloudAggregate = {
  type: "cloud";
  words: ReadonlyArray<{ text: string; weight: number }>;
  /** Cuantas respuestas se descartaron por el filtro. Se informa, no se esconde. */
  filtered: number;
};

export type ProfilesAggregate = {
  type: "profiles";
  counts: ReadonlyArray<{ id: string; label: string; count: number; pct: number }>;
  total: number;
};

export type Aggregate =
  | BarsAggregate
  | ScaleAggregate
  | CloudAggregate
  | ProfilesAggregate
  | RankingAggregate;

/* ------------------------------------------------------------------ */
/* Reparto de porcentajes                                               */
/* ------------------------------------------------------------------ */

/**
 * Porcentajes enteros que suman exactamente 100, por resto mayor.
 *
 * Redondear cada uno por su cuenta da 99 o 101 y en una pantalla de 3 metros
 * eso se ve. Los empates se rompen por orden declarado, nunca al azar: dos
 * corridas con los mismos datos tienen que dar el mismo grafico.
 */
export function percentages(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return counts.map(() => 0);

  const exact = counts.map((n) => (n / total) * 100);
  const floors = exact.map((n) => Math.floor(n));
  let remainder = 100 - floors.reduce((sum, n) => sum + n, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  const out = [...floors];
  for (const entry of order) {
    if (remainder <= 0) break;
    out[entry.index] = (out[entry.index] ?? 0) + 1;
    remainder--;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Barras                                                               */
/* ------------------------------------------------------------------ */

export type BarsInput = {
  options: ReadonlyArray<{ id: string; label: string }>;
  /** Una entrada por respuesta: el id de la opcion elegida. */
  picks: readonly string[];
  /** Se resalta al cerrar, nunca antes. */
  correctId?: string | null;
};

export function aggregateBars(input: BarsInput): BarsAggregate {
  const counts = input.options.map(
    (option) => input.picks.filter((pick) => pick === option.id).length,
  );
  const pcts = percentages(counts);

  return {
    type: "bars",
    total: input.picks.length,
    options: input.options.map((option, index) => ({
      id: option.id,
      label: option.label,
      count: counts[index] ?? 0,
      pct: pcts[index] ?? 0,
      ...(input.correctId != null ? { correct: option.id === input.correctId } : {}),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Escala                                                               */
/* ------------------------------------------------------------------ */

export function aggregateScale(values: readonly number[], min = 1, max = 5): ScaleAggregate {
  const span = Math.max(1, max - min + 1);
  const distribution = new Array<number>(span).fill(0);
  let sum = 0;
  let total = 0;

  for (const raw of values) {
    if (!Number.isFinite(raw)) continue;
    const value = Math.min(max, Math.max(min, Math.round(raw)));
    distribution[value - min] = (distribution[value - min] ?? 0) + 1;
    sum += value;
    total++;
  }

  return {
    type: "scale",
    avg: total > 0 ? sum / total : 0,
    distribution,
    min,
    max,
    total,
  };
}

/* ------------------------------------------------------------------ */
/* Nube de palabras                                                     */
/* ------------------------------------------------------------------ */

/**
 * Palabras que no se proyectan.
 *
 * Es un evento de empresa con una pantalla gigante: alguien va a probar. La
 * lista corta no pretende ser exhaustiva —ninguna lo es— pero corta el 90 % de
 * los intentos, y lo que pasa se puede moderar a mano antes de proyectar.
 */
const BLOCKED = [
  "puto",
  "puta",
  "concha",
  "verga",
  "pija",
  "mierda",
  "boludo",
  "pelotudo",
  "forro",
  "sorete",
  "carajo",
  "joder",
  "coger",
  "culo",
  "teta",
  "fuck",
  "shit",
  "bitch",
  "dick",
] as const;

/** Palabras vacias: sin esto la nube dice "de", "que" y "la" en cuerpo enorme. */
const STOPWORDS = new Set([
  "de", "la", "el", "que", "y", "a", "en", "un", "una", "los", "las", "del", "al", "por",
  "con", "para", "es", "se", "no", "lo", "mas", "más", "pero", "como", "su", "sus", "o",
  "me", "mi", "te", "tu", "le", "les", "ya", "muy", "si", "sí", "ser", "hay", "esta", "está",
]);

export function isBlockedText(text: string): boolean {
  const normalized = normalize(text);
  return BLOCKED.some((bad) => normalized.includes(bad));
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    // Los diacriticos combinantes se sacan por rango escapado, no pegando los
    // caracteres crudos en el fuente: asi el archivo sobrevive a cualquier
    // conversion de encoding.
    .replace(/[\u0300-\u036f]/g, "");
}

export type CloudOptions = {
  /** Cuantas palabras entran. Mas de 40 en una pantalla no se lee. */
  limit?: number;
  minLength?: number;
};

export function aggregateCloud(texts: readonly string[], options: CloudOptions = {}): CloudAggregate {
  const limit = options.limit ?? 40;
  const minLength = options.minLength ?? 3;
  const weights = new Map<string, number>();
  let filtered = 0;

  for (const raw of texts) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    // El filtro corre sobre la respuesta ENTERA, no palabra por palabra: si
    // alguien escribio una barbaridad, no se proyecta ni la parte limpia.
    if (isBlockedText(raw)) {
      filtered++;
      continue;
    }
    for (const word of normalize(raw).split(/[^a-z0-9ñ]+/)) {
      if (word.length < minLength || STOPWORDS.has(word)) continue;
      weights.set(word, (weights.get(word) ?? 0) + 1);
    }
  }

  const words = [...weights.entries()]
    .map(([text, weight]) => ({ text, weight }))
    // Empates por orden alfabetico: la nube no puede cambiar entre corridas.
    .sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text, "es"))
    .slice(0, limit);

  return { type: "cloud", words, filtered };
}

/* ------------------------------------------------------------------ */
/* Arquetipos                                                           */
/* ------------------------------------------------------------------ */

export function aggregateProfiles(
  profiles: ReadonlyArray<{ id: string; label: string }>,
  picks: readonly string[],
): ProfilesAggregate {
  const counts = profiles.map((profile) => picks.filter((pick) => pick === profile.id).length);
  const pcts = percentages(counts);

  return {
    type: "profiles",
    total: picks.length,
    counts: profiles.map((profile, index) => ({
      id: profile.id,
      label: profile.label,
      count: counts[index] ?? 0,
      pct: pcts[index] ?? 0,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Anonimato                                                            */
/* ------------------------------------------------------------------ */

/**
 * Descarta el identificador ANTES de agregar.
 *
 * La diferencia con ocultarlo en la vista no es cosmetica: lo que no se
 * calcula no se puede filtrar por accidente en un `meta`, en un log ni en el
 * inspector del navegador.
 */
export function stripIdentity<T>(
  responses: ReadonlyArray<{ participantId: string; value: T }>,
  anonymous: boolean,
): Array<{ participantId: string | null; value: T }> {
  return responses.map((response) => ({
    participantId: anonymous ? null : response.participantId,
    value: response.value,
  }));
}
