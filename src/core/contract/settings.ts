/**
 * Administrables — el schema declarativo que cada juego publica.
 *
 * El panel de administracion NO sabe de juegos: recorre el schema y dibuja el
 * control que corresponda. Un juego nuevo se vuelve administrable escribiendo
 * su schema, sin tocar la UI.
 *
 * El schema es tambien la fuente de los valores por defecto, y es lo que se
 * usa para sanear lo que viene de localStorage: un valor guardado que ya no
 * respeta el schema se descarta, no rompe el juego.
 */

export type SettingsRecord = Record<string, string | number | boolean | string[]>;

export type SettingValue = string | number | boolean | string[] | SettingsRecord[];

export type SettingsValues = Record<string, SettingValue>;

type FieldBase = {
  key: string;
  label: string;
  /** Una linea explicando que hace. Se muestra debajo del control. */
  help?: string;
  /** Agrupa campos bajo un titulo dentro del panel. */
  group?: string;
};

export type NumberField = FieldBase & {
  kind: "number";
  min: number;
  max: number;
  step?: number;
  unit?: string;
  default: number;
};

export type ToggleField = FieldBase & {
  kind: "toggle";
  default: boolean;
};

export type SelectField = FieldBase & {
  kind: "select";
  options: ReadonlyArray<{ value: string; label: string }>;
  default: string;
};

export type TextField = FieldBase & {
  kind: "text";
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  default: string;
};

/** Lista de strings sueltos: principios, palabras, opciones cortas. */
export type WordsField = FieldBase & {
  kind: "words";
  itemLabel: string;
  min?: number;
  max?: number;
  default: readonly string[];
};

export type RecordSubField =
  | (Omit<NumberField, "group"> & { kind: "number" })
  | (Omit<ToggleField, "group"> & { kind: "toggle" })
  | (Omit<SelectField, "group"> & { kind: "select" })
  | (Omit<TextField, "group"> & { kind: "text" })
  | (Omit<WordsField, "group"> & { kind: "words" });

/** Contenido tabular: preguntas de trivia, items de un test, tarjetas. */
export type RecordsField = FieldBase & {
  kind: "records";
  fields: readonly RecordSubField[];
  /** Que campo del registro se usa como titulo de la fila. */
  titleKey: string;
  min?: number;
  max?: number;
  default: readonly SettingsRecord[];
};

export type SettingField =
  | NumberField
  | ToggleField
  | SelectField
  | TextField
  | WordsField
  | RecordsField;

export type SettingsSchema = readonly SettingField[];

/* ------------------------------------------------------------------ */
/* Defaults y saneado                                                   */
/* ------------------------------------------------------------------ */

function defaultOf(field: SettingField | RecordSubField): SettingValue {
  switch (field.kind) {
    case "words":
      return [...field.default];
    case "records":
      return field.default.map((r) => ({ ...r }));
    default:
      return field.default;
  }
}

export function schemaDefaults(schema: SettingsSchema): SettingsValues {
  const out: SettingsValues = {};
  for (const field of schema) out[field.key] = defaultOf(field);
  return out;
}

function coerce(field: SettingField | RecordSubField, raw: unknown): SettingValue {
  switch (field.kind) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return field.default;
      return Math.min(field.max, Math.max(field.min, n));
    }
    case "toggle":
      return typeof raw === "boolean" ? raw : field.default;
    case "select":
      return field.options.some((o) => o.value === raw) ? (raw as string) : field.default;
    case "text": {
      if (typeof raw !== "string") return field.default;
      return field.maxLength ? raw.slice(0, field.maxLength) : raw;
    }
    case "words": {
      if (!Array.isArray(raw)) return [...field.default];
      const list = raw.filter((v): v is string => typeof v === "string");
      return list.length >= (field.min ?? 0) ? list : [...field.default];
    }
    case "records": {
      if (!Array.isArray(raw)) return field.default.map((r) => ({ ...r }));
      const rows = raw
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((row) => {
          const clean: SettingsRecord = {};
          for (const sub of field.fields) {
            clean[sub.key] = coerce(sub, row[sub.key]) as SettingsRecord[string];
          }
          return clean;
        });
      return rows.length >= (field.min ?? 1) ? rows : field.default.map((r) => ({ ...r }));
    }
  }
}

/**
 * Mezcla lo guardado sobre los defaults del schema.
 * Cualquier clave desconocida o valor fuera de rango se descarta.
 */
export function mergeSettings(schema: SettingsSchema, stored: unknown): SettingsValues {
  const out = schemaDefaults(schema);
  if (typeof stored !== "object" || stored === null) return out;
  const source = stored as Record<string, unknown>;
  for (const field of schema) {
    if (field.key in source) out[field.key] = coerce(field, source[field.key]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lectores tipados — como los juegos consumen sus administrables       */
/* ------------------------------------------------------------------ */

export function num(values: SettingsValues, key: string, fallback = 0): number {
  const v = values[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function bool(values: SettingsValues, key: string, fallback = false): boolean {
  const v = values[key];
  return typeof v === "boolean" ? v : fallback;
}

export function str(values: SettingsValues, key: string, fallback = ""): string {
  const v = values[key];
  return typeof v === "string" ? v : fallback;
}

export function words(values: SettingsValues, key: string, fallback: string[] = []): string[] {
  const v = values[key];
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : fallback;
}

export function records(values: SettingsValues, key: string): SettingsRecord[] {
  const v = values[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is SettingsRecord => typeof x === "object" && x !== null && !Array.isArray(x));
}
