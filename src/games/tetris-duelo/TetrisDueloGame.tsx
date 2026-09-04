import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "@/core/contract/game";
import { num } from "@/core/contract/settings";
import type {
  ControlButton,
  ControlHaptic,
  ControlInput,
  ControlSpec,
  ControlStatus,
} from "@/core/contract/control";
import type { NetPlayer } from "@/core/contract/gameNet";
import { withAlpha } from "@/core/engine/palette";
import { useGame2D, type DrawContext, type FrameContext } from "@/core/engine/useGame2D";
import { useGameNet } from "@/core/net/useGameNet";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  cellX,
  cellY,
  clearEvents,
  createMatch,
  finishByLines,
  finishByQuit,
  ghostY,
  hardDrop,
  holdPiece,
  pendingGarbage,
  pendingProgress,
  playerAt,
  rotate,
  setMoveHeld,
  setSoftDrop,
  startMatch,
  stepMatch,
  tetrisPoints,
  upcomingPiece,
  COLS,
  GARBAGE,
  HIDDEN_ROWS,
  ROWS,
  TETRIS_SEATS,
  VISIBLE_ROWS,
  type TetrisMatch,
  type TetrisPlayer,
  type TetrisRules,
} from "./logic";

/**
 * R6 · Tetris duelo.
 *
 * Topologia `gamepad`: **solo el proyector dibuja los dos tableros**. Los
 * celulares son mandos, y de eso salen las tres decisiones del archivo:
 *
 * 1. **No hay `broadcastState`.** El telefono no renderiza nada, asi que
 *    mandarle el tablero seria gastar canal para que lo tire. Lo unico que el
 *    mando necesita saber viaja en el `ControlSpec`: tus lineas y cuanta
 *    basura tenes en camino. Ese dato no es adorno —saber que vienen 4 filas
 *    cambia lo que hacés ahora— y por eso va con `tone: "warn"`.
 * 2. **El host recibe input y nada mas.** Del telefono llegan bordes
 *    ("empece a mantener", "solte") y pulsos. La repeticion (DAS/ARR) la
 *    cuenta `logic.ts` en esta maquina: calcularla en el telefono pondria la
 *    latencia adentro del ritmo del juego.
 * 3. **No arranca con un solo jugador.** Un duelo de uno no es un duelo. Si
 *    alguien se cae, la partida se pausa con 30 s de gracia y la pieza queda
 *    flotando; si no vuelve, el otro gana por abandono.
 *
 * `collide.ts` no se usa: la colision de un Tetris es comprobar celdas de una
 * grilla, y esta en `logic.ts`.
 */

/* ------------------------------------------------------------------ */
/* Escenario                                                            */
/* ------------------------------------------------------------------ */

const FIELD_W = 1600;
const FIELD_H = 900;

const CELL = 32;
const BOARD_W = COLS * CELL;
const BOARD_H = VISIBLE_ROWS * CELL;
const BOARD_Y = 196;
/** Izquierda de cada tablero. Entre los dos queda la calle de la basura. */
const BOARD_LEFT_X = 288;
const BOARD_RIGHT_X = 992;
const BOARD_X: readonly number[] = [BOARD_LEFT_X, BOARD_RIGHT_X];
const PANEL_X: readonly number[] = [40, 1328];
const PANEL_W = 232;
const PREVIEW_CELL = 20;

const LANE_LEFT = BOARD_LEFT_X + BOARD_W;
const LANE_RIGHT = BOARD_RIGHT_X;
const LANE_CENTER = (LANE_LEFT + LANE_RIGHT) / 2;
const TRANSIT_Y = 300;
const TRANSIT_STEP = 58;
const TRANSIT_W = 92;
const TRANSIT_H = 40;

/** Barra de lo que viene en camino, pegada al borde interno del tablero. */
const PENDING_BAR_W = 14;

const OVER_HOLD_MS = 2200;
const FLASH_MS = 260;
const SHAKE_MS = 220;
const SHAKE_PX = 7;
const PUSH_MS = 220;
const TINT_MS = 300;
const DEAD_MS = 900;

const FONT_NAME = '600 26px "Space Grotesk", sans-serif';
const FONT_LINES = '700 76px "Space Grotesk", sans-serif';
const FONT_LABEL = '600 15px "Space Grotesk", sans-serif';
const FONT_SMALL = '500 18px "Space Grotesk", sans-serif';
const FONT_TRANSIT = '700 22px "Space Grotesk", sans-serif';
const FONT_WAIT = '600 42px "Space Grotesk", sans-serif';

/** `String(n)` por cuadro es una asignacion por cuadro. */
const NUMBER_LABELS: readonly string[] = Array.from({ length: 400 }, (_, i) => String(i));
/** Lo mismo para las etiquetas compuestas del dibujo: se arman una sola vez. */
const TRANSIT_LEFT: readonly string[] = Array.from({ length: 24 }, (_, i) => `◀ ${i}`);
const TRANSIT_RIGHT: readonly string[] = Array.from({ length: 24 }, (_, i) => `${i} ▶`);
const SEAT_NAMES: readonly string[] = ["Jugador 1", "Jugador 2"];
const WAIT_TITLES: readonly string[] = ["Esperando al Jugador 1…", "Esperando al Jugador 2…"];
/** Cuantas tandas se dibujan viajando. Mas que esto es ruido, no informacion. */
const TRANSIT_MAX = 6;

function labelOf(value: number): string {
  return NUMBER_LABELS[value] ?? "···";
}

/* ------------------------------------------------------------------ */
/* El mando                                                             */
/* ------------------------------------------------------------------ */

const BTN_HOLD = "hold";
const BTN_LEFT = "left";
const BTN_SOFT = "soft";
const BTN_RIGHT = "right";
const BTN_CCW = "ccw";
const BTN_CW = "cw";
const BTN_DROP = "drop";

/**
 * Botones, no gestos: un deslizamiento hacia abajo que querias corto termina
 * en caida dura y arruina la partida. Los de mover van con `hold` porque la
 * repeticion la calcula el host. La caida dura va en `danger`, que el mando
 * dibuja separada del resto: es irreversible.
 */
const PAD_BUTTONS: readonly ControlButton[] = [
  { id: BTN_HOLD, label: "RETENER", group: "top" },
  { id: BTN_LEFT, label: "◀", hold: true, group: "main" },
  { id: BTN_SOFT, label: "▼", hold: true, group: "main" },
  { id: BTN_RIGHT, label: "▶", hold: true, group: "main" },
  { id: BTN_CCW, label: "↺", group: "rotate" },
  { id: BTN_CW, label: "↻", group: "rotate" },
  { id: BTN_DROP, label: "CAÍDA DURA", group: "danger" },
];

/**
 * Vibracion: el segundo canal de feedback. Corta al fijar, larga al completar,
 * y mas larga todavia en un tetris — fijar una pieza y hacer cuatro lineas no
 * se pueden sentir igual.
 *
 * Indices del `hapticKind` de la escena: 0 nada, 1 fijado, 2 lineas, 3 tetris.
 */
const HAPTIC_PREFIX: readonly string[] = ["", "lock-", "clear-", "tetris-"];
const HAPTIC_PATTERN: readonly (number | readonly number[])[] = [
  0,
  18,
  [45, 45, 95],
  [65, 45, 65, 45, 150],
];

/**
 * Cada cuanto se revisa si al mando le cambio algo que mostrar.
 *
 * 100 ms y no 200: aca ademas viaja la vibracion, y un golpe tactil que llega
 * un quinto de segundo despues de fijar la pieza ya no se lee como la pieza.
 */
const CONTROL_TICK_MS = 100;
/** Reenvio periodico: lo dirigido no se guarda, y quien vuelve tiene que ver algo. */
const CONTROL_RESEND_MS = 1500;

/* ------------------------------------------------------------------ */
/* Teclado local — para probar el duelo sin dos celulares               */
/* ------------------------------------------------------------------ */

type KeyAction = {
  seat: number;
  kind: "move" | "soft" | "rotate" | "hold" | "drop";
  value: number;
};

const KEY_MAP: Record<string, KeyAction> = {
  KeyA: { seat: 0, kind: "move", value: -1 },
  KeyD: { seat: 0, kind: "move", value: 1 },
  KeyS: { seat: 0, kind: "soft", value: 0 },
  KeyQ: { seat: 0, kind: "rotate", value: -1 },
  KeyE: { seat: 0, kind: "rotate", value: 1 },
  KeyW: { seat: 0, kind: "hold", value: 0 },
  Space: { seat: 0, kind: "drop", value: 0 },
  ArrowLeft: { seat: 1, kind: "move", value: -1 },
  ArrowRight: { seat: 1, kind: "move", value: 1 },
  ArrowDown: { seat: 1, kind: "soft", value: 0 },
  Comma: { seat: 1, kind: "rotate", value: -1 },
  ArrowUp: { seat: 1, kind: "rotate", value: 1 },
  Period: { seat: 1, kind: "hold", value: 0 },
  Enter: { seat: 1, kind: "drop", value: 0 },
};

/* ------------------------------------------------------------------ */
/* Escena                                                               */
/* ------------------------------------------------------------------ */

type Scene = {
  match: TetrisMatch;
  rules: TetrisRules;
  graceTotalMs: number;
  graceMs: number;
  /** Asiento que falta. -1 = estan los dos y la partida corre. */
  waitingSeat: number;
  overMs: number;
  viewSeat: number;

  /** Compartidos con los refs del componente: se escriben desde la red. */
  human: Uint8Array;
  keyboard: Uint8Array;
  names: string[];

  /** Sube una vez por evento vibrable. Es lo que hace unico el `id` del haptico. */
  hapticSeq: Int32Array;
  /** Que fue lo ultimo: 1 fijado, 2 lineas, 3 tetris. */
  hapticKind: Uint8Array;

  flashMs: Float32Array;
  shakeMs: Float32Array;
  pushMs: Float32Array;
  tintMs: Float32Array;
  deadMs: Float32Array;

  /** Ultimo HUD publicado: sin esto, `setHud` asigna un objeto por cuadro. */
  hudLines: Int32Array;
  hudPending: Int32Array;
  hudWinner: number;
  hudWaitingSeat: number;
  hudGraceS: number;

  /** Colores por valor de celda: 0 vacio, 1..7 piezas, 8 basura. */
  pieceFill: string[];
  pieceEdge: string[];
  seatColor: string[];
  bgColor: string;
  panelFill: string;
  panelLine: string;
  gridColor: string;
  ghostColor: string;
  textColor: string;
  dimColor: string;
  warnColor: string;
  dangerColor: string;
  flashColor: string;
  tintColor: string;
  deadColor: string;
  veilColor: string;
  bgGlow: CanvasGradient;
};

type TetrisHud = {
  lines0: number;
  lines1: number;
  pending0: number;
  pending1: number;
  waitingSeat: number;
  graceS: number;
  winner: number;
};

const EMPTY_HUD: TetrisHud = {
  lines0: 0,
  lines1: 0,
  pending0: 0,
  pending1: 0,
  waitingSeat: -1,
  graceS: 0,
  winner: -1,
};

export default function TetrisDueloGame({ config, signal, onFinish }: GameProps) {
  const options = useMemo(
    () => ({
      gravityMs: num(config.settings, "gravityMs", 800),
      gravityFactor: num(config.settings, "gravityFactor", 92) / 100,
      linesPerLevel: Math.round(num(config.settings, "linesPerLevel", 10)),
      softDropFactor: num(config.settings, "softDropFactor", 20),
      dasMs: num(config.settings, "dasMs", 130),
      arrMs: num(config.settings, "arrMs", 30),
      lockDelayMs: num(config.settings, "lockDelayMs", 500),
      maxLockResets: Math.round(num(config.settings, "maxLockResets", 15)),
      clearDelayMs: num(config.settings, "clearDelayMs", 180),
      garbageDouble: Math.round(num(config.settings, "garbageDouble", 1)),
      garbageTriple: Math.round(num(config.settings, "garbageTriple", 2)),
      garbageTetris: Math.round(num(config.settings, "garbageTetris", 4)),
      comboBonus: Math.round(num(config.settings, "comboBonus", 1)),
      garbageWindowMs: num(config.settings, "garbageWindowMs", 1000),
      pointsSingle: num(config.settings, "pointsSingle", 100),
      pointsDouble: num(config.settings, "pointsDouble", 300),
      pointsTriple: num(config.settings, "pointsTriple", 500),
      pointsTetris: num(config.settings, "pointsTetris", 800),
      pointsPerGarbage: num(config.settings, "pointsPerGarbage", 60),
      pointsWin: num(config.settings, "pointsWin", 600),
      graceMs: num(config.settings, "graceSeconds", 30) * 1000,
    }),
    [config.settings],
  );

  const sceneRef = useRef<Scene | null>(null);
  const phaseRef = useRef<string>("intro");
  /** Roster por id: `onPlayerLeave` solo trae el id y hay que saber de quien era. */
  const rosterRef = useRef<Map<string, NetPlayer>>(new Map());
  /** A quien mandarle el mando de cada asiento. */
  const seatPlayerRef = useRef<Array<string | null>>([null, null]);
  /** Ocupacion: vive en refs porque alguien puede sentarse antes de que exista la escena. */
  const humanRef = useRef<Uint8Array>(new Uint8Array(TETRIS_SEATS));
  const keyboardRef = useRef<Uint8Array>(new Uint8Array(TETRIS_SEATS));
  const namesRef = useRef<string[]>(["Jugador 1", "Jugador 2"]);
  /** Bitmask de asientos listos. Es lo unico de la ocupacion que React necesita. */
  const [readyMask, setReadyMask] = useState(0);
  const [armed, setArmed] = useState(false);

  const refreshReady = useCallback(() => {
    let mask = 0;
    for (let seat = 0; seat < TETRIS_SEATS; seat++) {
      const taken = (humanRef.current[seat] ?? 0) === 1 || (keyboardRef.current[seat] ?? 0) === 1;
      if (taken) mask |= 1 << seat;
    }
    setReadyMask(mask);
  }, []);

  /**
   * La unica puerta por la que entra el input. La usan el celular y el teclado
   * local: son la misma intencion por dos caminos distintos.
   */
  const applyInput = useCallback((seat: number, input: ControlInput) => {
    const scene = sceneRef.current;
    if (!scene || seat < 0 || seat >= TETRIS_SEATS) return;
    // Nada de mover piezas en pausa, en la cuenta regresiva ni con la partida
    // terminada: seria jugar sin que el rival pueda responder.
    if (phaseRef.current !== "playing" || scene.waitingSeat >= 0 || scene.match.over) return;
    const match = scene.match;

    if (input.kind === "hold") {
      if (input.buttonId === BTN_LEFT) setMoveHeld(match, seat, -1, input.pressed);
      else if (input.buttonId === BTN_RIGHT) setMoveHeld(match, seat, 1, input.pressed);
      else if (input.buttonId === BTN_SOFT) setSoftDrop(match, seat, input.pressed);
      return;
    }
    if (input.kind !== "press") return;
    if (input.buttonId === BTN_CCW) rotate(match, seat, -1);
    else if (input.buttonId === BTN_CW) rotate(match, seat, 1);
    else if (input.buttonId === BTN_HOLD) holdPiece(match, seat);
    else if (input.buttonId === BTN_DROP) hardDrop(match, seat);
  }, []);

  const netHandle = useGameNet<ControlInput, never>({
    // La sala la elige el contenedor: tiene que coincidir con el QR que
    // escanean los celulares.
    roomId: config.roomId,
    // Lo elige el contenedor, igual que la sala: el celular entra por donde
    // dice el QR y el proyector tiene que estar en la misma red.
    transport: config.transport,
    role: "host",
    // -1 = proyector que no juega. Los dos tableros son de los celulares.
    seat: -1,
    seats: TETRIS_SEATS,
    name: "Proyector",
    // Sin bot a proposito: un Tetris de bot no ensena nada y el duelo pide
    // dos personas. Sin las dos, la partida no arranca.

    onInput: (playerId, input) => {
      const player = rosterRef.current.get(playerId);
      if (!player || player.bot) return;
      applyInput(player.seat, input);
    },

    onPlayerJoin: (player) => {
      rosterRef.current.set(player.id, player);
      if (player.bot) return;
      humanRef.current[player.seat] = 1;
      keyboardRef.current[player.seat] = 0;
      seatPlayerRef.current[player.seat] = player.id;
      namesRef.current[player.seat] = player.name;
      refreshReady();
    },

    onPlayerLeave: (playerId) => {
      const player = rosterRef.current.get(playerId);
      rosterRef.current.delete(playerId);
      if (!player || player.bot) return;
      humanRef.current[player.seat] = 0;
      seatPlayerRef.current[player.seat] = null;
      namesRef.current[player.seat] = `Jugador ${player.seat + 1}`;
      refreshReady();
    },
  });

  const game = useGame2D<Scene, TetrisHud>(
    {
      design: { width: FIELD_W, height: FIELD_H },
      // 1/60 alcanza: el movimiento es por celdas y los tiempos se cuentan en
      // ms, no en cuadros.
      step: 1 / 60,
      countdown: 3,
      hud: EMPTY_HUD,

      init: (ctx) => {
        const rules: TetrisRules = {
          gravityMs: options.gravityMs,
          gravityFactor: options.gravityFactor,
          linesPerLevel: options.linesPerLevel,
          softDropFactor: options.softDropFactor,
          dasMs: options.dasMs,
          arrMs: options.arrMs,
          lockDelayMs: options.lockDelayMs,
          maxLockResets: options.maxLockResets,
          clearDelayMs: options.clearDelayMs,
          garbageTable: [0, options.garbageDouble, options.garbageTriple, options.garbageTetris],
          comboBonus: options.comboBonus,
          garbageWindowMs: options.garbageWindowMs,
          lineScores: [
            options.pointsSingle,
            options.pointsDouble,
            options.pointsTriple,
            options.pointsTetris,
          ],
          pointsPerGarbage: options.pointsPerGarbage,
          pointsWin: options.pointsWin,
        };

        const palette = ctx.palette;
        const g = ctx.view.ctx;
        const bgGlow = g.createLinearGradient(0, 0, 0, FIELD_H);
        bgGlow.addColorStop(0, withAlpha(palette["--sn-violet-600"], 0.22));
        bgGlow.addColorStop(1, withAlpha(palette["--sn-violet-600"], 0));

        // Siete colores distinguibles, todos del tema. La basura va gris: no
        // es tuya, y tiene que leerse distinta desde el fondo de la sala.
        const fills = [
          palette["--sn-bg"],
          palette["--sn-cyan-400"],
          palette["--sn-violet-400"],
          palette["--sn-warn"],
          palette["--sn-magenta-300"],
          palette["--sn-success"],
          palette["--sn-violet-300"],
          palette["--sn-danger"],
          palette["--sn-line"],
        ];

        const match = createMatch(rules, ctx.rng);
        startMatch(match);

        const scene: Scene = {
          match,
          rules,
          graceTotalMs: options.graceMs,
          graceMs: options.graceMs,
          waitingSeat: -1,
          overMs: 0,
          viewSeat: config.seat >= 1 ? 1 : 0,

          human: humanRef.current,
          keyboard: keyboardRef.current,
          names: namesRef.current,

          hapticSeq: new Int32Array(TETRIS_SEATS),
          hapticKind: new Uint8Array(TETRIS_SEATS),

          flashMs: new Float32Array(TETRIS_SEATS),
          shakeMs: new Float32Array(TETRIS_SEATS),
          pushMs: new Float32Array(TETRIS_SEATS),
          tintMs: new Float32Array(TETRIS_SEATS),
          deadMs: new Float32Array(TETRIS_SEATS),

          hudLines: new Int32Array(TETRIS_SEATS),
          hudPending: new Int32Array(TETRIS_SEATS),
          hudWinner: -1,
          hudWaitingSeat: -1,
          hudGraceS: 0,

          pieceFill: fills,
          pieceEdge: fills.map((hex) => withAlpha(hex, 0.55)),
          seatColor: [palette["--sn-cyan-400"], palette["--sn-magenta-400"]],
          bgColor: palette["--sn-bg"],
          panelFill: withAlpha(palette["--sn-panel"], 0.55),
          panelLine: withAlpha(palette["--sn-line"], 0.9),
          gridColor: withAlpha(palette["--sn-line-soft"], 0.5),
          ghostColor: withAlpha(palette["--sn-text"], 0.28),
          textColor: palette["--sn-text"],
          dimColor: palette["--sn-text-dim"],
          warnColor: palette["--sn-warn"],
          dangerColor: palette["--sn-danger"],
          flashColor: palette["--sn-text"],
          tintColor: withAlpha(palette["--sn-danger"], 0.22),
          deadColor: withAlpha(palette["--sn-text-dim"], 0.45),
          veilColor: withAlpha(palette["--sn-bg"], 0.74),
          bgGlow,
        };

        sceneRef.current = scene;
        return scene;
      },

      update: (scene, dt, ctx) => {
        const dtMs = dt * 1000;
        const match = scene.match;

        if (match.over) {
          decayFx(scene, dtMs);
          // Un momento para leer el resultado. Cortar en seco se siente como
          // un cuelgue, no como un duelo terminado.
          scene.overMs += dtMs;
          if (scene.overMs >= (ctx.reducedMotion ? 600 : OVER_HOLD_MS)) ctx.finish(true);
          publishHud(scene, ctx);
          return;
        }

        // Sin los dos, no se juega. La pieza queda flotando donde estaba.
        const missing = missingSeat(scene);
        if (missing >= 0) {
          if (scene.waitingSeat < 0) {
            scene.waitingSeat = missing;
            for (let seat = 0; seat < TETRIS_SEATS; seat++) {
              // Los costados quedan sueltos: si no, al volver la pieza sale
              // disparada por un boton que ya nadie tiene apretado.
              setMoveHeld(match, seat, -1, false);
              setMoveHeld(match, seat, 1, false);
              setSoftDrop(match, seat, false);
            }
          }
          scene.graceMs -= dtMs;
          if (scene.graceMs <= 0) {
            finishByQuit(match, missing);
            ctx.sfx.play("lose");
          }
          decayFx(scene, dtMs);
          publishHud(scene, ctx);
          return;
        }

        if (scene.waitingSeat >= 0) {
          scene.waitingSeat = -1;
          // Volvio: la gracia se recarga entera. Cobrarle lo que ya gasto
          // castigaria dos veces la misma caida de red.
          scene.graceMs = scene.graceTotalMs;
        }

        stepMatch(match, dtMs);
        readEvents(scene, ctx);
        decayFx(scene, dtMs);
        publishHud(scene, ctx);
      },

      draw: (scene, g, ctx) => drawScene(scene, g, ctx),

      outcome: (scene, completed, survivedMs) => {
        const match = scene.match;
        // Se acabo el tiempo o llego `force-end`: gana quien tenga mas lineas.
        if (!match.over) finishByLines(match, completed ? "time" : "forced");

        const seat = scene.viewSeat;
        const rival = seat === 0 ? 1 : 0;

        return {
          // "Completado" es solo el duelo jugado hasta el desborde: por tiempo,
          // por force-end o por abandono se corto antes.
          completed: match.reason === "topout",
          points: tetrisPoints(match, seat),
          meta: {
            motivo: reasonLabel(match.reason),
            ganador: match.winner >= 0 ? match.winner + 1 : null,
            duracionS: Math.round(survivedMs / 1000),
            // Los dos resultados viajan aca: el contrato admite un solo
            // `onFinish`, asi que el outcome de cada asiento va en `meta` y el
            // contenedor puede pagarle a los dos.
            jugadores: [
              seatSummary(match, seat),
              seatSummary(match, rival),
            ],
          },
        };
      },
    },
    config,
    signal,
    onFinish,
  );

  /* Espejo de la fase para el input, que llega por red y no por render. */
  useEffect(() => {
    phaseRef.current = game.phase;
  }, [game.phase]);

  /* --------------------------------------------------------------- */
  /* El mando: lo unico que el telefono necesita saber                 */
  /* --------------------------------------------------------------- */
  const netPort = netHandle.net;
  const gamePhase = game.phase;
  useEffect(() => {
    if (!netPort) return;
    const lastLines = [-1, -1];
    const lastPending = [-1, -1];
    const lastNotice = ["", ""];
    const lastHaptic = [-1, -1];
    const lastSentAt = [0, 0];

    const push = () => {
      const scene = sceneRef.current;
      const now = performance.now();
      for (let seat = 0; seat < TETRIS_SEATS; seat++) {
        const playerId = seatPlayerRef.current[seat];
        if (!playerId) continue;

        let lines = 0;
        let pending = 0;
        let notice = "Preparando la partida…";
        let enabled = false;
        let hapticSeq = 0;
        let hapticKind = 0;

        if (scene) {
          hapticSeq = scene.hapticSeq[seat] ?? 0;
          hapticKind = scene.hapticKind[seat] ?? 0;
          const player = playerAt(scene.match, seat);
          lines = player.lines;
          pending = pendingGarbage(player);
          if (scene.match.over) notice = scene.match.winner === seat ? "¡Ganaste!" : "Se terminó";
          else if (scene.waitingSeat >= 0) notice = "En pausa: falta el otro jugador";
          else if (player.phase === "dead") notice = "Te desbordaste";
          else if (gamePhase === "playing") notice = "";
          else if (gamePhase === "countdown") notice = "Ya empieza…";
          else notice = "Esperando al proyector…";
          enabled = gamePhase === "playing" && scene.waitingSeat < 0 && player.phase !== "dead" && !scene.match.over;
        }

        const stale = now - (lastSentAt[seat] ?? 0) > CONTROL_RESEND_MS;
        if (
          !stale &&
          lines === lastLines[seat] &&
          pending === lastPending[seat] &&
          notice === lastNotice[seat] &&
          hapticSeq === lastHaptic[seat]
        ) {
          continue;
        }
        lastLines[seat] = lines;
        lastPending[seat] = pending;
        lastNotice[seat] = notice;
        lastHaptic[seat] = hapticSeq;
        lastSentAt[seat] = now;

        const status: ControlStatus[] = [
          { label: "Tus líneas", value: String(lines) },
          {
            label: "Basura en camino",
            value: String(pending),
            // Que vengan 4 filas cambia lo que hacés ahora: por eso destaca.
            tone: pending >= 4 ? "danger" : pending > 0 ? "warn" : "default",
          },
        ];
        // El `id` sube solo cuando pasa el evento, asi que el reenvio
        // periodico llega con el mismo y el telefono no vuelve a vibrar.
        const haptic: ControlHaptic | null =
          hapticKind > 0
            ? {
                id: (HAPTIC_PREFIX[hapticKind] ?? "ev-") + hapticSeq,
                pattern: HAPTIC_PATTERN[hapticKind] ?? 18,
              }
            : null;
        const spec: ControlSpec = {
          layout: "pad",
          buttons: PAD_BUTTONS,
          status,
          enabled,
          ...(notice ? { notice } : {}),
          ...(haptic ? { haptic } : {}),
        };
        netPort.sendControl(spec, playerId);
      }
    };

    push();
    const timer = window.setInterval(push, CONTROL_TICK_MS);
    return () => window.clearInterval(timer);
  }, [netPort, gamePhase]);

  /* --------------------------------------------------------------- */
  /* Teclado local: probar el duelo sin dos celulares                  */
  /* --------------------------------------------------------------- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      // El celular manda sobre el teclado: si hay alguien sentado ahi, esto no
      // existe.
      if ((humanRef.current[action.seat] ?? 0) === 1) return;
      e.preventDefault();
      if ((keyboardRef.current[action.seat] ?? 0) === 0) {
        keyboardRef.current[action.seat] = 1;
        refreshReady();
      }
      if (e.repeat) return;
      if (action.kind === "move") {
        applyInput(action.seat, {
          kind: "hold",
          buttonId: action.value < 0 ? BTN_LEFT : BTN_RIGHT,
          pressed: true,
        });
      } else if (action.kind === "soft") {
        applyInput(action.seat, { kind: "hold", buttonId: BTN_SOFT, pressed: true });
      } else if (action.kind === "rotate") {
        applyInput(action.seat, { kind: "press", buttonId: action.value < 0 ? BTN_CCW : BTN_CW });
      } else if (action.kind === "hold") {
        applyInput(action.seat, { kind: "press", buttonId: BTN_HOLD });
      } else {
        applyInput(action.seat, { kind: "press", buttonId: BTN_DROP });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      if ((humanRef.current[action.seat] ?? 0) === 1) return;
      if (action.kind === "move") {
        applyInput(action.seat, {
          kind: "hold",
          buttonId: action.value < 0 ? BTN_LEFT : BTN_RIGHT,
          pressed: false,
        });
      } else if (action.kind === "soft") {
        applyInput(action.seat, { kind: "hold", buttonId: BTN_SOFT, pressed: false });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [applyInput, refreshReady]);

  /* --------------------------------------------------------------- */
  /* Arranque: no se juega un duelo de a uno                           */
  /* --------------------------------------------------------------- */
  const bothReady = readyMask === 3;
  const startGame = game.start;
  const handleStart = useCallback(() => {
    setArmed(true);
    if (readyMask === 3) startGame();
  }, [readyMask, startGame]);

  useEffect(() => {
    if (armed && bothReady && game.phase === "intro") startGame();
  }, [armed, bothReady, game.phase, startGame]);

  const seatOne = findSeat(netHandle.players, 0);
  const seatTwo = findSeat(netHandle.players, 1);
  const hud = game.hud;

  return (
    <GameStage
      containerRef={game.containerRef}
      canvasRef={game.canvasRef}
      phase={game.phase}
      countdownLeft={game.countdownLeft}
      muted={game.muted}
      onToggleMuted={game.toggleMuted}
      onStart={handleStart}
      onPause={game.pause}
      onResume={game.resume}
      onRestart={game.restart}
      aspect={FIELD_W / FIELD_H}
      {...(config.debug ? { fps: game.fps } : {})}
      instructions="Dos celulares, un duelo: las líneas que hacés le mandan basura al otro. Sin celulares, el Jugador 1 usa A D para mover, S para bajar, Q E para rotar, W para retener y Espacio para la caída dura; el Jugador 2, las flechas, , y ↑ para rotar, . para retener y Enter para la caída dura."
      introExtra={
        <div className="rounded-sn border border-sn-line-soft bg-sn-bg-elev px-3 py-2 text-xs">
          <p className="mb-1 text-sn-dim">Hacen falta los dos jugadores.</p>
          <p className={readyMask & 1 ? "text-sn-cyan" : "text-sn-muted"}>
            {readyMask & 1 ? "✓" : "○"} Jugador 1 {seatOne && !seatOne.bot ? "· celular" : ""}
          </p>
          <p className={readyMask & 2 ? "text-sn-magenta" : "text-sn-muted"}>
            {readyMask & 2 ? "✓" : "○"} Jugador 2 {seatTwo && !seatTwo.bot ? "· celular" : ""}
          </p>
          {armed && !bothReady && (
            <p className="mt-1 text-sn-warn">Arranca solo cuando estén los dos.</p>
          )}
        </div>
      }
      hud={
        <>
          <HudStat label="Jugador 1 · líneas" value={hud.lines0} dominant tone="cyan" />
          <HudStat label="Jugador 2 · líneas" value={hud.lines1} dominant tone="magenta" />
          {hud.pending0 > 0 && <HudStat label="Basura a J1" value={hud.pending0} tone="warn" />}
          {hud.pending1 > 0 && <HudStat label="Basura a J2" value={hud.pending1} tone="warn" />}
          {hud.waitingSeat >= 0 && (
            <HudStat
              label={`Falta el Jugador ${hud.waitingSeat + 1}`}
              value={`${hud.graceS} s`}
              tone="danger"
            />
          )}
          {game.timeLeftMs !== null && (
            <HudStat
              label="Tiempo"
              value={formatClock(game.timeLeftMs)}
              tone={game.timeLeftMs < 15_000 ? "danger" : "default"}
            />
          )}
        </>
      }
      summary={
        <>
          <h3 className="mb-1 text-lg">
            {hud.winner < 0 ? "Empate" : `Ganó el Jugador ${hud.winner + 1}`}
          </h3>
          <p className="text-sm text-sn-muted">
            <span className="sn-num text-sn-cyan">{hud.lines0}</span>
            <span className="mx-2 text-sn-dim">líneas</span>
            <span className="sn-num text-sn-magenta">{hud.lines1}</span>
          </p>
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Ayudas del componente                                                */
/* ------------------------------------------------------------------ */

function findSeat(players: readonly NetPlayer[], seat: number): NetPlayer | null {
  for (const player of players) {
    if (player.seat === seat) return player;
  }
  return null;
}

function reasonLabel(reason: TetrisMatch["reason"]): string {
  if (reason === "topout") return "desborde";
  if (reason === "time") return "tiempo";
  if (reason === "forced") return "forzado";
  if (reason === "quit") return "abandono";
  return "sin terminar";
}

function seatSummary(match: TetrisMatch, seat: number): Record<string, unknown> {
  const player = playerAt(match, seat);
  return {
    asiento: seat + 1,
    lineas: player.lines,
    basuraEnviada: player.garbageSent,
    basuraRecibida: player.garbageTaken,
    nivel: player.level,
    puntos: tetrisPoints(match, seat),
    resultado: match.winner < 0 ? "empate" : match.winner === seat ? "victoria" : "derrota",
  };
}

/** El asiento que falta, o -1 si estan los dos. */
function missingSeat(scene: Scene): number {
  for (let seat = 0; seat < TETRIS_SEATS; seat++) {
    const taken = (scene.human[seat] ?? 0) === 1 || (scene.keyboard[seat] ?? 0) === 1;
    if (!taken) return seat;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* Update                                                               */
/* ------------------------------------------------------------------ */

function decayFx(scene: Scene, dtMs: number): void {
  for (let seat = 0; seat < TETRIS_SEATS; seat++) {
    if ((scene.flashMs[seat] ?? 0) > 0) scene.flashMs[seat] = (scene.flashMs[seat] ?? 0) - dtMs;
    if ((scene.shakeMs[seat] ?? 0) > 0) scene.shakeMs[seat] = (scene.shakeMs[seat] ?? 0) - dtMs;
    if ((scene.pushMs[seat] ?? 0) > 0) scene.pushMs[seat] = (scene.pushMs[seat] ?? 0) - dtMs;
    if ((scene.tintMs[seat] ?? 0) > 0) scene.tintMs[seat] = (scene.tintMs[seat] ?? 0) - dtMs;
    if ((scene.deadMs[seat] ?? 0) < DEAD_MS && playerAt(scene.match, seat).phase === "dead") {
      scene.deadMs[seat] = (scene.deadMs[seat] ?? 0) + dtMs;
    }
  }
}

/**
 * Los eventos del paso se convierten en sonido, en algo que se ve y en algo
 * que se siente en la mano.
 *
 * El haptico se deja marcado como numero —tipo y contador— y no como texto: el
 * `id` se arma afuera del loop, donde asignar un string no cuesta un cuadro.
 */
function readEvents(scene: Scene, ctx: FrameContext<TetrisHud>): void {
  for (let seat = 0; seat < TETRIS_SEATS; seat++) {
    const player = playerAt(scene.match, seat);
    if (player.evLines > 0) {
      scene.flashMs[seat] = FLASH_MS;
      ctx.sfx.play(player.evLines >= 4 ? "win" : "pick");
      if (!ctx.reducedMotion && player.evLines >= 4) scene.shakeMs[seat] = SHAKE_MS;
      // Las lineas ganan sobre el fijado: son el mismo instante y el que
      // importa contarle a la mano es el grande.
      scene.hapticKind[seat] = player.evLines >= 4 ? 3 : 2;
      scene.hapticSeq[seat] = (scene.hapticSeq[seat] ?? 0) + 1;
    } else if (player.evLocked > 0) {
      scene.hapticKind[seat] = 1;
      scene.hapticSeq[seat] = (scene.hapticSeq[seat] ?? 0) + 1;
    }
    if (player.evGarbage > 0) {
      // El empuje se conserva con movimiento reducido: comunica la mecanica.
      scene.pushMs[seat] = PUSH_MS;
      if (!ctx.reducedMotion) scene.tintMs[seat] = TINT_MS;
      ctx.sfx.play("hit");
    }
    if (player.evLocked > 0 && player.evLines === 0) ctx.sfx.play("tick");
    if (player.evDead > 0) ctx.sfx.play("lose");
    clearEvents(player);
  }
}

/** Publica al HUD solo cuando algo cambio: si no, es un objeto por cuadro. */
function publishHud(scene: Scene, ctx: FrameContext<TetrisHud>): void {
  const left = playerAt(scene.match, 0);
  const right = playerAt(scene.match, 1);
  const pendingLeft = pendingGarbage(left);
  const pendingRight = pendingGarbage(right);
  const graceS = scene.waitingSeat >= 0 ? Math.max(0, Math.ceil(scene.graceMs / 1000)) : 0;
  const winner = scene.match.over ? scene.match.winner : -1;

  if (
    left.lines === scene.hudLines[0] &&
    right.lines === scene.hudLines[1] &&
    pendingLeft === scene.hudPending[0] &&
    pendingRight === scene.hudPending[1] &&
    winner === scene.hudWinner &&
    scene.waitingSeat === scene.hudWaitingSeat &&
    graceS === scene.hudGraceS
  ) {
    return;
  }
  scene.hudLines[0] = left.lines;
  scene.hudLines[1] = right.lines;
  scene.hudPending[0] = pendingLeft;
  scene.hudPending[1] = pendingRight;
  scene.hudWinner = winner;
  scene.hudWaitingSeat = scene.waitingSeat;
  scene.hudGraceS = graceS;
  ctx.setHud({
    lines0: left.lines,
    lines1: right.lines,
    pending0: pendingLeft,
    pending1: pendingRight,
    waitingSeat: scene.waitingSeat,
    graceS,
    winner,
  });
}

/* ------------------------------------------------------------------ */
/* Draw                                                                 */
/* ------------------------------------------------------------------ */

function drawScene(scene: Scene, g: CanvasRenderingContext2D, ctx: DrawContext): void {
  g.fillStyle = scene.bgColor;
  g.fillRect(0, 0, FIELD_W, FIELD_H);
  g.fillStyle = scene.bgGlow;
  g.fillRect(0, 0, FIELD_W, FIELD_H);

  drawLane(scene, g);
  for (let seat = 0; seat < TETRIS_SEATS; seat++) drawSide(scene, g, seat, ctx.reducedMotion);
  drawTransit(scene, g);
  if (scene.waitingSeat >= 0) drawWaiting(scene, g);
}

/** La calle del medio. Ver la basura cruzar es lo que hace entendible el duelo. */
function drawLane(scene: Scene, g: CanvasRenderingContext2D): void {
  g.fillStyle = scene.panelFill;
  g.fillRect(LANE_LEFT + 24, BOARD_Y, LANE_RIGHT - LANE_LEFT - 48, BOARD_H);
  g.strokeStyle = scene.panelLine;
  g.lineWidth = 1;
  g.strokeRect(LANE_LEFT + 24.5, BOARD_Y + 0.5, LANE_RIGHT - LANE_LEFT - 49, BOARD_H - 1);

  g.fillStyle = scene.dimColor;
  g.font = FONT_LABEL;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("BASURA EN VIAJE", LANE_CENTER, BOARD_Y + 32);
}

function drawSide(scene: Scene, g: CanvasRenderingContext2D, seat: number, reduced: boolean): void {
  const player = playerAt(scene.match, seat);
  const boardX = BOARD_X[seat] ?? 0;
  const accent = scene.seatColor[seat] ?? scene.textColor;

  g.save();
  if (!reduced) {
    const shake = scene.shakeMs[seat] ?? 0;
    if (shake > 0) {
      const decay = shake / SHAKE_MS;
      // Sacudida determinista: el azar del render no puede salir de `ctx.rng`
      // o la partida dependeria de los fps.
      g.translate(Math.sin(shake * 0.9) * SHAKE_PX * decay, Math.cos(shake * 1.3) * SHAKE_PX * decay);
    }
  }

  /* Nombre y contador grande de lineas. */
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = accent;
  g.font = FONT_NAME;
  g.fillText(scene.names[seat] ?? SEAT_NAMES[seat] ?? "Jugador", boardX + BOARD_W / 2, 72);
  g.font = FONT_LINES;
  g.fillText(labelOf(player.lines), boardX + BOARD_W / 2, 152);
  g.font = FONT_LABEL;
  g.fillStyle = scene.dimColor;
  g.fillText("LÍNEAS", boardX + BOARD_W / 2, 176);

  /* Marco del tablero. */
  g.fillStyle = scene.panelFill;
  g.fillRect(boardX, BOARD_Y, BOARD_W, BOARD_H);
  g.strokeStyle = scene.panelLine;
  g.lineWidth = 2;
  g.strokeRect(boardX - 1, BOARD_Y - 1, BOARD_W + 2, BOARD_H + 2);

  g.strokeStyle = scene.gridColor;
  g.lineWidth = 1;
  g.beginPath();
  for (let col = 1; col < COLS; col++) {
    const x = boardX + col * CELL + 0.5;
    g.moveTo(x, BOARD_Y);
    g.lineTo(x, BOARD_Y + BOARD_H);
  }
  for (let row = 1; row < VISIBLE_ROWS; row++) {
    const y = BOARD_Y + row * CELL + 0.5;
    g.moveTo(boardX, y);
    g.lineTo(boardX + BOARD_W, y);
  }
  g.stroke();

  /* El empuje de la basura: el tablero entra desde abajo y se acomoda. Se
     conserva con movimiento reducido porque explica de donde salieron las
     filas nuevas. */
  const push = scene.pushMs[seat] ?? 0;
  const pushOffset = push > 0 ? (push / PUSH_MS) * CELL : 0;

  g.save();
  g.beginPath();
  g.rect(boardX, BOARD_Y, BOARD_W, BOARD_H);
  g.clip();
  g.translate(0, pushOffset);

  drawCells(scene, g, player.board, boardX, player);
  drawGhostAndPiece(scene, g, seat, boardX);
  drawClearing(scene, g, player, boardX);

  g.restore();

  /* Tinte rojo al recibir. Fuera con movimiento reducido. */
  const tint = scene.tintMs[seat] ?? 0;
  if (!reduced && tint > 0) {
    g.globalAlpha = Math.min(1, tint / TINT_MS);
    g.fillStyle = scene.tintColor;
    g.fillRect(boardX, BOARD_Y, BOARD_W, BOARD_H);
    g.globalAlpha = 1;
  }

  /* Destello al completar. */
  const flash = scene.flashMs[seat] ?? 0;
  if (flash > 0) {
    g.globalAlpha = Math.min(0.35, (flash / FLASH_MS) * 0.35);
    g.fillStyle = scene.flashColor;
    g.fillRect(boardX, BOARD_Y, BOARD_W, BOARD_H);
    g.globalAlpha = 1;
  }

  /* Al perder, el tablero se llena de gris de abajo hacia arriba. */
  const dead = scene.deadMs[seat] ?? 0;
  if (dead > 0) {
    const ratio = Math.min(1, dead / DEAD_MS);
    const height = BOARD_H * ratio;
    g.fillStyle = scene.deadColor;
    g.fillRect(boardX, BOARD_Y + BOARD_H - height, BOARD_W, height);
  }

  drawPendingBar(scene, g, seat, boardX);
  drawPanel(scene, g, seat);
  g.restore();
}

function drawCells(
  scene: Scene,
  g: CanvasRenderingContext2D,
  board: Uint8Array,
  boardX: number,
  player: TetrisPlayer,
): void {
  for (let row = HIDDEN_ROWS; row < ROWS; row++) {
    let clearing = false;
    if (player.phase === "clearing") {
      for (let i = 0; i < player.clearCount; i++) {
        if ((player.clearRows[i] ?? -1) === row) {
          clearing = true;
          break;
        }
      }
    }
    if (clearing) continue;

    const y = BOARD_Y + (row - HIDDEN_ROWS) * CELL;
    for (let col = 0; col < COLS; col++) {
      const value = board[row * COLS + col] ?? 0;
      if (value === 0) continue;
      drawCell(scene, g, boardX + col * CELL, y, value);
    }
  }
}

function drawCell(scene: Scene, g: CanvasRenderingContext2D, x: number, y: number, value: number): void {
  g.fillStyle = scene.pieceFill[value] ?? scene.textColor;
  g.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
  // Bisel de arriba: da volumen sin costar un gradiente por celda.
  g.fillStyle = scene.pieceEdge[value] ?? scene.textColor;
  g.fillRect(x + 1, y + 1, CELL - 2, 5);
  if (value === GARBAGE) {
    g.fillRect(x + 1, y + CELL - 6, CELL - 2, 5);
  }
}

function drawGhostAndPiece(scene: Scene, g: CanvasRenderingContext2D, seat: number, boardX: number): void {
  const player = playerAt(scene.match, seat);
  if (player.piece < 0 || player.phase === "dead") return;

  // Fantasma: no es ayuda, es informacion que un jugador experto calcula igual.
  const landing = ghostY(scene.match, seat);
  g.strokeStyle = scene.ghostColor;
  g.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const col = player.x + cellX(player.piece, player.rot, i);
    const row = landing + cellY(player.piece, player.rot, i);
    if (row < HIDDEN_ROWS) continue;
    g.strokeRect(boardX + col * CELL + 2, BOARD_Y + (row - HIDDEN_ROWS) * CELL + 2, CELL - 4, CELL - 4);
  }

  for (let i = 0; i < 4; i++) {
    const col = player.x + cellX(player.piece, player.rot, i);
    const row = player.y + cellY(player.piece, player.rot, i);
    if (row < HIDDEN_ROWS) continue;
    drawCell(scene, g, boardX + col * CELL, BOARD_Y + (row - HIDDEN_ROWS) * CELL, player.piece + 1);
  }
}

/**
 * El aplastado de las filas completas. Se conserva con movimiento reducido: no
 * es adorno, es lo que explica por que la pila bajo de golpe.
 */
function drawClearing(
  scene: Scene,
  g: CanvasRenderingContext2D,
  player: TetrisPlayer,
  boardX: number,
): void {
  if (player.phase !== "clearing" || player.clearCount === 0) return;
  const total = Math.max(1, scene.rules.clearDelayMs);
  const ratio = Math.max(0, Math.min(1, player.clearMs / total));

  for (let i = 0; i < player.clearCount; i++) {
    const row = player.clearRows[i] ?? 0;
    if (row < HIDDEN_ROWS) continue;
    const y = BOARD_Y + (row - HIDDEN_ROWS) * CELL;
    const height = Math.max(2, CELL * ratio);
    g.fillStyle = scene.flashColor;
    g.globalAlpha = 0.85;
    g.fillRect(boardX, y + (CELL - height) / 2, BOARD_W, height);
    g.globalAlpha = 1;
  }
}

/** Cuanta basura tiene encima, contra el borde interno del tablero. */
function drawPendingBar(scene: Scene, g: CanvasRenderingContext2D, seat: number, boardX: number): void {
  const player = playerAt(scene.match, seat);
  const rows = pendingGarbage(player);
  const x = seat === 0 ? boardX + BOARD_W + 6 : boardX - 6 - PENDING_BAR_W;

  g.fillStyle = scene.panelFill;
  g.fillRect(x, BOARD_Y, PENDING_BAR_W, BOARD_H);
  if (rows <= 0) return;

  const height = Math.min(BOARD_H, rows * CELL);
  g.fillStyle = rows >= 4 ? scene.dangerColor : scene.warnColor;
  g.fillRect(x, BOARD_Y + BOARD_H - height, PENDING_BAR_W, height);
}

/** Retenida y las proximas tres, hacia afuera de cada tablero. */
function drawPanel(scene: Scene, g: CanvasRenderingContext2D, seat: number): void {
  const player = playerAt(scene.match, seat);
  const x = PANEL_X[seat] ?? 0;

  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.font = FONT_LABEL;
  g.fillStyle = scene.dimColor;
  g.fillText("RETENIDA", x + 12, BOARD_Y + 18);
  drawPreview(scene, g, player.hold, x, BOARD_Y + 30, player.holdUsed);

  g.fillStyle = scene.dimColor;
  g.font = FONT_LABEL;
  g.fillText("PRÓXIMAS", x + 12, BOARD_Y + 168);
  for (let i = 0; i < 3; i++) {
    const piece = upcomingPiece(scene.match, seat, i);
    drawPreview(scene, g, piece, x, BOARD_Y + 180 + i * 108, false);
  }

  g.font = FONT_SMALL;
  g.fillStyle = scene.dimColor;
  g.fillText("Enviadas", x + 12, BOARD_Y + BOARD_H - 34);
  g.fillStyle = scene.textColor;
  g.fillText(labelOf(player.garbageSent), x + 12, BOARD_Y + BOARD_H - 10);
  g.fillStyle = scene.dimColor;
  g.fillText("Nivel", x + 130, BOARD_Y + BOARD_H - 34);
  g.fillStyle = scene.textColor;
  g.fillText(labelOf(player.level), x + 130, BOARD_Y + BOARD_H - 10);
}

function drawPreview(
  scene: Scene,
  g: CanvasRenderingContext2D,
  piece: number,
  x: number,
  y: number,
  spent: boolean,
): void {
  g.fillStyle = scene.panelFill;
  g.fillRect(x, y, PANEL_W, 96);
  g.strokeStyle = scene.panelLine;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, PANEL_W - 1, 95);
  if (piece < 0) return;

  let minX = 9;
  let maxX = -9;
  let minY = 9;
  let maxY = -9;
  for (let i = 0; i < 4; i++) {
    const cx = cellX(piece, 0, i);
    const cy = cellY(piece, 0, i);
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  const width = (maxX - minX + 1) * PREVIEW_CELL;
  const height = (maxY - minY + 1) * PREVIEW_CELL;
  const originX = x + (PANEL_W - width) / 2 - minX * PREVIEW_CELL;
  const originY = y + (96 - height) / 2 - minY * PREVIEW_CELL;

  // La retenida ya usada se apaga: la regla es una vez por pieza y tiene que
  // verse, no memorizarse.
  g.globalAlpha = spent ? 0.35 : 1;
  for (let i = 0; i < 4; i++) {
    const cx = originX + cellX(piece, 0, i) * PREVIEW_CELL;
    const cy = originY + cellY(piece, 0, i) * PREVIEW_CELL;
    g.fillStyle = scene.pieceFill[piece + 1] ?? scene.textColor;
    g.fillRect(cx + 1, cy + 1, PREVIEW_CELL - 2, PREVIEW_CELL - 2);
    g.fillStyle = scene.pieceEdge[piece + 1] ?? scene.textColor;
    g.fillRect(cx + 1, cy + 1, PREVIEW_CELL - 2, 4);
  }
  g.globalAlpha = 1;
}

/**
 * La basura viajando de un tablero al otro.
 *
 * Es la ventana de compensacion hecha imagen: mientras el bloque cruza la
 * pantalla, el que la recibe todavia puede cancelarla haciendo lineas.
 */
function drawTransit(scene: Scene, g: CanvasRenderingContext2D): void {
  const windowMs = scene.rules.garbageWindowMs;
  g.textAlign = "center";
  g.textBaseline = "middle";

  for (let seat = 0; seat < TETRIS_SEATS; seat++) {
    const player = playerAt(scene.match, seat);
    // La que le viene al asiento 0 salio del tablero de la derecha, y al reves.
    // El medio bloque de margen deja que el cartel toque el borde del tablero
    // sin taparlo: lo que importa es de donde sale y a donde va.
    const from = seat === 0 ? LANE_RIGHT - TRANSIT_W / 2 : LANE_LEFT + TRANSIT_W / 2;
    const to = seat === 0 ? LANE_LEFT + TRANSIT_W / 2 : LANE_RIGHT - TRANSIT_W / 2;

    const shown = Math.min(player.pendingCount, TRANSIT_MAX);
    for (let i = 0; i < shown; i++) {
      const rows = player.pendingRows[i] ?? 0;
      if (rows <= 0) continue;
      const t = pendingProgress(player, i, windowMs);
      const x = from + (to - from) * t;
      const y = TRANSIT_Y + i * TRANSIT_STEP;

      g.fillStyle = rows >= 4 ? scene.dangerColor : scene.warnColor;
      g.fillRect(x - TRANSIT_W / 2, y - TRANSIT_H / 2, TRANSIT_W, TRANSIT_H);
      g.fillStyle = scene.bgColor;
      g.font = FONT_TRANSIT;
      // Etiquetas precalculadas: interpolar un string por cuadro y por tanda
      // seria basura de GC justo cuando mas se mira la pantalla.
      const label = seat === 0 ? TRANSIT_LEFT[rows] : TRANSIT_RIGHT[rows];
      g.fillText(label ?? labelOf(rows), x, y + 1);
    }
  }
}

/**
 * La pausa por desconexion. La partida no sigue de a uno, pero tampoco se
 * corta: hay una cuenta atras visible y la pieza del que se fue queda flotando
 * donde estaba.
 */
function drawWaiting(scene: Scene, g: CanvasRenderingContext2D): void {
  g.fillStyle = scene.veilColor;
  g.fillRect(0, 0, FIELD_W, FIELD_H);
  g.textAlign = "center";
  g.textBaseline = "middle";

  g.font = FONT_WAIT;
  g.fillStyle = scene.textColor;
  g.fillText(WAIT_TITLES[scene.waitingSeat] ?? "Esperando…", FIELD_W / 2, FIELD_H / 2 - 60);

  g.font = FONT_LINES;
  g.fillStyle = scene.warnColor;
  g.fillText(labelOf(Math.max(0, Math.ceil(scene.graceMs / 1000))), FIELD_W / 2, FIELD_H / 2 + 20);

  g.font = FONT_NAME;
  g.fillStyle = scene.dimColor;
  g.fillText("segundos antes del abandono", FIELD_W / 2, FIELD_H / 2 + 78);
}
