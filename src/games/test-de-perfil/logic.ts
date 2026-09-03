import { bool, num, records, type SettingsRecord, type SettingsValues } from "@/core/contract/settings";
import type { Rng } from "@/core/engine/rng";
import type { OptionWeights, SingleQuestion } from "@/core/corporate/question.types";
import type { ProfileResult } from "@/core/corporate/scoring";

/**
 * Lo unico propio del test de perfil: pasar de los registros editables del
 * panel a items del motor corporativo. La correccion, la agregacion y el
 * dibujo ya viven en core/corporate; aca no se repite nada de eso.
 */

export const ARCHETYPE_IDS = ["explorer", "builder", "connector", "guardian", "strategist"] as const;

export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

/** Nombre por defecto. El panel puede renombrarlos sin romper los pesos. */
export const ARCHETYPE_LABEL: Record<ArchetypeId, string> = {
  explorer: "Explorador",
  builder: "Constructor",
  connector: "Conector",
  guardian: "Guardián",
  strategist: "Estratega",
};

export const ARCHETYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = ARCHETYPE_IDS.map(
  (id) => ({ value: id, label: ARCHETYPE_LABEL[id] }),
);

/** Valor del select cuando una opcion no aporta un segundo arquetipo. */
export const NO_ARCHETYPE = "none";

export const ARCHETYPE_OPTIONS_WITH_NONE: ReadonlyArray<{ value: string; label: string }> = [
  ...ARCHETYPE_OPTIONS,
  { value: NO_ARCHETYPE, label: "Ninguno" },
];

/**
 * Pesos repartidos: cada opcion suma fuerte a un arquetipo y flojo a otro.
 * Sin el segundo peso los resultados salen 12 a 0 y se sienten falsos.
 */
export const PRIMARY_WEIGHT = 3;
export const SECONDARY_WEIGHT = 1;

/** Las cuatro opciones de cada situacion. El orden NO se baraja: los pesos estan pensados asi. */
export const OPTION_KEYS = ["a", "b", "c", "d"] as const;

export type Archetype = {
  id: string;
  name: string;
  description: string;
};

export type ProfileDeck = {
  questions: readonly SingleQuestion[];
  archetypes: readonly Archetype[];
  /** ms antes de pasar sola a la siguiente. 0 = al instante. */
  autoAdvanceMs: number;
  allowBack: boolean;
  showMix: boolean;
  closeMargin: number;
};

function isArchetypeId(value: unknown): value is ArchetypeId {
  return typeof value === "string" && (ARCHETYPE_IDS as readonly string[]).includes(value);
}

function text(row: SettingsRecord, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Los cinco arquetipos, con el nombre y la descripcion que diga el panel. */
export function parseArchetypes(rows: readonly SettingsRecord[]): Archetype[] {
  const out: Archetype[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const id = row["id"];
    if (!isArchetypeId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: text(row, "name") || ARCHETYPE_LABEL[id],
      description: text(row, "description"),
    });
  }

  // Un arquetipo borrado del panel sigue existiendo para los pesos: sin el, la
  // mezcla sumaria menos de 100 y el reparto quedaria mal.
  for (const id of ARCHETYPE_IDS) {
    if (!seen.has(id)) out.push({ id, name: ARCHETYPE_LABEL[id], description: "" });
  }

  return out;
}

/** Cada registro del panel es una situacion con cuatro salidas defendibles. */
export function parseProfileQuestions(rows: readonly SettingsRecord[]): SingleQuestion[] {
  const out: SingleQuestion[] = [];

  rows.forEach((row, index) => {
    const prompt = text(row, "prompt");
    if (!prompt) return;

    const options: Array<{ id: string; label: string }> = [];
    const weights: Record<string, Record<string, number>> = {};

    for (const key of OPTION_KEYS) {
      const label = text(row, key);
      if (!label) continue;

      const bucket: Record<string, number> = {};
      const main = row[`${key}Main`];
      if (isArchetypeId(main)) bucket[main] = PRIMARY_WEIGHT;
      const alt = row[`${key}Alt`];
      if (isArchetypeId(alt) && alt !== main) bucket[alt] = SECONDARY_WEIGHT;

      options.push({ id: key, label });
      weights[key] = bucket;
    }

    // Una situacion con una sola salida no mide nada.
    if (options.length < 2) return;

    out.push({
      kind: "single",
      id: `q${index + 1}`,
      prompt,
      options,
      correct: null,
      weights: weights as OptionWeights,
    });
  });

  return out;
}

/**
 * Arma la partida. El orden de las preguntas sale del PRNG sembrado, nunca de
 * `Math.random()`: con la misma semilla todos ven la misma secuencia.
 */
export function buildProfileDeck(values: SettingsValues, rng: Rng): ProfileDeck {
  const questions = parseProfileQuestions(records(values, "questions"));
  return {
    questions: bool(values, "shuffleQuestions", false) ? rng.shuffle(questions) : questions,
    archetypes: parseArchetypes(records(values, "archetypes")),
    autoAdvanceMs: num(values, "autoAdvanceMs", 250),
    allowBack: bool(values, "allowBack", true),
    showMix: bool(values, "showMix", true),
    closeMargin: num(values, "closeMargin", 5),
  };
}

export function findArchetype(
  archetypes: readonly Archetype[],
  id: string | null,
): Archetype | undefined {
  if (!id) return undefined;
  return archetypes.find((archetype) => archetype.id === id);
}

/**
 * El titulo del resultado. Con los dos primeros pegados se nombran los dos:
 * decir "Explorador" a secas cuando fue 34 contra 32 se siente arbitrario.
 */
export function describeProfile(
  result: ProfileResult,
  archetypes: readonly Archetype[],
): { headline: string; description: string } {
  const top = findArchetype(archetypes, result.topId);
  if (!top) {
    return {
      headline: "Sin perfil todavía",
      description: "Respondé al menos una situación para ver tu mezcla.",
    };
  }

  const second = findArchetype(archetypes, result.closeSecondId);
  return {
    headline: second ? `${top.name} con mucho de ${second.name}` : top.name,
    description: top.description,
  };
}

/** Lo que viaja en `meta`. Plano y serializable: el shell lo muestra crudo. */
export function profileMeta(
  result: ProfileResult,
  archetypes: readonly Archetype[],
  totalQuestions: number,
): Record<string, unknown> {
  const scores: Record<string, number> = {};
  for (const row of result.ranking) scores[row.id] = row.percent;

  const top = findArchetype(archetypes, result.topId);
  const second = findArchetype(archetypes, result.closeSecondId);

  return {
    profile: result.topId,
    profileName: top?.name ?? null,
    closeSecond: result.closeSecondId,
    closeSecondName: second?.name ?? null,
    scores,
    answered: result.answered,
    total: totalQuestions,
  };
}
