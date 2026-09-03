import { DEFAULT_CONDITIONS } from "@/core/contract/gameNet";
import type { GameNetPort, NetConditions, NetPlayer, NetRole } from "@/core/contract/gameNet";
import type { ControlSpec } from "@/core/contract/control";
import type { NetMessage, TransportFactory } from "@/core/contract/net";
import { createRng, type Rng } from "@/core/engine/rng";
import { createBroadcastNet } from "./broadcastNet";
import type { NetStateCodec } from "./snapshot";

/**
 * La sesion de red: el protocolo, independiente del transporte.
 *
 * Aca vive TODO lo que hace que una partida funcione —reparto de asientos,
 * bots, autoridad del host, snapshots, reconexion— y nada de como viajan los
 * bytes. El transporte se inyecta: BroadcastChannel por defecto (dos pestanas
 * de la misma maquina, que es lo que sirve para desarrollar) o WebRTC con
 * `createPeerTransport` para celulares de verdad.
 *
 * El transporte ya existe (`broadcastNet`); esto pone arriba lo que hace que sea
 * un juego y no un chat:
 *
 * - **Autoridad.** El host acepta `claim`, `input`, `hb`, `ping`, `kf` y `bye`.
 *   Cualquier otra cosa que mande un cliente, incluido estado o puntaje, se
 *   cuenta y se tira. Confiar en el cliente es la forma mas rapida de que
 *   alguien gane un premio abriendo la consola.
 * - **Ritmos.** Estado a 20 Hz, input a 30 Hz. El juego puede llamar todo lo
 *   seguido que quiera: el puerto agrupa y manda el ultimo valor, que es el
 *   unico que importa cuando lo que viaja es la posicion de un dedo.
 * - **Condiciones reales.** 80 ms de latencia por defecto, jitter y perdida.
 *   Un juego de red probado a 0 ms no esta probado.
 * - **Bots.** Completan los asientos vacios. Sin esto, probar un Pong exige
 *   dos personas y el juego no se puede desarrollar.
 */

/** Contrato: estado a 20 Hz, input a 30 Hz, render a 60. */
export const STATE_HZ = 20;
export const INPUT_HZ = 30;

const STATE_INTERVAL_MS = 1000 / STATE_HZ;
const INPUT_INTERVAL_MS = 1000 / INPUT_HZ;
const HEARTBEAT_MS = 500;
const SWEEP_MS = 250;
const ROSTER_MS = 1000;
const PING_MS = 1000;
/** Sin latidos por mas que esto, el asiento se considera caido. */
const PLAYER_TIMEOUT_MS = 2500;
/** El celular que se cayo tiene su asiento guardado 10 s (spec, seccion 8). */
const RECLAIM_WINDOW_MS = 10_000;
/** Silencio del host antes de dar la conexion por perdida. */
const HOST_TIMEOUT_MS = 3000;
const CLAIM_RETRY_MS = 600;

const MSG_CLAIM = "g:claim";
const MSG_SEAT = "g:seat";
const MSG_ROSTER = "g:roster";
const MSG_INPUT = "g:in";
const MSG_STATE = "g:state";
const MSG_HB = "g:hb";
const MSG_PING = "g:ping";
const MSG_PONG = "g:pong";
const MSG_KEYFRAME = "g:kf";
const MSG_BYE = "g:bye";
/** Host -> cliente: que dibujar en el telefono. Nunca al reves. */
const MSG_CONTROL = "g:ctl";

/** Los unicos tipos que un host acepta de un cliente. */
const CLIENT_TO_HOST = new Set([MSG_CLAIM, MSG_INPUT, MSG_HB, MSG_PING, MSG_KEYFRAME, MSG_BYE]);

export type SeatRejectionReason = "taken" | "reserved" | "out-of-range";

export type SeatRejection = {
  seat: number;
  reason: SeatRejectionReason;
  /** Para que el segundo que escaneo el mismo QR pueda tomar otro. */
  freeSeats: readonly number[];
};

export type NetStats = {
  sentPackets: number;
  sentBytes: number;
  recvPackets: number;
  recvBytes: number;
  /** Snapshots viejos o sin base que se descartaron. */
  droppedState: number;
  /** Mensajes de cliente que el host tiro por no ser input. */
  rejectedFromClient: number;
};

export type ClientStatus = "claiming" | "live" | "reconnecting" | "rejected";

export type BotContext = {
  seat: number;
  playerId: string;
  /** ms desde que arranco el puerto. */
  elapsedMs: number;
  /** Sembrado por asiento: el mismo bot juega igual dos veces seguidas. */
  rng: Rng;
};

export type BotPolicy<TInput> = {
  policy: (ctx: BotContext) => TInput;
  /** Por defecto los mismos 30 Hz que una persona. */
  hz?: number;
};

export type MockNetOptions<TInput, TState> = {
  roomId: string;
  role: NetRole;
  /** Asiento propio. En el host, `-1` = proyector que no juega. */
  seat: number;
  /** Asientos totales del juego. Los que sobran los completan bots. */
  seats: number;
  name?: string;
  /** Token estable del dispositivo: es lo que permite volver al mismo asiento. */
  token?: string;
  conditions?: Partial<NetConditions>;
  /** Sin codec el estado viaja como objeto: sirve para prototipar, no para medir. */
  codec?: NetStateCodec<TState>;
  bot?: BotPolicy<TInput>;
  /** ms antes de completar con bots los asientos vacios. */
  botFillDelayMs?: number;
  seed?: string;
  /**
   * Por defecto BroadcastChannel: dos pestanas de la misma maquina, que es lo
   * que sirve para desarrollar. `createPeerTransport` lo cambia por WebRTC sin
   * tocar una linea del protocolo.
   */
  transport?: TransportFactory;
};

export type MockNetPort<TInput, TState> = GameNetPort<TInput, TState> & {
  readonly conditions: NetConditions;
  setConditions(next: Partial<NetConditions>): void;
  /** Solo cliente: "ese lugar esta ocupado" con los asientos que quedan libres. */
  onSeatRejected(cb: (rejection: SeatRejection) => void): () => void;
  /** Solo cliente: tomar otro asiento despues del rechazo. */
  claimSeat(seat: number): void;
  readonly status: ClientStatus;
  /** Solo cliente: el ultimo rechazo, para pintarlo sin suscribirse. */
  readonly rejection: SeatRejection | null;
  stats(): NetStats;
};

/** `to: null` = para toda la sala. */
type ControlEnvelope = { spec: ControlSpec; to: string | null };

type ClaimPayload = { token: string; seat: number; name: string };
type SeatPayload = {
  token: string;
  seat: number;
  ok: boolean;
  reason: SeatRejectionReason | null;
  freeSeats: number[];
};
type RosterPayload = { hostId: string; players: NetPlayer[] };
type InputPayload<TInput> = { token: string; seq: number; input: TInput; ackTick: number };
type StatePayload<TState> = {
  tick: number;
  bytes: Uint8Array | null;
  state: TState | null;
  acks: Uint32Array;
};
/** `ackTick` viaja en todo lo que manda el cliente: es lo que fija la base del delta. */
type TokenPayload = { token: string; ackTick?: number };
type PingPayload = { token: string; t: number };

type SeatSlot = {
  index: number;
  player: NetPlayer | null;
  /** Token del humano dueno del asiento, aunque este caido. */
  token: string | null;
  lastSeenMs: number;
  /** Hasta cuando el asiento le queda guardado a quien se cayo. */
  reclaimUntilMs: number;
  /** Ultimo input procesado: es el ack que deja re-simular al cliente. */
  lastSequence: number;
  botSequence: number;
  /** Ultimo tick de estado que este cliente dijo haber reconstruido. */
  confirmedTick: number;
};

type Emitter<TArgs extends unknown[]> = {
  add(cb: (...args: TArgs) => void): () => void;
  emit(...args: TArgs): void;
  clear(): void;
};

function createEmitter<TArgs extends unknown[]>(): Emitter<TArgs> {
  const handlers = new Set<(...args: TArgs) => void>();
  return {
    add(cb) {
      handlers.add(cb);
      return () => {
        handlers.delete(cb);
      };
    },
    emit(...args) {
      // Copia: un handler puede desuscribirse mientras se emite.
      for (const cb of [...handlers]) cb(...args);
    },
    clear() {
      handlers.clear();
    },
  };
}

/**
 * Limita el ritmo sin perder el ultimo valor.
 *
 * Tirar lo que llega de mas perderia justo el input mas nuevo, que es el
 * unico que importa. Se manda al toque si paso el intervalo, y si no se
 * guarda y sale solo al abrirse la ventana.
 */
type Pacer<T> = { push(value: T): void; stop(): void };

function createPacer<T>(intervalMs: number, send: (value: T) => void): Pacer<T> {
  let pending: T | null = null;
  let hasPending = false;
  let lastSentMs = Number.NEGATIVE_INFINITY;
  let timer = 0;

  const flush = () => {
    timer = 0;
    if (!hasPending) return;
    const value = pending as T;
    pending = null;
    hasPending = false;
    lastSentMs = performance.now();
    send(value);
  };

  return {
    push(value) {
      const now = performance.now();
      const waited = now - lastSentMs;
      if (waited >= intervalMs) {
        lastSentMs = now;
        pending = null;
        hasPending = false;
        send(value);
        return;
      }
      pending = value;
      hasPending = true;
      if (timer === 0) timer = window.setTimeout(flush, intervalMs - waited);
    },
    stop() {
      if (timer !== 0) window.clearTimeout(timer);
      timer = 0;
      pending = null;
      hasPending = false;
    },
  };
}

export function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Token estable por sala. Sobrevive un refresh, que es exactamente el caso
 * del celular que perdio red y vuelve: el asiento sale de la URL y el token
 * dice que es el mismo aparato, asi que recuperarlo es determinista.
 */
export function deviceToken(roomId: string): string {
  const key = `supernova:net:${roomId}`;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    const next = randomToken();
    sessionStorage.setItem(key, next);
    return next;
  } catch {
    return randomToken();
  }
}

export function createMockNet<TInput, TState>(options: MockNetOptions<TInput, TState>): MockNetPort<TInput, TState> {
  const seats = Math.max(1, Math.round(options.seats));
  const role = options.role;
  const token = options.token ?? randomToken();
  const codec = options.codec ?? null;
  const botFillDelayMs = options.botFillDelayMs ?? 2000;
  const startedAtMs = performance.now();

  let conditions: NetConditions = { ...DEFAULT_CONDITIONS, ...options.conditions };
  let seat = Math.min(seats - 1, Math.max(role === "host" ? -1 : 0, Math.round(options.seat)));
  let disposed = false;

  const name = options.name ?? (role === "host" && seat < 0 ? "Proyector" : `Jugador ${seat + 1}`);
  const makeTransport = options.transport ?? createBroadcastNet;
  const transport = makeTransport({
    roomId: options.roomId,
    seat: Math.max(0, seat),
    role,
    name,
  });
  transport.setSimulation({ latencyMs: conditions.latencyMs, lossRate: conditions.lossRate });

  const inputEmitter = createEmitter<[string, TInput, number]>();
  const stateEmitter = createEmitter<[TState, number, number]>();
  const joinEmitter = createEmitter<[NetPlayer]>();
  const leaveEmitter = createEmitter<[string]>();
  const rejectEmitter = createEmitter<[SeatRejection]>();
  const controlEmitter = createEmitter<[ControlSpec]>();
  /** Lo ultimo que dijo el host, para reenviarselo a quien entra tarde. */
  let lastControl: ControlSpec | null = null;

  const timers = new Set<number>();
  const intervals = new Set<number>();
  const stats: NetStats = {
    sentPackets: 0,
    sentBytes: 0,
    recvPackets: 0,
    recvBytes: 0,
    droppedState: 0,
    rejectedFromClient: 0,
  };

  let rttMs = conditions.latencyMs * 2;
  let status: ClientStatus = role === "host" ? "live" : "claiming";

  function every(intervalMs: number, fn: () => void): void {
    const id = window.setInterval(() => {
      if (disposed) return;
      fn();
    }, intervalMs);
    intervals.add(id);
  }

  /** El jitter se agrega al recibir: la latencia base ya la pone el transporte. */
  function receiveLater(fn: () => void): void {
    if (conditions.jitterMs <= 0) {
      fn();
      return;
    }
    const delay = Math.random() * conditions.jitterMs;
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, delay);
    timers.add(id);
  }

  function post<T>(type: string, payload: T, bytes = 0): void {
    if (disposed) return;
    stats.sentPackets++;
    stats.sentBytes += bytes;
    transport.send(type, payload);
  }

  /* --------------------------------------------------------------- */
  /* Host                                                              */
  /* --------------------------------------------------------------- */

  const slots: SeatSlot[] = Array.from({ length: seats }, (_, index) => ({
    index,
    player: null,
    token: null,
    lastSeenMs: 0,
    reclaimUntilMs: 0,
    lastSequence: 0,
    botSequence: 0,
    confirmedTick: 0,
  }));
  const botRngs = new Map<number, Rng>();
  let roster: NetPlayer[] = [];
  let lastStateTick = -1;
  let hostId: string | null = role === "host" ? transport.playerId : null;

  function slotAt(index: number): SeatSlot | null {
    return slots[index] ?? null;
  }

  function freeSeats(nowMs: number): number[] {
    return slots
      .filter((slot) => {
        if (slot.player && !slot.player.bot && slot.player.connected) return false;
        if (slot.token && nowMs < slot.reclaimUntilMs) return false;
        return true;
      })
      .map((slot) => slot.index);
  }

  function publishRoster(): void {
    roster = slots.flatMap((slot) => (slot.player ? [slot.player] : []));
    if (role !== "host") return;
    post<RosterPayload>(MSG_ROSTER, { hostId: transport.playerId, players: roster });
  }

  function botRng(index: number): Rng {
    const existing = botRngs.get(index);
    if (existing) return existing;
    const created = createRng(`${options.seed ?? options.roomId}:bot:${index}`);
    botRngs.set(index, created);
    return created;
  }

  function installBot(slot: SeatSlot): void {
    if (slot.player?.bot) return;
    const previous = slot.player;
    slot.player = {
      id: `bot-${slot.index}`,
      seat: slot.index,
      name: `Bot ${slot.index + 1}`,
      bot: true,
      connected: true,
    };
    if (previous) leaveEmitter.emit(previous.id);
    joinEmitter.emit(slot.player);
    publishRoster();
  }

  function seatHuman(slot: SeatSlot, playerId: string, humanToken: string, humanName: string): void {
    const previous = slot.player;
    // Reintento del mismo aparato ya sentado: refrescar y nada mas. Anunciar
    // dos veces al mismo jugador le duplica la entidad al juego.
    if (previous && previous.id === playerId && previous.connected) {
      slot.lastSeenMs = performance.now();
      slot.reclaimUntilMs = 0;
      return;
    }
    slot.token = humanToken;
    slot.lastSeenMs = performance.now();
    slot.reclaimUntilMs = 0;
    slot.player = {
      id: playerId,
      seat: slot.index,
      name: humanName,
      bot: false,
      connected: true,
    };
    // El bot que le estaba guardando el lugar se va: la persona manda.
    if (previous && previous.id !== playerId) leaveEmitter.emit(previous.id);
    joinEmitter.emit(slot.player);
    publishRoster();
  }

  function handleClaim(from: string, payload: ClaimPayload): void {
    const now = performance.now();
    const target = slotAt(payload.seat);
    const reject = (reason: SeatRejectionReason) => {
      post<SeatPayload>(MSG_SEAT, {
        token: payload.token,
        seat: payload.seat,
        ok: false,
        reason,
        freeSeats: freeSeats(now),
      });
    };

    if (!target) {
      reject("out-of-range");
      return;
    }
    const occupant = target.player;
    const sameDevice = target.token === payload.token;
    // Dos celulares escaneando el mismo QR es el caso mas probable de una
    // sala real: el segundo tiene que enterarse, no quedarse mudo.
    if (!sameDevice && occupant && !occupant.bot && occupant.connected) {
      reject("taken");
      return;
    }
    // Asiento guardado para quien se cayo recien: hasta que se venza la
    // ventana no lo agarra otro, o el que perdio red vuelve y no tiene donde.
    if (!sameDevice && target.token && now < target.reclaimUntilMs) {
      reject("reserved");
      return;
    }

    seatHuman(target, from, payload.token, payload.name);
    // Quien entra a mitad de una ronda tiene que ver algo, no una pantalla muda.
    if (lastControl) post<ControlEnvelope>(MSG_CONTROL, { spec: lastControl, to: null });
    post<SeatPayload>(MSG_SEAT, {
      token: payload.token,
      seat: target.index,
      ok: true,
      reason: null,
      freeSeats: freeSeats(now),
    });
  }

  function handleHostMessage(msg: NetMessage): void {
    if (!CLIENT_TO_HOST.has(msg.type)) {
      // Regla de oro: el host recibe input, nunca estado ni puntaje.
      stats.rejectedFromClient++;
      return;
    }
    stats.recvPackets++;

    if (msg.type === MSG_CLAIM) {
      handleClaim(msg.from, msg.payload as ClaimPayload);
      return;
    }
    if (msg.type === MSG_KEYFRAME) {
      codec?.requestKeyframe();
      return;
    }

    const payload = msg.payload as TokenPayload;
    const slot = slots.find((candidate) => candidate.token === payload?.token);
    // Un aparato sin asiento no juega. Es la puerta por la que entraria
    // cualquiera que abra la consola y empiece a mandar mensajes.
    if (!slot) return;
    slot.lastSeenMs = performance.now();
    const ackTick = payload?.ackTick ?? 0;
    if (ackTick > slot.confirmedTick) slot.confirmedTick = ackTick;

    if (msg.type === MSG_INPUT) {
      const input = msg.payload as InputPayload<TInput>;
      if (slot.player && !slot.player.connected) {
        slot.player = { ...slot.player, connected: true };
        publishRoster();
      }
      if (input.seq > slot.lastSequence) slot.lastSequence = input.seq;
      const player = slot.player;
      if (player) inputEmitter.emit(player.id, input.input, input.seq);
      return;
    }
    if (msg.type === MSG_PING) {
      const ping = msg.payload as PingPayload;
      post<PingPayload>(MSG_PONG, { token: ping.token, t: ping.t });
      return;
    }
    if (msg.type === MSG_BYE) {
      dropSlot(slot, performance.now());
    }
  }

  function dropSlot(slot: SeatSlot, nowMs: number): void {
    const player = slot.player;
    if (!player || player.bot) return;
    slot.reclaimUntilMs = nowMs + RECLAIM_WINDOW_MS;
    leaveEmitter.emit(player.id);
    slot.player = null;
    // El bot entra en el acto: una partida no se cuelga porque alguien
    // cerro el celular.
    installBot(slot);
  }

  function sweep(): void {
    const now = performance.now();
    let changed = false;
    for (const slot of slots) {
      const player = slot.player;
      if (player && !player.bot && now - slot.lastSeenMs > PLAYER_TIMEOUT_MS) {
        dropSlot(slot, now);
        changed = true;
        continue;
      }
      if (slot.token && slot.reclaimUntilMs > 0 && now >= slot.reclaimUntilMs) {
        // Se vencio la espera: el asiento vuelve a estar disponible para
        // cualquiera, y mientras tanto lo sigue jugando el bot.
        slot.token = null;
        slot.reclaimUntilMs = 0;
        changed = true;
      }
      if (!slot.player && now - startedAtMs >= botFillDelayMs) {
        installBot(slot);
        changed = true;
      }
    }
    if (changed) publishRoster();
  }

  function pumpBots(): void {
    const bot = options.bot;
    if (!bot) return;
    const elapsedMs = performance.now() - startedAtMs;
    for (const slot of slots) {
      const player = slot.player;
      if (!player?.bot) continue;
      slot.botSequence++;
      slot.lastSequence = slot.botSequence;
      // Un bot manda input igual que una persona: no escribe estado ni
      // puntaje. Es la misma regla para todos.
      const input = bot.policy({
        seat: slot.index,
        playerId: player.id,
        elapsedMs,
        rng: botRng(slot.index),
      });
      inputEmitter.emit(player.id, input, slot.botSequence);
    }
  }

  /**
   * El tick mas viejo que confirmo alguien que esta escuchando. El delta se
   * arma contra eso: asi un paquete perdido cuesta ese paquete y no la cadena
   * entera hasta el proximo keyframe. `undefined` cuando no hay humanos
   * conectados y nadie puede quedarse sin base.
   */
  function confirmedBaseTick(): number | null | undefined {
    let oldest: number | null = null;
    for (const slot of slots) {
      const player = slot.player;
      if (!player || player.bot || !player.connected) continue;
      if (player.id === transport.playerId) continue;
      if (slot.confirmedTick <= 0) return null;
      oldest = oldest === null ? slot.confirmedTick : Math.min(oldest, slot.confirmedTick);
    }
    return oldest ?? undefined;
  }

  const statePacer = createPacer<{ state: TState; tick: number; acks: Readonly<Record<string, number>> }>(
    STATE_INTERVAL_MS,
    ({ state, tick, acks }) => {
      const ackArray = new Uint32Array(seats);
      for (const slot of slots) ackArray[slot.index] = slot.lastSequence;
      for (const [playerId, sequence] of Object.entries(acks)) {
        const slot = slots.find((candidate) => candidate.player?.id === playerId);
        if (slot) ackArray[slot.index] = sequence;
      }
      const bytes = codec ? codec.encode(state, confirmedBaseTick()) : null;
      post<StatePayload<TState>>(
        MSG_STATE,
        { tick, bytes, state: bytes ? null : state, acks: ackArray },
        bytes?.byteLength ?? 0,
      );
    },
  );

  /* --------------------------------------------------------------- */
  /* Cliente                                                           */
  /* --------------------------------------------------------------- */

  let desiredSeat = Math.max(0, seat);
  let rejection: SeatRejection | null = null;
  let lastHostMs = performance.now();

  function sendClaim(): void {
    post<ClaimPayload>(MSG_CLAIM, { token, seat: desiredSeat, name });
  }

  function applyRoster(players: readonly NetPlayer[]): void {
    const before = new Map(roster.map((player) => [player.id, player]));
    const after = new Map(players.map((player) => [player.id, player]));
    for (const player of players) {
      if (!before.has(player.id)) joinEmitter.emit(player);
    }
    for (const player of roster) {
      if (!after.has(player.id)) leaveEmitter.emit(player.id);
    }
    roster = [...players];
  }

  function handleClientMessage(msg: NetMessage): void {
    stats.recvPackets++;

    if (msg.type === MSG_SEAT) {
      const payload = msg.payload as SeatPayload;
      if (payload.token !== token) return;
      hostId = msg.from;
      lastHostMs = performance.now();
      if (payload.ok) {
        seat = payload.seat;
        desiredSeat = payload.seat;
        rejection = null;
        status = "live";
        return;
      }
      rejection = { seat: payload.seat, reason: payload.reason ?? "taken", freeSeats: payload.freeSeats };
      status = "rejected";
      rejectEmitter.emit(rejection);
      return;
    }

    if (msg.type === MSG_CONTROL) {
      // Solo del host: un cliente no le dicta la pantalla a otro.
      if (hostId !== null && msg.from !== hostId) return;
      const envelope = msg.payload as ControlEnvelope;
      // Sin destinatario es para toda la sala; con destinatario, solo para uno.
      if (envelope.to !== null && envelope.to !== transport.playerId) return;
      controlEmitter.emit(envelope.spec);
      return;
    }

    if (msg.type === MSG_ROSTER) {
      const payload = msg.payload as RosterPayload;
      hostId = payload.hostId;
      lastHostMs = performance.now();
      if (status === "reconnecting") status = "live";
      applyRoster(payload.players);
      return;
    }

    if (msg.type === MSG_PONG) {
      const payload = msg.payload as PingPayload;
      if (payload.token !== token) return;
      lastHostMs = performance.now();
      rttMs = Math.round(performance.now() - payload.t);
      return;
    }

    if (msg.type !== MSG_STATE) return;
    // Estado solo del host. Un cliente que manda estado se ignora, aca y del
    // otro lado: es la misma regla mirada desde el receptor.
    if (hostId !== null && msg.from !== hostId) {
      stats.rejectedFromClient++;
      return;
    }
    if (status !== "live") return;

    const payload = msg.payload as StatePayload<TState>;
    lastHostMs = performance.now();
    stats.recvBytes += payload.bytes?.byteLength ?? 0;

    // Desorden: un tick viejo que llega tarde ya no sirve para nada.
    if (payload.tick <= lastStateTick) {
      stats.droppedState++;
      return;
    }

    let state: TState | null;
    if (payload.bytes && codec) {
      state = codec.decode(payload.bytes);
      if (state === null) {
        // Se perdio la base del delta: se pide keyframe y se sigue.
        stats.droppedState++;
        post(MSG_KEYFRAME, { token });
        return;
      }
    } else {
      state = payload.state;
    }
    if (state === null) return;

    lastStateTick = payload.tick;
    const ack = payload.acks?.[seat] ?? 0;
    stateEmitter.emit(state, payload.tick, ack);
  }

  const inputPacer = createPacer<{ input: TInput; sequence: number }>(INPUT_INTERVAL_MS, ({ input, sequence }) => {
    post<InputPayload<TInput>>(MSG_INPUT, { token, seq: sequence, input, ackTick: lastStateTick });
  });

  /* --------------------------------------------------------------- */
  /* Cableado                                                          */
  /* --------------------------------------------------------------- */

  const unsubscribe = transport.on((msg) => {
    if (disposed) return;
    receiveLater(() => {
      if (role === "host") handleHostMessage(msg);
      else handleClientMessage(msg);
    });
  });

  if (role === "host") {
    if (seat >= 0) {
      const own = slotAt(seat);
      if (own) seatHuman(own, transport.playerId, token, name);
    }
    every(SWEEP_MS, sweep);
    every(ROSTER_MS, publishRoster);
    if (options.bot) every(1000 / (options.bot.hz ?? INPUT_HZ), pumpBots);
    publishRoster();
  } else {
    sendClaim();
    every(CLAIM_RETRY_MS, () => {
      // Reintento eterno mientras no haya asiento: el celular que perdio red
      // vuelve solo, sin que nadie toque nada.
      if (status === "claiming" || status === "reconnecting") sendClaim();
    });
    every(HEARTBEAT_MS, () => {
      if (status === "live") post<TokenPayload>(MSG_HB, { token, ackTick: lastStateTick });
      if (performance.now() - lastHostMs > HOST_TIMEOUT_MS && status === "live") {
        status = "reconnecting";
        sendClaim();
      }
    });
    every(PING_MS, () => {
      post<PingPayload>(MSG_PING, { token, t: performance.now() });
    });
  }

  return {
    role,
    get playerId() {
      return transport.playerId;
    },
    get seat() {
      return seat;
    },
    roomId: options.roomId,

    sendInput(input, sequence) {
      if (disposed) return;
      if (role === "host") {
        // El proyector que ademas juega no manda nada por el canal: su input
        // ya esta en la maquina que simula.
        const own = seat >= 0 ? slotAt(seat) : null;
        const player = own?.player;
        if (!own || !player) return;
        if (sequence > own.lastSequence) own.lastSequence = sequence;
        inputEmitter.emit(player.id, input, sequence);
        return;
      }
      if (status !== "live") return;
      inputPacer.push({ input, sequence });
    },

    onInput(cb) {
      // En un cliente no hay input ajeno que escuchar: nunca dispara.
      if (role !== "host") return () => {};
      return inputEmitter.add(cb);
    },

    broadcastState(state, tick, acks) {
      if (disposed) return;
      if (role !== "host") {
        // Un cliente que intenta publicar estado se cuenta y se ignora.
        stats.rejectedFromClient++;
        return;
      }
      statePacer.push({ state, tick, acks });
    },

    sendControl(spec, toPlayerId) {
      // Solo el host dibuja el telefono ajeno. En un cliente es no-op contado.
      if (role !== "host") {
        stats.rejectedFromClient++;
        return;
      }
      const to = toPlayerId ?? null;
      // Lo dirigido no se guarda como "lo ultimo": reenviarselo a quien entra
      // tarde le mostraria un aviso que era de otra persona.
      if (to === null) lastControl = spec;
      post<ControlEnvelope>(MSG_CONTROL, { spec, to });
    },
    onControl(cb) {
      return controlEmitter.add(cb);
    },
    onState(cb) {
      if (role === "host") return () => {};
      return stateEmitter.add(cb);
    },

    onPlayerJoin: joinEmitter.add,
    onPlayerLeave: leaveEmitter.add,
    onSeatRejected: rejectEmitter.add,

    players() {
      return roster;
    },

    claimSeat(next) {
      if (role === "host") return;
      desiredSeat = Math.min(seats - 1, Math.max(0, Math.round(next)));
      rejection = null;
      status = "claiming";
      sendClaim();
    },

    get status() {
      return status;
    },

    get rejection() {
      return rejection;
    },

    get rttMs() {
      return rttMs;
    },

    get conditions() {
      return conditions;
    },

    setConditions(next) {
      conditions = { ...conditions, ...next };
      transport.setSimulation({ latencyMs: conditions.latencyMs, lossRate: conditions.lossRate });
    },

    stats() {
      return { ...stats };
    },

    dispose() {
      if (disposed) return;
      if (role !== "host") post<TokenPayload>(MSG_BYE, { token });
      disposed = true;
      inputPacer.stop();
      statePacer.stop();
      for (const id of intervals) window.clearInterval(id);
      for (const id of timers) window.clearTimeout(id);
      intervals.clear();
      timers.clear();
      unsubscribe();
      transport.close();
      inputEmitter.clear();
      stateEmitter.clear();
      joinEmitter.clear();
      leaveEmitter.clear();
      rejectEmitter.clear();
      controlEmitter.clear();
    },
  };
}

/** El ultimo rechazo de asiento, para pintarlo sin suscribirse. */
export function seatRejectionMessage(rejection: SeatRejection): string {
  if (rejection.reason === "out-of-range") return "Ese asiento no existe en esta partida.";
  if (rejection.reason === "reserved") return "Ese lugar está guardado para alguien que se reconecta.";
  return "Ese lugar está ocupado. Elegí otro.";
}
