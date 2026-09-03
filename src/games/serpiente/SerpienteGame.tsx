import { useMemo } from "react";
import type { GameProps } from "@/core/contract/game";
import { num, words } from "@/core/contract/settings";
import { createPool } from "@/core/engine/pool";
import { mixHex, withAlpha } from "@/core/engine/palette";
import { vibrate } from "@/core/engine/audio";
import { useGame2D } from "@/core/engine/useGame2D";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  createSnakeState,
  queueTurn,
  segmentAt,
  snakePoints,
  stepSnake,
  type Direction,
  type SnakeState,
} from "./logic";

/**
 * R3 · Serpiente.
 *
 * Es el primer juego escrito enteramente sobre la base 2D, y por eso vale como
 * prueba de la base: si hacerlo pide mas que este archivo, la base esta mal.
 * Todo lo que no es "las reglas de Serpiente" lo pone `useGame2D`.
 */

const CELL = 40;
const UNRAVEL_MS = 400;
const MAX_FLOATERS = 4;

type Floater = { alive: boolean; x: number; y: number; life: number; word: number };

type SnakeHud = { points: number; eaten: number; speed: number };

type Scene = {
  snake: SnakeState;
  floaters: ReturnType<typeof createPool<Floater>>;
  /** Degrade cabeza-cola precalculado: mezclar color por segmento y por frame no. */
  gradient: string[];
  principles: string[];
  deathMs: number;
  flashMs: number;
  pulse: number;
  pointsPerPrinciple: number;
  timeBonus: number;
  durationMs: number | null;
};

export default function SerpienteGame({ config, signal, onFinish }: GameProps) {
  const options = useMemo(() => {
    const principles = words(config.settings, "principles", ["Foco"]).filter((w) => w.trim() !== "");
    return {
      cols: Math.round(num(config.settings, "cols", 24)),
      rows: Math.round(num(config.settings, "rows", 16)),
      startSpeed: num(config.settings, "startSpeed", 6),
      speedGain: num(config.settings, "speedGain", 0.35),
      maxSpeed: num(config.settings, "maxSpeed", 14),
      growth: Math.round(num(config.settings, "growth", 2)),
      pointsPerPrinciple: num(config.settings, "pointsPerPrinciple", 50),
      timeBonus: num(config.settings, "timeBonus", 200),
      principles: principles.length > 0 ? principles : ["Foco"],
    };
  }, [config.settings]);

  const game = useGame2D<Scene, SnakeHud>(
    {
      design: { width: options.cols * CELL, height: options.rows * CELL },
      countdown: 3,
      swipeThreshold: 24,
      hud: { points: 0, eaten: 0, speed: options.startSpeed },

      init: (ctx) => {
        const rules = {
          cols: options.cols,
          rows: options.rows,
          startSpeed: options.startSpeed,
          speedGain: options.speedGain,
          maxSpeed: options.maxSpeed,
          growth: options.growth,
        };
        const snake = createSnakeState(rules, ctx.rng, options.principles.length);
        const capacity = rules.cols * rules.rows;

        const gradient: string[] = new Array(capacity);
        for (let i = 0; i < capacity; i++) {
          gradient[i] = mixHex(
            ctx.palette["--sn-violet-400"],
            ctx.palette["--sn-magenta-400"],
            capacity > 1 ? i / (capacity - 1) : 0,
          );
        }

        return {
          snake,
          floaters: createPool<Floater>(MAX_FLOATERS, () => ({
            alive: false,
            x: 0,
            y: 0,
            life: 0,
            word: 0,
          })),
          gradient,
          principles: options.principles,
          deathMs: 0,
          flashMs: 0,
          pulse: 0,
          pointsPerPrinciple: options.pointsPerPrinciple,
          timeBonus: options.timeBonus,
          durationMs: config.durationMs,
        };
      },

      update: (scene, dt, ctx) => {
        const { snake } = scene;
        scene.pulse += dt;

        if (snake.dead) {
          // La serpiente se desarma antes de mostrar el resultado: cortar en
          // seco se siente como un cuelgue, no como una derrota.
          scene.deathMs += dt * 1000;
          if (scene.deathMs >= (ctx.reducedMotion ? 0 : UNRAVEL_MS)) ctx.finish(true);
          return;
        }

        const swipe = ctx.input.swipe;
        if (swipe) queueTurn(snake, swipe.dir as Direction);
        else if (ctx.input.axis.x === -1) queueTurn(snake, "left");
        else if (ctx.input.axis.x === 1) queueTurn(snake, "right");
        else if (ctx.input.axis.y === -1) queueTurn(snake, "up");
        else if (ctx.input.axis.y === 1) queueTurn(snake, "down");

        if (scene.flashMs > 0) scene.flashMs -= dt * 1000;

        scene.floaters.each((floater) => {
          floater.life -= dt;
          floater.y -= dt * 34;
          if (floater.life <= 0) scene.floaters.release(floater);
        });

        // El paso de grilla es independiente del paso de simulacion: el loop
        // corre a 60 Hz y la serpiente avanza a `speed` celdas por segundo.
        snake.stepClock += dt * snake.speed;
        while (snake.stepClock >= 1) {
          snake.stepClock -= 1;
          const result = stepSnake(snake, ctx.rng, scene.principles.length);

          if (result === "ate") {
            ctx.setHud({
              eaten: snake.eaten,
              points: snake.eaten * scene.pointsPerPrinciple,
              speed: Number(snake.speed.toFixed(1)),
            });
            scene.flashMs = 140;
            if (!ctx.reducedMotion) {
              const head = segmentAt(snake, 0);
              scene.floaters.spawn((floater) => {
                floater.x = head.x * CELL + CELL / 2;
                floater.y = head.y * CELL;
                floater.life = 0.9;
                floater.word = snake.foodWord;
              });
            }
            ctx.sfx.play("pick");
            vibrate(12);
          } else if (result === "died") {
            ctx.sfx.play("lose");
            vibrate([24, 40, 24]);
            break;
          }
        }
      },

      draw: (scene, g, ctx) => {
        const { snake, gradient } = scene;
        const width = snake.cols * CELL;
        const height = snake.rows * CELL;

        g.fillStyle = ctx.palette["--sn-bg"];
        g.fillRect(0, 0, width, height);

        // Grilla apenas visible: da lectura del tablero sin competir con nada.
        g.strokeStyle = withAlpha(ctx.palette["--sn-violet-500"], 0.08);
        g.lineWidth = 1;
        g.beginPath();
        for (let x = CELL; x < width; x += CELL) {
          g.moveTo(x, 0);
          g.lineTo(x, height);
        }
        for (let y = CELL; y < height; y += CELL) {
          g.moveTo(0, y);
          g.lineTo(width, y);
        }
        g.stroke();

        // Principio a comer.
        const beat = ctx.reducedMotion ? 0 : Math.sin(scene.pulse * 4) * 0.12;
        const foodR = CELL * (0.3 + beat);
        const fx = snake.foodX * CELL + CELL / 2;
        const fy = snake.foodY * CELL + CELL / 2;
        g.fillStyle = ctx.palette["--sn-cyan-400"];
        g.beginPath();
        g.arc(fx, fy, foodR, 0, Math.PI * 2);
        g.fill();

        g.font = `600 ${Math.round(CELL * 0.4)}px "Space Grotesk", sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = ctx.palette["--sn-cyan-300"];
        g.fillText(scene.principles[snake.foodWord % scene.principles.length] ?? "", fx, fy - CELL * 0.75);

        // Cuerpo. Se desarma desde la cola al morir.
        const unravel = snake.dead && !ctx.reducedMotion ? scene.deathMs / UNRAVEL_MS : 0;
        const visible = Math.max(1, Math.round(snake.length * (1 - Math.min(1, unravel))));
        const t = Math.min(1, snake.stepClock);
        const radius = CELL * 0.3;

        for (let i = visible - 1; i >= 0; i--) {
          const current = segmentAt(snake, i);
          const ahead = i > 0 ? segmentAt(snake, i - 1) : current;
          // Interpolar hacia donde estaba el segmento de adelante convierte el
          // avance por celdas en movimiento continuo, sin tocar la simulacion.
          const px = (current.x + (ahead.x - current.x) * t) * CELL;
          const py = (current.y + (ahead.y - current.y) * t) * CELL;

          g.fillStyle = gradient[Math.min(gradient.length - 1, i)] ?? ctx.palette["--sn-violet-400"];
          g.beginPath();
          g.roundRect(px + 2, py + 2, CELL - 4, CELL - 4, radius);
          g.fill();
        }

        if (scene.flashMs > 0 && !ctx.reducedMotion) {
          const head = segmentAt(snake, 0);
          g.fillStyle = withAlpha(ctx.palette["--sn-text"], (scene.flashMs / 140) * 0.7);
          g.beginPath();
          g.roundRect(head.x * CELL + 2, head.y * CELL + 2, CELL - 4, CELL - 4, radius);
          g.fill();
        }

        g.font = `600 ${Math.round(CELL * 0.38)}px "Space Grotesk", sans-serif`;
        scene.floaters.each((floater) => {
          g.fillStyle = withAlpha(ctx.palette["--sn-cyan-300"], Math.min(1, floater.life));
          g.fillText(scene.principles[floater.word % scene.principles.length] ?? "", floater.x, floater.y);
        });
      },

      outcome: (scene, completed, survivedMs) => ({
        completed,
        points: snakePoints(
          scene.snake.eaten,
          scene.pointsPerPrinciple,
          survivedMs,
          scene.durationMs,
          scene.timeBonus,
        ),
        meta: {
          principios: scene.snake.eaten,
          largo: scene.snake.length,
          velocidadFinal: Number(scene.snake.speed.toFixed(2)),
          causa: scene.snake.dead ? "choque" : completed ? "tiempo" : "forzado",
        },
      }),
    },
    config,
    signal,
    onFinish,
  );

  return (
    <GameStage
      containerRef={game.containerRef}
      canvasRef={game.canvasRef}
      phase={game.phase}
      countdownLeft={game.countdownLeft}
      muted={game.muted}
      onToggleMuted={game.toggleMuted}
      onStart={game.start}
      onPause={game.pause}
      onResume={game.resume}
      onRestart={game.restart}
      aspect={options.cols / options.rows}
      {...(config.debug ? { fps: game.fps } : {})}
      instructions="Deslizá o usá las flechas para girar. Comé los principios y no te choques."
      hud={
        <>
          <HudStat label="Puntos" value={game.hud.points} dominant tone="cyan" />
          <HudStat label="Principios" value={game.hud.eaten} />
          <HudStat label="Velocidad" value={game.hud.speed} />
          {game.timeLeftMs !== null && (
            <HudStat
              label="Tiempo"
              value={formatClock(game.timeLeftMs)}
              tone={game.timeLeftMs < 5000 ? "danger" : "default"}
            />
          )}
        </>
      }
      summary={
        <>
          <h3 className="mb-1 text-lg">Se terminó</h3>
          <p className="text-sm text-sn-muted">
            Juntaste <span className="sn-num text-sn-cyan">{game.hud.eaten}</span> principios.
          </p>
        </>
      }
    />
  );
}
