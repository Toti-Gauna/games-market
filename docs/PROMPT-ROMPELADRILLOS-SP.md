# Prompt maestro · Rompeladrillos, un jugador (portable)

> **Qué es este archivo.** El prompt autocontenido para implementar Rompeladrillos —el
> Breakout de paleta partida— **en versión de un jugador**, en otro proyecto, sin tener
> acceso a este código. Todo lo que hace falta —reglas, números, algoritmos de colisión,
> los cinco niveles, tests y criterios de aceptación— está escrito acá.
>
> **Cómo usarlo.** Copiá el archivo entero, desde `# ROL` hasta el final, y pegalo como
> prompt en Claude Code, Codex, Cursor o Copilot. No necesita nada más.
>
> **Origen.** `src/games/rompeladrillos/` de `juegos-supernova` (guía
> `games-guide/R5-ROMPELADRILLOS.md`). **El original es cooperativo de dos celulares**;
> el apéndice D explica exactamente qué se sacó y qué se conservó para llegar a esta
> versión. El apéndice E mapea archivo por archivo.

---

# ROL

Actuá como **Game-arquitect**: agente arquitecto de videojuegos web.
Priorizá simplicidad, vertical slicing, game feel y performance.
Usá el stack más chico que resuelva el juego. Primero loop jugable, después polish.
Leé los archivos antes de modificarlos y explicá las decisiones no obvias.

Este juego tiene un bug clásico del género que hay que evitar desde la primera línea (el
túnel de la pelota) y una mecánica que lo define (la paleta partida). Las dos tienen
secciones propias más abajo y no son negociables.

---

# OBJETIVO

Implementar **Rompeladrillos**: un Breakout con una vuelta que lo convierte en otra cosa —
**la paleta está partida al medio**, y si las dos mitades se separan queda un **hueco por el
que la pelota se cae**.

En esta versión **juega una sola persona y maneja las dos mitades**. Toda la tensión del
juego sigue en pie:

- **Juntas** cubren poco espacio pero no dejan hueco.
- **Separadas** cubren todo el ancho pero con un agujero en el medio.

Cada vez que estirás una mitad para llegar a la pelota, abrís el hueco por el que la vas a
perder después. Ese es el juego.

Cinco niveles, tres vidas, sin red, sin backend. Termina emitiendo un `outcome` que el
contenedor guarda o muestra.

---

# CORE LOOP

El jugador **mueve las dos mitades de la paleta** para devolver la pelota, la pelota
**rompe ladrillos**, algunos ladrillos **sueltan cápsulas** que cambian las reglas, y al
limpiar el tablero **arranca el nivel siguiente**, más difícil.

- **Gana** limpiando los cinco niveles.
- **Pierde** cuando se acaban las tres vidas (o cuando se acaba el tiempo, si el
  contenedor fijó duración).
- **La decisión constante** es cuánto abrir el hueco: estirarse llega más lejos, pero el
  medio queda descubierto. La correa entre las dos mitades impide separarlas del todo.

---

# PLATAFORMA Y STACK

- **Plataforma:** web, escritorio y móvil, orientación apaisada.
- **Render:** **Canvas 2D**. Nada más.
- **Lenguaje:** TypeScript en modo `strict`, con `noUncheckedIndexedAccess`.
- **UI/HUD:** React 19 (o el framework del destino). El HUD va en **DOM** encima del
  canvas, **nunca** dibujado adentro.
- **Tests:** Vitest (o el runner del destino), sin navegador.

**No usar:**

- **No** motor de física. La pelota es un círculo, todo lo demás son cajas, y el barrido
  se resuelve con 40 líneas de geometría.
- **No** engine de render (Pixi/Phaser): son 112 rectángulos y un círculo.
- **No** red, ni salas, ni mandos, ni bots. Esta versión es de un jugador **local**.
- **No** delta variable: el paso de simulación es fijo y **es 1/120**, no 1/60.
- **No** colisión discreta ("¿está la pelota adentro del ladrillo?").
- **No** assets de imagen ni de sonido: todo se dibuja y se sintetiza.

---

# ARQUITECTURA OBLIGATORIA

## 1. La lógica va separada de React y del canvas

```
rompeladrillos/
  logic.ts        # el juego entero: sin React, sin canvas, sin DOM. Testeable en Node.
  logic.test.ts   # los tests de logic.ts
  settings.ts     # el schema de administrables
  RompeladrillosGame.tsx  # escena, input, efectos, dibujo, HUD. Cero reglas.
```

**Regla dura:** el componente **no decide nada del juego**. Lee el input, lo traduce a una
posición normalizada por mitad, corre la simulación, y dibuja. Todo lo que decide qué pasa
vive en `logic.ts`, y por eso se puede testear la física entera sin navegador.

## 2. El runtime mínimo que el juego necesita

Si el proyecto destino ya tiene estas piezas, **usalas**. Si no, implementalas con
exactamente este contrato.

| Pieza | Contrato | Por qué |
|---|---|---|
| **Loop de paso fijo** | `createLoop(update: (dt) => void, render: (alpha) => void, { step })` con `dt` constante, acumulador, tope de `0.25 s` por frame. | La simulación tiene que ser independiente del hardware; el barrido trabaja sobre tramos de largo conocido. |
| **Canvas escalado** | `setupCanvas(canvas, { designWidth, designHeight, maxDpr })` → `{ ctx, toWorld(clientX, clientY), dispose() }`. Letterbox conservando aspecto, `setTransform` una vez por layout. | El juego dibuja en 1600×900 y no se entera del tamaño real. `toWorld` convierte el dedo en una posición del mundo. |
| **DPR topeado** | `min(devicePixelRatio, 1.5)` en puntero grueso, `2` en escritorio. | Renderizar a 3× es la forma más rápida de perder frames. |
| **Input con multitouch** | `createInput(container, { toWorld })` → `state.pointer` (el primer dedo) **y `state.pointers[]` (todos los dedos vivos, con `id`, `x`, `y`, `startX`, `startY`)**, más `state.keys`. `endFrame()` limpia los flags. Ignora los eventos cuyo `target.closest("[data-game-ui]")` exista. | **`pointers[]` no es opcional acá**: el control de las dos mitades con dos dedos depende de él. |
| **PRNG sembrado** | `createRng(seed)` → `{ next, range, int, chance }`. FNV-1a + mulberry32. | Con la misma semilla, las cápsulas caen siempre de los mismos ladrillos y el bug se reproduce. |
| **Paleta** | `readPalette()` lee los tokens CSS una vez y cachea. `withAlpha(hex, a)` **precalculado fuera del loop**. | Armar un color por frame es basura de GC. |
| **Audio** | WebAudio a mano. Voces usadas: `hit`, `tick`, `select`, `pick`, `win`, `lose`. **Arranca en silencio.** | — |
| **Ciclo de vida** | Fases `intro → countdown → playing → paused → over`, cuenta regresiva de 3, `AbortSignal` para force-end, `setHud` que sólo dispara render si algo cambió. | El loop corre a 120 Hz; React no. |

## 3. Contrato del componente

```ts
type GameOutcome = {
  completed: boolean;          // true si se ganó o si terminó por tiempo; false en force-end
  points: number;
  durationMs: number;
  meta?: Record<string, unknown>;
};

type GameProps = {
  config: {
    seed: string;                  // tablero y cápsulas reproducibles
    durationMs: number | null;
    settings: Record<string, ...>; // administrables ya mezclados con los defaults
    debug: boolean;
  };
  signal: AbortSignal;         // al abortar, emitir el resultado parcial EN EL ACTO
  onFinish: (outcome: GameOutcome) => void;  // exactamente una vez
};
```

---

# LA PALETA PARTIDA

**No son dos paletas independientes: es una paleta con una junta en el medio.** Dos
segmentos que se mueven por separado, atados por una correa, que **no se pueden cruzar** y
que **se empujan entre sí**.

| | |
|---|---|
| Ancho de cada segmento | **110 u** (administrable) |
| Separación mínima entre bordes internos | **0** — se pueden tocar y forman una paleta sólida de 220 |
| Separación máxima entre centros | **420 u** — la correa |
| Orden | la mitad 0 está **siempre** a la izquierda de la 1. No se cruzan nunca |
| Hueco | la distancia entre bordes internos. En 0 no hay por dónde perderla |
| Alto del segmento | 22 u, con el borde superior en `y = 830` |

**No cruzarse es la restricción clave.** Sin ella, las dos mitades van al mismo lugar y el
juego se convierte en dos paletas que se pisan.

## El rango permitido, que es de donde sale todo

```ts
function travelLo(state)  { return state.segWidth / 2; }
function travelHi(state)  { return state.rules.width - state.segWidth / 2; }

/** Distancia mínima entre centros. Con junta activa, la única posible. */
function requiredDistance(state) {
  return state.jointMs > 0 ? state.segWidth : state.segWidth + state.rules.minGap;
}

/**
 * Margen de empuje: cuánto puede pedir un segmento MÁS ALLÁ del borde interno
 * del compañero. Sin margen, el recorte sería tan estricto que empujar sería
 * imposible; con margen, ese excedente es exactamente lo que corre al otro.
 */
function pushMargin(state) { return state.segWidth; }

export function segmentRange(state, seat: 0 | 1, out: Range): Range {
  const lo = travelLo(state), hi = travelHi(state), width = state.segWidth;

  if (state.jointMs > 0) {                    // junta activa: el par es rígido
    out.min = seat === 0 ? lo : lo + width;
    out.max = seat === 0 ? hi - width : hi;
    if (out.max < out.min) out.max = out.min;
    return out;
  }

  const req = requiredDistance(state);
  const maxD = Math.max(req, state.rules.maxSeparation);
  const margin = pushMargin(state);
  const other = state.segX[seat === 0 ? 1 : 0];

  if (seat === 0) {
    out.min = Math.max(lo, other - maxD);           // la correa tira desde este lado
    out.max = Math.min(hi - req, other - req + margin);
  } else {
    out.min = Math.max(lo + req, other + req - margin);
    out.max = Math.min(hi, other + maxD);
  }
  // Con el compañero contra una pared el rango puede degenerar: mejor un punto
  // que un rango invertido.
  if (out.max < out.min) out.max = out.min;
  return out;
}
```

El rango de cada mitad **cambia según dónde está la otra**: si se te viene encima, tu techo
baja con ella; del otro lado tira la correa.

## Resolución de los dos destinos a la vez

**Se resuelve sobre los DESTINOS, no sobre las posiciones.** Eso es lo que hace que la
restricción no se pueda violar nunca: los segmentos persiguen su destino con un lerp, y **un
lerp entre dos configuraciones válidas es válida** (la separación resultante es una
combinación convexa de dos separaciones que ya cumplen).

```
resolveTargets(state):
  con junta activa:
      cada mitad tiene MEDIA autoridad sobre el centro del par;
      el par se coloca rígido alrededor de ese centro y listo.
  si no:
      a = deseo de la mitad 0, recortado a SU rango
      b = deseo de la mitad 1, recortado a SU rango
      si (b - a) < req:   se reparte desde el punto medio → a = mid - req/2, b = mid + req/2
      si (b - a) > maxD:  ídem con maxD
      si a < lo:  se corre el par entero hacia adentro (b += lo - a; a = lo)
      si b > hi:  ídem del otro lado
```

Los dos pueden pedir el mismo lugar por el margen de empuje; **se reparte desde el medio: los
dos empujan, el que insiste gana terreno, y ninguno puede atravesar al otro.**

Además hace falta un `enforcePositions()` que aplique la misma corrección a las **posiciones**
(no a los destinos). En marcha no hace nada, pero el invariante "nunca se superponen" no
puede depender de que nadie cambie el ancho (cápsula Ancho) ni la junta en medio de una
partida.

## El movimiento

```ts
function moveSegments(state, dt) {
  enforcePositions(state);   // el ancho pudo cambiar bajo los pies
  resolveTargets(state);
  const alpha = Math.min(1, state.rules.segmentFollow * dt * 60);
  for (const seat of [0, 1]) {
    state.segX[seat] += (state.segTarget[seat] - state.segX[seat]) * alpha;
  }
}
```

El segmento **persigue** su destino en vez de saltar. En el original ese suavizado existía
para absorber el jitter de la red; **acá el input es local, así que `segmentFollow` puede ir
más alto (0,7–1) para que responda más seco**. El default de 0,45 se siente pastoso con el
dedo encima.

## El hueco no es un objeto

**Es la ausencia de uno.** La colisión se hace contra cada segmento por separado, y en el
medio, simplemente, no hay nada contra qué chocar. No hay que modelar el hueco: sale gratis.

---

# EL CONTROL, EN UN JUGADOR

Una sola persona maneja las dos mitades. Tres esquemas, los tres activos a la vez:

## Puntero — un dedo mueve el par, dos dedos lo abren

- **Un dedo:** mueve **la paleta entera**. Se calcula la posición normalizada del dedo sobre
  el recorrido y se le pide a las dos mitades que se centren ahí conservando la separación
  actual: a la mitad 0 se le pide `x - sep/2` y a la 1 `x + sep/2`. La correa y el orden ya
  están garantizados por `resolveTargets`, así que no hace falta ningún caso especial.
- **Dos dedos:** cada dedo maneja una mitad. **El dedo más a la izquierda gobierna la mitad
  0 y el otro la 1**, reasignado en cada frame — si el jugador cruza las manos, las mitades
  no se cruzan (no pueden), simplemente cada dedo toma la que le queda.
- Al levantar un dedo y quedar uno solo, se vuelve al modo "par" **sin saltar**: la
  separación que quedó es la separación que se conserva.

Esto usa `input.pointers[]`, que es exactamente para lo que existe.

## Teclado — una mitad en cada mano

- **A / D** mueven la mitad izquierda.
- **← / →** mueven la derecha.
- Velocidad `0.95` pantallas por segundo. Al tomar el control se arranca **desde donde está
  el segmento**, no desde el último valor guardado: si no, salta al apretar la primera tecla.

Es el esquema que más se parece al juego original de dos personas, con una mano por mitad, y
el que mejor se siente en escritorio.

## Prioridad entre esquemas

El último que se usó manda, con una **retención de 1,5 s** para que soltar las teclas un
instante no le devuelva el control al dedo (ni al revés) y las mitades peguen un salto.

---

# LA COLISIÓN: BARRIDO, NO DISCRETA

**El túnel es EL bug del Breakout.** Preguntar "¿está la pelota adentro este paso?" la deja
pasar de largo: a velocidad máxima recorre más que el alto de un segmento entre dos pasos, y
la vida se pierde sin que nadie vea por qué.

La solución es buscar **el instante exacto del impacto**, con un barrido círculo-vs-caja:

```ts
/** Barrido círculo-vs-AABB estático. Devuelve t en [0,1] del impacto, o null. */
export function sweepCircleBox(c: Circle, dx: number, dy: number, b: Box): number | null {
  // Se expande la caja por el radio y se barre un PUNTO contra ella: es el mismo
  // resultado y cuesta la mitad.
  const expanded = { x: b.x - c.r, y: b.y - c.r, w: b.w + c.r * 2, h: b.h + c.r * 2 };
  return sweepPointBox(c.x, c.y, dx, dy, expanded);
}

function sweepPointBox(px, py, dx, dy, b): number | null {
  let tMin = 0, tMax = 1;
  for (const axis of [0, 1]) {
    const p = axis === 0 ? px : py;
    const d = axis === 0 ? dx : dy;
    const lo = axis === 0 ? b.x : b.y;
    const hi = axis === 0 ? b.x + b.w : b.y + b.h;
    if (Math.abs(d) < 1e-8) { if (p < lo || p > hi) return null; continue; }
    let t1 = (lo - p) / d, t2 = (hi - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin <= 1 ? tMin : null;
}
```

## El paso de una pelota

```
remaining = 1
repetir hasta MAX_RESOLVES (6) veces, mientras remaining > 0:
    dx, dy = velocidad · dt · multiplicadorLento · remaining
    buscar el impacto MÁS TEMPRANO entre:
      · paredes laterales y techo  → ANALÍTICO, no barrido:
            barrer una caja contra un plano infinito es pagar de más
      · los dos segmentos          → SÓLO si dy > 0 (bajando). Si no, una pelota que
            sale del segmento y todavía lo solapa rebota otra vez hacia abajo
      · los ladrillos              → con descarte por rango de la grilla: sin eso serían
            112 barridos por paso y por pelota
    avanzar hasta ese instante
    si no hubo impacto → cortar
    remaining ·= 1 - t
    resolver el impacto según su tipo
si la pelota quedó bajo el piso → muere
```

Antes de cada barrido, un **descarte barato** por caja envolvente del recorrido
(`sweptTouchesBox`): si el AABB del tramo no toca el AABB del objetivo, no se barre.

El descarte de la grilla de ladrillos se hace convirtiendo el AABB del tramo a rango de
filas y columnas, y recorriendo sólo esas celdas.

Después de cada impacto se separa la pelota **`SKIN = 0.02`** del objeto. Sin eso queda
vibrando pegada. Y en las paredes, **la corrección va ANTES de invertir la velocidad**: si
no, en el paso siguiente sigue del lado de afuera y queda temblando contra el borde.

## Resolución por tipo de impacto

**Pared lateral:** se reposiciona a `radius + SKIN` (o su espejo) y se invierte `vx`.
**Techo:** se reposiciona a `radius + SKIN` y se invierte `vy`.

**Segmento:**

```
si el centro de la pelota está por debajo del borde superior del segmento (+ margen):
    es un impacto DE COSTADO: se invierte vx y se empuja de lado.
    Sin esto se puede "levantar" una pelota desde abajo del segmento.
si no:
    rebote normal: bounceAngle(...)
```

**Ladrillo:** se decide la normal por la posición del centro respecto de la caja (`nx`, `ny`),
se invierte la componente que corresponda —y `vy` también cuando el impacto fue frontal
(`nx === 0`)—, se separa por `SKIN`, y se le resta un golpe al ladrillo.

## El rebote del segmento

```ts
function bounceAngle(state, ball, seat): number {
  const half = state.segWidth / 2;
  const center = state.segX[seat];
  const offset = clamp((state.ballX[ball] - center) / half, -1, 1);
  const angle = offset * state.rules.maxBounceRad;          // ±60° por defecto
  const speed = Math.min(state.maxSpeed, state.ballSpeed[ball] * state.rules.accelPerHit);
  state.ballSpeed[ball] = speed;
  // El segmento NO aporta su propia velocidad, sólo ángulo.
  state.ballVx[ball] = speed * Math.sin(angle);
  state.ballVy[ball] = -speed * Math.cos(angle);
  state.ballY[ball] = state.rules.segmentY - state.rules.ballRadius - SKIN;
  return offset;
}
```

Al centro sale recta, en la punta abre hasta el ángulo máximo. **El módulo de la velocidad se
conserva y sólo cambia el ángulo**, con una aceleración del 3 % por rebote y un techo de 2×
la velocidad inicial. Sin techo, al tercer nivel es injugable.

**Rescate:** un rebote en el borde **externo** (el que da a la pared) a partir del 72 % del
medio segmento cuenta como rescate y paga 30 puntos. Premia estirarse hasta el límite de la
correa en vez de quedarse en el centro — que es justamente lo que abre el hueco.

---

# ESPECIFICACIÓN FUNCIONAL

## Cancha

| | |
|---|---|
| Campo | **1600 × 900** |
| Radio de la pelota | **13 u** |
| Segmentos | 110 × 22, borde superior en `y = 830` |
| Grilla de ladrillos | **8 filas × 14 columnas** (filas administrables, 4–10) |
| Ladrillos: margen lateral | 90 u |
| Ladrillos: tope superior | 130 u |
| Alto de celda | 40 u, con 6 u de separación |
| Ancho de celda | `(1600 - 90·2) / 14` |
| Pelotas simultáneas | máx. **3** |
| Cápsulas simultáneas | máx. **10** |
| Vidas | **3** |
| Niveles | **5** |
| **Paso de simulación** | **1/120 s** |

**El paso es 1/120 y no 1/60**, y no es cosmético: con la pelota al doble de su velocidad
inicial, en 1/60 recorre 14 unidades por paso contra un segmento de 22 de alto, y el barrido
tendría que resolver tramos larguísimos. Se implementa con un **acumulador** dentro del
`update`, con tope de **10 subpasos por cuadro** — la deuda que no entra se **tira**:
recuperarla después sería simular en cámara rápida un tiempo que nadie vio.

## Ladrillos

| Tipo | Golpes | Puntos | Extra |
|---|---|---|---|
| Normal | 1 | 50 | — |
| Reforzado | 2 | 120 | — |
| Blindado | 3 | 250 | — |
| Explosivo | 1 | 100 | revienta a sus 8 vecinos |

**El explosivo no encadena.** Un explosivo revienta a sus ocho vecinos, pero los vecinos
explosivos **no vuelven a explotar**. Sin ese corte, un tablero denso se limpia entero de un
solo golpe. Los vecinos revientan **enteros**, sin importar cuántos golpes les quedaban: es
lo que hace que valga la pena buscar el explosivo. Y un ladrillo ya roto no se vuelve a
romper — sin esa guarda, resucitarlo para reventarlo pagaría sus puntos dos veces.

Reparto de tipos al armar el nivel:

```ts
function brickTypeFor(level, row, rows, roll): number {
  // Explosivos escasos y repartidos: uno de cada quince y NUNCA en la fila de
  // abajo, donde reventaría medio tablero de arranque.
  if (roll < 0.07 && row > 0) return BRICK_BOMB;
  const depth = rows > 1 ? 1 - row / (rows - 1) : 0;   // 1 = fila de arriba
  // Cuanto más arriba (más difícil de alcanzar) más duro, y sólo desde cierto
  // nivel: el primero tiene que poder terminarse.
  if (level >= 3 && depth > 0.75) return BRICK_ARMORED;
  if (level >= 1 && depth > 0.45) return BRICK_TOUGH;
  return BRICK_NORMAL;
}
```

**El tipo se sortea SIEMPRE que hay ladrillo**, aunque el nivel no use blindados: así la
serie del PRNG no depende del patrón, y dos niveles distintos con la misma semilla siguen
siendo reproducibles.

## Los cinco patrones

Sin huecos de diseño el tablero es una pared aburrida. Cada nivel enseña algo:

```ts
function levelHasBrick(level, row, col, rows, cols): boolean {
  switch (level) {
    case 0:
      // Muro macizo pero corto: el nivel de aprender a no abrir el hueco.
      return row < Math.max(3, rows - 3);
    case 1:
      // Damero: obliga a rebotes largos y diagonales.
      return (row + col) % 2 === 0;
    case 2: {
      // Pirámide centrada: el centro es lo último que queda, justo donde está
      // la junta de la paleta.
      const half = cols / 2;
      const reach = ((row + 1) / rows) * half;
      return Math.abs(col + 0.5 - half) <= reach;
    }
    case 3:
      // Columnas: pasillos verticales por donde la pelota se cuela hasta arriba.
      return col % 3 !== 1;
    default:
      // Fortaleza: marco lleno y núcleo macizo, con dos pasillos.
      return row === 0 || row === rows - 1 || col < 2 || col >= cols - 2
          || (row > 2 && row < rows - 2);
  }
}
```

## Cápsulas

Caen de algunos ladrillos (12 % por defecto) y se agarran con **cualquiera** de las dos
mitades. Con la misma semilla caen siempre de los mismos ladrillos.

| Cápsula | Efecto | Dura |
|---|---|---|
| **Ancho** | +40 u a **los dos** segmentos | 20 s |
| **Lento** | pelota a 0,7× | 15 s |
| **Multi** | dos pelotas más, en abanico de ±0,42 rad desde la primera libre | hasta perderlas |
| **Imán** | la pelota se pega al segmento que la reboté | 1 uso |
| **Junta** | las dos mitades quedan **unidas**: sin hueco posible | 10 s |

**La cápsula Junta es la más interesante:** durante 10 segundos el juego se vuelve un
Breakout normal. Es un alivio, y hace notar por contraste lo que significa el hueco.

**El imán suelta solo a los 2,2 s.** En el original había un botón en el mando; acá no hay
mando, y obligar a buscar una tecla con la pelota pegada cuesta la partida. Se puede
agregar además un "soltar" con toque o barra espaciadora, pero **la suelta automática tiene
que existir igual**.

Medidas de la cápsula: **60 × 26** (medias medidas 30 y 13). **Lo que se dibuja es
exactamente lo que agarra**, o la cápsula que "pasa rozando" se siente robada.

Al cambiar el ancho (cápsula Ancho, o su vencimiento) hay que llamar a `enforcePositions` +
`resolveTargets` **en el acto**, no en el paso siguiente: el ancho nuevo puede dejar los
segmentos superpuestos o fuera de la cancha.

## Vidas, servicio y fin

- Se pierde una vida cuando **muere la última pelota viva**.
- Al perder una vida (o al empezar un nivel) se **limpian todos los efectos**, se recupera
  el ancho base, se estaciona la pelota sobre la junta y arranca una pausa de **1,5 s**.
  Sin pausa nadie entiende qué pasó y la siguiente se pierde igual.
- Durante la pausa la pelota **espera apoyada sobre la junta y se mueve con ella**: así se
  ve desde dónde va a salir.
- Al vencer la pausa, la pelota se lanza con un ángulo sembrado dentro de la mitad de la
  cuña permitida.
- **Ojo con el temporizador:** restar 180 veces `1/120` a `1,5` no da 0 exacto. Hace falta
  un `TIMER_EPS = 1e-6` o la pausa dura un paso de más.
- Al limpiar el tablero: si era el quinto nivel, **partida ganada**; si no, nivel siguiente.
- Sin vidas, **partida perdida**.

## Puntaje

```ts
export function breakoutPoints(brickPoints, levelsCleared, rescues): number {
  return Math.max(0, Math.round(brickPoints + levelsCleared * 400 + rescues * 30));
}
```

- **Ladrillos:** lo que valga cada uno, al romperse.
- **Nivel superado:** 400.
- **Rescate:** 30 por rebote en el borde externo.

## Eventos: una máscara de bits, no un objeto

Un paso puede disparar varias cosas a la vez, y **un objeto de evento por paso son 120
asignaciones por segundo**. `stepBreakout` devuelve un número:

```ts
export const EV_WALL = 1;            export const EV_SEGMENT = 2;
export const EV_BRICK = 4;           export const EV_CAPSULE_DROP = 8;
export const EV_CAPSULE_CATCH = 16;  export const EV_LIFE_LOST = 32;
export const EV_LEVEL_CLEAR = 64;    export const EV_OVER = 128;
export const EV_RESCUE = 256;        export const EV_LAUNCH = 512;
export const EV_STICK = 1024;
```

El componente lee la máscara y dispara sonido, partículas, avisos y sacudida. Y para pintar
sin asignar, el estado guarda **lo último que pasó** (`lastHitX/Y`, `lastBrickX/Y`,
`lastBrickType`, `lastCatchType`, `lastHitSeat`).

---

# ADMINISTRABLES

| Grupo | Clave | Label | Default | Rango | Paso | Unidad |
|---|---|---|---|---|---|---|
| Pelota | `ballSpeed` | Velocidad inicial de la pelota | **420** | 240–900 | 20 | u/s |
| Pelota | `ballAccel` | Aceleración por rebote | **3** | 0–10 | 0.5 | % |
| Pelota | `maxSpeedFactor` | Techo de velocidad | **2** | 1–3 | 0.1 | × |
| Pelota | `maxBounceAngle` | Ángulo máximo de rebote | **60** | 30–75 | 5 | ° |
| Paleta partida | `segmentWidth` | Ancho de cada segmento | **110** | 60–200 | 10 | u |
| Paleta partida | `minGap` | Separación mínima entre segmentos | **0** | 0–60 | 5 | u |
| Paleta partida | `maxSeparation` | Separación máxima entre centros | **420** | 200–900 | 20 | u |
| Paleta partida | `segmentFollow` | Suavizado del segmento | **0.7** | 0.15–1 | 0.05 | — |
| Ladrillos | `brickRows` | Filas de ladrillos | **8** | 4–10 | 1 | — |
| Ladrillos | `capsuleChance` | Ladrillos con cápsula | **12** | 0–40 | 1 | % |
| Ladrillos | `capsuleSpeed` | Caída de la cápsula | **210** | 100–400 | 10 | u/s |
| Partida | `lives` | Vidas | **3** | 1–6 | 1 | — |
| Partida | `loseDelay` | Pausa al perder una vida | **1.5** | 0.5–3 | 0.5 | s |

> **`segmentFollow` sube a 0,7 en esta versión.** En el original valía 0,45 para absorber el
> jitter de la red; con el dedo encima, ese suavizado se siente pastoso.

Textos de ayuda que vale la pena mantener, porque explican **por qué** existe el número:

- `ballSpeed`: "Sobre una cancha de 1600 × 900. Debajo de 320 no exige nada."
- `maxSpeedFactor`: "Múltiplo máximo de la velocidad inicial. Sin tope, al tercer nivel es
  injugable."
- `maxBounceAngle`: "Medido desde la vertical. Pegarle con la punta abre hasta este ángulo;
  al centro sale recta."
- `segmentWidth`: "Juntos forman una paleta sólida del doble. La cápsula Ancho le suma 40 a
  los dos."
- `minGap`: "En 0 se pueden tocar y no queda hueco. Arriba de 0 siempre hay por dónde
  perderla."
- `maxSeparation`: "La correa entre las dos mitades. Es lo que impide tener media cancha
  cubierta gratis."
- `brickRows`: "Sobre 14 columnas fijas. Más filas alargan el nivel, no lo hacen más
  difícil."
- `capsuleChance`: "Con la misma semilla caen siempre de los mismos ladrillos."
- `capsuleSpeed`: "Muy rápida obliga a abandonar la pelota para ir a buscarla, y eso cuesta
  una vida."
- `loseDelay`: "Sin pausa nadie entiende qué pasó y la siguiente se pierde igual."

**Las dos perillas que cambian el juego de verdad son `segmentWidth` y `maxSeparation`:** la
primera decide cuánto cubre cada mitad, la segunda cuánto se pueden alejar antes de que la
correa las frene. Tocar cualquiera de las dos lo convierte en otro juego, así que salen
documentadas y no escondidas en el código.

---

# PRESENTACIÓN Y GAME FEEL

Todo es forma geométrica dibujada con Canvas 2D: **cero assets**.

## Colores (tokens CSS, leídos y compuestos una sola vez)

| Uso | Token |
|---|---|
| Fondo | `--sn-bg`, con un halo radial de `--sn-violet-600` al 28 % arriba |
| Viñeta | radial de `--sn-bg` transparente al 80 % en los bordes |
| Mitad izquierda | `--sn-cyan-400` |
| Mitad derecha | `--sn-magenta-400` |
| Ladrillo normal / reforzado / blindado / explosivo | `--sn-violet-400` / `--sn-cyan-500` / `--sn-text-muted` / `--sn-warn` |
| Grietas | la variante 300 de cada uno, y `--sn-danger` para el explosivo |
| Cápsulas (Ancho, Lento, Multi, Imán, Junta) | `--sn-cyan-400`, `--sn-violet-300`, `--sn-magenta-400`, `--sn-warn`, `--sn-success` |
| Pelota | `--sn-text`, o **el color de la mitad que la rebotó por última vez** |
| Línea del hueco | `--sn-danger` |
| Número de nivel de fondo | `--sn-violet-400` al 10 % |

## Orden de dibujo

```
1. sacudida (translate) + fondo + halo
2. número de nivel GIGANTE detrás de todo (220 px, al 10 %)
3. línea del piso
4. ladrillos
5. cápsulas
6. estelas
7. pelotas
8. AVISO DEL HUECO      ← va después de la pelota y antes de los segmentos
9. segmentos
10. chispas
11. flash + viñeta
```

**El aviso del hueco va donde va a propósito:** es la información más importante de la
pantalla y no puede quedar tapada.

## El aviso del hueco — la mitad del juego

Si no se dibuja, nadie entiende por qué perdió la vida.

- Una **línea punteada roja** que ocupa exactamente el hueco, entre los bordes internos de
  las dos mitades, con grosor y opacidad crecientes según lo grande que sea
  (`intensity = min(1, gap / 300)`).
- Un **triángulo hacia abajo** en el medio del hueco: dice **hacia dónde se va a caer**, no
  sólo que hay hueco.
- **Se conserva con `prefers-reduced-motion`**, porque es información, no adorno. Lo que se
  saca ahí es el brillo, no la línea.

## Ladrillos

Se dibujan **agrupados por tipo, en dos pasadas**: una de relleno y otra de grietas.
Agrupar evita un cambio de `fillStyle` por ladrillo — con 112 ladrillos eso se nota.

- **Los dañados se apagan** (`alpha = 0.45 + 0.55·hp/maxHp`): es la grieta legible de lejos.
- Encima, **grietas reales**: una línea diagonal por golpe recibido. En un proyector, las
  líneas finitas no se ven; por eso la opacidad hace el trabajo principal y la grieta es el
  refuerzo.

## Cápsulas, estela, pelota y chispas

- **Cápsulas:** píldora redondeada **con el nombre escrito adentro**, en el color del fondo.
  Cinco cápsulas no se distinguen por tono, y menos en un proyector.
- **Estela:** hasta 10 posiciones por pelota (3 con reduced-motion), en buffers circulares
  preasignados, con radio y opacidad decrecientes.
- **Pelota:** lleva **el color de la mitad que la rebotó por última vez**. Se ve de dónde
  viene. Con `shadowBlur` de 24 salvo con reduced-motion.
- **Chispas:** 150 máximo, 9 por ladrillo roto y 2 por rebote en el segmento, con gravedad
  520 y vida 0,25–0,55 s. Se dibujan **agrupadas por tipo**, igual que los ladrillos.
- **El azar del render NO puede salir del PRNG sembrado:** consumirlo en el dibujo haría que
  el próximo nivel dependa de los fps. Se precalcula una tabla de 64 valores de ruido en el
  `init` y se recorre con un cursor.

## Avisos, flash y sacudida

- **Aviso grande** arriba (36 px) para: nivel superado, vida perdida ("Se coló por el
  hueco"), rescate, cápsula agarrada. En una sala nadie mira el HUD chico.
- **Flash** blanco de 140 ms al perder una vida.
- **Sacudida** de 260 ms, ±7 px, con el ruido precalculado.
- **Pulso** del número de nivel al superarlo (700 ms).
- **Cuenta atrás del servicio** en grande, sobre la mitad inferior.

## `prefers-reduced-motion`

- Sin sacudida, sin flash, sin `shadowBlur`, sin chispas.
- Estela de 3 posiciones en vez de 10.
- **El aviso del hueco se mantiene**: es información.
- El fin de partida no espera: se resuelve en el acto en vez de sostener 1,5 s el tablero.

## Sonido y vibración

| Evento | Sonido | Vibración |
|---|---|---|
| Rebote en un segmento | `hit` | `18` |
| Rebote en pared o techo | `tick` | — |
| Ladrillo roto | `select` | — |
| Cápsula que cae | `tick` | — |
| Cápsula agarrada | `pick` | `[14, 60, 34]` |
| Pelota pegada al imán | `pick` | — |
| Lanzamiento | `tick` | — |
| Vida perdida | `lose` | — |
| Nivel superado | `win` | — |
| Fin de partida | `win` / `lose` | — |

**Al perder la última vida no suenan `lose` dos veces:** si el mismo paso trae
`EV_LIFE_LOST` y `EV_OVER`, el sonido lo pone `EV_OVER`. Dos "lose" encimados suenan a bug,
no a derrota.

Las dos vibraciones son distintas a propósito: el rebote es **un golpe seco y corto** que
pasa muchas veces por minuto y tiene que poder ignorarse; la cápsula son **dos toques con
pausa**, que es lo que hace que se distinga sin mirar — cambió una regla, prestá atención.

---

# HUD Y ESTADOS

HUD en **DOM**, con `aria-live="polite"` y `data-game-ui`:

- **Vidas** — el dominante; rojo cuando queda 1.
- **Puntos** — cyan.
- **Nivel** — `n/5`.
- **Hueco** — el número redondeado **a decenas** (el valor exacto bailaría 120 veces por
  segundo); en `warn` si hay hueco, en `danger` si pasa de 180.
- **Tiempo** — sólo si hay límite; rojo bajo 10 s.
- **fps** — sólo con `config.debug`.

Instrucciones, texto exacto: *"La paleta está partida al medio y manejás las dos mitades.
Juntas no hay hueco; separadas cubrís más, pero la pelota se cuela por el medio. Un dedo
mueve la paleta entera, dos dedos abren el hueco. Con teclado: A y D la mitad izquierda, ← y
→ la derecha."*

Resumen: *"¡Los cinco niveles!"* o *"Se acabaron las vidas"*, con los puntos y los niveles
superados.

---

# CONTRATO DE SALIDA

```ts
onFinish({
  completed: state.won || completedPorTiempo,   // false en force-end
  points: breakoutPoints(state.brickPoints, state.levelsCleared, state.rescues),
  durationMs,
  meta: {
    nivel: state.level + 1,
    nivelesSuperados: state.levelsCleared,
    ladrillos: state.brickPoints,
    rescates: state.rescues,
    vidasRestantes: state.lives,
    motivo: state.won ? "todos los niveles"
          : state.over ? "sin vidas"
          : completed ? "tiempo" : "forzado",
  },
});
```

---

# PERFORMANCE

| | |
|---|---|
| Objetivo | **60 fps de render con 120 pasos de simulación por segundo** |
| En pantalla | 112 ladrillos + 3 pelotas + 10 cápsulas + 150 chispas |
| Asignaciones por frame | **cero** |
| Si no llega | primero las chispas, después la estela |

Cómo se consigue, que es la parte que hay que hacer bien:

- **Todo en arrays tipados de tamaño fijo**: la grilla de ladrillos es un array plano; las
  pelotas, las cápsulas, las chispas y la estela viven en `Float32Array` /
  `Uint8Array` preasignados.
- **Los eventos son una máscara de bits**, no un objeto.
- **Los scratch de colisión (`circle`, `box`) viven en el estado**, no se crean por paso.
  Todas las funciones de geometría **escriben sobre un destino** en vez de devolver un
  objeto nuevo (`writeSegmentBox`, `writeBrickBox`, `segmentRange(…, out)`).
- **Nada de `pool.each` con callback inline**: eso es una closure nueva por cuadro. Las
  estelas y las chispas se recorren con `for` sobre arrays circulares.
- **Etiquetas y degradés precalculados**: `String(n)` por cuadro es una asignación por
  cuadro; un `createRadialGradient` por cuadro es la forma más barata de perder los 60 fps.
- **Agrupar el dibujo por estilo**: una pasada por tipo de ladrillo y por tipo de chispa, en
  vez de un cambio de `fillStyle` por objeto.
- **Descarte antes de barrer**: caja envolvente del recorrido, y rango de grilla para los
  ladrillos.

---

# QUÉ NO HACER

- **No** colisión discreta: es barrida, o la pelota atraviesa la paleta.
- **No** delta variable, ni paso de 1/60 para la simulación.
- **No** modelar el hueco como un objeto: es la ausencia de uno.
- **No** dejar que las mitades se crucen ni se superpongan, en ninguna circunstancia.
- **No** resolver las restricciones sobre las posiciones en vez de sobre los destinos.
- **No** que el segmento le aporte su velocidad a la pelota: sólo ángulo.
- **No** encadenar explosivos.
- **No** consumir el PRNG sembrado dentro del `draw`.
- **No** quitar el aviso del hueco con reduced-motion: es información.
- **No** dejar el imán sin suelta automática.
- **No** poner reglas del juego en el componente, ni dibujo en `logic.ts`.

---

# TESTS OBLIGATORIOS

Van sobre `logic.ts`, sin navegador. Hacen falta helpers para armar un estado con reglas de
laboratorio, colocar la pelota a mano, y correr N pasos.

**Determinismo**
1. La misma semilla arma el mismo tablero y las mismas cápsulas.
2. Semillas distintas reparten las cápsulas distinto.
3. La misma semilla y los mismos inputs dan la misma partida.

**Barrido: la pelota no atraviesa nada** — el bloque que justifica el archivo
4. A velocidad absurda **rebota en el segmento** en vez de pasarlo de largo.
5. **Una colisión discreta sí la dejaría pasar**: el mismo caso, comprobando que un test de
   solapamiento puntual no detecta nada. *Es el test que documenta por qué existe el
   barrido.*
6. Por el hueco entre segmentos **sí se cae**: el hueco no es un objeto.
7. Juntas, no hay hueco y la pelota vuelve.
8. No atraviesa un ladrillo aunque el paso sea larguísimo.

**La paleta partida**
9. El rango de una mitad se achica cuando la otra se le acerca.
10. El rango sigue al compañero: el techo de la 0 **nunca** pasa a la 1.
11. El rango normalizado está en 0..1 y ordenado (`min ≤ max`).
12. **Las dos mitades nunca se superponen, ni empujando de frente.**
13. Con separación mínima > 0 el hueco nunca se cierra, y tampoco se cruzan.
14. **Empujar corre al compañero:** el que insiste gana terreno.
15. La correa impide separarse más de lo permitido.
16. El setter **sanea lo que le llega**: `NaN`, infinitos y números absurdos no mueven nada.
17. La cápsula Junta une las mitades y no deja abrir hueco.

**Rebote en el segmento**
18. El punto de impacto cambia el ángulo de salida (centro recto, punta abierta).
19. El rebote acelera la pelota **hasta el techo y no más**.
20. Los puntos del ladrillo se acreditan tras rebotar (la pelota "tiene dueño").

**Ladrillos**
21. Un ladrillo se destruye **una sola vez** (el explosivo no paga dos veces a un vecino).
22. Un reforzado aguanta dos golpes antes de romperse.
23. Terminar el nivel suma el bono y arranca el siguiente.

**Puntaje**
24. Suma ladrillos, bono por nivel y rescates.
25. Nunca es negativo.

**Jugabilidad** — el smoke test que vale por diez
26. **Un piloto automático de prueba sostiene la partida:** un controlador que mueve las dos
    mitades hacia la pelota más baja (una a cada lado, haciendo sándwich) rompe ladrillos
    durante miles de pasos sin perder todas las vidas. Si este test falla, algo de la
    física está roto aunque los demás pasen.

**Cápsulas**
27. La Junta se puede agarrar con cualquiera de las dos mitades.
28. La cápsula Ancho reordena las mitades en el acto sin superponerlas.

---

# CRITERIOS DE ACEPTACIÓN

- [ ] `tsc --noEmit` en verde, en modo `strict` con `noUncheckedIndexedAccess`.
- [ ] Todos los tests de la sección anterior pasan.
- [ ] Se juegan los cinco niveles de principio a fin, y la progresión se siente.
- [ ] **La pelota nunca atraviesa un segmento ni un ladrillo**, ni a velocidad máxima con
      la cápsula Multi activa.
- [ ] **Las dos mitades nunca se cruzan ni se superponen**, ni empujando de frente, ni con
      la cápsula Ancho activándose contra una pared.
- [ ] Se puede jugar entero **con el dedo** (un dedo mueve el par, dos abren el hueco) y
      entero **con el teclado** (A/D y ←/→), y cambiar de uno a otro no hace saltar nada.
- [ ] El hueco se ve: la línea roja y el triángulo aparecen apenas hay separación.
- [ ] Las cuatro clases de ladrillo se distinguen **en escala de grises**.
- [ ] Las cinco cápsulas se distinguen por **nombre**, no sólo por color.
- [ ] El explosivo revienta a sus ocho vecinos **una sola vez** y no encadena.
- [ ] Perder una vida da 1,5 s de pausa con la pelota apoyada sobre la junta.
- [ ] El imán suelta solo a los 2,2 s aunque el jugador no haga nada.
- [ ] 60 fps de render con 120 pasos por segundo, tres pelotas y 150 chispas.
- [ ] **Cero recolecciones de basura en 90 segundos**, verificable en el perfil de memoria.
- [ ] `force-end` (abortar el `AbortSignal`) emite el outcome con lo acumulado, **una sola
      vez**.
- [ ] Con `prefers-reduced-motion` no hay sacudida, flash ni chispas, **pero el aviso del
      hueco sigue estando**.
- [ ] Al desmontar no queda ni un `requestAnimationFrame`, ni un listener, ni un
      `ResizeObserver`, ni un `AudioContext` abierto.
- [ ] Cero errores y cero warnings en consola.

---

# ORDEN DE IMPLEMENTACIÓN

Cinco slices, cada uno verificable solo. No pasar al siguiente sin cerrar el anterior.

| # | Slice | Se cierra cuando |
|---|---|---|
| 1 | **Runtime**: loop de paso fijo, canvas con DPR y letterbox, input con multitouch y teclado, PRNG. | El dedo se lee en coordenadas del mundo y el acumulador corre 120 pasos por segundo. |
| 2 | **Pelota y barrido** (`logic.ts` + tests): estado, paredes, un segmento, `sweepCircleBox`, rebote por punto de impacto. | Los tests de barrido pasan, incluido el que demuestra que la colisión discreta fallaría. |
| 3 | **La paleta partida**: rango, orden, empuje, correa, junta, `enforcePositions`. | Los tests de la paleta pasan: nunca se cruzan, se empujan, la correa frena. |
| 4 | **Ladrillos, niveles y cápsulas**: grilla, tipos, explosivos, los cinco patrones, cápsulas, vidas, puntaje. | El smoke test del piloto automático sostiene la partida y se llega al nivel 5. |
| 5 | **Juego**: componente, control con dedo y teclado, efectos, HUD, outcome. | Los criterios de aceptación visuales y de performance. |

---

# ENTREGA

Cambios pequeños y revisables, un slice por vez. Explicá las decisiones no obvias con un
comentario que diga **por qué**, no qué.
Al terminar, listá qué quedó pendiente y por qué.

---
---

# APÉNDICE A · Tipos y API de `logic.ts`

```ts
export const SEGMENTS = 2;          // las dos mitades de la paleta
export const MAX_BALLS = 3;
export const MAX_CAPSULES = 10;
export const BRICK_COLS = 14;
export const LEVEL_COUNT = 5;

const MAX_RESOLVES = 6;   // impactos resueltos dentro de un mismo paso
const SKIN = 0.02;        // separación tras el impacto: sin esto vibra pegada
const TIMER_EPS = 1e-6;   // restar 180 veces 1/120 a 1,5 no da 0 exacto

/* Duraciones fijas: no son administrables porque son el equilibrio del juego. */
const WIDE_MS = 20_000;   const SLOW_MS = 15_000;   const JOINT_MS = 10_000;
const MAGNET_HOLD_MS = 2200;
const WIDE_BONUS = 40;    const SLOW_FACTOR = 0.7;
const RESCUE_EDGE = 0.72; // desde dónde un rebote cuenta como rescate

export const BRICK_NORMAL = 0; export const BRICK_TOUGH = 1;
export const BRICK_ARMORED = 2; export const BRICK_BOMB = 3;
const BRICK_HP     = [1, 2, 3, 1];
const BRICK_POINTS = [50, 120, 250, 100];

export const CAP_WIDE = 0; export const CAP_SLOW = 1; export const CAP_MULTI = 2;
export const CAP_MAGNET = 3; export const CAP_JOINT = 4;
export const CAPSULE_LABELS = ["Ancho", "Lento", "Multi", "Imán", "Junta"];
export const CAPSULE_HALF_W = 30; export const CAPSULE_HALF_H = 13;

export type BreakoutRules = {
  width: number; height: number; ballRadius: number;
  ballSpeed: number;         // u/s al lanzar
  accelPerHit: number;       // multiplicador por rebote, p.ej. 1.03
  maxSpeedFactor: number;    // techo, en múltiplos de ballSpeed
  maxBounceRad: number;      // radianes desde la vertical, en la punta
  segmentWidth: number; segmentHeight: number; segmentY: number;
  segmentFollow: number;     // lerp por cuadro de 60 Hz hacia el destino
  minGap: number; maxSeparation: number;
  rows: number; cols: number;
  brickTop: number; brickSide: number; brickCellHeight: number; cellGap: number;
  capsuleChance: number;     // 0..1
  capsuleSpeed: number;
  lives: number; loseDelayS: number;
};

export type Range = { min: number; max: number };

export type BreakoutState = {
  rules: BreakoutRules;
  level: number; levelsCleared: number; lives: number;
  over: boolean; won: boolean;

  segX: Float32Array;        // centro actual de cada mitad
  segTarget: Float32Array;   // centro al que persigue, ya recortado
  segWish: Float32Array;     // lo último que pidió el jugador, 0..1
  segWidth: number;          // ancho actual: cambia con la cápsula Ancho

  ballX, ballY, ballVx, ballVy, ballSpeed: Float32Array;
  ballAlive: Uint8Array;
  ballOwner: Int8Array;      // qué mitad la rebotó por última vez. -1 = ninguna
  ballStuck: Int8Array;      // a qué mitad está pegada por el imán. -1 = libre
  ballStuckOffset, ballStuckMs: Float32Array;
  maxSpeed: number;

  brickHp, brickType, brickMaxHp: Uint8Array;
  brickCapsule: Int8Array;   // -1 sin cápsula; si no, el tipo. Sembrado al armar
  bricksLeft: number; cellW: number; cellH: number;

  capX, capY: Float32Array; capType: Int8Array; capAlive: Uint8Array;

  wideMs: number; slowMs: number; jointMs: number; magnetCharges: number;

  brickPoints: number; rescues: number;
  serveTimerS: number;       // 0 = pelota en juego

  /* Lo último que pasó, para pintar sin asignar. */
  lastHitSeat, lastHitX, lastHitY, lastHitOffset: number;
  lastBrickX, lastBrickY, lastBrickType: number;
  lastCatchType: number;

  /* Scratch de colisión: vive acá para no crear un objeto por paso. */
  circle: Circle; box: Box;
};

/* Construcción */
export function createBreakoutState(rules: BreakoutRules, rng: Rng): BreakoutState;
export function buildLevel(state: BreakoutState, rng: Rng): void;

/* La paleta */
export function segmentRange(state, seat, out: Range): Range;
export function segmentRangeNorm(state, seat, out: Range): Range;
export function segmentPosition(state, seat): number;      // 0..1
export function setSegmentTarget(state, seat, position: number): void;  // sanea y recorta
export function writeSegmentBox(state, seat, box: Box): void;
export function segmentGap(state): number;                 // 0 = paleta sólida
export function releaseStuck(state, seat): boolean;

/* Ladrillos */
export function brickBox(state, row, col, box: Box): Box;

/* El paso: la ÚNICA función que mueve algo. Devuelve la máscara de eventos. */
export function stepBreakout(state: BreakoutState, dt: number, rng: Rng): number;

/* Puntaje */
export function breakoutPoints(brickPoints, levelsCleared, rescues): number;
```

---

# APÉNDICE B · Constantes del componente

```ts
const FIELD_W = 1600;      const FIELD_H = 900;
const BALL_RADIUS = 13;
const SEGMENT_HEIGHT = 22; const SEGMENT_Y = 830;
const BRICK_TOP = 130;     const BRICK_SIDE = 90;
const BRICK_CELL_H = 40;   const CELL_GAP = 6;

const SIM_STEP = 1 / 120;  // NO 1/60: la pelota acelera y el barrido necesita tramos cortos
const MAX_SUBSTEPS = 10;   // volver de una pestaña oculta no dispara la espiral de la muerte

const TRAIL_MAX = 10;      const TRAIL_REDUCED = 3;
const MAX_SPARKS = 150;    const SPARKS_PER_BRICK = 9;
const SPARK_GRAVITY = 520; const NOISE_SIZE = 64;

const FLASH_MS = 140;      const SHAKE_MS = 260;   const SHAKE_PX = 7;
const NOTICE_MS = 2800;    const OVER_HOLD_MS = 1500;

const KEYBOARD_SPEED = 0.95;   // pantallas por segundo
const INPUT_HOLD_S = 1.5;      // retención antes de ceder el control al otro esquema
```

---

# APÉNDICE C · El `update`, paso a paso

```
1. descontar temporizadores de efectos visuales (flash, sacudida, aviso, pulso)
2. leer el input y traducirlo a setSegmentTarget(mitad, 0..1):
     · dos dedos → el de más a la izquierda gobierna la mitad 0, el otro la 1
     · un dedo   → mueve el par: a la 0 se le pide x - sep/2, a la 1 x + sep/2
     · teclado   → A/D la izquierda, ←/→ la derecha
     · el esquema usado por última vez retiene el control 1,5 s
3. avanzar las chispas
4. si la partida terminó → sostener el tablero 1,5 s y llamar a finish(won)
5. acumulador:
     while (acc >= 1/120 && pasos < 10):
         mask = stepBreakout(state, 1/120, rng)
         empujar la estela
         si mask !== 0 → sonido, chispas, avisos, flash, sacudida
         si el juego terminó → cortar
     si sobró más de 10 pasos de deuda → tirarla
6. publicar el HUD (el hueco redondeado a decenas)
```

Y el orden interno de `stepBreakout`:

```
1. si terminó → devolver 0
2. descontar wideMs, slowMs, jointMs (al vencer Ancho, restaurar el ancho base)
3. moveSegments(dt)
4. si hay servicio pendiente:
       la pelota espera sobre la junta y se mueve con ella
       al vencer → lanzar (EV_LAUNCH) y devolver
5. por cada pelota viva:
       si está pegada por el imán → seguir al segmento, descontar, soltar al vencer
       si no → moveBall(dt) con el barrido
6. avanzar y cobrar las cápsulas
7. si no quedan ladrillos → nivel superado (o partida ganada)
8. si no quedan pelotas vivas → vida perdida (o partida perdida)
```

---

# APÉNDICE D · Qué cambió respecto del original

**El original es cooperativo de dos personas**: topología `gamepad`, un proyector que simula
y renderiza, y **dos celulares que son mandos**, uno por mitad. Esta versión es de un
jugador. El reparto fue así:

## Lo que se conservó entero

**`logic.ts` casi no cambia.** La paleta partida, el barrido, los ladrillos, las cápsulas,
los cinco niveles, las vidas y el puntaje son idénticos. Las dos mitades siguen existiendo:
lo único que cambia es **de dónde viene el número** que las mueve. Por eso esta versión
conserva lo que hace distinto al juego en vez de ser "un Breakout más".

## Lo que se sacó

| Se sacó | Por qué |
|---|---|
| `useGameNet`, la sala, el rol de host, el roster de jugadores | no hay red |
| El `ControlSpec` del mando (slider con rango, marca del compañero, marca de la pelota, botón "Soltar", estado, hápticos dirigidos) | no hay celulares |
| Los **bots** que ocupaban los asientos vacíos | existían porque el juego no se podía probar con una sola persona; ahora **es** de una sola persona |
| El puntaje **por asiento** (`brickPoints[2]`, `rescues[2]`, `bounces[2]`, `catches[2]`) | se colapsa a un número por partida |
| Las etiquetas "Mitad 1 · persona / bot / libre" bajo cada segmento | no hay a quién identificar |
| El HUD de latencia, el aviso de salas distintas y el `viewSeat` | no hay red |
| El botón "Soltar" del imán | reemplazado por la suelta automática a los 2,2 s, que ya existía como red de seguridad |

## Lo que se agregó

- **El control con dos dedos**, que es lo que reemplaza a las dos personas. El módulo de
  input ya soporta multitouch (`pointers[]`); acá se usa de verdad.
- **El control con un dedo para el par entero**, para que el juego se pueda jugar sin
  pensar en el hueco hasta que hace falta abrirlo.
- **`segmentFollow` sube de 0,45 a 0,7**, porque el suavizado existía para absorber jitter
  de red y con el dedo encima se siente pastoso.

## Si preferís la variante simple

Si el proyecto destino quiere **un Breakout clásico de paleta sólida**, es un cambio chico
pero cambia el juego: fijar `minGap = 0` y `maxSeparation = segmentWidth` deja las dos
mitades pegadas para siempre y el hueco nunca se abre. **No lo recomiendo** —queda un
Breakout normal, y todo lo que hace distinto a este juego desaparece— pero es una línea de
configuración, no un refactor, y los tests siguen pasando.

---

# APÉNDICE E · Mapa del proyecto de origen

| Archivo | Qué es | ¿Portable tal cual? |
|---|---|---|
| `src/games/rompeladrillos/logic.ts` | Física, paleta partida, ladrillos, cápsulas, puntaje (~1210 líneas) | **Casi.** Sacar los arrays por asiento del puntaje; todo lo demás queda. |
| `src/games/rompeladrillos/logic.test.ts` | Los tests (~530 líneas) | **Sí**, ajustando los del puntaje por asiento. |
| `src/games/rompeladrillos/settings.ts` | El schema de administrables | Sí, sacando el grupo "Bots" y subiendo `segmentFollow`. |
| `src/games/rompeladrillos/RompeladrillosGame.tsx` | Escena, red, mando, efectos, dibujo (~1450 líneas) | **No tal cual**: es la mitad del archivo que hay que reescribir. El dibujo se copia entero; la red y el mando se tiran. |
| `src/core/engine/loop.ts` | Loop de paso fijo | **Sí**, tal cual. |
| `src/core/engine/canvas.ts` | Escalado, DPR, letterbox, `toWorld` | **Sí**, tal cual. |
| `src/core/engine/input.ts` | Puntero, **multitouch**, teclado | **Sí**, tal cual. `pointers[]` es la pieza clave acá. |
| `src/core/engine/collide.ts` | `clamp`, `lerp`, **`sweepCircleBox`** | **Sí**, tal cual. `sweepCircleBox` es el corazón del juego. |
| `src/core/engine/rng.ts` | PRNG sembrado | **Sí**, tal cual. |
| `src/core/engine/palette.ts` | Tokens CSS cacheados, `withAlpha` | Sí, cambiando la lista de tokens. |
| `src/core/engine/audio.ts` | WebAudio, seis voces sintetizadas, `vibrate` | **Sí**, tal cual. |
| `src/core/engine/useGameLifecycle.ts` | Fases, cuenta regresiva, force-end, HUD, mute | Sí, si el destino usa React. |
| `src/core/engine/useGame2D.ts` | Une lo anterior: `init` / `update` / `draw` / `outcome` | Sí, si el destino usa React. |
| `src/ui/game/GameStage.tsx` | Canvas + HUD + los estados de partida | Reescribir con el design system del destino. |
| `src/core/net/*`, `src/core/contract/control.ts` | Red y contrato del mando | **No se usan** en esta versión. |
| `games-guide/R5-ROMPELADRILLOS.md` | La guía original (cooperativa) | Referencia, leyendo el apéndice D antes. |

**Última advertencia.** El número que más fácil se rompe al portar es el **paso de
simulación**. Si el proyecto destino lo deja en 1/60 "porque es lo normal", el juego va a
parecer que funciona —hasta que la pelota llegue al techo de velocidad y empiece a
atravesar la paleta cada tantas vidas, sin patrón claro. Es 1/120 con acumulador, y el test
del barrido es lo que lo defiende.
