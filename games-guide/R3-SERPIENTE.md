# R3 · Serpiente

> **Tanda 2.** Requiere `00-BASES-2D.md` cerrada.
> Categoría **Retro** · topología `solo` · 1 QR · esfuerzo **S** · motor `canvas2d`

El primer juego escrito enteramente sobre la base 2D. Si hacerlo cuesta más de un archivo y unas
200 líneas, la base está mal y hay que arreglar la base, no el juego.

---

## La idea

Snake, con una vuelta que lo hace de este producto y no un clon suelto.

La serpiente recorre un tablero recogiendo **principios de la cultura** —las mismas palabras que
usa `principios-culturales`—. Cada uno que agarra la hace crecer y suma puntos. Chocarse consigo
misma o con el borde termina la partida.

La lectura es obvia sin explicarla: **crecés juntando lo que la empresa dice que importa, y te
caés por no mirar dónde estás parado.** No hace falta un cartel que lo diga.

---

## Reglas

| | |
|---|---|
| Tablero | 24 × 16 celdas, mundo de 960 × 640 |
| Velocidad inicial | 6 celdas por segundo |
| Aceleración | +0,35 celdas/s por principio, tope 14 |
| Crecimiento | +2 segmentos por principio |
| Fin | Choque con el propio cuerpo o con el borde, o se acaba `gameDurationMs` |
| Principios en pantalla | 1 a la vez, en celda libre aleatoria (PRNG sembrado) |

**Sin atravesar bordes.** El wrap-around hace el juego más fácil y más aburrido, y acá conviene
que una partida dure entre 40 y 90 segundos.

### Puntos

Se sigue la fórmula común de la categoría: base por logro más bono por velocidad.

```ts
const basePoints = principiosComidos * 50;
const timeBonus = gameDurationMs !== null
  ? Math.floor((tiempoSobrevividoMs / gameDurationMs) * 200)
  : 0;
const points = basePoints + timeBonus;
```

El bono premia sobrevivir, no sólo comer: sin él, la estrategia óptima es lanzarse a lo loco.

---

## Control

Un solo esquema, que tiene que funcionar en teléfono y en desktop:

- **Deslizar** en cualquier dirección gira la serpiente. Umbral de 24 px para no girar por temblor.
- **Flechas** y **WASD** en desktop.
- **No se puede girar 180°**: intentarlo se ignora, en vez de matar al jugador por un mal gesto.
- La dirección se **encola**: si el jugador desliza dos veces rápido antes del siguiente paso, el
  segundo giro se guarda y se aplica en el paso siguiente. Sin esto, en velocidad alta se pierden
  entradas y se siente roto.

Esa cola de una posición es el detalle que separa un Snake que se siente bien de uno que se siente
injusto.

---

## Presentación

- La serpiente es una cadena de celdas redondeadas con degradé de `--sn-violet` a `--sn-magenta`,
  de cabeza a cola.
- El principio a comer late suavemente en `--sn-cyan`.
- Al comer: destello breve en la cabeza y la palabra del principio sube y se desvanece.
- Grilla de fondo apenas visible, para que se lea el tablero sin distraer.
- Al morir: la serpiente se desarma desde la cola en 400 ms. Sin pantalla de "perdiste" abrupta.

Con `prefers-reduced-motion`: sin latido, sin destello, sin desarmado. La partida es idéntica.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en proyector y en celular de gama media |
| Draw calls | Es Canvas 2D: un `fillRect` por segmento, tope ~80 segmentos |
| Asignaciones en el loop | **Cero.** Los segmentos salen de un pool dimensionado a 24×16 |
| Si no llega | Bajar el suavizado de la cabeza. La lógica no se toca |

Un tablero de 384 celdas y 80 segmentos no debería costar nada. Si este juego no llega a 60 fps,
el problema está en la base.

---

## Qué usa de la base

Todo. Es el punto.

| De `_engine/` | Para qué |
|---|---|
| `useGame2D` | Montaje, loop, duración, `force-end`, outcome |
| `loop.ts` | Timestep fijo. La serpiente avanza por pasos, no por delta |
| `input.ts` | `swipe` y `keys` |
| `rng.ts` | Dónde aparece cada principio, sembrado con `config.seed` |
| `pool.ts` | Segmentos |
| `palette.ts` | Colores de marca |
| `hud.tsx` | Puntaje, reloj, cuenta regresiva |
| `collide.ts` | Sólo comparación de celdas. No hace falta AABB |

**No usa cámara** (el tablero entra entero) ni **colisión barrida** (el movimiento es por celdas,
no continuo).

---

## Qué NO hacer

- **No** meter Pixi. Es Canvas 2D y sobra.
- **No** simular con delta variable: la serpiente avanza en pasos discretos acumulando tiempo.
- **No** importar nada de `core/tour/` salvo los tipos de `game.types.ts`.
- **No** hardcodear colores: salen de `palette.ts`.
- **No** wrap-around en los bordes.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. El juego entero cabe en **un archivo de menos de 250 líneas**, sin contar el contenido de los
   principios. Si no, la base necesita trabajo.
3. Con la misma semilla, los principios aparecen en el **mismo orden y las mismas celdas**.
4. Deslizar dos veces rápido aplica los dos giros, uno por paso.
5. Intentar girar 180° no mata al jugador.
6. 60 fps con la serpiente en 80 segmentos.
7. Cero recolecciones de basura en 60 segundos de partida.
8. `force-end` emite el outcome parcial en el acto, con los principios comidos hasta ahí.
9. Al acabarse `gameDurationMs`, termina con `completed: true`.
10. Con `prefers-reduced-motion` no hay latido ni destello, y el juego se juega igual.
11. Jugable con una sola mano en un teléfono, en vertical.
12. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "serpiente",
  title: "Serpiente",
  description: "Recogé los principios y crecé. No te choques.",
  category: "retro",
  status: "estable",
  enabled: true,
  engine: "canvas2d",
  topology: "solo",
  needsNet: false,
  minPlayers: 1,
  maxPlayers: 1,
  qrSlots: 1,
  estimatedMin: 2,
  inputs: ["swipe", "keyboard"],
  tags: ["retro", "rápido", "individual"],
  mode: "internal",
  load: () => import("./serpiente/SerpienteGame"),
}
```
