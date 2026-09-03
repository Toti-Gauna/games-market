import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import {
  createSnakeState,
  queueTurn,
  segmentAt,
  snakePoints,
  stepSnake,
  type SnakeRules,
} from "./logic";

const RULES: SnakeRules = {
  cols: 24,
  rows: 16,
  startSpeed: 6,
  speedGain: 0.35,
  maxSpeed: 14,
  growth: 2,
};

function fresh(seed = "abc7", rules: SnakeRules = RULES) {
  const rng = createRng(seed);
  return { state: createSnakeState(rules, rng, 8), rng };
}

describe("determinismo", () => {
  it("la misma semilla pone la comida en el mismo lugar", () => {
    const a = fresh("abc7");
    const b = fresh("abc7");
    expect([a.state.foodX, a.state.foodY, a.state.foodWord]).toEqual([
      b.state.foodX,
      b.state.foodY,
      b.state.foodWord,
    ]);
  });

  it("semillas distintas divergen", () => {
    const a = fresh("abc7");
    const b = fresh("zzz9");
    const same = a.state.foodX === b.state.foodX && a.state.foodY === b.state.foodY;
    expect(same).toBe(false);
  });

  it("la misma semilla da la misma partida completa", () => {
    const run = (seed: string) => {
      const { state, rng } = fresh(seed);
      const trace: number[] = [];
      for (let i = 0; i < 40; i++) {
        stepSnake(state, rng, 8);
        trace.push(state.foodX, state.foodY, state.length);
      }
      return trace;
    };
    expect(run("mismo")).toEqual(run("mismo"));
  });
});

describe("giros", () => {
  it("ignora el giro de 180 grados", () => {
    const { state } = fresh();
    queueTurn(state, "left"); // arranca yendo a la derecha
    expect(state.queued).toBeNull();
  });

  it("encola un giro valido", () => {
    const { state } = fresh();
    queueTurn(state, "up");
    expect(state.queued).toBe("up");
  });

  it("el segundo giro se compara contra el encolado, no contra la direccion actual", () => {
    const { state } = fresh();
    queueTurn(state, "up");
    // "down" seria valido contra "right", pero es el opuesto de "up" ya encolado.
    queueTurn(state, "down");
    expect(state.queued).toBe("up");
  });
});

describe("movimiento y muerte", () => {
  it("choca contra el borde derecho", () => {
    const { state, rng } = fresh();
    let result: string = "moved";
    for (let i = 0; i < RULES.cols + 2 && result !== "died"; i++) {
      result = stepSnake(state, rng, 8);
    }
    expect(result).toBe("died");
    expect(state.dead).toBe(true);
  });

  it("puede pisar la celda de la cola cuando no esta creciendo", () => {
    // Un cuadrado de 4 pasos con un cuerpo de 3 termina justo sobre la cola.
    const { state, rng } = fresh();
    // Alejamos la comida para que no interfiera con el recorrido.
    state.foodX = RULES.cols - 1;
    state.foodY = RULES.rows - 1;

    queueTurn(state, "down");
    expect(stepSnake(state, rng, 8)).not.toBe("died");
    queueTurn(state, "left");
    expect(stepSnake(state, rng, 8)).not.toBe("died");
    queueTurn(state, "up");
    expect(stepSnake(state, rng, 8)).not.toBe("died");
  });

  it("comer hace crecer y acelerar", () => {
    const { state, rng } = fresh();
    const head = segmentAt(state, 0);
    // Poner la comida justo delante de la cabeza fuerza el "ate" en un paso.
    state.foodX = head.x + 1;
    state.foodY = head.y;

    const lengthBefore = state.length;
    const speedBefore = state.speed;
    expect(stepSnake(state, rng, 8)).toBe("ate");
    expect(state.eaten).toBe(1);
    expect(state.speed).toBeCloseTo(speedBefore + RULES.speedGain, 5);

    // El crecimiento se paga de a un segmento por paso.
    stepSnake(state, rng, 8);
    stepSnake(state, rng, 8);
    expect(state.length).toBe(lengthBefore + RULES.growth);
  });

  it("respeta el techo de velocidad", () => {
    const { state, rng } = fresh("tope", { ...RULES, startSpeed: 13.9, maxSpeed: 14 });
    for (let i = 0; i < 3; i++) {
      const head = segmentAt(state, 0);
      state.foodX = head.x + 1;
      state.foodY = head.y;
      stepSnake(state, rng, 8);
    }
    expect(state.speed).toBe(14);
  });
});

describe("puntaje", () => {
  it("suma base por principio y bono proporcional al tiempo", () => {
    expect(snakePoints(5, 50, 45_000, 90_000, 200)).toBe(350);
  });

  it("sin limite de tiempo no hay bono", () => {
    expect(snakePoints(5, 50, 45_000, null, 200)).toBe(250);
  });

  it("el bono no supera su techo aunque se pase de tiempo", () => {
    expect(snakePoints(0, 50, 200_000, 90_000, 200)).toBe(200);
  });
});
