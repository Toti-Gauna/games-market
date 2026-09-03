import { useEffect, useMemo, useRef } from "react";
import type { GameProps } from "@/core/contract/game";
import { num } from "@/core/contract/settings";
import type { NetPlayer } from "@/core/contract/gameNet";
import { clamp, type Box } from "@/core/engine/collide";
import { withAlpha } from "@/core/engine/palette";
import { useGame2D, type FrameContext } from "@/core/engine/useGame2D";
import type { BotPolicy } from "@/core/net/mockNet";
import { useGameNet } from "@/core/net/useGameNet";
import type { ControlInput } from "@/core/contract/control";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  createPongState,
  paddlePosition,
  pongPoints,
  setPaddleTarget,
  stepPong,
  writePaddleBox,
  PONG_SEATS,
  type PongResult,
  type PongRules,
  type PongState,
} from "./logic";

/**
 * R1 · Supernova Pong.
 *
 * Es el juego que estrena la base de netcode, asi que importa mas por lo que
 * demuestra que por lo que es. Tres decisiones lo explican entero:
 *
 * 1. **Topologia `gamepad`: solo el proyector dibuja.** Este componente corre
 *    como host autoritativo (`useGameNet` con `role: "host"`, `seat: -1`):
 *    simula, puntua y renderiza. Los celulares son mandos y ya muestran su
 *    propia paleta con feedback local desde `GamepadController`.
 * 2. **Por eso no hay prediccion ni reconciliacion.** `prediction.ts` existe
 *    para los juegos `arena`, donde cada aparato dibuja la partida y hay algo
 *    propio que predecir. Aca el celular no renderiza ninguna entidad: no hay
 *    nada que predecir de su lado, y predecir un dedo humano del lado del host
 *    produce correcciones visibles, que es peor que el retardo.
 * 3. **El host recibe input y nada mas.** Un cliente que mandara estado o
 *    puntaje se ignora en `mockNet`; aca, ademas, la posicion que llega se
 *    saneia en `setPaddleTarget` antes de tocar la simulacion.
 *
 * Tampoco publica estado con `broadcastState`: en `gamepad` el celular no
 * dibuja nada, asi que mandarselo seria gastar canal para que lo tire. El dia
 * que el mando muestre el marcador, se prende una linea aca.
 */

/* ------------------------------------------------------------------ */
/* Constantes de la cancha                                              */
/* ------------------------------------------------------------------ */

const FIELD_W = 1600;
const FIELD_H = 900;
const BALL_RADIUS = 14;
const PADDLE_WIDTH = 18;
const PADDLE_INSET = 48;

/**
 * Paso de simulacion 1/120, no 1/60, como pide R1-PONG.md: con la pelota a
 * 2,2x de la velocidad inicial, en 1/60 recorre 29 unidades por paso contra
 * una paleta de 18 de ancho y el barrido tiene que resolver tramos largos.
 *
 * La base honra `step`, asi que el dt entra valiendo 1/120 y el acumulador de
 * abajo da un subpaso. Se conserva igual porque hace la fisica independiente
 * del paso del loop: si algun dia el juego corriera a 1/60, el reparto sigue
 * siendo exacto (1/60 es dos veces 1/120 en binario) y no acumula deriva.
 *
 * Nota historica: cuando se escribio Pong, `useGame2D` declaraba `step` y no
 * se lo pasaba a `createLoop`, asi que todo pedido de 1/120 recibia 1/60 en
 * silencio. Lo encontro este juego y esta arreglado en la base.
 */
const SIM_STEP = 1 / 120;
/** Tope de subpasos por cuadro: volver de una pestana oculta no dispara la espiral. */
const MAX_SUBSTEPS = 8;

const TRAIL_MAX = 12;
const TRAIL_REDUCED = 4;
const MAX_SPARKS = 120;
const SPARKS_PER_HIT = 10;
const SPARK_GRAVITY = 620;
const NOISE_SIZE = 64;

const GOAL_FLASH_MS = 120;
const GOAL_PULSE_MS = 420;
const SHAKE_MS = 300;
const SHAKE_PX = 6;
const NOTICE_MS = 2800;
const OVER_HOLD_MS = 1400;

/** Velocidad del teclado, en pantallas por segundo. */
const KEYBOARD_SPEED = 1.15;
/** Cuanto sigue mandando el teclado despues de soltar la tecla, para que el bot no le pelee. */
const KEYBOARD_HOLD_S = 1.5;

const BOT_HZ = 30;
const BOT_TICK_S = 1 / BOT_HZ;

/** Sobre 200 ms el juego se siente roto y hay que decirlo. Callarlo es peor. */
const LATENCY_WARN_MS = 200;

const DEG = Math.PI / 180;

const FONT_SCORE = '700 400px "Space Grotesk", sans-serif';
const FONT_NOTICE = '600 38px "Space Grotesk", sans-serif';
const FONT_SEAT = '600 26px "Space Grotesk", sans-serif';
const FONT_SERVE = '600 64px "Space Grotesk", sans-serif';

/** Etiquetas precalculadas: `String(n)` por cuadro es una asignacion por cuadro. */
const NUMBER_LABELS: readonly string[] = Array.from({ length: 32 }, (_, i) => String(i));
const CENTER_DASH: readonly number[] = [16, 24];
const NO_DASH: readonly number[] = [];

/* ------------------------------------------------------------------ */
/* Escena                                                               */
/* ------------------------------------------------------------------ */

type Scene = {
  pong: PongState;
  /** Resto del cuadro que todavia no se convirtio en subpasos de 1/120. */
  accumulator: number;
  viewSeat: number;

  /* Estela y particulas en arrays circulares preasignados. `pool.ts` obliga a
     pasar un callback a `each`, y eso es una closure nueva por cuadro; con
     arrays planos el loop no asigna absolutamente nada. */
  trailX: Float32Array;
  trailY: Float32Array;
  trailHead: number;
  trailLen: number;
  trailMax: number;

  sparkX: Float32Array;
  sparkY: Float32Array;
  sparkVx: Float32Array;
  sparkVy: Float32Array;
  sparkLife: Float32Array;
  sparkMax: Float32Array;
  sparkSeat: Uint8Array;
  sparkHead: number;

  /** Ruido sembrado una vez. El azar del render NO puede salir de `ctx.rng`:
      consumirlo en draw haria que el angulo del proximo saque dependa de los
      fps. */
  noise: Float32Array;
  noiseCursor: number;

  flashMs: number;
  shakeMs: number;
  goalPulse: Float32Array;
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
  seatScoreFill: string[];
  seatLabelFill: string[];
  trailFill: string[];
  ballColor: string;
  lineColor: string;
  flashColor: string;
  serveColor: string;
  noticeFill: string[];
};

type PongHud = { left: number; right: number; rally: number; longest: number };

const EMPTY_HUD: PongHud = { left: 0, right: 0, rally: 0, longest: 0 };

export default function PongGame({ config, net, signal, onFinish }: GameProps) {
  const options = useMemo(
    () => ({
      ballSpeed: num(config.settings, "ballSpeed", 780),
      ballAccel: num(config.settings, "ballAccel", 4),
      maxSpeedFactor: num(config.settings, "maxSpeedFactor", 2.2),
      serveAngle: num(config.settings, "serveAngle", 35),
      maxBounceAngle: num(config.settings, "maxBounceAngle", 60),
      paddleHeight: num(config.settings, "paddleHeight", 170),
      paddleFollow: num(config.settings, "paddleFollow", 0.35),
      pointsToWin: Math.round(num(config.settings, "pointsToWin", 7)),
      hardCap: Math.round(num(config.settings, "hardCap", 11)),
      serveDelay: num(config.settings, "serveDelay", 1.5),
      botError: num(config.settings, "botError", 70),
      botSpeed: num(config.settings, "botSpeed", 950),
    }),
    [config.settings],
  );

  const sceneRef = useRef<Scene | null>(null);
  /** El roster completo por id: `onPlayerLeave` solo trae el id y hay que saber de quien era. */
  const rosterRef = useRef<Map<string, NetPlayer>>(new Map());

  /* El bot lee los administrables por referencia: el puerto de red se crea una
     sola vez y se queda con la politica que le dieron, asi que tocar una
     perilla no puede exigir reconectar a nadie. */
  const tuningRef = useRef({ errorNorm: 0, speedNorm: 0 });
  tuningRef.current.errorNorm = options.botError / FIELD_H;
  tuningRef.current.speedNorm = options.botSpeed / FIELD_H;

  const botMemoryRef = useRef({
    position: new Float32Array(PONG_SEATS).fill(0.5),
    bias: new Float32Array(PONG_SEATS),
    rally: new Int32Array(PONG_SEATS).fill(-1),
    out: [
      { kind: "paddle", position: 0.5 },
      { kind: "paddle", position: 0.5 },
    ] as Extract<ControlInput, { kind: "paddle" }>[],
  });

  /**
   * La politica del bot. Sin esto, probar un Pong exige dos personas y el
   * juego no se puede desarrollar: es criterio de aceptacion de la base.
   *
   * Manda posicion, igual que una persona. No escribe estado ni puntaje: la
   * regla es la misma para todos.
   */
  const botPolicy = useMemo<BotPolicy<ControlInput>>(
    () => ({
      hz: BOT_HZ,
      policy: (bot) => {
        const memory = botMemoryRef.current;
        const seat = bot.seat >= 0 && bot.seat < PONG_SEATS ? bot.seat : 0;
        const out = memory.out[seat] ?? memory.out[0] ?? { kind: "paddle" as const, position: 0.5 };
        const scene = sceneRef.current;
        if (!scene) {
          out.position = 0.5;
          return out;
        }
        const pong = scene.pong;

        // El error se renueva en cada saque. Con un error fijo, el jugador le
        // aprende el desvio en dos rebotes y el bot no falla nunca mas.
        if (memory.rally[seat] !== pong.rallyId) {
          memory.rally[seat] = pong.rallyId;
          memory.bias[seat] = (bot.rng.next() * 2 - 1) * tuningRef.current.errorNorm;
        }

        const incoming = seat === 0 ? pong.ballVx < 0 : pong.ballVx > 0;
        // Cuando la pelota va para el otro lado vuelve al centro, como una
        // persona. Perseguirla siempre lo haria imbatible y aburrido.
        const desired = incoming
          ? pong.ballY / pong.rules.height + (memory.bias[seat] ?? 0)
          : 0.5;

        // Velocidad limitada: es lo unico que hace que una pelota acelerada le
        // gane. Un bot que teletransporta la paleta no se puede vencer.
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
    role: "host",
    // -1 = proyector que no juega. Las dos paletas quedan para los celulares.
    seat: -1,
    seats: PONG_SEATS,
    name: "Proyector",
    bot: botPolicy,

    onInput: (playerId, input) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const player = rosterRef.current.get(playerId);
      if (!player) return;
      const seat = player.seat;
      // El teclado local tiene prioridad mientras se lo usa: si no, el bot del
      // mismo asiento le pelea la paleta a quien esta probando el juego.
      if ((scene.kbHold[seat] ?? 0) > 0) return;
      // El telefono puede mandar cualquier control: aca solo interesa la paleta.
      if (input.kind !== "paddle") return;
      setPaddleTarget(scene.pong, seat, input.position);
    },

    onPlayerJoin: (player) => {
      rosterRef.current.set(player.id, player);
      const scene = sceneRef.current;
      if (!scene) return;
      scene.humanSeat[player.seat] = player.bot ? 0 : 1;
      scene.seatLabel[player.seat] = seatLabelFor(player.seat, player.bot ? "bot" : "human");
      if (!player.bot) {
        scene.leftSeat[player.seat] = 0;
        pushNotice(scene, `Jugador ${player.seat + 1} se conectó`, 0);
      }
    },

    onPlayerLeave: (playerId) => {
      const player = rosterRef.current.get(playerId);
      rosterRef.current.delete(playerId);
      const scene = sceneRef.current;
      if (!scene || !player || player.bot) return;
      // El bot entra solo desde `mockNet`: la partida no se cuelga porque
      // alguien cerro el celular. Aca solo hay que contarlo.
      scene.humanSeat[player.seat] = 0;
      scene.leftSeat[player.seat] = 1;
      scene.seatLabel[player.seat] = seatLabelFor(player.seat, "bot");
      pushNotice(scene, `Jugador ${player.seat + 1} se fue · sigue un bot`, 1);
    },
  });

  /*
   * El telefono no sabe que juego es: hay que decirle que dibujar. Pong pide
   * una paleta vertical y nada mas; la sesion se encarga de repetirselo a
   * quien entra tarde.
   */
  const netPort = netHandle.net;
  useEffect(() => {
    netPort?.sendControl({ layout: "paddle", orientation: "vertical" });
  }, [netPort]);

  const game = useGame2D<Scene, PongHud>(
    {
      design: { width: FIELD_W, height: FIELD_H },
      // Declarado para el dia que la base lo honre. Ver SIM_STEP.
      step: SIM_STEP,
      countdown: 3,
      hud: EMPTY_HUD,

      init: (ctx) => {
        const rules: PongRules = {
          width: FIELD_W,
          height: FIELD_H,
          ballRadius: BALL_RADIUS,
          ballSpeed: options.ballSpeed,
          accelPerHit: 1 + options.ballAccel / 100,
          maxSpeedFactor: options.maxSpeedFactor,
          serveAngleRad: options.serveAngle * DEG,
          maxBounceRad: options.maxBounceAngle * DEG,
          paddleWidth: PADDLE_WIDTH,
          paddleHeight: options.paddleHeight,
          paddleInset: PADDLE_INSET,
          paddleFollow: options.paddleFollow,
          pointsToWin: options.pointsToWin,
          hardCap: Math.max(options.pointsToWin, options.hardCap),
          serveDelayS: options.serveDelay,
        };

        const g = ctx.view.ctx;
        // Los degrades se crean una vez. Crearlos por cuadro es la forma mas
        // barata de perder los 60 fps del proyector.
        const bgGlow = g.createRadialGradient(
          FIELD_W / 2,
          FIELD_H / 2,
          0,
          FIELD_W / 2,
          FIELD_H / 2,
          FIELD_W * 0.62,
        );
        bgGlow.addColorStop(0, withAlpha(ctx.palette["--sn-violet-600"], 0.3));
        bgGlow.addColorStop(1, withAlpha(ctx.palette["--sn-violet-600"], 0));

        const vignette = g.createRadialGradient(
          FIELD_W / 2,
          FIELD_H / 2,
          FIELD_W * 0.34,
          FIELD_W / 2,
          FIELD_H / 2,
          FIELD_W * 0.78,
        );
        vignette.addColorStop(0, withAlpha(ctx.palette["--sn-bg"], 0));
        vignette.addColorStop(1, withAlpha(ctx.palette["--sn-bg"], 0.82));

        const trailMax = ctx.reducedMotion ? TRAIL_REDUCED : TRAIL_MAX;
        const trailFill: string[] = new Array(TRAIL_MAX);
        for (let i = 0; i < TRAIL_MAX; i++) {
          trailFill[i] = withAlpha(ctx.palette["--sn-text"], 0.34 * (1 - i / TRAIL_MAX));
        }

        const noise = new Float32Array(NOISE_SIZE);
        for (let i = 0; i < NOISE_SIZE; i++) noise[i] = ctx.rng.range(-1, 1);

        const scene: Scene = {
          pong: createPongState(rules, ctx.rng),
          accumulator: 0,
          viewSeat: clamp(Math.round(config.seat), 0, PONG_SEATS - 1),

          trailX: new Float32Array(TRAIL_MAX),
          trailY: new Float32Array(TRAIL_MAX),
          trailHead: 0,
          trailLen: 0,
          trailMax,

          sparkX: new Float32Array(MAX_SPARKS),
          sparkY: new Float32Array(MAX_SPARKS),
          sparkVx: new Float32Array(MAX_SPARKS),
          sparkVy: new Float32Array(MAX_SPARKS),
          sparkLife: new Float32Array(MAX_SPARKS),
          sparkMax: new Float32Array(MAX_SPARKS),
          sparkSeat: new Uint8Array(MAX_SPARKS),
          sparkHead: 0,

          noise,
          noiseCursor: 0,

          flashMs: 0,
          shakeMs: 0,
          goalPulse: new Float32Array(PONG_SEATS),
          overMs: 0,

          noticeText: "",
          noticeTone: 0,
          noticeMs: 0,

          humanSeat: new Uint8Array(PONG_SEATS),
          leftSeat: new Uint8Array(PONG_SEATS),
          seatLabel: [seatLabelFor(0, "free"), seatLabelFor(1, "free")],

          kbHold: new Float32Array(PONG_SEATS),
          kbTarget: new Float32Array(PONG_SEATS).fill(0.5),

          box: { x: 0, y: 0, w: PADDLE_WIDTH, h: rules.paddleHeight },
          bgGlow,
          vignette,
          seatColor: [ctx.palette["--sn-cyan-400"], ctx.palette["--sn-magenta-400"]],
          seatScoreFill: [
            withAlpha(ctx.palette["--sn-cyan-400"], 0.13),
            withAlpha(ctx.palette["--sn-magenta-400"], 0.13),
          ],
          seatLabelFill: [
            withAlpha(ctx.palette["--sn-cyan-300"], 0.7),
            withAlpha(ctx.palette["--sn-magenta-300"], 0.7),
          ],
          trailFill,
          ballColor: ctx.palette["--sn-text"],
          lineColor: withAlpha(ctx.palette["--sn-violet-500"], 0.26),
          flashColor: ctx.palette["--sn-text"],
          serveColor: withAlpha(ctx.palette["--sn-text-dim"], 0.75),
          noticeFill: [ctx.palette["--sn-success"], ctx.palette["--sn-warn"]],
        };

        // El puerto de red ya existe cuando esto corre, y su bot y su `onInput`
        // buscan la escena aca.
        sceneRef.current = scene;
        // Los asientos que ya estaban ocupados cuando arranco la partida.
        for (const player of rosterRef.current.values()) {
          scene.humanSeat[player.seat] = player.bot ? 0 : 1;
          scene.seatLabel[player.seat] = seatLabelFor(player.seat, player.bot ? "bot" : "human");
        }
        return scene;
      },

      update: (scene, dt, ctx) => {
        const pong = scene.pong;

        decayTimers(scene, dt);
        readKeyboard(scene, dt, ctx);
        updateSparks(scene, dt);

        if (pong.over) {
          // Un momento para ver el marcador final. Cortar en seco se siente
          // como un cuelgue, no como un partido terminado.
          scene.overMs += dt * 1000;
          if (scene.overMs >= (ctx.reducedMotion ? 0 : OVER_HOLD_MS)) ctx.finish(true);
          return;
        }

        scene.accumulator += dt;
        let steps = 0;
        while (scene.accumulator >= SIM_STEP && steps < MAX_SUBSTEPS) {
          scene.accumulator -= SIM_STEP;
          steps++;
          const event = stepPong(pong, SIM_STEP, ctx.rng);
          pushTrail(scene, pong.ballX, pong.ballY);

          if (event === "wall") {
            ctx.sfx.play("tick");
          } else if (event === "paddle") {
            onPaddleHit(scene, ctx);
          } else if (event === "goal" || event === "match") {
            onGoal(scene, ctx, event === "match");
            if (event === "match") break;
          }
        }
        // Deuda que no entra en el tope: se tira. Recuperarla despues seria
        // simular en camara rapida un tiempo que el jugador no vio.
        if (scene.accumulator > SIM_STEP * MAX_SUBSTEPS) scene.accumulator = 0;

        ctx.setHud({
          left: pong.scores[0] ?? 0,
          right: pong.scores[1] ?? 0,
          rally: pong.rally,
          longest: pong.longestRally,
        });
      },

      draw: (scene, g, ctx) => drawPong(scene, g, ctx.palette["--sn-bg"], ctx.reducedMotion, ctx.elapsedMs),

      outcome: (scene, completed, survivedMs) => {
        const pong = scene.pong;
        const seat = scene.viewSeat;
        const goalsFor = pong.scores[seat] ?? 0;
        const goalsAgainst = pong.scores[seat === 0 ? 1 : 0] ?? 0;
        const quit = (scene.leftSeat[seat] ?? 0) === 1;
        // Empate en un `force-end`: no hay premio de ganador. Al que se fue se
        // le paga el abandono, pero se le paga.
        const result: PongResult = quit ? "quit" : goalsFor > goalsAgainst ? "win" : "loss";

        return {
          completed: quit ? false : completed,
          points: pongPoints(goalsFor, goalsAgainst, result),
          meta: {
            asiento: seat + 1,
            golesPropios: goalsFor,
            golesRival: goalsAgainst,
            rallyMasLargo: pong.longestRally,
            ganador: pong.winner >= 0 ? pong.winner + 1 : null,
            motivo: pong.over ? "partido" : quit ? "abandono" : completed ? "tiempo" : "forzado",
            duracionS: Math.round(survivedMs / 1000),
          },
        };
      },
    },
    config,
    signal,
    onFinish,
  );

  const seatOne = findSeat(netHandle.players, 0);
  const seatTwo = findSeat(netHandle.players, 1);
  // El contenedor pasa su transporte crudo, pero Pong arma el suyo tipado
  // sobre la misma sala. Lo unico util de mirarlo es que las salas no
  // coincidan: seria la razon exacta por la que el celular no ve al proyector.
  const roomMismatch = net !== null && net.roomId !== config.roomId;

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
      instructions="Escaneá un QR para tomar una paleta con el celular. Sin celular: W y S mueven la izquierda, ↑ y ↓ la derecha. Los asientos vacíos los juega un bot."
      hud={
        <>
          <HudStat label={occupancyLabel(1, seatOne)} value={game.hud.left} dominant tone="cyan" />
          <HudStat label={occupancyLabel(2, seatTwo)} value={game.hud.right} dominant tone="magenta" />
          <HudStat label="Peloteo" value={game.hud.rally} />
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
          <h3 className="mb-1 text-lg">
            {game.hud.left === game.hud.right
              ? "Empate"
              : `Ganó el Jugador ${game.hud.left > game.hud.right ? 1 : 2}`}
          </h3>
          <p className="text-sm text-sn-muted">
            <span className="sn-num text-sn-cyan">{game.hud.left}</span>
            <span className="mx-2 text-sn-dim">·</span>
            <span className="sn-num text-sn-magenta">{game.hud.right}</span>
          </p>
          <p className="mt-1 text-xs text-sn-dim">
            Peloteo más largo: <span className="sn-num">{game.hud.longest}</span>
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

/** Que asiento tiene una persona y cual un bot, legible desde el fondo de la sala. */
function occupancyLabel(number: number, player: NetPlayer | null): string {
  if (!player) return `Jugador ${number} · libre`;
  return `Jugador ${number} · ${player.bot ? "bot" : "persona"}`;
}

function seatLabelFor(seat: number, kind: "human" | "bot" | "free"): string {
  const who = kind === "human" ? "Persona" : kind === "bot" ? "Bot" : "Libre";
  return `Jugador ${seat + 1} · ${who}`;
}

function pushNotice(scene: Scene, text: string, tone: number): void {
  scene.noticeText = text;
  scene.noticeTone = tone;
  scene.noticeMs = NOTICE_MS;
}

/* ------------------------------------------------------------------ */
/* Update                                                               */
/* ------------------------------------------------------------------ */

function decayTimers(scene: Scene, dt: number): void {
  const ms = dt * 1000;
  if (scene.flashMs > 0) scene.flashMs -= ms;
  if (scene.shakeMs > 0) scene.shakeMs -= ms;
  if (scene.noticeMs > 0) scene.noticeMs -= ms;
  for (let seat = 0; seat < PONG_SEATS; seat++) {
    const pulse = scene.goalPulse[seat] ?? 0;
    if (pulse > 0) scene.goalPulse[seat] = pulse - ms;
  }
}

/**
 * Teclado local, solo sobre los asientos que hoy juega un bot.
 *
 * Es lo que permite probar el Pong entero sin dos celulares. En cuanto una
 * persona toma el asiento, el celular manda y el teclado deja de existir.
 */
function readKeyboard(scene: Scene, dt: number, ctx: FrameContext<PongHud>): void {
  const keys = ctx.input.keys;
  for (let seat = 0; seat < PONG_SEATS; seat++) {
    let hold = scene.kbHold[seat] ?? 0;
    if (scene.humanSeat[seat] === 1) {
      scene.kbHold[seat] = 0;
      continue;
    }

    const up = seat === 0 ? keys.has("KeyW") : keys.has("ArrowUp");
    const down = seat === 0 ? keys.has("KeyS") : keys.has("ArrowDown");
    const dir = (down ? 1 : 0) - (up ? 1 : 0);

    if (dir !== 0) {
      // Al tomar el control se arranca donde esta la paleta, no donde quedo la
      // ultima vez: si no, la paleta salta al apretar la primera tecla.
      if (hold <= 0) scene.kbTarget[seat] = paddlePosition(scene.pong, seat);
      const next = clamp((scene.kbTarget[seat] ?? 0.5) + dir * KEYBOARD_SPEED * dt, 0, 1);
      scene.kbTarget[seat] = next;
      setPaddleTarget(scene.pong, seat, next);
      hold = KEYBOARD_HOLD_S;
    } else if (hold > 0) {
      hold = Math.max(0, hold - dt);
    }
    scene.kbHold[seat] = hold;
  }
}

function pushTrail(scene: Scene, x: number, y: number): void {
  scene.trailHead = (scene.trailHead + 1) % TRAIL_MAX;
  scene.trailX[scene.trailHead] = x;
  scene.trailY[scene.trailHead] = y;
  if (scene.trailLen < scene.trailMax) scene.trailLen++;
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

function spawnSparks(scene: Scene, x: number, y: number, seat: number, dirX: number): void {
  for (let n = 0; n < SPARKS_PER_HIT; n++) {
    const index = scene.sparkHead;
    scene.sparkHead = (index + 1) % MAX_SPARKS;
    const spread = nextNoise(scene);
    const power = nextNoise(scene);
    const angle = spread * 0.95;
    const speed = 240 + Math.abs(power) * 420;
    const life = 0.26 + Math.abs(spread) * 0.24;
    scene.sparkX[index] = x;
    scene.sparkY[index] = y;
    scene.sparkVx[index] = dirX * Math.cos(angle) * speed;
    scene.sparkVy[index] = Math.sin(angle) * speed;
    scene.sparkLife[index] = life;
    scene.sparkMax[index] = life;
    scene.sparkSeat[index] = seat;
  }
}

/** Feedback en dos canales: sonido y algo que se ve. Uno solo no alcanza. */
function onPaddleHit(scene: Scene, ctx: FrameContext<PongHud>): void {
  const pong = scene.pong;
  ctx.sfx.play("hit");
  if (ctx.reducedMotion) return;
  const dirX = pong.hitSeat === 0 ? 1 : -1;
  spawnSparks(scene, pong.hitX, pong.hitY, pong.hitSeat, dirX);
}

function onGoal(scene: Scene, ctx: FrameContext<PongHud>, matchOver: boolean): void {
  const pong = scene.pong;
  ctx.sfx.play(matchOver ? "win" : "pick");
  scene.goalPulse[pong.scorerSeat] = GOAL_PULSE_MS;
  if (ctx.reducedMotion) return;
  scene.flashMs = GOAL_FLASH_MS;
  scene.shakeMs = SHAKE_MS;
}

/* ------------------------------------------------------------------ */
/* Draw                                                                 */
/* ------------------------------------------------------------------ */

function drawPong(
  scene: Scene,
  g: CanvasRenderingContext2D,
  background: string,
  reducedMotion: boolean,
  elapsedMs: number,
): void {
  const pong = scene.pong;

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

  drawScoreboard(scene, g, reducedMotion);
  drawCenterLine(scene, g);
  drawTrail(scene, g);
  drawBall(scene, g, reducedMotion);
  drawPaddles(scene, g, reducedMotion);
  drawSparks(scene, g);

  if (pong.serveTimerS > 0 && !pong.over) drawServeCountdown(scene, g);
  if (scene.noticeMs > 0) drawNotice(scene, g);

  if (scene.flashMs > 0 && !reducedMotion) {
    g.globalAlpha = (scene.flashMs / GOAL_FLASH_MS) * 0.55;
    g.fillStyle = scene.flashColor;
    g.fillRect(0, 0, FIELD_W, FIELD_H);
    g.globalAlpha = 1;
  }

  g.fillStyle = scene.vignette;
  g.fillRect(0, 0, FIELD_W, FIELD_H);
  g.restore();
}

/** Marcador gigante y semitransparente DETRAS del juego: se lee desde el fondo
    de la sala y no le compite a la pelota. */
function drawScoreboard(scene: Scene, g: CanvasRenderingContext2D, reducedMotion: boolean): void {
  g.textAlign = "center";
  g.textBaseline = "middle";

  for (let seat = 0; seat < PONG_SEATS; seat++) {
    const score = scene.pong.scores[seat] ?? 0;
    const x = seat === 0 ? FIELD_W * 0.28 : FIELD_W * 0.72;
    const pulse = reducedMotion ? 0 : Math.max(0, scene.goalPulse[seat] ?? 0) / GOAL_PULSE_MS;

    g.save();
    g.translate(x, FIELD_H * 0.46);
    if (pulse > 0) g.scale(1 + pulse * 0.22, 1 + pulse * 0.22);
    g.font = FONT_SCORE;
    g.fillStyle = scene.seatScoreFill[seat] ?? scene.lineColor;
    g.fillText(NUMBER_LABELS[score] ?? "", 0, 0);
    g.restore();

    g.font = FONT_SEAT;
    g.fillStyle = scene.seatLabelFill[seat] ?? scene.lineColor;
    g.fillText(scene.seatLabel[seat] ?? "", x, FIELD_H * 0.14);
  }
}

function drawCenterLine(scene: Scene, g: CanvasRenderingContext2D): void {
  g.setLineDash(CENTER_DASH as number[]);
  g.strokeStyle = scene.lineColor;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(FIELD_W / 2, 0);
  g.lineTo(FIELD_W / 2, FIELD_H);
  g.stroke();
  g.setLineDash(NO_DASH as number[]);
}

function drawTrail(scene: Scene, g: CanvasRenderingContext2D): void {
  for (let i = 1; i < scene.trailLen; i++) {
    const index = (scene.trailHead - i + TRAIL_MAX * 2) % TRAIL_MAX;
    const fade = i / scene.trailMax;
    g.fillStyle = scene.trailFill[i] ?? scene.ballColor;
    g.beginPath();
    g.arc(scene.trailX[index] ?? 0, scene.trailY[index] ?? 0, BALL_RADIUS * (1 - fade * 0.7), 0, Math.PI * 2);
    g.fill();
  }
}

function drawBall(scene: Scene, g: CanvasRenderingContext2D, reducedMotion: boolean): void {
  const pong = scene.pong;
  g.fillStyle = scene.ballColor;
  if (!reducedMotion) {
    g.shadowColor = scene.ballColor;
    g.shadowBlur = 26;
  }
  g.beginPath();
  g.arc(pong.ballX, pong.ballY, BALL_RADIUS, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
}

function drawPaddles(scene: Scene, g: CanvasRenderingContext2D, reducedMotion: boolean): void {
  for (let seat = 0; seat < PONG_SEATS; seat++) {
    writePaddleBox(scene.pong, seat, scene.box);
    const color = scene.seatColor[seat] ?? scene.ballColor;
    g.fillStyle = color;
    if (!reducedMotion) {
      g.shadowColor = color;
      g.shadowBlur = 30;
    }
    g.beginPath();
    g.roundRect(scene.box.x, scene.box.y, scene.box.w, scene.box.h, 9);
    g.fill();
  }
  g.shadowBlur = 0;
}

/** Dos pasadas, una por color: agrupar por estilo evita un save/restore por particula. */
function drawSparks(scene: Scene, g: CanvasRenderingContext2D): void {
  for (let seat = 0; seat < PONG_SEATS; seat++) {
    g.fillStyle = scene.seatColor[seat] ?? scene.ballColor;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const life = scene.sparkLife[i] ?? 0;
      if (life <= 0 || scene.sparkSeat[i] !== seat) continue;
      const ratio = life / (scene.sparkMax[i] || 1);
      g.globalAlpha = ratio;
      g.beginPath();
      g.arc(scene.sparkX[i] ?? 0, scene.sparkY[i] ?? 0, 3 + ratio * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
}

function drawServeCountdown(scene: Scene, g: CanvasRenderingContext2D): void {
  g.font = FONT_SERVE;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = scene.serveColor;
  g.fillText(NUMBER_LABELS[Math.ceil(scene.pong.serveTimerS)] ?? "", FIELD_W / 2, FIELD_H * 0.66);
}

/** Quien entro y quien se fue, en grande. En una sala nadie mira el HUD chico. */
function drawNotice(scene: Scene, g: CanvasRenderingContext2D): void {
  const fade = Math.min(1, scene.noticeMs / 400);
  g.globalAlpha = fade;
  g.font = FONT_NOTICE;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = scene.noticeFill[scene.noticeTone] ?? scene.ballColor;
  g.fillText(scene.noticeText, FIELD_W / 2, FIELD_H * 0.86);
  g.globalAlpha = 1;
}
