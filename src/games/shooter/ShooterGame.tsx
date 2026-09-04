import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "@/core/contract/game";
import { createRng } from "@/core/engine/rng";
import { useGameLifecycle } from "@/core/engine/useGameLifecycle";
import { Stage } from "@/core/engine3d/Stage";
import { HudStat } from "@/ui/game/GameStage";
import { ShooterScene, type ShooterStats } from "./ShooterScene";
import { MAX_PLAYERS, createShooterMap } from "./map";

/**
 * X4 · Supernova Arena — **fase 1 de 7**.
 *
 * Lo que hay aca NO es el juego: es la prueba de rendimiento que la guia exige
 * antes de escribir una linea de gameplay. Textual: *"Si no llega a 30 fps,
 * paramos y recortamos antes de escribir gameplay. No sigas sin esto."*
 *
 * Lo que mide: el mapa generado por semilla, diez capsulas moviendose y la
 * camara en primera persona, con fps, draw calls y triangulos en pantalla.
 * Es el caso peor razonable de la escena terminada, porque la geometria del
 * mapa y la cantidad de entidades no van a crecer: lo que falta —disparo,
 * anillo, red— cuesta CPU y casi nada de GPU.
 *
 * **Falta lo esencial y es a proposito:** no hay controles tactiles, ni
 * disparo, ni daño, ni anillo, ni red, ni bots con criterio. Todo eso son las
 * fases 2 a 7, y la guia pide un visto bueno antes de encararlas.
 *
 * El presupuesto contra el que se compara, de la guia:
 *
 * | | Objetivo movil |
 * |---|---|
 * | fps | 30 sostenidos |
 * | Draw calls | menos de 60 |
 * | Triangulos | menos de 40.000 |
 */

type ShooterHud = {
  fps: number;
  drawCalls: number;
  triangles: number;
};

export default function ShooterGame({ config, signal, onFinish, onReady }: GameProps) {
  const map = useMemo(() => createShooterMap(createRng(config.seed)), [config.seed]);

  /*
   * Las ultimas metricas, en una ref.
   *
   * El outcome las necesita, y leerlas del HUD lo haria depender del ciclo de
   * vida que lo esta creando. La ref rompe ese circulo y ademas no fuerza un
   * render por muestra.
   */
  const statsRef = useRef<ShooterStats>({ fps: 0, drawCalls: 0, triangles: 0 });

  const life = useGameLifecycle<ShooterHud>({
    hud: { fps: 0, drawCalls: 0, triangles: 0 },
    durationMs: config.durationMs,
    countdown: 0,
    // R3F corre su loop adentro del <Canvas>, donde no llega este componente.
    countdownDriver: "internal",
    signal,
    onFinish,
    /*
     * Sin partida no hay puntaje. Devolver 0 es honesto: esta fase no juega
     * nada, y un numero inventado ensuciaria cualquier medicion posterior.
     */
    outcome: (completed, playedMs) => ({
      completed,
      points: 0,
      durationMs: playedMs,
      meta: { phase: 1, ...statsRef.current },
    }),
  });

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  const [worst, setWorst] = useState({ fps: 999, drawCalls: 0 });

  const onStats = useCallback(
    (stats: ShooterStats) => {
      statsRef.current = stats;
      life.setHud(stats);
      /*
       * El peor valor visto, no solo el actual.
       *
       * Un contador que solo muestra el instante deja pasar los tirones, que
       * es justo lo que hay que detectar: 30 fps de promedio con caidas a 12
       * se juega peor que 25 estables.
       */
      setWorst((previous) =>
        stats.fps < previous.fps || stats.drawCalls > previous.drawCalls
          ? {
              fps: Math.min(previous.fps, stats.fps),
              drawCalls: Math.max(previous.drawCalls, stats.drawCalls),
            }
          : previous,
      );
    },
    [life],
  );

  const playing = life.phase === "playing";
  const overBudget = worst.drawCalls > 60;

  return (
    <Stage
      phase={life.phase}
      countdownLeft={life.countdownLeft}
      instructions={`Fase 1: prueba de rendimiento. ${MAX_PLAYERS} cápsulas, mapa por semilla y cámara en primera persona. Abrilo en un celular y mirá los números.`}
      muted={life.muted}
      onToggleMuted={life.toggleMuted}
      onStart={life.start}
      onResume={life.resume}
      onPause={life.pause}
      onRestart={life.restart}
      aspect={16 / 9}
      camera={{ position: [0, 1.7, 0], fov: 75, near: 0.1, far: 120 }}
      background="#07060f"
      {...(config.debug ? { debug: true } : {})}
      hud={
        <>
          <HudStat
            label="FPS"
            value={String(life.hud.fps)}
            tone={life.hud.fps < 30 ? "warn" : "default"}
            dominant
          />
          <HudStat label="Peor FPS" value={worst.fps === 999 ? "—" : String(worst.fps)} />
          <HudStat
            label="Draw calls"
            value={String(life.hud.drawCalls)}
            tone={overBudget ? "warn" : "default"}
          />
          <HudStat label="Triángulos" value={life.hud.triangles.toLocaleString("es-AR")} />
        </>
      }
      summary={
        <div className="text-left text-xs text-sn-muted">
          <p className="mb-2">
            Peor FPS: <span className="sn-num">{worst.fps === 999 ? "—" : worst.fps}</span> · Máx.
            draw calls: <span className="sn-num">{worst.drawCalls}</span>
          </p>
          <p>
            El objetivo de la guía es 30 fps sostenidos y menos de 60 draw calls en un celular de
            gama media. Si no llega, se recorta el alcance antes de seguir.
          </p>
        </div>
      }
    >
      <ShooterScene map={map} running={playing} onStats={onStats} />
    </Stage>
  );
}
