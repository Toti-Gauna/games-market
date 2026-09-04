import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "@/core/contract/game";
import type { AimBall, ControlInput, ControlSpec } from "@/core/contract/control";
import type { NetPlayer } from "@/core/contract/gameNet";
import { bool, num } from "@/core/contract/settings";
import { createRng } from "@/core/engine/rng";
import { useGameLifecycle } from "@/core/engine/useGameLifecycle";
import { useGameNet } from "@/core/net/useGameNet";
import { Stage } from "@/core/engine3d/Stage";
import { HudStat } from "@/ui/game/GameStage";
import { PoolScene, type PoolTableHandle } from "./PoolScene";
import {
  AIM_ASPECT,
  AIM_BALL_RADIUS,
  AIM_POCKET_RADIUS,
  CUE_BALL,
  GROUP_LABEL,
  HEAD_SPOT_X,
  POCKETS,
  POOL_SEATS,
  TABLE_LENGTH,
  TABLE_WIDTH,
  createPoolState,
  fromAimPoint,
  kindOf,
  poolPoints,
  remainingFor,
  resolveShot,
  seatIndex,
  toAimPoint,
  winnerByRemaining,
  type BallState,
  type Group,
  type PoolState,
  type ShotEvents,
} from "./logic";

/**
 * X2 · Pool.
 *
 * El primer juego 3D del catalogo, y esta primero a proposito: es el unico de
 * los cuatro donde nadie renderiza 3D en el telefono, no hay estado continuo
 * por red y la escena entera son una mesa y dieciseis esferas. Si esto no
 * llega a 60 fps, el problema esta en la base 3D y no en el juego.
 *
 * Tres capas, y el limite entre ellas es lo unico que hay que respetar:
 *
 * - `logic.ts` decide la partida. No sabe que existe three.
 * - `PoolScene.tsx` corre la fisica. No sabe una sola regla: cuando la mesa se
 *   aquieta entrega que se toco primero y que cayo, y nada mas.
 * - Este archivo une las dos y habla con las personas.
 *
 * **La red es de eventos, no de estado.** Se manda un tiro y se recibe una
 * mesa nueva, como en Ludo: no hay snapshots, ni interpolacion, ni prediccion.
 * Por eso Pool es el 3D mas barato de los cuatro, y por eso la latencia no lo
 * afecta — un turno tarda lo que tarda la mesa en aquietarse, no lo que tarda
 * un paquete.
 */

type PoolHud = {
  turn: number;
  group: string;
  remaining: number;
  fouls: number;
  notice: string;
};

/** Cuanto tarda la barra de fuerza del teclado en llenarse. */
const CHARGE_MS = 1100;

/** Lo que gira el apuntado por teclado, en radianes por segundo. */
const AIM_SPEED = 1.4;

/**
 * Cada cuanto se revisa si hay que mandar un `ControlSpec` nuevo.
 *
 * 5 Hz alcanza de sobra para un juego por turnos, y ademas el constructor
 * devuelve null cuando nada cambio: entre tiro y tiro el trafico es cero. Las
 * dieciseis posiciones viajan una sola vez, cuando la mesa se aquieta, y no
 * mientras las bolas ruedan: durante el tiro el mando esta deshabilitado y no
 * tiene nada que redibujar.
 */
const CONTROL_MS = 200;

/** Fuerza del tiro automatico cuando se vence el turno. Suave a proposito. */
const AUTO_SHOT_POWER = 0.35;

const HAPTIC_TURN = [40, 60, 40] as const;

export default function PoolGame({ config, signal, onFinish, onReady }: GameProps) {
  const spinEnabled = bool(config.settings, "spin", true);
  const turnMs = num(config.settings, "turnSeconds", 45) * 1000;

  const tableRef = useRef<PoolTableHandle | null>(null);

  /*
   * El estado de reglas vive en una ref y no en `useState`.
   *
   * Lo muta `resolveShot` desde el callback de la escena, que corre adentro de
   * un `useFrame`: pasar por React ahi seria un render por cuadro. Lo que la
   * pantalla necesita se copia al HUD, que si es estado.
   */
  const stateRef = useRef<PoolState | null>(null);

  const rack = useMemo(() => {
    const state = createPoolState(createRng(config.seed));
    stateRef.current = state;
    return state.balls.map((ball) => ({ ...ball }));
  }, [config.seed]);

  /** La ultima foto de la mesa quieta: es exactamente lo que ve el celular. */
  const snapshotRef = useRef<readonly BallState[]>(rack);
  /** Sube en cada cierre de turno. Es la llave para reenviar el spec. */
  const versionRef = useRef(0);
  /** Cuando vence el turno en curso. 0 = todavia no arranco. */
  const turnEndsAtRef = useRef(0);
  const noticeRef = useRef("");
  const seatPlayerRef = useRef<Array<NetPlayer | null>>([null, null]);

  const playingRef = useRef(false);

  /* ---------------------------------------------------------------- */
  /* Red                                                               */
  /* ---------------------------------------------------------------- */

  const netHandle = useGameNet<ControlInput, never>({
    // La sala la elige el contenedor porque tiene que coincidir con el QR que
    // escanean los celulares. Si el juego inventara una, no se verian.
    roomId: config.roomId,
    // Lo elige el contenedor, igual que la sala: el celular entra por donde
    // dice el QR y el proyector tiene que estar en la misma red.
    transport: config.transport,
    role: "host",
    // -1 = proyector que no juega. Los dos asientos son de los celulares.
    seat: -1,
    seats: POOL_SEATS,
    name: "Proyector",

    onInput: (playerId, input) => {
      const state = stateRef.current;
      const table = tableRef.current;
      if (!state || !table || state.over || !playingRef.current) return;

      // Solo el que tiene el turno mueve la mesa. Un input de otro asiento no
      // es un error del que lo manda: es el que solto el dedo tarde.
      const seat = seatPlayerRef.current.findIndex((p) => p?.id === playerId);
      if (seat !== state.turn) return;
      // Mientras las bolas ruedan no se acepta nada: el turno todavia no dio
      // su resultado.
      if (table.isSettling()) return;

      if (input.kind === "place") {
        if (!state.ballInHand) return;
        const point = fromAimPoint(input.x, input.z);
        table.placeCue(point.x, point.z);
        return;
      }

      if (input.kind !== "shoot") return;
      // Lo que llega de un celular se saneia antes de tocar la simulacion:
      // un `power` de 40 seria un tiro que atraviesa la mesa.
      const power = clamp01(input.power);
      const spin = spinEnabled ? clamp(input.spin, -1, 1) : 0;
      if (!Number.isFinite(input.angle) || power <= 0.05) return;
      table.shoot(input.angle, power, spin);
    },

    onPlayerJoin: (player) => {
      if (player.seat >= 0 && player.seat < POOL_SEATS) {
        seatPlayerRef.current[player.seat] = player;
      }
    },
    onPlayerLeave: (playerId) => {
      const seat = seatPlayerRef.current.findIndex((p) => p?.id === playerId);
      if (seat >= 0) seatPlayerRef.current[seat] = null;
    },
  });

  // El roster llega por el hook a 4 Hz. Se sigue igual aunque un join se haya
  // perdido antes de que montara la escena.
  useEffect(() => {
    const next: Array<NetPlayer | null> = [null, null];
    for (const player of netHandle.players) {
      if (player.seat >= 0 && player.seat < POOL_SEATS) next[player.seat] = player;
    }
    seatPlayerRef.current = next;
  }, [netHandle.players]);

  /* ---------------------------------------------------------------- */
  /* Ciclo de vida                                                     */
  /* ---------------------------------------------------------------- */

  const life = useGameLifecycle<PoolHud>({
    hud: { turn: 0, group: "mesa abierta", remaining: 7, fouls: 0, notice: "" },
    durationMs: config.durationMs,
    countdown: 3,
    // R3F corre su loop adentro del <Canvas>, donde no llega este componente.
    countdownDriver: "internal",
    signal,
    onFinish,
    outcome: (completed, playedMs) => {
      const state = stateRef.current;
      if (!state) return null;
      /*
       * El proyector emite el resultado del asiento 0. Es la simplificacion
       * que ya hace el resto del catalogo: el contenedor guarda una fila por
       * partida, y `meta` lleva lo que hace falta para reconstruir el duelo.
       */
      const seat = 0;
      const winner = state.winner ?? winnerByRemaining(state);
      return {
        completed,
        points: poolPoints({
          ownPocketed: 7 - remainingFor(state, seat),
          fouls: state.fouls[seatIndex(seat)],
          won: winner === seat,
          cleanShots: state.cleanShots[seatIndex(seat)],
        }),
        durationMs: playedMs,
        meta: { winner, fouls: [...state.fouls], cleanShots: [...state.cleanShots] },
      };
    },
  });

  const playing = life.phase === "playing";
  playingRef.current = playing;

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  // El reloj del turno arranca cuando arranca la partida, no al montar: si no,
  // el primer turno nace vencido despues de la cuenta regresiva.
  useEffect(() => {
    if (playing) turnEndsAtRef.current = performance.now() + turnMs;
  }, [playing, turnMs]);

  /* ---------------------------------------------------------------- */
  /* El puente entre la fisica y las reglas                            */
  /* ---------------------------------------------------------------- */

  const onSettled = useCallback(
    (events: ShotEvents) => {
      const state = stateRef.current;
      const table = tableRef.current;
      if (!state || state.over) return;

      const result = resolveShot(state, events);

      // La blanca vuelve al punto de cabecera. Desde ahi el rival la puede
      // mover a donde quiera, que es la compensacion de la falta.
      if (events.pocketed.includes(CUE_BALL)) {
        table?.placeCue(HEAD_SPOT_X, 0);
      }

      snapshotRef.current = table?.read() ?? snapshotRef.current;
      versionRef.current++;
      turnEndsAtRef.current = performance.now() + turnMs;

      const seat = state.turn;
      const group = state.groups[seatIndex(seat)];
      noticeRef.current =
        result.foulText ??
        (result.assigned ? `Te quedan las ${GROUP_LABEL[result.assigned]}.` : "");

      life.setHud({
        turn: seat,
        group: group === null ? "mesa abierta" : GROUP_LABEL[group],
        remaining: remainingFor(state, seat),
        fouls: state.fouls[seatIndex(seat)],
        notice: noticeRef.current,
      });

      if (state.over) life.finish(true);
    },
    [life, turnMs],
  );

  /* ---------------------------------------------------------------- */
  /* Turno vencido                                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const state = stateRef.current;
      const table = tableRef.current;
      if (!state || !table || state.over || table.isSettling()) return;
      if (performance.now() < turnEndsAtRef.current) return;

      /*
       * Se vencio el turno: tiro automatico suave hacia la propia mas cercana.
       *
       * Nunca dejar la mesa trabada. Alguien que se fue con el telefono en el
       * bolsillo no puede congelar una partida de ocho minutos, y un tiro
       * flojo hacia una bola propia es lo mas parecido a "no hacer nada" que
       * igual devuelve el turno.
       */
      const angle = autoShotAngle(snapshotRef.current, state.groups[seatIndex(state.turn)]);
      turnEndsAtRef.current = performance.now() + turnMs;
      if (angle !== null) table.shoot(angle, AUTO_SHOT_POWER, 0);
    }, 250);
    return () => window.clearInterval(timer);
  }, [playing, turnMs]);

  /* ---------------------------------------------------------------- */
  /* Lo que ve cada celular                                            */
  /* ---------------------------------------------------------------- */

  const netPort = netHandle.net;

  useEffect(() => {
    if (!netPort) return;
    const sent = ["", ""];
    const timer = window.setInterval(() => {
      const state = stateRef.current;
      const table = tableRef.current;
      if (!state) return;
      const settling = table?.isSettling() ?? false;

      for (let seat = 0; seat < POOL_SEATS; seat++) {
        const player = seatPlayerRef.current[seat];
        if (!player || player.bot) continue;

        const isTurn = seat === state.turn && !state.over && playingRef.current;
        const enabled = isTurn && !settling;
        /*
         * La firma decide si hay algo que mandar. Cambia con el turno, con la
         * version de la mesa y con el aviso: mientras nadie tira, es la misma
         * y no sale un solo paquete.
         */
        const signature = `${versionRef.current}|${state.turn}|${enabled}|${state.ballInHand}|${noticeRef.current}`;
        if (sent[seat] === signature) continue;
        sent[seat] = signature;

        netPort.sendControl(
          buildAimSpec({
            balls: snapshotRef.current,
            seat,
            state,
            enabled,
            isTurn,
            settling,
            remainingMs: Math.max(0, turnEndsAtRef.current - performance.now()),
            windowMs: turnMs,
            notice: noticeRef.current,
          }),
          player.id,
        );
      }
    }, CONTROL_MS);
    return () => window.clearInterval(timer);
  }, [netPort, turnMs]);

  /* ---------------------------------------------------------------- */
  /* Apuntado local, para el proyector                                 */
  /* ---------------------------------------------------------------- */

  const [angle, setAngle] = useState(0);
  const [spin, setSpin] = useState(0);
  const [power, setPower] = useState(0);
  const chargingRef = useRef(false);
  const heldRef = useRef({ left: false, right: false });

  useEffect(() => {
    if (!playing) return;

    const down = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") heldRef.current.left = true;
      if (event.key === "ArrowRight") heldRef.current.right = true;
      if (event.key === "ArrowUp" && spinEnabled) setSpin((s) => Math.min(1, s + 0.2));
      if (event.key === "ArrowDown" && spinEnabled) setSpin((s) => Math.max(-1, s - 0.2));
      if (event.code === "Space" && !chargingRef.current) {
        chargingRef.current = true;
        event.preventDefault();
      }
    };

    const up = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") heldRef.current.left = false;
      if (event.key === "ArrowRight") heldRef.current.right = false;
      if (event.code === "Space" && chargingRef.current) {
        chargingRef.current = false;
        event.preventDefault();
        setPower((current) => {
          // Un roce sin carga no es un tiro: gastaria el turno sin mover nada.
          if (current > 0.05) tableRef.current?.shoot(angle, current, spin);
          return 0;
        });
      }
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [playing, angle, spin, spinEnabled]);

  /* Giro y carga fuera de la escena: no necesitan el reloj de la fisica. */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const held = heldRef.current;
      if (held.left !== held.right) {
        setAngle((a) => a + (held.right ? AIM_SPEED : -AIM_SPEED) * dt);
      }
      if (chargingRef.current) {
        setPower((p) => Math.min(1, p + (dt * 1000) / CHARGE_MS));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const state = stateRef.current;
  const seatOne = seatPlayerRef.current[0];
  const seatTwo = seatPlayerRef.current[1];

  return (
    <Stage
      phase={life.phase}
      countdownLeft={life.countdownLeft}
      instructions="Escaneá los dos QR. Apuntás desde el celular; con el teclado, ← → y espacio."
      muted={life.muted}
      onToggleMuted={life.toggleMuted}
      onStart={life.start}
      onResume={life.resume}
      onPause={life.pause}
      onRestart={life.restart}
      aspect={TABLE_LENGTH / TABLE_WIDTH}
      camera={{ position: [0, 2.25, TABLE_WIDTH * 0.95], fov: 50, near: 0.05, far: 20 }}
      background="var(--sn-bg)"
      {...(config.debug ? { fps: life.fps, debug: true } : {})}
      hud={
        <>
          <HudStat label="Turno" value={`Jugador ${life.hud.turn + 1}`} />
          <HudStat label="Grupo" value={life.hud.group} />
          <HudStat label="Quedan" value={String(life.hud.remaining)} />
          <HudStat label="Fuerza" value={`${Math.round(power * 100)}%`} />
          {life.hud.notice && <HudStat label="" value={life.hud.notice} />}
        </>
      }
      introExtra={
        <p className="text-xs text-sn-dim">
          {seatOne && seatTwo
            ? "Los dos celulares están conectados."
            : `Faltan ${2 - [seatOne, seatTwo].filter(Boolean).length} celular(es).`}
        </p>
      }
      summary={
        state?.over ? (
          <p className="text-sm text-sn-muted">Ganó el jugador {(state.winner ?? 0) + 1}.</p>
        ) : undefined
      }
    >
      <PoolScene
        rack={rack}
        running={playing}
        reduced={life.reducedMotion}
        onSettled={onSettled}
        handleRef={tableRef}
      />
    </Stage>
  );
}

/* ------------------------------------------------------------------ */
/* El mando                                                            */
/* ------------------------------------------------------------------ */

/**
 * La mesa que se le manda al celular.
 *
 * Van solo las bolas que siguen en juego, ya en las coordenadas del mando. El
 * telefono **no recibe reglas**: recibe circulos, cual es su grupo para
 * resaltarlo, y si puede tirar. Todo lo que decide lo decide el proyector.
 */
function buildAimSpec(input: {
  balls: readonly BallState[];
  seat: number;
  state: PoolState;
  enabled: boolean;
  isTurn: boolean;
  settling: boolean;
  remainingMs: number;
  windowMs: number;
  notice: string;
}): ControlSpec {
  const own = input.state.groups[seatIndex(input.seat)];
  const needsEight = own !== null && remainingFor(input.state, input.seat) === 0;

  const balls: AimBall[] = [];
  for (const ball of input.balls) {
    if (ball.pocketed) continue;
    const point = toAimPoint(ball.x, ball.z);
    balls.push({ id: ball.id, x: point.x, z: point.z, kind: kindOf(ball.id) });
  }

  const title = input.isTurn
    ? input.settling
      ? "Esperando a que la mesa se aquiete"
      : "Tu turno"
    : `Turno del jugador ${input.state.turn + 1}`;

  return {
    layout: "aim",
    title,
    table: {
      balls,
      aspect: AIM_ASPECT,
      ballRadius: AIM_BALL_RADIUS,
      pocketRadius: AIM_POCKET_RADIUS,
      pockets: POCKETS.map((pocket) => toAimPoint(pocket.x, pocket.z)),
      own: needsEight ? "eight" : own,
    },
    enabled: input.enabled,
    ballInHand: input.enabled && input.state.ballInHand,
    status: [
      {
        label: "Tuyas",
        value: own === null ? "sin asignar" : String(remainingFor(input.state, input.seat)),
      },
      { label: "Faltas", value: String(input.state.fouls[seatIndex(input.seat)]) },
    ],
    ...(input.notice && input.isTurn ? { notice: input.notice } : {}),
    ...(input.enabled ? { remainingMs: input.remainingMs, windowMs: input.windowMs } : {}),
    ...(input.isTurn && !input.settling
      ? { haptic: { id: `turn-${input.state.turn}-${input.seat}`, pattern: HAPTIC_TURN } }
      : {}),
  };
}

/**
 * Adonde apunta el tiro automatico: a la propia mas cercana a la blanca.
 *
 * Con la mesa abierta no hay "propia", asi que va a la mas cercana que no sea
 * la 8 —apuntarle a la 8 seria falta, y castigar a alguien por quedarse sin
 * tiempo con una falta encima seria doble castigo.
 */
function autoShotAngle(balls: readonly BallState[], group: Group | null): number | null {
  const cue = balls.find((ball) => ball.id === CUE_BALL && !ball.pocketed);
  if (!cue) return null;

  let best: BallState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const ball of balls) {
    if (ball.pocketed || ball.id === CUE_BALL) continue;
    const kind = kindOf(ball.id);
    if (group === null ? kind === "eight" : kind !== group) continue;
    const distance = Math.hypot(ball.x - cue.x, ball.z - cue.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = ball;
    }
  }

  if (!best) return null;
  return Math.atan2(best.z - cue.z, best.x - cue.x);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}
