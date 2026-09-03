/**
 * Loop con timestep fijo y render interpolado.
 *
 * `update` recibe SIEMPRE el mismo dt. Es lo que hace la simulacion
 * determinista: con la misma semilla y las mismas entradas, dos maquinas
 * llegan al mismo estado. Con delta variable eso no pasa nunca.
 */

export type GameLoop = {
  start(): void;
  stop(): void;
  readonly running: boolean;
  /** ms de simulacion acumulados. Es el reloj del juego, no el del reloj de pared. */
  readonly elapsedMs: number;
  /** Promedio movil de fps, para el panel de metricas. */
  readonly fps: number;
};

/** Tope de tiempo procesado por frame: sin esto, volver de una pestana oculta dispara la espiral de la muerte. */
const MAX_FRAME_S = 0.25;

export type LoopOptions = {
  /** Paso de simulacion en segundos. 1/60 por defecto; los rapidos piden 1/120. */
  step?: number;
  /** Se pausa solo cuando la pestana se oculta. */
  pauseWhenHidden?: boolean;
};

export function createLoop(
  update: (dt: number) => void,
  render: (alpha: number) => void,
  options: LoopOptions = {},
): GameLoop {
  const step = options.step ?? 1 / 60;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;

  let acc = 0;
  let last = 0;
  let raf = 0;
  let running = false;
  let elapsedMs = 0;
  let fps = 60;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);

    const rawElapsed = (now - last) / 1000;
    last = now;
    const elapsed = Math.min(rawElapsed, MAX_FRAME_S);

    // Suavizado exponencial: el numero del HUD no tiene que temblar.
    if (rawElapsed > 0) fps += (1 / rawElapsed - fps) * 0.08;

    acc += elapsed;
    while (acc >= step) {
      update(step);
      elapsedMs += step * 1000;
      acc -= step;
    }

    render(acc / step);
  }

  function onVisibility() {
    if (!running) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else {
      // Reset de `last`: el tiempo que estuvo oculta no se simula.
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
      if (pauseWhenHidden) document.addEventListener("visibilitychange", onVisibility);
    },
    stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      if (pauseWhenHidden) document.removeEventListener("visibilitychange", onVisibility);
    },
    get running() {
      return running;
    },
    get elapsedMs() {
      return elapsedMs;
    },
    get fps() {
      return fps;
    },
  };
}
