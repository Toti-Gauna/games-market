# R6 · Tetris duelo

> **Tanda 6.** Requiere `00-BASES-2D.md` y `02-BASES-NETCODE.md` cerradas.
> Categoría **Retro** · topología `gamepad` · **2 QR** · esfuerzo **L** · motor `canvas2d`

Dos tableros lado a lado en el proyector. **Las líneas que hacés le mandan basura al otro.** Es el
más largo de la tanda 6 porque un Tetris que se siente bien depende de media docena de detalles
que casi nadie implementa.

---

## La idea

Cada persona juega su propio Tetris en su mitad de la pantalla. Completar líneas envía filas de
basura al tablero del rival, que sube desde abajo. Pierde el primero que se desborda.

---

## Lo que separa un Tetris bueno de uno malo

Estos seis detalles son el juego. Sin ellos, la mecánica está pero se siente mal y nadie sabe
explicar por qué.

### 1. Bolsa de 7

Las piezas **no salen al azar**. Salen de una bolsa con las 7 piezas barajada; cuando se vacía, se
rebaraja. Garantiza que nunca falte una pieza más de 12 turnos.

Al azar puro, esperar una barra vertical 20 turnos es posible, y se siente injusto porque lo es.

**Los dos jugadores comparten la misma secuencia**, generada con `config.seed`. Mismas piezas en
el mismo orden: el duelo se decide por habilidad, no por suerte de reparto.

### 2. DAS y ARR

Mantener presionado a un costado tiene que **repetir**:

| | Valor |
|---|---|
| DAS — retardo antes de repetir | 130 ms |
| ARR — repetición | 30 ms |

Sin esto hay que tocar 8 veces para cruzar el tablero. Es la diferencia entre control y pelea.

### 3. Retardo de fijado

Al apoyarse, la pieza **no se fija de inmediato**: hay 500 ms. Y **cada rotación o movimiento
reinicia el contador**, hasta un tope de 15 reinicios.

Es lo que permite deslizar una pieza al último momento hacia un hueco. Sin retardo, el juego
castiga la velocidad; con retardo infinito, se puede eternizar una pieza. 500 ms con 15 reinicios
es el equilibrio del estándar moderno.

### 4. Patadas de pared

Al rotar contra una pared o una pila, la pieza **se corre** para que la rotación entre, en vez de
rechazarla. Se usa la tabla de desplazamientos del estándar SRS.

Es lo que hace posibles los encajes en T y lo que más se nota cuando falta.

### 5. Fantasma

La silueta de dónde va a caer la pieza, proyectada abajo. No es ayuda: es información que un
jugador experto calcula igual, y sin ella el juego es más lento sin ser más difícil.

### 6. Retención

Guardar la pieza actual para después, **una vez por pieza**. Agrega decisión.

---

## La basura

| Líneas | Basura enviada |
|---|---|
| 1 | 0 |
| 2 | 1 |
| 3 | 2 |
| 4 (tetris) | **4** |
| Doble seguido | +1 de bono |

Una fila de basura entra desde abajo con **un hueco en una columna aleatoria** —de la secuencia
sembrada, igual para ambos— y empuja todo hacia arriba.

**Compensación:** si te mandan basura y hacés líneas antes de que entre, se cancela. Hay una
ventana de 1 segundo entre el envío y la aparición, y en ese lapso lo que completás resta. Es lo
que evita que quien va perdiendo no tenga vuelta.

Sin compensación, el que se adelanta gana solo. Con ella, hay remontadas, que es lo que hace
mirable un duelo.

---

## Reglas

| | |
|---|---|
| Tablero | 10 × 20 visible, 2 filas ocultas arriba |
| Gravedad | 1 celda cada 800 ms, ×0,92 por cada 10 líneas propias |
| Caída suave | 20× la gravedad, suma 1 punto por celda |
| Caída dura | Instantánea, suma 2 puntos por celda |
| Fin | Una pila llega a las filas ocultas, o `gameDurationMs` |
| Si se acaba el tiempo | Gana quien tenga más líneas |

### Puntos

```ts
const lineas   = { 1: 100, 2: 300, 3: 500, 4: 800 }[cuantas] * nivel;
const basura   = filasEnviadas * 60;
const victoria = gano ? 600 : 0;
const points   = lineas + basura + victoria + puntosDeCaida;
```

---

## El mando

Es la parte difícil: Tetris en un teléfono suele ser incómodo.

**Botones, no gestos.** Se probó mil veces y los gestos fallan: un deslizamiento hacia abajo que
querías corto termina en caída dura y arruina la partida. La precisión importa más que la
elegancia.

Layout **`dpad`** de la base, con seis controles:

```
┌─────────────────────────────┐
│        [ RETENER ]          │
│                             │
│   ┌───┐   ┌───┐   ┌───┐     │
│   │ ◀ │   │ ▼ │   │ ▶ │     │  ← mover y caída suave
│   └───┘   └───┘   └───┘     │
│                             │
│      ┌─────┐   ┌─────┐      │
│      │  ↺  │   │  ↻  │      │  ← rotar
│      └─────┘   └─────┘      │
│                             │
│    ┌───────────────────┐    │
│    │    CAÍDA DURA     │    │  ← separado del resto a propósito
│    └───────────────────┘    │
└─────────────────────────────┘
```

- **La caída dura va separada** de todo lo demás. Es irreversible: tocarla sin querer cuesta la
  partida.
- Los botones de mover **repiten con DAS/ARR mientras se mantienen presionados**. El teléfono
  manda "empecé a mantener" y "solté"; **la repetición la calcula el host**, o la latencia
  arruinaría el ritmo.
- Vibración corta al fijar, más larga al completar líneas.
- Arriba: tu contador de líneas y **cuánta basura tenés en camino**, que es la información que
  decide si conviene apurarse.

Ese último dato es lo que hace que el mando no sea sólo botones: saber que vienen 4 filas cambia
lo que hacés ahora.

---

## El proyector

- Dos tableros lado a lado, con el nombre y el color de cada jugador.
- Al centro: **el indicador de basura en tránsito**, viajando visiblemente de un tablero al otro.
  Ver la basura cruzar la pantalla es lo que hace entendible el duelo para quien mira.
- Cola de las próximas 3 piezas y la retenida, en cada tablero.
- Al completar líneas: destello y las filas colapsan con un aplastado corto.
- Al recibir basura: el tablero sube con un empujón visible y un tinte rojo breve.
- Al perder: el tablero se llena de gris de abajo hacia arriba.
- Contador de líneas grande en cada lado.

Con `prefers-reduced-motion`: sin sacudida ni tinte. **El colapso de líneas y el empuje de basura
se conservan**: comunican la mecánica.

---

## Estados

1. **Lobby** — dos QR. No arranca con uno solo.
2. **QR ya tomado** — se ofrece el otro asiento.
3. **Uno se desconecta** — pausa, 30 s de gracia. Su pieza queda flotando.
4. **No vuelve** — el otro gana por abandono; los dos reciben outcome.
5. **`force-end`** — gana quien tenga más líneas; dos outcomes.
6. **Fin normal** — pantalla con líneas, basura enviada y puntos.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en el proyector |
| Entidades | 2 tableros de 10×22 en arrays planos, ~120 partículas |
| Estado por tick | < 200 bytes (dos tableros comprimidos) |

Los tableros son `Uint8Array(220)`. El estado de red manda **sólo las celdas que cambiaron** desde
el último tick confirmado, que en Tetris son poquísimas.

---

## Qué usa de las bases

| De `_engine/` | Para qué |
|---|---|
| `loop.ts` a `1/60` | Suficiente: el movimiento es por celdas |
| `rng.ts` | **La bolsa de 7 y los huecos de basura**, sembrados e idénticos para los dos |
| `pool.ts`, `palette.ts`, `hud.tsx` | — |

`collide.ts` **no se usa**: la colisión es comprobación de celdas en la grilla.

| De `_net/` | Para qué |
|---|---|
| `GameNetPort` | Estado delta a 20 Hz, input a 30 Hz |
| `GamepadController` layout `dpad` | Con DAS/ARR calculado en el host |

---

## Qué NO hacer

- **No** piezas al azar: bolsa de 7, sembrada y compartida.
- **No** omitir DAS/ARR, retardo de fijado, patadas de pared, fantasma ni retención.
- **No** gestos para mover: botones.
- **No** poner la caída dura pegada a los otros botones.
- **No** calcular la repetición en el teléfono.
- **No** basura sin ventana de compensación.
- **No** arrancar con un solo jugador.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Partida completa con **dos celulares reales**, con basura cruzando en los dos sentidos.
3. **Los dos jugadores reciben exactamente la misma secuencia de piezas.** Verificable comparando
   las primeras 50.
4. La bolsa de 7 garantiza que ninguna pieza tarde más de 12 turnos.
5. **DAS/ARR:** mantener presionado cruza el tablero de un extremo al otro sin soltar.
6. **Retardo de fijado:** una pieza apoyada se puede deslizar 500 ms, y rotar reinicia el
   contador, hasta 15 veces.
7. **Patadas de pared:** una pieza T rota contra la pared corriéndose, no se rechaza.
8. El fantasma marca correctamente dónde cae.
9. La retención funciona una vez por pieza.
10. Un tetris manda 4 filas; completar líneas dentro de la ventana de 1 s **cancela** basura
    entrante.
11. El mando muestra la basura en camino.
12. El proyector muestra la basura viajando de un tablero al otro.
13. Desconectar pausa; reconectar reanuda en el mismo asiento.
14. `force-end` da la victoria a quien tenga más líneas y emite **dos** outcomes.
15. Estado por tick por debajo de 200 bytes.
16. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "tetris-duelo",
  title: "Tetris duelo",
  description: "Dos tableros, una pantalla. Las líneas que hacés se las mandás al otro.",
  category: "retro",
  status: "beta",
  enabled: false,
  engine: "canvas2d",
  topology: "gamepad",
  needsNet: true,
  minPlayers: 2,
  maxPlayers: 2,
  qrSlots: 2,
  estimatedMin: 7,
  inputs: ["touch"],
  tags: ["retro", "versus", "duelo", "proyector"],
  mode: "internal",
  load: () => import("./tetrisDuelo/TetrisDueloGame"),
}
```
