# M1 · Match-3

> **Tanda 5.** Requiere `00-BASES-2D.md` cerrada. Usa **PixiJS** (ya instalado en M5).
> Categoría **Moderno** · topología `solo` · 1 QR · esfuerzo **L** · motor `pixi`

El más largo de la tanda y el que más gente sabe jugar sin explicación. **Todos juegan el mismo
tablero**, así que los puntajes son comparables de verdad — y eso se logra sin una línea de red.

---

## Por qué es `solo` y no `arena`

En el catálogo original lo puse como `arena`. Está mal: `arena` significa **estado compartido**, y
acá no hay ninguno. Cada participante juega su propio tablero, en su teléfono, sin ver el de los
demás.

Lo que los une es que **el tablero es idéntico**, porque `GameRuntimeConfig.seed` ya llega igual
para todos. Misma disposición inicial, mismas piezas de relleno, mismo orden. La comparación la
hace el ranking del tour al final.

Es competencia real sin transporte, sin host y sin latencia. Todo el trabajo lo hace un campo que
ya existe.

---

## La regla que hace posible eso

**Determinismo total en las cascadas.** Es la parte técnicamente delicada.

Cuando se combinan tres piezas, desaparecen, las de arriba caen y **entran piezas nuevas por
arriba**. Si esas piezas nuevas salieran de `Math.random()`, dos jugadores con el mismo tablero
inicial divergirían en la primera cascada y todo el planteo se cae.

Entonces:

- **Un único generador sembrado** con `config.seed`, del que salen el tablero inicial y **todas**
  las piezas de relleno, en orden.
- Ese generador se consume **sólo** en el relleno, y siempre en el mismo orden: columna izquierda
  a derecha, dentro de cada una de abajo hacia arriba.
- Nada más en el juego consume ese generador. Las partículas y los efectos usan uno aparte.

Si dos jugadores hacen exactamente los mismos movimientos, tienen exactamente el mismo tablero
después. Eso es lo que hay que poder verificar.

---

## Reglas

| | |
|---|---|
| Tablero | 8 × 8 |
| Tipos de pieza | 6, con color **y forma** distintas |
| Movimiento | Intercambiar dos piezas adyacentes |
| Válido | Sólo si genera al menos una combinación de 3+ |
| Combinación | 3+ en línea, horizontal o vertical |
| Cascada | Las piezas caen y se rellena desde arriba, repitiendo hasta que no haya más |
| Fin | `gameDurationMs`, típicamente 90 s |

**El tablero inicial no puede tener combinaciones ya hechas ni quedar sin movimientos posibles.**
Se genera y se corrige antes de mostrarlo — reemplazando piezas hasta que cumpla, siempre con el
generador sembrado para que la corrección también sea idéntica en todos.

### Piezas especiales

Lo que le da profundidad a un match-3 y lo diferencia de un juego de suerte:

| Se forma con | Pieza | Qué hace |
|---|---|---|
| 4 en línea | **Rayo** | Limpia su fila o columna |
| 5 en L o T | **Bomba** | Limpia un radio de 3 |
| 5 en línea | **Prisma** | Limpia todas las piezas de un color |

Combinar dos especiales entre sí las encadena. Es donde están los puntajes altos y donde el
juego premia mirar el tablero en vez de tocar rápido.

### Puntos

```ts
const base    = piezas * 20;
const cascada = nivelDeCascada * 50;        // cada cascada encadenada vale más
const especial = especialesUsadas * 150;
const points  = base + cascadas + especiales;
```

El bono creciente por cascada es lo que hace que un movimiento bien pensado valga cinco veces uno
cualquiera.

---

## Control

- **Deslizar** una pieza hacia la adyacente con la que se quiere intercambiar. Es más rápido y
  natural en teléfono que tocar dos veces.
- Tocar y tocar de nuevo también funciona, para quien lo prefiera.
- Si el intercambio no genera combinación: las piezas **vuelven con una animación corta**, sin
  penalización. Nunca bloquear ni castigar un intento inválido.
- Durante la cascada, la entrada se **encola**, no se ignora. Perder un movimiento porque el
  tablero estaba animando se siente roto.

---

## Presentación

- Piezas como formas geométricas con degradé: círculo, rombo, hexágono, triángulo, cuadrado,
  estrella. **Cada tipo tiene color y forma propios** — nunca sólo color.
- Al combinar: las piezas se encogen y estallan en partículas de su color.
- Caída con rebote corto al aterrizar. Es lo que hace que el tablero se sienta físico.
- Cascadas encadenadas: el multiplicador aparece cada vez más grande.
- Especiales con un brillo constante para que se distingan de un vistazo.
- Al activar un prisma: barrido de color por todo el tablero.
- Reloj como barra que se consume, con los últimos 10 segundos en `--sn-magenta`.

Con `prefers-reduced-motion`: sin rebote, sin barrido, partículas al mínimo. Los tiempos de
animación bajan pero **no a cero**: sin ninguna transición no se entiende qué se movió.

Ese matiz importa acá más que en otros juegos: en un match-3, la animación **comunica la mecánica**.
Quitarla del todo lo vuelve ilegible.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en celular de gama media |
| Sprites | 64 piezas + máx. 300 partículas |
| Draw calls | < 8 |
| Si no llega | Partículas a la mitad, después sacar el rebote de caída |

Las 64 piezas se crean una vez y **se reutilizan**: al desaparecer no se destruyen, se reposicionan
arriba con un tipo nuevo. Nunca se instancia un sprite durante la partida.

---

## Qué usa de la base

| De `_engine/` | Para qué |
|---|---|
| `useGame2D` | Montaje, loop, duración, `force-end`, outcome |
| `loop.ts` | Timestep fijo para las animaciones de caída |
| `input.ts` | `swipe` y `pointer` |
| `rng.ts` | **Dos generadores**: uno sembrado para el tablero, otro suelto para efectos |
| `pool.ts` | Partículas |
| `palette.ts` | Colores |
| `hud.tsx` | Puntaje, reloj, multiplicador |

`collide.ts` y `camera.ts` no se usan.

---

## Qué NO hacer

- **No** `Math.random()` en nada que afecte el tablero.
- **No** consumir el generador sembrado para efectos visuales: divergiría el relleno.
- **No** mostrar un tablero inicial con combinaciones ya hechas o sin movimientos posibles.
- **No** distinguir piezas sólo por color.
- **No** ignorar la entrada durante las cascadas: se encola.
- **No** penalizar un intercambio inválido.
- **No** quitar toda la animación con reduced-motion: reducirla.
- **No** instanciar sprites durante la partida.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. **La prueba que define el juego:** dos instancias con la misma semilla y **la misma secuencia
   de movimientos** terminan con **tableros idénticos y el mismo puntaje**. Verificable con un
   hash del tablero tras 20 movimientos.
3. El tablero inicial nunca tiene combinaciones hechas ni queda sin movimientos.
4. Cuando no quedan movimientos posibles, el tablero se rebaraja **con el generador sembrado** y
   se avisa.
5. Las tres piezas especiales se forman con sus patrones y hacen lo suyo.
6. Combinar dos especiales las encadena.
7. Un intercambio inválido devuelve las piezas sin penalizar.
8. Deslizar durante una cascada **encola** el movimiento.
9. Las seis piezas se distinguen **en escala de grises**.
10. 60 fps con una cascada de 5 niveles y 300 partículas.
11. Cero recolecciones de basura en 90 segundos.
12. `force-end` emite el outcome con el puntaje acumulado.
13. Con `prefers-reduced-motion` las animaciones se acortan pero **siguen existiendo**.
14. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "match3",
  title: "Combinaciones",
  description: "Alineá tres o más. Todos juegan el mismo tablero.",
  category: "moderno",
  status: "estable",
  enabled: true,
  engine: "pixi",
  topology: "solo",
  needsNet: false,
  minPlayers: 1,
  maxPlayers: 1,
  qrSlots: 1,
  estimatedMin: 3,
  inputs: ["swipe", "touch"],
  tags: ["moderno", "puzzle", "individual", "mismo tablero"],
  mode: "internal",
  load: () => import("./match3/Match3Game"),
}
```
