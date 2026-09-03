import { describe, expect, it } from "vitest";
import { createPrediction, createSequencer, replayInputs, type PendingInput } from "./prediction";

/**
 * La entidad propia de un Pong: una paleta que sube y baja.
 * `step` es pura y con dt fijo, que es lo que la reconciliacion exige.
 */
type Paddle = { y: number };
type PaddleInput = { dir: -1 | 0 | 1 };

const SPEED = 600;
const DT = 1 / 60;

function step(state: Paddle, input: PaddleInput, dt: number): Paddle {
  const y = state.y + input.dir * SPEED * dt;
  return { y: y < 0 ? 0 : y > 720 ? 720 : y };
}

function inputsUp(count: number, from = 1): PendingInput<PaddleInput>[] {
  return Array.from({ length: count }, (_, i) => ({ sequence: from + i, input: { dir: 1 as const } }));
}

describe("prediccion local", () => {
  it("el input se ve en el acto, sin esperar al host", () => {
    const prediction = createPrediction<Paddle, PaddleInput>({ y: 100 }, { step, dt: DT });

    const sequence = prediction.predict({ dir: 1 });

    expect(sequence).toBe(1);
    expect(prediction.predicted.y).toBeCloseTo(110, 6);
    // El autoritativo no se movio: todavia no llego nada del host.
    expect(prediction.confirmed.y).toBe(100);
    expect(prediction.pending).toHaveLength(1);
  });

  it("las secuencias son consecutivas y arrancan en 1", () => {
    const prediction = createPrediction<Paddle, PaddleInput>({ y: 0 }, { step, dt: DT });
    expect([prediction.predict({ dir: 0 }), prediction.predict({ dir: 0 })]).toEqual([1, 2]);
    expect(prediction.lastSequence).toBe(2);
  });

  it("no acumula pendientes para siempre cuando el host desaparecio", () => {
    const prediction = createPrediction<Paddle, PaddleInput>({ y: 0 }, { step, dt: DT, maxPending: 5 });
    for (let i = 0; i < 40; i++) prediction.predict({ dir: 1 });
    expect(prediction.pending).toHaveLength(5);
  });
});

describe("reconciliacion", () => {
  it("re-simular los pendientes da lo mismo que simularlos de una", () => {
    // Es el test que sostiene toda la prediccion: si esto falla, la paleta
    // salta cada vez que llega un paquete.
    const start: Paddle = { y: 200 };
    const inputs = inputsUp(10);
    const direct = replayInputs(start, inputs, step, DT);

    const prediction = createPrediction<Paddle, PaddleInput>(start, { step, dt: DT });
    for (const entry of inputs) prediction.predict(entry.input);
    expect(prediction.predicted).toEqual(direct);

    // El host proceso los primeros cuatro y manda su estado.
    const authoritative = replayInputs(start, inputs.slice(0, 4), step, DT);
    prediction.reconcile(authoritative, 4);

    expect(prediction.pending).toHaveLength(6);
    expect(prediction.predicted).toEqual(direct);
  });

  it("converge al estado autoritativo cuando el cliente se equivoco", () => {
    const prediction = createPrediction<Paddle, PaddleInput>({ y: 300 }, { step, dt: DT });
    for (let i = 0; i < 6; i++) prediction.predict({ dir: -1 });

    // El host dice otra cosa: la paleta choco contra el borde. Manda la suya.
    const authoritative: Paddle = { y: 0 };
    prediction.reconcile(authoritative, 6);

    expect(prediction.confirmed).toEqual(authoritative);
    expect(prediction.pending).toHaveLength(0);
    // Sin pendientes, lo predicho ES lo autoritativo: no queda deriva.
    expect(prediction.predicted).toEqual(authoritative);
  });

  it("lo que el host todavia no proceso sobrevive a la reconciliacion", () => {
    const prediction = createPrediction<Paddle, PaddleInput>({ y: 0 }, { step, dt: DT });
    for (let i = 0; i < 5; i++) prediction.predict({ dir: 1 });

    prediction.reconcile({ y: 50 }, 2);

    expect(prediction.pending.map((entry) => entry.sequence)).toEqual([3, 4, 5]);
    expect(prediction.predicted).toEqual(replayInputs({ y: 50 }, inputsUp(3, 3), step, DT));
    expect(prediction.resimulations).toBe(1);
  });

  it("un ack repetido no vuelve a mover nada", () => {
    const prediction = createPrediction<Paddle, PaddleInput>({ y: 0 }, { step, dt: DT });
    prediction.predict({ dir: 1 });
    prediction.predict({ dir: 1 });

    const authoritative = replayInputs({ y: 0 }, inputsUp(2), step, DT);
    prediction.reconcile(authoritative, 2);
    const once = prediction.predicted;
    prediction.reconcile(authoritative, 2);

    expect(prediction.predicted).toEqual(once);
  });

  it("reset tira lo pendiente: una partida nueva no arrastra la anterior", () => {
    const prediction = createPrediction<Paddle, PaddleInput>({ y: 0 }, { step, dt: DT });
    prediction.predict({ dir: 1 });
    prediction.reset({ y: 360 });

    expect(prediction.pending).toHaveLength(0);
    expect(prediction.lastSequence).toBe(0);
    expect(prediction.predicted).toEqual({ y: 360 });
  });
});

describe("determinismo del paso fijo", () => {
  it("mil pasos partidos en dos dan lo mismo que mil de corrido", () => {
    // Sin esto, host y cliente terminan en estados distintos y no hay
    // reconciliacion que alcance.
    // Entrada que serpentea: si el estado se saturara contra el borde, el
    // test pasaria sin probar nada.
    const dirs: PaddleInput["dir"][] = [1, 1, -1, 0, 1, -1, -1, 0];
    const inputs: PendingInput<PaddleInput>[] = Array.from({ length: 1000 }, (_, i) => ({
      sequence: i + 1,
      input: { dir: dirs[i % dirs.length] ?? 0 },
    }));
    const whole = replayInputs({ y: 360 }, inputs, step, DT);
    const half = replayInputs({ y: 360 }, inputs.slice(0, 400), step, DT);
    const split = replayInputs(half, inputs.slice(400), step, DT);

    // Si hubiera quedado pegada a un borde, el recorte taparia cualquier deriva.
    expect(whole.y).not.toBe(0);
    expect(whole.y).not.toBe(720);

    expect(split).toEqual(whole);
  });
});

describe("secuenciador", () => {
  it("cuenta desde 1 y no repite", () => {
    const sequencer = createSequencer();
    expect([sequencer.next(), sequencer.next(), sequencer.value]).toEqual([1, 2, 2]);
  });
});
