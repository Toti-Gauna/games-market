import { mergeSettings, schemaDefaults, type SettingsSchema, type SettingsValues } from "@/core/contract/settings";

/**
 * Administrables persistidos.
 *
 * Los defaults viven en el repo (el schema de cada juego); lo que se toca en
 * el panel vive en localStorage. Restaurar es borrar la clave, no reescribir
 * valores: asi un cambio en el default del repo llega solo.
 *
 * Todo acceso va envuelto: modo incognito, cuota llena o site data bloqueada
 * tiran, y el juego tiene que abrir igual.
 */

const SETTINGS_PREFIX = "sn:settings:";
const LAB_PREFIX = "sn:lab:";

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin persistencia el panel sigue funcionando en memoria. No es un error fatal.
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ver arriba */
  }
}

export function loadSettings(gameId: string, schema: SettingsSchema): SettingsValues {
  if (schema.length === 0) return {};
  return mergeSettings(schema, readJson(SETTINGS_PREFIX + gameId));
}

export function saveSettings(gameId: string, values: SettingsValues): void {
  writeJson(SETTINGS_PREFIX + gameId, values);
}

export function resetSettings(gameId: string, schema: SettingsSchema): SettingsValues {
  removeKey(SETTINGS_PREFIX + gameId);
  return schemaDefaults(schema);
}

export function hasCustomSettings(gameId: string): boolean {
  return readJson(SETTINGS_PREFIX + gameId) !== null;
}

/* ------------------------------------------------------------------ */
/* Preferencias del banco de pruebas (no son del juego)                 */
/* ------------------------------------------------------------------ */

export type LabPreferences = {
  durationSec: number;
  /** "" = semilla nueva en cada partida. */
  seed: string;
  seat: number;
  playerCount: number;
  latencyMs: number;
  lossPercent: number;
  /** "local" = dos pestanas. "webrtc" = celulares de verdad, y necesita HTTPS. */
  transport: "local" | "webrtc";
};

export const DEFAULT_LAB: LabPreferences = {
  durationSec: 90,
  seed: "",
  seat: 0,
  playerCount: 1,
  latencyMs: 0,
  lossPercent: 0,
  transport: "local",
};

export function loadLabPreferences(gameId: string): LabPreferences {
  const stored = readJson(LAB_PREFIX + gameId);
  if (typeof stored !== "object" || stored === null) return { ...DEFAULT_LAB };
  const raw = stored as Partial<LabPreferences>;
  return {
    durationSec: clampNumber(raw.durationSec, 0, 900, DEFAULT_LAB.durationSec),
    seed: typeof raw.seed === "string" ? raw.seed.slice(0, 16) : DEFAULT_LAB.seed,
    seat: clampNumber(raw.seat, 0, 7, DEFAULT_LAB.seat),
    playerCount: clampNumber(raw.playerCount, 1, 8, DEFAULT_LAB.playerCount),
    latencyMs: clampNumber(raw.latencyMs, 0, 500, DEFAULT_LAB.latencyMs),
    lossPercent: clampNumber(raw.lossPercent, 0, 25, DEFAULT_LAB.lossPercent),
    transport: raw.transport === "webrtc" ? "webrtc" : "local",
  };
}

export function saveLabPreferences(gameId: string, prefs: LabPreferences): void {
  writeJson(LAB_PREFIX + gameId, prefs);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
