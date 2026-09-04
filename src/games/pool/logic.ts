import type { Rng } from "@/core/engine/rng";

/**
 * X2 · Pool — la logica pura.
 *
 * Todo lo que decide una partida vive aca y no toca three, ni Rapier, ni la
 * red: el armado del triangulo, quien es de lisas y quien de rayadas, que es
 * falta y **por que**, cuando se cierra el turno y como se cuentan los puntos.
 *
 * La division con la escena es la que pide la guia y no es cosmetica: la
 * fisica la corre Rapier en el proyector, pero Rapier no sabe de reglas. Lo
 * unico que sale del solver es una lista de eventos —que bola se toco primero,
 * cuales cayeron— y con eso `resolveShot` decide la partida entera. Eso hace
 * que las reglas se prueben sin GPU, que es lo que permite tener un test por
 * cada falta en vez de descubrirlas jugando.
 *
 * Dos decisiones que conviene no revisar:
 *
 * 1. **El motivo de la falta es un dato, no un string suelto.** `FoulReason`
 *    es una union cerrada y `foulTextOf` la traduce en un lugar unico. La guia
 *    pide el cartel *"Falta: no tocaste ninguna lisa"*, y con el motivo tipado
 *    el cartel del proyector y el aviso del mando no pueden contradecirse.
 * 2. **El triangulo se arma con el `Rng` sembrado.** Sin eso, dos maquinas de
 *    la misma partida rackean distinto y no hay forma de reproducir un bug.
 *    Es tambien el criterio de aceptacion 12: misma semilla y mismo tiro,
 *    resultado identico.
 */

/* ------------------------------------------------------------------ */
/* Geometria: proporciones reales                                      */
/* ------------------------------------------------------------------ */

/**
 * Medidas de una mesa de 9 pies, en metros, y el radio real de 28,5 mm.
 *
 * La guia insiste con las proporciones reales y tiene razon: todo el mundo
 * sabe como se ve una mesa de pool, y una bola apenas mas grande de lo que
 * corresponde se lee como error antes de que nadie sepa por que.
 */
export const TABLE_LENGTH = 2.54;
export const TABLE_WIDTH = 1.27;
export const BALL_RADIUS = 0.0285;

/** Boca del bolsillo. Poco mas de dos radios: entra la bola, no dos juntas. */
export const POCKET_RADIUS = 0.062;

/** 15 numeradas + la blanca. */
export const BALL_COUNT = 16;
export const CUE_BALL = 0;
export const EIGHT_BALL = 8;

/** Siempre dos. Es un duelo, y la guia no contempla otra cosa. */
export const POOL_SEATS = 2;

/**
 * Donde se pone la blanca al sacar y despues de embocarla: el punto de
 * cabecera, a un cuarto de la mesa. La punta del triangulo va simetrica.
 */
export const HEAD_SPOT_X = -TABLE_LENGTH / 4;
export const FOOT_SPOT_X = TABLE_LENGTH / 4;

/** Los seis bolsillos: cuatro esquinas y dos de medio. */
export const POCKETS: readonly { x: number; z: number }[] = [
  { x: -TABLE_LENGTH / 2, z: -TABLE_WIDTH / 2 },
  { x: 0, z: -TABLE_WIDTH / 2 },
  { x: TABLE_LENGTH / 2, z: -TABLE_WIDTH / 2 },
  { x: -TABLE_LENGTH / 2, z: TABLE_WIDTH / 2 },
  { x: 0, z: TABLE_WIDTH / 2 },
  { x: TABLE_LENGTH / 2, z: TABLE_WIDTH / 2 },
];

/* ------------------------------------------------------------------ */
/* Fisica: los numeros de la guia, en un solo lugar                    */
/* ------------------------------------------------------------------ */

/**
 * Constantes del solver.
 *
 * Viven aca y no en la escena porque son **reglas del juego disfrazadas de
 * fisica**: cambiar la restitucion de las bandas cambia como se juega, igual
 * que cambiar el tamano del bolsillo. Tenerlas junto a las reglas evita que
 * alguien las toque pensando que ajusta un detalle visual.
 */
export const PHYSICS = {
  /** Casi elastica: dos bolas de resina no pierden casi nada al chocar. */
  restitutionBall: 0.95,
  /** La banda absorbe bastante mas que una bola. */
  restitutionRail: 0.75,
  /** Lo unico que hace que las bolas se frenen. */
  rollingFriction: 0.015,
  angularDamping: 0.4,
  /**
   * `1/120`, no `1/60`. Un tiro fuerte mueve la blanca varios diametros por
   * paso, y a 60 Hz el solver la mete adentro de otra bola antes de poder
   * resolver el contacto. Con CCD encendido ademas, que es lo que evita el
   * atravesado directo.
   */
  step: 1 / 120,
} as const;

/**
 * Debajo de esto una bola cuenta como quieta.
 *
 * 5 mm/s: a esa velocidad una bola tarda mas de un minuto en cruzar la mesa,
 * asi que ya no va a cambiar el resultado del turno, y esperar a cero real es
 * esperar a que el solver termine de decidir un empate entre friccion y ruido
 * numerico.
 */
export const SETTLE_SPEED = 0.005;

/** Tope duro para cerrar el turno aunque algo siga moviendose. */
export const SETTLE_TIMEOUT_MS = 12_000;

/** Turno vencido: tiro automatico suave. Nunca dejar la mesa trabada. */
export const TURN_TIMEOUT_MS = 45_000;

/* ------------------------------------------------------------------ */
/* Bolas y grupos                                                      */
/* ------------------------------------------------------------------ */

export type Group = "solids" | "stripes";

/** Que es cada numero. La blanca y la 8 no pertenecen a ningun grupo. */
export type BallKind = Group | "cue" | "eight";

export function kindOf(id: number): BallKind {
  if (id === CUE_BALL) return "cue";
  if (id === EIGHT_BALL) return "eight";
  return id < EIGHT_BALL ? "solids" : "stripes";
}

/** El otro grupo. Existe para no repetir el ternario en cinco lugares. */
export function otherGroup(group: Group): Group {
  return group === "solids" ? "stripes" : "solids";
}

export const GROUP_LABEL: Record<Group, string> = {
  solids: "lisas",
  stripes: "rayadas",
};

/** Singular, para los carteles de falta: "no tocaste ninguna lisa". */
export const GROUP_LABEL_ONE: Record<Group, string> = {
  solids: "lisa",
  stripes: "rayada",
};

export type BallState = {
  id: number;
  x: number;
  z: number;
  /** Fuera de la mesa. No se simula mas y va al estante del que la emboco. */
  pocketed: boolean;
};

/* ------------------------------------------------------------------ */
/* El triangulo                                                        */
/* ------------------------------------------------------------------ */

/** Indice del hueco `(fila, columna)` en el triangulo, contando desde la punta. */
function slotIndex(row: number, col: number): number {
  return (row * (row + 1)) / 2 + col;
}

/**
 * Arma el triangulo con las reglas del 8-ball, sembrado.
 *
 * Lo que el reglamento fija y aca se respeta:
 *
 * - La 8 va en el centro de la tercera fila. No es decoracion: es lo que hace
 *   que un saque no la emboque de casualidad.
 * - Las dos esquinas del fondo son una de cada grupo, para que el saque no
 *   favorezca sistematicamente a uno.
 * - El resto va mezclado.
 *
 * Las filas se separan `R * sqrt(3)`, que es la altura del triangulo
 * equilatero de lado `2R`: es la unica distancia con la que las quince bolas
 * se tocan sin superponerse. Un valor a ojo deja el rack flojo o encimado, y
 * Rapier lo resuelve con una explosion en el primer paso.
 */
export function rackPositions(rng: Rng): BallState[] {
  const numbered: number[] = [];
  for (let id = 1; id <= 15; id++) if (id !== EIGHT_BALL) numbered.push(id);

  const shuffled = rng.shuffle(numbered);
  const solids = shuffled.filter((id) => kindOf(id) === "solids");
  const stripes = shuffled.filter((id) => kindOf(id) === "stripes");

  /*
   * Las dos esquinas primero: se sacan de sus grupos y lo que queda llena el
   * resto. Cual grupo cae en cual esquina tambien lo decide la semilla, asi
   * que ni siquiera eso es siempre igual.
   */
  const flip = rng.chance(0.5);
  const cornerA = (flip ? solids : stripes).shift() as number;
  const cornerB = (flip ? stripes : solids).shift() as number;

  const rest = rng.shuffle([...solids, ...stripes]);

  const slots: number[] = new Array(15).fill(-1);
  slots[slotIndex(2, 1)] = EIGHT_BALL;
  slots[slotIndex(4, 0)] = cornerA;
  slots[slotIndex(4, 4)] = cornerB;

  let cursor = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === -1) slots[i] = rest[cursor++] as number;
  }

  /*
   * Un pelo de aire entre bolas. Con el contacto exacto, Rapier arranca con
   * quince contactos en penetracion cero y el primer paso los empuja: el rack
   * se abre solo antes de que nadie tire.
   */
  const gap = BALL_RADIUS * 2.02;
  const rowStep = BALL_RADIUS * Math.sqrt(3) * 1.01;

  const balls: BallState[] = [{ id: CUE_BALL, x: HEAD_SPOT_X, z: 0, pocketed: false }];

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      balls.push({
        id: slots[slotIndex(row, col)] as number,
        x: FOOT_SPOT_X + row * rowStep,
        z: (col - row / 2) * gap,
        pocketed: false,
      });
    }
  }

  // Por id, para que `state.balls[7]` sea siempre la 7 y no haya que buscar.
  balls.sort((a, b) => a.id - b.id);
  return balls;
}

/* ------------------------------------------------------------------ */
/* Estado de la partida                                                */
/* ------------------------------------------------------------------ */

export type PoolState = {
  balls: BallState[];
  /** Asiento al que le toca. */
  turn: number;
  /**
   * Grupo por asiento. `null` en los dos = mesa abierta, todavia sin asignar.
   * Se asigna con la primera bola embocada despues del saque.
   */
  groups: [Group | null, Group | null];
  fouls: [number, number];
  /** Tiros cerrados sin falta. Es el `tiroLimpio` del puntaje. */
  cleanShots: [number, number];
  /** La blanca se puede colocar donde sea: el rival cometio falta. */
  ballInHand: boolean;
  /** true hasta que se resuelve el primer tiro. */
  breaking: boolean;
  winner: number | null;
  over: boolean;
};

export function createPoolState(rng: Rng): PoolState {
  return {
    balls: rackPositions(rng),
    turn: 0,
    groups: [null, null],
    fouls: [0, 0],
    cleanShots: [0, 0],
    ballInHand: false,
    breaking: true,
    winner: null,
    over: false,
  };
}

/**
 * El asiento como indice de tupla.
 *
 * Con `noUncheckedIndexedAccess`, indexar una tupla de dos con un `number`
 * devuelve `T | undefined` y obliga a chequear un caso que no existe: en Pool
 * los asientos son exactamente dos. Esto lo dice en el tipo, en un solo lugar,
 * en vez de repartir `!` por todo el archivo.
 */
export function seatIndex(seat: number): 0 | 1 {
  return seat === 0 ? 0 : 1;
}

/** Las que le quedan en la mesa a un asiento. Sin grupo asignado, sus siete. */
export function remainingFor(state: PoolState, seat: number): number {
  const group = state.groups[seatIndex(seat)];
  if (group === null) return 7;
  return state.balls.filter((b) => !b.pocketed && kindOf(b.id) === group).length;
}

/** Ya metio las siete y puede ir por la 8. */
export function canShootEight(state: PoolState, seat: number): boolean {
  return state.groups[seatIndex(seat)] !== null && remainingFor(state, seat) === 0;
}

/* ------------------------------------------------------------------ */
/* Resolucion del tiro                                                 */
/* ------------------------------------------------------------------ */

/**
 * Lo unico que la escena le cuenta a las reglas.
 *
 * Se arma mirando los contactos de Rapier y los bolsillos, y se entrega
 * cuando la mesa se aquieta. Nada de velocidades ni posiciones: si una regla
 * necesitara eso, estaria mal pensada.
 */
export type ShotEvents = {
  /** Primera bola que toco la blanca. `null` = no toco ninguna. */
  firstContact: number | null;
  /** Ids que cayeron, en cualquier bolsillo, incluida la blanca y la 8. */
  pocketed: readonly number[];
};

export type FoulReason =
  /** Emboco la blanca. */
  | "cue-pocketed"
  /** La blanca no toco nada. */
  | "no-contact"
  /** Toco primero una que no es de su grupo. */
  | "wrong-first"
  /** Emboco una del rival. */
  | "opponent-pocketed";

export type ShotResult = {
  foul: FoulReason | null;
  /** Ya armado y en castellano. El proyector y el mando muestran este mismo. */
  foulText: string | null;
  /** Grupo asignado en este tiro, si la mesa estaba abierta. */
  assigned: Group | null;
  /** Sigue tirando el mismo asiento. */
  keepsTurn: boolean;
  /** Bolas propias que emboco en este tiro. Suma puntos. */
  ownPocketed: number;
  winner: number | null;
  /** Perdio embocando la 8 antes de tiempo o junto con una falta. */
  lostOnEight: boolean;
};

/**
 * Si le tocaba la 8 **antes** de este tiro.
 *
 * Las bolas propias que cayeron en este mismo tiro no cuentan para habilitar
 * la 8: embocar la ultima propia y la 8 en la misma tirada pierde. Es la
 * regla estandar, y es la que evita que la partida la termine un golpe de
 * suerte en vez de una decision.
 */
function eightWasLegal(state: PoolState, seat: number, pocketed: readonly number[]): boolean {
  const group = state.groups[seatIndex(seat)];
  if (group === null) return false;
  // `state.balls` ya tiene aplicado el tiro, asi que se reconstruye el estado
  // previo volviendo a contar como en mesa lo que cayo recien.
  const ownStillOnTableBefore = state.balls.filter(
    (b) => kindOf(b.id) === group && (!b.pocketed || pocketed.includes(b.id)),
  );
  return ownStillOnTableBefore.length === 0;
}

function detectFoul(
  state: PoolState,
  seat: number,
  events: ShotEvents,
  cuePocketed: boolean,
  wasOpen: boolean,
): FoulReason | null {
  if (cuePocketed) return "cue-pocketed";
  if (events.firstContact === null) return "no-contact";

  const group = state.groups[seatIndex(seat)];

  /*
   * Mesa abierta: cualquier primera bola vale menos la 8. Tocar la 8 primero
   * con la mesa abierta es falta en el reglamento y aca tambien, porque si no
   * el saque optimo seria apuntarle siempre.
   */
  if (wasOpen || group === null) {
    return events.firstContact === EIGHT_BALL ? "wrong-first" : null;
  }

  const needsEight = remainingFor(state, seat) === 0;
  if (needsEight) {
    if (events.firstContact !== EIGHT_BALL) return "wrong-first";
  } else if (kindOf(events.firstContact) !== group) {
    return "wrong-first";
  }

  // Embocar una del rival es falta aunque el primer contacto haya sido legal.
  const rivalGroup = otherGroup(group);
  const sankRival = events.pocketed.some(
    (id) => id !== CUE_BALL && id !== EIGHT_BALL && kindOf(id) === rivalGroup,
  );
  return sankRival ? "opponent-pocketed" : null;
}

/**
 * El cartel. Un solo lugar, porque el proyector y el mando muestran el mismo
 * texto y verlos discrepar es peor que no mostrar nada.
 */
export function foulTextOf(foul: FoulReason, group: Group | null): string {
  switch (foul) {
    case "cue-pocketed":
      return "Falta: embocaste la blanca.";
    case "no-contact":
      return "Falta: no tocaste ninguna bola.";
    case "wrong-first":
      return group === null
        ? "Falta: tocaste primero la 8."
        : `Falta: no tocaste ninguna ${GROUP_LABEL_ONE[group]}.`;
    case "opponent-pocketed":
      return "Falta: embocaste una del rival.";
  }
}

/**
 * Aplica un tiro y devuelve que paso. **Muta `state`.**
 *
 * El orden importa y es el del reglamento:
 *
 * 1. Se sacan de la mesa las que cayeron.
 * 2. Si cayo la 8, eso decide la partida y no se mira nada mas.
 * 3. Se asigna grupo si la mesa estaba abierta.
 * 4. Se evalua la falta.
 * 5. Se decide si sigue tirando.
 *
 * Asignar **antes** de evaluar la falta es lo que hace que el tiro que abre la
 * mesa no sea falta por "tocaste una que no es tuya": con la mesa abierta
 * todavia no hay un grupo propio que respetar.
 */
export function resolveShot(state: PoolState, events: ShotEvents): ShotResult {
  const seat = state.turn;
  const rival = 1 - seat;
  const pocketed = events.pocketed;

  for (const id of pocketed) {
    const ball = state.balls[id];
    if (ball) ball.pocketed = true;
  }

  const cuePocketed = pocketed.includes(CUE_BALL);
  const wasOpen = state.groups[seatIndex(seat)] === null;

  /*
   * La 8 primero. El resto de las reglas no la puede salvar ni condenar: si
   * cayo y no le tocaba, perdio; si le tocaba pero ademas emboco la blanca,
   * tambien. Es la unica jugada que ignora todo lo demas.
   */
  if (pocketed.includes(EIGHT_BALL)) {
    const legal = eightWasLegal(state, seat, pocketed) && !cuePocketed;
    state.over = true;
    state.winner = legal ? seat : rival;
    if (!legal) state.fouls[seatIndex(seat)]++;
    return {
      foul: cuePocketed ? "cue-pocketed" : null,
      foulText: legal ? null : "Embocaste la 8 antes de tiempo.",
      assigned: null,
      keepsTurn: false,
      ownPocketed: 0,
      winner: state.winner,
      lostOnEight: !legal,
    };
  }

  /*
   * Asignacion de grupo. La guia la ata a "la primera bola embocada tras el
   * saque", asi que el saque mismo NO asigna: es el tiro mas caotico de la
   * partida y dejar que reparta grupos al azar seria decidirla ahi.
   */
  let assigned: Group | null = null;
  if (wasOpen && !state.breaking) {
    const first = pocketed.find((id) => id !== CUE_BALL && id !== EIGHT_BALL);
    if (first !== undefined) {
      assigned = kindOf(first) as Group;
      state.groups[seatIndex(seat)] = assigned;
      state.groups[seatIndex(rival)] = otherGroup(assigned);
    }
  }

  const group = state.groups[seatIndex(seat)];
  const foul = detectFoul(state, seat, events, cuePocketed, wasOpen);

  const ownPocketed = pocketed.filter(
    (id) => id !== CUE_BALL && id !== EIGHT_BALL && group !== null && kindOf(id) === group,
  ).length;

  state.breaking = false;

  if (foul !== null) {
    state.fouls[seatIndex(seat)]++;
    // Tras falta el rival mueve la blanca. Es la unica compensacion del juego
    // y lo que hace que pegar fuerte a ver que pasa tenga costo.
    state.ballInHand = true;
    state.turn = rival;
    return {
      foul,
      foulText: foulTextOf(foul, group),
      assigned,
      keepsTurn: false,
      ownPocketed,
      winner: null,
      lostOnEight: false,
    };
  }

  state.cleanShots[seatIndex(seat)]++;
  state.ballInHand = false;

  // Turno extra al embocar una propia. La que asigno el grupo cuenta como
  // propia, que es lo que hace que abrir la mesa no regale el turno.
  const keepsTurn = ownPocketed > 0;
  if (!keepsTurn) state.turn = rival;

  return {
    foul: null,
    foulText: null,
    assigned,
    keepsTurn,
    ownPocketed,
    winner: null,
    lostOnEight: false,
  };
}

/* ------------------------------------------------------------------ */
/* La mesa como la ve el celular                                       */
/* ------------------------------------------------------------------ */

/**
 * De metros a las coordenadas del mando.
 *
 * **Los dos ejes se dividen por el largo**, no cada uno por su lado. Es la
 * unica forma de que un angulo signifique lo mismo de los dos lados: con
 * escalas distintas, apuntar a 30 grados en el telefono seria otro angulo en
 * la mesa, y la linea de tiro dejaria de coincidir con la trayectoria real.
 */
export function toAimPoint(x: number, z: number): { x: number; z: number } {
  return {
    x: (x + TABLE_LENGTH / 2) / TABLE_LENGTH,
    z: (z + TABLE_WIDTH / 2) / TABLE_LENGTH,
  };
}

/** La vuelta, para colocar la blanca donde toco el dedo. */
export function fromAimPoint(x: number, z: number): { x: number; z: number } {
  return {
    x: x * TABLE_LENGTH - TABLE_LENGTH / 2,
    z: z * TABLE_LENGTH - TABLE_WIDTH / 2,
  };
}

/** Radio y boca en la escala del mando. */
export const AIM_ASPECT = TABLE_LENGTH / TABLE_WIDTH;
export const AIM_BALL_RADIUS = BALL_RADIUS / TABLE_LENGTH;
export const AIM_POCKET_RADIUS = POCKET_RADIUS / TABLE_LENGTH;

/* ------------------------------------------------------------------ */
/* Fin por tiempo                                                      */
/* ------------------------------------------------------------------ */

/**
 * Quien gana si se acaba `gameDurationMs`: el que tenga menos bolas propias en
 * la mesa. Empate en cantidad devuelve `null`, y con eso los dos reciben un
 * outcome sin victoria en vez de inventar un desempate.
 */
export function winnerByRemaining(state: PoolState): number | null {
  const a = remainingFor(state, 0);
  const b = remainingFor(state, 1);
  if (a === b) return null;
  return a < b ? 0 : 1;
}

/* ------------------------------------------------------------------ */
/* Puntos                                                              */
/* ------------------------------------------------------------------ */

/**
 * La formula de la guia, tal cual.
 *
 * Es el unico juego del catalogo donde una falta resta, y es a proposito: sin
 * costo, la estrategia optima es pegar fuerte siempre y rezar. El
 * `Math.max(0, …)` evita que alguien termine en negativo, que en un evento se
 * lee como error del sistema y no como resultado.
 */
export function poolPoints(input: {
  ownPocketed: number;
  fouls: number;
  won: boolean;
  cleanShots: number;
}): number {
  const pocketed = input.ownPocketed * 200;
  const fouls = input.fouls * -50;
  const victory = input.won ? 800 : 0;
  const clean = input.cleanShots * 40;
  return Math.max(0, pocketed + fouls + victory + clean);
}
