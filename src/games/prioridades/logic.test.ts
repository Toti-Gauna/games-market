import { describe, expect, it } from "vitest";
import { schemaDefaults, type SettingsRecord } from "@/core/contract/settings";
import { createRng } from "@/core/engine/rng";
import { prioridadesSettings } from "./settings";
import {
  DEFAULT_CARDS,
  MAX_CARDS,
  PRIORITY_DECKS,
  buildPriorityDeck,
  deckCards,
  isCompleteOrder,
  moveCard,
  orderedCards,
  priorityMeta,
  resolveAnonymous,
  seededOrder,
} from "./logic";

const defaults = schemaDefaults(prioridadesSettings);
const defaultRows = defaults["cards"] as SettingsRecord[];

describe("contenido", () => {
  it("hay cinco conjuntos de ocho tarjetas", () => {
    expect(PRIORITY_DECKS).toHaveLength(5);
    for (const deck of PRIORITY_DECKS) {
      expect(deckCards(defaultRows, deck.id)).toHaveLength(MAX_CARDS);
    }
    expect(defaultRows).toHaveLength(5 * MAX_CARDS);
  });

  it("las tarjetas entran en una fila de teléfono y no se repiten", () => {
    for (const deck of PRIORITY_DECKS) {
      const labels = DEFAULT_CARDS[deck.id] ?? [];
      for (const label of labels) {
        expect(label.trim().length).toBeGreaterThan(0);
        expect(label.length).toBeLessThan(40);
      }
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("un conjunto vaciado desde el panel vuelve a las tarjetas de fábrica", () => {
    const cards = deckCards([{ deck: "producto", label: "Una sola" }], "producto");
    expect(cards).toHaveLength(MAX_CARDS);
    expect(cards[0]?.label).toBe("Entregar rápido");
  });

  it("nunca se dibujan más de ocho", () => {
    const rows: SettingsRecord[] = Array.from({ length: 12 }, (_, i) => ({
      deck: "producto",
      label: `Tarjeta ${i + 1}`,
    }));
    expect(deckCards(rows, "producto")).toHaveLength(MAX_CARDS);
  });
});

describe("orden inicial sembrado", () => {
  it("todos reciben el mismo orden inicial con la misma semilla", () => {
    const a = buildPriorityDeck(defaults, createRng("abc7"));
    const b = buildPriorityDeck(defaults, createRng("abc7"));
    expect(a.initialOrder).toEqual(b.initialOrder);
  });

  it("es una permutación completa de las ocho tarjetas", () => {
    const deck = buildPriorityDeck(defaults, createRng("abc7"));
    expect([...deck.initialOrder].sort()).toEqual([...deck.cards.map((card) => card.id)].sort());
    expect(isCompleteOrder(deck.initialOrder, deck.cards)).toBe(true);
  });

  it("otra semilla da otro orden: no está fijo, está sembrado", () => {
    const variants = ["abc7", "zzz9", "k4m2"].map((seed) =>
      buildPriorityDeck(defaults, createRng(seed)).initialOrder.join(","),
    );
    expect(new Set(variants).size).toBeGreaterThan(1);
  });

  it("seededOrder no toca las tarjetas que recibe", () => {
    const cards = [
      { id: "c1", label: "A" },
      { id: "c2", label: "B" },
    ];
    seededOrder(cards, createRng("abc7"));
    expect(cards.map((card) => card.id)).toEqual(["c1", "c2"]);
  });
});

describe("mover", () => {
  const ids = ["c1", "c2", "c3", "c4"];

  it("sube y baja una tarjeta", () => {
    expect(moveCard(ids, 2, 0)).toEqual(["c3", "c1", "c2", "c4"]);
    expect(moveCard(ids, 0, 3)).toEqual(["c2", "c3", "c4", "c1"]);
    expect(moveCard(ids, 1, 2)).toEqual(["c1", "c3", "c2", "c4"]);
  });

  it("los bordes no se cruzan", () => {
    expect(moveCard(ids, 0, -1)).toEqual(ids);
    expect(moveCard(ids, 3, 4)).toEqual(ids);
    expect(moveCard(ids, 2, 2)).toEqual(ids);
    expect(moveCard(ids, 9, 0)).toEqual(ids);
  });

  it("devuelve una copia: la lista original no se muta", () => {
    const moved = moveCard(ids, 0, 1);
    expect(moved).not.toBe(ids);
    expect(ids).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("mover no pierde ni duplica tarjetas", () => {
    const deck = buildPriorityDeck(defaults, createRng("abc7"));
    let order: readonly string[] = deck.initialOrder;
    order = moveCard(order, 7, 0);
    order = moveCard(order, 3, 5);
    order = moveCard(order, 0, 1);
    expect(isCompleteOrder(order, deck.cards)).toBe(true);
  });
});

describe("saneado del orden", () => {
  const cards = [
    { id: "c1", label: "Uno" },
    { id: "c2", label: "Dos" },
    { id: "c3", label: "Tres" },
  ];

  it("descarta ids desconocidos y repetidos, y completa los que faltan", () => {
    expect(orderedCards(cards, ["c3", "zz", "c3"]).map((card) => card.id)).toEqual([
      "c3",
      "c1",
      "c2",
    ]);
  });

  it("un orden incompleto no cuenta como respuesta completa", () => {
    expect(isCompleteOrder(["c1", "c2"], cards)).toBe(false);
    expect(isCompleteOrder(["c1", "c2", "c2"], cards)).toBe(false);
    expect(isCompleteOrder(["c3", "c1", "c2"], cards)).toBe(true);
  });
});

describe("meta del outcome", () => {
  const deck = buildPriorityDeck(defaults, createRng("abc7"));

  it("serializa el orden completo con sus etiquetas alineadas", () => {
    const order = moveCard(deck.initialOrder, 5, 0);
    const meta = priorityMeta(deck, order);
    expect(meta["orden"]).toEqual([...order]);
    expect(meta["deck"]).toBe("producto");
    expect(meta["total"]).toBe(MAX_CARDS);

    const labels = meta["labels"] as string[];
    expect(labels).toHaveLength(MAX_CARDS);
    expect(labels[0]).toBe(deck.cards.find((card) => card.id === order[0])?.label);
  });

  it("un orden a medias se completa antes de emitirse", () => {
    const meta = priorityMeta(deck, ["c4"]);
    expect((meta["orden"] as string[])[0]).toBe("c4");
    expect(meta["orden"]).toHaveLength(MAX_CARDS);
  });

  it("no hay forma de saber quién ordenó: el meta solo tiene el orden", () => {
    const meta = priorityMeta(deck, deck.initialOrder);
    expect(Object.keys(meta).sort()).toEqual(["anonymous", "deck", "labels", "orden", "total"]);
    expect(JSON.stringify(meta)).not.toContain("participant");
  });
});

describe("anonimato", () => {
  it("el conjunto personal va anónimo aunque se apague el anónimo general", () => {
    expect(resolveAnonymous("personal", false, true)).toBe(true);
    expect(resolveAnonymous("producto", false, true)).toBe(false);
  });

  it("la guardia se puede apagar a propósito, no por descuido", () => {
    expect(resolveAnonymous("personal", false, false)).toBe(false);
    expect(resolveAnonymous("personal", true, false)).toBe(true);
  });

  it("los administrables por defecto arrancan anónimos", () => {
    expect(buildPriorityDeck(defaults, createRng("abc7")).anonymous).toBe(true);
    expect(
      buildPriorityDeck({ ...defaults, deck: "personal", anonymous: false }, createRng("abc7"))
        .anonymous,
    ).toBe(true);
  });
});
