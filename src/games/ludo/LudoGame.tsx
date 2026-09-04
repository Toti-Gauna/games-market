import { useEffect, useMemo, useRef } from "react";
import type { GameProps } from "@/core/contract/game";
import { bool, num, str } from "@/core/contract/settings";
import type {
  ControlButton,
  ControlHaptic,
  ControlInput,
  ControlSpec,
  ControlStatus,
  OptionShape,
} from "@/core/contract/control";
import type { NetPlayer } from "@/core/contract/gameNet";
import { clamp } from "@/core/engine/collide";
import { withAlpha } from "@/core/engine/palette";
import { useGame2D, type FrameContext } from "@/core/engine/useGame2D";
import type { BotPolicy } from "@/core/net/mockNet";
import { useGameNet } from "@/core/net/useGameNet";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  advanceOf,
  applyMove,
  autoMove,
  blockReasonText,
  botSkillOf,
  chooseBotMove,
  createLudoState,
  currentMoves,
  finishMove,
  isSafeSquare,
  leaderSeat,
  legalCount,
  ludoPoints,
  moveHintText,
  movesFor,
  onlyLegalMove,
  passTurn,
  placeText,
  rollDie,
  seatOfToken,
  tokenIndex,
  tokensAtBase,
  tokensAtGoal,
  trackSquareOf,
  DEFAULT_RULES,
  HOME_LENGTH,
  LUDO_SEATS,
  type BotSkill,
  type LudoRules,
  type LudoState,
} from "./logic";

/**
 * X3 · Ludo.
 *
 * **El multijugador mas barato de los 24.** Es por turnos, asi que la latencia
 * no importa: no hay prediccion, ni interpolacion, ni estado a 20 Hz. Es pedir
 * y responder. Tres decisiones lo explican entero:
 *
 * 1. **El host tira el dado.** Este componente corre como host autoritativo
 *    (`useGameNet` con `role: "host"`, `seat: -1`): el celular manda "tire" y
 *    nunca "saque un 6". Es la regla de todo el proyecto —el host recibe
 *    input, nunca resultados— pero aca es especialmente evidente: un dado
 *    tirado en el telefono es un dado que alguien puede elegir.
 * 2. **El mando ensena las reglas sin tutorial.** El `sendControl` va dirigido
 *    por asiento y las fichas que no se pueden mover llegan deshabilitadas
 *    **con el motivo** ("en casa, necesitas 5 o 6"). Un boton apagado y mudo
 *    solo confunde. Y si solo una ficha puede moverse, se mueve sola: no se
 *    hace elegir cuando no hay eleccion.
 * 3. **Nadie espera a quien se distrajo.** Cada turno tiene 15 segundos con
 *    cuenta regresiva visible; al agotarse se juega solo el mejor movimiento,
 *    o se pasa. Un turno sin limite en una sala es una persona distraida
 *    frenando a tres.
 *
 * Es el unico juego de red del catalogo que **no difunde estado**: no hay
 * `broadcastState` ni snapshots. Se manda un `ControlSpec` cuando pasa algo
 * —se tiro, se movio, cambio el turno— y en reposo el trafico es cero.
 */

/* ------------------------------------------------------------------ */
/* Escenario                                                            */
/* ------------------------------------------------------------------ */

const DESIGN_W = 1280;
const DESIGN_H = 800;

/**
 * El tablero es cuadrado y vive a la izquierda; a la derecha va el estado de
 * todos. Esta corrido para abajo y no centrado: la franja del HUD en DOM ocupa
 * los primeros ~60 px y taparia la punta del brazo de arriba.
 */
const BOARD_CX = 400;
const BOARD_CY = 415;
const BOARD_R = 300;

const PANEL_X = 802;
const PANEL_W = 438;
const PANEL_ROW_H = 108;
const PANEL_ROWS_Y = 268;

/** ms por casilla de la animacion. Con reduced-motion se acorta, no se elimina. */
const STEP_MS = 130;
const STEP_MS_REDUCED = 55;
/** La ficha comida vuelve a su casa volando. Es el momento del juego. */
const FLY_MS = 620;
const FLY_MS_REDUCED = 200;
const DIE_SPIN_MS = 520;
const DIE_SPIN_MS_REDUCED = 140;

/** Un instante antes de mover sola: sin la pausa parece un error, no una jugada. */
const AUTO_MOVE_MS = 720;
const AUTO_PASS_MS = 950;
/** El bot no contesta al toque: si lo hiciera, la sala no llegaria a ver el dado. */
const BOT_THINK_MS = 900;
/** Cuanto manda el teclado local antes de devolverle el asiento al bot. */
const LOCAL_HOLD_MS = 6000;

const NOTICE_MS = 2400;
const OVER_HOLD_MS = 2600;
const SHAKE_MS = 260;
const SHAKE_PX = 7;

/** ms de un paso simulado. Solo lo usa el render para interpolar con `alpha`. */
const SIM_MS = 1000 / 60;

const MAX_SPARKS = 72;
const SPARKS_PER_CAPTURE = 22;
const SPARK_GRAVITY = 900;
const NOISE_SIZE = 64;

/** El mando se refresca 5 veces por segundo, no 60, y solo si algo cambio. */
const CONTROL_MS = 200;

const ROLL_BUTTON = "roll";
const TOKEN_PREFIX = "token-";
const DIGIT_CODES = ["Digit1", "Digit2", "Digit3", "Digit4"] as const;

const HAPTIC_TURN = 30;
const HAPTIC_ROLL = [12, 40, 12] as const;
const HAPTIC_EAT = [20, 50, 60] as const;
const HAPTIC_BITTEN = [70, 60, 70] as const;
/** El aviso viaja en varios specs: el mando ignora el `id` repetido. */
const HAPTIC_TICKS = 8;

/** Nombre del color, para quien todavia no tomo asiento con el celular. */
const SEAT_COLOR_NAMES = ["Cian", "Magenta", "Violeta", "Ámbar"] as const;
/** Cada color lleva ademas su forma: hay gente daltonica en cualquier sala. */
const SEAT_SHAPES: readonly OptionShape[] = ["circle", "triangle", "square", "diamond"];

const FONT_TURN = '700 40px "Space Grotesk", sans-serif';
const FONT_DIE = '700 74px "Space Grotesk", sans-serif';
const FONT_ROW = '600 22px "Space Grotesk", sans-serif';
const FONT_SMALL = '500 16px "Space Grotesk", sans-serif';
const FONT_HOUSE = '600 18px "Space Grotesk", sans-serif';
const FONT_NOTICE = '600 30px "Space Grotesk", sans-serif';

/* ------------------------------------------------------------------ */
/* Geometria del tablero                                                */
/* ------------------------------------------------------------------ */

type Layout = {
  trackX: Float32Array;
  trackY: Float32Array;
  homeX: Float32Array;
  homeY: Float32Array;
  baseX: Float32Array;
  baseY: Float32Array;
  houseX: Float32Array;
  houseY: Float32Array;
  houseR: number;
  cell: number;
  homeCell: number;
};

/**
 * El tablero en cruz, calculado y no dibujado a mano.
 *
 * La pista es el contorno de una cruz: cuatro brazos de medio ancho `w`, y las
 * `trackLength` casillas repartidas a paso constante sobre ese contorno. Un
 * cuadrante mide siempre `2R` de arco, asi que salen `trackLength / 4` casillas
 * por brazo con cualquier recorrido que sea multiplo de 8 — que es lo que el
 * administrable garantiza.
 *
 * Se calcula en vez de hardcodearse porque el largo del recorrido es
 * administrable: una tabla de 32 posiciones a mano se rompe el dia que alguien
 * pone 48 en el panel.
 *
 * Tres detalles del muestreo, que son lo que hace que el tablero se vea como un
 * Ludo y no como un anillo cualquiera:
 *
 * - Las casillas se muestrean en `(i + 1) * paso`, no en `(i + 0.5) * paso`.
 *   Asi caen **exactamente sobre los vertices de la cruz**, todas las vecinas
 *   quedan a un paso justo sobre un eje y ningun par se superpone. Con el medio
 *   paso, las dos que rodean cada rincon interno se pisaban.
 * - Con ese muestreo, la casilla 0 de cada cuadrante es la **casilla de entrada
 *   del color**, que es lo que `entrySquare` de la logica ya suponia.
 * - La ultima casilla del cuadrante anterior queda a **un paso exacto** de la
 *   primera casilla de la recta final: el giro hacia la meta se ve como un
 *   paso mas, igual que en el tablero de siempre.
 */
function buildLayout(rules: LudoRules): Layout {
  const perQuadrant = rules.trackLength / rules.seats;
  const R = BOARD_R;
  // Medio ancho del brazo = un paso de casilla: por eso el brazo se ve de tres
  // celdas de ancho (pista, recta final, pista), como el tablero clasico.
  const step = (2 * R) / perQuadrant;
  const w = step;

  const trackX = new Float32Array(rules.trackLength);
  const trackY = new Float32Array(rules.trackLength);

  // Polilinea de un cuadrante: sube por el costado del brazo, cruza la punta y
  // baja por el otro costado. Los tres tramos suman 2R.
  const px = [w, w, -w, -w];
  const py = [w, R, R, w];

  for (let q = 0; q < rules.seats; q++) {
    const angle = (q * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let i = 0; i < perQuadrant; i++) {
      let remaining = (i + 1) * step;
      let x = px[0] ?? 0;
      let y = py[0] ?? 0;
      for (let s = 0; s < 3; s++) {
        const ax = px[s] ?? 0;
        const ay = py[s] ?? 0;
        const bx = px[s + 1] ?? 0;
        const by = py[s + 1] ?? 0;
        const length = Math.abs(bx - ax) + Math.abs(by - ay);
        if (remaining <= length || s === 2) {
          const t = length === 0 ? 0 : Math.min(1, remaining / length);
          x = ax + (bx - ax) * t;
          y = ay + (by - ay) * t;
          break;
        }
        remaining -= length;
      }
      const index = q * perQuadrant + i;
      trackX[index] = x * cos - y * sin;
      trackY[index] = x * sin + y * cos;
    }
  }

  // Recta final: por el medio del brazo propio, de adentro hacia la punta. La
  // primera arranca a un paso de la casilla de giro y la ultima —la meta—
  // queda antes de la punta, que ya la ocupa la pista.
  const spread = Math.min(step * 0.72, (R - step * 0.9 - w) / Math.max(1, rules.homeLength - 1));
  const homeX = new Float32Array(rules.seats * rules.homeLength);
  const homeY = new Float32Array(rules.seats * rules.homeLength);
  for (let seat = 0; seat < rules.seats; seat++) {
    const angle = (seat * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let j = 0; j < rules.homeLength; j++) {
      const r = w + spread * j;
      const index = seat * rules.homeLength + j;
      homeX[index] = -r * sin;
      homeY[index] = r * cos;
    }
  }

  // Las casas van en los cuatro rincones que la cruz deja libres, cada una
  // pegada a la casilla de entrada de su color.
  const houseR = ((R - w) / 2) * 0.84;
  const houseC = (R + w) / 2;
  const houseX = new Float32Array(rules.seats);
  const houseY = new Float32Array(rules.seats);
  const baseX = new Float32Array(rules.seats * rules.tokensPerPlayer);
  const baseY = new Float32Array(rules.seats * rules.tokensPerPlayer);
  const columns = Math.ceil(Math.sqrt(rules.tokensPerPlayer));
  const rows = Math.ceil(rules.tokensPerPlayer / columns);

  for (let seat = 0; seat < rules.seats; seat++) {
    const angle = (seat * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = houseC * cos - houseC * sin;
    const cy = houseC * sin + houseC * cos;
    houseX[seat] = cx;
    houseY[seat] = cy;

    for (let t = 0; t < rules.tokensPerPlayer; t++) {
      const col = t % columns;
      const row = Math.floor(t / columns);
      const ox = columns === 1 ? 0 : (col / (columns - 1) - 0.5) * houseR;
      const oy = rows === 1 ? 0 : (row / (rows - 1) - 0.5) * houseR;
      const index = seat * rules.tokensPerPlayer + t;
      baseX[index] = cx + ox;
      baseY[index] = cy - oy;
    }
  }

  return {
    trackX,
    trackY,
    homeX,
    homeY,
    baseX,
    baseY,
    houseX,
    houseY,
    houseR,
    cell: step * 0.84,
    homeCell: spread * 0.84,
  };
}

type Point = { x: number; y: number };

/** Donde se dibuja una ficha con ese progreso. Sirve tambien para la animacion. */
function pointAt(
  layout: Layout,
  rules: LudoRules,
  seat: number,
  token: number,
  progress: number,
  out: Point,
): void {
  if (progress < 0) {
    const index = tokenIndex(rules, seat, token);
    out.x = layout.baseX[index] ?? 0;
    out.y = layout.baseY[index] ?? 0;
    return;
  }
  if (progress < rules.trackLength) {
    const square = trackSquareOf(rules, seat, progress);
    out.x = layout.trackX[square] ?? 0;
    out.y = layout.trackY[square] ?? 0;
    return;
  }
  const slot = seat * rules.homeLength + (progress - rules.trackLength);
  out.x = layout.homeX[slot] ?? 0;
  out.y = layout.homeY[slot] ?? 0;
}

/** Identificador de la celda que ocupa una ficha, para apilar sin superponer. */
function cellIdOf(rules: LudoRules, seat: number, token: number, progress: number): number {
  if (progress < 0) return -1 - tokenIndex(rules, seat, token);
  if (progress < rules.trackLength) return trackSquareOf(rules, seat, progress);
  return rules.trackLength + seat * rules.homeLength + (progress - rules.trackLength);
}

const screenX = (x: number): number => BOARD_CX + x;
const screenY = (y: number): number => BOARD_CY - y;

/* ------------------------------------------------------------------ */
/* Escena                                                               */
/* ------------------------------------------------------------------ */

type Scene = {
  game: LudoState;
  layout: Layout;
  viewSeat: number;
  stepMs: number;
  flyMs: number;
  dieSpinMs: number;

  /* Animacion de la ficha, casilla por casilla. */
  walkToken: number;
  walkFrom: number;
  walkStep: number;
  walkSteps: number;
  walkMs: number;

  /* La ficha comida volviendo a su casa. */
  flyToken: number;
  flyFrom: number;
  flyElapsed: number;

  /* Jugada programada: 0 sin decidir, -1 elige la persona, 1 mover, 2 pasar. */
  autoKind: number;
  autoToken: number;
  autoMs: number;
  /** El bot se toma un momento antes de contestar. */
  botMs: number;
  /** Mientras corre, el teclado local le gana al bot de ese asiento. */
  localHoldMs: number;

  /** Ultimo boton tocado por asiento. Se consume dentro del update. */
  pendingPress: string[];
  pendingBot: Uint8Array;

  spinMs: number;
  flashMs: number;
  shakeMs: number;
  goalPulse: Float32Array;
  overMs: number;

  noticeText: string;
  noticeTone: number;
  noticeMs: number;

  sparkX: Float32Array;
  sparkY: Float32Array;
  sparkVx: Float32Array;
  sparkVy: Float32Array;
  sparkLife: Float32Array;
  sparkMax: Float32Array;
  sparkSeat: Uint8Array;
  sparkHead: number;

  /** Ruido sembrado una vez: el azar del render no puede salir de `ctx.rng`. */
  noise: Float32Array;
  noiseCursor: number;

  seatLabel: string[];
  seatHuman: Uint8Array;
  seatLeft: Uint8Array;

  rollKeyHeld: boolean;
  pickKeyHeld: Uint8Array;

  stack: Int8Array;
  cellId: Int32Array;
  scratch: Point;
  scratchB: Point;

  seatColor: string[];
  seatSoft: string[];
  seatFaint: string[];
  bgGlow: CanvasGradient;
  lineColor: string;
  cellFill: string;
  textColor: string;
  mutedColor: string;
  dimColor: string;
  panelFill: string;
  dieFill: string;
  noticeFill: string[];
};

type LudoHud = {
  turn: number;
  die: number;
  secs: number;
  goals: number;
  captures: number;
  /** 0 = todavia nadie. Va al HUD y no a un ref para que el resumen sea reactivo. */
  winner: number;
};

const EMPTY_HUD: LudoHud = { turn: 1, die: 0, secs: 0, goals: 0, captures: 0, winner: 0 };

/* ------------------------------------------------------------------ */

export default function LudoGame({ config, net, signal, onFinish }: GameProps) {
  const rules = useMemo<LudoRules>(() => {
    const seats = LUDO_SEATS;
    const raw = Math.round(num(config.settings, "trackLength", DEFAULT_RULES.trackLength));
    // Multiplo de 8, no solo de 4. De 4 lo pide la logica —cada color entra en
    // su cuarto y las cuatro casillas seguras quedan repartidas parejo— pero el
    // tablero en cruz necesita ademas que cada cuadrante tenga un numero PAR de
    // casillas, o los tramos del brazo no cierran en sus vertices y las
    // casillas de los rincones se pisan.
    const trackLength = clamp(Math.round(raw / 8) * 8, 24, 48);
    const entry = str(config.settings, "entryRolls", "56");
    const entryRolls = parseEntryRolls(entry);

    return {
      seats,
      tokensPerPlayer: clamp(Math.round(num(config.settings, "tokensPerPlayer", 2)), 1, 4),
      trackLength,
      homeLength: HOME_LENGTH,
      entryRolls,
      dieFaces: DEFAULT_RULES.dieFaces,
      extraRoll: bool(config.settings, "extraRoll", true),
      turnMs: Math.round(num(config.settings, "turnSeconds", 15) * 1000),
      pointsPerStep: num(config.settings, "pointsPerStep", 10),
      pointsPerCapture: num(config.settings, "pointsPerCapture", 150),
      pointsPerToken: num(config.settings, "pointsPerToken", 400),
      pointsWin: num(config.settings, "pointsWin", 500),
    };
  }, [config.settings]);

  const sceneRef = useRef<Scene | null>(null);
  const rosterRef = useRef<Map<string, NetPlayer>>(new Map());
  const seatPlayerRef = useRef<Array<NetPlayer | null>>([null, null, null, null]);

  /* El bot lee la dificultad por referencia: el puerto de red se crea una sola
     vez, asi que tocar una perilla no puede exigir reconectar a nadie. */
  const tuningRef = useRef<{ skill: BotSkill }>({ skill: "normal" });
  tuningRef.current.skill = botSkillOf(str(config.settings, "botSkill", "normal"));

  const botMemoryRef = useRef({
    idle: { kind: "press", buttonId: "" } as Extract<ControlInput, { kind: "press" }>,
    roll: { kind: "press", buttonId: ROLL_BUTTON } as Extract<ControlInput, { kind: "press" }>,
    pick: [0, 1, 2, 3].map(
      (i) => ({ kind: "press", buttonId: TOKEN_PREFIX + i }) as Extract<ControlInput, { kind: "press" }>,
    ),
    key: new Int32Array(LUDO_SEATS).fill(-1),
    token: new Int32Array(LUDO_SEATS).fill(-1),
  });

  /**
   * La politica del bot.
   *
   * Manda `press`, igual que una persona: no escribe estado ni puntaje, y su
   * decision la valida el host como cualquier otra. La prioridad es la de la
   * spec —capturar, meter, sacar, avanzar la mas adelantada— y no mas: un bot
   * de Ludo demasiado bueno frustra sin aportar, y la mayor parte del juego es
   * el dado.
   *
   * La eleccion se cachea por tirada. Sin eso, un bot "calmo" sortearia una
   * ficha distinta en cada tick y consumiria azar para nada.
   */
  const botPolicy = useMemo<BotPolicy<ControlInput>>(
    () => ({
      hz: 6,
      policy: (bot) => {
        const memory = botMemoryRef.current;
        const scene = sceneRef.current;
        if (!scene) return memory.idle;
        const state = scene.game;
        const seat = bot.seat;
        if (state.over || state.turn !== seat || seat < 0 || seat >= LUDO_SEATS) return memory.idle;
        if (state.phase === "roll") return memory.roll;
        if (state.phase !== "choose") return memory.idle;

        const key = state.turns * 4096 + state.rolls;
        if (memory.key[seat] !== key) {
          memory.key[seat] = key;
          memory.token[seat] = chooseBotMove(
            state,
            currentMoves(state),
            bot.rng,
            tuningRef.current.skill,
          );
        }
        const token = memory.token[seat] ?? -1;
        return token < 0 ? memory.idle : (memory.pick[token] ?? memory.idle);
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
    // -1 = proyector que no juega. Los cuatro colores quedan para los celulares.
    seat: -1,
    seats: LUDO_SEATS,
    name: "Proyector",
    bot: botPolicy,

    /**
     * La unica puerta por la que entra algo de un celular, y entra un toque:
     * "tire", "movi la ficha 1". Nunca un numero de dado ni un resultado.
     *
     * El toque se encola y se consume dentro del `update`, no aca: asi el
     * PRNG se consume siempre en el mismo orden y la partida sigue siendo
     * reproducible aunque los paquetes lleguen cuando quieran.
     */
    onInput: (playerId, input) => {
      const scene = sceneRef.current;
      if (!scene || input.kind !== "press" || !input.buttonId) return;
      const player = rosterRef.current.get(playerId);
      if (!player) return;
      const seat = player.seat;
      if (seat < 0 || seat >= LUDO_SEATS) return;
      if (player.bot && seat === scene.viewSeat && scene.localHoldMs > 0) return;
      scene.pendingPress[seat] = input.buttonId;
      scene.pendingBot[seat] = player.bot ? 1 : 0;
    },

    onPlayerJoin: (player) => {
      rosterRef.current.set(player.id, player);
      const scene = sceneRef.current;
      if (!scene || player.seat < 0 || player.seat >= LUDO_SEATS) return;
      scene.seatHuman[player.seat] = player.bot ? 0 : 1;
      scene.seatLabel[player.seat] = labelFor(player);
      if (!player.bot) {
        scene.seatLeft[player.seat] = 0;
        pushNotice(scene, `${player.name} se sumó`, 0);
      }
    },

    onPlayerLeave: (playerId) => {
      const player = rosterRef.current.get(playerId);
      rosterRef.current.delete(playerId);
      const scene = sceneRef.current;
      if (!scene || !player || player.bot) return;
      if (player.seat < 0 || player.seat >= LUDO_SEATS) return;
      // Un bot lo reemplaza en el acto y la partida no se pausa: en un juego
      // por turnos, esperar 30 segundos a alguien es insoportable para el
      // resto. Al volver recupera sus fichas donde el bot las dejo.
      scene.seatHuman[player.seat] = 0;
      scene.seatLeft[player.seat] = 1;
      scene.seatLabel[player.seat] = SEAT_COLOR_NAMES[player.seat] ?? "Bot";
      pushNotice(scene, `${player.name} se fue · sigue un bot`, 1);
    },
  });

  const game = useGame2D<Scene, LudoHud>(
    {
      design: { width: DESIGN_W, height: DESIGN_H },
      countdown: 3,
      hud: EMPTY_HUD,

      init: (ctx) => {
        const g = ctx.view.ctx;
        const bgGlow = g.createRadialGradient(
          BOARD_CX,
          BOARD_CY,
          0,
          BOARD_CX,
          BOARD_CY,
          BOARD_R * 1.35,
        );
        bgGlow.addColorStop(0, withAlpha(ctx.palette["--sn-violet-600"], 0.26));
        bgGlow.addColorStop(1, withAlpha(ctx.palette["--sn-violet-600"], 0));

        const seatColor = [
          ctx.palette["--sn-cyan-400"],
          ctx.palette["--sn-magenta-400"],
          ctx.palette["--sn-violet-400"],
          ctx.palette["--sn-warn"],
        ];

        const noise = new Float32Array(NOISE_SIZE);
        for (let i = 0; i < NOISE_SIZE; i++) noise[i] = ctx.rng.next();

        const total = rules.seats * rules.tokensPerPlayer;
        const scene: Scene = {
          game: createLudoState(rules, ctx.rng),
          layout: buildLayout(rules),
          viewSeat: clamp(Math.round(config.seat), 0, LUDO_SEATS - 1),
          stepMs: ctx.reducedMotion ? STEP_MS_REDUCED : STEP_MS,
          flyMs: ctx.reducedMotion ? FLY_MS_REDUCED : FLY_MS,
          dieSpinMs: ctx.reducedMotion ? DIE_SPIN_MS_REDUCED : DIE_SPIN_MS,

          walkToken: -1,
          walkFrom: -1,
          walkStep: 0,
          walkSteps: 0,
          walkMs: 0,

          flyToken: -1,
          flyFrom: -1,
          flyElapsed: 0,

          autoKind: 0,
          autoToken: -1,
          autoMs: 0,
          botMs: BOT_THINK_MS,
          localHoldMs: 0,

          pendingPress: ["", "", "", ""],
          pendingBot: new Uint8Array(LUDO_SEATS),

          spinMs: 0,
          flashMs: 0,
          shakeMs: 0,
          goalPulse: new Float32Array(LUDO_SEATS),
          overMs: 0,

          noticeText: "",
          noticeTone: 0,
          noticeMs: 0,

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

          seatLabel: [...SEAT_COLOR_NAMES],
          seatHuman: new Uint8Array(LUDO_SEATS),
          seatLeft: new Uint8Array(LUDO_SEATS),

          rollKeyHeld: false,
          pickKeyHeld: new Uint8Array(4),

          stack: new Int8Array(total),
          cellId: new Int32Array(total),
          scratch: { x: 0, y: 0 },
          scratchB: { x: 0, y: 0 },

          seatColor,
          seatSoft: seatColor.map((color) => withAlpha(color, 0.22)),
          seatFaint: seatColor.map((color) => withAlpha(color, 0.1)),
          bgGlow,
          lineColor: withAlpha(ctx.palette["--sn-violet-500"], 0.3),
          cellFill: withAlpha(ctx.palette["--sn-panel"], 0.55),
          textColor: ctx.palette["--sn-text"],
          mutedColor: ctx.palette["--sn-text-muted"],
          dimColor: ctx.palette["--sn-text-dim"],
          panelFill: withAlpha(ctx.palette["--sn-panel"], 0.42),
          dieFill: ctx.palette["--sn-bg-elev"],
          noticeFill: [
            ctx.palette["--sn-success"],
            ctx.palette["--sn-warn"],
            ctx.palette["--sn-danger"],
          ],
        };

        sceneRef.current = scene;
        for (const player of rosterRef.current.values()) {
          if (player.seat < 0 || player.seat >= LUDO_SEATS) continue;
          scene.seatHuman[player.seat] = player.bot ? 0 : 1;
          scene.seatLabel[player.seat] = labelFor(player);
        }
        return scene;
      },

      update: (scene, dt, ctx) => {
        const state = scene.game;
        const ms = dt * 1000;
        decayTimers(scene, ms);
        updateSparks(scene, dt);

        if (state.over) {
          scene.overMs += ms;
          if (scene.overMs >= (ctx.reducedMotion ? 800 : OVER_HOLD_MS)) ctx.finish(true);
          pushHud(scene, ctx);
          return;
        }

        // 1. La ficha camina casilla por casilla. El turno no se cierra hasta
        //    que termina: sin eso la ficha aparece en el destino y no se ve
        //    que se movio.
        if (scene.walkToken >= 0) {
          scene.walkMs += ms;
          while (scene.walkMs >= scene.stepMs && scene.walkStep < scene.walkSteps) {
            scene.walkMs -= scene.stepMs;
            scene.walkStep++;
            if (scene.walkStep < scene.walkSteps) ctx.sfx.play("tick");
          }
          if (scene.walkStep >= scene.walkSteps) endWalk(scene, ctx);
          pushHud(scene, ctx);
          return;
        }

        // 2. La ficha comida vuelve volando a su casa.
        if (scene.flyToken >= 0) {
          scene.flyElapsed += ms;
          if (scene.flyElapsed >= scene.flyMs) endFly(scene, ctx);
          pushHud(scene, ctx);
          return;
        }

        // 3. El teclado y el click del proyector entran por la misma cola que
        //    el celular: una sola puerta de input, una sola validacion.
        readLocalInput(scene, ctx);
        drainPresses(scene, ctx);
        if (state.over) {
          pushHud(scene, ctx);
          return;
        }

        // 4. El reloj del turno. Nadie espera a quien se distrajo.
        if (state.phase === "roll") {
          state.turnMsLeft -= ms;
          if (state.turnMsLeft <= 0) hostRoll(scene, ctx, true);
        } else if (state.phase === "choose") {
          if (scene.autoKind === 0) scheduleChoice(scene);
          if (scene.autoKind > 0) {
            scene.autoMs -= ms;
            if (scene.autoMs <= 0) runScheduled(scene, ctx);
          } else {
            state.turnMsLeft -= ms;
            if (state.turnMsLeft <= 0) {
              const token = autoMove(state, currentMoves(state));
              if (token < 0) hostPass(scene, ctx);
              else hostMove(scene, ctx, token);
            }
          }
        }

        pushHud(scene, ctx);
      },

      draw: (scene, g, ctx) => drawLudo(scene, g, ctx.palette["--sn-bg"], ctx.reducedMotion, ctx.alpha),

      outcome: (scene, completed, survivedMs) => {
        const state = scene.game;
        const seat = scene.viewSeat;
        const decided = state.winner >= 0;
        // Si se acaba el tiempo gana quien tenga mas avance total: es una
        // metrica que se entiende de un vistazo en el proyector.
        const champion = decided ? state.winner : leaderSeat(state);
        const won = champion === seat && (decided || completed);
        const quit = (scene.seatLeft[seat] ?? 0) === 1;

        return {
          completed: quit ? false : completed,
          points: ludoPoints(state, seat, won),
          meta: {
            asiento: seat + 1,
            color: SEAT_COLOR_NAMES[seat] ?? "—",
            avance: advanceOf(state, seat),
            capturas: state.capturesBy[seat] ?? 0,
            fichasEnMeta: tokensAtGoal(state, seat),
            ganador: champion + 1,
            porAvance: !decided,
            motivo: decided ? "partida" : quit ? "abandono" : completed ? "tiempo" : "forzado",
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
  /* El mando: una interfaz de turnos, dirigida por asiento             */
  /* ---------------------------------------------------------------- */

  const netPort = netHandle.net;
  const playing = game.phase === "playing";
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    if (!netPort) return;
    // Fuera del loop a proposito: armar un `ControlSpec` es un objeto, y
    // `update` y `draw` no asignan. A 5 Hz alcanza de sobra para un juego por
    // turnos, y `buildControlSpec` devuelve null cuando nada cambio, asi que
    // en reposo el trafico es cero.
    const memory = createControlMemory();
    const timer = window.setInterval(() => {
      const scene = sceneRef.current;
      if (!scene) return;
      for (let seat = 0; seat < LUDO_SEATS; seat++) {
        const player = seatPlayerRef.current[seat];
        if (!player || player.bot) continue;
        const spec = buildControlSpec(scene, seat, player.id, playingRef.current, memory);
        if (spec) netPort.sendControl(spec, player.id);
      }
    }, CONTROL_MS);
    return () => window.clearInterval(timer);
  }, [netPort]);

  // El roster llega por el hook a 4 Hz; el mapa por asiento lo sigue aunque el
  // join se haya perdido antes de que montara la escena.
  useEffect(() => {
    const next: Array<NetPlayer | null> = [null, null, null, null];
    for (const player of netHandle.players) {
      if (player.seat >= 0 && player.seat < LUDO_SEATS) next[player.seat] = player;
      rosterRef.current.set(player.id, player);
    }
    seatPlayerRef.current = next;
    const scene = sceneRef.current;
    if (!scene) return;
    for (let seat = 0; seat < LUDO_SEATS; seat++) {
      const player = next[seat];
      scene.seatHuman[seat] = player && !player.bot ? 1 : 0;
      scene.seatLabel[seat] = player ? labelFor(player) : (SEAT_COLOR_NAMES[seat] ?? "—");
    }
  }, [netHandle.players]);

  const turnSeat = clamp(game.hud.turn - 1, 0, LUDO_SEATS - 1);
  const turnName = nameOfSeat(netHandle.players, turnSeat);
  const winnerName = game.hud.winner > 0 ? nameOfSeat(netHandle.players, game.hud.winner - 1) : "";
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
      aspect={DESIGN_W / DESIGN_H}
      {...(config.debug ? { fps: game.fps } : {})}
      instructions="Escaneá un QR para tomar un color con el celular. Sin celular: Espacio tira el dado y 1 o 2 eligen la ficha; también podés tocar el dado y las fichas en pantalla. Los lugares vacíos los juegan bots."
      hud={
        <>
          <HudStat label="Juega" value={turnName} dominant tone={hudTone(turnSeat)} />
          <HudStat label="Dado" value={game.hud.die > 0 ? game.hud.die : "—"} />
          <HudStat
            label="Turno"
            value={`${game.hud.secs} s`}
            tone={game.hud.secs <= 5 ? "danger" : "default"}
          />
          <HudStat label="Tus fichas en meta" value={game.hud.goals} />
          {game.hud.captures > 0 && <HudStat label="Tus capturas" value={game.hud.captures} />}
          {game.timeLeftMs !== null && (
            <HudStat
              label="Tiempo"
              value={formatClock(game.timeLeftMs)}
              tone={game.timeLeftMs < 30_000 ? "warn" : "default"}
            />
          )}
          {config.debug && <HudStat label="Sala" value={netHandle.net?.roomId ?? "—"} />}
          {roomMismatch && <HudStat label="Salas distintas" value="revisar QR" tone="danger" />}
        </>
      }
      summary={
        <>
          <h3 className="mb-1 text-lg">
            {game.hud.winner > 0 ? `Ganó ${winnerName}` : "Se acabó el tiempo"}
          </h3>
          <p className="text-sm text-sn-muted">
            Tus fichas en la meta: <span className="sn-num">{game.hud.goals}</span>
          </p>
          <p className="mt-1 text-xs text-sn-dim">
            Capturas: <span className="sn-num">{game.hud.captures}</span>
          </p>
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* El host: tirar, mover, pasar                                         */
/* ------------------------------------------------------------------ */

/** Deja el turno listo para la proxima decision, sea de una persona o de un bot. */
function armPhase(scene: Scene): void {
  scene.autoKind = 0;
  scene.autoToken = -1;
  scene.autoMs = 0;
  scene.botMs = BOT_THINK_MS;
}

function hostRoll(scene: Scene, ctx: FrameContext<LudoHud>, auto: boolean): void {
  const state = scene.game;
  if (state.phase !== "roll") return;
  // El dado sale del PRNG sembrado del host. El celular manda "tire".
  rollDie(state, ctx.rng, auto);
  scene.spinMs = scene.dieSpinMs;
  ctx.sfx.play("select");
  armPhase(scene);
}

function hostMove(scene: Scene, ctx: FrameContext<LudoHud>, token: number): void {
  const state = scene.game;
  if (!applyMove(state, token)) return;
  scene.autoKind = 0;
  scene.walkToken = state.lastToken;
  scene.walkFrom = state.lastFrom;
  scene.walkStep = 0;
  scene.walkSteps = state.lastFrom < 0 ? 1 : Math.max(1, state.lastTo - state.lastFrom);
  scene.walkMs = 0;
  ctx.sfx.play("pick");
}

function hostPass(scene: Scene, ctx: FrameContext<LudoHud>): void {
  const state = scene.game;
  const seat = state.turn;
  passTurn(state);
  armPhase(scene);
  ctx.sfx.play("tick");
  if (state.turn === seat) pushNotice(scene, "Nada que mover, pero sacaste 6: otra tirada", 1);
  else pushNotice(scene, "Ninguna ficha podía moverse", 1);
}

/**
 * Que hacer con el dado que acaba de salir.
 *
 * Se decide una sola vez por tirada, y las tres ramas son las tres reglas de
 * ritmo del juego: si nadie se puede mover se pasa solo, si solo una ficha
 * puede moverse se mueve sola, y si el reloj ya tiro por vos tampoco te toca
 * elegir. Recien cuando hay dos opciones de verdad se espera un dedo.
 */
function scheduleChoice(scene: Scene): void {
  const state = scene.game;
  const options = currentMoves(state);
  const count = legalCount(options);

  if (count === 0) {
    scene.autoKind = 2;
    scene.autoMs = AUTO_PASS_MS;
    return;
  }
  if (count === 1) {
    scene.autoKind = 1;
    scene.autoToken = onlyLegalMove(options);
    scene.autoMs = AUTO_MOVE_MS;
    return;
  }
  if (state.autoTurn) {
    // La tirada la disparo el reloj: quien no contesto los primeros 15 s no
    // merece otros 15 para elegir.
    scene.autoKind = 1;
    scene.autoToken = autoMove(state, options);
    scene.autoMs = AUTO_MOVE_MS;
    return;
  }
  scene.autoKind = -1;
}

function runScheduled(scene: Scene, ctx: FrameContext<LudoHud>): void {
  if (scene.autoKind === 2) {
    hostPass(scene, ctx);
    return;
  }
  const token = scene.autoToken;
  scene.autoKind = -1;
  if (token >= 0) hostMove(scene, ctx, token);
  else hostPass(scene, ctx);
}

function endWalk(scene: Scene, ctx: FrameContext<LudoHud>): void {
  const state = scene.game;
  scene.walkToken = -1;
  if (state.lastCaptured >= 0) {
    scene.flyToken = state.lastCaptured;
    scene.flyFrom = state.lastCapturedFrom;
    scene.flyElapsed = 0;
    ctx.sfx.play("hit");
    if (!ctx.reducedMotion) {
      scene.shakeMs = SHAKE_MS;
      burst(scene, state.lastCaptured);
    }
    return;
  }
  resolveMove(scene, ctx);
}

function endFly(scene: Scene, ctx: FrameContext<LudoHud>): void {
  scene.flyToken = -1;
  resolveMove(scene, ctx);
}

function resolveMove(scene: Scene, ctx: FrameContext<LudoHud>): void {
  const state = scene.game;
  const seat = state.turn;
  const captured = state.lastCaptured;
  const reachedGoal = state.lastReachedGoal;

  if (captured >= 0) {
    const victim = seatOfToken(state.rules, captured);
    pushNotice(scene, `${scene.seatLabel[seat] ?? ""} se comió una ficha de ${scene.seatLabel[victim] ?? ""}`, 2);
  }
  if (reachedGoal) {
    scene.goalPulse[seat] = 1;
    scene.flashMs = ctx.reducedMotion ? 0 : 140;
    ctx.sfx.play("win");
  }

  finishMove(state);
  armPhase(scene);

  if (state.over) {
    ctx.sfx.play("win");
    pushNotice(scene, `¡Ganó ${scene.seatLabel[state.winner] ?? ""}!`, 0);
    return;
  }
  if (state.turn === seat && !captured && !reachedGoal) {
    pushNotice(scene, "¡Otra tirada!", 0);
  }
}

/* ------------------------------------------------------------------ */
/* Entrada: la misma cola para el celular, el teclado y el click        */
/* ------------------------------------------------------------------ */

function queuePress(scene: Scene, seat: number, button: string): void {
  if (seat < 0 || seat >= LUDO_SEATS) return;
  scene.pendingPress[seat] = button;
  scene.pendingBot[seat] = 0;
  // Tocar es tomar el asiento: el bot que lo estaba llenando se calla un rato.
  scene.localHoldMs = LOCAL_HOLD_MS;
}

/**
 * Teclado y click del proyector.
 *
 * Existen para que el juego sea jugable en solitario contra bots sin un
 * celular a mano, que es la unica forma de desarrollarlo y de probarlo desde
 * el banco de pruebas. Van al asiento propio, no al que tenga el turno: robarle
 * el turno a alguien que si tiene celular seria peor que no tener teclado.
 */
function readLocalInput(scene: Scene, ctx: FrameContext<LudoHud>): void {
  const state = scene.game;
  const seat = scene.viewSeat;
  const keys = ctx.input.keys;

  const rollDown = keys.has("Space") || keys.has("Enter");
  if (rollDown && !scene.rollKeyHeld) queuePress(scene, seat, ROLL_BUTTON);
  scene.rollKeyHeld = rollDown;

  for (let token = 0; token < DIGIT_CODES.length; token++) {
    if (token >= state.rules.tokensPerPlayer) break;
    const down = keys.has(DIGIT_CODES[token] ?? "");
    if (down && (scene.pickKeyHeld[token] ?? 0) === 0) queuePress(scene, seat, TOKEN_PREFIX + token);
    scene.pickKeyHeld[token] = down ? 1 : 0;
  }

  if (ctx.input.pointer.justPressed) {
    const hit = hitTest(scene, ctx.input.pointer.x, ctx.input.pointer.y);
    if (hit === -2) queuePress(scene, seat, ROLL_BUTTON);
    else if (hit >= 0) queuePress(scene, seat, TOKEN_PREFIX + hit);
  }
}

/** -2 = el dado, 0..n = una ficha propia, -1 = nada. */
function hitTest(scene: Scene, x: number, y: number): number {
  const state = scene.game;
  const rules = state.rules;
  const seat = scene.viewSeat;

  const dieR = scene.layout.cell * 0.95;
  if (Math.abs(x - BOARD_CX) <= dieR && Math.abs(y - BOARD_CY) <= dieR) return -2;

  const radius = scene.layout.cell * 0.55;
  for (let token = 0; token < rules.tokensPerPlayer; token++) {
    const progress = state.progress[tokenIndex(rules, seat, token)] ?? -1;
    pointAt(scene.layout, rules, seat, token, progress, scene.scratch);
    const dx = x - screenX(scene.scratch.x);
    const dy = y - screenY(scene.scratch.y);
    if (dx * dx + dy * dy <= radius * radius * 2.2) return token;
  }
  return -1;
}

/**
 * Consume los toques encolados.
 *
 * Todo pasa por aca —celular, teclado y click— y todo se valida igual: si no
 * es tu turno, si la fase no corresponde o si la ficha no se podia mover, el
 * toque se descarta y no rompe nada. Un dedo y un reloj de 15 s se cruzan mas
 * seguido de lo que parece.
 */
function drainPresses(scene: Scene, ctx: FrameContext<LudoHud>): void {
  const state = scene.game;
  for (let seat = 0; seat < LUDO_SEATS; seat++) {
    const button = scene.pendingPress[seat] ?? "";
    if (!button) continue;
    if (seat !== state.turn || state.over) {
      scene.pendingPress[seat] = "";
      continue;
    }
    // El bot se toma un momento: si contestara al instante, la sala no
    // llegaria a ver ni el dado ni la ficha moviendose.
    if ((scene.pendingBot[seat] ?? 0) === 1 && scene.botMs > 0) continue;
    scene.pendingPress[seat] = "";

    if (button === ROLL_BUTTON) {
      if (state.phase === "roll") hostRoll(scene, ctx, false);
      continue;
    }
    if (!button.startsWith(TOKEN_PREFIX) || state.phase !== "choose") continue;
    const token = Number.parseInt(button.slice(TOKEN_PREFIX.length), 10);
    if (Number.isInteger(token)) hostMove(scene, ctx, token);
  }
}

/* ------------------------------------------------------------------ */
/* Temporizadores, avisos y particulas                                  */
/* ------------------------------------------------------------------ */

function decayTimers(scene: Scene, ms: number): void {
  if (scene.spinMs > 0) scene.spinMs = Math.max(0, scene.spinMs - ms);
  if (scene.flashMs > 0) scene.flashMs = Math.max(0, scene.flashMs - ms);
  if (scene.shakeMs > 0) scene.shakeMs = Math.max(0, scene.shakeMs - ms);
  if (scene.noticeMs > 0) scene.noticeMs = Math.max(0, scene.noticeMs - ms);
  if (scene.botMs > 0) scene.botMs = Math.max(0, scene.botMs - ms);
  if (scene.localHoldMs > 0) scene.localHoldMs = Math.max(0, scene.localHoldMs - ms);
  for (let seat = 0; seat < LUDO_SEATS; seat++) {
    const pulse = scene.goalPulse[seat] ?? 0;
    if (pulse > 0) scene.goalPulse[seat] = Math.max(0, pulse - ms / 900);
  }
}

function pushNotice(scene: Scene, text: string, tone: number): void {
  scene.noticeText = text;
  scene.noticeTone = tone;
  scene.noticeMs = NOTICE_MS;
}

function burst(scene: Scene, tokenGlobal: number): void {
  const state = scene.game;
  const rules = state.rules;
  const seat = seatOfToken(rules, tokenGlobal);
  const token = tokenGlobal - seat * rules.tokensPerPlayer;
  pointAt(scene.layout, rules, seat, token, state.lastCapturedFrom, scene.scratch);
  const x = screenX(scene.scratch.x);
  const y = screenY(scene.scratch.y);

  for (let i = 0; i < SPARKS_PER_CAPTURE; i++) {
    const head = scene.sparkHead;
    scene.sparkHead = (head + 1) % MAX_SPARKS;
    const angle = nextNoise(scene) * Math.PI * 2;
    const speed = 140 + nextNoise(scene) * 340;
    scene.sparkX[head] = x;
    scene.sparkY[head] = y;
    scene.sparkVx[head] = Math.cos(angle) * speed;
    scene.sparkVy[head] = Math.sin(angle) * speed - 120;
    const life = 0.5 + nextNoise(scene) * 0.4;
    scene.sparkLife[head] = life;
    scene.sparkMax[head] = life;
    scene.sparkSeat[head] = seat;
  }
}

function updateSparks(scene: Scene, dt: number): void {
  for (let i = 0; i < MAX_SPARKS; i++) {
    const life = scene.sparkLife[i] ?? 0;
    if (life <= 0) continue;
    scene.sparkLife[i] = life - dt;
    scene.sparkVy[i] = (scene.sparkVy[i] ?? 0) + SPARK_GRAVITY * dt;
    scene.sparkX[i] = (scene.sparkX[i] ?? 0) + (scene.sparkVx[i] ?? 0) * dt;
    scene.sparkY[i] = (scene.sparkY[i] ?? 0) + (scene.sparkVy[i] ?? 0) * dt;
  }
}

/** El azar del render sale de un ruido sembrado, nunca de `ctx.rng`: consumirlo
    en el dibujo haria que el proximo dado dependa de los fps. */
function nextNoise(scene: Scene): number {
  const value = scene.noise[scene.noiseCursor] ?? 0.5;
  scene.noiseCursor = (scene.noiseCursor + 1) % NOISE_SIZE;
  return value;
}

function pushHud(scene: Scene, ctx: FrameContext<LudoHud>): void {
  const state = scene.game;
  ctx.setHud({
    turn: state.turn + 1,
    die: state.die,
    secs: Math.max(0, Math.ceil(state.turnMsLeft / 1000)),
    goals: tokensAtGoal(state, scene.viewSeat),
    captures: state.capturesBy[scene.viewSeat] ?? 0,
    winner: state.winner + 1,
  });
}

/* ------------------------------------------------------------------ */
/* El mando                                                             */
/* ------------------------------------------------------------------ */

type ControlMemory = {
  signature: string[];
  owner: string[];
  hapticId: string[];
  hapticPattern: Array<number | readonly number[]>;
  hapticTicks: Int32Array;
  seenTurn: Int32Array;
  seenRoll: Int32Array;
  seenMove: Int32Array;
  noticeText: string[];
};

function createControlMemory(): ControlMemory {
  return {
    signature: ["", "", "", ""],
    owner: ["", "", "", ""],
    hapticId: ["", "", "", ""],
    hapticPattern: [HAPTIC_TURN, HAPTIC_TURN, HAPTIC_TURN, HAPTIC_TURN],
    hapticTicks: new Int32Array(LUDO_SEATS),
    seenTurn: new Int32Array(LUDO_SEATS).fill(-1),
    seenRoll: new Int32Array(LUDO_SEATS).fill(-1),
    seenMove: new Int32Array(LUDO_SEATS).fill(-1),
    noticeText: ["", "", "", ""],
  };
}

/**
 * Lo que ve un celular.
 *
 * No hace falta layout de la base: es una interfaz de turnos, no un control
 * continuo. Con el `pad` alcanza, y lo que lo hace bueno es una sola cosa:
 * **las fichas que no se pueden mover llegan deshabilitadas con el motivo**.
 * "En casa, necesitás 5 o 6" enseña la regla sin tutorial; un botón apagado y
 * mudo sólo confunde.
 *
 * Va dirigido por asiento: sólo quien tiene el turno recibe botones
 * habilitados, y el resto ve a quién le toca. Devuelve null cuando nada
 * cambió, así que en reposo el tráfico es cero.
 */
function buildControlSpec(
  scene: Scene,
  seat: number,
  playerId: string,
  playing: boolean,
  memory: ControlMemory,
): ControlSpec | null {
  const state = scene.game;
  const rules = state.rules;
  const mine = state.turn === seat && !state.over;
  const secs = Math.max(0, Math.ceil(state.turnMsLeft / 1000));
  const haptic = seatHaptic(scene, seat, memory);
  const notice = memory.noticeText[seat] ?? "";

  let positions = "";
  for (let token = 0; token < rules.tokensPerPlayer; token++) {
    positions += (state.progress[tokenIndex(rules, seat, token)] ?? -1) + ",";
  }
  // Los segundos entran en la firma SOLO para quien tiene el turno: es el
  // unico que necesita ver correr el reloj. Sin esa distincion, los otros tres
  // telefonos recibirian un paquete por segundo para mirar.
  const signature = [
    playing ? 1 : 0,
    state.phase,
    state.turn,
    state.die,
    mine ? secs : 0,
    positions,
    state.moves,
    notice,
    haptic?.id ?? "",
    state.over ? state.winner : -1,
  ].join("|");

  // Un aparato que acaba de tomar el asiento tiene que recibir su pantalla
  // aunque no haya cambiado nada: el spec dirigido no se reenvia solo.
  const fresh = memory.owner[seat] !== playerId;
  if (!fresh && memory.signature[seat] === signature) return null;
  memory.owner[seat] = playerId;
  memory.signature[seat] = signature;

  const status: ControlStatus[] = [
    { label: "Dado", value: state.die > 0 ? String(state.die) : "—" },
  ];
  for (let token = 0; token < rules.tokensPerPlayer; token++) {
    const progress = state.progress[tokenIndex(rules, seat, token)] ?? -1;
    status.push({ label: `Ficha ${token + 1}`, value: placeText(rules, seat, progress) });
  }
  status.push({
    label: "En la meta",
    value: `${tokensAtGoal(state, seat)}/${rules.tokensPerPlayer}`,
  });

  let buttons: ControlButton[] | undefined;
  if (mine && state.phase === "roll") {
    buttons = [{ id: ROLL_BUTTON, label: "Tirar el dado", group: "main" }];
  } else if (mine && state.phase === "choose") {
    const options = movesFor(state, seat, state.die);
    const only = onlyLegalMove(options);
    buttons = options.map((option) => {
      const hint = option.legal
        ? only === option.token
          ? "se juega sola"
          : moveHintText(option, rules, seat)
        : placeText(rules, seat, option.from);
      return {
        id: TOKEN_PREFIX + option.token,
        label: `Ficha ${option.token + 1}`,
        group: "main",
        shape: SEAT_SHAPES[seat] ?? "circle",
        hint,
        ...(option.legal ? {} : { disabled: true, disabledReason: blockReasonText(option, rules) }),
      } satisfies ControlButton;
    });
  }

  const title = state.over
    ? `Ganó ${scene.seatLabel[state.winner] ?? ""}`
    : mine
      ? state.phase === "roll"
        ? `Tu turno · ${secs} s`
        : state.phase === "choose"
          ? `Elegí qué ficha mover · ${secs} s`
          : "Moviendo…"
      : `Juega ${scene.seatLabel[state.turn] ?? ""}`;

  return {
    layout: "pad",
    title,
    enabled: playing && mine && (state.phase === "roll" || state.phase === "choose"),
    ...(buttons ? { buttons } : {}),
    status,
    ...(notice ? { notice } : {}),
    ...(haptic ? { haptic } : {}),
  };
}

/**
 * Lo que le paso A ESTE TELEFONO: vibracion y aviso.
 *
 * Cuatro momentos, y los cuatro son de la spec: te toca, tiraste, comiste y te
 * comieron. El `id` sale de contadores de la logica, asi que cambia solo
 * cuando pasa el evento y el telefono vibra una vez, no en cada refresco.
 */
function seatHaptic(scene: Scene, seat: number, memory: ControlMemory): ControlHaptic | null {
  const state = scene.game;
  let ticks = memory.hapticTicks[seat] ?? 0;
  if (ticks > 0) ticks--;

  const firstTurn = (memory.seenTurn[seat] ?? -1) < 0;
  const turnChanged = memory.seenTurn[seat] !== state.turns;
  const rollChanged = memory.seenRoll[seat] !== state.rolls;
  const moveChanged = memory.seenMove[seat] !== state.moves;

  if (moveChanged && !firstTurn && state.lastCaptured >= 0) {
    const victim = seatOfToken(state.rules, state.lastCaptured);
    if (victim === seat) {
      memory.hapticId[seat] = `bitten-${state.moves}`;
      memory.hapticPattern[seat] = HAPTIC_BITTEN;
      memory.noticeText[seat] = "Te comieron una ficha";
      ticks = HAPTIC_TICKS;
    } else if (state.turn === seat) {
      memory.hapticId[seat] = `eat-${state.moves}`;
      memory.hapticPattern[seat] = HAPTIC_EAT;
      memory.noticeText[seat] = "¡Te comiste una ficha! Tirás de nuevo";
      ticks = HAPTIC_TICKS;
    }
  } else if (rollChanged && !firstTurn && state.turn === seat) {
    memory.hapticId[seat] = `roll-${state.rolls}`;
    memory.hapticPattern[seat] = HAPTIC_ROLL;
    memory.noticeText[seat] = state.autoTurn ? "Tiró el reloj por vos" : "";
    ticks = HAPTIC_TICKS;
  } else if (turnChanged && !firstTurn && state.turn === seat) {
    memory.hapticId[seat] = `turn-${state.turns}`;
    memory.hapticPattern[seat] = HAPTIC_TURN;
    memory.noticeText[seat] = "";
    ticks = HAPTIC_TICKS;
  }

  memory.seenTurn[seat] = state.turns;
  memory.seenRoll[seat] = state.rolls;
  memory.seenMove[seat] = state.moves;
  memory.hapticTicks[seat] = ticks;
  if (ticks <= 0) memory.noticeText[seat] = "";
  if (ticks <= 0 || !memory.hapticId[seat]) return null;

  return { id: memory.hapticId[seat] ?? "", pattern: memory.hapticPattern[seat] ?? HAPTIC_TURN };
}

/* ------------------------------------------------------------------ */
/* Dibujo                                                               */
/* ------------------------------------------------------------------ */

function drawLudo(
  scene: Scene,
  g: CanvasRenderingContext2D,
  background: string,
  reducedMotion: boolean,
  alpha: number,
): void {
  g.fillStyle = background;
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  g.fillStyle = scene.bgGlow;
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);

  g.save();
  if (scene.shakeMs > 0 && !reducedMotion) {
    const strength = (scene.shakeMs / SHAKE_MS) * SHAKE_PX;
    g.translate((nextNoise(scene) * 2 - 1) * strength, (nextNoise(scene) * 2 - 1) * strength);
  }

  drawTrack(scene, g);
  drawHouses(scene, g);
  drawTokens(scene, g, alpha, reducedMotion);
  drawSparks(scene, g);
  drawDie(scene, g, reducedMotion);
  g.restore();

  drawPanel(scene, g);
  drawNotice(scene, g);

  if (scene.flashMs > 0) {
    g.fillStyle = withAlpha(scene.textColor, (scene.flashMs / 140) * 0.16);
    g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  }
}

function drawTrack(scene: Scene, g: CanvasRenderingContext2D): void {
  const rules = scene.game.rules;
  const layout = scene.layout;
  const size = layout.cell;

  g.lineWidth = 2;
  for (let square = 0; square < rules.trackLength; square++) {
    const x = screenX(layout.trackX[square] ?? 0);
    const y = screenY(layout.trackY[square] ?? 0);
    const owner = ownerOfSquare(rules, square);
    const safe = isSafeSquare(rules, square);

    roundRect(g, x - size / 2, y - size / 2, size, size, size * 0.22);
    g.fillStyle = safe ? (scene.seatSoft[owner] ?? scene.cellFill) : scene.cellFill;
    g.fill();
    g.strokeStyle = safe ? (scene.seatColor[owner] ?? scene.lineColor) : scene.lineColor;
    g.stroke();

    // Las casillas seguras llevan ademas una marca: no se distinguen solo por
    // color, que en una sala de 40 personas siempre deja a alguien afuera.
    if (safe) {
      g.strokeStyle = withAlpha(scene.seatColor[owner] ?? scene.lineColor, 0.85);
      drawShape(g, "diamond", x, y, size * 0.22);
      g.stroke();
    }
  }

  const homeSize = layout.homeCell;
  const goal = rules.homeLength - 1;
  for (let seat = 0; seat < rules.seats; seat++) {
    for (let j = 0; j < rules.homeLength; j++) {
      const index = seat * rules.homeLength + j;
      const x = screenX(layout.homeX[index] ?? 0);
      const y = screenY(layout.homeY[index] ?? 0);
      const last = j === goal;
      const pulse = last ? (scene.goalPulse[seat] ?? 0) : 0;
      roundRect(g, x - homeSize / 2, y - homeSize / 2, homeSize, homeSize, homeSize * 0.24);
      g.fillStyle = last
        ? withAlpha(scene.seatColor[seat] ?? scene.cellFill, 0.34 + pulse * 0.5)
        : (scene.seatFaint[seat] ?? scene.cellFill);
      g.fill();
      g.strokeStyle = withAlpha(scene.seatColor[seat] ?? scene.lineColor, last ? 0.95 : 0.4);
      g.lineWidth = last ? 3 : 2;
      g.stroke();
    }
  }
  g.lineWidth = 2;
}

function drawHouses(scene: Scene, g: CanvasRenderingContext2D): void {
  const state = scene.game;
  const rules = state.rules;
  const layout = scene.layout;
  const size = layout.houseR * 1.7;

  for (let seat = 0; seat < rules.seats; seat++) {
    const x = screenX(layout.houseX[seat] ?? 0);
    const y = screenY(layout.houseY[seat] ?? 0);
    const active = state.turn === seat && !state.over;

    roundRect(g, x - size / 2, y - size / 2, size, size, size * 0.18);
    g.fillStyle = scene.seatFaint[seat] ?? scene.cellFill;
    g.fill();
    g.strokeStyle = withAlpha(scene.seatColor[seat] ?? scene.lineColor, active ? 0.95 : 0.35);
    g.lineWidth = active ? 4 : 2;
    g.stroke();

    // El nombre del jugador va con su casa y no pegado a cada ficha: ocho
    // etiquetas sueltas sobre el tablero tapan las fichas que describen.
    g.font = FONT_HOUSE;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = active ? (scene.seatColor[seat] ?? scene.textColor) : scene.mutedColor;
    g.fillText(scene.seatLabel[seat] ?? "", x, y + size / 2 + 16, size * 1.3);

    for (let token = 0; token < rules.tokensPerPlayer; token++) {
      const index = seat * rules.tokensPerPlayer + token;
      const sx = screenX(layout.baseX[index] ?? 0);
      const sy = screenY(layout.baseY[index] ?? 0);
      g.strokeStyle = withAlpha(scene.seatColor[seat] ?? scene.lineColor, 0.4);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx, sy, layout.cell * 0.36, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.lineWidth = 2;
}

function drawTokens(
  scene: Scene,
  g: CanvasRenderingContext2D,
  alpha: number,
  reducedMotion: boolean,
): void {
  const state = scene.game;
  const rules = state.rules;
  const layout = scene.layout;
  const total = rules.seats * rules.tokensPerPlayer;
  const radius = layout.cell * 0.34;

  // Cuantas fichas comparten celda, para separarlas sin superponerlas. Dos
  // bucles sobre 8 fichas: no asigna nada.
  for (let i = 0; i < total; i++) {
    const seat = Math.floor(i / rules.tokensPerPlayer);
    const token = i - seat * rules.tokensPerPlayer;
    scene.cellId[i] = cellIdOf(rules, seat, token, state.progress[i] ?? -1);
    scene.stack[i] = 0;
  }
  for (let i = 0; i < total; i++) {
    let shared = 0;
    for (let j = 0; j < i; j++) if (scene.cellId[j] === scene.cellId[i]) shared++;
    scene.stack[i] = shared;
  }

  for (let i = 0; i < total; i++) {
    const seat = Math.floor(i / rules.tokensPerPlayer);
    const token = i - seat * rules.tokensPerPlayer;
    const progress = state.progress[i] ?? -1;

    let x: number;
    let y: number;
    let lift = 0;

    if (i === scene.walkToken) {
      // Casilla por casilla, no de un salto: se sigue con la vista y se
      // entiende que se movio. `alpha` interpola dentro del paso simulado.
      const t = clamp((scene.walkMs + alpha * SIM_MS) / scene.stepMs, 0, 1);
      const from = scene.walkFrom < 0 ? -1 : scene.walkFrom + scene.walkStep;
      const to = scene.walkFrom < 0 ? 0 : Math.min(from + 1, progress);
      pointAt(layout, rules, seat, token, from, scene.scratch);
      pointAt(layout, rules, seat, token, to, scene.scratchB);
      x = screenX(scene.scratch.x + (scene.scratchB.x - scene.scratch.x) * t);
      y = screenY(scene.scratch.y + (scene.scratchB.y - scene.scratch.y) * t);
      if (!reducedMotion) lift = Math.sin(t * Math.PI) * radius * 0.8;
    } else if (i === scene.flyToken) {
      // La ficha capturada vuelve volando a su casa. Es el momento del juego y
      // merece pantalla.
      const t = clamp((scene.flyElapsed + alpha * SIM_MS) / scene.flyMs, 0, 1);
      pointAt(layout, rules, seat, token, scene.flyFrom, scene.scratch);
      pointAt(layout, rules, seat, token, -1, scene.scratchB);
      x = screenX(scene.scratch.x + (scene.scratchB.x - scene.scratch.x) * t);
      y = screenY(scene.scratch.y + (scene.scratchB.y - scene.scratch.y) * t);
      lift = Math.sin(t * Math.PI) * radius * (reducedMotion ? 1 : 4);
    } else {
      // Mientras la ficha que come camina, la comida sigue donde estaba: ya
      // salio del estado, pero todavia no volo.
      const pending = scene.walkToken >= 0 && i === state.lastCaptured;
      pointAt(layout, rules, seat, token, pending ? state.lastCapturedFrom : progress, scene.scratch);
      const stack = pending ? 0 : (scene.stack[i] ?? 0);
      x = screenX(scene.scratch.x) + (stack % 2 === 0 ? -1 : 1) * stack * radius * 0.5;
      y = screenY(scene.scratch.y) - stack * radius * 0.35;
    }

    drawPawn(scene, g, x, y - lift, radius, seat, token);
  }
}

function drawPawn(
  scene: Scene,
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  seat: number,
  token: number,
): void {
  const color = scene.seatColor[seat] ?? scene.textColor;
  g.beginPath();
  g.arc(x, y + radius * 0.18, radius * 0.95, 0, Math.PI * 2);
  g.fillStyle = withAlpha(scene.dieFill, 0.55);
  g.fill();

  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.strokeStyle = withAlpha(scene.dieFill, 0.9);
  g.lineWidth = 3;
  g.stroke();

  // La forma va adentro de la ficha: el color solo no alcanza para distinguir
  // cuatro jugadores, y el numero dice cual de las dos fichas es.
  g.strokeStyle = withAlpha(scene.dieFill, 0.85);
  g.lineWidth = 2;
  drawShape(g, SEAT_SHAPES[seat] ?? "circle", x, y, radius * 0.46);
  g.stroke();

  g.font = FONT_SMALL;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = withAlpha(scene.dieFill, 0.95);
  g.fillText(String(token + 1), x, y + radius * 1.05);
}

function drawDie(scene: Scene, g: CanvasRenderingContext2D, reducedMotion: boolean): void {
  const state = scene.game;
  const size = scene.layout.cell * 1.6;
  const x = BOARD_CX;
  const y = BOARD_CY;
  const spinning = scene.spinMs > 0;
  const face = spinning ? 1 + Math.floor(nextNoise(scene) * state.rules.dieFaces) : state.die;
  const turnColor = scene.seatColor[state.turn] ?? scene.textColor;

  // El reloj de los 15 segundos vive alrededor del dado: quien mira el
  // proyector mira ahi, no a un rincon.
  const left = state.rules.turnMs > 0 ? clamp(state.turnMsLeft / state.rules.turnMs, 0, 1) : 0;
  g.beginPath();
  g.arc(x, y, size * 0.86, -Math.PI / 2, Math.PI * 2 - Math.PI / 2);
  g.strokeStyle = withAlpha(scene.lineColor, 0.8);
  g.lineWidth = 9;
  g.stroke();
  if (!state.over) {
    g.beginPath();
    g.arc(x, y, size * 0.86, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    g.strokeStyle = left < 0.34 ? (scene.noticeFill[2] ?? turnColor) : turnColor;
    g.lineWidth = 9;
    g.stroke();
  }

  g.save();
  if (spinning && !reducedMotion) {
    const t = scene.spinMs / scene.dieSpinMs;
    g.translate(x, y);
    g.rotate(t * 0.9);
    g.scale(1 + t * 0.12, 1 + t * 0.12);
    g.translate(-x, -y);
  }
  roundRect(g, x - size / 2, y - size / 2, size, size, size * 0.2);
  g.fillStyle = scene.dieFill;
  g.fill();
  g.strokeStyle = withAlpha(turnColor, 0.9);
  g.lineWidth = 4;
  g.stroke();

  if (face > 0) {
    g.fillStyle = turnColor;
    drawPips(g, x, y, size, face);
  } else {
    g.font = FONT_DIE;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = withAlpha(scene.textColor, 0.35);
    g.fillText("?", x, y + 4);
  }
  g.restore();
  g.lineWidth = 2;
}

function drawPips(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  face: number,
): void {
  const r = size * 0.075;
  const d = size * 0.24;
  const spots: ReadonlyArray<readonly [number, number]> =
    face === 1
      ? [[0, 0]]
      : face === 2
        ? [
            [-1, -1],
            [1, 1],
          ]
        : face === 3
          ? [
              [-1, -1],
              [0, 0],
              [1, 1],
            ]
          : face === 4
            ? [
                [-1, -1],
                [1, -1],
                [-1, 1],
                [1, 1],
              ]
            : face === 5
              ? [
                  [-1, -1],
                  [1, -1],
                  [0, 0],
                  [-1, 1],
                  [1, 1],
                ]
              : [
                  [-1, -1],
                  [1, -1],
                  [-1, 0],
                  [1, 0],
                  [-1, 1],
                  [1, 1],
                ];

  for (const spot of spots) {
    g.beginPath();
    g.arc(cx + (spot[0] ?? 0) * d, cy + (spot[1] ?? 0) * d, r, 0, Math.PI * 2);
    g.fill();
  }
}

function drawPanel(scene: Scene, g: CanvasRenderingContext2D): void {
  const state = scene.game;
  const rules = state.rules;
  const turnColor = scene.seatColor[state.turn] ?? scene.textColor;

  roundRect(g, PANEL_X, 62, PANEL_W, 150, 18);
  g.fillStyle = scene.panelFill;
  g.fill();
  g.strokeStyle = withAlpha(turnColor, 0.6);
  g.lineWidth = 2;
  g.stroke();

  g.textAlign = "left";
  g.textBaseline = "middle";
  g.font = FONT_SMALL;
  g.fillStyle = scene.dimColor;
  g.fillText(state.over ? "GANÓ" : "ES EL TURNO DE", PANEL_X + 26, 96);

  g.font = FONT_TURN;
  g.fillStyle = state.over
    ? (scene.seatColor[state.winner] ?? scene.textColor)
    : turnColor;
  const bannerSeat = state.over ? state.winner : state.turn;
  g.fillText(scene.seatLabel[bannerSeat] ?? "", PANEL_X + 26, 138, PANEL_W - 96);
  drawShape(g, SEAT_SHAPES[bannerSeat] ?? "circle", PANEL_X + PANEL_W - 44, 132, 18);
  g.fill();

  // Barra del turno: la cuenta regresiva tiene que verse desde el fondo.
  const left = rules.turnMs > 0 ? clamp(state.turnMsLeft / rules.turnMs, 0, 1) : 0;
  roundRect(g, PANEL_X + 26, 176, PANEL_W - 52, 12, 6);
  g.fillStyle = withAlpha(scene.lineColor, 0.9);
  g.fill();
  if (!state.over) {
    roundRect(g, PANEL_X + 26, 176, (PANEL_W - 52) * left, 12, 6);
    g.fillStyle = left < 0.34 ? (scene.noticeFill[2] ?? turnColor) : turnColor;
    g.fill();
  }

  for (let seat = 0; seat < rules.seats; seat++) {
    const y = PANEL_ROWS_Y + seat * PANEL_ROW_H;
    const active = state.turn === seat && !state.over;
    const color = scene.seatColor[seat] ?? scene.textColor;

    roundRect(g, PANEL_X, y, PANEL_W, PANEL_ROW_H - 12, 16);
    g.fillStyle = active ? (scene.seatFaint[seat] ?? scene.panelFill) : scene.panelFill;
    g.fill();
    g.strokeStyle = withAlpha(color, active ? 0.85 : 0.25);
    g.lineWidth = active ? 3 : 1.5;
    g.stroke();

    g.fillStyle = color;
    drawShape(g, SEAT_SHAPES[seat] ?? "circle", PANEL_X + 34, y + 32, 13);
    g.fill();

    g.font = FONT_ROW;
    g.textAlign = "left";
    g.fillStyle = active ? scene.textColor : scene.mutedColor;
    g.fillText(scene.seatLabel[seat] ?? "", PANEL_X + 58, y + 32, PANEL_W - 160);

    g.font = FONT_SMALL;
    g.fillStyle = scene.dimColor;
    const inBase = tokensAtBase(state, seat);
    const inGoal = tokensAtGoal(state, seat);
    const onTrack = rules.tokensPerPlayer - inBase - inGoal;
    g.fillText(
      `casa ${inBase} · en juego ${onTrack} · meta ${inGoal}`,
      PANEL_X + 58,
      y + 62,
      PANEL_W - 170,
    );

    g.textAlign = "right";
    g.font = FONT_ROW;
    g.fillStyle = active ? color : scene.mutedColor;
    g.fillText(String(advanceOf(state, seat)), PANEL_X + PANEL_W - 26, y + 32);
    g.font = FONT_SMALL;
    g.fillStyle = scene.dimColor;
    g.fillText("avance", PANEL_X + PANEL_W - 26, y + 58);

    if ((scene.seatLeft[seat] ?? 0) === 1) {
      g.fillStyle = scene.noticeFill[1] ?? scene.mutedColor;
      g.fillText("lo sigue un bot", PANEL_X + PANEL_W - 26, y + 80);
    }
  }
  g.lineWidth = 2;
}

function drawNotice(scene: Scene, g: CanvasRenderingContext2D): void {
  if (scene.noticeMs <= 0 || !scene.noticeText) return;
  const fade = Math.min(1, scene.noticeMs / 400);
  g.font = FONT_NOTICE;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = withAlpha(scene.noticeFill[scene.noticeTone] ?? scene.textColor, fade);
  g.fillText(scene.noticeText, BOARD_CX, DESIGN_H - 24, BOARD_R * 2.3);
}

function drawSparks(scene: Scene, g: CanvasRenderingContext2D): void {
  for (let i = 0; i < MAX_SPARKS; i++) {
    const life = scene.sparkLife[i] ?? 0;
    if (life <= 0) continue;
    const max = scene.sparkMax[i] || 1;
    const seat = scene.sparkSeat[i] ?? 0;
    g.fillStyle = withAlpha(scene.seatColor[seat] ?? scene.textColor, (life / max) * 0.85);
    g.beginPath();
    g.arc(scene.sparkX[i] ?? 0, scene.sparkY[i] ?? 0, 4 * (life / max) + 1, 0, Math.PI * 2);
    g.fill();
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades de dibujo y de datos                                      */
/* ------------------------------------------------------------------ */

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + radius, y);
  g.lineTo(x + w - radius, y);
  g.quadraticCurveTo(x + w, y, x + w, y + radius);
  g.lineTo(x + w, y + h - radius);
  g.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  g.lineTo(x + radius, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - radius);
  g.lineTo(x, y + radius);
  g.quadraticCurveTo(x, y, x + radius, y);
  g.closePath();
}

function drawShape(
  g: CanvasRenderingContext2D,
  shape: OptionShape,
  x: number,
  y: number,
  r: number,
): void {
  g.beginPath();
  if (shape === "circle") {
    g.arc(x, y, r, 0, Math.PI * 2);
  } else if (shape === "square") {
    g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
  } else if (shape === "triangle") {
    g.moveTo(x, y - r);
    g.lineTo(x + r * 0.92, y + r * 0.72);
    g.lineTo(x - r * 0.92, y + r * 0.72);
    g.closePath();
  } else {
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
  }
}

/** De quien es la casilla segura. Cada entrada pertenece a un color. */
function ownerOfSquare(rules: LudoRules, square: number): number {
  const quarter = rules.trackLength / rules.seats;
  return Math.floor(square / quarter) % rules.seats;
}

function parseEntryRolls(raw: string): readonly number[] {
  const values: number[] = [];
  for (const char of raw) {
    const value = Number.parseInt(char, 10);
    if (Number.isInteger(value) && value >= 1 && value <= 6 && !values.includes(value)) {
      values.push(value);
    }
  }
  values.sort((a, b) => a - b);
  return values.length > 0 ? values : DEFAULT_RULES.entryRolls;
}

function labelFor(player: NetPlayer): string {
  if (player.bot) return `${SEAT_COLOR_NAMES[player.seat] ?? "Bot"} · bot`;
  return player.name || (SEAT_COLOR_NAMES[player.seat] ?? "Jugador");
}

/** Como se llama ese color en el HUD. Sin nadie sentado, el nombre del color. */
function nameOfSeat(players: readonly NetPlayer[], seat: number): string {
  for (const player of players) {
    if (player.seat === seat) return labelFor(player);
  }
  return SEAT_COLOR_NAMES[seat] ?? "—";
}

function hudTone(seat: number): "cyan" | "magenta" | "warn" | "default" {
  if (seat === 0) return "cyan";
  if (seat === 1) return "magenta";
  if (seat === 3) return "warn";
  return "default";
}
