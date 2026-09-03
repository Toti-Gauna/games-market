/**
 * Prediccion local y reconciliacion.
 *
 * Sin esto, mover el dedo y ver la paleta reaccionar 80 ms despues se siente
 * roto, y no hay arte que lo tape. El cliente aplica su input al instante,
 * lo guarda con su numero de secuencia y sigue jugando; cuando llega el
 * estado autoritativo descarta lo que el host ya proceso y **re-simula** el
 * resto encima.
 *
 * Dos condiciones que no se negocian:
 *
 * - **Solo la entidad propia.** Predecir lo ajeno es adivinar la intencion de
 *   otra persona: se equivoca siempre y produce el teletransporte que todos
 *   conocen. Lo ajeno se interpola (ver `interpolation.ts`).
 * - **`step` puro y determinista, con timestep fijo.** Re-simular N inputs
 *   sobre el estado autoritativo tiene que dar exactamente lo mismo que
 *   simularlos de una: si `step` muta su entrada, usa `Math.random()` o mira
 *   el reloj de pared, la reconciliacion nunca converge. El `dt` fijo lo da la
 *   base 2D (`createLoop`), y por eso las dos piezas encajan.
 */

/** Estado autoritativo todavia sin confirmar nada. */
export const NO_SEQUENCE = 0;

export type PendingInput<TInput> = {
  sequence: number;
  input: TInput;
};

export type PredictionOptions<TState, TInput> = {
  /** LA MISMA funcion que corre el host. Pura: devuelve estado nuevo. */
  step: (state: TState, input: TInput, dt: number) => TState;
  /** Paso fijo en segundos. El mismo del loop del host: 1/60 por defecto. */
  dt?: number;
  /**
   * Tope de inputs sin confirmar. Con mas que esto la conexion ya se corto y
   * guardarlos solo hace crecer la cola sin que nadie la vaya a confirmar.
   */
  maxPending?: number;
};

export type Prediction<TState, TInput> = {
  /** Lo que se dibuja: autoritativo mas lo que el host todavia no confirmo. */
  readonly predicted: TState;
  /** El ultimo estado que mando el host. La verdad. */
  readonly confirmed: TState;
  readonly pending: readonly PendingInput<TInput>[];
  /** Secuencia del ultimo input generado. Es la que se manda con `sendInput`. */
  readonly lastSequence: number;
  /** Cuantas veces hubo que re-simular. Sirve para el HUD de diagnostico. */
  readonly resimulations: number;
  /** Aplica el input ya y lo encola. Devuelve su numero de secuencia. */
  predict(input: TInput): number;
  /** Llego estado autoritativo. Devuelve el estado predicho nuevo. */
  reconcile(state: TState, ackedSequence: number): TState;
  /** Arranque o partida nueva: se tira todo lo pendiente. */
  reset(state: TState): void;
};

export function createPrediction<TState, TInput>(
  initial: TState,
  options: PredictionOptions<TState, TInput>,
): Prediction<TState, TInput> {
  const dt = options.dt ?? 1 / 60;
  const maxPending = options.maxPending ?? 120;
  const step = options.step;

  let confirmed = initial;
  let predicted = initial;
  let pending: PendingInput<TInput>[] = [];
  let sequence = NO_SEQUENCE;
  let resimulations = 0;

  return {
    get predicted() {
      return predicted;
    },
    get confirmed() {
      return confirmed;
    },
    get pending() {
      return pending;
    },
    get lastSequence() {
      return sequence;
    },
    get resimulations() {
      return resimulations;
    },

    predict(input) {
      sequence++;
      predicted = step(predicted, input, dt);
      pending.push({ sequence, input });
      // La cola vieja no se recupera nunca: si el host se fue, guardar mil
      // inputs no lo trae de vuelta.
      if (pending.length > maxPending) pending = pending.slice(pending.length - maxPending);
      return sequence;
    },

    reconcile(state, ackedSequence) {
      confirmed = state;
      pending = pending.filter((entry) => entry.sequence > ackedSequence);
      let next = state;
      for (const entry of pending) next = step(next, entry.input, dt);
      if (pending.length > 0) resimulations++;
      predicted = next;
      return predicted;
    },

    reset(state) {
      confirmed = state;
      predicted = state;
      pending = [];
      sequence = NO_SEQUENCE;
      resimulations = 0;
    },
  };
}

/**
 * Simula una lista de inputs de corrido. Es la referencia contra la que se
 * mide la reconciliacion: re-simular pendientes tiene que dar esto mismo.
 */
export function replayInputs<TState, TInput>(
  state: TState,
  inputs: readonly PendingInput<TInput>[],
  step: (state: TState, input: TInput, dt: number) => TState,
  dt: number,
): TState {
  let next = state;
  for (const entry of inputs) next = step(next, entry.input, dt);
  return next;
}

/**
 * Contador de secuencia del lado del emisor.
 *
 * Va aparte de `Prediction` porque el host tambien lo necesita para los bots,
 * que mandan input igual que una persona.
 */
export function createSequencer(start = NO_SEQUENCE): { next(): number; readonly value: number } {
  let value = start;
  return {
    next() {
      value++;
      return value;
    },
    get value() {
      return value;
    },
  };
}
