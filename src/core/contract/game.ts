import type { ComponentType } from "react";
import type { NetPort } from "./net";
import type { SettingsValues } from "./settings";

/**
 * El contrato. Tres reglas y nada mas:
 *
 * 1. Un juego recibe `GameProps` y no importa nada del shell.
 * 2. Termina llamando `onFinish` exactamente una vez.
 * 3. Si `signal` aborta, emite su resultado parcial EN EL ACTO.
 *
 * Todo lo demas (donde se monta, quien guarda el resultado, si hay tour o no)
 * es problema del contenedor.
 */

export type GameOutcome = {
  /** false si se corto por tiempo o por `force-end`. */
  completed: boolean;
  points: number;
  durationMs: number;
  /** Datos propios del juego. El shell los muestra crudos, no los interpreta. */
  meta?: Record<string, unknown>;
};

export type GameRuntimeConfig = {
  /**
   * Sala de la partida. La elige el contenedor, no el juego, porque es lo que
   * tiene que coincidir con el QR que escanean los celulares.
   * Un juego `solo` puede ignorarla.
   */
  roomId: string;
  /** Todos los clientes de la misma partida comparten semilla. */
  seed: string;
  /** null = sin limite de tiempo. */
  durationMs: number | null;
  /** Asiento del jugador, 0-based. En `solo` siempre 0. */
  seat: number;
  /**
   * Si este aparato es el host autoritativo de la partida.
   *
   * Lo decide el contenedor. Antes cada juego `arena` lo deducia con
   * `config.seat === 0`, que funcionaba pero era una regla no escrita que
   * cada juego reinventaba y podia contradecir.
   */
  isHost: boolean;
  playerCount: number;
  /** Ya viene mezclado con los defaults del schema: nunca falta una clave. */
  settings: SettingsValues;
  /** true cuando corre en el banco de pruebas: habilita overlays de debug. */
  debug: boolean;
};

export type GameProps = {
  config: GameRuntimeConfig;
  /** null en los juegos `solo`. */
  net: NetPort | null;
  /** Se aborta con "Forzar fin". El juego debe cerrar y emitir al toque. */
  signal: AbortSignal;
  onFinish: (outcome: GameOutcome) => void;
  /** Opcional: avisa que ya se puede sacar el loader. */
  onReady?: () => void;
};

export type GameComponent = ComponentType<GameProps>;

/** Formula compartida: logro + bono por aprovechar el tiempo. */
export function scoreWithTimeBonus(
  basePoints: number,
  survivedMs: number,
  durationMs: number | null,
  maxBonus = 200,
): number {
  if (durationMs === null || durationMs <= 0) return Math.round(basePoints);
  const ratio = Math.min(1, survivedMs / durationMs);
  return Math.round(basePoints + ratio * maxBonus);
}
