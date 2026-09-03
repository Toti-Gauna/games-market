import { describe, expect, it } from "vitest";
import { schemaDefaults } from "@/core/contract/settings";
import { createRng } from "@/core/engine/rng";
import { buildPriorityDeck } from "./logic";
import {
  createPriorityRoom,
  isPriorityInput,
  projectorMeta,
  receiveOrder,
  roomAggregate,
  roomResponses,
  roomState,
  sanitizeOrder,
  type PriorityInput,
} from "./room";
import { prioridadesSettings } from "./settings";

const defaults = schemaDefaults(prioridadesSettings);

function deckOf(anonymous: boolean) {
  return buildPriorityDeck({ ...defaults, anonymous }, createRng("abc7"));
}

function orderInput(deck: ReturnType<typeof deckOf>, order: readonly string[]): PriorityInput {
  return { kind: "order", deck: deck.id, order };
}

describe("lo que entra por la red", () => {
  const deck = deckOf(false);

  it("acepta una forma válida y rechaza cualquier otra cosa", () => {
    expect(isPriorityInput(orderInput(deck, ["c1"]))).toBe(true);
    expect(isPriorityInput({ kind: "pick", optionId: "c1" })).toBe(false);
    expect(isPriorityInput({ kind: "order", deck: "producto" })).toBe(false);
    expect(isPriorityInput(null)).toBe(false);
    expect(isPriorityInput("c1,c2")).toBe(false);
  });

  it("el orden se sanea contra las tarjetas de la sala", () => {
    expect(sanitizeOrder(deck.cards, ["c3", "zz", "c3", "c1", 7, null])).toEqual(["c3", "c1"]);
  });

  it("no se puede mandar más ids que tarjetas hay", () => {
    const flood = Array.from({ length: 5000 }, (_, i) => `c${(i % 8) + 1}`);
    expect(sanitizeOrder(deck.cards, flood)).toHaveLength(deck.cards.length);
  });
});

describe("recolección en el host", () => {
  it("cuenta una respuesta por aparato y descarta el segundo intento", () => {
    const deck = deckOf(false);
    const room = createPriorityRoom(deck);
    const order = deck.cards.map((card) => card.id);

    expect(receiveOrder(room, "p1", "Ana", orderInput(deck, order))).toBe("accepted");
    expect(receiveOrder(room, "p1", "Ana", orderInput(deck, [...order].reverse()))).toBe("repeat");
    expect(room.entries.size).toBe(1);
    // El primero que llegó es el que cuenta: "no se puede cambiar" en serio.
    expect(room.entries.get("p1")?.order).toEqual(order);
  });

  it("descarta un orden de otro conjunto y uno que no deja nada en pie", () => {
    const deck = deckOf(false);
    const room = createPriorityRoom(deck);
    expect(receiveOrder(room, "p1", "Ana", { kind: "order", deck: "equipo", order: ["c1"] })).toBe(
      "invalid",
    );
    expect(receiveOrder(room, "p2", "Bruno", orderInput(deck, ["zz", "yy"]))).toBe("invalid");
    expect(receiveOrder(room, "p3", "Cami", { kind: "press", buttonId: "a" })).toBe("invalid");
    expect(room.entries.size).toBe(0);
  });

  it("el host junta respuestas y calcula él el agregado", () => {
    const deck = deckOf(false);
    const room = createPriorityRoom(deck);
    const ids = deck.cards.map((card) => card.id);
    const first = ids[0] as string;
    const rest = ids.slice(1);

    // Cuatro lo mandan primero, cuatro lo mandan último: la grieta armada.
    for (let i = 0; i < 4; i += 1) {
      receiveOrder(room, `top-${i}`, `Arriba ${i}`, orderInput(deck, [first, ...rest]));
      receiveOrder(room, `bottom-${i}`, `Abajo ${i}`, orderInput(deck, [...rest, first]));
    }

    const aggregate = roomAggregate(room);
    expect(aggregate.responses).toBe(8);
    expect(aggregate.mostDividedId).toBe(first);
    expect(aggregate.items.find((item) => item.id === first)?.deviation).toBeCloseTo(3.5, 10);
  });
});

describe("anonimato en el camino de red", () => {
  const deck = deckOf(true);

  it("con la ronda anónima el nombre no se guarda ni llega al agregado", () => {
    expect(deck.anonymous).toBe(true);
    const room = createPriorityRoom(deck);
    receiveOrder(room, "p1", "Ana", orderInput(deck, ["c1", "c2"]));
    receiveOrder(room, "p2", "Bruno", orderInput(deck, ["c2", "c1"]));

    expect(room.arrivals).toEqual([]);
    expect(JSON.stringify([...room.entries.values()])).not.toContain("Ana");
    // El participantId ni siquiera se arma: no es que no se muestre.
    expect(roomResponses(room).every((response) => response.participantId === undefined)).toBe(true);

    const aggregate = roomAggregate(room);
    expect(aggregate.anonymous).toBe(true);
    expect(aggregate.participants).toEqual([]);
    expect(JSON.stringify(aggregate)).not.toContain("Ana");
    expect(JSON.stringify(projectorMeta(room, aggregate))).not.toContain("Bruno");
  });

  it("sin anonimato los nombres llegan y quedan por orden de llegada", () => {
    const open = deckOf(false);
    const room = createPriorityRoom(open);
    receiveOrder(room, "p1", "Ana", orderInput(open, ["c1", "c2"]));
    receiveOrder(room, "p2", "Bruno", orderInput(open, ["c2", "c1"]));

    expect(room.arrivals).toEqual(["Ana", "Bruno"]);
    expect(roomAggregate(room).participants).toEqual(["Ana", "Bruno"]);
  });

  it("descartar el nombre no cambia el consenso", () => {
    const open = deckOf(false);
    const anon = createPriorityRoom(deck);
    const named = createPriorityRoom(open);
    for (const [id, name] of [["p1", "Ana"], ["p2", "Bruno"]] as const) {
      receiveOrder(anon, id, name, orderInput(deck, ["c1", "c2", "c3"]));
      receiveOrder(named, id, name, orderInput(open, ["c1", "c2", "c3"]));
    }
    expect(roomAggregate(anon).items.map((item) => item.avgPosition)).toEqual(
      roomAggregate(named).items.map((item) => item.avgPosition),
    );
  });
});

describe("lo que se difunde", () => {
  const deck = deckOf(false);

  it("mientras se responde no viaja ningún resultado", () => {
    const room = createPriorityRoom(deck);
    receiveOrder(room, "p1", "Ana", orderInput(deck, ["c1", "c2"]));
    const state = roomState(room, "respondiendo", 12, roomAggregate(room));

    expect(state.result).toBeNull();
    expect(state.answered).toBe(1);
    expect(state.eligible).toBe(12);
    expect(JSON.stringify(state)).not.toContain("avgPosition");
  });

  it("recién en el consenso viaja el agregado", () => {
    const room = createPriorityRoom(deck);
    receiveOrder(room, "p1", "Ana", orderInput(deck, ["c1", "c2"]));
    const aggregate = roomAggregate(room);
    expect(roomState(room, "consenso", 1, aggregate).result).toBe(aggregate);
    expect(roomState(room, "division", 1, aggregate).result).toBe(aggregate);
  });

  it("el orden sembrado del proyector viaja siempre: es el mismo para todos", () => {
    const room = createPriorityRoom(deck);
    for (const moment of ["respondiendo", "consenso", "division"] as const) {
      expect(roomState(room, moment, 0, null).initialOrder).toEqual(deck.initialOrder);
    }
  });

  it("nunca se anuncia menos gente de la que ya respondió", () => {
    const room = createPriorityRoom(deck);
    receiveOrder(room, "p1", "Ana", orderInput(deck, ["c1"]));
    receiveOrder(room, "p2", "Bruno", orderInput(deck, ["c2"]));
    // Un teléfono que se desconectó después de responder sale del roster, pero
    // su respuesta sigue contada: "3 de 1" sería absurdo.
    expect(roomState(room, "respondiendo", 0, null).eligible).toBe(2);
  });
});

describe("meta del proyector", () => {
  it("lleva el consenso, la división y el ítem discutido, sin puntaje", () => {
    const deck = deckOf(true);
    const room = createPriorityRoom(deck);
    const ids = deck.cards.map((card) => card.id);
    const first = ids[0] as string;
    const rest = ids.slice(1);
    receiveOrder(room, "a", "", orderInput(deck, [first, ...rest]));
    receiveOrder(room, "b", "", orderInput(deck, [...rest, first]));

    const meta = projectorMeta(room, roomAggregate(room));
    expect(meta["mostDividedId"]).toBe(first);
    expect(meta["responses"]).toBe(2);
    expect(meta["anonymous"]).toBe(true);
    expect(Object.keys(meta)).not.toContain("points");
    expect((meta["consenso"] as unknown[]).length).toBe(deck.cards.length);
    expect((meta["division"] as unknown[]).length).toBe(deck.cards.length);
  });
});
