import type { Rng } from "@/core/engine/rng";

/**
 * Logica de Combinaciones (match-3). Sin React, sin canvas: se testea sola.
 *
 * Todo el juego pasa por aca. El render solo lee el tablero e interpola, y esa
 * separacion es la que hace posible el criterio que define a M1: dos jugadores
 * con la misma semilla y la misma secuencia de movimientos tienen que terminar
 * con el mismo tablero y el mismo puntaje.
 *
 * De ahi salen las dos reglas duras del archivo:
 *
 * 1. El unico generador que toca el tablero es el Rng sembrado que se pasa a
 *    createBoard, collapseAndRefill y finishClear, y se consume SIEMPRE en el
 *    mismo orden: columna de izquierda a derecha, y dentro de cada una de abajo
 *    hacia arriba. Los efectos visuales usan otro generador aparte.
 * 2. Cero asignaciones: el tablero y los buffers de trabajo son arrays tipados
 *    dimensionados una vez, y todas las funciones escriben adentro.
 */

/* ------------------------------------------------------------------ */
/* Tipos                                                                */
/* ------------------------------------------------------------------ */

/** Hueco. Solo existe adentro de finishClear, entre el borrado y el derrumbe. */
export const EMPTY_TILE = -1;

export const SPECIAL_NONE = 0;
/** Rayo horizontal: limpia su fila. */
export const SPECIAL_ROW = 1;
/** Rayo vertical: limpia su columna. */
export const SPECIAL_COL = 2;
/** Bomba: limpia un bloque alrededor. */
export const SPECIAL_BOMB = 3;
/** Prisma: limpia todas las fichas de un color. */
export const SPECIAL_PRISM = 4;

export type MatchRules = {
  cols: number;
  rows: number;
  typeCount: number;
  pointsPerTile: number;
  specialPoints: number;
  cascadeMultiplier: number;
  bombRadius: number;
  specialsEnabled: boolean;
};

export type Board = {
  cols: number;
  rows: number;
  typeCount: number;
  /** Tipo de ficha por celda, o EMPTY_TILE. */
  tiles: Int8Array;
  /** Constante SPECIAL_* por celda. */
  specials: Uint8Array;
  /** Filas que cayo cada ficha en el ultimo derrumbe. Solo lo usa el dibujo. */
  fallFrom: Int8Array;
};

/** Buffers del resolvedor. Se crean una vez y se reciclan en cada paso. */
export type MatchWork = {
  /** 1 en las celdas que se limpian en este paso. */
  cleared: Uint8Array;
  activated: Uint8Array;
  /** Color que borra un prisma cuando se lo intercambia. -1 = el suyo. */
  prismTarget: Int8Array;
  queue: Int32Array;
  queueHead: number;
  queueTail: number;
  clearedCount: number;
  specialsUsed: number;
  spawnIndex: Int32Array;
  spawnKind: Uint8Array;
  spawnType: Int8Array;
  spawnCount: number;
  hRunOf: Int32Array;
  vRunOf: Int32Array;
  runStart: Int32Array;
  runLen: Int32Array;
  /** 0 horizontal, 1 vertical. */
  runDir: Uint8Array;
  runCrossed: Uint8Array;
  runCount: number;
};

export type CascadeReport = {
  points: number;
  /** Cuantos pasos encadeno el movimiento. 0 si no limpio nada. */
  levels: number;
  cleared: number;
  specials: number;
};

/** Tope de seguridad: una cascada real no pasa de unos pocos niveles. */
const MAX_CASCADE_LEVELS = 64;
/** Reintentos de generacion antes de aceptar un tablero sin movimientos. */
const MAX_GENERATION_ATTEMPTS = 64;

/** Scratch de modulo para hasAnyMove: evita asignar un par por consulta. */
const SCRATCH_PAIR = new Int32Array(2);

/* ------------------------------------------------------------------ */
/* Construccion                                                         */
/* ------------------------------------------------------------------ */

export function createBoard(rules: MatchRules, rng: Rng): Board {
  const size = rules.cols * rules.rows;
  const board: Board = {
    cols: rules.cols,
    rows: rules.rows,
    typeCount: rules.typeCount,
    tiles: new Int8Array(size),
    specials: new Uint8Array(size),
    fallFrom: new Int8Array(size),
  };
  generateSolvableBoard(board, rng, rules);
  return board;
}

export function createWork(board: Board): MatchWork {
  const size = board.cols * board.rows;
  return {
    cleared: new Uint8Array(size),
    activated: new Uint8Array(size),
    prismTarget: new Int8Array(size),
    queue: new Int32Array(size),
    queueHead: 0,
    queueTail: 0,
    clearedCount: 0,
    specialsUsed: 0,
    spawnIndex: new Int32Array(size),
    spawnKind: new Uint8Array(size),
    spawnType: new Int8Array(size),
    spawnCount: 0,
    hRunOf: new Int32Array(size),
    vRunOf: new Int32Array(size),
    runStart: new Int32Array(size),
    runLen: new Int32Array(size),
    runDir: new Uint8Array(size),
    runCrossed: new Uint8Array(size),
    runCount: 0,
  };
}

export function createReport(): CascadeReport {
  return { points: 0, levels: 0, cleared: 0, specials: 0 };
}

/* ------------------------------------------------------------------ */
/* Generacion del tablero inicial                                       */
/* ------------------------------------------------------------------ */

/**
 * True si poner ese tipo en (x, y) cerraria una linea de 3 con lo YA escrito.
 *
 * Se apoya en el orden de llenado (columnas de izquierda a derecha, filas de
 * abajo hacia arriba): al llegar a una celda, las dos de su izquierda y las dos
 * de abajo ya estan definidas. Como toda linea de 3 tiene una celda que se
 * escribe ultima, mirar solo hacia atras alcanza para que el tablero terminado
 * no tenga ni una combinacion hecha.
 */
function wouldCloseRun(board: Board, x: number, y: number, type: number): boolean {
  const { cols, tiles } = board;
  if (x >= 2 && tiles[y * cols + x - 1] === type && tiles[y * cols + x - 2] === type) return true;
  if (y + 2 < board.rows && tiles[(y + 1) * cols + x] === type && tiles[(y + 2) * cols + x] === type) {
    return true;
  }
  return false;
}

/**
 * Llena el tablero sin ninguna combinacion hecha.
 *
 * Consume exactamente una tirada del generador por celda: si el tipo sorteado
 * cierra una linea se avanza al siguiente tipo en vez de volver a tirar. Sin
 * eso la cantidad de tiradas dependeria del tablero, y dos clientes con la
 * misma semilla divergirian apenas uno reintentara una vez mas que el otro.
 */
export function fillBoardWithoutMatches(board: Board, rng: Rng): void {
  const { cols, rows, tiles, specials, typeCount } = board;
  specials.fill(SPECIAL_NONE);
  board.fallFrom.fill(0);

  for (let x = 0; x < cols; x++) {
    for (let y = rows - 1; y >= 0; y--) {
      const first = rng.int(0, typeCount - 1);
      let chosen = first;
      for (let k = 0; k < typeCount; k++) {
        const candidate = (first + k) % typeCount;
        chosen = candidate;
        if (!wouldCloseRun(board, x, y, candidate)) break;
      }
      tiles[y * cols + x] = chosen;
    }
  }
}

/**
 * Genera hasta dar con un tablero sin combinaciones hechas Y con al menos un
 * movimiento posible. Devuelve los intentos consumidos.
 *
 * Es tambien el rebarajado: cuando el tablero se traba durante la partida se
 * llama a esto con el MISMO generador sembrado, asi el tablero nuevo tambien
 * sale identico para todos.
 */
export function generateSolvableBoard(board: Board, rng: Rng, rules: MatchRules): number {
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    fillBoardWithoutMatches(board, rng);
    if (hasAnyMove(board, rules.specialsEnabled)) return attempt;
  }
  return MAX_GENERATION_ATTEMPTS;
}

/* ------------------------------------------------------------------ */
/* Consultas                                                            */
/* ------------------------------------------------------------------ */

export function indexOf(board: Board, x: number, y: number): number {
  return y * board.cols + x;
}

export function areAdjacent(cols: number, a: number, b: number): boolean {
  const ax = a % cols;
  const ay = (a / cols) | 0;
  const bx = b % cols;
  const by = (b / cols) | 0;
  const dx = ax > bx ? ax - bx : bx - ax;
  const dy = ay > by ? ay - by : by - ay;
  return dx + dy === 1;
}

/** True si la ficha de ese indice es parte de una linea de 3 o mas. */
export function formsRunAt(board: Board, index: number): boolean {
  const { cols, rows, tiles } = board;
  const type = tiles[index];
  if (type === undefined || type === EMPTY_TILE) return false;
  const x = index % cols;
  const y = (index / cols) | 0;

  let run = 1;
  for (let c = x - 1; c >= 0 && tiles[y * cols + c] === type; c--) run++;
  for (let c = x + 1; c < cols && tiles[y * cols + c] === type; c++) run++;
  if (run >= 3) return true;

  run = 1;
  for (let r = y - 1; r >= 0 && tiles[r * cols + x] === type; r--) run++;
  for (let r = y + 1; r < rows && tiles[r * cols + x] === type; r++) run++;
  return run >= 3;
}

export function applySwap(board: Board, a: number, b: number): void {
  const { tiles, specials } = board;
  const tile = tiles[a] as number;
  tiles[a] = tiles[b] as number;
  tiles[b] = tile;
  const special = specials[a] as number;
  specials[a] = specials[b] as number;
  specials[b] = special;
}

/**
 * Un intercambio es legal si genera al menos una linea de 3.
 *
 * Las especiales agregan dos excepciones: un prisma se activa contra cualquier
 * cosa, y dos especiales juntas se encadenan. Todo lo demas se decide probando
 * el intercambio y deshaciendolo, asi que el tablero queda como estaba.
 */
export function isLegalSwap(board: Board, a: number, b: number, specialsEnabled: boolean): boolean {
  const size = board.tiles.length;
  if (a < 0 || b < 0 || a >= size || b >= size) return false;
  if (!areAdjacent(board.cols, a, b)) return false;

  if (specialsEnabled) {
    const sa = board.specials[a] as number;
    const sb = board.specials[b] as number;
    if (sa === SPECIAL_PRISM || sb === SPECIAL_PRISM) return true;
    if (sa !== SPECIAL_NONE && sb !== SPECIAL_NONE) return true;
  }

  applySwap(board, a, b);
  const legal = formsRunAt(board, a) || formsRunAt(board, b);
  applySwap(board, a, b);
  return legal;
}

/** Escribe en out el primer movimiento legal que encuentra. Sirve de pista. */
export function findMove(board: Board, specialsEnabled: boolean, out: Int32Array): boolean {
  const { cols, rows } = board;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const index = y * cols + x;
      if (x + 1 < cols && isLegalSwap(board, index, index + 1, specialsEnabled)) {
        out[0] = index;
        out[1] = index + 1;
        return true;
      }
      if (y + 1 < rows && isLegalSwap(board, index, index + cols, specialsEnabled)) {
        out[0] = index;
        out[1] = index + cols;
        return true;
      }
    }
  }
  return false;
}

export function hasAnyMove(board: Board, specialsEnabled: boolean): boolean {
  return findMove(board, specialsEnabled, SCRATCH_PAIR);
}

/** Huella del tablero. Es lo que se compara para verificar el determinismo. */
export function hashBoard(board: Board): number {
  let h = 2166136261;
  for (let i = 0; i < board.tiles.length; i++) {
    h ^= ((board.tiles[i] as number) + 1) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= board.specials[i] as number;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* Deteccion de combinaciones                                           */
/* ------------------------------------------------------------------ */

function resetWork(work: MatchWork): void {
  work.cleared.fill(0);
  work.activated.fill(0);
  work.prismTarget.fill(-1);
  work.queueHead = 0;
  work.queueTail = 0;
  work.clearedCount = 0;
  work.specialsUsed = 0;
  work.spawnCount = 0;
  work.runCount = 0;
}

/** Marca una celda y, si tenia una especial, la encola para que estalle. */
function markCell(board: Board, work: MatchWork, index: number): void {
  if (work.cleared[index] === 1) return;
  work.cleared[index] = 1;
  work.clearedCount++;
  if (board.specials[index] !== SPECIAL_NONE && work.activated[index] === 0) {
    work.activated[index] = 1;
    work.queue[work.queueTail++] = index;
  }
}

/** Todas las lineas maximas de 3 o mas, horizontales y verticales. */
function scanRuns(board: Board, work: MatchWork): void {
  const { cols, rows, tiles } = board;
  work.hRunOf.fill(-1);
  work.vRunOf.fill(-1);
  work.runCount = 0;

  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      const base = y * cols + x;
      const type = tiles[base] as number;
      let len = 1;
      while (x + len < cols && tiles[base + len] === type) len++;
      if (type !== EMPTY_TILE && len >= 3) {
        const id = work.runCount++;
        work.runStart[id] = base;
        work.runLen[id] = len;
        work.runDir[id] = 0;
        work.runCrossed[id] = 0;
        for (let k = 0; k < len; k++) work.hRunOf[base + k] = id;
      }
      x += len;
    }
  }

  for (let x = 0; x < cols; x++) {
    let y = 0;
    while (y < rows) {
      const base = y * cols + x;
      const type = tiles[base] as number;
      let len = 1;
      while (y + len < rows && tiles[base + len * cols] === type) len++;
      if (type !== EMPTY_TILE && len >= 3) {
        const id = work.runCount++;
        work.runStart[id] = base;
        work.runLen[id] = len;
        work.runDir[id] = 1;
        work.runCrossed[id] = 0;
        for (let k = 0; k < len; k++) work.vRunOf[base + k * cols] = id;
      }
      y += len;
    }
  }
}

function runStride(board: Board, work: MatchWork, id: number): number {
  return work.runDir[id] === 0 ? 1 : board.cols;
}

/**
 * Donde nace la especial: en la celda que el jugador movio si es parte de la
 * linea, y si no en el medio. Poner la ficha nueva bajo el dedo hace que se
 * entienda de donde salio sin tener que explicarlo.
 */
function preferredCell(
  board: Board,
  work: MatchWork,
  id: number,
  preferA: number,
  preferB: number,
): number {
  const start = work.runStart[id] as number;
  const len = work.runLen[id] as number;
  const stride = runStride(board, work, id);
  for (let k = 0; k < len; k++) {
    const index = start + k * stride;
    if (index === preferA || index === preferB) return index;
  }
  return start + (len >> 1) * stride;
}

function addSpawn(board: Board, work: MatchWork, index: number, kind: number): void {
  for (let i = 0; i < work.spawnCount; i++) {
    if (work.spawnIndex[i] === index) return;
  }
  const slot = work.spawnCount++;
  work.spawnIndex[slot] = index;
  work.spawnKind[slot] = kind;
  work.spawnType[slot] = board.tiles[index] as number;
}

/**
 * Que especial deja cada linea.
 *
 * El rayo limpia PERPENDICULAR a la linea que lo formo: si limpiara su propia
 * fila estaria barriendo el lugar que acaba de quedar vacio y no serviria de
 * nada. Un cruce (L o T) pesa mas que la longitud y consume las dos lineas.
 */
function decideSpawns(
  board: Board,
  work: MatchWork,
  rules: MatchRules,
  preferA: number,
  preferB: number,
): void {
  if (!rules.specialsEnabled) return;

  for (let id = 0; id < work.runCount; id++) {
    if (work.runDir[id] !== 0) continue;
    const start = work.runStart[id] as number;
    const len = work.runLen[id] as number;
    for (let k = 0; k < len; k++) {
      const index = start + k;
      const crossed = work.vRunOf[index] as number;
      if (crossed < 0) continue;
      work.runCrossed[id] = 1;
      work.runCrossed[crossed] = 1;
      addSpawn(board, work, index, SPECIAL_BOMB);
      break;
    }
  }

  for (let id = 0; id < work.runCount; id++) {
    if (work.runCrossed[id] === 1) continue;
    const len = work.runLen[id] as number;
    if (len < 4) continue;
    const index = preferredCell(board, work, id, preferA, preferB);
    const kind = len >= 5 ? SPECIAL_PRISM : work.runDir[id] === 0 ? SPECIAL_COL : SPECIAL_ROW;
    addSpawn(board, work, index, kind);
  }
}

/** Intercambio de especiales: no hace falta linea, se activan entre ellas. */
function markSwapCombo(
  board: Board,
  work: MatchWork,
  rules: MatchRules,
  a: number,
  b: number,
): void {
  if (!rules.specialsEnabled) return;
  const sa = board.specials[a] as number;
  const sb = board.specials[b] as number;
  const bothSpecial = sa !== SPECIAL_NONE && sb !== SPECIAL_NONE;
  const anyPrism = sa === SPECIAL_PRISM || sb === SPECIAL_PRISM;
  if (!bothSpecial && !anyPrism) return;

  // Dos prismas juntos limpian el tablero entero; uno solo toma el color de lo
  // que se le puso al lado.
  if (sa === SPECIAL_PRISM && sb === SPECIAL_PRISM) {
    for (let i = 0; i < board.tiles.length; i++) markCell(board, work, i);
    return;
  }
  if (sa === SPECIAL_PRISM) work.prismTarget[a] = board.tiles[b] as number;
  if (sb === SPECIAL_PRISM) work.prismTarget[b] = board.tiles[a] as number;

  markCell(board, work, a);
  markCell(board, work, b);
}

/** Estalla lo encolado. Cada especial que toca otra la encola: asi encadenan. */
function expandSpecials(board: Board, work: MatchWork, rules: MatchRules): void {
  const { cols, rows } = board;
  while (work.queueHead < work.queueTail) {
    const index = work.queue[work.queueHead++] as number;
    work.specialsUsed++;
    const kind = board.specials[index] as number;
    const x = index % cols;
    const y = (index / cols) | 0;

    if (kind === SPECIAL_ROW) {
      for (let c = 0; c < cols; c++) markCell(board, work, y * cols + c);
    } else if (kind === SPECIAL_COL) {
      for (let r = 0; r < rows; r++) markCell(board, work, r * cols + x);
    } else if (kind === SPECIAL_BOMB) {
      const radius = rules.bombRadius;
      for (let r = y - radius; r <= y + radius; r++) {
        if (r < 0 || r >= rows) continue;
        for (let c = x - radius; c <= x + radius; c++) {
          if (c < 0 || c >= cols) continue;
          markCell(board, work, r * cols + c);
        }
      }
    } else if (kind === SPECIAL_PRISM) {
      const declared = work.prismTarget[index] as number;
      const target = declared >= 0 ? declared : (board.tiles[index] as number);
      for (let i = 0; i < board.tiles.length; i++) {
        if (board.tiles[i] === target) markCell(board, work, i);
      }
    }
  }
}

/**
 * Primera mitad de un paso de cascada: decide QUE se limpia y que especiales
 * nacen, pero todavia no toca el tablero. El componente aprovecha esa pausa
 * para animar el estallido; los tests la usan para leer work sin ruido.
 *
 * preferA y preferB son las celdas del intercambio que disparo el paso, o -1
 * en las cascadas encadenadas.
 *
 * Devuelve cuantas fichas se limpian. 0 significa tablero estable.
 */
export function beginClear(
  board: Board,
  work: MatchWork,
  rules: MatchRules,
  preferA: number,
  preferB: number,
): number {
  resetWork(work);
  scanRuns(board, work);

  for (let id = 0; id < work.runCount; id++) {
    const start = work.runStart[id] as number;
    const len = work.runLen[id] as number;
    const stride = runStride(board, work, id);
    for (let k = 0; k < len; k++) markCell(board, work, start + k * stride);
  }

  decideSpawns(board, work, rules, preferA, preferB);
  if (preferA >= 0 && preferB >= 0) markSwapCombo(board, work, rules, preferA, preferB);
  expandSpecials(board, work, rules);

  return work.clearedCount;
}

/**
 * Gravedad y relleno. El orden de consumo del generador es el contrato:
 * columnas de izquierda a derecha, y dentro de cada una de abajo hacia arriba.
 * Cambiarlo rompe la comparabilidad entre jugadores.
 */
export function collapseAndRefill(board: Board, rng: Rng): void {
  const { cols, rows, tiles, specials, fallFrom, typeCount } = board;
  fallFrom.fill(0);

  for (let x = 0; x < cols; x++) {
    let write = rows - 1;
    for (let y = rows - 1; y >= 0; y--) {
      const from = y * cols + x;
      if (tiles[from] === EMPTY_TILE) continue;
      if (write !== y) {
        const to = write * cols + x;
        tiles[to] = tiles[from] as number;
        specials[to] = specials[from] as number;
        fallFrom[to] = write - y;
        tiles[from] = EMPTY_TILE;
        specials[from] = SPECIAL_NONE;
      }
      write--;
    }
    // Quedaron write + 1 huecos arriba. Todos entran desde fuera del tablero,
    // asi que caen la misma distancia y se leen como un bloque.
    const holes = write + 1;
    for (let y = write; y >= 0; y--) {
      const index = y * cols + x;
      tiles[index] = rng.int(0, typeCount - 1);
      specials[index] = SPECIAL_NONE;
      fallFrom[index] = holes;
    }
  }
}

/**
 * Segunda mitad del paso: borra lo marcado, deja nacer las especiales y
 * derrumba. Despues de esto el tablero no tiene huecos.
 */
export function finishClear(board: Board, work: MatchWork, rng: Rng): void {
  const { tiles, specials } = board;
  for (let i = 0; i < tiles.length; i++) {
    if (work.cleared[i] !== 1) continue;
    tiles[i] = EMPTY_TILE;
    specials[i] = SPECIAL_NONE;
  }
  // Las especiales se escriben despues del borrado: nacen en una celda que
  // acaba de limpiarse y sobreviven al derrumbe cayendo como cualquier ficha.
  for (let s = 0; s < work.spawnCount; s++) {
    const index = work.spawnIndex[s] as number;
    tiles[index] = work.spawnType[s] as number;
    specials[index] = work.spawnKind[s] as number;
  }
  collapseAndRefill(board, rng);
}

/* ------------------------------------------------------------------ */
/* Puntaje                                                              */
/* ------------------------------------------------------------------ */

/**
 * Puntos de UN paso de cascada. level es 0 en la combinacion que hizo el
 * jugador y crece en cada eslabon: es lo que hace que una jugada pensada valga
 * varias veces una cualquiera.
 */
export function cascadePoints(
  clearedTiles: number,
  specialsUsed: number,
  level: number,
  rules: MatchRules,
): number {
  const base = clearedTiles * rules.pointsPerTile + specialsUsed * rules.specialPoints;
  return Math.round(base * (1 + level * rules.cascadeMultiplier));
}

/* ------------------------------------------------------------------ */
/* Resolucion completa                                                  */
/* ------------------------------------------------------------------ */

/**
 * Encadena pasos hasta que el tablero queda estable, acumulando en out.
 *
 * Es la version sin animacion de lo que hace el componente frame a frame. Las
 * dos recorren las MISMAS primitivas en el mismo orden, asi que una partida
 * jugada a mano y una simulada en un test terminan igual.
 */
export function resolveCascades(
  board: Board,
  work: MatchWork,
  rules: MatchRules,
  rng: Rng,
  swapA: number,
  swapB: number,
  out: CascadeReport,
): CascadeReport {
  out.points = 0;
  out.levels = 0;
  out.cleared = 0;
  out.specials = 0;

  let preferA = swapA;
  let preferB = swapB;
  for (let level = 0; level < MAX_CASCADE_LEVELS; level++) {
    const marked = beginClear(board, work, rules, preferA, preferB);
    preferA = -1;
    preferB = -1;
    if (marked === 0) break;
    out.points += cascadePoints(marked, work.specialsUsed, level, rules);
    out.cleared += marked;
    out.specials += work.specialsUsed;
    out.levels = level + 1;
    finishClear(board, work, rng);
  }
  return out;
}

/**
 * Un movimiento completo del jugador. Devuelve false y deja el tablero intacto
 * si el intercambio no era legal: un intento invalido no cuesta nada.
 */
export function applyMove(
  board: Board,
  work: MatchWork,
  rules: MatchRules,
  rng: Rng,
  a: number,
  b: number,
  out: CascadeReport,
): boolean {
  if (!isLegalSwap(board, a, b, rules.specialsEnabled)) return false;
  applySwap(board, a, b);
  resolveCascades(board, work, rules, rng, a, b, out);
  return true;
}
