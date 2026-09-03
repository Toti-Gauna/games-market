import { useEffect, useMemo, useRef, useState } from "react";
import type * as RapierNs from "@dimforge/rapier2d-compat";
import type { GameProps } from "@/core/contract/game";
import { vibrate } from "@/core/engine/audio";
import { mixHex, withAlpha } from "@/core/engine/palette";
import { createPool, type Pool } from "@/core/engine/pool";
import { useGame2D, type BaseContext } from "@/core/engine/useGame2D";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import { GROUND_Y, WORLD_HEIGHT, WORLD_WIDTH } from "./levels";
import {
  MAX_PIECES,
  aimFromDrag,
  buildRunPlans,
  createAim,
  createRun,
  currentLevel,
  endTurn,
  fireShot,
  nextLevel,
  registerBlockDown,
  registerTargetDown,
  resolveLevels,
  rulesFromSettings,
  runMeta,
  runPoints,
  tickTurn,
  trajectoryPoint,
  type Aim,
  type CatapultRules,
  type LevelPlan,
  type Point,
  type RunState,
} from "./logic";

/**
 * M2 - Catapulta.
 *
 * El primer juego con fisica de verdad. Rapier resuelve el derrumbe; la base 2D
 * pone el loop, el input y el cierre; `logic.ts` decide que significa lo que se
 * cayo. Este archivo solo los ata y dibuja.
 *
 * Dos cosas que no son negociables y por eso estan comentadas donde pasan:
 * el paso de Rapier es el mismo paso fijo del loop, y el mundo WASM se libera a
 * mano porque el recolector de JS no lo alcanza.
 */

type RapierModule = typeof RapierNs;
type RigidBody = RapierNs.RigidBody;
type World = RapierNs.World;
type Vector = RapierNs.Vector;
type EventQueue = RapierNs.EventQueue;
type ContactForceEvent = RapierNs.TempContactForceEvent;

/** Paso de simulacion. El mismo numero alimenta al loop y a Rapier. */
const FIXED_STEP = 1 / 60;
/**
 * Cuantos pixeles considera Rapier "un metro". Sin esto habria que convertir
 * unidades en cada lectura de posicion; con esto la fisica y el canvas usan el
 * mismo sistema y no hay una sola conversion por frame.
 */
const PIXELS_PER_METER = 100;

const ANCHOR_X = 250;
const ANCHOR_Y = 636;
const MAX_DRAG = 260;
const POUCH_SCALE = 0.5;
const PROJECTILE_RADIUS = 18;
const PARK_X = -4000;
const PARK_Y = -4000;

const PREVIEW_STEPS = 26;
const PREVIEW_SPAN_S = 1.2;
const MAX_PARTICLES = 150;
const BURST_FULL = 12;
const BURST_CALM = 3;
const TRAIL_POINTS = 16;
const REVIEW_MS = 1500;
const BANNER_MS = 1600;
const SETTLING_HINT_MS = 1200;
const HIT_SOUND_COOLDOWN_MS = 90;

/**
 * Fuerza de contacto por debajo de la cual no hay golpe sino peso: una torre en
 * reposo apoya hasta ~5.500, y un impacto real pasa de 13.000. Medido, no
 * adivinado. Todo lo que queda arriba se cobra como impulso.
 */
const FORCE_FLOOR = 12000;
/** Velocidad y espera con las que se da por gastado el proyectil. */
const SPENT_SPEED = 70;
const SPENT_MS = 300;
/** Un cuerpo que se fue del mundo sigue costando: se retira apenas cruza. */
const OUT_MARGIN = 600;

const TAU = Math.PI * 2;
const FONT_BANNER = '700 46px "Space Grotesk", sans-serif';
const FONT_HINT = '600 20px "Space Grotesk", sans-serif';

const STATUS_AIM = "Apuntá";
const STATUS_FLY = "Volando";
const STATUS_SETTLE = "Asentándose";
const STATUS_CLEAR = "¡Nivel limpio!";
const STATUS_FAIL = "Sin tiros";

type Piece = {
  alive: boolean;
  body: RigidBody | null;
  /** 0 bloque, 1 objetivo. */
  kind: number;
  stone: boolean;
  hp: number;
  maxHp: number;
  w: number;
  h: number;
  grain: number;
  /** Handle del collider: es la unica forma de mapear un evento a su pieza. */
  collider: number;
  x: number;
  y: number;
  angle: number;
  prevX: number;
  prevY: number;
  prevAngle: number;
  flashMs: number;
};

type Particle = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  tone: number;
};

type Physics = {
  world: World;
  events: EventQueue;
  projectile: RigidBody;
  /** Vectores reutilizados: Rapier escribe adentro en vez de crear uno nuevo. */
  vec: Vector;
  vec2: Vector;
  disposed: boolean;
  dispose(): void;
};

type Colors = {
  sky: CanvasGradient;
  ground: string;
  groundEdge: string;
  horizon: string;
  frame: string;
  frameHi: string;
  band: string;
  ball: string;
  trail: string;
  preview: string;
  target: string;
  targetGlow: string;
  wood: string;
  woodEdge: string;
  stone: string;
  stoneEdge: string;
  bg: string;
  flash: string;
  text: string;
  dim: string;
  success: string;
  danger: string;
  tones: string[];
};

type Scene = {
  run: RunState;
  physics: Physics;
  pieces: Piece[];
  particles: Pool<Particle>;
  colors: Colors;
  rules: CatapultRules;
  aim: Aim;
  preview: Point;
  dragging: boolean;
  dragX: number;
  dragY: number;
  projActive: boolean;
  projX: number;
  projY: number;
  projAngle: number;
  projPrevX: number;
  projPrevY: number;
  projPrevAngle: number;
  projSlowMs: number;
  /** Handle de collider -> pieza. Se arma al montar el nivel, nunca por frame. */
  byCollider: Map<number, Piece>;
  /** Se crea una vez: un closure nuevo por frame seria basura por frame. */
  onContactForce: (event: ContactForceEvent) => void;
  /** Tiros del nivel en curso: el nivel puede declarar los suyos. */
  levelShots: number;
  trailX: Float32Array;
  trailY: Float32Array;
  trailCount: number;
  trailHead: number;
  shakeMs: number;
  shakeAmp: number;
  shakeX: number;
  shakeY: number;
  reviewMs: number;
  bannerMs: number;
  bannerText: string;
  bannerTone: number;
  hitCooldownMs: number;
  status: string;
  hudDirty: boolean;
  pulse: number;
};

type CatapultHud = {
  points: number;
  level: string;
  shots: number;
  targets: number;
  status: string;
};

/* ------------------------------------------------------------------ */
/* Mundo de Rapier                                                      */
/* ------------------------------------------------------------------ */

function createPhysics(api: RapierModule, gravity: number): Physics {
  const world = new api.World({ x: 0, y: gravity });
  // El paso de Rapier es el del loop. Si no coinciden, la simulacion deja de
  // ser determinista y el mismo tiro se derrumba distinto en cada maquina.
  world.timestep = FIXED_STEP;
  world.lengthUnit = PIXELS_PER_METER;

  const ground = world.createRigidBody(
    api.RigidBodyDesc.fixed().setTranslation(WORLD_WIDTH / 2, GROUND_Y + 80),
  );
  world.createCollider(
    api.ColliderDesc.cuboid(WORLD_WIDTH, 80).setFriction(0.92).setRestitution(0.02),
    ground,
  );

  // El proyectil se crea una sola vez y se apaga entre tiros: crear y destruir
  // un cuerpo por disparo seria basura para el GC en mitad de la partida.
  const projectile = world.createRigidBody(
    api.RigidBodyDesc.dynamic()
      .setTranslation(PARK_X, PARK_Y)
      // CCD solo en el proyectil: es el unico cuerpo lo bastante rapido como
      // para cruzar un bloque entre dos pasos.
      .setCcdEnabled(true)
      .setEnabled(false)
      .setLinearDamping(0.02)
      .setAngularDamping(0.6),
  );
  world.createCollider(
    api.ColliderDesc.ball(PROJECTILE_RADIUS)
      .setDensity(0.0018)
      .setFriction(0.55)
      .setRestitution(0.22)
      .setActiveEvents(api.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(FORCE_FLOOR),
    projectile,
  );

  const physics: Physics = {
    world,
    events: new api.EventQueue(true),
    projectile,
    vec: { x: 0, y: 0 },
    vec2: { x: 0, y: 0 },
    disposed: false,
    dispose() {
      if (physics.disposed) return;
      physics.disposed = true;
      // Es memoria WASM: el recolector de JS no la toca. Sin esto, cada
      // reinicio del banco de pruebas deja un mundo entero colgado.
      physics.events.free();
      world.free();
    },
  };
  return physics;
}

/**
 * El dano sale de la fuerza de contacto, no del cambio de velocidad: un
 * objetivo aplastado contra el suelo no cambia de velocidad, pero la plataforma
 * que le cae encima si le mete fuerza. Medirlo asi es lo que hace que derrumbar
 * la torre cuente como derribar lo que hay debajo.
 *
 * Solo resta vida; sacar el cuerpo del mundo mientras Rapier drena sus propios
 * eventos es pedir un cuelgue. La pieza se retira despues, en readBodies.
 */
function makeForceHandler(scene: Scene, ctx: Pick<BaseContext, "sfx">) {
  return (event: ContactForceEvent) => {
    if (scene.run.phase !== "resolving") return;
    const impulse = (event.maxForceMagnitude() - FORCE_FLOOR) * FIXED_STEP;
    if (impulse <= 0) return;
    const first = scene.byCollider.get(event.collider1());
    const second = scene.byCollider.get(event.collider2());
    let hit = false;
    if (first && first.alive) {
      first.hp -= impulse;
      first.flashMs = 150;
      hit = true;
    }
    if (second && second.alive) {
      second.hp -= impulse;
      second.flashMs = 150;
      hit = true;
    }
    if (hit && scene.hitCooldownMs <= 0) {
      scene.hitCooldownMs = HIT_SOUND_COOLDOWN_MS;
      ctx.sfx.play("tick");
    }
  };
}

function clearPieces(scene: Scene): void {
  const { world } = scene.physics;
  for (let i = 0; i < scene.pieces.length; i++) {
    const piece = scene.pieces[i];
    if (!piece || !piece.alive) continue;
    if (piece.body) world.removeRigidBody(piece.body);
    piece.body = null;
    piece.alive = false;
  }
  scene.byCollider.clear();
}

/** Arma el nivel en el mundo. Corre al cambiar de nivel, nunca por frame. */
function buildLevel(scene: Scene, api: RapierModule, plan: LevelPlan): void {
  clearPieces(scene);
  const { world } = scene.physics;

  for (let i = 0; i < plan.pieces.length && i < scene.pieces.length; i++) {
    const spec = plan.pieces[i];
    const piece = scene.pieces[i];
    if (!spec || !piece) continue;

    const stone = spec.material === "stone";
    const density = spec.kind === "target" ? 0.0005 : stone ? 0.0016 : 0.0006;
    const body = world.createRigidBody(
      api.RigidBodyDesc.dynamic()
        .setTranslation(spec.x, spec.y)
        .setLinearDamping(0.05)
        .setAngularDamping(0.2),
    );
    const collider = world.createCollider(
      api.ColliderDesc.cuboid(spec.w / 2, spec.h / 2)
        .setDensity(density)
        .setFriction(stone ? 0.72 : 0.62)
        .setRestitution(0.04)
        .setActiveEvents(api.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(FORCE_FLOOR),
      body,
    );

    piece.alive = true;
    piece.body = body;
    piece.collider = collider.handle;
    scene.byCollider.set(collider.handle, piece);
    piece.kind = spec.kind === "target" ? 1 : 0;
    piece.stone = stone;
    piece.hp = spec.strength;
    piece.maxHp = spec.strength;
    piece.w = spec.w;
    piece.h = spec.h;
    piece.grain = spec.grain;
    piece.x = spec.x;
    piece.y = spec.y;
    piece.angle = 0;
    piece.prevX = spec.x;
    piece.prevY = spec.y;
    piece.prevAngle = 0;
    piece.flashMs = 0;
  }

  scene.levelShots = plan.shots;
  scene.bannerText = plan.name;
  scene.bannerTone = 0;
  scene.bannerMs = BANNER_MS;
}

function fireProjectile(scene: Scene): void {
  const { projectile, vec } = scene.physics;
  projectile.setEnabled(true);
  vec.x = ANCHOR_X;
  vec.y = ANCHOR_Y;
  projectile.setTranslation(vec, true);
  projectile.setRotation(0, true);
  vec.x = scene.aim.vx;
  vec.y = scene.aim.vy;
  projectile.setLinvel(vec, true);
  projectile.setAngvel(0, true);

  scene.projActive = true;
  scene.projX = ANCHOR_X;
  scene.projY = ANCHOR_Y;
  scene.projPrevX = ANCHOR_X;
  scene.projPrevY = ANCHOR_Y;
  scene.projAngle = 0;
  scene.projPrevAngle = 0;
  scene.trailCount = 0;
  scene.trailHead = 0;
  scene.projSlowMs = 0;
}

function parkProjectile(scene: Scene): void {
  const { projectile, vec } = scene.physics;
  vec.x = 0;
  vec.y = 0;
  projectile.setLinvel(vec, false);
  projectile.setAngvel(0, false);
  vec.x = PARK_X;
  vec.y = PARK_Y;
  projectile.setTranslation(vec, false);
  projectile.setEnabled(false);
  scene.projActive = false;
}

/* ------------------------------------------------------------------ */
/* Efectos                                                             */
/* ------------------------------------------------------------------ */

function burst(scene: Scene, ctx: BaseContext, x: number, y: number, tone: number): void {
  const count = ctx.reducedMotion ? BURST_CALM : BURST_FULL;
  for (let i = 0; i < count; i++) {
    scene.particles.spawn((particle) => {
      const angle = ctx.rng.range(0, TAU);
      const speed = ctx.rng.range(90, 340);
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed - 90;
      particle.maxLife = ctx.rng.range(0.35, 0.85);
      particle.life = particle.maxLife;
      particle.size = ctx.rng.range(3, 8);
      particle.tone = tone;
    });
  }
}

function shake(scene: Scene, ctx: BaseContext, amount: number): void {
  if (ctx.reducedMotion) return;
  scene.shakeAmp = Math.min(14, Math.max(scene.shakeAmp, amount));
  scene.shakeMs = Math.max(scene.shakeMs, 180);
}

function destroyPiece(scene: Scene, ctx: BaseContext, piece: Piece, scored: boolean): void {
  if (piece.body) scene.physics.world.removeRigidBody(piece.body);
  piece.body = null;
  piece.alive = false;
  // Rapier recicla los handles: dejarlo en el mapa haria que el proximo cuerpo
  // le cargue el dano a una pieza que ya no existe.
  scene.byCollider.delete(piece.collider);
  if (!scored) return;

  if (piece.kind === 1) {
    registerTargetDown(scene.run);
    ctx.sfx.play("win");
    vibrate([18, 30, 18]);
    burst(scene, ctx, piece.x, piece.y, 2);
    shake(scene, ctx, 10);
  } else {
    registerBlockDown(scene.run);
    ctx.sfx.play("hit");
    vibrate(14);
    burst(scene, ctx, piece.x, piece.y, piece.stone ? 1 : 0);
    shake(scene, ctx, piece.stone ? 8 : 5);
  }
  scene.hudDirty = true;
}

/* ------------------------------------------------------------------ */
/* Componente                                                          */
/* ------------------------------------------------------------------ */

export default function CatapultaGame({ config, net, signal, onFinish, onReady }: GameProps) {
  const [api, setApi] = useState<RapierModule | null>(null);
  const [failed, setFailed] = useState(false);
  // El aviso de "ya se puede sacar el loader" no puede estar en las
  // dependencias del efecto: si el padre lo recrea, el motor se recargaria.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // `RAPIER.init()` es asincrono y `useGame2D.init` no. Se carga el motor antes
  // de montar el escenario, con un import dinamico para que el WASM no entre en
  // el bundle inicial ni bloquee el primer render.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("@dimforge/rapier2d-compat");
        await mod.init();
        if (cancelled) return;
        setApi(mod);
        onReadyRef.current?.();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!api) {
    return (
      <div className="grid h-full w-full place-items-center rounded-sn-lg border border-sn-line-soft bg-sn-bg">
        <p className="text-sm text-sn-muted">
          {failed ? "No se pudo cargar el motor de física." : "Cargando el motor de física…"}
        </p>
      </div>
    );
  }

  return <CatapultaStage api={api} config={config} net={net} signal={signal} onFinish={onFinish} />;
}

function CatapultaStage({ api, config, signal, onFinish }: GameProps & { api: RapierModule }) {
  const options = useMemo(() => {
    const rules = rulesFromSettings(config.settings);
    return { rules, levels: resolveLevels(config.settings) };
  }, [config.settings]);

  // El mundo de Rapier vive fuera de React: hay que soltarlo a mano al
  // remontar y al desmontar.
  const physicsRef = useRef<Physics | null>(null);
  useEffect(
    () => () => {
      physicsRef.current?.dispose();
      physicsRef.current = null;
    },
    [],
  );

  const game = useGame2D<Scene, CatapultHud>(
    {
      design: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      step: FIXED_STEP,
      countdown: 0,
      hud: { points: 0, level: "1/1", shots: 0, targets: 0, status: STATUS_AIM },

      init: (ctx) => {
        // Reiniciar remonta la escena sin desmontar el componente: el mundo
        // anterior se libera aca o queda colgado en memoria WASM.
        physicsRef.current?.dispose();

        const { rules } = options;
        const plans = buildRunPlans(options.levels, rules, ctx.rng);
        const physics = createPhysics(api, rules.gravity);
        physicsRef.current = physics;

        const palette = ctx.palette;
        const sky = ctx.view.ctx.createLinearGradient(0, 0, 0, GROUND_Y);
        sky.addColorStop(0, palette["--sn-bg-elev"]);
        sky.addColorStop(1, palette["--sn-bg"]);

        const wood = palette["--sn-violet-400"];
        const stone = palette["--sn-violet-600"];
        const target = palette["--sn-cyan-400"];
        const colors: Colors = {
          sky,
          ground: palette["--sn-panel"],
          groundEdge: palette["--sn-line"],
          horizon: withAlpha(palette["--sn-violet-500"], 0.22),
          frame: palette["--sn-line"],
          frameHi: palette["--sn-panel-hi"],
          band: palette["--sn-magenta-500"],
          ball: palette["--sn-magenta-400"],
          trail: palette["--sn-magenta-300"],
          preview: palette["--sn-cyan-300"],
          target,
          targetGlow: withAlpha(palette["--sn-cyan-300"], 0.3),
          wood,
          woodEdge: mixHex(wood, palette["--sn-bg"], 0.45),
          stone,
          stoneEdge: mixHex(stone, palette["--sn-bg"], 0.45),
          bg: palette["--sn-bg"],
          flash: palette["--sn-text"],
          text: palette["--sn-text"],
          dim: palette["--sn-text-dim"],
          success: palette["--sn-success"],
          danger: palette["--sn-danger"],
          tones: [wood, stone, target],
        };

        const pieces: Piece[] = new Array(MAX_PIECES);
        for (let i = 0; i < MAX_PIECES; i++) {
          pieces[i] = {
            alive: false,
            body: null,
            kind: 0,
            stone: false,
            hp: 0,
            maxHp: 1,
            w: 0,
            h: 0,
            grain: 0,
            collider: -1,
            x: 0,
            y: 0,
            angle: 0,
            prevX: 0,
            prevY: 0,
            prevAngle: 0,
            flashMs: 0,
          };
        }

        const scene: Scene = {
          run: createRun(plans, rules),
          physics,
          pieces,
          particles: createPool<Particle>(MAX_PARTICLES, () => ({
            alive: false,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            life: 0,
            maxLife: 1,
            size: 4,
            tone: 0,
          })),
          colors,
          rules,
          aim: createAim(),
          preview: { x: 0, y: 0 },
          dragging: false,
          dragX: 0,
          dragY: 0,
          projActive: false,
          projX: ANCHOR_X,
          projY: ANCHOR_Y,
          projAngle: 0,
          projPrevX: ANCHOR_X,
          projPrevY: ANCHOR_Y,
          projPrevAngle: 0,
          projSlowMs: 0,
          byCollider: new Map<number, Piece>(),
          onContactForce: () => {},
          levelShots: 0,
          trailX: new Float32Array(TRAIL_POINTS),
          trailY: new Float32Array(TRAIL_POINTS),
          trailCount: 0,
          trailHead: 0,
          shakeMs: 0,
          shakeAmp: 0,
          shakeX: 0,
          shakeY: 0,
          reviewMs: 0,
          bannerMs: 0,
          bannerText: "",
          bannerTone: 0,
          hitCooldownMs: 0,
          status: STATUS_AIM,
          hudDirty: true,
          pulse: 0,
        };

        scene.onContactForce = makeForceHandler(scene, ctx);

        const plan = currentLevel(scene.run);
        if (plan) buildLevel(scene, api, plan);
        return scene;
      },

      update: (scene, dt, ctx) => {
        const dtMs = dt * 1000;
        const { run, physics } = scene;
        scene.pulse += dt;

        // Exactamente un paso de Rapier por paso del loop, siempre, en todas
        // las fases: es lo unico que mantiene la simulacion determinista.
        physics.world.step(physics.events);
        physics.events.drainContactForceEvents(scene.onContactForce);

        readBodies(scene, ctx, dtMs);
        updateParticles(scene, dt);

        if (scene.shakeMs > 0) {
          scene.shakeMs -= dtMs;
          const fade = Math.max(0, scene.shakeMs) / 180;
          scene.shakeX = ctx.rng.range(-1, 1) * scene.shakeAmp * fade;
          scene.shakeY = ctx.rng.range(-1, 1) * scene.shakeAmp * fade;
        } else {
          scene.shakeX = 0;
          scene.shakeY = 0;
        }
        if (scene.bannerMs > 0) scene.bannerMs -= dtMs;
        if (scene.hitCooldownMs > 0) scene.hitCooldownMs -= dtMs;

        if (run.phase === "aiming") {
          handleAim(scene, ctx);
        } else if (run.phase === "resolving") {
          if (tickTurn(run, dtMs, worldQuiet(scene))) {
            parkProjectile(scene);
            const result = endTurn(run);
            if (result === "cleared") {
              scene.bannerText = STATUS_CLEAR;
              scene.bannerTone = 1;
              scene.bannerMs = REVIEW_MS;
              scene.reviewMs = 0;
              ctx.sfx.play("win");
              vibrate([20, 40, 20, 40]);
            } else if (result === "failed") {
              scene.bannerText = STATUS_FAIL;
              scene.bannerTone = 2;
              scene.bannerMs = REVIEW_MS;
              scene.reviewMs = 0;
              ctx.sfx.play("lose");
              vibrate([40, 60]);
            }
            scene.hudDirty = true;
          }
        } else if (run.phase === "review") {
          scene.reviewMs += dtMs;
          if (scene.reviewMs >= (ctx.reducedMotion ? 600 : REVIEW_MS)) {
            scene.reviewMs = 0;
            if (nextLevel(run)) {
              const plan = currentLevel(run);
              if (plan) buildLevel(scene, api, plan);
              ctx.sfx.play("select");
            }
            scene.hudDirty = true;
          }
        }

        if (run.phase === "done") {
          ctx.finish(true);
          return;
        }

        publishHud(scene, ctx);
      },

      draw: drawScene,

      outcome: (scene, completed, _survivedMs) => ({
        completed: completed && scene.run.phase === "done",
        points: runPoints(scene.run),
        meta: runMeta(scene.run),
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
      aspect={WORLD_WIDTH / WORLD_HEIGHT}
      {...(config.debug ? { fps: game.fps } : {})}
      instructions="Arrastrá hacia atrás para tensar la banda y soltá para disparar. Tres tiros por nivel, y los que no usás suman."
      hud={
        <>
          <HudStat label="Puntos" value={game.hud.points} dominant tone="cyan" />
          <HudStat label="Nivel" value={game.hud.level} />
          <HudStat label="Tiros" value={game.hud.shots} tone={game.hud.shots === 0 ? "danger" : "magenta"} />
          <HudStat label="Objetivos" value={game.hud.targets} />
          <HudStat label="Estado" value={game.hud.status} />
          {game.timeLeftMs !== null && (
            <HudStat
              label="Tiempo"
              value={formatClock(game.timeLeftMs)}
              tone={game.timeLeftMs < 15000 ? "danger" : "default"}
            />
          )}
        </>
      }
      summary={
        <>
          <h3 className="mb-1 text-lg">Se terminó</h3>
          <p className="text-sm text-sn-muted">
            Superaste <span className="sn-num text-sn-cyan">{game.hud.level}</span> niveles con{" "}
            <span className="sn-num text-sn-magenta">{game.hud.points}</span> puntos.
          </p>
          <p className="mt-1 text-xs text-sn-dim">
            El bono por tiros sin usar es donde está el puntaje: resolvé de un tiro.
          </p>
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

/**
 * Lee de Rapier lo que hace falta para dibujar y para decidir dano, sin crear
 * un objeto por cuerpo y por frame: los vectores de scratch se reusan.
 */
function readBodies(scene: Scene, ctx: BaseContext, dtMs: number): void {
  const { physics, run } = scene;
  const { vec, vec2 } = physics;
  // El dano solo cuenta mientras se resuelve un tiro. Asi el asentado inicial
  // del nivel, que pasa mientras el jugador apunta, no rompe nada solo.
  const scoring = run.phase === "resolving";

  for (let i = 0; i < scene.pieces.length; i++) {
    const piece = scene.pieces[i];
    if (!piece || !piece.alive || !piece.body) continue;
    const body = piece.body;

    piece.prevX = piece.x;
    piece.prevY = piece.y;
    piece.prevAngle = piece.angle;
    body.translation(vec);
    piece.x = vec.x;
    piece.y = vec.y;
    piece.angle = body.rotation();
    if (piece.flashMs > 0) piece.flashMs -= dtMs;

    // El dano ya lo resto `onContactForce`; aca solo se cobra el resultado,
    // porque sacar un cuerpo del mundo mientras se drenan sus eventos no.
    if (scoring && piece.hp <= 0) {
      destroyPiece(scene, ctx, piece, true);
      continue;
    }

    if (
      piece.y > WORLD_HEIGHT + OUT_MARGIN ||
      piece.x < -OUT_MARGIN ||
      piece.x > WORLD_WIDTH + OUT_MARGIN
    ) {
      // Un cuerpo cayendo al infinito sigue costando: se retira, y si era un
      // objetivo cuenta igual porque ya no esta en pie.
      destroyPiece(scene, ctx, piece, scoring);
    }
  }

  if (!scene.projActive) return;
  const { projectile } = physics;
  scene.projPrevX = scene.projX;
  scene.projPrevY = scene.projY;
  scene.projPrevAngle = scene.projAngle;
  projectile.translation(vec);
  // Una bola rodando por el suelo tarda muchisimo en dormirse y es la razon
  // numero uno de que un turno llegue al tope de espera. Gastada, se guarda.
  projectile.linvel(vec2);
  scene.projSlowMs =
    Math.sqrt(vec2.x * vec2.x + vec2.y * vec2.y) < SPENT_SPEED ? scene.projSlowMs + dtMs : 0;
  scene.projX = vec.x;
  scene.projY = vec.y;
  scene.projAngle = projectile.rotation();

  scene.trailX[scene.trailHead] = scene.projX;
  scene.trailY[scene.trailHead] = scene.projY;
  scene.trailHead = (scene.trailHead + 1) % TRAIL_POINTS;
  if (scene.trailCount < TRAIL_POINTS) scene.trailCount++;

  if (
    scene.projY > WORLD_HEIGHT + OUT_MARGIN ||
    scene.projX < -OUT_MARGIN ||
    scene.projX > WORLD_WIDTH + OUT_MARGIN ||
    scene.projSlowMs > SPENT_MS
  ) {
    parkProjectile(scene);
  }
}

function updateParticles(scene: Scene, dt: number): void {
  const gravity = scene.rules.gravity * 0.55;
  scene.particles.each((particle) => {
    particle.life -= dt;
    if (particle.life <= 0) {
      scene.particles.release(particle);
      return;
    }
    particle.vy += gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  });
}

/** El mundo se aquieto cuando no queda nada despierto que pueda cambiar el turno. */
function worldQuiet(scene: Scene): boolean {
  if (scene.projActive && !scene.physics.projectile.isSleeping()) return false;
  for (let i = 0; i < scene.pieces.length; i++) {
    const piece = scene.pieces[i];
    if (!piece || !piece.alive || !piece.body) continue;
    // Rapier duerme los cuerpos quietos solo: hay que dejarlo, no despertarlos.
    if (!piece.body.isSleeping()) return false;
  }
  return true;
}

function handleAim(scene: Scene, ctx: BaseContext): void {
  const pointer = ctx.input.pointer;

  if (pointer.justPressed) {
    scene.dragging = true;
    scene.dragX = pointer.x;
    scene.dragY = pointer.y;
  }
  if (!scene.dragging) return;

  // El arrastre es relativo a donde se apreto, no a la honda: en un proyector o
  // en un celular chico exigir agarrar la bolsa exacta hace fallar el gesto.
  aimFromDrag(
    scene.dragX - pointer.x,
    scene.dragY - pointer.y,
    MAX_DRAG,
    scene.rules.maxLaunchSpeed,
    scene.aim,
  );

  if (pointer.justReleased) {
    scene.dragging = false;
    if (scene.aim.power > 0 && fireShot(scene.run)) {
      fireProjectile(scene);
      ctx.sfx.play("pick");
      vibrate(20);
      scene.hudDirty = true;
    }
    scene.aim.power = 0;
  } else if (!pointer.down) {
    // Perder el foco con el dedo apoyado dejaba la banda tensada para siempre.
    scene.dragging = false;
    scene.aim.power = 0;
  }
}

function statusOf(scene: Scene): string {
  const { run } = scene;
  if (run.phase === "resolving") {
    return run.turnMs > SETTLING_HINT_MS ? STATUS_SETTLE : STATUS_FLY;
  }
  if (run.phase === "review") return run.lastLevelCleared ? STATUS_CLEAR : STATUS_FAIL;
  return STATUS_AIM;
}

/**
 * Solo publica al HUD cuando algo cambio de verdad. Armar el objeto del parche
 * por frame seria una asignacion por frame para pintar los mismos numeros.
 */
function publishHud(scene: Scene, ctx: { setHud: (patch: Partial<CatapultHud>) => void }): void {
  const status = statusOf(scene);
  if (status !== scene.status) {
    scene.status = status;
    scene.hudDirty = true;
  }
  if (!scene.hudDirty) return;
  scene.hudDirty = false;

  const { run } = scene;
  ctx.setHud({
    points: runPoints(run),
    level: Math.min(run.levelIndex + 1, run.plans.length) + "/" + run.plans.length,
    shots: run.shotsLeft,
    targets: run.targetsLeft,
    status,
  });
}

/* ------------------------------------------------------------------ */
/* Draw                                                                */
/* ------------------------------------------------------------------ */

/** Lerp que no se vuelve loco cuando el angulo cruza de pi a -pi. */
function lerpAngle(prev: number, next: number, alpha: number): number {
  return Math.abs(next - prev) > Math.PI ? next : prev + (next - prev) * alpha;
}

function drawScene(
  scene: Scene,
  g: CanvasRenderingContext2D,
  ctx: { alpha: number; reducedMotion: boolean },
): void {
  const { colors, run } = scene;
  const alpha = ctx.alpha;

  g.fillStyle = colors.sky;
  g.fillRect(0, 0, WORLD_WIDTH, GROUND_Y);

  g.save();
  g.translate(scene.shakeX, scene.shakeY);

  // Suelo y linea de horizonte. Sin parallax: distrae de la trayectoria.
  g.fillStyle = colors.ground;
  g.fillRect(-40, GROUND_Y, WORLD_WIDTH + 80, WORLD_HEIGHT - GROUND_Y + 40);
  g.strokeStyle = colors.groundEdge;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(-40, GROUND_Y);
  g.lineTo(WORLD_WIDTH + 40, GROUND_Y);
  g.stroke();

  g.strokeStyle = colors.horizon;
  g.lineWidth = 2;
  g.beginPath();
  for (let x = 40; x < WORLD_WIDTH; x += 80) {
    g.moveTo(x, GROUND_Y + 16);
    g.lineTo(x + 34, GROUND_Y + 16);
  }
  g.stroke();

  drawCatapult(scene, g);
  drawPreview(scene, g);
  drawPieces(scene, g, alpha, ctx.reducedMotion);
  drawProjectile(scene, g, alpha, ctx.reducedMotion);
  drawParticles(scene, g);
  drawShotsLeft(scene, g);

  g.restore();

  if (scene.bannerMs > 0) {
    const fade = Math.min(1, scene.bannerMs / 420);
    g.globalAlpha = fade;
    g.font = FONT_BANNER;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle =
      scene.bannerTone === 1 ? colors.success : scene.bannerTone === 2 ? colors.danger : colors.text;
    g.fillText(scene.bannerText, WORLD_WIDTH / 2, 150);
    g.globalAlpha = 1;
  }

  if (run.phase === "resolving" && run.turnMs > SETTLING_HINT_MS) {
    g.globalAlpha = 0.55 + (ctx.reducedMotion ? 0 : Math.sin(scene.pulse * 5) * 0.2);
    g.font = FONT_HINT;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = colors.dim;
    g.fillText("Esperando que se asiente…", WORLD_WIDTH / 2, 92);
    g.globalAlpha = 1;
  }
}

function drawCatapult(scene: Scene, g: CanvasRenderingContext2D): void {
  const { colors, aim } = scene;
  const stretched = scene.dragging && aim.power > 0;
  const pouchX = stretched ? ANCHOR_X - aim.pullX * POUCH_SCALE : ANCHOR_X;
  const pouchY = stretched ? ANCHOR_Y - aim.pullY * POUCH_SCALE : ANCHOR_Y;

  g.strokeStyle = colors.frame;
  g.lineCap = "round";
  g.lineWidth = 16;
  g.beginPath();
  g.moveTo(ANCHOR_X, GROUND_Y);
  g.lineTo(ANCHOR_X, ANCHOR_Y + 52);
  g.moveTo(ANCHOR_X, ANCHOR_Y + 52);
  g.lineTo(ANCHOR_X - 30, ANCHOR_Y);
  g.moveTo(ANCHOR_X, ANCHOR_Y + 52);
  g.lineTo(ANCHOR_X + 30, ANCHOR_Y);
  g.stroke();

  g.strokeStyle = colors.band;
  g.lineWidth = stretched ? 9 : 6;
  g.beginPath();
  g.moveTo(ANCHOR_X - 30, ANCHOR_Y);
  g.lineTo(pouchX, pouchY);
  g.lineTo(ANCHOR_X + 30, ANCHOR_Y);
  g.stroke();

  // La bola espera en la bolsa cuando queda tiro: se ve que hay con que tirar.
  if (!scene.projActive && scene.run.shotsLeft > 0 && scene.run.phase === "aiming") {
    g.fillStyle = colors.ball;
    g.beginPath();
    g.arc(pouchX, pouchY, PROJECTILE_RADIUS, 0, TAU);
    g.fill();
  }
}

function drawPreview(scene: Scene, g: CanvasRenderingContext2D): void {
  if (!scene.dragging || scene.aim.power <= 0) return;
  const { aim, colors, preview } = scene;
  const startX = ANCHOR_X - aim.pullX * POUCH_SCALE;
  const startY = ANCHOR_Y - aim.pullY * POUCH_SCALE;

  g.fillStyle = colors.preview;
  for (let i = 1; i <= PREVIEW_STEPS; i++) {
    const t = (i / PREVIEW_STEPS) * PREVIEW_SPAN_S;
    trajectoryPoint(startX, startY, aim.vx, aim.vy, scene.rules.gravity, t, preview);
    if (preview.y > GROUND_Y) break;
    g.globalAlpha = 0.85 - (i / PREVIEW_STEPS) * 0.65;
    g.beginPath();
    g.arc(preview.x, preview.y, 5, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;

  // Medidor de fuerza pegado a la honda: leer la potencia sin mirar el HUD.
  g.globalAlpha = 0.9;
  g.fillStyle = colors.frameHi;
  g.fillRect(ANCHOR_X - 60, GROUND_Y + 28, 120, 12);
  g.fillStyle = colors.band;
  g.fillRect(ANCHOR_X - 60, GROUND_Y + 28, 120 * aim.power, 12);
  g.globalAlpha = 1;
}

function drawPieces(
  scene: Scene,
  g: CanvasRenderingContext2D,
  alpha: number,
  reducedMotion: boolean,
): void {
  const { colors } = scene;
  const pulse = reducedMotion ? 0 : Math.sin(scene.pulse * 3.2) * 0.5 + 0.5;

  for (let i = 0; i < scene.pieces.length; i++) {
    const piece = scene.pieces[i];
    if (!piece || !piece.alive) continue;

    const x = piece.prevX + (piece.x - piece.prevX) * alpha;
    const y = piece.prevY + (piece.y - piece.prevY) * alpha;
    const angle = lerpAngle(piece.prevAngle, piece.angle, alpha);
    const hw = piece.w / 2;
    const hh = piece.h / 2;

    g.save();
    g.translate(x, y);
    g.rotate(angle);

    if (piece.kind === 1) {
      g.globalAlpha = 0.25 + pulse * 0.35;
      g.fillStyle = colors.targetGlow;
      g.beginPath();
      g.roundRect(-hw - 9, -hh - 9, piece.w + 18, piece.h + 18, 12);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = colors.target;
      g.beginPath();
      g.roundRect(-hw, -hh, piece.w, piece.h, 8);
      g.fill();
      g.fillStyle = colors.bg;
      g.globalAlpha = 0.35;
      g.beginPath();
      g.arc(0, 0, hw * 0.42, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    } else {
      g.fillStyle = piece.stone ? colors.stone : colors.wood;
      g.beginPath();
      g.roundRect(-hw, -hh, piece.w, piece.h, 5);
      g.fill();
      // Una veta por pieza, con posicion sembrada: da textura sin costar nada.
      g.strokeStyle = piece.stone ? colors.stoneEdge : colors.woodEdge;
      g.lineWidth = 3;
      g.beginPath();
      if (piece.h > piece.w) {
        const gy = -hh + piece.h * (0.25 + piece.grain * 0.5);
        g.moveTo(-hw + 4, gy);
        g.lineTo(hw - 4, gy);
      } else {
        const gx = -hw + piece.w * (0.25 + piece.grain * 0.5);
        g.moveTo(gx, -hh + 4);
        g.lineTo(gx, hh - 4);
      }
      g.stroke();
      // Cuanto mas dano acumulado, mas oscura: el estado se ve antes de romper.
      const wear = 1 - Math.max(0, piece.hp) / piece.maxHp;
      if (wear > 0.02) {
        g.globalAlpha = wear * 0.5;
        g.fillStyle = colors.stoneEdge;
        g.beginPath();
        g.roundRect(-hw, -hh, piece.w, piece.h, 5);
        g.fill();
        g.globalAlpha = 1;
      }
    }

    if (piece.flashMs > 0 && !reducedMotion) {
      g.globalAlpha = (piece.flashMs / 150) * 0.55;
      g.fillStyle = colors.flash;
      g.beginPath();
      g.roundRect(-hw, -hh, piece.w, piece.h, 6);
      g.fill();
      g.globalAlpha = 1;
    }

    g.restore();
  }
}

function drawProjectile(
  scene: Scene,
  g: CanvasRenderingContext2D,
  alpha: number,
  reducedMotion: boolean,
): void {
  if (!scene.projActive) return;
  const { colors } = scene;

  if (!reducedMotion && scene.trailCount > 1) {
    g.strokeStyle = colors.trail;
    g.lineWidth = 5;
    g.lineCap = "round";
    for (let i = 1; i < scene.trailCount; i++) {
      const a = (scene.trailHead - scene.trailCount + i + TRAIL_POINTS * 2) % TRAIL_POINTS;
      const b = (a + 1) % TRAIL_POINTS;
      g.globalAlpha = (i / scene.trailCount) * 0.45;
      g.beginPath();
      g.moveTo(scene.trailX[a] ?? 0, scene.trailY[a] ?? 0);
      g.lineTo(scene.trailX[b] ?? 0, scene.trailY[b] ?? 0);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  const x = scene.projPrevX + (scene.projX - scene.projPrevX) * alpha;
  const y = scene.projPrevY + (scene.projY - scene.projPrevY) * alpha;
  const angle = lerpAngle(scene.projPrevAngle, scene.projAngle, alpha);

  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = colors.ball;
  g.beginPath();
  g.arc(0, 0, PROJECTILE_RADIUS, 0, TAU);
  g.fill();
  g.strokeStyle = colors.trail;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(-PROJECTILE_RADIUS * 0.55, 0);
  g.lineTo(PROJECTILE_RADIUS * 0.55, 0);
  g.stroke();
  g.restore();
}

function drawParticles(scene: Scene, g: CanvasRenderingContext2D): void {
  const { colors } = scene;
  scene.particles.each((particle) => {
    g.globalAlpha = Math.min(1, particle.life / particle.maxLife);
    g.fillStyle = colors.tones[particle.tone] ?? colors.wood;
    g.beginPath();
    g.arc(particle.x, particle.y, particle.size, 0, TAU);
    g.fill();
  });
  g.globalAlpha = 1;
}

function drawShotsLeft(scene: Scene, g: CanvasRenderingContext2D): void {
  const left = scene.run.shotsLeft;
  g.fillStyle = scene.colors.ball;
  for (let i = 0; i < left; i++) {
    g.beginPath();
    g.arc(96 + i * 34, GROUND_Y + 34, 11, 0, TAU);
    g.fill();
  }
  g.strokeStyle = scene.colors.groundEdge;
  g.lineWidth = 2;
  for (let i = left; i < scene.levelShots; i++) {
    g.beginPath();
    g.arc(96 + i * 34, GROUND_Y + 34, 11, 0, TAU);
    g.stroke();
  }
}
