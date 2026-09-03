import { clamp, sweepCircleBox, type Box, type Circle } from "@/core/engine/collide";
import type { Rng } from "@/core/engine/rng";

/**
 * Logica de Pong. Sin React, sin canvas, sin red: se testea sola.
 *
 * Dos decisiones cargan todo el peso del archivo:
 *
 * 1. **Colision barrida, no discreta.** Preguntar "esta la pelota dentro de la
 *    paleta este cuadro" la deja pasar de largo: a velocidad alta, en un paso
 *    esta antes de la paleta y en el siguiente ya paso. El tunel es EL bug del
 *    Pong y aca se resuelve buscando el instante exacto del impacto dentro del
 *    paso con `sweepCircleBox`.
 * 2. **El punto de impacto decide el angulo de salida.** Centro sale plano,
 *    puntas abren hasta el maximo. Es lo que convierte al Pong en un juego de
 *    habilidad y no de suerte.
 *
 * Cero asignaciones: los scratch de colision viven en el estado y los eventos
 * se devuelven como literales de union, no como objetos.
 */

export const PONG_SEATS = 2;

/** Cuantos impactos se resuelven dentro de un mismo paso. Tres rebotes en 1/120 s no existen. */
const MAX_RESOLVES = 4;
/** Separacion tras el impacto. Sin esto la pelota queda vibrando pegada a la superficie. */
const SKIN = 0.01;
/**
 * Restar 180 veces 1/120 a 1,5 no da 0 sino 2,8e-15. Sin este margen la pausa
 * del saque dura un paso entero de mas, y siempre.
 */
const TIMER_EPS = 1e-6;

export type PongRules = {
  width: number;
  height: number;
  ballRadius: number;
  /** u/s al sacar. */
  ballSpeed: number;
  /** Multiplicador por rebote en paleta, por ejemplo 1.04. */
  accelPerHit: number;
  /** Techo, en multiplos de `ballSpeed`. */
  maxSpeedFactor: number;
  /** Radianes desde la horizontal. */
  serveAngleRad: number;
  /** Radianes desde la horizontal, con la pelota en la punta de la paleta. */
  maxBounceRad: number;
  paddleWidth: number;
  paddleHeight: number;
  /** Distancia de la paleta al borde de su lado. */
  paddleInset: number;
  /** Lerp por cuadro de 60 Hz hacia la posicion recibida. */
  paddleFollow: number;
  pointsToWin: number;
  hardCap: number;
  serveDelayS: number;
};

/** Lo que paso en un paso. Un literal de union no asigna; un objeto de evento si. */
export type PongEvent = "none" | "wall" | "paddle" | "goal" | "match";

export type PongResult = "win" | "loss" | "quit";

export type PongState = {
  rules: PongRules;
  ballX: number;
  ballY: number;
  ballVx: number;
  ballVy: number;
  /** Modulo de la velocidad. Se guarda aparte porque el rebote conserva el modulo y cambia el angulo. */
  ballSpeed: number;
  maxSpeed: number;
  /** Centro actual de cada paleta, en unidades del mundo. */
  paddleY: Float32Array;
  /** Centro al que la paleta persigue. Es lo unico que escribe el input remoto. */
  targetY: Float32Array;
  scores: Int32Array;
  /** Segundos hasta el proximo saque. 0 = pelota en juego. */
  serveTimerS: number;
  /** Asiento hacia el que va el saque: el que acaba de recibir el gol. */
  serveToSeat: number;
  rally: number;
  longestRally: number;
  /** Cambia en cada gol. Los bots lo usan para renovar su error. */
  rallyId: number;
  over: boolean;
  /** -1 mientras no haya ganador. */
  winner: number;
  /* Ultimo impacto y ultimo gol, para que el render los pinte sin asignar. */
  hitSeat: number;
  hitX: number;
  hitY: number;
  /** -1..1 segun donde pego en la paleta. */
  hitOffset: number;
  scorerSeat: number;
  /** Scratch de colision. Vive aca para no crear un objeto por paso. */
  circle: Circle;
  box: Box;
};

export function createPongState(rules: PongRules, rng: Rng): PongState {
  const state: PongState = {
    rules,
    ballX: rules.width / 2,
    ballY: rules.height / 2,
    ballVx: 0,
    ballVy: 0,
    ballSpeed: rules.ballSpeed,
    maxSpeed: rules.ballSpeed * rules.maxSpeedFactor,
    paddleY: new Float32Array(PONG_SEATS),
    targetY: new Float32Array(PONG_SEATS),
    scores: new Int32Array(PONG_SEATS),
    serveTimerS: 0,
    // El primer saque va para el asiento 0 sin sortear nada: la ventaja de
    // sacar en Pong no existe, y sortearlo gastaria un valor del PRNG que
    // despues no cuadra con el resto de la serie.
    serveToSeat: 0,
    rally: 0,
    longestRally: 0,
    rallyId: 0,
    over: false,
    winner: -1,
    hitSeat: -1,
    hitX: 0,
    hitY: 0,
    hitOffset: 0,
    scorerSeat: -1,
    circle: { x: 0, y: 0, r: rules.ballRadius },
    box: { x: 0, y: 0, w: rules.paddleWidth, h: rules.paddleHeight },
  };

  const center = rules.height / 2;
  for (let seat = 0; seat < PONG_SEATS; seat++) {
    state.paddleY[seat] = center;
    state.targetY[seat] = center;
  }
  serveBall(state, rng);
  return state;
}

/**
 * Objetivo de una paleta, desde la posicion normalizada que manda el celular.
 *
 * El host no confia en el payload: un cliente puede mandar NaN, 1e9 o nada.
 * Se saneia aca, que es donde se testea, y no en el componente.
 */
export function setPaddleTarget(state: PongState, seat: number, position: number): void {
  if (seat < 0 || seat >= PONG_SEATS) return;
  if (!Number.isFinite(position)) return;
  const half = state.rules.paddleHeight / 2;
  const travel = state.rules.height - state.rules.paddleHeight;
  state.targetY[seat] = half + clamp(position, 0, 1) * travel;
}

/** Posicion normalizada actual de una paleta. Es la inversa de `setPaddleTarget`. */
export function paddlePosition(state: PongState, seat: number): number {
  const half = state.rules.paddleHeight / 2;
  const travel = state.rules.height - state.rules.paddleHeight;
  if (travel <= 0) return 0.5;
  return clamp(((state.paddleY[seat] ?? half) - half) / travel, 0, 1);
}

/** Caja de una paleta, escrita sobre un destino ya existente. */
export function writePaddleBox(state: PongState, seat: number, box: Box): void {
  const r = state.rules;
  box.x = seat === 0 ? r.paddleInset : r.width - r.paddleInset - r.paddleWidth;
  box.y = (state.paddleY[seat] ?? r.height / 2) - r.paddleHeight / 2;
  box.w = r.paddleWidth;
  box.h = r.paddleHeight;
}

/** Saque hacia `serveToSeat`, con angulo sembrado dentro de la cuna permitida. */
export function serveBall(state: PongState, rng: Rng): void {
  const r = state.rules;
  const angle = rng.range(-r.serveAngleRad, r.serveAngleRad);
  const dir = state.serveToSeat === 0 ? -1 : 1;
  state.ballX = r.width / 2;
  state.ballY = r.height / 2;
  state.ballSpeed = r.ballSpeed;
  state.ballVx = dir * r.ballSpeed * Math.cos(angle);
  state.ballVy = r.ballSpeed * Math.sin(angle);
}

export function isMatchOver(state: PongState): boolean {
  const a = state.scores[0] ?? 0;
  const b = state.scores[1] ?? 0;
  const top = a > b ? a : b;
  const diff = a > b ? a - b : b - a;
  return (top >= state.rules.pointsToWin && diff >= 2) || top >= state.rules.hardCap;
}

/**
 * Un paso de simulacion. Es la unica funcion que mueve algo.
 *
 * `dt` es fijo por contrato: con delta variable la simulacion deja de ser
 * determinista y el barrido empieza a trabajar sobre tramos de largo distinto.
 */
export function stepPong(state: PongState, dt: number, rng: Rng): PongEvent {
  if (state.over) return "none";

  movePaddles(state, dt);

  if (state.serveTimerS > 0) {
    state.serveTimerS -= dt;
    if (state.serveTimerS <= TIMER_EPS) {
      state.serveTimerS = 0;
      serveBall(state, rng);
    }
    return "none";
  }

  const event = moveBall(state, dt);

  const r = state.rules;
  if (state.ballX < -r.ballRadius) return scoreGoal(state, 1);
  if (state.ballX > r.width + r.ballRadius) return scoreGoal(state, 0);
  return event;
}

/* ------------------------------------------------------------------ */
/* Interno                                                              */
/* ------------------------------------------------------------------ */

function movePaddles(state: PongState, dt: number): void {
  // `paddleFollow` esta expresado por cuadro de 60 Hz porque es como se
  // percibe; aca se convierte al paso real para que cambiar el timestep no
  // cambie la sensacion de la paleta.
  const alpha = Math.min(1, state.rules.paddleFollow * dt * 60);
  for (let seat = 0; seat < PONG_SEATS; seat++) {
    const current = state.paddleY[seat] ?? 0;
    const goal = state.targetY[seat] ?? current;
    state.paddleY[seat] = current + (goal - current) * alpha;
  }
}

function moveBall(state: PongState, dt: number): PongEvent {
  const r = state.rules;
  let event: PongEvent = "none";
  /** Fraccion del paso que todavia no se consumio. */
  let remaining = 1;

  for (let pass = 0; pass < MAX_RESOLVES && remaining > 0; pass++) {
    const dx = state.ballVx * dt * remaining;
    const dy = state.ballVy * dt * remaining;
    if (dx === 0 && dy === 0) break;

    let bestT = 1;
    // 0 nada, 1 pared, 2 paleta.
    let bestKind = 0;
    let bestSeat = -1;

    // Paredes: analitico. Barrer una caja para un plano infinito seria pagar
    // de mas por el mismo resultado.
    if (dy < 0) {
      const t = (r.ballRadius - state.ballY) / dy;
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestKind = 1;
      }
    } else if (dy > 0) {
      const t = (r.height - r.ballRadius - state.ballY) / dy;
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestKind = 1;
      }
    }

    for (let seat = 0; seat < PONG_SEATS; seat++) {
      // Solo se testea la paleta a la que la pelota va: si no, una pelota que
      // sale de la paleta y todavia la solapa rebota de nuevo hacia adentro.
      const approaching = seat === 0 ? state.ballVx < 0 : state.ballVx > 0;
      if (!approaching) continue;

      writePaddleBox(state, seat, state.box);
      // Descarte por caja envolvente del recorrido: es aritmetica pura y evita
      // entrar al barrido en 118 de cada 120 pasos.
      if (!sweptTouchesBox(state, dx, dy, state.box)) continue;

      state.circle.x = state.ballX;
      state.circle.y = state.ballY;
      state.circle.r = r.ballRadius;
      const t = sweepCircleBox(state.circle, dx, dy, state.box);
      if (t !== null && t >= 0 && t < bestT) {
        bestT = t;
        bestKind = 2;
        bestSeat = seat;
      }
    }

    state.ballX += dx * bestT;
    state.ballY += dy * bestT;

    if (bestKind === 0) break;
    remaining *= 1 - bestT;

    if (bestKind === 1) {
      // Correccion de penetracion ANTES de invertir: si no, en el paso
      // siguiente sigue del lado de afuera y queda vibrando contra el borde.
      state.ballY =
        state.ballY < r.height / 2 ? r.ballRadius + SKIN : r.height - r.ballRadius - SKIN;
      state.ballVy = -state.ballVy;
      if (event === "none") event = "wall";
    } else {
      bounceOffPaddle(state, bestSeat);
      event = "paddle";
    }
  }

  return event;
}

/** Caja envolvente del recorrido contra la caja de la paleta. Descarte barato. */
function sweptTouchesBox(state: PongState, dx: number, dy: number, box: Box): boolean {
  const r = state.rules.ballRadius;
  const x1 = state.ballX;
  const x2 = state.ballX + dx;
  const y1 = state.ballY;
  const y2 = state.ballY + dy;
  const minX = (x1 < x2 ? x1 : x2) - r;
  const maxX = (x1 > x2 ? x1 : x2) + r;
  const minY = (y1 < y2 ? y1 : y2) - r;
  const maxY = (y1 > y2 ? y1 : y2) + r;
  return maxX >= box.x && minX <= box.x + box.w && maxY >= box.y && minY <= box.y + box.h;
}

function bounceOffPaddle(state: PongState, seat: number): void {
  const r = state.rules;
  const half = r.paddleHeight / 2;
  const center = state.paddleY[seat] ?? r.height / 2;
  // Donde pego decide el angulo: centro plano, punta abierta. Sin esto el
  // Pong es suerte.
  const offset = clamp((state.ballY - center) / half, -1, 1);
  const angle = offset * r.maxBounceRad;
  const dir = seat === 0 ? 1 : -1;

  state.ballSpeed = Math.min(state.maxSpeed, state.ballSpeed * r.accelPerHit);
  state.ballVx = dir * state.ballSpeed * Math.cos(angle);
  state.ballVy = state.ballSpeed * Math.sin(angle);

  // La paleta NO aporta su propia velocidad: con input remoto y ruidoso, sumar
  // la velocidad de la paleta se descontrola.
  const faceLeft = r.paddleInset;
  const faceRight = r.width - r.paddleInset;
  if (seat === 0) {
    const out = faceLeft + r.paddleWidth + r.ballRadius + SKIN;
    if (state.ballX < out) state.ballX = out;
  } else {
    const out = faceRight - r.paddleWidth - r.ballRadius - SKIN;
    if (state.ballX > out) state.ballX = out;
  }

  state.rally++;
  state.hitSeat = seat;
  state.hitX = seat === 0 ? faceLeft + r.paddleWidth : faceRight - r.paddleWidth;
  state.hitY = state.ballY;
  state.hitOffset = offset;
}

function scoreGoal(state: PongState, scorer: number): PongEvent {
  const r = state.rules;
  state.scores[scorer] = (state.scores[scorer] ?? 0) + 1;
  state.scorerSeat = scorer;
  if (state.rally > state.longestRally) state.longestRally = state.rally;
  state.rally = 0;
  state.rallyId++;

  // Saque hacia el que acaba de recibir el gol.
  state.serveToSeat = scorer === 0 ? 1 : 0;
  state.serveTimerS = r.serveDelayS;
  state.ballX = r.width / 2;
  state.ballY = r.height / 2;
  state.ballVx = 0;
  state.ballVy = 0;

  if (isMatchOver(state)) {
    state.over = true;
    state.winner = scorer;
    return "match";
  }
  return "goal";
}

/* ------------------------------------------------------------------ */
/* Puntaje                                                              */
/* ------------------------------------------------------------------ */

/**
 * Formula de R1-PONG.md. Al que se fue se le paga igual: el resultado sale con
 * `completed: false`, pero sale.
 */
export function pongPoints(goalsFor: number, goalsAgainst: number, result: PongResult): number {
  if (result === "quit") return 80;
  if (result === "win") return 400 + (goalsFor - goalsAgainst) * 30 + goalsFor * 20;
  return 120 + goalsFor * 25;
}
