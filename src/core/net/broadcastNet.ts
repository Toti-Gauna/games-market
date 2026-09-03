import type { NetMessage, NetPeer, NetPort, NetRole, NetSimulation } from "@/core/contract/net";
import { NO_SIMULATION } from "@/core/contract/net";

/**
 * NetPort sobre BroadcastChannel.
 *
 * Alcanza para todo el desarrollo: dos pestanas de la misma maquina son un
 * proyector y un celular. El dia que haya WebRTC se cambia este archivo y
 * ningun juego se entera, porque ninguno importa de aca: reciben `NetPort`.
 *
 * Incluye latencia y perdida simuladas porque un juego de red que solo se
 * probo a 0 ms de latencia es un juego que no se probo.
 */

const HEARTBEAT_MS = 1000;
const PEER_TIMEOUT_MS = 4000;

type WireMessage = NetMessage & { room: string };

export type BroadcastNetOptions = {
  roomId: string;
  seat: number;
  role: NetRole;
  name?: string;
  simulation?: NetSimulation;
};

/** El puerto que ve el juego es `NetPort`; el banco de pruebas ve tambien el setter. */
export type BroadcastNetPort = NetPort & { setSimulation(next: NetSimulation): void };

export function createBroadcastNet(options: BroadcastNetOptions): BroadcastNetPort {
  const { roomId, seat, role } = options;
  const name = options.name ?? (role === "host" ? "Proyector" : `Jugador ${seat + 1}`);
  const playerId = `${role}-${seat}-${Math.random().toString(36).slice(2, 8)}`;

  const channel = new BroadcastChannel(`supernova:${roomId}`);
  const handlers = new Set<(msg: NetMessage) => void>();
  const peers = new Map<string, NetPeer>();
  const pendingTimers = new Set<number>();

  let simulation: NetSimulation = options.simulation ?? NO_SIMULATION;
  let closed = false;

  function deliver(msg: NetMessage) {
    for (const handler of handlers) handler(msg);
  }

  channel.onmessage = (event: MessageEvent<WireMessage>) => {
    if (closed) return;
    const msg = event.data;
    if (!msg || msg.room !== roomId || msg.from === playerId) return;

    if (simulation.lossRate > 0 && Math.random() < simulation.lossRate) return;

    const apply = () => {
      if (closed) return;
      const existing = peers.get(msg.from);
      peers.set(msg.from, {
        id: msg.from,
        seat: msg.seat,
        name: existing?.name ?? `Asiento ${msg.seat + 1}`,
        lastSeenMs: performance.now(),
      });

      if (msg.type === "sn:hello") {
        const payload = msg.payload as { name?: string } | undefined;
        const peer = peers.get(msg.from);
        if (peer && payload?.name) peer.name = payload.name;
        return;
      }
      if (msg.type === "sn:beat") return;
      deliver(msg);
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
  };

  function post<T>(type: string, payload: T) {
    if (closed) return;
    const wire: WireMessage = { room: roomId, type, from: playerId, seat, t: performance.now(), payload };
    channel.postMessage(wire);
  }

  post("sn:hello", { name });
  const heartbeat = window.setInterval(() => {
    post("sn:beat", null);
    // Un peer que dejo de latir se cae de la lista y el HUD lo puede mostrar.
    const now = performance.now();
    for (const [id, peer] of peers) {
      if (now - peer.lastSeenMs > PEER_TIMEOUT_MS) peers.delete(id);
    }
  }, HEARTBEAT_MS);

  return {
    role,
    seat,
    playerId,
    roomId,
    send: post,
    on(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    peers() {
      return [...peers.values()].sort((a, b) => a.seat - b.seat);
    },
    setSimulation(next) {
      simulation = next;
    },
    close() {
      if (closed) return;
      closed = true;
      window.clearInterval(heartbeat);
      for (const timer of pendingTimers) window.clearTimeout(timer);
      pendingTimers.clear();
      handlers.clear();
      channel.close();
    },
  };
}
