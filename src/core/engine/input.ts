/**
 * Input: una sola API para teclado, toque, deslizamiento e inclinacion.
 *
 * El gameplay lee intenciones (axis, swipe, pointer), nunca eventos del
 * navegador. Es lo que permite sumar el celular como control despues sin
 * tocar una linea de la logica del juego.
 */

export type SwipeDirection = "up" | "down" | "left" | "right";

export type Swipe = {
  dx: number;
  dy: number;
  dir: SwipeDirection;
  /** px por segundo */
  speed: number;
};

/**
 * Un dedo. `startX`/`startY` es donde toco, que es lo que necesita cualquier
 * gesto anclado: una palanca analogica se dibuja donde cayo el pulgar, no en
 * un lugar fijo de la pantalla.
 */
export type PointerInfo = {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  down: boolean;
  justPressed: boolean;
  justReleased: boolean;
};

export type InputState = {
  /** El primer dedo. Es lo que alcanza para casi todos los juegos. */
  pointer: { x: number; y: number; down: boolean; justPressed: boolean; justReleased: boolean };
  /**
   * Todos los dedos a la vez.
   *
   * Existe porque `pointer` solo no alcanza: correr con el pulgar izquierdo y
   * patear con el derecho al mismo tiempo es imposible con un unico puntero, y
   * es lo que pide cualquier juego de accion en un telefono.
   */
  pointers: readonly PointerInfo[];
  /** Vive un solo frame. Leelo en update y no lo guardes. */
  swipe: Swipe | null;
  /** null mientras no haya permiso de giroscopio. */
  tilt: { beta: number; gamma: number } | null;
  keys: ReadonlySet<string>;
  /** -1..1 derivado de flechas/WASD. */
  axis: { x: number; y: number };
};

export type InputController = {
  readonly state: InputState;
  /** Limpia los flags de un frame. El loop la llama despues de cada update. */
  endFrame(): void;
  /** iOS exige gesto del usuario. Devuelve si quedo habilitado. */
  requestTilt(): Promise<boolean>;
  dispose(): void;
};

export type InputOptions = {
  /** Distancia minima en px para que cuente como deslizar. */
  swipeThreshold?: number;
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
};

const ARROW_TO_AXIS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
};

type TiltPermissionApi = { requestPermission?: () => Promise<string> };

export function createInput(target: HTMLElement, options: InputOptions): InputController {
  const threshold = options.swipeThreshold ?? 24;
  const keys = new Set<string>();

  /**
   * Los dedos vivos. Se reusan los objetos: el loop lee esto por cuadro y no
   * puede asignar.
   */
  const pointers: PointerInfo[] = [];

  const state: InputState = {
    pointer: { x: 0, y: 0, down: false, justPressed: false, justReleased: false },
    pointers,
    swipe: null,
    tilt: null,
    keys,
    axis: { x: 0, y: 0 },
  };

  let startX = 0;
  let startY = 0;
  let startT = 0;
  /** El dedo que gobierna `state.pointer` y el deslizamiento. */
  let primaryPointer: number | null = null;
  let tiltAttached = false;

  function findPointer(id: number): PointerInfo | undefined {
    for (const pointer of pointers) if (pointer.id === id) return pointer;
    return undefined;
  }

  function recomputeAxis() {
    let x = 0;
    let y = 0;
    for (const code of keys) {
      const dir = ARROW_TO_AXIS[code];
      if (dir) {
        x += dir[0];
        y += dir[1];
      }
    }
    state.axis.x = Math.max(-1, Math.min(1, x));
    state.axis.y = Math.max(-1, Math.min(1, y));
  }

  const onPointerDown = (e: PointerEvent) => {
    // Apretar un boton del HUD o de un overlay NO es input de juego.
    //
    // Importa mas de lo que parece: abajo capturamos el puntero sobre el
    // contenedor, y el contenedor es el mismo elemento que contiene esos
    // botones. Sin esta guarda, la captura redirige el `pointerup` al
    // contenedor, el boton nunca recibe su `click` y la interfaz queda muerta
    // — que es exactamente como se ve un juego que no arranca al tocar "Jugar".
    if (e.target instanceof Element && e.target.closest("[data-game-ui]")) return;

    target.setPointerCapture?.(e.pointerId);
    const p = options.toWorld(e.clientX, e.clientY);

    // Cada dedo entra a la lista. Antes se ignoraba todo lo que no fuera el
    // primero, asi que correr con un pulgar y patear con el otro al mismo
    // tiempo era imposible.
    pointers.push({
      id: e.pointerId,
      x: p.x,
      y: p.y,
      startX: p.x,
      startY: p.y,
      down: true,
      justPressed: true,
      justReleased: false,
    });

    // El primero gobierna `state.pointer` y el deslizamiento, para que los
    // juegos que solo miran un dedo sigan funcionando igual que siempre.
    if (primaryPointer === null) {
      primaryPointer = e.pointerId;
      state.pointer.x = p.x;
      state.pointer.y = p.y;
      state.pointer.down = true;
      state.pointer.justPressed = true;
      startX = e.clientX;
      startY = e.clientY;
      startT = performance.now();
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = options.toWorld(e.clientX, e.clientY);
    const pointer = findPointer(e.pointerId);
    if (pointer) {
      pointer.x = p.x;
      pointer.y = p.y;
    }
    if (primaryPointer === null || primaryPointer === e.pointerId) {
      state.pointer.x = p.x;
      state.pointer.y = p.y;
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const pointer = findPointer(e.pointerId);
    if (pointer) {
      pointer.down = false;
      pointer.justReleased = true;
    }
    // Un dedo que no es el primero se suelta y ya: no genera deslizamiento ni
    // toca `state.pointer`.
    if (primaryPointer !== e.pointerId) return;
    primaryPointer = null;
    state.pointer.down = false;
    state.pointer.justReleased = true;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dist = Math.hypot(dx, dy);
    if (dist >= threshold) {
      const seconds = Math.max(0.016, (performance.now() - startT) / 1000);
      state.swipe = {
        dx,
        dy,
        dir: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up",
        speed: dist / seconds,
      };
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    keys.add(e.code);
    // El scroll con flechas o barra espaciadora arruina cualquier juego.
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    recomputeAxis();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
    recomputeAxis();
  };

  // Alt+Tab deja teclas trabadas si no se limpian al perder el foco.
  const onBlur = () => {
    keys.clear();
    recomputeAxis();
    state.pointer.down = false;
    // Soltar todos: un dedo que quedo marcado apretado al perder el foco deja
    // al personaje corriendo solo para siempre.
    pointers.length = 0;
    primaryPointer = null;
  };

  const onOrientation = (e: DeviceOrientationEvent) => {
    state.tilt = { beta: e.beta ?? 0, gamma: e.gamma ?? 0 };
  };

  const onContextMenu = (e: Event) => e.preventDefault();

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerUp);
  target.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    state,
    endFrame() {
      state.pointer.justPressed = false;
      state.pointer.justReleased = false;
      state.swipe = null;
      // Los dedos sueltos se van recien ahora: asi el juego alcanza a ver su
      // `justReleased` en el cuadro en que paso, y no un cuadro tarde.
      for (let i = pointers.length - 1; i >= 0; i--) {
        const pointer = pointers[i];
        if (!pointer) continue;
        pointer.justPressed = false;
        if (pointer.justReleased) pointers.splice(i, 1);
      }
    },
    async requestTilt() {
      if (tiltAttached) return true;
      if (typeof DeviceOrientationEvent === "undefined") return false;
      const api = DeviceOrientationEvent as unknown as TiltPermissionApi;
      if (typeof api.requestPermission === "function") {
        try {
          const result = await api.requestPermission();
          if (result !== "granted") return false;
        } catch {
          return false;
        }
      }
      window.addEventListener("deviceorientation", onOrientation);
      tiltAttached = true;
      return true;
    },
    dispose() {
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);
      target.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (tiltAttached) window.removeEventListener("deviceorientation", onOrientation);
    },
  };
}
