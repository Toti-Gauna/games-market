import { describe, expect, it } from "vitest";
import { aggregateRanking, type RankableItem, type RankingResponse } from "./ranking";

/* Cuatro items y cinco respuestas, para poder verificar el consenso a mano. */
const SMALL: readonly RankableItem[] = [
  { id: "a", label: "Entregar rápido" },
  { id: "b", label: "Que no se rompa nada" },
  { id: "c", label: "Cubrir más casos de uso" },
  { id: "d", label: "Pagar la deuda técnica" },
];

const FIVE: readonly RankingResponse[] = [
  { order: ["a", "b", "c", "d"] },
  { order: ["a", "b", "d", "c"] },
  { order: ["b", "a", "c", "d"] },
  { order: ["a", "c", "b", "d"] },
  { order: ["b", "a", "d", "c"] },
];

const EIGHT: readonly RankableItem[] = [
  { id: "x", label: "Entregar rápido" },
  { id: "i2", label: "Que no se rompa nada" },
  { id: "i3", label: "Cubrir más casos de uso" },
  { id: "i4", label: "Pagar la deuda técnica" },
  { id: "i5", label: "Que sea fácil de usar" },
  { id: "i6", label: "Escuchar a quien nos usa" },
  { id: "i7", label: "Documentar lo que hacemos" },
  { id: "i8", label: "Probar ideas nuevas" },
];

const REST = ["i2", "i3", "i4", "i5", "i6", "i7", "i8"];

/** Cuatro lo ponen primero y cuatro lo ponen último: el equipo partido al medio. */
const SPLIT: readonly RankingResponse[] = [
  ...Array.from({ length: 4 }, () => ({ order: ["x", ...REST] })),
  ...Array.from({ length: 4 }, () => ({ order: [...REST, "x"] })),
];

function itemById(items: ReturnType<typeof aggregateRanking>["items"], id: string) {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`no está el item ${id}`);
  return found;
}

describe("consenso", () => {
  const result = aggregateRanking(SMALL, FIVE);

  it("la posición media sale de las cinco respuestas, cuenta hecha a mano", () => {
    // a: 1,1,2,1,2 = 7/5 · b: 2,2,1,3,1 = 9/5 · c: 3,4,3,2,4 = 16/5 · d: 4,3,4,4,3 = 18/5
    expect(itemById(result.items, "a").avgPosition).toBeCloseTo(1.4, 10);
    expect(itemById(result.items, "b").avgPosition).toBeCloseTo(1.8, 10);
    expect(itemById(result.items, "c").avgPosition).toBeCloseTo(3.2, 10);
    expect(itemById(result.items, "d").avgPosition).toBeCloseTo(3.6, 10);
    expect(result.responses).toBe(5);
  });

  it("ordena por posición media ascendente y numera el puesto", () => {
    expect(result.items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(result.items.map((item) => item.consensusPosition)).toEqual([1, 2, 3, 4]);
  });

  it("el desvío es el poblacional de las posiciones", () => {
    // a: media 1.4, sumatoria de cuadrados 1.2, dividido 5 = 0.24
    expect(itemById(result.items, "a").deviation).toBeCloseTo(Math.sqrt(0.24), 10);
  });

  it("guarda la distribución, los extremos y el último puesto", () => {
    const a = itemById(result.items, "a");
    expect(a.distribution).toEqual([3, 2, 0, 0]);
    expect(a.minPosition).toBe(1);
    expect(a.maxPosition).toBe(2);
    expect(a.bottomCount).toBe(0);
    expect(itemById(result.items, "d").bottomCount).toBe(3);
    expect(a.samples).toBe(5);
  });

  it("un empate se rompe por el orden declarado, no por el azar", () => {
    const tied = aggregateRanking(SMALL, [
      { order: ["a", "b", "c", "d"] },
      { order: ["b", "a", "d", "c"] },
    ]);
    // a y b promedian 1.5; c y d promedian 3.5.
    expect(tied.items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("división", () => {
  const result = aggregateRanking(EIGHT, SPLIT);

  it("identifica el ítem más dividido: mitad primero, mitad último", () => {
    expect(result.mostDividedId).toBe("x");
    expect(result.byDivision[0]?.id).toBe("x");
  });

  it("el desvío del dividido es mucho mayor que el del resto", () => {
    // x: 1,1,1,1,8,8,8,8 → media 4.5, desvío 3.5. El resto se corre un puesto: 0.5.
    const x = itemById(result.items, "x");
    expect(x.avgPosition).toBeCloseTo(4.5, 10);
    expect(x.deviation).toBeCloseTo(3.5, 10);
    for (const item of result.items) {
      if (item.id !== "x") expect(item.deviation).toBeCloseTo(0.5, 10);
    }
  });

  it("cuenta cuántos lo pusieron en el podio y cuántos último", () => {
    const x = itemById(result.items, "x");
    expect(x.topCount).toBe(4);
    expect(x.bottomCount).toBe(4);
    expect(x.minPosition).toBe(1);
    expect(x.maxPosition).toBe(8);
    expect(x.distribution).toEqual([4, 0, 0, 0, 0, 0, 0, 4]);
  });

  it("la media esconde la grieta: en el consenso queda en el medio", () => {
    // 4.5 de promedio lo deja cuarto, como si a nadie le importara demasiado.
    expect(itemById(result.items, "x").consensusPosition).toBe(4);
  });

  it("sin respuestas o con acuerdo total no hay ítem discutido", () => {
    expect(aggregateRanking(EIGHT, []).mostDividedId).toBeNull();
    const agreed = aggregateRanking(SMALL, [
      { order: ["a", "b", "c", "d"] },
      { order: ["a", "b", "c", "d"] },
    ]);
    expect(agreed.mostDividedId).toBeNull();
    expect(agreed.items.every((item) => item.deviation === 0)).toBe(true);
  });
});

describe("anonimato", () => {
  const named: readonly RankingResponse[] = [
    { order: ["a", "b", "c", "d"], participantId: "ana" },
    { order: ["b", "a", "d", "c"], participantId: "bruno" },
  ];

  it("con anonymous el participantId no llega al resultado", () => {
    const result = aggregateRanking(SMALL, named, { anonymous: true });
    expect(result.anonymous).toBe(true);
    expect(result.participants).toEqual([]);
    const raw = JSON.stringify(result);
    expect(raw).not.toContain("ana");
    expect(raw).not.toContain("bruno");
    expect(raw).not.toContain("participantId");
  });

  it("descartar el id no cambia el consenso: se agrega igual", () => {
    const anon = aggregateRanking(SMALL, named, { anonymous: true });
    const open = aggregateRanking(SMALL, named, { anonymous: false });
    expect(anon.items.map((item) => item.avgPosition)).toEqual(
      open.items.map((item) => item.avgPosition),
    );
    expect(open.participants).toEqual(["ana", "bruno"]);
  });
});

describe("respuestas sucias", () => {
  it("una respuesta parcial aporta lo que tenga", () => {
    const result = aggregateRanking(SMALL, [{ order: ["a", "b"] }, { order: ["a", "b", "c", "d"] }]);
    expect(itemById(result.items, "a").samples).toBe(2);
    expect(itemById(result.items, "c").samples).toBe(1);
    expect(itemById(result.items, "d").avgPosition).toBe(4);
  });

  it("ids desconocidos y repetidos no cuentan ni corren las posiciones", () => {
    const result = aggregateRanking(SMALL, [{ order: ["z", "a", "a", "b", "c", "d"] }]);
    expect(itemById(result.items, "a").avgPosition).toBe(1);
    expect(itemById(result.items, "b").avgPosition).toBe(2);
    expect(itemById(result.items, "a").samples).toBe(1);
  });

  it("lo que nadie posicionó queda al final y sin desvío", () => {
    const result = aggregateRanking(SMALL, [{ order: ["b", "c"] }]);
    const last = result.items[result.items.length - 1];
    expect(last?.samples).toBe(0);
    expect(last?.avgPosition).toBe(0);
    expect(result.items.slice(0, 2).map((item) => item.id)).toEqual(["b", "c"]);
  });
});
