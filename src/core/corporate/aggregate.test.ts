import { describe, expect, it } from "vitest";
import {
  aggregateBars,
  aggregateCloud,
  aggregateProfiles,
  aggregateScale,
  isBlockedText,
  percentages,
  stripIdentity,
} from "./aggregate";

describe("percentages", () => {
  it("suman exactamente 100 aunque los decimales no cierren", () => {
    // Tres tercios redondeados por separado dan 99. En una pantalla de tres
    // metros eso se ve.
    expect(percentages([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("reparten el resto al de fraccion mas alta", () => {
    expect(percentages([5, 3, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentages([1, 2, 3, 4, 5, 6, 7]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("sin respuestas devuelve todo en cero, no NaN", () => {
    expect(percentages([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("es estable: los empates se rompen por orden, no al azar", () => {
    expect(percentages([1, 1, 1])).toEqual(percentages([1, 1, 1]));
  });
});

describe("aggregateBars", () => {
  const options = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ];

  it("cuenta cada opcion y reparte porcentajes que suman 100", () => {
    const result = aggregateBars({ options, picks: ["a", "a", "b"] });
    expect(result.total).toBe(3);
    expect(result.options.map((o) => o.count)).toEqual([2, 1, 0]);
    expect(result.options.reduce((sum, o) => sum + o.pct, 0)).toBe(100);
  });

  it("no marca la correcta mientras no se la pasen", () => {
    const open = aggregateBars({ options, picks: ["a"] });
    expect(open.options.every((o) => o.correct === undefined)).toBe(true);

    const closed = aggregateBars({ options, picks: ["a"], correctId: "b" });
    expect(closed.options.find((o) => o.id === "b")?.correct).toBe(true);
    expect(closed.options.find((o) => o.id === "a")?.correct).toBe(false);
  });

  it("una opcion que nadie eligio sigue apareciendo en cero", () => {
    const result = aggregateBars({ options, picks: [] });
    expect(result.options).toHaveLength(3);
    expect(result.options.every((o) => o.count === 0 && o.pct === 0)).toBe(true);
  });
});

describe("aggregateScale", () => {
  it("promedia y distribuye", () => {
    const result = aggregateScale([1, 3, 3, 5], 1, 5);
    expect(result.avg).toBe(3);
    expect(result.distribution).toEqual([1, 0, 2, 0, 1]);
    expect(result.total).toBe(4);
  });

  it("recorta lo que se va de rango en vez de romper la distribucion", () => {
    const result = aggregateScale([0, 9], 1, 5);
    expect(result.distribution).toEqual([1, 0, 0, 0, 1]);
  });

  it("sin respuestas el promedio es 0 y no NaN", () => {
    expect(aggregateScale([], 1, 5).avg).toBe(0);
  });
});

describe("aggregateCloud", () => {
  it("cuenta palabras y saca acentos y mayusculas", () => {
    const result = aggregateCloud(["Colaboración", "colaboracion", "COLABORACIÓN"]);
    expect(result.words[0]).toEqual({ text: "colaboracion", weight: 3 });
  });

  it("descarta las palabras vacias", () => {
    const result = aggregateCloud(["el equipo y la confianza"]);
    const texts = result.words.map((w) => w.text);
    expect(texts).not.toContain("el");
    expect(texts).not.toContain("la");
    expect(texts).toContain("equipo");
    expect(texts).toContain("confianza");
  });

  it("filtra la respuesta ENTERA si trae una barbaridad, y lo informa", () => {
    // Alguien va a probar: es un evento de empresa con una pantalla gigante.
    const result = aggregateCloud(["respeto", "esto es una mierda enorme", "confianza"]);
    expect(result.filtered).toBe(1);
    const texts = result.words.map((w) => w.text);
    expect(texts).toContain("respeto");
    // Ni siquiera se proyecta la parte limpia de esa respuesta.
    expect(texts).not.toContain("enorme");
  });

  it("el filtro no se esquiva con acentos ni mayusculas", () => {
    expect(isBlockedText("MIÉRDA")).toBe(true);
    expect(isBlockedText("Mierda")).toBe(true);
    expect(isBlockedText("miercoles")).toBe(false);
  });

  it("respeta el tope de palabras", () => {
    const many = Array.from({ length: 100 }, (_, i) => `palabra${i}`);
    expect(aggregateCloud(many, { limit: 10 }).words).toHaveLength(10);
  });

  it("es estable entre corridas", () => {
    const input = ["foco equipo", "equipo foco", "cliente"];
    expect(aggregateCloud(input)).toEqual(aggregateCloud(input));
  });
});

describe("aggregateProfiles", () => {
  it("cuenta arquetipos con porcentajes que suman 100", () => {
    const profiles = [
      { id: "explorador", label: "Explorador" },
      { id: "guardian", label: "Guardián" },
    ];
    const result = aggregateProfiles(profiles, ["explorador", "explorador", "guardian"]);
    expect(result.counts.map((c) => c.count)).toEqual([2, 1]);
    expect(result.counts.reduce((sum, c) => sum + c.pct, 0)).toBe(100);
  });
});

describe("anonimato", () => {
  it("con anonymous el participantId NO llega al resultado", () => {
    const responses = [
      { participantId: "ana", value: 5 },
      { participantId: "beto", value: 3 },
    ];
    const anon = stripIdentity(responses, true);
    // Lo que no se calcula no se puede filtrar por accidente en un meta,
    // en un log ni en el inspector.
    expect(JSON.stringify(anon)).not.toContain("ana");
    expect(JSON.stringify(anon)).not.toContain("beto");
    expect(anon.every((r) => r.participantId === null)).toBe(true);
    expect(anon.map((r) => r.value)).toEqual([5, 3]);
  });

  it("sin anonymous el identificador se conserva", () => {
    const responses = [{ participantId: "ana", value: 5 }];
    expect(stripIdentity(responses, false)[0]?.participantId).toBe("ana");
  });
});
