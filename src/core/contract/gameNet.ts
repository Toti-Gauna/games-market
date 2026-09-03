import type { ControlSpec } from "./control";
import type { NetPeer } from "./net";

/**
 * El puerto de red que ve un juego.
 *
 * Es una capa por encima de `NetPort` (el transporte). El transporte mueve
 * mensajes; esto define **quien manda**:
 *
 *   El proyector es el host autoritativo. Es la maquina que ya esta en la
 *   sala, tiene mejor hardware que un celular y no se va a ir a mitad de
 *   partida. Corre la simulacion y manda estado; los celulares mandan input
 *   y dibujan.
 *
 * Regla que no se negocia: **el host recibe input, nunca estado ni puntaje.**
 * Un cliente que manda "hice 500 puntos" se ignora. Confiar en el cliente es
 * la forma mas rapida de que alguien gane un premio abriendo la consola.
 */

export type NetRole = "host" | "client";

export type NetPlayer = {
  id: string;
  /** Asiento 0-based. Sale de la URL, asi que recuperarlo es determinista. */
  seat: number;
  name: string;
  /** true cuando lo completa la maquina en vez de una persona. */
  bot: boolean;
  connected: boolean;
};

export type GameNetPort<TInput, TState> = {
  readonly role: NetRole;
  readonly playerId: string;
  readonly seat: number;
  readonly roomId: string;

  /**
   * Cliente -> host. El input se manda a 30 Hz: el dedo no se mueve mas rapido.
   *
   * **Se toma por referencia**, igual que `broadcastState`, y el limitador lo
   * puede diferir hasta 33 ms. Un juego que reusa el mismo objeto de input
   * -que es lo que pide la regla de cero asignaciones- termina mandando la
   * secuencia de un tick con el contenido de otro. La solucion del lado del
   * juego es doble buffer.
   */
  sendInput(input: TInput, sequence: number): void;
  /** Solo host. */
  onInput(cb: (playerId: string, input: TInput, sequence: number) => void): () => void;

  /**
   * Solo host. Estado a 20 Hz; el cliente interpola hasta los 60 del render.
   *
   * **El estado se toma por referencia y se codifica despues**, cuando el
   * limitador decide mandarlo. Asi que el juego NO puede seguir escribiendo
   * sobre ese objeto: si reusa el mismo snapshot cuadro a cuadro —que es lo
   * que pide la regla de cero asignaciones— el tick N termina viajando con el
   * contenido del tick N+2.
   *
   * La solucion del lado del juego es doble buffer: dos snapshots que se
   * alternan. No se puede resolver aca porque `TState` es opaco y no hay forma
   * generica de copiarlo.
   */
  broadcastState(state: TState, tick: number, acks: Readonly<Record<string, number>>): void;
  /**
   * Solo cliente. `ackedSequence` es el ultimo input propio que el host ya
   * proceso: es lo que permite descartar lo confirmado y re-simular el resto.
   */
  onState(cb: (state: TState, tick: number, ackedSequence: number) => void): () => void;

  /**
   * Solo host: le dice al celular QUE mostrar. El telefono no conoce el juego,
   * asi que la misma pantalla de control sirve para todos.
   * Sin `toPlayerId` va a toda la sala. Con destinatario va a uno solo, que
   * es lo que hace falta cuando el aviso es personal: "seguis jugando por
   * puntos" lo tiene que leer el eliminado, no los diez que siguen vivos.
   * El host reenvia el ultimo spec difundido a quien entra tarde.
   */
  sendControl(spec: ControlSpec, toPlayerId?: string): void;
  /** Solo cliente. */
  onControl(cb: (spec: ControlSpec) => void): () => void;

  onPlayerJoin(cb: (player: NetPlayer) => void): () => void;
  onPlayerLeave(cb: (playerId: string) => void): () => void;
  players(): readonly NetPlayer[];

  /** Ida y vuelta medido, en ms. Para el HUD de diagnostico. */
  readonly rttMs: number;
  dispose(): void;
};

/** Lo que el banco de pruebas degrada a mano para ver que aguanta. */
export type NetConditions = {
  /** Nunca 0 por defecto: un juego de red probado a 0 ms no esta probado. */
  latencyMs: number;
  jitterMs: number;
  /** 0..1 */
  lossRate: number;
};

export const DEFAULT_CONDITIONS: NetConditions = {
  latencyMs: 80,
  jitterMs: 20,
  lossRate: 0.01,
};

export type { NetPeer };
