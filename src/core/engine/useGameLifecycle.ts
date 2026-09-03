import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameOutcome } from "@/core/contract/game";
import { createSfx, type Sfx } from "./audio";
import { prefersReducedMotion } from "./palette";

/**
 * El ciclo de vida de una partida, sin canvas y sin loop.
 *
 * Vivia adentro de `useGame2D`, que ademas arma canvas, input y loop de paso
 * fijo. Un juego 3D no puede usar nada de eso —React Three Fiber trae su
 * propio canvas y su propio loop— pero necesita exactamente lo mismo:
 * maquina de fases, cuenta regresiva, force-end por `AbortSignal`, HUD
 * sincronizado, mute y reinicio.
 *
 * Reimplementarlo del lado 3D garantizaba que las dos copias se separaran, y
 * lo que se separa en una maquina de estados no se nota hasta que un juego
 * emite dos resultados o ninguno. Asi que la maquina vive aca, una sola vez,
 * y `useGame2D` la consume igual que la base 3D.
 *
 * Lo que este hook NO hace, a proposito: no dibuja, no lee input y no corre
 * un loop. El duenio del loop es quien lo llama.
 */

export type GamePhase = "intro" | "countdown" | "playing" | "paused" | "over";

export type PartialOutcome = {
  points: number;
  completed: boolean;
  meta?: Record<string, unknown>;
};

/** Segundos de cuenta regresiva cuando el juego no dice otra cosa. */
export const DEFAULT_COUNTDOWN = 3;

/* ------------------------------------------------------------------ */
/* Reloj de fases: logica pura, testeable sin React ni GPU             */
/* ------------------------------------------------------------------ */

export type PhaseClock = {
  /**
   * ms simulados en fase "playing". Es el unico reloj que puntua.
   *
   * Ojo con la tentacion de usar el `elapsedMs` del loop: ese cuenta tambien
   * la cuenta regresiva y la pausa, asi que infla el bono por tiempo.
   */
  playedMs: number;
  /** ms simulados dentro de la cuenta regresiva. */
  countdownMs: number;
  /** Ultimo segundo publicado al HUD. -1 = ninguno todavia. */
  lastCountdown: number;
};

export function createPhaseClock(): PhaseClock {
  return { playedMs: 0, countdownMs: 0, lastCountdown: -1 };
}

export function resetPhaseClock(clock: PhaseClock): void {
  clock.playedMs = 0;
  clock.countdownMs = 0;
  clock.lastCountdown = -1;
}

export type CountdownTick = {
  /**
   * Segundo a publicar, o null si es el mismo de antes.
   *
   * Sin este filtro son 60 setState por segundo para pintar el mismo numero.
   */
  publish: number | null;
  /** true cuando la cuenta llego a cero y hay que pasar a "playing". */
  done: boolean;
};

/**
 * Un paso de la cuenta regresiva. Muta el reloj y dice que publicar.
 *
 * El reloj se limpia al terminar para que la sesion siguiente arranque desde
 * cero sin que el llamador tenga que acordarse.
 */
export function stepCountdown(clock: PhaseClock, dt: number, totalS: number): CountdownTick {
  const total = totalS * 1000;
  clock.countdownMs += dt * 1000;
  const left = Math.max(0, Math.ceil((total - clock.countdownMs) / 1000));
  const publish = left !== clock.lastCountdown ? left : null;
  if (publish !== null) clock.lastCountdown = left;
  const done = clock.countdownMs >= total;
  if (done) {
    clock.countdownMs = 0;
    clock.lastCountdown = -1;
  }
  return { publish, done };
}

/* ------------------------------------------------------------------ */
/* El hook                                                             */
/* ------------------------------------------------------------------ */

/**
 * Quien avanza la cuenta regresiva.
 *
 * - `"external"`: la avanza el loop del juego llamando `tick(dt)`. Es lo que
 *   hace la base 2D: la cuenta consume tiempo *simulado*, el mismo reloj que
 *   la fisica, asi que dos maquinas con la misma semilla arrancan juntas.
 * - `"internal"`: la avanza el hook con su propio rAF mientras dura la fase.
 *   Es lo que necesita la base 3D: ahi el loop es de R3F y vive adentro del
 *   `<Canvas>`, fuera del alcance del componente que tiene el ciclo de vida.
 *
 * En los dos casos la cuenta la lleva `stepCountdown`, escrita una sola vez.
 * Lo unico que cambia es de donde sale el `dt`.
 */
export type CountdownDriver = "external" | "internal";

export type GameLifecycleOptions<H extends Record<string, unknown>> = {
  /** Valores iniciales del HUD. Se releen al empezar cada sesion. */
  hud: H;
  /** null = partida sin limite de tiempo. */
  durationMs: number | null;
  /** Segundos de cuenta regresiva antes de jugar. 0 la saltea. */
  countdown?: number;
  countdownDriver?: CountdownDriver;
  signal: AbortSignal;
  onFinish: (outcome: GameOutcome) => void;
  /**
   * Cierra el resultado con el estado del juego.
   *
   * Devolver `null` significa "todavia no hay runtime": pasa si el force-end
   * llega entre el render y el efecto de montaje. En ese caso no se emite
   * nada y la partida no queda marcada como terminada.
   */
  outcome: (completed: boolean, playedMs: number) => PartialOutcome | null;
};

export type GameLifecycle<H extends Record<string, unknown>> = {
  phase: GamePhase;
  /** Numero de la cuenta regresiva, 0 cuando no corre. */
  countdownLeft: number;
  hud: H;
  /** ms restantes, o null si la partida no tiene limite. */
  timeLeftMs: number | null;
  fps: number;
  muted: boolean;
  /** Sube en cada reinicio. El consumidor la usa como llave de remontaje. */
  generation: number;
  sfx: Sfx;
  reducedMotion: boolean;

  setHud: (patch: Partial<H>) => void;
  toggleMuted: () => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  /** Termina la partida ahora. Idempotente. */
  finish: (completed: boolean) => void;

  /** La fase sin pasar por React: el loop no puede esperar un render. */
  readPhase: () => GamePhase;
  /** ms jugados, sin contar cuenta regresiva ni pausa. */
  readPlayedMs: () => number;
  /** Arranca una sesion: reloj a cero, HUD original y fase inicial. */
  beginSession: () => void;
  /**
   * Un paso del reloj de fases.
   *
   * `simulate` corre unicamente en "playing" y recibe los ms jugados ya
   * acumulados. Devuelve si en este paso hubo simulacion.
   */
  tick: (dt: number, simulate?: (elapsedMs: number) => void) => boolean;
  /** El fps que mide el duenio del loop. Se muestrea cada 250 ms. */
  reportFps: (value: number) => void;
};

export function useGameLifecycle<H extends Record<string, unknown>>(
  options: GameLifecycleOptions<H>,
): GameLifecycle<H> {
  const [phase, setPhaseState] = useState<GamePhase>("intro");
  const [countdownLeft, setCountdownLeft] = useState(0);
  const [hud, setHudState] = useState<H>(options.hud);
  const [timeLeftMs, setTimeLeftMs] = useState<number | null>(options.durationMs);
  const [fps, setFps] = useState(60);
  const [muted, setMuted] = useState(true);
  const [generation, setGeneration] = useState(0);

  // Todo lo que lee el loop vive en refs: depender de un render de React es
  // perder el cuadro.
  const phaseRef = useRef<GamePhase>("intro");
  const clockRef = useRef<PhaseClock>(createPhaseClock());
  const finishedRef = useRef(false);
  const hudRef = useRef<H>(options.hud);
  const fpsRef = useRef(60);
  const generationRef = useRef(0);
  const optionsRef = useRef(options);

  optionsRef.current = options;
  generationRef.current = generation;

  /*
   * El sintetizador se crea una vez por hook y NO por sesion: reiniciar no
   * tiene por que tirar el AudioContext. Se libera al desmontar, que es lo
   * que antes no pasaba y dejaba un AudioContext abierto por juego montado.
   */
  const sfxRef = useRef<Sfx | null>(null);
  if (sfxRef.current === null) sfxRef.current = createSfx(true);
  const sfx = sfxRef.current;

  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  const setPhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  /** Empuja al HUD solo lo que cambio: el loop corre a 60 fps, React no. */
  const setHud = useCallback((patch: Partial<H>) => {
    let changed = false;
    for (const key of Object.keys(patch) as Array<keyof H>) {
      if (!Object.is(hudRef.current[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    hudRef.current = { ...hudRef.current, ...patch };
    setHudState(hudRef.current);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      sfxRef.current?.setMuted(!prev);
      return !prev;
    });
  }, []);

  const start = useCallback(() => {
    const countdown = optionsRef.current.countdown ?? DEFAULT_COUNTDOWN;
    if (countdown > 0) {
      setCountdownLeft(countdown);
      setPhase("countdown");
    } else {
      setPhase("playing");
    }
  }, [setPhase]);

  const pause = useCallback(() => {
    if (phaseRef.current === "playing") setPhase("paused");
  }, [setPhase]);

  const resume = useCallback(() => {
    if (phaseRef.current === "paused") setPhase("playing");
  }, [setPhase]);

  // Sin guardas: reiniciar despues de perder es justamente el caso principal.
  const restart = useCallback(() => {
    setGeneration((g) => g + 1);
  }, []);

  /**
   * `forced` distingue el force-end del final normal.
   *
   * No alcanza con pasar `completed: false`: hay juegos cuyo `outcome`
   * devuelve `completed: true` igual (Rompeladrillos lo hace si ya habias
   * ganado). El contrato dice que un force-end reporta `completed: false`,
   * asi que la bandera pisa lo que diga el juego.
   */
  const finishInternal = useCallback(
    (completed: boolean, forced: boolean) => {
      if (finishedRef.current) return;
      const opts = optionsRef.current;
      const playedMs = clockRef.current.playedMs;
      const partial = opts.outcome(completed, playedMs);
      if (partial === null) return;
      finishedRef.current = true;
      setPhase("over");
      opts.onFinish({
        completed: forced ? false : partial.completed,
        points: Math.max(0, Math.round(partial.points)),
        durationMs: Math.round(playedMs),
        ...(partial.meta ? { meta: partial.meta } : {}),
      });
    },
    [setPhase],
  );

  const finish = useCallback((completed: boolean) => finishInternal(completed, false), [finishInternal]);

  const advanceCountdown = useCallback(
    (dt: number) => {
      const total = optionsRef.current.countdown ?? DEFAULT_COUNTDOWN;
      const result = stepCountdown(clockRef.current, dt, total);
      if (result.publish !== null) setCountdownLeft(result.publish);
      if (result.done) setPhase("playing");
    },
    [setPhase],
  );

  const tick = useCallback(
    (dt: number, simulate?: (elapsedMs: number) => void): boolean => {
      const opts = optionsRef.current;
      const clock = clockRef.current;
      const current = phaseRef.current;

      if (current === "countdown") {
        // Con driver interno el rAF del hook ya la avanza: hacerlo tambien
        // aca la correria al doble de velocidad.
        if ((opts.countdownDriver ?? "external") === "external") advanceCountdown(dt);
        return false;
      }

      if (current !== "playing") return false;

      clock.playedMs += dt * 1000;
      simulate?.(clock.playedMs);

      if (opts.durationMs !== null && clock.playedMs >= opts.durationMs) {
        finishInternal(true, false);
      }
      return true;
    },
    [advanceCountdown, finishInternal],
  );

  const beginSession = useCallback(() => {
    const opts = optionsRef.current;
    resetPhaseClock(clockRef.current);
    finishedRef.current = false;
    hudRef.current = opts.hud;
    setHudState(opts.hud);
    setTimeLeftMs(opts.durationMs);

    // Al remontar hay que devolver la maquina de estados al principio, o la
    // partida nueva arranca mostrando el resultado de la anterior. La primera
    // vez se entra por la pantalla de instrucciones; al reiniciar no, porque
    // el jugador ya las leyo y volver a pedirle un click sobra.
    const countdown = opts.countdown ?? DEFAULT_COUNTDOWN;
    if (generationRef.current === 0 || countdown === 0) {
      setPhase(generationRef.current === 0 ? "intro" : "playing");
    } else {
      setCountdownLeft(countdown);
      setPhase("countdown");
    }
  }, [setPhase]);

  const readPhase = useCallback(() => phaseRef.current, []);
  const readPlayedMs = useCallback(() => clockRef.current.playedMs, []);
  const reportFps = useCallback((value: number) => {
    fpsRef.current = value;
  }, []);

  /* --------------------------------------------------------------- */
  /* Cuenta regresiva por rAF, solo con driver interno                 */
  /* --------------------------------------------------------------- */
  const driver = options.countdownDriver ?? "external";
  useEffect(() => {
    if (driver !== "internal" || phase !== "countdown") return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // Mismo tope que el loop 2D: volver de una pestana oculta no puede
      // comerse la cuenta entera en un cuadro.
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      advanceCountdown(dt);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [driver, phase, advanceCountdown]);

  /* --------------------------------------------------------------- */
  /* Force-end: el caso que siempre se rompe y nadie prueba            */
  /* --------------------------------------------------------------- */
  const signal = options.signal;
  useEffect(() => {
    /*
     * Si ya venia abortado, se emite igual y no se espera un evento que nunca
     * va a llegar. Hoy la shell reemplaza el AbortController antes de montar,
     * asi que no pasa, pero un contenedor que no lo haga dejaria la partida
     * sin emitir nada: un juego que termina en silencio es peor que uno que
     * termina mal.
     */
    if (signal.aborted) {
      finishInternal(false, true);
      return;
    }
    const onAbort = () => finishInternal(false, true);
    signal.addEventListener("abort", onAbort);
    return () => signal.removeEventListener("abort", onAbort);
  }, [signal, finishInternal]);

  /* Pausa automatica al ocultar la pestana: nadie pierde por atender un mail. */
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && phaseRef.current === "playing") setPhase("paused");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [setPhase]);

  /* Escape y P: pausa universal, en todos los juegos. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape" && e.code !== "KeyP") return;
      if (phaseRef.current === "playing") setPhase("paused");
      else if (phaseRef.current === "paused") setPhase("playing");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPhase]);

  /* El HUD de tiempo y fps se refresca 4 veces por segundo, no 60. */
  useEffect(() => {
    const sampler = window.setInterval(() => {
      setFps(Math.round(fpsRef.current));
      const duration = optionsRef.current.durationMs;
      if (duration !== null) {
        setTimeLeftMs(Math.max(0, duration - clockRef.current.playedMs));
      }
    }, 250);
    return () => window.clearInterval(sampler);
  }, []);

  /* El AudioContext se cierra al desmontar. Una pestana no aguanta muchos. */
  useEffect(() => {
    return () => {
      sfxRef.current?.dispose();
    };
  }, []);

  return {
    phase,
    countdownLeft,
    hud,
    timeLeftMs,
    fps,
    muted,
    generation,
    sfx,
    reducedMotion,
    setHud,
    toggleMuted,
    start,
    pause,
    resume,
    restart,
    finish,
    readPhase,
    readPlayedMs,
    beginSession,
    tick,
    reportFps,
  };
}
