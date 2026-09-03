/**
 * NetPort — el unico canal por el que un juego habla con otros dispositivos.
 *
 * Un juego nunca instancia transporte: recibe un `NetPort` por props o `null`
 * si es `solo`. Hoy la implementacion es BroadcastChannel (dos pestanas de la
 * misma maquina); manana puede ser WebRTC sin que ningun juego se entere.
 */

export type NetRole = "host" | "client";

export type NetPeer = {
  id: string;
  seat: number;
  name: string;
  /** ms desde el ultimo latido. Sirve para pintar "se desconecto". */
  lastSeenMs: number;
};

export type NetMessage<T = unknown> = {
  type: string;
  from: string;
  seat: number;
  /** Reloj del emisor en ms. El host es la autoridad; esto es informativo. */
  t: number;
  payload: T;
};

export type NetPort = {
  readonly role: NetRole;
  readonly seat: number;
  readonly playerId: string;
  readonly roomId: string;
  send<T>(type: string, payload: T): void;
  /** Devuelve la funcion para desuscribirse. Llamala siempre al desmontar. */
  on(handler: (msg: NetMessage) => void): () => void;
  peers(): readonly NetPeer[];
  close(): void;
};

/**
 * Lo minimo que la sesion de red necesita de un transporte.
 *
 * El protocolo —reparto de asientos, bots, autoridad del host, snapshots— vive
 * una sola vez, encima de esto. Cambiar BroadcastChannel por WebRTC es pasar
 * otra fabrica: ni el protocolo ni ningun juego se entera.
 */
export type NetTransport = {
  readonly playerId: string;
  send<T>(type: string, payload: T): void;
  on(handler: (msg: NetMessage) => void): () => void;
  setSimulation(next: NetSimulation): void;
  close(): void;
};

export type TransportInit = {
  roomId: string;
  seat: number;
  role: NetRole;
  name: string;
};

export type TransportFactory = (init: TransportInit) => NetTransport;

/** Lo que el banco de pruebas puede degradar a mano para ver que aguanta. */
export type NetSimulation = {
  /** Latencia agregada en cada sentido, en ms. */
  latencyMs: number;
  /** Probabilidad 0..1 de tirar un mensaje. */
  lossRate: number;
};

export const NO_SIMULATION: NetSimulation = { latencyMs: 0, lossRate: 0 };
