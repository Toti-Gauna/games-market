import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

/**
 * Timestep fijo adentro de `useFrame`.
 *
 * Mismo principio y mismos numeros que `loop.ts` de la base 2D, y por la
 * misma razon: la simulacion recibe SIEMPRE el mismo `dt`. Con delta variable
 * dos maquinas con la misma semilla y las mismas entradas nunca llegan al
 * mismo estado, y sin eso las topologias `arena` no pueden sincronizar nada.
 *
 * El detalle que se paga caro si se pasa por alto: **Rapier tambien se
 * configura con este paso**. `<Physics timeStep={FIXED_STEP}>`, no el delta
 * del cuadro. Un solver con delta variable da resultados distintos en cada
 * maquina aunque el codigo del juego sea determinista.
 *
 * Como se conecta con el ciclo de vida, que es lo que no hay que reinventar:
 *
 *     // En el componente del juego, AFUERA del <Canvas>.
 *     const life = useGameLifecycle<Hud>({
 *       hud, durationMs, countdown: 3,
 *       // R3F corre su loop adentro del <Canvas>, donde no llega este
 *       // componente: la cuenta regresiva la maneja el hook.
 *       countdownDriver: "internal",
 *       signal, onFinish, outcome,
 *     });
 *
 *     // En un componente ADENTRO del <Canvas>.
 *     useFixedStep(
 *       (dt) => life.tick(dt, (elapsedMs) => simulate(dt, elapsedMs)),
 *       { enabled: life.phase === "playing" },
 *     );
 */

/** El mismo 1/60 de la base 2D. */
export const FIXED_STEP = 1 / 60;

/**
 * Tope de tiempo procesado por cuadro.
 *
 * Sin esto, volver de una pestania oculta con dos minutos acumulados dispara
 * la espiral de la muerte: el loop intenta simular 7200 pasos, tarda mas que
 * un cuadro, acumula mas tiempo y no sale nunca.
 */
export const MAX_FRAME_S = 0.25;

/** Lo que hay que pasarle a `<Physics>` de @react-three/rapier. */
export const FIXED_PHYSICS = { timeStep: FIXED_STEP } as const;

/* ------------------------------------------------------------------ */
/* Acumulador: logica pura, testeable sin GPU                          */
/* ------------------------------------------------------------------ */

export type StepAccumulator = {
  /** Tiempo sobrante, siempre menor que un paso. */
  acc: number;
};

export function createStepAccumulator(): StepAccumulator {
  return { acc: 0 };
}

/**
 * Cuantos pasos hay que correr en este cuadro.
 *
 * El resto queda en el acumulador y se cobra en el cuadro siguiente: es lo
 * que hace que a 144 Hz o a 50 Hz la simulacion avance a la misma velocidad
 * sin acumular deriva.
 */
export function drainSteps(
  accumulator: StepAccumulator,
  frameDelta: number,
  step: number = FIXED_STEP,
  maxFrame: number = MAX_FRAME_S,
): number {
  // Un delta negativo o NaN llega cuando el reloj del navegador salta hacia
  // atras. Se descarta en vez de envenenar el acumulador.
  if (!(frameDelta > 0)) return 0;
  accumulator.acc += Math.min(frameDelta, maxFrame);
  let steps = 0;
  while (accumulator.acc >= step) {
    accumulator.acc -= step;
    steps++;
  }
  return steps;
}

/** El sobrante en 0..1, para interpolar el render entre dos pasos. */
export function stepAlpha(accumulator: StepAccumulator, step: number = FIXED_STEP): number {
  return accumulator.acc / step;
}

/* ------------------------------------------------------------------ */
/* El hook                                                             */
/* ------------------------------------------------------------------ */

export type FixedStepOptions = {
  /** Paso de simulacion. 1/60 por defecto; los rapidos piden 1/120. */
  step?: number;
  /**
   * Con `false` no simula y ademas suelta lo acumulado.
   *
   * Es lo que hay que usar en pausa, en la cuenta regresiva y al terminar: si
   * el acumulador siguiera creciendo, al volver de una pausa de diez segundos
   * el juego correria seiscientos pasos de golpe.
   */
  enabled?: boolean;
  /** Prioridad de `useFrame`. Negativa corre antes; positiva, despues. */
  priority?: number;
};

/**
 * Corre `update(dt)` con paso fijo.
 *
 * Se llama desde un componente que este ADENTRO del `<Canvas>`: `useFrame`
 * necesita el contexto de R3F.
 *
 * `update` se guarda en una ref para que el callback no dependa de que R3F
 * vuelva a registrarlo, y no se asigna nada por cuadro.
 */
export function useFixedStep(update: (dt: number) => void, options: FixedStepOptions = {}): void {
  const step = options.step ?? FIXED_STEP;
  const enabled = options.enabled ?? true;

  const updateRef = useRef(update);
  const accumulatorRef = useRef<StepAccumulator>(createStepAccumulator());

  updateRef.current = update;

  useFrame((_, delta) => {
    const accumulator = accumulatorRef.current;
    if (!enabled) {
      accumulator.acc = 0;
      return;
    }
    const steps = drainSteps(accumulator, delta, step);
    for (let i = 0; i < steps; i++) updateRef.current(step);
  }, options.priority ?? 0);
}
