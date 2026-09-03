# X3 · Ludo

> **Tanda 7.** Requiere `00-BASES-2D.md` y `02-BASES-NETCODE.md` cerradas.
> Categoría **Creativos** · topología `arena` · 1 QR · esfuerzo **M** · motor `canvas2d`

**El multijugador más barato de los 24.** Es por turnos, así que la latencia no importa: no hay
predicción, ni interpolación, ni estado a 20 Hz. Es pedir y responder.

Buen candidato para implementar temprano si hace falta validar el netcode con algo simple, o para
un evento donde el ritmo tiene que ser tranquilo.

---

## El problema del Ludo: dura demasiado

Un parchís normal son 30 a 60 minutos. Una pantalla de tour tiene 8 o 10.

Tres recortes, y los tres cambian el juego a mejor para este contexto:

| Original | Acá | Por qué |
|---|---|---|
| 4 fichas por jugador | **2** | Menos micro-decisiones, misma tensión |
| Recorrido de 52 casillas | **32** | Una vuelta completa en ~11 tiradas |
| Sacar ficha requiere un 6 | **6 o 5** | Empezar rápido; esperar un 6 es lo más aburrido del original |
| Sin límite de turno | **15 s** | Nadie espera a quien se distrajo |

Con eso, una partida de 4 son 8 a 10 minutos. Sigue siendo Ludo.

---

## Reglas

| | |
|---|---|
| Jugadores | 2 a 4. Con menos de 4, el resto son bots |
| Fichas | 2 por jugador |
| Recorrido | 32 casillas comunes + 4 de meta por color |
| Salir de casa | Sacando 6 o 5 |
| Tirada extra | Al sacar 6, o al capturar |
| Captura | Caer en una ficha rival la manda a casa |
| Casillas seguras | 4, marcadas. No se captura ahí |
| Meta | Entrar con número exacto; si se pasa, no se mueve |
| Gana | Quien mete sus 2 fichas |
| Fin | Alguien gana, o `gameDurationMs` |

Si se acaba el tiempo, gana quien tenga **más avance total** sumando las casillas recorridas por
sus dos fichas. Es una métrica que se entiende de un vistazo en el proyector.

### El dado

Lo tira **el host**, con el PRNG sembrado. Nunca el cliente.

Es la misma regla que rige todo el proyecto —el host recibe input, nunca resultados— pero acá es
especialmente evidente: un dado tirado en el teléfono es un dado que alguien puede elegir.

Con la semilla, además, una partida es reproducible, que es lo que permite depurarla.

---

## Puntos

```ts
const avance    = casillasRecorridas * 10;       // las dos fichas
const capturas  = capturasHechas * 150;
const metas     = fichasEnMeta * 400;
const victoria  = gano ? 500 : 0;
const points    = avance + capturas + metas + victoria;
```

Que el avance puntúe hace que quien pierde igual tenga un número que refleja cómo le fue. En un
juego con tanta suerte, un puntaje binario sería injusto.

---

## El problema de esperar el turno

Con 4 jugadores, cada uno espera 3 turnos. A 15 segundos cada uno, son 45 segundos mirando.

Cuatro cosas para que esa espera no sea muerta:

1. **El proyector es el espectáculo.** El tablero completo, las fichas moviéndose con animación,
   las capturas con su efecto. Mirar tiene que ser entretenido.
2. **El teléfono muestra el tablero también**, en chico, con las fichas propias resaltadas. No se
   depende de mirar arriba.
3. **Turnos de 15 segundos** con cuenta regresiva visible. Si se acaba, se mueve automáticamente
   la ficha más adelantada.
4. **Anticipación:** cuando falta poco para tu turno, el teléfono lo avisa con una vibración.

El punto 3 es el que más importa: un turno sin límite en una sala es una persona distraída
frenando a siete.

---

## El mando

No hace falta layout de la base: es una interfaz de turnos, no un control continuo.

```
┌─────────────────────────────┐
│  Tu turno · 12 s            │
│                             │
│      ┌───────────┐          │
│      │     4     │  ← dado  │
│      └───────────┘          │
│                             │
│   Elegí qué ficha mover:    │
│   ┌────────┐  ┌────────┐    │
│   │ Ficha 1│  │ Ficha 2│    │
│   │ casilla│  │ en casa│    │
│   │   14   │  │   ✕    │    │
│   └────────┘  └────────┘    │
│                             │
│   [ tablero en chico ]      │
└─────────────────────────────┘
```

- **Tirar** con un toque grande, con animación del dado.
- Las fichas que **no se pueden mover** con esa tirada aparecen deshabilitadas y explicando por
  qué (*"en casa, necesitás 5 o 6"*). Es lo que enseña las reglas sin tutorial.
- Si sólo una ficha puede moverse, **se mueve sola** tras un instante. No hacer elegir cuando no
  hay elección.
- Vibración al tirar, al capturar y al ser capturado.

---

## El proyector

- Tablero en cruz clásico, con los cuatro colores de la paleta de marca.
- Fichas con el nombre del jugador al lado.
- **De quién es el turno**, grande, con su color y la cuenta regresiva.
- El dado se anima al tirarse, en grande, al centro.
- Movimiento de ficha casilla por casilla, no de un salto: se sigue con la vista y se entiende.
- Al capturar: la ficha capturada **vuela de vuelta a su casa** con una animación. Es el momento
  del juego y merece pantalla.
- Al meter una ficha: destello del color del jugador.
- Estado de todos al costado: fichas en casa, en juego, en meta.

Con `prefers-reduced-motion`: el movimiento casilla por casilla se acorta pero **no se elimina**.
Igual que en Match-3, acá la animación comunica la mecánica: sin ella no se ve qué se movió.

---

## Bots

Con menos de 4 jugadores, los lugares vacíos son bots. Y también reemplazan a quien se va.

Prioridad simple, en orden:

1. Capturar, si puede.
2. Meter una ficha en meta.
3. Sacar una ficha de casa.
4. Avanzar la ficha más adelantada.
5. Avanzar la única que pueda.

No hace falta más. Un bot de Ludo demasiado bueno frustra sin aportar, y la mayor parte del juego
es el dado.

---

## Estados

1. **Lobby** — un QR. Arranca con **al menos 2** humanos, o con 1 y tres bots si el host lo pide.
2. **Entra a mitad** — toma el lugar de un bot si hay, o espera a la próxima partida.
3. **Se desconecta** — **un bot lo reemplaza en el acto**. La partida no se pausa: es por turnos,
   pausarla por uno es frenar a tres.
4. **Vuelve** — recupera su lugar y sus fichas donde el bot las dejó.
5. **`force-end`** — gana quien más avance tenga; outcomes de todos.

Que un bot reemplace al instante es la decisión correcta acá y distinta a la de Pong o
Rompeladrillos: en un juego por turnos, esperar 30 segundos a alguien es insoportable para el
resto.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps, sobrado |
| Entidades | 8 fichas, 36 casillas, ~60 partículas |
| Estado por tick | Trivial: se manda **por evento**, no a 20 Hz |

Es el único juego de red del catálogo que **no necesita difusión continua de estado**. Se manda un
mensaje cuando pasa algo: se tiró, se movió, se capturó, cambió el turno. En reposo, el tráfico es
cero.

---

## Qué usa de las bases

| De `_engine/` | Para qué |
|---|---|
| `useGame2D` | Ciclo de vida y outcome |
| `rng.ts` | **El dado**, sembrado, en el host |
| `pool.ts`, `palette.ts`, `hud.tsx` | — |

`loop.ts` se usa sólo para las animaciones; no hay simulación continua.
`collide.ts` y `camera.ts` no se usan.

| De `_net/` | Para qué |
|---|---|
| `GameNetPort` | Mensajes por evento |

**No usa** `GamepadController`: la interfaz de turnos es propia.

---

## Qué NO hacer

- **No** tirar el dado en el cliente.
- **No** turnos sin límite de tiempo.
- **No** hacer elegir cuando sólo hay un movimiento posible.
- **No** pausar la partida cuando alguien se desconecta: entra un bot.
- **No** difundir estado a 20 Hz: es por evento.
- **No** eliminar la animación de movimiento con reduced-motion, acortarla.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Partida completa de 4 con celulares reales, en **menos de 12 minutos**.
3. Con la misma semilla, **la secuencia de dados es idéntica**.
4. Un cliente modificado **no puede influir en el dado**.
5. Las fichas que no se pueden mover aparecen deshabilitadas **con el motivo**.
6. Con un solo movimiento posible, se ejecuta solo.
7. El turno de 15 segundos vence y mueve automáticamente.
8. Desconectar a alguien mete un bot **sin pausar**, y al volver recupera sus fichas.
9. Los bots siguen la prioridad definida.
10. En las casillas seguras no se captura.
11. Entrar a meta requiere número exacto.
12. Si se acaba el tiempo, gana quien tenga más avance.
13. **En reposo, el tráfico de red es cero.**
14. `force-end` emite un outcome por jugador humano.
15. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "ludo",
  title: "Ludo",
  description: "El clásico de mesa, para cuatro. Por turnos, sin apuro.",
  category: "creativo3d",
  status: "beta",
  enabled: false,
  engine: "canvas2d",
  topology: "arena",
  needsNet: true,
  minPlayers: 2,
  maxPlayers: 4,
  qrSlots: 1,
  estimatedMin: 10,
  inputs: ["touch"],
  tags: ["creativo", "mesa", "turnos", "tranquilo"],
  mode: "internal",
  load: () => import("./ludo/LudoGame"),
}
```
