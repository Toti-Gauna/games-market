import {
  aggregateRanking,
  type RankingAggregate,
  type RankingResponse,
} from "@/core/corporate/ranking";
import type { PriorityCard, PriorityDeck } from "./logic";

/**
 * La sala del proyector: lo unico propio del camino de red de Prioridades.
 *
 * Dos reglas mandan sobre todo lo demas:
 *
 * 1. **El host recibe respuestas, nunca resultados.** Del telefono entra un
 *    orden de ids y nada mas. Las medias, el desvio y el item mas dividido los
 *    calcula el proyector con `aggregateRanking`; un cliente modificado no
 *    tiene por donde mandar un promedio ya hecho.
 * 2. **El anonimato se cumple en el camino, no en la vista.** Con la ronda
 *    anonima el nombre de quien responde NO SE GUARDA y el `participantId` no
 *    se arma: no llega al agregado porque no existe. Prometer anonimato y
 *    limitarse a no dibujarlo es no cumplirlo.
 *
 * La clave del mapa es el id de red del aparato. Vive aca adentro y no sale
 * nunca: sirve para no contar dos veces al mismo telefono, que es la unica
 * forma de que "no se puede cambiar despues" sea cierto.
 */

/** Una sala corporativa, no cuatro paletas. Espeja `maxPlayers` del registry. */
export const ROOM_SEATS = 40;

/** Lo que un telefono manda al proyector. */
export type PriorityInput = {
  kind: "order";
  /** El conjunto que estaba ordenando. Un orden de otro conjunto se descarta. */
  deck: string;
  order: readonly string[];
};

export type PriorityMoment = "respondiendo" | "consenso" | "division";

/** Lo que el proyector le difunde a los telefonos. */
export type PriorityNetState = {
  moment: PriorityMoment;
  answered: number;
  eligible: number;
  anonymous: boolean;
  /**
   * El orden inicial sembrado, tal como lo dibuja el proyector.
   *
   * Viaja porque el orden tiene que ser **el mismo para todos**: si cada uno
   * recibiera un orden distinto, el sesgo de anclaje —tendemos a dejar arriba
   * lo que ya estaba arriba— afectaria a cada persona de forma distinta y
   * ensuciaria el agregado. La semilla ya deberia alcanzar, pero el que manda
   * es el proyector: un telefono que arranco con otra semilla adopta esta
   * mientras todavia no toco nada.
   */
  initialOrder: readonly string[];
  /**
   * null mientras se responde, SIEMPRE.
   *
   * No es una optimizacion de trafico: es lo que hace imposible que un telefono
   * dibuje un resultado parcial. Ver el consenso a medias cambia lo que ordena
   * quien todavia no contesto, y el agregado pasa a medir lo que la sala vio en
   * la pantalla en vez de lo que la sala piensa.
   */
  result: RankingAggregate | null;
};

export type PriorityEntry = {
  order: readonly string[];
  /** Vacio en una ronda anonima: el nombre directamente no se guarda. */
  name: string;
};

export type PriorityRoom = {
  deckId: string;
  cards: readonly PriorityCard[];
  /** El orden sembrado que la sala tiene que ver. Lo fija el proyector. */
  initialOrder: readonly string[];
  anonymous: boolean;
  /** Un orden por aparato. La clave no sale de este objeto. */
  entries: Map<string, PriorityEntry>;
  /** Los nombres por orden de llegada. Vacio en una ronda anonima. */
  arrivals: string[];
};

/** "repeat" no es un error: es el mismo aparato reintentando, y ya esta contado. */
export type PriorityReceipt = "accepted" | "repeat" | "invalid";

export function createPriorityRoom(deck: PriorityDeck): PriorityRoom {
  return {
    deckId: deck.id,
    cards: deck.cards,
    initialOrder: deck.initialOrder,
    anonymous: deck.anonymous,
    entries: new Map(),
    arrivals: [],
  };
}

/**
 * Lo que llega por la red es texto ajeno hasta que se demuestre lo contrario.
 * Se comprueba la forma antes de tocarlo.
 */
export function isPriorityInput(value: unknown): value is PriorityInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PriorityInput>;
  return (
    candidate.kind === "order" &&
    typeof candidate.deck === "string" &&
    Array.isArray(candidate.order)
  );
}

/**
 * El orden crudo, saneado contra las tarjetas de la sala.
 *
 * `aggregateRanking` ya ignora ids desconocidos y repetidos, asi que esto no
 * es por correccion sino por tamano: sin el tope, un cliente modificado puede
 * mandar cien mil ids y quedarse en la memoria del proyector toda la ronda.
 */
export function sanitizeOrder(
  cards: readonly PriorityCard[],
  order: readonly unknown[],
): string[] {
  const known = new Set(cards.map((card) => card.id));
  const seen = new Set<string>();
  const out: string[] = [];

  for (const id of order) {
    if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cards.length) break;
  }

  return out;
}

/**
 * Entra una respuesta.
 *
 * El primero que llega es el que cuenta: el segundo mensaje del mismo aparato
 * se descarta, porque el telefono avisa antes de mandar que despues no se puede
 * cambiar y hay que sostenerlo aunque alguien recargue la pagina.
 */
export function receiveOrder(
  room: PriorityRoom,
  playerId: string,
  name: string,
  input: unknown,
): PriorityReceipt {
  if (!isPriorityInput(input)) return "invalid";
  // Cambiar el conjunto desde el panel a mitad de ronda invalida lo anterior:
  // mezclarlos daria un promedio de dos preguntas distintas.
  if (input.deck !== room.deckId) return "invalid";
  if (room.entries.has(playerId)) return "repeat";

  const order = sanitizeOrder(room.cards, input.order);
  if (order.length === 0) return "invalid";

  // Aca se cumple el anonimato: sin nombre guardado no hay nada que filtrar
  // despues, ni por descuido ni por un `JSON.stringify` de mas.
  const label = room.anonymous ? "" : name;
  room.entries.set(playerId, { order, name: label });
  if (!room.anonymous) room.arrivals.push(label);

  return "accepted";
}

/** Las respuestas tal como las pide `aggregateRanking`. */
export function roomResponses(room: PriorityRoom): RankingResponse[] {
  const out: RankingResponse[] = [];
  for (const entry of room.entries.values()) {
    // El `participantId` ni siquiera se arma en una ronda anonima.
    out.push(room.anonymous ? { order: entry.order } : { order: entry.order, participantId: entry.name });
  }
  return out;
}

export function roomAggregate(room: PriorityRoom): RankingAggregate {
  return aggregateRanking(room.cards, roomResponses(room), { anonymous: room.anonymous });
}

/**
 * El estado que se difunde.
 *
 * El agregado viaja UNICAMENTE cuando el momento dejo de ser "respondiendo".
 * La regla de no mostrar parciales queda en el protocolo y no en la vista: un
 * telefono no puede dibujar lo que nunca recibio.
 */
export function roomState(
  room: PriorityRoom,
  moment: PriorityMoment,
  eligible: number,
  result: RankingAggregate | null,
): PriorityNetState {
  return {
    moment,
    answered: room.entries.size,
    eligible: Math.max(eligible, room.entries.size),
    anonymous: room.anonymous,
    initialOrder: room.initialOrder,
    result: moment === "respondiendo" ? null : result,
  };
}

/**
 * El `meta` del outcome del proyector.
 *
 * Sale del agregado, que ya viene anonimizado: si la ronda fue anonima no hay
 * un solo nombre que copiar. Sin puntaje, como todo el juego.
 */
export function projectorMeta(
  room: PriorityRoom,
  aggregate: RankingAggregate,
): Record<string, unknown> {
  return {
    deck: room.deckId,
    anonymous: room.anonymous,
    responses: aggregate.responses,
    total: room.cards.length,
    mostDividedId: aggregate.mostDividedId,
    consenso: aggregate.items.map((item) => ({
      id: item.id,
      label: item.label,
      media: Number(item.avgPosition.toFixed(3)),
      desvio: Number(item.deviation.toFixed(3)),
    })),
    division: aggregate.byDivision.map((item) => ({
      id: item.id,
      desvio: Number(item.deviation.toFixed(3)),
      podio: item.topCount,
      ultimo: item.bottomCount,
      reparto: item.distribution,
    })),
  };
}
