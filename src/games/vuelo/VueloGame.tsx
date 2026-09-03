import { useEffect, useMemo, useRef } from "react";
import { scoreWithTimeBonus, type GameProps } from "@/core/contract/game";
import { str, words } from "@/core/contract/settings";
import { vibrate } from "@/core/engine/audio";
import { clamp, lerp } from "@/core/engine/collide";
import { withAlpha } from "@/core/engine/palette";
import { createPool, type Pool } from "@/core/engine/pool";
import { useGame2D, type Game2DDefinition } from "@/core/engine/useGame2D";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  createWorld,
  flap,
  pickLoseMessage,
  runPoints,
  stepWorld,
  tuningFromSettings,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type FlappyTuning,
  type FlappyWorld,
} from "./logic";

/**
 * Vuelo (M3).
 *
 * Un toque impulsa, la gravedad hace el resto. El componente es solo montaje,
 * entrada, dibujo y HUD: la partida entera vive en `logic.ts`, que se testea
 * sin navegador.
 */

const STAR_COUNT = 60;
const TRAIL_CAPACITY = 40;
const JITTER_COUNT = 48;
const SHAKE_MS = 200;
const DEATH_MS = 850;
const RISE_ANGLE = (-25 * Math.PI) / 180;
const FALL_ANGLE = (70 * Math.PI) / 180;

type Star = { x: number; y: number; r: number; near: boolean };

type Particle = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
};

/** Puente entre el frame y las funciones creadas una sola vez en `init`. */
type FrameHolder = {
  dt: number;
  spawnX: number;
  spawnY: number;
  speed: number;
  jx: number;
  jy: number;
};

type VueloState = {
  world: FlappyWorld;
  stars: Star[];
  trail: Pool<Particle>;
  jitter: Float32Array;
  jitterAt: number;
  trailTick: number;
  angle: number;
  shakeMs: number;
  flashMs: number;
  spaceWasDown: boolean;
  frame: FrameHolder;
  gradient: CanvasGradient;
  colors: {
    bg: string;
    starFar: string;
    starNear: string;
    pipeBody: string;
    pipeLine: string;
    pipeEdge: string;
    trail: string;
    flash: string;
  };
  /** Callbacks del pool, creadas una vez: en el loop no se asigna nada. */
  spawnTrail: (p: Particle) => void;
  stepTrail: (p: Particle) => void;
  drawTrail: (p: Particle) => void;
};

type VueloHud = {
  score: number;
  pipes: number;
  perfect: number;
  /** false mientras la nave flota esperando el primer toque. */
  ready: boolean;
};

export default function VueloGame({ config, signal, onFinish, onReady }: GameProps) {
  // Los administrables se leen una sola vez y salen tipados; el loop nunca
  // vuelve a tocar `config.settings`.
  const options = useMemo(() => {
    const tuning: FlappyTuning = tuningFromSettings(config.settings);
    return {
      tuning,
      instructions: str(
        config.settings,
        "instructions",
        "Tocá la pantalla o apretá espacio para impulsarte.",
      ),
      readyHint: str(config.settings, "readyHint", "Tocá para volar"),
      loseMessages: words(config.settings, "loseMessages", ["Se terminó el vuelo."]),
    };
  }, [config.settings]);

  const durationMs = config.durationMs;
  const hudPush = useRef<(patch: Partial<VueloHud>) => void>(() => {});

  const definition = useMemo<Game2DDefinition<VueloState, VueloHud>>(() => {
    const tuning = options.tuning;

    /** El mismo numero que ve el jugador al final y el que viaja en el outcome. */
    const finalPoints = (world: FlappyWorld): number => {
      const base = runPoints(world.pipesPassed, world.perfectPasses, tuning);
      if (!tuning.timeBonus) return base;
      return scoreWithTimeBonus(base, world.elapsedMs, durationMs, tuning.maxTimeBonus);
    };

    return {
      design: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      step: 1 / 60,
      countdown: 3,
      hud: { score: 0, pipes: 0, perfect: 0, ready: false },

      init: (ctx) => {
        // Orden fijo de consumo del PRNG: primero los tubos, siempre. Estrellas
        // y jitter se generan aunque no se dibujen, para que el movimiento
        // reducido no corra la serie y cambie el recorrido.
        const world = createWorld(tuning, ctx.rng);

        const stars: Star[] = new Array<Star>(STAR_COUNT);
        for (let i = 0; i < STAR_COUNT; i++) {
          const near = i % 2 === 0;
          stars[i] = {
            x: ctx.rng.range(0, WORLD_WIDTH),
            y: ctx.rng.range(0, WORLD_HEIGHT),
            r: near ? ctx.rng.range(1, 1.9) : ctx.rng.range(0.5, 1.1),
            near,
          };
        }

        const jitter = new Float32Array(JITTER_COUNT);
        for (let i = 0; i < JITTER_COUNT; i++) jitter[i] = ctx.rng.range(-1, 1);

        const trail = createPool<Particle>(TRAIL_CAPACITY, () => ({
          alive: false,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          life: 0,
          max: 1,
        }));

        const g = ctx.view.ctx;
        const frame: FrameHolder = { dt: 0, spawnX: 0, spawnY: 0, speed: 0, jx: 0, jy: 0 };

        const gradient = g.createLinearGradient(-16, -12, 20, 12);
        gradient.addColorStop(0, ctx.palette["--sn-violet-500"]);
        gradient.addColorStop(1, ctx.palette["--sn-magenta-400"]);

        const spawnTrail = (p: Particle) => {
          p.x = frame.spawnX;
          p.y = frame.spawnY;
          p.vx = -frame.speed * 0.4 + frame.jx * 24;
          p.vy = frame.jy * 46;
          p.life = 0.42;
          p.max = 0.42;
        };

        const stepTrail = (p: Particle) => {
          p.life -= frame.dt;
          if (p.life <= 0) {
            trail.release(p);
            return;
          }
          p.x += p.vx * frame.dt;
          p.y += p.vy * frame.dt;
        };

        const drawTrail = (p: Particle) => {
          g.globalAlpha = Math.max(0, p.life / p.max) * 0.65;
          g.fillRect(p.x - 2, p.y - 2, 4, 4);
        };

        return {
          world,
          stars,
          trail,
          jitter,
          jitterAt: 0,
          trailTick: 0,
          angle: 0,
          shakeMs: 0,
          flashMs: 0,
          spaceWasDown: false,
          frame,
          gradient,
          colors: {
            bg: ctx.palette["--sn-bg"],
            starFar: withAlpha(ctx.palette["--sn-violet-300"], 0.32),
            starNear: withAlpha(ctx.palette["--sn-cyan-300"], 0.62),
            pipeBody: ctx.palette["--sn-panel-hi"],
            pipeLine: ctx.palette["--sn-line"],
            pipeEdge: ctx.palette["--sn-cyan-400"],
            trail: ctx.palette["--sn-magenta-300"],
            flash: withAlpha(ctx.palette["--sn-cyan-400"], 0.85),
          },
          spawnTrail,
          stepTrail,
          drawTrail,
        };
      },

      update: (state, dt, ctx) => {
        const world = state.world;
        const frame = state.frame;
        frame.dt = dt;

        // Teclado por flanco: mantener apretado no da impulso continuo.
        const spaceDown =
          ctx.input.keys.has("Space") || ctx.input.keys.has("ArrowUp") || ctx.input.keys.has("KeyW");
        const tapped = ctx.input.pointer.justPressed || (spaceDown && !state.spaceWasDown);
        state.spaceWasDown = spaceDown;

        if (tapped && !world.dead && flap(world, tuning)) {
          ctx.sfx.play("select");
          hudPush.current({ ready: true });
        }

        stepWorld(world, dt, tuning, ctx.rng);

        if (world.events.scored) {
          ctx.sfx.play(world.events.perfect ? "pick" : "tick");
          if (world.events.perfect) {
            state.flashMs = ctx.reducedMotion ? 0 : 220;
            vibrate(10);
          }
          hudPush.current({
            score: finalPoints(world),
            pipes: world.pipesPassed,
            perfect: world.perfectPasses,
          });
        }

        if (world.events.crashed) {
          ctx.sfx.play("lose");
          vibrate([40, 30, 70]);
          state.shakeMs = ctx.reducedMotion ? 0 : SHAKE_MS;
          hudPush.current({
            score: finalPoints(world),
            pipes: world.pipesPassed,
            perfect: world.perfectPasses,
          });
        }

        // La rotacion es lo que da la lectura de la caida.
        const span = tuning.maxFallSpeed - tuning.flapImpulse;
        const t = span > 0 ? clamp((world.shipVy - tuning.flapImpulse) / span, 0, 1) : 0;
        state.angle = lerp(state.angle, lerp(RISE_ANGLE, FALL_ANGLE, t), 0.2);

        if (state.shakeMs > 0) state.shakeMs = Math.max(0, state.shakeMs - dt * 1000);
        if (state.flashMs > 0) state.flashMs = Math.max(0, state.flashMs - dt * 1000);

        const alive = world.started && !world.dead;

        if (tuning.parallax && !ctx.reducedMotion && alive) {
          for (let i = 0; i < state.stars.length; i++) {
            const star = state.stars[i];
            if (!star) continue;
            star.x -= world.speed * (star.near ? 0.34 : 0.12) * dt;
            if (star.x < -2) star.x += WORLD_WIDTH + 4;
          }
        }

        state.trailTick++;
        if (tuning.trail && !ctx.reducedMotion && alive && state.trailTick % 3 === 0) {
          state.jitterAt = (state.jitterAt + 1) % JITTER_COUNT;
          frame.jx = state.jitter[state.jitterAt] ?? 0;
          frame.jy = state.jitter[(state.jitterAt + 7) % JITTER_COUNT] ?? 0;
          frame.spawnX = tuning.shipX - 14;
          frame.spawnY = world.shipY + frame.jy * 4;
          frame.speed = world.speed;
          state.trail.spawn(state.spawnTrail);
        }
        state.trail.each(state.stepTrail);

        // La caida se ve entera antes de cerrar: el jugador entiende por que perdio.
        if (world.dead && (world.deathMs >= DEATH_MS || world.shipY > WORLD_HEIGHT + 120)) {
          ctx.finish(true);
        }
      },

      draw: (state, g, ctx) => {
        const world = state.world;
        const colors = state.colors;

        g.fillStyle = colors.bg;
        g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

        g.save();
        if (state.shakeMs > 0) {
          const decay = state.shakeMs / SHAKE_MS;
          g.translate(Math.sin(state.shakeMs * 0.9) * 7 * decay, Math.cos(state.shakeMs * 1.4) * 7 * decay);
        }

        // Fondo: dos capas a distinta velocidad. Quietas con movimiento reducido.
        for (let i = 0; i < state.stars.length; i++) {
          const star = state.stars[i];
          if (!star) continue;
          g.fillStyle = star.near ? colors.starNear : colors.starFar;
          g.fillRect(star.x, star.y, star.r * 2, star.r * 2);
        }

        const width = tuning.pipeWidth;
        for (let i = 0; i < world.pipes.length; i++) {
          const pipe = world.pipes[i];
          if (!pipe) continue;
          const x = lerp(pipe.px, pipe.x, ctx.alpha);
          if (x > WORLD_WIDTH || x + width < 0) continue;
          const topEnd = pipe.gapY - pipe.gapH / 2;
          const bottomStart = pipe.gapY + pipe.gapH / 2;

          g.fillStyle = colors.pipeBody;
          g.fillRect(x, 0, width, topEnd);
          g.fillRect(x, bottomStart, width, WORLD_HEIGHT - bottomStart);

          g.fillStyle = colors.pipeLine;
          g.fillRect(x, 0, 2, topEnd);
          g.fillRect(x, bottomStart, 2, WORLD_HEIGHT - bottomStart);

          // El borde que da al hueco es el unico iluminado: marca por donde se pasa.
          g.fillStyle = colors.pipeEdge;
          g.fillRect(x, topEnd - 4, width, 4);
          g.fillRect(x, bottomStart, width, 4);
        }

        g.fillStyle = colors.trail;
        state.trail.each(state.drawTrail);
        g.globalAlpha = 1;

        const bob =
          !world.started && !ctx.reducedMotion ? Math.sin(ctx.elapsedMs / 260) * 7 : 0;
        const shipY = lerp(world.shipPrevY, world.shipY, ctx.alpha) + bob;

        if (state.flashMs > 0) {
          g.globalAlpha = state.flashMs / 220;
          g.strokeStyle = colors.flash;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(tuning.shipX, shipY, 22 + (1 - state.flashMs / 220) * 14, 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
        }

        g.save();
        g.translate(tuning.shipX, shipY);
        g.rotate(state.angle);
        g.beginPath();
        g.moveTo(20, 0);
        g.lineTo(-14, -12);
        g.lineTo(-7, 0);
        g.lineTo(-14, 12);
        g.closePath();
        g.fillStyle = state.gradient;
        g.fill();
        g.strokeStyle = colors.pipeEdge;
        g.lineWidth = 1.5;
        g.stroke();
        g.restore();

        g.restore();
      },

      outcome: (state, completed) => {
        const world = state.world;
        return {
          points: finalPoints(world),
          completed,
          meta: {
            pipesPassed: world.pipesPassed,
            perfectPasses: world.perfectPasses,
            survivedMs: Math.round(world.elapsedMs),
            topSpeed: Math.round(world.speed),
          },
        };
      },
    };
  }, [options, durationMs]);

  const api = useGame2D(definition, config, signal, onFinish);

  // El loop necesita empujar al HUD y `setHud` recien existe despues del hook.
  // La asignacion es idempotente y el primer frame llega despues del montaje.
  hudPush.current = api.setHud;

  const readyRef = useRef(false);
  useEffect(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    onReady?.();
  }, [onReady]);

  const { hud, timeLeftMs } = api;
  const message = pickLoseMessage(options.loseMessages, hud.pipes);

  return (
    <div className="relative h-full w-full">
      <GameStage
        containerRef={api.containerRef}
        canvasRef={api.canvasRef}
        phase={api.phase}
        countdownLeft={api.countdownLeft}
        instructions={options.instructions}
        aspect={WORLD_WIDTH / WORLD_HEIGHT}
        {...(config.debug ? { fps: api.fps } : {})}
        muted={api.muted}
        onToggleMuted={api.toggleMuted}
        onStart={api.start}
        onResume={api.resume}
        onPause={api.pause}
        onRestart={api.restart}
        hud={
          <>
            <HudStat label="Puntos" value={hud.score} tone="cyan" dominant />
            <HudStat label="Tubos" value={hud.pipes} />
            <HudStat label="Perfectos" value={hud.perfect} tone="magenta" />
            {timeLeftMs !== null && (
              <HudStat
                label="Tiempo"
                value={formatClock(timeLeftMs)}
                tone={timeLeftMs <= 6000 ? "danger" : "default"}
              />
            )}
          </>
        }
        summary={
          <div className="text-center">
            <h3 className="text-lg">Se acabó el vuelo</h3>
            <p className="mt-1 text-sm text-sn-muted">{message}</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="sn-card px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-sn-dim">Puntos</div>
                <div className="sn-num text-lg text-sn-cyan">{hud.score}</div>
              </div>
              <div className="sn-card px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-sn-dim">Tubos</div>
                <div className="sn-num text-lg text-sn-text">{hud.pipes}</div>
              </div>
              <div className="sn-card px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-sn-dim">Perfectos</div>
                <div className="sn-num text-lg text-sn-magenta">{hud.perfect}</div>
              </div>
            </div>
          </div>
        }
      />

      {/* El aviso del primer toque va en DOM, como todo el HUD. */}
      {api.phase === "playing" && !hud.ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="sn-chip border-sn-line bg-sn-panel/80 px-3 py-1.5 text-sm text-sn-text">
            {options.readyHint}
          </span>
        </div>
      )}
    </div>
  );
}
