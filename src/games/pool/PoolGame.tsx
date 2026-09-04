import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "@/core/contract/game";
import { bool } from "@/core/contract/settings";
import { createRng } from "@/core/engine/rng";
import { useGameLifecycle } from "@/core/engine/useGameLifecycle";
import { Stage } from "@/core/engine3d/Stage";
import { HudStat } from "@/ui/game/GameStage";
import { PoolScene, type PoolTableHandle } from "./PoolScene";
import {
  CUE_BALL,
  GROUP_LABEL,
  HEAD_SPOT_X,
  POOL_SEATS,
  TABLE_LENGTH,
  TABLE_WIDTH,
  createPoolState,
  poolPoints,
  remainingFor,
  resolveShot,
  seatIndex,
  winnerByRemaining,
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
 * **El mando del celular todavia no esta conectado.** El apuntado local por
 * teclado que hay aca es para el proyector y para el banco de pruebas; es lo
 * que permite ver la mesa resolverse sin dos telefonos a mano.
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

export default function PoolGame({ config, signal, onFinish, onReady }: GameProps) {
  const spinEnabled = bool(config.settings, "spin", true);

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
      const seat = 0;
      const won = state.winner === seat;
      return {
        completed,
        points: poolPoints({
          ownPocketed: 7 - remainingFor(state, seat),
          fouls: state.fouls[seatIndex(seat)],
          won,
          cleanShots: state.cleanShots[seatIndex(seat)],
        }),
        durationMs: playedMs,
        meta: {
          winner: state.winner ?? winnerByRemaining(state),
          fouls: state.fouls,
        },
      };
    },
  });

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  /* ---------------------------------------------------------------- */
  /* Apuntado local, para el proyector                                 */
  /* ---------------------------------------------------------------- */

  const [angle, setAngle] = useState(0);
  const [spin, setSpin] = useState(0);
  const [power, setPower] = useState(0);
  const chargingRef = useRef(false);
  const heldRef = useRef({ left: false, right: false });

  const playing = life.phase === "playing";

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

  /* ---------------------------------------------------------------- */
  /* El puente entre la fisica y las reglas                            */
  /* ---------------------------------------------------------------- */

  const onSettled = useCallback(
    (events: ShotEvents) => {
      const state = stateRef.current;
      const table = tableRef.current;
      if (!state || state.over) return;

      const result = resolveShot(state, events);

      /*
       * La blanca vuelve al punto de cabecera cuando cae. Colocarla donde la
       * quiera el rival es la compensacion de la falta, pero eso llega con el
       * mando del celular; hasta entonces vuelve a un lugar jugable en vez de
       * quedarse debajo del pano.
       */
      if (events.pocketed.includes(CUE_BALL)) {
        table?.placeCue(HEAD_SPOT_X, 0);
      }

      const seat = state.turn;
      const group = state.groups[seatIndex(seat)];

      life.setHud({
        turn: seat,
        group: group === null ? "mesa abierta" : GROUP_LABEL[group],
        remaining: remainingFor(state, seat),
        fouls: state.fouls[seatIndex(seat)],
        notice:
          result.foulText ??
          (result.assigned ? `Te quedan las ${GROUP_LABEL[result.assigned]}.` : ""),
      });

      if (state.over) life.finish(true);
    },
    [life],
  );

  const state = stateRef.current;

  return (
    <Stage
      phase={life.phase}
      countdownLeft={life.countdownLeft}
      instructions="Apuntá con ← →, cargá con espacio y soltá para pegar."
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
      summary={
        state?.over ? (
          <p className="text-sm text-sn-muted">
            Ganó el jugador {(state.winner ?? 0) + 1} de {POOL_SEATS}.
          </p>
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
