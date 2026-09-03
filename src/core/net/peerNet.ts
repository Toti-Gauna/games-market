import type { NetMessage, NetSimulation, NetTransport, TransportInit } from "@/core/contract/net";
import { NO_SIMULATION } from "@/core/contract/net";

/**
 * Transporte WebRTC sobre PeerJS.
 *
 * Es el mismo `NetTransport` que BroadcastChannel, asi que **el protocolo no
 * cambia una linea**: reparto de asientos, bots, autoridad y snapshots viven
 * arriba y no saben por donde viajan los bytes.
 *
 * Topologia en estrella, que es la que ya pide el contrato: el proyector es el
 * host y cada celular abre un DataChannel directo contra el. No hace falta
 * servidor de juego, solo senalizacion — y esa la pone el broker publico de
 * PeerJS, asi que no hay nada que levantar.
 *
 * Los clientes NO se hablan entre si, y no hace falta: al host le mandan input
 * y del host reciben estado. El protocolo ya descarta lo que no venga del host.
 *
 * DOS COSAS QUE HAY QUE SABER:
 *
 * 1. **Requiere HTTPS.** Un telefono no abre una `RTCPeerConnection` en un
 *    origen inseguro. En desarrollo se resuelve con `npm run dev:https`.
 * 2. **En la misma WiFi el camino directo es el caso normal.** Cuando no lo es
 *    hace falta un TURN, que si es infraestructura. Para una sala donde el
 *    proyector y los celulares estan en la misma red, no aparece.
 */

type PeerLike = {
  id: string;
  on(event: string, cb: (...args: unknown[]) => void): void;
  connect(id: string, options?: unknown): DataConnectionLike;
  destroy(): void;
};

type DataConnectionLike = {
  peer: string;
  open: boolean;
  on(event: string, cb: (...args: unknown[]) => void): void;
  send(data: unknown): void;
  close(): void;
};

export type PeerTransportStatus = "connecting" | "online" | "reconnecting" | "failed";

export type PeerTransport = NetTransport & {
  readonly status: PeerTransportStatus;
  /** Motivo legible del ultimo fallo. Para pintarlo, no para reintentar. */
  readonly error: string | null;
  onStatus(cb: (status: PeerTransportStatus, error: string | null) => void): () => void;
};

/** Envoltura de lo que viaja por el canal. Espeja la forma de `NetMessage`. */
type Wire = { type: string; from: string; seat: number; t: number; payload: unknown };

/**
 * El host publica un id derivado de la sala para que el celular pueda
 * calcularlo sin coordinar nada: escanea el QR, arma el id y se conecta.
 */
export function hostPeerId(roomId: string): string {
  return `sn-${roomId.replace(/[^A-Za-z0-9-]/g, "-")}-host`;
}

const RECONNECT_MS = 1500;

export function createPeerTransport(init: TransportInit): PeerTransport {
  const isHost = init.role === "host";
  const targetId = hostPeerId(init.roomId);

  const handlers = new Set<(msg: NetMessage) => void>();
  const statusHandlers = new Set<(status: PeerTransportStatus, error: string | null) => void>();
  /** Solo el host las usa: un canal por celular. */
  const connections = new Map<string, DataConnectionLike>();
  const pendingTimers = new Set<number>();

  let peer: PeerLike | null = null;
  let hostConnection: DataConnectionLike | null = null;
  let simulation: NetSimulation = NO_SIMULATION;
  let status: PeerTransportStatus = "connecting";
  let error: string | null = null;
  let closed = false;
  let playerId = isHost ? targetId : "";
  let reconnectTimer = 0;

  function setStatus(next: PeerTransportStatus, reason: string | null = null) {
    if (status === next && error === reason) return;
    status = next;
    error = reason;
    for (const cb of statusHandlers) cb(status, error);
  }

  function deliver(wire: Wire) {
    if (closed) return;
    if (simulation.lossRate > 0 && Math.random() < simulation.lossRate) return;

    const apply = () => {
      if (closed) return;
      const msg: NetMessage = {
        type: wire.type,
        from: wire.from,
        seat: wire.seat,
        t: wire.t,
        payload: wire.payload,
      };
      for (const handler of handlers) handler(msg);
    };

    if (simulation.latencyMs > 0) {
      const timer = window.setTimeout(() => {
        pendingTimers.delete(timer);
        apply();
      }, simulation.latencyMs);
      pendingTimers.add(timer);
    } else {
      apply();
    }
  }

  function attachConnection(conn: DataConnectionLike) {
    conn.on("data", (raw) => {
      const wire = raw as Wire;
      if (!wire || typeof wire.type !== "string") return;
      // El host reenvia lo que no es para el: un cliente que manda al "todos"
      // en realidad le habla al host, y el resto se entera por el estado.
      deliver(wire);
    });
    conn.on("close", () => {
      connections.delete(conn.peer);
      if (!isHost) scheduleReconnect("Se cayó la conexión con el proyector");
    });
    conn.on("error", () => {
      connections.delete(conn.peer);
    });
  }

  function scheduleReconnect(reason: string) {
    if (closed || isHost) return;
    setStatus("reconnecting", reason);
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connectToHost, RECONNECT_MS);
  }

  function connectToHost() {
    if (closed || !peer) return;
    try {
      // No confiable y no ordenado: para estado de juego, un paquete viejo que
      // llega tarde no sirve, y retransmitirlo solo suma latencia.
      const conn = peer.connect(targetId, { reliable: false, serialization: "json" });
      hostConnection = conn;
      conn.on("open", () => {
        setStatus("online");
      });
      attachConnection(conn);
    } catch {
      scheduleReconnect("No se pudo abrir el canal");
    }
  }

  async function boot() {
    let PeerCtor: new (id?: string | undefined) => PeerLike;
    try {
      // Carga diferida: quien no usa WebRTC no paga el peso de PeerJS.
      const mod = await import("peerjs");
      PeerCtor = mod.default as unknown as new (id?: string) => PeerLike;
    } catch {
      setStatus("failed", "No se pudo cargar PeerJS");
      return;
    }
    if (closed) return;

    try {
      peer = isHost ? new PeerCtor(targetId) : new PeerCtor(undefined);
    } catch {
      setStatus("failed", "No se pudo crear el par");
      return;
    }

    peer.on("open", (id) => {
      playerId = String(id);
      if (isHost) setStatus("online");
      else connectToHost();
    });

    peer.on("error", (raw) => {
      const err = raw as { type?: string; message?: string };
      if (err?.type === "unavailable-id") {
        // Ya hay un proyector con esta sala. Abrir dos es el error mas facil
        // de cometer y el mas confuso si no se dice.
        setStatus("failed", "Ya hay otro proyector abierto en esta sala");
        return;
      }
      if (err?.type === "peer-unavailable") {
        scheduleReconnect("El proyector todavía no está abierto");
        return;
      }
      setStatus("failed", err?.message ?? "Error de conexión");
    });

    peer.on("disconnected", () => {
      if (!closed) setStatus("reconnecting", "Se perdió la señalización");
    });

    if (isHost) {
      peer.on("connection", (raw) => {
        const conn = raw as DataConnectionLike;
        connections.set(conn.peer, conn);
        attachConnection(conn);
      });
    }
  }

  void boot();

  return {
    get playerId() {
      return playerId || targetId;
    },
    get status() {
      return status;
    },
    get error() {
      return error;
    },
    send(type, payload) {
      if (closed) return;
      const wire: Wire = { type, from: playerId, seat: init.seat, t: performance.now(), payload };
      if (isHost) {
        for (const conn of connections.values()) {
          if (conn.open) conn.send(wire);
        }
      } else if (hostConnection?.open) {
        hostConnection.send(wire);
      }
    },
    on(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onStatus(cb) {
      statusHandlers.add(cb);
      cb(status, error);
      return () => statusHandlers.delete(cb);
    },
    setSimulation(next) {
      simulation = next;
    },
    close() {
      if (closed) return;
      closed = true;
      window.clearTimeout(reconnectTimer);
      for (const timer of pendingTimers) window.clearTimeout(timer);
      pendingTimers.clear();
      handlers.clear();
      statusHandlers.clear();
      for (const conn of connections.values()) conn.close();
      connections.clear();
      hostConnection?.close();
      hostConnection = null;
      peer?.destroy();
      peer = null;
    },
  };
}
