import { useState } from "react";
import type {
  RecordSubField,
  SettingField,
  SettingValue,
  SettingsRecord,
  SettingsSchema,
  SettingsValues,
} from "@/core/contract/settings";

/**
 * El panel de administrables.
 *
 * No sabe de juegos: recorre el schema y dibuja el control que corresponde.
 * Sumar un administrable nuevo a un juego es agregar un campo al schema; esta
 * pantalla no se toca nunca mas.
 */

export type SettingsPanelProps = {
  schema: SettingsSchema;
  values: SettingsValues;
  onChange: (key: string, value: SettingValue) => void;
  onReset: () => void;
  hasCustom: boolean;
};

export function SettingsPanel({ schema, values, onChange, onReset, hasCustom }: SettingsPanelProps) {
  if (schema.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-xs text-sn-dim">
        Este juego todavia no declara administrables.
      </p>
    );
  }

  const groups = new Map<string, SettingField[]>();
  for (const field of schema) {
    const key = field.group ?? "Ajustes";
    const list = groups.get(key);
    if (list) list.push(field);
    else groups.set(key, [field]);
  }

  return (
    <div className="flex flex-col gap-5">
      {[...groups.entries()].map(([group, fields]) => (
        <section key={group} className="flex flex-col gap-3.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sn-dim">{group}</h4>
          {fields.map((field) => (
            <FieldControl
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={(next) => onChange(field.key, next)}
            />
          ))}
        </section>
      ))}

      <button
        type="button"
        className="sn-btn sn-btn--ghost h-8 self-start text-xs"
        onClick={onReset}
        disabled={!hasCustom}
      >
        {hasCustom ? "Restaurar valores del repo" : "Sin cambios respecto del repo"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: SettingField;
  value: SettingValue | undefined;
  onChange: (next: SettingValue) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {field.kind !== "toggle" && (
        <label className="flex items-baseline justify-between gap-2 text-xs font-medium text-sn-text">
          <span>{field.label}</span>
          {field.kind === "number" && (
            <span className="sn-num text-[11px] text-sn-cyan">
              {typeof value === "number" ? value : field.default}
              {field.unit ? ` ${field.unit}` : ""}
            </span>
          )}
        </label>
      )}

      <Control field={field} value={value} onChange={onChange} />

      {field.help && <p className="text-[11px] leading-snug text-sn-dim">{field.help}</p>}
    </div>
  );
}

function Control({
  field,
  value,
  onChange,
}: {
  field: SettingField | RecordSubField;
  value: SettingValue | undefined;
  onChange: (next: SettingValue) => void;
}) {
  switch (field.kind) {
    case "number":
      return (
        <input
          type="range"
          className="sn-range"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={typeof value === "number" ? value : field.default}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={field.label}
        />
      );

    case "toggle":
      return (
        <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium text-sn-text">
          <input
            type="checkbox"
            className="size-4 accent-sn-violet-400"
            checked={typeof value === "boolean" ? value : field.default}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label}
        </label>
      );

    case "select":
      return (
        <select
          className="sn-input"
          value={typeof value === "string" ? value : field.default}
          onChange={(e) => onChange(e.target.value)}
          aria-label={field.label}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case "text":
      return field.multiline ? (
        <textarea
          className="sn-input"
          rows={3}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : field.default}
          onChange={(e) => onChange(e.target.value)}
          aria-label={field.label}
        />
      ) : (
        <input
          type="text"
          className="sn-input"
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : field.default}
          onChange={(e) => onChange(e.target.value)}
          aria-label={field.label}
        />
      );

    case "words":
      return (
        <WordsEditor
          items={Array.isArray(value) ? (value as string[]) : [...field.default]}
          itemLabel={field.itemLabel}
          min={field.min ?? 1}
          max={field.max ?? 40}
          onChange={onChange}
        />
      );

    case "records":
      return (
        <RecordsEditor
          rows={Array.isArray(value) ? (value as SettingsRecord[]) : field.default.map((r) => ({ ...r }))}
          fields={field.fields}
          titleKey={field.titleKey}
          min={field.min ?? 1}
          max={field.max ?? 60}
          onChange={onChange}
        />
      );
  }
}

/* ------------------------------------------------------------------ */

function WordsEditor({
  items,
  itemLabel,
  min,
  max,
  onChange,
}: {
  items: string[];
  itemLabel: string;
  min: number;
  max: number;
  onChange: (next: string[]) => void;
}) {
  const replace = (index: number, text: string) => {
    const next = [...items];
    next[index] = text;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            type="text"
            className="sn-input"
            value={item}
            maxLength={40}
            onChange={(e) => replace(index, e.target.value)}
            aria-label={`${itemLabel} ${index + 1}`}
          />
          <button
            type="button"
            className="sn-btn sn-btn--ghost size-8 shrink-0 px-0 text-sn-dim"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
            disabled={items.length <= min}
            title="Quitar"
            aria-label={`Quitar ${itemLabel} ${index + 1}`}
          >
            &times;
          </button>
        </div>
      ))}
      <button
        type="button"
        className="sn-btn h-8 self-start text-xs"
        onClick={() => onChange([...items, ""])}
        disabled={items.length >= max}
      >
        Agregar {itemLabel.toLowerCase()}
      </button>
    </div>
  );
}

function emptyRecord(fields: readonly RecordSubField[]): SettingsRecord {
  const row: SettingsRecord = {};
  for (const field of fields) {
    row[field.key] = field.kind === "words" ? [...field.default] : field.default;
  }
  return row;
}

function RecordsEditor({
  rows,
  fields,
  titleKey,
  min,
  max,
  onChange,
}: {
  rows: SettingsRecord[];
  fields: readonly RecordSubField[];
  titleKey: string;
  min: number;
  max: number;
  onChange: (next: SettingsRecord[]) => void;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const patchRow = (index: number, key: string, value: SettingValue) => {
    const next = rows.map((row, i) =>
      i === index ? { ...row, [key]: value as SettingsRecord[string] } : row,
    );
    onChange(next);
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const a = next[index] as SettingsRecord;
    const b = next[target] as SettingsRecord;
    next[index] = b;
    next[target] = a;
    onChange(next);
    setOpenIndex(target);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, index) => {
        const open = openIndex === index;
        const title = String(row[titleKey] ?? "").trim() || `Sin titulo ${index + 1}`;
        return (
          <div key={index} className="overflow-hidden rounded-sn border border-sn-line-soft bg-sn-bg-elev">
            <div className="flex items-center gap-1 px-1.5 py-1">
              <button
                type="button"
                className="min-w-0 flex-1 truncate px-1 py-1 text-left text-xs text-sn-text hover:text-sn-cyan"
                onClick={() => setOpenIndex(open ? null : index)}
                aria-expanded={open}
              >
                <span className="sn-num mr-2 text-[10px] text-sn-dim">{String(index + 1).padStart(2, "0")}</span>
                {title}
              </button>
              <button
                type="button"
                className="sn-btn sn-btn--ghost size-7 shrink-0 px-0 text-sn-dim"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Subir"
              >
                &uarr;
              </button>
              <button
                type="button"
                className="sn-btn sn-btn--ghost size-7 shrink-0 px-0 text-sn-dim"
                onClick={() => move(index, 1)}
                disabled={index === rows.length - 1}
                aria-label="Bajar"
              >
                &darr;
              </button>
              <button
                type="button"
                className="sn-btn sn-btn--ghost size-7 shrink-0 px-0 text-sn-dim"
                onClick={() => {
                  onChange(rows.filter((_, i) => i !== index));
                  setOpenIndex(null);
                }}
                disabled={rows.length <= min}
                aria-label="Eliminar"
              >
                &times;
              </button>
            </div>

            {open && (
              <div className="flex flex-col gap-3 border-t border-sn-line-soft p-2.5">
                {fields.map((field) => (
                  <div key={field.key} className="flex flex-col gap-1.5">
                    {field.kind !== "toggle" && (
                      <label className="text-[11px] font-medium text-sn-muted">{field.label}</label>
                    )}
                    <Control
                      field={field}
                      value={row[field.key]}
                      onChange={(next) => patchRow(index, field.key, next)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        className="sn-btn h-8 self-start text-xs"
        onClick={() => {
          onChange([...rows, emptyRecord(fields)]);
          setOpenIndex(rows.length);
        }}
        disabled={rows.length >= max}
      >
        Agregar
      </button>
    </div>
  );
}
