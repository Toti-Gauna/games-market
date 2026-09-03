import {
  bool,
  records,
  str,
  type SettingsRecord,
  type SettingsValues,
} from "@/core/contract/settings";
import type { Rng } from "@/core/engine/rng";
import type { RankableItem } from "@/core/corporate/ranking";

/**
 * Lo unico propio de Prioridades: pasar de las tarjetas editables del panel al
 * conjunto activo, sembrar el orden inicial y armar el `meta` del outcome.
 *
 * Nada de esto puntua. No hay orden correcto: puntuar una opinion seria absurdo
 * y meteria en el ranking del tour un numero sin significado.
 */

/** Con mas de ocho, ordenar deja de ser una decision y pasa a ser una tarea. */
export const MAX_CARDS = 8;

/** El conjunto mas revelador, y el que mas conviene correr anonimo. */
export const PERSONAL_DECK_ID = "personal";

export type PriorityDeckMeta = {
  id: string;
  /** Como se llama el conjunto en el panel. */
  label: string;
  /** Titulo en el telefono. */
  title: string;
  /** La consigna. */
  prompt: string;
};

export const PRIORITY_DECKS: readonly PriorityDeckMeta[] = [
  {
    id: "producto",
    label: "Producto",
    title: "Al construir",
    prompt: "Ordená qué tiene que priorizar el equipo cuando construye.",
  },
  {
    id: "equipo",
    label: "Equipo",
    title: "Un buen lugar para trabajar",
    prompt: "Ordená qué hace bueno a un lugar de trabajo.",
  },
  {
    id: "cliente",
    label: "Cliente",
    title: "Del otro lado",
    prompt: "Ordená qué valora más quien nos usa.",
  },
  {
    id: "trimestre",
    label: "Trimestre",
    title: "Los objetivos del trimestre",
    prompt: "Ordená los objetivos del trimestre por importancia.",
  },
  {
    id: PERSONAL_DECK_ID,
    label: "Personal",
    title: "Qué buscás vos",
    prompt: "Ordená qué buscás vos en tu trabajo.",
  },
];

export const DECK_OPTIONS: ReadonlyArray<{ value: string; label: string }> = PRIORITY_DECKS.map(
  (deck) => ({ value: deck.id, label: deck.label }),
);

/**
 * Las ocho de cada conjunto.
 *
 * Cuatro reglas de escritura, y son las que hacen que el resultado sirva:
 *
 * 1. Todas las opciones tienen que ser deseables. Si hay una obviamente mala,
 *    todos la mandan ultima y el item no aporta: la tension aparece cuando hay
 *    que elegir entre cosas buenas.
 * 2. Menos de 40 caracteres, para que entren en una fila de telefono.
 * 3. Sin jerga interna que la mitad no entienda.
 * 4. Sin solapamiento: dos que dicen casi lo mismo se reparten los votos y el
 *    agregado pierde nitidez.
 */
export const DEFAULT_CARDS: Readonly<Record<string, readonly string[]>> = {
  producto: [
    "Entregar rápido",
    "Que no se rompa nada",
    "Cubrir más casos de uso",
    "Pagar la deuda técnica",
    "Que sea fácil de usar",
    "Escuchar a quien nos usa",
    "Dejar todo documentado",
    "Probar ideas nuevas",
  ],
  equipo: [
    "Compañeros de los que aprender",
    "Horarios flexibles",
    "Un jefe que escucha",
    "Objetivos claros",
    "Que se reconozca el trabajo",
    "Un sueldo acorde",
    "Poder desconectar al salir",
    "Lugar para equivocarse",
  ],
  cliente: [
    "Que sea rápido",
    "Que se entienda solo",
    "Que nunca se caiga",
    "Que cueste poco",
    "Que lo atiendan cuando escribe",
    "Que tenga todo lo que necesita",
    "Que cuiden sus datos",
    "Que mejore seguido",
  ],
  trimestre: [
    "Sumar clientes nuevos",
    "Retener a los que ya están",
    "Bajar los costos",
    "Lanzar la próxima versión",
    "Responder más rápido",
    "Ordenar los procesos internos",
    "Formar al equipo",
    "Entrar en un mercado nuevo",
  ],
  personal: [
    "Aprender algo nuevo",
    "Ganar mejor",
    "Tener tiempo libre",
    "Trabajar con gente que admiro",
    "Que lo que hago tenga sentido",
    "Crecer a un puesto mayor",
    "Estabilidad",
    "Decidir cómo hago mi trabajo",
  ],
};

/** Las 40 filas editables del panel: cinco conjuntos por ocho tarjetas. */
export function defaultCardRows(): SettingsRecord[] {
  const rows: SettingsRecord[] = [];
  for (const deck of PRIORITY_DECKS) {
    for (const label of DEFAULT_CARDS[deck.id] ?? []) rows.push({ deck: deck.id, label });
  }
  return rows;
}

export type PriorityCard = RankableItem;

export type PriorityDeck = {
  id: string;
  title: string;
  prompt: string;
  cards: readonly PriorityCard[];
  /** Sembrado con la semilla de la partida: el mismo para todos. */
  initialOrder: readonly string[];
  anonymous: boolean;
};

export function deckMeta(deckId: string): PriorityDeckMeta {
  return PRIORITY_DECKS.find((deck) => deck.id === deckId) ?? (PRIORITY_DECKS[0] as PriorityDeckMeta);
}

/** Ids estables dentro del conjunto: c1 es la primera tarjeta escrita. */
function toCards(labels: readonly string[]): PriorityCard[] {
  return labels
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .slice(0, MAX_CARDS)
    .map((label, index) => ({ id: `c${index + 1}`, label }));
}

/**
 * Las tarjetas del conjunto activo. Si el panel quedo sin tarjetas suficientes
 * se usan las de fabrica: un juego que no se puede jugar es peor que uno con
 * el contenido por defecto.
 */
export function deckCards(rows: readonly SettingsRecord[], deckId: string): PriorityCard[] {
  const labels = rows
    .filter((row) => row["deck"] === deckId)
    .map((row) => (typeof row["label"] === "string" ? row["label"] : ""));
  const cards = toCards(labels);
  return cards.length >= 2 ? cards : toCards(DEFAULT_CARDS[deckId] ?? []);
}

/**
 * `personal` expone a la persona: proyectar con nombre que alguien puso el
 * sueldo primero es otra cosa que mostrar el promedio del equipo.
 */
export function resolveAnonymous(
  deckId: string,
  anonymous: boolean,
  guardPersonal: boolean,
): boolean {
  if (deckId === PERSONAL_DECK_ID && guardPersonal) return true;
  return anonymous;
}

/**
 * El orden inicial sale del PRNG sembrado y es igual para todos.
 *
 * Si cada uno recibiera un orden distinto, el sesgo de anclaje (tendemos a
 * dejar arriba lo que ya estaba arriba) afectaria a cada persona de forma
 * distinta y ensuciaria el agregado. Igual para todos, el sesgo es parejo y se
 * puede descontar. Nunca `Math.random()`.
 */
export function seededOrder(cards: readonly PriorityCard[], rng: Rng): string[] {
  return rng.shuffle(cards.map((card) => card.id));
}

export function buildPriorityDeck(values: SettingsValues, rng: Rng): PriorityDeck {
  const id = str(values, "deck", PRIORITY_DECKS[0]?.id ?? "producto");
  const meta = deckMeta(id);
  const cards = deckCards(records(values, "cards"), meta.id);

  return {
    id: meta.id,
    title: meta.title,
    prompt: meta.prompt,
    cards,
    initialOrder: seededOrder(cards, rng),
    anonymous: resolveAnonymous(
      meta.id,
      bool(values, "anonymous", true),
      bool(values, "anonymousPersonal", true),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Movimiento y saneado                                                 */
/* ------------------------------------------------------------------ */

/** Fuera de rango no pasa nada: los bordes de la lista no se cruzan. */
export function moveCard(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...ids];
  next.splice(to, 0, moved);
  return next;
}

export function isCompleteOrder(order: readonly string[], cards: readonly PriorityCard[]): boolean {
  if (order.length !== cards.length) return false;
  const seen = new Set(order);
  return seen.size === cards.length && cards.every((card) => seen.has(card.id));
}

/**
 * Las tarjetas en el orden pedido, sin ids desconocidos y sin faltantes: un id
 * viejo guardado no puede dejar la lista incompleta.
 */
export function orderedCards(
  cards: readonly PriorityCard[],
  order: readonly string[],
): PriorityCard[] {
  const seen = new Set<string>();
  const out: PriorityCard[] = [];
  for (const id of order) {
    if (seen.has(id)) continue;
    const card = cards.find((candidate) => candidate.id === id);
    if (!card) continue;
    seen.add(id);
    out.push(card);
  }
  for (const card of cards) if (!seen.has(card.id)) out.push(card);
  return out;
}

/**
 * El `meta` del outcome. `orden` va en castellano porque asi lo consume el
 * agregado del proyector; las etiquetas viajan al lado para que el resultado
 * crudo se pueda leer sin tener el conjunto a mano.
 *
 * Nunca viaja quien respondio: el juego directamente no tiene con que romper el
 * anonimato.
 */
export function priorityMeta(
  deck: PriorityDeck,
  order: readonly string[],
): Record<string, unknown> {
  const cards = orderedCards(deck.cards, order);
  return {
    deck: deck.id,
    orden: cards.map((card) => card.id),
    labels: cards.map((card) => card.label),
    anonymous: deck.anonymous,
    total: deck.cards.length,
  };
}
