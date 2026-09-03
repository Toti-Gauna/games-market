import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "@/core/contract/game";
import { vibrate } from "@/core/engine/audio";
import { lerp } from "@/core/engine/collide";
import { withAlpha } from "@/core/engine/palette";
import { createPool, type Pool } from "@/core/engine/pool";
import { useGame2D, type Game2DDefinition } from "@/core/engine/useGame2D";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  calibrateTilt,
  climbToMeters,
  createJumperWorld,
  jumperPoints,
  pushTiltSample,
  stepJumper,
  tiltAxis,
  tuningFromSettings,
  KIND_BOOST,
  KIND_FRAGILE,
  KIND_MOVING,
  TILT_SAMPLES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type JumperTuning,
  type JumperWorld,
} from "./logic";

/**
 * Saltarin (M4).
 *
 * El componente es montaje, entrada, dibujo y HUD: la partida entera vive en
 * `logic.ts`. Lo propio de este juego es el control por inclinacion, y la
 * regla que lo ordena todo es que el giroscopio es la forma preferida, no la
 * unica: toque y flechas funcionan siempre, con permiso o sin el.
 */

const STAR_COUNT = 70;
const SPARK_CAPACITY = 60;
const SPARKS_PER_JUMP = 7;
const JITTER_COUNT = 48;
const DEATH_MS = 900;
/** Cada cuanto se publica al HUD. El loop va a 60 Hz, React no tiene por que. */
const HUD_INTERVAL_MS = 250;
/** Marcas de altura cada 1000 px, con etiqueta precalculada. */
const MARK_STEP = 1000;
const MARK_LABELS = 80;

type Star = { x: number; y: number; r: number; near: boolean };

type Spark = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
};

/** Puente entre React y el loop: el boton escribe, el update lee. */
type TiltControl = { enabled: boolean; recenter: boolean };

/** Puente entre el frame y las funciones creadas una sola vez en `init`. */
type FrameHolder = { dt: number; x: number; y: number; jx: number; jy: number; power: number };

type SaltarinState = {
  world: JumperWorld;
  stars: Star[];
  sparks: Pool<Spark>;
  jitter: Float32Array;
  jitterAt: number;
  squash: number;
  hudClock: number;
  frame: FrameHolder;
  control: TiltControl;
  gradient: CanvasGradient;
  markLabels: string[];
  colors: {
    bg: string;
    deep: string;
    starFar: string;
    starNear: string;
    normal: string;
    moving: string;
    fragile: string;
    boost: string;
    edge: string;
    mark: string;
    markText: string;
    spark: string;
    ship: string;
  };
  markFont: string;
  spawnSpark: (p: Spark) => void;
  stepSpark: (p: Spark) => void;
  drawSpark: (p: Spark) => void;
};

type SaltarinHud = { points: number; meters: number; boosts: number; tilt: boolean };

type TiltStatus = "idle" | "granted" | "denied";

/** Modulo que no devuelve negativos: el parallax cruza el cero todo el tiempo. */
function wrap(value: number, span: number): number {
  const rest = value % span;
  return rest < 0 ? rest + span : rest;
}

export default function SaltarinGame({ config, signal, onFinish, onReady }: GameProps) {
  const tuning = useMemo<JumperTuning>(() => tuningFromSettings(config.settings), [config.settings]);

  const [tiltStatus, setTiltStatus] = useState<TiltStatus>("idle");
  const controlRef = useRef<TiltControl>({ enabled: false, recenter: false });
  const hudPush = useRef<(patch: Partial<SaltarinHud>) => void>(() => {});

  const definition = useMemo<Game2DDefinition<SaltarinState, SaltarinHud>>(() => {
    const control = controlRef.current;

    return {
      design: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      step: 1 / 60,
      countdown: 3,
      hud: { points: 0, meters: 0, boosts: 0, tilt: false },

      init: (ctx) => {
        // Orden fijo de consumo del PRNG: primero las plataformas, siempre.
        // Las estrellas se generan aunque el movimiento reducido no las mueva,
        // para que la serie no se corra y el recorrido siga siendo el mismo.
        const world = createJumperWorld(tuning, ctx.rng);

        const stars: Star[] = new Array<Star>(STAR_COUNT);
        for (let i = 0; i < STAR_COUNT; i++) {
          const near = i % 3 === 0;
          stars[i] = {
            x: ctx.rng.range(0, WORLD_WIDTH),
            y: ctx.rng.range(0, WORLD_HEIGHT),
            r: near ? ctx.rng.range(1, 1.8) : ctx.rng.range(0.5, 1.1),
            near,
          };
        }

        const jitter = new Float32Array(JITTER_COUNT);
        for (let i = 0; i < JITTER_COUNT; i++) jitter[i] = ctx.rng.range(-1, 1);

        const sparks = createPool<Spark>(SPARK_CAPACITY, () => ({
          alive: false,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          life: 0,
          max: 1,
        }));

        const g = ctx.view.ctx;
        const frame: FrameHolder = { dt: 0, x: 0, y: 0, jx: 0, jy: 0, power: 1 };

        const gradient = g.createLinearGradient(-18, -20, 18, 20);
        gradient.addColorStop(0, ctx.palette["--sn-violet-400"]);
        gradient.addColorStop(1, ctx.palette["--sn-magenta-400"]);

        // Las etiquetas de las marcas se arman una vez: componer strings por
        // frame es basura para el GC igual que un `new` por particula.
        const markLabels: string[] = new Array<string>(MARK_LABELS);
        for (let i = 0; i < MARK_LABELS; i++) markLabels[i] = `${i * (MARK_STEP / 10)} m`;

        const spawnSpark = (p: Spark) => {
          p.x = frame.x + frame.jx * 14;
          p.y = frame.y;
          p.vx = frame.jx * 150 * frame.power;
          p.vy = frame.jy * 60 + 90 * frame.power;
          p.life = 0.4;
          p.max = 0.4;
        };

        const stepSpark = (p: Spark) => {
          p.life -= frame.dt;
          if (p.life <= 0) {
            sparks.release(p);
            return;
          }
          p.x += p.vx * frame.dt;
          p.y += p.vy * frame.dt;
          p.vy += 380 * frame.dt;
        };

        const drawSpark = (p: Spark) => {
          g.globalAlpha = Math.max(0, p.life / p.max) * 0.8;
          g.fillRect(p.x - 2, p.y - 2, 4, 4);
        };

        return {
          world,
          stars,
          sparks,
          jitter,
          jitterAt: 0,
          squash: 0,
          hudClock: 0,
          frame,
          control,
          gradient,
          markLabels,
          colors: {
            bg: ctx.palette["--sn-bg"],
            deep: ctx.palette["--sn-bg"],
            starFar: withAlpha(ctx.palette["--sn-violet-300"], 0.28),
            starNear: withAlpha(ctx.palette["--sn-cyan-300"], 0.6),
            normal: withAlpha(ctx.palette["--sn-cyan-500"], 0.75),
            moving: ctx.palette["--sn-cyan-300"],
            fragile: withAlpha(ctx.palette["--sn-warn"], 0.7),
            boost: ctx.palette["--sn-magenta-400"],
            edge: withAlpha(ctx.palette["--sn-text"], 0.16),
            mark: withAlpha(ctx.palette["--sn-violet-400"], 0.22),
            markText: withAlpha(ctx.palette["--sn-text-dim"], 0.75),
            spark: ctx.palette["--sn-cyan-300"],
            ship: ctx.palette["--sn-cyan-400"],
          },
          markFont: '600 12px "Space Grotesk", sans-serif',
          spawnSpark,
          stepSpark,
          drawSpark,
        };
      },

      update: (state, dt, ctx) => {
        const world = state.world;
        const frame = state.frame;
        frame.dt = dt;

        /* --- Control: giroscopio si lo hay, toque y flechas siempre ----- */
        let axis = 0;
        const tilt = ctx.input.tilt;
        if (state.control.enabled && tilt) {
          pushTiltSample(world, tilt.gamma);
          // El cero se fija donde el jugador tenga el telefono al empezar, y
          // el boton "Centrar" lo vuelve a fijar a mitad de partida: la gente
          // cambia de postura, se sienta, se recuesta.
          if (state.control.recenter || (!world.tiltReady && world.tiltFilled >= TILT_SAMPLES)) {
            calibrateTilt(world);
            state.control.recenter = false;
            ctx.sfx.play("select");
          }
          axis = tiltAxis(world);
        }
        if (axis === 0) {
          // Fallback: sin permiso, sin sensor o en escritorio el juego se
          // juega igual. Un juego que muere sin giroscopio esta mal hecho.
          if (ctx.input.axis.x !== 0) axis = ctx.input.axis.x;
          else if (ctx.input.pointer.down) {
            axis = ctx.input.pointer.x < WORLD_WIDTH / 2 ? -1 : 1;
          }
        }

        stepJumper(world, dt, axis, ctx.rng);
        const events = world.events;

        if (events.jumped || events.boosted) {
          ctx.sfx.play(events.boosted ? "win" : "tick");
          if (events.boosted) vibrate(18);
          state.squash = ctx.reducedMotion ? 0 : 1;
          if (!ctx.reducedMotion) {
            frame.x = events.x;
            frame.y = events.y;
            frame.power = events.boosted ? 1.6 : 1;
            for (let i = 0; i < SPARKS_PER_JUMP; i++) {
              state.jitterAt = (state.jitterAt + 1) % JITTER_COUNT;
              frame.jx = state.jitter[state.jitterAt] ?? 0;
              frame.jy = state.jitter[(state.jitterAt + 11) % JITTER_COUNT] ?? 0;
              state.sparks.spawn(state.spawnSpark);
            }
          }
        }

        if (events.broke) {
          ctx.sfx.play("hit");
          vibrate(14);
        }

        if (events.died) {
          ctx.sfx.play("lose");
          vibrate([30, 40, 60]);
        }

        if (state.squash > 0) state.squash = Math.max(0, state.squash - dt * 6);
        state.sparks.each(state.stepSpark);

        state.hudClock += dt * 1000;
        if (state.hudClock >= HUD_INTERVAL_MS || events.boosted || events.died) {
          state.hudClock = 0;
          hudPush.current({
            points: jumperPoints(world.maxClimb, world.boosts, tuning),
            meters: climbToMeters(world.maxClimb),
            boosts: world.boosts,
            tilt: state.control.enabled && world.tiltReady,
          });
        }

        // La caida se ve entera antes de cerrar: el jugador entiende por que
        // perdio, y ver caer al de al lado es parte de la gracia.
        if (world.dead && world.deathMs >= (ctx.reducedMotion ? 120 : DEATH_MS)) {
          ctx.finish(true);
        }
      },

      draw: (state, g, ctx) => {
        const world = state.world;
        const colors = state.colors;
        const camera = lerp(world.cameraPrevY, world.cameraY, ctx.alpha);

        g.fillStyle = colors.bg;
        g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

        // Cuanto mas alto, mas oscuro. Sin componer colores: alpha sobre el
        // mismo fondo, que no asigna un string por frame.
        const depth = Math.min(0.55, world.maxClimb / 12000);
        if (depth > 0) {
          g.globalAlpha = depth;
          g.fillStyle = colors.deep;
          g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
          g.globalAlpha = 1;
        }

        /* --- Fondo: dos capas de parallax vertical --------------------- */
        // Con movimiento reducido las estrellas quedan quietas, no desaparecen:
        // sacar el parallax no es lo mismo que apagar el fondo.
        for (let i = 0; i < state.stars.length; i++) {
          const star = state.stars[i];
          if (!star) continue;
          const drift = ctx.reducedMotion ? 0 : camera * (star.near ? 0.35 : 0.12);
          const y = wrap(star.y - drift, WORLD_HEIGHT);
          g.fillStyle = star.near ? colors.starNear : colors.starFar;
          g.fillRect(star.x, y, star.r * 2, star.r * 2);
        }

        g.save();
        g.translate(0, -camera);

        /* --- Marcas de altura ------------------------------------------ */
        g.font = state.markFont;
        g.textAlign = "left";
        g.textBaseline = "bottom";
        const topWorld = camera;
        const bottomWorld = camera + WORLD_HEIGHT;
        const firstMark = Math.max(1, Math.floor((world.startY - bottomWorld) / MARK_STEP));
        const lastMark = Math.floor((world.startY - topWorld) / MARK_STEP);
        for (let k = firstMark; k <= lastMark; k++) {
          const y = world.startY - k * MARK_STEP;
          g.fillStyle = colors.mark;
          g.fillRect(0, y, WORLD_WIDTH, 1);
          g.fillStyle = colors.markText;
          g.fillText(state.markLabels[k] ?? "", 10, y - 4);
        }

        /* --- Plataformas ----------------------------------------------- */
        const pw = world.tuning.platformWidth;
        const ph = world.tuning.platformHeight;
        const pulse = ctx.reducedMotion ? 0 : Math.sin(ctx.elapsedMs / 180) * 0.5 + 0.5;
        for (let i = 0; i < world.platforms.length; i++) {
          const plat = world.platforms[i];
          if (!plat) continue;
          if (plat.y < topWorld - ph || plat.y > bottomWorld + ph) continue;
          const x = lerp(plat.px, plat.x, ctx.alpha);

          if (plat.broken) {
            // La rota se apaga en vez de desaparecer: sin eso parece un bug.
            g.globalAlpha = Math.max(0, 1 - plat.breakMs / 260);
            g.fillStyle = colors.fragile;
            g.beginPath();
            g.roundRect(x, plat.y, pw / 2 - 3, ph, 5);
            g.roundRect(x + pw / 2 + 3, plat.y, pw / 2 - 3, ph, 5);
            g.fill();
            g.globalAlpha = 1;
            continue;
          }

          if (plat.kind === KIND_BOOST) g.fillStyle = colors.boost;
          else if (plat.kind === KIND_MOVING) g.fillStyle = colors.moving;
          else if (plat.kind === KIND_FRAGILE) g.fillStyle = colors.fragile;
          else g.fillStyle = colors.normal;

          if (plat.kind === KIND_BOOST) g.globalAlpha = 0.7 + pulse * 0.3;
          g.beginPath();
          g.roundRect(x, plat.y, pw, ph, 6);
          g.fill();
          g.globalAlpha = 1;

          if (plat.kind === KIND_FRAGILE) {
            // Agrietada: la amenaza tiene que leerse antes de pisarla.
            g.fillStyle = colors.bg;
            g.fillRect(x + pw * 0.32, plat.y, 2, ph);
            g.fillRect(x + pw * 0.62, plat.y, 2, ph);
          } else if (plat.kind === KIND_MOVING) {
            g.fillStyle = colors.edge;
            g.fillRect(x + 6, plat.y + 2, pw - 12, 2);
          } else if (plat.kind === KIND_BOOST) {
            g.fillStyle = colors.bg;
            g.fillRect(x + pw / 2 - 8, plat.y + 5, 16, 3);
          }
        }

        /* --- Particulas ------------------------------------------------ */
        g.fillStyle = colors.spark;
        state.sparks.each(state.drawSpark);
        g.globalAlpha = 1;

        /* --- La nave ---------------------------------------------------- */
        const shipX = lerp(world.px, world.x, ctx.alpha);
        const shipY = lerp(world.py, world.y, ctx.alpha);
        const r = world.tuning.playerRadius;
        // Se inclina hacia donde se mueve: sin esto no se lee la direccion.
        const tiltAngle = (world.vx / Math.max(1, world.tuning.maxSpeedX)) * 0.38;

        for (let pass = 0; pass < 2; pass++) {
          // Segunda pasada corrida un mundo: con el wrap horizontal la nave
          // tiene que verse entrando por un lado mientras sale por el otro.
          const offset = pass === 0 ? 0 : shipX < WORLD_WIDTH / 2 ? WORLD_WIDTH : -WORLD_WIDTH;
          if (pass === 1 && shipX > r && shipX < WORLD_WIDTH - r) break;

          g.save();
          g.translate(shipX + offset, shipY);
          g.rotate(tiltAngle);
          if (state.squash > 0) g.scale(1 + state.squash * 0.22, 1 - state.squash * 0.22);
          g.beginPath();
          g.moveTo(0, -r);
          g.lineTo(r * 0.92, r * 0.72);
          g.lineTo(0, r * 0.36);
          g.lineTo(-r * 0.92, r * 0.72);
          g.closePath();
          g.fillStyle = state.gradient;
          g.fill();
          g.strokeStyle = colors.ship;
          g.lineWidth = 1.5;
          g.stroke();
          g.restore();
        }

        g.restore();
      },

      outcome: (state, completed) => {
        const world = state.world;
        return {
          points: jumperPoints(world.maxClimb, world.boosts, tuning),
          completed,
          meta: {
            alturaPx: Math.round(world.maxClimb),
            alturaM: climbToMeters(world.maxClimb),
            impulsos: world.boosts,
            rebotes: world.landings,
            rotas: world.breaks,
            control: state.control.enabled && world.tiltReady ? "giroscopio" : "toque",
            causa: world.dead ? "caida" : completed ? "tiempo" : "forzado",
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

  const enableTilt = useCallback(async () => {
    // iOS solo concede el permiso desde un gesto del usuario, nunca al montar:
    // por eso el pedido vive en este boton y no en un efecto.
    const granted = await api.requestTilt();
    controlRef.current.enabled = granted;
    setTiltStatus(granted ? "granted" : "denied");
  }, [api]);

  const recenter = useCallback(() => {
    controlRef.current.recenter = true;
  }, []);

  const { phase, requestTilt } = api;
  useEffect(() => {
    if (tiltStatus !== "granted" || phase === "intro") return;
    // Al reiniciar, `useGame2D` arma un InputController nuevo y el listener de
    // orientacion se pierde con el viejo. El permiso ya esta concedido, asi
    // que volver a engancharlo no vuelve a preguntar nada.
    void requestTilt();
  }, [tiltStatus, phase, requestTilt]);

  const { hud, timeLeftMs } = api;

  return (
    <div className="relative h-full w-full">
      <GameStage
        containerRef={api.containerRef}
        canvasRef={api.canvasRef}
        phase={api.phase}
        countdownLeft={api.countdownLeft}
        instructions="Inclíná el teléfono para moverte. Subí saltando y no te caigas."
        aspect={WORLD_WIDTH / WORLD_HEIGHT}
        {...(config.debug ? { fps: api.fps } : {})}
        muted={api.muted}
        onToggleMuted={api.toggleMuted}
        onStart={api.start}
        onResume={api.resume}
        onPause={api.pause}
        onRestart={api.restart}
        introExtra={
          <div className="sn-card p-3 text-left">
            <button
              type="button"
              className="sn-btn sn-btn--ghost h-9 w-full text-xs"
              onClick={() => void enableTilt()}
              disabled={tiltStatus === "granted"}
            >
              {tiltStatus === "granted"
                ? "Inclinación activada"
                : "Usar la inclinación del teléfono"}
            </button>
            <p className="mt-2 text-[11px] leading-snug text-sn-dim">
              {tiltStatus === "granted"
                ? "Sostené el teléfono como te resulte cómodo: al empezar, esa posición queda como el cero. Podés volver a centrarlo durante la partida."
                : tiltStatus === "denied"
                  ? "No se pudo activar el sensor. Se juega igual: tocá la mitad izquierda o derecha de la pantalla, o usá las flechas."
                  : "Es opcional. Sin sensor se juega tocando las mitades de la pantalla o con las flechas."}
            </p>
          </div>
        }
        hud={
          <>
            <HudStat label="Puntos" value={hud.points} tone="cyan" dominant />
            <HudStat label="Altura" value={`${hud.meters} m`} />
            <HudStat label="Impulsos" value={hud.boosts} tone="magenta" />
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
            <h3 className="text-lg">Hasta acá llegaste</h3>
            <p className="mt-1 text-sm text-sn-muted">
              Subiste <span className="sn-num text-sn-cyan">{hud.meters}</span> metros.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="sn-card px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-sn-dim">Puntos</div>
                <div className="sn-num text-lg text-sn-cyan">{hud.points}</div>
              </div>
              <div className="sn-card px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-sn-dim">Altura</div>
                <div className="sn-num text-lg text-sn-text">{hud.meters}</div>
              </div>
              <div className="sn-card px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-sn-dim">Impulsos</div>
                <div className="sn-num text-lg text-sn-magenta">{hud.boosts}</div>
              </div>
            </div>
          </div>
        }
      />

      {/* Recalibrar a mitad de partida: la gente cambia de postura. Aparece
          recien cuando el sensor esta dando lecturas de verdad. */}
      {api.phase === "playing" && hud.tilt && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            className="sn-btn sn-btn--ghost pointer-events-auto h-8 px-3 text-xs"
            onClick={recenter}
          >
            Centrar inclinación
          </button>
        </div>
      )}
    </div>
  );
}
