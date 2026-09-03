import { describe, expect, it } from "vitest";
import { createPhaseClock, resetPhaseClock, stepCountdown } from "./useGameLifecycle";

/**
 * El reloj de fases es lo unico que la base 2D y la base 3D comparten de
 * verdad, y encima con dos fuentes de `dt` distintas: el paso fijo del loop
 * 2D y el rAF del hook cuando el loop es de R3F. Si la cuenta regresiva se
 * porta distinto segun quien la empuje, los dos mundos se desincronizan.
 */

describe("stepCountdown", () => {
  it("publica cada segundo una sola vez", () => {
    const clock = createPhaseClock();
    const published: number[] = [];
    let done = false;
    // 3 segundos a 60 pasos por segundo. Van 200 vueltas y no 180 porque el
    // acumulado en coma flotante queda un pelo por debajo de los 3000 ms: la
    // cuenta termina en el paso 181, no en el 180.
    for (let i = 0; i < 200 && !done; i++) {
      const tick = stepCountdown(clock, 1 / 60, 3);
      if (tick.publish !== null) published.push(tick.publish);
      done = tick.done;
    }
    expect(published).toEqual([3, 2, 1, 0]);
    expect(done).toBe(true);
  });

  it("no publica el mismo numero dos veces seguidas", () => {
    const clock = createPhaseClock();
    let repeats = 0;
    let previous: number | null = null;
    for (let i = 0; i < 180; i++) {
      const tick = stepCountdown(clock, 1 / 60, 3);
      if (tick.publish !== null) {
        if (tick.publish === previous) repeats++;
        previous = tick.publish;
      }
      if (tick.done) break;
    }
    expect(repeats).toBe(0);
  });

  it("da el mismo resultado empujada por rAF que por paso fijo", () => {
    // Paso fijo de 1/60, como el loop 2D.
    const fixed = createPhaseClock();
    const fixedPublished: number[] = [];
    for (let i = 0; i < 200; i++) {
      const tick = stepCountdown(fixed, 1 / 60, 3);
      if (tick.publish !== null) fixedPublished.push(tick.publish);
      if (tick.done) break;
    }

    // Deltas irregulares, como los de un rAF real.
    const variable = createPhaseClock();
    const variablePublished: number[] = [];
    const deltas = [0.016, 0.021, 0.013, 0.017, 0.019, 0.011];
    for (let i = 0; i < 400; i++) {
      const tick = stepCountdown(variable, deltas[i % deltas.length] ?? 0.016, 3);
      if (tick.publish !== null) variablePublished.push(tick.publish);
      if (tick.done) break;
    }

    expect(variablePublished).toEqual(fixedPublished);
  });

  it("se limpia sola al terminar para que la sesion siguiente arranque en cero", () => {
    const clock = createPhaseClock();
    let done = false;
    while (!done) done = stepCountdown(clock, 1 / 60, 3).done;
    expect(clock.countdownMs).toBe(0);
    expect(clock.lastCountdown).toBe(-1);
  });

  it("una cuenta de 1 segundo publica 1 y 0", () => {
    const clock = createPhaseClock();
    const published: number[] = [];
    let done = false;
    while (!done) {
      const tick = stepCountdown(clock, 1 / 60, 1);
      if (tick.publish !== null) published.push(tick.publish);
      done = tick.done;
    }
    expect(published).toEqual([1, 0]);
  });

  it("un cuadro larguisimo la termina de una y no deja el numero colgado", () => {
    const clock = createPhaseClock();
    const tick = stepCountdown(clock, 10, 3);
    expect(tick.done).toBe(true);
    expect(tick.publish).toBe(0);
  });
});

describe("PhaseClock", () => {
  it("arranca en cero y sin numero publicado", () => {
    expect(createPhaseClock()).toEqual({ playedMs: 0, countdownMs: 0, lastCountdown: -1 });
  });

  it("reset lo devuelve al principio, incluido el tiempo jugado", () => {
    const clock = createPhaseClock();
    clock.playedMs = 12345;
    stepCountdown(clock, 0.5, 3);
    resetPhaseClock(clock);
    expect(clock).toEqual({ playedMs: 0, countdownMs: 0, lastCountdown: -1 });
  });
});
