import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * El control de un juego en primera persona, en el propio telefono.
 *
 * Dos pulgares: el izquierdo mueve, el derecho mira. Y los dos botones que
 * hacen falta —disparar y saltar— a la derecha, donde el pulgar ya esta.
 *
 * Tres decisiones que vienen de la guia del shooter y no del gusto:
 *
 * - **El stick aparece donde cae el pulgar**, no en un lugar fijo. Un stick
 *   dibujado en una esquina es comodo en un telefono y esta fuera de alcance
 *   en el siguiente; uno que nace bajo el dedo esta bien en todos.
 * - **La mirada es por arrastre**, no por inclinacion. Inclinar se ve bien en
 *   un video y es impreciso en la mano.
 * - **Sin estado de React por cuadro.** Todo lo que el juego lee vive en un
 *   objeto mutable (`SticksState`) que el loop consulta cuando quiere. Un
 *   `setState` por evento de puntero seria un render por cada milimetro.
 *
 * En escritorio el mismo componente atiende teclado y raton: WASD o flechas
 * para moverse, el raton con bloqueo de puntero para mirar, click para
 * disparar y espacio para saltar. El juego no distingue de donde vino nada.
 *
 * Se monta en la capa `overlay` del escenario, ENTRE el canvas y el HUD: asi
 * cubre la pantalla entera sin tapar los botones del HUD, que quedan arriba.
 */

/** El estado vive en `sticks.ts`: este archivo exporta solo el componente. */
import type { SticksState } from "./sticks";
export type { SticksState };

export type TouchSticksProps = {
  state: SticksState;
  /** false apaga todo: no se dibuja nada y no se escucha nada. */
  enabled: boolean;
  showFire?: boolean;
  showJump?: boolean;
  /** Etiquetas de los botones. */
  fireLabel?: string;
  jumpLabel?: string;
  /** Radio del stick en px. Mas chico es mas sensible. */
  radius?: number;
};

/** Radio por defecto del recorrido del stick, en px. */
const DEFAULT_RADIUS = 56;

type MovePointer = { id: number; originX: number; originY: number };
type LookPointer = { id: number; lastX: number; lastY: number };

const KEY_AXIS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export function TouchSticks({
  state,
  enabled,
  showFire = true,
  showJump = true,
  fireLabel = "Disparar",
  jumpLabel = "Saltar",
  radius = DEFAULT_RADIUS,
}: TouchSticksProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);

  const moveRef = useRef<MovePointer | null>(null);
  const lookRef = useRef<LookPointer | null>(null);
  const keysRef = useRef<Set<string>>(new Set());

  /* ---------------------------------------------------------------- */
  /* Tacto                                                              */
  /* ---------------------------------------------------------------- */

  const showStick = (x: number, y: number) => {
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!base || !knob) return;
    base.style.transform = `translate(${x - radius}px, ${y - radius}px)`;
    base.style.opacity = "1";
    knob.style.transform = "translate(0px, 0px)";
  };

  const moveKnob = (dx: number, dy: number) => {
    const knob = knobRef.current;
    if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const hideStick = () => {
    const base = baseRef.current;
    if (base) base.style.opacity = "0";
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    // El raton va por el bloqueo de puntero, no por los sticks: atenderlo aca
    // tambien seria mover el stick con el cursor mientras se mira con el.
    if (event.pointerType === "mouse") return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    surface.setPointerCapture(event.pointerId);
    state.touching = true;

    if (localX < rect.width / 2) {
      if (moveRef.current) return;
      moveRef.current = { id: event.pointerId, originX: localX, originY: localY };
      showStick(localX, localY);
      return;
    }
    if (lookRef.current) return;
    lookRef.current = { id: event.pointerId, lastX: event.clientX, lastY: event.clientY };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType === "mouse") return;
    const move = moveRef.current;
    if (move && move.id === event.pointerId) {
      const surface = surfaceRef.current;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      let dx = event.clientX - rect.left - move.originX;
      let dy = event.clientY - rect.top - move.originY;
      const length = Math.hypot(dx, dy);
      if (length > radius) {
        dx = (dx / length) * radius;
        dy = (dy / length) * radius;
      }
      state.mx = dx / radius;
      state.my = -dy / radius;
      moveKnob(dx, dy);
      return;
    }
    const look = lookRef.current;
    if (look && look.id === event.pointerId) {
      state.lookX += event.clientX - look.lastX;
      state.lookY += event.clientY - look.lastY;
      look.lastX = event.clientX;
      look.lastY = event.clientY;
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    const move = moveRef.current;
    if (move && move.id === event.pointerId) {
      moveRef.current = null;
      state.mx = 0;
      state.my = 0;
      hideStick();
    }
    const look = lookRef.current;
    if (look && look.id === event.pointerId) lookRef.current = null;
    state.touching = moveRef.current !== null || lookRef.current !== null;
  };

  /* ---------------------------------------------------------------- */
  /* Teclado y raton                                                    */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!enabled) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const keys = keysRef.current;

    const recompute = () => {
      let x = 0;
      let y = 0;
      for (const code of keys) {
        const axis = KEY_AXIS[code];
        if (axis) {
          x += axis[0];
          y += axis[1];
        }
      }
      // Solo si nadie esta tocando: el pulgar manda sobre el teclado.
      if (moveRef.current === null) {
        state.mx = Math.max(-1, Math.min(1, x));
        state.my = Math.max(-1, Math.min(1, y));
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code in KEY_AXIS || event.code === "Space") event.preventDefault();
      if (event.code === "Space") {
        state.jump = true;
        return;
      }
      keys.add(event.code);
      recompute();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
      recompute();
    };
    const onBlur = () => {
      keys.clear();
      recompute();
      state.fire = false;
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (document.pointerLockElement !== surface) {
        // Puede fallar por politica del navegador. No es un error del juego.
        surface.requestPointerLock?.();
        return;
      }
      state.fire = true;
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0) state.fire = false;
    };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== surface) return;
      state.lookX += event.movementX;
      state.lookY += event.movementY;
    };
    const onLockChange = () => {
      state.locked = document.pointerLockElement === surface;
      if (!state.locked) state.fire = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    surface.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onLockChange);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      surface.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      keys.clear();
      state.mx = 0;
      state.my = 0;
      state.fire = false;
      state.jump = false;
      state.touching = false;
      if (document.pointerLockElement === surface) document.exitPointerLock();
    };
  }, [enabled, state]);

  if (!enabled) return null;

  const stickSize = radius * 2;

  return (
    <div
      ref={surfaceRef}
      className="absolute inset-0 select-none"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* El stick: nace bajo el pulgar y desaparece al soltar. */}
      <div
        ref={baseRef}
        className="pointer-events-none absolute left-0 top-0 rounded-full border border-sn-cyan-300/60 bg-sn-bg/40 opacity-0 backdrop-blur-sm transition-opacity duration-100"
        style={{ width: stickSize, height: stickSize }}
        aria-hidden="true"
      >
        <div
          ref={knobRef}
          className="absolute rounded-full bg-sn-cyan-400 shadow-[0_0_18px_var(--sn-cyan-400)]"
          style={{
            width: radius * 0.9,
            height: radius * 0.9,
            left: radius - radius * 0.45,
            top: radius - radius * 0.45,
          }}
        />
      </div>

      {(showFire || showJump) && (
        <div
          className="absolute bottom-5 right-5 flex items-end gap-3"
          style={{ touchAction: "none" }}
        >
          {showJump && (
            <button
              type="button"
              data-game-ui
              aria-label={jumpLabel}
              className="grid size-16 place-items-center rounded-full border border-sn-line bg-sn-bg/60 text-[11px] font-medium text-sn-muted backdrop-blur-sm active:bg-sn-panel-hi"
              style={{ touchAction: "none" }}
              onPointerDown={(event) => {
                event.preventDefault();
                state.jump = true;
              }}
            >
              {jumpLabel}
            </button>
          )}
          {showFire && (
            <button
              type="button"
              data-game-ui
              aria-label={fireLabel}
              className="grid size-24 place-items-center rounded-full border-2 border-sn-magenta-400 bg-sn-magenta-500/30 text-xs font-semibold text-sn-text shadow-[0_0_28px_-4px_var(--sn-magenta-400)] backdrop-blur-sm active:bg-sn-magenta-500/60"
              style={{ touchAction: "none" }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                state.fire = true;
              }}
              onPointerUp={() => {
                state.fire = false;
              }}
              onPointerCancel={() => {
                state.fire = false;
              }}
            >
              {fireLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
