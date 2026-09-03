import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import {
  createPongState,
  isMatchOver,
  paddlePosition,
  pongPoints,
  setPaddleTarget,
  stepPong,
  writePaddleBox,
  type PongRules,
  type PongState,
} from "./logic";

const DEG = Math.PI / 180;

const RULES: PongRules = {
  width: 1600,
  height: 900,
  ballRadius: 14,
  ballSpeed: 780,
  accelPerHit: 1.04,
  maxSpeedFactor: 2.2,
  serveAngleRad: 35 * DEG,
  maxBounceRad: 60 * DEG,
  paddleWidth: 18,
  paddleHeight: 170,
  paddleInset: 48,
  paddleFollow: 0.35,
  pointsToWin: 7,
  hardCap: 11,
  serveDelayS: 1.5,
};

/** El paso real del juego. Ver el comentario de SIM_STEP en PongGame.tsx. */
const STEP = 1 / 120;

function fresh(seed = "abc7", overrides: Partial<PongRules> = {}) {
  const rng = createRng(seed);
  const rules: PongRules = { ...RULES, ...overrides };
  return { state: createPongState(rules, rng), rng };
}

/** Pone la paleta quieta en una Y concreta, sin esperar al lerp. */
function parkPaddle(state: PongState, seat: number, y: number): void {
  state.paddleY[seat] = y;
  state.targetY[seat] = y;
}

describe("determinismo", () => {
  it("la misma semilla saca con el mismo angulo", () => {
    const a = fresh("abc7");
    const b = fresh("abc7");
    expect([a.state.ballVx, a.state.ballVy]).toEqual([b.state.ballVx, b.state.ballVy]);
  });

  it("semillas distintas divergen", () => {
    const a = fresh("abc7");
    const b = fresh("zzz9");
    expect(a.state.ballVy).not.toBe(b.state.ballVy);
  });

  it("la misma semilla da la misma partida completa", () => {
    const run = (seed: string) => {
      const { state, rng } = fresh(seed);
      const trace: number[] = [];
      for (let i = 0; i < 2400; i++) {
        // Las dos paletas siguen la pelota con el mismo retraso en las dos
        // corridas: si el trazo diverge, diverge por la simulacion.
        setPaddleTarget(state, 0, state.ballY / RULES.height);
        setPaddleTarget(state, 1, 1 - state.ballY / RULES.height);
        stepPong(state, STEP, rng);
        trace.push(state.ballX, state.ballY, state.scores[0] ?? 0, state.scores[1] ?? 0);
      }
      return trace;
    };
    expect(run("mismo")).toEqual(run("mismo"));
  });

  it("el angulo de saque nunca es casi vertical", () => {
    for (let i = 0; i < 200; i++) {
      const { state } = fresh(`saque-${i}`);
      // |vx| tiene que dominar: un saque vertical se ve como que el juego se colgo.
      expect(Math.abs(state.ballVx)).toBeGreaterThan(Math.abs(state.ballVy));
    }
  });
});

describe("paletas", () => {
  it("la posicion normalizada se convierte en el centro de la paleta", () => {
    const { state } = fresh();
    setPaddleTarget(state, 0, 0);
    expect(state.targetY[0]).toBeCloseTo(RULES.paddleHeight / 2, 5);
    setPaddleTarget(state, 0, 1);
    expect(state.targetY[0]).toBeCloseTo(RULES.height - RULES.paddleHeight / 2, 5);
  });

  it("recorta lo que se va de rango y descarta lo que no es un numero", () => {
    const { state } = fresh();
    setPaddleTarget(state, 0, 9);
    expect(state.targetY[0]).toBeCloseTo(RULES.height - RULES.paddleHeight / 2, 5);
    const before = state.targetY[0];
    setPaddleTarget(state, 0, Number.NaN);
    expect(state.targetY[0]).toBe(before);
  });

  it("paddlePosition es la inversa de setPaddleTarget", () => {
    const { state } = fresh();
    setPaddleTarget(state, 1, 0.25);
    state.paddleY[1] = state.targetY[1] ?? 0;
    expect(paddlePosition(state, 1)).toBeCloseTo(0.25, 5);
  });

  it("la caja de la paleta queda pegada a su lado", () => {
    const { state } = fresh();
    const box = { x: 0, y: 0, w: 0, h: 0 };
    writePaddleBox(state, 0, box);
    expect(box.x).toBe(RULES.paddleInset);
    writePaddleBox(state, 1, box);
    expect(box.x + box.w).toBe(RULES.width - RULES.paddleInset);
  });
});

describe("rebote en paleta", () => {
  /** Deja la pelota a punto de impactar la paleta izquierda, con la paleta quieta. */
  function aboutToHitLeft(state: PongState, paddleCenterY: number, ballY: number): void {
    parkPaddle(state, 0, paddleCenterY);
    state.serveTimerS = 0;
    state.ballX = RULES.paddleInset + RULES.paddleWidth + RULES.ballRadius + 1;
    state.ballY = ballY;
    state.ballSpeed = RULES.ballSpeed;
    state.ballVx = -RULES.ballSpeed;
    state.ballVy = 0;
  }

  it("al centro sale plano", () => {
    const { state, rng } = fresh();
    aboutToHitLeft(state, 450, 450);
    expect(stepPong(state, STEP, rng)).toBe("paddle");
    expect(state.ballVx).toBeGreaterThan(0);
    expect(Math.abs(state.ballVy)).toBeLessThan(1);
  });

  it("con la punta abre el angulo hasta el maximo", () => {
    const { state, rng } = fresh();
    const half = RULES.paddleHeight / 2;
    // La pelota pega en el borde de abajo de la paleta: offset = +1.
    aboutToHitLeft(state, 450 - half, 450);
    expect(stepPong(state, STEP, rng)).toBe("paddle");
    const angle = Math.atan2(state.ballVy, state.ballVx);
    expect(angle).toBeCloseTo(RULES.maxBounceRad, 2);
  });

  it("el angulo crece con la distancia al centro", () => {
    const half = RULES.paddleHeight / 2;
    const angleFor = (offset: number) => {
      const { state, rng } = fresh();
      aboutToHitLeft(state, 450 - offset * half, 450);
      stepPong(state, STEP, rng);
      return Math.atan2(state.ballVy, state.ballVx);
    };
    const flat = angleFor(0);
    const mid = angleFor(0.5);
    const tip = angleFor(1);
    expect(Math.abs(flat)).toBeLessThan(Math.abs(mid));
    expect(Math.abs(mid)).toBeLessThan(Math.abs(tip));
  });

  it("la paleta derecha devuelve hacia la izquierda", () => {
    const { state, rng } = fresh();
    parkPaddle(state, 1, 450);
    state.serveTimerS = 0;
    state.ballX = RULES.width - RULES.paddleInset - RULES.paddleWidth - RULES.ballRadius - 1;
    state.ballY = 450;
    state.ballSpeed = RULES.ballSpeed;
    state.ballVx = RULES.ballSpeed;
    state.ballVy = 0;
    expect(stepPong(state, STEP, rng)).toBe("paddle");
    expect(state.ballVx).toBeLessThan(0);
  });
});

describe("velocidad", () => {
  it("acelera en cada rebote y se clava en el techo", () => {
    const { state, rng } = fresh();
    const top = RULES.ballSpeed * RULES.maxSpeedFactor;
    const speeds: number[] = [];

    // Las dos paletas siguen la pelota sin error: el peloteo no se corta y se
    // acumulan rebotes hasta llegar al tope.
    state.rules.paddleFollow = 1;
    for (let i = 0; i < 6000; i++) {
      setPaddleTarget(state, 0, state.ballY / RULES.height);
      setPaddleTarget(state, 1, state.ballY / RULES.height);
      if (stepPong(state, STEP, rng) === "paddle") speeds.push(state.ballSpeed);
      expect(state.ballSpeed).toBeLessThanOrEqual(top + 1e-6);
    }

    expect(speeds.length).toBeGreaterThan(30);
    expect(speeds[0] ?? 0).toBeCloseTo(RULES.ballSpeed * RULES.accelPerHit, 4);
    expect(speeds[speeds.length - 1] ?? 0).toBeCloseTo(top, 6);
  });
});

describe("gol", () => {
  it("se detecta del lado izquierdo y suma al asiento 1", () => {
    const { state, rng } = fresh();
    state.serveTimerS = 0;
    state.ballX = 10;
    state.ballY = 450;
    state.ballVx = -6000;
    state.ballVy = 0;
    expect(stepPong(state, STEP, rng)).toBe("goal");
    expect([state.scores[0], state.scores[1]]).toEqual([0, 1]);
  });

  it("se detecta del lado derecho y suma al asiento 0", () => {
    const { state, rng } = fresh();
    state.serveTimerS = 0;
    state.ballX = RULES.width - 10;
    state.ballY = 450;
    state.ballVx = 6000;
    state.ballVy = 0;
    expect(stepPong(state, STEP, rng)).toBe("goal");
    expect([state.scores[0], state.scores[1]]).toEqual([1, 0]);
  });

  it("saca hacia el que acaba de recibir el gol, despues de la pausa", () => {
    const { state, rng } = fresh();
    state.serveTimerS = 0;
    state.ballX = 10;
    state.ballVx = -6000;
    stepPong(state, STEP, rng);
    expect(state.serveToSeat).toBe(0);
    expect(state.serveTimerS).toBeCloseTo(RULES.serveDelayS, 5);
    expect(state.ballVx).toBe(0);

    // La pelota no se mueve hasta que se agota la pausa.
    for (let i = 0; i < Math.ceil(RULES.serveDelayS / STEP); i++) stepPong(state, STEP, rng);
    expect(state.serveTimerS).toBe(0);
    expect(state.ballVx).toBeLessThan(0);
  });

  it("guarda el rally mas largo", () => {
    const { state, rng } = fresh();
    state.rules.paddleFollow = 1;
    for (let i = 0; i < 3000; i++) {
      setPaddleTarget(state, 0, state.ballY / RULES.height);
      setPaddleTarget(state, 1, state.ballY / RULES.height);
      stepPong(state, STEP, rng);
    }
    expect(state.rally).toBeGreaterThan(5);
  });
});

describe("fin del partido", () => {
  it("hacen falta 7 puntos y dos de diferencia", () => {
    const { state } = fresh();
    state.scores[0] = 7;
    state.scores[1] = 6;
    expect(isMatchOver(state)).toBe(false);
    state.scores[0] = 8;
    expect(isMatchOver(state)).toBe(true);
  });

  it("el techo duro corta aunque no haya diferencia de dos", () => {
    const { state } = fresh();
    state.scores[0] = 11;
    state.scores[1] = 10;
    expect(isMatchOver(state)).toBe(true);
  });

  it("el gol que cierra el partido devuelve 'match' y deja ganador", () => {
    const { state, rng } = fresh();
    state.scores[0] = 6;
    state.serveTimerS = 0;
    state.ballX = RULES.width - 10;
    state.ballVx = 6000;
    expect(stepPong(state, STEP, rng)).toBe("match");
    expect(state.over).toBe(true);
    expect(state.winner).toBe(0);
  });

  it("con el partido terminado los pasos siguientes no cambian nada", () => {
    const { state, rng } = fresh();
    state.over = true;
    const x = state.ballX;
    stepPong(state, STEP, rng);
    expect(state.ballX).toBe(x);
  });
});

describe("tunel: el bug clasico del Pong", () => {
  it("un paso largo a velocidad maxima no atraviesa la paleta", () => {
    const { state, rng } = fresh();
    parkPaddle(state, 0, 450);
    state.serveTimerS = 0;
    state.ballX = 800;
    state.ballY = 450;
    state.ballSpeed = state.maxSpeed;
    state.ballVx = -state.maxSpeed;
    state.ballVy = 0;

    // Medio segundo de un saque: la pelota recorre 858 unidades y la paleta
    // mide 18 de ancho. Con colision discreta esto es gol; con barrido, rebote.
    expect(stepPong(state, 0.5, rng)).toBe("paddle");
    expect(state.ballVx).toBeGreaterThan(0);
    expect(state.ballX).toBeGreaterThan(RULES.paddleInset + RULES.paddleWidth);
    expect([state.scores[0], state.scores[1]]).toEqual([0, 0]);
  });

  it("con la paleta pegada a la pelota no entra ni un gol en un peloteo largo", () => {
    // Paso de 1/60: al doble del paso real, la pelota avanza 28 unidades por
    // paso contra una paleta de 18 de ancho. Sin barrido, pasa de largo.
    const { state, rng } = fresh("tunel", { paddleFollow: 1, maxSpeedFactor: 1, ballSpeed: 1716 });
    for (let i = 0; i < 4000; i++) {
      setPaddleTarget(state, 0, state.ballY / RULES.height);
      setPaddleTarget(state, 1, state.ballY / RULES.height);
      stepPong(state, 1 / 60, rng);
    }
    expect([state.scores[0], state.scores[1]]).toEqual([0, 0]);
    expect(state.rally).toBeGreaterThan(20);
  });

  it("la pelota nunca se va de la cancha por arriba ni por abajo", () => {
    const { state, rng } = fresh("paredes");
    state.rules.paddleFollow = 1;
    for (let i = 0; i < 6000; i++) {
      setPaddleTarget(state, 0, state.ballY / RULES.height);
      setPaddleTarget(state, 1, state.ballY / RULES.height);
      stepPong(state, STEP, rng);
      expect(state.ballY).toBeGreaterThanOrEqual(0);
      expect(state.ballY).toBeLessThanOrEqual(RULES.height);
    }
  });
});

describe("puntaje", () => {
  it("el ganador cobra base, diferencia y goles propios", () => {
    expect(pongPoints(7, 3, "win")).toBe(400 + 4 * 30 + 7 * 20);
  });

  it("el perdedor cobra base y sus goles", () => {
    expect(pongPoints(3, 7, "loss")).toBe(120 + 3 * 25);
  });

  it("el que se fue cobra el abandono", () => {
    expect(pongPoints(5, 2, "quit")).toBe(80);
  });
});
