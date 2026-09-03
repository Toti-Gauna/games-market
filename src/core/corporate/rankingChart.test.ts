import { describe, expect, it } from "vitest";
import { aggregateRanking, type RankableItem, type RankingResponse } from "./ranking";
import {
  axisPosition,
  buildDivisionRows,
  decimal,
  divisionHeadline,
  scatterDots,
} from "./rankingChart";

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

/** El caso de la spec: catorce lo mandan primero, once lo mandan último. */
const SPLIT: readonly RankingResponse[] = [
  ...Array.from({ length: 14 }, () => ({ order: ["x", ...REST] })),
  ...Array.from({ length: 11 }, () => ({ order: [...REST, "x"] })),
];

describe("eje", () => {
  it("reparte las posiciones de extremo a extremo", () => {
    expect(axisPosition(1, 8)).toBe(0);
    expect(axisPosition(8, 8)).toBe(1);
    expect(axisPosition(4.5, 8)).toBeCloseTo(0.5, 10);
  });

  it("una sola tarjeta no tiene eje: va al centro y no divide por cero", () => {
    expect(axisPosition(1, 1)).toBe(0.5);
    expect(axisPosition(1, 0)).toBe(0.5);
  });

  it("una posición fuera de rango se recorta contra el eje", () => {
    expect(axisPosition(0, 8)).toBe(0);
    expect(axisPosition(99, 8)).toBe(1);
  });
});

describe("formato", () => {
  it("el promedio se escribe con coma, como en castellano", () => {
    expect(decimal(3.44)).toBe("3,4");
    expect(decimal(4)).toBe("4,0");
    expect(decimal(0)).toBe("0,0");
  });
});

describe("puntos", () => {
  const result = aggregateRanking(EIGHT, SPLIT);
  const divided = result.items.find((item) => item.id === "x");

  it("el ítem partido da dos puntos en los extremos y nada en el medio", () => {
    if (!divided) throw new Error("no está el ítem dividido");
    const dots = scatterDots(divided);
    expect(dots.map((dot) => dot.position)).toEqual([1, 8]);
    expect(dots.map((dot) => dot.count)).toEqual([14, 11]);
    expect(dots[0]?.at).toBe(0);
    expect(dots[1]?.at).toBe(1);
  });

  it("el peso compara contra el pico de la propia fila, no entre filas", () => {
    if (!divided) throw new Error("no está el ítem dividido");
    const dots = scatterDots(divided);
    expect(dots[0]?.weight).toBe(1);
    expect(dots[1]?.weight).toBeCloseTo(11 / 14, 10);
    expect(dots[0]?.pct).toBe(56);
    expect(dots[1]?.pct).toBe(44);
  });

  it("lo que nadie posicionó no dibuja ningún punto", () => {
    const empty = aggregateRanking(EIGHT, []);
    expect(scatterDots(empty.items[0] as never)).toEqual([]);
  });
});

describe("la frase", () => {
  it("dice los dos grupos, como en la spec", () => {
    expect(divisionHeadline({ samples: 25, topCount: 14, bottomCount: 11 })).toBe(
      "14 personas lo pusieron en el podio, 11 lo pusieron último.",
    );
  });

  it("concuerda en singular", () => {
    expect(divisionHeadline({ samples: 2, topCount: 1, bottomCount: 1 })).toBe(
      "1 persona lo puso en el podio, 1 lo puso último.",
    );
    expect(divisionHeadline({ samples: 1, topCount: 0, bottomCount: 1 })).toBe(
      "1 persona lo puso último.",
    );
  });

  it("con un solo puesto de podio no dice podio: dice primero", () => {
    expect(divisionHeadline({ samples: 5, topCount: 3, bottomCount: 0 }, 1)).toBe(
      "3 personas lo pusieron primero.",
    );
  });

  it("sin extremos y sin respuestas dice lo que pasó, no una frase vacía", () => {
    expect(divisionHeadline({ samples: 5, topCount: 0, bottomCount: 0 })).toBe(
      "Nadie lo mandó a un extremo.",
    );
    expect(divisionHeadline({ samples: 0, topCount: 0, bottomCount: 0 })).toBe(
      "Nadie lo posicionó.",
    );
  });
});

describe("filas del gráfico", () => {
  const result = aggregateRanking(EIGHT, SPLIT);
  const rows = buildDivisionRows(result);

  it("el más discutido va primero y es el único marcado", () => {
    expect(rows[0]?.id).toBe("x");
    expect(rows[0]?.leader).toBe(true);
    expect(rows.filter((row) => row.leader)).toHaveLength(1);
  });

  it("respeta el orden por desvío que ya resolvió el agregado", () => {
    expect(rows.map((row) => row.id)).toEqual(result.byDivision.map((item) => item.id));
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]?.deviation).toBeGreaterThanOrEqual(rows[i]?.deviation ?? 0);
    }
  });

  it("el tramo del desacuerdo cubre el eje entero cuando se va a los extremos", () => {
    expect(rows[0]?.spanFrom).toBe(0);
    expect(rows[0]?.spanTo).toBe(1);
    expect(rows[0]?.avgAt).toBeCloseTo(axisPosition(rows[0]?.avgPosition ?? 0, 8), 10);
  });

  it("el límite recorta y las filas sin respuestas no entran", () => {
    expect(buildDivisionRows(result, { limit: 3 })).toHaveLength(3);
    expect(buildDivisionRows(aggregateRanking(EIGHT, []))).toEqual([]);
  });

  it("sin desacuerdo no hay ítem destacado", () => {
    const agreed = aggregateRanking(EIGHT, [{ order: ["x", ...REST] }, { order: ["x", ...REST] }]);
    expect(buildDivisionRows(agreed).every((row) => !row.leader)).toBe(true);
  });
});
