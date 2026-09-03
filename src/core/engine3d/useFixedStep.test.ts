import { describe, expect, it } from "vitest";
import {
  FIXED_STEP,
  MAX_FRAME_S,
  createStepAccumulator,
  drainSteps,
  stepAlpha,
} from "./useFixedStep";

/**
 * El paso fijo es de lo que depende que la fisica de Rapier sea determinista.
 * Si reparte mal o acumula deriva, dos maquinas con la misma semilla dejan de
 * coincidir y ninguna topologia `arena` puede sincronizar nada.
 */

describe("drainSteps", () => {
  it("un cuadro de exactamente un paso corre un paso", () => {
    const acc = createStepAccumulator();
    expect(drainSteps(acc, FIXED_STEP)).toBe(1);
    expect(acc.acc).toBeCloseTo(0, 10);
  });

  it("a 30 Hz corre dos pasos por cuadro", () => {
    const acc = createStepAccumulator();
    expect(drainSteps(acc, 1 / 30)).toBe(2);
  });

  it("a 144 Hz reparte sin perder ni inventar tiempo", () => {
    const acc = createStepAccumulator();
    const delta = 1 / 144;
    let steps = 0;
    for (let i = 0; i < 1440; i++) steps += drainSteps(acc, delta);
    // 10 segundos reales a 1/60 son 600 pasos. Se tolera el paso en vuelo.
    expect(steps).toBeGreaterThanOrEqual(599);
    expect(steps).toBeLessThanOrEqual(600);
  });

  it("no acumula deriva en diez mil cuadros", () => {
    const acc = createStepAccumulator();
    const delta = 1 / 60;
    let steps = 0;
    for (let i = 0; i < 10000; i++) steps += drainSteps(acc, delta);
    const simulated = steps * FIXED_STEP;
    const real = 10000 * delta;
    // La diferencia no puede crecer con el tiempo: como mucho es el sobrante
    // de un paso, y eso vale igual en el cuadro 10 que en el 10.000.
    expect(Math.abs(simulated - real)).toBeLessThan(FIXED_STEP);
    expect(acc.acc).toBeLessThan(FIXED_STEP);
    expect(acc.acc).toBeGreaterThanOrEqual(0);
  });

  it("el sobrante nunca llega a un paso entero", () => {
    const acc = createStepAccumulator();
    for (let i = 0; i < 500; i++) {
      drainSteps(acc, 0.0071 + (i % 7) * 0.001);
      expect(acc.acc).toBeLessThan(FIXED_STEP);
    }
  });

  it("un cuadro larguisimo se topea y no dispara la espiral de la muerte", () => {
    const acc = createStepAccumulator();
    // Dos minutos con la pestania oculta: sin tope serian 7200 pasos.
    const steps = drainSteps(acc, 120);
    expect(steps).toBe(Math.floor(MAX_FRAME_S / FIXED_STEP));
    expect(steps).toBe(15);
  });

  it("ignora deltas invalidos en vez de envenenar el acumulador", () => {
    const acc = createStepAccumulator();
    expect(drainSteps(acc, 0)).toBe(0);
    expect(drainSteps(acc, -1)).toBe(0);
    expect(drainSteps(acc, Number.NaN)).toBe(0);
    expect(acc.acc).toBe(0);
  });

  it("respeta un paso propio, como el 1/120 de los juegos rapidos", () => {
    const acc = createStepAccumulator();
    expect(drainSteps(acc, 1 / 60, 1 / 120)).toBe(2);
  });

  it("stepAlpha devuelve el sobrante en 0..1", () => {
    const acc = createStepAccumulator();
    drainSteps(acc, FIXED_STEP * 1.5);
    expect(stepAlpha(acc)).toBeCloseTo(0.5, 6);
  });
});
