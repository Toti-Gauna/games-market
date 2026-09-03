/**
 * El guardia de degradacion.
 *
 * El contrato es explicito: **si no se llega, se baja calidad, no se baja el
 * framerate**. Esto lo implementa, y es lo que permite que el mismo juego
 * corra en el proyector de la sala y en un telefono de gama media sin dos
 * builds ni un menu de opciones que nadie toca.
 *
 * Mide fps promedio en ventanas de 2 s y baja de a un escalon, en este orden:
 *
 *   1. postproceso off
 *   2. densidad de particulas / 2
 *   3. LOD mas agresivo
 *   4. resolucion x 0,8
 *   5. sombras off (si estaban)
 *
 * El orden no es arbitrario: va de lo que menos se nota a lo que mas. El
 * postproceso es un efecto que la mayoria no registra; la resolucion se nota
 * enseguida. Las sombras van ultimas porque, por default, ya estan apagadas y
 * el escalon no hace nada: solo cuenta para el juego que decidio encenderlas.
 *
 * **El guardia no vuelve a subir**, y eso es a proposito. Recuperar calidad
 * significa volver a prender exactamente lo que hizo caer los fps, que hace
 * caer los fps otra vez, que vuelve a apagarlo: el parpadeo clasico de los
 * ajustes dinamicos, y encima cada cambio de calidad recompila shaders y
 * pega un tiron. Preferimos quedarnos abajo. Un `reset()` explicito existe
 * para el banco de pruebas y para cuando el juego cambia de escena.
 *
 * Es logica pura. No sabe de React ni de three: el juego lo alimenta desde su
 * `useFrame` con el delta del cuadro —el real, no el paso fijo— y aplica lo
 * que devuelve.
 */

export type Quality = {
  /** 0 = todo encendido. 5 = el ultimo escalon. */
  rung: number;
  postprocessing: boolean;
  /** Multiplicador de la cantidad de particulas. */
  particleScale: number;
  /** > 1 corta a LOD mas bajo antes. */
  lodBias: number;
  /** Multiplicador del DPR efectivo. */
  resolutionScale: number;
  shadows: boolean;
};

export const QUALITY_RUNGS = 5;

/**
 * El escalon `rung` con las sombras que el juego pidio al arrancar.
 *
 * Cada escalon incluye todos los anteriores: es una escalera, no una lista de
 * opciones sueltas.
 */
export function qualityAt(rung: number, shadowsAtStart: boolean): Quality {
  const clamped = Math.max(0, Math.min(QUALITY_RUNGS, Math.round(rung)));
  return {
    rung: clamped,
    postprocessing: clamped < 1,
    particleScale: clamped < 2 ? 1 : 0.5,
    lodBias: clamped < 3 ? 1 : 1.6,
    resolutionScale: clamped < 4 ? 1 : 0.8,
    shadows: shadowsAtStart && clamped < 5,
  };
}

export type PerfGuardOptions = {
  /** Los fps a los que apunta el juego. 60 salvo excepcion. */
  target?: number;
  /** Por debajo de esto se baja un escalon. Por defecto, 3/4 del objetivo. */
  floor?: number;
  /** Largo de la ventana de medicion. */
  windowMs?: number;
  /**
   * Cuadros minimos para que una ventana valga.
   *
   * Una ventana con cuatro cuadros no dice nada del rendimiento: dice que la
   * pestania estuvo oculta o que hubo un tiron de carga. Bajar calidad por
   * eso es bajarla por nada.
   */
  minSamples?: number;
  /** Si el juego arranca con sombras encendidas. */
  shadows?: boolean;
  /** Hasta que escalon se permite bajar. */
  maxRung?: number;
};

export type PerfGuard = {
  readonly quality: Quality;
  readonly rung: number;
  /** fps de la ultima ventana cerrada. 0 mientras no haya ninguna. */
  readonly lastFps: number;
  /**
   * Un cuadro. Devuelve la calidad nueva si bajo un escalon, y null si no
   * cambio nada, que es el caso normal.
   */
  sample(frameDeltaS: number): Quality | null;
  /** Vuelve al escalon 0. Para el banco de pruebas o un cambio de escena. */
  reset(): Quality;
};

/**
 * Tope de cuadro. Un cuadro de mas de 1/4 de segundo no es "el juego va
 * lento": es un tiron de carga, un GC largo o una pestania que volvio. Si
 * contara, cualquier hipo bajaria la calidad para siempre.
 */
const MAX_FRAME_S = 0.25;

export function createPerfGuard(options: PerfGuardOptions = {}): PerfGuard {
  const target = options.target ?? 60;
  const floor = options.floor ?? target * 0.75;
  const windowS = (options.windowMs ?? 2000) / 1000;
  const minSamples = options.minSamples ?? 30;
  const shadowsAtStart = options.shadows ?? false;
  const maxRung = Math.min(options.maxRung ?? QUALITY_RUNGS, QUALITY_RUNGS);

  let rung = 0;
  let quality = qualityAt(0, shadowsAtStart);
  let windowSeconds = 0;
  let windowFrames = 0;
  let lastFps = 0;

  function closeWindow(): void {
    windowSeconds = 0;
    windowFrames = 0;
  }

  return {
    get quality() {
      return quality;
    },
    get rung() {
      return rung;
    },
    get lastFps() {
      return lastFps;
    },

    sample(frameDeltaS) {
      if (!(frameDeltaS > 0) || frameDeltaS > MAX_FRAME_S) return null;

      windowSeconds += frameDeltaS;
      windowFrames++;
      if (windowSeconds < windowS) return null;

      const fps = windowFrames / windowSeconds;
      const enough = windowFrames >= minSamples;
      closeWindow();
      if (!enough) return null;

      lastFps = fps;
      if (fps >= floor) return null;
      if (rung >= maxRung) return null;

      // Un escalon por ventana. Bajar dos de golpe es exactamente como se
      // termina en la calidad minima por un bache de dos segundos.
      rung++;
      quality = qualityAt(rung, shadowsAtStart);
      return quality;
    },

    reset() {
      rung = 0;
      quality = qualityAt(0, shadowsAtStart);
      lastFps = 0;
      closeWindow();
      return quality;
    },
  };
}
