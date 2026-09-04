import { getStroke } from "perfect-freehand";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ControlInput, ControlSpec, StrokePoint } from "@/core/contract/control";
import { SKETCH_ASPECT } from "@/core/contract/control";
import type { GameProps } from "@/core/contract/game";
import { useDeadline } from "@/core/corporate/hooks";
import { LiveRankingTable } from "@/core/corporate/LiveStage";
import {
  addParticipant,
  advanceLiveRound,
  answerProgress,
  awardPoints,
  closeWindowNow,
  createLiveRound,
  liveRanking,
  submitAnswer,
  DEFAULT_RANKING_MS,
  type LiveRankEntry,
  type LiveRoundPhase,
  type LiveRoundState,
} from "@/core/corporate/liveRound";
import type { TextQuestion } from "@/core/corporate/question.types";
import { readPalette } from "@/core/engine/palette";
import { createRng } from "@/core/engine/rng";
import type { BotPolicy } from "@/core/net/mockNet";
import { useGameNet } from "@/core/net/useGameNet";
import {
  appendStroke,
  applyCanvasAction,
  buildChoiceDeck,
  defaultPool,
  drawerPoints,
  guessNotice,
  hintFor,
  isKnownInk,
  judgeGuess,
  nextDrawer,
  participantKey,
  pinturilloMeta,
  pinturilloPoints,
  readPinturilloSetup,
  resolveInk,
  revealCount,
  revealOrder,
  roundSummary,
  strokePointCount,
  BOARD_COLOR,
  INK_CSS,
  INK_WIDTHS,
  MAX_STROKES,
  MIN_PLAYERS,
  PINTURILLO_SEATS,
  type Stroke,
} from "./logic";
import type { WordSeed } from "./words";

/**
 * X1 - Pinturillo.
 *
 * Uno dibuja en su celular, se ve en la pantalla grande, el resto adivina.
 *
 * La maquina de fases NO se escribe aca: es `core/corporate/liveRound.ts`, la
 * misma que usan Trivia y Verdadero o falso. No es forzado, es el mismo patron
 * de fases cronometradas por el host, con otros nombres arriba:
 *
 *   anuncio  -> "Le toca a Ana"
 *   lectura  -> la eleccion de palabra (10 s)
 *   respuesta-> el dibujo (75 s)
 *   cierre   -> la palabra, quien acerto y los puntos (8 s)
 *
 * Y eso trae gratis lo que importa: el reloj lo mide el host contra
 * `clockMs`, el celular manda texto y puntos y nunca un tiempo ni un puntaje,
 * la ventana cierra en el proyector y el ranking es determinista.
 *
 * Las tres decisiones propias de X1, y las tres son de riesgo:
 *
 * 1. **El host puede borrar el lienzo y saltear la ronda en un toque.** Es un
 *    evento de empresa con una pantalla de tres metros: alguien va a dibujar
 *    algo que no corresponde. No es remoto, es lo que pasa.
 * 2. **Los intentos se filtran con `isBlockedText`** antes de tocar nada. Un
 *    intento vetado no se proyecta y no se evalua.
 * 3. **Los intentos fallidos NO se proyectan por defecto.** Se ve "Ana esta
 *    escribiendo" y los aciertos. El chat completo existe, pero se enciende a
 *    mano en los administrables.
 *
 * Y una de rendimiento, que es donde este juego se cae si se hace mal:
 * **solo se redibuja el trazo en curso.** Los trazos cerrados se pintan UNA
 * vez en un canvas de cache que queda debajo; redibujar 120 trazos por cuadro
 * no llega a 60 fps en ningun proyector.
 */

/* ------------------------------------------------------------------ */
/* Ritmo interno                                                        */
/* ------------------------------------------------------------------ */

/** Deuda maxima por cuadro. Una pestana que vuelve no corre rondas que nadie vio. */
const MAX_FRAME_MS = 250;

/** 25 Hz: la barra de tiempo se lee continua y React no re-renderiza a 60. */
const PUBLISH_MS = 40;

/** Cada cuanto se revisa si algun telefono necesita una pantalla nueva. */
const CONTROL_TICK_MS = 120;

/**
 * El `remainingMs` del que dibuja se refresca en pasos de medio segundo.
 *
 * Los que adivinan NO reciben `remainingMs`: su reloj es la barra del
 * proyector. Sin eso serian 20 mensajes por segundo para dibujar 20 barritas
 * que ya estan en la pantalla grande, y el presupuesto de red se va entero en
 * eso en vez de en el dibujo.
 */
const DRAW_CLOCK_STEP_MS = 500;

/** Cuanto queda en pantalla un aviso personal -"Casi!"- antes de limpiarse. */
const NOTICE_MS = 3500;

/** "Ana esta escribiendo" se apaga sola si deja de llegar el aviso. */
const TYPING_MS = 2200;

/** Gracia antes de cortar cuando ya acertaron todos. Cortar en el mismo cuadro se siente cuelgue. */
const EARLY_CLOSE_MS = 900;

/**
 * Cuando un trazo en curso pasa este largo se cierra y se abre otro pegado.
 *
 * `getStroke` recalcula el contorno entero en cada cuadro, y un garabato de
 * 75 segundos sin levantar el dedo son miles de puntos: partirlo manda al
 * canvas de cache lo que ya no cambia y deja el trabajo por cuadro acotado.
 */
const LIVE_SPLIT_POINTS = 220;

/** Lo que `perfect-freehand` necesita para que un trazo parezca trazo. */
const STROKE_OPTIONS = { thinning: 0.55, smoothing: 0.55, streamline: 0.35 } as const;

type Stage = "lobby" | "playing" | "done";

type RailRow = {
  participantId: string;
  name: string;
  points: number;
  position: number;
  correct: boolean;
  drawing: boolean;
  typing: boolean;
};

type FeedLine = { id: number; name: string; text: string };

type View = {
  phase: LiveRoundPhase;
  itemIndex: number;
  totalRounds: number;
  /** 0..1 de la fase en curso, para la barra. */
  progress: number;
  remainingMs: number;
  drawerName: string;
  hint: string;
  /** La palabra, solo en el cierre. */
  word: string;
  guessed: number;
  guessers: number;
  rows: readonly RailRow[];
  ranking: readonly LiveRankEntry[];
  winners: readonly string[];
  cancelled: boolean;
  cancelReason: string;
  feed: readonly FeedLine[];
  strokes: number;
  points: number;
};

const EMPTY_VIEW: View = {
  phase: "anuncio",
  itemIndex: 0,
  totalRounds: 0,
  progress: 0,
  remainingMs: 0,
  drawerName: "",
  hint: "",
  word: "",
  guessed: 0,
  guessers: 0,
  rows: [],
  ranking: [],
  winners: [],
  cancelled: false,
  cancelReason: "",
  feed: [],
  strokes: 0,
  points: 0,
};

type Drawer = { participantId: string; name: string };

type ActiveWord = { text: string; order: readonly number[] };

export default function PinturilloGame({ config, signal, onFinish }: GameProps) {
  const setup = useMemo(() => readPinturilloSetup(config.settings), [config.settings]);

  /* El mazo de elecciones se arma entero con la semilla: una partida es
     reproducible y ninguna palabra se repite mientras quede alguna sin usar. */
  const deck = useMemo(() => {
    const pool = setup.pool.length > 0 ? setup.pool : defaultPool();
    return buildChoiceDeck(pool, setup.rounds, createRng(config.seed));
  }, [config.seed, setup.pool, setup.rounds]);

  /* Un item por turno. `liveRound` corrige contra `correct`, y la palabra se
     conoce recien cuando la persona la elige: por eso el item se completa en
     caliente, al abrir la ventana de dibujo. */
  const questions = useMemo<TextQuestion[]>(
    () =>
      deck.map((_, index) => ({
        id: `ronda-${index}`,
        kind: "text",
        prompt: "",
        correct: null,
      })),
    [deck],
  );

  const totalRounds = questions.length;

  const [stage, setStage] = useState<Stage>("lobby");
  const [view, setView] = useState<View>(EMPTY_VIEW);

  /* La ronda avanza con `dt` y vive en un ref, igual que la simulacion de
     cualquier juego. React recibe solo la foto que hay que dibujar. */
  const roundRef = useRef<LiveRoundState | null>(null);
  if (roundRef.current === null) {
    roundRef.current = createLiveRound({
      config: setup.round,
      questions,
      scorer: setup.scorer,
    });
  }

  const stageRef = useRef<Stage>("lobby");
  const startedAtRef = useRef(performance.now());
  const finishedRef = useRef(false);
  const roundsPlayedRef = useRef(0);
  const cancelledCountRef = useRef(0);

  /* ---- Turno y palabra ---- */
  const drawerRef = useRef<Drawer | null>(null);
  const drawnRef = useRef<readonly string[]>([]);
  const choicesRef = useRef<readonly WordSeed[]>([]);
  const pickedRef = useRef<string | null>(null);
  const wordRef = useRef<ActiveWord | null>(null);
  const revealRef = useRef(0);
  const cancelledRef = useRef(false);
  const cancelReasonRef = useRef("");
  const correctOrderRef = useRef<readonly string[]>([]);

  /* ---- Lienzo ---- */
  const strokesRef = useRef<readonly Stroke[]>([]);
  const liveStrokeRef = useRef<Stroke | null>(null);
  const strokeIdRef = useRef(0);
  /** Hay que repintar el canvas de cache entero. Solo por evento, nunca por cuadro. */
  const boardDirtyRef = useRef(true);
  /** Cambio el trazo en curso. Es lo unico que se repinta cuadro a cuadro. */
  const liveDirtyRef = useRef(true);
  /** Hasta cuando el que dibuja ve "el host borro el lienzo". */
  const panicAtRef = useRef(0);

  const boardBoxRef = useRef<HTMLDivElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<Record<string, string>>({});

  /* ---- Gente ---- */
  const seatByPlayerRef = useRef<Map<string, { seat: number; bot: boolean }>>(new Map());
  const playerByParticipantRef = useRef<Map<string, { playerId: string; bot: boolean }>>(new Map());
  const typingRef = useRef<Map<string, number>>(new Map());
  const noticeRef = useRef<Map<string, { text: string; until: number; seq: number }>>(new Map());
  const noticeSeqRef = useRef(0);
  const feedRef = useRef<readonly FeedLine[]>([]);
  const feedIdRef = useRef(0);

  /* ---- Publicacion ---- */
  const sentKeysRef = useRef<Map<string, string>>(new Map());
  const lastPublishRef = useRef(0);
  const lastControlAtRef = useRef(0);
  const allInMsRef = useRef(0);

  /* ---------------------------------------------------------------- */
  /* Lienzo: cache + trazo en curso                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Pinta UN trazo.
   *
   * `perfect-freehand` convierte la secuencia de puntos en un contorno relleno
   * en vez de una polilinea: es la diferencia entre un trazo que parece
   * dibujado y uno que parece un grafico.
   *
   * `live` deja el trazo abierto mientras el dedo sigue apoyado; al cerrarlo,
   * `last` redondea la punta.
   */
  const paintStroke = useCallback(
    (ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, live: boolean) => {
      if (stroke.points.length === 0) return;
      // Los puntos vienen normalizados 0..1, asi que el dibujo escala solo a
      // cualquier resolucion. El grosor va contra el ancho, la misma
      // referencia que usa el celular para pintar su vista previa: con el
      // lienzo ya encuadrado en la proporcion del contrato, medir contra el
      // lado corto daria un trazo mas fino de un lado que del otro.
      const scale = width / 1000;
      const hasPressure = stroke.points[0]?.p !== undefined;
      const input = stroke.points.map((point) => [point.x * width, point.y * height, point.p ?? 0.5]);

      const outline = getStroke(input, {
        ...STROKE_OPTIONS,
        size: Math.max(1, stroke.width * scale),
        simulatePressure: !hasPressure,
        last: !live,
      });
      if (outline.length === 0) return;

      // El borrador pinta del color del lienzo en vez de recortar: el canvas
      // de cache es opaco, asi que un `destination-out` abriria un agujero al
      // fondo de la pagina en lugar de borrar.
      ctx.fillStyle = stroke.eraser ? BOARD_COLOR : resolveInk(stroke.color, paletteRef.current);
      ctx.fill(outlinePath(outline));
    },
    [],
  );

  /**
   * Reconstruye el dibujo entero desde la lista de trazos.
   *
   * Es lo que hace que quien entra tarde vea el dibujo ya hecho y no un lienzo
   * vacio: la verdad del lienzo es la lista de puntos, no un bitmap. Corre por
   * evento -alguien entra, deshacer, borrar, ronda nueva, cambio de tamano- y
   * NUNCA por cuadro.
   */
  const rebuildBoard = useCallback(() => {
    const canvas = baseCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = BOARD_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokesRef.current) {
      paintStroke(ctx, stroke, canvas.width, canvas.height, false);
    }
  }, [paintStroke]);

  /** Cierra el trazo en curso y lo manda al cache: se pinta una sola vez. */
  const commitStroke = useCallback(
    (stroke: Stroke) => {
      const before = strokesRef.current.length;
      strokesRef.current = appendStroke(strokesRef.current, stroke, MAX_STROKES);
      if (strokesRef.current.length === before) return;
      const canvas = baseCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) paintStroke(ctx, stroke, canvas.width, canvas.height, false);
    },
    [paintStroke],
  );

  const clearBoard = useCallback(() => {
    strokesRef.current = [];
    liveStrokeRef.current = null;
    boardDirtyRef.current = true;
    liveDirtyRef.current = true;
  }, []);

  /**
   * El boton de panico del host.
   *
   * Un toque y el proyector queda limpio. Al que dibuja se le avisa, porque su
   * lienzo local sigue con lo que hizo: sin el aviso creeria que el proyector
   * muestra lo mismo que su telefono y volveria a dibujar encima.
   */
  const panicClear = useCallback(() => {
    clearBoard();
    const drawer = drawerRef.current;
    if (!drawer) return;
    panicAtRef.current = performance.now() + NOTICE_MS;
    sentKeysRef.current.delete(drawer.participantId);
  }, [clearBoard]);

  const renderBoard = useCallback(() => {
    if (boardDirtyRef.current) {
      boardDirtyRef.current = false;
      liveDirtyRef.current = true;
      rebuildBoard();
    }
    if (!liveDirtyRef.current) return;
    liveDirtyRef.current = false;

    const canvas = liveCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // Lo unico que se repinta cuadro a cuadro: una limpieza y un trazo.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const stroke = liveStrokeRef.current;
    if (stroke) paintStroke(ctx, stroke, canvas.width, canvas.height, true);
  }, [paintStroke, rebuildBoard]);

  /* El tamano del lienzo sigue al contenedor. Cambiar `width` limpia el canvas,
     asi que despues hay que reconstruir desde la lista de trazos. */
  useEffect(() => {
    paletteRef.current = readPalette();
    const box = boardBoxRef.current;
    if (!box) return;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(box.clientWidth * dpr));
      const height = Math.max(1, Math.round(box.clientHeight * dpr));
      for (const canvas of [baseCanvasRef.current, liveCanvasRef.current]) {
        if (!canvas || (canvas.width === width && canvas.height === height)) continue;
        canvas.width = width;
        canvas.height = height;
      }
      boardDirtyRef.current = true;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(box);
    return () => observer.disconnect();
    // El lienzo se monta y desmonta con la etapa: hay que reenganchar el
    // observador cuando vuelve.
  }, [stage]);

  /* ---------------------------------------------------------------- */
  /* Avisos personales                                                 */
  /* ---------------------------------------------------------------- */

  const setNotice = useCallback((participantId: string, text: string, now: number) => {
    if (text === "") return;
    noticeSeqRef.current++;
    noticeRef.current.set(participantId, {
      text,
      until: now + NOTICE_MS,
      seq: noticeSeqRef.current,
    });
  }, []);

  const noticeOf = useCallback((participantId: string, now: number) => {
    const entry = noticeRef.current.get(participantId);
    if (!entry) return null;
    if (now >= entry.until) {
      noticeRef.current.delete(participantId);
      return null;
    }
    return entry;
  }, []);

  /* ---------------------------------------------------------------- */
  /* Ronda                                                             */
  /* ---------------------------------------------------------------- */

  /** Quienes pueden dibujar, siempre en orden de asiento: el turno es determinista. */
  const candidates = useCallback((): string[] => {
    const round = roundRef.current;
    if (!round) return [];
    return [...round.participants.keys()].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  }, []);

  const beginRound = useCallback(() => {
    const round = roundRef.current;
    if (!round) return;

    const pick = nextDrawer(candidates(), drawnRef.current);
    drawnRef.current = pick.drawn;
    const participant = pick.drawerId ? round.participants.get(pick.drawerId) : undefined;
    drawerRef.current =
      pick.drawerId && participant
        ? { participantId: pick.drawerId, name: participant.name }
        : null;

    choicesRef.current = deck[round.itemIndex] ?? [];
    pickedRef.current = null;
    wordRef.current = null;
    revealRef.current = 0;
    cancelledRef.current = false;
    cancelReasonRef.current = "";
    correctOrderRef.current = [];
    feedRef.current = [];
    noticeRef.current.clear();
    typingRef.current.clear();
    clearBoard();
    sentKeysRef.current.clear();
  }, [candidates, clearBoard, deck]);

  /** La palabra elegida pasa a ser la respuesta correcta del item. */
  const lockWord = useCallback(() => {
    const round = roundRef.current;
    if (!round) return;
    const choices = choicesRef.current;
    if (choices.length === 0) return;

    const chosen =
      choices.find((word) => word.text === pickedRef.current) ??
      // Sin eleccion sale la del medio: el nivel intermedio es el que menos
      // castiga a quien se distrajo diez segundos.
      choices[Math.min(1, choices.length - 1)] ??
      choices[0];
    if (!chosen) return;

    wordRef.current = {
      text: chosen.text,
      // Sembrada por ronda y palabra: la misma partida revela las mismas letras.
      order: revealOrder(chosen.text, createRng(`${config.seed}:${round.itemIndex}:${chosen.text}`)),
    };
    revealRef.current = 0;

    const question = questions[round.itemIndex];
    if (question) {
      question.prompt = chosen.text;
      question.correct = [chosen.text];
    }
  }, [config.seed, questions]);

  /**
   * Corta la ronda sin puntos para nadie.
   *
   * Lo usan el boton de panico del host y la desconexion del que dibuja. En
   * los dos casos **no se espera**: dejar a la sala mirando un lienzo congelado
   * es peor que perder la ronda.
   */
  const cancelRound = useCallback(
    (reason: string) => {
      const round = roundRef.current;
      if (!round || round.finished) return;
      if (round.phase === "cierre" || round.phase === "ranking") return;

      cancelledRef.current = true;
      cancelReasonRef.current = reason;
      cancelledCountRef.current++;
      // Vaciar las respuestas es lo que deja la ronda sin puntos: quien ya
      // habia acertado tampoco cobra, porque la ronda no valio.
      round.answers.clear();
      correctOrderRef.current = [];
      clearBoard();
      sentKeysRef.current.clear();

      if (round.phase === "respuesta") {
        // La via sancionada: la ventana cierra sola en el proximo cuadro.
        closeWindowNow(round);
        return;
      }
      // En anuncio o eleccion no hay ventana que cerrar, asi que se salta al
      // cierre a mano. Es la unica escritura directa sobre la ronda y existe
      // porque `liveRound` no tiene un "abortar" propio.
      round.phase = "cierre";
      round.phaseMs = 0;
      round.windowOpenedAtMs = null;
    },
    [clearBoard],
  );

  /* ---------------------------------------------------------------- */
  /* Lo que ve cada telefono                                           */
  /* ---------------------------------------------------------------- */

  const specFor = useCallback(
    (participantId: string, now: number): { key: string; spec: ControlSpec } => {
      const round = roundRef.current;
      if (!round) return { key: "boot", spec: { layout: "wait", message: "Preparando la sala…" } };

      if (stageRef.current === "lobby") {
        return {
          key: "lobby",
          spec: { layout: "wait", message: "Listo. Mirá la pantalla grande: ya arranca." },
        };
      }
      if (stageRef.current === "done" || round.finished) {
        return {
          key: "done",
          spec: { layout: "wait", message: "Terminó. Las posiciones están en la pantalla grande." },
        };
      }

      const drawer = drawerRef.current;
      const isDrawer = drawer?.participantId === participantId;
      const index = round.itemIndex;
      const notice = noticeOf(participantId, now);
      const noticeKey = notice ? String(notice.seq) : "-";

      switch (round.phase) {
        case "anuncio":
          return isDrawer
            ? {
                key: `a|${index}|yo`,
                spec: { layout: "wait", message: "Te toca dibujar. Preparate." },
              }
            : {
                key: `a|${index}`,
                spec: {
                  layout: "wait",
                  message: `Le toca a ${drawer?.name ?? "alguien"}. Preparate para adivinar.`,
                },
              };

        case "lectura": {
          if (!isDrawer) {
            return {
              key: `c|${index}`,
              spec: {
                layout: "wait",
                message: `${drawer?.name ?? "Alguien"} está eligiendo qué dibujar…`,
              },
            };
          }
          const bucket = Math.floor(round.phaseMs / DRAW_CLOCK_STEP_MS);
          return {
            key: `c|${index}|${pickedRef.current ?? "-"}|${bucket}`,
            spec: {
              layout: "buttons",
              // Una facil, una media y una dificil: elegir es parte del juego.
              options: choicesRef.current.map((word) => ({
                id: word.text,
                label: word.text,
                shape:
                  word.level === "facil" ? "circle" : word.level === "media" ? "triangle" : "diamond",
              })),
              enabled: pickedRef.current === null,
              picked: pickedRef.current,
              question: "Elegí qué dibujar",
              remainingMs: Math.max(0, setup.round.readMs - round.phaseMs),
              windowMs: setup.round.readMs,
            },
          };
        }

        case "respuesta": {
          const word = wordRef.current;
          if (isDrawer) {
            const bucket = Math.floor(round.phaseMs / DRAW_CLOCK_STEP_MS);
            const panicked = now < panicAtRef.current;
            return {
              key: `d|${index}|${bucket}|${panicked ? 1 : 0}`,
              spec: {
                layout: "draw",
                prompt: word?.text ?? "",
                colors: INK_CSS,
                widths: INK_WIDTHS,
                enabled: true,
                ...(panicked
                  ? { notice: "El host borró el lienzo. Lo que sigue arranca de cero." }
                  : {}),
                remainingMs: Math.max(0, setup.round.answerMs - round.phaseMs),
                windowMs: setup.round.answerMs,
              },
            };
          }
          const locked = round.answers.has(participantId);
          const hint = word ? hintFor(word.text, word.order, revealRef.current) : "";
          return {
            // Sin `remainingMs`: el reloj de quien adivina es la barra del
            // proyector, y asi el spec cambia 5 veces por ronda y no 8 por
            // segundo por persona.
            key: `g|${index}|${revealRef.current}|${locked ? 1 : 0}|${noticeKey}`,
            spec: {
              layout: "text",
              // El placeholder cambia por ronda: es lo que limpia el campo del
              // telefono al empezar la siguiente.
              placeholder: `Ronda ${index + 1}: ¿qué es?`,
              hint,
              enabled: true,
              locked,
              ...(notice
                ? { notice: notice.text }
                : locked
                  ? { notice: "Acertaste. Mirá cómo caen los demás." }
                  : {}),
            },
          };
        }

        case "cierre": {
          if (cancelledRef.current) {
            return {
              key: `z|${index}|x`,
              spec: { layout: "wait", message: `Ronda cancelada. ${cancelReasonRef.current}` },
            };
          }
          const word = wordRef.current?.text ?? "";
          const count = correctOrderRef.current.length;
          if (isDrawer) {
            return {
              key: `z|${index}|d`,
              spec: {
                layout: "wait",
                message:
                  count === 0
                    ? `Nadie te entendió “${word}”. Esta ronda no suma.`
                    : `Te entendieron ${count}. +${drawerPoints(count, setup.scoring)}`,
              },
            };
          }
          return {
            key: `z|${index}|${noticeKey}`,
            spec: {
              layout: "wait",
              message: notice ? notice.text : `Era “${word}”.`,
            },
          };
        }

        case "ranking":
          return {
            key: `r|${index}`,
            spec: { layout: "wait", message: "Posiciones en la pantalla grande." },
          };
      }
    },
    [noticeOf, setup.round.answerMs, setup.round.readMs, setup.scoring],
  );

  /* ---------------------------------------------------------------- */
  /* Red                                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Simulados del banco de pruebas: garabatean cuando les toca y tiran algun
   * intento. Sin esto, ver el proyector con el lienzo lleno y ocho nombres en
   * la lista exige ocho telefonos. Llegan apagados.
   */
  const botPolicy = useMemo<BotPolicy<ControlInput>>(
    () => ({
      hz: 5,
      policy: (bot) => {
        const round = roundRef.current;
        const id = participantKey(bot.seat);
        // Un input que el host ignora: es como se dice "este turno, nada".
        const silence: ControlInput = { kind: "press", buttonId: "" };
        if (!round || stageRef.current !== "playing") return silence;

        const isDrawer = drawerRef.current?.participantId === id;

        if (round.phase === "lectura" && isDrawer && pickedRef.current === null) {
          if (round.phaseMs < 1500) return silence;
          const choice = bot.rng.pick(choicesRef.current.map((word) => word.text));
          return { kind: "pick", optionId: choice };
        }

        if (round.phase !== "respuesta") return silence;

        if (isDrawer) {
          // Un trazo completo por mensaje: un cliente falso no necesita
          // simular el lote de 50 ms, y asi ejercita el tope de trazos.
          const cx = bot.rng.range(0.15, 0.85);
          const cy = bot.rng.range(0.15, 0.85);
          const points: StrokePoint[] = [];
          for (let i = 0; i < 8; i++) {
            points.push({
              x: Math.min(1, Math.max(0, cx + bot.rng.range(-0.12, 0.12))),
              y: Math.min(1, Math.max(0, cy + bot.rng.range(-0.12, 0.12))),
            });
          }
          return {
            kind: "stroke",
            phase: "end",
            points,
            color: bot.rng.pick(INK_CSS),
            width: bot.rng.pick(INK_WIDTHS),
            eraser: false,
          };
        }

        if (round.answers.has(id)) return silence;
        // Cada uno tarda distinto y no todos aciertan: una sala real tampoco.
        if (round.phaseMs < 4000 + (bot.seat % 6) * 5000) return silence;
        if (bot.rng.next() < 0.6) return { kind: "typing" };
        const word = wordRef.current?.text ?? "";
        return { kind: "text", value: bot.rng.next() < 0.55 ? word : "una casa" };
      },
    }),
    [],
  );

  const netHandle = useGameNet<ControlInput, never>({
    roomId: config.roomId,
    // Lo elige el contenedor, igual que la sala: el celular entra por donde
    // dice el QR y el proyector tiene que estar en la misma red.
    transport: config.transport,
    role: "host",
    // -1 = proyector que no juega. Los 20 asientos quedan para los celulares.
    seat: -1,
    seats: PINTURILLO_SEATS,
    name: "Proyector",
    bot: setup.demoBots ? botPolicy : undefined,

    onInput: (playerId, input) => {
      const round = roundRef.current;
      const entry = seatByPlayerRef.current.get(playerId);
      if (!round || !entry || stageRef.current !== "playing") return;

      const participantId = participantKey(entry.seat);
      const isDrawer = drawerRef.current?.participantId === participantId;
      const now = performance.now();

      switch (input.kind) {
        case "pick": {
          // La palabra la elige quien dibuja, y solo en la fase de eleccion.
          if (!isDrawer || round.phase !== "lectura" || pickedRef.current !== null) return;
          if (!choicesRef.current.some((word) => word.text === input.optionId)) return;
          pickedRef.current = input.optionId;
          return;
        }

        case "stroke": {
          if (!isDrawer || round.phase !== "respuesta" || cancelledRef.current) return;
          // Un color que no salio de la paleta del spec no entra al lienzo.
          const color = isKnownInk(input.color) ? input.color : INK_CSS[0] ?? BOARD_COLOR;
          const width = INK_WIDTHS.includes(input.width) ? input.width : INK_WIDTHS[1] ?? 12;

          let live = liveStrokeRef.current;
          if (input.phase === "start" || live === null) {
            // Un "start" perdido no puede perder el trazo entero: si llega un
            // "move" sin trazo abierto, se abre uno.
            live = {
              id: ++strokeIdRef.current,
              color,
              width,
              eraser: input.eraser,
              points: [],
            };
          }
          const points = [...live.points, ...input.points];
          live = { ...live, points };
          liveStrokeRef.current = live;
          liveDirtyRef.current = true;

          if (input.phase === "end") {
            commitStroke(live);
            liveStrokeRef.current = null;
          } else if (points.length >= LIVE_SPLIT_POINTS) {
            commitStroke(live);
            // El trazo nuevo arranca en los dos ultimos puntos para que la
            // union no se vea como un corte.
            liveStrokeRef.current = {
              ...live,
              id: ++strokeIdRef.current,
              points: points.slice(-2),
            };
          }
          return;
        }

        case "canvas": {
          if (!isDrawer || round.phase !== "respuesta") return;
          strokesRef.current = applyCanvasAction(strokesRef.current, input.action);
          if (input.action === "clear") liveStrokeRef.current = null;
          // Deshacer y borrar son eventos: el repintado completo se paga una
          // vez, cuando alguien lo pide, y no en cada cuadro.
          boardDirtyRef.current = true;
          return;
        }

        case "typing": {
          // Quien dibuja no escribe, y quien ya acerto tampoco tipea.
          if (isDrawer || round.answers.has(participantId)) return;
          typingRef.current.set(participantId, now + TYPING_MS);
          return;
        }

        case "text": {
          if (round.phase !== "respuesta") return;
          // Quien dibuja no puede escribir: es la regla que impide el "lo dije
          // yo mismo" y el unico control que hace falta explicar.
          if (isDrawer) return;
          if (round.answers.has(participantId)) return;
          const word = wordRef.current;
          if (!word || cancelledRef.current) return;

          const verdict = judgeGuess(input.value, word.text, setup.scoring.nearDistance);
          typingRef.current.delete(participantId);

          if (verdict === "correct") {
            const result = submitAnswer(round, {
              participantId,
              // Viaja la palabra canonica, no lo que se escribio: el item
              // corrige contra `correct` y ya se decidio aca que acerto.
              value: word.text,
              // El RTT sale del ping del puerto, nunca de lo que diga el
              // telefono: sin eso pierde quien tiene peor WiFi.
              rttMs: netHandle.net?.rttMs ?? 0,
            });
            if (result.status !== "accepted") return;
            correctOrderRef.current = [...correctOrderRef.current, participantId];
            setNotice(
              participantId,
              guessNotice({
                verdict,
                points: Math.max(
                  0,
                  Math.round(
                    setup.scoring.guessBase +
                      setup.scoring.guessSpeed *
                        Math.max(0, 1 - result.elapsedMs / setup.round.answerMs),
                  ),
                ),
                position: correctOrderRef.current.length,
              }),
              now,
            );
            return;
          }

          if (verdict === "near" || verdict === "blocked") {
            // El "Casi!" va SOLO a esa persona: proyectarlo le regalaria la
            // palabra a la sala. El vetado tampoco se proyecta, nunca.
            setNotice(participantId, guessNotice({ verdict, points: 0, position: 0 }), now);
            return;
          }

          // Un intento fallido NO se proyecta salvo que el host lo pida, y aun
          // asi ya paso por el filtro de texto.
          if (setup.showGuesses) {
            const participant = round.participants.get(participantId);
            feedIdRef.current++;
            feedRef.current = [
              ...feedRef.current.slice(-5),
              {
                id: feedIdRef.current,
                name: participant?.name ?? "Alguien",
                text: input.value.slice(0, 40),
              },
            ];
          }
          return;
        }

        default:
          return;
      }
    },

    onPlayerJoin: (player) => {
      seatByPlayerRef.current.set(player.id, { seat: player.seat, bot: player.bot });
      if (player.bot && !setup.demoBots) return;
      const round = roundRef.current;
      if (!round) return;

      const participantId = participantKey(player.seat);
      playerByParticipantRef.current.set(participantId, { playerId: player.id, bot: player.bot });
      const participant = addParticipant(round, participantId, player.name);
      participant.name = player.name;
      // Quien entra a mitad ENTRA A ADIVINAR, y dibuja en la ronda siguiente:
      // `addParticipant` lo dejaria afuera del item en curso, que es lo
      // correcto en una trivia y no aca, donde adivinar no es una carrera
      // contra los que ya estaban.
      participant.fromItem = Math.min(participant.fromItem, round.itemIndex);

      // El dibujo se reconstruye desde la LISTA DE TRAZOS. Es lo que hace que
      // quien llega a mitad de la ronda vea el dibujo ya hecho y no un lienzo
      // en blanco mientras todos ven algo a medias.
      boardDirtyRef.current = true;
      // Y su telefono recibe su pantalla en el acto, no en el proximo cambio
      // de fase: el que se reconecta puede ser el que estaba dibujando.
      sentKeysRef.current.delete(participantId);
    },

    onPlayerLeave: (playerId) => {
      const entry = seatByPlayerRef.current.get(playerId);
      seatByPlayerRef.current.delete(playerId);
      if (!entry) return;
      const participantId = participantKey(entry.seat);
      playerByParticipantRef.current.delete(participantId);
      typingRef.current.delete(participantId);
      // A quien adivina no se lo saca de la ronda: los puntos que hizo son
      // suyos y un telefono que se bloqueo no es alguien que no jugo.

      const round = roundRef.current;
      if (!round || stageRef.current !== "playing") return;
      if (drawerRef.current?.participantId !== participantId) return;

      if (round.phase === "anuncio") {
        // Todavia no empezo nada: se le da el turno a otro y listo.
        drawnRef.current = drawnRef.current.filter((id) => id !== participantId);
        beginRound();
        return;
      }
      // NO se espera al que se cayo. La ronda se cancela sin puntos y pasa al
      // siguiente: dejar a la sala mirando un lienzo congelado es peor.
      cancelRound("El dibujante se desconectó.");
    },
  });

  const netPort = netHandle.net;

  /* ---------------------------------------------------------------- */
  /* Fin                                                               */
  /* ---------------------------------------------------------------- */

  const finish = useCallback(
    (completed: boolean, reason: string) => {
      if (finishedRef.current) return; // el contrato pide exactamente una vez
      finishedRef.current = true;
      const round = roundRef.current;
      const ranking = round ? liveRanking(round) : [];
      setStage("done");
      stageRef.current = "done";
      onFinish({
        completed,
        points: pinturilloPoints(ranking),
        durationMs: Math.round(performance.now() - startedAtRef.current),
        meta: pinturilloMeta(
          {
            roundsPlayed: roundsPlayedRef.current,
            totalRounds,
            participants: round ? round.participants.size : 0,
            cancelledRounds: cancelledCountRef.current,
            ranking,
          },
          reason,
        ),
      });
    },
    [onFinish, totalRounds],
  );

  /* Forzar fin: emite lo acumulado hasta ahi, en el acto. */
  useEffect(() => {
    if (signal.aborted) {
      finish(false, "forzado");
      return;
    }
    const onAbort = () => finish(false, "forzado");
    signal.addEventListener("abort", onAbort);
    return () => signal.removeEventListener("abort", onAbort);
  }, [finish, signal]);

  useDeadline(
    config.durationMs,
    useCallback(() => finish(false, "tiempo"), [finish]),
  );

  /* ---------------------------------------------------------------- */
  /* Publicacion                                                       */
  /* ---------------------------------------------------------------- */

  const pushControls = useCallback(
    (now: number, force: boolean) => {
      const port = netPort;
      const round = roundRef.current;
      if (!port || !round) return;
      if (!force && now - lastControlAtRef.current < CONTROL_TICK_MS) return;
      lastControlAtRef.current = now;

      for (const [participantId, target] of playerByParticipantRef.current) {
        // Un simulado no mira su telefono: mandarle la pantalla serian 20
        // mensajes por segundo para nadie.
        if (target.bot) continue;
        const { key, spec } = specFor(participantId, now);
        if (sentKeysRef.current.get(participantId) === key) continue;
        sentKeysRef.current.set(participantId, key);
        // Dirigido SIEMPRE: en la fase de dibujo el que dibuja tiene el lienzo
        // y los demas un campo de texto. Un difundido le taparia el lienzo a
        // quien esta dibujando en cuanto el jitter cruzara los dos mensajes.
        port.sendControl(spec, target.playerId);
      }
    },
    [netPort, specFor],
  );

  const publish = useCallback(
    (now: number, force: boolean) => {
      const round = roundRef.current;
      if (!round) return;
      if (!force && now - lastPublishRef.current < PUBLISH_MS) return;
      lastPublishRef.current = now;

      const total = phaseTotalMs(round);
      const progress = round.finished ? 1 : Math.min(1, round.phaseMs / Math.max(1, total));
      const drawer = drawerRef.current;
      const word = wordRef.current;
      const correct = new Set(correctOrderRef.current);
      const ranking = liveRanking(round);
      const counts = answerProgress(round);

      const rows: RailRow[] = ranking.map((row) => ({
        participantId: row.participantId,
        name: row.name,
        points: row.points,
        position: row.position,
        correct: correct.has(row.participantId),
        drawing: drawer?.participantId === row.participantId,
        typing: (typingRef.current.get(row.participantId) ?? 0) > now,
      }));

      setView({
        phase: round.phase,
        itemIndex: Math.min(round.itemIndex, Math.max(0, totalRounds - 1)),
        totalRounds,
        progress,
        remainingMs: Math.max(0, total - round.phaseMs),
        drawerName: drawer?.name ?? "",
        hint: word ? hintFor(word.text, word.order, revealRef.current) : "",
        word: word?.text ?? "",
        guessed: correct.size,
        // El que dibuja no adivina: contarlo daria "3 de 4" con todos adentro.
        guessers: Math.max(0, counts.eligible - (drawer ? 1 : 0)),
        rows,
        ranking,
        winners: correctOrderRef.current.map(
          (id) => round.participants.get(id)?.name ?? "Alguien",
        ),
        cancelled: cancelledRef.current,
        cancelReason: cancelReasonRef.current,
        feed: feedRef.current,
        strokes: strokesRef.current.length,
        points: strokePointCount(strokesRef.current),
      });
    },
    [totalRounds],
  );

  /* ---------------------------------------------------------------- */
  /* El loop                                                           */
  /* ---------------------------------------------------------------- */

  const tick = useCallback(
    (dtMs: number, now: number) => {
      const round = roundRef.current;
      if (!round) return;

      if (stageRef.current !== "playing") {
        pushControls(now, false);
        renderBoard();
        return;
      }

      const events = advanceLiveRound(round, dtMs);
      let forced = false;

      for (const event of events) {
        if (event.type === "closed") {
          roundsPlayedRef.current++;
          const correctCount = event.results.filter((answer) => answer.correct === true).length;
          const drawer = drawerRef.current;
          // El que dibuja puntua segun cuanta gente acerto. Si no acerto nadie,
          // `drawerPoints` devuelve 0 y no se le suma nada.
          if (!cancelledRef.current && drawer && correctCount > 0) {
            awardPoints(round, drawer.participantId, drawerPoints(correctCount, setup.scoring));
          }
        } else if (event.type === "phase") {
          forced = true;
          sentKeysRef.current.clear();
          if (event.phase === "anuncio") beginRound();
          if (event.phase === "respuesta") {
            lockWord();
            allInMsRef.current = 0;
          }
        } else if (event.type === "finished") {
          finish(true, "completa");
        }
      }

      if (round.phase === "respuesta" && !cancelledRef.current) {
        const remaining = Math.max(0, setup.round.answerMs - round.phaseMs);
        const reveal = revealCount(remaining, setup.hintsAtMs);
        if (reveal !== revealRef.current) {
          revealRef.current = reveal;
          // La pista nueva sale ya: esperar al proximo tick de control la
          // atrasaria hasta 120 ms, y una pista tarde no ayuda.
          forced = true;
        }

        /* Cortar cuando ya acertaron todos: seguir 40 segundos con el lienzo
           abierto y nadie escribiendo es tiempo muerto en la sala. */
        const counts = answerProgress(round);
        const guessers = Math.max(0, counts.eligible - (drawerRef.current ? 1 : 0));
        if (guessers > 0 && counts.answered >= guessers) {
          allInMsRef.current += dtMs;
          if (allInMsRef.current >= EARLY_CLOSE_MS) closeWindowNow(round);
        } else {
          allInMsRef.current = 0;
        }
      }

      publish(now, forced);
      pushControls(now, forced);
      renderBoard();
    },
    [
      beginRound,
      finish,
      lockWord,
      publish,
      pushControls,
      renderBoard,
      setup.hintsAtMs,
      setup.round.answerMs,
      setup.scoring,
    ],
  );

  /* El loop se monta UNA vez y lee el `tick` de turno por referencia. Si
     dependiera de `tick`, un `onFinish` que cambia de identidad en cada render
     reiniciaria el cuadro y el `dt` daria casi cero. */
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = window.requestAnimationFrame(frame);
      const dt = Math.min(MAX_FRAME_MS, now - last);
      last = now;
      tickRef.current(dt, now);
    };
    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const start = useCallback(() => {
    startedAtRef.current = performance.now();
    lastPublishRef.current = 0;
    stageRef.current = "playing";
    setStage("playing");
    // La ronda 0 no llega por evento: la maquina ya nace en `anuncio`.
    beginRound();
  }, [beginRound]);

  /* ---------------------------------------------------------------- */
  /* El proyector                                                      */
  /* ---------------------------------------------------------------- */

  const humans = netHandle.players.filter((player) => !player.bot || setup.demoBots);

  if (totalRounds === 0) {
    return (
      <Frame>
        <div className="sn-card p-6 text-center">
          <h2 className="text-xl text-sn-text">No hay palabras cargadas</h2>
          <p className="mt-2 text-sm text-sn-muted">
            Elegí al menos una lista con palabras en los administrables.
          </p>
        </div>
      </Frame>
    );
  }

  if (stage === "lobby") {
    return (
      <Frame>
        <div className="sn-card flex flex-col gap-5 p-8 text-center">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sn-dim">Pinturillo</p>
            <h2 className="mt-1 font-display text-3xl text-sn-text">Uno dibuja, todos adivinan</h2>
          </div>
          <p className="text-sm text-sn-muted">
            {totalRounds} rondas · {Math.round(setup.round.answerMs / 1000)} segundos para dibujar ·
            se puntúa por adivinar rápido, y quien dibuja puntúa según cuánta gente lo entendió.
          </p>
          <p className="rounded-sn border border-sn-line-soft bg-sn-bg-elev px-4 py-3 text-sm text-sn-text">
            Escaneá el QR con el celular. El dibujo va acá arriba; en el teléfono está el lienzo o el
            campo para escribir.
          </p>
          <p className="sn-num text-2xl text-sn-cyan" aria-live="polite">
            {humans.length} {humans.length === 1 ? "conectado" : "conectados"}
          </p>
          {humans.length < MIN_PLAYERS && (
            <p className="text-sm text-sn-warn">
              Hacen falta al menos {MIN_PLAYERS}: uno dibuja y dos adivinan. Con dos, es raro.
            </p>
          )}
          <button
            type="button"
            className="sn-btn sn-btn--primary h-12 w-full"
            onClick={start}
            disabled={humans.length < 2}
          >
            Empezar
          </button>
          <p className="text-[11px] text-sn-dim">
            Quien llegue tarde entra a adivinar en el acto y dibuja en la ronda siguiente.
          </p>
        </div>
      </Frame>
    );
  }

  if (stage === "done") {
    return (
      <Frame>
        <div className="flex w-full max-w-3xl flex-col gap-6">
          <header className="text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-sn-dim">Terminó</p>
            <h2 className="mt-1 font-display text-4xl text-sn-text">
              {view.ranking[0] ? `Ganó ${view.ranking[0].name}` : "Sin participantes"}
            </h2>
            {view.ranking[0] && (
              <p className="sn-num mt-1 text-2xl text-sn-cyan">{view.ranking[0].points} puntos</p>
            )}
          </header>
          <LiveRankingTable rows={view.ranking} limit={10} title="Posiciones finales" />
        </div>
      </Frame>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 p-6">
      <header className="flex shrink-0 items-center justify-between gap-6">
        <span className="sn-num text-[clamp(0.9rem,1.4vw,1.4rem)] tracking-widest text-sn-dim">
          {phaseLabel(view.phase)} · RONDA {Math.min(view.itemIndex + 1, view.totalRounds)} DE{" "}
          {view.totalRounds}
        </span>

        <div className="flex items-center gap-3">
          {netHandle.rttMs > 200 && (
            <span className="text-[clamp(0.7rem,1vw,1rem)] text-sn-warn">latencia alta</span>
          )}
          {config.debug && (
            <span className="sn-num text-[clamp(0.7rem,0.9vw,0.9rem)] text-sn-dim">
              {view.strokes} trazos · {view.points} puntos
            </span>
          )}
          {/* El boton de panico. Un toque, sin confirmacion: cuando hace falta,
              hace falta ya. Es lo que separa "el mejor momento de la
              presentacion" de "un riesgo para quien organiza el evento". */}
          <button
            type="button"
            className="sn-btn h-10 px-4 text-sm"
            onClick={panicClear}
            title="Borra el dibujo y deja seguir la ronda"
          >
            Borrar lienzo
          </button>
          <button
            type="button"
            className="sn-btn sn-btn--danger h-10 px-4 text-sm"
            onClick={() => cancelRound("El host la salteó.")}
            title="Cancela la ronda sin puntos y pasa a la siguiente"
          >
            Saltear ronda
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-6">
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          {/* La palabra en guiones, arriba: es lo que sostiene la ronda cuando
              el dibujo no alcanza. */}
          <p
            className="sn-num shrink-0 text-center text-[clamp(1.2rem,2.6vw,2.8rem)] tracking-[0.35em] text-sn-text"
            aria-live="polite"
          >
            {view.phase === "cierre" && !view.cancelled ? view.word : view.hint || " "}
          </p>

          {/* El lienzo se encuadra con la proporcion del contrato y se centra
              en lo que sobre. Antes se estiraba a todo el hueco disponible, y
              como el celular dibuja sobre otra proporcion, lo que se hacia
              redondo en la mano llegaba al proyector aplastado. Vale mas dejar
              aire al costado que deformar el dibujo. */}
          <div className="relative min-h-0 flex-1">
            {/* `inset-0` + `m-auto` con la proporcion y los dos maximos: es el
                encuadre que se comporta como `object-fit: contain` sin
                depender de cual de los dos lados sea el que limita. Fijar el
                alto y confiar en `max-width` no alcanza: cuando el ancho es el
                que aprieta, el recorte gana y la proporcion se rompe justo en
                el caso que se queria evitar. */}
            <div
              ref={boardBoxRef}
              className="absolute inset-0 m-auto overflow-hidden rounded-sn-lg border border-sn-line-soft"
              style={{
                aspectRatio: String(SKETCH_ASPECT),
                maxWidth: "100%",
                maxHeight: "100%",
                background: BOARD_COLOR,
              }}
            >
              {/* Dos canvas apilados: abajo el cache con los trazos cerrados,
                  pintados una sola vez; arriba solo el trazo en curso. Es lo que
                  sostiene 60 fps con 120 trazos. */}
              <canvas ref={baseCanvasRef} className="absolute inset-0 h-full w-full" aria-label="Dibujo" />
              <canvas ref={liveCanvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

              {view.phase !== "respuesta" && (
                <BoardOverlay view={view} scoring={setup.scoring} />
              )}
            </div>
          </div>

          <footer className="shrink-0">
            <div className="h-3 overflow-hidden rounded-full bg-sn-line" aria-hidden="true">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, (1 - view.progress) * 100))}%`,
                  background:
                    view.progress > 0.8 ? "var(--sn-magenta-400)" : "var(--sn-cyan-400)",
                }}
              />
            </div>
            <p
              className="sn-num mt-2 text-center text-[clamp(0.9rem,1.5vw,1.5rem)] text-sn-muted"
              aria-live="polite"
            >
              {footerText(view)}
            </p>
          </footer>
        </section>

        <aside className="hidden w-[clamp(16rem,22vw,26rem)] shrink-0 flex-col gap-3 lg:flex">
          <PlayerRail rows={view.rows} />
          {/* Apagado por defecto. Encendido, lo que se ve ya paso por el filtro. */}
          {setup.showGuesses && view.feed.length > 0 && (
            <ul className="shrink-0 rounded-sn border border-sn-line-soft bg-sn-bg-elev p-3">
              {view.feed.map((line) => (
                <li key={line.id} className="truncate text-[clamp(0.7rem,1vw,1rem)] text-sn-dim">
                  <span className="text-sn-muted">{line.name}:</span> {line.text}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vistas                                                               */
/* ------------------------------------------------------------------ */

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-xl">{children}</div>
    </div>
  );
}

/**
 * Lo que tapa el lienzo cuando no se esta dibujando: el anuncio del turno, la
 * eleccion, el cierre. El lienzo sigue debajo para que el dibujo no
 * desaparezca de golpe al cerrar la ronda.
 */
function BoardOverlay({
  view,
  scoring,
}: {
  view: View;
  scoring: { drawerBase: number; drawerPerGuess: number; nearDistance: number };
}) {
  const drawerReward =
    view.guessed === 0 ? 0 : scoring.drawerBase + view.guessed * scoring.drawerPerGuess;

  return (
    <div className="absolute inset-0 grid place-items-center bg-sn-bg/85 p-6 text-center">
      <div className="max-w-3xl">
        {view.phase === "anuncio" && (
          <p className="font-display text-[clamp(1.6rem,4vw,4rem)] font-semibold text-sn-text">
            Le toca a <span className="text-sn-cyan">{view.drawerName || "alguien"}</span>
          </p>
        )}

        {view.phase === "lectura" && (
          <>
            <p className="font-display text-[clamp(1.4rem,3.2vw,3.2rem)] font-semibold text-sn-text">
              {view.drawerName || "Alguien"} está eligiendo qué dibujar
            </p>
            <p className="mt-3 text-[clamp(0.9rem,1.4vw,1.4rem)] text-sn-muted">
              Tres palabras: una fácil, una media y una difícil.
            </p>
          </>
        )}

        {view.phase === "cierre" && view.cancelled && (
          <>
            <p className="font-display text-[clamp(1.4rem,3.2vw,3.2rem)] font-semibold text-sn-warn">
              Ronda cancelada
            </p>
            <p className="mt-3 text-[clamp(0.9rem,1.4vw,1.4rem)] text-sn-muted">
              {view.cancelReason} Nadie suma puntos.
            </p>
          </>
        )}

        {view.phase === "cierre" && !view.cancelled && (
          <>
            <p className="font-display text-[clamp(1.8rem,4.4vw,4.4rem)] font-semibold text-sn-text">
              {view.word}
            </p>
            <p className="sn-num mt-3 text-[clamp(0.9rem,1.5vw,1.5rem)] text-sn-muted">
              {roundSummary(view.guessed, view.guessers, view.word)}
            </p>
            {view.winners.length > 0 && (
              <ol className="mt-4 flex flex-wrap justify-center gap-2">
                {view.winners.map((name, index) => (
                  <li
                    key={`${name}-${index}`}
                    className="rounded-sn border border-sn-line-soft bg-sn-bg-elev px-3 py-1 text-[clamp(0.8rem,1.2vw,1.2rem)] text-sn-text"
                  >
                    <span className="sn-num mr-2 text-sn-cyan">{index + 1}</span>
                    {name}
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-4 text-[clamp(0.8rem,1.2vw,1.2rem)] text-sn-dim">
              {view.drawerName || "Quien dibujó"}: +{drawerReward}
            </p>
          </>
        )}

        {view.phase === "ranking" && (
          <p className="font-display text-[clamp(1.6rem,3.6vw,3.6rem)] font-semibold text-sn-text">
            Así va la sala
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * La lista del costado.
 *
 * El tilde cuando alguien acierta es la mitad de la gracia del juego: verlos
 * caer uno a uno es lo que hace que la sala mire la pantalla. Y "esta
 * escribiendo" se muestra SIN decir que escribe.
 */
function PlayerRail({ rows }: { rows: readonly RailRow[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="mb-3 text-[clamp(0.7rem,1vw,1rem)] font-semibold uppercase tracking-[0.14em] text-sn-dim">
        Posiciones
      </h2>
      <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        {rows.map((row) => (
          <li
            key={row.participantId}
            className="flex items-center gap-3 rounded-sn border px-3 py-2"
            style={{
              borderColor: row.correct ? "var(--sn-success)" : "var(--sn-line-soft)",
              background: row.correct
                ? "color-mix(in oklab, var(--sn-success) 14%, transparent)"
                : "var(--sn-bg-elev)",
            }}
          >
            <span className="sn-num w-6 shrink-0 text-[clamp(0.9rem,1.3vw,1.4rem)] text-sn-cyan">
              {row.position}
            </span>
            <span className="min-w-0 flex-1 truncate text-[clamp(0.85rem,1.2vw,1.3rem)] text-sn-text">
              {row.name}
              {row.drawing && <span className="ml-2 text-sn-dim">dibuja</span>}
              {!row.drawing && row.typing && !row.correct && (
                <span className="ml-2 text-sn-dim">está escribiendo…</span>
              )}
            </span>
            {/* Simbolo ademas de color: en una sala de 40 siempre hay alguien
                que no distingue el verde. */}
            {row.correct && (
              <span className="shrink-0 text-sn-success" aria-label="Acertó">
                ✓
              </span>
            )}
            <span className="sn-num shrink-0 text-[clamp(0.85rem,1.2vw,1.3rem)] text-sn-muted">
              {row.points}
            </span>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-3 py-2 text-[clamp(0.8rem,1.1vw,1.1rem)] text-sn-dim">
            Todavía no hay nadie.
          </li>
        )}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ayudas puras de la vista                                             */
/* ------------------------------------------------------------------ */

/**
 * El contorno relleno que devuelve `perfect-freehand`, como `Path2D`.
 *
 * Las curvas cuadraticas entre puntos medios son lo que saca los angulos del
 * poligono: sin esto el trazo se ve como un grafico, con esto se ve dibujado.
 */
function outlinePath(points: readonly (readonly number[])[]): Path2D {
  const path = new Path2D();
  const first = points[0];
  if (!first) return path;
  path.moveTo(first[0] ?? 0, first[1] ?? 0);

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    const ax = a[0] ?? 0;
    const ay = a[1] ?? 0;
    path.quadraticCurveTo(ax, ay, (ax + (b[0] ?? 0)) / 2, (ay + (b[1] ?? 0)) / 2);
  }
  path.closePath();
  return path;
}

function phaseLabel(phase: LiveRoundPhase): string {
  switch (phase) {
    case "anuncio":
      return "TURNO";
    case "lectura":
      return "ELIGIENDO";
    case "respuesta":
      return "DIBUJANDO";
    case "cierre":
      return "RESULTADO";
    case "ranking":
      return "POSICIONES";
  }
}

function footerText(view: View): string {
  switch (view.phase) {
    case "anuncio":
      return "Preparate.";
    case "lectura":
      return `${Math.ceil(view.remainingMs / 1000)} s para elegir`;
    case "respuesta":
      return `${view.guessed} de ${view.guessers} adivinaron · ${Math.ceil(view.remainingMs / 1000)} s`;
    case "cierre":
      return view.cancelled ? "Sin puntos." : "Ya va la próxima.";
    case "ranking":
      return "Así va la sala.";
  }
}

/**
 * Cuanto dura la fase en curso.
 *
 * La maquina de fases no lo expone porque no lo necesita: es un dato de la
 * vista. Se lee de la misma configuracion que usa la ronda, asi que no puede
 * desincronizarse.
 */
function phaseTotalMs(round: LiveRoundState): number {
  switch (round.phase) {
    case "anuncio":
      return round.config.announceMs;
    case "lectura":
      return round.config.readMs;
    case "respuesta":
      return round.config.answerMs;
    case "cierre":
      return round.config.revealMs;
    case "ranking":
      return round.config.rankingMs ?? DEFAULT_RANKING_MS;
  }
}
