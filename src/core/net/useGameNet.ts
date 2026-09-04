import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CONDITIONS } from "@/core/contract/gameNet";
import type { NetConditions, NetPlayer, NetRole } from "@/core/contract/gameNet";
import type { NetTransportKind } from "@/core/contract/net";
import { createSnapshotBuffer, type SnapshotBuffer } from "./interpolation";
import {
  createMockNet,
  deviceToken,
  type BotPolicy,
  type ClientStatus,
  type MockNetPort,
  type NetStats,
  type SeatRejection,
} from "./mockNet";
import { createPeerTransport } from "./peerNet";
import type { NetStateCodec } from "./snapshot";

/**
 * El tipo vive en el contrato: lo elige el contenedor y lo tiene que leer el
 * juego. Se reexporta para no romper a quien ya lo importaba desde aca.
 */
export type { NetTransportKind } from "@/core/contract/net";

/**
 * El hook que arma la red y le da al juego un `GameNetPort` listo.
 *
 * Un juego no instancia transporte ni sabe de BroadcastChannel: pide sala,
 * rol, asiento y cuantos asientos hay, y recibe el puerto. El dia que entre
 * WebRTC se cambia la fabrica de aca adentro y ningun juego se entera.
 *
 * Lo que resuelve por vos:
 *
 * - Token estable del aparato, para volver al mismo asiento tras un refresh.
 * - Buffer de interpolacion del lado del cliente: `sampleState` devuelve el
 *   estado de hace ~100 ms, que es lo que hay que dibujar, no el ultimo.
 * - Aviso de asiento ocupado con la lista de los que quedan libres.
 * - Diagnostico (roster, rtt, bytes) muestreado a 4 Hz, no a 60: el HUD no
 *   necesita mas y React tampoco.
 *
 * Lo que NO hace: predecir. Eso pide la simulacion del juego, asi que se
 * arma con `createPrediction` del lado del juego, alimentado por el
 * `ackedSequence` que llega en `onState`.
 */

const SAMPLE_MS = 250;

export type UseGameNetOptions<TInput, TState> = {
  roomId: string;
  role: NetRole;
  /** Asiento propio. En el host, `-1` = proyector que no juega. */
  seat: number;
  seats: number;
  /** false desconecta todo y devuelve `net: null`. Util en los juegos `solo`. */
  enabled?: boolean;
  name?: string;
  conditions?: Partial<NetConditions>;
  /** Sin codec el estado viaja como objeto. Con `createSnapshotCodec()` viaja empaquetado. */
  codec?: NetStateCodec<TState>;
  /** Sin esto los asientos vacios se llenan igual, pero el bot no juega. */
  bot?: BotPolicy<TInput>;
  /** Habilita `sampleState`. Para `NetSnapshot` alcanza con `lerpSnapshot`. */
  interpolate?: { lerp: (a: TState, b: TState, t: number) => TState; delayMs?: number };
  onInput?: (playerId: string, input: TInput, sequence: number) => void;
  onState?: (state: TState, tick: number, ackedSequence: number) => void;
  onPlayerJoin?: (player: NetPlayer) => void;
  onPlayerLeave?: (playerId: string) => void;
  /** Por defecto `local`. Ver `NetTransportKind`. */
  transport?: NetTransportKind;
};

export type GameNetHandle<TInput, TState> = {
  /** `null` mientras monta o si `enabled` es false. */
  net: MockNetPort<TInput, TState> | null;
  players: readonly NetPlayer[];
  status: ClientStatus | "off";
  /** "Ese lugar está ocupado": el segundo que escaneo el mismo QR. */
  rejection: SeatRejection | null;
  rttMs: number;
  /** Por que no conecta el transporte. null = anda, o no reporta. */
  transportError: string | null;
  stats: NetStats;
  conditions: NetConditions;
  setConditions: (next: Partial<NetConditions>) => void;
  claimSeat: (seat: number) => void;
  /** Estado interpolado de hace ~100 ms. Es lo que dibuja el cliente. */
  sampleState: (nowMs?: number) => TState | null;
};

const EMPTY_STATS: NetStats = {
  sentPackets: 0,
  sentBytes: 0,
  recvPackets: 0,
  recvBytes: 0,
  droppedState: 0,
  rejectedFromClient: 0,
};

export function useGameNet<TInput, TState>(
  options: UseGameNetOptions<TInput, TState>,
): GameNetHandle<TInput, TState> {
  const { roomId, role, seat, seats, name } = options;
  const enabled = options.enabled ?? true;
  const latencyMs = options.conditions?.latencyMs ?? DEFAULT_CONDITIONS.latencyMs;
  const jitterMs = options.conditions?.jitterMs ?? DEFAULT_CONDITIONS.jitterMs;
  const lossRate = options.conditions?.lossRate ?? DEFAULT_CONDITIONS.lossRate;
  const transport = options.transport ?? "local";

  const [net, setNet] = useState<MockNetPort<TInput, TState> | null>(null);
  const [players, setPlayers] = useState<readonly NetPlayer[]>([]);
  const [status, setStatus] = useState<ClientStatus | "off">("off");
  const [rejection, setRejection] = useState<SeatRejection | null>(null);
  const [rttMs, setRttMs] = useState(0);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [stats, setStats] = useState<NetStats>(EMPTY_STATS);
  const [conditions, setConditionsState] = useState<NetConditions>({ latencyMs, jitterMs, lossRate });

  // Todo lo que el puerto lee una sola vez al crearse vive en refs: cambiar la
  // identidad de un callback no puede tirar abajo la conexion en el medio de
  // una partida.
  const portRef = useRef<MockNetPort<TInput, TState> | null>(null);
  const bufferRef = useRef<SnapshotBuffer<TState> | null>(null);
  const latestRef = useRef<TState | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!enabled) {
      setNet(null);
      setStatus("off");
      return;
    }
    const current = optionsRef.current;
    const port = createMockNet<TInput, TState>({
      roomId,
      role,
      seat,
      seats,
      name,
      token: deviceToken(roomId),
      conditions: { latencyMs, jitterMs, lossRate },
      codec: current.codec,
      bot: current.bot,
      ...(transport === "webrtc" ? { transport: createPeerTransport } : {}),
    });
    portRef.current = port;

    const interpolate = current.interpolate;
    bufferRef.current = interpolate
      ? createSnapshotBuffer<TState>({
          lerp: interpolate.lerp,
          delayMs: interpolate.delayMs,
        })
      : null;
    latestRef.current = null;

    const offInput = port.onInput((playerId, input, sequence) => {
      optionsRef.current.onInput?.(playerId, input, sequence);
    });
    const offState = port.onState((state, tick, acked) => {
      latestRef.current = state;
      bufferRef.current?.push(state, tick, performance.now());
      optionsRef.current.onState?.(state, tick, acked);
    });
    const offJoin = port.onPlayerJoin((player) => {
      setPlayers(port.players());
      optionsRef.current.onPlayerJoin?.(player);
    });
    const offLeave = port.onPlayerLeave((playerId) => {
      setPlayers(port.players());
      optionsRef.current.onPlayerLeave?.(playerId);
    });
    const offRejected = port.onSeatRejected((next) => {
      setRejection(next);
    });

    setNet(port);
    setPlayers(port.players());
    setStatus(port.status);

    // El HUD de diagnostico se refresca 4 veces por segundo, no 60.
    const sampler = window.setInterval(() => {
      setPlayers(port.players());
      setStatus(port.status);
      setRttMs(port.rttMs);
      setTransportError(port.transportError);
      setStats(port.stats());
      setRejection(port.rejection);
    }, SAMPLE_MS);

    return () => {
      window.clearInterval(sampler);
      offInput();
      offState();
      offJoin();
      offLeave();
      offRejected();
      port.dispose();
      portRef.current = null;
      bufferRef.current = null;
      latestRef.current = null;
      setNet(null);
    };
    // Cambiar de transporte rehace la sesion entera: son dos redes distintas.
  }, [roomId, role, seat, seats, name, enabled, latencyMs, jitterMs, lossRate, transport]);

  const setConditions = useCallback((next: Partial<NetConditions>) => {
    setConditionsState((previous) => {
      const merged = { ...previous, ...next };
      portRef.current?.setConditions(merged);
      return merged;
    });
  }, []);

  const claimSeat = useCallback((next: number) => {
    setRejection(null);
    portRef.current?.claimSeat(next);
  }, []);

  const sampleState = useCallback((nowMs?: number) => {
    const buffer = bufferRef.current;
    if (!buffer) return latestRef.current;
    return buffer.sample(nowMs ?? performance.now());
  }, []);

  return {
    net,
    players,
    status,
    rejection,
    rttMs,
    transportError,
    stats,
    conditions,
    setConditions,
    claimSeat,
    sampleState,
  };
}
