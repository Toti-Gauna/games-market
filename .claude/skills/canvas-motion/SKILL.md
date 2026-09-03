---
name: canvas-motion
description: "Crea microjuegos web con Canvas API + requestAnimationFrame + Motion/Framer Motion o GSAP, sin engine completo. Usala cuando el juego se resuelve con una sola mecánica, pocas entidades y no justifica Phaser ni PixiJS."
---

## Propósito

Resolver juegos chicos sin arrastrar un engine. Un Flappy, un memotest, un runner de una pantalla, un juego de reflejos o una mecánica de landing no necesitan escenas, loader ni físicas: necesitan un canvas, un loop y buen easing.

**Regla de decisión:** si el juego tiene menos de ~5 tipos de entidad, una sola pantalla de gameplay y no necesita tilemaps ni spritesheets complejos, esta skill alcanza. Si no, pasá a `web-game-engine`.

## Cuándo usarla

- Microjuegos y mecánicas de una sola pantalla.
- Juegos de reflejos, timing o precisión.
- Gamificación dentro de una app (una ruleta, un raspadito, un mini-desafío).
- Prototipos rápidos para validar si el loop es divertido.

## Cuándo no usarla

- Hay tilemaps, múltiples niveles o scroll de mundo.
- Hacen falta físicas reales (rebotes, articulaciones, pilas).
- Hay cientos de sprites simultáneos: ahí PixiJS rinde mucho más.
- Es 3D: ver `react-three-fiber-game`.

## Setup del canvas

El canvas **se dimensiona por DPR o se ve borroso** en cualquier pantalla retina:

```ts
function resize(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap en 2: arriba de eso el costo no se ve
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // dibujás en CSS px, no en px físicos
}
```

El cap en 2 importa: en un móvil con DPR 3 estás pintando 9 veces el área.

## El loop

```ts
let last = performance.now();
function frame(now: number) {
  const delta = Math.min((now - last) / 1000, 0.05);
  last = now;
  update(delta);
  draw(ctx);
  raf = requestAnimationFrame(frame);
}
```

Todo lo que se mueve usa `delta`. Ver `gameplay-architecture`.

## Dónde entra Motion / GSAP

**No en el gameplay.** El loop del juego mueve las entidades; la librería de animación mueve **lo que no es gameplay**:

| Sí | No |
|---|---|
| Transición de menú a partida | Posición del jugador |
| Contador de score animado | Física de proyectiles |
| Pop de un power-up al recogerlo | Colisiones |
| Screen shake | Movimiento de enemigos |
| Fade de game over | Cualquier cosa que dependa de `delta` |

Mezclar los dos sistemas sobre la misma propiedad produce peleas por el valor: uno escribe y el otro lo pisa al frame siguiente.

Si el juego es puramente de UI (cartas que se dan vuelta, fichas que se acomodan), es válido que **toda** la animación sea de la librería y no haya loop propio.

## Juice barato que cambia el juego

En orden de retorno por línea de código:

1. **Easing en todo lo que no sea física.** `power2.out` en vez de lineal.
2. **Screen shake** en impactos: 3-6 px, 120 ms, decayendo.
3. **Squash & stretch**: escalar 1.15 / 0.9 al saltar y aterrizar.
4. **Partículas simples**: 8-12 rectángulos con vida corta.
5. **Hit stop**: congelar el loop 40-60 ms en un impacto fuerte.
6. **Trail**: dibujar 3 posiciones anteriores con alpha decreciente.

## Reglas de dibujo

- Limpiá con `clearRect`, no redibujando un rectángulo opaco, salvo que quieras trail.
- Agrupá por estado: cambiar `fillStyle` es barato, cambiar `font` no.
- No crees objetos dentro del loop. Un `{ x, y }` por frame por entidad es basura para el GC.
- `ctx.save()` / `ctx.restore()` sólo cuando hace falta: no son gratis.
- Redondeá posiciones a enteros si el arte es pixel art.

## Accesibilidad y respeto

- Respetá `prefers-reduced-motion`: bajá o apagá screen shake, parpadeos y partículas.
- Nunca uses parpadeo rápido (riesgo fotosensible).
- Ofrecé pausa. Un juego que no se puede pausar es un juego que no se puede jugar en una oficina.
- Si el input es sólo teclado, agregá touch: la mitad del tráfico es móvil.

## Salida esperada

- Un componente con el canvas, el loop y su limpieza.
- El estado del juego en un `ref`, no en `useState`.
- El HUD como DOM encima del canvas, no dibujado en el canvas (se lee mejor, es accesible y se estila con CSS).
