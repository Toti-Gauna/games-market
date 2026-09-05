import type { ReactNode, RefObject } from "react";
import { useFullscreen } from "./useFullscreen";
import type { GamePhase } from "@/core/engine/useGame2D";

/**
 * El escenario compartido: canvas + HUD + los cuatro estados que un juego no
 * puede no tener (antes de jugar, jugando, pausa, fin).
 *
 * El HUD va en DOM encima del canvas, nunca dibujado adentro: se lee mejor, lo
 * anuncia un lector de pantalla, se estila con CSS y no consume frames.
 */

export type GameStageProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  /** El canvas de la base 2D. Sobra cuando el juego trae `surface` propia. */
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  /**
   * Superficie propia, en lugar del `<canvas>` de la base 2D.
   *
   * Existe por los juegos 3D: React Three Fiber crea su canvas adentro de
   * `<Canvas>` y no acepta uno de afuera. En vez de duplicar aca el HUD, los
   * cuatro estados y la cuenta regresiva —dos copias de una maquina de
   * estados que se separan sin que nadie se entere—, el escenario deja que le
   * cambien la superficie y todo lo demas sigue siendo el mismo.
   *
   * Ocupa el contenedor entero: el encuadre lo resuelve la superficie.
   */
  surface?: ReactNode;
  phase: GamePhase;
  countdownLeft: number;
  /** Una linea. "Desliza para girar", no un tutorial de tres pantallas. */
  instructions: string;
  /** Barra superior: score, vidas, reloj. Una sola cosa dominante. */
  hud?: ReactNode;
  /** Lo que se muestra al terminar. */
  summary?: ReactNode;
  /**
   * Slot en la pantalla de instrucciones, arriba del boton de jugar.
   * Es para lo que hay que pedir ANTES de empezar y depende del juego: el
   * permiso de giroscopio, elegir dificultad. El escenario no sabe que es
   * ninguna de esas cosas, solo les hace lugar.
   */
  introExtra?: ReactNode;
  /**
   * Una capa de DOM ENTRE la superficie y el HUD, que cubre el contenedor.
   *
   * Es para lo que tiene que estar encima del canvas y abajo de los botones:
   * los sticks tactiles de un juego en primera persona, una mira, un
   * indicador de dano. No puede ir en `hud` —eso es una barra arriba que no
   * recibe clicks— y no puede ir adentro de la superficie, que en 3D es un
   * `<Canvas>` donde no entra DOM.
   */
  overlay?: ReactNode;
  /**
   * La pantalla de arranque deja ver la superficie en vez de taparla.
   *
   * El velo con desenfoque del intro existe para que el texto se lea sobre
   * cualquier juego, y para casi todos esta bien: atras no hay nada que
   * mirar todavia. Un juego que arranca mostrando algo —un personaje que se
   * elige, un escenario que presenta— necesita lo contrario: el panel se
   * corre a un costado, se pone su propio fondo, y el velo desaparece.
   * Solo aplica al intro; la pausa y el resumen siguen tapando.
   */
  introShowcase?: boolean;
  muted: boolean;
  onToggleMuted: () => void;
  onStart: () => void;
  onResume: () => void;
  onPause: () => void;
  onRestart: () => void;
  /** Proporcion del mundo del juego, para reservar el espacio correcto. */
  aspect: number;
  /** Solo en el banco de pruebas (`config.debug`). Nunca en produccion. */
  fps?: number;
};

export function GameStage({
  containerRef,
  canvasRef,
  surface,
  phase,
  countdownLeft,
  instructions,
  hud,
  summary,
  introExtra,
  overlay,
  introShowcase = false,
  muted,
  onToggleMuted,
  onStart,
  onResume,
  onPause,
  onRestart,
  aspect,
  fps,
}: GameStageProps) {
  const fullscreen = useFullscreen(containerRef);
  const showOverlay = phase !== "playing";

  return (
    <div className="flex h-full w-full flex-col">
      <div
        ref={containerRef}
        className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden rounded-sn-lg border border-sn-line-soft bg-sn-bg"
        /*
         * En pantalla completa se suelta la proporcion: con `aspectRatio`
         * puesto, el contenedor se queda del tamano que pedia el juego y
         * sobra pantalla negra alrededor. El encuadre lo resuelve igual la
         * superficie, que ya escala a lo que le den.
         */
        style={fullscreen.active ? undefined : { aspectRatio: aspect }}
      >
        {surface ? (
          <div className="absolute inset-0">{surface}</div>
        ) : (
          <canvas ref={canvasRef} className="block" />
        )}

        {/* La capa del juego: encima del canvas, debajo del HUD. Solo mientras
            se juega, para que no tape la pantalla de instrucciones. */}
        {overlay !== undefined && phase === "playing" && (
          <div className="absolute inset-0">{overlay}</div>
        )}

        {/* HUD: no se come los clicks del juego. */}
        <div
          data-game-ui
          className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center gap-2">{hud}</div>
          <div className="pointer-events-auto flex items-center gap-1.5">
            {fps !== undefined && (
              <span
                className="sn-chip"
                style={{ color: fps < 50 ? "var(--sn-warn)" : "var(--sn-text-dim)" }}
                title="Cuadros por segundo"
              >
                <span className="sn-num">{fps}</span> fps
              </span>
            )}
            <button
              type="button"
              className="sn-btn sn-btn--ghost h-7 px-2 text-xs"
              onClick={onToggleMuted}
              aria-pressed={!muted}
              title={muted ? "Activar sonido" : "Silenciar"}
            >
              {muted ? "Sonido apagado" : "Sonido"}
            </button>
            {fullscreen.supported && (
              <button
                type="button"
                className="sn-btn sn-btn--ghost h-7 px-2 text-xs"
                onClick={fullscreen.toggle}
                aria-pressed={fullscreen.active}
                title={fullscreen.active ? "Salir de pantalla completa" : "Pantalla completa"}
              >
                {fullscreen.active ? "Salir" : "Pantalla completa"}
              </button>
            )}
            {phase === "playing" && (
              <button type="button" className="sn-btn sn-btn--ghost h-7 px-2 text-xs" onClick={onPause}>
                Pausa
              </button>
            )}
          </div>
        </div>

        {phase === "countdown" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span
              key={countdownLeft}
              className="sn-num text-7xl font-bold text-sn-cyan"
              style={{ textShadow: "0 0 32px var(--sn-cyan-400)" }}
            >
              {countdownLeft > 0 ? countdownLeft : "Ya"}
            </span>
          </div>
        )}

        {showOverlay && phase !== "countdown" && (
          <div
            data-game-ui
            className={
              introShowcase && phase === "intro"
                ? // A un costado y sin velo: atras hay algo que mirar.
                  "absolute inset-0 grid items-end justify-center p-3 sm:items-center sm:justify-end sm:p-6"
                : "absolute inset-0 grid place-items-center bg-sn-bg/78 backdrop-blur-sm"
            }
          >
            <div
              className={
                introShowcase && phase === "intro"
                  ? "w-full max-w-sm rounded-xl border border-sn-line bg-sn-panel/92 px-6 py-5 text-center shadow-lg backdrop-blur-sm"
                  : "w-full max-w-sm px-6 text-center"
              }
            >
              {phase === "intro" && (
                <>
                  <p className="mb-5 text-sm text-sn-muted">{instructions}</p>
                  {introExtra && <div className="mb-3">{introExtra}</div>}
                  <button type="button" className="sn-btn sn-btn--primary h-10 w-full text-sm" onClick={onStart} autoFocus>
                    Jugar
                  </button>
                </>
              )}

              {phase === "paused" && (
                <>
                  <h3 className="mb-1 text-lg">En pausa</h3>
                  <p className="mb-5 text-xs text-sn-dim">Escape o P para seguir.</p>
                  <div className="flex gap-2">
                    <button type="button" className="sn-btn sn-btn--primary h-10 flex-1" onClick={onResume} autoFocus>
                      Seguir
                    </button>
                    <button type="button" className="sn-btn h-10" onClick={onRestart}>
                      Reiniciar
                    </button>
                  </div>
                </>
              )}

              {phase === "over" && (
                <>
                  {summary}
                  {/* Reintentar es la accion principal y va donde ya esta el pulgar. */}
                  <button type="button" className="sn-btn sn-btn--primary mt-5 h-10 w-full text-sm" onClick={onRestart} autoFocus>
                    Jugar de nuevo
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Casillero del HUD. Numeros tabulares para que el score no tiemble. */
export function HudStat({
  label,
  value,
  tone = "default",
  dominant = false,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "cyan" | "magenta" | "warn" | "danger";
  dominant?: boolean;
}) {
  const toneColor = {
    default: "var(--sn-text)",
    cyan: "var(--sn-cyan-400)",
    magenta: "var(--sn-magenta-400)",
    warn: "var(--sn-warn)",
    danger: "var(--sn-danger)",
  }[tone];

  return (
    <div className="rounded-sn border border-sn-line-soft bg-sn-bg/70 px-2.5 py-1 backdrop-blur-sm">
      <div className="text-[10px] uppercase leading-tight tracking-wider text-sn-dim">{label}</div>
      <div
        className={`sn-num leading-tight ${dominant ? "text-xl font-semibold" : "text-sm"}`}
        style={{ color: toneColor }}
      >
        {value}
      </div>
    </div>
  );
}
