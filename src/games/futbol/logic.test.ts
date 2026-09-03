import { describe, expect, it } from "vitest";
import { createPrediction, replayInputs, type PendingInput } from "@/core/net/prediction";
import { createSnapshotCodec, type NetEntity } from "@/core/net/snapshot";
import {
  createFieldGeometry,
  createFutbolRules,
  createFutbolState,
  cloneMatchState,
  futbolPoints,
  goalBottom,
  goalTop,
  requestKick,
  setIntent,
  stepDisc,
  stepMatch,
  teamOfSeat,
  BALL_ID,
  FUTBOL_SEATS,
  PHASE_CELEBRATION,
  PHASE_OVER,
  PHASE_PLAYING,
  type DiscIntent,
  type FutbolState,
  type FutbolTuning,
  type PredictedDisc,
} from "./logic";

/** El paso real del juego. Ver el comentario de cabecera de `logic.ts`. */
const STEP = 1 / 120;

const TUNING: FutbolTuning = {
  width: 1600,
  height: 900,
  goalWidth: 250,
  playerRadius: 28,
  ballRadius: 15,
  playerSpeed: 380,
  playerAccel: 1900,
  playerFriction: 0.92,
  ballFriction: 0.42,
  kickPower: 900,
  kickReach: 14,
  kickCooldownS: 0.3,
  restitution: 0.55,
  goalsToWin: 3,
  matchSeconds: 180,
  celebrationS: 2,
  kickoffS: 2,
  step: STEP,
};

function fresh(overrides: Partial<FutbolTuning> = {}): FutbolState {
  return createFutbolState(createFutbolRules({ ...TUNING, ...overrides }));
}

/** Saltea la cuenta del saque: casi todos los tests quieren la pelota viva. */
function startPlaying(state: FutbolState): void {
  state.phase = PHASE_PLAYING;
  state.phaseTimerS = 0;
}

/** Manda los ocho discos contra la banda de arriba y los deja quietos. */
function parkPlayers(state: FutbolState, y = 60): void {
  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    state.px[seat] = 120 + seat * 160;
    state.py[seat] = y;
    state.pvx[seat] = 0;
    state.pvy[seat] = 0;
    setIntent(state, seat, 0, 0);
  }
}

function placeBall(state: FutbolState, x: number, y: number, vx: number, vy: number): void {
  state.ballX = x;
  state.ballY = y;
  state.ballVx = vx;
  state.ballVy = vy;
}

/**
 * Un guion de juego determinista: cada disco corre hacia la pelota y patea cada
 * tantos pasos. No es un bot bueno; es un bot REPETIBLE, que es lo unico que le
 * importa a un test de determinismo.
 */
function driveScript(state: FutbolState, tick: number): void {
  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    const dx = state.ballX - (state.px[seat] ?? 0);
    const dy = state.ballY - (state.py[seat] ?? 0);
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    setIntent(state, seat, dx / dist, dy / dist);
    if ((tick + seat * 7) % 23 === 0) requestKick(state, seat);
  }
}

function traceOf(state: FutbolState): number[] {
  const row: number[] = [state.ballX, state.ballY, state.ballVx, state.ballVy, state.phase];
  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    row.push(state.px[seat] ?? 0, state.py[seat] ?? 0, state.pvx[seat] ?? 0, state.pvy[seat] ?? 0);
  }
  row.push(state.score[0] ?? 0, state.score[1] ?? 0, state.kickCount, state.goalCount);
  return row;
}

function totalMomentum(state: FutbolState): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    x += (state.pvx[seat] ?? 0) * state.rules.playerMass;
    y += (state.pvy[seat] ?? 0) * state.rules.playerMass;
  }
  return { x, y };
}

function kineticEnergy(state: FutbolState): number {
  let sum = 0;
  for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
    const vx = state.pvx[seat] ?? 0;
    const vy = state.pvy[seat] ?? 0;
    sum += 0.5 * state.rules.playerMass * (vx * vx + vy * vy);
  }
  return sum;
}

/* ------------------------------------------------------------------ */

describe("determinismo", () => {
  it("la misma secuencia de inputs desde el mismo estado da el mismo resultado dos veces", () => {
    const run = () => {
      const state = fresh();
      const trace: number[] = [];
      for (let tick = 0; tick < 2400; tick++) {
        driveScript(state, tick);
        stepMatch(state);
        if (tick % 8 === 0) trace.push(...traceOf(state));
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });

  it("la simulacion no consume azar: dos partidas iguales sin PRNG de por medio", () => {
    // Si `stepMatch` sacara numeros de una semilla, re-simular los pendientes
    // durante la reconciliacion adelantaria la serie y las dos puntas dejarian
    // de coincidir. Este test fija esa propiedad.
    const a = fresh();
    const b = fresh();
    for (let tick = 0; tick < 900; tick++) {
      driveScript(a, tick);
      driveScript(b, tick);
      stepMatch(a);
      stepMatch(b);
    }
    expect(traceOf(a)).toEqual(traceOf(b));
  });

  it("un input basura no mueve nada ni ensucia el estado", () => {
    const state = fresh();
    startPlaying(state);
    setIntent(state, 0, Number.NaN, Number.POSITIVE_INFINITY);
    setIntent(state, 1, 1e9, -1e9);
    // Fuera de rango: no existe el asiento y no tiene que romper nada.
    setIntent(state, 99, 1, 1);
    requestKick(state, -3);
    stepMatch(state);
    expect(state.inX[0]).toBe(0);
    expect(state.inY[0]).toBe(0);
    // Recortado y normalizado: en diagonal no se corre 41 % mas rapido.
    const nx = state.inX[1] ?? 0;
    const ny = state.inY[1] ?? 0;
    expect(Math.sqrt(nx * nx + ny * ny)).toBeCloseTo(1, 6);
  });
});

describe("reconciliacion", () => {
  const rules = createFutbolRules(TUNING);
  const geo = createFieldGeometry(rules);
  const DT = 1 / 30;
  const step = (disc: PredictedDisc, intent: DiscIntent, dt: number) => stepDisc(disc, intent, dt, geo);

  function scriptedInputs(count: number): PendingInput<DiscIntent>[] {
    const list: PendingInput<DiscIntent>[] = [];
    for (let n = 1; n <= count; n++) {
      list.push({ sequence: n, input: { moveX: Math.cos(n * 0.7), moveY: Math.sin(n * 0.7) } });
    }
    return list;
  }

  it("re-simular los pendientes da exactamente lo mismo que simularlos de una", () => {
    const start: PredictedDisc = { x: 420, y: 300, vx: 0, vy: 0 };
    const inputs = scriptedInputs(12);
    const whole = replayInputs(start, inputs, step, DT);

    const prediction = createPrediction<PredictedDisc, DiscIntent>(start, { step, dt: DT });
    for (const entry of inputs) prediction.predict(entry.input);
    expect(prediction.predicted).toEqual(whole);

    // El host confirmo los primeros cinco: se descartan y se re-simulan los
    // siete que quedan sobre el estado autoritativo.
    const authoritative = replayInputs(start, inputs.slice(0, 5), step, DT);
    expect(prediction.reconcile(authoritative, 5)).toEqual(whole);
    expect(prediction.pending).toHaveLength(7);
  });

  it("un input de 1/30 s son cuatro pasos de 1/120, no un paso de 1/30", () => {
    const start: PredictedDisc = { x: 500, y: 400, vx: 0, vy: 0 };
    const intent: DiscIntent = { moveX: 1, moveY: 0 };
    const long = stepDisc(start, intent, 4 / 120, geo);
    let short = start;
    for (let i = 0; i < 4; i++) short = stepDisc(short, intent, 1 / 120, geo);
    expect(long).toEqual(short);
  });

  it("el partido entero se puede clonar y seguir desde el clon sin divergir", () => {
    const original = fresh();
    for (let tick = 0; tick < 600; tick++) {
      driveScript(original, tick);
      stepMatch(original);
    }
    const copy = cloneMatchState(original);
    for (let tick = 600; tick < 1100; tick++) {
      driveScript(original, tick);
      stepMatch(original);
      driveScript(copy, tick);
      stepMatch(copy);
    }
    expect(traceOf(copy)).toEqual(traceOf(original));
  });
});

describe("barrido", () => {
  it("la pelota no atraviesa la pared a velocidad absurda", () => {
    const state = fresh();
    startPlaying(state);
    parkPlayers(state);
    // 200000 u/s son 1666 u en un paso: mas que la cancha entera. Sin barrido
    // termina del otro lado del mapa.
    placeBall(state, 800, 120, 200_000, 0);
    stepMatch(state);
    expect(state.ballX).toBeLessThanOrEqual(state.rules.width);
    expect(state.ballX).toBeGreaterThanOrEqual(0);
    expect(state.ballY).toBeGreaterThan(0);
    expect(state.ballY).toBeLessThan(state.rules.height);
  });

  it("cien pasos a velocidad absurda dejan la pelota siempre dentro", () => {
    const state = fresh({ goalWidth: 140 });
    startPlaying(state);
    parkPlayers(state);
    placeBall(state, 800, 700, 90_000, -70_000);
    for (let i = 0; i < 100; i++) {
      stepMatch(state);
      if (state.phase !== PHASE_PLAYING) break;
      expect(state.ballX).toBeGreaterThanOrEqual(-state.rules.goalDepth);
      expect(state.ballX).toBeLessThanOrEqual(state.rules.width + state.rules.goalDepth);
      expect(state.ballY).toBeGreaterThanOrEqual(0);
      expect(state.ballY).toBeLessThanOrEqual(state.rules.height);
    }
  });

  it("la pelota rebota en el poste en vez de entrar por el borde del arco", () => {
    const state = fresh();
    startPlaying(state);
    parkPlayers(state);
    const posts = state.postCount;
    // Justo a la altura del poste de arriba del arco izquierdo.
    placeBall(state, 300, goalTop(state.rules), -900, 0);
    for (let i = 0; i < 120 && state.phase === PHASE_PLAYING; i++) stepMatch(state);
    expect(state.postCount).toBeGreaterThan(posts);
    expect(state.score[1] ?? 0).toBe(0);
  });
});

describe("gol", () => {
  it("se detecta al cruzar la linea y se cuenta una sola vez", () => {
    const state = fresh({ goalsToWin: 5 });
    startPlaying(state);
    parkPlayers(state);
    placeBall(state, 120, 450, -700, 0);
    // Alguien tiene que haber tocado para que el gol tenga autor.
    state.lastTouchSeat = 1;

    let steps = 0;
    while (state.goalCount === 0 && steps < 600) {
      stepMatch(state);
      steps++;
    }
    expect(state.goalCount).toBe(1);
    expect(state.score[1]).toBe(1);
    expect(state.score[0]).toBe(0);
    expect(state.phase).toBe(PHASE_CELEBRATION);
    // El autor es del equipo 1, asi que suma el gol como propio.
    expect(state.goals[1]).toBe(1);

    // Festejo, reposicion, cuenta del saque y a jugar: nada de esto puede
    // volver a contar el mismo gol.
    for (let i = 0; i < 900; i++) stepMatch(state);
    expect(state.goalCount).toBe(1);
    expect(state.score[1]).toBe(1);
    expect(state.ballX).toBeCloseTo(state.rules.width / 2, 3);
  });

  it("la pelota fuera de la boca del arco no es gol", () => {
    const state = fresh();
    startPlaying(state);
    parkPlayers(state, 700);
    // Bien arriba del poste: choca contra la pared, no entra.
    placeBall(state, 300, goalTop(state.rules) - 90, -900, 0);
    for (let i = 0; i < 200; i++) stepMatch(state);
    expect(state.goalCount).toBe(0);
    expect(state.ballX).toBeGreaterThan(0);
  });

  it("un gol en contra no le suma el gol al que lo hizo", () => {
    const state = fresh({ goalsToWin: 5 });
    startPlaying(state);
    parkPlayers(state);
    placeBall(state, 120, 450, -700, 0);
    // El asiento 0 es del equipo 0 y la pelota entra en el arco del equipo 0.
    state.lastTouchSeat = 0;
    while (state.goalCount === 0) stepMatch(state);
    expect(state.score[1]).toBe(1);
    expect(state.goals[0]).toBe(0);
  });

  it("el tercer gol termina el partido", () => {
    const state = fresh({ goalsToWin: 3, celebrationS: 0.5, kickoffS: 0.5 });
    startPlaying(state);
    for (let goal = 0; goal < 3; goal++) {
      parkPlayers(state);
      startPlaying(state);
      placeBall(state, 120, 450, -700, 0);
      state.lastTouchSeat = 1;
      let guard = 0;
      const before = state.goalCount;
      while (state.goalCount === before && guard++ < 600) stepMatch(state);
    }
    expect(state.score[1]).toBe(3);
    expect(state.phase).toBe(PHASE_OVER);
    expect(state.winnerTeam).toBe(1);
  });

  it("el reloj a cero termina el partido, y empatado queda empatado", () => {
    const state = fresh({ matchSeconds: 0.5 });
    startPlaying(state);
    parkPlayers(state);
    for (let i = 0; i < 200; i++) stepMatch(state);
    expect(state.phase).toBe(PHASE_OVER);
    expect(state.winnerTeam).toBe(2);
  });
});

describe("rozamiento", () => {
  it("frena la pelota hasta detenerla del todo", () => {
    const state = fresh();
    startPlaying(state);
    parkPlayers(state);
    placeBall(state, 200, 120, 300, 0);

    let steps = 0;
    while ((state.ballVx !== 0 || state.ballVy !== 0) && steps < 1500) {
      stepMatch(state);
      steps++;
    }
    expect(state.ballVx).toBe(0);
    expect(state.ballVy).toBe(0);
    expect(steps).toBeLessThan(1500);
    // Y se detuvo despues de recorrer algo: no se clavo en el primer paso.
    expect(state.ballX).toBeGreaterThan(400);
  });

  it("la pelota rueda mucho mas que un jugador: es lo que hace que el pase llegue", () => {
    const rules = createFutbolRules(TUNING);
    // Un segundo entero de rozamiento para cada uno.
    const afterPlayer = Math.pow(rules.playerDamp, 120);
    const afterBall = Math.pow(rules.ballDamp, 120);
    expect(afterBall).toBeGreaterThan(afterPlayer * 4);
  });
});

describe("choque entre jugadores", () => {
  function headOn(restitution: number): FutbolState {
    const state = fresh({
      restitution,
      playerFriction: 0,
      playerSpeed: 5000,
      goalWidth: 140,
    });
    startPlaying(state);
    for (let seat = 2; seat < FUTBOL_SEATS; seat++) {
      state.px[seat] = 150 + seat * 90;
      state.py[seat] = 840;
      state.pvx[seat] = 0;
      state.pvy[seat] = 0;
    }
    state.px[0] = 700;
    state.py[0] = 450;
    state.pvx[0] = 200;
    state.pvy[0] = 0;
    state.px[1] = 760;
    state.py[1] = 450;
    state.pvx[1] = -200;
    state.pvy[1] = 0;
    placeBall(state, 120, 120, 0, 0);
    for (let seat = 0; seat < FUTBOL_SEATS; seat++) setIntent(state, seat, 0, 0);
    return state;
  }

  it("con restitucion 1 conserva cantidad de movimiento y energia", () => {
    const state = headOn(1);
    const before = totalMomentum(state);
    const energyBefore = kineticEnergy(state);
    for (let i = 0; i < 40; i++) stepMatch(state);
    const after = totalMomentum(state);

    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
    expect(kineticEnergy(state)).toBeCloseTo(energyBefore, 3);
    // Masas iguales y de frente: las velocidades se intercambian.
    expect(state.pvx[0]).toBeCloseTo(-200, 4);
    expect(state.pvx[1]).toBeCloseTo(200, 4);
  });

  it("con restitucion menor a 1 conserva el movimiento pero pierde energia", () => {
    const state = headOn(0.5);
    const before = totalMomentum(state);
    const energyBefore = kineticEnergy(state);
    for (let i = 0; i < 40; i++) stepMatch(state);

    expect(totalMomentum(state).x).toBeCloseTo(before.x, 4);
    expect(kineticEnergy(state)).toBeLessThan(energyBefore);
    expect(kineticEnergy(state)).toBeGreaterThan(0);
  });

  it("no quedan pegados ni se atraviesan", () => {
    const state = headOn(0.55);
    for (let i = 0; i < 60; i++) stepMatch(state);
    const dx = (state.px[1] ?? 0) - (state.px[0] ?? 0);
    const dy = (state.py[1] ?? 0) - (state.py[0] ?? 0);
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeGreaterThanOrEqual(state.rules.playerRadius * 2 - 0.001);
    // Y siguen del lado del que venian: no se atravesaron.
    expect(dx).toBeGreaterThan(0);
  });

  it("ocho discos amontonados en el mismo punto se separan sin atravesarse", () => {
    const state = fresh();
    startPlaying(state);
    for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
      state.px[seat] = 800 + seat * 0.5;
      state.py[seat] = 450 + seat * 0.5;
      state.pvx[seat] = 0;
      state.pvy[seat] = 0;
      setIntent(state, seat, 0, 0);
    }
    placeBall(state, 120, 120, 0, 0);
    for (let i = 0; i < 240; i++) stepMatch(state);

    for (let i = 0; i < FUTBOL_SEATS; i++) {
      for (let j = i + 1; j < FUTBOL_SEATS; j++) {
        const dx = (state.px[j] ?? 0) - (state.px[i] ?? 0);
        const dy = (state.py[j] ?? 0) - (state.py[i] ?? 0);
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(state.rules.playerRadius * 1.6);
      }
    }
  });
});

describe("patada", () => {
  it("es un golpe: suma velocidad de una y respeta la espera", () => {
    const state = fresh();
    startPlaying(state);
    parkPlayers(state, 700);
    state.px[0] = 700;
    state.py[0] = 450;
    placeBall(state, 700 + state.rules.playerRadius + state.rules.ballRadius, 450, 0, 0);

    requestKick(state, 0);
    stepMatch(state);
    const speed = Math.sqrt(state.ballVx * state.ballVx + state.ballVy * state.ballVy);
    expect(speed).toBeGreaterThan(state.rules.kickPower * 0.9);
    expect(state.kickCount).toBe(1);

    // Volver a pedirla enseguida no hace nada: sin espera, quedarse encima de
    // la pelota la dispararia sesenta veces por segundo.
    requestKick(state, 0);
    stepMatch(state);
    expect(state.kickCount).toBe(1);
  });

  it("lejos de la pelota no patea", () => {
    const state = fresh();
    startPlaying(state);
    parkPlayers(state, 700);
    placeBall(state, 200, 200, 0, 0);
    requestKick(state, 0);
    for (let i = 0; i < 30; i++) stepMatch(state);
    expect(state.kickCount).toBe(0);
  });
});

describe("equipos y puntaje", () => {
  it("los asientos alternan equipo", () => {
    expect(teamOfSeat(0)).toBe(0);
    expect(teamOfSeat(1)).toBe(1);
    expect(teamOfSeat(6)).toBe(0);
    expect(teamOfSeat(7)).toBe(1);
  });

  it("el arco esta centrado y mide lo que dicen las reglas", () => {
    const rules = createFutbolRules(TUNING);
    expect(goalBottom(rules) - goalTop(rules)).toBeCloseTo(rules.goalWidth, 6);
    expect((goalTop(rules) + goalBottom(rules)) / 2).toBeCloseTo(rules.height / 2, 6);
  });

  it("el bono por toques tiene tope y el que no metio goles igual suma", () => {
    expect(futbolPoints(0, 0, 0, "loss")).toBe(90);
    expect(futbolPoints(0, 0, 200, "loss")).toBe(150);
    expect(futbolPoints(2, 1, 10, "win")).toBe(300 + 140 + 35 + 20);
    expect(futbolPoints(0, 0, 30, "draw")).toBe(240);
    // Al que se fue se le paga, pero se le paga poco.
    expect(futbolPoints(1, 3, 40, "quit")).toBe(160);
  });
});

/*
 * El puntaje de un cliente.
 *
 * En `arena` cada aparato emite su propio `GameOutcome`, y un cliente no
 * simula: tiene que armar su puntaje con lo que le llega. Este bloque fija que
 * se pueda, y que dé EXACTAMENTE lo mismo que la simulación del host.
 *
 * Los goles y las asistencias salen del flujo de eventos —cada gol viaja con su
 * autor— y los toques viajan empaquetados, cuatro por escalar y siete bits cada
 * uno, porque un toque no genera evento y sin ese número el cliente tendría que
 * inventarse el bono por participar, que es justo lo que el contrato prohíbe.
 *
 * Los índices de escalar de acá son propios del test: lo que se verifica es la
 * técnica —empaquetar, pasar por el codec de verdad y reconstruir— y no el
 * reparto concreto que hace `FutbolGame`, que puede moverse sin romper esto.
 */
describe("puntaje reconstruido por un cliente", () => {
  const ENTITIES = FUTBOL_SEATS + 1;
  const SCALARS = 15;
  const V_SCORE_A = 0;
  const V_SCORE_B = 1;
  const V_GOALS = 6;
  const V_GOAL_TEAM = 7;
  const V_GOAL_SEAT = 9;
  const V_ASSIST_SEAT = 12;
  const V_TOUCHES_0 = 13;
  const V_TOUCHES_1 = 14;
  const TOUCH_BITS = 7;
  const TOUCH_MAX = (1 << TOUCH_BITS) - 1;

  /** El mismo guion de siempre, pero apuntando al arco rival: hace goles. */
  function attack(state: FutbolState): void {
    for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
      const rivalGoalX = teamOfSeat(seat) === 0 ? state.rules.width : 0;
      const gx = rivalGoalX - state.ballX;
      const gy = state.rules.height / 2 - state.ballY;
      const glen = Math.sqrt(gx * gx + gy * gy) || 1;
      const aimX = state.ballX - (gx / glen) * 40;
      const aimY = state.ballY - (gy / glen) * 40;
      const dx = aimX - (state.px[seat] ?? 0);
      const dy = aimY - (state.py[seat] ?? 0);
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      setIntent(state, seat, dx / dist, dy / dist);
      const bx = state.ballX - (state.px[seat] ?? 0);
      const by = state.ballY - (state.py[seat] ?? 0);
      const reach = state.rules.playerRadius + state.rules.ballRadius + state.rules.kickReach;
      if (bx * bx + by * by <= reach * reach) requestKick(state, seat);
    }
  }

  it("los goles, las asistencias y los toques llegan enteros al cliente", () => {
    const state = fresh({ goalsToWin: 9, matchSeconds: 240 });
    startPlaying(state);

    const entities: NetEntity[] = [];
    for (let i = 0; i < ENTITIES; i++) {
      entities.push({ id: i, x: 0, y: 0, vx: 0, vy: 0, angle: 0, flags: 0 });
    }
    const snapshot = { tick: 0, entities, scalars: new Array<number>(SCALARS).fill(0) };
    const codec = createSnapshotCodec({ keyframeEvery: 20 });

    const goals = new Int32Array(FUTBOL_SEATS);
    const assists = new Int32Array(FUTBOL_SEATS);
    const touches = new Int32Array(FUTBOL_SEATS);
    let seenGoals = 0;
    let tick = 0;
    let bytes = 0;
    let packets = 0;

    for (let step = 0; step < 120 * 200 && state.phase !== PHASE_OVER; step++) {
      attack(state);
      stepMatch(state);
      // Estado a 20 Hz sobre una simulación de 120: uno de cada seis pasos.
      if (step % 6 !== 0) continue;

      tick++;
      snapshot.tick = tick;
      for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
        const entity = snapshot.entities[seat];
        if (!entity) continue;
        entity.x = state.px[seat] ?? 0;
        entity.y = state.py[seat] ?? 0;
        entity.vx = state.pvx[seat] ?? 0;
        entity.vy = state.pvy[seat] ?? 0;
      }
      const ball = snapshot.entities[BALL_ID];
      if (ball) {
        ball.x = state.ballX;
        ball.y = state.ballY;
        ball.vx = state.ballVx;
        ball.vy = state.ballVy;
      }
      snapshot.scalars[V_SCORE_A] = state.score[0] ?? 0;
      snapshot.scalars[V_SCORE_B] = state.score[1] ?? 0;
      snapshot.scalars[V_GOALS] = state.goalCount;
      snapshot.scalars[V_GOAL_TEAM] = state.lastGoalTeam;
      snapshot.scalars[V_GOAL_SEAT] = state.lastGoalSeat;
      snapshot.scalars[V_ASSIST_SEAT] = state.lastAssistSeat;
      let low = 0;
      let high = 0;
      for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
        const count = Math.min(TOUCH_MAX, state.touches[seat] ?? 0);
        if (seat < 4) low |= count << (seat * TOUCH_BITS);
        else high |= count << ((seat - 4) * TOUCH_BITS);
      }
      snapshot.scalars[V_TOUCHES_0] = low;
      snapshot.scalars[V_TOUCHES_1] = high;
      // Los escalares empaquetados nunca pueden tocar el bit de signo: viajan
      // como Int32 y un negativo se reconstruiría al revés.
      expect(low).toBeGreaterThanOrEqual(0);
      expect(high).toBeGreaterThanOrEqual(0);

      const packet = codec.encode(snapshot);
      packets++;
      bytes += packet.byteLength;
      const view = codec.decode(packet);
      expect(view).not.toBeNull();
      if (!view) return;

      const seen = view.scalars[V_GOALS] ?? 0;
      if (seen > seenGoals) {
        const team = view.scalars[V_GOAL_TEAM] ?? -1;
        // Sólo si subió de a uno: si subió de a dos se perdió un evento y no
        // se sabe de quién fue. Y sólo si el gol es PARA mi equipo, que es la
        // misma regla que aplica el host: un gol en contra no suma 70 puntos.
        if (seen - seenGoals === 1) {
          for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
            if (team !== teamOfSeat(seat)) continue;
            if ((view.scalars[V_GOAL_SEAT] ?? -1) === seat) goals[seat] = (goals[seat] ?? 0) + 1;
            if ((view.scalars[V_ASSIST_SEAT] ?? -1) === seat) assists[seat] = (assists[seat] ?? 0) + 1;
          }
        }
        seenGoals = seen;
      }
      for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
        const packed = view.scalars[seat < 4 ? V_TOUCHES_0 : V_TOUCHES_1] ?? 0;
        touches[seat] = (packed >> ((seat % 4) * TOUCH_BITS)) & TOUCH_MAX;
      }
    }

    // Un partido de verdad, no dos pases: si no hubo goles el test no probó nada.
    expect(state.goalCount).toBeGreaterThan(2);
    for (let seat = 0; seat < FUTBOL_SEATS; seat++) {
      expect([seat, goals[seat]]).toEqual([seat, state.goals[seat] ?? 0]);
      expect([seat, assists[seat]]).toEqual([seat, state.assists[seat] ?? 0]);
      expect([seat, touches[seat]]).toEqual([seat, Math.min(TOUCH_MAX, state.touches[seat] ?? 0)]);
    }
    // Criterio de la base: un tick de estado entra en menos de 200 bytes.
    expect(bytes / packets).toBeLessThan(200);
  });

  it("el punto de la patada sobrevive al empaquetado en un solo escalar", () => {
    const shift = 12;
    const mask = 0xfff;
    const bias = 128;
    for (const [x, y] of [
      [-70, 0],
      [0, 325],
      [1970, 1100],
      [800, 450],
    ] as const) {
      const packed = (x + bias) | (y << shift);
      expect(packed).toBeGreaterThanOrEqual(0);
      expect((packed & mask) - bias).toBe(x);
      expect((packed >> shift) & mask).toBe(y);
    }
  });
});
