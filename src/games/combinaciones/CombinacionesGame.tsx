import { useMemo } from "react";
import type { GameProps } from "@/core/contract/game";
import { bool, num } from "@/core/contract/settings";
import { vibrate } from "@/core/engine/audio";
import { mixHex } from "@/core/engine/palette";
import { createPool, type Pool } from "@/core/engine/pool";
import { createRng, type Rng } from "@/core/engine/rng";
import type { DrawContext, FrameContext } from "@/core/engine/useGame2D";
import { useGame2D } from "@/core/engine/useGame2D";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  applySwap,
  areAdjacent,
  beginClear,
  cascadePoints,
  createBoard,
  createWork,
  finishClear,
  generateSolvableBoard,
  hasAnyMove,
  hashBoard,
  isLegalSwap,
  SPECIAL_BOMB,
  SPECIAL_COL,
  SPECIAL_NONE,
  SPECIAL_PRISM,
  SPECIAL_ROW,
  type Board,
  type MatchRules,
  type MatchWork,
} from "./logic";

/**
 * M1 · Combinaciones.
 *
 * El registry lo declara con motor `pixi`, pero esta escrito con el canvas 2D
 * de la base. Un tablero de 8x8 son 64 formas y un puñado de particulas: muy
 * por debajo del umbral de ~200 sprites moviles que la propia guia pone para
 * justificar un motor. Si el contador de fps del banco de pruebas bajara de 60,
 * ahi habria evidencia para migrar; antes seria una dependencia sin motivo.
 *
 * Este archivo NO tiene reglas: arma el estado, traduce los toques a
 * intercambios y dibuja. Todo lo que decide que pasa vive en `logic.ts`, y esa
 * separacion es lo que hace verificable el determinismo del tablero compartido.
 */

const CELL = 80;
/** Aire arriba para que el HUD no se apoye sobre la primera fila. */
const TOP = 76;
/** Franja de abajo: ahi va la barra de reloj. */
const BOTTOM = 22;

const PHASE_IDLE = 0;
const PHASE_SWAP = 1;
const PHASE_CLEAR = 2;
const PHASE_FALL = 3;

const SWAP_MS = 150;
const CLEAR_MS = 210;
const FALL_MS = 280;
/** Con reduced-motion las animaciones se acortan, no desaparecen: en un
 * match-3 la animacion explica la mecanica y sin ella el tablero es ilegible. */
const REDUCED_FACTOR = 0.5;

const STEP_MS = 1000 / 60;
const TAU = Math.PI * 2;
/** Fraccion de celda que hay que arrastrar para que cuente como deslizar. */
const DRAG_RATIO = 0.34;
const WARNING_MS = 10_000;

type Particle = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  type: number;
  size: number;
};

type MatchHud = { points: number; cascade: number; moves: number; shuffles: number };

type Scene = {
  board: Board;
  work: MatchWork;
  rules: MatchRules;
  /** Generador aparte para los efectos: tocar el sembrado desviaria el relleno. */
  fx: Rng;
  particles: Pool<Particle>;

  phase: number;
  timer: number;
  phaseMs: number;
  level: number;

  swapA: number;
  swapB: number;
  swapValid: boolean;
  /** Movimiento pedido durante una cascada. Se espera, no se descarta. */
  pendingA: number;
  pendingB: number;
  selected: number;
  pressIndex: number;
  pressX: number;
  pressY: number;

  points: number;
  moves: number;
  clearedTotal: number;
  specialsTotal: number;
  bestCascade: number;
  shuffles: number;

  comboMs: number;
  comboLevel: number;
  noticeMs: number;
  shakeMs: number;

  durationMs: number | null;
  swapMs: number;
  clearMs: number;
  fallMs: number;
  particlesPerTile: number;

  boardX: number;
  boardY: number;
  boardW: number;
  boardH: number;

  fill: string[];
  glow: string[];
  shade: string[];
  hexX: Float32Array;
  hexY: Float32Array;
  starX: Float32Array;
  starY: Float32Array;
  comboFonts: string[];
  comboLabels: string[];
  noticeFont: string;
};

/* ------------------------------------------------------------------ */
/* Particulas: el init vive afuera para no crear un closure por ficha   */
/* ------------------------------------------------------------------ */

const spawnArgs: { x: number; y: number; type: number; rng: Rng | null } = {
  x: 0,
  y: 0,
  type: 0,
  rng: null,
};

function initParticle(p: Particle): void {
  const rng = spawnArgs.rng;
  const angle = rng ? rng.next() * TAU : 0;
  const speed = rng ? 80 + rng.next() * 240 : 140;
  p.x = spawnArgs.x;
  p.y = spawnArgs.y;
  p.vx = Math.cos(angle) * speed;
  p.vy = Math.sin(angle) * speed - 70;
  p.maxLife = 340 + (rng ? rng.next() * 280 : 120);
  p.life = p.maxLife;
  p.type = spawnArgs.type;
  p.size = 3 + (rng ? rng.next() * 4 : 2);
}

function makeParticle(): Particle {
  return { alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, type: 0, size: 3 };
}

/**
 * `pool.each` recibe un callback. Definirlo inline seria un closure nuevo por
 * frame, o sea basura de GC a 60 Hz. Estas tres variables de modulo son el
 * precio de no tenerla: solo hay un juego corriendo a la vez y las dos lecturas
 * son sincronicas dentro de la misma llamada.
 */
let liveScene: Scene | null = null;
let liveDt = 0;
let liveCanvas: CanvasRenderingContext2D | null = null;
let liveFallback = "";

function stepParticle(p: Particle): void {
  const scene = liveScene;
  if (!scene) return;
  p.life -= liveDt * 1000;
  if (p.life <= 0) {
    scene.particles.release(p);
    return;
  }
  p.x += p.vx * liveDt;
  p.y += p.vy * liveDt;
  p.vy += 1100 * liveDt;
}

function paintParticle(p: Particle): void {
  const scene = liveScene;
  const g = liveCanvas;
  if (!scene || !g) return;
  g.globalAlpha = clamp01(p.life / p.maxLife);
  g.fillStyle = scene.fill[p.type] ?? liveFallback;
  g.beginPath();
  g.arc(p.x, p.y, p.size, 0, TAU);
  g.fill();
}

/* ------------------------------------------------------------------ */
/* Maquina de fases                                                     */
/* ------------------------------------------------------------------ */

function cellAt(scene: Scene, x: number, y: number): number {
  const col = Math.floor((x - scene.boardX) / CELL);
  const row = Math.floor((y - scene.boardY) / CELL);
  if (col < 0 || row < 0 || col >= scene.board.cols || row >= scene.board.rows) return -1;
  return row * scene.board.cols + col;
}

function queueMove(scene: Scene, a: number, b: number): void {
  if (!areAdjacent(scene.board.cols, a, b)) return;
  scene.pendingA = a;
  scene.pendingB = b;
}

function readInput(scene: Scene, ctx: FrameContext<MatchHud>): void {
  const pointer = ctx.input.pointer;

  if (pointer.justPressed) {
    scene.pressIndex = cellAt(scene, pointer.x, pointer.y);
    scene.pressX = pointer.x;
    scene.pressY = pointer.y;
  }

  // Deslizar: apenas el dedo se corre lo suficiente se decide el vecino y se
  // suelta el gesto, sin esperar a que levante.
  if (pointer.down && scene.pressIndex >= 0) {
    const dx = pointer.x - scene.pressX;
    const dy = pointer.y - scene.pressY;
    const adx = dx < 0 ? -dx : dx;
    const ady = dy < 0 ? -dy : dy;
    const threshold = CELL * DRAG_RATIO;
    if (adx > threshold || ady > threshold) {
      const from = scene.pressIndex;
      let col = from % scene.board.cols;
      let row = (from / scene.board.cols) | 0;
      if (adx > ady) col += dx > 0 ? 1 : -1;
      else row += dy > 0 ? 1 : -1;
      if (col >= 0 && col < scene.board.cols && row >= 0 && row < scene.board.rows) {
        queueMove(scene, from, row * scene.board.cols + col);
      }
      scene.pressIndex = -1;
      scene.selected = -1;
    }
  }

  if (pointer.justReleased) {
    const index = scene.pressIndex;
    scene.pressIndex = -1;
    if (index < 0) return;
    // Tocar y volver a tocar, para quien no desliza.
    if (scene.selected >= 0 && scene.selected !== index && areAdjacent(scene.board.cols, scene.selected, index)) {
      queueMove(scene, scene.selected, index);
      scene.selected = -1;
    } else {
      scene.selected = scene.selected === index ? -1 : index;
      ctx.sfx.play("select");
    }
  }
}

function goIdle(scene: Scene, ctx: FrameContext<MatchHud>): void {
  scene.phase = PHASE_IDLE;
  scene.timer = 0;
  scene.phaseMs = 0;
  scene.level = 0;
  ctx.setHud({ cascade: 1 });

  if (hasAnyMove(scene.board, scene.rules.specialsEnabled)) return;

  // Trabado: se rebaraja con el generador sembrado, asi el tablero nuevo
  // tambien es el mismo para todos los que comparten semilla.
  generateSolvableBoard(scene.board, ctx.rng, scene.rules);
  if (!hasAnyMove(scene.board, scene.rules.specialsEnabled)) {
    ctx.finish(true);
    return;
  }
  scene.board.fallFrom.fill(scene.board.rows);
  scene.shuffles++;
  scene.noticeMs = 1500;
  ctx.setHud({ shuffles: scene.shuffles });
  ctx.sfx.play("tick");
  scene.phase = PHASE_FALL;
  scene.phaseMs = scene.fallMs;
  scene.timer = scene.fallMs;
}

function spawnBurst(scene: Scene): void {
  if (scene.particlesPerTile === 0) return;
  const { board, work } = scene;
  spawnArgs.rng = scene.fx;
  for (let i = 0; i < board.tiles.length; i++) {
    if (work.cleared[i] !== 1) continue;
    spawnArgs.x = scene.boardX + (i % board.cols) * CELL + CELL / 2;
    spawnArgs.y = scene.boardY + (((i / board.cols) | 0) * CELL) + CELL / 2;
    spawnArgs.type = board.tiles[i] as number;
    for (let k = 0; k < scene.particlesPerTile; k++) scene.particles.spawn(initParticle);
  }
}

/** Marca lo que se limpia, cobra los puntos y entra en la fase de estallido. */
function startClear(scene: Scene, ctx: FrameContext<MatchHud>, preferA: number, preferB: number): void {
  const marked = beginClear(scene.board, scene.work, scene.rules, preferA, preferB);
  if (marked === 0) {
    goIdle(scene, ctx);
    return;
  }

  const gained = cascadePoints(marked, scene.work.specialsUsed, scene.level, scene.rules);
  scene.points += gained;
  scene.clearedTotal += marked;
  scene.specialsTotal += scene.work.specialsUsed;
  if (scene.level + 1 > scene.bestCascade) scene.bestCascade = scene.level + 1;

  ctx.setHud({ points: scene.points, cascade: scene.level + 1, moves: scene.moves });
  ctx.sfx.play(scene.level === 0 ? "pick" : "win");
  vibrate(scene.level === 0 ? 10 : 20);
  spawnBurst(scene);
  if (scene.level > 0) {
    scene.comboLevel = scene.level + 1;
    scene.comboMs = 750;
  }
  if (!ctx.reducedMotion && scene.work.specialsUsed > 0) scene.shakeMs = 180;

  scene.phase = PHASE_CLEAR;
  scene.phaseMs = scene.clearMs;
  scene.timer = scene.clearMs;
}

function onIdle(scene: Scene, ctx: FrameContext<MatchHud>): void {
  scene.timer = 0;
  if (scene.pendingA < 0) return;
  const a = scene.pendingA;
  const b = scene.pendingB;
  scene.pendingA = -1;
  scene.pendingB = -1;

  scene.swapA = a;
  scene.swapB = b;
  scene.swapValid = isLegalSwap(scene.board, a, b, scene.rules.specialsEnabled);
  scene.selected = -1;
  // El invalido dura el doble porque la animacion va y vuelve. No penaliza:
  // el tablero ni se entera, solo se ve que las fichas no se quedan.
  scene.phaseMs = scene.swapValid ? scene.swapMs : scene.swapMs * 2;
  scene.timer = scene.phaseMs;
  scene.phase = PHASE_SWAP;
  ctx.sfx.play(scene.swapValid ? "select" : "tick");
}

function onSwapEnd(scene: Scene, ctx: FrameContext<MatchHud>): void {
  const a = scene.swapA;
  const b = scene.swapB;
  scene.swapA = -1;
  scene.swapB = -1;

  if (!scene.swapValid) {
    vibrate(8);
    goIdle(scene, ctx);
    return;
  }

  applySwap(scene.board, a, b);
  scene.moves++;
  scene.level = 0;
  startClear(scene, ctx, a, b);
}

function onClearEnd(scene: Scene, ctx: FrameContext<MatchHud>): void {
  finishClear(scene.board, scene.work, ctx.rng);
  scene.phase = PHASE_FALL;
  scene.phaseMs = scene.fallMs;
  scene.timer = scene.fallMs;
}

function onFallEnd(scene: Scene, ctx: FrameContext<MatchHud>): void {
  scene.level++;
  startClear(scene, ctx, -1, -1);
}

/* ------------------------------------------------------------------ */
/* Dibujo                                                               */
/* ------------------------------------------------------------------ */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function drawShape(
  g: CanvasRenderingContext2D,
  scene: Scene,
  type: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  g.beginPath();
  switch (type) {
    case 0:
      g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      break;
    case 1:
      g.moveTo(cx, cy - ry);
      g.lineTo(cx + rx, cy);
      g.lineTo(cx, cy + ry);
      g.lineTo(cx - rx, cy);
      g.closePath();
      break;
    case 2:
      for (let i = 0; i < 6; i++) {
        const px = cx + (scene.hexX[i] as number) * rx;
        const py = cy + (scene.hexY[i] as number) * ry;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      break;
    case 3:
      g.moveTo(cx, cy - ry);
      g.lineTo(cx + rx * 0.94, cy + ry * 0.74);
      g.lineTo(cx - rx * 0.94, cy + ry * 0.74);
      g.closePath();
      break;
    case 4:
      g.roundRect(cx - rx * 0.84, cy - ry * 0.84, rx * 1.68, ry * 1.68, Math.min(rx, ry) * 0.3);
      break;
    default:
      for (let i = 0; i < 10; i++) {
        const px = cx + (scene.starX[i] as number) * rx;
        const py = cy + (scene.starY[i] as number) * ry;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      break;
  }
  g.fill();
}

/** Las especiales se marcan con un trazo, no solo con brillo: se leen de un vistazo. */
function drawSpecialMark(
  g: CanvasRenderingContext2D,
  kind: number,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.beginPath();
  if (kind === SPECIAL_ROW) {
    g.moveTo(cx - r * 1.15, cy - r * 0.3);
    g.lineTo(cx + r * 1.15, cy - r * 0.3);
    g.moveTo(cx - r * 1.15, cy + r * 0.3);
    g.lineTo(cx + r * 1.15, cy + r * 0.3);
  } else if (kind === SPECIAL_COL) {
    g.moveTo(cx - r * 0.3, cy - r * 1.15);
    g.lineTo(cx - r * 0.3, cy + r * 1.15);
    g.moveTo(cx + r * 0.3, cy - r * 1.15);
    g.lineTo(cx + r * 0.3, cy + r * 1.15);
  } else if (kind === SPECIAL_BOMB) {
    g.arc(cx, cy, r * 1.12, 0, TAU);
  } else if (kind === SPECIAL_PRISM) {
    g.arc(cx, cy, r * 1.12, 0, TAU);
    g.moveTo(cx + r * 0.5, cy);
    g.arc(cx, cy, r * 0.5, 0, TAU);
  }
  g.stroke();
}

/* ------------------------------------------------------------------ */
/* Componente                                                           */
/* ------------------------------------------------------------------ */

export default function CombinacionesGame({ config, signal, onFinish }: GameProps) {
  const options = useMemo(() => {
    const rules: MatchRules = {
      cols: Math.round(num(config.settings, "cols", 8)),
      rows: Math.round(num(config.settings, "rows", 8)),
      typeCount: Math.round(num(config.settings, "typeCount", 6)),
      pointsPerTile: num(config.settings, "pointsPerTile", 20),
      specialPoints: num(config.settings, "specialPoints", 150),
      cascadeMultiplier: num(config.settings, "cascadeMultiplier", 0.5),
      bombRadius: Math.round(num(config.settings, "bombRadius", 1)),
      specialsEnabled: bool(config.settings, "specialsEnabled", true),
    };
    return {
      rules,
      animationSpeed: num(config.settings, "animationSpeed", 1),
      maxParticles: Math.round(num(config.settings, "maxParticles", 220)),
    };
  }, [config.settings]);

  const width = options.rules.cols * CELL;
  const height = TOP + options.rules.rows * CELL + BOTTOM;

  const game = useGame2D<Scene, MatchHud>(
    {
      design: { width, height },
      countdown: 3,
      hud: { points: 0, cascade: 1, moves: 0, shuffles: 0 },

      init: (ctx) => {
        const rules = options.rules;
        const board = createBoard(rules, ctx.rng);
        const work = createWork(board);
        const palette = ctx.palette;

        // Seis tipos con color Y forma propias: el color solo no alcanza para
        // quien no lo distingue, y la guia pide que se lean en escala de grises.
        const base = [
          palette["--sn-cyan-400"],
          palette["--sn-magenta-400"],
          palette["--sn-violet-400"],
          palette["--sn-success"],
          palette["--sn-warn"],
          palette["--sn-text"],
        ];
        const fill: string[] = new Array(base.length);
        const glow: string[] = new Array(base.length);
        const shade: string[] = new Array(base.length);
        for (let i = 0; i < base.length; i++) {
          const color = base[i] ?? palette["--sn-text"];
          fill[i] = color;
          // El degrade se arma con dos formas de colores precalculados: crear
          // un CanvasGradient por ficha y por frame seria basura garantizada.
          glow[i] = mixHex(color, palette["--sn-text"], 0.45);
          shade[i] = mixHex(color, palette["--sn-bg"], 0.55);
        }

        const hexX = new Float32Array(6);
        const hexY = new Float32Array(6);
        for (let i = 0; i < 6; i++) {
          const angle = -Math.PI / 2 + (i * TAU) / 6;
          hexX[i] = Math.cos(angle);
          hexY[i] = Math.sin(angle);
        }
        const starX = new Float32Array(10);
        const starY = new Float32Array(10);
        for (let i = 0; i < 10; i++) {
          const angle = -Math.PI / 2 + (i * TAU) / 10;
          const radius = i % 2 === 0 ? 1 : 0.46;
          starX[i] = Math.cos(angle) * radius;
          starY[i] = Math.sin(angle) * radius;
        }

        const family = '"Space Grotesk", sans-serif';
        const comboFonts = [56, 66, 76, 86, 96].map((size) => `700 ${size}px ${family}`);
        const comboLabels: string[] = new Array(12);
        for (let i = 0; i < comboLabels.length; i++) comboLabels[i] = "×" + (i + 1);

        const speed = options.animationSpeed <= 0 ? 1 : options.animationSpeed;
        const factor = (ctx.reducedMotion ? REDUCED_FACTOR : 1) / speed;

        return {
          board,
          work,
          rules,
          fx: createRng(config.seed + "-fx"),
          particles: createPool<Particle>(options.maxParticles, makeParticle),

          phase: PHASE_IDLE,
          timer: 0,
          phaseMs: 0,
          level: 0,

          swapA: -1,
          swapB: -1,
          swapValid: false,
          pendingA: -1,
          pendingB: -1,
          selected: -1,
          pressIndex: -1,
          pressX: 0,
          pressY: 0,

          points: 0,
          moves: 0,
          clearedTotal: 0,
          specialsTotal: 0,
          bestCascade: 0,
          shuffles: 0,

          comboMs: 0,
          comboLevel: 0,
          noticeMs: 0,
          shakeMs: 0,

          durationMs: config.durationMs,
          swapMs: SWAP_MS * factor,
          clearMs: CLEAR_MS * factor,
          fallMs: FALL_MS * factor,
          particlesPerTile: options.maxParticles === 0 ? 0 : ctx.reducedMotion ? 1 : 4,

          boardX: 0,
          boardY: TOP,
          boardW: board.cols * CELL,
          boardH: board.rows * CELL,

          fill,
          glow,
          shade,
          hexX,
          hexY,
          starX,
          starY,
          comboFonts,
          comboLabels,
          noticeFont: `600 26px ${family}`,
        };
      },

      update: (scene, dt, ctx) => {
        const ms = dt * 1000;

        liveScene = scene;
        liveDt = dt;
        scene.particles.each(stepParticle);

        if (scene.comboMs > 0) scene.comboMs -= ms;
        if (scene.noticeMs > 0) scene.noticeMs -= ms;
        if (scene.shakeMs > 0) scene.shakeMs -= ms;

        readInput(scene, ctx);

        if (scene.phase === PHASE_IDLE) {
          onIdle(scene, ctx);
          return;
        }

        scene.timer -= ms;
        if (scene.timer > 0) return;

        if (scene.phase === PHASE_SWAP) onSwapEnd(scene, ctx);
        else if (scene.phase === PHASE_CLEAR) onClearEnd(scene, ctx);
        else onFallEnd(scene, ctx);
      },

      draw: (scene, g, ctx) => {
        drawScene(scene, g, ctx);
      },

      outcome: (scene, completed) => ({
        completed,
        points: scene.points,
        meta: {
          movimientos: scene.moves,
          fichas: scene.clearedTotal,
          especiales: scene.specialsTotal,
          mejorCascada: scene.bestCascade,
          rebarajadas: scene.shuffles,
          // La huella del tablero final es lo que permite verificar afuera que
          // dos jugadores con la misma semilla jugaron el mismo tablero.
          tablero: hashBoard(scene.board),
        },
      }),
    },
    config,
    signal,
    onFinish,
  );

  const timeLeft = game.timeLeftMs;

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
      aspect={width / height}
      {...(config.debug ? { fps: game.fps } : {})}
      instructions="Deslizá una ficha hacia su vecina para alinear tres o más. Todos juegan el mismo tablero, así que el puntaje se compara de verdad."
      hud={
        <>
          <HudStat label="Puntos" value={game.hud.points} dominant tone="cyan" />
          {game.hud.cascade > 1 && (
            <HudStat label="Cascada" value={"×" + game.hud.cascade} tone="magenta" />
          )}
          <HudStat label="Jugadas" value={game.hud.moves} />
          {game.hud.shuffles > 0 && <HudStat label="Rebarajadas" value={game.hud.shuffles} tone="warn" />}
          {timeLeft !== null && (
            <HudStat
              label="Tiempo"
              value={formatClock(timeLeft)}
              tone={timeLeft < WARNING_MS ? "magenta" : "default"}
            />
          )}
        </>
      }
      summary={
        <>
          <h3 className="mb-1 text-lg">Se terminó</h3>
          <p className="text-sm text-sn-muted">
            <span className="sn-num text-sn-cyan">{game.hud.points}</span> puntos en{" "}
            <span className="sn-num">{game.hud.moves}</span> jugadas.
          </p>
          <p className="mt-1 text-xs text-sn-dim">
            Todos jugaron este mismo tablero: el ranking compara cabezas, no suerte.
          </p>
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* El render, afuera del componente para no rearmarlo en cada frame     */
/* ------------------------------------------------------------------ */

function drawScene(scene: Scene, g: CanvasRenderingContext2D, ctx: DrawContext): void {
  const board = scene.board;
  const palette = ctx.palette;
  const width = scene.boardW;
  const height = TOP + scene.boardH + BOTTOM;

  g.fillStyle = palette["--sn-bg"];
  g.fillRect(0, 0, width, height);

  // Progreso de la fase actual, interpolado con el alpha del loop para que la
  // caida se vea continua aunque la simulacion vaya a pasos fijos.
  const t =
    scene.phaseMs > 0 ? clamp01(1 - (scene.timer - ctx.alpha * STEP_MS) / scene.phaseMs) : 1;

  g.save();
  if (scene.shakeMs > 0 && !ctx.reducedMotion) {
    const amount = (scene.shakeMs / 180) * 5;
    g.translate(Math.sin(ctx.elapsedMs * 0.09) * amount, Math.cos(ctx.elapsedMs * 0.13) * amount);
  }

  // Fondo del tablero y grilla: dos draw calls para las 64 celdas.
  g.fillStyle = palette["--sn-panel"];
  g.beginPath();
  g.roundRect(scene.boardX, scene.boardY, scene.boardW, scene.boardH, 18);
  g.fill();

  g.strokeStyle = palette["--sn-line-soft"];
  g.lineWidth = 1;
  g.beginPath();
  for (let c = 1; c < board.cols; c++) {
    const x = scene.boardX + c * CELL;
    g.moveTo(x, scene.boardY);
    g.lineTo(x, scene.boardY + scene.boardH);
  }
  for (let r = 1; r < board.rows; r++) {
    const y = scene.boardY + r * CELL;
    g.moveTo(scene.boardX, y);
    g.lineTo(scene.boardX + scene.boardW, y);
  }
  g.stroke();

  if (scene.selected >= 0) {
    const sx = scene.boardX + (scene.selected % board.cols) * CELL;
    const sy = scene.boardY + (((scene.selected / board.cols) | 0) * CELL);
    g.strokeStyle = palette["--sn-cyan-400"];
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(sx + 3, sy + 3, CELL - 6, CELL - 6, 14);
    g.stroke();
  }

  const radius = CELL * 0.33;
  const bounce = ctx.reducedMotion ? 0 : 1;

  for (let index = 0; index < board.tiles.length; index++) {
    const type = board.tiles[index] as number;
    if (type < 0) continue;

    const col = index % board.cols;
    const row = (index / board.cols) | 0;
    let cx = scene.boardX + col * CELL + CELL / 2;
    let cy = scene.boardY + row * CELL + CELL / 2;
    let rx = radius;
    let ry = radius;

    if (scene.phase === PHASE_SWAP && (index === scene.swapA || index === scene.swapB)) {
      const other = index === scene.swapA ? scene.swapB : scene.swapA;
      // El invalido va y vuelve: las fichas se asoman y regresan solas.
      const k = scene.swapValid ? easeOutCubic(t) : t < 0.5 ? t * 2 : (1 - t) * 2;
      cx += ((other % board.cols) - col) * CELL * k;
      cy += (((other / board.cols) | 0) - row) * CELL * k;
    } else if (scene.phase === PHASE_CLEAR && scene.work.cleared[index] === 1) {
      const k = t < 0.3 ? 1 + t * 0.5 : Math.max(0, 1.15 * (1 - (t - 0.3) / 0.7));
      rx = radius * k;
      ry = radius * k;
    } else if (scene.phase === PHASE_FALL) {
      const distance = board.fallFrom[index] as number;
      if (distance > 0) {
        const eased = easeOutCubic(t);
        cy -= distance * CELL * (1 - eased);
        // Rebote corto al aterrizar: es lo que hace que el tablero se sienta
        // fisico en vez de teletransportado.
        const land = t > 0.72 ? Math.sin(((t - 0.72) / 0.28) * Math.PI) : 0;
        rx = radius * (1 + 0.16 * land * bounce);
        ry = radius * (1 - 0.2 * land * bounce);
      }
    }

    if (rx <= 0.5 || ry <= 0.5) continue;

    g.fillStyle = scene.shade[type] ?? palette["--sn-panel-hi"];
    drawShape(g, scene, type, cx, cy + 3, rx, ry);
    g.fillStyle = scene.fill[type] ?? palette["--sn-text"];
    drawShape(g, scene, type, cx, cy, rx, ry);
    g.globalAlpha = 0.55;
    g.fillStyle = scene.glow[type] ?? palette["--sn-text"];
    drawShape(g, scene, type, cx, cy - ry * 0.26, rx * 0.52, ry * 0.42);
    g.globalAlpha = 1;

    const kind = board.specials[index] as number;
    if (kind !== SPECIAL_NONE) {
      const pulse = ctx.reducedMotion ? 0.9 : 0.75 + Math.sin(ctx.elapsedMs * 0.006) * 0.25;
      g.globalAlpha = pulse;
      drawSpecialMark(g, kind, cx, cy, radius, palette["--sn-text"]);
      g.globalAlpha = 1;
    }
  }

  liveScene = scene;
  liveCanvas = g;
  liveFallback = palette["--sn-text"];
  scene.particles.each(paintParticle);
  g.globalAlpha = 1;

  if (scene.comboMs > 0) {
    const fade = clamp01(scene.comboMs / 750);
    const step = Math.min(scene.comboFonts.length - 1, scene.comboLevel - 2);
    g.font = scene.comboFonts[step < 0 ? 0 : step] ?? scene.noticeFont;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.globalAlpha = fade;
    g.fillStyle = palette["--sn-magenta-400"];
    g.fillText(
      scene.comboLabels[Math.min(scene.comboLabels.length - 1, scene.comboLevel - 1)] ?? "",
      scene.boardX + scene.boardW / 2,
      scene.boardY + scene.boardH / 2,
    );
    g.globalAlpha = 1;
  }

  if (scene.noticeMs > 0) {
    g.font = scene.noticeFont;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.globalAlpha = clamp01(scene.noticeMs / 1500);
    g.fillStyle = palette["--sn-warn"];
    g.fillText("Sin jugadas: tablero nuevo", scene.boardX + scene.boardW / 2, scene.boardY + 34);
    g.globalAlpha = 1;
  }

  g.restore();

  // Reloj como barra: los ultimos diez segundos cambian de color, que es lo
  // que se ve sin dejar de mirar el tablero.
  if (scene.durationMs !== null && scene.durationMs > 0) {
    const barY = TOP + scene.boardH + 8;
    const left = clamp01(1 - ctx.elapsedMs / scene.durationMs);
    g.fillStyle = palette["--sn-line"];
    g.fillRect(0, barY, width, 6);
    const remaining = scene.durationMs - ctx.elapsedMs;
    g.fillStyle = remaining < WARNING_MS ? palette["--sn-magenta-400"] : palette["--sn-cyan-400"];
    g.fillRect(0, barY, width * left, 6);
  }
}
