---
name: gameplay-architecture
description: "Diseña la arquitectura mínima de gameplay: estados, escenas, entidades, input, game loop, score, timers, colisiones, eventos y el límite entre engine y UI. Usala antes de crear la estructura técnica de escenas, estados, entidades, input, score, timers o game loop."
---

## Propósito

Definir la estructura técnica mínima de un juego **antes** de escribirlo, para que no termine siendo un archivo de 900 líneas con el loop, el input, el render, el score y la UI mezclados.

El objetivo es la estructura **más chica que sostenga el juego pedido**, no un engine.

## Cuándo usarla

Antes de crear escenas, estados, entidades, input handling, score, timers o el game loop.

## Cuándo no usarla

- Para un microjuego de una sola mecánica que cabe en un componente: ahí usá `canvas-motion` directamente.
- Para agregar una entidad más a un juego que ya tiene arquitectura.

## Las cinco piezas

Todo juego, del más chico al más grande, necesita estas cinco y **nada más** hasta que se demuestre lo contrario.

### 1. Máquina de estados

```txt
idle -> playing -> paused -> gameover -> idle
```

Un solo lugar decide en qué estado está el juego. Los estados no se infieren de banderas sueltas (`isPlaying && !isPaused && lives > 0`): eso es lo que produce el bug de "el juego sigue corriendo detrás del modal".

### 2. Game loop

Un solo `requestAnimationFrame` (o el loop del engine). Recibe `delta` y lo propaga.

**Todo movimiento se calcula con `delta`, nunca con un valor fijo por frame.** Sin eso el juego corre al doble de velocidad en un monitor de 120 Hz.

```ts
let last = performance.now();

function frame(now: number) {
  // Clamp: una pestaña en segundo plano devuelve saltos enormes y las
  // entidades se teletransportan a través de las paredes.
  const delta = Math.min((now - last) / 1000, 0.05);
  last = now;
  update(delta);
  render();
  raf = requestAnimationFrame(frame);
}
```

El clamp no es opcional.

### 3. Entidades

Datos planos, no clases con lógica de render adentro:

```ts
interface Entity {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  w: number; h: number;
  alive: boolean;
}
```

`update` las mueve, `render` las dibuja. Que sean datos planos es lo que permite serializar el estado, hacer replay y testear la física sin montar nada.

### 4. Input

Una capa que traduce eventos del navegador a **intenciones** del juego:

```ts
interface Intent {
  left: boolean;
  right: boolean;
  action: boolean;
}
```

El gameplay lee `Intent`, no `KeyboardEvent`. Es lo que permite agregar touch, gamepad o VR después sin tocar el gameplay.

### 5. El límite engine / UI

**El juego no renderiza el HUD y la UI no toca el estado del juego.**

- El engine emite eventos o expone un snapshot (`{ score, lives, state }`).
- React lee ese snapshot y pinta el HUD.
- La UI manda comandos (`start()`, `pause()`) y nada más.

En React, el estado caliente del juego **no** va en `useState` actualizado por frame: eso son 60 renders por segundo. Usá un `ref` para el estado del loop y sincronizá a React sólo lo que el HUD necesita, y sólo cuando cambia.

## Colisiones

Empezá con AABB (cajas alineadas). Alcanza para la enorme mayoría de los juegos 2D:

```ts
const hit =
  a.x < b.x + b.w && a.x + a.w > b.x &&
  a.y < b.y + b.h && a.y + a.h > b.y;
```

Pasá a un motor de físicas sólo cuando haya rotación, rebotes realistas o pilas de objetos.

## Limpieza

El loop, los listeners y los timers se cancelan al desmontar. Un `requestAnimationFrame` huérfano sigue corriendo, consume batería y escribe sobre un canvas que ya no existe.

```ts
useEffect(() => {
  const raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}, []);
```

## No hacer

- No crees un ECS genérico para un juego con cuatro entidades.
- No inventes un sistema de eventos propio si un callback alcanza.
- No metas Redux/Zustand para el estado de gameplay: es estado caliente, no estado de aplicación.
- No guardes posiciones en el estado de React.
- No mezcles unidades: elegí píxeles o unidades de mundo, y dejalo escrito.

## Salida

```txt
ESTADOS:    lista y transiciones
ENTIDADES:  tipos y campos
LOOP:       qué corre por frame, en qué orden
INPUT:      eventos -> intents
UI:         qué expone el engine, qué manda la UI
COLISIONES: método y contra qué
```
