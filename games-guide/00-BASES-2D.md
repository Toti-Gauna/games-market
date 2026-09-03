# Base 2D · el motor compartido

> Leé `docs/CONTRATO-JUEGOS.md` y `docs/fase-3/README.md` primero.
> **La usan 14 de los 24 juegos.** Sin esto cerrado no se empieza ninguno.

El objetivo: que hacer un juego 2D nuevo sea escribir su lógica, no volver a resolver el loop, el
input, el escalado y el audio.

---

## Qué existe hoy

Un solo juego, `principios-culturales`, y no tiene loop: es DOM + framer-motion, arrastrar y
soltar. No sirve de base para nada que tenga física o movimiento continuo.

```
src/games/
├── gameRegistry.ts
└── principiosCulturales/
    ├── MergeGameBoard.tsx          ← compartido con el juego original
    └── PrincipiosCulturalesGame.tsx ← wrapper del tour, calcula puntos
```

`PrincipiosCulturalesGame.tsx` sí es buen ejemplo de **cómo un juego habla con el tour**: recibe
`GameComponentProps`, calcula sus puntos y llama a `onFinished`. Eso se conserva.

---

## Qué construir

```
src/games/_engine/
├── loop.ts           ← timestep fijo
├── canvas.ts         ← escalado, DPR, resize
├── input.ts          ← touch, teclado, swipe, tilt
├── rng.ts            ← PRNG sembrado
├── pool.ts           ← object pooling
├── audio.ts          ← howler, sprites, silencio por defecto
├── palette.ts        ← tokens del CSS, cacheados
├── camera.ts         ← seguimiento, shake, límites
├── collide.ts        ← AABB, círculo, barrido
├── hud.tsx           ← marcador, reloj, cuenta regresiva
└── useGame2D.ts      ← el hook que arma todo
```

### 1. El loop — `loop.ts`

Timestep fijo con acumulador y render interpolado. Es la pieza que decide si el juego se siente
bien o no.

```ts
export type GameLoop = {
  start(): void;
  stop(): void;
  readonly running: boolean;
};

const MAX_FRAME = 0.25;   // tope: si la pestaña estuvo oculta, no simular 40 pasos de golpe

export function createLoop(
  update: (dt: number) => void,
  render: (alpha: number) => void,
  /** Paso de simulación. Default 1/60; los juegos rápidos piden 1/120. */
  step = 1 / 60,
): GameLoop {
  let acc = 0, last = 0, raf = 0, running = false;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const elapsed = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    acc += elapsed;

    while (acc >= step) {
      update(step);       // SIEMPRE el mismo dt
      acc -= step;
    }

    render(acc / step);   // alpha para interpolar la posición dibujada
  }
  …
}
```

Tres detalles que importan:

- **`update` recibe siempre `step`.** Es lo que hace la simulación determinista y lo que permite
  que dos máquinas lleguen al mismo estado en `arena`.
- **`MAX_FRAME`** evita la espiral de la muerte: si la pestaña volvió tras 10 segundos, sin tope
  el `while` intentaría 600 pasos, tardaría más de un frame y acumularía más deuda.
- **El paso es por juego, no global.** `1/60` sirve para casi todo, pero un Pong con pelota
  acelerada quiere `1/120`: con pasos más largos, entre dos pasos la pelota recorre demasiado y
  el barrido tiene que trabajar de más. Cada juego declara el suyo y **no lo cambia nunca en
  caliente**: en `arena` y `gamepad`, todos los clientes del mismo juego usan el mismo paso o la
  simulación diverge. `MAX_FRAME` a 0,25 s significa 15 pasos a 1/60 y 30 a 1/120, los dos
  manejables.

Se pausa con `document.hidden` y se reanuda reseteando `last`, para no acumular el tiempo que
estuvo oculto.

### 2. Canvas y escalado — `canvas.ts`

```ts
export function setupCanvas(canvas: HTMLCanvasElement, opts: {
  designWidth: number;    // el mundo del juego, p.ej. 960×540
  designHeight: number;
  maxDpr?: number;        // 2 proyector, 1.5 celular
}) { … }
```

- El juego dibuja siempre en coordenadas de diseño; el escalado lo resuelve la base.
- DPR topeado según dispositivo. Renderizar a 3× en un teléfono es la forma más rápida de perder
  la mitad de los frames.
- `ResizeObserver` con debounce, no `window.resize`.
- Devuelve `toWorld(clientX, clientY)` para convertir un toque en coordenadas del juego. Sin esto,
  cada juego reimplementa la misma cuenta y alguno la hace mal.

### 3. Input — `input.ts`

Una sola API para las tres formas de jugar:

```ts
export type InputState = {
  pointer: { x: number; y: number; down: boolean; justPressed: boolean };
  swipe: { dx: number; dy: number; speed: number } | null;
  tilt: { beta: number; gamma: number } | null;   // null si no hay permiso
  keys: Set<string>;
  axis: { x: number; y: number };                 // joystick virtual, -1..1
};
```

- **Touch y mouse unificados** con Pointer Events.
- **Swipe** con umbral de distancia y velocidad, que es lo que necesitan Serpiente y Ninja.
- **Tilt** por `DeviceOrientation`. En iOS **requiere permiso explícito tras un gesto del
  usuario** (`DeviceOrientationEvent.requestPermission()`); la base expone
  `requestTilt()` y los juegos que lo usan muestran un botón. Si se niega, el juego tiene que
  seguir siendo jugable con touch — un juego que muere sin giroscopio está mal hecho.
- **Joystick virtual** con `nipplejs`, sólo cuando el juego lo declara.
- `preventDefault` del scroll y del zoom por doble toque dentro del canvas, que en móvil arruina
  cualquier juego.

### 4. PRNG sembrado — `rng.ts`

`GameRuntimeConfig.seed` existe para que todos los clientes generen lo mismo. **Ni
`Math.random()` ni `gsap.utils.random()` aceptan semilla.**

```ts
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return function next() {
    h |= 0; h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed: string) {
  const next = seededRandom(seed);
  return {
    next,
    range: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    pick: <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  };
}
```

Es el mismo generador que usa el ensayo de la Parte 2. Vive acá y se comparte.

### 5. Pooling — `pool.ts`

El contrato pide cero asignaciones en el loop. Un `new` por bala por frame es basura de GC
garantizada y tirones cada pocos segundos.

```ts
export function createPool<T>(factory: () => T, reset: (item: T) => void, size: number) {
  // acquire() / release() / forEachActive()
}
```

Todo lo que aparece y desaparece —balas, partículas, enemigos, textos flotantes— sale de un pool
dimensionado al arrancar.

### 6. Paleta — `palette.ts`

`AGENTS.md` prohíbe hardcodear colores, y en canvas no se pueden usar variables CSS directo.

```ts
let cache: Palette | null = null;

export function getPalette(): Palette {
  if (cache) return cache;
  const s = getComputedStyle(document.documentElement);
  cache = {
    bg: s.getPropertyValue("--sn-bg-deep").trim(),
    violet: s.getPropertyValue("--sn-violet").trim(),
    magenta: s.getPropertyValue("--sn-magenta").trim(),
    cyan: s.getPropertyValue("--sn-cyan").trim(),
    white: s.getPropertyValue("--sn-white").trim(),
  };
  return cache;
}
```

Se lee **una vez** y se cachea. Leer `getComputedStyle` en el loop fuerza reflow y es de los
errores más caros que se pueden cometer acá.

### 7. Cámara — `camera.ts`

Seguimiento con suavizado, límites del mundo, zoom, y **screen shake que respeta
`prefers-reduced-motion`** (con reduced motion, amplitud 0; el resto del juego sigue igual).

### 8. Colisiones — `collide.ts`

AABB, círculo-círculo, círculo-AABB, y **barrido** (swept AABB) para lo que se mueve rápido. Sin
barrido, la pelota de Pong a alta velocidad atraviesa la paleta entre dos frames — es el bug
clásico y conviene resolverlo una vez acá.

### 9. HUD — `hud.tsx`

Marcador, reloj, cuenta regresiva de inicio y overlay de fin, en **DOM sobre el canvas**, no
dibujados. Texto en DOM se lee mejor, escala solo y es accesible.

Usa los tokens y las primitivas de la Parte 1. Los números en mono tabular para que no bailen.

### 10. El hook — `useGame2D.ts`

Lo que consume cada juego:

```tsx
export function useGame2D(opts: {
  config: GameRuntimeConfig;
  designWidth: number;
  designHeight: number;
  inputs?: Array<"touch" | "tilt" | "swipe" | "keyboard" | "joystick">;
  update: (dt: number, ctx: GameContext) => void;
  render: (g: CanvasRenderingContext2D, alpha: number, ctx: GameContext) => void;
  onFinish: (outcome: Partial<GameOutcome>) => void;
}) { … }
```

Resuelve: montar el canvas, arrancar el loop, sembrar el RNG con `config.seed`, respetar
`gameDurationMs`, escuchar `force-end`, pausar con `document.hidden`, y llamar a `onFinished`
con el outcome bien formado.

**Un juego nuevo debería ser un archivo con `update`, `render` y el cálculo de puntos.**

---

## Qué NO tocar

- `MergeGameBoard.tsx`: lo comparten el juego original y el tour. No se migra a esta base.
- El contrato `GameComponentProps`. La base se adapta a él, no al revés.
- La regla de oro: un juego **no importa nada de `core/tour/`** salvo sus tipos.
- Los dos relojes: `gameDurationMs` es del juego; el de sala no le incumbe.

---

## Reglas

- `update` siempre con `dt` fijo. Si algún juego necesita delta variable, está mal planteado.
- Cero asignaciones en `update` y `render`. Todo pooleado.
- Cero `getComputedStyle`, `querySelector` o lectura de layout dentro del loop.
- Nada de estado de React por frame. El loop escribe en refs; React sólo pinta el HUD, y a lo
  sumo 4 veces por segundo.
- El canvas no captura el scroll de la página fuera de sus límites.
- Todo juego responde a `force-end` con su outcome parcial en el acto.
- Con `prefers-reduced-motion` se saca shake y destellos; el juego sigue jugable.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. **Juego de prueba**: un Pong de un jugador contra la pared, escrito **sólo** con la base, en
   menos de 150 líneas. Es la prueba de que la base sirve.
3. **Determinismo**: dos instancias con la misma semilla y la misma secuencia de inputs terminan
   con el mismo estado. Verificable comparando un hash del estado tras 600 pasos.
4. **60 fps** en el juego de prueba con 500 partículas activas, medido en Performance.
5. **Cero recolecciones de basura** en 30 segundos de juego (DevTools → Memory, sin dientes de
   sierra).
6. Ocultar la pestaña 10 segundos y volver: el juego **no** simula los 10 segundos de golpe.
7. La pelota a velocidad máxima **no atraviesa** la paleta (prueba del barrido).
8. En un teléfono, el DPR efectivo no supera 1.5.
9. Negar el permiso de giroscopio deja el juego jugable con touch.
10. Cero errores de consola.

---

## Decisión a registrar

```json
{
  "id": "games-2d-engine-base",
  "status": "accepted",
  "decision": "A shared 2D engine lives in src/games/_engine/: fixed-timestep loop with accumulator and interpolated render, canvas setup with capped devicePixelRatio, unified pointer/swipe/tilt/keyboard input, a seeded PRNG, object pooling, cached palette reads, camera, swept collision and a DOM HUD, all wrapped by a useGame2D hook.",
  "reason": "The only existing game is DOM plus framer-motion drag and drop, with no loop, so it could not serve as a base for anything with physics or continuous movement. Fourteen of the twenty-four planned games need the same loop, input and scaling, and the contract's determinism and zero-allocation rules are easier to guarantee once than in fourteen places.",
  "consequence": "update always receives a fixed 1/60 dt, which is what makes arena topologies able to agree on state. The seeded PRNG lives here and is shared with the part-2 rehearsal driver, because neither Math.random nor gsap.utils.random accepts a seed. Palette values are read from CSS once and cached, since getComputedStyle inside the loop forces reflow. A new 2D game should be one file with update, render and scoring."
}
```
