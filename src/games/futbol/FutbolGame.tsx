import { useEffect, useMemo, useRef } from "react";
import type { GameProps } from "@/core/contract/game";
import { num } from "@/core/contract/settings";
import type { GameNetPort, NetConditions, NetPlayer } from "@/core/contract/gameNet";
import type { ControlHaptic, ControlInput, ControlSpec, ControlStatus } from "@/core/contract/control";
import { clamp } from "@/core/engine/collide";
import { withAlpha } from "@/core/engine/palette";
import type { Sfx } from "@/core/engine/audio";
import { useGame2D, type DrawContext, type FrameContext } from "@/core/engine/useGame2D";
import type { BotPolicy } from "@/core/net/mockNet";
import { useGameNet } from "@/core/net/useGameNet";
import { createSnapshotBuffer, lerpAngle, type SnapshotBuffer } from "@/core/net/interpolation";
import { createPrediction, type Prediction } from "@/core/net/prediction";
import {
  createSnapshotCodec,
  type NetEntity,
  type NetSnapshot,
  type SnapshotCodec,
} from "@/core/net/snapshot";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  createFieldGeometry,
  createFutbolRules,
  createFutbolState,
  futbolPoints,
  goalBottom,
  goalTop,
  requestKick,
  setIntent,
  stepDisc,
  stepMatch,
  teamOfSeat,
  BALL_ID,
  FUTBOL_SEATS,
  PHASE_CELEBRATION,
  PHASE_KICKOFF,
  PHASE_OVER,
  PHASE_PLAYING,
  type DiscIntent,
  type FieldGeometry,
  type FutbolResult,
  type FutbolState,
  type PredictedDisc,
} from "./logic";

/**
 * X6 · Supernova Futbol.
 *
 * Es el primer juego que usa `snapshot.ts`, `interpolation.ts` y
 * `prediction.ts`, asi que importa mas por lo que demuestra que por lo que es.
 * Cuatro decisiones lo explican entero:
 *
 * 1. **Un solo archivo, dos roles.** `arena` de verdad: el asiento 0 es el
 *    host y los demas son clientes, como en Corredor. El host simula a paso
 *    fijo, decide los goles y publica estado a 20 Hz con `broadcastState`. Un
 *    cliente NO simula la partida: dibuja lo que le llega y manda intencion.
 *    Lo que llega se saneia en `setIntent` antes de tocar la simulacion, y un
 *    puntaje que mande un cliente no existe: el host no lo mira.
 *
 * 2. **Los dos dibujan lo mismo, y por el mismo camino.** El cliente saca su
 *    vista de `sampleState()`, que es el buffer de interpolacion que llena
 *    `useGameNet` con los snapshots reales. El host no recibe estado —lo
 *    produce—, asi que se lo manda a si mismo por un cano local con la misma
 *    latencia, jitter y perdida que el mock: se dibuja a si mismo COMO cliente.
 *    Suena a capricho y no lo es. Primero, el proyector muestra exactamente lo
 *    que muestra un celular, artefactos de red incluidos, asi que cualquier
 *    problema se ve en la pantalla grande. Segundo, y mas importante: sin eso,
 *    una partida en solitario contra bots —que es un requisito de la base— no
 *    ejercitaria una sola linea de interpolacion ni de prediccion.
 *
 * 3. **Prediccion de UN disco, con reconciliacion.** En un cliente es la unica
 *    forma de que el pulgar no se sienta 80 ms tarde. En el host podria
 *    adelantar los ocho discos, porque conoce el input de todos, y a proposito
 *    no lo hace: `prediction.ts` esta pensado para un cliente que solo conoce
 *    el suyo, y adelantar los ajenos haria que el proyector muestre un partido
 *    distinto del que muestran los celulares. Se predice el asiento propio y
 *    nada mas; el resto va interpolado.
 *
 * 4. **Fisica a mano, no Rapier.** El motivo largo esta en `logic.ts`: la
 *    reconciliacion pide un `step` puro y re-ejecutable, y un mundo de fisica
 *    con estado interno no lo da sin serializarlo entero cada 50 ms.
 *
 * 5. **El telefono sirve de las dos maneras.** Con `phoneRole: "player"` corre
 *    este mismo componente y manda `drive`; con `"control"` corre
 *    `ControlPage` y manda `ControlInput` sobre el `ControlSpec` que le dibuja
 *    el host. No hace falta elegir en el codigo: quien manda `drive` se
 *    identifica solo y el host deja de mandarle pantallas de mando.
 */

/* ------------------------------------------------------------------ */
/* Ritmos                                                               */
/* ------------------------------------------------------------------ */

/** Paso de simulacion. La pelota pateada vuela y a 1/60 recorre demasiado. */
const SIM_STEP = 1 / 120;
/** Tope de subpasos por cuadro: volver de una pestana oculta no dispara la espiral. */
const MAX_SUBSTEPS = 12;
/** Contrato: estado a 20 Hz, input a 30 Hz, render a 60. */
const STATE_STEP = 1 / 20;
const INPUT_STEP = 1 / 30;
/** Dos ticks de estado mas margen. Es lo que absorbe el jitter. */
const VIEW_DELAY_MS = 80;
const BOT_HZ = 30;
/** El mando se redibuja 10 veces por segundo: el dedo no necesita mas. */
const CONTROL_MS = 100;

/* ------------------------------------------------------------------ */
/* Formato del snapshot                                                 */
/* ------------------------------------------------------------------ */

const ENTITY_COUNT = FUTBOL_SEATS + 1;

const S_SCORE_A = 0;
const S_SCORE_B = 1;
const S_PHASE = 2;
const S_CLOCK_MS = 3;
const S_PHASE_MS = 4;
const S_KICKS = 5;
const S_GOALS = 6;
const S_GOAL_TEAM = 7;
/** Punto del ultimo golpe, empaquetado: x en 12 bits, y en los 11 de arriba. */
const S_KICK_POS = 8;
const S_GOAL_SEAT = 9;
const S_POSTS = 10;
const S_KICK_SEAT = 11;
const S_ASSIST_SEAT = 12;
/**
 * Toques por asiento, cuatro por escalar y siete bits cada uno.
 *
 * Es lo unico del puntaje que un cliente NO puede deducir mirando el flujo:
 * los goles y las asistencias vienen con su autor en cada evento, pero un
 * toque no genera evento. Y sin toques el cliente tendria que inventarse el
 * bono por participar, que es exactamente lo que el contrato prohibe. Siete
 * bits porque el bono satura a los 30 toques: 127 sobra y deja el escalar
 * lejos del bit de signo.
 */
const S_TOUCHES_0 = 13;
const S_TOUCHES_1 = 14;
const SCALAR_COUNT = 15;
/** Desplazamiento de la coordenada Y dentro de `S_KICK_POS`. */
const KICK_POS_SHIFT = 12;
const KICK_POS_MASK = 0xfff;
/** El mundo empieza en -70 detras del arco: se corre para que no haya negativos. */
const KICK_POS_BIAS = 128;
const TOUCH_BITS = 7;
const TOUCH_MAX = (1 << TOUCH_BITS) - 1;

const FLAG_TEAM_B = 1 << 0;
const FLAG_HUMAN = 1 << 1;
const FLAG_KICK_READY = 1 << 2;

/** `broadcastState` ya completa los acks desde los asientos; no hace falta armarlos. */
const EMPTY_ACKS: Readonly<Record<string, number>> = Object.freeze({});

/* ------------------------------------------------------------------ */
/* Presentacion                                                         */
/* ------------------------------------------------------------------ */

const TRAIL_MAX = 16;
const TRAIL_REDUCED = 5;
const MAX_SPARKS = 200;
const SPARKS_PER_GOAL = 60;
const MAX_RIPPLES = 20;
const RIPPLE_LIFE = 0.42;
const NOISE_SIZE = 96;

const FLASH_MS = 220;
const SHAKE_MS = 380;
const SHAKE_PX = 9;
const NOTICE_MS = 2600;
const OVER_HOLD_MS = 1800;

/** Ritmo con el que se absorbe la correccion de la reconciliacion. */
const SMOOTH_RATE = 14;
/** Correccion mas grande que esto se aplica de golpe: arrastrarla se ve peor. */
const MAX_SMOOTH = 70;

/** Zona muerta del deslizador: dentro de esto el disco deja de acelerar. */
const TARGET_DEADZONE = 45;
/** Radio de la palanca virtual, en unidades del mundo. */
const STICK_RADIUS = 130;
/** Dentro de esto el pulgar no manda: si no, el disco tiembla al apoyarlo. */
const STICK_DEADZONE = 16;
/**
 * La franja derecha de la cancha es el boton de patear.
 *
 * No hay boton dibujado en un rincon porque el pulgar derecho ya vive ahi, y
 * porque con un dedo la palanca queda inutilizable si el boton se la come.
 */
const KICK_ZONE = 0.62;
/** Sobre esto el juego se siente roto y hay que decirlo. Callarlo es peor. */
const LATENCY_WARN_MS = 200;
/*
 * Aca vivia un re-anclaje del buffer de interpolacion: el estimador de desfase
 * de la base solo se recuperaba 0,5 ms por snapshot, y `useGame2D` pausa sola
 * cuando se oculta la pestana, asi que volver de una pausa dejaba el 99 % de los
 * cuadros dibujando el ultimo snapshot congelado. Ya no hace falta: la base
 * re-ancla cuando la diferencia pasa el medio segundo, y lo hace en `push`, que
 * es mejor que hacerlo en `sample` como hacia este juego —corrige antes de que
 * el cuadro malo llegue a dibujarse, y le sirve tambien al buffer que arma
 * `useGameNet` para los clientes, al que este juego no tenia como llegar.
 */

const FONT_SCORE = '700 128px "Space Grotesk", sans-serif';
const FONT_CLOCK = '600 40px "Space Grotesk", sans-serif';
const FONT_BANNER = '700 76px "Space Grotesk", sans-serif';
const FONT_NOTICE = '600 26px "Space Grotesk", sans-serif';
const FONT_INITIAL = '700 24px "Space Grotesk", sans-serif';

/** `String(n)` por cuadro es una asignacion por cuadro. */
const NUMBER_LABELS: readonly string[] = Array.from({ length: 64 }, (_, i) => String(i));
const SEAT_INITIALS: readonly string[] = ["A", "B", "C", "D", "E", "F", "G", "H"];
const TEAM_NAMES: readonly string[] = ["Cian", "Magenta"];
const BANNER_KICKOFF = "Saque";
const BANNER_GOAL = "¡Gol!";
const BANNER_OVER = "Final";
const LABEL_KICK = "PATEAR";

const HAPTIC_KICK: readonly number[] = [18];
const HAPTIC_SCORED: readonly number[] = [30, 60, 30, 60, 120];
const HAPTIC_CONCEDED: readonly number[] = [140];

/* ------------------------------------------------------------------ */
/* Tipos locales                                                        */
/* ------------------------------------------------------------------ */

/**
 * Lo que viaja hacia el host.
 *
 * Dos formas, segun que sea el telefono:
 *
 * - `drive` es el input de un aparato que **corre el juego** —un cliente
 *   `arena` o un bot del host—: dos ejes y la patada en un solo mensaje. Es la
 *   forma correcta para un disco, y ningun `ControlInput` puede expresarla de
 *   una: `BotPolicy` devuelve UN input por tick, y la franja del mando manda un
 *   eje por vez.
 * - `ControlInput` es lo que manda un telefono en modo mando, dibujado por
 *   `ControlSpec`. Se sigue aceptando porque el mismo juego sirve para los dos
 *   `phoneRole`, y quien manda `drive` se identifica solo: el host le deja de
 *   mandar pantallas de mando en cuanto llega el primero.
 */
type FutbolInput = ControlInput | BotDrive;

type MutableSnapshot = { tick: number; entities: NetEntity[]; scalars: number[] };

type Scene = {
  /**
   * El estado autoritativo. **En un cliente existe pero NO se simula**: se crea
   * por las reglas y la geometria, que hacen falta para dibujar la cancha y
   * para predecir el disco propio, y `stepMatch` no se llama nunca. La partida
   * de un cliente es lo que llega por la red, no lo que calcula.
   */
  match: FutbolState;
  /** true en el asiento 0: es el que simula, puntua y difunde. */
  isHost: boolean;
  /** De donde sale lo que se dibuja. Ver `drawMatch`. */
  sample: (nowMs: number) => NetSnapshot | null;
  /** Resto del cuadro que todavia no se convirtio en subpasos de 1/120. */
  accumulator: number;
  stateTimer: number;
  inputTimer: number;
  tick: number;

  /* --- La punta que publica --- */
  /**
   * Dos buffers que se alternan, no uno.
   *
   * `broadcastState` recibe el estado POR REFERENCIA y `mockNet` lo pasa por un
   * limitador que puede diferir el empaquetado hasta el proximo hueco de 50 ms.
   * Con un solo objeto reusado —que es lo que pide la regla de cero
   * asignaciones— el estado se puede mutar entre el `push` y el `encode`, y
   * entonces el paquete sale con el tick de un tick y el contenido de otro. Con
   * dos alternados, el que espera nunca es el que se esta escribiendo.
   */
  snapshotA: MutableSnapshot;
  snapshotB: MutableSnapshot;
  snapshotFlip: boolean;
  /** El ultimo escrito. Es lo que dibuja el render mientras no llego nada. */
  snapshot: MutableSnapshot;
  /** Codec propio del cano local. El de la red es otra instancia: ver el reporte. */
  codec: SnapshotCodec;
  /** Ultimo tick que el "cliente" local reconstruyo. Es la base del delta. */
  confirmedTick: number;

  /* --- El cano con latencia, jitter y perdida --- */
  pipeBytes: Array<Uint8Array | null>;
  pipeAt: Float64Array;
  pipeAck: Int32Array;

  /* --- La punta que dibuja --- */
  buffer: SnapshotBuffer<NetSnapshot>;
  /** Destino del lerp. `lerpSnapshot` arma objetos nuevos; esto no. */
  lerpOut: MutableSnapshot;
  prediction: Prediction<PredictedDisc, DiscIntent>;
  predictGeo: FieldGeometry;
  predictSeat: number;
  errX: number;
  errY: number;
  localSeq: number;
  droppedPackets: number;
  lastBytes: number;

  /* --- Input local --- */
  localIntentX: number;
  localIntentY: number;
  /** Flanco de patada pendiente de mandar. Se consume en el pulso de 30 Hz. */
  localKick: boolean;
  prevKick: boolean;
  /**
   * Dos objetos de input alternados, por la misma razon que los dos snapshots:
   * `sendInput` recibe el input POR REFERENCIA y el limitador de `mockNet` lo
   * puede diferir hasta el proximo hueco de 33 ms. Con uno solo reusado, el
   * paquete sale con la secuencia de un tick y el vector de otro.
   */
  driveA: BotDrive;
  driveB: BotDrive;
  driveFlip: boolean;
  /** Palanca virtual: centro anclado donde cayo el dedo, y el dedo que la lleva. */
  stickId: number;
  stickX: number;
  stickY: number;
  stickTipX: number;
  stickTipY: number;
  stickActive: boolean;
  /** Toque en la zona de patear, pendiente de consumirse en el pulso de 30 Hz. */
  touchKick: boolean;
  /** 1 mientras el asiento se dibuje con `ControlSpec` en vez de correr el juego. */
  padSeat: Uint8Array;
  /** Objetivo del deslizador por asiento, en unidades del mundo. */
  targetX: Float32Array;
  /** -1, 0 o 1 desde los botones de mantener. */
  dirY: Float32Array;
  usesPad: Uint8Array;
  humanSeat: Uint8Array;
  leftSeat: Uint8Array;

  /* --- Efectos --- */
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
  sparkTeam: Uint8Array;
  sparkHead: number;

  rippleX: Float32Array;
  rippleY: Float32Array;
  rippleLife: Float32Array;
  rippleTeam: Uint8Array;
  rippleHead: number;

  noise: Float32Array;
  noiseCursor: number;

  flashMs: number;
  flashTeam: number;
  shakeMs: number;
  overMs: number;
  noticeText: string;
  noticeMs: number;

  /** Lo ultimo que se vio EN LA VISTA. Los efectos siguen al reloj de la sala. */
  seenKicks: number;
  seenGoals: number;
  seenPosts: number;
  clockLabel: string;
  clockSeconds: number;

  /* Lo que la vista dice del partido. Es la unica fuente en un cliente, y en el
     host va 80 ms atras del marcador real, que en un marcador no se nota. */
  viewA: number;
  viewB: number;
  viewClockS: number;
  viewPhase: number;
  /** Puntaje propio reconstruido del flujo: cada gol viaja con su autor. */
  myGoals: number;
  myAssists: number;
  myTouches: number;

  /* --- Colores y degrades, creados una vez --- */
  bgGlow: CanvasGradient;
  vignette: CanvasGradient;
  teamFill: string[];
  teamRing: string[];
  teamSoft: string[];
  teamSpark: string[];
  lineColor: string;
  lineSoft: string;
  ballColor: string;
  ballGlow: string;
  trailFill: string[];
  textColor: string;
  dimColor: string;
  flashColor: string[];
  ownRing: string;
  touchZoneFill: string;
  touchStroke: string;
};

/** `bytes`, `resim` y `lost` solo se publican con `config.debug`. */
type FutbolHud = { a: number; b: number; clock: number; mine: number; bytes: number; resim: number; lost: number };

const EMPTY_HUD: FutbolHud = { a: 0, b: 0, clock: 0, mine: 0, bytes: 0, resim: 0, lost: 0 };

/* ------------------------------------------------------------------ */
/* Componente                                                           */
/* ------------------------------------------------------------------ */

export default function FutbolGame({ config, signal, onFinish }: GameProps) {
  const options = useMemo(
    () => ({
      fieldWidth: num(config.settings, "fieldWidth", 1600),
      fieldHeight: num(config.settings, "fieldHeight", 900),
      goalWidth: num(config.settings, "goalWidth", 250),
      playerRadius: num(config.settings, "playerRadius", 28),
      ballRadius: num(config.settings, "ballRadius", 15),
      playerSpeed: num(config.settings, "playerSpeed", 380),
      playerAccel: num(config.settings, "playerAccel", 1900),
      playerFriction: num(config.settings, "playerFriction", 92) / 100,
      ballFriction: num(config.settings, "ballFriction", 42) / 100,
      kickPower: num(config.settings, "kickPower", 900),
      kickReach: num(config.settings, "kickReach", 14),
      kickCooldown: num(config.settings, "kickCooldown", 0.3),
      bounce: num(config.settings, "bounce", 0.55),
      goalsToWin: Math.round(num(config.settings, "goalsToWin", 3)),
      matchMinutes: num(config.settings, "matchMinutes", 3),
      celebration: num(config.settings, "celebration", 2),
      kickoff: num(config.settings, "kickoff", 2),
      botSkill: num(config.settings, "botSkill", 55) / 100,
    }),
    [config.settings],
  );

  const sceneRef = useRef<Scene | null>(null);
  /** El roster por id: `onPlayerLeave` solo trae el id y hay que saber de quien era. */
  const rosterRef = useRef<Map<string, NetPlayer>>(new Map());
  const seatPlayerRef = useRef<Array<NetPlayer | null>>(new Array(FUTBOL_SEATS).fill(null));

  const localSeat = clamp(Math.round(config.seat), 0, FUTBOL_SEATS - 1);
  /**
   * El asiento 0 es el host y los demas son clientes, igual que en Corredor.
   * En `arena` cada aparato dibuja la partida: el proyector porque es la
   * pantalla de la sala, y cada celular porque juega su propio disco. Lo que
   * cambia entre los dos no es el dibujo —es el mismo— sino quien simula.
   */
  const isHost = localSeat === 0;

  /* El bot lee la dificultad por referencia: el puerto de red se crea una sola
     vez, asi que tocar una perilla no puede exigir reconectar a nadie. */
  const skillRef = useRef(options.botSkill);
  skillRef.current = options.botSkill;

  const botMemoryRef = useRef<BotMemory>(createBotMemory());

  /**
   * La politica de los bots. Sin esto, probar un futbol de 8 exige ocho
   * personas y el juego no se puede desarrollar: es criterio de la base.
   *
   * Manda intencion, igual que una persona. No escribe estado ni puntaje.
   */
  const botPolicy = useMemo<BotPolicy<FutbolInput>>(
    () => ({
      hz: BOT_HZ,
      policy: (bot) => {
        const memory = botMemoryRef.current;
        const seat = bot.seat >= 0 && bot.seat < FUTBOL_SEATS ? bot.seat : 0;
        const out = memory.out[seat] ?? { kind: "drive" as const, x: 0, y: 0, kick: false };
        const scene = sceneRef.current;
        if (!scene) {
          out.x = 0;
          out.y = 0;
          out.kick = false;
          return out;
        }
        writeBotIntent(
          scene,
          memory,
          seat,
          bot.elapsedMs,
          bot.rng.next(),
          bot.rng.next(),
          skillRef.current,
          out,
        );
        return out;
      },
    }),
    [],
  );

  /**
   * El codec del aire. Es OTRA instancia que la del cano local a proposito:
   * `createSnapshotCodec` guarda el historial de lo que mando, asi que una sola
   * instancia empaquetando para dos consumidores armaria el segundo delta
   * contra el primero y el paquete saldria vacio.
   */
  const wireCodec = useMemo(() => createSnapshotCodec({ keyframeEvery: 20 }), []);

  /*
   * El destino de la mezcla vive aca y no en la escena porque `useGameNet` lee
   * `interpolate` UNA vez, al crear el puerto, y la escena todavia no existe.
   * Es el mismo objeto que despues usa el cano local del host: los dos caminos
   * son excluyentes, nunca corren a la vez.
   */
  const viewScratch = useMemo(() => createMutableSnapshot(), []);
  const viewLerp = useMemo(() => makeScratchLerp(viewScratch), [viewScratch]);

  const netHandle = useGameNet<FutbolInput, NetSnapshot>({
    // La sala la elige el contenedor porque tiene que coincidir con el QR que
    // escanean los celulares.
    roomId: config.roomId,
    // Lo elige el contenedor, igual que la sala: el celular entra por donde
    // dice el QR y el proyector tiene que estar en la misma red.
    transport: config.transport,
    role: isHost ? "host" : "client",
    // El host ya no es un proyector que mira: juega el asiento 0. Con eso su
    // input entra por el mismo `sendInput` que el de un celular y desaparece la
    // pelea entre el teclado y el bot que le guardaba el lugar.
    seat: localSeat,
    seats: FUTBOL_SEATS,
    name: isHost ? "Proyector" : `Jugador ${localSeat + 1}`,
    codec: wireCodec,
    // En un cliente esto es lo que alimenta `sampleState()`. En el host queda
    // inerte —un host produce estado, no lo recibe— y esta bien que asi sea.
    interpolate: { lerp: viewLerp, delayMs: VIEW_DELAY_MS },
    bot: botPolicy,

    // Solo dispara en el host: es el unico que recibe input ajeno.
    onInput: (playerId, input) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const player = rosterRef.current.get(playerId);
      if (!player) return;
      applyRemoteInput(scene, player.seat, input);
    },

    /*
     * Solo dispara en un cliente. El buffer de interpolacion lo alimenta el
     * propio hook; lo que falta hacer aca es lo que el hook no puede hacer
     * porque no conoce la simulacion: descartar los inputs que el host ya
     * proceso y re-simular los pendientes sobre el estado autoritativo.
     */
    onState: (state, _tick, ackedSequence) => {
      const scene = sceneRef.current;
      if (!scene) return;
      reconcileOwnDisc(scene, state, ackedSequence);
    },

    onPlayerJoin: (player) => {
      rosterRef.current.set(player.id, player);
      const scene = sceneRef.current;
      if (!scene) return;
      scene.humanSeat[player.seat] = player.bot ? 0 : 1;
      scene.usesPad[player.seat] = player.bot ? 0 : 1;
      if (!player.bot) {
        scene.leftSeat[player.seat] = 0;
        scene.targetX[player.seat] = scene.match.px[player.seat] ?? 0;
        pushNotice(scene, `Entró al equipo ${TEAM_NAMES[teamOfSeat(player.seat)] ?? ""}`);
      }
    },

    onPlayerLeave: (playerId) => {
      const player = rosterRef.current.get(playerId);
      rosterRef.current.delete(playerId);
      const scene = sceneRef.current;
      if (!scene || !player || player.bot) return;
      // El bot entra solo desde `mockNet`: el partido no se cuelga porque
      // alguien cerro el celular. Aca solo hay que contarlo y soltar el pad.
      scene.humanSeat[player.seat] = 0;
      scene.usesPad[player.seat] = 0;
      scene.leftSeat[player.seat] = 1;
      scene.dirY[player.seat] = 0;
      pushNotice(scene, "Se fue un jugador · sigue un bot");
    },
  });

  const netPort = netHandle.net;
  const netRef = useRef(netPort);
  netRef.current = netPort;

  /* Las condiciones del banco de pruebas mandan tambien sobre el cano local: si
     el mock corre a 80 ms con jitter y perdida, la vista del proyector tiene
     que sufrir exactamente lo mismo. Una interpolacion probada a 0 ms no esta
     probada. Va por ref y no por efecto porque el loop de `useGame2D` monta
     despues que este componente y un efecto llegaria tarde. */
  const conditionsRef = useRef(netHandle.conditions);
  conditionsRef.current = netHandle.conditions;
  /** `sampleState` es estable, pero el loop lo lee por ref igual que el puerto. */
  const sampleRef = useRef(netHandle.sampleState);
  sampleRef.current = netHandle.sampleState;

  const game = useGame2D<Scene, FutbolHud>(
    {
      design: { width: options.fieldWidth, height: options.fieldHeight },
      step: SIM_STEP,
      countdown: 3,
      hud: EMPTY_HUD,

      init: (ctx) => {
        const rules = createFutbolRules({
          width: options.fieldWidth,
          height: options.fieldHeight,
          goalWidth: options.goalWidth,
          playerRadius: options.playerRadius,
          ballRadius: options.ballRadius,
          playerSpeed: options.playerSpeed,
          playerAccel: options.playerAccel,
          playerFriction: options.playerFriction,
          ballFriction: options.ballFriction,
          kickPower: options.kickPower,
          kickReach: options.kickReach,
          kickCooldownS: options.kickCooldown,
          restitution: options.bounce,
          goalsToWin: options.goalsToWin,
          matchSeconds: options.matchMinutes * 60,
          celebrationS: options.celebration,
          kickoffS: options.kickoff,
          step: SIM_STEP,
        });

        const match = createFutbolState(rules);
        const predictGeo = createFieldGeometry(rules);
        const lerpOut = viewScratch;
        const snapshotA = createMutableSnapshot();
        const snapshotB = createMutableSnapshot();

        const g = ctx.view.ctx;
        const w = rules.width;
        const h = rules.height;
        // Los degrades se crean una vez: crearlos por cuadro es la forma mas
        // barata de perder los 60 fps del proyector.
        const bgGlow = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.62);
        bgGlow.addColorStop(0, withAlpha(ctx.palette["--sn-violet-600"], 0.26));
        bgGlow.addColorStop(1, withAlpha(ctx.palette["--sn-violet-600"], 0));
        const vignette = g.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.76);
        vignette.addColorStop(0, withAlpha(ctx.palette["--sn-bg"], 0));
        vignette.addColorStop(1, withAlpha(ctx.palette["--sn-bg"], 0.8));

        const trailMax = ctx.reducedMotion ? TRAIL_REDUCED : TRAIL_MAX;
        const trailFill: string[] = new Array(TRAIL_MAX);
        for (let i = 0; i < TRAIL_MAX; i++) {
          trailFill[i] = withAlpha(ctx.palette["--sn-text"], 0.3 * (1 - i / TRAIL_MAX));
        }

        // El azar del render NO puede salir de `ctx.rng` cuadro a cuadro: se
        // siembra una tabla una vez y despues se recorre. Si el ruido se
        // consumiera en draw, el juego dependeria de los fps.
        const noise = new Float32Array(NOISE_SIZE);
        for (let i = 0; i < NOISE_SIZE; i++) noise[i] = ctx.rng.range(-1, 1);

        const scene: Scene = {
          match,
          isHost,
          // El host se dibuja a si mismo COMO CLIENTE, por su cano local; un
          // cliente dibuja lo que le llega de verdad. Los dos terminan en un
          // `NetSnapshot` interpolado a -80 ms, asi que hay un solo dibujo.
          sample: () => null,
          accumulator: 0,
          stateTimer: 0,
          inputTimer: 0,
          tick: 0,

          snapshotA,
          snapshotB,
          snapshotFlip: false,
          snapshot: snapshotA,
          codec: createSnapshotCodec({ keyframeEvery: 20 }),
          confirmedTick: 0,

          pipeBytes: new Array<Uint8Array | null>(16).fill(null),
          pipeAt: new Float64Array(16),
          pipeAck: new Int32Array(16),

          buffer: createSnapshotBuffer<NetSnapshot>({
            lerp: makeScratchLerp(lerpOut),
            delayMs: VIEW_DELAY_MS,
            tickRateHz: 20,
          }),
          lerpOut,
          prediction: createPrediction<PredictedDisc, DiscIntent>(
            { x: match.px[localSeat] ?? 0, y: match.py[localSeat] ?? 0, vx: 0, vy: 0 },
            { step: (disc, intent, dt) => stepDisc(disc, intent, dt, predictGeo), dt: INPUT_STEP },
          ),
          predictGeo,
          predictSeat: localSeat,
          errX: 0,
          errY: 0,
          localSeq: 0,
          droppedPackets: 0,
          lastBytes: 0,

          localIntentX: 0,
          localIntentY: 0,
          localKick: false,
          prevKick: false,
          driveA: { kind: "drive", x: 0, y: 0, kick: false },
          driveB: { kind: "drive", x: 0, y: 0, kick: false },
          driveFlip: false,
          stickId: -1,
          stickX: 0,
          stickY: 0,
          stickTipX: 0,
          stickTipY: 0,
          stickActive: false,
          touchKick: false,
          padSeat: new Uint8Array(FUTBOL_SEATS),
          targetX: new Float32Array(FUTBOL_SEATS),
          dirY: new Float32Array(FUTBOL_SEATS),
          usesPad: new Uint8Array(FUTBOL_SEATS),
          humanSeat: new Uint8Array(FUTBOL_SEATS),
          leftSeat: new Uint8Array(FUTBOL_SEATS),

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
          sparkTeam: new Uint8Array(MAX_SPARKS),
          sparkHead: 0,

          rippleX: new Float32Array(MAX_RIPPLES),
          rippleY: new Float32Array(MAX_RIPPLES),
          rippleLife: new Float32Array(MAX_RIPPLES),
          rippleTeam: new Uint8Array(MAX_RIPPLES),
          rippleHead: 0,

          noise,
          noiseCursor: 0,

          flashMs: 0,
          flashTeam: 0,
          shakeMs: 0,
          overMs: 0,
          noticeText: "",
          noticeMs: 0,

          seenKicks: 0,
          seenGoals: 0,
          seenPosts: 0,
          clockLabel: formatClock(rules.matchSeconds * 1000),
          clockSeconds: Math.ceil(rules.matchSeconds),

          viewA: 0,
          viewB: 0,
          viewClockS: rules.matchSeconds,
          viewPhase: PHASE_KICKOFF,
          myGoals: 0,
          myAssists: 0,
          myTouches: 0,

          bgGlow,
          vignette,
          teamFill: [
            withAlpha(ctx.palette["--sn-cyan-400"], 0.9),
            withAlpha(ctx.palette["--sn-magenta-400"], 0.9),
          ],
          teamRing: [ctx.palette["--sn-cyan-300"], ctx.palette["--sn-magenta-300"]],
          teamSoft: [
            withAlpha(ctx.palette["--sn-cyan-400"], 0.16),
            withAlpha(ctx.palette["--sn-magenta-400"], 0.16),
          ],
          teamSpark: [
            withAlpha(ctx.palette["--sn-cyan-300"], 0.85),
            withAlpha(ctx.palette["--sn-magenta-300"], 0.85),
          ],
          lineColor: withAlpha(ctx.palette["--sn-violet-400"], 0.34),
          lineSoft: withAlpha(ctx.palette["--sn-violet-500"], 0.16),
          ballColor: ctx.palette["--sn-text"],
          ballGlow: withAlpha(ctx.palette["--sn-text"], 0.22),
          trailFill,
          textColor: ctx.palette["--sn-text"],
          dimColor: withAlpha(ctx.palette["--sn-text-dim"], 0.8),
          flashColor: [
            withAlpha(ctx.palette["--sn-cyan-300"], 0.5),
            withAlpha(ctx.palette["--sn-magenta-300"], 0.5),
          ],
          ownRing: ctx.palette["--sn-text"],
          touchZoneFill: withAlpha(ctx.palette["--sn-text"], 0.05),
          touchStroke: withAlpha(ctx.palette["--sn-text"], 0.5),
        };

        for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
          scene.targetX[seat] = match.px[seat] ?? 0;
          // Hasta que un aparato mande `drive` se lo trata como mando: un
          // telefono en modo mando que no recibe pantalla se queda mirando
          // "Esperando al proyector", y uno que corre el juego simplemente
          // ignora los `ControlSpec` que le sobran durante los primeros 30 ms.
          scene.padSeat[seat] = 1;
        }
        writeSnapshot(scene);
        // El host lee de su cano local; el cliente, del buffer que llena el hook.
        scene.sample = isHost
          ? (nowMs) => scene.buffer.sample(nowMs)
          : (nowMs) => sampleRef.current(nowMs);

        // El puerto de red ya existe cuando esto corre, y su bot y su `onInput`
        // buscan la escena aca.
        sceneRef.current = scene;
        for (const player of rosterRef.current.values()) {
          scene.humanSeat[player.seat] = player.bot ? 0 : 1;
          scene.usesPad[player.seat] = player.bot ? 0 : 1;
        }
        return scene;
      },

      update: (scene, dt, ctx) => {
        decayTimers(scene, dt);
        updateParticles(scene, dt);

        const match = scene.match;
        // El fin de partido se decide por lo que se VE, no por lo que se
        // simula: en un cliente no hay simulacion, y en el host la vista va
        // 80 ms atras, asi que cortar por el estado autoritativo dejaria al
        // proyector sin mostrar el ultimo gol.
        if (scene.viewPhase === PHASE_OVER) {
          // Un momento para ver el marcador final. Cortar en seco se siente
          // como un cuelgue, no como un partido terminado.
          scene.overMs += dt * 1000;
          if (scene.overMs >= (ctx.reducedMotion ? 0 : OVER_HOLD_MS)) ctx.finish(true);
          return;
        }

        // El input sale igual en los dos roles: siempre por `sendInput`. En el
        // host el puerto lo entrega en el acto, sin pasar por la red.
        pumpInput(scene, dt, ctx, netRef.current);

        if (scene.isHost) {
          scene.accumulator += dt;
          let steps = 0;
          while (scene.accumulator >= SIM_STEP && steps < MAX_SUBSTEPS) {
            scene.accumulator -= SIM_STEP;
            steps++;
            const event = stepMatch(match);
            if (event === "match") break;
          }
          // Deuda que no entra en el tope: se tira. Recuperarla despues seria
          // simular en camara rapida un tiempo que la sala no vio.
          if (scene.accumulator > SIM_STEP * MAX_SUBSTEPS) scene.accumulator = 0;

          publishState(scene, dt, ctx, netRef.current, conditionsRef.current);
          drainPipe(scene);
        }

        ctx.setHud({
          a: scene.viewA,
          b: scene.viewB,
          clock: Math.ceil(scene.viewClockS),
          mine: scene.myGoals,
        });
        // El diagnostico de red solo en el banco de pruebas: los bytes cambian
        // veinte veces por segundo y no hay razon para que React se entere en
        // una sala de verdad.
        if (config.debug) {
          ctx.setHud({
            bytes: scene.lastBytes,
            resim: scene.prediction.resimulations,
            lost: scene.droppedPackets,
          });
        }
      },

      draw: (scene, g, ctx) => drawMatch(scene, g, ctx),

      /*
       * Cada aparato emite SU resultado, y ninguno lo inventa.
       *
       * El host lo lee de la simulacion que corrio. Un cliente lo lee de los
       * snapshots que recibio: los goles y las asistencias vienen con su autor
       * en cada evento y los toques viajan como escalar, asi que el numero sale
       * del host aunque lo arme el telefono. Es lo mas cerca de la regla
       * "el cliente no puntua" que se puede estar cuando el contrato pide un
       * `GameOutcome` por participante.
       */
      outcome: (scene, completed, survivedMs) => {
        const match = scene.match;
        const team = teamOfSeat(localSeat);
        const goalsFor = team === 0 ? scene.viewA : scene.viewB;
        const goalsAgainst = team === 0 ? scene.viewB : scene.viewA;
        const quit = (scene.leftSeat[localSeat] ?? 0) === 1;
        const over = scene.viewPhase === PHASE_OVER;
        const result: FutbolResult = quit
          ? "quit"
          : goalsFor > goalsAgainst
            ? "win"
            : goalsFor === goalsAgainst
              ? "draw"
              : "loss";

        return {
          completed: quit ? false : completed || over,
          points: futbolPoints(scene.myGoals, scene.myAssists, scene.myTouches, result),
          meta: {
            asiento: localSeat + 1,
            rol: scene.isHost ? "proyector" : "celular",
            equipo: TEAM_NAMES[team] ?? "",
            goles: scene.myGoals,
            asistencias: scene.myAssists,
            toques: scene.myTouches,
            golesAFavor: goalsFor,
            golesEnContra: goalsAgainst,
            resultado: result,
            motivo: over
              ? scene.viewClockS <= 0
                ? "tiempo"
                : "goles"
              : quit
                ? "abandono"
                : completed
                  ? "tiempo"
                  : "forzado",
            duracionS: Math.round(survivedMs / 1000),
            // Solo el host tiene el reloj de la simulacion; en un cliente es 0
            // y no se muestra como si fuera un dato propio.
            relojHostS: scene.isHost ? Math.round(match.clockS) : null,
          },
        };
      },
    },
    config,
    signal,
    onFinish,
  );

  /* ---------------------------------------------------------------- */
  /* Tactil: palanca y patada, con varios dedos a la vez                */
  /* ---------------------------------------------------------------- */

  /*
   * `createInput` de la base atiende UN puntero: el segundo dedo se descarta en
   * la primera linea de `onPointerDown`. Para un mando de franja alcanza, pero
   * un cliente `arena` necesita correr y patear al mismo tiempo, y con un solo
   * dedo eso no existe. Asi que este juego trae su propia capa tactil sobre el
   * mismo contenedor, que es lo unico que no puede salir de la base sin
   * tocarla. Le va a pasar igual a Metaverso y al Shooter: esta reportado.
   *
   * Solo en el cliente: el proyector se juega con teclado y no tiene por que
   * comerse los clics de su propia pantalla.
   */
  useEffect(() => {
    if (isHost) return;
    const container = game.containerRef.current;
    if (!container) return;

    const world = (e: PointerEvent) => {
      const box = container.getBoundingClientRect();
      const canvas = container.querySelector("canvas");
      const rect = canvas?.getBoundingClientRect() ?? box;
      const scale = rect.width > 0 ? options.fieldWidth / rect.width : 1;
      return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
    };

    const onDown = (e: PointerEvent) => {
      const scene = sceneRef.current;
      if (!scene) return;
      // Un boton del escenario no es input de juego. Misma guarda que la base:
      // sin esto, "Jugar" y "Pausa" dejan de responder.
      if (e.target instanceof Element && e.target.closest("[data-game-ui]")) return;
      const point = world(e);
      if (point.x > options.fieldWidth * KICK_ZONE) {
        scene.touchKick = true;
        return;
      }
      if (scene.stickId !== -1) return;
      // La palanca aparece donde cae el pulgar, no en un lugar fijo: es la
      // diferencia entre jugar mirando la cancha y jugar mirando el control.
      scene.stickId = e.pointerId;
      scene.stickX = point.x;
      scene.stickY = point.y;
      scene.stickTipX = point.x;
      scene.stickTipY = point.y;
      scene.stickActive = true;
    };

    const onMove = (e: PointerEvent) => {
      const scene = sceneRef.current;
      if (!scene || scene.stickId !== e.pointerId) return;
      const point = world(e);
      scene.stickTipX = point.x;
      scene.stickTipY = point.y;
    };

    const onUp = (e: PointerEvent) => {
      const scene = sceneRef.current;
      if (!scene || scene.stickId !== e.pointerId) return;
      scene.stickId = -1;
      scene.stickActive = false;
    };

    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
    return () => {
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
    };
  }, [isHost, game.containerRef, options.fieldWidth]);

  /* ---------------------------------------------------------------- */
  /* El mando: una pantalla por asiento                                */
  /* ---------------------------------------------------------------- */

  const playing = game.phase === "playing";
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    // Solo el host dibuja telefonos ajenos, y solo si queda alguno en modo
    // mando. Con `phoneRole: "player"` todos corren el juego y este intervalo
    // no manda un solo mensaje.
    if (!netPort || !isHost) return;
    // Fuera del loop a proposito: `update` y `draw` no asignan nada, y armar un
    // `ControlSpec` es un objeto. A 10 Hz alcanza y son 10 mensajes por segundo
    // por celular en vez de 120.
    const memory = createControlMemory();
    const timer = window.setInterval(() => {
      const scene = sceneRef.current;
      if (!scene) return;
      for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
        const player = seatPlayerRef.current[seat];
        // A un bot no hay a quien dibujarle nada, y a quien corre el juego
        // tampoco: ya se dibuja la cancha entera solo.
        if (!player || player.bot || (scene.padSeat[seat] ?? 0) === 0) continue;
        const spec = buildControlSpec(scene, seat, player.id, playingRef.current, memory);
        if (spec) netPort.sendControl(spec, player.id);
      }
    }, CONTROL_MS);
    return () => window.clearInterval(timer);
  }, [netPort, isHost]);

  // El roster llega por el hook a 4 Hz; el mapa por asiento tiene que seguirlo
  // aunque el join se haya perdido antes de que montara la escena.
  useEffect(() => {
    const next: Array<NetPlayer | null> = new Array(FUTBOL_SEATS).fill(null);
    for (const player of netHandle.players) {
      if (player.seat >= 0 && player.seat < FUTBOL_SEATS) next[player.seat] = player;
      rosterRef.current.set(player.id, player);
    }
    seatPlayerRef.current = next;
    const scene = sceneRef.current;
    if (!scene) return;
    for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
      const player = next[seat];
      const human = player != null && !player.bot;
      scene.humanSeat[seat] = human ? 1 : 0;
      scene.usesPad[seat] = human ? 1 : 0;
    }
  }, [netHandle.players]);

  const humansA = countHumans(netHandle.players, 0);
  const humansB = countHumans(netHandle.players, 1);
  const myTeam = teamOfSeat(localSeat);

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
      aspect={options.fieldWidth / options.fieldHeight}
      {...(config.debug ? { fps: game.fps } : {})}
      instructions={
        isHost
          ? "Vos jugás el disco 1 con WASD o las flechas, y la barra espaciadora patea. Escaneá un QR para sumar celulares: cada uno juega su propio disco. Los lugares vacíos los llenan bots."
          : "Arrastrá el pulgar en la mitad izquierda para correr —la palanca aparece donde lo apoyes— y tocá la franja derecha para patear. Con teclado: WASD o flechas y barra espaciadora."
      }
      hud={
        <>
          <HudStat label={`Cian · ${humansA} ${humansA === 1 ? "persona" : "personas"}`} value={game.hud.a} dominant tone="cyan" />
          <HudStat label={`Magenta · ${humansB} ${humansB === 1 ? "persona" : "personas"}`} value={game.hud.b} dominant tone="magenta" />
          <HudStat
            label="Reloj"
            value={formatClock(game.hud.clock * 1000)}
            tone={game.hud.clock <= 15 ? "danger" : "default"}
          />
          <HudStat label={`Tus goles · ${TEAM_NAMES[myTeam] ?? ""}`} value={game.hud.mine} />
          {netHandle.rttMs > LATENCY_WARN_MS && (
            <HudStat label="Latencia" value={`${netHandle.rttMs} ms`} tone="warn" />
          )}
          {config.debug && (
            <>
              <HudStat
                label={isHost ? "Estado por tick" : "Estado recibido"}
                value={isHost ? `${game.hud.bytes} B` : `${netHandle.stats.recvBytes} B`}
              />
              <HudStat label="Re-simulaciones" value={game.hud.resim} />
              <HudStat
                label="Paquetes perdidos"
                value={isHost ? game.hud.lost : netHandle.stats.droppedState}
              />
              <HudStat label="Rol" value={isHost ? "host" : `cliente ${localSeat + 1}`} />
            </>
          )}
        </>
      }
      summary={
        <>
          <h3 className="mb-1 text-lg">
            {game.hud.a === game.hud.b
              ? "Empate"
              : `Ganó ${TEAM_NAMES[game.hud.a > game.hud.b ? 0 : 1] ?? ""}`}
          </h3>
          <p className="text-sm text-sn-muted">
            <span className="sn-num text-sn-cyan">{game.hud.a}</span>
            <span className="mx-2 text-sn-dim">·</span>
            <span className="sn-num text-sn-magenta">{game.hud.b}</span>
          </p>
          <p className="mt-1 text-xs text-sn-dim">
            Tus goles: <span className="sn-num">{game.hud.mine}</span>
          </p>
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Snapshot: escribir y leer                                            */
/* ------------------------------------------------------------------ */

function createMutableSnapshot(): MutableSnapshot {
  const entities: NetEntity[] = new Array(ENTITY_COUNT);
  for (let i = 0; i < ENTITY_COUNT; i++) {
    entities[i] = { id: i, x: 0, y: 0, vx: 0, vy: 0, angle: 0, flags: 0 };
  }
  return { tick: 0, entities, scalars: new Array<number>(SCALAR_COUNT).fill(0) };
}

/** El estado del tick, escrito sobre el buffer que no esta en vuelo. */
function writeSnapshot(scene: Scene): void {
  const match = scene.match;
  scene.snapshotFlip = !scene.snapshotFlip;
  const snapshot = scene.snapshotFlip ? scene.snapshotB : scene.snapshotA;
  scene.snapshot = snapshot;
  snapshot.tick = scene.tick;

  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    const entity = snapshot.entities[seat];
    if (!entity) continue;
    const vx = match.pvx[seat] ?? 0;
    const vy = match.pvy[seat] ?? 0;
    entity.id = seat;
    entity.x = match.px[seat] ?? 0;
    entity.y = match.py[seat] ?? 0;
    entity.vx = vx;
    entity.vy = vy;
    // El angulo se cuantiza a 8 bits: 256 pasos de rumbo no se ven en un disco.
    entity.angle = vx === 0 && vy === 0 ? 0 : Math.atan2(vy, vx);
    entity.flags =
      ((match.pTeam[seat] ?? 0) === 1 ? FLAG_TEAM_B : 0) |
      ((scene.humanSeat[seat] ?? 0) === 1 ? FLAG_HUMAN : 0) |
      ((match.pKickCd[seat] ?? 0) <= 0 ? FLAG_KICK_READY : 0);
  }

  const ball = snapshot.entities[BALL_ID];
  if (ball) {
    ball.id = BALL_ID;
    ball.x = match.ballX;
    ball.y = match.ballY;
    ball.vx = match.ballVx;
    ball.vy = match.ballVy;
    ball.angle = 0;
    ball.flags = match.phase;
  }

  const scalars = snapshot.scalars;
  scalars[S_SCORE_A] = match.score[0] ?? 0;
  scalars[S_SCORE_B] = match.score[1] ?? 0;
  scalars[S_PHASE] = match.phase;
  scalars[S_CLOCK_MS] = Math.round(match.clockS * 1000);
  scalars[S_PHASE_MS] = Math.round(match.phaseTimerS * 1000);
  scalars[S_KICKS] = match.kickCount;
  scalars[S_GOALS] = match.goalCount;
  scalars[S_GOAL_TEAM] = match.lastGoalTeam;
  // Dos coordenadas en un escalar: un Int32 sobra para 12 + 11 bits y libera
  // un lugar de los dieciseis que hay.
  const kickX = clamp(Math.round(match.lastKickX) + KICK_POS_BIAS, 0, KICK_POS_MASK);
  const kickY = clamp(Math.round(match.lastKickY), 0, KICK_POS_MASK);
  scalars[S_KICK_POS] = kickX | (kickY << KICK_POS_SHIFT);
  scalars[S_GOAL_SEAT] = match.lastGoalSeat;
  scalars[S_POSTS] = match.postCount;
  scalars[S_KICK_SEAT] = match.lastKickSeat;
  scalars[S_ASSIST_SEAT] = match.lastAssistSeat;

  // Cuatro asientos por escalar, siete bits cada uno.
  let low = 0;
  let high = 0;
  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    const touches = Math.min(TOUCH_MAX, match.touches[seat] ?? 0);
    if (seat < 4) low |= touches << (seat * TOUCH_BITS);
    else high |= touches << ((seat - 4) * TOUCH_BITS);
  }
  scalars[S_TOUCHES_0] = low;
  scalars[S_TOUCHES_1] = high;
}

/** Toques de un asiento, desempaquetados del escalar que le toca. */
function touchesOf(snapshot: NetSnapshot, seat: number): number {
  const packed = scalarAt(snapshot, seat < 4 ? S_TOUCHES_0 : S_TOUCHES_1);
  return (packed >> ((seat % 4) * TOUCH_BITS)) & TOUCH_MAX;
}

function entityAt(snapshot: NetSnapshot, id: number): NetEntity | null {
  const direct = snapshot.entities[id];
  if (direct && direct.id === id) return direct;
  for (const entity of snapshot.entities) {
    if (entity.id === id) return entity;
  }
  return null;
}

function scalarAt(snapshot: NetSnapshot, index: number): number {
  return snapshot.scalars[index] ?? 0;
}

/**
 * Mezcla de dos snapshots escribiendo sobre un destino ya existente.
 *
 * `lerpSnapshot` de la base arma un array, nueve objetos, dos mapas y un set en
 * CADA muestreo, y el muestreo pasa una vez por cuadro: son ~700 asignaciones
 * por segundo contra la regla de cero asignaciones del loop 2D. El buffer es
 * generico en la funcion de mezcla, asi que se le pasa esta.
 */
function makeScratchLerp(out: MutableSnapshot) {
  return (a: NetSnapshot, b: NetSnapshot, t: number): NetSnapshot => {
    const count = out.entities.length;
    // El host publica siempre las mismas entidades; si no coinciden, mejor
    // dibujar el estado de llegada que inventar una mezcla.
    if (a.entities.length !== count || b.entities.length !== count) return b;
    out.tick = a.tick;
    for (let i = 0; i < count; i++) {
      const ea = a.entities[i];
      const eb = b.entities[i];
      const eo = out.entities[i];
      if (!ea || !eb || !eo) continue;
      eo.id = ea.id;
      eo.x = ea.x + (eb.x - ea.x) * t;
      eo.y = ea.y + (eb.y - ea.y) * t;
      eo.vx = ea.vx + (eb.vx - ea.vx) * t;
      eo.vy = ea.vy + (eb.vy - ea.vy) * t;
      eo.angle = lerpAngle(ea.angle, eb.angle, t);
      // `flags` y los escalares son discretos: un marcador de 3,5 no existe.
      eo.flags = ea.flags;
    }
    for (let i = 0; i < out.scalars.length; i++) out.scalars[i] = a.scalars[i] ?? 0;
    return out;
  };
}

/* ------------------------------------------------------------------ */
/* La red: publicar, el cano, y volver a entrar como cliente            */
/* ------------------------------------------------------------------ */

function publishState(
  scene: Scene,
  dt: number,
  ctx: FrameContext<FutbolHud>,
  net: GameNetPort<FutbolInput, NetSnapshot> | null,
  conditions: NetConditions,
): void {
  scene.stateTimer += dt;
  if (scene.stateTimer < STATE_STEP) return;
  // Se descuenta un intervalo, no se pone en cero: al reves, un cuadro largo
  // desplazaria el ritmo de estado para siempre.
  scene.stateTimer -= STATE_STEP;
  if (scene.stateTimer > STATE_STEP) scene.stateTimer = 0;

  scene.tick++;
  writeSnapshot(scene);

  // Al aire, para los celulares que algun dia dibujen la cancha. `mockNet` lo
  // empaqueta con el codec del aire, lo limita a 20 Hz y completa los acks
  // desde el ultimo input procesado de cada asiento, asi que no hay que
  // armarlos aca.
  net?.broadcastState(scene.snapshot, scene.tick, EMPTY_ACKS);

  // Y al cano local, que es lo que el proyector va a terminar dibujando.
  // `confirmedTick` es lo ultimo que este "cliente" reconstruyo: armar el delta
  // contra eso hace que un paquete perdido cueste ese paquete y no la cadena
  // entera hasta el proximo keyframe.
  const base = scene.confirmedTick > 0 ? scene.confirmedTick : null;
  const bytes = scene.codec.encode(scene.snapshot, base);
  scene.lastBytes = bytes.byteLength;

  if (ctx.rng.chance(conditions.lossRate)) {
    scene.droppedPackets++;
    return;
  }
  const slot = findPipeSlot(scene);
  if (slot < 0) return;
  scene.pipeBytes[slot] = bytes;
  scene.pipeAt[slot] = performance.now() + conditions.latencyMs + ctx.rng.range(0, conditions.jitterMs);
  scene.pipeAck[slot] = scene.localSeq;
}

function findPipeSlot(scene: Scene): number {
  for (let i = 0; i < scene.pipeBytes.length; i++) {
    if (scene.pipeBytes[i] === null) return i;
  }
  return -1;
}

/**
 * El lado cliente: lo que llego, se decodifica, se acomoda y se reconcilia.
 *
 * Se drena en orden de llegada, no de tick: con jitter los paquetes se cruzan y
 * el buffer de interpolacion sabe insertarlos en su lugar, que es justamente lo
 * que evita el hueco visible a 20 Hz.
 */
function drainPipe(scene: Scene): void {
  const now = performance.now();
  for (;;) {
    let best = -1;
    let bestAt = Number.POSITIVE_INFINITY;
    for (let i = 0; i < scene.pipeBytes.length; i++) {
      if (scene.pipeBytes[i] === null) continue;
      const at = scene.pipeAt[i] ?? 0;
      if (at <= now && at < bestAt) {
        bestAt = at;
        best = i;
      }
    }
    if (best < 0) return;

    const bytes = scene.pipeBytes[best];
    const ack = scene.pipeAck[best] ?? 0;
    scene.pipeBytes[best] = null;
    if (!bytes) continue;

    const decoded = scene.codec.decode(bytes);
    if (!decoded) {
      // Se perdio la base del delta: se pide keyframe y se sigue. Inventar el
      // estado que falta es peor que perder un frame.
      scene.droppedPackets++;
      scene.codec.requestKeyframe();
      continue;
    }
    if (decoded.tick > scene.confirmedTick) scene.confirmedTick = decoded.tick;
    scene.buffer.push(decoded, decoded.tick, now);
    reconcileOwnDisc(scene, decoded, ack);
  }
}

/**
 * Llego estado autoritativo: se descartan los inputs ya procesados y se
 * re-simulan los pendientes encima.
 *
 * La correccion que queda se absorbe en unos 80 ms en vez de aplicarse de
 * golpe. Un salto de dos pixeles cada 50 ms se ve como un temblor; arrastrarlo
 * no se ve. Lo que si se aplica de golpe es una correccion grande: arrastrar
 * setenta pixeles seria mentirle a quien esta jugando.
 */
function reconcileOwnDisc(scene: Scene, snapshot: NetSnapshot, ack: number): void {
  const seat = scene.predictSeat;
  const entity = entityAt(snapshot, seat);
  if (!entity) return;

  const before = scene.prediction.predicted;
  const beforeX = before.x;
  const beforeY = before.y;
  const after = scene.prediction.reconcile(
    { x: entity.x, y: entity.y, vx: entity.vx, vy: entity.vy },
    ack,
  );

  let ex = scene.errX + (beforeX - after.x);
  let ey = scene.errY + (beforeY - after.y);
  if (ex * ex + ey * ey > MAX_SMOOTH * MAX_SMOOTH) {
    ex = 0;
    ey = 0;
  }
  scene.errX = ex;
  scene.errY = ey;
}

/* ------------------------------------------------------------------ */
/* Input                                                                */
/* ------------------------------------------------------------------ */

/** Lo que llega de un celular o de un bot. Nunca un puntaje ni un resultado. */
function applyRemoteInput(scene: Scene, seat: number, input: FutbolInput): void {
  if (seat < 0 || seat >= FUTBOL_SEATS) return;
  const match = scene.match;

  if (input.kind === "drive") {
    // Quien manda `drive` corre el juego: deja de necesitar que le dibujen una
    // pantalla de mando. Se identifica solo, sin que el host tenga que saber
    // que `phoneRole` trae el registry.
    scene.padSeat[seat] = 0;
    setIntent(match, seat, input.x, input.y);
    if (input.kick) requestKick(match, seat);
  } else if (input.kind === "paddle") {
    // Franja de posicion absoluta: un paquete perdido se corrige solo en el
    // siguiente, que es la razon por la que el mando manda posicion y no delta.
    const position = Number.isFinite(input.position) ? clamp(input.position, 0, 1) : 0.5;
    scene.targetX[seat] = position * match.rules.width;
  } else if (input.kind === "hold") {
    const dir = input.buttonId === "up" ? -1 : input.buttonId === "down" ? 1 : 0;
    if (dir !== 0) scene.dirY[seat] = input.pressed ? dir : 0;
  } else if (input.kind === "press" && input.buttonId === "kick") {
    requestKick(match, seat);
  }

}

/**
 * El pulso de input, a 30 Hz.
 *
 * Hace tres cosas: convierte el deslizador de cada celular en intencion,
 * atiende el teclado del proyector y alimenta la prediccion del disco propio.
 * Va a 30 y no a 120 porque es el ritmo al que un dedo genera informacion
 * nueva, y porque cada `predict` guarda un pendiente que despues hay que
 * re-simular.
 */
function pumpInput(
  scene: Scene,
  dt: number,
  ctx: FrameContext<FutbolHud>,
  net: GameNetPort<FutbolInput, NetSnapshot> | null,
): void {
  scene.inputTimer += dt;
  let guard = 0;
  while (scene.inputTimer >= INPUT_STEP && guard++ < 4) {
    scene.inputTimer -= INPUT_STEP;
    // La franja de los celulares en modo mando solo la resuelve el host: es el
    // unico que tiene la posicion real de esos discos.
    if (scene.isHost) applyPadIntents(scene);
    readLocalIntent(scene, ctx);

    // Prediccion: se aplica el input al instante sobre la vista, que va 80 ms
    // atras, y se guarda con su numero de secuencia para poder descartarlo
    // cuando el host lo confirme.
    scene.localSeq = scene.prediction.predict({
      moveX: scene.localIntentX,
      moveY: scene.localIntentY,
    });

    // Un objeto distinto que el del pulso anterior: el limitador de `mockNet`
    // puede tener el anterior todavia esperando su turno.
    scene.driveFlip = !scene.driveFlip;
    const drive = scene.driveFlip ? scene.driveB : scene.driveA;
    drive.x = scene.localIntentX;
    drive.y = scene.localIntentY;
    drive.kick = scene.localKick;
    // El mismo camino para los dos roles. En el host el puerto lo entrega en
    // el acto a `onInput`; en un cliente sale por la red a 30 Hz.
    net?.sendInput(drive, scene.localSeq);
    scene.localKick = false;
  }
  if (scene.inputTimer > INPUT_STEP) scene.inputTimer = 0;
}

/** El deslizador es posicion; el disco tiene que correr hacia ella, no saltar. */
function applyPadIntents(scene: Scene): void {
  const match = scene.match;
  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    // El asiento propio nunca: lo escribe `readLocalIntent` y pisarlo aca
    // seria dejar que el mando de otro le mueva el disco al que esta jugando.
    if (seat === scene.predictSeat) continue;
    if ((scene.usesPad[seat] ?? 0) === 0 || (scene.padSeat[seat] ?? 0) === 0) continue;
    const dx = (scene.targetX[seat] ?? 0) - (match.px[seat] ?? 0);
    const moveX = clamp(dx / TARGET_DEADZONE, -1, 1);
    setIntent(match, seat, moveX, scene.dirY[seat] ?? 0);
  }
}

/**
 * El teclado del proyector, sobre el asiento propio.
 *
 * Es lo que permite jugar el partido entero sin un solo celular. En cuanto una
 * persona toma ese asiento, el celular manda y el teclado deja de existir.
 */
function readLocalIntent(scene: Scene, ctx: FrameContext<FutbolHud>): void {
  const axis = ctx.input.axis;
  let x = axis.x;
  let y = axis.y;
  let kick = ctx.input.keys.has("Space") || ctx.input.keys.has("Enter");

  // La palanca gana sobre el teclado cuando hay un dedo apoyado: en un celular
  // no hay teclado, y en una pantalla tactil de escritorio el dedo es lo que la
  // persona esta mirando.
  if (scene.stickActive) {
    const dx = scene.stickTipX - scene.stickX;
    const dy = scene.stickTipY - scene.stickY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > STICK_DEADZONE) {
      // Analogica, no de ocho direcciones: el modulo crece hasta el radio y
      // ahi satura, asi que se puede caminar despacio para acomodarse.
      const reach = Math.min(1, (dist - STICK_DEADZONE) / (STICK_RADIUS - STICK_DEADZONE));
      x = (dx / dist) * reach;
      y = (dy / dist) * reach;
    } else {
      x = 0;
      y = 0;
    }
  }
  if (scene.touchKick) {
    kick = true;
    scene.touchKick = false;
  }

  // `setIntent` es la que saneia y normaliza, y es la misma que corre sobre lo
  // que llega de la red: un solo lugar donde se decide que es un vector valido.
  setIntent(scene.match, scene.predictSeat, x, y);
  scene.localIntentX = scene.match.inX[scene.predictSeat] ?? 0;
  scene.localIntentY = scene.match.inY[scene.predictSeat] ?? 0;

  // Flanco, no estado: mantener la barra no dispara sesenta patadas.
  if (kick && !scene.prevKick) scene.localKick = true;
  scene.prevKick = kick;
}

/* ------------------------------------------------------------------ */
/* Bots                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Un bot de Haxball honesto: el mas cercano de su equipo va a la pelota
 * acomodandose del lado del arco rival, y el resto sostiene su lugar entre la
 * pelota y su propio arco.
 *
 * El error se renueva cada tanto y en cada saque. Con un error fijo, una
 * persona le aprende el desvio en dos jugadas y el bot deja de fallar. Con la
 * dificultad en 0 el desvio llega a medio arco; en 100 apunta al centro.
 */
function writeBotIntent(
  scene: Scene,
  memory: BotMemory,
  seat: number,
  elapsedMs: number,
  roll1: number,
  roll2: number,
  skill: number,
  out: BotDrive,
): void {
  const match = scene.match;
  const rules = match.rules;
  const team = match.pTeam[seat] ?? 0;
  const rivalGoalX = team === 0 ? rules.width : 0;
  const ownGoalX = team === 0 ? 0 : rules.width;
  const midY = rules.height / 2;

  if (memory.kickoffId[seat] !== match.kickoffId || elapsedMs >= (memory.nextThinkMs[seat] ?? 0)) {
    memory.kickoffId[seat] = match.kickoffId;
    // Reaccionar cada 300 ms con dificultad baja y cada 90 ms con la maxima.
    memory.nextThinkMs[seat] = elapsedMs + 90 + (1 - skill) * 260;
    const spread = (1 - skill) * rules.goalWidth * 0.9 + 12;
    memory.biasX[seat] = (roll1 * 2 - 1) * spread;
    memory.biasY[seat] = (roll2 * 2 - 1) * spread;
  }

  const px = match.px[seat] ?? 0;
  const py = match.py[seat] ?? 0;
  const ballX = match.ballX;
  const ballY = match.ballY;

  // Quien va a la pelota: el mas cercano del equipo. Sin esto los cuatro se
  // amontonan y el partido se vuelve un forcejeo.
  let closest = true;
  const myDist = distance2(px, py, ballX, ballY);
  for (let other = 0; other < FUTBOL_SEATS; other++) {
    if (other === seat || (match.pTeam[other] ?? 0) !== team) continue;
    if (distance2(match.px[other] ?? 0, match.py[other] ?? 0, ballX, ballY) < myDist) {
      closest = false;
      break;
    }
  }

  let targetX: number;
  let targetY: number;
  if (closest) {
    // Punto justo detras de la pelota respecto del arco rival: llegar por ahi
    // es lo que hace que el golpe salga hacia adelante y no hacia el costado.
    const dx = rivalGoalX - ballX;
    const dy = midY - ballY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const behind = rules.playerRadius + rules.ballRadius * 0.8;
    targetX = ballX - (dx / len) * behind + (memory.biasX[seat] ?? 0) * 0.3;
    targetY = ballY - (dy / len) * behind + (memory.biasY[seat] ?? 0) * 0.3;
  } else {
    // Sostener: a mitad de camino entre la pelota y el arco propio, abierto en
    // la banda que le toca por formacion.
    const lane = Math.floor(seat / 2) % 2 === 0 ? -0.22 : 0.22;
    targetX = ballX * 0.55 + ownGoalX * 0.45;
    targetY = ballY * 0.6 + (midY + lane * rules.height) * 0.4 + (memory.biasY[seat] ?? 0) * 0.2;
  }

  targetX = clamp(targetX, rules.playerRadius, rules.width - rules.playerRadius);
  targetY = clamp(targetY, rules.playerRadius, rules.height - rules.playerRadius);

  const mx = targetX - px;
  const my = targetY - py;
  const dist = Math.sqrt(mx * mx + my * my);
  if (dist > 4) {
    out.x = mx / dist;
    out.y = my / dist;
  } else {
    out.x = 0;
    out.y = 0;
  }

  // Patear cuando la pelota esta al alcance y esta del lado del arco rival:
  // sin la segunda condicion el bot hace goles en contra con entusiasmo.
  const reach = rules.playerRadius + rules.ballRadius + rules.kickReach;
  const toBallX = ballX - px;
  const toBallY = ballY - py;
  const inReach = toBallX * toBallX + toBallY * toBallY <= reach * reach;
  const forward = team === 0 ? toBallX > -rules.playerRadius : toBallX < rules.playerRadius;
  out.kick = inReach && forward && match.phase === PHASE_PLAYING;
}

function distance2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/* ------------------------------------------------------------------ */
/* Efectos                                                              */
/* ------------------------------------------------------------------ */

function decayTimers(scene: Scene, dt: number): void {
  const ms = dt * 1000;
  if (scene.flashMs > 0) scene.flashMs -= ms;
  if (scene.shakeMs > 0) scene.shakeMs -= ms;
  if (scene.noticeMs > 0) scene.noticeMs -= ms;
  // La correccion de la reconciliacion se va absorbiendo sola.
  const decay = Math.min(1, dt * SMOOTH_RATE);
  scene.errX -= scene.errX * decay;
  scene.errY -= scene.errY * decay;
}

function updateParticles(scene: Scene, dt: number): void {
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
    scene.sparkVx[i] = (scene.sparkVx[i] ?? 0) * 0.97;
    scene.sparkVy[i] = (scene.sparkVy[i] ?? 0) * 0.97;
  }
  for (let i = 0; i < MAX_RIPPLES; i++) {
    const life = scene.rippleLife[i] ?? 0;
    if (life > 0) scene.rippleLife[i] = Math.max(0, life - dt);
  }
}

function nextNoise(scene: Scene): number {
  scene.noiseCursor = (scene.noiseCursor + 1) % NOISE_SIZE;
  return scene.noise[scene.noiseCursor] ?? 0;
}

function spawnRipple(scene: Scene, x: number, y: number, team: number): void {
  scene.rippleHead = (scene.rippleHead + 1) % MAX_RIPPLES;
  scene.rippleX[scene.rippleHead] = x;
  scene.rippleY[scene.rippleHead] = y;
  scene.rippleLife[scene.rippleHead] = RIPPLE_LIFE;
  scene.rippleTeam[scene.rippleHead] = team === 1 ? 1 : 0;
}

function spawnGoalBurst(scene: Scene, x: number, y: number, team: number, reduced: boolean): void {
  const count = reduced ? 12 : SPARKS_PER_GOAL;
  for (let i = 0; i < count; i++) {
    scene.sparkHead = (scene.sparkHead + 1) % MAX_SPARKS;
    const head = scene.sparkHead;
    const angle = nextNoise(scene) * Math.PI;
    const speed = 220 + Math.abs(nextNoise(scene)) * 620;
    scene.sparkX[head] = x;
    scene.sparkY[head] = y;
    scene.sparkVx[head] = Math.cos(angle) * speed;
    scene.sparkVy[head] = Math.sin(angle) * speed;
    const life = 0.5 + Math.abs(nextNoise(scene)) * 0.7;
    scene.sparkLife[head] = life;
    scene.sparkMax[head] = life;
    scene.sparkTeam[head] = team === 1 ? 1 : 0;
  }
}

function pushNotice(scene: Scene, text: string): void {
  scene.noticeText = text;
  scene.noticeMs = NOTICE_MS;
}

function pushTrail(scene: Scene, x: number, y: number): void {
  scene.trailHead = (scene.trailHead + 1) % TRAIL_MAX;
  scene.trailX[scene.trailHead] = x;
  scene.trailY[scene.trailHead] = y;
  if (scene.trailLen < scene.trailMax) scene.trailLen++;
}

/* ------------------------------------------------------------------ */
/* Dibujo                                                               */
/* ------------------------------------------------------------------ */

function drawMatch(scene: Scene, g: CanvasRenderingContext2D, ctx: DrawContext): void {
  const rules = scene.match.rules;
  const w = rules.width;
  const h = rules.height;
  const reduced = ctx.reducedMotion;

  // Lo que se dibuja es el estado de hace 80 ms, interpolado entre los dos
  // snapshots que lo rodean. Nunca el ultimo recibido: eso serian saltos de
  // 50 ms y un congelamiento por cada paquete que llega tarde.
  // El host lo saca de su cano local y el cliente del buffer que llena
  // `useGameNet`. Los dos entregan lo mismo: el estado de hace 80 ms,
  // interpolado entre los dos snapshots que lo rodean. Nunca el ultimo
  // recibido: eso serian saltos de 50 ms y un congelamiento por cada paquete
  // que llega tarde.
  const view = scene.sample(performance.now()) ?? scene.snapshot;

  reactToViewEvents(scene, view, reduced, ctx.sfx);

  g.fillStyle = ctx.palette["--sn-bg"];
  g.fillRect(0, 0, w, h);

  // `save`/`restore` y no `setTransform`: el contexto ya viene con la matriz de
  // DPR y escala que puso la base, y pisarla dibujaria el partido del tamano de
  // una estampilla.
  g.save();
  if (!reduced && scene.shakeMs > 0) {
    const strength = (scene.shakeMs / SHAKE_MS) * SHAKE_PX;
    g.translate(nextNoise(scene) * strength, nextNoise(scene) * strength);
  }

  g.fillStyle = scene.bgGlow;
  g.fillRect(0, 0, w, h);

  drawField(scene, g, rules);
  drawTrail(scene, g, view, rules);
  drawRipples(scene, g);
  drawPlayers(scene, g, view, rules);
  drawBall(scene, g, view, rules);
  drawSparks(scene, g);

  g.fillStyle = scene.vignette;
  g.fillRect(0, 0, w, h);
  g.restore();

  if (!reduced && scene.flashMs > 0) {
    g.globalAlpha = (scene.flashMs / FLASH_MS) * 0.55;
    g.fillStyle = scene.flashColor[scene.flashTeam] ?? scene.flashColor[0] ?? "";
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
  }

  drawScoreboard(scene, g, view, rules);
  if (!scene.isHost) drawTouchLayer(scene, g, rules);
}

/**
 * Lo que ve el dedo. Solo en un cliente: el proyector se juega con teclado.
 *
 * La palanca se dibuja donde cayo el pulgar y no en un rincon fijo, que es lo
 * que permite mirar la cancha en vez de mirar el control. La zona de patear se
 * marca apenas: si se pinta fuerte, tapa media cancha durante todo el partido.
 */
function drawTouchLayer(scene: Scene, g: CanvasRenderingContext2D, rules: FutbolRulesLike): void {
  const zoneX = rules.width * KICK_ZONE;
  g.fillStyle = scene.touchZoneFill;
  g.fillRect(zoneX, 0, rules.width - zoneX, rules.height);
  g.font = FONT_NOTICE;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = scene.dimColor;
  g.fillText(LABEL_KICK, (zoneX + rules.width) / 2, rules.height - 46);

  if (!scene.stickActive) return;
  g.lineWidth = 3;
  g.strokeStyle = scene.touchStroke;
  g.beginPath();
  g.arc(scene.stickX, scene.stickY, STICK_RADIUS, 0, Math.PI * 2);
  g.stroke();

  const dx = scene.stickTipX - scene.stickX;
  const dy = scene.stickTipY - scene.stickY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // El pulgar se puede ir mas lejos que el radio; el punto se queda en el borde
  // para que se lea como una palanca y no como un dedo perdido.
  const reach = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
  g.fillStyle = scene.touchStroke;
  g.beginPath();
  g.arc(scene.stickX + dx * reach, scene.stickY + dy * reach, 34, 0, Math.PI * 2);
  g.fill();
}

function drawField(scene: Scene, g: CanvasRenderingContext2D, rules: FutbolRulesLike): void {
  const w = rules.width;
  const h = rules.height;
  const top = goalTop(rules);
  const bottom = goalBottom(rules);

  g.lineWidth = 3;
  g.strokeStyle = scene.lineColor;
  g.strokeRect(0, 0, w, h);

  g.beginPath();
  g.moveTo(w / 2, 0);
  g.lineTo(w / 2, h);
  g.stroke();

  g.beginPath();
  g.arc(w / 2, h / 2, h * 0.16, 0, Math.PI * 2);
  g.stroke();

  // Areas: dos rectangulos, uno por arco.
  const areaW = w * 0.11;
  const areaH = (bottom - top) * 1.9;
  g.strokeStyle = scene.lineSoft;
  g.strokeRect(0, h / 2 - areaH / 2, areaW, areaH);
  g.strokeRect(w - areaW, h / 2 - areaH / 2, areaW, areaH);

  // Boca de cada arco, del color del equipo que la defiende.
  g.lineWidth = 8;
  g.strokeStyle = scene.teamRing[0] ?? "";
  g.beginPath();
  g.moveTo(0, top);
  g.lineTo(0, bottom);
  g.stroke();
  g.strokeStyle = scene.teamRing[1] ?? "";
  g.beginPath();
  g.moveTo(w, top);
  g.lineTo(w, bottom);
  g.stroke();

  // Postes: son cuerpos de colision, asi que se dibujan.
  g.fillStyle = scene.textColor;
  for (let i = 0; i < 4; i++) {
    const px = i < 2 ? 0 : w;
    const py = i % 2 === 0 ? top : bottom;
    g.beginPath();
    g.arc(px, py, rules.postRadius, 0, Math.PI * 2);
    g.fill();
  }
}

function drawTrail(
  scene: Scene,
  g: CanvasRenderingContext2D,
  view: NetSnapshot,
  rules: FutbolRulesLike,
): void {
  const ball = entityAt(view, BALL_ID);
  if (!ball) return;
  // La estela sigue al reloj de la sala, no al de la simulacion: por eso se
  // alimenta desde la vista y a ritmo de cuadro.
  pushTrail(scene, ball.x, ball.y);

  for (let i = 0; i < scene.trailLen; i++) {
    const index = (scene.trailHead - i + TRAIL_MAX * 2) % TRAIL_MAX;
    g.fillStyle = scene.trailFill[i] ?? "";
    g.beginPath();
    g.arc(
      scene.trailX[index] ?? 0,
      scene.trailY[index] ?? 0,
      rules.ballRadius * (1 - i / (scene.trailMax + 4)),
      0,
      Math.PI * 2,
    );
    g.fill();
  }
}

function drawPlayers(
  scene: Scene,
  g: CanvasRenderingContext2D,
  view: NetSnapshot,
  rules: FutbolRulesLike,
): void {
  const radius = rules.playerRadius;
  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    const entity = entityAt(view, seat);
    if (!entity) continue;
    const team = (entity.flags & FLAG_TEAM_B) !== 0 ? 1 : 0;
    const own = seat === scene.predictSeat;

    // El disco propio se dibuja PREDICHO: es lo unico cuyo input este aparato
    // conoce antes que el snapshot. Todo el resto va interpolado.
    const x = own ? scene.prediction.predicted.x + scene.errX : entity.x;
    const y = own ? scene.prediction.predicted.y + scene.errY : entity.y;

    g.fillStyle = scene.teamSoft[team] ?? "";
    g.beginPath();
    g.arc(x, y, radius * 1.5, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = scene.teamFill[team] ?? "";
    g.beginPath();
    g.arc(x, y, radius, 0, Math.PI * 2);
    g.fill();

    g.lineWidth = own ? 5 : 3;
    g.strokeStyle = own ? scene.ownRing : (scene.teamRing[team] ?? "");
    g.beginPath();
    g.arc(x, y, radius - 2, 0, Math.PI * 2);
    g.stroke();

    // Muesca de rumbo: dice para donde va sin agregar otra entidad al snapshot.
    const speed2 = entity.vx * entity.vx + entity.vy * entity.vy;
    if (speed2 > 900) {
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(entity.angle) * radius * 1.35, y + Math.sin(entity.angle) * radius * 1.35);
      g.stroke();
    }

    if ((entity.flags & FLAG_KICK_READY) === 0) {
      // Sin patada disponible: anillo punteado, se lee de lejos.
      g.lineWidth = 2;
      g.strokeStyle = scene.dimColor;
      g.beginPath();
      g.arc(x, y, radius + 7, 0, Math.PI * 2);
      g.stroke();
    }

    g.fillStyle = scene.textColor;
    g.font = FONT_INITIAL;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(
      (entity.flags & FLAG_HUMAN) !== 0 ? (SEAT_INITIALS[seat] ?? "?") : "·",
      x,
      y + 1,
    );
  }
}

function drawBall(
  scene: Scene,
  g: CanvasRenderingContext2D,
  view: NetSnapshot,
  rules: FutbolRulesLike,
): void {
  const ball = entityAt(view, BALL_ID);
  if (!ball) return;
  g.fillStyle = scene.ballGlow;
  g.beginPath();
  g.arc(ball.x, ball.y, rules.ballRadius * 2.1, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = scene.ballColor;
  g.beginPath();
  g.arc(ball.x, ball.y, rules.ballRadius, 0, Math.PI * 2);
  g.fill();
}

function drawRipples(scene: Scene, g: CanvasRenderingContext2D): void {
  for (let i = 0; i < MAX_RIPPLES; i++) {
    const life = scene.rippleLife[i] ?? 0;
    if (life <= 0) continue;
    const t = 1 - life / RIPPLE_LIFE;
    g.globalAlpha = 1 - t;
    g.lineWidth = 4;
    g.strokeStyle = scene.teamRing[scene.rippleTeam[i] ?? 0] ?? "";
    g.beginPath();
    g.arc(scene.rippleX[i] ?? 0, scene.rippleY[i] ?? 0, 14 + t * 90, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 1;
}

function drawSparks(scene: Scene, g: CanvasRenderingContext2D): void {
  for (let i = 0; i < MAX_SPARKS; i++) {
    const life = scene.sparkLife[i] ?? 0;
    if (life <= 0) continue;
    g.globalAlpha = life / (scene.sparkMax[i] ?? 1);
    g.fillStyle = scene.teamSpark[scene.sparkTeam[i] ?? 0] ?? "";
    g.beginPath();
    g.arc(scene.sparkX[i] ?? 0, scene.sparkY[i] ?? 0, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function drawScoreboard(
  scene: Scene,
  g: CanvasRenderingContext2D,
  view: NetSnapshot,
  rules: FutbolRulesLike,
): void {
  const w = rules.width;
  const scoreA = scalarAt(view, S_SCORE_A);
  const scoreB = scalarAt(view, S_SCORE_B);
  const phase = scalarAt(view, S_PHASE);

  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = FONT_SCORE;
  g.fillStyle = scene.teamFill[0] ?? "";
  g.fillText(NUMBER_LABELS[scoreA] ?? "", w / 2 - 120, 130);
  g.fillStyle = scene.teamFill[1] ?? "";
  g.fillText(NUMBER_LABELS[scoreB] ?? "", w / 2 + 120, 130);
  g.fillStyle = scene.dimColor;
  g.font = FONT_CLOCK;
  g.fillText("·", w / 2, 118);

  // La etiqueta del reloj se rearma solo cuando cambia el segundo, no 60 veces.
  const seconds = Math.max(0, Math.ceil(scalarAt(view, S_CLOCK_MS) / 1000));
  if (seconds !== scene.clockSeconds) {
    scene.clockSeconds = seconds;
    scene.clockLabel = formatClock(seconds * 1000);
  }
  g.fillStyle = scene.textColor;
  g.fillText(scene.clockLabel, w / 2, 178);

  if (phase !== PHASE_PLAYING) {
    g.font = FONT_BANNER;
    g.fillStyle =
      phase === PHASE_CELEBRATION
        ? (scene.teamRing[clamp(scalarAt(view, S_GOAL_TEAM), 0, 1)] ?? "")
        : scene.textColor;
    g.fillText(
      phase === PHASE_CELEBRATION ? BANNER_GOAL : phase === PHASE_OVER ? BANNER_OVER : BANNER_KICKOFF,
      w / 2,
      rules.height / 2 + 26,
    );
  }

  if (scene.noticeMs > 0) {
    g.font = FONT_NOTICE;
    g.fillStyle = scene.dimColor;
    g.fillText(scene.noticeText, w / 2, rules.height - 42);
  }
}

/**
 * Los efectos se disparan desde LA VISTA, no desde la simulacion.
 *
 * Si el destello del gol saliera del estado autoritativo, se veria 80 ms antes
 * de que la pelota entre en pantalla. Los contadores viajan como escalares
 * justamente para esto.
 */
function reactToViewEvents(scene: Scene, view: NetSnapshot, reduced: boolean, sfx: Sfx): void {
  const seat = scene.predictSeat;
  scene.viewA = scalarAt(view, S_SCORE_A);
  scene.viewB = scalarAt(view, S_SCORE_B);
  scene.viewClockS = scalarAt(view, S_CLOCK_MS) / 1000;
  scene.viewPhase = scalarAt(view, S_PHASE);
  scene.myTouches = touchesOf(view, seat);

  const kicks = scalarAt(view, S_KICKS);
  if (kicks > scene.seenKicks) {
    const packed = scalarAt(view, S_KICK_POS);
    const kicker = Math.max(0, scalarAt(view, S_KICK_SEAT));
    spawnRipple(
      scene,
      (packed & KICK_POS_MASK) - KICK_POS_BIAS,
      (packed >> KICK_POS_SHIFT) & KICK_POS_MASK,
      teamOfSeat(kicker),
    );
    sfx.play("hit");
  }
  scene.seenKicks = kicks;

  const posts = scalarAt(view, S_POSTS);
  if (posts !== scene.seenPosts) {
    if (posts > scene.seenPosts) {
      pushNotice(scene, "¡En el palo!");
      sfx.play("tick");
    }
    scene.seenPosts = posts;
  }

  const goals = scalarAt(view, S_GOALS);
  if (goals !== scene.seenGoals) {
    if (goals > scene.seenGoals) {
      sfx.play("win");
      // El autor viaja con cada gol, asi que el puntaje propio se arma del
      // flujo sin inventar nada, igual en el host que en un cliente. Dos
      // condiciones: que el contador haya subido de a uno —si subio de a dos se
      // perdio un evento y no se sabe de quien fue— y que el gol sea PARA mi
      // equipo, que es la misma regla que aplica `registerGoal`. Sin lo
      // segundo, un gol en contra sumaria 70 puntos.
      const scoringTeam = scalarAt(view, S_GOAL_TEAM);
      if (goals - scene.seenGoals === 1 && scoringTeam === teamOfSeat(seat)) {
        if (scalarAt(view, S_GOAL_SEAT) === seat) scene.myGoals++;
        if (scalarAt(view, S_ASSIST_SEAT) === seat) scene.myAssists++;
      }
      const team = clamp(scoringTeam, 0, 1);
      const ball = entityAt(view, BALL_ID);
      spawnGoalBurst(scene, ball?.x ?? 0, ball?.y ?? 0, team, reduced);
      scene.flashTeam = team;
      if (!reduced) {
        scene.flashMs = FLASH_MS;
        scene.shakeMs = SHAKE_MS;
      }
      scene.trailLen = 0;
      const scorer = scalarAt(view, S_GOAL_SEAT);
      const assist = scalarAt(view, S_ASSIST_SEAT);
      pushNotice(
        scene,
        assist >= 0
          ? `Gol de ${TEAM_NAMES[team] ?? ""} · asistió ${SEAT_INITIALS[assist] ?? "?"}`
          : scorer >= 0
            ? `Gol de ${TEAM_NAMES[team] ?? ""} · ${SEAT_INITIALS[scorer] ?? "?"}`
            : `Gol de ${TEAM_NAMES[team] ?? ""}`,
      );
    }
    scene.seenGoals = goals;
  }
}

/* ------------------------------------------------------------------ */
/* El mando                                                             */
/* ------------------------------------------------------------------ */

type ControlMemory = {
  signature: string[];
  owner: string[];
  eventId: string[];
  eventPattern: Array<readonly number[]>;
  eventTicks: Int32Array;
  eventText: string[];
  kicks: Int32Array;
  goals: Int32Array;
};

function createControlMemory(): ControlMemory {
  return {
    signature: new Array<string>(FUTBOL_SEATS).fill(""),
    owner: new Array<string>(FUTBOL_SEATS).fill(""),
    eventId: new Array<string>(FUTBOL_SEATS).fill(""),
    eventPattern: new Array<readonly number[]>(FUTBOL_SEATS).fill(HAPTIC_KICK),
    eventTicks: new Int32Array(FUTBOL_SEATS),
    eventText: new Array<string>(FUTBOL_SEATS).fill(""),
    kicks: new Int32Array(FUTBOL_SEATS).fill(-1),
    goals: new Int32Array(FUTBOL_SEATS).fill(-1),
  };
}

/**
 * Lo que ve un celular. Es por asiento y no para la sala, porque la marca de
 * "vos estas acá" y la vibracion son distintas para cada uno.
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
  const match = scene.match;
  const rules = match.rules;
  const team = match.pTeam[seat] ?? 0;
  const enabled = playing && match.phase === PHASE_PLAYING;
  const haptic = seatHaptic(scene, seat, memory);

  const scoreA = match.score[0] ?? 0;
  const scoreB = match.score[1] ?? 0;
  const seconds = Math.max(0, Math.ceil(match.clockS));
  const mine = match.goals[seat] ?? 0;
  const notice =
    (memory.eventTicks[seat] ?? 0) > 0
      ? (memory.eventText[seat] ?? "")
      : match.phase === PHASE_KICKOFF
        ? "Saque del medio"
        : match.phase === PHASE_CELEBRATION
          ? `Gol de ${TEAM_NAMES[clamp(match.lastGoalTeam, 0, 1)] ?? ""}`
          : match.phase === PHASE_OVER
            ? "Terminó el partido"
            : "";

  // Las marcas del deslizador entran en la firma CUANTIZADAS. Sin ellas, la
  // pelota del mini-mapa se movia una vez por segundo —cuando cambiaba el
  // reloj— y no servia para nada; con la posicion cruda, el spec saldria diez
  // veces por segundo aunque nadie se haya movido dos pixeles.
  const ballMark = Math.round((match.ballX / rules.width) * 40);
  const ownMark = Math.round(((match.px[seat] ?? 0) / rules.width) * 40);
  const signature = `${enabled ? 1 : 0}|${scoreA}|${scoreB}|${seconds}|${mine}|${notice}|${haptic?.id ?? ""}|${ballMark}|${ownMark}`;
  // Un aparato que acaba de tomar el asiento tiene que recibir su pantalla
  // aunque no haya cambiado nada: el spec dirigido no se reenvia solo.
  const fresh = memory.owner[seat] !== playerId;
  if (!fresh && memory.signature[seat] === signature) return null;
  memory.owner[seat] = playerId;
  memory.signature[seat] = signature;

  const status: ControlStatus[] = [
    { label: "Marcador", value: `${scoreA} · ${scoreB}` },
    { label: "Reloj", value: formatClock(seconds * 1000), tone: seconds <= 15 ? "danger" : "default" },
    { label: "Tus goles", value: String(mine) },
  ];

  return {
    layout: "pad",
    title: `Equipo ${TEAM_NAMES[team] ?? ""}`,
    enabled,
    slider: {
      orientation: "horizontal",
      min: 0,
      max: 1,
      markers: [
        { at: clamp(match.ballX / rules.width, 0, 1), label: "Pelota" },
        { at: clamp((match.px[seat] ?? 0) / rules.width, 0, 1), label: "Vos", tone: "warn" },
      ],
    },
    buttons: [
      { id: "up", label: "▲ Subir", hold: true, group: "main" },
      { id: "down", label: "▼ Bajar", hold: true, group: "main" },
      // El botón no se apaga durante la espera entre patadas: dura 0,3 s y el
      // spec sale 10 veces por segundo, así que apagarlo sería un parpadeo sin
      // información. La patada además queda armada un rato en el host, así que
      // tocar un instante antes de tiempo igual sale.
      { id: "kick", label: "PATEAR", group: "rotate", hint: "Cuando la tengas cerca" },
    ],
    status,
    ...(notice ? { notice } : {}),
    ...(haptic ? { haptic } : {}),
  };
}

/**
 * Vibracion por asiento: corta al patear, larga al recibir un gol, festiva al
 * hacerlo. El `id` sale de contadores que solo cambian cuando pasa el evento,
 * asi que el telefono vibra una vez y no en cada refresco del spec.
 */
function seatHaptic(scene: Scene, seat: number, memory: ControlMemory): ControlHaptic | null {
  const match = scene.match;
  const team = match.pTeam[seat] ?? 0;
  const kicks = match.lastKickSeat === seat ? match.kickCount : (memory.kicks[seat] ?? 0);
  const goals = match.goalCount;
  // El primer spec no vibra: no paso nada todavia y arrancar con un golpe en la
  // mano es ruido.
  const first = (memory.kicks[seat] ?? -1) < 0;
  let ticks = memory.eventTicks[seat] ?? 0;
  if (ticks > 0) ticks--;

  if (!first && goals !== (memory.goals[seat] ?? 0)) {
    const scored = match.lastGoalTeam === team;
    memory.eventText[seat] = scored ? "¡Gol de tu equipo!" : "Gol en contra";
    memory.eventId[seat] = `goal-${goals}`;
    memory.eventPattern[seat] = scored ? HAPTIC_SCORED : HAPTIC_CONCEDED;
    ticks = 12;
  } else if (!first && kicks !== (memory.kicks[seat] ?? 0)) {
    memory.eventText[seat] = "";
    memory.eventId[seat] = `kick-${kicks}`;
    memory.eventPattern[seat] = HAPTIC_KICK;
    ticks = 3;
  }

  memory.kicks[seat] = kicks;
  memory.goals[seat] = goals;
  memory.eventTicks[seat] = ticks;

  // Viaja en todos los specs de la ventana, no solo en el primero: el mando
  // ignora el `id` repetido, asi que un paquete perdido no cuesta la vibracion.
  if (ticks > 0 && memory.eventId[seat]) {
    return { id: memory.eventId[seat] ?? "", pattern: memory.eventPattern[seat] ?? HAPTIC_KICK };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Ayudas                                                               */
/* ------------------------------------------------------------------ */

/** Lo que `drawField` y compania necesitan de las reglas, y nada mas. */
type FutbolRulesLike = FutbolState["rules"];

function countHumans(players: readonly NetPlayer[], team: number): number {
  let count = 0;
  for (const player of players) {
    if (!player.bot && teamOfSeat(player.seat) === team) count++;
  }
  return count;
}

/** El input de un bot. Nunca viaja por la red: la politica corre en el host. */
type BotDrive = { kind: "drive"; x: number; y: number; kick: boolean };

type BotMemory = {
  biasX: Float32Array;
  biasY: Float32Array;
  kickoffId: Int32Array;
  nextThinkMs: Float32Array;
  /** Un objeto por asiento, reusado: la politica corre 30 veces por segundo. */
  out: BotDrive[];
};

function createBotMemory(): BotMemory {
  return {
    biasX: new Float32Array(FUTBOL_SEATS),
    biasY: new Float32Array(FUTBOL_SEATS),
    kickoffId: new Int32Array(FUTBOL_SEATS).fill(-1),
    nextThinkMs: new Float32Array(FUTBOL_SEATS),
    out: Array.from({ length: FUTBOL_SEATS }, () => ({
      kind: "drive" as const,
      x: 0,
      y: 0,
      kick: false,
    })),
  };
}
