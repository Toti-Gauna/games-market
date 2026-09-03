import { clamp, sweepCircleBox, type Box, type Circle } from "@/core/engine/collide";

/**
 * Fisica y reglas de Supernova Futbol. Sin React, sin canvas, sin red.
 *
 * Es un Haxball: todo es un disco con masa, la resolucion es por impulso y
 * patear es un golpe, no un arrastre. Cinco decisiones cargan el archivo:
 *
 * 1. **Fisica a mano, no Rapier.** La reconciliacion de `prediction.ts` exige
 *    un `step(estado, input, dt)` PURO que se pueda re-correr N veces sobre un
 *    estado autoritativo cualquiera. Un motor con mundo mutable adentro no da
 *    eso sin serializar el mundo entero cada 50 ms, y ademas obliga a un
 *    `init()` asincrono que este archivo no puede tener si quiere testearse en
 *    node. Discos con rebote elastico son sesenta lineas y se controlan enteras.
 * 2. **Paso fijo, y el paso vive en las reglas.** `stepMatch(state)` no recibe
 *    `dt`: lo saca de `state.rules.step`. Un `dt` variable rompe la fisica Y la
 *    reconciliacion al mismo tiempo, asi que directamente no se puede pasar.
 * 3. **Barrido contra las paredes.** Una pelota pateada de primera sale a mas
 *    de 1500 u/s y un rebote entre discos la deja todavia mas rapida; sin
 *    barrido atraviesa la pared y nadie entiende por que. `sweepCircleBox`
 *    busca el instante exacto del impacto dentro del paso.
 * 4. **Separar antes de impulsar, y varias iteraciones.** Sin separar, dos
 *    discos quedan pegados vibrando; con una sola iteracion, cinco discos
 *    amontonados se atraviesan.
 * 5. **Cero azar.** El saque es la pelota quieta en el centro y las posiciones
 *    salen de una formacion fija, asi que la simulacion no consume PRNG. Es
 *    deliberado: si `stepMatch` sacara numeros de una semilla, re-simular los
 *    pendientes durante la reconciliacion consumiria la serie del host y las
 *    dos puntas dejarian de coincidir.
 *
 * Cero asignaciones: los cuerpos viven en `Float32Array`, los scratch de
 * colision viven en la geometria y los eventos son literales de union.
 */

/** Ocho asientos: 4 contra 4. Los que no toma nadie los juega un bot. */
export const FUTBOL_SEATS = 8;
export const TEAM_COUNT = 2;
/** La pelota es una entidad mas del snapshot; va despues de los asientos. */
export const BALL_ID = FUTBOL_SEATS;

export const PHASE_KICKOFF = 0;
export const PHASE_PLAYING = 1;
export const PHASE_CELEBRATION = 2;
export const PHASE_OVER = 3;

/** Separacion tras el impacto. Sin esto el disco queda vibrando contra la pared. */
const SKIN = 0.01;
/** Impactos que se resuelven dentro de un mismo paso. Cinco rebotes en 1/120 s no existen. */
const MAX_SWEEPS = 4;
/**
 * Restar 240 veces 1/120 a 2 no da 0 sino 3e-15. Sin margen, la cuenta del
 * saque dura un paso de mas, y siempre.
 */
const TIMER_EPS = 1e-6;
/**
 * La patada queda armada un rato. El dedo llega antes que la pelota mas veces
 * de las que uno cree, y una patada que no sale porque faltaban 20 ms se siente
 * como que el juego no responde.
 */
const KICK_ARMED_S = 0.16;
/** Profundidad de la red detras de la linea. Existe para que el gol se vea. */
const GOAL_DEPTH = 70;
/** Paredes gruesas: un barrido nunca las cruza de lado a lado. */
const WALL_THICKNESS = 240;

export type FutbolTuning = {
  width: number;
  height: number;
  goalWidth: number;
  playerRadius: number;
  ballRadius: number;
  playerSpeed: number;
  playerAccel: number;
  /** Fraccion de velocidad que el jugador PIERDE en un segundo, 0..1. */
  playerFriction: number;
  ballFriction: number;
  kickPower: number;
  kickReach: number;
  kickCooldownS: number;
  restitution: number;
  goalsToWin: number;
  matchSeconds: number;
  celebrationS: number;
  kickoffS: number;
  /** Paso de simulacion en segundos. 1/120 en el juego. */
  step: number;
};

export type FutbolRules = {
  step: number;
  width: number;
  height: number;
  goalWidth: number;
  goalDepth: number;
  postRadius: number;
  playerRadius: number;
  ballRadius: number;
  playerMass: number;
  /** La pelota pesa mucho menos: es lo que deja que un choque la mande lejos. */
  ballMass: number;
  accel: number;
  maxSpeed: number;
  /** Factor por PASO, ya convertido desde el "pierde X por segundo" del panel. */
  playerDamp: number;
  ballDamp: number;
  /**
   * Debajo de esto la pelota se detiene del todo. El decaimiento exponencial
   * nunca llega a cero solo, y una pelota que se arrastra medio pixel por
   * segundo durante un minuto se ve como un bug.
   */
  stopSpeed: number;
  kickPower: number;
  kickReach: number;
  kickCooldownS: number;
  restitution: number;
  wallRestitution: number;
  goalsToWin: number;
  matchSeconds: number;
  celebrationS: number;
  kickoffS: number;
  iterations: number;
};

/** Lo que paso en un paso. Un literal de union no asigna; un objeto de evento si. */
export type FutbolEvent = "none" | "wall" | "post" | "kick" | "goal" | "match";

/** Un cuerpo suelto. Es el formato con el que trabajan barrido e integracion. */
type Body = { x: number; y: number; vx: number; vy: number; r: number };

/** Lo que el cliente predice de su propio disco. Nada mas que eso. */
export type PredictedDisc = { x: number; y: number; vx: number; vy: number };

/** La intencion de movimiento: un vector, ya normalizado por quien lo genera. */
export type DiscIntent = { moveX: number; moveY: number };

/**
 * La cancha: paredes, postes y los scratch de colision.
 *
 * Va aparte del estado porque el predictor necesita la misma geometria sin
 * arrastrar marcador ni reloj, y porque compartir los scratch entre el host y
 * el predictor seria un alias esperando a morder.
 */
export type FieldGeometry = {
  rules: FutbolRules;
  walls: readonly Box[];
  postX: Float32Array;
  postY: Float32Array;
  postCount: number;
  circle: Circle;
  body: Body;
};

export type FutbolState = {
  rules: FutbolRules;
  geo: FieldGeometry;

  /* Discos de los jugadores. */
  px: Float32Array;
  py: Float32Array;
  pvx: Float32Array;
  pvy: Float32Array;
  pTeam: Uint8Array;
  /** Segundos que faltan para poder volver a patear. */
  pKickCd: Float32Array;

  /* Lo unico que escribe el input. El host lo saneia antes de tocarlo. */
  inX: Float32Array;
  inY: Float32Array;
  /** Segundos que le quedan armados a la patada pedida. 0 = no pidio. */
  inKickS: Float32Array;

  ballX: number;
  ballY: number;
  ballVx: number;
  ballVy: number;

  score: Int32Array;
  clockS: number;
  phase: number;
  phaseTimerS: number;
  /** -1 mientras no haya ganador; 2 = empate al terminar el reloj. */
  winnerTeam: number;

  goals: Int32Array;
  assists: Int32Array;
  touches: Int32Array;

  /** Ultimo y penultimo que tocaron. La asistencia sale de aca. */
  lastTouchSeat: number;
  prevTouchSeat: number;

  /* Contadores de evento: el render los compara para disparar efectos sin que
     la logica sepa que existe un render. */
  kickCount: number;
  goalCount: number;
  postCount: number;
  wallCount: number;
  lastKickSeat: number;
  lastKickX: number;
  lastKickY: number;
  lastGoalTeam: number;
  lastGoalSeat: number;
  lastAssistSeat: number;
  /** Cambia en cada saque. Los bots lo usan para renovar su error. */
  kickoffId: number;
};

/* ------------------------------------------------------------------ */
/* Reglas y geometria                                                   */
/* ------------------------------------------------------------------ */

/**
 * El panel habla de "pierde el 92 % por segundo" y la formula necesita el
 * factor por paso. La conversion se hace UNA vez aca y nunca dentro del loop:
 * `Math.pow` tiene precision definida por la implementacion, asi que cuanto
 * menos aparezca en la simulacion, mas parecidas corren dos maquinas distintas.
 */
export function createFutbolRules(tuning: FutbolTuning): FutbolRules {
  const step = tuning.step;
  const playerKeep = clamp(1 - tuning.playerFriction, 0.001, 1);
  const ballKeep = clamp(1 - tuning.ballFriction, 0.001, 1);
  return {
    step,
    width: tuning.width,
    height: tuning.height,
    goalWidth: tuning.goalWidth,
    goalDepth: GOAL_DEPTH,
    postRadius: Math.max(6, tuning.ballRadius * 0.7),
    playerRadius: tuning.playerRadius,
    ballRadius: tuning.ballRadius,
    playerMass: 1,
    ballMass: 0.4,
    accel: tuning.playerAccel,
    maxSpeed: tuning.playerSpeed,
    playerDamp: Math.pow(playerKeep, step),
    ballDamp: Math.pow(ballKeep, step),
    stopSpeed: 6,
    kickPower: tuning.kickPower,
    kickReach: tuning.kickReach,
    kickCooldownS: tuning.kickCooldownS,
    restitution: tuning.restitution,
    // La pared devuelve mas que un disco: un rebote muerto en la banda mata el
    // ritmo del partido.
    wallRestitution: Math.min(0.95, tuning.restitution + 0.25),
    goalsToWin: Math.max(1, Math.round(tuning.goalsToWin)),
    matchSeconds: tuning.matchSeconds,
    celebrationS: tuning.celebrationS,
    kickoffS: tuning.kickoffS,
    // Dos iteraciones dejan pasar el amontonamiento de cinco discos; tres no se
    // notan y con nueve cuerpos no cuestan nada.
    iterations: 3,
  };
}

/** Paredes y postes. Se arma una vez: nada de esto cambia durante el partido. */
export function createFieldGeometry(rules: FutbolRules): FieldGeometry {
  const w = rules.width;
  const h = rules.height;
  const d = rules.goalDepth;
  const t = WALL_THICKNESS;
  const top = goalTop(rules);
  const bottom = goalBottom(rules);
  const mouth = bottom - top;

  const walls: Box[] = [
    { x: -d - t, y: -t, w: w + 2 * (d + t), h: t },
    { x: -d - t, y: h, w: w + 2 * (d + t), h: t },
    { x: -t, y: 0, w: t, h: top },
    { x: -t, y: bottom, w: t, h: h - bottom },
    { x: w, y: 0, w: t, h: top },
    { x: w, y: bottom, w: t, h: h - bottom },
    { x: -d - t, y: top - t, w: t, h: mouth + 2 * t },
    { x: w + d, y: top - t, w: t, h: mouth + 2 * t },
    { x: -d, y: top - t, w: d, h: t },
    { x: -d, y: bottom, w: d, h: t },
    { x: w, y: top - t, w: d, h: t },
    { x: w, y: bottom, w: d, h: t },
  ];

  // Los postes son discos solidos, no huecos: el rebote en el palo es la mitad
  // de la gracia del juego.
  const postX = new Float32Array([0, 0, w, w]);
  const postY = new Float32Array([top, bottom, top, bottom]);

  return {
    rules,
    walls,
    postX,
    postY,
    postCount: 4,
    circle: { x: 0, y: 0, r: 0 },
    body: { x: 0, y: 0, vx: 0, vy: 0, r: 0 },
  };
}

export function goalTop(rules: FutbolRules): number {
  return rules.height / 2 - rules.goalWidth / 2;
}

export function goalBottom(rules: FutbolRules): number {
  return rules.height / 2 + rules.goalWidth / 2;
}

/** Equipo 0 ataca a la derecha; equipo 1, a la izquierda. Asientos alternados. */
export function teamOfSeat(seat: number): number {
  return seat % TEAM_COUNT;
}

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

export function createFutbolState(rules: FutbolRules): FutbolState {
  const state: FutbolState = {
    rules,
    geo: createFieldGeometry(rules),
    px: new Float32Array(FUTBOL_SEATS),
    py: new Float32Array(FUTBOL_SEATS),
    pvx: new Float32Array(FUTBOL_SEATS),
    pvy: new Float32Array(FUTBOL_SEATS),
    pTeam: new Uint8Array(FUTBOL_SEATS),
    pKickCd: new Float32Array(FUTBOL_SEATS),
    inX: new Float32Array(FUTBOL_SEATS),
    inY: new Float32Array(FUTBOL_SEATS),
    inKickS: new Float32Array(FUTBOL_SEATS),
    ballX: rules.width / 2,
    ballY: rules.height / 2,
    ballVx: 0,
    ballVy: 0,
    score: new Int32Array(TEAM_COUNT),
    clockS: rules.matchSeconds,
    phase: PHASE_KICKOFF,
    phaseTimerS: rules.kickoffS,
    winnerTeam: -1,
    goals: new Int32Array(FUTBOL_SEATS),
    assists: new Int32Array(FUTBOL_SEATS),
    touches: new Int32Array(FUTBOL_SEATS),
    lastTouchSeat: -1,
    prevTouchSeat: -1,
    kickCount: 0,
    goalCount: 0,
    postCount: 0,
    wallCount: 0,
    lastKickSeat: -1,
    lastKickX: 0,
    lastKickY: 0,
    lastGoalTeam: -1,
    lastGoalSeat: -1,
    lastAssistSeat: -1,
    kickoffId: 0,
  };
  for (let seat = 0; seat < FUTBOL_SEATS; seat++) state.pTeam[seat] = teamOfSeat(seat);
  resetKickoff(state);
  return state;
}

/**
 * Copia profunda del estado.
 *
 * Es la primitiva que necesita cualquier cliente `arena` para re-simular sobre
 * un estado autoritativo, y es lo que deja que el test de reconciliacion compare
 * "seguir desde aca" contra "correrlo todo de una".
 */
export function cloneMatchState(state: FutbolState): FutbolState {
  return {
    ...state,
    px: state.px.slice(),
    py: state.py.slice(),
    pvx: state.pvx.slice(),
    pvy: state.pvy.slice(),
    pTeam: state.pTeam.slice(),
    pKickCd: state.pKickCd.slice(),
    inX: state.inX.slice(),
    inY: state.inY.slice(),
    inKickS: state.inKickS.slice(),
    score: state.score.slice(),
    goals: state.goals.slice(),
    assists: state.assists.slice(),
    touches: state.touches.slice(),
  };
}

/**
 * Formacion del saque. Fija a proposito: sortearla consumiria PRNG dentro de la
 * simulacion, que es justo lo que rompe la reconciliacion.
 *
 * `FORMATION_X` es la distancia al arco PROPIO como fraccion del ancho, asi que
 * la misma tabla sirve espejada para el otro equipo.
 */
const FORMATION_X: readonly number[] = [0.42, 0.27, 0.27, 0.1];
const FORMATION_Y: readonly number[] = [0.5, 0.27, 0.73, 0.5];

export function resetKickoff(state: FutbolState): void {
  const r = state.rules;
  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    const team = state.pTeam[seat] ?? 0;
    const index = Math.floor(seat / TEAM_COUNT) % FORMATION_X.length;
    const fx = FORMATION_X[index] ?? 0.3;
    const fy = FORMATION_Y[index] ?? 0.5;
    state.px[seat] = team === 0 ? fx * r.width : r.width - fx * r.width;
    state.py[seat] = fy * r.height;
    state.pvx[seat] = 0;
    state.pvy[seat] = 0;
    state.pKickCd[seat] = 0;
    state.inKickS[seat] = 0;
  }
  state.ballX = r.width / 2;
  state.ballY = r.height / 2;
  state.ballVx = 0;
  state.ballVy = 0;
  state.lastTouchSeat = -1;
  state.prevTouchSeat = -1;
  state.kickoffId++;
}

/* ------------------------------------------------------------------ */
/* Entrada                                                              */
/* ------------------------------------------------------------------ */

/**
 * La intencion de un asiento, saneada.
 *
 * El host no confia en el payload: un celular puede mandar NaN, 1e9 o nada. Se
 * saneia aca, que es donde se testea, y no en el componente.
 */
export function setIntent(state: FutbolState, seat: number, moveX: number, moveY: number): void {
  if (seat < 0 || seat >= FUTBOL_SEATS) return;
  const x = Number.isFinite(moveX) ? clamp(moveX, -1, 1) : 0;
  const y = Number.isFinite(moveY) ? clamp(moveY, -1, 1) : 0;
  // Normalizar: en diagonal, sin esto se corre un 41 % mas rapido.
  const len2 = x * x + y * y;
  if (len2 > 1) {
    const inv = 1 / Math.sqrt(len2);
    state.inX[seat] = x * inv;
    state.inY[seat] = y * inv;
    return;
  }
  state.inX[seat] = x;
  state.inY[seat] = y;
}

/** Pide patear. Queda armada un rato: el dedo suele llegar antes que la pelota. */
export function requestKick(state: FutbolState, seat: number): void {
  if (seat < 0 || seat >= FUTBOL_SEATS) return;
  state.inKickS[seat] = KICK_ARMED_S;
}

/* ------------------------------------------------------------------ */
/* Paso de simulacion                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un paso. Es la unica funcion que mueve algo.
 *
 * No recibe `dt` a proposito: el paso es `state.rules.step` y punto. Con delta
 * variable la fisica deja de ser determinista, el barrido trabaja sobre tramos
 * de largo distinto y la reconciliacion no converge nunca.
 */
export function stepMatch(state: FutbolState): FutbolEvent {
  const r = state.rules;
  if (state.phase === PHASE_OVER) return "none";

  if (state.phase === PHASE_CELEBRATION) {
    state.phaseTimerS -= r.step;
    if (state.phaseTimerS <= TIMER_EPS) {
      resetKickoff(state);
      state.phase = PHASE_KICKOFF;
      state.phaseTimerS = r.kickoffS;
    }
    return "none";
  }

  const playing = state.phase === PHASE_PLAYING;
  let event: FutbolEvent = "none";

  const playerHit = movePlayers(state);
  if (playerHit !== "none") event = playerHit;

  if (playing) {
    const ballHit = moveBall(state);
    if (ballHit !== "none") event = ballHit;
  }

  resolveContacts(state, playing);

  if (!playing) {
    // Saque: la pelota espera quieta en el centro. Si alguien se le paro
    // encima, el contacto de arriba ya lo empujo; aca se la vuelve a clavar.
    state.ballX = r.width / 2;
    state.ballY = r.height / 2;
    state.ballVx = 0;
    state.ballVy = 0;
    state.phaseTimerS -= r.step;
    if (state.phaseTimerS <= TIMER_EPS) {
      state.phase = PHASE_PLAYING;
      state.phaseTimerS = 0;
    }
    return event;
  }

  if (applyKicks(state)) event = "kick";

  const scoringTeam = detectGoal(state);
  if (scoringTeam >= 0) return registerGoal(state, scoringTeam);

  state.clockS -= r.step;
  if (state.clockS <= TIMER_EPS) {
    state.clockS = 0;
    return endMatch(state);
  }
  return event;
}

/* ------------------------------------------------------------------ */
/* Movimiento                                                           */
/* ------------------------------------------------------------------ */

/**
 * Integracion de un jugador. Es la MISMA funcion que corre la prediccion: si
 * fueran dos copias, la reconciliacion no convergeria nunca y el disco propio
 * temblaria en cada snapshot.
 */
function advancePlayer(body: Body, intentX: number, intentY: number, r: FutbolRules): void {
  body.vx += intentX * r.accel * r.step;
  body.vy += intentY * r.accel * r.step;
  const speed2 = body.vx * body.vx + body.vy * body.vy;
  const max2 = r.maxSpeed * r.maxSpeed;
  if (speed2 > max2) {
    const scale = r.maxSpeed / Math.sqrt(speed2);
    body.vx *= scale;
    body.vy *= scale;
  }
  body.vx *= r.playerDamp;
  body.vy *= r.playerDamp;
}

function movePlayers(state: FutbolState): FutbolEvent {
  const r = state.rules;
  const body = state.geo.body;
  let event: FutbolEvent = "none";

  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    const cooldown = state.pKickCd[seat] ?? 0;
    if (cooldown > 0) state.pKickCd[seat] = Math.max(0, cooldown - r.step);
    const armed = state.inKickS[seat] ?? 0;
    if (armed > 0) state.inKickS[seat] = Math.max(0, armed - r.step);

    body.x = state.px[seat] ?? 0;
    body.y = state.py[seat] ?? 0;
    body.vx = state.pvx[seat] ?? 0;
    body.vy = state.pvy[seat] ?? 0;
    body.r = r.playerRadius;

    advancePlayer(body, state.inX[seat] ?? 0, state.inY[seat] ?? 0, r);
    const hit = sweepBody(body, state.geo, r.wallRestitution);
    if (hit === 2) event = "post";
    else if (hit === 1 && event === "none") event = "wall";

    state.px[seat] = body.x;
    state.py[seat] = body.y;
    state.pvx[seat] = body.vx;
    state.pvy[seat] = body.vy;
  }
  return event;
}

function moveBall(state: FutbolState): FutbolEvent {
  const r = state.rules;
  const body = state.geo.body;
  body.x = state.ballX;
  body.y = state.ballY;
  body.vx = state.ballVx * r.ballDamp;
  body.vy = state.ballVy * r.ballDamp;
  body.r = r.ballRadius;

  // El rozamiento tiene que llegar a cero de verdad. Solo con la exponencial,
  // la pelota se arrastra para siempre.
  if (body.vx * body.vx + body.vy * body.vy < r.stopSpeed * r.stopSpeed) {
    body.vx = 0;
    body.vy = 0;
  }

  const hit = sweepBody(body, state.geo, r.wallRestitution);
  state.ballX = body.x;
  state.ballY = body.y;
  state.ballVx = body.vx;
  state.ballVy = body.vy;

  if (hit === 2) {
    state.postCount++;
    return "post";
  }
  if (hit === 1) {
    state.wallCount++;
    return "wall";
  }
  return "none";
}

/**
 * Barrido contra paredes y postes. Devuelve 0 nada, 1 pared, 2 poste.
 *
 * Preguntar "esta el disco dentro de la pared en este paso" lo deja pasar de
 * largo: a velocidad alta, en un paso esta de un lado y en el siguiente ya
 * paso. El tunel es EL bug de este juego.
 */
function sweepBody(body: Body, geo: FieldGeometry, restitution: number): number {
  const dt = geo.rules.step;
  let result = 0;
  let remaining = 1;

  for (let pass = 0; pass < MAX_SWEEPS && remaining > 0; pass++) {
    const dx = body.vx * dt * remaining;
    const dy = body.vy * dt * remaining;
    if (dx === 0 && dy === 0) break;

    let bestT = 1;
    let bestKind = 0;
    let bestIndex = -1;

    geo.circle.x = body.x;
    geo.circle.y = body.y;
    geo.circle.r = body.r;

    for (let i = 0; i < geo.walls.length; i++) {
      const box = geo.walls[i];
      if (!box) continue;
      // Descarte por caja envolvente del recorrido: aritmetica pura, evita
      // entrar al barrido en casi todos los pasos.
      if (!sweptTouchesBox(body, dx, dy, box)) continue;
      const t = sweepCircleBox(geo.circle, dx, dy, box);
      if (t !== null && t >= 0 && t < bestT) {
        bestT = t;
        bestKind = 1;
        bestIndex = i;
      }
    }

    for (let i = 0; i < geo.postCount; i++) {
      const t = sweepCircleCircle(
        body.x,
        body.y,
        dx,
        dy,
        body.r,
        geo.postX[i] ?? 0,
        geo.postY[i] ?? 0,
        geo.rules.postRadius,
      );
      if (t !== null && t >= 0 && t < bestT) {
        bestT = t;
        bestKind = 2;
        bestIndex = i;
      }
    }

    body.x += dx * bestT;
    body.y += dy * bestT;
    if (bestKind === 0) break;
    remaining *= 1 - bestT;

    if (bestKind === 1) {
      const box = geo.walls[bestIndex];
      if (box) reflectOffBox(body, box, restitution);
      if (result === 0) result = 1;
    } else {
      reflectOffPost(
        body,
        geo.postX[bestIndex] ?? 0,
        geo.postY[bestIndex] ?? 0,
        geo.rules.postRadius,
        restitution,
      );
      result = 2;
    }
  }
  return result;
}

function sweptTouchesBox(body: Body, dx: number, dy: number, box: Box): boolean {
  const r = body.r;
  const x2 = body.x + dx;
  const y2 = body.y + dy;
  const minX = (body.x < x2 ? body.x : x2) - r;
  const maxX = (body.x > x2 ? body.x : x2) + r;
  const minY = (body.y < y2 ? body.y : y2) - r;
  const maxY = (body.y > y2 ? body.y : y2) + r;
  return maxX >= box.x && minX <= box.x + box.w && maxY >= box.y && minY <= box.y + box.h;
}

/**
 * Barrido de circulo movil contra circulo quieto. Los postes lo necesitan: son
 * la unica superficie curva de la cancha, y resolverlos como caja daria rebotes
 * que no se parecen a nada.
 */
function sweepCircleCircle(
  px: number,
  py: number,
  dx: number,
  dy: number,
  radius: number,
  cx: number,
  cy: number,
  cr: number,
): number | null {
  const ex = px - cx;
  const ey = py - cy;
  const sum = radius + cr;
  const c = ex * ex + ey * ey - sum * sum;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a <= 0) return null;
  const b = 2 * (ex * dx + ey * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return null;
  return t;
}

/**
 * Correccion de penetracion ANTES de invertir la velocidad. Al reves, el disco
 * sigue del lado de afuera en el paso siguiente y queda vibrando contra el borde.
 *
 * La normal sale del punto mas cercano de la caja REAL, no de la caja expandida
 * que usa el barrido: en una esquina eso es la diferencia entre rebotar en
 * diagonal y rebotar de costado.
 */
function reflectOffBox(body: Body, box: Box, restitution: number): void {
  const nearestX = clamp(body.x, box.x, box.x + box.w);
  const nearestY = clamp(body.y, box.y, box.y + box.h);
  let nx = body.x - nearestX;
  let ny = body.y - nearestY;
  let dist = Math.sqrt(nx * nx + ny * ny);

  if (dist < 1e-6) {
    // Centro dentro de la caja: se sale por el lado menos hundido.
    const left = body.x - box.x;
    const right = box.x + box.w - body.x;
    const top = body.y - box.y;
    const bottom = box.y + box.h - body.y;
    const min = Math.min(left, right, top, bottom);
    nx = min === left ? -1 : min === right ? 1 : 0;
    ny = nx !== 0 ? 0 : min === top ? -1 : 1;
    dist = 0;
  } else {
    nx /= dist;
    ny /= dist;
  }

  const push = body.r + SKIN - dist;
  if (push > 0) {
    body.x += nx * push;
    body.y += ny * push;
  }
  const vn = body.vx * nx + body.vy * ny;
  if (vn < 0) {
    const impulse = -(1 + restitution) * vn;
    body.vx += impulse * nx;
    body.vy += impulse * ny;
  }
}

function reflectOffPost(body: Body, cx: number, cy: number, cr: number, restitution: number): void {
  let nx = body.x - cx;
  let ny = body.y - cy;
  const dist = Math.sqrt(nx * nx + ny * ny);
  if (dist < 1e-6) {
    nx = 1;
    ny = 0;
  } else {
    nx /= dist;
    ny /= dist;
  }
  const push = body.r + cr + SKIN - dist;
  if (push > 0) {
    body.x += nx * push;
    body.y += ny * push;
  }
  const vn = body.vx * nx + body.vy * ny;
  if (vn < 0) {
    const impulse = -(1 + restitution) * vn;
    body.vx += impulse * nx;
    body.vy += impulse * ny;
  }
}

/* ------------------------------------------------------------------ */
/* Contactos entre discos                                               */
/* ------------------------------------------------------------------ */

/**
 * Separacion e impulso, varias iteraciones.
 *
 * Con una sola, cinco discos amontonados en el area se atraviesan. Con dos
 * todavia se ve. Tres alcanzan y con nueve cuerpos no cuestan nada.
 *
 * `countTouches` esta en false durante el saque: sumar toques con la pelota
 * clavada en el centro regalaria puntaje por pararse encima.
 */
export function resolveContacts(state: FutbolState, countTouches: boolean): void {
  const r = state.rules;
  for (let pass = 0; pass < r.iterations; pass++) {
    for (let i = 0; i < FUTBOL_SEATS; i++) {
      for (let j = i + 1; j < FUTBOL_SEATS; j++) resolvePlayerPair(state, i, j);
    }
    for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
      if (resolvePlayerBall(state, seat) && countTouches) registerTouch(state, seat);
    }
  }
}

/** Choque elastico entre dos jugadores: misma masa, impulso igual y opuesto. */
function resolvePlayerPair(state: FutbolState, i: number, j: number): void {
  const r = state.rules;
  const dx = (state.px[j] ?? 0) - (state.px[i] ?? 0);
  const dy = (state.py[j] ?? 0) - (state.py[i] ?? 0);
  const sum = r.playerRadius * 2;
  const dist2 = dx * dx + dy * dy;
  if (dist2 >= sum * sum || dist2 <= 1e-9) return;

  const dist = Math.sqrt(dist2);
  const nx = dx / dist;
  const ny = dy / dist;

  // Separar primero. Sin esto quedan pegados temblando, que es el bug clasico.
  const half = (sum - dist) * 0.5;
  state.px[i] = (state.px[i] ?? 0) - nx * half;
  state.py[i] = (state.py[i] ?? 0) - ny * half;
  state.px[j] = (state.px[j] ?? 0) + nx * half;
  state.py[j] = (state.py[j] ?? 0) + ny * half;

  const rvx = (state.pvx[j] ?? 0) - (state.pvx[i] ?? 0);
  const rvy = (state.pvy[j] ?? 0) - (state.pvy[i] ?? 0);
  const vn = rvx * nx + rvy * ny;
  // Ya se separan: aplicar impulso ahora los pegaria de vuelta.
  if (vn > 0) return;

  const impulse = (-(1 + r.restitution) * vn) / 2;
  state.pvx[i] = (state.pvx[i] ?? 0) - impulse * nx;
  state.pvy[i] = (state.pvy[i] ?? 0) - impulse * ny;
  state.pvx[j] = (state.pvx[j] ?? 0) + impulse * nx;
  state.pvy[j] = (state.pvy[j] ?? 0) + impulse * ny;
}

/** Jugador contra pelota. La pelota pesa menos de la mitad: por eso sale disparada. */
function resolvePlayerBall(state: FutbolState, seat: number): boolean {
  const r = state.rules;
  const dx = state.ballX - (state.px[seat] ?? 0);
  const dy = state.ballY - (state.py[seat] ?? 0);
  const sum = r.playerRadius + r.ballRadius;
  const dist2 = dx * dx + dy * dy;
  if (dist2 >= sum * sum || dist2 <= 1e-9) return false;

  const dist = Math.sqrt(dist2);
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = sum - dist;

  const invPlayer = 1 / r.playerMass;
  const invBall = 1 / r.ballMass;
  const invSum = invPlayer + invBall;
  // Separacion proporcional a la masa inversa: la pelota se corre casi todo.
  state.px[seat] = (state.px[seat] ?? 0) - nx * overlap * (invPlayer / invSum);
  state.py[seat] = (state.py[seat] ?? 0) - ny * overlap * (invPlayer / invSum);
  state.ballX += nx * overlap * (invBall / invSum);
  state.ballY += ny * overlap * (invBall / invSum);

  const rvx = state.ballVx - (state.pvx[seat] ?? 0);
  const rvy = state.ballVy - (state.pvy[seat] ?? 0);
  const vn = rvx * nx + rvy * ny;
  if (vn > 0) return true;

  const impulse = (-(1 + r.restitution) * vn) / invSum;
  state.pvx[seat] = (state.pvx[seat] ?? 0) - impulse * invPlayer * nx;
  state.pvy[seat] = (state.pvy[seat] ?? 0) - impulse * invPlayer * ny;
  state.ballVx += impulse * invBall * nx;
  state.ballVy += impulse * invBall * ny;
  return true;
}

function registerTouch(state: FutbolState, seat: number): void {
  if (state.lastTouchSeat === seat) return;
  state.prevTouchSeat = state.lastTouchSeat;
  state.lastTouchSeat = seat;
  state.touches[seat] = (state.touches[seat] ?? 0) + 1;
}

/* ------------------------------------------------------------------ */
/* Patada                                                              */
/* ------------------------------------------------------------------ */

/**
 * La patada es un impulso en la direccion jugador -> pelota, no un arrastre.
 *
 * Suma velocidad en vez de fijarla: pegarle a una pelota que ya viene rapida
 * tiene que mandarla mas lejos que pegarle a una parada, y es lo que hace que
 * un pase de primera se sienta distinto de uno acomodado.
 */
function applyKicks(state: FutbolState): boolean {
  const r = state.rules;
  const reach = r.playerRadius + r.ballRadius + r.kickReach;
  const reach2 = reach * reach;
  let kicked = false;

  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    if ((state.inKickS[seat] ?? 0) <= 0) continue;
    if ((state.pKickCd[seat] ?? 0) > 0) continue;
    const dx = state.ballX - (state.px[seat] ?? 0);
    const dy = state.ballY - (state.py[seat] ?? 0);
    const dist2 = dx * dx + dy * dy;
    if (dist2 > reach2) continue;

    let nx: number;
    let ny: number;
    const dist = Math.sqrt(dist2);
    if (dist < 1e-6) {
      // Pelota exactamente en el centro del disco: se patea hacia donde corre,
      // y si esta quieto, hacia el arco rival.
      const vx = state.pvx[seat] ?? 0;
      const vy = state.pvy[seat] ?? 0;
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed > 1e-6) {
        nx = vx / speed;
        ny = vy / speed;
      } else {
        nx = (state.pTeam[seat] ?? 0) === 0 ? 1 : -1;
        ny = 0;
      }
    } else {
      nx = dx / dist;
      ny = dy / dist;
    }

    state.ballVx += nx * r.kickPower;
    state.ballVy += ny * r.kickPower;
    state.pKickCd[seat] = r.kickCooldownS;
    state.inKickS[seat] = 0;
    state.kickCount++;
    state.lastKickSeat = seat;
    state.lastKickX = (state.px[seat] ?? 0) + nx * r.playerRadius;
    state.lastKickY = (state.py[seat] ?? 0) + ny * r.playerRadius;
    registerTouch(state, seat);
    kicked = true;
  }
  return kicked;
}

/* ------------------------------------------------------------------ */
/* Gol, marcador y fin                                                  */
/* ------------------------------------------------------------------ */

/** Equipo que convirtio, o -1. La pared solo deja pasar por la boca del arco. */
function detectGoal(state: FutbolState): number {
  const r = state.rules;
  if (state.ballY < goalTop(r) || state.ballY > goalBottom(r)) return -1;
  // El centro de la pelota cruzo la linea. Es la definicion mas simple que se
  // puede explicar en la sala sin discutir.
  if (state.ballX <= 0) return 1;
  if (state.ballX >= r.width) return 0;
  return -1;
}

function registerGoal(state: FutbolState, team: number): FutbolEvent {
  const scorer = state.lastTouchSeat;
  state.score[team] = (state.score[team] ?? 0) + 1;
  state.goalCount++;
  state.lastGoalTeam = team;
  state.lastGoalSeat = scorer;
  state.lastAssistSeat = -1;

  if (scorer >= 0 && (state.pTeam[scorer] ?? 0) === team) {
    state.goals[scorer] = (state.goals[scorer] ?? 0) + 1;
    const assist = state.prevTouchSeat;
    // Asistencia: ultimo toque del mismo equipo antes del gol, de otro jugador.
    if (assist >= 0 && assist !== scorer && (state.pTeam[assist] ?? 0) === team) {
      state.assists[assist] = (state.assists[assist] ?? 0) + 1;
      state.lastAssistSeat = assist;
    }
  }

  state.ballVx = 0;
  state.ballVy = 0;
  // Se pasa a festejo en el acto: es lo que hace que el gol se cuente UNA vez.
  // Mientras dure, `detectGoal` ni se llama.
  state.phase = PHASE_CELEBRATION;
  state.phaseTimerS = state.rules.celebrationS;

  if ((state.score[team] ?? 0) >= state.rules.goalsToWin) {
    state.phase = PHASE_OVER;
    state.winnerTeam = team;
    return "match";
  }
  return "goal";
}

function endMatch(state: FutbolState): FutbolEvent {
  const a = state.score[0] ?? 0;
  const b = state.score[1] ?? 0;
  state.phase = PHASE_OVER;
  // 2 = empate. Sin alargue: es Haxball, no una final.
  state.winnerTeam = a === b ? 2 : a > b ? 0 : 1;
  return "match";
}

export function isMatchOver(state: FutbolState): boolean {
  return state.phase === PHASE_OVER;
}

/* ------------------------------------------------------------------ */
/* Prediccion del disco propio                                          */
/* ------------------------------------------------------------------ */

/**
 * Un paso de prediccion sobre el disco propio, y nada mas.
 *
 * Corre la MISMA integracion y el MISMO barrido que el host: si fueran dos
 * implementaciones, cada snapshot corregiria la posicion y el disco temblaria.
 * Lo que NO hace es resolver contactos con otros discos ni con la pelota,
 * porque para eso habria que predecir tambien la intencion de los demas, que es
 * justo lo que `prediction.ts` prohibe. El precio es una correccion chica
 * mientras dura un choque, y se paga con gusto.
 *
 * `dt` puede ser mayor que el paso: se parte en subpasos fijos. Un input de
 * 1/30 s son cuatro pasos de 1/120, no un paso de 1/30, o la integracion no da
 * lo mismo que la del host y la reconciliacion nunca converge.
 */
export function stepDisc(
  disc: PredictedDisc,
  intent: DiscIntent,
  dt: number,
  geo: FieldGeometry,
): PredictedDisc {
  const r = geo.rules;
  const body = geo.body;
  body.x = disc.x;
  body.y = disc.y;
  body.vx = disc.vx;
  body.vy = disc.vy;
  body.r = r.playerRadius;

  const steps = Math.max(1, Math.round(dt / r.step));
  for (let i = 0; i < steps; i++) {
    advancePlayer(body, intent.moveX, intent.moveY, r);
    sweepBody(body, geo, r.wallRestitution);
  }
  return { x: body.x, y: body.y, vx: body.vx, vy: body.vy };
}

/* ------------------------------------------------------------------ */
/* Puntaje                                                              */
/* ------------------------------------------------------------------ */

export type FutbolResult = "win" | "draw" | "loss" | "quit";

/** Tope del bono por participar. Sin tope, quien orbita la pelota gana solo con eso. */
const TOUCH_BONUS_CAP = 60;

/**
 * Formula de X6-FUTBOL.md.
 *
 * El bono por toques existe para que quien no metio goles igual sume: sin eso,
 * en un 4 contra 4 media sala termina con el puntaje minimo y el juego se
 * siente injusto.
 */
export function futbolPoints(
  goals: number,
  assists: number,
  touches: number,
  result: FutbolResult,
): number {
  if (result === "quit") return 90 + goals * 70;
  const base = result === "win" ? 300 : result === "draw" ? 180 : 90;
  return base + goals * 70 + assists * 35 + Math.min(TOUCH_BONUS_CAP, touches * 2);
}
