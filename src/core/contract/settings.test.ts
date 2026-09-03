import { describe, expect, it } from "vitest";
import { bool, mergeSettings, num, records, schemaDefaults, str, words, type SettingsSchema } from "./settings";

/**
 * El saneado es lo que evita que un localStorage viejo o tocado a mano rompa
 * un juego. Un valor invalido cae al default; nunca llega al loop.
 */

const SCHEMA: SettingsSchema = [
  { kind: "number", key: "speed", label: "Velocidad", min: 1, max: 10, default: 6 },
  { kind: "toggle", key: "bots", label: "Bots", default: true },
  {
    kind: "select",
    key: "mode",
    label: "Modo",
    options: [
      { value: "easy", label: "Fácil" },
      { value: "hard", label: "Difícil" },
    ],
    default: "easy",
  },
  { kind: "text", key: "title", label: "Título", maxLength: 5, default: "hola" },
  { kind: "words", key: "list", label: "Lista", itemLabel: "Palabra", min: 2, default: ["a", "b"] },
  {
    kind: "records",
    key: "items",
    label: "Preguntas",
    titleKey: "text",
    fields: [
      { kind: "text", key: "text", label: "Texto", default: "" },
      { kind: "number", key: "points", label: "Puntos", min: 0, max: 100, default: 10 },
    ],
    default: [{ text: "Una", points: 10 }],
  },
];

describe("schemaDefaults", () => {
  it("saca todos los defaults del schema", () => {
    expect(schemaDefaults(SCHEMA)).toEqual({
      speed: 6,
      bots: true,
      mode: "easy",
      title: "hola",
      list: ["a", "b"],
      items: [{ text: "Una", points: 10 }],
    });
  });

  it("clona: tocar el resultado no contamina el schema", () => {
    const first = schemaDefaults(SCHEMA);
    (first.list as string[]).push("contaminado");
    expect(schemaDefaults(SCHEMA).list).toEqual(["a", "b"]);
  });
});

describe("mergeSettings", () => {
  it("recorta los numeros fuera de rango en vez de aceptarlos", () => {
    expect(mergeSettings(SCHEMA, { speed: 999 }).speed).toBe(10);
    expect(mergeSettings(SCHEMA, { speed: -50 }).speed).toBe(1);
  });

  it("descarta un valor de otro tipo", () => {
    expect(mergeSettings(SCHEMA, { bots: "si" }).bots).toBe(true);
    expect(mergeSettings(SCHEMA, { speed: "rapido" }).speed).toBe(6);
  });

  it("una opcion de select que ya no existe cae al default", () => {
    expect(mergeSettings(SCHEMA, { mode: "imposible" }).mode).toBe("easy");
  });

  it("respeta maxLength en los textos", () => {
    expect(mergeSettings(SCHEMA, { title: "muy largo de verdad" }).title).toBe("muy l");
  });

  it("una lista mas corta que el minimo vuelve al default", () => {
    expect(mergeSettings(SCHEMA, { list: ["solo"] }).list).toEqual(["a", "b"]);
    expect(mergeSettings(SCHEMA, { list: ["x", "y", "z"] }).list).toEqual(["x", "y", "z"]);
  });

  it("ignora claves desconocidas", () => {
    const merged = mergeSettings(SCHEMA, { fantasma: 1, speed: 8 });
    expect(merged.speed).toBe(8);
    expect("fantasma" in merged).toBe(false);
  });

  it("sanea cada campo de un registro y completa los que faltan", () => {
    const merged = mergeSettings(SCHEMA, {
      items: [{ text: "Dos", points: 5000 }, { text: "Sin puntos" }],
    });
    expect(merged.items).toEqual([
      { text: "Dos", points: 100 },
      { text: "Sin puntos", points: 10 },
    ]);
  });

  it("un guardado corrupto no rompe nada", () => {
    expect(mergeSettings(SCHEMA, "esto no es un objeto")).toEqual(schemaDefaults(SCHEMA));
    expect(mergeSettings(SCHEMA, null)).toEqual(schemaDefaults(SCHEMA));
  });
});

describe("lectores tipados", () => {
  const values = schemaDefaults(SCHEMA);

  it("devuelven el valor cuando el tipo coincide", () => {
    expect(num(values, "speed")).toBe(6);
    expect(bool(values, "bots")).toBe(true);
    expect(str(values, "mode")).toBe("easy");
    expect(words(values, "list")).toEqual(["a", "b"]);
    expect(records(values, "items")).toHaveLength(1);
  });

  it("caen al fallback cuando la clave no existe o no es del tipo esperado", () => {
    expect(num(values, "inexistente", 42)).toBe(42);
    expect(bool(values, "speed", false)).toBe(false);
    expect(str(values, "speed", "-")).toBe("-");
    expect(words(values, "speed", ["x"])).toEqual(["x"]);
    expect(records(values, "speed")).toEqual([]);
  });
});
