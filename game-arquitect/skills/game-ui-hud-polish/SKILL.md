---
name: game-ui-hud-polish
description: "Diseña HUDs, overlays, onboarding, estados visuales, feedback de victoria y derrota, loaders y polish para juegos web, native y VR. Usala cuando el loop ya funciona y hay que hacer que se entienda y se sienta bien."
---

## Propósito

Un juego con un buen loop y sin HUD se siente roto; un juego con un loop mediocre y buen feedback se siente bien. Esta skill cubre la capa que le dice al jugador **qué está pasando, qué logró y qué tiene que hacer**.

Se usa **después** de que el loop funciona, no antes. Ver `game-vertical-slice-planning`.

## Cuándo usarla

- Hay que mostrar score, vidas, tiempo, progreso o estado.
- Falta el onboarding: el jugador no sabe qué hacer al entrar.
- Faltan las pantallas de victoria y derrota.
- El juego funciona pero se siente seco.

## El HUD va en DOM, no en el canvas

Salvo que tenga que estar en el mundo del juego (VR, o un indicador anclado a una entidad), **el HUD se hace con DOM/React encima del canvas**:

- Se lee mejor (el navegador hace el rasterizado del texto).
- Es accesible por lector de pantalla.
- Se estila y se anima con CSS.
- No consume frames del loop.

```tsx
<div className="game-host">
  <canvas ref={canvasRef} />
  <div className="game-hud" aria-live="polite">…</div>
</div>
```

`pointer-events: none` en el contenedor del HUD y `auto` sólo en lo clickeable, o el HUD se come los clicks del juego.

## Los cuatro estados que no pueden faltar

1. **Antes de jugar** — qué es el juego, cómo se controla, un botón grande. No un tutorial de tres pantallas: una línea y un botón.
2. **Jugando** — score, vidas/tiempo, y nada más. Todo lo que no se mira durante la partida no va en el HUD.
3. **Pausa** — siempre. Un juego sin pausa no se puede jugar en un contexto real.
4. **Fin** — resultado, comparación (récord, promedio, la partida anterior) y **reintentar como acción principal**. El botón de reintentar tiene que estar donde ya está el pulgar.

## Jerarquía del HUD

- **Una sola cosa dominante.** Normalmente el score o el tiempo, no los dos.
- Lo crítico (vidas, tiempo bajo) en la periferia superior; lo secundario más chico y con menos contraste.
- Números con `font-variant-numeric: tabular-nums`: sin eso el score "salta" al cambiar de dígito.
- El HUD no tapa la zona de juego. En móvil, cuidado con la parte inferior: ahí está la mano.

## Feedback: la regla de los tres canales

Toda acción importante se confirma por **al menos dos** de estos tres:

| Canal | Ejemplo |
|---|---|
| Visual | flash, escala, partícula, cambio de color |
| Sonoro | click, acierto, error |
| Táctil | haptic (móvil), rumble (gamepad) |

Un acierto que sólo suma un número es un acierto que no se siente.

## Micro-detalles que más rinden

1. **El score sube contando**, no salta. 200-400 ms con easing.
2. **Highlight del récord** cuando se supera, en el momento en que se supera.
3. **Cuenta regresiva** de 3 antes de arrancar: le da al jugador tiempo de poner las manos.
4. **El tiempo bajo cambia de color y pulsa** en los últimos 5 segundos.
5. **Transición entre estados**, nunca corte seco. 200-300 ms alcanza.
6. **Loader real** con progreso si la carga supera 1 segundo; nada si es menos.

## Onboarding

- Enseñá **jugando**, no leyendo. La primera pantalla del juego es el tutorial.
- Un control por vez.
- Si hace falta texto, una línea: "Tocá para saltar".
- Nada de modales encadenados.

## Accesibilidad

- Respetá `prefers-reduced-motion`: sin shake, sin parpadeo, transiciones cortas.
- Nunca comuniques información **sólo** por color (daltonismo): sumá forma, icono o texto.
- Contraste mínimo 4.5:1 en el texto del HUD, medido sobre el fondo más claro que pueda aparecer detrás.
- El HUD con `aria-live="polite"` para cambios de estado importantes.
- Todo lo interactivo alcanzable por teclado, con foco visible.
- Nada de parpadeo rápido.

## Salida esperada

- Los cuatro estados implementados.
- HUD en DOM, con jerarquía clara y números tabulares.
- Feedback en dos canales para las acciones clave.
- Transiciones entre estados.
- Verificación de contraste y de `prefers-reduced-motion`.
