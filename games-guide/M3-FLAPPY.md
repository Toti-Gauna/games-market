# M3 · Flappy

> **Tanda 2.** Requiere `00-BASES-2D.md` cerrada.
> Categoría **Moderno** · topología `solo` · 1 QR · esfuerzo **S** · motor `canvas2d`

El juego más simple de los 24 y el mejor para calibrar el "se siente bien". Flappy Bird vive o
muere en tres números: gravedad, impulso y separación de los tubos. Si esos tres están mal, no hay
arte que lo salve.

---

## La idea

Una nave de Supernova atraviesa un corredor de obstáculos. Un toque impulsa hacia arriba; la
gravedad hace el resto. Chocar termina la partida.

Sin metáfora corporativa forzada. Este juego está para ser **inmediato**: alguien escanea, entiende
en dos segundos y juega. Es el que se pone cuando hay 30 segundos entre dos bloques de contenido.

---

## Los números que importan

Estos valores son el juego. Empezar acá y ajustar sobre lo jugado, no sobre lo pensado.

| | Valor | Por qué |
|---|---|---|
| Mundo | 480 × 720 | Vertical: se juega con el teléfono como está |
| Gravedad | 1800 px/s² | |
| Impulso | −520 px/s | Relación impulso/gravedad ≈ 0,29 s de subida |
| Velocidad horizontal | 160 px/s inicial, +2 px/s por tubo, tope 260 | Acelera de a poco |
| Hueco entre tubos | 190 px inicial, −1,5 px por tubo, piso 130 | Se cierra despacio |
| Separación horizontal | 260 px | |
| Radio de colisión | 14 px, menor que el sprite | **Perdonar un poco** se siente justo; castigar al píxel se siente roto |
| Rotación de la nave | −25° subiendo a 70° cayendo, suavizada | Es lo que da la lectura de la caída |

**El radio de colisión menor que el dibujo no es un error: es la decisión de diseño más
importante del juego.** Un Flappy con hitbox exacta se percibe injusto aunque sea correcto.

### Puntos

```ts
const basePoints = tubosPasados * 100;
const perfectBonus = tubosPasadosPorElCentro * 25;   // dentro del 30% central del hueco
const points = basePoints + perfectBonus;
```

El bono por centrar premia jugar bien, no sólo sobrevivir, y le da techo al que ya domina el
juego. Sin él, el ranking es puro aguante.

---

## Control

- **Un toque en cualquier lado** impulsa. Nada de botones.
- **Espacio** y **click** en desktop.
- El primer toque arranca la partida: antes, la nave flota en el centro con el cartel de "tocá
  para empezar". **No** arrancar con la gravedad ya corriendo mientras se lee la pantalla.
- Sin toque sostenido: cada impulso es un toque discreto.

---

## Presentación

- Nave: triángulo redondeado con degradé `--sn-violet` → `--sn-magenta` y una estela corta de
  partículas.
- Tubos: rectángulos con borde superior iluminado en `--sn-cyan`. Sin textura.
- Fondo: dos capas de parallax lento (estrellas lejanas y cercanas), a velocidades distintas.
- Al pasar un tubo: el marcador pulsa. Si fue por el centro, destello cian y `+125`.
- Al chocar: la nave gira, cae fuera de pantalla y **la cámara sacude 200 ms**.
- Cuenta regresiva de 3 al empezar, del HUD de la base.

Con `prefers-reduced-motion`: sin sacudida, sin estela, parallax quieto. Los tubos y la nave se
mueven igual — el juego no cambia.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en proyector y celular de gama media |
| Entidades | 6 tubos activos, ~40 partículas de estela, 60 estrellas |
| Asignaciones en el loop | **Cero.** Tubos, partículas y estrellas de pools fijos |
| Si no llega | Bajar partículas de estela a 15, después apagar el parallax lejano |

Los tubos se **reciclan**: el que sale por la izquierda vuelve a la derecha con hueco nuevo. Nunca
se crea ni se destruye uno.

---

## Qué usa de la base

| De `_engine/` | Para qué |
|---|---|
| `useGame2D` | Montaje, loop, duración, `force-end`, outcome |
| `loop.ts` | Timestep fijo. Con gravedad, delta variable cambia la altura del salto entre dispositivos |
| `input.ts` | `pointer.justPressed` y `keys` |
| `rng.ts` | Altura de cada hueco, sembrado con `config.seed` |
| `pool.ts` | Tubos, partículas, estrellas |
| `palette.ts` | Colores |
| `camera.ts` | Sólo el shake del choque |
| `collide.ts` | Círculo contra AABB |
| `hud.tsx` | Marcador, cuenta regresiva, fin |

El timestep fijo es **crítico acá**: con delta variable, la misma pulsación da alturas distintas
en un teléfono lento y en el proyector. Deja de ser el mismo juego.

---

## Qué NO hacer

- **No** meter Pixi ni física. Es una elipse, seis rectángulos y una integración de Euler.
- **No** hitbox exacta al sprite.
- **No** arrancar la gravedad antes del primer toque.
- **No** generar tubos con `Math.random()`: van con el PRNG sembrado, para que el ranking sea
  comparable entre participantes.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Un archivo, menos de 300 líneas.
3. **Con la misma semilla, los huecos aparecen a la misma altura.** Dos participantes de la misma
   sesión juegan el mismo recorrido y sus puntajes son comparables.
4. La altura del salto es **idéntica** en un dispositivo a 30 fps y en uno a 60. Es la prueba del
   timestep fijo, y se verifica con `Emulation.setCPUThrottlingRate`.
5. Rozar el borde de un tubo con el sprite **no** mata: el radio de colisión es menor.
6. La partida no arranca hasta el primer toque.
7. 60 fps con estela y parallax activos.
8. Cero recolecciones de basura en 60 segundos.
9. `force-end` emite el outcome con los tubos pasados hasta ahí.
10. Con `prefers-reduced-motion` no hay sacudida ni estela, y se juega igual.
11. Jugable con una mano, en vertical, con el pulgar.
12. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "flappy",
  title: "Vuelo",
  description: "Un toque para subir. Pasá los obstáculos sin chocar.",
  category: "moderno",
  status: "estable",
  enabled: true,
  engine: "canvas2d",
  topology: "solo",
  needsNet: false,
  minPlayers: 1,
  maxPlayers: 1,
  qrSlots: 1,
  estimatedMin: 2,
  inputs: ["touch", "keyboard"],
  tags: ["moderno", "rápido", "individual", "reflejos"],
  mode: "internal",
  load: () => import("./flappy/FlappyGame"),
}
```

---

## Después, cuando exista la red

Con `02-BASES-NETCODE.md` cerrada, se le agrega el modo `arena`: **las siluetas de los demás
volando en tu misma pantalla**, semitransparentes, con su nombre. Mismo recorrido para todos
—ya lo garantiza la semilla— así que las siluetas son honestas y no decorativas.

Eso convierte un juego individual en algo que se grita en una sala. Pero es un agregado, no un
requisito: el juego tiene que estar bueno antes, jugando solo.
