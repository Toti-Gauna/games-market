import type { StrokePoint } from "@/core/contract/control";
import {
  bool,
  num,
  records,
  str,
  type SettingsValues,
} from "@/core/contract/settings";
import { isBlockedText } from "@/core/corporate/aggregate";
import type { LiveRankEntry, LiveRoundConfig, LiveScorer } from "@/core/corporate/liveRound";
import { normalizeText } from "@/core/corporate/question.types";
import type { Rng } from "@/core/engine/rng";
import {
  PINTURILLO_WORD_LISTS,
  WORD_LEVELS,
  isWordLevel,
  type WordLevel,
  type WordListId,
  type WordSeed,
} from "./words";

/**
 * Lo unico propio de X1, y todo puro: entra dato plano y sale dato plano.
 *
 * No hay React, no hay canvas y no hay relojes del sistema. La maquina de
 * fases, la medicion del tiempo contra el reloj del host, el cierre de la
 * ventana y el ranking ya viven en `core/corporate/liveRound.ts` y no se
 * repiten aca: X1 usa exactamente el mismo patron de fases cronometradas que
 * Trivia y Verdadero o falso, con otros nombres arriba.
 *
 * Lo que si es de este juego:
 *
 * - Comparar lo que alguien escribio con la palabra, sin acentos, sin
 *   mayusculas, sin espacios de mas y sin signos.
 * - Decidir cuando eso es un "Casi!" en vez de un error, que es lo que evita
 *   la frustracion de escribir bien con un dedo torpe.
 * - Las pistas progresivas, que son lo que impide que una ronda se muera en
 *   silencio.
 * - El puntaje, con la regla que alinea al que dibuja con la sala.
 * - La rotacion del turno y la lista de trazos con deshacer y borrar.
 */

/* ------------------------------------------------------------------ */
/* Constantes de sala                                                   */
/* ------------------------------------------------------------------ */

/** Los asientos del registry: el tope de gente que puede tomar el QR. */
export const PINTURILLO_SEATS = 20;

/** Uno dibuja y hacen falta dos que adivinen. Con dos, es raro. */
export const MIN_PLAYERS = 3;

/**
 * "Le toca a Ana" antes de la eleccion. Corto a proposito: es un cartel, no
 * una fase. Los 10 s de la spec son la eleccion, que es la fase `lectura`.
 */
export const ANNOUNCE_MS = 1800;

/**
 * La clave del participante es el ASIENTO, no el id de red: el id cambia con
 * cada refresh del telefono y quien vuelve tiene que recuperar sus puntos, no
 * aparecer dos veces en el ranking.
 */
export function participantKey(seat: number): string {
  return `s${seat}`;
}

/* ------------------------------------------------------------------ */
/* Tinta: colores y grosores                                            */
/* ------------------------------------------------------------------ */

/**
 * Un color del lienzo.
 *
 * `css` es lo que viaja al telefono y lo que vuelve en cada trazo, porque el
 * telefono lo usa tal cual como `background`. El proyector lo pinta en un
 * canvas, y ahi `var(--sn-cyan-400)` no sirve: hay que resolverlo contra la
 * paleta. Por eso el color viaja como token y no como hex suelto - cambiar el
 * tema cambia la tinta sin tocar el juego.
 *
 * Negro y blanco van como palabras clave de CSS y no como hex: son validos en
 * las dos puntas y no hay ningun `#` escrito en el proyecto.
 */
export type Ink = { css: string; label: string };

export const INK_BLACK = "black";

/** El lienzo del proyector es opaco: el blanco es tinta, no transparencia. */
export const BOARD_COLOR = "white";

/** Seis de marca, mas negro y blanco. Ni una herramienta mas de las cinco. */
export const INK_COLORS: readonly Ink[] = [
  { css: INK_BLACK, label: "Negro" },
  { css: "var(--sn-violet-400)", label: "Violeta" },
  { css: "var(--sn-magenta-400)", label: "Magenta" },
  { css: "var(--sn-cyan-400)", label: "Cian" },
  { css: "var(--sn-success)", label: "Verde" },
  { css: "var(--sn-warn)", label: "Ámbar" },
  { css: "var(--sn-danger)", label: "Rojo" },
  { css: BOARD_COLOR, label: "Blanco" },
];

/**
 * Tres grosores, en unidades de un lienzo de 1000. El proyector los escala a
 * su tamano: lo que viaja es el grosor relativo, igual que los puntos.
 */
export const INK_WIDTHS: readonly number[] = [5, 12, 26];

export const INK_CSS = INK_COLORS.map((ink) => ink.css);

/** `var(--x)` -> el valor de la paleta. Cualquier otra cosa pasa tal cual. */
export function resolveInk(css: string, palette: Readonly<Record<string, string>>): string {
  const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(css);
  if (!match) return css;
  const token = match[1];
  if (token === undefined) return css;
  // Si el token no esta en la paleta se cae al negro: una tinta invisible
  // seria peor que una tinta equivocada.
  return palette[token] ?? INK_BLACK;
}

/** Un `color` que no salio de la paleta del spec no se acepta. */
export function isKnownInk(css: string): boolean {
  return INK_CSS.includes(css);
}

/* ------------------------------------------------------------------ */
/* Comparar lo que alguien escribio                                     */
/* ------------------------------------------------------------------ */

/**
 * Sin mayusculas, sin acentos, sin espacios de mas y sin signos.
 *
 * `normalizeText` de la base ya resuelve las tres primeras; lo que agrega X1
 * es sacar la puntuacion, porque aca se escribe con teclado virtual y el
 * autocorrector mete puntos y guiones que no son un error de la persona.
 */
export function normalizeGuess(text: string): string {
  return normalizeText(text)
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Distancia de edicion, con dos filas en vez de la matriz entera.
 *
 * Solo se usa para decidir el "Casi!", asi que las palabras son cortas y no
 * hace falta ningun corte temprano.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    const charA = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = charA === b.charCodeAt(j - 1) ? 0 : 1;
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      const substitution = (previous[j - 1] ?? 0) + cost;
      current[j] = Math.min(deletion, insertion, substitution);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length] ?? 0;
}

/**
 * `blocked` no es un error de la persona: es un intento que NO se proyecta.
 * Va primero que todo lo demas, antes incluso de comparar con la palabra.
 */
export type GuessVerdict = "blocked" | "correct" | "near" | "wrong";

export function judgeGuess(raw: string, word: string, nearDistance = 1): GuessVerdict {
  // El filtro corre sobre el texto crudo: normalizar primero le sacaria los
  // signos con los que se disfrazan las palabras vetadas.
  if (isBlockedText(raw)) return "blocked";

  const guess = normalizeGuess(raw);
  const target = normalizeGuess(word);
  if (guess === "" || target === "") return "wrong";
  if (guess === target) return "correct";

  // El "Casi!" solo tiene sentido si la palabra ya casi esta: con una palabra
  // de tres letras, distancia 1 seria cualquier cosa.
  if (target.length <= 3) return "wrong";
  return levenshtein(guess, target) <= nearDistance ? "near" : "wrong";
}

/* ------------------------------------------------------------------ */
/* Pistas progresivas                                                   */
/* ------------------------------------------------------------------ */

/** Lo que se muestra en lugar de una letra todavia escondida. */
export const HINT_BLANK = "_";

/**
 * En que orden se van revelando las letras.
 *
 * Barajado con el PRNG sembrado y nunca con `Math.random()`: la misma partida
 * tiene que revelar las mismas letras, o dos corridas del mismo bug no se
 * parecen. Los espacios no entran: ya se ven.
 */
export function revealOrder(word: string, rng: Rng): number[] {
  const positions: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] !== " ") positions.push(i);
  }
  return rng.shuffle(positions);
}

/**
 * Cuantas letras van reveladas segun lo que queda de la ventana.
 *
 * `thresholdsMs` son ms RESTANTES, de mayor a menor: 45 s, 25 s y 10 s. Cuanto
 * peor va el dibujo, mas ayuda la palabra.
 */
export function revealCount(remainingMs: number, thresholdsMs: readonly number[]): number {
  let count = 0;
  for (const threshold of thresholdsMs) {
    if (remainingMs <= threshold) count++;
  }
  return count;
}

/**
 * La palabra en guiones, con las letras ya reveladas.
 *
 * Nunca se revela la ultima letra que queda: regalar la palabra entera a los
 * 10 segundos convierte la ronda en un dictado.
 */
export function hintFor(word: string, order: readonly number[], reveal: number): string {
  const maxReveal = Math.max(0, order.length - 1);
  const shown = new Set(order.slice(0, Math.min(Math.max(0, reveal), maxReveal)));

  const cells: string[] = [];
  for (let i = 0; i < word.length; i++) {
    const char = word[i] ?? "";
    // El espacio se conserva como celda vacia: separa las palabras sin decir
    // cuantas letras tiene cada una.
    cells.push(char === " " ? " " : shown.has(i) ? char : HINT_BLANK);
  }
  return cells.join(" ");
}

/** Cuantas letras dejo ver una pista. Es lo que verifica el test de umbrales. */
export function revealedLetters(hint: string): number {
  let count = 0;
  for (const char of hint) {
    if (char !== HINT_BLANK && char.trim() !== "") count++;
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Puntaje                                                              */
/* ------------------------------------------------------------------ */

export type PinturilloScoring = {
  /** Lo que paga acertar, sin importar cuando. */
  guessBase: number;
  /** Lo que agrega llegar primero, repartido por lo que queda de ventana. */
  guessSpeed: number;
  /** Piso del que dibuja, solo si acerto al menos una persona. */
  drawerBase: number;
  /** Lo que suma cada persona que entendio el dibujo. */
  drawerPerGuess: number;
  /** Distancia de edicion que todavia cuenta como "Casi!". */
  nearDistance: number;
};

export const DEFAULT_SCORING: PinturilloScoring = {
  guessBase: 400,
  guessSpeed: 600,
  drawerBase: 200,
  drawerPerGuess: 150,
  nearDistance: 1,
};

export function guesserPoints(
  elapsedMs: number,
  windowMs: number,
  scoring: PinturilloScoring = DEFAULT_SCORING,
): number {
  if (windowMs <= 0) return scoring.guessBase;
  const left = Math.min(1, Math.max(0, 1 - elapsedMs / windowMs));
  return scoring.guessBase + Math.floor(left * scoring.guessSpeed);
}

/**
 * El que dibuja puntua segun CUANTA gente acerto, y eso es lo que lo alinea
 * con la sala: no le conviene un dibujo imposible ni uno que resuelva una sola
 * persona, le conviene que lo entiendan todos.
 *
 * Y si no acerto nadie saca cero. Eso desalienta el dibujo criptico mejor que
 * cualquier regla escrita.
 */
export function drawerPoints(
  correctCount: number,
  scoring: PinturilloScoring = DEFAULT_SCORING,
): number {
  if (correctCount <= 0) return 0;
  return scoring.drawerBase + correctCount * scoring.drawerPerGuess;
}

/**
 * El puntaje que consume `liveRound` al cerrar la ronda.
 *
 * Sin racha: en X1 el bono ya es la velocidad, y una racha de aciertos
 * premiaria a quien tiene mejor conexion mas que a quien entiende el dibujo.
 */
export function createPinturilloScorer(scoring: PinturilloScoring): LiveScorer {
  return (input) => {
    if (input.correct !== true || input.elapsedMs === null) return { base: 0, bonus: 0 };
    return { base: guesserPoints(input.elapsedMs, input.windowMs, scoring), bonus: 0 };
  };
}

/* ------------------------------------------------------------------ */
/* Rotacion del turno                                                   */
/* ------------------------------------------------------------------ */

export type TurnPick = {
  /** null cuando no hay nadie a quien darle el turno. */
  drawerId: string | null;
  /** Quienes ya dibujaron, con el nuevo adentro. */
  drawn: readonly string[];
};

/**
 * El turno rota hasta que todos dibujaron una vez, y ahi el ciclo vuelve a
 * empezar.
 *
 * Es puro y toma la lista de candidatos de afuera: quien se desconecto ya no
 * esta en `candidates`, asi que el turno no se le puede quedar a un telefono
 * apagado. Determinista: con la misma sala y el mismo historial da el mismo
 * turno, siempre.
 */
export function nextDrawer(candidates: readonly string[], drawn: readonly string[]): TurnPick {
  if (candidates.length === 0) return { drawerId: null, drawn };

  const pending = candidates.filter((id) => !drawn.includes(id));
  if (pending.length > 0) {
    const drawerId = pending[0] ?? null;
    return { drawerId, drawn: drawerId === null ? drawn : [...drawn, drawerId] };
  }

  // Todos dibujaron: arranca un ciclo nuevo en vez de dejar la sala sin turno.
  const drawerId = candidates[0] ?? null;
  return { drawerId, drawn: drawerId === null ? [] : [drawerId] };
}

/* ------------------------------------------------------------------ */
/* La lista de trazos                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un trazo cerrado.
 *
 * Guarda PUNTOS, nunca una imagen: por eso el dibujo escala a cualquier
 * resolucion del proyector, quien entra tarde lo puede reconstruir entero y el
 * trafico se mide en cientos de bytes.
 */
export type Stroke = {
  id: number;
  /** El `css` de la paleta, sin resolver: se resuelve al pintar. */
  color: string;
  /** En unidades de un lienzo de 1000. */
  width: number;
  eraser: boolean;
  points: readonly StrokePoint[];
};

/**
 * Tope duro de trazos. El presupuesto son ~120; el doble deja lugar a una
 * ronda larga sin que un cliente hostil llene la memoria del proyector.
 */
export const MAX_STROKES = 240;

export function appendStroke(
  list: readonly Stroke[],
  stroke: Stroke,
  max: number = MAX_STROKES,
): Stroke[] {
  // Un trazo sin puntos no se guarda: seria un elemento que `deshacer` tendria
  // que sacar sin que se vea nada.
  if (stroke.points.length === 0) return [...list];
  if (list.length >= max) return [...list];
  return [...list, stroke];
}

/** Deshacer y borrar viajan como evento, no como un redibujado. */
export function applyCanvasAction(list: readonly Stroke[], action: "undo" | "clear"): Stroke[] {
  return action === "clear" ? [] : list.slice(0, -1);
}

/** Para el presupuesto: cuantos puntos hay en el lienzo. */
export function strokePointCount(list: readonly Stroke[]): number {
  let total = 0;
  for (const stroke of list) total += stroke.points.length;
  return total;
}

/* ------------------------------------------------------------------ */
/* Elegir que dibujar                                                   */
/* ------------------------------------------------------------------ */

/**
 * Las tres opciones de cada ronda, una por nivel.
 *
 * Se arma entera al empezar la partida y con la semilla, no ronda por ronda:
 * asi una partida es reproducible y ninguna palabra se repite mientras quede
 * alguna sin usar en su nivel.
 */
export function buildChoiceDeck(
  pool: readonly WordSeed[],
  rounds: number,
  rng: Rng,
): readonly (readonly WordSeed[])[] {
  if (pool.length === 0 || rounds <= 0) return [];

  const bags = new Map<WordLevel, WordSeed[]>();
  for (const level of WORD_LEVELS) {
    bags.set(
      level,
      rng.shuffle(pool.filter((word) => word.level === level)),
    );
  }

  const deck: WordSeed[][] = [];
  for (let round = 0; round < rounds; round++) {
    const trio: WordSeed[] = [];
    for (const level of WORD_LEVELS) {
      const bag = bags.get(level);
      if (!bag || bag.length === 0) continue;
      const word = bag.shift();
      if (word) trio.push(word);
    }

    // Un nivel vacio no puede dejar la ronda sin nada que elegir: se recarga
    // la bolsa y se repite alguna palabra antes que ofrecer una lista vacia.
    if (trio.length === 0) {
      for (const level of WORD_LEVELS) {
        bags.set(
          level,
          rng.shuffle(pool.filter((word) => word.level === level)),
        );
      }
      const fallback = rng.pick(pool);
      trio.push(fallback);
    }
    deck.push(trio);
  }
  return deck;
}

/* ------------------------------------------------------------------ */
/* Administrables -> partida                                            */
/* ------------------------------------------------------------------ */

export const POOL_OPTIONS = [
  { value: "mixta", label: "Mixta (general + oficina)" },
  { value: "general", label: "Sólo general" },
  { value: "oficina", label: "Sólo oficina" },
  { value: "empresa", label: "Sólo empresa" },
  { value: "dificil", label: "Sólo difícil" },
  { value: "todas", label: "Las cuatro listas" },
] as const;

export type PoolId = (typeof POOL_OPTIONS)[number]["value"];

const POOL_MEMBERS: Readonly<Record<PoolId, readonly WordListId[]>> = {
  mixta: ["general", "oficina"],
  general: ["general"],
  oficina: ["oficina"],
  empresa: ["empresa"],
  dificil: ["dificil"],
  todas: ["general", "oficina", "empresa", "dificil"],
};

export type PinturilloSetup = {
  poolId: PoolId;
  pool: readonly WordSeed[];
  rounds: number;
  round: LiveRoundConfig;
  /** ms restantes en los que se revela una letra mas, de mayor a menor. */
  hintsAtMs: readonly number[];
  scoring: PinturilloScoring;
  scorer: LiveScorer;
  /**
   * Proyectar los intentos que no aciertan. **Apagado por defecto**: los
   * mensajes van a una pantalla de tres metros en un evento de empresa.
   */
  showGuesses: boolean;
  demoBots: boolean;
};

function isPoolId(value: string): value is PoolId {
  return POOL_OPTIONS.some((option) => option.value === value);
}

/** Una fila del panel a una palabra. Se descarta lo que no se puede dibujar. */
function toWordSeed(row: Readonly<Record<string, unknown>>): WordSeed | null {
  const text = typeof row["text"] === "string" ? row["text"].trim() : "";
  if (text === "") return null;
  const level = row["level"];
  return { text, level: isWordLevel(level) ? level : "media" };
}

export function readWordList(values: SettingsValues, id: WordListId): WordSeed[] {
  const rows = records(values, id);
  const out: WordSeed[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const seed = toWordSeed(row);
    if (!seed) continue;
    const key = normalizeGuess(seed.text);
    // Una palabra repetida entre listas saldria dos veces en la misma partida.
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(seed);
  }
  return out;
}

export function readPinturilloSetup(values: SettingsValues): PinturilloSetup {
  const rawPool = str(values, "pool", "mixta");
  const poolId: PoolId = isPoolId(rawPool) ? rawPool : "mixta";

  const pool: WordSeed[] = [];
  const seen = new Set<string>();
  for (const listId of POOL_MEMBERS[poolId]) {
    for (const seed of readWordList(values, listId)) {
      const key = normalizeGuess(seed.text);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(seed);
    }
  }

  const drawMs = Math.round(num(values, "drawSec", 75) * 1000);
  const scoring: PinturilloScoring = {
    guessBase: Math.round(num(values, "guessBase", DEFAULT_SCORING.guessBase)),
    guessSpeed: Math.round(num(values, "guessSpeed", DEFAULT_SCORING.guessSpeed)),
    drawerBase: Math.round(num(values, "drawerBase", DEFAULT_SCORING.drawerBase)),
    drawerPerGuess: Math.round(num(values, "drawerPerGuess", DEFAULT_SCORING.drawerPerGuess)),
    nearDistance: DEFAULT_SCORING.nearDistance,
  };

  return {
    poolId,
    pool,
    rounds: Math.max(1, Math.round(num(values, "rounds", 8))),
    round: {
      announceMs: ANNOUNCE_MS,
      readMs: Math.round(num(values, "chooseSec", 10) * 1000),
      answerMs: drawMs,
      revealMs: Math.round(num(values, "closeSec", 8) * 1000),
      rankingEvery: Math.max(0, Math.round(num(values, "rankingEvery", 0))),
    },
    hintsAtMs: readHints(values, drawMs),
    scoring,
    scorer: createPinturilloScorer(scoring),
    showGuesses: bool(values, "showGuesses", false),
    demoBots: bool(values, "demoBots", false),
  };
}

/**
 * Los tres momentos de las pistas, en ms restantes y de mayor a menor.
 *
 * Un umbral mas grande que la ventana revelaria la letra antes de empezar, asi
 * que se descarta. Repetidos tambien: dos pistas en el mismo instante son una.
 */
function readHints(values: SettingsValues, windowMs: number): readonly number[] {
  const raw = [
    Math.round(num(values, "hint1Sec", 45) * 1000),
    Math.round(num(values, "hint2Sec", 25) * 1000),
    Math.round(num(values, "hint3Sec", 10) * 1000),
  ];
  const clean = [...new Set(raw.filter((ms) => ms > 0 && ms < windowMs))];
  return clean.sort((a, b) => b - a);
}

/** El pool de fabrica: lo que corre si nadie toco los administrables. */
export function defaultPool(): readonly WordSeed[] {
  const out: WordSeed[] = [];
  for (const list of PINTURILLO_WORD_LISTS) {
    if (list.id === "general" || list.id === "oficina") out.push(...list.words);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cierre                                                               */
/* ------------------------------------------------------------------ */

export type PinturilloSummary = {
  roundsPlayed: number;
  totalRounds: number;
  participants: number;
  cancelledRounds: number;
  ranking: readonly LiveRankEntry[];
};

export function pinturilloMeta(
  summary: PinturilloSummary,
  reason: string,
): Record<string, unknown> {
  return {
    rondasJugadas: summary.roundsPlayed,
    rondasTotales: summary.totalRounds,
    participantes: summary.participants,
    rondasCanceladas: summary.cancelledRounds,
    motivo: reason,
    podio: summary.ranking.slice(0, 5).map((row) => ({
      posicion: row.position,
      nombre: row.name,
      puntos: row.points,
      aciertos: row.correctCount,
    })),
  };
}

/**
 * Es una arena: el proyector no juega, asi que no hay puntaje propio que
 * emitir. Se emite el del ganador, que es el numero que la sala se lleva.
 */
export function pinturilloPoints(ranking: readonly LiveRankEntry[]): number {
  return ranking[0]?.points ?? 0;
}

/* ------------------------------------------------------------------ */
/* Textos del telefono                                                  */
/* ------------------------------------------------------------------ */

export type GuessNotice = {
  verdict: GuessVerdict;
  points: number;
  position: number;
};

/** Lo que ve una sola persona en su telefono, y nadie mas. */
export function guessNotice(notice: GuessNotice): string {
  switch (notice.verdict) {
    case "correct":
      return notice.position === 1
        ? `¡Acertaste, y primero! +${notice.points}`
        : `¡Acertaste! +${notice.points} · ${notice.position}.º en adivinar`;
    case "near":
      // Solo a esa persona: proyectarlo le regalaria la palabra a la sala.
      return "¡Casi! Te falta una letra.";
    case "blocked":
      return "Ese intento no se proyecta. Probá con la palabra.";
    case "wrong":
      return "";
  }
}

export function roundSummary(correctCount: number, eligible: number, word: string): string {
  if (correctCount === 0) return `Nadie acertó “${word}”.`;
  if (correctCount === 1) return `Una persona acertó “${word}”.`;
  return `${correctCount} de ${eligible} acertaron “${word}”.`;
}
