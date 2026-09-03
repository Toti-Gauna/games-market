import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Application, Container, Graphics, Mesh, MeshGeometry, Shader, Texture } from "pixi.js";
import type { GameProps } from "@/core/contract/game";
import { num, str } from "@/core/contract/settings";
import { vibrate } from "@/core/engine/audio";
import type { CanvasSurface } from "@/core/engine/canvas";
import { clamp, lerp } from "@/core/engine/collide";
import { mixHex, type Palette } from "@/core/engine/palette";
import { createPool, type Pool } from "@/core/engine/pool";
import { useGame2D } from "@/core/engine/useGame2D";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import {
  createRace,
  playerPosition,
  raceMeta,
  racePoints,
  stepRace,
  type Race,
  type RaceRules,
} from "./logic";
import {
  TRACK_SPAN,
  TRACK_TEXTURE_SIZE,
  buildTrack,
  paintTrack,
  trackById,
  wrapAngle,
  type TrackGeometry,
} from "./track";

/**
 * R2 · Supernova Rush. Carreras con perspectiva **Mode 7**.
 *
 * La pista es un bitmap plano visto desde arriba. Para cada linea horizontal
 * de la pantalla se calcula que franja del bitmap le corresponde segun la
 * distancia al horizonte y se dibuja deformada. Se lee como 3D, pero el juego
 * entero sigue siendo 2D: posiciones en un plano, colisiones en 2D, IA en 2D.
 * Eso es lo que lo hace simple de razonar y de depurar.
 *
 * **La proyeccion va en la GPU, en un fragment shader.** Es una transformacion
 * por pixel: hacerla en JS sobre un `ImageData` serian dos millones de pixeles
 * por cuadro en el hilo principal, que en un celular es perder la carrera
 * antes de largar. Un quad tapa la pantalla, el shader invierte la proyeccion
 * y la GPU no se despeina.
 *
 * Todo lo demas lo pone la base: `surface: "raw"` deja el canvas libre para
 * Pixi —igual que Corredor—, y el paso fijo, la cuenta regresiva, el
 * force-end, el HUD, la paleta y el PRNG se heredan sin escribir una linea.
 *
 * **No hay red.** Cada uno corre solo en su celular; lo unico que hace
 * comparables los tiempos es que el circuito y la grilla de rivales salgan de
 * la misma semilla.
 */

/* ------------------------------------------------------------------ */
/* Encuadre y camara                                                    */
/* ------------------------------------------------------------------ */

/** 3:2. Se banca vertical y horizontal sin dejar al HUD sin lugar. */
const WORLD_W = 960;
const WORLD_H = 640;

/** Altura del horizonte, como fraccion de la pantalla. */
const HORIZON = 0.4;
/** Altura de la camara sobre el plano, en unidades del mundo. */
const CAM_HEIGHT = 40;
/** Distancia base de la camara al auto. */
const CAM_BACK = 92;
/** Cuanto mas se retrasa la camara a velocidad maxima. */
const CAM_BACK_SPEED = 30;
/** Con cuanta inercia la camara sigue al rumbo. Baja = mas suelta. */
const CAM_TURN_RATE = 6.5;
/** Cuanto se abre el campo de vision a velocidad maxima, en grados. */
const FOV_SPEED_GAIN = 7;
/** Donde el fondo termina de fundirse con el cielo, en unidades. */
const FOG_FAR = 700;

/** Ancho del auto propio en unidades del mundo. Fija su tamano en pantalla. */
const CAR_WIDTH = 30;
const RIVAL_WIDTH = 27;
/** Los sprites se dibujan en una caja de este ancho y despues se escalan. */
const SPRITE_BOX = 40;
/** Mas cerca que esto no se dibuja: la proyeccion se dispara. */
const NEAR_Z = 14;
/** Mas lejos que esto ya se lo comio la niebla. */
const FAR_Z = 480;

const SPARK_CAPACITY = 24;
/** Lado del cuadrito de chispa, en px locales. */
const SPARK_PX = 6;
/** Que tan grande se ve una chispa sobre la pista, en unidades del mundo. */
const SPARK_WORLD_WIDTH = 4;
const SPARKS_PER_STEP = 2;
const JITTER_COUNT = 64;
/** El HUD se refresca a 8 Hz. El loop va a 60 y React no tiene por que. */
const HUD_INTERVAL_MS = 120;
/** Congelamiento al cruzar la meta, para que se lea el tiempo. */
const FINISH_FREEZE_MS = 900;
/** Muestras de giroscopio antes de fijar el cero. */
const TILT_SAMPLES = 20;
/** Grados que se ignoran alrededor del cero: es lo que hace que quieto sea quieto. */
const TILT_DEADZONE = 1.5;

/* ------------------------------------------------------------------ */
/* El shader                                                            */
/* ------------------------------------------------------------------ */

/*
 * Sin `#version`: Pixi compila esto como GLSL ES 1.00 y define `in`, `out`,
 * `texture` y `finalColor` para que el mismo fuente ande en WebGL 1 y en
 * WebGL 2. Es el camino que menos supuestos hace sobre el telefono que haya
 * del otro lado.
 */
const MODE7_VERTEX = `
in vec2 aPosition;
in vec2 aUV;

out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
}
`;

/*
 * La proyeccion inversa, por pixel:
 *
 *   z     = uDepth / (v - horizonte)                     distancia al frente
 *   mundo = camara + adelante * z + derecha * ((u - 0.5) * uWidth * z)
 *
 * `uDepth` sale de la altura de la camara y la distancia focal, y `uWidth` del
 * campo de vision. Si la grilla no converge recta al horizonte, la que esta
 * mal es esta cuenta, y todo lo que se construya encima va a estar torcido.
 */
const MODE7_FRAGMENT = `
in vec2 vUV;

out vec4 finalColor;

uniform sampler2D uTrack;
uniform vec2 uCam;
uniform vec2 uFwd;
uniform vec2 uShake;
uniform float uHorizon;
uniform float uDepth;
uniform float uWidth;
uniform float uSpan;
uniform float uFar;
uniform float uStarShift;
uniform vec3 uSkyTop;
uniform vec3 uSkyLow;
uniform vec3 uVoid;
uniform vec3 uStar;

float hash12(vec2 p) {
    vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

void main(void) {
    vec2 uv = vUV + uShake;
    float dy = uv.y - uHorizon;

    if (dy <= 0.0012) {
        // Cielo: violeta profundo arriba, magenta contra el horizonte.
        float t = clamp((uHorizon - uv.y) / max(uHorizon, 0.001), 0.0, 1.0);
        vec3 sky = mix(uSkyLow, uSkyTop, t * t);
        vec2 cell = floor(vec2(uv.x * 1.6 + uStarShift, uv.y * 0.9) * 150.0);
        float star = step(0.9955, hash12(cell));
        finalColor = vec4(sky + uStar * star * t, 1.0);
        return;
    }

    float z = uDepth / dy;
    vec2 right = vec2(-uFwd.y, uFwd.x);
    vec2 world = uCam + uFwd * z + right * ((uv.x - 0.5) * uWidth * z);
    vec2 tuv = world / uSpan;

    // Sin ramas alrededor del muestreo: se clampea y se mezcla con el vacio.
    vec2 clamped = clamp(tuv, 0.0, 1.0);
    float outside = step(0.00001, distance(clamped, tuv));
    vec3 base = mix(texture(uTrack, clamped).rgb, uVoid, outside);

    // Niebla del color del cielo: funde el corte del bitmap con el horizonte.
    float fog = clamp(z / uFar, 0.0, 1.0);
    fog *= fog;
    finalColor = vec4(mix(base, uSkyLow, fog), 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Estado                                                               */
/* ------------------------------------------------------------------ */

type TiltStatus = "idle" | "granted" | "denied";

type Spark = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  level: number;
};

/** Puente entre React y el loop: los botones escriben, el update lee. */
type Controls = { tilt: boolean; recenter: boolean; drift: boolean };

type TiltState = {
  samples: Float32Array;
  head: number;
  filled: number;
  zero: number;
  ready: boolean;
};

/** Los mismos objetos que consume Pixi. Se escriben en su lugar, sin asignar. */
type Uniforms = {
  uCam: Float32Array;
  uFwd: Float32Array;
  uShake: Float32Array;
  uHorizon: number;
  uDepth: number;
  uWidth: number;
  uSpan: number;
  uFar: number;
  uStarShift: number;
  uSkyTop: Float32Array;
  uSkyLow: Float32Array;
  uVoid: Float32Array;
  uStar: Float32Array;
};

/** Resultado de proyectar un punto. Se reusa: nunca se crea uno por cuadro. */
type Projection = { x: number; y: number; z: number; scale: number; visible: boolean };

type Scene = {
  app: Application;
  ready: boolean;
  failed: boolean;

  track: TrackGeometry;
  race: Race;
  rules: RaceRules;

  /** null hasta que `Application.init` resuelve. */
  mesh: Mesh<MeshGeometry, Shader> | null;
  uniforms: Uniforms | null;
  texture: Texture | null;

  sprites: Container;
  rivalSprites: Graphics[];
  playerSprite: Graphics;
  sparkLayer: Container;
  sparkSprites: Graphics[];
  speedLines: Graphics;
  flash: Graphics;
  touchLeft: Graphics;
  touchRight: Graphics;

  /* --- camara --- */
  camHeading: number;
  camPrevHeading: number;
  camBack: number;

  /* --- efectos --- */
  shakeMs: number;
  shakeMag: number;
  flashAlpha: number;
  jitter: Float32Array;
  jitterAt: number;
  sparks: Pool<Spark>;
  sparkTints: Int32Array;

  /* --- entrada --- */
  controls: Controls;
  tilt: TiltState;
  tiltRange: number;
  steer: number;
  /** -1 izquierda, 1 derecha, 0 nada. Solo para el feedback de las zonas. */
  touchSide: number;

  /* --- varios --- */
  hudClock: number;
  endMs: number;
  fovBase: number;
  lastPixelWidth: number;
  reducedMotion: boolean;
  /** Holder del cuadro para las funciones del pool: cero asignaciones. */
  frame: { dt: number; x: number; y: number; heading: number; level: number };
  /** camX, camY, fx, fy, uWidth, uDepth del cuadro que se esta dibujando. */
  view: Float64Array;
  proj: Projection;
  /** Creadas una sola vez: un closure por cuadro es basura igual que un `new`. */
  spawnSpark: (spark: Spark) => void;
  stepSpark: (spark: Spark) => void;
  drawSpark: (spark: Spark, index: number) => void;
};

type RaceHud = {
  lap: number;
  laps: number;
  totalMs: number;
  lapMs: number;
  bestMs: number;
  position: number;
  rivals: number;
  charge: number;
  done: boolean;
};

const EMPTY_HUD: RaceHud = {
  lap: 1,
  laps: 3,
  totalMs: 0,
  lapMs: 0,
  bestMs: 0,
  position: 1,
  rivals: 0,
  charge: 0,
  done: false,
};

/* ------------------------------------------------------------------ */

export default function CarrerasGame({ config, signal, onFinish, onReady }: GameProps) {
  const options = useMemo(
    () => ({
      accel: num(config.settings, "accel", 170),
      maxSpeed: num(config.settings, "maxSpeed", 100),
      grip: num(config.settings, "grip", 1),
      offTrack: num(config.settings, "offTrack", 0.6),
      trackId: str(config.settings, "track", "nova"),
      laps: Math.round(num(config.settings, "laps", 3)),
      rivals: Math.round(num(config.settings, "rivals", 5)),
      aiSkill: num(config.settings, "aiSkill", 0.9),
      targetMs: num(config.settings, "targetMs", 95_000),
      fov: num(config.settings, "fov", 70),
      tiltRange: num(config.settings, "tiltRange", 22),
    }),
    [config.settings],
  );

  const [tiltStatus, setTiltStatus] = useState<TiltStatus>("idle");
  const controlsRef = useRef<Controls>({ tilt: false, recenter: false, drift: false });
  const sceneRef = useRef<Scene | null>(null);
  /*
   * La Application vive en un ref, no en la escena, y sobrevive a los
   * reinicios. Un canvas tiene UN solo contexto WebGL: crear una Application
   * nueva por partida deja dos renderers peleandoselo, y destruir la vieja
   * tampoco arregla nada porque `destroy` le hace `loseContext` al canvas y
   * despues no vuelve. Se crea una y se le cambia la escena.
   */
  const appRef = useRef<Application | null>(null);
  const appInitRef = useRef<Promise<void> | null>(null);
  const disposeTimerRef = useRef<number | null>(null);

  const game = useGame2D<Scene, RaceHud, CanvasSurface, HTMLCanvasElement>(
    {
      surface: "raw",
      design: { width: WORLD_W, height: WORLD_H },
      // El Mode 7 es todo relleno de pixeles: renderizar a 3x es la forma mas
      // rapida de perder los 60 fps que este juego promete.
      maxDpr: 1.5,
      countdown: 3,
      hud: { ...EMPTY_HUD, laps: options.laps, rivals: options.rivals },

      init: (ctx) => {
        const track = buildTrack(trackById(options.trackId));
        const rules: RaceRules = {
          accel: options.accel,
          maxSpeed: options.maxSpeed,
          grip: options.grip,
          offTrackFactor: options.offTrack,
          laps: options.laps,
          rivalCount: options.rivals,
          aiSkill: options.aiSkill,
          targetTotalMs: options.targetMs,
        };

        const app = appRef.current ?? new Application();
        appRef.current = app;
        const previous = sceneRef.current;
        const sprites = new Container();
        // Painter's algorithm: los lejanos primero. Sin orden por profundidad,
        // un auto lejano se dibuja encima de uno cercano y la ilusion se cae
        // en el acto.
        sprites.sortableChildren = true;

        const noop = () => {};
        const scene: Scene = {
          app,
          ready: false,
          failed: false,
          track,
          race: createRace(track, rules, ctx.rng),
          rules,
          mesh: null,
          uniforms: null,
          texture: null,
          sprites,
          rivalSprites: [],
          playerSprite: new Graphics(),
          sparkLayer: new Container(),
          sparkSprites: [],
          speedLines: new Graphics(),
          flash: new Graphics(),
          touchLeft: new Graphics(),
          touchRight: new Graphics(),
          camHeading: track.headings[0] ?? 0,
          camPrevHeading: track.headings[0] ?? 0,
          camBack: CAM_BACK,
          shakeMs: 0,
          shakeMag: 0,
          flashAlpha: 0,
          jitter: new Float32Array(JITTER_COUNT),
          jitterAt: 0,
          sparks: createPool<Spark>(SPARK_CAPACITY, () => ({
            alive: false,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            life: 0,
            max: 1,
            level: 1,
          })),
          sparkTints: new Int32Array(4),
          controls: controlsRef.current,
          tilt: {
            samples: new Float32Array(TILT_SAMPLES),
            head: 0,
            filled: 0,
            zero: 0,
            ready: false,
          },
          tiltRange: options.tiltRange,
          steer: 0,
          touchSide: 0,
          hudClock: 0,
          endMs: 0,
          fovBase: options.fov,
          lastPixelWidth: 0,
          reducedMotion: ctx.reducedMotion,
          frame: { dt: 0, x: 0, y: 0, heading: 0, level: 1 },
          view: new Float64Array(6),
          proj: { x: 0, y: 0, z: 0, scale: 0, visible: false },
          spawnSpark: noop,
          stepSpark: noop,
          drawSpark: noop,
        };

        for (let i = 0; i < JITTER_COUNT; i++) scene.jitter[i] = ctx.rng.range(-1, 1);
        // El color de las chispas cuenta el nivel de carga: cyan, violeta,
        // magenta. Es la unica forma de saber cuanto turbo hay guardado.
        scene.sparkTints[0] = hexToNumber(ctx.palette["--sn-text-dim"]);
        scene.sparkTints[1] = hexToNumber(ctx.palette["--sn-cyan-300"]);
        scene.sparkTints[2] = hexToNumber(ctx.palette["--sn-violet-400"]);
        scene.sparkTints[3] = hexToNumber(ctx.palette["--sn-magenta-400"]);

        /* --- El bitmap de la pista, pintado una sola vez --------------- */
        const bitmap = document.createElement("canvas");
        bitmap.width = TRACK_TEXTURE_SIZE;
        bitmap.height = TRACK_TEXTURE_SIZE;
        const bitmapCtx = bitmap.getContext("2d");
        if (bitmapCtx) {
          paintTrack(bitmapCtx, track, {
            space: ctx.palette["--sn-bg"],
            grass: ctx.palette["--sn-violet-600"],
            asphalt: ctx.palette["--sn-bg-elev"],
            edge: ctx.palette["--sn-cyan-400"],
            centerLine: ctx.palette["--sn-line"],
            boost: ctx.palette["--sn-cyan-300"],
            finishDark: ctx.palette["--sn-panel"],
            finishLight: ctx.palette["--sn-text"],
          });
        }

        // La escena vieja suelta sus texturas y sprites; la Application no.
        if (previous) disposeScene(previous);
        // El efecto de limpieza necesita la escena viva para liberar Pixi.
        sceneRef.current = scene;

        /*
         * `Application.init` es asincrono y el `init` del hook no puede serlo:
         * se arranca aca y `draw` no dibuja hasta que este listo. La cuenta
         * regresiva de la base tapa exactamente esta ventana. En los reinicios
         * la promesa ya esta resuelta y el armado sale en el mismo microtask.
         */
        if (!appInitRef.current) {
          appInitRef.current = app.init({
            canvas: ctx.view.canvas,
            width: WORLD_W,
            height: WORLD_H,
            resolution: Math.max(1, ctx.view.pixelWidth / WORLD_W),
            // El shader es solo WebGL: con WebGPU quedaria sin programa.
            preference: "webgl",
            // El Mode 7 tapa la pantalla entera y los sprites son planos: el
            // antialias solo costaria relleno.
            antialias: false,
            autoDensity: false,
            powerPreference: "high-performance",
          });
        }

        void appInitRef.current
          .then(() => {
            // El loop lo maneja la base: el ticker propio de Pixi sobra y
            // ademas dibujaria con delta variable.
            app.ticker.stop();
            // Si mientras tanto hubo otro reinicio, esta escena ya es vieja.
            if (sceneRef.current !== scene) return;
            buildRenderer(scene, bitmap, ctx.palette);
            scene.ready = true;
          })
          .catch(() => {
            // Sin WebGL no hay Mode 7, pero la partida sigue corriendo y el
            // HUD sigue contando: es preferible a una pantalla muerta.
            scene.failed = true;
          });

        return scene;
      },

      /* ------------------------------------------------------------- */

      update: (scene, dt, ctx) => {
        const race = scene.race;
        scene.frame.dt = dt;

        if (race.finished) {
          // Congelamiento breve: es lo que deja leer el tiempo final.
          scene.endMs += dt * 1000;
          stepEffects(scene, dt);
          if (scene.endMs >= (ctx.reducedMotion ? 150 : FINISH_FREEZE_MS)) ctx.finish(true);
          return;
        }

        /* --- Direccion: inclinacion, toque y teclado ------------------- */
        let steer = 0;
        const tilt = ctx.input.tilt;
        if (scene.controls.tilt && tilt) {
          pushTilt(scene.tilt, tiltRaw(tilt.beta, tilt.gamma));
          // El cero se fija donde el jugador tenga el telefono al empezar, y
          // el boton lo vuelve a fijar en plena carrera: la gente cambia de
          // postura, se sienta, se recuesta.
          if (scene.controls.recenter || (!scene.tilt.ready && scene.tilt.filled >= TILT_SAMPLES)) {
            calibrateTilt(scene.tilt);
            scene.controls.recenter = false;
            ctx.sfx.play("select");
          }
          steer = tiltAxis(scene.tilt, scene.tiltRange);
        }
        if (steer === 0) {
          // Sin permiso, sin sensor o en escritorio se juega igual. Un juego
          // que muere sin giroscopio esta mal hecho.
          if (ctx.input.axis.x !== 0) {
            steer = ctx.input.axis.x;
          } else if (ctx.input.pointer.down) {
            // Analogico respecto del centro: un solo pulgar alcanza, y cuanto
            // mas al costado se toca, mas se dobla.
            steer = clamp((ctx.input.pointer.x - WORLD_W / 2) / (WORLD_W * 0.3), -1, 1);
          }
        }
        scene.steer = steer;
        scene.touchSide = steer < -0.05 ? -1 : steer > 0.05 ? 1 : 0;

        const drift =
          scene.controls.drift ||
          ctx.input.keys.has("Space") ||
          ctx.input.keys.has("ShiftLeft") ||
          ctx.input.keys.has("ShiftRight");
        const brake = ctx.input.axis.y === 1;

        stepRace(race, dt, steer, drift, brake);
        const events = race.events;

        /* --- Retorno sensorial ---------------------------------------- */
        if (events.wallHit) {
          ctx.sfx.play("hit");
          vibrate(22);
          addShake(scene, 0.9);
        }
        if (events.wentOffTrack) {
          ctx.sfx.play("tick");
          addShake(scene, 0.5);
        }
        if (events.boostPad || events.turboLaunch > 0) {
          ctx.sfx.play("pick");
          vibrate(14);
          addShake(scene, 0.35);
        }
        if (events.respawn) ctx.sfx.play("select");
        if (events.lapDone) {
          ctx.sfx.play(race.player.finished ? "win" : "pick");
          scene.flashAlpha = ctx.reducedMotion ? 0 : 0.5;
          vibrate([18, 40, 18]);
        }

        /* --- Camara ---------------------------------------------------- */
        const player = race.player;
        // Sigue a la direccion de MOVIMIENTO, no al morro: es lo que hace que
        // el derrape se vea, porque el auto queda cruzado en el encuadre.
        const slip = wrapAngle(player.heading - player.velAngle);
        const desired = wrapAngle(player.velAngle + slip * 0.3);
        scene.camPrevHeading = scene.camHeading;
        scene.camHeading = wrapAngle(
          scene.camHeading + wrapAngle(desired - scene.camHeading) * Math.min(1, CAM_TURN_RATE * dt),
        );
        // Se retrasa al acelerar y se acerca al frenar.
        const ratio = clamp(player.speed / scene.rules.maxSpeed, 0, 1.5);
        const targetBack = CAM_BACK + (ctx.reducedMotion ? 0 : ratio * CAM_BACK_SPEED);
        scene.camBack += (targetBack - scene.camBack) * Math.min(1, 4 * dt);

        /* --- Chispas del derrape --------------------------------------- */
        if (scene.ready && !ctx.reducedMotion && player.driftDir !== 0 && player.driftLevel > 0) {
          scene.frame.x = player.x;
          scene.frame.y = player.y;
          scene.frame.heading = player.heading;
          scene.frame.level = player.driftLevel;
          for (let i = 0; i < SPARKS_PER_STEP; i++) scene.sparks.spawn(scene.spawnSpark);
        }
        stepEffects(scene, dt);

        /* --- HUD -------------------------------------------------------- */
        scene.hudClock += dt * 1000;
        if (scene.hudClock >= HUD_INTERVAL_MS || events.lapDone || events.finished) {
          scene.hudClock = 0;
          ctx.setHud({
            lap: Math.min(scene.rules.laps, player.lap + 1),
            laps: scene.rules.laps,
            totalMs: Math.round(player.totalMs),
            lapMs: Math.round(player.lapMs),
            bestMs: Math.round(player.bestLapMs),
            position: playerPosition(race),
            rivals: race.rivals.length,
            charge: player.driftLevel,
            done: player.lap >= scene.rules.laps,
          });
        }
      },

      /* ------------------------------------------------------------- */

      draw: (scene, canvas, ctx) => {
        if (!scene.ready || scene.failed) return;
        const uniforms = scene.uniforms;
        const mesh = scene.mesh;
        if (!uniforms || !mesh) return;
        const app = scene.app;

        /*
         * El canvas lo redimensiona el ResizeObserver de la base, que no sabe
         * nada de Pixi. Sin este chequeo el viewport de WebGL se queda con el
         * tamano viejo y el juego se dibuja en un rincon de la pantalla.
         */
        if (canvas.width !== scene.lastPixelWidth && canvas.width > 0) {
          scene.lastPixelWidth = canvas.width;
          app.renderer.resize(WORLD_W, WORLD_H, canvas.width / WORLD_W);
        }

        const player = scene.race.player;
        const heading = wrapAngle(
          scene.camPrevHeading + wrapAngle(scene.camHeading - scene.camPrevHeading) * ctx.alpha,
        );
        const carX = lerp(player.px, player.x, ctx.alpha);
        const carY = lerp(player.py, player.y, ctx.alpha);
        const fx = Math.cos(heading);
        const fy = Math.sin(heading);
        const camX = carX - fx * scene.camBack;
        const camY = carY - fy * scene.camBack;

        // El campo de vision se abre con la velocidad: es lo que da sensacion
        // de velocidad sin tocar la velocidad real.
        const ratio = clamp(player.speed / scene.rules.maxSpeed, 0, 1.5);
        const fov = scene.fovBase + (ctx.reducedMotion ? 0 : ratio * FOV_SPEED_GAIN);
        const uWidth = 2 * Math.tan((fov * Math.PI) / 360);
        const uDepth = ((WORLD_W / uWidth) * CAM_HEIGHT) / WORLD_H;

        scene.view[0] = camX;
        scene.view[1] = camY;
        scene.view[2] = fx;
        scene.view[3] = fy;
        scene.view[4] = uWidth;
        scene.view[5] = uDepth;

        uniforms.uCam[0] = camX;
        uniforms.uCam[1] = camY;
        uniforms.uFwd[0] = fx;
        uniforms.uFwd[1] = fy;
        uniforms.uWidth = uWidth;
        uniforms.uDepth = uDepth;
        uniforms.uStarShift = heading * 0.16;

        if (scene.shakeMs > 0 && !ctx.reducedMotion) {
          scene.jitterAt = (scene.jitterAt + 1) % JITTER_COUNT;
          const mag = scene.shakeMag * 0.012;
          uniforms.uShake[0] = (scene.jitter[scene.jitterAt] ?? 0) * mag;
          uniforms.uShake[1] = (scene.jitter[(scene.jitterAt + 17) % JITTER_COUNT] ?? 0) * mag;
        } else {
          uniforms.uShake[0] = 0;
          uniforms.uShake[1] = 0;
        }

        /* --- Sprites, ordenados por profundidad ------------------------ */
        const rivals = scene.race.rivals;
        for (let i = 0; i < scene.rivalSprites.length; i++) {
          const sprite = scene.rivalSprites[i];
          if (!sprite) continue;
          const rival = rivals[i];
          if (!rival) {
            sprite.visible = false;
            continue;
          }
          project(
            scene.proj,
            lerp(rival.px, rival.x, ctx.alpha),
            lerp(rival.py, rival.y, ctx.alpha),
            scene.view,
            RIVAL_WIDTH,
          );
          sprite.visible = scene.proj.visible;
          if (!scene.proj.visible) continue;
          sprite.x = scene.proj.x;
          sprite.y = scene.proj.y;
          sprite.scale.set(scene.proj.scale);
          // Cuanto mas lejos, mas se lo come la niebla.
          const fog = clamp(scene.proj.z / FOG_FAR, 0, 1);
          sprite.alpha = 1 - fog * fog;
          sprite.zIndex = -scene.proj.z;
        }

        project(scene.proj, carX, carY, scene.view, CAR_WIDTH);
        const car = scene.playerSprite;
        car.visible = scene.proj.visible;
        if (scene.proj.visible) {
          car.x = scene.proj.x;
          car.y = scene.proj.y;
          const bob = ctx.reducedMotion ? 0 : Math.sin(ctx.elapsedMs / 90) * ratio * 0.006;
          car.scale.set(scene.proj.scale, scene.proj.scale * (1 + bob));
          // Cruzado respecto de la camara: asi se lee el derrape.
          const cross = wrapAngle(lerp(player.pheading, player.heading, ctx.alpha) - heading);
          car.rotation = cross * 0.3;
          car.skew.x = -cross * 0.55;
          car.zIndex = -scene.proj.z;
        }

        drawSparks(scene);

        /* --- Lineas de velocidad, destello y zonas tactiles ------------- */
        const boosting = player.turboMs > 0 || player.boostMs > 0;
        scene.speedLines.alpha = ctx.reducedMotion
          ? 0
          : clamp((ratio - 0.55) * 1.4, 0, 1) * (boosting ? 0.85 : 0.35);
        scene.flash.alpha = scene.flashAlpha;

        const showZones = !scene.controls.tilt;
        scene.touchLeft.visible = showZones;
        scene.touchRight.visible = showZones;
        scene.touchLeft.alpha = scene.touchSide === -1 ? 0.26 : 0.08;
        scene.touchRight.alpha = scene.touchSide === 1 ? 0.26 : 0.08;

        app.renderer.render(app.stage);
      },

      outcome: (scene, completed) => ({
        // Cortar por tiempo agotado no es terminar la carrera.
        completed: completed && scene.race.player.lap >= scene.rules.laps,
        points: racePoints(scene.race),
        meta: raceMeta(scene.race),
      }),
    },
    config,
    signal,
    onFinish,
  );

  /*
   * Pixi retiene texturas y contextos de GPU: sin liberarlos, el banco de
   * pruebas los acumula en cada partida hasta quedarse sin memoria.
   *
   * Se espera a que `init` haya resuelto antes de destruir: destruir una
   * Application a medio arrancar revienta en el plugin del ticker. Y `texture:
   * true` NO va, porque el Mesh apunta a la `Texture.WHITE` compartida de todo
   * el proceso, no a una nuestra.
   */
  const destroyApp = useCallback(() => {
    const app = appRef.current;
    const started = appInitRef.current;
    const scene = sceneRef.current;
    // Se sueltan ya, no dentro del `finish`: asi el armado que pueda estar en
    // vuelo ve que su escena dejo de ser la actual y no construye al pedo.
    appRef.current = null;
    appInitRef.current = null;
    sceneRef.current = null;
    if (!app) return;
    const finish = () => {
      scene?.texture?.destroy(true);
      app.destroy(false, { children: true });
    };
    if (started) void started.then(finish).catch(() => {});
    else finish();
  }, []);

  useEffect(() => {
    // Montar cancela un desmontaje agendado. Es el ida y vuelta que hace
    // StrictMode en desarrollo, y destruir la Application en el medio seria
    // fatal: `destroy` le pierde el contexto WebGL al canvas y no vuelve.
    if (disposeTimerRef.current !== null) {
      window.clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }
    return () => {
      disposeTimerRef.current = window.setTimeout(destroyApp, 0);
    };
  }, [destroyApp]);

  const readyRef = useRef(false);
  useEffect(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    onReady?.();
  }, [onReady]);

  const enableTilt = useCallback(async () => {
    // iOS solo concede el permiso desde un gesto del usuario, nunca al montar:
    // por eso el pedido vive en este boton y no en un efecto.
    const granted = await game.requestTilt();
    controlsRef.current.tilt = granted;
    setTiltStatus(granted ? "granted" : "denied");
  }, [game]);

  const { phase, requestTilt, hud } = game;
  useEffect(() => {
    if (tiltStatus !== "granted" || phase === "intro") return;
    // Al reiniciar, la base arma un InputController nuevo y el listener de
    // orientacion se va con el viejo. El permiso ya esta dado: reengancharlo
    // no vuelve a preguntar nada.
    void requestTilt();
  }, [tiltStatus, phase, requestTilt]);

  const holdDrift = useCallback(() => {
    controlsRef.current.drift = true;
  }, []);
  const releaseDrift = useCallback(() => {
    controlsRef.current.drift = false;
  }, []);
  const recenter = useCallback(() => {
    controlsRef.current.recenter = true;
  }, []);
  const onStart = useCallback(() => game.start(), [game]);

  return (
    <div className="relative h-full w-full">
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
        instructions="Acelera solo. Inclíná el teléfono o tocá el costado hacia el que querés doblar, y mantené Derrape en las curvas para cargar turbo."
        introExtra={
          <div className="sn-card p-3 text-left">
            <button
              type="button"
              className="sn-btn sn-btn--ghost h-9 w-full text-xs"
              onClick={() => void enableTilt()}
              disabled={tiltStatus === "granted"}
            >
              {tiltStatus === "granted" ? "Inclinación activada" : "Manejar con la inclinación"}
            </button>
            <p className="mt-2 text-[11px] leading-snug text-sn-dim">
              {tiltStatus === "granted"
                ? "Sostené el teléfono como te resulte cómodo: al arrancar, esa posición queda como el volante derecho. Podés volver a centrarlo en plena carrera."
                : tiltStatus === "denied"
                  ? "No se pudo activar el sensor. Se juega igual: tocá el costado hacia el que querés doblar, o usá las flechas."
                  : "Es opcional. Sin sensor se dobla tocando el costado de la pantalla, o con las flechas."}
            </p>
          </div>
        }
        hud={
          <>
            <HudStat label="Vuelta" value={`${hud.lap} / ${hud.laps}`} dominant tone="cyan" />
            <HudStat label="Total" value={formatLap(hud.totalMs)} />
            <HudStat label="Vuelta actual" value={formatLap(hud.lapMs)} />
            {hud.bestMs > 0 && <HudStat label="Mejor" value={formatLap(hud.bestMs)} tone="magenta" />}
            {hud.rivals > 0 && (
              <HudStat label="Puesto" value={`${hud.position} de ${hud.rivals + 1}`} />
            )}
            {hud.charge > 0 && (
              <HudStat
                label="Turbo"
                value={"|".repeat(hud.charge)}
                tone={hud.charge >= 3 ? "magenta" : "cyan"}
              />
            )}
          </>
        }
        summary={
          <div className="text-center">
            <h3 className="text-lg">{hud.done ? "Bandera a cuadros" : "Se terminó"}</h3>
            <p className="mt-1 text-sm text-sn-muted">
              Tiempo total <span className="sn-num text-sn-cyan">{formatLap(hud.totalMs)}</span>
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="sn-card px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-sn-dim">Vueltas</div>
                <div className="sn-num text-lg text-sn-text">
                  {hud.done ? hud.laps : Math.max(0, hud.lap - 1)}
                </div>
              </div>
              <div className="sn-card px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-sn-dim">Mejor vuelta</div>
                <div className="sn-num text-lg text-sn-magenta">{formatLap(hud.bestMs)}</div>
              </div>
              <div className="sn-card px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-sn-dim">Puesto</div>
                <div className="sn-num text-lg text-sn-cyan">{hud.position}</div>
              </div>
            </div>
          </div>
        }
      />

      {/* Los controles de mano viven FUERA del contenedor del juego: asi el
          `pointerdown` del boton no le roba el dedo que esta doblando, y los
          dos se pueden usar al mismo tiempo. */}
      {game.phase === "playing" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex items-end justify-between px-3">
          {tiltStatus === "granted" ? (
            <button
              type="button"
              className="sn-btn sn-btn--ghost pointer-events-auto h-9 px-3 text-xs"
              onClick={recenter}
            >
              Centrar volante
            </button>
          ) : (
            <span className="text-[11px] text-sn-dim">Tocá el costado para doblar</span>
          )}
          <button
            type="button"
            aria-label="Derrapar"
            className="sn-btn sn-btn--primary pointer-events-auto h-16 w-16 rounded-full text-[11px]"
            onPointerDown={holdDrift}
            onPointerUp={releaseDrift}
            onPointerLeave={releaseDrift}
            onPointerCancel={releaseDrift}
          >
            Derrape
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Armado del renderer                                                  */
/* ------------------------------------------------------------------ */

/**
 * Todo lo que solo se puede armar cuando el renderer de Pixi ya existe.
 * Corre una vez, dentro del `then` de `Application.init`.
 */
function buildRenderer(scene: Scene, bitmap: HTMLCanvasElement, palette: Palette): void {
  const texture = Texture.from(bitmap);
  scene.texture = texture;

  const horizon = mixHex(palette["--sn-violet-600"], palette["--sn-magenta-500"], 0.45);

  const shader = Shader.from({
    gl: {
      vertex: MODE7_VERTEX,
      fragment: MODE7_FRAGMENT,
      name: "mode7",
      // Con mediump las coordenadas del mundo pierden precision y la pista
      // tiembla. Pixi lo baja solo si el aparato no soporta highp.
      preferredFragmentPrecision: "highp",
    },
    resources: {
      uTrack: texture.source,
      uSampler: texture.source.style,
      mode7: {
        uCam: { value: new Float32Array(2), type: "vec2<f32>" },
        uFwd: { value: new Float32Array([1, 0]), type: "vec2<f32>" },
        uShake: { value: new Float32Array(2), type: "vec2<f32>" },
        uHorizon: { value: HORIZON, type: "f32" },
        uDepth: { value: 40, type: "f32" },
        uWidth: { value: 1.4, type: "f32" },
        uSpan: { value: TRACK_SPAN, type: "f32" },
        uFar: { value: FOG_FAR, type: "f32" },
        uStarShift: { value: 0, type: "f32" },
        uSkyTop: { value: hexToRgb(palette["--sn-bg"]), type: "vec3<f32>" },
        // El horizonte y la niebla comparten color a proposito: es lo que
        // esconde el corte del bitmap contra el cielo. Violeta tirando a
        // magenta, que es el degrade que pide la guia sin lavar la pista.
        uSkyLow: { value: hexToRgb(horizon), type: "vec3<f32>" },
        uVoid: { value: hexToRgb(palette["--sn-bg"]), type: "vec3<f32>" },
        uStar: { value: hexToRgb(palette["--sn-cyan-300"]), type: "vec3<f32>" },
      },
    },
  });

  /*
   * El loop escribe directamente sobre el grupo de uniforms de Pixi. Los
   * `Float32Array` se mutan en su lugar y los escalares se reasignan: en las
   * dos formas el sincronizado de WebGL compara contra su cache y solo sube
   * lo que cambio.
   */
  const group = shader.resources["mode7"] as { uniforms: Uniforms };
  scene.uniforms = group.uniforms;

  const geometry = new MeshGeometry({
    positions: new Float32Array([0, 0, WORLD_W, 0, WORLD_W, WORLD_H, 0, WORLD_H]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  const mesh = new Mesh<MeshGeometry, Shader>({ geometry, shader });
  scene.mesh = mesh;

  /* --- Sprites: se dibujan UNA vez y despues solo se transforman ---- */
  const body = palette["--sn-cyan-400"];
  const rivalBody = palette["--sn-violet-400"];
  const dark = palette["--sn-bg"];
  const trim = palette["--sn-magenta-400"];

  for (let i = 0; i < scene.race.rivals.length; i++) {
    const sprite = new Graphics();
    paintKart(sprite, rivalBody, dark, palette["--sn-panel-hi"]);
    sprite.visible = false;
    scene.rivalSprites.push(sprite);
    scene.sprites.addChild(sprite);
  }
  paintKart(scene.playerSprite, body, dark, trim);
  scene.sprites.addChild(scene.playerSprite);

  for (let i = 0; i < SPARK_CAPACITY; i++) {
    const spark = new Graphics();
    spark.rect(-SPARK_PX / 2, -SPARK_PX / 2, SPARK_PX, SPARK_PX).fill(0xffffff);
    spark.visible = false;
    scene.sparkSprites.push(spark);
    scene.sparkLayer.addChild(spark);
  }

  paintSpeedLines(scene.speedLines, palette["--sn-cyan-300"]);
  scene.speedLines.alpha = 0;

  scene.flash.rect(0, 0, WORLD_W, WORLD_H).fill(palette["--sn-text"]);
  scene.flash.alpha = 0;

  paintTouchZone(scene.touchLeft, palette["--sn-cyan-400"], 20);
  paintTouchZone(scene.touchRight, palette["--sn-cyan-400"], WORLD_W - 20 - WORLD_W * 0.28);

  scene.app.stage.addChild(mesh);
  scene.app.stage.addChild(scene.sprites);
  scene.app.stage.addChild(scene.sparkLayer);
  scene.app.stage.addChild(scene.speedLines);
  scene.app.stage.addChild(scene.touchLeft);
  scene.app.stage.addChild(scene.touchRight);
  scene.app.stage.addChild(scene.flash);

  scene.spawnSpark = (spark) => {
    scene.jitterAt = (scene.jitterAt + 1) % JITTER_COUNT;
    const jitter = scene.jitter[scene.jitterAt] ?? 0;
    const back = scene.frame.heading + Math.PI;
    const side = jitter > 0 ? 10 : -10;
    spark.x = scene.frame.x + Math.cos(back) * 12 - Math.sin(back) * side;
    spark.y = scene.frame.y + Math.sin(back) * 12 + Math.cos(back) * side;
    spark.vx = Math.cos(back) * 45 + jitter * 34;
    spark.vy = Math.sin(back) * 45 + jitter * 34;
    spark.life = 0.4;
    spark.max = 0.4;
    spark.level = scene.frame.level;
  };

  scene.stepSpark = (spark) => {
    spark.life -= scene.frame.dt;
    if (spark.life <= 0) {
      scene.sparks.release(spark);
      return;
    }
    spark.x += spark.vx * scene.frame.dt;
    spark.y += spark.vy * scene.frame.dt;
  };

  scene.drawSpark = (spark, index) => {
    const sprite = scene.sparkSprites[index];
    if (!sprite) return;
    project(scene.proj, spark.x, spark.y, scene.view, SPARK_WORLD_WIDTH);
    sprite.visible = scene.proj.visible;
    if (!scene.proj.visible) return;
    sprite.x = scene.proj.x;
    sprite.y = scene.proj.y;
    // `proj.scale` viene calibrada para la caja de sprite: la chispa se dibuja
    // en una de SPARK_PX, asi que hay que reescalar la diferencia.
    sprite.scale.set(Math.max(0.25, scene.proj.scale * (SPRITE_BOX / SPARK_PX)));
    sprite.alpha = Math.max(0, spark.life / spark.max);
    sprite.tint = scene.sparkTints[spark.level] ?? 0xffffff;
  };
}

/**
 * Suelta lo pesado de una escena vieja sin tocar el renderer.
 *
 * Lo caro es la textura de la pista —un megapixel— y las geometrias de los
 * sprites. Los programas del shader NO se destruyen: `GlProgram.from` los
 * cachea por fuente, y tirarlos obligaria a recompilar el Mode 7 en cada
 * reinicio para no ganar nada.
 */
function disposeScene(scene: Scene): void {
  // `Mesh.destroy` se olvida de la geometria: hay que agarrarla antes.
  const geometry = scene.mesh?.geometry ?? null;
  const removed = scene.app.stage.removeChildren();
  // Sin `texture: true`: el Mesh apunta a la `Texture.WHITE` compartida.
  for (const child of removed) child.destroy({ children: true });
  geometry?.destroy(true);
  scene.texture?.destroy(true);
  scene.mesh = null;
  scene.uniforms = null;
  scene.texture = null;
  scene.ready = false;
}

/** Un kart visto de atras, con la sombra que lo ancla al piso. */
function paintKart(g: Graphics, body: string, dark: string, trim: string): void {
  const w = SPRITE_BOX;
  // Sin sombra todo parece flotar. Es barato y es lo que ancla el sprite.
  g.ellipse(0, 0, w * 0.5, w * 0.13).fill({ color: dark, alpha: 0.55 });
  g.roundRect(-w * 0.46, -w * 0.2, w * 0.92, w * 0.2, 3).fill(dark);
  g.roundRect(-w * 0.4, -w * 0.62, w * 0.8, w * 0.46, 5).fill(body);
  g.roundRect(-w * 0.24, -w * 0.86, w * 0.48, w * 0.3, 4).fill(trim);
  g.rect(-w * 0.34, -w * 0.34, w * 0.68, w * 0.06).fill({ color: dark, alpha: 0.7 });
}

/** Lineas radiales en los bordes. Solo se enciende y se apaga su alpha. */
function paintSpeedLines(g: Graphics, color: string): void {
  const cx = WORLD_W / 2;
  const cy = WORLD_H * 0.62;
  for (let i = 0; i < 26; i++) {
    const angle = (i / 26) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    g.moveTo(cx + dx * 460, cy + dy * 460);
    g.lineTo(cx + dx * 820, cy + dy * 820);
  }
  g.stroke({ color, width: 3, alpha: 0.55 });
}

/** Zona tactil: grande y generosa, con feedback al tocarla. */
function paintTouchZone(g: Graphics, color: string, x: number): void {
  g.roundRect(x, WORLD_H * 0.6, WORLD_W * 0.28, WORLD_H * 0.34, 18).fill(color);
  g.alpha = 0.08;
}

/* ------------------------------------------------------------------ */
/* Proyeccion directa: mundo -> pantalla                                */
/* ------------------------------------------------------------------ */

/**
 * La inversa exacta de lo que hace el shader. Tiene que serlo: si divergen,
 * los sprites flotan sobre el piso o se hunden en el, y eso no se arregla
 * despues con arte.
 */
function project(
  out: Projection,
  wx: number,
  wy: number,
  view: Float64Array,
  worldWidth: number,
): void {
  const camX = view[0] ?? 0;
  const camY = view[1] ?? 0;
  const fx = view[2] ?? 1;
  const fy = view[3] ?? 0;
  const uWidth = view[4] ?? 1.4;
  const uDepth = view[5] ?? 40;

  const relX = wx - camX;
  const relY = wy - camY;
  const z = relX * fx + relY * fy;
  if (z < NEAR_Z || z > FAR_Z) {
    out.visible = false;
    return;
  }
  const lateral = -relX * fy + relY * fx;
  out.z = z;
  out.x = (0.5 + lateral / (uWidth * z)) * WORLD_W;
  out.y = (HORIZON + uDepth / z) * WORLD_H;
  // Escala inversamente proporcional a la distancia, como en el original.
  out.scale = (worldWidth / (uWidth * z)) * (WORLD_W / SPRITE_BOX);
  out.visible = out.x > -280 && out.x < WORLD_W + 280;
}

/* ------------------------------------------------------------------ */
/* Efectos                                                             */
/* ------------------------------------------------------------------ */

function addShake(scene: Scene, magnitude: number): void {
  if (scene.reducedMotion) return;
  scene.shakeMs = 260;
  scene.shakeMag = Math.max(scene.shakeMag, magnitude);
}

function stepEffects(scene: Scene, dt: number): void {
  if (scene.shakeMs > 0) {
    scene.shakeMs -= dt * 1000;
    if (scene.shakeMs <= 0) scene.shakeMag = 0;
    else scene.shakeMag *= 0.92;
  }
  if (scene.flashAlpha > 0) scene.flashAlpha = Math.max(0, scene.flashAlpha - dt * 1.6);
  scene.sparks.each(scene.stepSpark);
}

function drawSparks(scene: Scene): void {
  for (let i = 0; i < scene.sparkSprites.length; i++) {
    const sprite = scene.sparkSprites[i];
    if (sprite) sprite.visible = false;
  }
  scene.sparks.each(scene.drawSpark);
}

/* ------------------------------------------------------------------ */
/* Giroscopio                                                           */
/* ------------------------------------------------------------------ */

/**
 * Que eje del sensor es el volante depende de como este el telefono: en
 * vertical es `gamma`, acostado es `beta` con el signo dado vuelta segun el
 * lado. Sin esto, el juego dobla al reves apenas alguien gira el aparato.
 */
function tiltRaw(beta: number, gamma: number): number {
  const angle = typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle : 0;
  if (angle === 90) return -beta;
  if (angle === 270) return beta;
  return gamma;
}

function pushTilt(tilt: TiltState, value: number): void {
  tilt.samples[tilt.head] = value;
  tilt.head = (tilt.head + 1) % tilt.samples.length;
  if (tilt.filled < tilt.samples.length) tilt.filled++;
}

/** El cero queda donde el jugador tenga el telefono, no donde diga la fisica. */
function calibrateTilt(tilt: TiltState): void {
  let sum = 0;
  for (let i = 0; i < tilt.filled; i++) sum += tilt.samples[i] ?? 0;
  tilt.zero = tilt.filled > 0 ? sum / tilt.filled : 0;
  tilt.ready = true;
}

function tiltAxis(tilt: TiltState, range: number): number {
  if (!tilt.ready) return 0;
  const last = tilt.samples[(tilt.head - 1 + tilt.samples.length) % tilt.samples.length] ?? 0;
  const delta = last - tilt.zero;
  if (Math.abs(delta) < TILT_DEADZONE) return 0;
  const sign = delta > 0 ? 1 : -1;
  return clamp(((Math.abs(delta) - TILT_DEADZONE) / range) * sign, -1, 1);
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                           */
/* ------------------------------------------------------------------ */

/** m:ss.mmm. Ceros a la izquierda para que el numero no tiemble. */
function formatLap(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function hexToNumber(hex: string): number {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.replace(/./g, (c) => c + c) : clean;
  const value = parseInt(full.slice(0, 6), 16);
  return Number.isFinite(value) ? value : 0xffffff;
}

function hexToRgb(hex: string): Float32Array {
  const n = hexToNumber(hex);
  return new Float32Array([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]);
}
