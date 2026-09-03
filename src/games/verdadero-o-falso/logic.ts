import type { ControlOption, ControlSpec } from "@/core/contract/control";
import {
  bool,
  num,
  records,
  str,
  type SettingsRecord,
  type SettingsValues,
} from "@/core/contract/settings";
import type { Rng } from "@/core/engine/rng";
import type { LiveAnswer, LiveParticipant, LiveRoundPhase } from "@/core/corporate/liveRound";
import type { BooleanQuestion } from "@/core/corporate/question.types";
import {
  DECKS,
  DECK_IDS,
  MAX_SAME_ANSWER_RUN,
  MAX_STATEMENT_LENGTH,
  isDeckId,
  type DeckId,
  type Statement,
} from "./content";

/**
 * Lo unico propio de C6: el **formato de supervivencia**.
 *
 * La maquina de fases, la medicion de tiempo en el host, el descuento de medio
 * RTT, el cierre de ventana, el descarte de tardias, la entrada tardia y el
 * puntaje por acierto ya viven en `core/corporate/liveRound.ts` y se usan
 * enteros. Aca esta lo que esa capa no puede saber: quien sigue en carrera,
 * quien vuelve por la repesca y quien gana el ranking de honor.
 *
 * Todo puro y determinista: sin relojes, sin timers, sin red y sin React. El
 * componente le pasa los veredictos de cada afirmacion y recibe listas.
 *
 * La regla que ordena el archivo entero: **nadie deja de jugar.** Caer cambia
 * de carrera, no saca de la sala. Por eso `closeSurvivalItem` sigue sumando
 * `answerPoints` a los eliminados y por eso existe `honorRanking`.
 */

/* ------------------------------------------------------------------ */
/* Reglas                                                              */
/* ------------------------------------------------------------------ */

export type SurvivalMode = "supervivencia" | "puntos";

export const MODE_OPTIONS: ReadonlyArray<{ value: SurvivalMode; label: string }> = [
  { value: "supervivencia", label: "Supervivencia (con repesca)" },
  { value: "puntos", label: "Sólo puntos (todos juegan las 10)" },
];

export type SurvivalRules = {
  mode: SurvivalMode;
  /** Afirmacion de repesca, 1-based. 0 = sin repesca. */
  reviveAt: number;
  /** +150 por cada afirmacion superada estando vivo. */
  survivedBonus: number;
  /** +500 al que sobrevive las 10. */
  finisherBonus: number;
};

export const DEFAULT_RULES: SurvivalRules = {
  mode: "supervivencia",
  reviveAt: 6,
  survivedBonus: 150,
  finisherBonus: 500,
};

/* ------------------------------------------------------------------ */
/* Contenido: de administrables a afirmaciones                         */
/* ------------------------------------------------------------------ */

function rowText(row: SettingsRecord, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Una fila del panel se convierte en afirmacion solo si tiene texto y
 * explicacion: una afirmacion sin explicacion reparte puntos y no ensena nada,
 * que es exactamente el verdadero-o-falso que este juego evita.
 *
 * El recorte a 90 caracteres se hace aca y no solo en el panel: el contenido
 * puede llegar de localStorage viejo, y una afirmacion que no se lee en dos
 * segundos rompe el juego mas que perder media frase.
 */
export function parseStatements(rows: readonly SettingsRecord[], deckId: DeckId): Statement[] {
  const out: Statement[] = [];
  rows.forEach((row, index) => {
    const text = rowText(row, "text").slice(0, MAX_STATEMENT_LENGTH);
    const explain = rowText(row, "explain");
    if (text === "" || explain === "") return;
    out.push({ id: `${deckId}-${index + 1}`, text, answer: row["answer"] === true, explain });
  });
  return out;
}

/**
 * Si con lo que queda todavia se puede terminar sin pasarse de `maxRun`.
 *
 * Las que quedan del mismo signo tienen que entrar en los huecos que abren las
 * del otro —`otherLeft + 1` grupos de a `maxRun`, descontando la tirada que ya
 * viene abierta— y viceversa. Sin esta cuenta, mirar solo la tirada actual
 * gasta las falsas al principio y deja tres verdaderas juntas al final, que es
 * justo el patron que se queria evitar.
 */
function fits(runLength: number, sameLeft: number, otherLeft: number, maxRun: number): boolean {
  return sameLeft <= maxRun * (otherLeft + 1) - runLength && otherLeft <= maxRun * (sameLeft + 1);
}

/**
 * Baraja sin dejar tres respuestas iguales seguidas.
 *
 * Un shuffle comun rompe justo la propiedad que hace que la sala lea en vez de
 * jugar al patron: con diez afirmaciones, muchas semillas dejan una tirada de
 * tres o mas. Toma siempre la primera del mazo barajado que no rompa la regla,
 * asi que sigue siendo azar sembrado y no un orden armado a mano.
 */
export function orderStatements(
  items: readonly Statement[],
  rng: Rng,
  maxRun: number = MAX_SAME_ANSWER_RUN,
): Statement[] {
  const pool = rng.shuffle(items);
  const out: Statement[] = [];
  let runValue: boolean | null = null;
  let runLength = 0;
  let truesLeft = pool.filter((item) => item.answer).length;

  while (pool.length > 0) {
    const falsesLeft = pool.length - truesLeft;

    const allowed = (answer: boolean): boolean => {
      const nextRun = answer === runValue ? runLength + 1 : 1;
      if (nextRun > maxRun) return false;
      const sameLeft = (answer ? truesLeft : falsesLeft) - 1;
      const otherLeft = answer ? falsesLeft : truesLeft;
      return fits(nextRun, sameLeft, otherLeft, maxRun);
    };

    // Si el contenido no esta parejo puede no haber ninguna jugada limpia. Se
    // sigue con la primera: la tirada larga la denuncia el test del contenido,
    // no la esconde el barajado.
    const index = Math.max(0, pool.findIndex((item) => allowed(item.answer)));
    const picked = pool.splice(index, 1)[0];
    if (!picked) break;

    out.push(picked);
    if (picked.answer) truesLeft--;
    if (picked.answer === runValue) {
      runLength++;
    } else {
      runValue = picked.answer;
      runLength = 1;
    }
  }

  return out;
}

export type RoundContent = {
  deckId: DeckId;
  /** El nombre del juego, para la sala de espera del proyector. */
  title: string;
  statements: readonly Statement[];
  rules: SurvivalRules;
  /** Ventana de respuesta en ms. Pisa la de `SURVIVAL_ROUND_CONFIG`. */
  answerMs: number;
};

/**
 * Lee los administrables y arma la ronda. El azar sale del PRNG sembrado y de
 * ningun otro lado: dos corridas con la misma semilla tienen que dar la misma
 * tanda de afirmaciones en el mismo orden.
 */
export function buildRound(values: SettingsValues, rng: Rng): RoundContent {
  const chosen = str(values, "deck", "seguridad");
  // "aleatorio" no es un mazo: es sacar uno con el PRNG sembrado, para que dos
  // proyectores con la misma semilla jueguen exactamente el mismo.
  const deckId: DeckId = isDeckId(chosen) ? chosen : rng.pick(DECK_IDS);

  const fromPanel = parseStatements(records(values, deckId), deckId);
  const base = fromPanel.length > 0 ? fromPanel : DECKS[deckId].statements;
  const shuffle = bool(values, "shuffleStatements", true);

  return {
    deckId,
    title: DECKS[deckId].title,
    statements: shuffle ? orderStatements(base, rng) : [...base],
    answerMs: Math.round(num(values, "answerSeconds", 5) * 1000),
    rules: {
      mode: str(values, "mode", DEFAULT_RULES.mode) === "puntos" ? "puntos" : "supervivencia",
      reviveAt: Math.round(num(values, "reviveAt", DEFAULT_RULES.reviveAt)),
      survivedBonus: Math.round(num(values, "survivedBonus", DEFAULT_RULES.survivedBonus)),
      finisherBonus: Math.round(num(values, "finisherBonus", DEFAULT_RULES.finisherBonus)),
    },
  };
}

/**
 * La afirmacion tal como la consume la ronda en vivo.
 *
 * La explicacion NO viaja adentro de la pregunta: `publicQuestion()` saca
 * `correct` y `weights`, pero no `help`, y el enunciado publico llega al
 * celular. La explicacion se busca por indice del lado del host y se muestra
 * recien en el cierre.
 */
export function toQuestion(statement: Statement): BooleanQuestion {
  return {
    id: statement.id,
    kind: "boolean",
    prompt: statement.text,
    correct: statement.answer,
    labels: { yes: "Verdadero", no: "Falso" },
  };
}

/* ------------------------------------------------------------------ */
/* Las dos opciones del celular                                         */
/* ------------------------------------------------------------------ */

/**
 * Circulo y rombo, no verde y rojo: en cualquier sala de 40 personas hay
 * alguien que no distingue los colores, y el criterio 8 pide que los dos
 * botones se separen en escala de grises.
 */
export const TRUE_SHAPE = "circle" as const;
export const FALSE_SHAPE = "diamond" as const;

/**
 * Los ids llevan el numero de afirmacion adentro por dos motivos: el mando
 * limpia lo tocado cuando cambian los ids de las opciones —si fueran fijos, la
 * eleccion de la afirmacion 3 quedaria marcada en la 4— y una respuesta vieja
 * que llega tarde se puede reconocer y descartar sin mirar el reloj.
 */
export function optionsFor(itemNumber: number): readonly ControlOption[] {
  return [
    { id: `v${itemNumber}`, label: "Verdadero", shape: TRUE_SHAPE },
    { id: `f${itemNumber}`, label: "Falso", shape: FALSE_SHAPE },
  ];
}

/** null si el id no corresponde a esta afirmacion: es de otra ronda o es basura. */
export function parsePick(optionId: string, itemNumber: number): boolean | null {
  if (optionId === `v${itemNumber}`) return true;
  if (optionId === `f${itemNumber}`) return false;
  return null;
}

/* ------------------------------------------------------------------ */
/* Lo que ve el celular                                                 */
/* ------------------------------------------------------------------ */

export type PhoneView = {
  phase: LiveRoundPhase;
  /** 1-based. */
  itemNumber: number;
  totalItems: number;
  statement: string;
  /** Este telefono esta fuera de la carrera de supervivencia. */
  eliminated: boolean;
  /** Esta afirmacion es la de repesca y este telefono la esta esperando. */
  revivePending: boolean;
  /** Este telefono contesto despues del cierre y hay que decirselo. */
  discarded: boolean;
  /** ms que quedan de la ventana. Solo cuenta durante `respuesta`. */
  remainingMs: number;
  /** La ventana completa: sin esto el telefono tendria que asumir una duracion. */
  windowMs: number;
};

export const NOTICE_ELIMINATED = "Seguís jugando por puntos";
export const NOTICE_REVIVE = "REPESCA — acertá y volvés";
export const NOTICE_LATE = "Llegaste después del cierre";

function noticeFor(view: PhoneView): string | undefined {
  if (view.discarded) return NOTICE_LATE;
  if (view.revivePending) return NOTICE_REVIVE;
  if (view.eliminated) return NOTICE_ELIMINATED;
  return undefined;
}

/**
 * El `ControlSpec` de una fase.
 *
 * Tres decisiones que son el juego:
 *
 * - `enabled` solo en `respuesta`. Durante los 2 s de lectura los botones se
 *   ven y no responden: con una ventana de 5 s, sin ese margen gana el reflejo
 *   y no el criterio, que es justo lo que el juego dice medir.
 * - Caer no muestra un cartel de derrota: muestra `NOTICE_ELIMINATED`, porque
 *   es un cambio de carrera y no el final del juego.
 * - `picked` viaja en null a proposito: el mando ya marca lo tocado en el acto
 *   con su estado local, y esperar la confirmacion del host se siente como
 *   lag. La verdad del puntaje igual la tiene el host.
 *
 * El aviso es de UNA persona, no de la sala: quien sigue en carrera no tiene
 * por que leer "seguis jugando por puntos". Por eso este spec se manda
 * dirigido, con el id del participante, y no difundido.
 */
export function controlSpecFor(view: PhoneView): ControlSpec {
  if (view.phase === "anuncio") {
    return { layout: "wait", message: `Afirmación ${view.itemNumber} de ${view.totalItems}` };
  }
  if (view.phase === "ranking") {
    return { layout: "wait", message: "Se terminó. Mirá la pantalla grande." };
  }

  const notice = noticeFor(view);
  const answering = view.phase === "respuesta";
  return {
    layout: "buttons",
    options: optionsFor(view.itemNumber),
    enabled: answering,
    picked: null,
    question: view.statement,
    ...(notice ? { notice } : {}),
    // La barra viaja con su ventana y solo mientras se puede contestar: una
    // barra quieta durante la lectura dice que el tiempo ya corre, y sin
    // `windowMs` el telefono tendria que asumir una duracion que no es la de
    // este juego.
    ...(answering
      ? { remainingMs: Math.max(0, Math.min(view.windowMs, view.remainingMs)), windowMs: view.windowMs }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Supervivencia                                                        */
/* ------------------------------------------------------------------ */

export type SurvivalEntry = {
  participantId: string;
  name: string;
  /** En carrera. En modo `puntos` no deja de serlo nunca. */
  alive: boolean;
  /** Afirmacion en la que cayo, 1-based. null si nunca cayo. */
  fellAt: number | null;
  /** Afirmacion en la que volvio por repesca. */
  revivedAt: number | null;
  /** Cuantas supero estando vivo. Es lo que cobra el bono de +150. */
  survivedItems: number;
  /** Solo lo que salio de contestar. Es el ranking de honor. */
  answerPoints: number;
  correctCount: number;
  answeredCount: number;
};

export type SurvivalState = {
  readonly rules: SurvivalRules;
  readonly totalItems: number;
  entries: Map<string, SurvivalEntry>;
  /** Cuantas afirmaciones ya cerraron. */
  closedItems: number;
};

export function createSurvivalState(options: {
  rules: SurvivalRules;
  totalItems: number;
}): SurvivalState {
  return {
    rules: options.rules,
    totalItems: options.totalItems,
    entries: new Map(),
    closedItems: 0,
  };
}

/**
 * Quien entra tarde entra vivo. Cobra desde la afirmacion que le toca, igual
 * que en la ronda: el `fromItem` de `liveRound` ya lo resuelve y aca no hace
 * falta repetirlo.
 */
export function joinSurvival(state: SurvivalState, participantId: string, name: string): SurvivalEntry {
  const existing = state.entries.get(participantId);
  if (existing) return existing;
  const entry: SurvivalEntry = {
    participantId,
    name,
    alive: true,
    fellAt: null,
    revivedAt: null,
    survivedItems: 0,
    answerPoints: 0,
    correctCount: 0,
    answeredCount: 0,
  };
  state.entries.set(participantId, entry);
  return entry;
}

/** Lo que le paso a una persona en una afirmacion. `correct: null` = no contesto. */
export type ItemVerdict = {
  participantId: string;
  correct: boolean | null;
  /** Lo que cobro por contestar esta afirmacion. Alimenta el ranking de honor. */
  points: number;
};

/**
 * Traduce el cierre de la ronda compartida a veredictos.
 *
 * Incluye a los que NO contestaron, que es lo que hace posible eliminarlos: si
 * solo se miraran las respuestas que llegaron, callarse seria la jugada
 * perfecta. `fromItem` respeta la entrada tardia de `liveRound`: quien todavia
 * no jugaba esta afirmacion no puede caer en ella.
 */
export function verdictsFrom(
  participants: Iterable<LiveParticipant>,
  itemIndex: number,
  results: readonly LiveAnswer[],
): ItemVerdict[] {
  const byId = new Map(results.map((result) => [result.participantId, result]));
  const out: ItemVerdict[] = [];
  for (const participant of participants) {
    if (itemIndex < participant.fromItem) continue;
    const answer = byId.get(participant.id);
    out.push({
      participantId: participant.id,
      correct: answer ? answer.correct : null,
      points: answer ? answer.base + answer.bonus : 0,
    });
  }
  return out;
}

export type AwardReason = "sobrevivio" | "final";

/** Puntos que no salen de contestar. El componente los aplica con `awardPoints`. */
export type SurvivalAward = {
  participantId: string;
  points: number;
  reason: AwardReason;
};

export type SurvivalItemReport = {
  /** 1-based. */
  itemNumber: number;
  aliveBefore: number;
  aliveAfter: number;
  fell: readonly string[];
  revived: readonly string[];
  survived: readonly string[];
  awards: readonly SurvivalAward[];
  /** Porcentaje de los que estaban vivos que cayo con esta afirmacion. */
  fellPct: number;
  /** Cayo mas de la mitad de la sala: es el momento que genera conversacion. */
  wipeout: boolean;
};

/**
 * Cierra una afirmacion.
 *
 * Reglas del formato, en orden:
 *
 * - **No contestar cuenta como error.** Si callarse dejara vivo, la estrategia
 *   optima seria no tocar nada, y el juego se termina en la afirmacion 1.
 * - **Errar no resta.** Ya cuesta la eliminacion; restar ademas es castigar
 *   dos veces. Los puntos de contestar los pone `survivalScorer` y nunca son
 *   negativos.
 * - **El eliminado sigue sumando.** Su acierto entra igual a `answerPoints`,
 *   que es el ranking de honor. Nadie deja de jugar.
 * - **La repesca devuelve a la carrera** a quien acierte esa afirmacion, y no
 *   le paga el bono de supervivencia: no la corrio estando vivo.
 */
export function closeSurvivalItem(
  state: SurvivalState,
  itemNumber: number,
  verdicts: readonly ItemVerdict[],
): SurvivalItemReport {
  const { rules } = state;
  const survival = rules.mode === "supervivencia";
  const aliveBefore = aliveCount(state);

  const fell: string[] = [];
  const revived: string[] = [];
  const survived: string[] = [];
  const awards: SurvivalAward[] = [];

  for (const verdict of verdicts) {
    const entry = state.entries.get(verdict.participantId);
    if (!entry) continue;

    if (verdict.correct !== null) entry.answeredCount++;
    if (verdict.correct === true) entry.correctCount++;
    entry.answerPoints += Math.max(0, verdict.points);

    if (!survival) continue;

    if (entry.alive) {
      if (verdict.correct === true) {
        entry.survivedItems++;
        survived.push(entry.participantId);
        if (rules.survivedBonus > 0) {
          awards.push({
            participantId: entry.participantId,
            points: rules.survivedBonus,
            reason: "sobrevivio",
          });
        }
      } else {
        entry.alive = false;
        entry.fellAt = itemNumber;
        fell.push(entry.participantId);
      }
      continue;
    }

    if (rules.reviveAt > 0 && itemNumber === rules.reviveAt && verdict.correct === true) {
      entry.alive = true;
      entry.revivedAt = itemNumber;
      revived.push(entry.participantId);
    }
  }

  state.closedItems = Math.max(state.closedItems, itemNumber);

  const fellPct = aliveBefore > 0 ? Math.round((fell.length / aliveBefore) * 100) : 0;
  return {
    itemNumber,
    aliveBefore,
    aliveAfter: aliveCount(state),
    fell,
    revived,
    survived,
    awards,
    fellPct,
    // Estricto: la mitad justa no es "mas de la mitad".
    wipeout: fell.length > 0 && fell.length * 2 > aliveBefore,
  };
}

/**
 * El +500 del que sobrevivio las diez. Se pide `survivedItems === totalItems`
 * y no solo "sigue vivo": quien entro en la afirmacion 5 o volvio por repesca
 * llega vivo al final sin haber sobrevivido las diez, y cobrarlo igual haria
 * del ranking una loteria de a que hora escaneaste el QR.
 */
export function finishSurvival(state: SurvivalState): readonly SurvivalAward[] {
  if (state.rules.mode !== "supervivencia" || state.rules.finisherBonus <= 0) return [];
  const awards: SurvivalAward[] = [];
  for (const entry of state.entries.values()) {
    if (!entry.alive || entry.fellAt !== null) continue;
    if (entry.survivedItems < state.totalItems) continue;
    awards.push({
      participantId: entry.participantId,
      points: state.rules.finisherBonus,
      reason: "final",
    });
  }
  return awards;
}

export function aliveCount(state: SurvivalState): number {
  let count = 0;
  for (const entry of state.entries.values()) if (entry.alive) count++;
  return count;
}

/* ------------------------------------------------------------------ */
/* Los dos rankings                                                     */
/* ------------------------------------------------------------------ */

export type SurvivalRankEntry = {
  participantId: string;
  name: string;
  position: number;
  /** Puntos de contestar. Es lo comparable entre quien sigue vivo y quien cayo. */
  points: number;
  correctCount: number;
  alive: boolean;
  fellAt: number | null;
  survivedItems: number;
};

function toRank(entry: SurvivalEntry, position: number): SurvivalRankEntry {
  return {
    participantId: entry.participantId,
    name: entry.name,
    position,
    points: entry.answerPoints,
    correctCount: entry.correctCount,
    alive: entry.alive,
    fellAt: entry.fellAt,
    survivedItems: entry.survivedItems,
  };
}

/**
 * El ranking de honor: por lo que se acerto, sin los bonos de supervivencia.
 *
 * Entran todos, vivos y caidos, porque esa es la unica forma de que el que
 * cayo en la 2 y acerto nueve de diez le pueda ganar a alguien. Los empates se
 * rompen por aciertos y despues por nombre, nunca al azar.
 */
export function honorRanking(state: SurvivalState): SurvivalRankEntry[] {
  return [...state.entries.values()]
    .sort(
      (a, b) =>
        b.answerPoints - a.answerPoints ||
        b.correctCount - a.correctCount ||
        a.name.localeCompare(b.name, "es"),
    )
    .map((entry, index) => toRank(entry, index + 1));
}

/** Los que siguen en carrera. Es el marcador real del juego. */
export function survivorRanking(state: SurvivalState): SurvivalRankEntry[] {
  return [...state.entries.values()]
    .filter((entry) => entry.alive)
    .sort(
      (a, b) =>
        b.survivedItems - a.survivedItems ||
        b.answerPoints - a.answerPoints ||
        a.name.localeCompare(b.name, "es"),
    )
    .map((entry, index) => toRank(entry, index + 1));
}
