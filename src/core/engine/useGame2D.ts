import { useCallback, useEffect, useRef } from "react";
import type { GameOutcome, GameRuntimeConfig } from "@/core/contract/game";
import { setupCanvas, setupCanvasSurface, type CanvasSurface, type CanvasView } from "./canvas";
import { createInput, type InputController, type InputState } from "./input";
import { createLoop, type GameLoop } from "./loop";
import { createRng, type Rng } from "./rng";
import { readPalette, type Palette } from "./palette";
import type { Sfx } from "./audio";
import { useGameLifecycle } from "./useGameLifecycle";
import type { GamePhase, PartialOutcome } from "./useGameLifecycle";

/**
 * El hook que arma un juego 2D entero.
 *
 * Resuelve una sola vez lo que si no resuelve cada juego a su manera: canvas,
 * DPR, loop de paso fijo, input, PRNG sembrado, maquina de estados, cuenta
 * regresiva, limite de tiempo, force-end y limpieza.
 *
 * Un juego nuevo deberia ser init + update + draw + outcome, y nada mas.
 *
 * La mitad que NO es 2D —fases, cuenta regresiva, force-end, HUD, mute,
 * reinicio— vive en `useGameLifecycle`, porque la base 3D necesita
 * exactamente eso y no puede usar ni este canvas ni este loop. Aca queda lo
 * que si es propio del 2D: superficie, input y paso fijo.
 */

export type { GamePhase, PartialOutcome };

/**
 * `TView` es `CanvasView` (con contexto 2D) o `CanvasSurface` (canvas crudo,
 * para un juego que trae su propio renderer). El default deja intacto a todo
 * lo que ya estaba escrito.
 */
export type BaseContext<TView = CanvasView> = {
  input: InputState;
  rng: Rng;
  palette: Palette;
  view: TView;
  sfx: Sfx;
  reducedMotion: boolean;
  /** ms simulados desde que arranco la partida. */
  elapsedMs: number;
};

export type FrameContext<H extends Record<string, unknown>, TView = CanvasView> = BaseContext<TView> & {
  /** Termina la partida ahora. Idempotente. */
  finish: (completed: boolean) => void;
  /** Publica al HUD. Solo dispara un render de React si algo cambio. */
  setHud: (patch: Partial<H>) => void;
};

export type DrawContext<TView = CanvasView> = BaseContext<TView> & {
  /** 0..1 entre el ultimo paso simulado y el siguiente. Interpolar con esto. */
  alpha: number;
};

export type Game2DDefinition<
  S,
  H extends Record<string, unknown>,
  TView = CanvasView,
  TTarget = CanvasRenderingContext2D,
> = {
  design: { width: number; height: number };
  /**
   * `"2d"` (default) crea el contexto 2D y `draw` lo recibe. `"raw"` deja el
   * canvas crudo para un renderer propio —Pixi, un shader— y `draw` recibe el
   * elemento. Un canvas NO puede tener los dos contextos, asi que la eleccion
   * es exclusiva y va aca.
   */
  surface?: "2d" | "raw";
  /** Paso de simulacion. 1/60 por defecto; los rapidos piden 1/120. */
  step?: number;
  maxDpr?: number;
  swipeThreshold?: number;
  /** Segundos de cuenta regresiva antes de jugar. 0 la saltea. */
  countdown?: number;
  hud: H;
  init: (ctx: Omit<BaseContext<TView>, "elapsedMs">) => S;
  update: (state: S, dt: number, ctx: FrameContext<H, TView>) => void;
  draw: (state: S, target: TTarget, ctx: DrawContext<TView>) => void;
  /** Se consulta al terminar por cualquier via, incluido force-end. */
  outcome: (state: S, completed: boolean, survivedMs: number) => PartialOutcome;
};

export type Game2DApi<H> = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  phase: GamePhase;
  /** Numero de la cuenta regresiva, 0 cuando no corre. */
  countdownLeft: number;
  hud: H;
  /** ms restantes, o null si la partida no tiene limite. */
  timeLeftMs: number | null;
  fps: number;
  muted: boolean;
  toggleMuted: () => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  requestTilt: () => Promise<boolean>;
};

type Runtime<S> = {
  view: CanvasView | CanvasSurface;
  input: InputController;
  loop: GameLoop;
  state: S;
};

export function useGame2D<
  S,
  H extends Record<string, unknown>,
  TView = CanvasView,
  TTarget = CanvasRenderingContext2D,
>(
  definition: Game2DDefinition<S, H, TView, TTarget>,
  config: GameRuntimeConfig,
  signal: AbortSignal,
  onFinish: (outcome: GameOutcome) => void,
): Game2DApi<H> & { setHud: (patch: Partial<H>) => void } {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const runtimeRef = useRef<Runtime<S> | null>(null);
  const defRef = useRef(definition);
  const onFinishRef = useRef(onFinish);

  defRef.current = definition;
  onFinishRef.current = onFinish;

  /*
   * El ciclo de vida entero delegado. El puente es `outcome`: el hook de
   * fases no conoce el estado del juego, asi que lo pide cuando hace falta y
   * lo resuelve este lado, que si lo tiene.
   */
  const lifecycle = useGameLifecycle<H>({
    hud: definition.hud,
    durationMs: config.durationMs,
    ...(definition.countdown !== undefined ? { countdown: definition.countdown } : {}),
    signal,
    onFinish: (outcome) => onFinishRef.current(outcome),
    outcome: (completed, playedMs) => {
      const runtime = runtimeRef.current;
      // Force-end antes de que exista el runtime: no hay nada que reportar.
      if (!runtime) return null;
      return defRef.current.outcome(runtime.state, completed, playedMs);
    },
  });

  const {
    generation,
    reducedMotion,
    sfx,
    setHud,
    finish,
    tick,
    beginSession,
    readPlayedMs,
    reportFps,
  } = lifecycle;

  const requestTilt = useCallback(async () => {
    return (await runtimeRef.current?.input.requestTilt()) ?? false;
  }, []);

  /* --------------------------------------------------------------- */
  /* Montaje: canvas + input + loop                                    */
  /* --------------------------------------------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const def = defRef.current;
    const canvasOptions = {
      designWidth: def.design.width,
      designHeight: def.design.height,
      ...(def.maxDpr !== undefined ? { maxDpr: def.maxDpr } : {}),
    };
    // Exclusivo: pedir el contexto 2D dejaria a WebGL sin poder tomar el canvas.
    const view =
      def.surface === "raw" ? setupCanvasSurface(canvas, canvasOptions) : setupCanvas(canvas, canvasOptions);
    const drawTarget = (
      def.surface === "raw" ? (view as CanvasSurface).canvas : (view as CanvasView).ctx
    ) as TTarget;
    const input = createInput(container, {
      toWorld: view.toWorld,
      ...(def.swipeThreshold !== undefined ? { swipeThreshold: def.swipeThreshold } : {}),
    });
    /*
     * La semilla NO incluye la generacion, a proposito: reiniciar reproduce
     * la misma partida.
     *
     * Suena raro para un juego `solo` -uno esperaria variedad al reintentar-
     * pero es lo correcto para el catalogo: en Match-3 y en Corredor todos
     * tienen que jugar el mismo tablero y la misma pista, y en un `arena` dos
     * clientes que reinician en momentos distintos divergirian. Quien quiera
     * una partida nueva cambia la semilla desde el banco de pruebas, que es
     * justamente para eso.
     */
    const rng = createRng(config.seed);
    const palette = readPalette();

    /*
     * El unico punto donde el tipo se afirma en vez de deducirse: en tiempo de
     * ejecucion `view` es `CanvasView` o `CanvasSurface` segun `surface`, y es
     * el juego el que declara cual espera al instanciar el hook. Queda aca, en
     * una linea, en vez de repartido por diez juegos.
     */
    const baseCtx = { input: input.state, rng, palette, view, sfx, reducedMotion } as unknown as Omit<
      BaseContext<TView>,
      "elapsedMs"
    >;
    const state = def.init(baseCtx);

    // El runtime tiene que estar antes de arrancar la sesion: un force-end
    // que llegue en el mismo tick necesita poder resolver el outcome.
    const frameCtx: FrameContext<H, TView> = { ...baseCtx, elapsedMs: 0, finish, setHud };
    const drawCtx: DrawContext<TView> = { ...baseCtx, elapsedMs: 0, alpha: 0 };

    const loop = createLoop(
      (dt) => {
        tick(dt, (elapsedMs) => {
          frameCtx.elapsedMs = elapsedMs;
          def.update(state, dt, frameCtx);
        });
        input.endFrame();
      },
      (alpha) => {
        reportFps(loop.fps);
        drawCtx.alpha = alpha;
        drawCtx.elapsedMs = readPlayedMs();
        def.draw(state, drawTarget, drawCtx);
      },
      // Sin esto, un juego que declara `step: 1/120` recibia 1/60 en silencio:
      // la opcion existia en el tipo y no llegaba al loop.
      def.step !== undefined ? { step: def.step } : {},
    );

    runtimeRef.current = { view, input, loop, state };
    beginSession();
    loop.start();

    return () => {
      loop.stop();
      input.dispose();
      view.dispose();
      runtimeRef.current = null;
    };
    // `generation` fuerza el remontaje completo al reiniciar.
  }, [
    config.seed,
    config.durationMs,
    generation,
    reducedMotion,
    sfx,
    setHud,
    finish,
    tick,
    beginSession,
    readPlayedMs,
    reportFps,
  ]);

  return {
    containerRef,
    canvasRef,
    phase: lifecycle.phase,
    countdownLeft: lifecycle.countdownLeft,
    hud: lifecycle.hud,
    timeLeftMs: lifecycle.timeLeftMs,
    fps: lifecycle.fps,
    muted: lifecycle.muted,
    toggleMuted: lifecycle.toggleMuted,
    start: lifecycle.start,
    pause: lifecycle.pause,
    resume: lifecycle.resume,
    restart: lifecycle.restart,
    requestTilt,
    setHud,
  };
}
