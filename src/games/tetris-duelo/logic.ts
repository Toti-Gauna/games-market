import type { Rng } from "@/core/engine/rng";

/**
 * Logica de Tetris duelo. Sin React, sin canvas, sin red: se testea sola.
 *
 * Un Tetris que se siente bien no depende de la mecanica —que la sabe todo el
 * mundo— sino de seis detalles que casi nadie implementa. Los seis viven aca:
 *
 * 1. **Bolsa de 7 sembrada y compartida.** Las piezas NO son al azar: salen de
 *    una bolsa con las siete barajada. Garantiza que ninguna tarde mas de 12
 *    turnos. Y los dos jugadores leen la MISMA secuencia con su propio cursor:
 *    el duelo se decide por habilidad, no por suerte de reparto.
 * 2. **DAS y ARR.** El telefono manda "empece a mantener" y "solte"; la
 *    repeticion la cuenta este modulo, o sea el host. Si la contara el
 *    telefono, la latencia arruinaria el ritmo.
 * 3. **Retardo de fijado con reinicios topeados.** Al apoyarse hay 500 ms, y
 *    cada movimiento o rotacion reinicia el contador hasta 15 veces. Sin
 *    retardo el juego castiga la velocidad; con retardo infinito se eterniza
 *    una pieza.
 * 4. **Patadas de pared (SRS).** Al rotar contra una pared o una pila, la
 *    pieza se corre en vez de rechazar la rotacion.
 * 5. **Fantasma**: donde va a caer la pieza, calculado sobre el mismo tablero.
 * 6. **Retencion**, una sola vez por pieza.
 *
 * Y la basura con **ventana de compensacion**: entre el envio y la aparicion
 * hay 1 segundo, y lo que el que la recibe complete en ese lapso la cancela.
 * Sin compensacion el que se adelanta gana solo y no hay remontadas.
 *
 * Cero asignaciones en el paso: tableros y colas son arrays tipados
 * preasignados, los eventos son contadores y `collide.ts` no se usa —la
 * colision aca es comprobar celdas de una grilla.
 */

/* ------------------------------------------------------------------ */
/* Tablero                                                              */
/* ------------------------------------------------------------------ */

export const TETRIS_SEATS = 2;
export const COLS = 10;
/** 20 visibles + 2 ocultas arriba, donde aparecen las piezas. */
export const HIDDEN_ROWS = 2;
export const VISIBLE_ROWS = 20;
export const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
export const BOARD_CELLS = COLS * ROWS;

export const EMPTY = 0;
/** Las filas que manda el rival. Se pintan distinto: no son tuyas. */
export const GARBAGE = 8;

export const PIECE_I = 0;
export const PIECE_J = 1;
export const PIECE_L = 2;
export const PIECE_O = 3;
export const PIECE_S = 4;
export const PIECE_T = 5;
export const PIECE_Z = 6;
export const PIECE_COUNT = 7;

/** Piezas por bolsa pregenerada. 320 bolsas = 2240 piezas: una partida entera. */
const QUEUE_BAGS = 320;
const QUEUE_LENGTH = QUEUE_BAGS * PIECE_COUNT;
/** Columnas de hueco pregeneradas. Se recorren con modulo. */
const HOLE_LENGTH = 512;

const SOFT_DROP_POINT = 1;
const HARD_DROP_POINT = 2;
/** Piso de la gravedad: sin esto, con nivel alto, el paso seria 0 ms. */
const MIN_GRAVITY_MS = 60;
/** Tope de entradas de basura en vuelo. Mas que esto ya es una partida perdida. */
const PENDING_CAPACITY = 16;

/**
 * Las cuatro rotaciones de cada pieza, en celdas de su caja, con y hacia
 * abajo (que es como se indexa el tablero). Se aplanan a un Int8Array para no
 * recorrer arrays de arrays en el paso.
 */
const SHAPES: readonly (readonly (readonly number[])[])[] = [
  // I — caja de 4x4
  [
    [0, 1, 1, 1, 2, 1, 3, 1],
    [2, 0, 2, 1, 2, 2, 2, 3],
    [0, 2, 1, 2, 2, 2, 3, 2],
    [1, 0, 1, 1, 1, 2, 1, 3],
  ],
  // J
  [
    [0, 0, 0, 1, 1, 1, 2, 1],
    [1, 0, 2, 0, 1, 1, 1, 2],
    [0, 1, 1, 1, 2, 1, 2, 2],
    [1, 0, 1, 1, 0, 2, 1, 2],
  ],
  // L
  [
    [2, 0, 0, 1, 1, 1, 2, 1],
    [1, 0, 1, 1, 1, 2, 2, 2],
    [0, 1, 1, 1, 2, 1, 0, 2],
    [0, 0, 1, 0, 1, 1, 1, 2],
  ],
  // O — no rota: las cuatro orientaciones son la misma
  [
    [0, 0, 1, 0, 0, 1, 1, 1],
    [0, 0, 1, 0, 0, 1, 1, 1],
    [0, 0, 1, 0, 0, 1, 1, 1],
    [0, 0, 1, 0, 0, 1, 1, 1],
  ],
  // S
  [
    [1, 0, 2, 0, 0, 1, 1, 1],
    [1, 0, 1, 1, 2, 1, 2, 2],
    [1, 1, 2, 1, 0, 2, 1, 2],
    [0, 0, 0, 1, 1, 1, 1, 2],
  ],
  // T
  [
    [1, 0, 0, 1, 1, 1, 2, 1],
    [1, 0, 1, 1, 2, 1, 1, 2],
    [0, 1, 1, 1, 2, 1, 1, 2],
    [1, 0, 0, 1, 1, 1, 1, 2],
  ],
  // Z
  [
    [0, 0, 1, 0, 1, 1, 2, 1],
    [2, 0, 1, 1, 2, 1, 1, 2],
    [0, 1, 1, 1, 1, 2, 2, 2],
    [1, 0, 0, 1, 1, 1, 0, 2],
  ],
];

const CELL_TABLE = flattenShapes();

function flattenShapes(): Int8Array {
  const table = new Int8Array(PIECE_COUNT * 4 * 8);
  for (let piece = 0; piece < PIECE_COUNT; piece++) {
    const rotations = SHAPES[piece] ?? [];
    for (let rot = 0; rot < 4; rot++) {
      const cells = rotations[rot] ?? [];
      for (let n = 0; n < 8; n++) {
        table[(piece * 4 + rot) * 8 + n] = cells[n] ?? 0;
      }
    }
  }
  return table;
}

/** Columna de la celda `i` (0..3) de una pieza en una rotacion. */
export function cellX(piece: number, rot: number, index: number): number {
  return CELL_TABLE[(piece * 4 + rot) * 8 + index * 2] ?? 0;
}

/** Fila de la celda `i` (0..3), con y hacia abajo. */
export function cellY(piece: number, rot: number, index: number): number {
  return CELL_TABLE[(piece * 4 + rot) * 8 + index * 2 + 1] ?? 0;
}

/**
 * Columna de aparicion. La O centra su caja de 2 en las columnas 4 y 5; el
 * resto arranca en la 3, que es donde las deja el estandar.
 */
const SPAWN_X: readonly number[] = [3, 3, 3, 4, 3, 3, 3];

/* ------------------------------------------------------------------ */
/* Patadas de pared — tabla SRS                                         */
/* ------------------------------------------------------------------ */

/**
 * Desplazamientos que se prueban en orden cuando la rotacion no entra.
 *
 * La tabla original del estandar esta escrita con y hacia ARRIBA; aca la y va
 * hacia abajo porque asi se indexa el tablero, o sea que todos los
 * desplazamientos verticales estan negados respecto de la tabla publicada.
 * Es el error clasico al portar SRS: se ve como piezas que se hunden al rotar.
 *
 * Indice: (desde * 4 + hacia) * 10. Solo se llenan las ocho transiciones de
 * 90 grados: no hay boton de 180.
 */
const KICK_STEPS = 5;

function buildKickTable(entries: Record<number, readonly number[]>): Int8Array {
  const table = new Int8Array(16 * KICK_STEPS * 2);
  for (const key of Object.keys(entries)) {
    const index = Number(key);
    const values = entries[index] ?? [];
    for (let n = 0; n < KICK_STEPS * 2; n++) {
      table[index * KICK_STEPS * 2 + n] = values[n] ?? 0;
    }
  }
  return table;
}

/** J, L, S, T, Z. */
const KICKS_MAIN = buildKickTable({
  [0 * 4 + 1]: [0, 0, -1, 0, -1, -1, 0, 2, -1, 2],
  [1 * 4 + 0]: [0, 0, 1, 0, 1, 1, 0, -2, 1, -2],
  [1 * 4 + 2]: [0, 0, 1, 0, 1, 1, 0, -2, 1, -2],
  [2 * 4 + 1]: [0, 0, -1, 0, -1, -1, 0, 2, -1, 2],
  [2 * 4 + 3]: [0, 0, 1, 0, 1, -1, 0, 2, 1, 2],
  [3 * 4 + 2]: [0, 0, -1, 0, -1, 1, 0, -2, -1, -2],
  [3 * 4 + 0]: [0, 0, -1, 0, -1, 1, 0, -2, -1, -2],
  [0 * 4 + 3]: [0, 0, 1, 0, 1, -1, 0, 2, 1, 2],
});

/** La I tiene su propia tabla: su caja es de 4 y se corre hasta dos columnas. */
const KICKS_I = buildKickTable({
  [0 * 4 + 1]: [0, 0, -2, 0, 1, 0, -2, 1, 1, -2],
  [1 * 4 + 0]: [0, 0, 2, 0, -1, 0, 2, -1, -1, 2],
  [1 * 4 + 2]: [0, 0, -1, 0, 2, 0, -1, -2, 2, 1],
  [2 * 4 + 1]: [0, 0, 1, 0, -2, 0, 1, 2, -2, -1],
  [2 * 4 + 3]: [0, 0, 2, 0, -1, 0, 2, -1, -1, 2],
  [3 * 4 + 2]: [0, 0, -2, 0, 1, 0, -2, 1, 1, -2],
  [3 * 4 + 0]: [0, 0, 1, 0, -2, 0, 1, 2, -2, -1],
  [0 * 4 + 3]: [0, 0, -1, 0, 2, 0, -1, -2, 2, 1],
});

/* ------------------------------------------------------------------ */
/* Tipos                                                                */
/* ------------------------------------------------------------------ */

export type TetrisRules = {
  /** ms por celda al nivel 1. */
  gravityMs: number;
  /** Multiplicador por nivel, 0..1. 0,92 = 8 % mas rapido cada 10 lineas. */
  gravityFactor: number;
  linesPerLevel: number;
  /** Cuantas veces mas rapido baja con ▼ apretado. */
  softDropFactor: number;
  /** Retardo antes de que el costado empiece a repetir. */
  dasMs: number;
  /** Cada cuanto repite una vez pasado el DAS. */
  arrMs: number;
  lockDelayMs: number;
  maxLockResets: number;
  /** Lo que dura el aplastado de las filas antes de que colapsen. */
  clearDelayMs: number;
  /** Filas enviadas segun cuantas lineas: indice 0 = simple. */
  garbageTable: readonly number[];
  /** Extra cuando la pieza anterior tambien hizo lineas. */
  comboBonus: number;
  /** Entre el envio y la aparicion. En ese lapso, lo que completes cancela. */
  garbageWindowMs: number;
  /** Puntos por cantidad de lineas, multiplicados por el nivel. */
  lineScores: readonly number[];
  pointsPerGarbage: number;
  pointsWin: number;
};

/**
 * Los valores de la guia. El juego arma los suyos desde los administrables;
 * esto es la referencia unica para las pruebas y el respaldo si falta una
 * clave.
 */
export const DEFAULT_RULES: TetrisRules = {
  gravityMs: 800,
  gravityFactor: 0.92,
  linesPerLevel: 10,
  softDropFactor: 20,
  dasMs: 130,
  arrMs: 30,
  lockDelayMs: 500,
  maxLockResets: 15,
  clearDelayMs: 180,
  garbageTable: [0, 1, 2, 4],
  comboBonus: 1,
  garbageWindowMs: 1000,
  lineScores: [100, 300, 500, 800],
  pointsPerGarbage: 60,
  pointsWin: 600,
};

export type PlayerPhase = "idle" | "falling" | "clearing" | "dead";

export type MatchReason = "none" | "topout" | "time" | "forced" | "quit";

export type TetrisPlayer = {
  seat: number;
  /** 10 x 22 en un array plano. 0 vacio, 1..7 pieza, 8 basura. */
  board: Uint8Array;
  phase: PlayerPhase;

  /** Pieza activa, o -1 entre el fijado y la aparicion siguiente. */
  piece: number;
  rot: number;
  x: number;
  y: number;
  /** Fila mas baja que alcanzo la pieza: bajar devuelve los reinicios de fijado. */
  lowestY: number;

  hold: number;
  holdUsed: boolean;
  /** Posicion propia en la secuencia compartida. */
  queueCursor: number;
  holeCursor: number;

  lines: number;
  garbageSent: number;
  garbageTaken: number;
  linePoints: number;
  dropPoints: number;
  /** Piezas seguidas que hicieron lineas. La segunda ya suma bono. */
  combo: number;
  level: number;
  /** ms por celda al nivel actual. */
  gravityMs: number;
  gravityAccMs: number;

  lockMs: number;
  lockResets: number;
  grounded: boolean;

  /** -1 izquierda, 0 nada, 1 derecha. Lo que el mando dice que esta apretado. */
  moveDir: number;
  dasMs: number;
  arrMs: number;
  softDrop: boolean;

  clearMs: number;
  clearRows: Int32Array;
  clearCount: number;

  /** Basura en vuelo hacia ESTE jugador, con lo que le falta para entrar. */
  pendingRows: Int32Array;
  pendingMs: Float64Array;
  pendingCount: number;

  /* Eventos acumulados desde la ultima lectura. Contadores, no objetos: el
     render los consume y los pone en cero con `clearEvents`. */
  evLines: number;
  evLocked: number;
  evGarbage: number;
  evHold: number;
  evRotate: number;
  evDrop: number;
  evDead: number;
};

export type TetrisMatch = {
  rules: TetrisRules;
  players: readonly [TetrisPlayer, TetrisPlayer];
  /** La secuencia compartida de piezas. Los dos cursores leen de aca. */
  queue: Uint8Array;
  /** Columnas de hueco de la basura, tambien sembradas e iguales para los dos. */
  holes: Uint8Array;
  over: boolean;
  /** -1 = empate o todavia nada. */
  winner: number;
  reason: MatchReason;
  elapsedMs: number;
};

/* ------------------------------------------------------------------ */
/* Construccion                                                         */
/* ------------------------------------------------------------------ */

export function createPlayer(seat: number, rules: TetrisRules): TetrisPlayer {
  return {
    seat,
    board: new Uint8Array(BOARD_CELLS),
    phase: "idle",
    piece: -1,
    rot: 0,
    x: 0,
    y: 0,
    lowestY: 0,
    hold: -1,
    holdUsed: false,
    queueCursor: 0,
    holeCursor: 0,
    lines: 0,
    garbageSent: 0,
    garbageTaken: 0,
    linePoints: 0,
    dropPoints: 0,
    combo: 0,
    level: 1,
    gravityMs: rules.gravityMs,
    gravityAccMs: 0,
    lockMs: 0,
    lockResets: 0,
    grounded: false,
    moveDir: 0,
    dasMs: 0,
    arrMs: 0,
    softDrop: false,
    clearMs: 0,
    clearRows: new Int32Array(4),
    clearCount: 0,
    pendingRows: new Int32Array(PENDING_CAPACITY),
    pendingMs: new Float64Array(PENDING_CAPACITY),
    pendingCount: 0,
    evLines: 0,
    evLocked: 0,
    evGarbage: 0,
    evHold: 0,
    evRotate: 0,
    evDrop: 0,
    evDead: 0,
  };
}

/**
 * Arma la partida con las dos secuencias sembradas.
 *
 * La cola se genera entera aca y no bolsa por bolsa durante el juego: rellenar
 * a mitad de partida seria asignar dentro del paso, que es justo lo que el
 * contrato prohibe. 2240 piezas son mas de las que entran en una partida, y si
 * se pasara, el modulo cae en una posicion multiplo de 7 y la bolsa sigue
 * siendo bolsa.
 */
export function createMatch(rules: TetrisRules, rng: Rng): TetrisMatch {
  const queue = new Uint8Array(QUEUE_LENGTH);
  const bag = new Uint8Array(PIECE_COUNT);

  for (let b = 0; b < QUEUE_BAGS; b++) {
    for (let i = 0; i < PIECE_COUNT; i++) bag[i] = i;
    // Fisher-Yates sobre el mismo buffer. `rng.shuffle` copia el array, y una
    // copia por bolsa es basura que no hace falta.
    for (let i = PIECE_COUNT - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const a = bag[i] ?? 0;
      const c = bag[j] ?? 0;
      bag[i] = c;
      bag[j] = a;
    }
    queue.set(bag, b * PIECE_COUNT);
  }

  const holes = new Uint8Array(HOLE_LENGTH);
  for (let i = 0; i < HOLE_LENGTH; i++) holes[i] = rng.int(0, COLS - 1);

  return {
    rules,
    players: [createPlayer(0, rules), createPlayer(1, rules)],
    queue,
    holes,
    over: false,
    winner: -1,
    reason: "none",
    elapsedMs: 0,
  };
}

/** Los dos empiezan con la primera pieza de la misma secuencia. */
export function startMatch(match: TetrisMatch): void {
  for (let seat = 0; seat < TETRIS_SEATS; seat++) {
    const player = playerAt(match, seat);
    player.phase = "falling";
    spawnNext(match, player);
  }
}

/** Acceso al asiento sin que el indice numerico devuelva `undefined`. */
export function playerAt(match: TetrisMatch, seat: number): TetrisPlayer {
  return seat === 1 ? match.players[1] : match.players[0];
}

export function otherSeat(seat: number): number {
  return seat === 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Secuencia compartida                                                 */
/* ------------------------------------------------------------------ */

/** La pieza numero `index` de la secuencia. Es la misma para los dos asientos. */
export function pieceAt(match: TetrisMatch, index: number): number {
  return match.queue[index % QUEUE_LENGTH] ?? 0;
}

/** Lo que le viene a este asiento: 0 es la pieza actual ya en juego. */
export function upcomingPiece(match: TetrisMatch, seat: number, ahead: number): number {
  return pieceAt(match, playerAt(match, seat).queueCursor + ahead);
}

function nextHole(match: TetrisMatch, player: TetrisPlayer): number {
  const hole = match.holes[player.holeCursor % HOLE_LENGTH] ?? 0;
  player.holeCursor++;
  return hole % COLS;
}

/* ------------------------------------------------------------------ */
/* Colision — comprobacion de celdas, no `collide.ts`                   */
/* ------------------------------------------------------------------ */

export function boardIndex(col: number, row: number): number {
  return row * COLS + col;
}

export function cellValue(board: Uint8Array, col: number, row: number): number {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return GARBAGE;
  return board[row * COLS + col] ?? EMPTY;
}

/**
 * Si la pieza entra en esa posicion.
 *
 * Arriba del tablero cuenta como ocupado: con dos filas ocultas, una patada
 * que empuje por encima del techo pasa solo cuando la partida ya esta perdida,
 * y permitirlo obligaria a escribir fuera del array al fijar.
 */
export function canPlace(board: Uint8Array, piece: number, rot: number, x: number, y: number): boolean {
  if (piece < 0) return false;
  for (let i = 0; i < 4; i++) {
    const col = x + cellX(piece, rot, i);
    const row = y + cellY(piece, rot, i);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
    if ((board[row * COLS + col] ?? EMPTY) !== EMPTY) return false;
  }
  return true;
}

function isGrounded(player: TetrisPlayer): boolean {
  return !canPlace(player.board, player.piece, player.rot, player.x, player.y + 1);
}

/** Fila donde la pieza quedaria si cayera ya. Es lo que dibuja el fantasma. */
export function ghostY(match: TetrisMatch, seat: number): number {
  const player = playerAt(match, seat);
  if (player.piece < 0) return player.y;
  let y = player.y;
  while (canPlace(player.board, player.piece, player.rot, player.x, y + 1)) y++;
  return y;
}

function toppedOut(board: Uint8Array): boolean {
  for (let i = 0; i < HIDDEN_ROWS * COLS; i++) {
    if ((board[i] ?? EMPTY) !== EMPTY) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Aparicion, retencion y fijado                                        */
/* ------------------------------------------------------------------ */

/**
 * Deja una pieza en su posicion de aparicion. Publica porque las pruebas la
 * usan para armar una situacion sin jugar veinte piezas hasta llegar a ella.
 */
export function setActivePiece(player: TetrisPlayer, piece: number, rot: number, x: number, y: number): void {
  player.piece = piece;
  player.rot = rot;
  player.x = x;
  player.y = y;
  player.lowestY = y;
  player.lockMs = 0;
  player.lockResets = 0;
  player.gravityAccMs = 0;
  player.arrMs = 0;
  player.grounded = isGrounded(player);
}

function placeSpawn(player: TetrisPlayer, piece: number): void {
  setActivePiece(player, piece, 0, SPAWN_X[piece] ?? 3, 0);
  player.phase = "falling";
  // Bloqueo de aparicion: la pieza nueva no entra, la pila llego arriba.
  if (!canPlace(player.board, piece, 0, player.x, player.y)) killPlayer(player);
}

function spawnNext(match: TetrisMatch, player: TetrisPlayer): void {
  const piece = pieceAt(match, player.queueCursor);
  player.queueCursor++;
  // La retencion vuelve a estar disponible: es una vez por pieza, no por vida.
  player.holdUsed = false;
  placeSpawn(player, piece);
}

/**
 * Se pregunta por funcion y no en linea a proposito: adentro del paso hay
 * llamadas que matan al jugador (la basura que desborda), y leyendo el campo
 * directo el compilador estrecha el tipo y da por imposible una comparacion
 * que si pasa en tiempo de ejecucion.
 */
function isDead(player: TetrisPlayer): boolean {
  return player.phase === "dead";
}

function killPlayer(player: TetrisPlayer): void {
  if (isDead(player)) return;
  player.phase = "dead";
  player.moveDir = 0;
  player.softDrop = false;
  player.evDead++;
}

/**
 * Un movimiento o una rotacion que entra reinicia el retardo de fijado.
 *
 * Con un tope, para que no se pueda eternizar una pieza. El contador de
 * reinicios se devuelve entero cuando la pieza alcanza una fila mas baja que
 * ninguna anterior: bajar es progreso, no demora.
 */
function afterMove(player: TetrisPlayer, rules: TetrisRules): void {
  if (player.y > player.lowestY) {
    player.lowestY = player.y;
    player.lockResets = 0;
    player.lockMs = 0;
    player.grounded = isGrounded(player);
    return;
  }
  if (isGrounded(player)) {
    player.grounded = true;
    if (player.lockResets < rules.maxLockResets) {
      player.lockResets++;
      player.lockMs = 0;
    }
    return;
  }
  player.grounded = false;
  player.lockMs = 0;
}

function tryMove(player: TetrisPlayer, rules: TetrisRules, dx: number, dy: number): boolean {
  if (player.phase !== "falling") return false;
  if (!canPlace(player.board, player.piece, player.rot, player.x + dx, player.y + dy)) return false;
  player.x += dx;
  player.y += dy;
  afterMove(player, rules);
  return true;
}

function lockPiece(match: TetrisMatch, player: TetrisPlayer): void {
  const piece = player.piece;
  if (piece < 0) return;

  for (let i = 0; i < 4; i++) {
    const col = player.x + cellX(piece, player.rot, i);
    const row = player.y + cellY(piece, player.rot, i);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;
    player.board[row * COLS + col] = piece + 1;
  }
  player.piece = -1;
  player.grounded = false;
  player.evLocked++;

  player.clearCount = 0;
  for (let row = 0; row < ROWS; row++) {
    let full = true;
    for (let col = 0; col < COLS; col++) {
      if ((player.board[row * COLS + col] ?? EMPTY) === EMPTY) {
        full = false;
        break;
      }
    }
    if (full && player.clearCount < 4) {
      player.clearRows[player.clearCount] = row;
      player.clearCount++;
    }
  }

  if (player.clearCount === 0) {
    player.combo = 0;
    // La pila llego a las filas ocultas: se acabo.
    if (toppedOut(player.board)) {
      killPlayer(player);
      return;
    }
    spawnNext(match, player);
    return;
  }

  scoreClear(match, player);
  // El aplastado corre antes del colapso. Es lo que hace legible que las filas
  // desaparecieron, y se conserva con movimiento reducido por eso mismo.
  player.phase = "clearing";
  player.clearMs = match.rules.clearDelayMs;
  player.evLines += player.clearCount;
}

function scoreClear(match: TetrisMatch, player: TetrisPlayer): void {
  const rules = match.rules;
  const count = player.clearCount;

  // Los puntos usan el nivel con el que se hizo la linea, no el de despues.
  player.linePoints += (rules.lineScores[count - 1] ?? 0) * player.level;
  player.lines += count;
  const step = Math.floor(player.lines / rules.linesPerLevel);
  player.level = 1 + step;
  player.gravityMs = Math.max(MIN_GRAVITY_MS, rules.gravityMs * Math.pow(rules.gravityFactor, step));

  let outgoing = (rules.garbageTable[count - 1] ?? 0) + (player.combo > 0 ? rules.comboBonus : 0);
  player.combo++;

  // Compensacion: lo que completaste primero cancela lo que te viene. Sin
  // esto el que se adelanta gana solo y no hay remontadas.
  outgoing = cancelPending(player, outgoing);
  if (outgoing > 0) {
    pushGarbage(match, playerAt(match, otherSeat(player.seat)), outgoing);
    player.garbageSent += outgoing;
  }
}

function collapseRows(player: TetrisPlayer): void {
  let write = ROWS - 1;
  for (let row = ROWS - 1; row >= 0; row--) {
    let cleared = false;
    for (let i = 0; i < player.clearCount; i++) {
      if ((player.clearRows[i] ?? -1) === row) {
        cleared = true;
        break;
      }
    }
    if (cleared) continue;
    if (write !== row) player.board.copyWithin(write * COLS, row * COLS, row * COLS + COLS);
    write--;
  }
  for (let row = write; row >= 0; row--) player.board.fill(EMPTY, row * COLS, row * COLS + COLS);
  player.clearCount = 0;
}

/* ------------------------------------------------------------------ */
/* Basura                                                               */
/* ------------------------------------------------------------------ */

/** Filas que le vienen encima a este jugador y todavia no entraron. */
export function pendingGarbage(player: TetrisPlayer): number {
  let total = 0;
  for (let i = 0; i < player.pendingCount; i++) total += player.pendingRows[i] ?? 0;
  return total;
}

/** ms que le faltan a la tanda mas proxima. Sirve para dibujarla en viaje. */
export function pendingProgress(player: TetrisPlayer, index: number, windowMs: number): number {
  if (windowMs <= 0) return 1;
  const left = player.pendingMs[index] ?? 0;
  return Math.min(1, Math.max(0, 1 - left / windowMs));
}

function pushGarbage(match: TetrisMatch, target: TetrisPlayer, rows: number): void {
  if (rows <= 0) return;
  if (target.pendingCount >= PENDING_CAPACITY) {
    // Cola llena: se suma a la ultima tanda en vez de perderse. Perder ataques
    // en silencio seria peor que una fila de mas.
    const last = target.pendingCount - 1;
    target.pendingRows[last] = (target.pendingRows[last] ?? 0) + rows;
    return;
  }
  target.pendingRows[target.pendingCount] = rows;
  target.pendingMs[target.pendingCount] = match.rules.garbageWindowMs;
  target.pendingCount++;
}

/**
 * Descuenta de lo que viene en camino y devuelve lo que sobra para el rival.
 *
 * Se cancela desde la tanda mas vieja, que es la que esta por caer: es lo que
 * convierte una linea a tiempo en una defensa y no en un consuelo.
 */
function cancelPending(player: TetrisPlayer, incoming: number): number {
  let left = incoming;
  let index = 0;
  while (left > 0 && index < player.pendingCount) {
    const rows = player.pendingRows[index] ?? 0;
    if (rows > left) {
      player.pendingRows[index] = rows - left;
      left = 0;
      break;
    }
    left -= rows;
    player.pendingRows[index] = 0;
    index++;
  }
  if (index > 0) removePending(player, index);
  return left;
}

function removePending(player: TetrisPlayer, count: number): void {
  const remaining = player.pendingCount - count;
  for (let i = 0; i < remaining; i++) {
    player.pendingRows[i] = player.pendingRows[i + count] ?? 0;
    player.pendingMs[i] = player.pendingMs[i + count] ?? 0;
  }
  player.pendingCount = remaining;
}

/**
 * Entra la basura: empuja todo hacia arriba y agrega filas abajo.
 *
 * Todas las filas de una misma tanda comparten el hueco. Cuatro filas con
 * cuatro huecos distintos serian una sentencia de muerte; con uno solo se
 * puede cavar esa columna y devolver el golpe, que es lo que la guia pide
 * cuando habla de remontadas.
 */
function applyGarbage(match: TetrisMatch, player: TetrisPlayer, rows: number): void {
  const n = Math.min(rows, ROWS);
  if (n <= 0) return;

  // Lo que se va por arriba no cabe mas: eso es perder.
  let overflow = false;
  for (let row = 0; row < n && !overflow; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((player.board[row * COLS + col] ?? EMPTY) !== EMPTY) {
        overflow = true;
        break;
      }
    }
  }

  player.board.copyWithin(0, n * COLS, ROWS * COLS);
  const hole = nextHole(match, player);
  for (let i = 0; i < n; i++) {
    const row = ROWS - n + i;
    for (let col = 0; col < COLS; col++) {
      player.board[row * COLS + col] = col === hole ? EMPTY : GARBAGE;
    }
  }

  player.garbageTaken += n;
  player.evGarbage += n;

  // La pieza sube con el tablero. Si no, queda enterrada en la basura que
  // acaba de entrar y se pierde por algo que no hizo nadie.
  if (player.phase === "falling" && player.piece >= 0) {
    let y = player.y;
    let steps = 0;
    while (!canPlace(player.board, player.piece, player.rot, player.x, y) && steps < n) {
      y--;
      steps++;
    }
    if (canPlace(player.board, player.piece, player.rot, player.x, y)) {
      player.y = y;
      player.lowestY = Math.min(player.lowestY, y);
      player.grounded = isGrounded(player);
    } else {
      overflow = true;
    }
  }

  if (overflow || toppedOut(player.board)) killPlayer(player);
}

function tickGarbage(match: TetrisMatch, player: TetrisPlayer, dtMs: number): void {
  if (player.pendingCount === 0) return;
  let landed = 0;
  for (let i = 0; i < player.pendingCount; i++) {
    player.pendingMs[i] = (player.pendingMs[i] ?? 0) - dtMs;
  }
  // Mientras las filas colapsan no entra nada: meter basura a mitad del
  // aplastado moveria las filas marcadas y el colapso borraria otras.
  if (player.phase !== "falling") return;
  while (landed < player.pendingCount && (player.pendingMs[landed] ?? 0) <= 0) {
    applyGarbage(match, player, player.pendingRows[landed] ?? 0);
    landed++;
    // Se lee por funcion a proposito: TS no ve que `applyGarbage` muta la fase.
    if (isDead(player)) break;
  }
  if (landed > 0) removePending(player, landed);
}

/* ------------------------------------------------------------------ */
/* Entrada — el host recibe intenciones, nunca resultados               */
/* ------------------------------------------------------------------ */

/**
 * "Empece a mantener" / "solte" un costado.
 *
 * El primer paso sale en el acto y despues manda el DAS. El telefono solo
 * avisa el borde: la repeticion se cuenta aca, en el host, o la latencia
 * decidiria el ritmo del juego.
 */
export function setMoveHeld(match: TetrisMatch, seat: number, dir: number, pressed: boolean): void {
  const player = playerAt(match, seat);
  if (isDead(player)) return;
  if (!pressed) {
    // Soltar el otro costado mientras este sigue apretado no corta nada.
    if (player.moveDir === dir) {
      player.moveDir = 0;
      player.dasMs = 0;
      player.arrMs = 0;
    }
    return;
  }
  player.moveDir = dir;
  player.dasMs = 0;
  player.arrMs = 0;
  tryMove(player, match.rules, dir, 0);
}

export function setSoftDrop(match: TetrisMatch, seat: number, pressed: boolean): void {
  const player = playerAt(match, seat);
  if (isDead(player)) return;
  player.softDrop = pressed;
  // Sin esto, soltar y volver a apretar reusaria el acumulador de la gravedad
  // lenta y la primera celda bajaria tarde.
  if (pressed) player.gravityAccMs = 0;
}

/** dir 1 = horario, -1 = antihorario. Devuelve si la rotacion entro. */
export function rotate(match: TetrisMatch, seat: number, dir: number): boolean {
  const player = playerAt(match, seat);
  if (player.phase !== "falling" || player.piece < 0) return false;

  const from = player.rot;
  const to = (from + (dir > 0 ? 1 : 3)) % 4;
  const table = player.piece === PIECE_I ? KICKS_I : KICKS_MAIN;
  const base = (from * 4 + to) * KICK_STEPS * 2;

  for (let k = 0; k < KICK_STEPS; k++) {
    const dx = table[base + k * 2] ?? 0;
    const dy = table[base + k * 2 + 1] ?? 0;
    if (!canPlace(player.board, player.piece, to, player.x + dx, player.y + dy)) continue;
    player.rot = to;
    player.x += dx;
    player.y += dy;
    afterMove(player, match.rules);
    player.evRotate++;
    return true;
  }
  return false;
}

/** Retencion: una sola vez por pieza. Devuelve si se pudo. */
export function holdPiece(match: TetrisMatch, seat: number): boolean {
  const player = playerAt(match, seat);
  if (player.phase !== "falling" || player.piece < 0 || player.holdUsed) return false;

  const current = player.piece;
  if (player.hold < 0) {
    player.hold = current;
    spawnNext(match, player);
  } else {
    const swap = player.hold;
    player.hold = current;
    placeSpawn(player, swap);
  }
  player.holdUsed = true;
  player.evHold++;
  return true;
}

/** Caida dura: instantanea, 2 puntos por celda, y fija sin retardo. */
export function hardDrop(match: TetrisMatch, seat: number): void {
  const player = playerAt(match, seat);
  if (player.phase !== "falling" || player.piece < 0) return;

  let dropped = 0;
  while (canPlace(player.board, player.piece, player.rot, player.x, player.y + 1)) {
    player.y++;
    dropped++;
  }
  player.dropPoints += dropped * HARD_DROP_POINT;
  player.evDrop += dropped;
  lockPiece(match, player);
}

/* ------------------------------------------------------------------ */
/* Paso                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Un paso de un jugador. Publica ademas de `stepMatch` porque las pruebas
 * necesitan mover un solo tablero sin que el otro decida el fin de la partida.
 */
export function stepPlayer(match: TetrisMatch, seat: number, dtMs: number): void {
  const player = playerAt(match, seat);
  const rules = match.rules;
  if (player.phase === "dead" || player.phase === "idle") return;

  tickGarbage(match, player, dtMs);
  if (isDead(player)) return;

  if (player.phase === "clearing") {
    player.clearMs -= dtMs;
    if (player.clearMs <= 0) {
      collapseRows(player);
      spawnNext(match, player);
    }
    return;
  }

  // DAS y ARR. Sin esto hay que tocar ocho veces para cruzar el tablero: es la
  // diferencia entre control y pelea.
  if (player.moveDir !== 0) {
    player.dasMs += dtMs;
    if (player.dasMs >= rules.dasMs) {
      player.arrMs += dtMs;
      const arr = Math.max(1, rules.arrMs);
      let guard = 0;
      while (player.arrMs >= arr && guard < COLS) {
        player.arrMs -= arr;
        guard++;
        if (!tryMove(player, rules, player.moveDir, 0)) {
          // Contra la pared el acumulador se vacia: si no, soltar y volver a
          // la otra direccion dispararia una rafaga guardada.
          player.arrMs = 0;
          break;
        }
      }
    }
  }

  const gravityMs = player.softDrop
    ? Math.max(1, player.gravityMs / rules.softDropFactor)
    : Math.max(1, player.gravityMs);
  player.gravityAccMs += dtMs;
  let steps = 0;
  while (player.gravityAccMs >= gravityMs && steps < ROWS) {
    player.gravityAccMs -= gravityMs;
    steps++;
    if (!tryMove(player, rules, 0, 1)) {
      player.gravityAccMs = 0;
      break;
    }
    if (player.softDrop) player.dropPoints += SOFT_DROP_POINT;
  }

  // Retardo de fijado: apoyada, la pieza todavia se puede deslizar.
  if (isGrounded(player)) {
    player.grounded = true;
    player.lockMs += dtMs;
    if (player.lockMs >= rules.lockDelayMs) lockPiece(match, player);
  } else {
    player.grounded = false;
    player.lockMs = 0;
  }
}

/** Avanza los dos tableros y decide si la partida termino por desborde. */
export function stepMatch(match: TetrisMatch, dtMs: number): void {
  if (match.over) return;
  match.elapsedMs += dtMs;
  stepPlayer(match, 0, dtMs);
  stepPlayer(match, 1, dtMs);

  const left = match.players[0];
  const right = match.players[1];
  if (left.phase !== "dead" && right.phase !== "dead") return;

  match.over = true;
  match.reason = "topout";
  if (left.phase === "dead" && right.phase === "dead") match.winner = leaderByLines(match);
  else match.winner = left.phase === "dead" ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Finales                                                              */
/* ------------------------------------------------------------------ */

/** Quien tiene mas lineas. -1 si empatan. */
export function leaderByLines(match: TetrisMatch): number {
  const left = match.players[0].lines;
  const right = match.players[1].lines;
  if (left === right) return -1;
  return left > right ? 0 : 1;
}

/** Se acabo `gameDurationMs` o llego `force-end`: gana quien tenga mas lineas. */
export function finishByLines(match: TetrisMatch, reason: "time" | "forced"): void {
  if (match.over) return;
  match.over = true;
  match.reason = reason;
  match.winner = leaderByLines(match);
}

/** No volvio de la desconexion: el otro gana por abandono. */
export function finishByQuit(match: TetrisMatch, quitterSeat: number): void {
  if (match.over) return;
  match.over = true;
  match.reason = "quit";
  match.winner = otherSeat(quitterSeat);
}

/* ------------------------------------------------------------------ */
/* Puntos y eventos                                                     */
/* ------------------------------------------------------------------ */

export function tetrisPoints(match: TetrisMatch, seat: number): number {
  const player = playerAt(match, seat);
  const rules = match.rules;
  const won = match.winner === seat ? rules.pointsWin : 0;
  return Math.round(player.linePoints + player.garbageSent * rules.pointsPerGarbage + won + player.dropPoints);
}

/** El render consume los eventos y los apaga. Contadores, no objetos. */
export function clearEvents(player: TetrisPlayer): void {
  player.evLines = 0;
  player.evLocked = 0;
  player.evGarbage = 0;
  player.evHold = 0;
  player.evRotate = 0;
  player.evDrop = 0;
  player.evDead = 0;
}
