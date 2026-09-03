/**
 * Canvas: escalado, DPR y conversion de coordenadas.
 *
 * El juego dibuja siempre en coordenadas de diseno (por ejemplo 960x640) y no
 * se entera del tamano real. Sin esto, cada juego reimplementa la misma cuenta
 * y alguno la hace mal.
 *
 * Hay dos variantes porque **un canvas no puede tener contexto 2D y WebGL a la
 * vez**: `setupCanvas` crea el contexto 2D, y `setupCanvasSurface` deja el
 * canvas crudo para que lo tome Pixi o WebGL. El encuadre, el DPR y `toWorld`
 * son los mismos en los dos casos.
 */

type BaseView = {
  readonly width: number;
  readonly height: number;
  /** Pasa un punto de la pantalla a coordenadas del mundo del juego. */
  toWorld(clientX: number, clientY: number): { x: number; y: number };
  dispose(): void;
};

export type CanvasView = BaseView & {
  ctx: CanvasRenderingContext2D;
};

/** Igual que `CanvasView` pero sin contexto: el motor de render lo pone el juego. */
export type CanvasSurface = BaseView & {
  canvas: HTMLCanvasElement;
  /** Pixeles reales del buffer, que es lo que necesita un renderer propio. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
};

export type CanvasOptions = {
  designWidth: number;
  designHeight: number;
  /** 2 en proyector, 1.5 en celular. Renderizar a 3x es la forma mas rapida de perder frames. */
  maxDpr?: number;
};

function isCoarsePointer(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/**
 * Lo comun a las dos variantes: encuadre con letterbox, DPR topeado, resize
 * observado y `toWorld`. `onLayout` recibe la escala y el DPR ya resueltos.
 */
function createFrame(
  canvas: HTMLCanvasElement,
  options: CanvasOptions,
  onLayout?: (scale: number, dpr: number) => void,
) {
  const { designWidth, designHeight } = options;
  const maxDpr = options.maxDpr ?? (isCoarsePointer() ? 1.5 : 2);

  let scale = 1;

  function layout() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

    // Letterbox: se conserva el aspecto del mundo, con bandas si hace falta.
    scale = Math.min(rect.width / designWidth, rect.height / designHeight);
    const cssW = designWidth * scale;
    const cssH = designHeight * scale;

    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    onLayout?.(scale, dpr);
  }

  let frame = 0;
  const observer = new ResizeObserver(() => {
    // Debounce por rAF: el ResizeObserver dispara en rafagas al arrastrar.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  });
  if (canvas.parentElement) observer.observe(canvas.parentElement);
  layout();

  const base: BaseView = {
    get width() {
      return designWidth;
    },
    get height() {
      return designHeight;
    },
    toWorld(clientX, clientY) {
      // La posicion se mide en el momento, no se cachea: el canvas se mueve
      // por scroll, por abrir el cajon del sidebar o por cualquier reflow que
      // no cambie su tamano, y el ResizeObserver no se entera de ninguno.
      // Solo corre en eventos de puntero, no por frame, asi que el reflow que
      // fuerza es barato.
      const box = canvas.getBoundingClientRect();
      return { x: (clientX - box.left) / scale, y: (clientY - box.top) / scale };
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
    },
  };

  return { base, relayout: layout };
}

export function setupCanvas(canvas: HTMLCanvasElement, options: CanvasOptions): CanvasView {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("No se pudo crear el contexto 2D");

  const { base } = createFrame(canvas, options, (scale, dpr) => {
    // Una sola transform: el juego dibuja en unidades de diseno.
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
  });

  return { ...base, ctx };
}

/**
 * El mismo encuadre, sin contexto 2D.
 *
 * Lo usan los juegos que traen su propio renderer —Pixi para el corredor, un
 * shader para el Mode 7 de las carreras—, porque pedir un contexto 2D sobre
 * este canvas dejaria a WebGL sin poder tomarlo.
 */
export function setupCanvasSurface(
  canvas: HTMLCanvasElement,
  options: CanvasOptions,
): CanvasSurface {
  const { base } = createFrame(canvas, options);
  return {
    ...base,
    canvas,
    get pixelWidth() {
      return canvas.width;
    },
    get pixelHeight() {
      return canvas.height;
    },
  };
}
