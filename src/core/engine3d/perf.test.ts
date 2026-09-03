import { describe, expect, it } from "vitest";
import { QUALITY_RUNGS, createPerfGuard, qualityAt, type PerfGuard } from "./perf";

/**
 * El guardia es lo que hace cierta la regla del contrato: si no se llega, se
 * baja calidad y no framerate. Dos cosas tienen que ser verdad siempre: que
 * el orden de los escalones sea el pactado, y que no oscile. Un guardia que
 * prende y apaga el postproceso cada dos segundos es peor que no tenerlo.
 */

/** Alimenta una ventana entera de 2 s a los fps pedidos. */
function feedWindow(guard: PerfGuard, fps: number, seconds = 2.05): ReturnType<PerfGuard["sample"]> {
  const delta = 1 / fps;
  const frames = Math.ceil(seconds / delta);
  let last: ReturnType<PerfGuard["sample"]> = null;
  for (let i = 0; i < frames; i++) {
    const changed = guard.sample(delta);
    if (changed) last = changed;
  }
  return last;
}

describe("qualityAt", () => {
  it("cada escalon incluye a los anteriores", () => {
    const rungs = [0, 1, 2, 3, 4, 5].map((r) => qualityAt(r, true));
    expect(rungs.map((q) => q.postprocessing)).toEqual([true, false, false, false, false, false]);
    expect(rungs.map((q) => q.particleScale)).toEqual([1, 1, 0.5, 0.5, 0.5, 0.5]);
    expect(rungs.map((q) => q.lodBias)).toEqual([1, 1, 1, 1.6, 1.6, 1.6]);
    expect(rungs.map((q) => q.resolutionScale)).toEqual([1, 1, 1, 1, 0.8, 0.8]);
    expect(rungs.map((q) => q.shadows)).toEqual([true, true, true, true, true, false]);
  });

  it("si el juego arranca sin sombras, ningun escalon las enciende", () => {
    for (let r = 0; r <= QUALITY_RUNGS; r++) expect(qualityAt(r, false).shadows).toBe(false);
  });
});

describe("createPerfGuard", () => {
  it("con fps de sobra no toca nada", () => {
    const guard = createPerfGuard();
    for (let i = 0; i < 10; i++) expect(feedWindow(guard, 60)).toBeNull();
    expect(guard.rung).toBe(0);
    expect(guard.quality.postprocessing).toBe(true);
  });

  it("baja de a un escalon por ventana y en el orden del contrato", () => {
    const guard = createPerfGuard({ shadows: true });

    const first = feedWindow(guard, 30);
    expect(guard.rung).toBe(1);
    expect(first?.postprocessing).toBe(false);
    expect(first?.particleScale).toBe(1);

    feedWindow(guard, 30);
    expect(guard.rung).toBe(2);
    expect(guard.quality.particleScale).toBe(0.5);
    expect(guard.quality.lodBias).toBe(1);

    feedWindow(guard, 30);
    expect(guard.rung).toBe(3);
    expect(guard.quality.lodBias).toBe(1.6);
    expect(guard.quality.resolutionScale).toBe(1);

    feedWindow(guard, 30);
    expect(guard.rung).toBe(4);
    expect(guard.quality.resolutionScale).toBe(0.8);
    expect(guard.quality.shadows).toBe(true);

    feedWindow(guard, 30);
    expect(guard.rung).toBe(5);
    expect(guard.quality.shadows).toBe(false);
  });

  it("no baja mas alla del ultimo escalon", () => {
    const guard = createPerfGuard();
    for (let i = 0; i < 20; i++) feedWindow(guard, 20);
    expect(guard.rung).toBe(QUALITY_RUNGS);
    expect(feedWindow(guard, 20)).toBeNull();
  });

  it("no oscila: recuperar fps no vuelve a subir la calidad", () => {
    const guard = createPerfGuard();
    feedWindow(guard, 30);
    expect(guard.rung).toBe(1);

    // Justamente porque bajo la calidad ahora sobran fps. Volver a subirla
    // seria volver a hundirlos: el parpadeo clasico.
    for (let i = 0; i < 20; i++) expect(feedWindow(guard, 120)).toBeNull();
    expect(guard.rung).toBe(1);
  });

  it("alternar ventanas buenas y malas baja como mucho una por ventana mala", () => {
    const guard = createPerfGuard();
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      feedWindow(guard, i % 2 === 0 ? 30 : 120);
      seen.push(guard.rung);
    }
    expect(seen).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("no baja antes de que la ventana se cierre", () => {
    const guard = createPerfGuard();
    const delta = 1 / 30;
    for (let i = 0; i < 30; i++) expect(guard.sample(delta)).toBeNull();
    expect(guard.rung).toBe(0);
  });

  it("un tiron de carga no cuenta como bajo rendimiento", () => {
    const guard = createPerfGuard();
    // Un cuadro de tres segundos: una pestania que volvio, no un juego lento.
    for (let i = 0; i < 10; i++) guard.sample(3);
    expect(guard.rung).toBe(0);
  });

  it("una ventana con pocos cuadros se descarta", () => {
    const guard = createPerfGuard();
    // Cuatro cuadros de medio segundo llenan los 2 s con 8 fps de promedio,
    // pero no dicen nada: es la pestania volviendo.
    for (let i = 0; i < 5; i++) guard.sample(0.24);
    expect(guard.rung).toBe(0);
  });

  it("el piso por defecto sale del objetivo: 60 pide 45", () => {
    const guard = createPerfGuard({ target: 60 });
    feedWindow(guard, 50);
    expect(guard.rung).toBe(0);
    feedWindow(guard, 40);
    expect(guard.rung).toBe(1);
  });

  it("maxRung frena la escalera donde diga el juego", () => {
    const guard = createPerfGuard({ maxRung: 2 });
    for (let i = 0; i < 10; i++) feedWindow(guard, 20);
    expect(guard.rung).toBe(2);
    expect(guard.quality.resolutionScale).toBe(1);
  });

  it("reset vuelve al escalon 0", () => {
    const guard = createPerfGuard();
    feedWindow(guard, 20);
    feedWindow(guard, 20);
    expect(guard.rung).toBe(2);
    const quality = guard.reset();
    expect(quality.rung).toBe(0);
    expect(guard.quality.postprocessing).toBe(true);
  });
});
