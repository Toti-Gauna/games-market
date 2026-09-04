/**
 * NetPort — el unico canal por el que un juego habla con otros dispositivos.
 *
 * Un juego nunca instancia transporte: recibe un `NetPort` por props o `null`
 * si es `solo`. Hoy la implementacion es BroadcastChannel (dos pestanas de la
 * misma maquina); manana puede ser WebRTC sin que ningun juego se entere.
 */

export type NetRole = "host" | "client";

/**
 * Por donde viajan los bytes.
 *
 * `local` = BroadcastChannel: dos pestanas del MISMO navegador. Alcanza para
 * desarrollar y no cruza a otro aparato ni por casualidad.
 * `webrtc` = celulares de verdad contra el proyector. Requiere HTTPS.
 *
 * Vive en el contrato y no en `useGameNet` porque **el juego tiene que poder
 * leerlo**: quien elige el transporte es el contenedor (el banco de pruebas,
 * el quiosco), y el juego arma su propia sesion de red. Si el dato no llega
 * hasta ahi, el proyector abre un BroadcastChannel mientras el celular entra
 * por WebRTC, y no se ven nunca — que es exactamente el sintoma de
 * "Conectando…" para siempre.
 */
export type NetTransportKind = "local" | "webrtc";

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
