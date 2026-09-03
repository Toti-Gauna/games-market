import { useEffect, useMemo, useRef } from "react";
import type { GameProps } from "@/core/contract/game";
import { bool, num } from "@/core/contract/settings";
import type { ControlInput, ControlSpec } from "@/core/contract/control";
import type { NetPlayer } from "@/core/contract/gameNet";
import { vibrate } from "@/core/engine/audio";
import { clamp } from "@/core/engine/collide";
import { withAlpha } from "@/core/engine/palette";
import { useGame2D, type DrawContext, type FrameContext } from "@/core/engine/useGame2D";
import type { BotPolicy } from "@/core/net/mockNet";
import { useGameNet } from "@/core/net/useGameNet";
import { GameStage, HudStat } from "@/ui/game/GameStage";
import { formatClock } from "@/ui/game/format";
import {
  cannonPosition,
  createInvadersState,
  fireCannon,
  invaderX,
  invadersPoints,
  roomPoints,
  seatPoints,
  setCannonActive,
  setCannonTarget,
  startWave,
  stepInvaders,
  EVENT_CANNON_HIT,
  EVENT_KILL,
  EVENT_MARCH,
  EVENT_OVER,
  EVENT_SHIELD,
  EVENT_WAVE_CLEARED,
  INVADERS_SEATS,
  INVADER_TYPES,
  MAX_BOMBS,
  MAX_BULLETS,
  SHIELD_CELLS,
  SHIELD_COLS,
  SHIELD_COUNT,
  SHIELD_ROWS,
  type InvadersRules,
  type InvadersState,
} from "./logic";

/**
 * R4 · Invasores.
 *
 * Space Invaders cooperativo: hasta cuatro celulares son cañones en la misma
 * pantalla proyectada y **la horda es una sola**. Es el unico juego del
 * catalogo donde la sala gana o pierde junta.
 *
 * Tres decisiones lo explican entero:
 *
 * 1. **Topologia `gamepad`: solo el proyector dibuja.** Este componente corre
 *    como host autoritativo (`useGameNet` con `role: "host"`, `seat: -1`):
 *    simula, puntua y renderiza. Los celulares son mandos. Por eso **no hay
 *    `broadcastState` ni snapshots**: el telefono no renderiza la partida, asi
 *    que mandarle estado seria gastar canal para que lo tire. Lo que el
 *    telefono muestra viaja en el `ControlSpec`.
 * 2. **Posicion absoluta para mover, evento para disparar.** La franja tactil
 *    manda donde esta el dedo: un paquete perdido se corrige solo en el
 *    siguiente. El disparo va como `press` porque perder un "disparé" se nota
 *    muchisimo mas que perder un cuadro de posicion.
 * 3. **El host recibe input, nunca resultados.** Lo que llega se saneia en
 *    `setCannonTarget` y en `fireCannon` antes de tocar la simulacion. Un
 *    cliente que mandara puntaje se ignora.
 *
 * Los asientos vacios los juega un bot, porque la base exige que todo juego de
 * red se pueda probar en solitario, y porque si alguien cierra el celular a
 * mitad de partida la sala no se puede quedar esperandolo.
 */

/* ------------------------------------------------------------------ */
/* Geometria del campo                                                  */
/* ------------------------------------------------------------------ */

const FIELD_W = 1600;
const FIELD_H = 900;

const CELL_W = 96;
const CELL_H = 68;
const INVADER_W = 62;
const INVADER_H = 42;
const HORDE_TOP_Y = 120;
/** Tope de descensos acumulados entre oleadas: la oleada 12 no puede nacer invadiendo. */
const MAX_WAVE_DROPS = 6;

const CANNON_W = 72;
const CANNON_H = 38;
/** Techo de los cañones. Llegar aca es invasion. */
const CANNON_Y = 800;

const BULLET_W = 6;
const BULLET_H = 22;
const BOMB_W = 8;
const BOMB_H = 22;

const SHIELD_TOP_Y = 640;
const SHIELD_CELL = 8;

/** Fraccion extra de velocidad por cañon conectado: 1,0 / 1,1 / 1,2 / 1,3. */
const PLAYER_SPEED_GAIN = 0.1;
/** Paso de simulacion: 1/60, como pide la guia. Los proyectiles son lentos y
 *  entran en un paso sin necesidad de barrido. */
const SIM_STEP = 1 / 60;
/** La horda dispara mas seguido en cada oleada. */
const HORDE_FIRE_WAVE_GAIN = 0.15;

/* ------------------------------------------------------------------ */
/* Presentacion                                                         */
/* ------------------------------------------------------------------ */

const MAX_SPARKS = 200;
const SPARKS_PER_KILL = 12;
const SPARKS_PER_SHIELD = 4;
const SPARK_GRAVITY = 520;
const NOISE_SIZE = 64;

const FLASH_MS = 160;
const SHAKE_MS = 320;
const SHAKE_PX = 7;
const NOTICE_MS = 2600;
const OVER_HOLD_MS = 1800;
/** El paso de la horda no puede sonar 37 veces por segundo cuando acelera. */
const MARCH_SFX_MS = 110;

const FIRE_BUTTON = "fire";
/** Cada cuanto se revisa si al mando le cambio algo que mostrar. */
const CONTROL_MS = 400;

const BOT_HZ = 30;
const BOT_TICK_S = 1 / BOT_HZ;
/** Cuanto se corre el bot al ver una bomba encima, en unidades del mundo. */
const BOT_DODGE = 150;

/**
 * Vibracion corta al acertar, larga al ser alcanzado.
 *
 * Es el segundo canal de feedback del mando: en la mano de quien juega, el
 * proyector esta a diez metros y la sala tiene ruido. Que acertar y que te
 * volteen no se sientan igual es lo que hace legible el juego sin mirar.
 */
const HAPTIC_HIT = 18;
const HAPTIC_DOWN: number[] = [45, 70, 45];

/** Velocidad del teclado local, en pantallas por segundo. */
const KEYBOARD_SPEED = 1.05;
/** Cuanto sigue mandando el teclado despues de soltar, para que el bot no le pelee. */
const KEYBOARD_HOLD_S = 1.5;

/** Si se van todos, se espera y despues se termina. La partida nunca se cuelga. */
const ABANDON_S = 30;

/** Sobre 200 ms el juego se siente roto y hay que decirlo. Callarlo es peor. */
const LATENCY_WARN_MS = 200;

const FONT_LIVES = '700 84px "Space Grotesk", sans-serif';
const FONT_LIVES_LABEL = '600 20px "Space Grotesk", sans-serif';
const FONT_SEAT = '600 22px "Space Grotesk", sans-serif';
const FONT_BANNER = '700 76px "Space Grotesk", sans-serif';
const FONT_BANNER_SUB = '600 30px "Space Grotesk", sans-serif';
const FONT_NOTICE = '600 34px "Space Grotesk", sans-serif';

/** `String(n)` por cuadro es una asignacion por cuadro. */
const NUMBER_LABELS: readonly string[] = Array.from({ length: 256 }, (_, i) => String(i));

function label(n: number): string {
  return NUMBER_LABELS[n] ?? String(n);
}

/* ------------------------------------------------------------------ */
/* Escena                                                               */
/* ------------------------------------------------------------------ */

type InvadersHud = { lives: number; wave: number; left: number; points: number };

type Scene = {
  game: InvadersState;
  /** Asiento desde el que se reporta el outcome. En el banco de pruebas, `config.seat`. */
  viewSeat: number;

  /* Particulas en arrays planos. `pool.each` pide un callback, y eso es una
     closure nueva por cuadro; con arrays planos el loop no asigna nada. */
  sparkX: Float32Array;
  sparkY: Float32Array;
  sparkVx: Float32Array;
  sparkVy: Float32Array;
  sparkLife: Float32Array;
  sparkMax: Float32Array;
  sparkSeat: Uint8Array;
  sparkHead: number;

  /**
   * Ruido sembrado una vez.
   *
   * El azar de las particulas NO puede salir de `ctx.rng`: con
   * `prefers-reduced-motion` no se emiten particulas, asi que consumir el PRNG
   * de la simulacion aca haria que dos maquinas con la misma semilla vieran
   * disparar a invasores distintos segun una preferencia del sistema operativo.
   */
  noise: Float32Array;
  noiseCursor: number;

  flashMs: number;
  shakeMs: number;
  overMs: number;
  marchSfxMs: number;
  hitFlash: Float32Array;
  /** Disparos aceptados que todavia no sonaron. El audio se toca en el loop. */
  pendingShots: number;

  noticeText: string;
  noticeTone: number;
  noticeMs: number;

  /* Roster proyectado sobre asientos. */
  occupied: Uint8Array;
  humanSeat: Uint8Array;
  leftSeat: Uint8Array;
  seatName: string[];
  seatScoreText: string[];
  seatScoreValue: Int32Array;
  seatNotice: string[];
  seatNoticeMs: Float32Array;
  controlSignature: string[];
  /** Id del jugador de cada asiento, "" si lo ocupa un bot o esta libre. */
  seatPlayerId: string[];

  /* Haptica por asiento. El evento es de cada jugador, no de la sala: el que le
     acerto a un invasor vibra, los otros tres no. */
  hapticId: string[];
  hapticPattern: Array<number | readonly number[]>;
  hapticPending: Uint8Array;
  /** Cuantas veces cayo el cañon de cada asiento. Solo alimenta el id haptico. */
  seatDowns: Int32Array;
  humanCount: number;
  sawHuman: boolean;
  emptyS: number;

  /* Teclado local: es lo que permite probar la sala entera sin un celular. */
  keyboardSeat: number;
  kbHoldS: number;
  kbTarget: number;
  kbFireDown: boolean;

  /** Patch del HUD reutilizado: un literal nuevo por cuadro es basura por cuadro. */
  hudPatch: InvadersHud;
  /** Texto del cartel de oleada, recalculado solo cuando cambia la oleada. */
  waveText: string;
  waveTextFor: number;

  /* Colores y degrades precalculados. */
  seatColor: string[];
  seatSoft: string[];
  invaderColor: string[];
  shieldColor: string;
  bombColor: string;
  floorColor: string;
  flashColor: string;
  bannerBack: string;
  bannerText: string;
  bannerSub: string;
  livesColor: string;
  livesWarn: string;
  noticeFill: string[];
  bgGlow: CanvasGradient;
  vignette: CanvasGradient;
};

/* ------------------------------------------------------------------ */

export default function InvasoresGame({ config, net, signal, onFinish }: GameProps) {
  const options = useMemo(
    () => ({
      baseRows: Math.round(num(config.settings, "baseRows", 3)),
      baseCols: Math.round(num(config.settings, "baseCols", 8)),
      marchSpeed: num(config.settings, "marchSpeed", 95),
      accelFactor: num(config.settings, "accelFactor", 2.2),
      stepDown: num(config.settings, "stepDown", 22),
      hordeFireRate: num(config.settings, "hordeFireRate", 1.1),
      fireCooldown: num(config.settings, "fireCooldown", 0.32),
      bulletSpeed: num(config.settings, "bulletSpeed", 900),
      bombSpeed: num(config.settings, "bombSpeed", 340),
      cannonFollow: num(config.settings, "cannonFollow", 0.45),
      lives: Math.round(num(config.settings, "lives", 3)),
      regroupPause: num(config.settings, "regroupPause", 1.5),
      wavePause: num(config.settings, "wavePause", 3),
      waveSpeedGain: num(config.settings, "waveSpeedGain", 12) / 100,
      waveDrop: num(config.settings, "waveDrop", 24),
      pointsPerInvader: num(config.settings, "pointsPerInvader", 100),
      accuracyBonus: num(config.settings, "accuracyBonus", 500),
      pointsPerWave: num(config.settings, "pointsPerWave", 300),
      botSpeed: num(config.settings, "botSpeed", 620),
      botAim: num(config.settings, "botAim", 60),
      botDodge: bool(config.settings, "botDodge", true),
    }),
    [config.settings],
  );

  const emptyHud = useMemo<InvadersHud>(
    () => ({ lives: options.lives, wave: 1, left: 0, points: 0 }),
    [options.lives],
  );

  const sceneRef = useRef<Scene | null>(null);
  /** El roster por id: `onPlayerLeave` solo trae el id y hay que saber de quien era. */
  const rosterRef = useRef<Map<string, NetPlayer>>(new Map());

  /* El bot lee los administrables por referencia: el puerto de red se crea una
     sola vez y se queda con la politica que le dieron, asi que tocar una
     perilla no puede exigir reconectar a nadie. */
  const tuningRef = useRef({ speed: 620, aim: 60, dodge: true });
  tuningRef.current.speed = options.botSpeed;
  tuningRef.current.aim = options.botAim;
  tuningRef.current.dodge = options.botDodge;

  const botMemoryRef = useRef({
    position: new Float32Array(INVADERS_SEATS).fill(0.5),
    bias: new Float32Array(INVADERS_SEATS),
    wave: new Int32Array(INVADERS_SEATS).fill(-1),
    move: [
      { kind: "paddle", position: 0.5 },
      { kind: "paddle", position: 0.5 },
      { kind: "paddle", position: 0.5 },
      { kind: "paddle", position: 0.5 },
    ] as Extract<ControlInput, { kind: "paddle" }>[],
    // Constante y compartido: el disparo no lleva datos, asi que no se muta.
    fire: { kind: "press", buttonId: FIRE_BUTTON } as Extract<ControlInput, { kind: "press" }>,
  });

  /**
   * La politica del bot.
   *
   * Manda posicion y `press`, igual que una persona: no escribe estado ni
   * puntaje. Apunta al invasor vivo mas cercano con preferencia por los de
   * abajo (que son los que estan por invadir), se corre cuando ve una bomba
   * encima y tiene un error de punteria que se renueva en cada oleada — con un
   * error fijo se le aprende el desvio y deja de fallar.
   */
  const botPolicy = useMemo<BotPolicy<ControlInput>>(
    () => ({
      hz: BOT_HZ,
      policy: (bot) => {
        const memory = botMemoryRef.current;
        const seat = bot.seat >= 0 && bot.seat < INVADERS_SEATS ? bot.seat : 0;
        const move = memory.move[seat] ?? { kind: "paddle" as const, position: 0.5 };
        const scene = sceneRef.current;
        if (!scene) {
          move.position = 0.5;
          return move;
        }
        const game = scene.game;
        const rules = game.rules;

        if (memory.wave[seat] !== game.wavesCleared) {
          memory.wave[seat] = game.wavesCleared;
          memory.bias[seat] = (bot.rng.next() * 2 - 1) * (tuningRef.current.aim / rules.width);
        }

        const myX = game.cannonX[seat] ?? rules.width / 2;
        // Cada bot se queda en su franja de la horda. Sin esto los cuatro le
        // tiran al mismo invasor, se pisan los disparos y la sala pierde por
        // falta de reparto, que es justo lo que un compañero no deberia hacer.
        const laneCenter = laneCenterFor(game, seat);

        let targetX = myX;
        let targetY = 0;
        let best = Number.POSITIVE_INFINITY;
        for (let row = game.maxRow; row >= 0; row--) {
          for (let col = game.minCol; col <= game.maxCol; col++) {
            if (game.invaderAlive[row * game.cols + col] !== 1) continue;
            const ix = invaderX(game, col) + rules.invaderW / 2;
            // Los de abajo pesan menos: son los que estan por llegar al suelo.
            const score =
              Math.abs(ix - myX) +
              (game.maxRow - row) * rules.cellW * 0.35 +
              Math.abs(ix - laneCenter) * 0.7;
            if (score < best) {
              best = score;
              targetX = ix;
              targetY = row;
            }
          }
        }

        // Adelanta el tiro: sin esto el bot le apunta a donde el invasor ya no
        // esta, y con la horda acelerada no le pega nunca.
        const flightS =
          (rules.cannonY - (game.hordeY + targetY * rules.cellH)) / Math.max(1, rules.bulletSpeed);
        const aimX = targetX + game.hordeDir * game.hordeSpeed * flightS;
        let desired = aimX / rules.width + (memory.bias[seat] ?? 0);

        if (tuningRef.current.dodge) {
          for (let i = 0; i < MAX_BOMBS; i++) {
            if (game.bombAlive[i] !== 1) continue;
            const by = game.bombY[i] ?? 0;
            // Solo la bomba que ya esta encima: esquivar de lejos lo tiene todo
            // el tiempo corriendose y nunca dispara.
            if (by < rules.cannonY - 220) continue;
            const dx = (game.bombX[i] ?? 0) - myX;
            if (Math.abs(dx) > rules.cannonW * 0.9) continue;
            desired = (myX + (dx >= 0 ? -BOT_DODGE : BOT_DODGE)) / rules.width;
            break;
          }
        }

        // Velocidad limitada: un bot que teletransporta el cañon no falla nunca
        // y deja de ser un compañero para ser un piso de dificultad.
        const current = memory.position[seat] ?? 0.5;
        const maxStep = (tuningRef.current.speed / rules.width) * BOT_TICK_S;
        const next = clamp(current + clamp(desired - current, -maxStep, maxStep), 0, 1);
        memory.position[seat] = next;

        // El disparo es un evento: se manda en el tick en que decide tirar, y la
        // posicion de ese tick se corrige sola en el siguiente.
        const aimed = Math.abs(aimX - myX) < rules.invaderW * 0.8;
        if (aimed && (game.cannonCooldown[seat] ?? 0) <= 0 && best < Number.POSITIVE_INFINITY) {
          return memory.fire;
        }

        move.position = next;
        return move;
      },
    }),
    [],
  );

  const netHandle = useGameNet<ControlInput, never>({
    // La sala la elige el contenedor porque tiene que coincidir con el QR que
    // escanean los celulares. Si el juego inventara una, no se verian.
    roomId: config.roomId,
    role: "host",
    // -1 = proyector que no juega. Los cuatro asientos quedan para los celulares.
    seat: -1,
    seats: INVADERS_SEATS,
    name: "Proyector",
    bot: botPolicy,

    onInput: (playerId, input) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const player = rosterRef.current.get(playerId);
      if (!player) return;
      const seat = player.seat;
      // El teclado local tiene prioridad mientras se lo usa: si no, el bot del
      // mismo asiento le pelea el cañon a quien esta probando el juego.
      if (seat === scene.keyboardSeat && scene.kbHoldS > 0) return;

      if (input.kind === "paddle") {
        setCannonTarget(scene.game, seat, input.position);
      } else if (input.kind === "press" && input.buttonId === FIRE_BUTTON) {
        // Se acepta el evento, no un resultado: quien decide si sale el tiro es
        // la simulacion, con su cadencia y su limite de un proyectil en vuelo.
        if (fireCannon(scene.game, seat)) scene.pendingShots++;
      }
    },

    onPlayerJoin: (player) => {
      rosterRef.current.set(player.id, player);
      const scene = sceneRef.current;
      if (!scene) return;
      syncSeats(scene, rosterRef.current);
      if (!player.bot) {
        scene.leftSeat[player.seat] = 0;
        // Aparece en la oleada siguiente, no en la actual: reescalar la horda
        // en caliente es injusto en las dos direcciones.
        pushNotice(scene, `Cañón ${player.seat + 1} listo · entra en la próxima oleada`, 0);
      }
    },

    onPlayerLeave: (playerId) => {
      const player = rosterRef.current.get(playerId);
      rosterRef.current.delete(playerId);
      const scene = sceneRef.current;
      if (!scene) return;
      syncSeats(scene, rosterRef.current);
      if (!player || player.bot) return;
      // El bot entra solo desde `mockNet`: la partida no se cuelga porque
      // alguien cerro el celular, y la horda tampoco cambia.
      scene.leftSeat[player.seat] = 1;
      pushNotice(scene, `Cañón ${player.seat + 1} se fue · sigue un bot`, 1);
    },
  });

  /*
   * El telefono no sabe que juego es: hay que decirle que dibujar. Invasores
   * pide franja horizontal + boton de disparo, y arriba su puntaje.
   *
   * Va personalizado por jugador porque el puntaje es individual, y se manda
   * solo cuando algo cambio: repetir el mismo spec 60 veces por segundo seria
   * gastar el canal en pintar el mismo numero.
   */
  const netPort = netHandle.net;
  /** El escenario esta jugando de verdad. El mando no se habilita en la pausa. */
  const stagePlayingRef = useRef(false);
  /* Lo lee el loop para mandar la vibracion en el cuadro del impacto y no en el
     refresco siguiente: 400 ms tarde, un golpe en la mano ya no explica nada. */
  const senderRef = useRef<ControlSender | null>(null);
  senderRef.current = netPort;

  useEffect(() => {
    if (!netPort) return;
    const timer = window.setInterval(() => {
      const scene = sceneRef.current;
      if (!scene) return;
      pushControls(scene, netPort, stagePlayingRef.current);
    }, CONTROL_MS);
    return () => window.clearInterval(timer);
  }, [netPort]);

  const game = useGame2D<Scene, InvadersHud>(
    {
      design: { width: FIELD_W, height: FIELD_H },
      step: SIM_STEP,
      countdown: 3,
      // El HUD arranca con las vidas configuradas: mostrar 3 y corregir a 5 en el
      // primer cuadro se lee como un bug.
      hud: emptyHud,

      init: (ctx) => {
        const rules: InvadersRules = {
          width: FIELD_W,
          height: FIELD_H,
          floorY: CANNON_Y,

          baseRows: options.baseRows,
          baseCols: options.baseCols,
          cellW: CELL_W,
          cellH: CELL_H,
          invaderW: INVADER_W,
          invaderH: INVADER_H,
          hordeTopY: HORDE_TOP_Y,
          waveDropY: options.waveDrop,
          maxWaveDrops: MAX_WAVE_DROPS,

          marchSpeed: options.marchSpeed,
          accelFactor: options.accelFactor,
          stepDown: options.stepDown,
          waveSpeedGain: options.waveSpeedGain,
          playerSpeedGain: PLAYER_SPEED_GAIN,

          cannonW: CANNON_W,
          cannonH: CANNON_H,
          cannonY: CANNON_Y,
          cannonFollow: options.cannonFollow,
          fireCooldownS: options.fireCooldown,

          bulletSpeed: options.bulletSpeed,
          bulletW: BULLET_W,
          bulletH: BULLET_H,

          bombSpeed: options.bombSpeed,
          bombW: BOMB_W,
          bombH: BOMB_H,
          hordeFireRate: options.hordeFireRate,
          hordeFireWaveGain: HORDE_FIRE_WAVE_GAIN,

          lives: options.lives,
          regroupS: options.regroupPause,
          waveBannerS: options.wavePause,

          pointsPerInvader: options.pointsPerInvader,
          pointsPerWave: options.pointsPerWave,
          accuracyBonus: options.accuracyBonus,

          shieldTopY: SHIELD_TOP_Y,
          shieldCellW: SHIELD_CELL,
          shieldCellH: SHIELD_CELL,
        };

        const g = ctx.view.ctx;
        // Los degrades se crean una vez. Crearlos por cuadro es la forma mas
        // barata de perder los 60 fps del proyector.
        const bgGlow = g.createRadialGradient(
          FIELD_W / 2,
          FIELD_H * 0.25,
          0,
          FIELD_W / 2,
          FIELD_H * 0.25,
          FIELD_W * 0.7,
        );
        bgGlow.addColorStop(0, withAlpha(ctx.palette["--sn-violet-600"], 0.28));
        bgGlow.addColorStop(1, withAlpha(ctx.palette["--sn-violet-600"], 0));

        const vignette = g.createRadialGradient(
          FIELD_W / 2,
          FIELD_H / 2,
          FIELD_W * 0.34,
          FIELD_W / 2,
          FIELD_H / 2,
          FIELD_W * 0.8,
        );
        vignette.addColorStop(0, withAlpha(ctx.palette["--sn-bg"], 0));
        vignette.addColorStop(1, withAlpha(ctx.palette["--sn-bg"], 0.8));

        const noise = new Float32Array(NOISE_SIZE);
        for (let i = 0; i < NOISE_SIZE; i++) noise[i] = ctx.rng.range(-1, 1);

        // Los colores de asiento son los mismos que usa el mando y el QR: es lo
        // unico que le dice a alguien cual de los cuatro cañones es el suyo.
        const seatColor = [
          ctx.palette["--sn-cyan-400"],
          ctx.palette["--sn-magenta-400"],
          ctx.palette["--sn-violet-300"],
          ctx.palette["--sn-warn"],
        ];

        const scene: Scene = {
          game: createInvadersState(rules, countPlayers(rosterRef.current)),
          viewSeat: clamp(Math.round(config.seat), 0, INVADERS_SEATS - 1),

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
          overMs: 0,
          marchSfxMs: 0,
          hitFlash: new Float32Array(INVADERS_SEATS),
          pendingShots: 0,

          noticeText: "",
          noticeTone: 0,
          noticeMs: 0,

          occupied: new Uint8Array(INVADERS_SEATS),
          humanSeat: new Uint8Array(INVADERS_SEATS),
          leftSeat: new Uint8Array(INVADERS_SEATS),
          seatName: ["Cañón 1", "Cañón 2", "Cañón 3", "Cañón 4"],
          seatScoreText: ["0", "0", "0", "0"],
          seatScoreValue: new Int32Array(INVADERS_SEATS),
          seatNotice: ["", "", "", ""],
          seatNoticeMs: new Float32Array(INVADERS_SEATS),
          controlSignature: ["", "", "", ""],
          seatPlayerId: ["", "", "", ""],

          hapticId: ["", "", "", ""],
          hapticPattern: [HAPTIC_HIT, HAPTIC_HIT, HAPTIC_HIT, HAPTIC_HIT],
          hapticPending: new Uint8Array(INVADERS_SEATS),
          seatDowns: new Int32Array(INVADERS_SEATS),
          humanCount: 0,
          sawHuman: false,
          emptyS: 0,

          keyboardSeat: 0,
          kbHoldS: 0,
          kbTarget: 0.5,
          kbFireDown: false,

          hudPatch: { lives: options.lives, wave: 1, left: 0, points: 0 },
          waveText: "Oleada 1",
          waveTextFor: 0,

          seatColor,
          seatSoft: seatColor.map((color) => withAlpha(color, 0.22)),
          invaderColor: [
            ctx.palette["--sn-cyan-300"],
            ctx.palette["--sn-violet-300"],
            ctx.palette["--sn-magenta-300"],
          ],
          shieldColor: withAlpha(ctx.palette["--sn-success"], 0.85),
          bombColor: ctx.palette["--sn-danger"],
          floorColor: withAlpha(ctx.palette["--sn-danger"], 0.35),
          flashColor: ctx.palette["--sn-danger"],
          bannerBack: withAlpha(ctx.palette["--sn-bg"], 0.86),
          bannerText: ctx.palette["--sn-text"],
          bannerSub: ctx.palette["--sn-text-muted"],
          livesColor: ctx.palette["--sn-text"],
          livesWarn: ctx.palette["--sn-danger"],
          noticeFill: [ctx.palette["--sn-success"], ctx.palette["--sn-warn"]],
          bgGlow,
          vignette,
        };

        // El puerto de red ya existe cuando esto corre, y su bot y su `onInput`
        // buscan la escena aca.
        sceneRef.current = scene;
        syncSeats(scene, rosterRef.current);
        return scene;
      },

      update: (scene, dt, ctx) => {
        const state = scene.game;

        decayTimers(scene, dt);
        updateSparks(scene, dt);
        readKeyboard(scene, dt, ctx);

        if (scene.pendingShots > 0) {
          scene.pendingShots = 0;
          ctx.sfx.play("select");
        }

        if (state.over) {
          // Un momento para leer el resultado. Cortar en seco se siente como un
          // cuelgue, no como una partida terminada.
          scene.overMs += dt * 1000;
          if (scene.overMs >= (ctx.reducedMotion ? 0 : OVER_HOLD_MS)) ctx.finish(true);
          return;
        }

        // Se fueron todos: se espera y despues se termina con lo acumulado. La
        // partida nunca se queda colgada esperando a nadie.
        if (scene.sawHuman && scene.humanCount === 0) {
          scene.emptyS += dt;
          if (scene.emptyS >= ABANDON_S) {
            ctx.finish(false);
            return;
          }
        } else {
          scene.emptyS = 0;
        }

        const events = stepInvaders(state, dt, ctx.rng);
        if (events !== 0) {
          reactToEvents(scene, events, ctx);
          // La vibracion sale en el cuadro del impacto. Esperar al refresco de
          // 400 ms la convertiria en un golpe suelto sin causa visible.
          pushHaptics(scene, senderRef.current, stagePlayingRef.current);
        }

        for (let seat = 0; seat < INVADERS_SEATS; seat++) {
          const points = seatPoints(state, seat);
          if (scene.seatScoreValue[seat] === points) continue;
          scene.seatScoreValue[seat] = points;
          scene.seatScoreText[seat] = label(points);
        }
        if (scene.waveTextFor !== state.wavesCleared) {
          scene.waveTextFor = state.wavesCleared;
          scene.waveText = `Oleada ${state.wavesCleared + 1}`;
        }

        // El patch se reusa: `setHud` copia lo que recibe, asi que mutarlo es
        // seguro y ahorra un objeto por cuadro.
        scene.hudPatch.lives = state.lives;
        scene.hudPatch.wave = state.wavesCleared + 1;
        scene.hudPatch.left = state.aliveCount;
        scene.hudPatch.points = roomPoints(state);
        ctx.setHud(scene.hudPatch);
      },

      draw: (scene, g, ctx) => drawInvaders(scene, g, ctx),

      outcome: (scene, completed, survivedMs) => {
        const state = scene.game;
        const seat = scene.viewSeat;
        const kills = state.seatKills[seat] ?? 0;
        const hits = state.seatHits[seat] ?? 0;
        const shots = state.seatShots[seat] ?? 0;
        const accuracy = shots > 0 ? Math.round((hits / shots) * 100) : 0;

        return {
          // Perder la oleada es terminar la partida, no que se corte: lo unico
          // incompleto es el `force-end` y el abandono de la sala entera.
          completed: state.over ? true : completed,
          points: invadersPoints(kills, hits, shots, state.wavesCleared, state.rules),
          meta: {
            asiento: seat + 1,
            oleadasSuperadas: state.wavesCleared,
            invasoresPropios: kills,
            precision: accuracy + "%",
            vidasRestantes: state.lives,
            cañonesEnLaOleada: state.waveCannons,
            abandono: (scene.leftSeat[seat] ?? 0) === 1,
            puntajesPorAsiento: [
              seatPoints(state, 0),
              seatPoints(state, 1),
              seatPoints(state, 2),
              seatPoints(state, 3),
            ],
            puntajeDeLaSala: roomPoints(state),
            motivo:
              state.reason === "invaded"
                ? "invasión"
                : state.reason === "lives"
                  ? "sin vidas"
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

  // Lo lee el temporizador que arma el `ControlSpec`: mientras el proyector no
  // este jugando, el mando queda deshabilitado en vez de mover un cañon que no
  // se simula.
  stagePlayingRef.current = game.phase === "playing";

  // El contenedor pasa su transporte crudo, pero Invasores arma el suyo tipado
  // sobre la misma sala. Lo unico util de mirarlo es que las salas no coincidan:
  // seria la razon exacta por la que el celular no ve al proyector.
  const roomMismatch = net !== null && net.roomId !== config.roomId;
  const humans = countHumans(netHandle.players);

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
      instructions="Escaneá un QR para tomar un cañón con el celular: deslizá abajo para moverte y tocá el botón para disparar. Sin celular: ← → mueven y Espacio dispara. Los cañones libres los juega un bot. Las vidas son de todos."
      hud={
        <>
          <HudStat
            label="Vidas de la sala"
            value={game.hud.lives}
            dominant
            tone={game.hud.lives <= 1 ? "danger" : "default"}
          />
          <HudStat label="Oleada" value={game.hud.wave} tone="cyan" />
          <HudStat label="Invasores" value={game.hud.left} />
          <HudStat label="Puntos de la sala" value={game.hud.points} tone="magenta" />
          <HudStat label="Cañones" value={`${humans} de ${INVADERS_SEATS}`} />
          {game.timeLeftMs !== null && (
            <HudStat
              label="Tiempo"
              value={formatClock(game.timeLeftMs)}
              tone={game.timeLeftMs < 15_000 ? "danger" : "default"}
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
            {game.hud.wave > 1 ? `Frenaron ${game.hud.wave - 1} oleada${game.hud.wave > 2 ? "s" : ""}` : "Nos pasaron por arriba"}
          </h3>
          <p className="text-sm text-sn-muted">
            La sala juntó <span className="sn-num text-sn-magenta">{game.hud.points}</span> puntos.
          </p>
          <p className="mt-1 text-xs text-sn-dim">O la frenan entre todos, o no.</p>
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Roster y asientos                                                    */
/* ------------------------------------------------------------------ */

function countPlayers(roster: ReadonlyMap<string, NetPlayer>): number {
  let total = 0;
  for (const player of roster.values()) {
    if (player.seat >= 0 && player.seat < INVADERS_SEATS) total++;
  }
  return Math.max(1, total);
}

/**
 * Centro de la franja de horda que le toca cubrir a un asiento.
 *
 * Se reparte entre los cañones ACTIVOS y sobre el ancho vivo de la horda, no
 * sobre el campo: cuando quedan cuatro invasores en una punta, los bots se
 * juntan ahi en vez de seguir vigilando aire.
 */
function laneCenterFor(state: InvadersState, seat: number): number {
  let total = 0;
  let rank = 0;
  for (let s = 0; s < INVADERS_SEATS; s++) {
    if (state.cannonActive[s] !== 1) continue;
    if (s < seat) rank++;
    total++;
  }
  const left = invaderX(state, state.minCol);
  const right = invaderX(state, state.maxCol) + state.rules.invaderW;
  if (total <= 1) return (left + right) / 2;
  return left + (right - left) * ((rank + 0.5) / total);
}

/** Nadie jugo todavia: ni un tiro, ni una baja, ni una oleada. */
function isPristine(state: InvadersState): boolean {
  if (state.over || state.wavesCleared > 0) return false;
  if (state.aliveCount !== state.totalCount) return false;
  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    if ((state.seatShots[seat] ?? 0) > 0) return false;
  }
  return true;
}

function countHumans(players: readonly NetPlayer[]): number {
  let total = 0;
  for (const player of players) {
    if (!player.bot && player.connected) total++;
  }
  return total;
}

/**
 * Proyecta el roster sobre los cuatro cañones.
 *
 * Escribe `activeCannons`, que la simulacion **solo lee al empezar la oleada
 * siguiente**: entrar o irse a mitad no reescala la horda.
 */
function syncSeats(scene: Scene, roster: ReadonlyMap<string, NetPlayer>): void {
  scene.occupied.fill(0);
  scene.humanSeat.fill(0);
  for (let seat = 0; seat < INVADERS_SEATS; seat++) scene.seatPlayerId[seat] = "";
  let humans = 0;

  for (const player of roster.values()) {
    const seat = player.seat;
    if (seat < 0 || seat >= INVADERS_SEATS) continue;
    scene.occupied[seat] = 1;
    scene.seatName[seat] = player.bot ? `Bot ${seat + 1}` : player.name || `Cañón ${seat + 1}`;
    if (player.bot) continue;
    scene.humanSeat[seat] = 1;
    // Solo las personas tienen mando: a un bot no hay a quien mandarle un spec.
    scene.seatPlayerId[seat] = player.id;
    humans++;
  }

  let cannons = 0;
  for (let seat = 0; seat < INVADERS_SEATS; seat++) cannons += scene.occupied[seat] ?? 0;
  if (cannons === 0) {
    // El proyector solo, antes de que entre nadie: siempre hay un cañon o la
    // horda baja sobre un campo vacio mientras alguien escanea el QR.
    scene.occupied[0] = 1;
    scene.seatName[0] = "Cañón 1";
    cannons = 1;
  }

  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    setCannonActive(scene.game, seat, scene.occupied[seat] === 1);
  }
  const state = scene.game;
  state.activeCannons = cannons;

  // Reescalar en caliente esta prohibido, pero la oleada 1 se arma cuando monta
  // el componente y los celulares todavia estan escaneando el QR: si no se
  // redimensionara mientras NADIE jugo un solo tiro, la primera oleada seria
  // siempre la de un cañon aunque haya cuatro personas. La condicion es
  // estricta: horda intacta, sin disparos y sin oleadas superadas.
  if (state.waveCannons !== cannons && isPristine(state)) startWave(state);

  scene.humanCount = humans;
  if (humans > 0) scene.sawHuman = true;

  // El teclado maneja el primer cañon que hoy no tiene una persona: es lo que
  // permite probar la sala entera sin un celular a mano.
  scene.keyboardSeat = -1;
  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    if (scene.occupied[seat] === 1 && scene.humanSeat[seat] === 0) {
      scene.keyboardSeat = seat;
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* El mando                                                             */
/* ------------------------------------------------------------------ */

/** Lo unico que el juego necesita del puerto para hablarle a un mando. */
type ControlSender = { sendControl: (spec: ControlSpec, toPlayerId?: string) => void };

/**
 * Manda a cada mando lo que le cambio, y nada mas.
 *
 * Personalizado por jugador: el puntaje es individual y la vibracion tambien.
 * El que le acerto a un invasor vibra; los otros tres no.
 */
function pushControls(scene: Scene, sender: ControlSender, playing: boolean): void {
  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    const playerId = scene.seatPlayerId[seat];
    if (!playerId) continue;
    scene.hapticPending[seat] = 0;
    const spec = buildControlSpec(scene, seat, playing);
    const signature = specSignature(spec);
    if (scene.controlSignature[seat] === signature) continue;
    scene.controlSignature[seat] = signature;
    sender.sendControl(spec, playerId);
  }
}

/** Solo los asientos con una vibracion recien disparada. Corre dentro del loop. */
function pushHaptics(scene: Scene, sender: ControlSender | null, playing: boolean): void {
  if (!sender) return;
  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    if (scene.hapticPending[seat] !== 1) continue;
    scene.hapticPending[seat] = 0;
    const playerId = scene.seatPlayerId[seat];
    if (!playerId) continue;
    const spec = buildControlSpec(scene, seat, playing);
    scene.controlSignature[seat] = specSignature(spec);
    sender.sendControl(spec, playerId);
  }
}

function buildControlSpec(scene: Scene, seat: number, playing: boolean): ControlSpec {
  const state = scene.game;
  const notice = playing ? seatNotice(scene, seat) : "Esperando al proyector…";
  const hapticId = scene.hapticId[seat] ?? "";
  return {
    layout: "pad",
    // Posicion absoluta, igual que la paleta de Pong: un paquete perdido se
    // corrige solo en el siguiente.
    slider: { orientation: "horizontal", min: 0, max: 1 },
    // El disparo es un evento, no una posicion.
    buttons: [{ id: FIRE_BUTTON, label: "Disparar", group: "main", shape: "triangle" }],
    status: [
      { label: "Tu puntaje", value: scene.seatScoreText[seat] ?? "0" },
      {
        label: "Vidas de todos",
        value: label(state.lives),
        tone: state.lives <= 1 ? "danger" : "default",
      },
    ],
    enabled: playing && !state.over && state.phase === "marching",
    ...(notice ? { notice } : {}),
    // El telefono vibra una sola vez por `id`, asi que reenviar el mismo spec no
    // le hace temblar la mano a nadie.
    ...(hapticId
      ? { haptic: { id: hapticId, pattern: scene.hapticPattern[seat] ?? HAPTIC_HIT } }
      : {}),
  };
}

function seatNotice(scene: Scene, seat: number): string {
  const state = scene.game;
  if (state.over) return state.reason === "invaded" ? "Nos invadieron" : "Se acabaron las vidas";
  if (state.phase === "banner") return `Oleada ${state.wavesCleared + 1} en camino`;
  if ((scene.seatNoticeMs[seat] ?? 0) > 0) return scene.seatNotice[seat] ?? "";
  if (state.phase === "regroup") return "Nos alcanzaron · a reagruparse";
  return "";
}

/** Firma de lo que el mando ya tiene en pantalla: sin esto se reenvia lo mismo. */
function specSignature(spec: ControlSpec): string {
  if (spec.layout !== "pad") return spec.layout;
  const status = spec.status ?? [];
  let out = spec.enabled ? "1" : "0";
  out += "|" + (spec.notice ?? "");
  // El id haptico entra en la firma: un acierto que no cambia ningun numero de
  // la pantalla igual tiene que llegar.
  out += "|" + (spec.haptic?.id ?? "");
  for (const item of status) out += "|" + item.value + ":" + (item.tone ?? "");
  return out;
}

/* ------------------------------------------------------------------ */
/* Update: timers, teclado, particulas, feedback                        */
/* ------------------------------------------------------------------ */

function decayTimers(scene: Scene, dt: number): void {
  const ms = dt * 1000;
  if (scene.flashMs > 0) scene.flashMs -= ms;
  if (scene.shakeMs > 0) scene.shakeMs -= ms;
  if (scene.noticeMs > 0) scene.noticeMs -= ms;
  if (scene.marchSfxMs > 0) scene.marchSfxMs -= ms;
  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    const flash = scene.hitFlash[seat] ?? 0;
    if (flash > 0) scene.hitFlash[seat] = flash - ms;
    const notice = scene.seatNoticeMs[seat] ?? 0;
    if (notice > 0) scene.seatNoticeMs[seat] = notice - ms;
  }
}

/**
 * Teclado local, solo sobre el cañon que hoy juega un bot.
 *
 * Es lo que permite probar Invasores entero sin un celular. En cuanto una
 * persona toma ese asiento, manda el celular y el teclado deja de existir.
 */
function readKeyboard(scene: Scene, dt: number, ctx: FrameContext<InvadersHud>): void {
  const seat = scene.keyboardSeat;
  if (seat < 0) {
    scene.kbHoldS = 0;
    return;
  }

  const axis = ctx.input.axis.x;
  if (axis !== 0) {
    // Al tomar el control se arranca donde esta el cañon, no donde quedo la
    // ultima vez: si no, el cañon salta al apretar la primera tecla.
    if (scene.kbHoldS <= 0) scene.kbTarget = cannonPosition(scene.game, seat);
    scene.kbTarget = clamp(scene.kbTarget + axis * KEYBOARD_SPEED * dt, 0, 1);
    setCannonTarget(scene.game, seat, scene.kbTarget);
    scene.kbHoldS = KEYBOARD_HOLD_S;
  } else if (scene.kbHoldS > 0) {
    scene.kbHoldS = Math.max(0, scene.kbHoldS - dt);
  }

  // Flanco, no estado: mantener la barra no dispara en rafaga.
  const down = ctx.input.keys.has("Space");
  if (down && !scene.kbFireDown && fireCannon(scene.game, seat)) {
    scene.pendingShots++;
    scene.kbHoldS = KEYBOARD_HOLD_S;
  }
  scene.kbFireDown = down;
}

function reactToEvents(scene: Scene, events: number, ctx: FrameContext<InvadersHud>): void {
  const state = scene.game;

  if ((events & EVENT_KILL) !== 0) {
    for (let i = 0; i < state.killCount; i++) {
      const seat = state.killSeat[i] ?? 0;
      spawnSparks(scene, state.killX[i] ?? 0, state.killY[i] ?? 0, seat, ctx.reducedMotion ? 0 : SPARKS_PER_KILL);
      // Vibracion corta, y solo para el que acerto: el id lleva la cuenta de
      // aciertos de ese asiento, asi que cambia exactamente una vez por impacto.
      armHaptic(scene, seat, "hit-" + (state.seatHits[seat] ?? 0), HAPTIC_HIT);
    }
    ctx.sfx.play("hit");
    // El proyector tambien vibra si corre en una tablet. En un monitor es no-op.
    vibrate(HAPTIC_HIT);
  }

  if ((events & EVENT_SHIELD) !== 0) {
    for (let i = 0; i < state.shieldHitCount; i++) {
      spawnSparks(
        scene,
        state.shieldHitX[i] ?? 0,
        state.shieldHitY[i] ?? 0,
        0,
        ctx.reducedMotion ? 0 : SPARKS_PER_SHIELD,
      );
    }
  }

  if ((events & EVENT_MARCH) !== 0 && scene.marchSfxMs <= 0) {
    scene.marchSfxMs = MARCH_SFX_MS;
    ctx.sfx.play("tick");
  }

  if ((events & EVENT_CANNON_HIT) !== 0) {
    const seat = state.hitSeat >= 0 ? state.hitSeat : 0;
    scene.hitFlash[seat] = 900;
    scene.seatNotice[seat] = "Te alcanzaron";
    scene.seatNoticeMs[seat] = 2000;
    if (!ctx.reducedMotion) {
      scene.flashMs = FLASH_MS;
      scene.shakeMs = SHAKE_MS;
      spawnSparks(scene, state.cannonX[seat] ?? 0, state.rules.cannonY, seat, SPARKS_PER_KILL * 2);
    }
    pushNotice(scene, `Cañón ${seat + 1} alcanzado · quedan ${state.lives} vidas`, 1);
    ctx.sfx.play("lose");
    // Vibracion larga, y solo para el que cayo. Pisa a la corta del mismo
    // cuadro a proposito: que te volteen es lo que hay que sentir.
    scene.seatDowns[seat] = (scene.seatDowns[seat] ?? 0) + 1;
    armHaptic(scene, seat, "down-" + (scene.seatDowns[seat] ?? 0), HAPTIC_DOWN);
    vibrate(HAPTIC_DOWN);
  }

  if ((events & EVENT_WAVE_CLEARED) !== 0) {
    pushNotice(scene, `¡Oleada ${state.wavesCleared} superada!`, 0);
    ctx.sfx.play("win");
  }

  if ((events & EVENT_OVER) !== 0) {
    ctx.sfx.play("lose");
    vibrate([60, 80, 60]);
  }
}

/** Deja lista la vibracion de un asiento. La manda el loop, no el temporizador. */
function armHaptic(scene: Scene, seat: number, id: string, pattern: number | readonly number[]): void {
  if (seat < 0 || seat >= INVADERS_SEATS) return;
  scene.hapticId[seat] = id;
  scene.hapticPattern[seat] = pattern;
  scene.hapticPending[seat] = 1;
}

function pushNotice(scene: Scene, text: string, tone: number): void {
  scene.noticeText = text;
  scene.noticeTone = tone;
  scene.noticeMs = NOTICE_MS;
}

/** Valor de ruido pregenerado, en -1..1. Ver el comentario de `Scene.noise`. */
function nextNoise(scene: Scene): number {
  scene.noiseCursor = (scene.noiseCursor + 1) & (NOISE_SIZE - 1);
  return scene.noise[scene.noiseCursor] ?? 0;
}

function spawnSparks(scene: Scene, x: number, y: number, seat: number, count: number): void {
  for (let i = 0; i < count; i++) {
    scene.sparkHead = (scene.sparkHead + 1) % MAX_SPARKS;
    const slot = scene.sparkHead;
    const angle = nextNoise(scene) * Math.PI;
    const speed = 90 + (nextNoise(scene) * 0.5 + 0.5) * 250;
    scene.sparkX[slot] = x;
    scene.sparkY[slot] = y;
    scene.sparkVx[slot] = Math.cos(angle) * speed;
    scene.sparkVy[slot] = Math.sin(angle) * speed;
    const life = 0.25 + (nextNoise(scene) * 0.5 + 0.5) * 0.35;
    scene.sparkLife[slot] = life;
    scene.sparkMax[slot] = life;
    scene.sparkSeat[slot] = seat;
  }
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
    scene.sparkVy[i] = (scene.sparkVy[i] ?? 0) + SPARK_GRAVITY * dt;
    scene.sparkX[i] = (scene.sparkX[i] ?? 0) + (scene.sparkVx[i] ?? 0) * dt;
    scene.sparkY[i] = (scene.sparkY[i] ?? 0) + (scene.sparkVy[i] ?? 0) * dt;
  }
}

/* ------------------------------------------------------------------ */
/* Draw                                                                 */
/* ------------------------------------------------------------------ */

function drawInvaders(scene: Scene, g: CanvasRenderingContext2D, ctx: DrawContext): void {
  const state = scene.game;
  const reduced = ctx.reducedMotion;

  g.save();
  if (!reduced && scene.shakeMs > 0) {
    const decay = scene.shakeMs / SHAKE_MS;
    const tick = (ctx.elapsedMs * 0.07) | 0;
    g.translate(
      (scene.noise[tick & (NOISE_SIZE - 1)] ?? 0) * SHAKE_PX * decay,
      (scene.noise[(tick + 11) & (NOISE_SIZE - 1)] ?? 0) * SHAKE_PX * decay,
    );
  }

  // Sobredibujo: con la sacudida activa, pintar solo el campo dejaria una franja
  // vacia en el borde.
  g.fillStyle = ctx.palette["--sn-bg"];
  g.fillRect(-SHAKE_PX * 2, -SHAKE_PX * 2, FIELD_W + SHAKE_PX * 4, FIELD_H + SHAKE_PX * 4);
  g.fillStyle = scene.bgGlow;
  g.fillRect(0, 0, FIELD_W, FIELD_H);

  drawFloor(scene, g, state);
  drawShields(scene, g, state);
  drawHorde(scene, g, state, ctx);
  drawProjectiles(scene, g, state, ctx);
  drawCannons(scene, g, state, reduced);
  drawSparks(scene, g);
  drawLives(scene, g, state);

  if (state.phase === "banner") drawWaveBanner(scene, g, state);
  else if (state.phase === "regroup") drawRegroup(scene, g);
  if (scene.noticeMs > 0) drawNotice(scene, g);

  if (scene.flashMs > 0 && !reduced) {
    g.globalAlpha = (scene.flashMs / FLASH_MS) * 0.4;
    g.fillStyle = scene.flashColor;
    g.fillRect(0, 0, FIELD_W, FIELD_H);
    g.globalAlpha = 1;
  }

  g.fillStyle = scene.vignette;
  g.fillRect(0, 0, FIELD_W, FIELD_H);
  g.restore();
}

function drawFloor(scene: Scene, g: CanvasRenderingContext2D, state: InvadersState): void {
  g.fillStyle = scene.floorColor;
  g.fillRect(0, state.rules.floorY - 3, FIELD_W, 3);
}

/**
 * Escudos por corridas de celdas encendidas, no celda por celda: 4 x 200
 * `fillRect` por cuadro son 48 000 llamadas por segundo para dibujar cuatro
 * bloques.
 */
function drawShields(scene: Scene, g: CanvasRenderingContext2D, state: InvadersState): void {
  const rules = state.rules;
  const cw = rules.shieldCellW;
  const ch = rules.shieldCellH;
  g.fillStyle = scene.shieldColor;

  for (let s = 0; s < SHIELD_COUNT; s++) {
    const sx = state.shieldX[s] ?? 0;
    const sy = state.shieldY[s] ?? 0;
    const base = s * SHIELD_CELLS;
    for (let row = 0; row < SHIELD_ROWS; row++) {
      let runStart = -1;
      for (let col = 0; col <= SHIELD_COLS; col++) {
        const filled = col < SHIELD_COLS && state.shieldCell[base + row * SHIELD_COLS + col] === 1;
        if (filled) {
          if (runStart < 0) runStart = col;
        } else if (runStart >= 0) {
          g.fillRect(sx + runStart * cw, sy + row * ch, (col - runStart) * cw, ch);
          runStart = -1;
        }
      }
    }
  }
}

/**
 * La horda, agrupada por tipo para cambiar `fillStyle` tres veces y no 55.
 *
 * Los dos fotogramas alternados al ritmo del movimiento son el paso
 * caracteristico del original, y se conservan con `prefers-reduced-motion`:
 * son informacion (la horda acelera), no decoracion.
 */
function drawHorde(
  scene: Scene,
  g: CanvasRenderingContext2D,
  state: InvadersState,
  ctx: DrawContext,
): void {
  if (state.aliveCount === 0) return;
  const rules = state.rules;
  // Interpolacion del avance: en un proyector a 120 Hz sin esto la horda va a
  // saltos de un paso de simulacion.
  const drift = state.phase === "marching" ? state.hordeDir * state.hordeSpeed * SIM_STEP * ctx.alpha : 0;
  const originX = state.hordeX + drift;
  const frame = state.animFrame;

  for (let type = 0; type < INVADER_TYPES; type++) {
    g.fillStyle = scene.invaderColor[type] ?? scene.invaderColor[0] ?? "#fff";
    for (let row = 0; row < state.rows; row++) {
      const y = state.hordeY + row * rules.cellH;
      for (let col = 0; col < state.cols; col++) {
        const index = row * state.cols + col;
        if (state.invaderAlive[index] !== 1) continue;
        if (state.invaderType[index] !== type) continue;
        drawInvader(g, originX + col * rules.cellW, y, rules.invaderW, rules.invaderH, type, frame);
      }
    }
  }
}

/** Tres formas geometricas simples, dos fotogramas cada una. Solo `fillRect`. */
function drawInvader(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  type: number,
  frame: number,
): void {
  const u = w / 8;
  const v = h / 6;

  if (type === 0) {
    g.fillRect(x + 3 * u, y, 2 * u, v);
    g.fillRect(x + 2 * u, y + v, 4 * u, v);
    g.fillRect(x + u, y + 2 * v, 6 * u, 2 * v);
    if (frame === 0) {
      g.fillRect(x, y + 4 * v, u, 2 * v);
      g.fillRect(x + 7 * u, y + 4 * v, u, 2 * v);
    } else {
      g.fillRect(x + u, y + 4 * v, u, 2 * v);
      g.fillRect(x + 6 * u, y + 4 * v, u, 2 * v);
    }
    return;
  }

  if (type === 1) {
    g.fillRect(x + 2 * u, y, 4 * u, v);
    g.fillRect(x + u, y + v, 6 * u, 3 * v);
    if (frame === 0) {
      g.fillRect(x, y + v, u, 2 * v);
      g.fillRect(x + 7 * u, y + v, u, 2 * v);
      g.fillRect(x + 2 * u, y + 4 * v, u, 2 * v);
      g.fillRect(x + 5 * u, y + 4 * v, u, 2 * v);
    } else {
      g.fillRect(x, y + 2 * v, u, 2 * v);
      g.fillRect(x + 7 * u, y + 2 * v, u, 2 * v);
      g.fillRect(x + u, y + 4 * v, u, 2 * v);
      g.fillRect(x + 6 * u, y + 4 * v, u, 2 * v);
    }
    return;
  }

  g.fillRect(x + u, y, 6 * u, 2 * v);
  g.fillRect(x, y + 2 * v, 8 * u, 2 * v);
  if (frame === 0) {
    g.fillRect(x + u, y + 4 * v, 2 * u, 2 * v);
    g.fillRect(x + 5 * u, y + 4 * v, 2 * u, 2 * v);
  } else {
    g.fillRect(x, y + 4 * v, 2 * u, v);
    g.fillRect(x + 6 * u, y + 4 * v, 2 * u, v);
    g.fillRect(x + 3 * u, y + 4 * v, 2 * u, 2 * v);
  }
}

function drawProjectiles(
  scene: Scene,
  g: CanvasRenderingContext2D,
  state: InvadersState,
  ctx: DrawContext,
): void {
  const rules = state.rules;
  const lead = state.phase === "marching" ? SIM_STEP * ctx.alpha : 0;

  for (let i = 0; i < MAX_BULLETS; i++) {
    if (state.bulletAlive[i] !== 1) continue;
    const seat = state.bulletSeat[i] ?? 0;
    g.fillStyle = scene.seatColor[seat] ?? scene.seatColor[0] ?? "#fff";
    g.fillRect(
      state.bulletX[i] ?? 0,
      (state.bulletY[i] ?? 0) - rules.bulletSpeed * lead,
      rules.bulletW,
      rules.bulletH,
    );
  }

  g.fillStyle = scene.bombColor;
  for (let i = 0; i < MAX_BOMBS; i++) {
    if (state.bombAlive[i] !== 1) continue;
    const x = state.bombX[i] ?? 0;
    const y = (state.bombY[i] ?? 0) + rules.bombSpeed * lead;
    // Zigzag: tres trozos alternados. Se lee como "esto cae", no como "esto sube".
    const third = rules.bombH / 3;
    g.fillRect(x, y, rules.bombW, third);
    g.fillRect(x + rules.bombW * 0.4, y + third, rules.bombW, third);
    g.fillRect(x, y + third * 2, rules.bombW, third);
  }
}

function drawCannons(
  scene: Scene,
  g: CanvasRenderingContext2D,
  state: InvadersState,
  reduced: boolean,
): void {
  const rules = state.rules;
  g.font = FONT_SEAT;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";

  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    if (state.cannonActive[seat] !== 1) continue;
    const cx = state.cannonX[seat] ?? 0;
    const left = cx - rules.cannonW / 2;
    const color = scene.seatColor[seat] ?? scene.seatColor[0] ?? "#fff";

    const flash = scene.hitFlash[seat] ?? 0;
    // Parpadeo tras el impacto: con reduced motion se saca el parpadeo, no el
    // cañon. La regla del juego no cambia.
    if (!reduced && flash > 0 && (((flash / 90) | 0) & 1) === 0) continue;

    g.fillStyle = scene.seatSoft[seat] ?? "rgba(255,255,255,0.2)";
    g.fillRect(left - 6, rules.cannonY - 6, rules.cannonW + 12, rules.cannonH + 12);

    g.fillStyle = color;
    g.fillRect(left, rules.cannonY + rules.cannonH * 0.45, rules.cannonW, rules.cannonH * 0.55);
    g.fillRect(left + rules.cannonW * 0.2, rules.cannonY + rules.cannonH * 0.2, rules.cannonW * 0.6, rules.cannonH * 0.3);
    g.fillRect(cx - 5, rules.cannonY, 10, rules.cannonH * 0.3);

    g.fillText(scene.seatName[seat] ?? "", cx, rules.cannonY - 16);
  }
}

function drawSparks(scene: Scene, g: CanvasRenderingContext2D): void {
  for (let i = 0; i < MAX_SPARKS; i++) {
    const life = scene.sparkLife[i] ?? 0;
    if (life <= 0) continue;
    const max = scene.sparkMax[i] || 1;
    const seat = scene.sparkSeat[i] ?? 0;
    g.globalAlpha = Math.min(1, life / max);
    g.fillStyle = scene.seatColor[seat] ?? scene.seatColor[0] ?? "#fff";
    g.fillRect((scene.sparkX[i] ?? 0) - 2, (scene.sparkY[i] ?? 0) - 2, 5, 5);
  }
  g.globalAlpha = 1;
}

/** Vidas compartidas, arriba al centro y grandes. Es el numero que importa. */
function drawLives(scene: Scene, g: CanvasRenderingContext2D, state: InvadersState): void {
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = FONT_LIVES;
  g.fillStyle = state.lives <= 1 ? scene.livesWarn : scene.livesColor;
  g.fillText(label(state.lives), FIELD_W / 2, 92);

  g.font = FONT_LIVES_LABEL;
  g.fillStyle = scene.bannerSub;
  g.fillText("VIDAS DE TODOS", FIELD_W / 2, 118);
}

function drawWaveBanner(scene: Scene, g: CanvasRenderingContext2D, state: InvadersState): void {
  g.fillStyle = scene.bannerBack;
  g.fillRect(0, FIELD_H * 0.3, FIELD_W, FIELD_H * 0.4);

  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = FONT_BANNER;
  g.fillStyle = scene.bannerText;
  g.fillText(scene.waveText, FIELD_W / 2, FIELD_H * 0.42);

  g.font = FONT_BANNER_SUB;
  const step = FIELD_W / (INVADERS_SEATS + 1);
  for (let seat = 0; seat < INVADERS_SEATS; seat++) {
    if (state.cannonActive[seat] !== 1) continue;
    g.fillStyle = scene.seatColor[seat] ?? scene.bannerText;
    g.fillText(scene.seatScoreText[seat] ?? "0", step * (seat + 1), FIELD_H * 0.58);
    g.fillStyle = scene.bannerSub;
    g.fillText(scene.seatName[seat] ?? "", step * (seat + 1), FIELD_H * 0.64);
  }
  g.textBaseline = "alphabetic";
}

function drawRegroup(scene: Scene, g: CanvasRenderingContext2D): void {
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = FONT_BANNER_SUB;
  g.fillStyle = scene.bannerSub;
  g.fillText("A reagruparse", FIELD_W / 2, FIELD_H * 0.62);
  g.textBaseline = "alphabetic";
}

function drawNotice(scene: Scene, g: CanvasRenderingContext2D): void {
  const alpha = Math.min(1, scene.noticeMs / 500);
  g.globalAlpha = alpha;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = FONT_NOTICE;
  g.fillStyle = scene.noticeFill[scene.noticeTone] ?? scene.bannerText;
  g.fillText(scene.noticeText, FIELD_W / 2, 180);
  g.globalAlpha = 1;
}
