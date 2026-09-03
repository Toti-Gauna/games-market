import type { Rng } from "@/core/engine/rng";

/**
 * X3 · Ludo — la logica pura.
 *
 * Todo lo que decide una partida vive aca y no toca el DOM, el canvas ni la
 * red: el tablero, la tirada, que movimientos son legales, **por que no lo son
 * los otros**, la captura, la entrada a meta y la victoria.
 *
 * Dos cosas la hacen distinta de la logica de los otros juegos del catalogo:
 *
 * 1. **El motivo de lo ilegal es un dato de primera clase.** `movesFor` no
 *    devuelve "estas dos se pueden mover": devuelve una entrada por ficha, y
 *    las que no se pueden traen `reason`. Ese motivo es lo que el mando pinta
 *    en `disabledReason` ("en casa, necesitas 5 o 6"), y es lo que ensena las
 *    reglas sin tutorial. Un boton apagado y mudo solo confunde.
 * 2. **El dado lo tira el host, con el PRNG sembrado.** `rollDie` pide un
 *    `Rng`, asi que no hay forma de que un numero entre desde afuera. Con la
 *    semilla, ademas, la partida entera es reproducible, que es lo que permite
 *    depurarla.
 *
 * El modelo de posicion es un solo entero por ficha, `progress`:
 *
 * ```
 *  -1                       en casa
 *  0 .. trackLength-1       pista comun, relativo a la entrada del color
 *  trackLength .. finish    recta final del color
 *  finish                   la meta
 * ```
 *
 * Con eso "avanzar" es sumar, "entrar a meta" es comparar contra `finish` y
 * "pasarse" es que la suma se pase. La conversion a casilla absoluta —lo unico
 * que necesita saber quien captura a quien— la hace `trackSquareOf`.
 */

/** Cuatro colores, siempre. Los asientos que no tienen persona los juega un bot. */
export const LUDO_SEATS = 4;

/** Casillas de la recta final por color. La ultima es la meta. */
export const HOME_LENGTH = 4;

/** Caras del dado. Sacar la cara maxima es lo que da tirada extra. */
export const DIE_FACES = 6;

/**
 * Tope de tiradas extra por turno.
 *
 * Es la regla clasica de los tres seises seguidos, y ademas es la unica
 * garantia dura de que un turno termina: sin tope, una racha de seises con
 * captura podria no soltar el turno nunca.
 */
export const MAX_EXTRA_ROLLS = 2;

export type LudoRules = {
  seats: number;
  tokensPerPlayer: number;
  /** Casillas comunes. Multiplo de `seats`: cada color entra en su cuarto. */
  trackLength: number;
  /** Casillas de la recta final. La ultima es la meta. */
  homeLength: number;
  /** Con que numeros se sale de casa. Ordenados de menor a mayor. */
  entryRolls: readonly number[];
  dieFaces: number;
  /** Tirada extra al sacar la cara maxima o al capturar. */
  extraRoll: boolean;
  turnMs: number;
  pointsPerStep: number;
  pointsPerCapture: number;
  pointsPerToken: number;
  pointsWin: number;
};

export const DEFAULT_RULES: LudoRules = {
  seats: LUDO_SEATS,
  tokensPerPlayer: 2,
  trackLength: 32,
  homeLength: HOME_LENGTH,
  entryRolls: [5, 6],
  dieFaces: DIE_FACES,
  extraRoll: true,
  turnMs: 15_000,
  pointsPerStep: 10,
  pointsPerCapture: 150,
  pointsPerToken: 400,
  pointsWin: 500,
};

/**
 * Que hace el juego en este instante.
 *
 * `moving` existe para que el proyector anime la ficha casilla por casilla:
 * la logica ya movio todo, pero el turno no se cierra hasta que la animacion
 * termina y alguien llama `finishMove`.
 */
export type LudoPhase = "roll" | "choose" | "moving" | "over";

/** Por que una ficha NO se puede mover. Es lo que alimenta `disabledReason`. */
export type MoveBlock = "finished" | "needs-entry" | "overshoot" | "own-token";

export type MoveOption = {
  /** Indice de la ficha dentro del jugador, 0..tokensPerPlayer-1. */
  token: number;
  from: number;
  /** Progreso destino. Igual a `from` cuando el movimiento no es legal. */
  to: number;
  legal: boolean;
  /** null cuando es legal. */
  reason: MoveBlock | null;
  /** Indice global de la ficha rival que se come, o -1. */
  captures: number;
  /** Solo con `overshoot`: con que numero entraria justo. */
  exact: number;
  /** true cuando el destino es la meta. */
  reachesGoal: boolean;
};

export type LudoState = {
  rules: LudoRules;
  /** Progreso de cada ficha, indexada por `tokenIndex`. */
  progress: Int16Array;
  turn: number;
  phase: LudoPhase;
  /** 0 = todavia no se tiro en este turno. */
  die: number;
  turnMsLeft: number;
  /** Tiradas extra ya gastadas en este turno. */
  extras: number;
  /** Sube con cada tirada. Es el id del haptico y el de la animacion del dado. */
  rolls: number;
  /** Sube con cada ficha movida o turno pasado. */
  moves: number;
  /** Sube cada vez que el turno cambia de mano. */
  turns: number;
  capturesBy: Int32Array;

  /* Lo que dejo el ultimo movimiento. El proyector lo lee para animar y el
     mando para saber a quien le vibra el telefono. */
  lastToken: number;
  lastFrom: number;
  lastTo: number;
  /** Indice global de la ficha comida, o -1. */
  lastCaptured: number;
  /** Desde que progreso volo la ficha comida. Solo sirve para la animacion. */
  lastCapturedFrom: number;
  lastReachedGoal: boolean;

  /** true cuando el movimiento en curso concede otra tirada. */
  pendingExtra: boolean;
  /** true cuando la tirada la disparo el reloj y no una persona. */
  autoTurn: boolean;
  winner: number;
  over: boolean;
};

/* ------------------------------------------------------------------ */
/* Geometria del tablero                                                */
/* ------------------------------------------------------------------ */

export function tokenIndex(rules: LudoRules, seat: number, token: number): number {
  return seat * rules.tokensPerPlayer + token;
}

export function seatOfToken(rules: LudoRules, index: number): number {
  return Math.floor(index / rules.tokensPerPlayer);
}

/** Progreso de la meta. Llegar exactamente ahi es meter la ficha. */
export function finishProgress(rules: LudoRules): number {
  return rules.trackLength + rules.homeLength - 1;
}

/** Casilla absoluta donde entra cada color. Tambien es su casilla segura. */
export function entrySquare(rules: LudoRules, seat: number): number {
  const quarter = rules.trackLength / rules.seats;
  return (Math.round(seat * quarter) % rules.trackLength + rules.trackLength) % rules.trackLength;
}

/** Casilla comun donde esta la ficha, o -1 si esta en casa o en la recta final. */
export function trackSquareOf(rules: LudoRules, seat: number, progress: number): number {
  if (progress < 0 || progress >= rules.trackLength) return -1;
  return (entrySquare(rules, seat) + progress) % rules.trackLength;
}

/**
 * Las cuatro casillas seguras son las cuatro entradas.
 *
 * Que sean las entradas y no cuatro cualquiera importa: es la unica forma de
 * que sacar una ficha no sea regalarla al que viene atras.
 */
export function isSafeSquare(rules: LudoRules, square: number): boolean {
  if (square < 0) return false;
  const quarter = rules.trackLength / rules.seats;
  return square % quarter === 0;
}

/** Casillas recorridas por una ficha. Estar recien salido ya cuenta una. */
export function travelled(progress: number): number {
  return progress < 0 ? 0 : progress + 1;
}

export function advanceOf(state: LudoState, seat: number): number {
  let total = 0;
  for (let t = 0; t < state.rules.tokensPerPlayer; t++) {
    total += travelled(state.progress[tokenIndex(state.rules, seat, t)] ?? -1);
  }
  return total;
}

export function tokensAtGoal(state: LudoState, seat: number): number {
  const goal = finishProgress(state.rules);
  let total = 0;
  for (let t = 0; t < state.rules.tokensPerPlayer; t++) {
    if ((state.progress[tokenIndex(state.rules, seat, t)] ?? -1) === goal) total++;
  }
  return total;
}

export function tokensAtBase(state: LudoState, seat: number): number {
  let total = 0;
  for (let t = 0; t < state.rules.tokensPerPlayer; t++) {
    if ((state.progress[tokenIndex(state.rules, seat, t)] ?? -1) < 0) total++;
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Estado                                                               */
/* ------------------------------------------------------------------ */

export function createLudoState(rules: LudoRules, rng: Rng): LudoState {
  const total = rules.seats * rules.tokensPerPlayer;
  const progress = new Int16Array(total).fill(-1);
  // Quien arranca sale del PRNG sembrado, no de "siempre el asiento 0": con
  // cuatro colores, empezar es una ventaja chica pero real.
  const turn = rng.int(0, rules.seats - 1);

  return {
    rules,
    progress,
    turn,
    phase: "roll",
    die: 0,
    turnMsLeft: rules.turnMs,
    extras: 0,
    rolls: 0,
    moves: 0,
    turns: 0,
    capturesBy: new Int32Array(rules.seats),
    lastToken: -1,
    lastFrom: -1,
    lastTo: -1,
    lastCaptured: -1,
    lastCapturedFrom: -1,
    lastReachedGoal: false,
    pendingExtra: false,
    autoTurn: false,
    winner: -1,
    over: false,
  };
}

/**
 * La tirada. **Solo el host la llama, y siempre con el PRNG sembrado.**
 *
 * Un dado tirado en el telefono es un dado que alguien puede elegir: por eso
 * el celular manda "tire" y nunca "saque un 6". Es la misma regla que rige
 * todo el proyecto —el host recibe input, nunca resultados— pero aca es
 * especialmente evidente.
 */
export function rollDie(state: LudoState, rng: Rng, auto = false): number {
  if (state.over || state.phase !== "roll") return state.die;
  state.die = rng.int(1, state.rules.dieFaces);
  state.rolls++;
  state.phase = "choose";
  if (auto) state.autoTurn = true;
  return state.die;
}

/* ------------------------------------------------------------------ */
/* Movimientos legales, y el motivo de los que no lo son                */
/* ------------------------------------------------------------------ */

/** Ficha propia parada en ese progreso, o -1. Nunca se llama con progreso < 0. */
function ownTokenAt(state: LudoState, seat: number, progress: number): number {
  for (let t = 0; t < state.rules.tokensPerPlayer; t++) {
    const index = tokenIndex(state.rules, seat, t);
    if ((state.progress[index] ?? -1) === progress) return index;
  }
  return -1;
}

/** Ficha rival parada en esa casilla comun, o -1. */
function rivalTokenOnSquare(state: LudoState, seat: number, square: number): number {
  const rules = state.rules;
  for (let s = 0; s < rules.seats; s++) {
    if (s === seat) continue;
    for (let t = 0; t < rules.tokensPerPlayer; t++) {
      const index = tokenIndex(rules, s, t);
      const progress = state.progress[index] ?? -1;
      if (progress < 0 || progress >= rules.trackLength) continue;
      if (trackSquareOf(rules, s, progress) === square) return index;
    }
  }
  return -1;
}

/**
 * Una entrada por ficha: las que se pueden mover y **las que no, con su
 * motivo**.
 *
 * El orden de los chequeos es el orden en que una persona los piensa, y es lo
 * que hace que el mensaje sea el util: si la ficha ya esta en la meta no tiene
 * sentido decirle que se pasaria, y si esta en casa el numero que necesita es
 * mas informativo que cualquier otra cosa.
 */
export function movesFor(state: LudoState, seat: number, die: number): MoveOption[] {
  const rules = state.rules;
  const goal = finishProgress(rules);
  const options: MoveOption[] = [];

  for (let token = 0; token < rules.tokensPerPlayer; token++) {
    const from = state.progress[tokenIndex(rules, seat, token)] ?? -1;
    const option: MoveOption = {
      token,
      from,
      to: from,
      legal: false,
      reason: null,
      captures: -1,
      exact: 0,
      reachesGoal: false,
    };
    options.push(option);

    if (die <= 0) {
      // Todavia no se tiro: no hay nada que evaluar y tampoco un motivo real.
      continue;
    }

    if (from === goal) {
      option.reason = "finished";
      continue;
    }

    let to: number;
    if (from < 0) {
      // De casa se sale solo con los numeros de entrada, y siempre a la
      // casilla de entrada del color: el resto de la tirada no se gasta.
      if (!rules.entryRolls.includes(die)) {
        option.reason = "needs-entry";
        continue;
      }
      to = 0;
    } else {
      to = from + die;
      if (to > goal) {
        option.reason = "overshoot";
        option.exact = goal - from;
        continue;
      }
    }

    // La meta admite las dos fichas: es justamente donde tienen que terminar
    // las dos. En cualquier otro lado la propia estorba.
    if (to !== goal && ownTokenAt(state, seat, to) >= 0) {
      option.reason = "own-token";
      continue;
    }

    option.legal = true;
    option.to = to;
    option.reachesGoal = to === goal;

    const square = trackSquareOf(rules, seat, to);
    // En las casillas seguras no se captura: conviven. Es lo que hace que
    // salir de casa no sea regalarle la ficha al que viene atras.
    if (square >= 0 && !isSafeSquare(rules, square)) {
      option.captures = rivalTokenOnSquare(state, seat, square);
    }
  }

  return options;
}

/** Los movimientos del que tiene el turno con el dado que ya salio. */
export function currentMoves(state: LudoState): MoveOption[] {
  return movesFor(state, state.turn, state.die);
}

export function legalCount(options: readonly MoveOption[]): number {
  let count = 0;
  for (const option of options) if (option.legal) count++;
  return count;
}

/**
 * El indice de la unica ficha que se puede mover, o -1 si hay cero o mas de
 * una.
 *
 * Existe para no hacer elegir cuando no hay eleccion: con un solo movimiento
 * posible, el juego lo hace solo tras un instante.
 */
export function onlyLegalMove(options: readonly MoveOption[]): number {
  let found = -1;
  for (const option of options) {
    if (!option.legal) continue;
    if (found >= 0) return -1;
    found = option.token;
  }
  return found;
}

/** Un solo lugar arma el texto de por que una ficha no se puede mover. */
export function blockReasonText(option: MoveOption, rules: LudoRules): string {
  switch (option.reason) {
    case "finished":
      return "ya llegó a la meta";
    case "needs-entry":
      return `en casa, necesitás ${joinNumbers(rules.entryRolls)}`;
    case "overshoot":
      return `te pasarías de la meta: entra justo con ${option.exact}`;
    case "own-token":
      return "tu otra ficha ya está ahí";
    default:
      return "";
  }
}

/** Donde esta una ficha, dicho como lo diria una persona. */
export function placeText(rules: LudoRules, seat: number, progress: number): string {
  if (progress < 0) return "en casa";
  if (progress === finishProgress(rules)) return "en la meta";
  if (progress >= rules.trackLength) {
    return `recta final ${progress - rules.trackLength + 1} de ${rules.homeLength}`;
  }
  return `casilla ${trackSquareOf(rules, seat, progress) + 1}`;
}

/** Que pasaria si se mueve esa ficha. Es la segunda linea del boton del mando. */
export function moveHintText(option: MoveOption, rules: LudoRules, seat: number): string {
  if (!option.legal) return placeText(rules, seat, option.from);
  if (option.captures >= 0) return `come una ficha en la ${trackSquareOf(rules, seat, option.to) + 1}`;
  if (option.reachesGoal) return "¡entra a la meta!";
  if (option.from < 0) return "sale de casa";
  if (option.to >= rules.trackLength) {
    return `recta final ${option.to - rules.trackLength + 1} de ${rules.homeLength}`;
  }
  return `${placeText(rules, seat, option.from)} → ${trackSquareOf(rules, seat, option.to) + 1}`;
}

function joinNumbers(values: readonly number[]): string {
  if (values.length === 0) return "—";
  if (values.length === 1) return String(values[0]);
  return values.slice(0, -1).join(", ") + " o " + values[values.length - 1];
}

/* ------------------------------------------------------------------ */
/* Aplicar un movimiento                                                */
/* ------------------------------------------------------------------ */

function extraAllowed(state: LudoState, captured: boolean): boolean {
  if (!state.rules.extraRoll) return false;
  if (state.extras >= MAX_EXTRA_ROLLS) return false;
  return captured || state.die === state.rules.dieFaces;
}

/**
 * Mueve la ficha y resuelve captura, meta y victoria.
 *
 * Deja el estado en `moving`: la logica ya termino, pero el turno no se cierra
 * hasta que el proyector termine de animar y llame `finishMove`. Sin esa
 * pausa, la ficha aparece en el destino y no se entiende que se movio.
 *
 * Devuelve false si el movimiento no era legal. Un input que llega tarde —el
 * dedo y el reloj de 15 s pueden cruzarse— se descarta aca y no rompe nada.
 */
export function applyMove(state: LudoState, token: number): boolean {
  if (state.over || state.phase !== "choose") return false;
  const rules = state.rules;
  const options = currentMoves(state);
  const option = options[token];
  if (!option || !option.legal) return false;

  const index = tokenIndex(rules, state.turn, token);
  state.progress[index] = option.to;

  state.lastToken = index;
  state.lastFrom = option.from;
  state.lastTo = option.to;
  state.lastReachedGoal = option.reachesGoal;
  state.lastCaptured = option.captures;
  state.lastCapturedFrom = option.captures >= 0 ? (state.progress[option.captures] ?? -1) : -1;

  if (option.captures >= 0) {
    // Caer en una ficha rival la manda a casa. Es el momento del juego.
    state.progress[option.captures] = -1;
    state.capturesBy[state.turn] = (state.capturesBy[state.turn] ?? 0) + 1;
  }

  state.moves++;
  state.pendingExtra = extraAllowed(state, option.captures >= 0);
  if (tokensAtGoal(state, state.turn) === rules.tokensPerPlayer) state.winner = state.turn;
  state.phase = "moving";
  return true;
}

/** Cierra la animacion del movimiento y resuelve a quien le toca. */
export function finishMove(state: LudoState): void {
  if (state.phase !== "moving") return;
  concludeTurn(state);
}

/**
 * Nadie se puede mover con este dado.
 *
 * Un 6 sin movimiento posible igual da otra tirada: es la regla clasica y
 * evita que un tablero trabado le coma el turno a alguien sin motivo.
 */
export function passTurn(state: LudoState): void {
  if (state.over || state.phase !== "choose") return;
  state.lastToken = -1;
  state.lastCaptured = -1;
  state.moves++;
  state.pendingExtra = extraAllowed(state, false);
  concludeTurn(state);
}

function concludeTurn(state: LudoState): void {
  if (state.winner >= 0) {
    state.over = true;
    state.phase = "over";
    return;
  }
  if (state.pendingExtra) {
    state.pendingExtra = false;
    state.extras++;
    state.die = 0;
    state.phase = "roll";
    // La tirada extra viene con reloj nuevo, y ademas se le perdona el
    // "jugo el reloj por vos": quien capturo estaba mirando.
    state.turnMsLeft = state.rules.turnMs;
    state.autoTurn = false;
    return;
  }
  nextTurn(state);
}

export function nextTurn(state: LudoState): void {
  const rules = state.rules;
  state.turn = (state.turn + 1) % rules.seats;
  state.turns++;
  state.phase = "roll";
  state.die = 0;
  state.extras = 0;
  state.pendingExtra = false;
  state.autoTurn = false;
  state.turnMsLeft = rules.turnMs;
  state.lastToken = -1;
  state.lastCaptured = -1;
  state.lastReachedGoal = false;
}

/* ------------------------------------------------------------------ */
/* Bots y jugada automatica                                             */
/* ------------------------------------------------------------------ */

export type BotSkill = "calmo" | "normal" | "filoso";

export function botSkillOf(raw: string): BotSkill {
  return raw === "calmo" || raw === "filoso" ? raw : "normal";
}

/**
 * Que tan buena es una jugada, en el orden que pide la spec:
 * capturar, meter en meta, sacar de casa, y despues avanzar la mas adelantada.
 *
 * Los pesos estan bien separados para que el desempate por avance —que vale
 * como mucho `finish`— no pueda dar vuelta una prioridad.
 */
function rankMove(state: LudoState, option: MoveOption, skill: BotSkill): number {
  const rules = state.rules;
  let score = option.to;
  if (option.captures >= 0) score += 4000;
  if (option.reachesGoal) score += 3000;
  if (option.from < 0) score += 2000;

  if (skill === "filoso") {
    const square = trackSquareOf(rules, state.turn, option.to);
    // Terminar en casilla segura vale poco pero desempata: es la unica
    // decision defensiva que un bot de Ludo puede tomar.
    if (square >= 0 && isSafeSquare(rules, square)) score += 60;
    else if (square >= 0 && threatened(state, state.turn, square)) score -= 90;
  }
  return score;
}

/** Hay un rival a tiro de un dado de esa casilla. Solo lo mira el bot filoso. */
function threatened(state: LudoState, seat: number, square: number): boolean {
  const rules = state.rules;
  for (let s = 0; s < rules.seats; s++) {
    if (s === seat) continue;
    for (let t = 0; t < rules.tokensPerPlayer; t++) {
      const progress = state.progress[tokenIndex(rules, s, t)] ?? -1;
      if (progress < 0 || progress >= rules.trackLength) continue;
      const from = trackSquareOf(rules, s, progress);
      const gap = (square - from + rules.trackLength) % rules.trackLength;
      if (gap >= 1 && gap <= rules.dieFaces) return true;
    }
  }
  return false;
}

/**
 * Que ficha mueve el bot. Devuelve -1 cuando no puede mover ninguna.
 *
 * No hace falta mas que la prioridad de la spec: un bot de Ludo demasiado
 * bueno frustra sin aportar, y la mayor parte del juego es el dado.
 */
export function chooseBotMove(
  state: LudoState,
  options: readonly MoveOption[],
  rng: Rng,
  skill: BotSkill,
): number {
  const legal = options.filter((option) => option.legal);
  if (legal.length === 0) return -1;
  if (legal.length === 1) return legal[0]?.token ?? -1;
  if (skill === "calmo") return rng.pick(legal).token;

  let best = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const option of legal) {
    const score = rankMove(state, option, skill);
    if (score > bestScore) {
      bestScore = score;
      best = option.token;
    }
  }
  return best;
}

/**
 * La jugada que hace el reloj cuando se agotan los 15 segundos.
 *
 * Es la misma prioridad del bot normal y sin azar: nadie espera a quien se
 * distrajo, pero tampoco se le arruina la partida moviendo cualquier cosa.
 */
export function autoMove(state: LudoState, options: readonly MoveOption[]): number {
  let best = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const option of options) {
    if (!option.legal) continue;
    const score = rankMove(state, option, "normal");
    if (score > bestScore) {
      bestScore = score;
      best = option.token;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Puntaje y resultado                                                  */
/* ------------------------------------------------------------------ */

/**
 * Avance + capturas + metas + victoria.
 *
 * Que el avance puntue es lo que hace que quien pierde igual se lleve un
 * numero que refleja como le fue. En un juego con tanta suerte, un puntaje
 * binario seria injusto.
 */
export function ludoPoints(state: LudoState, seat: number, won: boolean): number {
  const rules = state.rules;
  const advance = advanceOf(state, seat) * rules.pointsPerStep;
  const captures = (state.capturesBy[seat] ?? 0) * rules.pointsPerCapture;
  const goals = tokensAtGoal(state, seat) * rules.pointsPerToken;
  return Math.round(advance + captures + goals + (won ? rules.pointsWin : 0));
}

/**
 * Quien va ganando por avance total.
 *
 * Es la metrica con la que se decide si se acaba el tiempo, y se eligio porque
 * se entiende de un vistazo en el proyector. Los empates los rompe el asiento
 * mas bajo, que es arbitrario pero determinista.
 */
export function leaderSeat(state: LudoState): number {
  if (state.winner >= 0) return state.winner;
  let best = 0;
  let bestAdvance = -1;
  for (let seat = 0; seat < state.rules.seats; seat++) {
    const advance = advanceOf(state, seat);
    if (advance > bestAdvance) {
      bestAdvance = advance;
      best = seat;
    }
  }
  return best;
}
