# Prompt maestro · Combinaciones / Match-3 (portable)

> **Qué es este archivo.** El prompt autocontenido para reimplementar el juego
> Combinaciones (match-3 de tablero compartido) de este repo en **otro proyecto**, sin
> tener acceso a este código. Todo lo que hace falta —reglas, números, algoritmos,
> orden de consumo del generador, presupuesto, tests y criterios de aceptación— está
> escrito acá.
>
> **Cómo usarlo.** Copiá el archivo entero, desde `# ROL` hasta el final, y pegalo como
> prompt en Claude Code, Codex, Cursor o Copilot. No necesita nada más.
>
> **Origen.** `src/games/combinaciones/` de `juegos-supernova` (guía
> `games-guide/M1-MATCH3.md`). El apéndice D mapea archivo por archivo por si el
> proyecto destino prefiere copiar la base en vez de reescribirla.

---

# ROL

Actuá como **Game-arquitect**: agente arquitecto de videojuegos web.
Priorizá simplicidad, vertical slicing, game feel y performance.
Usá el stack más chico que resuelva el juego. Primero loop jugable, después polish.
Leé los archivos antes de modificarlos y explicá las decisiones no obvias.

Este juego tiene una particularidad que manda sobre todo lo demás: **es determinista**.
Cada vez que dudes entre dos formas de hacer algo, gana la que mantiene reproducible el
tablero.

---

# OBJETIVO

Implementar **Combinaciones**: un match-3 para navegador donde **todos los jugadores
juegan exactamente el mismo tablero**, derivado de una semilla compartida, de modo que
los puntajes se comparen de verdad — y todo eso **sin una sola línea de red**.

Es un juego `solo`: cada uno juega en su teléfono, sin ver el de los demás, sin host y
sin latencia. Lo único que los une es la semilla. La comparación la hace después quien
guarde los resultados.

Partida típica de 90 segundos. Termina emitiendo un `outcome` que incluye un **hash del
tablero final**, que es lo que permite verificar desde afuera que dos jugadores jugaron
el mismo tablero.

---

# CORE LOOP

El jugador **desliza una ficha hacia su vecina**, si el intercambio arma una línea de 3
o más esas fichas **se limpian**, las de arriba **caen**, entran fichas nuevas por
arriba, y si la caída arma otra línea **encadena una cascada** que vale más.

- **Suma** limpiando fichas; el multiplicador de cascada es lo que hace que **un
  movimiento pensado valga varias veces uno cualquiera**. Ahí está la decisión del juego.
- Las **piezas especiales** (rayo, bomba, prisma) son lo que lo diferencia de un juego de
  suerte: se forman con patrones concretos y se encadenan entre sí.
- **No se pierde.** La partida termina por tiempo. Un intercambio inválido **no se
  penaliza**: las fichas van, vuelven, y el tablero ni se entera.

---

# LA REGLA QUE DEFINE EL JUEGO

**Determinismo total en las cascadas.** Es la parte técnicamente delicada y es lo que
hay que resolver bien desde la primera línea.

Cuando se limpian fichas, las de arriba caen y entran fichas nuevas por arriba. Si esas
fichas nuevas salieran de `Math.random()`, dos jugadores con el mismo tablero inicial
divergirían en la primera cascada y todo el planteo se cae.

Entonces, dos reglas duras:

1. **Un único generador sembrado** con `config.seed` produce el tablero inicial, **todas**
   las fichas de relleno y los rebarajados. Se consume **siempre en el mismo orden**:
   columnas de izquierda a derecha, y dentro de cada columna **de abajo hacia arriba**.
2. **Nada más consume ese generador.** Las partículas y los efectos usan **otro
   generador aparte**, sembrado con `config.seed + "-fx"`. Tocar el sembrado para un
   efecto visual desviaría el relleno y rompería la comparabilidad.

Si dos jugadores hacen exactamente los mismos movimientos, tienen exactamente el mismo
tablero después. **Eso es lo que hay que poder verificar**, y por eso el juego expone un
`hashBoard()`.

---

# PLATAFORMA Y STACK

- **Plataforma:** web, mobile-first, orientación vertical.
- **Render:** **Canvas 2D**. Nada más.
- **Lenguaje:** TypeScript en modo `strict`, con `noUncheckedIndexedAccess`.
- **UI/HUD:** React 19 (o el framework del proyecto destino). El HUD va en **DOM**
  encima del canvas, **nunca** dibujado adentro.
- **Tests:** Vitest (o el runner del destino), sin navegador.

**No usar:**

- **No** Pixi, Phaser ni ningún engine. La guía original pedía Pixi y fue un desvío
  deliberado: un tablero de 8×8 son **64 formas** y un puñado de partículas, muy por
  debajo del umbral de ~200 sprites móviles que justifica un motor. **El criterio para
  revisarlo es el contador de FPS, no la intuición.**
- **No** `Math.random()` en **nada** que afecte el tablero.
- **No** consumir el generador sembrado para efectos visuales.
- **No** librerías de tween, de partículas ni de audio.
- **No** assets de imagen ni de sonido: todo se dibuja y se sintetiza.
- **No** delta variable alimentando la máquina de fases.

---

# ARQUITECTURA OBLIGATORIA

## 1. La lógica va separada de React y del canvas

```
combinaciones/
  logic.ts        # el juego entero: sin React, sin canvas, sin DOM. Testeable en Node.
  logic.test.ts   # los tests de logic.ts
  settings.ts     # el schema de administrables (defaults, min, max, unidades)
  CombinacionesGame.tsx  # estado de escena, input, fases, dibujo, HUD. Cero reglas.
```

**Regla dura:** el componente **no tiene ni una regla del juego**. Arma el estado,
traduce los toques a intercambios y dibuja. Todo lo que decide qué pasa vive en
`logic.ts`. Esa separación no es estética: es lo que hace **verificable** el
determinismo, porque los tests corren la misma lógica que el juego, sin animaciones.

## 2. El runtime mínimo que el juego necesita

Si el proyecto destino ya tiene estas piezas, **usalas**. Si no, implementalas con
exactamente este contrato antes de escribir el juego.

| Pieza | Contrato | Por qué |
|---|---|---|
| **Loop de paso fijo** | `createLoop(update: (dt) => void, render: (alpha) => void, { step })` con `dt = 1/60` constante, acumulador, tope de `0.25 s` por frame, y `alpha = acc/step` para interpolar el render. | Las animaciones de caída se miden en ms; con delta variable la duración de una fase depende del hardware. |
| **Canvas escalado** | `setupCanvas(canvas, { designWidth, designHeight, maxDpr })` → `{ ctx, toWorld(clientX, clientY), dispose() }`. Letterbox conservando aspecto, `setTransform` una vez por layout, `ResizeObserver` con debounce por rAF. | El juego dibuja en coordenadas de diseño y no se entera del tamaño real. `toWorld` es lo que convierte un toque en una celda. |
| **DPR topeado** | `min(devicePixelRatio, 1.5)` en puntero grueso, `2` en escritorio. | Renderizar a 3× es la forma más rápida de perder frames en un celular. |
| **Input** | `createInput(container, { toWorld })` → `state.pointer { x, y, down, justPressed, justReleased }`. `endFrame()` limpia los flags de un frame. Ignora los eventos cuyo `target.closest("[data-game-ui]")` exista. | Sin la guarda del HUD, la captura de puntero se come el `click` del botón "Jugar". |
| **PRNG sembrado** | `createRng(seed: string)` → `{ next(): [0,1), range, int(min,max) inclusive, pick, shuffle, chance }`. FNV-1a + mulberry32. | **El corazón del juego.** Sin semilla no hay tablero compartido ni bug reproducible. |
| **Object pool** | `createPool<T extends { alive: boolean }>(capacity, factory)` → `{ spawn(init), each(fn), release(item), active, capacity }`. Todo preasignado. | Cero asignaciones en el loop. |
| **Paleta** | `readPalette()` lee los tokens CSS **una vez** y cachea. `mixHex(a, b, t)` mezcla dos hex — **precalcular fuera del loop**. | Crear un `CanvasGradient` por ficha y por frame es basura garantizada. |
| **Audio** | WebAudio a mano: oscilador + gain, ataque de 8 ms y caída exponencial. Voces usadas: `pick`, `win`, `select`, `tick`. **Arranca en silencio.** | Un juego que suena solo al abrirlo en una oficina es un juego que se cierra. |
| **Ciclo de vida** | Fases `intro → countdown → playing → paused → over`, cuenta regresiva de 3, pausa con Escape/P y al ocultar la pestaña, `AbortSignal` para force-end, y un `setHud` que **sólo dispara render si algo cambió**. | El loop corre a 60 fps; React no. |

## 3. Contrato del componente

```ts
type GameOutcome = {
  completed: boolean;          // false si se cortó por force-end
  points: number;
  durationMs: number;          // ms jugados, sin contar cuenta regresiva ni pausa
  meta?: Record<string, unknown>;
};

type GameProps = {
  config: {
    seed: string;                  // MISMA SEMILLA ⇒ MISMO TABLERO. Es todo el juego.
    durationMs: number | null;     // típicamente 90_000
    settings: Record<string, ...>; // administrables ya mezclados con los defaults
    debug: boolean;
  };
  signal: AbortSignal;         // al abortar, emitir el resultado parcial EN EL ACTO
  onFinish: (outcome: GameOutcome) => void;  // exactamente una vez
};
```

---

# ESPECIFICACIÓN FUNCIONAL

## Tablero

| | |
|---|---|
| Tamaño | **8 × 8** (administrable, 6–10 en cada eje) |
| Tipos de ficha | **6**, con **color y forma** propios (administrable, 4–6) |
| Celda | **80 px** |
| Mundo de diseño | `cols·80` de ancho × `76 + rows·80 + 22` de alto (8×8 ⇒ **640 × 738**) |
| Franja superior | 76 px de aire para que el HUD no se apoye sobre la primera fila |
| Franja inferior | 22 px, donde va la barra del reloj |
| Movimiento | intercambiar dos fichas **adyacentes** (Manhattan = 1) |
| Válido | sólo si genera al menos una línea de 3+ (más las excepciones de las especiales) |
| Combinación | 3 o más en línea, horizontal o vertical |
| Fin | por tiempo (`durationMs`), o si un rebarajado no logra destrabar el tablero |

## Representación

Arrays tipados dimensionados **una sola vez**, nunca objetos por celda:

```ts
export const EMPTY_TILE = -1;   // hueco; sólo existe entre el borrado y el derrumbe

export const SPECIAL_NONE  = 0;
export const SPECIAL_ROW   = 1; // rayo horizontal: limpia su fila
export const SPECIAL_COL   = 2; // rayo vertical: limpia su columna
export const SPECIAL_BOMB  = 3; // bomba: limpia un bloque alrededor
export const SPECIAL_PRISM = 4; // prisma: limpia todas las fichas de un color

export type Board = {
  cols: number;
  rows: number;
  typeCount: number;
  tiles: Int8Array;      // tipo por celda, o EMPTY_TILE
  specials: Uint8Array;  // constante SPECIAL_* por celda
  fallFrom: Int8Array;   // filas que cayó cada ficha en el último derrumbe (sólo dibujo)
};
```

`indexOf(board, x, y) = y·cols + x`. Todo el juego trabaja con índices planos.

## Generación del tablero inicial

**El tablero inicial no puede tener combinaciones ya hechas ni quedar sin movimientos
posibles.** Y la corrección tiene que ser idéntica en todos los clientes.

```ts
/**
 * True si poner ese tipo en (x, y) cerraría una línea de 3 con lo YA escrito.
 *
 * Se apoya en el orden de llenado (columnas de izquierda a derecha, filas de
 * abajo hacia arriba): al llegar a una celda, las dos de su izquierda y las dos
 * de abajo ya están definidas. Como toda línea de 3 tiene una celda que se
 * escribe última, mirar sólo hacia atrás alcanza.
 */
function wouldCloseRun(board: Board, x: number, y: number, type: number): boolean {
  if (x >= 2 && tiles[y*cols + x-1] === type && tiles[y*cols + x-2] === type) return true;
  if (y + 2 < rows && tiles[(y+1)*cols + x] === type && tiles[(y+2)*cols + x] === type) return true;
  return false;
}
```

`fillBoardWithoutMatches(board, rng)` recorre **columna por columna de izquierda a
derecha, y dentro de cada una de abajo hacia arriba**, y por cada celda:

- **consume exactamente UNA tirada** `rng.int(0, typeCount - 1)`;
- si el tipo sorteado cerraría una línea, **avanza al siguiente tipo módulo `typeCount`**
  hasta encontrar uno que no la cierre — **no vuelve a tirar**.

> **Esto último es la parte que se hace mal.** Si en vez de avanzar se reintenta con una
> tirada nueva, la cantidad de tiradas depende del tablero, y dos clientes con la misma
> semilla divergen apenas uno reintente una vez más que el otro.

`generateSolvableBoard(board, rng, rules)` llama a `fillBoardWithoutMatches` hasta que
`hasAnyMove()` sea verdadero, con un tope de **64 intentos**, y devuelve los intentos
consumidos. **Es también el rebarajado**: cuando el tablero se traba durante la partida
se llama a esto con el **mismo generador sembrado**, así el tablero nuevo también sale
idéntico para todos.

## Legalidad de un intercambio

```ts
export function isLegalSwap(board, a, b, specialsEnabled): boolean {
  if (fuera de rango) return false;
  if (!areAdjacent(cols, a, b)) return false;          // |dx| + |dy| === 1

  if (specialsEnabled) {
    if (alguna de las dos es PRISM) return true;       // el prisma se activa contra todo
    if (las dos son especiales)     return true;       // dos especiales se encadenan
  }

  applySwap(board, a, b);
  const legal = formsRunAt(board, a) || formsRunAt(board, b);
  applySwap(board, a, b);                              // se deshace: el tablero queda igual
  return legal;
}
```

`formsRunAt(board, index)` cuenta hacia los dos lados en horizontal y en vertical y
devuelve si alguna corrida llega a 3.

`findMove(board, specialsEnabled, out: Int32Array)` recorre `y` externo, `x` interno, y
prueba primero el vecino de la derecha y después el de abajo; escribe el par en `out` y
devuelve `true`. `hasAnyMove()` es `findMove` con un **`Int32Array(2)` de módulo**
reusado, para no asignar un par por consulta (y se consulta seguido).

`hashBoard(board)` es un FNV-1a sobre `tiles` y `specials`. Es lo que se compara para
verificar el determinismo, y viaja en el `outcome`.

## Detección de líneas

`scanRuns` registra **todas las corridas máximas de 3 o más**, primero las horizontales
(recorriendo filas y saltando de corrida en corrida) y después las verticales. Por cada
corrida guarda `runStart`, `runLen`, `runDir` (0 horizontal, 1 vertical) y un flag
`runCrossed`; y por cada celda guarda a qué corrida horizontal (`hRunOf`) y a qué
corrida vertical (`vRunOf`) pertenece, o `-1`.

Ese doble índice es lo que después permite detectar los cruces (L y T) en una pasada.

## Piezas especiales

| Se forma con | Pieza | Qué hace |
|---|---|---|
| 4 en línea | **Rayo** | limpia la fila o la columna, **perpendicular a la línea que lo formó** |
| Cruce de dos líneas (L o T) | **Bomba** | limpia un bloque de radio `bombRadius` (por defecto 3×3) |
| 5 o más en línea | **Prisma** | limpia todas las fichas de un color |

**El rayo limpia perpendicular a su línea.** Si limpiara su propia fila estaría barriendo
el lugar que acaba de quedar vacío y no serviría de nada. Entonces: una corrida
**horizontal** de 4 deja un `SPECIAL_COL`, y una **vertical** de 4 deja un `SPECIAL_ROW`.

Orden de `decideSpawns` (importa):

1. **Primero los cruces.** Se recorren las corridas horizontales; para cada una se busca
   la primera celda que además pertenezca a una corrida vertical. Si la hay: nace una
   **bomba** en esa celda, y **las dos corridas quedan marcadas como cruzadas** (una L o
   T pesa más que la longitud y consume ambas líneas).
2. **Después las longitudes.** Cada corrida **no cruzada** de largo ≥ 4 deja una pieza:
   `PRISM` si el largo es ≥ 5, si no el rayo perpendicular.

**Dónde nace la especial:** en la celda que el jugador movió, si es parte de la línea; si
no, en el medio de la corrida. Poner la ficha nueva bajo el dedo hace que se entienda de
dónde salió sin tener que explicarlo.

Las especiales se registran en una lista de spawns (índice, tipo de especial, y el
**color de la ficha que había ahí**), sin duplicar índices.

### Intercambio de dos especiales

No hace falta línea: se activan entre ellas.

- **Dos prismas** juntos → se marca **el tablero entero**.
- **Un prisma** con cualquier otra ficha → el prisma toma **el color de lo que se le puso
  al lado** (`prismTarget`), y se marcan las dos celdas del intercambio.
- **Dos especiales cualesquiera** → se marcan las dos celdas, y la propagación se encarga
  del resto.

### Propagación (`expandSpecials`)

Una cola FIFO. Marcar una celda que tiene una especial **la encola**; cada especial que
estalla marca celdas que pueden tener otras especiales, que se encolan a su vez: así
encadenan solas, sin recursión.

| Especial | Qué marca |
|---|---|
| `SPECIAL_ROW` | toda su fila |
| `SPECIAL_COL` | toda su columna |
| `SPECIAL_BOMB` | el bloque `[y-r, y+r] × [x-r, x+r]`, recortado al tablero |
| `SPECIAL_PRISM` | todas las celdas cuyo tipo sea `prismTarget` si fue declarado, o el suyo propio |

Cada especial que se desencola incrementa `specialsUsed`, que es lo que después paga
`specialPoints`.

## El paso de cascada, partido en dos

Esto no es un capricho de diseño: es lo que permite **animar el estallido** sin duplicar
la lógica, y lo que permite a los tests leer el resultado sin ruido.

```ts
/** Primera mitad: decide QUÉ se limpia y qué especiales nacen. NO toca el tablero. */
beginClear(board, work, rules, preferA, preferB): number   // devuelve cuántas se limpian

/** Segunda mitad: borra lo marcado, escribe las especiales y derrumba. */
finishClear(board, work, rng): void
```

`preferA`/`preferB` son las celdas del intercambio que disparó el paso, o `-1` en las
cascadas encadenadas. `beginClear` devuelve `0` cuando el tablero está estable.

Orden interno de `beginClear`:

```
1. resetWork(work)          // limpia buffers; prismTarget se llena con -1
2. scanRuns(board, work)
3. marcar todas las celdas de todas las corridas
4. decideSpawns(...)        // cruces primero, longitudes después
5. si preferA >= 0 y preferB >= 0 → markSwapCombo(...)   // el combo de especiales
6. expandSpecials(...)      // la cola: las especiales encadenan
7. devolver work.clearedCount
```

Orden interno de `finishClear`:

```
1. por cada celda marcada → tiles = EMPTY_TILE, specials = SPECIAL_NONE
2. por cada spawn → tiles = el color guardado, specials = la especial
   (se escriben DESPUÉS del borrado: nacen en una celda que acaba de limpiarse
    y sobreviven al derrumbe cayendo como cualquier ficha)
3. collapseAndRefill(board, rng)
```

## Gravedad y relleno

**El orden de consumo del generador es el contrato.** Cambiarlo rompe la comparabilidad
entre jugadores.

```
por cada columna x, de izquierda a derecha:
    write = rows - 1
    por cada y de rows-1 hacia 0:                  // de abajo hacia arriba
        si tiles[y][x] es EMPTY_TILE → seguir
        si write !== y:
            mover la ficha (tipo y especial) a la fila write
            fallFrom[destino] = write - y          // cuántas filas cayó, sólo para el dibujo
            dejar el origen vacío
        write--
    holes = write + 1                              // los huecos que quedaron arriba
    por cada y de write hacia 0:
        tiles[y][x] = rng.int(0, typeCount - 1)    // ← LA ÚNICA tirada del relleno
        specials[y][x] = SPECIAL_NONE
        fallFrom[y][x] = holes                     // todas las nuevas caen lo mismo:
                                                   // se leen como un bloque
```

## Puntaje

```ts
export function cascadePoints(clearedTiles, specialsUsed, level, rules): number {
  const base = clearedTiles * rules.pointsPerTile + specialsUsed * rules.specialPoints;
  return Math.round(base * (1 + level * rules.cascadeMultiplier));
}
```

`level` es **0** en la combinación que hizo el jugador y crece de a uno en cada eslabón
de la cascada. Con los defaults (20 por ficha, 150 por especial, ×0,5 por nivel), el
segundo eslabón vale una vez y media y el tercero el doble: **es lo que hace que una
jugada pensada valga varias veces una cualquiera**. Con el multiplicador en 0, encadenar
deja de rendir y el juego pierde su decisión.

## Resolución completa

```ts
resolveCascades(board, work, rules, rng, swapA, swapB, out): CascadeReport
```

Encadena pasos hasta que el tablero queda estable, con un tope de seguridad de **64
niveles** (una cascada real no pasa de unos pocos). En el nivel 0 pasa `swapA`/`swapB`
como celdas preferidas; en los siguientes pasa `-1`. Acumula `points`, `levels`,
`cleared` y `specials` en un `CascadeReport` reusado.

```ts
applyMove(board, work, rules, rng, a, b, out): boolean
```

Un movimiento completo del jugador. Devuelve `false` y **deja el tablero intacto** si el
intercambio no era legal: un intento inválido no cuesta nada.

`resolveCascades` es la versión **sin animación** de lo que hace el componente frame a
frame. Las dos recorren las **mismas primitivas en el mismo orden**, así que una partida
jugada a mano y una simulada en un test terminan igual. Si esto deja de ser cierto, el
juego perdió su propiedad principal.

---

# LA MÁQUINA DE FASES DEL COMPONENTE

Cuatro fases y un temporizador. El componente **no decide nada del juego**: sólo estira
en el tiempo lo que `logic.ts` resuelve de una.

| Fase | Duración base | Qué pasa al terminar |
|---|---|---|
| `IDLE` | — | si hay un movimiento encolado, lo toma y pasa a `SWAP` |
| `SWAP` | **150 ms** (el doble si es inválido) | si era válido: aplica el intercambio, `moves++`, `level = 0`, y arranca el `CLEAR`. Si no: vibra 8 ms y vuelve a `IDLE` |
| `CLEAR` | **210 ms** | `finishClear` (borra, escribe especiales y derrumba) → `FALL` |
| `FALL` | **280 ms** | `level++` y vuelve a intentar un `CLEAR`; si no hay nada que limpiar, `IDLE` |

Las tres duraciones se multiplican por
`factor = (reducedMotion ? 0.5 : 1) / animationSpeed`.

**El intercambio inválido dura el doble porque la animación va y vuelve.** No penaliza:
el tablero ni se entera, sólo se ve que las fichas no se quedan.

## Entrada

- **Deslizar** es el gesto principal: apenas el dedo se corre más de **0,34 de celda**
  (27 px con celda de 80), se decide el vecino por el eje dominante y **se suelta el
  gesto sin esperar a que levante el dedo**. Es más rápido y natural en teléfono.
- **Tocar y volver a tocar** también funciona, para quien lo prefiera: el primer toque
  selecciona (y suena `select`), el segundo sobre una vecina intercambia.
- **Durante una cascada la entrada se encola, no se descarta.** Se guarda en
  `pendingA`/`pendingB` y se ejecuta cuando el tablero vuelve a `IDLE`. Perder un
  movimiento porque el tablero estaba animando se siente roto.

## Tablero trabado

Al volver a `IDLE` se consulta `hasAnyMove()`. Si no quedan movimientos:

1. Se rebaraja con `generateSolvableBoard` usando **el generador sembrado** (así el
   tablero nuevo también es el mismo para todos los que comparten semilla).
2. Si aun así no hay movimientos → `finish(true)`: la partida termina.
3. Si los hay: `fallFrom` se llena con `rows` (todas las fichas entran cayendo desde
   arriba, se lee como un tablero nuevo), `shuffles++`, se muestra el aviso **"Sin
   jugadas: tablero nuevo"** durante 1,5 s, suena `tick`, y se entra en `FALL`.

---

# ADMINISTRABLES

El juego publica un schema declarativo; el panel lo recorre y dibuja el control que
corresponda. Es también la fuente de los defaults y lo que sanea lo guardado.

| Grupo | Clave | Label | Default | Rango | Paso | Unidad |
|---|---|---|---|---|---|---|
| Tablero | `cols` | Columnas del tablero | **8** | 6–10 | 1 | — |
| Tablero | `rows` | Filas del tablero | **8** | 6–10 | 1 | — |
| Tablero | `typeCount` | Tipos de ficha | **6** | 4–6 | 1 | — |
| Puntaje | `pointsPerTile` | Puntos por ficha | **20** | 5–100 | 5 | — |
| Puntaje | `cascadeMultiplier` | Multiplicador de cascada | **0.5** | 0–1.5 | 0.1 | × |
| Puntaje | `specialPoints` | Puntos por especial usada | **150** | 0–400 | 25 | — |
| Piezas especiales | `specialsEnabled` | Piezas especiales | **true** | toggle | — | — |
| Piezas especiales | `bombRadius` | Radio de la bomba | **1** | 1–3 | 1 | celdas |
| Ritmo | `animationSpeed` | Velocidad de las animaciones | **1** | 0.5–2 | 0.1 | × |
| Rendimiento | `maxParticles` | Partículas máximas | **220** | 0–300 | 20 | — |

Textos de ayuda que vale la pena mantener, porque explican **por qué** existe el número:

- `rows`: "Un tablero más chico deja menos jugadas y sube el ritmo."
- `typeCount`: "Cada tipo tiene forma y color propios. Con menos tipos, las combinaciones
  salen solas."
- `cascadeMultiplier`: "Cuánto suma cada cascada encadenada. En 0 pensar la jugada deja de
  rendir."
- `specialsEnabled`: "Rayo con 4 en línea, bomba con 5 en L o T, prisma con 5 en línea."
- `bombRadius`: "En 1 la bomba arrasa un bloque de 3×3. En 3 se lleva medio tablero."
- `animationSpeed`: "Más rápido se juegan más movimientos, pero cuesta seguir qué se
  movió."
- `maxParticles`: "Bajalo si el celular no llega a 60 fps. No cambia ninguna regla."

> **Advertencia que va en el panel:** todo lo que cambie el tablero (tamaño y cantidad de
> tipos) altera la partida de **todos** los que juegan con la misma semilla. Se toca
> antes de la sesión, no durante.

---

# PRESENTACIÓN Y GAME FEEL

Todo es forma geométrica dibujada con Canvas 2D: **cero assets**.

## Las seis fichas

**Cada tipo tiene color Y forma propios, nunca sólo color.** El color solo no alcanza
para quien no lo distingue, y el criterio es que **se lean en escala de grises**.

| Tipo | Forma | Token de color |
|---|---|---|
| 0 | círculo / elipse | `--sn-cyan-400` |
| 1 | rombo | `--sn-magenta-400` |
| 2 | hexágono | `--sn-violet-400` |
| 3 | triángulo | `--sn-success` |
| 4 | cuadrado redondeado | `--sn-warn` |
| 5 | estrella de 5 puntas | `--sn-text` |

Los vértices del hexágono (6) y de la estrella (10, alternando radio 1 y 0,46) se
**precalculan en `Float32Array` al iniciar**, arrancando en `-π/2` para que la punta
quede arriba.

Cada ficha se dibuja en tres pasadas, con **colores precalculados** — armar un
`CanvasGradient` por ficha y por frame sería basura garantizada:

1. **Sombra**: la misma forma 3 px más abajo, con el color mezclado 55 % contra el fondo.
2. **Relleno**: el color del tipo.
3. **Brillo**: la forma reducida (`rx·0.52`, `ry·0.42`) desplazada a `cy - ry·0.26`, con
   el color mezclado 45 % contra el texto y `alpha 0.55`.

Radio base de la ficha: `CELL · 0.33`.

## Las especiales

Se marcan **con un trazo, no sólo con brillo**: se leen de un vistazo y también en escala
de grises. Trazo de 3 px en `--sn-text`, con un pulso de opacidad
`0.75 + sin(elapsedMs · 0.006) · 0.25` (fijo en `0.9` con reduced-motion).

| Especial | Marca |
|---|---|
| `SPECIAL_ROW` | dos líneas horizontales a `±0.3·r`, de ancho `2.3·r` |
| `SPECIAL_COL` | dos líneas verticales a `±0.3·r`, de alto `2.3·r` |
| `SPECIAL_BOMB` | un anillo de radio `1.12·r` |
| `SPECIAL_PRISM` | anillo de `1.12·r` + anillo interior de `0.5·r` |

## Animaciones

El progreso de la fase se calcula **interpolado con el `alpha` del loop**, para que la
caída se vea continua aunque la simulación vaya a pasos fijos:

```ts
const STEP_MS = 1000 / 60;
const t = phaseMs > 0 ? clamp01(1 - (timer - alpha * STEP_MS) / phaseMs) : 1;
```

- **Intercambio válido:** las dos fichas se desplazan a la posición de la otra con
  `easeOutCubic(t)`.
- **Intercambio inválido:** `k = t < 0.5 ? t·2 : (1-t)·2` — las fichas se asoman y
  regresan solas.
- **Estallido:** la ficha crece a `1.15×` en el primer 30 % de la fase y después se
  encoge hasta desaparecer.
- **Caída:** `cy -= fallFrom · CELL · (1 - easeOutCubic(t))`, más un **rebote corto al
  aterrizar** en el último 28 % de la fase: `land = sin(((t-0.72)/0.28)·π)`, que ensancha
  la ficha un 16 % y la achata un 20 %. Es lo que hace que el tablero se sienta físico en
  vez de teletransportado. Con reduced-motion el rebote se apaga, la caída no.
- **Sacudida:** 180 ms de `±5 px` cuando el paso usó alguna especial. Nunca con
  reduced-motion.

## Partículas

Pool de `maxParticles` (220 por defecto), **4 por ficha limpiada** (1 con reduced-motion,
0 si el administrable está en 0). Salen del centro de cada celda marcada, con ángulo y
velocidad del **generador de efectos** (`seed + "-fx"`, nunca el sembrado):

- ángulo uniforme, velocidad `80 + rnd·240`, más un empujón de `-70` en Y;
- vida `340 + rnd·280` ms, tamaño `3 + rnd·4`, gravedad `1100 px/s²`;
- se dibujan como círculos del color del tipo, con `alpha = life / maxLife`.

## Cascadas, aviso y reloj

- **Multiplicador de cascada:** a partir del segundo eslabón aparece `×N` en el centro del
  tablero, en magenta, durante 750 ms, **cada vez más grande** (fuentes precalculadas de
  56, 66, 76, 86 y 96 px). Las etiquetas `×1..×12` también se precalculan: armar un
  string por frame es asignar.
- **Aviso de rebarajado:** `"Sin jugadas: tablero nuevo"` en `--sn-warn`, arriba del
  tablero, 1,5 s.
- **Reloj como barra** de 6 px pegada abajo del tablero, que se consume de izquierda a
  derecha. Los últimos **10 segundos** pasan de cyan a magenta: es lo que se ve sin dejar
  de mirar el tablero.

## Fondo y grilla

Panel del tablero con `roundRect` de radio 18 en `--sn-panel`, y la grilla entera
—todas las verticales y todas las horizontales— **en un solo `Path2D`**: dos draw calls
para las 64 celdas. La celda seleccionada se marca con un `roundRect` de 3 px en
`--sn-cyan-400`.

## `prefers-reduced-motion`

En un match-3 **la animación comunica la mecánica**: quitarla del todo deja el tablero
ilegible. Entonces se **acorta, no se elimina**:

- las tres duraciones se multiplican por 0,5, pero **siguen existiendo**;
- sin rebote al aterrizar y sin sacudida;
- 1 partícula por ficha en vez de 4;
- el pulso de las especiales queda fijo.

## Sonido y vibración

| Evento | Sonido | Vibración |
|---|---|---|
| Seleccionar una ficha | `select` | — |
| Intercambio válido | `select` | — |
| Intercambio inválido | `tick` | `8` |
| Limpieza del jugador (nivel 0) | `pick` | `10` |
| Cascada encadenada (nivel > 0) | `win` | `20` |
| Rebarajado | `tick` | — |

---

# HUD Y ESTADOS

El HUD va en **DOM** encima del canvas, con `aria-live="polite"`, `data-game-ui` para que
el input lo ignore, y números tabulares para que el score no tiemble.

- **Puntos** — el dominante, cyan.
- **Cascada** — `×N`, magenta, **sólo cuando es mayor que 1**.
- **Jugadas**.
- **Rebarajadas** — en `warn`, **sólo si hubo alguna**.
- **Tiempo** — magenta en los últimos 10 segundos.
- **fps** — sólo con `config.debug`.

El HUD se actualiza **por evento, no por frame**: se empuja un patch al empezar cada
limpieza, al rebarajar y al volver a `IDLE`.

Estados: `intro` (instrucciones + "Jugar"), `countdown` (3 s), `playing`, `paused`
(Escape/P), `over` (resumen + "Jugar de nuevo").

- Instrucciones, texto exacto: *"Deslizá una ficha hacia su vecina para alinear tres o
  más. Todos juegan el mismo tablero, así que el puntaje se compara de verdad."*
- Resumen: *"N puntos en M jugadas"*, con la línea *"Todos jugaron este mismo tablero: el
  ranking compara cabezas, no suerte."*

---

# CONTRATO DE SALIDA

```ts
onFinish({
  completed,
  points: scene.points,
  durationMs,
  meta: {
    movimientos: scene.moves,
    fichas: scene.clearedTotal,
    especiales: scene.specialsTotal,
    mejorCascada: scene.bestCascade,
    rebarajadas: scene.shuffles,
    // La huella del tablero final es lo que permite verificar AFUERA que dos
    // jugadores con la misma semilla jugaron el mismo tablero.
    tablero: hashBoard(scene.board),
  },
});
```

---

# PERFORMANCE

| | |
|---|---|
| Objetivo | **60 fps en celular de gama media** |
| En pantalla | 64 fichas + hasta 300 partículas |
| Draw calls | < 8 |
| Asignaciones por frame | **cero** |
| Si no llega | primero las partículas a la mitad, después el rebote de la caída |

Cómo se consigue el "cero asignaciones", que es la parte que hay que hacer bien:

- **El tablero y los buffers de trabajo son arrays tipados dimensionados una vez**, y
  todas las funciones escriben adentro. `MatchWork` (el scratch del resolvedor) se crea
  una vez y se recicla en cada paso.
- **Colores precalculados**: relleno, brillo y sombra de cada tipo se computan en el
  `init` con `mixHex`. Nunca un gradiente por frame.
- **Fuentes y etiquetas precalculadas**: las cinco fuentes del combo y los doce `×N`.
- **Vértices precalculados**: hexágono y estrella en `Float32Array`.
- **`hasAnyMove` usa un `Int32Array(2)` de módulo** en vez de devolver un par nuevo.
- **Los callbacks de los pools son funciones de módulo, no closures inline.** `pool.each`
  recibe un callback; definirlo inline sería un closure nuevo por frame, o sea basura de
  GC a 60 Hz. El precio de evitarlo son tres variables de módulo (`liveScene`, `liveDt`,
  `liveCanvas`) que se escriben antes de cada recorrido — vale la pena documentar el
  porqué, porque a primera vista parece un global gratuito: sólo hay un juego corriendo a
  la vez y las lecturas son sincrónicas dentro de la misma llamada.
- Nada de `Math.random()`, `new`, `{}`, `[]`, `.map`, `.filter` ni template literals
  dentro de `update` ni de `draw`.

---

# QUÉ NO HACER

- **No** `Math.random()` en nada que afecte el tablero.
- **No** consumir el generador sembrado para efectos visuales: divergiría el relleno.
- **No** reintentar tiradas en la generación del tablero: se avanza al tipo siguiente.
- **No** cambiar el orden de recorrido del relleno (columnas L→R, filas abajo→arriba).
- **No** mostrar un tablero inicial con combinaciones hechas o sin movimientos posibles.
- **No** distinguir fichas sólo por color.
- **No** ignorar la entrada durante las cascadas: se encola.
- **No** penalizar un intercambio inválido.
- **No** quitar toda la animación con reduced-motion: reducirla.
- **No** instanciar fichas ni sprites durante la partida.
- **No** poner reglas del juego en el componente, ni dibujo en `logic.ts`.
- **No** meter un engine sin evidencia del contador de fps.

---

# TESTS OBLIGATORIOS

Van sobre `logic.ts`, sin navegador. Hace falta un helper que arme tableros a mano desde
strings (un dígito por celda, los espacios se ignoran) y otro que cuente cuántas líneas
hay sin tocar el tablero.

**Determinismo** — el bloque que justifica el juego entero
1. La misma semilla da el mismo tablero inicial.
2. Semillas distintas dan tableros distintos.
3. **La prueba que define el juego:** dos instancias con la misma semilla y **la misma
   secuencia de movimientos** terminan con **el mismo hash de tablero y el mismo
   puntaje**. Verificar tras ~20 movimientos.
4. El relleno consume el generador **en orden fijo**: columna por columna de izquierda a
   derecha, dentro de cada una de abajo hacia arriba.

**Tablero inicial**
5. Nunca trae combinaciones ya hechas ni queda sin movimientos.
6. También cumple con tableros chicos y pocos tipos (probar 6×6 con 4 tipos).
7. No deja fichas fuera del rango `[0, typeCount)`.

**Intercambios**
8. Un intercambio que no forma línea es ilegal y **deja el tablero intacto**.
9. Rechaza celdas no adyacentes y fuera del tablero.
10. Un intercambio que forma línea es legal y limpia.

**Detección de líneas**
11. Encuentra una línea horizontal de 3.
12. Encuentra una línea vertical de 3.
13. Una L o T limpia las cinco fichas y deja una **bomba en el cruce**.
14. Cuatro en línea **horizontal** dejan un rayo **vertical**.
15. Cuatro en línea **vertical** dejan un rayo **horizontal**.
16. Cinco en línea dejan un prisma.
17. La especial nace **bajo el dedo del jugador** cuando la celda movida es parte de la
    línea.
18. Con las especiales apagadas no nace ninguna.

**Cascadas** — con un tablero armado para que la caída de una columna arme sola una
segunda línea
19. El tablero de prueba arranca sin combinaciones (si no, el test no prueba nada).
20. Un movimiento encadena dos pasos y **el segundo vale más**.
21. `resolveCascades` deja el tablero estable y reporta los niveles.
22. **Resolver paso a paso da lo mismo que resolver de una** — el test que garantiza que
    el componente animado y la lógica pura no se separan.

**Puntaje**
23. Suma base por ficha y premio por especial.
24. Cada nivel de cascada multiplica.
25. Con el multiplicador en 0, encadenar no rinde.

**Sin movimientos posibles** — con un tablero de diagonales de período 3, donde ningún
intercambio adyacente arma una línea
26. Detecta el tablero trabado (con y sin especiales).
27. Ningún intercambio del tablero trabado es legal.
28. Rebarajar con el generador sembrado lo destraba, no deja combinaciones hechas, **y es
    reproducible** (mismo hash con la misma semilla).

**Piezas especiales**
29. Un prisma se puede intercambiar con cualquier vecina.
30. El prisma limpia todas las fichas del color con el que se lo cambia.
31. Dos especiales juntas se encadenan.
32. La bomba limpia su bloque y **respeta el radio administrable**.
33. La especial que nace **sobrevive al derrumbe**.

---

# CRITERIOS DE ACEPTACIÓN

- [ ] `tsc --noEmit` en verde, en modo `strict` con `noUncheckedIndexedAccess`.
- [ ] Todos los tests de la sección anterior pasan.
- [ ] **La prueba que define el juego:** dos instancias con la misma semilla y la misma
      secuencia de movimientos terminan con tableros idénticos y el mismo puntaje,
      verificable con el hash tras 20 movimientos.
- [ ] El tablero inicial nunca tiene combinaciones hechas ni queda sin movimientos.
- [ ] Cuando no quedan movimientos, el tablero se rebaraja **con el generador sembrado** y
      se avisa en pantalla.
- [ ] Las tres piezas especiales se forman con sus patrones y hacen lo suyo; el rayo
      limpia **perpendicular** a la línea que lo formó.
- [ ] Combinar dos especiales las encadena; dos prismas limpian el tablero entero.
- [ ] Un intercambio inválido devuelve las fichas **sin penalizar**.
- [ ] Deslizar durante una cascada **encola** el movimiento en vez de descartarlo.
- [ ] Las seis fichas se distinguen **en escala de grises**.
- [ ] 60 fps con una cascada de 5 niveles y 300 partículas.
- [ ] **Cero recolecciones de basura en 90 segundos**, verificable en el perfil de memoria.
- [ ] `force-end` (abortar el `AbortSignal`) emite el outcome con el puntaje acumulado,
      **una sola vez**.
- [ ] Con `prefers-reduced-motion` las animaciones se acortan pero **siguen existiendo**.
- [ ] Al desmontar no queda ni un `requestAnimationFrame`, ni un listener, ni un
      `ResizeObserver`, ni un `AudioContext` abierto.
- [ ] El sonido arranca apagado y se puede prender desde el HUD.
- [ ] Cero errores y cero warnings en consola.

---

# ORDEN DE IMPLEMENTACIÓN

Cinco slices, cada uno verificable solo. No pasar al siguiente sin cerrar el anterior.

| # | Slice | Se cierra cuando |
|---|---|---|
| 1 | **Runtime**: loop de paso fijo, canvas con DPR y letterbox, input de puntero, PRNG, pool. | El puntero se lee en coordenadas del mundo y el loop corre a 60 fps. |
| 2 | **Tablero y detección**: representación, generación sin combinaciones, `isLegalSwap`, `findMove`, `scanRuns`, `beginClear` sin especiales, `collapseAndRefill`, `hashBoard`. | Los tests de determinismo, tablero inicial, intercambios y líneas básicas pasan. |
| 3 | **Cascadas y puntaje**: `finishClear`, `resolveCascades`, `applyMove`, `cascadePoints`. | Los tests de cascadas y puntaje pasan, incluido "resolver paso a paso da lo mismo que de una". |
| 4 | **Especiales**: `decideSpawns`, `markSwapCombo`, `expandSpecials`, rebarajado. | Los tests de especiales y de tablero trabado pasan. |
| 5 | **Juego**: componente, máquina de fases, entrada encolada, dibujo, partículas, HUD, outcome. | Los criterios de aceptación visuales y de performance. |

---

# ENTREGA

Cambios pequeños y revisables, un slice por vez. Explicá las decisiones no obvias con un
comentario que diga **por qué**, no qué.
Al terminar, listá qué quedó pendiente y por qué.

---
---

# APÉNDICE A · Tipos y API de `logic.ts`

```ts
export const EMPTY_TILE = -1;
export const SPECIAL_NONE = 0;
export const SPECIAL_ROW = 1;
export const SPECIAL_COL = 2;
export const SPECIAL_BOMB = 3;
export const SPECIAL_PRISM = 4;

export type MatchRules = {
  cols: number; rows: number; typeCount: number;
  pointsPerTile: number; specialPoints: number; cascadeMultiplier: number;
  bombRadius: number; specialsEnabled: boolean;
};

export type Board = {
  cols: number; rows: number; typeCount: number;
  tiles: Int8Array;       // tipo por celda, o EMPTY_TILE
  specials: Uint8Array;   // SPECIAL_* por celda
  fallFrom: Int8Array;    // filas que cayó cada ficha en el último derrumbe (sólo dibujo)
};

/** Buffers del resolvedor. Se crean una vez y se reciclan en cada paso. */
export type MatchWork = {
  cleared: Uint8Array;      // 1 en las celdas que se limpian en este paso
  activated: Uint8Array;    // ya encolada, para no encolar dos veces
  prismTarget: Int8Array;   // color que borra un prisma intercambiado. -1 = el suyo
  queue: Int32Array; queueHead: number; queueTail: number;
  clearedCount: number; specialsUsed: number;
  spawnIndex: Int32Array; spawnKind: Uint8Array; spawnType: Int8Array; spawnCount: number;
  hRunOf: Int32Array; vRunOf: Int32Array;   // a qué corrida pertenece cada celda, o -1
  runStart: Int32Array; runLen: Int32Array;
  runDir: Uint8Array;                        // 0 horizontal, 1 vertical
  runCrossed: Uint8Array; runCount: number;
};

export type CascadeReport = {
  points: number;
  levels: number;   // cuántos pasos encadenó el movimiento. 0 si no limpió nada
  cleared: number;
  specials: number;
};

/* Construcción */
export function createBoard(rules: MatchRules, rng: Rng): Board;
export function createWork(board: Board): MatchWork;
export function createReport(): CascadeReport;

/* Generación */
export function fillBoardWithoutMatches(board: Board, rng: Rng): void;
export function generateSolvableBoard(board: Board, rng: Rng, rules: MatchRules): number;

/* Consultas */
export function indexOf(board: Board, x: number, y: number): number;
export function areAdjacent(cols: number, a: number, b: number): boolean;
export function formsRunAt(board: Board, index: number): boolean;
export function applySwap(board: Board, a: number, b: number): void;
export function isLegalSwap(board: Board, a: number, b: number, specialsEnabled: boolean): boolean;
export function findMove(board: Board, specialsEnabled: boolean, out: Int32Array): boolean;
export function hasAnyMove(board: Board, specialsEnabled: boolean): boolean;
export function hashBoard(board: Board): number;

/* Resolución */
export function beginClear(
  board: Board, work: MatchWork, rules: MatchRules,
  preferA: number, preferB: number,
): number;
export function collapseAndRefill(board: Board, rng: Rng): void;
export function finishClear(board: Board, work: MatchWork, rng: Rng): void;
export function cascadePoints(
  clearedTiles: number, specialsUsed: number, level: number, rules: MatchRules,
): number;
export function resolveCascades(
  board: Board, work: MatchWork, rules: MatchRules, rng: Rng,
  swapA: number, swapB: number, out: CascadeReport,
): CascadeReport;
export function applyMove(
  board: Board, work: MatchWork, rules: MatchRules, rng: Rng,
  a: number, b: number, out: CascadeReport,
): boolean;

/* Topes de seguridad */
const MAX_CASCADE_LEVELS = 64;       // una cascada real no pasa de unos pocos niveles
const MAX_GENERATION_ATTEMPTS = 64;  // reintentos antes de aceptar un tablero trabado
```

---

# APÉNDICE B · El estado de escena del componente

Lo que el componente guarda además del tablero. Todo se crea en el `init` y no vuelve a
asignarse:

```ts
type Scene = {
  board: Board; work: MatchWork; rules: MatchRules;
  fx: Rng;                     // generador APARTE para los efectos: seed + "-fx"
  particles: Pool<Particle>;

  phase: number;               // IDLE | SWAP | CLEAR | FALL
  timer: number;               // ms que le quedan a la fase
  phaseMs: number;             // duración total de la fase, para calcular el progreso
  level: number;               // nivel de cascada del paso en curso

  swapA: number; swapB: number; swapValid: boolean;
  pendingA: number; pendingB: number;   // movimiento encolado durante una cascada
  selected: number;                     // ficha seleccionada por toque
  pressIndex: number; pressX: number; pressY: number;

  points: number; moves: number; clearedTotal: number;
  specialsTotal: number; bestCascade: number; shuffles: number;

  comboMs: number; comboLevel: number;  // el ×N flotante
  noticeMs: number;                     // el aviso de rebarajado
  shakeMs: number;

  durationMs: number | null;
  swapMs: number; clearMs: number; fallMs: number;   // ya escaladas por animationSpeed
  particlesPerTile: number;

  boardX: number; boardY: number; boardW: number; boardH: number;

  fill: string[]; glow: string[]; shade: string[];   // colores precalculados por tipo
  hexX: Float32Array; hexY: Float32Array;            // vértices precalculados
  starX: Float32Array; starY: Float32Array;
  comboFonts: string[]; comboLabels: string[]; noticeFont: string;
};
```

Constantes del componente:

```ts
const CELL = 80;
const TOP = 76;        // aire para el HUD
const BOTTOM = 22;     // franja del reloj
const SWAP_MS = 150;
const CLEAR_MS = 210;
const FALL_MS = 280;
const REDUCED_FACTOR = 0.5;
const STEP_MS = 1000 / 60;
const DRAG_RATIO = 0.34;   // fracción de celda para que cuente como deslizar
const WARNING_MS = 10_000; // los últimos diez segundos del reloj
```

---

# APÉNDICE C · Desvíos respecto de la guía original

El proyecto de origen tiene una guía escrita antes de implementar (`M1-MATCH3.md`). Dos
cosas quedaron distintas a propósito; si el proyecto destino sigue la guía en vez de este
prompt, va a obtener otro juego.

1. **Motor.** La guía pedía PixiJS; la implementación quedó en **Canvas 2D**, por el
   motivo explicado arriba. El campo `engine` del catálogo se corrigió a `canvas2d` para
   que no mienta.
2. **Fórmula del puntaje.** La guía proponía un bono aditivo por cascada
   (`nivel · 50`). La implementación usa un **multiplicador**:
   `round((fichas·pointsPerTile + especiales·specialPoints) · (1 + nivel·cascadeMultiplier))`.
   Es la que quedó administrable y la que hay que implementar; el bono aditivo no escala
   con el tamaño de la limpieza y hacía que una cascada grande valiera lo mismo que una
   chica.

---

# APÉNDICE D · Mapa del proyecto de origen

Si el proyecto destino prefiere copiar en vez de reescribir. Los de `core/` son
genéricos: sirven para cualquier juego 2D, no sólo para éste.

| Archivo | Qué es | ¿Portable tal cual? |
|---|---|---|
| `src/games/combinaciones/logic.ts` | El juego entero (~700 líneas) | **Sí.** Sólo depende del tipo `Rng`. |
| `src/games/combinaciones/logic.test.ts` | Los 33 tests (~550 líneas) | **Sí.** |
| `src/games/combinaciones/settings.ts` | El schema de administrables | Sí, si el destino tiene un panel equivalente; si no, hardcodear los defaults. |
| `src/games/combinaciones/CombinacionesGame.tsx` | Escena, fases, input, dibujo, HUD (~890 líneas) | Depende del runtime y del `GameStage` del destino. |
| `src/core/engine/loop.ts` | Loop de paso fijo con render interpolado | **Sí**, tal cual. |
| `src/core/engine/canvas.ts` | Escalado, DPR, letterbox, `toWorld` | **Sí**, tal cual. |
| `src/core/engine/input.ts` | Puntero, multitouch, swipe, teclado | **Sí**, tal cual. |
| `src/core/engine/rng.ts` | PRNG sembrado — **la pieza crítica** | **Sí**, tal cual. Si se cambia el algoritmo, cambian todos los tableros. |
| `src/core/engine/pool.ts` | Object pool | **Sí**, tal cual. |
| `src/core/engine/palette.ts` | Tokens CSS cacheados, `mixHex`, `prefersReducedMotion` | Sí, cambiando la lista de tokens. |
| `src/core/engine/audio.ts` | WebAudio, seis voces sintetizadas, `vibrate` | **Sí**, tal cual. |
| `src/core/engine/useGameLifecycle.ts` | Fases, cuenta regresiva, force-end, HUD, mute | Sí, si el destino usa React. |
| `src/core/engine/useGame2D.ts` | Une lo anterior: `init` / `update` / `draw` / `outcome` | Sí, si el destino usa React. |
| `src/ui/game/GameStage.tsx` | Canvas + HUD + los estados de partida | Reescribir con el design system del destino. |
| `src/styles/tokens.css` | Los tokens de color | Reemplazar por los del destino. |
| `games-guide/M1-MATCH3.md` | La guía original | Referencia, con los desvíos del apéndice C. |

**Última advertencia.** Si el proyecto destino cambia el PRNG, el orden de recorrido del
relleno, o la forma de corregir el tablero inicial, el juego va a **funcionar igual y ser
otro**: los tableros no van a coincidir con los del proyecto de origen. Eso está bien
mientras sea una decisión y no un accidente — pero los tests de determinismo tienen que
seguir en verde dentro del proyecto nuevo.
