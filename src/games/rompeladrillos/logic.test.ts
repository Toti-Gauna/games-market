import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import { sweepCircleBox, type Box, type Circle } from "@/core/engine/collide";
import {
  BREAKOUT_SEATS,
  CAP_JOINT,
  breakoutPoints,
  createBreakoutState,
  segmentGap,
  segmentPosition,
  segmentRange,
  segmentRangeNorm,
  setSegmentTarget,
  stepBreakout,
  writeSegmentBox,
  EV_BRICK,
  EV_SEGMENT,
  type BreakoutRules,
  type BreakoutState,
  type Range,
} from "./logic";

const DEG = Math.PI / 180;

const RULES: BreakoutRules = {
  width: 1600,
  height: 900,
  ballRadius: 13,
  ballSpeed: 420,
  accelPerHit: 1.03,
  maxSpeedFactor: 2,
  maxBounceRad: 60 * DEG,
  segmentWidth: 110,
  segmentHeight: 22,
  segmentY: 830,
  segmentFollow: 0.45,
  minGap: 0,
  maxSeparation: 420,
  rows: 8,
  cols: 14,
  brickTop: 130,
  brickSide: 90,
  brickCellHeight: 40,
  cellGap: 6,
  capsuleChance: 0.12,
  capsuleSpeed: 210,
  lives: 3,
  loseDelayS: 1.5,
};

/** El paso real del juego. Ver el comentario de SIM_STEP en RompeladrillosGame.tsx. */
const STEP = 1 / 120;

function fresh(seed = "abc7", overrides: Partial<BreakoutRules> = {}) {
  const rng = createRng(seed);
  const rules: BreakoutRules = { ...RULES, ...overrides };
  return { state: createBreakoutState(rules, rng), rng, rules };
}

/** Saca la pausa de saque y deja la pelota en juego, quieta donde se la pone. */
function placeBall(state: BreakoutState, x: number, y: number, vx: number, vy: number): void {
  state.serveTimerS = 0;
  state.ballAlive[0] = 1;
  state.ballStuck[0] = -1;
  state.ballX[0] = x;
  state.ballY[0] = y;
  state.ballVx[0] = vx;
  state.ballVy[0] = vy;
  state.ballSpeed[0] = Math.hypot(vx, vy);
}

/** Planta los dos segmentos donde se los quiera, sin esperar al lerp. */
function parkSegments(state: BreakoutState, a: number, b: number): void {
  state.segX[0] = a;
  state.segX[1] = b;
  state.segTarget[0] = a;
  state.segTarget[1] = b;
  state.segWish[0] = segmentPosition(state, 0);
  state.segWish[1] = segmentPosition(state, 1);
}

/** Corre pasos hasta que se cumpla algo, o se agoten. Devuelve el OR de eventos. */
function stepUntil(
  state: BreakoutState,
  rng: ReturnType<typeof createRng>,
  dt: number,
  done: (state: BreakoutState, mask: number) => boolean,
  maxSteps = 400,
): number {
  let all = 0;
  for (let i = 0; i < maxSteps; i++) {
    const mask = stepBreakout(state, dt, rng);
    all |= mask;
    if (done(state, mask)) break;
  }
  return all;
}

const range: Range = { min: 0, max: 0 };
const box: Box = { x: 0, y: 0, w: 0, h: 0 };

/* ------------------------------------------------------------------ */

describe("determinismo", () => {
  it("la misma semilla arma el mismo tablero y las mismas cápsulas", () => {
    const a = fresh("abc7");
    const b = fresh("abc7");
    expect(Array.from(a.state.brickType)).toEqual(Array.from(b.state.brickType));
    expect(Array.from(a.state.brickCapsule)).toEqual(Array.from(b.state.brickCapsule));
    expect(a.state.bricksLeft).toBe(b.state.bricksLeft);
  });

  it("semillas distintas reparten las cápsulas distinto", () => {
    const a = fresh("abc7");
    const b = fresh("zzz9");
    expect(Array.from(a.state.brickCapsule)).not.toEqual(Array.from(b.state.brickCapsule));
  });

  it("la misma semilla y los mismos inputs dan la misma partida", () => {
    const run = (seed: string) => {
      const { state, rng } = fresh(seed);
      const trace: number[] = [];
      for (let i = 0; i < 3000; i++) {
        // Los dos siguen la pelota con el mismo criterio en las dos corridas:
        // si el trazo diverge, diverge por la simulacion.
        const aim = (state.ballX[0] ?? 800) / RULES.width;
        setSegmentTarget(state, 0, aim - 0.04);
        setSegmentTarget(state, 1, aim + 0.04);
        stepBreakout(state, STEP, rng);
        trace.push(
          state.ballX[0] ?? 0,
          state.ballY[0] ?? 0,
          state.segX[0] ?? 0,
          state.segX[1] ?? 0,
          state.bricksLeft,
          state.lives,
        );
      }
      return trace;
    };
    expect(run("mismo")).toEqual(run("mismo"));
  });
});

/* ------------------------------------------------------------------ */

describe("barrido: la pelota no atraviesa nada", () => {
  it("a velocidad absurda rebota en el segmento en vez de pasarlo de largo", () => {
    const { state, rng } = fresh("tunel");
    parkSegments(state, 745, 855);

    // 30000 u/s con dt de 1/60 son 500 unidades en un paso, contra un segmento
    // de 22 de alto: sin barrido la pelota aparece 400 unidades debajo del
    // suelo y la vida se pierde sin que nadie vea por que.
    placeBall(state, 800, 700, 0, 30000);
    const before = state.lives;
    stepBreakout(state, 1 / 60, rng);

    expect(state.ballAlive[0]).toBe(1);
    expect(state.ballY[0] ?? 0).toBeLessThanOrEqual(RULES.segmentY);
    expect(state.ballVy[0] ?? 0).toBeLessThan(0);
    expect(state.lives).toBe(before);
  });

  it("una colisión discreta sí la dejaría pasar: el barrido es lo que la agarra", () => {
    // La contraprueba, contra el mismo `sweepCircleBox` que usa la logica.
    const { state } = fresh("tunel");
    parkSegments(state, 745, 855);
    writeSegmentBox(state, 0, box);

    const circle: Circle = { x: 800, y: 700, r: RULES.ballRadius };
    const dy = 500;
    // Discreta: ni el origen ni el destino tocan el segmento.
    const endsInside = 700 + dy < box.y + box.h && 700 + dy > box.y;
    expect(endsInside).toBe(false);
    // Barrida: hay impacto, y antes de la mitad del tramo.
    const t = sweepCircleBox(circle, 0, dy, box);
    expect(t).not.toBeNull();
    expect(t ?? 1).toBeLessThan(0.5);
  });

  it("por el hueco entre segmentos sí se cae: el hueco no es un objeto", () => {
    const { state, rng } = fresh("hueco");
    // Bien separados: el centro queda descubierto.
    parkSegments(state, 620, 980);
    placeBall(state, 800, 700, 0, 4000);
    const before = state.lives;
    stepUntil(state, rng, 1 / 60, (s) => s.lives < before, 40);
    expect(state.lives).toBe(before - 1);
  });

  it("juntos no hay hueco y la pelota vuelve", () => {
    const { state, rng } = fresh("hueco");
    parkSegments(state, 745, 855);
    expect(segmentGap(state)).toBeCloseTo(0, 5);
    // Bien adentro del segmento 1, no sobre la costura entre los dos.
    placeBall(state, 770, 700, 0, 4000);
    const before = state.lives;
    stepUntil(state, rng, 1 / 60, (_s, mask) => (mask & EV_SEGMENT) !== 0, 40);
    expect(state.lives).toBe(before);
    expect(state.ballVy[0] ?? 0).toBeLessThan(0);
  });

  it("no atraviesa un ladrillo aunque el paso sea larguísimo", () => {
    const { state, rng } = fresh("ladrillo");
    // Contra la primera fila, desde abajo y a toda velocidad.
    placeBall(state, 200, 700, 0, -40000);
    const before = state.bricksLeft;
    stepBreakout(state, 1 / 60, rng);
    expect(state.bricksLeft).toBeLessThan(before);
    expect(state.ballY[0] ?? 0).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */

describe("la paleta partida", () => {
  it("el rango de un segmento se achica cuando el otro se le acerca", () => {
    const { state } = fresh("rango");

    parkSegments(state, 500, 1000);
    segmentRange(state, 0, range);
    const wide = range.max - range.min;

    parkSegments(state, 300, 400);
    segmentRange(state, 0, range);
    const near = range.max - range.min;

    parkSegments(state, 150, 200);
    segmentRange(state, 0, range);
    const cramped = range.max - range.min;

    expect(near).toBeLessThan(wide);
    expect(cramped).toBeLessThan(near);
  });

  it("el rango sigue al compañero: el techo del 1 nunca pasa al 2", () => {
    const { state } = fresh("rango");
    parkSegments(state, 600, 900);
    segmentRange(state, 0, range);
    // El margen de empuje deja pedir hasta el centro del companero, nunca mas.
    expect(range.max).toBeLessThanOrEqual(900);
    expect(range.min).toBeGreaterThanOrEqual(900 - RULES.maxSeparation);

    segmentRange(state, 1, range);
    expect(range.min).toBeGreaterThanOrEqual(600);
    expect(range.max).toBeLessThanOrEqual(600 + RULES.maxSeparation);
  });

  it("el rango normalizado que va al mando está en 0..1 y ordenado", () => {
    const { state } = fresh("rango");
    parkSegments(state, 300, 420);
    for (let seat = 0; seat < BREAKOUT_SEATS; seat++) {
      segmentRangeNorm(state, seat, range);
      expect(range.min).toBeGreaterThanOrEqual(0);
      expect(range.max).toBeLessThanOrEqual(1);
      expect(range.max).toBeGreaterThanOrEqual(range.min);
    }
  });

  it("los dos segmentos nunca se superponen, ni empujando de frente", () => {
    const { state, rng } = fresh("empuje");
    for (let i = 0; i < 1200; i++) {
      // Los dos van al mismo punto del centro: es el peor caso posible.
      setSegmentTarget(state, 0, 1);
      setSegmentTarget(state, 1, 0);
      stepBreakout(state, STEP, rng);
      const distance = (state.segX[1] ?? 0) - (state.segX[0] ?? 0);
      expect(distance).toBeGreaterThanOrEqual(RULES.segmentWidth - 1e-3);
      expect(state.segX[0] ?? 0).toBeLessThan(state.segX[1] ?? 0);
    }
  });

  it("con separación mínima > 0 el hueco nunca se cierra, y tampoco se cruzan", () => {
    const { state, rng } = fresh("empuje", { minGap: 40 });
    for (let i = 0; i < 600; i++) {
      setSegmentTarget(state, 0, 1);
      setSegmentTarget(state, 1, 0);
      stepBreakout(state, STEP, rng);
      const distance = (state.segX[1] ?? 0) - (state.segX[0] ?? 0);
      expect(distance).toBeGreaterThanOrEqual(RULES.segmentWidth + 40 - 1e-3);
    }
  });

  it("empujar corre al compañero: el que insiste gana terreno", () => {
    const { state, rng } = fresh("empuje");
    parkSegments(state, 400, 510);
    // El 2 se queda quieto donde esta; el 1 empuja hacia la derecha.
    setSegmentTarget(state, 1, segmentPosition(state, 1));
    const before = state.segX[1] ?? 0;
    for (let i = 0; i < 240; i++) {
      setSegmentTarget(state, 0, 1);
      stepBreakout(state, STEP, rng);
    }
    expect(state.segX[1] ?? 0).toBeGreaterThan(before + 20);
    expect((state.segX[1] ?? 0) - (state.segX[0] ?? 0)).toBeGreaterThanOrEqual(
      RULES.segmentWidth - 1e-3,
    );
  });

  it("la correa impide separarse más de lo permitido", () => {
    const { state, rng } = fresh("correa");
    for (let i = 0; i < 900; i++) {
      setSegmentTarget(state, 0, 0);
      setSegmentTarget(state, 1, 1);
      stepBreakout(state, STEP, rng);
      const distance = (state.segX[1] ?? 0) - (state.segX[0] ?? 0);
      expect(distance).toBeLessThanOrEqual(RULES.maxSeparation + 1e-3);
    }
  });

  it("el host recorta lo que llega: NaN, infinitos y números absurdos no mueven nada", () => {
    const { state } = fresh("saneo");
    const before = state.segTarget[0] ?? 0;
    setSegmentTarget(state, 0, Number.NaN);
    expect(state.segTarget[0] ?? 0).toBe(before);
    setSegmentTarget(state, 0, Number.POSITIVE_INFINITY);
    expect(state.segTarget[0] ?? 0).toBe(before);

    setSegmentTarget(state, 0, 1e9);
    segmentRange(state, 0, range);
    expect(state.segTarget[0] ?? 0).toBeLessThanOrEqual(range.max + 1e-3);
    setSegmentTarget(state, 0, -1e9);
    segmentRange(state, 0, range);
    expect(state.segTarget[0] ?? 0).toBeGreaterThanOrEqual(range.min - 1e-3);

    // Un asiento que no existe no puede tocar el estado.
    const snapshot = Array.from(state.segTarget);
    setSegmentTarget(state, 7, 0.1);
    expect(Array.from(state.segTarget)).toEqual(snapshot);
  });

  it("la cápsula Junta une los segmentos y no deja abrir hueco", () => {
    const { state, rng } = fresh("junta");
    state.jointMs = 10_000;
    for (let i = 0; i < 400; i++) {
      setSegmentTarget(state, 0, 0);
      setSegmentTarget(state, 1, 1);
      stepBreakout(state, STEP, rng);
      expect(segmentGap(state)).toBeLessThan(1e-2);
    }
    // Y el rango que ve el mando pasa a ser el recorrido del par entero.
    segmentRange(state, 0, range);
    expect(range.min).toBeCloseTo(state.segWidth / 2, 5);
  });
});

/* ------------------------------------------------------------------ */

describe("rebote en el segmento", () => {
  it("el punto de impacto cambia el ángulo de salida", () => {
    const sample = (offset: number) => {
      const { state, rng } = fresh("angulo");
      parkSegments(state, 745, 855);
      const center = state.segX[0] ?? 745;
      placeBall(state, center + offset, 780, 0, 900);
      stepUntil(state, rng, STEP, (_s, mask) => (mask & EV_SEGMENT) !== 0, 40);
      return { vx: state.ballVx[0] ?? 0, vy: state.ballVy[0] ?? 0 };
    };

    const left = sample(-48);
    const middle = sample(0);
    const right = sample(48);

    // Al centro sale recta; en las puntas se abre para cada lado.
    expect(middle.vx).toBeCloseTo(0, 3);
    expect(left.vx).toBeLessThan(-1);
    expect(right.vx).toBeGreaterThan(1);
    // Y siempre sale para arriba, pegue donde pegue.
    expect(left.vy).toBeLessThan(0);
    expect(middle.vy).toBeLessThan(0);
    expect(right.vy).toBeLessThan(0);
    // Cuanto mas al borde, mas abierto.
    expect(Math.abs(left.vx)).toBeGreaterThan(Math.abs(middle.vx));
  });

  it("el rebote acelera la pelota hasta el techo y no más", () => {
    const { state, rng } = fresh("acelera");
    parkSegments(state, 745, 855);
    placeBall(state, 855, 780, 0, RULES.ballSpeed);
    stepUntil(state, rng, STEP, (_s, mask) => (mask & EV_SEGMENT) !== 0, 40);
    expect(state.ballSpeed[0] ?? 0).toBeGreaterThan(RULES.ballSpeed);

    for (let i = 0; i < 60; i++) {
      placeBall(state, 855, 780, 0, state.maxSpeed);
      state.ballSpeed[0] = state.maxSpeed;
      stepUntil(state, rng, STEP, (_s, mask) => (mask & EV_SEGMENT) !== 0, 40);
      expect(state.ballSpeed[0] ?? 0).toBeLessThanOrEqual(state.maxSpeed + 1e-3);
    }
  });

  it("los puntos del ladrillo son de quien la rebotó por última vez", () => {
    const { state, rng } = fresh("dueno");
    parkSegments(state, 745, 855);
    placeBall(state, 855, 780, 0, 900);
    const mask = stepUntil(state, rng, STEP, (_s, m) => (m & EV_SEGMENT) !== 0, 40);
    expect(mask & EV_SEGMENT).toBeTruthy();
    expect(state.ballOwner[0]).toBe(1);

    // Contra la fila de abajo del tablero, ya con dueno.
    placeBall(state, state.ballX[0] ?? 855, 700, 0, -40000);
    state.ballOwner[0] = 1;
    stepBreakout(state, 1 / 60, rng);
    expect(state.brickPoints[1] ?? 0).toBeGreaterThan(0);
    expect(state.brickPoints[0] ?? 0).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe("ladrillos", () => {
  it("un ladrillo se destruye una sola vez", () => {
    const { state, rng } = fresh("unavez");
    // Un tablero de un solo ladrillo normal: el resto se limpia a mano.
    state.brickHp.fill(0);
    state.brickCapsule.fill(-1);
    const index = 7 * RULES.cols + 6;
    state.brickType[index] = 0;
    state.brickHp[index] = 1;
    state.brickMaxHp[index] = 1;
    state.bricksLeft = 1;

    placeBall(state, 90 + 6.5 * ((1600 - 180) / 14), 700, 0, -20000);
    state.ballOwner[0] = 0;
    const mask = stepBreakout(state, 1 / 60, rng);

    expect(mask & EV_BRICK).toBeTruthy();
    expect(state.brickHp[index]).toBe(0);
    const points = state.brickPoints[0] ?? 0;
    expect(points).toBe(50);

    // El nivel se dio por terminado con ese ladrillo; los puntos no se vuelven
    // a pagar por mas pasos que corran.
    for (let i = 0; i < 200; i++) stepBreakout(state, STEP, rng);
    expect(state.brickPoints[0] ?? 0).toBe(points);
  });

  it("un reforzado aguanta dos golpes antes de romperse", () => {
    const { state, rng } = fresh("reforzado");
    state.brickHp.fill(0);
    state.brickCapsule.fill(-1);
    const index = 7 * RULES.cols + 6;
    state.brickType[index] = 1;
    state.brickHp[index] = 2;
    state.brickMaxHp[index] = 2;
    state.bricksLeft = 1;

    const x = 90 + 6.5 * ((1600 - 180) / 14);
    placeBall(state, x, 700, 0, -20000);
    state.ballOwner[0] = 0;
    stepBreakout(state, 1 / 60, rng);
    expect(state.brickHp[index]).toBe(1);
    expect(state.bricksLeft).toBe(1);
    expect(state.brickPoints[0] ?? 0).toBe(0);

    placeBall(state, x, 700, 0, -20000);
    state.ballOwner[0] = 0;
    stepBreakout(state, 1 / 60, rng);
    expect(state.brickHp[index]).toBe(0);
    expect(state.brickPoints[0] ?? 0).toBe(120);
  });

  it("terminar el nivel suma el bono y arranca el siguiente", () => {
    const { state, rng } = fresh("nivel");
    state.serveTimerS = 0;
    state.brickHp.fill(0);
    state.bricksLeft = 0;
    stepBreakout(state, STEP, rng);
    expect(state.levelsCleared).toBe(1);
    expect(state.level).toBe(1);
    expect(state.bricksLeft).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */

describe("puntaje", () => {
  it("el bono por nivel es el mismo para los dos y los ladrillos no", () => {
    const uno = breakoutPoints(600, 2, 3);
    const dos = breakoutPoints(200, 2, 0);
    expect(uno).toBe(600 + 800 + 90);
    expect(dos).toBe(200 + 800);
    expect(uno - dos).toBe(400 + 90);
  });

  it("nunca es negativo", () => {
    expect(breakoutPoints(0, 0, 0)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe("jugabilidad", () => {
  it("dos bots que se reparten la pelota rompen ladrillos y sostienen la partida", () => {
    const { state, rng } = fresh("solitario");
    const before = state.bricksLeft;
    // Los dos bots hacen sandwich: el 1 se para a la izquierda de la pelota y
    // el 2 a la derecha. Es la politica que usa el juego para los asientos
    // vacios, y es la prueba de que se puede jugar en solitario.
    for (let i = 0; i < 120 * 40; i++) {
      const aim = (state.ballX[0] ?? 800) / RULES.width;
      setSegmentTarget(state, 0, aim - state.segWidth / 2 / RULES.width);
      setSegmentTarget(state, 1, aim + state.segWidth / 2 / RULES.width);
      stepBreakout(state, STEP, rng);
      if (state.over) break;
    }
    expect(state.bricksLeft).toBeLessThan(before);
    expect((state.brickPoints[0] ?? 0) + (state.brickPoints[1] ?? 0)).toBeGreaterThan(0);
    // Con la paleta bien puesta no se pierden las tres vidas en 40 segundos.
    expect(state.lives).toBeGreaterThan(0);
  });
});

describe("capsulas", () => {
  it("la Junta se puede agarrar con cualquiera de los dos segmentos", () => {
    for (let seat = 0; seat < BREAKOUT_SEATS; seat++) {
      const { state, rng } = fresh("captura");
      state.serveTimerS = 0;
      writeSegmentBox(state, seat, box);
      state.capAlive[0] = 1;
      state.capType[0] = CAP_JOINT;
      state.capX[0] = box.x + box.w / 2;
      state.capY[0] = box.y - 4;
      stepBreakout(state, STEP, rng);
      expect(state.jointMs).toBeGreaterThan(0);
      expect(state.catches[seat] ?? 0).toBe(1);
    }
  });
});
