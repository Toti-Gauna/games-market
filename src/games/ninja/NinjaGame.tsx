import { useEffect, useMemo, useRef } from "react";
import type { GameProps } from "@/core/contract/game";
import { vibrate } from "@/core/engine/audio";
import { lerp } from "@/core/engine/collide";
import { withAlpha } from "@/core/engine/palette";
import { createPool, type Pool } from "@/core/engine/pool";
import { useGame2D, type Game2DDefinition } from "@/core/engine/useGame2D";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  beginStroke,
  comboPoints,
  createNinjaWorld,
  createSliceResult,
  endStroke,
  sliceFruits,
  stepNinja,
  tuningFromSettings,
  FRUIT_COLORS,
  MAX_SLICES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type NinjaTuning,
  type NinjaWorld,
  type SliceResult,
} from "./logic";

/**
 * Ninja (M5).
 *
 * Va sobre Canvas 2D y no sobre Pixi. La regla del proyecto es no meter un
 * motor donde alcanza un `fillRect`, y el umbral que la propia guia fija para
 * Pixi son ~200 sprites moviles con transformaciones propias: acá son formas
 * simples que salen de pools. Si el contador de fps del banco de pruebas no
 * llega a 60, ahi hay evidencia para cambiar, y no antes.
 *
 * El componente es montaje, entrada, dibujo y HUD: el corte, la fisica y el
 * puntaje viven en `logic.ts`, que se testea sin navegador.
 */

/* Presupuesto de objetos, todos preasignados en `init`:
   240 gotas de jugo + 32 mitades + 48 salpicaduras + 8 numeros de combo
   + 16 frutas = 344 objetos vivos como maximo. */
const JUICE_CAPACITY = 240;
const HALF_CAPACITY = 32;
const SPLAT_CAPACITY = 48;
const FLOATER_CAPACITY = 8;
const JUICE_PER_FRUIT = 14;
const JITTER_COUNT = 96;

/** Posiciones del rastro del puntero que forman la estela del sable. */
const TRAIL_POINTS = 14;
const TRAIL_SHORT = 6;
/** Segundos que tarda un punto de la estela en apagarse. */
const TRAIL_FADE = 0.22;

const SHAKE_MS = 320;
const FLASH_MS = 260;
/** Lo que se ve el final antes de mostrar el resumen. */
const OVER_MS = 800;

type Juice = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: number;
};

type Half = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  radius: number;
  /** Angulo del corte: define por donde se parte la fruta. */
  cut: number;
  side: number;
  color: number;
  shape: number;
  life: number;
  max: number;
};

type Splat = {
  alive: boolean;
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: number;
};

type Floater = {
  alive: boolean;
  x: number;
  y: number;
  life: number;
  max: number;
  count: number;
};

/** Puente entre el frame y las funciones creadas una sola vez en `init`. */
type FrameHolder = {
  dt: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: number;
  shape: number;
  cut: number;
  side: number;
  size: number;
  count: number;
};

type NinjaState = {
  world: NinjaWorld;
  slice: SliceResult;
  juice: Pool<Juice>;
  halves: Pool<Half>;
  splats: Pool<Splat>;
  floaters: Pool<Floater>;
  jitter: Float32Array;
  jitterAt: number;
  /** Estela: buffers circulares, no objetos. */
  trailX: Float32Array;
  trailY: Float32Array;
  trailLife: Float32Array;
  trailHead: number;
  prevX: number;
  prevY: number;
  hasPrev: boolean;
  shakeMs: number;
  flashMs: number;
  overMs: number;
  frame: FrameHolder;
  fruitColors: string[];
  shineColors: string[];
  splatColors: string[];
  comboLabels: string[];
  colors: {
    bg: string;
    bomb: string;
    bombRing: string;
    bombFuse: string;
    blade: string;
    bladeCore: string;
    flash: string;
    combo: string;
  };
  comboFont: string;
  spawnJuice: (p: Juice) => void;
  stepJuice: (p: Juice) => void;
  drawJuice: (p: Juice) => void;
  spawnHalf: (h: Half) => void;
  stepHalf: (h: Half) => void;
  drawHalf: (h: Half) => void;
  spawnSplat: (s: Splat) => void;
  stepSplat: (s: Splat) => void;
  drawSplat: (s: Splat) => void;
  spawnFloater: (f: Floater) => void;
  stepFloater: (f: Floater) => void;
  drawFloater: (f: Floater) => void;
};

type NinjaHud = { points: number; lives: number; streak: number; cut: number };

/** Silueta de una fruta en el origen. La usan la entera y sus mitades. */
function fruitPath(g: CanvasRenderingContext2D, shape: number, r: number): void {
  g.beginPath();
  if (shape === 1) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
  } else if (shape === 2) {
    g.moveTo(0, -r * 1.25);
    g.quadraticCurveTo(r, -r * 0.2, 0, r);
    g.quadraticCurveTo(-r, -r * 0.2, 0, -r * 1.25);
  } else if (shape === 3) {
    g.moveTo(0, -r);
    g.lineTo(r * 0.82, 0);
    g.lineTo(0, r);
    g.lineTo(-r * 0.82, 0);
    g.closePath();
  } else {
    g.arc(0, 0, r, 0, Math.PI * 2);
  }
}

export default function NinjaGame({ config, signal, onFinish, onReady }: GameProps) {
  const tuning = useMemo<NinjaTuning>(() => tuningFromSettings(config.settings), [config.settings]);
  const hudPush = useRef<(patch: Partial<NinjaHud>) => void>(() => {});

  const definition = useMemo<Game2DDefinition<NinjaState, NinjaHud>>(() => {
    return {
      design: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      step: 1 / 60,
      countdown: 3,
      // El corte se resuelve por segmento del puntero, frame a frame; el swipe
      // de la base solo cierra el trazo, asi que no necesita umbral fino.
      swipeThreshold: 20,
      hud: { points: 0, lives: tuning.lives, streak: 0, cut: 0 },

      init: (ctx) => {
        const world = createNinjaWorld(tuning);
        const g = ctx.view.ctx;

        // Ultimo recurso para el indexado con noUncheckedIndexedAccess: sigue
        // saliendo de la paleta, nunca un hex suelto.
        const fallbackColor = ctx.palette["--sn-text"];

        const jitter = new Float32Array(JITTER_COUNT);
        for (let i = 0; i < JITTER_COUNT; i++) jitter[i] = ctx.rng.range(-1, 1);

        const juice = createPool<Juice>(JUICE_CAPACITY, () => ({
          alive: false,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          life: 0,
          max: 1,
          size: 3,
          color: 0,
        }));
        const halves = createPool<Half>(HALF_CAPACITY, () => ({
          alive: false,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          rot: 0,
          spin: 0,
          radius: 30,
          cut: 0,
          side: 0,
          color: 0,
          shape: 0,
          life: 0,
          max: 1,
        }));
        const splats = createPool<Splat>(SPLAT_CAPACITY, () => ({
          alive: false,
          x: 0,
          y: 0,
          r: 10,
          life: 0,
          max: 1,
          color: 0,
        }));
        const floaters = createPool<Floater>(FLOATER_CAPACITY, () => ({
          alive: false,
          x: 0,
          y: 0,
          life: 0,
          max: 1,
          count: 0,
        }));

        const frame: FrameHolder = {
          dt: 0,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          radius: 30,
          color: 0,
          shape: 0,
          cut: 0,
          side: 0,
          size: 3,
          count: 0,
        };

        // Los colores salen de los tokens del CSS y se componen una sola vez:
        // armar un rgba() por particula y por frame es basura de GC.
        const fruitColors = [
          ctx.palette["--sn-cyan-400"],
          ctx.palette["--sn-magenta-400"],
          ctx.palette["--sn-violet-400"],
          ctx.palette["--sn-success"],
          ctx.palette["--sn-warn"],
        ];
        const shineColors = [
          ctx.palette["--sn-cyan-300"],
          ctx.palette["--sn-magenta-300"],
          ctx.palette["--sn-violet-300"],
          ctx.palette["--sn-success"],
          ctx.palette["--sn-warn"],
        ];
        const splatColors: string[] = new Array<string>(FRUIT_COLORS);
        for (let i = 0; i < FRUIT_COLORS; i++) {
          splatColors[i] = withAlpha(fruitColors[i] ?? fallbackColor, 0.18);
        }

        const comboLabels: string[] = new Array<string>(MAX_SLICES + 1);
        for (let i = 0; i <= MAX_SLICES; i++) comboLabels[i] = `+${comboPoints(i, tuning)}`;

        const spawnJuice = (p: Juice) => {
          p.x = frame.x;
          p.y = frame.y;
          p.vx = frame.vx;
          p.vy = frame.vy;
          p.life = 0.55;
          p.max = 0.55;
          p.size = frame.size;
          p.color = frame.color;
        };
        const stepJuice = (p: Juice) => {
          p.life -= frame.dt;
          if (p.life <= 0) {
            juice.release(p);
            return;
          }
          p.vy += 900 * frame.dt;
          p.x += p.vx * frame.dt;
          p.y += p.vy * frame.dt;
        };
        const drawJuice = (p: Juice) => {
          g.globalAlpha = Math.max(0, p.life / p.max);
          g.fillStyle = fruitColors[p.color] ?? fallbackColor;
          g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        };

        const spawnHalf = (h: Half) => {
          h.x = frame.x;
          h.y = frame.y;
          h.vx = frame.vx;
          h.vy = frame.vy;
          h.rot = 0;
          h.spin = frame.side === 0 ? 3.2 : -3.2;
          h.radius = frame.radius;
          h.cut = frame.cut;
          h.side = frame.side;
          h.color = frame.color;
          h.shape = frame.shape;
          h.life = 1.6;
          h.max = 1.6;
        };
        const stepHalf = (h: Half) => {
          h.life -= frame.dt;
          if (h.life <= 0) {
            halves.release(h);
            return;
          }
          h.vy += 900 * frame.dt;
          h.x += h.vx * frame.dt;
          h.y += h.vy * frame.dt;
          h.rot += h.spin * frame.dt;
        };
        const drawHalf = (h: Half) => {
          g.save();
          g.globalAlpha = Math.min(1, h.life / 0.5);
          g.translate(h.x, h.y);
          g.rotate(h.cut + h.rot);
          g.fillStyle = fruitColors[h.color] ?? fallbackColor;
          g.beginPath();
          const from = h.side === 0 ? 0 : Math.PI;
          g.arc(0, 0, h.radius, from, from + Math.PI);
          g.closePath();
          g.fill();
          // La cara del corte va mas clara: es lo que hace que se lea partida.
          g.fillStyle = shineColors[h.color] ?? fallbackColor;
          g.fillRect(-h.radius, h.side === 0 ? 0 : -3, h.radius * 2, 3);
          g.restore();
        };

        const spawnSplat = (s: Splat) => {
          s.x = frame.x;
          s.y = frame.y;
          s.r = frame.radius * 0.9;
          s.life = 4;
          s.max = 4;
          s.color = frame.color;
        };
        const stepSplat = (s: Splat) => {
          s.life -= frame.dt;
          if (s.life <= 0) splats.release(s);
        };
        const drawSplat = (s: Splat) => {
          g.globalAlpha = Math.min(1, s.life / 1.4);
          g.fillStyle = splatColors[s.color] ?? fallbackColor;
          g.beginPath();
          g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          g.fill();
        };

        const spawnFloater = (f: Floater) => {
          f.x = frame.x;
          f.y = frame.y;
          f.life = 0.9;
          f.max = 0.9;
          f.count = frame.count;
        };
        const stepFloater = (f: Floater) => {
          f.life -= frame.dt;
          if (f.life <= 0) {
            floaters.release(f);
            return;
          }
          f.y -= 70 * frame.dt;
        };
        const drawFloater = (f: Floater) => {
          g.globalAlpha = Math.min(1, f.life / 0.4);
          g.fillText(comboLabels[f.count] ?? "", f.x, f.y);
        };

        return {
          world,
          slice: createSliceResult(),
          juice,
          halves,
          splats,
          floaters,
          jitter,
          jitterAt: 0,
          trailX: new Float32Array(TRAIL_POINTS),
          trailY: new Float32Array(TRAIL_POINTS),
          trailLife: new Float32Array(TRAIL_POINTS),
          trailHead: 0,
          prevX: WORLD_WIDTH / 2,
          prevY: WORLD_HEIGHT / 2,
          hasPrev: false,
          shakeMs: 0,
          flashMs: 0,
          overMs: 0,
          frame,
          fruitColors,
          shineColors,
          splatColors,
          comboLabels,
          colors: {
            bg: ctx.palette["--sn-bg"],
            // La bomba es lo mas oscuro de la pantalla: se distingue de
            // cualquier fruta tambien en escala de grises.
            bomb: ctx.palette["--sn-bg-elev"],
            bombRing: ctx.palette["--sn-danger"],
            bombFuse: ctx.palette["--sn-warn"],
            blade: withAlpha(ctx.palette["--sn-cyan-300"], 0.55),
            bladeCore: ctx.palette["--sn-text"],
            flash: ctx.palette["--sn-text"],
            combo: ctx.palette["--sn-magenta-300"],
          },
          comboFont: '700 30px "Space Grotesk", sans-serif',
          spawnJuice,
          stepJuice,
          drawJuice,
          spawnHalf,
          stepHalf,
          drawHalf,
          spawnSplat,
          stepSplat,
          drawSplat,
          spawnFloater,
          stepFloater,
          drawFloater,
        };
      },

      update: (state, dt, ctx) => {
        const world = state.world;
        const frame = state.frame;
        frame.dt = dt;

        const pointer = ctx.input.pointer;

        if (pointer.justPressed) {
          // Trazo nuevo: el combo se cuenta por trazo, y el primer frame no
          // tiene segmento valido porque el punto anterior es de otro gesto.
          beginStroke(world);
          state.prevX = pointer.x;
          state.prevY = pointer.y;
          state.hasPrev = true;
        }

        if (pointer.down && state.hasPrev) {
          const dx = pointer.x - state.prevX;
          const dy = pointer.y - state.prevY;
          const distance = Math.hypot(dx, dy);
          const speed = distance / dt;

          if (distance > 1.5) {
            state.trailHead = (state.trailHead + 1) % TRAIL_POINTS;
            state.trailX[state.trailHead] = pointer.x;
            state.trailY[state.trailHead] = pointer.y;
            state.trailLife[state.trailHead] = 1;
          }

          // El movimiento entre dos frames es un segmento, no un punto: con
          // deteccion por punto un deslizamiento rapido pasa por arriba de
          // tres frutas sin cortar ninguna.
          const slice = sliceFruits(
            world,
            state.prevX,
            state.prevY,
            pointer.x,
            pointer.y,
            speed,
            state.slice,
          );

          if (slice.count > 0) {
            const normal = slice.angle + Math.PI / 2;
            const pushX = Math.cos(normal);
            const pushY = Math.sin(normal);
            const juicePerFruit = ctx.reducedMotion
              ? Math.floor(JUICE_PER_FRUIT / 2)
              : JUICE_PER_FRUIT;

            for (let i = 0; i < slice.count; i++) {
              const fx = slice.xs[i] ?? 0;
              const fy = slice.ys[i] ?? 0;
              const radius = slice.radii[i] ?? 24;
              const color = slice.colors[i] ?? 0;
              if (color < 0) continue; // la bomba no reparte jugo

              frame.x = fx;
              frame.y = fy;
              frame.radius = radius;
              frame.color = color;
              frame.shape = slice.shapes[i] ?? 0;
              frame.cut = slice.angle;

              for (let side = 0; side < 2; side++) {
                const sign = side === 0 ? 1 : -1;
                frame.side = side;
                frame.vx = pushX * 130 * sign + Math.cos(slice.angle) * 40;
                frame.vy = pushY * 130 * sign - 120;
                state.halves.spawn(state.spawnHalf);
              }

              if (!ctx.reducedMotion) {
                frame.x = fx;
                frame.y = fy;
                state.splats.spawn(state.spawnSplat);
              }

              for (let k = 0; k < juicePerFruit; k++) {
                state.jitterAt = (state.jitterAt + 1) % JITTER_COUNT;
                const jx = state.jitter[state.jitterAt] ?? 0;
                const jy = state.jitter[(state.jitterAt + 31) % JITTER_COUNT] ?? 0;
                frame.x = fx + jx * radius * 0.5;
                frame.y = fy + jy * radius * 0.5;
                frame.vx = jx * 300 + pushX * 90;
                frame.vy = jy * 300 + pushY * 90 - 60;
                frame.size = 3 + Math.abs(jy) * 3;
                state.juice.spawn(state.spawnJuice);
              }
            }

            if (slice.bomb) {
              ctx.sfx.play("lose");
              vibrate([60, 40, 120]);
              state.shakeMs = ctx.reducedMotion ? 0 : SHAKE_MS;
              state.flashMs = ctx.reducedMotion ? 0 : FLASH_MS;
            } else {
              ctx.sfx.play("pick");
              vibrate(10);
            }

            hudPush.current({
              points: world.points,
              lives: world.lives,
              streak: world.streak,
              cut: world.cut,
            });
          }

          state.prevX = pointer.x;
          state.prevY = pointer.y;
        }

        if (pointer.justReleased) {
          // Hay que leer el contador antes de cerrar: `endStroke` lo reinicia.
          const strokeCut = world.strokeCut;
          const combo = endStroke(world);
          // El swipe de la base llega recien al soltar: sirve para el silbido
          // del sable, no para cortar.
          const swipe = ctx.input.swipe;
          if (swipe && swipe.speed >= tuning.minSliceSpeed) ctx.sfx.play("select");
          if (combo > 0) {
            ctx.sfx.play("win");
            vibrate([12, 30, 12]);
            frame.x = world.strokeX;
            frame.y = world.strokeY;
            frame.count = Math.min(MAX_SLICES, strokeCut);
            state.floaters.spawn(state.spawnFloater);
            hudPush.current({ points: world.points });
          }
          state.hasPrev = false;
        }

        // La estela se apaga sola: sin esto queda una cinta colgada en la
        // pantalla cuando el jugador levanta el dedo.
        const fade = dt / TRAIL_FADE;
        for (let i = 0; i < TRAIL_POINTS; i++) {
          const life = state.trailLife[i] ?? 0;
          if (life > 0) state.trailLife[i] = Math.max(0, life - fade);
        }

        stepNinja(world, dt, ctx.rng);

        if (world.events.missed > 0) {
          ctx.sfx.play("hit");
          vibrate(24);
          hudPush.current({ lives: world.lives, streak: 0, points: world.points });
        }

        state.juice.each(state.stepJuice);
        state.halves.each(state.stepHalf);
        state.splats.each(state.stepSplat);
        state.floaters.each(state.stepFloater);

        if (state.shakeMs > 0) state.shakeMs = Math.max(0, state.shakeMs - dt * 1000);
        if (state.flashMs > 0) state.flashMs = Math.max(0, state.flashMs - dt * 1000);

        if (world.over) {
          state.overMs += dt * 1000;
          if (state.overMs >= (ctx.reducedMotion ? 200 : OVER_MS)) ctx.finish(true);
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
          g.translate(
            Math.sin(state.shakeMs * 0.8) * 12 * decay,
            Math.cos(state.shakeMs * 1.3) * 12 * decay,
          );
        }

        // Salpicaduras del fondo: dan la sensacion de que la partida deja marca.
        state.splats.each(state.drawSplat);
        g.globalAlpha = 1;

        /* --- Frutas enteras --------------------------------------------- */
        for (let i = 0; i < world.fruits.length; i++) {
          const fruit = world.fruits[i];
          if (!fruit || !fruit.alive) continue;
          const x = lerp(fruit.px, fruit.x, ctx.alpha);
          const y = lerp(fruit.py, fruit.y, ctx.alpha);
          if (y < -80 || y > WORLD_HEIGHT + 80) continue;

          g.save();
          g.translate(x, y);
          g.rotate(lerp(fruit.prot, fruit.rot, ctx.alpha));

          if (fruit.bomb) {
            // Esfera oscura, anillo rojo pulsante y mecha. Confundirla con una
            // fruta se sentiria injusto, asi que no se parece a ninguna.
            const beat = ctx.reducedMotion ? 0.5 : Math.sin(ctx.elapsedMs / 110) * 0.5 + 0.5;
            g.fillStyle = colors.bomb;
            g.beginPath();
            g.arc(0, 0, fruit.radius, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = colors.bombRing;
            g.lineWidth = 3 + beat * 2;
            g.stroke();
            g.strokeStyle = colors.bombFuse;
            g.lineWidth = 3;
            g.beginPath();
            g.moveTo(0, -fruit.radius);
            g.lineTo(fruit.radius * 0.45, -fruit.radius * 1.5);
            g.stroke();
            g.fillStyle = colors.bombFuse;
            g.beginPath();
            g.arc(fruit.radius * 0.45, -fruit.radius * 1.5, 3 + beat * 2, 0, Math.PI * 2);
            g.fill();
          } else {
            g.fillStyle = state.fruitColors[fruit.color] ?? ctx.palette["--sn-text"];
            fruitPath(g, fruit.shape, fruit.radius);
            g.fill();
            g.fillStyle = state.shineColors[fruit.color] ?? ctx.palette["--sn-text"];
            g.globalAlpha = 0.55;
            fruitPath(g, fruit.shape, fruit.radius * 0.52);
            g.fill();
            g.globalAlpha = 1;
          }
          g.restore();
        }

        /* --- Mitades y jugo ---------------------------------------------- */
        state.halves.each(state.drawHalf);
        g.globalAlpha = 1;
        state.juice.each(state.drawJuice);
        g.globalAlpha = 1;

        /* --- Estela del corte -------------------------------------------- */
        const points = ctx.reducedMotion ? TRAIL_SHORT : TRAIL_POINTS;
        g.lineCap = "round";
        g.lineJoin = "round";
        for (let k = 1; k < points; k++) {
          const current = (state.trailHead - k + TRAIL_POINTS * 2) % TRAIL_POINTS;
          const previous = (current + 1) % TRAIL_POINTS;
          const lifeA = state.trailLife[current] ?? 0;
          const lifeB = state.trailLife[previous] ?? 0;
          if (lifeA <= 0 || lifeB <= 0) continue;

          const taper = 1 - k / points;
          g.globalAlpha = Math.min(lifeA, lifeB) * taper;
          g.strokeStyle = colors.blade;
          g.lineWidth = 2 + taper * 12;
          g.beginPath();
          g.moveTo(state.trailX[current] ?? 0, state.trailY[current] ?? 0);
          g.lineTo(state.trailX[previous] ?? 0, state.trailY[previous] ?? 0);
          g.stroke();

          g.strokeStyle = colors.bladeCore;
          g.lineWidth = 1 + taper * 3;
          g.stroke();
        }
        g.globalAlpha = 1;

        /* --- Numero del combo -------------------------------------------- */
        g.font = state.comboFont;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = colors.combo;
        state.floaters.each(state.drawFloater);
        g.globalAlpha = 1;

        g.restore();

        if (state.flashMs > 0) {
          g.globalAlpha = (state.flashMs / FLASH_MS) * 0.8;
          g.fillStyle = colors.flash;
          g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
          g.globalAlpha = 1;
        }
      },

      outcome: (state, completed) => {
        const world = state.world;
        return {
          points: world.points,
          completed,
          meta: {
            cortadas: world.cut,
            caidas: world.missed,
            mejorRacha: world.bestStreak,
            mejorCombo: world.bestCombo,
            vidas: Math.max(0, world.lives),
            causa: world.overReason === "" ? (completed ? "tiempo" : "forzado") : world.overReason,
          },
        };
      },
    };
  }, [tuning]);

  const api = useGame2D(definition, config, signal, onFinish);

  // El loop necesita empujar al HUD y `setHud` recien existe despues del hook.
  hudPush.current = api.setHud;

  const readyRef = useRef(false);
  useEffect(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    onReady?.();
  }, [onReady]);

  const { hud, timeLeftMs } = api;

  return (
    <GameStage
      containerRef={api.containerRef}
      canvasRef={api.canvasRef}
      phase={api.phase}
      countdownLeft={api.countdownLeft}
      instructions="Deslizá para cortar. Tres o más de un solo trazo dan combo. Las bombas terminan la partida."
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
          <HudStat label="Puntos" value={hud.points} tone="cyan" dominant />
          <HudStat
            label="Vidas"
            value={hud.lives}
            tone={hud.lives <= 1 ? "danger" : "default"}
          />
          <HudStat label="Racha" value={hud.streak} tone="magenta" />
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
          <h3 className="text-lg">Se terminó</h3>
          <p className="mt-1 text-sm text-sn-muted">
            Cortaste <span className="sn-num text-sn-cyan">{hud.cut}</span> frutas.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="sn-card px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-sn-dim">Puntos</div>
              <div className="sn-num text-lg text-sn-cyan">{hud.points}</div>
            </div>
            <div className="sn-card px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-sn-dim">Cortadas</div>
              <div className="sn-num text-lg text-sn-text">{hud.cut}</div>
            </div>
            <div className="sn-card px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-sn-dim">Racha</div>
              <div className="sn-num text-lg text-sn-magenta">{hud.streak}</div>
            </div>
          </div>
        </div>
      }
    />
  );
}
