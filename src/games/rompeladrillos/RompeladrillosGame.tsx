import { useEffect, useMemo, useRef } from "react";
import type { GameProps } from "@/core/contract/game";
import { num } from "@/core/contract/settings";
import type { NetPlayer } from "@/core/contract/gameNet";
import type {
  ControlHaptic,
  ControlInput,
  ControlSpec,
  ControlStatus,
} from "@/core/contract/control";
import { clamp, type Box } from "@/core/engine/collide";
import { withAlpha } from "@/core/engine/palette";
import { useGame2D, type FrameContext } from "@/core/engine/useGame2D";
import type { BotPolicy } from "@/core/net/mockNet";
import { useGameNet } from "@/core/net/useGameNet";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  BREAKOUT_SEATS,
  BRICK_COLS,
  BRICK_KINDS,
  CAPSULE_HALF_H,
  CAPSULE_HALF_W,
  CAPSULE_KINDS,
  CAPSULE_LABELS,
  EV_BRICK,
  EV_CAPSULE_CATCH,
  EV_CAPSULE_DROP,
  EV_LAUNCH,
  EV_LEVEL_CLEAR,
  EV_LIFE_LOST,
  EV_OVER,
  EV_RESCUE,
  EV_SEGMENT,
  EV_STICK,
  EV_WALL,
  LEVEL_COUNT,
  MAX_BALLS,
  MAX_CAPSULES,
  brickBox,
  createBreakoutState,
  releaseStuck,
  seatPoints,
  segmentGap,
  segmentPosition,
  segmentRangeNorm,
  setSegmentTarget,
  stepBreakout,
  writeSegmentBox,
  type BreakoutRules,
  type BreakoutState,
  type Range,
} from "./logic";

/**
 * R5 · Rompeladrillos.
 *
 * Un Breakout con la paleta partida al medio: cada celular controla una mitad,
 * y si se separan queda un hueco por el que la pelota se cae. Todo lo que hace
 * distinto a este juego pasa por tres decisiones:
 *
 * 1. **Topologia `gamepad`: solo el proyector dibuja.** Este componente corre
 *    como host autoritativo (`useGameNet` con `role: "host"`, `seat: -1`):
 *    simula, puntua y renderiza. Los celulares son mandos. No se publica
 *    estado con `broadcastState` porque el telefono no dibuja la partida:
 *    seria gastar canal para que lo tire.
 * 2. **El mando es la mitad del juego.** El `sendControl` va POR ASIENTO,
 *    porque el rango permitido y la marca del companero son distintos para
 *    cada uno. Sin el rango, el dedo se frena contra un limite invisible; sin
 *    la marca del companero, coordinar exige mirar el proyector, y ahi la
 *    pelota va rapido.
 * 3. **El host recibe input, nunca resultados.** El mando ya recorta la
 *    posicion al rango permitido para que el dedo no vaya donde no puede, pero
 *    un cliente puede mandar cualquier numero: `setSegmentTarget` la vuelve a
 *    recortar del lado del host, que es donde se testea.
 */

/* ------------------------------------------------------------------ */
/* Constantes de la cancha                                              */
/* ------------------------------------------------------------------ */

const FIELD_W = 1600;
const FIELD_H = 900;
const BALL_RADIUS = 13;
const SEGMENT_HEIGHT = 22;
const SEGMENT_Y = 830;
const BRICK_TOP = 130;
const BRICK_SIDE = 90;
const BRICK_CELL_H = 40;
const CELL_GAP = 6;

/**
 * Paso de simulacion 1/120, no 1/60, como pide R5-ROMPELADRILLOS.md y por lo
 * mismo que Pong: con la pelota al doble de su velocidad inicial, en 1/60
 * recorre 14 unidades por paso contra un segmento de 22 de alto, y el barrido
 * tiene que resolver tramos largos. El acumulador de abajo hace la fisica
 * independiente del paso del loop.
 */
const SIM_STEP = 1 / 120;
/** Tope de subpasos por cuadro: volver de una pestana oculta no dispara la espiral. */
const MAX_SUBSTEPS = 10;

const TRAIL_MAX = 10;
const TRAIL_REDUCED = 3;
const MAX_SPARKS = 150;
const SPARKS_PER_BRICK = 9;
const SPARK_GRAVITY = 520;
const NOISE_SIZE = 64;

const FLASH_MS = 140;
const SHAKE_MS = 260;
const SHAKE_PX = 7;
const NOTICE_MS = 2800;
const OVER_HOLD_MS = 1500;

/** Cada cuanto se le redibuja la pantalla a cada celular. */
const CONTROL_MS = 100;
/** Debajo de esto no vale la pena mandar: el mando ya esta dibujando lo mismo. */
const CONTROL_EPS = 0.004;

/** Velocidad del teclado local, en pantallas por segundo. */
const KEYBOARD_SPEED = 0.95;
/** Cuanto sigue mandando el teclado tras soltar, para que el bot no le pelee. */
const KEYBOARD_HOLD_S = 1.5;

const BOT_HZ = 30;
const BOT_TICK_S = 1 / BOT_HZ;

/** Sobre 200 ms el juego se siente roto y hay que decirlo. Callarlo es peor. */
const LATENCY_WARN_MS = 200;

/**
 * Los dos hapticos del mando, distintos a proposito.
 *
 * El rebote es un golpe seco y corto: pasa muchas veces por minuto y tiene que
 * poder ignorarse. La capsula son dos toques con pausa, que es lo que hace que
 * se distinga del rebote sin mirar el telefono: cambio las reglas, prestale
 * atencion.
 */
const HAPTIC_BOUNCE: readonly number[] = [18];
const HAPTIC_CAPSULE: readonly number[] = [14, 60, 34];

const DEG = Math.PI / 180;

const FONT_LEVEL = '700 220px "Space Grotesk", sans-serif';
const FONT_NOTICE = '600 36px "Space Grotesk", sans-serif';
const FONT_SEAT = '600 24px "Space Grotesk", sans-serif';
const FONT_BIG = '600 60px "Space Grotesk", sans-serif';
const FONT_CAPSULE = '700 17px "Space Grotesk", sans-serif';

/** Etiquetas precalculadas: `String(n)` por cuadro es una asignacion por cuadro. */
const NUMBER_LABELS: readonly string[] = Array.from({ length: 32 }, (_, i) => String(i));
const GAP_DASH: readonly number[] = [10, 12];
const NO_DASH: readonly number[] = [];

/* ------------------------------------------------------------------ */
/* Escena                                                               */
/* ------------------------------------------------------------------ */

type Scene = {
  game: BreakoutState;
  /** Resto del cuadro que todavia no se convirtio en subpasos de 1/120. */
  accumulator: number;
  viewSeat: number;

  /* Estela y particulas en arrays circulares preasignados: `pool.each` pide un
     callback, y eso es una closure nueva por cuadro. */
  trailX: Float32Array;
  trailY: Float32Array;
  trailHead: Int32Array;
  trailLen: Int32Array;
  trailMax: number;

  sparkX: Float32Array;
  sparkY: Float32Array;
  sparkVx: Float32Array;
  sparkVy: Float32Array;
  sparkLife: Float32Array;
  sparkMax: Float32Array;
  sparkKind: Uint8Array;
  sparkHead: number;

  /** Ruido sembrado una vez. El azar del render NO puede salir de `ctx.rng`:
      consumirlo en draw haria que el proximo nivel dependa de los fps. */
  noise: Float32Array;
  noiseCursor: number;

  flashMs: number;
  shakeMs: number;
  levelPulseMs: number;
  overMs: number;

  noticeText: string;
  noticeTone: number;
  noticeMs: number;

  /** 1 cuando el asiento lo ocupa una persona. */
  humanSeat: Uint8Array;
  /** 1 cuando una persona se fue de ese asiento y lo termino un bot. */
  leftSeat: Uint8Array;
  seatLabel: string[];

  kbHold: Float32Array;
  kbTarget: Float32Array;

  box: Box;
  bgGlow: CanvasGradient;
  vignette: CanvasGradient;
  seatColor: string[];
  seatSoft: string[];
  brickFill: string[];
  brickEdge: string[];
  capsuleFill: string[];
  sparkFill: string[];
  trailFill: string[];
  ballColor: string;
  lineColor: string;
  dangerColor: string;
  flashColor: string;
  levelColor: string;
  noticeFill: string[];
  capsuleText: string;
  textDim: string;
};

type BreakoutHud = {
  lives: number;
  level: number;
  /** Niveles ya superados. Es lo que decide si la partida se ganó. */
  cleared: number;
  one: number;
  two: number;
  gap: number;
};

const EMPTY_HUD: BreakoutHud = { lives: 3, level: 1, cleared: 0, one: 0, two: 0, gap: 0 };

export default function RompeladrillosGame({ config, net, signal, onFinish }: GameProps) {
  const options = useMemo(
    () => ({
      ballSpeed: num(config.settings, "ballSpeed", 420),
      ballAccel: num(config.settings, "ballAccel", 3),
      maxSpeedFactor: num(config.settings, "maxSpeedFactor", 2),
      maxBounceAngle: num(config.settings, "maxBounceAngle", 60),
      segmentWidth: num(config.settings, "segmentWidth", 110),
      minGap: num(config.settings, "minGap", 0),
      maxSeparation: num(config.settings, "maxSeparation", 420),
      segmentFollow: num(config.settings, "segmentFollow", 0.45),
      brickRows: Math.round(num(config.settings, "brickRows", 8)),
      capsuleChance: num(config.settings, "capsuleChance", 12) / 100,
      capsuleSpeed: num(config.settings, "capsuleSpeed", 210),
      lives: Math.round(num(config.settings, "lives", 3)),
      loseDelay: num(config.settings, "loseDelay", 1.5),
      botSpeed: num(config.settings, "botSpeed", 720),
      botError: num(config.settings, "botError", 60),
    }),
    [config.settings],
  );

  const sceneRef = useRef<Scene | null>(null);
  /** El roster por id: `onPlayerLeave` solo trae el id y hay que saber de quien era. */
  const rosterRef = useRef<Map<string, NetPlayer>>(new Map());
  /** El jugador de cada asiento: el `sendControl` va dirigido, no a la sala. */
  const seatPlayerRef = useRef<Array<NetPlayer | null>>([null, null]);

  /* El bot lee los administrables por referencia: el puerto de red se crea una
     sola vez y se queda con la politica que le dieron, asi que tocar una
     perilla no puede exigir reconectar a nadie. */
  const tuningRef = useRef({ speedNorm: 0, errorNorm: 0 });
  tuningRef.current.speedNorm = options.botSpeed / FIELD_W;
  tuningRef.current.errorNorm = options.botError / FIELD_W;

  const botMemoryRef = useRef({
    position: new Float32Array(BREAKOUT_SEATS).fill(0.5),
    bias: new Float32Array(BREAKOUT_SEATS),
    round: new Int32Array(BREAKOUT_SEATS).fill(-1),
    out: [
      { kind: "paddle", position: 0.5 },
      { kind: "paddle", position: 0.5 },
    ] as Extract<ControlInput, { kind: "paddle" }>[],
  });

  /**
   * La politica del bot. Sin esto, probar este juego exige dos personas: es un
   * juego que no existe con una sola, asi que el asiento vacio lo tiene que
   * jugar alguien.
   *
   * Los dos bots hacen sandwich —el 1 se para a la izquierda de la pelota y el
   * 2 a la derecha— que es exactamente lo que dos personas descubren a los
   * treinta segundos. Manda posicion, igual que una persona: no escribe estado
   * ni puntaje.
   */
  const botPolicy = useMemo<BotPolicy<ControlInput>>(
    () => ({
      hz: BOT_HZ,
      policy: (bot) => {
        const memory = botMemoryRef.current;
        const seat = bot.seat >= 0 && bot.seat < BREAKOUT_SEATS ? bot.seat : 0;
        const out = memory.out[seat] ?? memory.out[0] ?? { kind: "paddle" as const, position: 0.5 };
        const scene = sceneRef.current;
        if (!scene) {
          out.position = 0.5;
          return out;
        }
        const game = scene.game;

        // El error se renueva en cada vida y en cada nivel. Con un error fijo,
        // el bot deja de fallar y el juego se vuelve una demo.
        const round = game.level * 16 + game.lives;
        if (memory.round[seat] !== round) {
          memory.round[seat] = round;
          memory.bias[seat] = (bot.rng.next() * 2 - 1) * tuningRef.current.errorNorm;
        }

        const target = dangerBallX(game);
        const half = game.segWidth / 2 / FIELD_W;
        // Sandwich: cada uno cubre su lado de la pelota. Los dos al mismo punto
        // seria pelearse por el lugar y dejar el hueco justo abajo.
        const desired = clamp(
          target / FIELD_W + (seat === 0 ? -half : half) + (memory.bias[seat] ?? 0),
          0,
          1,
        );

        // Velocidad limitada: un bot que teletransporta su mitad no se puede
        // acompanar, y este es un juego cooperativo.
        const current = memory.position[seat] ?? 0.5;
        const maxStep = tuningRef.current.speedNorm * BOT_TICK_S;
        const next = clamp(current + clamp(desired - current, -maxStep, maxStep), 0, 1);
        memory.position[seat] = next;
        out.position = next;
        return out;
      },
    }),
    [],
  );

  const netHandle = useGameNet<ControlInput, never>({
    // La sala la elige el contenedor porque tiene que coincidir con el QR que
    // escanean los celulares. Si el juego inventara una, no se verian.
    roomId: config.roomId,
    // Lo elige el contenedor, igual que la sala: el celular entra por donde
    // dice el QR y el proyector tiene que estar en la misma red.
    transport: config.transport,
    role: "host",
    // -1 = proyector que no juega. Las dos mitades quedan para los celulares.
    seat: -1,
    seats: BREAKOUT_SEATS,
    name: "Proyector",
    bot: botPolicy,

    onInput: (playerId, input) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const player = rosterRef.current.get(playerId);
      if (!player) return;
      const seat = player.seat;
      // El teclado local manda mientras se lo usa: si no, el bot del mismo
      // asiento le pelea el segmento a quien esta probando el juego.
      if ((scene.kbHold[seat] ?? 0) > 0) return;

      if (input.kind === "paddle") {
        // Recorte del lado del host. El mando ya lo hace para que el dedo no
        // vaya donde no puede, pero un cliente puede mandar cualquier numero.
        setSegmentTarget(scene.game, seat, input.position);
        return;
      }
      // El unico boton del mando: soltar la pelota que agarro el iman.
      if (input.kind === "press" && input.buttonId === "release") {
        releaseStuck(scene.game, seat);
      }
    },

    onPlayerJoin: (player) => {
      rosterRef.current.set(player.id, player);
      seatPlayerRef.current[player.seat] = player;
      const scene = sceneRef.current;
      if (!scene) return;
      scene.humanSeat[player.seat] = player.bot ? 0 : 1;
      scene.seatLabel[player.seat] = seatLabelFor(player.seat, player.bot ? "bot" : "human");
      if (!player.bot) {
        scene.leftSeat[player.seat] = 0;
        pushNotice(scene, `Jugador ${player.seat + 1} tomó su mitad`, 0);
      }
    },

    onPlayerLeave: (playerId) => {
      const player = rosterRef.current.get(playerId);
      rosterRef.current.delete(playerId);
      if (player) seatPlayerRef.current[player.seat] = null;
      const scene = sceneRef.current;
      if (!scene || !player || player.bot) return;
      // El bot entra solo desde `mockNet`: con una mitad quieta el juego es
      // injugable, asi que la partida nunca se cuelga esperando a nadie.
      scene.humanSeat[player.seat] = 0;
      scene.leftSeat[player.seat] = 1;
      scene.seatLabel[player.seat] = seatLabelFor(player.seat, "bot");
      pushNotice(scene, `Jugador ${player.seat + 1} se fue · sigue un bot`, 1);
    },
  });

  const game = useGame2D<Scene, BreakoutHud>(
    {
      design: { width: FIELD_W, height: FIELD_H },
      step: SIM_STEP,
      countdown: 3,
      hud: EMPTY_HUD,

      init: (ctx) => {
        const rules: BreakoutRules = {
          width: FIELD_W,
          height: FIELD_H,
          ballRadius: BALL_RADIUS,
          ballSpeed: options.ballSpeed,
          accelPerHit: 1 + options.ballAccel / 100,
          maxSpeedFactor: options.maxSpeedFactor,
          maxBounceRad: options.maxBounceAngle * DEG,
          segmentWidth: options.segmentWidth,
          segmentHeight: SEGMENT_HEIGHT,
          segmentY: SEGMENT_Y,
          segmentFollow: options.segmentFollow,
          minGap: options.minGap,
          maxSeparation: Math.max(options.segmentWidth + options.minGap, options.maxSeparation),
          rows: options.brickRows,
          cols: BRICK_COLS,
          brickTop: BRICK_TOP,
          brickSide: BRICK_SIDE,
          brickCellHeight: BRICK_CELL_H,
          cellGap: CELL_GAP,
          capsuleChance: options.capsuleChance,
          capsuleSpeed: options.capsuleSpeed,
          lives: options.lives,
          loseDelayS: options.loseDelay,
        };

        const g = ctx.view.ctx;
        const p = ctx.palette;
        // Los degrades se crean una vez: crearlos por cuadro es la forma mas
        // barata de perder los 60 fps del proyector.
        const bgGlow = g.createRadialGradient(
          FIELD_W / 2,
          FIELD_H * 0.3,
          0,
          FIELD_W / 2,
          FIELD_H * 0.3,
          FIELD_W * 0.6,
        );
        bgGlow.addColorStop(0, withAlpha(p["--sn-violet-600"], 0.28));
        bgGlow.addColorStop(1, withAlpha(p["--sn-violet-600"], 0));

        const vignette = g.createRadialGradient(
          FIELD_W / 2,
          FIELD_H / 2,
          FIELD_W * 0.34,
          FIELD_W / 2,
          FIELD_H / 2,
          FIELD_W * 0.8,
        );
        vignette.addColorStop(0, withAlpha(p["--sn-bg"], 0));
        vignette.addColorStop(1, withAlpha(p["--sn-bg"], 0.8));

        const trailMax = ctx.reducedMotion ? TRAIL_REDUCED : TRAIL_MAX;
        const trailFill: string[] = new Array(TRAIL_MAX);
        for (let i = 0; i < TRAIL_MAX; i++) {
          trailFill[i] = withAlpha(p["--sn-text"], 0.3 * (1 - i / TRAIL_MAX));
        }

        const noise = new Float32Array(NOISE_SIZE);
        for (let i = 0; i < NOISE_SIZE; i++) noise[i] = ctx.rng.range(-1, 1);

        const scene: Scene = {
          game: createBreakoutState(rules, ctx.rng),
          accumulator: 0,
          viewSeat: clamp(Math.round(config.seat), 0, BREAKOUT_SEATS - 1),

          trailX: new Float32Array(MAX_BALLS * TRAIL_MAX),
          trailY: new Float32Array(MAX_BALLS * TRAIL_MAX),
          trailHead: new Int32Array(MAX_BALLS),
          trailLen: new Int32Array(MAX_BALLS),
          trailMax,

          sparkX: new Float32Array(MAX_SPARKS),
          sparkY: new Float32Array(MAX_SPARKS),
          sparkVx: new Float32Array(MAX_SPARKS),
          sparkVy: new Float32Array(MAX_SPARKS),
          sparkLife: new Float32Array(MAX_SPARKS),
          sparkMax: new Float32Array(MAX_SPARKS),
          sparkKind: new Uint8Array(MAX_SPARKS),
          sparkHead: 0,

          noise,
          noiseCursor: 0,

          flashMs: 0,
          shakeMs: 0,
          levelPulseMs: 0,
          overMs: 0,

          noticeText: "",
          noticeTone: 0,
          noticeMs: 0,

          humanSeat: new Uint8Array(BREAKOUT_SEATS),
          leftSeat: new Uint8Array(BREAKOUT_SEATS),
          seatLabel: [seatLabelFor(0, "free"), seatLabelFor(1, "free")],

          kbHold: new Float32Array(BREAKOUT_SEATS),
          kbTarget: new Float32Array(BREAKOUT_SEATS).fill(0.5),

          box: { x: 0, y: 0, w: 0, h: 0 },
          bgGlow,
          vignette,
          // Cian y magenta, el mismo color en el QR, en el teléfono y aca.
          seatColor: [p["--sn-cyan-400"], p["--sn-magenta-400"]],
          seatSoft: [withAlpha(p["--sn-cyan-300"], 0.7), withAlpha(p["--sn-magenta-300"], 0.7)],
          // Color por tipo de ladrillo, no solo por posicion: en escala de
          // grises los cuatro tipos siguen teniendo brillos distintos.
          brickFill: [
            p["--sn-violet-400"],
            p["--sn-cyan-500"],
            p["--sn-text-muted"],
            p["--sn-warn"],
          ],
          brickEdge: [
            withAlpha(p["--sn-violet-300"], 0.85),
            withAlpha(p["--sn-cyan-300"], 0.85),
            withAlpha(p["--sn-text"], 0.9),
            withAlpha(p["--sn-danger"], 0.95),
          ],
          capsuleFill: [
            p["--sn-cyan-400"],
            p["--sn-violet-300"],
            p["--sn-magenta-400"],
            p["--sn-warn"],
            p["--sn-success"],
          ],
          sparkFill: [
            p["--sn-violet-300"],
            p["--sn-cyan-300"],
            p["--sn-text"],
            p["--sn-warn"],
          ],
          trailFill,
          ballColor: p["--sn-text"],
          lineColor: withAlpha(p["--sn-violet-500"], 0.22),
          dangerColor: p["--sn-danger"],
          flashColor: p["--sn-text"],
          levelColor: withAlpha(p["--sn-violet-400"], 0.1),
          noticeFill: [p["--sn-success"], p["--sn-warn"]],
          // El nombre va en el color del fondo: sobre un relleno saturado es
          // lo unico que se lee desde lejos.
          capsuleText: p["--sn-bg"],
          textDim: withAlpha(p["--sn-text-dim"], 0.75),
        };

        // El puerto de red ya existe cuando esto corre, y su bot, su `onInput`
        // y el reloj del mando buscan la escena aca.
        sceneRef.current = scene;
        for (const player of rosterRef.current.values()) {
          scene.humanSeat[player.seat] = player.bot ? 0 : 1;
          scene.seatLabel[player.seat] = seatLabelFor(player.seat, player.bot ? "bot" : "human");
        }
        return scene;
      },

      update: (scene, dt, ctx) => {
        const state = scene.game;

        decayTimers(scene, dt);
        readKeyboard(scene, dt, ctx);
        updateSparks(scene, dt);

        if (state.over) {
          // Un momento para ver el tablero final. Cortar en seco se siente
          // como un cuelgue, no como una partida terminada.
          scene.overMs += dt * 1000;
          if (scene.overMs >= (ctx.reducedMotion ? 0 : OVER_HOLD_MS)) ctx.finish(state.won);
          return;
        }

        scene.accumulator += dt;
        let steps = 0;
        while (scene.accumulator >= SIM_STEP && steps < MAX_SUBSTEPS) {
          scene.accumulator -= SIM_STEP;
          steps++;
          const mask = stepBreakout(state, SIM_STEP, ctx.rng);
          pushTrails(scene);
          if (mask !== 0) handleEvents(scene, mask, ctx);
          if (state.over) break;
        }
        // Deuda que no entra en el tope: se tira. Recuperarla despues seria
        // simular en camara rapida un tiempo que nadie vio.
        if (scene.accumulator > SIM_STEP * MAX_SUBSTEPS) scene.accumulator = 0;

        ctx.setHud({
          lives: state.lives,
          level: state.level + 1,
          cleared: state.levelsCleared,
          one: seatPoints(state, 0),
          two: seatPoints(state, 1),
          // Redondeado a diez: el numero exacto bailaria sesenta veces por segundo.
          gap: Math.round(segmentGap(state) / 10) * 10,
        });
      },

      draw: (scene, g, ctx) => drawGame(scene, g, ctx.palette["--sn-bg"], ctx.reducedMotion, ctx.elapsedMs),

      outcome: (scene, completed, survivedMs) => {
        const state = scene.game;
        const seat = scene.viewSeat;
        const quit = (scene.leftSeat[seat] ?? 0) === 1;
        return {
          // Al que se fue se le paga lo acumulado, pero con `completed: false`.
          completed: quit ? false : completed || state.won,
          points: seatPoints(state, seat),
          meta: {
            asiento: seat + 1,
            nivel: state.level + 1,
            nivelesSuperados: state.levelsCleared,
            ladrillosPropios: state.brickPoints[seat] ?? 0,
            rescates: state.rescues[seat] ?? 0,
            vidasRestantes: state.lives,
            motivo: state.won
              ? "todos los niveles"
              : state.over
                ? "sin vidas"
                : quit
                  ? "abandono"
                  : completed
                    ? "tiempo"
                    : "forzado",
            duracionS: Math.round(survivedMs / 1000),
          },
        };
      },
    },
    config,
    signal,
    onFinish,
  );

  /* ---------------------------------------------------------------- */
  /* El mando: una pantalla distinta para cada asiento                  */
  /* ---------------------------------------------------------------- */

  const netPort = netHandle.net;
  const playing = game.phase === "playing";
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    if (!netPort) return;
    // Fuera del loop a proposito: `update` y `draw` no asignan nada, y armar un
    // `ControlSpec` es un objeto. A 10 Hz alcanza —el mando interpola el dedo
    // solo— y son 20 mensajes por segundo en vez de 120.
    const memory = createControlMemory();
    const timer = window.setInterval(() => {
      const scene = sceneRef.current;
      if (!scene) return;
      for (let seat = 0; seat < BREAKOUT_SEATS; seat++) {
        const player = seatPlayerRef.current[seat];
        // A un bot no hay a quien dibujarle nada.
        if (!player || player.bot) continue;
        const spec = buildControlSpec(scene, seat, player.id, playingRef.current, memory);
        if (spec) netPort.sendControl(spec, player.id);
      }
    }, CONTROL_MS);
    return () => window.clearInterval(timer);
  }, [netPort]);

  // El roster llega por el hook a 4 Hz; el mapa por asiento tiene que seguirlo
  // aunque el join se haya perdido antes de que montara la escena.
  useEffect(() => {
    const next: Array<NetPlayer | null> = [null, null];
    for (const player of netHandle.players) {
      if (player.seat >= 0 && player.seat < BREAKOUT_SEATS) next[player.seat] = player;
      rosterRef.current.set(player.id, player);
    }
    seatPlayerRef.current = next;
  }, [netHandle.players]);

  const seatOne = findSeat(netHandle.players, 0);
  const seatTwo = findSeat(netHandle.players, 1);
  // El contenedor pasa su transporte crudo, pero el juego arma el suyo tipado
  // sobre la misma sala. Lo unico util de mirarlo es que las salas no
  // coincidan: seria la razon exacta por la que el celular no ve al proyector.
  const roomMismatch = net !== null && net.roomId !== config.roomId;
  const won = game.hud.cleared >= LEVEL_COUNT;

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
      aspect={FIELD_W / FIELD_H}
      {...(config.debug ? { fps: game.fps } : {})}
      instructions="La paleta está partida al medio y cada celular maneja una mitad. Juntos no hay hueco; separados cubren más pero la pelota se cuela. Sin celular: A y D mueven la mitad izquierda, ← y → la derecha. Los asientos vacíos los juega un bot."
      hud={
        <>
          <HudStat
            label="Vidas compartidas"
            value={game.hud.lives}
            dominant
            tone={game.hud.lives <= 1 ? "danger" : "default"}
          />
          <HudStat label={occupancyLabel(1, seatOne)} value={game.hud.one} tone="cyan" />
          <HudStat label={occupancyLabel(2, seatTwo)} value={game.hud.two} tone="magenta" />
          <HudStat label="Nivel" value={`${Math.min(game.hud.level, LEVEL_COUNT)}/${LEVEL_COUNT}`} />
          <HudStat
            label="Hueco"
            value={game.hud.gap}
            tone={game.hud.gap > 180 ? "danger" : game.hud.gap > 0 ? "warn" : "default"}
          />
          {game.timeLeftMs !== null && (
            <HudStat
              label="Tiempo"
              value={formatClock(game.timeLeftMs)}
              tone={game.timeLeftMs < 10_000 ? "danger" : "default"}
            />
          )}
          {netHandle.rttMs > LATENCY_WARN_MS && (
            <HudStat label="Latencia" value={`${netHandle.rttMs} ms`} tone="warn" />
          )}
          {config.debug && <HudStat label="Sala" value={netHandle.net?.roomId ?? "—"} />}
          {roomMismatch && <HudStat label="Salas distintas" value="revisar QR" tone="danger" />}
        </>
      }
      summary={
        <>
          <h3 className="mb-1 text-lg">{won ? "¡Los cinco niveles!" : "Se acabaron las vidas"}</h3>
          <p className="text-sm text-sn-muted">
            <span className="sn-num text-sn-cyan">{game.hud.one}</span>
            <span className="mx-2 text-sn-dim">·</span>
            <span className="sn-num text-sn-magenta">{game.hud.two}</span>
          </p>
          <p className="mt-1 text-xs text-sn-dim">
            Niveles superados: <span className="sn-num">{game.hud.cleared}</span>
          </p>
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Ayudas de HUD                                                        */
/* ------------------------------------------------------------------ */

function findSeat(players: readonly NetPlayer[], seat: number): NetPlayer | null {
  for (const player of players) {
    if (player.seat === seat) return player;
  }
  return null;
}

/** Que mitad tiene una persona y cual un bot, legible desde el fondo de la sala. */
function occupancyLabel(number: number, player: NetPlayer | null): string {
  if (!player) return `Mitad ${number} · libre`;
  return `Mitad ${number} · ${player.bot ? "bot" : "persona"}`;
}

function seatLabelFor(seat: number, kind: "human" | "bot" | "free"): string {
  const who = kind === "human" ? "Persona" : kind === "bot" ? "Bot" : "Libre";
  return `Mitad ${seat + 1} · ${who}`;
}

function pushNotice(scene: Scene, text: string, tone: number): void {
  scene.noticeText = text;
  scene.noticeTone = tone;
  scene.noticeMs = NOTICE_MS;
}

/** La pelota que hay que ir a buscar: la mas baja de las que estan bajando. */
function dangerBallX(state: BreakoutState): number {
  let bestX = state.rules.width / 2;
  let bestY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < MAX_BALLS; i++) {
    if (state.ballAlive[i] !== 1) continue;
    const y = state.ballY[i] ?? 0;
    if (y > bestY) {
      bestY = y;
      bestX = state.ballX[i] ?? bestX;
    }
  }
  return bestX;
}

/* ------------------------------------------------------------------ */
/* El mando                                                             */
/* ------------------------------------------------------------------ */

type ControlMemory = {
  range: Range;
  /** Lo ultimo que se le mando a cada asiento, para no repetir el mismo dibujo. */
  min: Float32Array;
  max: Float32Array;
  partner: Float32Array;
  signature: string[];
  /** De quien era ese asiento. Un aparato nuevo empieza de cero, si o si. */
  owner: string[];
  /* Contadores propios del asiento: cambian y el telefono se entera de que fue
     SU mitad la que reboto o la que agarro la capsula. */
  bounces: Int32Array;
  catches: Int32Array;
  /** Ticks que le quedan al aviso del evento antes de volver al aviso normal. */
  eventTicks: Int32Array;
  eventText: string[];
  /** Identificador del último evento: el mando vibra una vez por `id` nuevo. */
  eventId: string[];
  eventPattern: Array<readonly number[]>;
};

function createControlMemory(): ControlMemory {
  return {
    range: { min: 0, max: 1 },
    min: new Float32Array(BREAKOUT_SEATS).fill(-1),
    max: new Float32Array(BREAKOUT_SEATS).fill(-1),
    partner: new Float32Array(BREAKOUT_SEATS).fill(-1),
    signature: ["", ""],
    owner: ["", ""],
    bounces: new Int32Array(BREAKOUT_SEATS).fill(-1),
    catches: new Int32Array(BREAKOUT_SEATS).fill(-1),
    eventTicks: new Int32Array(BREAKOUT_SEATS),
    eventText: ["", ""],
    eventId: ["", ""],
    eventPattern: [HAPTIC_BOUNCE, HAPTIC_BOUNCE],
  };
}

/**
 * Lo que ve un celular. Es por asiento y no para la sala entera, porque el
 * rango permitido y la marca del companero son distintos para cada uno.
 *
 * Las tres piezas que lo hacen jugable:
 *
 * - `min`/`max` del slider: el rango del dedo mapea al rango permitido y el
 *   mando sombrea la zona prohibida. Sin esto el dedo se frena contra un
 *   limite invisible y nadie entiende por que.
 * - Una marca donde esta el companero: sin ella, coordinar exige mirar el
 *   proyector, y en el proyector la pelota va rapido.
 * - Una marca donde esta la pelota, por lo mismo.
 *
 * Devuelve null cuando nada cambio lo suficiente: repetir el mismo dibujo diez
 * veces por segundo es gastar canal.
 */
function buildControlSpec(
  scene: Scene,
  seat: number,
  playerId: string,
  playing: boolean,
  memory: ControlMemory,
): ControlSpec | null {
  const state = scene.game;
  segmentRangeNorm(state, seat, memory.range);
  const partner = segmentPosition(state, 1 - seat);
  const ball = dangerBallX(state) / state.rules.width;

  const stuck = hasStuckBall(state, seat);
  const haptic = seatHaptic(state, seat, memory);
  const notice = (memory.eventTicks[seat] ?? 0) > 0
    ? (memory.eventText[seat] ?? "")
    : controlNotice(state, seat, stuck);
  const points = seatPoints(state, seat);
  const gap = Math.round(segmentGap(state) / 10) * 10;
  const signature = `${playing ? 1 : 0}|${stuck ? 1 : 0}|${notice}|${points}|${state.lives}|${gap}|${haptic?.id ?? ""}`;

  // Un aparato que acaba de tomar el asiento tiene que recibir su pantalla
  // aunque no se haya movido nada: el spec dirigido no se reenvia solo, asi
  // que sin esto se quedaria mirando "Esperando al proyector".
  const fresh = memory.owner[seat] !== playerId;
  const movedRange =
    Math.abs((memory.min[seat] ?? -1) - memory.range.min) > CONTROL_EPS ||
    Math.abs((memory.max[seat] ?? -1) - memory.range.max) > CONTROL_EPS ||
    Math.abs((memory.partner[seat] ?? -1) - partner) > CONTROL_EPS;
  if (!fresh && !movedRange && memory.signature[seat] === signature) return null;

  memory.owner[seat] = playerId;
  memory.min[seat] = memory.range.min;
  memory.max[seat] = memory.range.max;
  memory.partner[seat] = partner;
  memory.signature[seat] = signature;

  const status: ControlStatus[] = [
    { label: "Tus puntos", value: String(points) },
    { label: "Vidas", value: String(state.lives), tone: state.lives <= 1 ? "danger" : "default" },
    { label: "Hueco", value: String(gap), tone: gap > 180 ? "danger" : gap > 0 ? "warn" : "default" },
  ];

  return {
    layout: "pad",
    enabled: playing,
    slider: {
      orientation: "horizontal",
      min: memory.range.min,
      max: memory.range.max,
      markers: [
        { at: clamp(partner, 0, 1), label: "Compañero", tone: "warn" },
        { at: clamp(ball, 0, 1), label: "Pelota" },
      ],
    },
    ...(stuck
      ? { buttons: [{ id: "release", label: "Soltar la pelota", group: "main" as const }] }
      : {}),
    status,
    ...(notice ? { notice } : {}),
    // Dirigido por asiento: vibra el que rebotó la pelota, no los dos.
    ...(haptic ? { haptic } : {}),
  };
}

/**
 * Lo que le pasó A ESTA MITAD: vibración y aviso, distintos para el rebote y
 * para la cápsula.
 *
 * El `id` sale de los contadores por asiento que lleva la lógica
 * (`bounces`, `catches`), que es exactamente lo que pide el contrato: cambia
 * sólo cuando pasa el evento, así que el teléfono vibra una vez y no en cada
 * refresco del spec. Y como el spec va dirigido, vibra el que rebotó la
 * pelota, no los dos.
 */
function seatHaptic(
  state: BreakoutState,
  seat: number,
  memory: ControlMemory,
): ControlHaptic | null {
  const bounces = state.bounces[seat] ?? 0;
  const catches = state.catches[seat] ?? 0;
  // El primer spec del asiento no vibra: no pasó nada todavía, y arrancar con
  // un golpe en la mano es ruido.
  const first = (memory.bounces[seat] ?? -1) < 0;
  let ticks = memory.eventTicks[seat] ?? 0;
  if (ticks > 0) ticks--;
  let haptic: ControlHaptic | null = null;

  if (!first && catches !== (memory.catches[seat] ?? 0)) {
    // La cápsula gana sobre el rebote: es lo que cambia las reglas.
    memory.eventText[seat] = `Agarraste ${CAPSULE_LABELS[state.lastCatchType] ?? "una cápsula"}`;
    memory.eventId[seat] = `capsule-${catches}`;
    memory.eventPattern[seat] = HAPTIC_CAPSULE;
    ticks = 9;
  } else if (!first && bounces !== (memory.bounces[seat] ?? 0)) {
    memory.eventText[seat] = "¡Rebotó en tu mitad!";
    memory.eventId[seat] = `bounce-${bounces}`;
    memory.eventPattern[seat] = HAPTIC_BOUNCE;
    ticks = 4;
  }

  memory.bounces[seat] = bounces;
  memory.catches[seat] = catches;
  memory.eventTicks[seat] = ticks;

  // Viaja en todos los specs de la ventana del aviso, no sólo en el primero:
  // el mando ignora el `id` repetido, así que un paquete perdido no cuesta la
  // vibración.
  if (ticks > 0 && memory.eventId[seat]) {
    haptic = {
      id: memory.eventId[seat] ?? "",
      pattern: memory.eventPattern[seat] ?? HAPTIC_BOUNCE,
    };
  }
  return haptic;
}

function hasStuckBall(state: BreakoutState, seat: number): boolean {
  for (let i = 0; i < MAX_BALLS; i++) {
    if (state.ballAlive[i] === 1 && state.ballStuck[i] === seat) return true;
  }
  return false;
}

/**
 * Lo unico que el telefono dice con palabras.
 *
 * Es el segundo canal de feedback del mando: la marca del companero se mueve
 * sola y el aviso explica lo que esa marca significa ahora mismo.
 */
function controlNotice(state: BreakoutState, seat: number, stuck: boolean): string {
  if (state.over) return state.won ? "¡Terminaron los cinco niveles!" : "Se acabaron las vidas";
  if (stuck) return "La pelota está pegada: tocá Soltar";
  if (state.serveTimerS > 0) return "Preparate: sale del medio";
  if (state.jointMs > 0) return "Junta activa: van pegados, no hay hueco";
  const gap = segmentGap(state);
  if (gap > 220) return "Hueco enorme en el medio";
  if (gap > 90) return seat === 0 ? "Corréte a la derecha: hay hueco" : "Corréte a la izquierda: hay hueco";
  return "";
}

/* ------------------------------------------------------------------ */
/* Update                                                               */
/* ------------------------------------------------------------------ */

function decayTimers(scene: Scene, dt: number): void {
  const ms = dt * 1000;
  if (scene.flashMs > 0) scene.flashMs -= ms;
  if (scene.shakeMs > 0) scene.shakeMs -= ms;
  if (scene.noticeMs > 0) scene.noticeMs -= ms;
  if (scene.levelPulseMs > 0) scene.levelPulseMs -= ms;
}

/**
 * Teclado local, solo sobre las mitades que hoy juega un bot.
 *
 * Es lo que permite probar el juego entero sin dos celulares. En cuanto una
 * persona toma la mitad, el celular manda y el teclado deja de existir.
 */
function readKeyboard(scene: Scene, dt: number, ctx: FrameContext<BreakoutHud>): void {
  const keys = ctx.input.keys;
  for (let seat = 0; seat < BREAKOUT_SEATS; seat++) {
    let hold = scene.kbHold[seat] ?? 0;
    if (scene.humanSeat[seat] === 1) {
      scene.kbHold[seat] = 0;
      continue;
    }

    const left = seat === 0 ? keys.has("KeyA") : keys.has("ArrowLeft");
    const right = seat === 0 ? keys.has("KeyD") : keys.has("ArrowRight");
    const dir = (right ? 1 : 0) - (left ? 1 : 0);

    if (dir !== 0) {
      // Al tomar el control se arranca donde esta el segmento, no donde quedo
      // la ultima vez: si no, salta al apretar la primera tecla.
      if (hold <= 0) scene.kbTarget[seat] = segmentPosition(scene.game, seat);
      const next = clamp((scene.kbTarget[seat] ?? 0.5) + dir * KEYBOARD_SPEED * dt, 0, 1);
      scene.kbTarget[seat] = next;
      setSegmentTarget(scene.game, seat, next);
      hold = KEYBOARD_HOLD_S;
    } else if (hold > 0) {
      hold = Math.max(0, hold - dt);
    }
    scene.kbHold[seat] = hold;
  }
}

/** Feedback en dos canales: siempre algo que suena y algo que se ve. */
function handleEvents(scene: Scene, mask: number, ctx: FrameContext<BreakoutHud>): void {
  const state = scene.game;

  if ((mask & EV_SEGMENT) !== 0) {
    ctx.sfx.play("hit");
    if (!ctx.reducedMotion) {
      spawnSparks(scene, state.lastHitX, state.lastHitY, 2, 4, -1);
    }
  }
  if ((mask & EV_WALL) !== 0) ctx.sfx.play("tick");
  if ((mask & EV_RESCUE) !== 0) {
    pushNotice(scene, `¡Rescate de la mitad ${state.lastHitSeat + 1}!`, 0);
  }
  if ((mask & EV_BRICK) !== 0) {
    ctx.sfx.play("select");
    if (!ctx.reducedMotion) {
      spawnSparks(scene, state.lastBrickX, state.lastBrickY, state.lastBrickType, SPARKS_PER_BRICK, 1);
    }
  }
  if ((mask & EV_CAPSULE_DROP) !== 0) ctx.sfx.play("tick");
  if ((mask & EV_CAPSULE_CATCH) !== 0) {
    ctx.sfx.play("pick");
    const label = CAPSULE_LABELS[state.lastCatchType] ?? "Cápsula";
    pushNotice(scene, `Cápsula ${label} · mitad ${state.lastCatchSeat + 1}`, 0);
  }
  if ((mask & EV_STICK) !== 0) ctx.sfx.play("pick");
  if ((mask & EV_LAUNCH) !== 0) ctx.sfx.play("tick");
  if ((mask & EV_LIFE_LOST) !== 0) {
    // Si ademas se termino la partida el sonido lo pone EV_OVER: dos "lose"
    // encimados suenan a bug, no a derrota.
    if ((mask & EV_OVER) === 0) ctx.sfx.play("lose");
    pushNotice(scene, "Se coló por el hueco", 1);
    if (!ctx.reducedMotion) {
      scene.flashMs = FLASH_MS;
      scene.shakeMs = SHAKE_MS;
    }
  }
  if ((mask & EV_LEVEL_CLEAR) !== 0) {
    ctx.sfx.play("win");
    pushNotice(scene, "Nivel superado · +400 para los dos", 0);
    if (!ctx.reducedMotion) scene.levelPulseMs = 700;
  }
  if ((mask & EV_OVER) !== 0) ctx.sfx.play(state.won ? "win" : "lose");
}

function pushTrails(scene: Scene): void {
  const state = scene.game;
  for (let i = 0; i < MAX_BALLS; i++) {
    if (state.ballAlive[i] !== 1) {
      scene.trailLen[i] = 0;
      continue;
    }
    const head = ((scene.trailHead[i] ?? 0) + 1) % TRAIL_MAX;
    scene.trailHead[i] = head;
    scene.trailX[i * TRAIL_MAX + head] = state.ballX[i] ?? 0;
    scene.trailY[i * TRAIL_MAX + head] = state.ballY[i] ?? 0;
    const len = scene.trailLen[i] ?? 0;
    if (len < scene.trailMax) scene.trailLen[i] = len + 1;
  }
}

function nextNoise(scene: Scene): number {
  scene.noiseCursor = (scene.noiseCursor + 1) % NOISE_SIZE;
  return scene.noise[scene.noiseCursor] ?? 0;
}

function updateSparks(scene: Scene, dt: number): void {
  for (let i = 0; i < MAX_SPARKS; i++) {
    const life = scene.sparkLife[i] ?? 0;
    if (life <= 0) continue;
    const next = life - dt;
    if (next <= 0) {
      scene.sparkLife[i] = 0;
      continue;
    }
    scene.sparkLife[i] = next;
    scene.sparkX[i] = (scene.sparkX[i] ?? 0) + (scene.sparkVx[i] ?? 0) * dt;
    scene.sparkY[i] = (scene.sparkY[i] ?? 0) + (scene.sparkVy[i] ?? 0) * dt;
    scene.sparkVy[i] = (scene.sparkVy[i] ?? 0) + SPARK_GRAVITY * dt;
  }
}

function spawnSparks(
  scene: Scene,
  x: number,
  y: number,
  kind: number,
  count: number,
  dirY: number,
): void {
  for (let n = 0; n < count; n++) {
    const index = scene.sparkHead;
    scene.sparkHead = (index + 1) % MAX_SPARKS;
    const spread = nextNoise(scene);
    const power = nextNoise(scene);
    const angle = spread * Math.PI;
    const speed = 160 + Math.abs(power) * 340;
    const life = 0.25 + Math.abs(spread) * 0.3;
    scene.sparkX[index] = x;
    scene.sparkY[index] = y;
    scene.sparkVx[index] = Math.cos(angle) * speed;
    scene.sparkVy[index] = Math.sin(angle) * speed * 0.7 + dirY * 90;
    scene.sparkLife[index] = life;
    scene.sparkMax[index] = life;
    scene.sparkKind[index] = kind % BRICK_KINDS;
  }
}

/* ------------------------------------------------------------------ */
/* Draw                                                                 */
/* ------------------------------------------------------------------ */

function drawGame(
  scene: Scene,
  g: CanvasRenderingContext2D,
  background: string,
  reducedMotion: boolean,
  elapsedMs: number,
): void {
  const state = scene.game;

  g.save();
  if (!reducedMotion && scene.shakeMs > 0) {
    const decay = scene.shakeMs / SHAKE_MS;
    const tick = (elapsedMs * 0.07) | 0;
    g.translate(
      (scene.noise[tick & (NOISE_SIZE - 1)] ?? 0) * SHAKE_PX * decay,
      (scene.noise[(tick + 11) & (NOISE_SIZE - 1)] ?? 0) * SHAKE_PX * decay,
    );
  }

  g.fillStyle = background;
  g.fillRect(0, 0, FIELD_W, FIELD_H);
  g.fillStyle = scene.bgGlow;
  g.fillRect(0, 0, FIELD_W, FIELD_H);

  drawLevelNumber(scene, g, reducedMotion);
  drawFloorLine(scene, g);
  drawBricks(scene, g);
  drawCapsules(scene, g);
  drawTrails(scene, g);
  drawBalls(scene, g, reducedMotion);
  // El hueco va DESPUES de la pelota y antes de los segmentos: es la
  // informacion mas importante de la pantalla y no puede quedar tapada.
  drawGapWarning(scene, g);
  drawSegments(scene, g, reducedMotion);
  drawSparks(scene, g);
  drawSeatLabels(scene, g);

  if (state.serveTimerS > 0 && !state.over) drawServeHint(scene, g);
  if (scene.noticeMs > 0) drawNotice(scene, g);

  if (scene.flashMs > 0 && !reducedMotion) {
    g.globalAlpha = (scene.flashMs / FLASH_MS) * 0.5;
    g.fillStyle = scene.flashColor;
    g.fillRect(0, 0, FIELD_W, FIELD_H);
    g.globalAlpha = 1;
  }

  g.fillStyle = scene.vignette;
  g.fillRect(0, 0, FIELD_W, FIELD_H);
  g.restore();
}

/** Numero de nivel gigante detras de todo: se lee desde el fondo de la sala. */
function drawLevelNumber(scene: Scene, g: CanvasRenderingContext2D, reducedMotion: boolean): void {
  const pulse = reducedMotion ? 0 : Math.max(0, scene.levelPulseMs) / 700;
  g.save();
  g.translate(FIELD_W / 2, FIELD_H * 0.62);
  if (pulse > 0) g.scale(1 + pulse * 0.18, 1 + pulse * 0.18);
  g.font = FONT_LEVEL;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = scene.levelColor;
  g.fillText(NUMBER_LABELS[scene.game.level + 1] ?? "", 0, 0);
  g.restore();
}

function drawFloorLine(scene: Scene, g: CanvasRenderingContext2D): void {
  g.strokeStyle = scene.lineColor;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, SEGMENT_Y + SEGMENT_HEIGHT + 26);
  g.lineTo(FIELD_W, SEGMENT_Y + SEGMENT_HEIGHT + 26);
  g.stroke();
}

/** Una pasada por tipo: agrupar por estilo evita un cambio de fillStyle por ladrillo. */
function drawBricks(scene: Scene, g: CanvasRenderingContext2D): void {
  const state = scene.game;
  const total = state.rules.rows * state.rules.cols;

  for (let type = 0; type < BRICK_KINDS; type++) {
    g.fillStyle = scene.brickFill[type] ?? scene.ballColor;
    for (let index = 0; index < total; index++) {
      const hp = state.brickHp[index] ?? 0;
      if (hp === 0 || (state.brickType[index] ?? 0) !== type) continue;
      const col = index % state.rules.cols;
      const row = (index - col) / state.rules.cols;
      brickBox(state, row, col, scene.box);
      const maxHp = state.brickMaxHp[index] ?? 1;
      // Los danados se apagan: es la "grieta" leible de lejos, sin dibujar
      // lineas finitas que en un proyector no se ven.
      g.globalAlpha = maxHp > 1 ? 0.45 + 0.55 * (hp / maxHp) : 1;
      g.beginPath();
      g.roundRect(scene.box.x, scene.box.y, scene.box.w, scene.box.h, 5);
      g.fill();
    }
  }
  g.globalAlpha = 1;

  // Segunda pasada: la grieta propiamente dicha, solo en los golpeados.
  g.lineWidth = 3;
  for (let type = 0; type < BRICK_KINDS; type++) {
    g.strokeStyle = scene.brickEdge[type] ?? scene.ballColor;
    for (let index = 0; index < total; index++) {
      const hp = state.brickHp[index] ?? 0;
      const maxHp = state.brickMaxHp[index] ?? 1;
      if (hp === 0 || hp >= maxHp || (state.brickType[index] ?? 0) !== type) continue;
      const col = index % state.rules.cols;
      const row = (index - col) / state.rules.cols;
      brickBox(state, row, col, scene.box);
      g.beginPath();
      g.moveTo(scene.box.x + scene.box.w * 0.2, scene.box.y);
      g.lineTo(scene.box.x + scene.box.w * 0.45, scene.box.y + scene.box.h);
      if (hp <= maxHp - 2) {
        g.moveTo(scene.box.x + scene.box.w * 0.75, scene.box.y);
        g.lineTo(scene.box.x + scene.box.w * 0.55, scene.box.y + scene.box.h);
      }
      g.stroke();
    }
  }
}

function drawCapsules(scene: Scene, g: CanvasRenderingContext2D): void {
  const state = scene.game;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = FONT_CAPSULE;
  for (let type = 0; type < CAPSULE_KINDS; type++) {
    const color = scene.capsuleFill[type] ?? scene.ballColor;
    for (let i = 0; i < MAX_CAPSULES; i++) {
      if (state.capAlive[i] !== 1 || state.capType[i] !== type) continue;
      const x = state.capX[i] ?? 0;
      const y = state.capY[i] ?? 0;
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x - CAPSULE_HALF_W, y - CAPSULE_HALF_H, CAPSULE_HALF_W * 2, CAPSULE_HALF_H * 2, CAPSULE_HALF_H);
      g.fill();
      // Nombre ademas de color: cinco capsulas no se distinguen por tono, y
      // menos en un proyector.
      g.fillStyle = scene.capsuleText;
      g.fillText(CAPSULE_LABELS[type] ?? "", x, y + 1);
    }
  }
}

function drawTrails(scene: Scene, g: CanvasRenderingContext2D): void {
  const state = scene.game;
  for (let ball = 0; ball < MAX_BALLS; ball++) {
    if (state.ballAlive[ball] !== 1) continue;
    const head = scene.trailHead[ball] ?? 0;
    const len = scene.trailLen[ball] ?? 0;
    for (let i = 1; i < len; i++) {
      const index = ball * TRAIL_MAX + ((head - i + TRAIL_MAX * 2) % TRAIL_MAX);
      const fade = i / scene.trailMax;
      g.fillStyle = scene.trailFill[i] ?? scene.ballColor;
      g.beginPath();
      g.arc(scene.trailX[index] ?? 0, scene.trailY[index] ?? 0, BALL_RADIUS * (1 - fade * 0.65), 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawBalls(scene: Scene, g: CanvasRenderingContext2D, reducedMotion: boolean): void {
  const state = scene.game;
  for (let i = 0; i < MAX_BALLS; i++) {
    if (state.ballAlive[i] !== 1) continue;
    // La pelota lleva el color de quien la reboto ultimo: se ve de quien son
    // los puntos que estan por caer.
    const owner = state.ballOwner[i] ?? -1;
    const color = owner >= 0 ? (scene.seatColor[owner] ?? scene.ballColor) : scene.ballColor;
    g.fillStyle = color;
    if (!reducedMotion) {
      g.shadowColor = color;
      g.shadowBlur = 24;
    }
    g.beginPath();
    g.arc(state.ballX[i] ?? 0, state.ballY[i] ?? 0, BALL_RADIUS, 0, Math.PI * 2);
    g.fill();
  }
  g.shadowBlur = 0;
}

/**
 * La linea de peligro del hueco.
 *
 * Es la mitad del juego: si no se dibuja, nadie entiende por que se perdio la
 * vida. Se conserva con `prefers-reduced-motion` porque es informacion, no
 * adorno; lo que se saca ahi es el brillo, no la linea.
 */
function drawGapWarning(scene: Scene, g: CanvasRenderingContext2D): void {
  const state = scene.game;
  const gap = segmentGap(state);
  if (gap <= 1) return;
  const left = (state.segX[0] ?? 0) + state.segWidth / 2;
  const y = SEGMENT_Y + SEGMENT_HEIGHT / 2;
  const intensity = Math.min(1, gap / 300);

  g.save();
  g.globalAlpha = 0.25 + intensity * 0.7;
  g.strokeStyle = scene.dangerColor;
  g.lineWidth = 4 + intensity * 6;
  g.setLineDash(GAP_DASH as number[]);
  g.beginPath();
  g.moveTo(left, y);
  g.lineTo(left + gap, y);
  g.stroke();
  g.setLineDash(NO_DASH as number[]);

  // Y un triangulo hacia abajo en el medio del hueco: dice hacia donde se va a
  // caer, no solo que hay hueco.
  g.globalAlpha = 0.3 + intensity * 0.6;
  g.fillStyle = scene.dangerColor;
  const cx = left + gap / 2;
  g.beginPath();
  g.moveTo(cx - 16, y + 18);
  g.lineTo(cx + 16, y + 18);
  g.lineTo(cx, y + 46);
  g.closePath();
  g.fill();
  g.restore();
}

function drawSegments(scene: Scene, g: CanvasRenderingContext2D, reducedMotion: boolean): void {
  const state = scene.game;
  for (let seat = 0; seat < BREAKOUT_SEATS; seat++) {
    writeSegmentBox(state, seat, scene.box);
    const color = scene.seatColor[seat] ?? scene.ballColor;
    g.fillStyle = color;
    if (!reducedMotion) {
      g.shadowColor = color;
      g.shadowBlur = 28;
    }
    g.beginPath();
    g.roundRect(scene.box.x, scene.box.y, scene.box.w, scene.box.h, 10);
    g.fill();
  }
  g.shadowBlur = 0;

  // Con la junta activa, una barra que une las dos mitades: se ve que ahora
  // son una sola paleta.
  if (state.jointMs > 0) {
    g.fillStyle = scene.flashColor;
    g.globalAlpha = 0.75;
    const a = (state.segX[0] ?? 0) + state.segWidth / 2;
    const b = (state.segX[1] ?? 0) - state.segWidth / 2;
    g.fillRect(a - 2, SEGMENT_Y + 6, Math.max(4, b - a + 4), SEGMENT_HEIGHT - 12);
    g.globalAlpha = 1;
  }
}

/** Dos pasadas, una por color: agrupar evita un cambio de estilo por particula. */
function drawSparks(scene: Scene, g: CanvasRenderingContext2D): void {
  for (let kind = 0; kind < BRICK_KINDS; kind++) {
    g.fillStyle = scene.sparkFill[kind] ?? scene.ballColor;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const life = scene.sparkLife[i] ?? 0;
      if (life <= 0 || scene.sparkKind[i] !== kind) continue;
      const ratio = life / (scene.sparkMax[i] || 1);
      g.globalAlpha = ratio;
      g.beginPath();
      g.arc(scene.sparkX[i] ?? 0, scene.sparkY[i] ?? 0, 2 + ratio * 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
}

/** Quien maneja cada mitad, debajo de su segmento y con su color. */
function drawSeatLabels(scene: Scene, g: CanvasRenderingContext2D): void {
  const state = scene.game;
  g.font = FONT_SEAT;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let seat = 0; seat < BREAKOUT_SEATS; seat++) {
    g.fillStyle = scene.seatSoft[seat] ?? scene.textDim;
    g.fillText(scene.seatLabel[seat] ?? "", state.segX[seat] ?? 0, SEGMENT_Y + SEGMENT_HEIGHT + 54);
  }
}

function drawServeHint(scene: Scene, g: CanvasRenderingContext2D): void {
  g.font = FONT_BIG;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = scene.textDim;
  g.fillText(NUMBER_LABELS[Math.ceil(scene.game.serveTimerS)] ?? "", FIELD_W / 2, FIELD_H * 0.78);
}

/** Lo que pasó, en grande. En una sala nadie mira el HUD chico. */
function drawNotice(scene: Scene, g: CanvasRenderingContext2D): void {
  const fade = Math.min(1, scene.noticeMs / 400);
  g.globalAlpha = fade;
  g.font = FONT_NOTICE;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = scene.noticeFill[scene.noticeTone] ?? scene.ballColor;
  g.fillText(scene.noticeText, FIELD_W / 2, FIELD_H * 0.09);
  g.globalAlpha = 1;
}
