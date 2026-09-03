# X2 · Pool

> **Tanda 8.** Requiere `01-BASES-3D.md` y `02-BASES-NETCODE.md` cerradas.
> Categoría **Creativos/3D** · topología `gamepad` · **2 QR** · esfuerzo **L** · motor `r3f`

Billar en la pantalla grande, con los dos celulares como tacos. Es el juego 3D más barato de los
cuatro porque **es por turnos**: no hay netcode en tiempo real, sólo eventos.

---

## La idea

Una mesa de pool vista desde arriba en el proyector. Cada jugador apunta y pega desde su celular.
La física hace el resto, y ver 16 bolas resolverse es satisfactorio sin que haya que agregarle
nada.

---

## Por qué es el 3D más accesible

De los cuatro juegos 3D, este es el único donde:

- **Nadie renderiza 3D en el teléfono.** El celular es una interfaz de apuntado en 2D; todo el
  render pasa en el proyector, que es la máquina buena.
- **No hay estado continuo por red.** Se manda un tiro y se recibe el resultado. Como Ludo.
- La escena es **una mesa y 16 esferas**. No hay mundo, ni LOD, ni oclusión.

Si hay que empezar la 3D por algún lado, es por acá.

---

## Reglas — bola 8 simplificada

| | |
|---|---|
| Bolas | 15 numeradas + blanca |
| Grupos | Lisas (1-7) y rayadas (9-15) |
| Asignación | Con la primera bola embocada tras el saque |
| Turno extra | Al embocar una propia |
| Falta | No tocar ninguna propia, embocar la blanca, o embocar una del rival |
| Tras falta | El rival puede **mover la blanca** a cualquier lado |
| Gana | Emboca sus 7 y después la 8 |
| Pierde | Emboca la 8 antes de tiempo, o junto con una falta |
| Fin | Alguien gana, o `gameDurationMs` |

Si se acaba el tiempo, gana quien tenga **menos bolas propias en la mesa**.

**Sin cantar bolsillo.** Es una regla del pool serio que en un evento sólo genera discusiones y
turnos perdidos. Acá, si entra, entra.

---

## La física

Es la parte que hace o rompe el juego. Un pool con física apenas aceptable se siente mal de
inmediato, porque todo el mundo sabe cómo se mueven las bolas.

Con `@react-three/rapier`:

| | Valor | Nota |
|---|---|---|
| Restitución bola-bola | 0,95 | Casi elástica |
| Restitución bola-banda | 0,75 | Las bandas absorben |
| Fricción de rodadura | 0,015 | Lo que hace que se frenen |
| Amortiguación angular | 0,4 | |
| Radio | 28,5 mm a escala real | Proporciones reales: se nota |
| Paso de física | **`1/120`** | Como Pong, y por lo mismo |

**CCD activo en todas las bolas.** Un tiro fuerte mueve la blanca varios diámetros por paso; sin
colisión continua, atraviesa otra bola y el juego pierde toda credibilidad.

### El turno termina cuando la mesa se aquieta

Mismo problema que en Catapulta, y la misma solución: no se puede evaluar el resultado hasta que
todo dejó de moverse. Una bola rodando lento puede caer tres segundos después.

**El turno cierra cuando todas las bolas duermen, o a los 12 segundos.** Con un indicador sutil de
que la mesa se está asentando.

### Efecto

Sin efecto, el pool es plano. Con efecto completo, es injugable para quien no juega al pool.

El punto medio: **efecto vertical solamente** — pegarle arriba o abajo del centro produce corrida
o retroceso. Es el efecto que más se nota, el más fácil de entender y el que se puede explicar en
una frase en pantalla.

Nada de efecto lateral ni masse.

---

## El mando

Layout **`aim`** de la base de netcode:

```
┌─────────────────────────────┐
│  Tu turno                   │
│                             │
│   ┌───────────────────┐     │
│   │                   │     │
│   │    ●              │     │  ← vista cenital de la mesa
│   │      ╲            │     │     con la línea de tiro
│   │       ○           │     │
│   └───────────────────┘     │
│                             │
│   Efecto   ◐               │  ← arriba/abajo del centro
│                             │
│   Fuerza  ▓▓▓▓▓▓░░░░       │
│                             │
│      [    PEGAR    ]        │
└─────────────────────────────┘
```

- **Apuntar:** arrastrar sobre la vista cenital gira la dirección. Con un dedo, precisión gruesa;
  **acercando los dedos se hace zoom** y la precisión se afina. Sin ajuste fino, apuntar a una
  bola lejana es imposible en un teléfono.
- **La línea de tiro se proyecta** mostrando la trayectoria de la blanca y, si golpea, la
  dirección aproximada de la bola golpeada. Es ayuda, y sin ella el juego es adivinar.
- **Fuerza:** una barra que se llena manteniendo presionado `PEGAR` y se suelta. Como el swing de
  un juego de golf.
- **Efecto:** un círculo donde se elige el punto de impacto vertical.
- Vibración al pegar, y distinta al embocar.

**Nada de apuntar inclinando el teléfono.** Se probó en muchos juegos y siempre es lo mismo: se
ve muy bien en el video de demostración y es impreciso en la mano. El pool necesita precisión.

---

## El proyector

- **Vista cenital ligeramente inclinada**, no perfectamente desde arriba: da profundidad sin
  perder la lectura de los ángulos.
- La cámara **sigue a la blanca** durante el tiro y vuelve a la vista general al aquietarse.
- Mesa en verde profundo con las bandas en un tono de la paleta; bolas con los números legibles.
- La línea de tiro del jugador activo, **en su color**.
- Al embocar: la bola cae con un sonido y aparece en el estante lateral de ese jugador.
- Al cometer falta: cartel claro con el motivo. *"Falta: no tocaste ninguna lisa."*
- **Ralentí automático** cuando dos bolas están por chocar cerca de un bolsillo. Es el momento que
  la sala mira, y merece 400 ms.
- Estante de cada jugador con sus bolas embocadas.

Con `prefers-reduced-motion`: sin ralentí ni sacudida. El seguimiento de cámara se conserva —
perder la bola de vista sería peor.

---

## Puntos

```ts
const embocadas  = bolasPropias * 200;
const faltas     = faltasCometidas * -50;      // única resta del catálogo, y es leve
const victoria   = gano ? 800 : 0;
const tiroLimpio = tirosSinFalta * 40;
const points     = Math.max(0, embocadas + faltas + victoria + tiroLimpio);
```

Es el único juego donde **una falta resta**, y es a propósito: en pool, la falta es la unidad de
error del juego, y sin costo la estrategia óptima es pegar fuerte siempre. El `Math.max(0, …)`
evita que alguien termine en negativo.

---

## Estados

1. **Lobby** — dos QR. No arranca con uno solo.
2. **QR tomado** — se ofrece el otro asiento.
3. **Desconexión** — pausa, 30 s de gracia. La mesa queda como está.
4. **No vuelve** — el otro gana; los dos reciben outcome.
5. **Turno vencido** — 45 s por turno; al vencer, tiro automático suave hacia la bola propia más
   cercana. Nunca dejar la mesa trabada.
6. **`force-end`** — gana quien tenga menos bolas en la mesa; dos outcomes.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en el proyector |
| Cuerpos físicos | 16 esferas + mesa + 6 bolsillos |
| Draw calls | < 15, con las bolas instanciadas |
| Triángulos | < 40.000 |
| Estado por red | Trivial: se manda el tiro, se recibe el resultado |

16 esferas es una escena mínima para Rapier3D. Si esto no llega a 60 fps, el problema está en la
base 3D, no en el juego — y por eso conviene que sea el primer 3D que se implemente.

---

## Qué usa de las bases

| De `_engine3d/` | Para qué |
|---|---|
| `Stage.tsx` | Canvas, DPR topeado, cámara, luces |
| `useFixedStep.ts` | Física a `1/120` |
| `instancing.ts` | Las 16 bolas como instancias |
| `geometry.ts`, `materials.ts` | Esferas y mesa procedurales |
| `audio3d.ts` | Choques posicionales |
| `perf.ts` | Degradación automática |

`bvh.ts` y `lod.ts` **no se usan**: la escena es demasiado chica.

| De `_net/` | Para qué |
|---|---|
| `GameNetPort` | Mensajes por evento |
| `GamepadController` layout `aim` | Con zoom para el ajuste fino |

---

## Qué NO hacer

- **No** apuntar por inclinación.
- **No** efecto lateral ni masse.
- **No** cantar bolsillo.
- **No** evaluar el turno antes de que la mesa se aquiete.
- **No** física sin CCD.
- **No** dejar un turno sin límite de tiempo.
- **No** renderizar 3D en el teléfono.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Partida completa con **dos celulares reales**, hasta embocar la 8.
3. **Ninguna bola atraviesa a otra** en un tiro a máxima fuerza (CCD).
4. El turno no se evalúa hasta que la mesa se aquieta o pasan 12 segundos.
5. La línea de tiro proyectada **coincide** con la trayectoria real de la blanca.
6. El zoom con dos dedos permite apuntar a una bola en el otro extremo de la mesa.
7. El efecto vertical produce corrida y retroceso visibles.
8. Las faltas se detectan y se explican con el motivo correcto.
9. Tras una falta, el rival puede mover la blanca.
10. El turno de 45 s vence y ejecuta un tiro automático.
11. 60 fps con las 16 bolas en movimiento, menos de 15 draw calls.
12. Con la misma semilla y el mismo tiro, el resultado es **idéntico**.
13. Desconectar pausa; reconectar reanuda en el mismo asiento.
14. `force-end` emite **dos** outcomes.
15. El chunk de Three **no entra** en el bundle inicial.
16. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "pool",
  title: "Pool",
  description: "La mesa en la pantalla, el taco en tu celular.",
  category: "creativo3d",
  status: "beta",
  enabled: false,
  engine: "r3f",
  topology: "gamepad",
  needsNet: true,
  minPlayers: 2,
  maxPlayers: 2,
  qrSlots: 2,
  estimatedMin: 10,
  inputs: ["touch"],
  tags: ["3d", "física", "turnos", "duelo", "proyector"],
  mode: "internal",
  load: () => import("./pool/PoolGame"),
}
```
