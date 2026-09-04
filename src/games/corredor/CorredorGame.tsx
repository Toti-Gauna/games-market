import { useCallback, useEffect, useMemo, useRef } from "react";
import { Application, Container, Graphics } from "pixi.js";
import type { GameProps } from "@/core/contract/game";
import { bool, num } from "@/core/contract/settings";
import type { CanvasSurface } from "@/core/engine/canvas";
import { useGame2D } from "@/core/engine/useGame2D";
import { useGameNet } from "@/core/net/useGameNet";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  GROUND_Y,
  RUNNER_W,
  RUNNER_X,
  WORLD_H,
  WORLD_W,
  checkHits,
  createRunner,
  createTrack,
  deriveGhostY,
  generateTrack,
  ghostHeight,
  metersOf,
  pruneTrack,
  requestJump,
  requestSlide,
  runnerBox,
  runnerHeight,
  runnerPoints,
  runnerState,
  speedAt,
  stepRunner,
  type Runner,
  type RunnerState,
  type Track,
} from "./logic";

/**
 * M6 · Corredor.
 *
 * Dos cosas lo separan del resto del catalogo:
 *
 * 1. **Es el primer juego con renderer propio.** Usa `surface: "raw"` de la
 *    base, que saltea la creacion del contexto 2D y deja el canvas libre para
 *    Pixi. Todo lo demas del hook —maquina de fases, cuenta regresiva,
 *    force-end, HUD, input, PRNG, paleta— se hereda igual.
 * 2. **Es el juego de red mas barato del catalogo despues de Ludo.** Se
 *    difunde un numero por jugador a 2 Hz: 6 bytes. La altura de las siluetas
 *    NO viaja, se deriva, porque la pista es identica para todos y mandarla
 *    seria mandar informacion que el otro ya tiene.
 *
 * Las siluetas son honestas justamente por eso: una 40 m adelante esta 40 m
 * adelante sobre el mismo terreno. No es decoracion, es informacion comparable.
 */

/** La spec lo fija: difundir mas seguido es gastar sin ganar nada. */
const BROADCAST_HZ = 2;
const BROADCAST_MS = 1000 / BROADCAST_HZ;

/** Cuantos obstaculos y siluetas se preasignan. Nada se crea por cuadro. */
const MAX_OBSTACLE_SPRITES = 48;
const MAX_GHOST_SPRITES = 30;

type GhostInfo = { id: string; name: string; distance: number; state: RunnerState };

type Scene = {
  app: Application;
  ready: boolean;
  track: Track;
  runner: Runner;
  /** px/s de este cuadro. */
  speed: number;
  deathMs: number;
  broadcastMs: number;

  world: Container;
  ghostLayer: Container;
  obstacleSprites: Graphics[];
  ghostSprites: Graphics[];
  runnerSprite: Graphics;
  groundSprite: Graphics;

  colors: {
    runner: string;
    block: string;
    bar: string;
    gapEdge: string;
    ghost: string;
    ground: string;
  };
  maxGhosts: number;
  parallax: boolean;
  scoreRules: { perMeter: number; perCoin: number; perGraze: number };
  rules: { baseSpeed: number; speedGain: number; maxSpeed: number };
};

type RunnerHud = { meters: number; points: number; position: number; total: number };

const EMPTY_HUD: RunnerHud = { meters: 0, points: 0, position: 1, total: 1 };

export default function CorredorGame({ config, signal, onFinish }: GameProps) {
  const options = useMemo(
    () => ({
      baseSpeed: num(config.settings, "baseSpeed", 320),
      speedGain: num(config.settings, "speedGain", 8),
      maxSpeed: num(config.settings, "maxSpeed", 900),
      perMeter: num(config.settings, "perMeter", 10),
      perCoin: num(config.settings, "perCoin", 25),
      perGraze: num(config.settings, "perGraze", 15),
      maxGhosts: Math.round(num(config.settings, "maxGhosts", 30)),
      parallax: bool(config.settings, "parallax", true),
    }),
    [config.settings],
  );

  /* Las siluetas viven fuera de React: entran por la red y las lee el loop. */
  const ghostsRef = useRef<Map<string, GhostInfo>>(new Map());
  /*
   * La Application vive aparte de la escena y se crea UNA sola vez.
   *
   * Un canvas tiene un solo contexto WebGL: crear otra Application en cada
   * reinicio dejaria el contexto anterior perdido y el juego negro a partir
   * de la segunda partida.
   */
  const appRef = useRef<Application | null>(null);
  const destroyTimerRef = useRef(0);

  const net = useGameNet<{ d: number; s: number }, never>({
    roomId: config.roomId,
    // Lo elige el contenedor, igual que la sala: el celular entra por donde
    // dice el QR y el proyector tiene que estar en la misma red.
    transport: config.transport,
    role: config.seat === 0 ? "host" : "client",
    seat: Math.max(0, config.seat),
    seats: 30,
    onInput: (playerId, input) => {
      // Lo unico que llega de otro jugador: distancia y estado. 6 bytes.
      const previous = ghostsRef.current.get(playerId);
      ghostsRef.current.set(playerId, {
        id: playerId,
        name: previous?.name ?? "Jugador",
        distance: input.d,
        state: STATE_BY_CODE[input.s] ?? "running",
      });
    },
    onPlayerLeave: (playerId) => ghostsRef.current.delete(playerId),
  });

  const netPort = net.net;
  const netRef = useRef(netPort);
  netRef.current = netPort;

  const game = useGame2D<Scene, RunnerHud, CanvasSurface, HTMLCanvasElement>(
    {
      surface: "raw",
      design: { width: WORLD_W, height: WORLD_H },
      countdown: 3,
      swipeThreshold: 20,
      hud: EMPTY_HUD,

      init: (ctx) => {
        const app = appRef.current ?? new Application();
        const world = new Container();
        const ghostLayer = new Container();

        const scene: Scene = {
          app,
          ready: false,
          track: createTrack(),
          runner: createRunner(),
          speed: options.baseSpeed,
          deathMs: 0,
          broadcastMs: 0,
          world,
          ghostLayer,
          obstacleSprites: [],
          ghostSprites: [],
          runnerSprite: new Graphics(),
          groundSprite: new Graphics(),
          colors: {
            runner: ctx.palette["--sn-cyan-400"],
            block: ctx.palette["--sn-violet-400"],
            bar: ctx.palette["--sn-magenta-400"],
            gapEdge: ctx.palette["--sn-line"],
            // Las siluetas van en gris, NUNCA en color: tienen que leerse como
            // fondo y no competir con el personaje propio.
            ghost: ctx.palette["--sn-text-dim"],
            ground: ctx.palette["--sn-line-soft"],
          },
          maxGhosts: options.maxGhosts,
          parallax: options.parallax && !ctx.reducedMotion,
          scoreRules: {
            perMeter: options.perMeter,
            perCoin: options.perCoin,
            perGraze: options.perGraze,
          },
          rules: {
            baseSpeed: options.baseSpeed,
            speedGain: options.speedGain,
            maxSpeed: options.maxSpeed,
          },
        };

        // Todo preasignado: el loop no crea un solo objeto.
        for (let i = 0; i < MAX_OBSTACLE_SPRITES; i++) {
          const sprite = new Graphics();
          sprite.visible = false;
          scene.obstacleSprites.push(sprite);
          world.addChild(sprite);
        }
        for (let i = 0; i < MAX_GHOST_SPRITES; i++) {
          const sprite = new Graphics();
          sprite.visible = false;
          sprite.alpha = 0.35;
          scene.ghostSprites.push(sprite);
          ghostLayer.addChild(sprite);
        }

        const attach = () => {
          // El stage se rearma en cada partida: los contenedores son nuevos.
          app.stage.removeChildren();
          app.stage.addChild(ghostLayer);
          app.stage.addChild(world);
          world.addChild(scene.groundSprite);
          world.addChild(scene.runnerSprite);
          scene.ready = true;
        };

        if (appRef.current) {
          // Reinicio: la Application ya esta viva sobre este canvas.
          attach();
        } else {
          appRef.current = app;
          /*
           * `Application.init` es asincrono y `init` del hook no puede serlo,
           * asi que se arranca aca y `draw` no dibuja hasta que este listo. La
           * cuenta regresiva de la base tapa exactamente esa ventana.
           */
          void app
            .init({
              canvas: ctx.view.canvas,
              width: WORLD_W,
              height: WORLD_H,
              backgroundAlpha: 0,
              antialias: true,
              autoDensity: false,
            })
            .then(() => {
              // El loop lo maneja la base: el ticker propio de Pixi sobra y
              // ademas dibujaria con delta variable.
              app.ticker.stop();
              attach();
            });
        }

        generateTrack(scene.track, WORLD_W * 3, ctx.rng, scene.rules);
        return scene;
      },

      update: (scene, dt, ctx) => {
        const { runner, track } = scene;

        if (runner.dead) {
          scene.deathMs += dt * 1000;
          if (scene.deathMs >= (ctx.reducedMotion ? 0 : 300)) ctx.finish(true);
          return;
        }

        const swipe = ctx.input.swipe;
        if (swipe?.dir === "up" || ctx.input.keys.has("Space") || ctx.input.axis.y === -1) {
          requestJump(runner);
        }
        if (swipe?.dir === "down" || ctx.input.axis.y === 1) {
          requestSlide(runner);
        }
        if (ctx.input.pointer.justPressed) {
          // Mitad de arriba salta, mitad de abajo se desliza.
          if (ctx.input.pointer.y < WORLD_H / 2) requestJump(runner);
          else requestSlide(runner);
        }

        const meters = metersOf(runner.x);
        scene.speed = speedAt(meters, scene.rules.baseSpeed, scene.rules.speedGain, scene.rules.maxSpeed);

        const prevX = runner.x;
        stepRunner(runner, dt, scene.speed, track);
        const hit = checkHits(runner, prevX, track);
        runner.grazes += hit.grazes;

        if (hit.hit || runner.dead) {
          ctx.sfx.play("lose");
          ctx.setHud({ meters: Math.floor(meters), points: runnerPoints(runner, scene.scoreRules) });
          return;
        }

        generateTrack(track, runner.x + WORLD_W * 2, ctx.rng, scene.rules);
        pruneTrack(track, runner.x);

        // La red: un numero, dos veces por segundo.
        scene.broadcastMs += dt * 1000;
        if (scene.broadcastMs >= BROADCAST_MS) {
          scene.broadcastMs = 0;
          netRef.current?.sendInput(
            { d: Math.round(runner.x), s: CODE_BY_STATE[runnerState(runner)] },
            0,
          );
        }

        const ghosts = ghostsRef.current;
        let ahead = 0;
        for (const ghost of ghosts.values()) if (ghost.distance > runner.x) ahead++;

        ctx.setHud({
          meters: Math.floor(meters),
          points: runnerPoints(runner, scene.scoreRules),
          position: ahead + 1,
          total: ghosts.size + 1,
        });
      },

      draw: (scene, _canvas, ctx) => {
        if (!scene.ready) return;
        const { runner, track, world, colors } = scene;

        // La camara: el corredor va fijo en RUNNER_X y el mundo se corre.
        const cameraX = runner.x - RUNNER_X;
        world.x = -cameraX;
        scene.ghostLayer.x = -cameraX;

        // El piso, con los huecos calados.
        const ground = scene.groundSprite;
        ground.clear();
        ground.rect(cameraX, GROUND_Y, WORLD_W, WORLD_H - GROUND_Y).fill(colors.ground);
        for (const obstacle of track.obstacles) {
          if (obstacle.kind !== "gap") continue;
          ground.rect(obstacle.x, GROUND_Y, obstacle.width, WORLD_H - GROUND_Y).cut();
        }

        let slot = 0;
        for (const obstacle of track.obstacles) {
          if (obstacle.kind === "gap") continue;
          const sprite = scene.obstacleSprites[slot];
          if (!sprite) break;
          slot++;
          sprite.visible = true;
          sprite.clear();
          sprite
            .rect(obstacle.x, obstacle.top, obstacle.width, obstacle.height)
            .fill(obstacle.kind === "highBar" ? colors.bar : colors.block);
        }
        for (let i = slot; i < scene.obstacleSprites.length; i++) {
          const sprite = scene.obstacleSprites[i];
          if (sprite) sprite.visible = false;
        }

        drawGhosts(scene, ghostsRef.current, runner.x);

        const box = runnerBox(runner);
        const sprite = scene.runnerSprite;
        sprite.clear();
        sprite.rect(box.x, box.y, RUNNER_W, runnerHeight(runner)).fill(colors.runner);
        sprite.alpha = runner.dead && !ctx.reducedMotion ? 0.4 : 1;

        scene.app.renderer.render(scene.app.stage);
      },

      outcome: (scene, completed) => ({
        completed,
        points: runnerPoints(scene.runner, scene.scoreRules),
        meta: {
          metros: Math.floor(metersOf(scene.runner.x)),
          monedas: scene.runner.coins,
          roces: scene.runner.grazes,
          causa: scene.runner.dead ? "choque" : "tiempo",
        },
      }),
    },
    config,
    signal,
    onFinish,
  );

  /* Pixi retiene texturas y contextos de GPU: si no se libera, el banco de
     pruebas los va acumulando hasta quedarse sin memoria. */
  useEffect(() => {
    window.clearTimeout(destroyTimerRef.current);
    return () => {
      /*
       * Aplazado un tick a proposito. En desarrollo StrictMode desmonta y
       * vuelve a montar: destruir en el acto dejaria al remontaje con un
       * canvas cuyo contexto WebGL ya se perdio. El remontaje cancela esto.
       *
       * Y va con : el canvas es de React, no de Pixi. Sacarlo del DOM
       * desde aca rompe el desmontaje de React.
       */
      destroyTimerRef.current = window.setTimeout(() => {
        const app = appRef.current;
        appRef.current = null;
        app?.destroy(false, { children: true, texture: true });
      }, 0);
    };
  }, []);

  const onStart = useCallback(() => game.start(), [game]);

  return (
    <GameStage
      containerRef={game.containerRef}
      canvasRef={game.canvasRef}
      phase={game.phase}
      countdownLeft={game.countdownLeft}
      muted={game.muted}
      onToggleMuted={game.toggleMuted}
      onStart={onStart}
      onPause={game.pause}
      onResume={game.resume}
      onRestart={game.restart}
      aspect={WORLD_W / WORLD_H}
      {...(config.debug ? { fps: game.fps } : {})}
      instructions="Deslizá arriba para saltar y abajo para deslizarte. Un choque y se termina."
      hud={
        <>
          <HudStat label="Metros" value={game.hud.meters} dominant tone="cyan" />
          <HudStat label="Puntos" value={game.hud.points} />
          {game.hud.total > 1 && (
            <HudStat label="Puesto" value={`${game.hud.position} de ${game.hud.total}`} />
          )}
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
            Llegaste a <span className="sn-num text-sn-cyan">{game.hud.meters}</span> metros.
          </p>
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */

/** Los estados viajan como un byte, no como texto. */
const CODE_BY_STATE: Record<RunnerState, number> = {
  running: 0,
  jumping: 1,
  sliding: 2,
  dead: 3,
};
const STATE_BY_CODE: Record<number, RunnerState> = {
  0: "running",
  1: "jumping",
  2: "sliding",
  3: "dead",
};

/**
 * Dibuja las siluetas mas cercanas.
 *
 * Son lo unico que escala con la cantidad de gente, asi que son lo primero que
 * se recorta si no se llega a 60 fps.
 */
function drawGhosts(scene: Scene, ghosts: Map<string, GhostInfo>, ownX: number): void {
  const sorted = [...ghosts.values()]
    .sort((a, b) => Math.abs(a.distance - ownX) - Math.abs(b.distance - ownX))
    .slice(0, Math.min(scene.maxGhosts, scene.ghostSprites.length));

  for (let i = 0; i < scene.ghostSprites.length; i++) {
    const sprite = scene.ghostSprites[i];
    if (!sprite) continue;
    const ghost = sorted[i];
    if (!ghost) {
      sprite.visible = false;
      continue;
    }
    const height = ghostHeight(ghost.state);
    // La Y no vino por la red: se deduce del estado sobre la pista compartida.
    const y = GROUND_Y + deriveGhostY(ghost.state) - height;
    sprite.visible = true;
    sprite.clear();
    sprite.rect(ghost.distance, y, RUNNER_W, height).fill(scene.colors.ghost);
  }
}
