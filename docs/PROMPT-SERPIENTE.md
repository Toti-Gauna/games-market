# Prompt maestro · Serpiente (portable)

> **Qué es este archivo.** El prompt autocontenido para reimplementar Serpiente en **otro
> proyecto**, sin tener acceso a este código. Todo lo que hace falta —reglas, estructuras de
> datos, el render del gusano, tests y criterios de aceptación— está escrito acá.
>
> **Cómo usarlo.** Copiá el archivo entero, desde `# ROL` hasta el final, y pegalo como
> prompt en Claude Code, Codex, Cursor o Copilot. No necesita nada más.
>
> **Ojo:** este prompt **no** describe el render del proyecto de origen tal cual está. La
> sección *El gusano* especifica un render nuevo que reemplaza al actual, con el diagnóstico
> de por qué el actual no alcanzaba. Es la parte más importante del documento.
>
> **Origen.** `src/games/serpiente/` de `juegos-supernova` (guía
> `games-guide/R3-SERPIENTE.md`). El apéndice D mapea archivo por archivo.

---

# ROL

Actuá como **Game-arquitect**: agente arquitecto de videojuegos web.
Priorizá simplicidad, vertical slicing, game feel y performance.
Usá el stack más chico que resuelva el juego. Primero loop jugable, después polish.
Leé los archivos antes de modificarlos y explicá las decisiones no obvias.

Este juego es chico a propósito: la lógica entera son ~200 líneas. **Si implementarlo pide
mucho más que eso, el runtime está mal y hay que arreglar el runtime, no el juego.** La
complejidad de este prompt está casi toda en el render.

---

# OBJETIVO

Implementar **Serpiente**: un Snake donde lo que se recoge son **principios de la cultura de
la empresa** —palabras configurables— y donde el que juega es **un gusano**, no una cadena de
cuadrados.

La lectura es obvia sin explicarla: **crecés juntando lo que la empresa dice que importa, y
te caés por no mirar dónde estás parado.** No hace falta un cartel que lo diga.

Un jugador, sin red, sin backend, partidas de 40 a 90 segundos. Termina emitiendo un
`outcome` que el contenedor guarda o muestra.

---

# CORE LOOP

El jugador **gira el gusano** con el dedo o las flechas, **come el principio** que aparece en
el tablero, el gusano **crece y acelera**, y el tablero se le va llenando de su propio cuerpo.

- **Pierde** al chocar contra un borde o contra sí mismo. No hay victoria: la partida termina
  por choque o por tiempo, y la pregunta es cuántos principios juntaste.
- **La tensión es que crecer es el castigo.** Cada principio suma puntos y te deja menos
  lugar. Y acelera.
- **El bono por tiempo** premia sobrevivir: sin él, la estrategia óptima es lanzarse a lo
  loco.

---

# PLATAFORMA Y STACK

- **Plataforma:** web, escritorio y móvil.
- **Render:** **Canvas 2D**. Nada más.
- **Lenguaje:** TypeScript en modo `strict`, con `noUncheckedIndexedAccess`.
- **UI/HUD:** React 19 (o el framework del destino). El HUD va en **DOM** encima del canvas.
- **Tests:** Vitest (o el runner del destino), sin navegador.

**No usar:**

- **No** engine de render ni de física.
- **No** una entidad por segmento: el cuerpo es un **ring buffer** sobre arrays tipados.
- **No** recorrer el cuerpo para detectar el choque contra uno mismo: es O(1) con una grilla
  de ocupación.
- **No** `Math.random()`: la comida sale del PRNG sembrado.
- **No** wrap-around en los bordes: atravesarlos hace el juego más fácil y más aburrido.
- **No** assets de imagen ni de sonido: todo se dibuja y se sintetiza.

---

# ARQUITECTURA OBLIGATORIA

```
serpiente/
  logic.ts        # el juego entero: sin React, sin canvas, sin DOM. ~200 líneas.
  logic.test.ts   # los tests de logic.ts
  settings.ts     # el schema de administrables (incluye las palabras)
  SerpienteGame.tsx  # escena, input, el render del gusano, HUD. Cero reglas.
```

## El runtime mínimo

| Pieza | Contrato | Por qué |
|---|---|---|
| **Loop de paso fijo** | `createLoop(update: (dt) => void, render: (alpha) => void, { step })` con `dt = 1/60` constante y tope de `0.25 s` por frame. | El paso de grilla es independiente del paso del loop: ver más abajo. |
| **Canvas escalado** | `setupCanvas(canvas, { designWidth, designHeight, maxDpr })` → `{ ctx, toWorld, dispose() }`. Letterbox conservando aspecto. | El juego dibuja en `cols·40 × rows·40` y no se entera del tamaño real. |
| **DPR topeado** | `min(devicePixelRatio, 1.5)` en puntero grueso, `2` en escritorio. | — |
| **Input** | `createInput(container, { toWorld, swipeThreshold })` → `state.swipe { dir }`, `state.axis { x, y }` (flechas y WASD), `state.keys`. `endFrame()` limpia los flags. Ignora los eventos con `target.closest("[data-game-ui]")`. | El swipe con umbral de 24 px es todo el control táctil. |
| **PRNG sembrado** | `createRng(seed)` → `{ next, int, range }`. FNV-1a + mulberry32. | Con la misma semilla la comida cae en el mismo lugar y en el mismo orden. |
| **Object pool** | `createPool<T extends { alive: boolean }>(capacity, factory)`. | Sólo para las palabras flotantes. |
| **Paleta** | `readPalette()` una vez, cacheado. `mixHex(a,b,t)` y `withAlpha(hex,a)` **precalculados fuera del loop**. | El degradé del cuerpo se precalcula: mezclar un color por segmento y por frame no. |
| **Audio** | WebAudio a mano: `pick` y `lose`. **Arranca en silencio.** | — |
| **Ciclo de vida** | Fases `intro → countdown → playing → paused → over`, cuenta regresiva de 3, `AbortSignal` para force-end, `setHud` que sólo dispara render si algo cambió. | — |

## Contrato del componente

```ts
type GameProps = {
  config: {
    seed: string;
    durationMs: number | null;     // típicamente 90_000
    settings: Record<string, ...>; // administrables ya mezclados con los defaults
    debug: boolean;
  };
  signal: AbortSignal;             // al abortar, emitir el resultado parcial EN EL ACTO
  onFinish: (outcome: GameOutcome) => void;  // exactamente una vez
};
```

---

# LA LÓGICA

## Representación: ring buffer + grilla de ocupación

```ts
export type SnakeState = {
  cols: number; rows: number;
  capacity: number;              // cols · rows
  xs: Int16Array;                // el cuerpo, como ring buffer
  ys: Int16Array;
  head: number;                  // índice del ring donde está la cabeza
  length: number;
  occupied: Uint8Array;          // 1 por celda ocupada. Choque en O(1)
  dir: Direction;
  queued: Direction | null;      // cola de UN solo giro
  pendingGrowth: number;
  speed: number;                 // celdas por segundo
  stepClock: number;             // segundos acumulados hacia el próximo paso
  eaten: number;
  foodX: number; foodY: number; foodWord: number;
  dead: boolean;
  rules: SnakeRules;
};
```

**Las dos decisiones que hacen que esto sea barato:** el cuerpo no se recorre nunca para
detectar colisiones (la grilla de ocupación responde en O(1)) y no se asigna nada por paso
(el ring buffer se escribe en su lugar).

## El paso de grilla

El paso de grilla es **independiente del paso del loop**: el loop corre a 60 Hz y la
serpiente avanza a `speed` celdas por segundo.

```ts
snake.stepClock += dt * snake.speed;
while (snake.stepClock >= 1) {
  snake.stepClock -= 1;
  const result = stepSnake(snake, rng, wordCount);
  // …
}
```

`stepClock` queda entre 0 y 1 y es **exactamente el `t` de interpolación** que necesita el
dibujo. No hace falta ningún otro reloj.

Orden interno de `stepSnake`:

```
1. si está muerta → "died"
2. aplicar el giro encolado, si hay
3. calcular la celda siguiente
4. si se sale del tablero → muere              // sin wrap-around
5. calcular la celda de la cola y si ESTE paso la libera (pendingGrowth === 0)
6. si la celda siguiente está ocupada Y no es la cola que se libera → muere
7. si hay crecimiento pendiente → consumirlo y alargar; si no → liberar la cola
8. avanzar la cabeza en el ring y marcar la celda
9. si la celda era la comida → comer: eaten++, crecer, acelerar, reubicar comida
```

> **El paso 5–6 es el que se hace mal.** La celda de la cola deja de estar ocupada en este
> mismo paso, así que **pisarla es legal**. Sin esa excepción, la serpiente muere
> persiguiéndose a sí misma a velocidad alta, y el jugador no entiende por qué.

## El giro

```ts
export function queueTurn(state: SnakeState, dir: Direction): void {
  // El giro se compara contra el ÚLTIMO GIRO ENCOLADO, no contra la dirección
  // actual: si no, dos deslizadas rápidas se pisan y una se pierde.
  const reference = state.queued ?? state.dir;
  if (dir === reference || dir === OPPOSITE[reference]) return;
  state.queued = dir;
}
```

**Esa cola de una posición es el detalle que separa un Snake que se siente bien de uno que se
siente injusto.** A velocidad alta, el jugador desliza dos veces antes del siguiente paso; sin
la cola, la segunda se pierde y el gusano se estrella "solo".

No se puede girar 180°: intentarlo **se ignora**, en vez de matar al jugador por un mal gesto.

## La comida

```ts
export function placeFood(state: SnakeState, rng: Rng, wordCount: number): void {
  const free = state.cols * state.rows - state.length;
  if (free <= 0) return;
  // Se sortea el N-ésimo hueco libre y se recorre la grilla hasta encontrarlo:
  // recorrer no asigna, y reintentar hasta pegarle a una celda libre haría que
  // la cantidad de tiradas dependa de cuánto ocupa el cuerpo — y ahí se pierde
  // la reproducibilidad con la misma semilla.
  let target = rng.int(0, free - 1);
  for (let i = 0; i < state.cols * state.rows; i++) {
    if (state.occupied[i] === 1) continue;
    if (target === 0) {
      state.foodX = i % state.cols;
      state.foodY = Math.floor(i / state.cols);
      state.foodWord = wordCount > 0 ? rng.int(0, wordCount - 1) : 0;
      return;
    }
    target--;
  }
}
```

Dos tiradas por comida, **siempre**: la celda y la palabra. Nunca un `while (ocupada)
reintentar`.

## Puntaje

```ts
export function snakePoints(eaten, pointsPerPrinciple, survivedMs, durationMs, maxTimeBonus) {
  const base = eaten * pointsPerPrinciple;
  if (durationMs === null || durationMs <= 0 || maxTimeBonus <= 0) return base;
  const ratio = Math.min(1, survivedMs / durationMs);
  return Math.floor(base + ratio * maxTimeBonus);
}
```

---

# EL GUSANO — cómo se dibuja

**Esta es la parte que hay que hacer bien.** El resto del juego es Snake; esto es lo que lo
hace este juego.

## Diagnóstico: por qué una cadena de `roundRect` no funciona

El render ingenuo —un rectángulo redondeado por celda, con un par de píxeles de margen— se ve
como **varios cuadrados siguiendo a un cuadrado**, y no como un bicho. Tres causas, y las
tres hay que corregirlas:

1. **El margen entre celdas separa el cuerpo.** Con `roundRect(x+2, y+2, CELL-4, CELL-4)` hay
   4 px de aire entre segmento y segmento: el ojo lee piezas sueltas, no un cuerpo.
2. **La cabeza no se interpola.** Si cada segmento se dibuja interpolando *hacia* el que tiene
   adelante, la cabeza no tiene a quién seguir y **se queda pegada a su celda hasta el paso
   siguiente**: salta una celda entera de golpe mientras el resto del cuerpo desliza. Es el
   artefacto que más rompe la ilusión y el más fácil de no ver.
3. **Todos los segmentos son iguales.** Sin cabeza, sin cola y sin dirección, no hay criatura:
   hay una fila de fichas.

## La idea: el cuerpo es una polilínea trazada, no una lista de cajas

Un gusano es **un tubo con extremos redondeados**. En Canvas 2D eso es un trazo con
`lineCap: "round"` y `lineJoin: "round"` sobre la polilínea que pasa por los centros de los
segmentos. Todo lo demás son detalles encima de eso.

### 1. La polilínea, con la interpolación corregida

Sea `c(i)` la celda del segmento `i` contando desde la cabeza (`0` = cabeza), y
`t = stepClock` (0..1).

```
p(i) = lerp(centro(c(i+1)), centro(c(i)), t)     para i = 0 … length-2
```

Cada punto viaja **desde donde está el segmento de atrás hacia donde está él**. Con eso:

- **la cabeza también se mueve**, porque `p(0)` va de `c(1)` a `c(0)`;
- todo el cuerpo se desliza como una sola pieza, un cell por paso;
- el dibujo **va un poco atrás** de la simulación (hasta un cell), que es justo lo que hace
  falta para que la cabeza no se meta visualmente en una pared antes de morir.

Los puntos se calculan **en un `Float32Array` preasignado** (`capacity * 2`), no en un array
de objetos.

### 2. El cuerpo: cápsula por segmento, con afinado

Un trazo no puede cambiar de ancho a lo largo, así que **el cuerpo se traza segmento por
segmento**: de `p(i)` a `p(i+1)`, con `lineCap: "round"`. Los extremos redondeados de dos
cápsulas consecutivas se solapan y se leen como **un cuerpo continuo, sin costuras**.

```
anchoBase = CELL * 0.78

factor de ancho por segmento:
  cabeza (i = 0)      → 1.00
  cuerpo              → 1.00
  últimos 4 segmentos → se afina hasta 0.35 en la punta de la cola
                        w = 0.35 + 0.65 · (restantes / 4)
```

**Regla dura:** el cuerpo se dibuja **opaco** (`globalAlpha = 1`). Cualquier pasada
translúcida —la sombra, el brillo— **tiene que ser un solo trazo continuo sobre toda la
polilínea, nunca cápsula por cápsula**: los solapes de cápsulas semitransparentes se ven como
manchas oscuras en cada articulación.

### 3. El color

Degradé de la cabeza a la cola, **precalculado una vez** en 64 pasos y indexado por posición
**relativa**:

```ts
const stop = Math.round((i / Math.max(1, length - 1)) * 63);
```

Indexarlo por el índice absoluto es el error fácil: con un gusano corto todos los segmentos
caen en las primeras entradas del degradé y el bicho queda de un solo color.

### 4. La ondulación — lo que lo hace estar vivo

Un gusano no es una manguera rígida. Se le suma un desplazamiento **perpendicular** a su
propio recorrido:

```
fase += speed · dt                       // ondula más rápido cuando va más rápido
offset(i) = amplitud(i) · sin(fase · 2.4 − i · 0.55)
amplitud(i) = CELL · 0.07 · envolvente(i)
```

Con una **envolvente que vale 0 en la cabeza**, sube hasta 1 alrededor del tercio delantero y
baja a 0.3 en la cola. La cabeza **no puede ondular**: es donde el jugador mira para apuntar,
y si tiembla, girar se siente imposible.

La perpendicular sale de los vecinos de cada punto (`normalize(p(i-1) - p(i+1))` rotado 90°),
no de la dirección de la simulación: así el giro también se ondula bien.

**Con `prefers-reduced-motion`, la amplitud es 0.** El gusano queda liso y el juego es
idéntico.

### 5. Los anillos

Lo que termina de decir "gusano" y no "tubo": una **marca perpendicular** en cada
articulación.

- Un trazo perpendicular de largo `ancho · 0.72`, `lineWidth 2`, en el color del cuerpo
  mezclado 45 % contra el fondo, `alpha 0.16`.
- **Salteando los dos primeros y los dos últimos segmentos**: la cabeza y la punta de la cola
  no tienen anillos.
- Se dibujan sobre el cuerpo ya pintado, con una sola pasada de `strokeStyle`.

### 6. La cabeza

Sin cabeza no hay bicho. Es lo más barato y lo que más rinde:

- **Un círculo** de radio `ancho · 0.62` en `p(0)`, del color del primer stop del degradé.
- **Dos ojos**: círculos blancos de radio `ancho · 0.17`, a `±ancho · 0.30` sobre la
  perpendicular y `ancho · 0.12` hacia adelante.
- **Dos pupilas**: círculos oscuros de radio `ancho · 0.085`, **desplazadas hacia la comida**
  (`normalize(comida − cabeza) · radioOjo · 0.4`). Cuesta cuatro líneas y hace que el gusano
  parezca que sabe a dónde va.
- **Al comer**, 140 ms de destello: el círculo de la cabeza se dibuja de nuevo en blanco con
  `alpha` decreciente.

### 7. El bulto que viaja — la firma del gusano

Cuando come, **se le nota el bocado bajando por el cuerpo**. Es el detalle que convierte un
tubo en un animal, y es casi gratis:

```ts
bumps: Float32Array   // posiciones en segmentos desde la cabeza, -1 = libre (máx. 4)
```

- Al comer se agrega un bulto en la posición `0.5`.
- **Cada paso de grilla** todos los bultos avanzan `+1`. Al pasar de `length` se apagan.
- Al dibujar, el ancho de cada segmento se multiplica por
  `1 + 0.38 · max(0, 1 − |i − bump| / 1.6)` — una campana angosta de dos segmentos de ancho.

Con el crecimiento en 2 segmentos por principio, el bulto tarda unos segundos en llegar a la
cola: se ve perfectamente.

### 8. Volumen: sombra y lomo

- **Sombra:** un trazo **continuo** de toda la polilínea, ancho `anchoBase`, desplazado
  `(0, 3)`, en el color del fondo mezclado contra negro, `alpha 0.35`. Va **antes** del
  cuerpo. Una sola pasada, por la regla de las translúcidas.
- **Lomo:** un trazo **continuo** de ancho `anchoBase · 0.34`, desplazado `−ancho · 0.16`
  sobre la perpendicular, en el color del cuerpo mezclado 45 % contra el texto, `alpha 0.20`.
  Va **después** del cuerpo y antes de los anillos.

### 9. Al morir

El desarmado desde la cola sigue igual, y ahora es más simple: **se acorta la polilínea**.
`visible = round(length · (1 − deathMs / 400))`, con un mínimo de 1. El gusano se va comiendo
a sí mismo desde atrás durante 400 ms y recién ahí aparece el resumen. Cortar en seco se
siente como un cuelgue, no como una derrota.

Con reduced-motion no hay desarmado: se resuelve en el acto.

## Orden de dibujo

```
1. fondo + grilla apenas visible
2. la comida (el principio) + su etiqueta
3. sombra del gusano        (UN trazo continuo, translúcido)
4. cuerpo                   (cápsula por segmento, opaco, con ancho variable)
5. lomo                     (UN trazo continuo, translúcido)
6. anillos                  (una pasada)
7. cabeza: círculo, ojos, pupilas
8. destello de la cabeza al comer
9. palabras flotantes
```

## Presupuesto

Con un tablero de 24 × 16, un gusano largo son ~40 segmentos: **~40 trazos del cuerpo + 36
anillos + 2 trazos continuos + 5 círculos de la cabeza ≈ 85 llamadas de dibujo por cuadro**.
A 60 fps son ~5.000 por segundo, que Canvas 2D absorbe sin despeinarse.

Si alguna vez no llegara: **primero los anillos, después el lomo, después la ondulación.** El
cuerpo, la cabeza y los ojos no se tocan — son lo que hace que sea un gusano.

## Cero asignaciones

- La polilínea vive en un **`Float32Array` preasignado** de `capacity * 2`.
- Las perpendiculares se calculan **en el momento**, en dos variables locales, no en un array
  de vectores.
- El degradé son **64 strings precalculados** en el `init`.
- Los bultos son un **`Float32Array` de 4**, no una lista.
- Nada de `new`, `{}`, `[]` ni template literals dentro de `update` ni de `draw`.

---

# EL RESTO DE LA PRESENTACIÓN

## Tablero y comida

- **Mundo:** `cols · 40 × rows · 40` (24 × 16 celdas ⇒ **960 × 640**).
- **Grilla de fondo** apenas visible: `--sn-violet-500` al 8 %, líneas de 1 px, **en un solo
  `Path2D`**. Da lectura del tablero sin competir con nada.
- **El principio a comer:** un círculo en `--sn-cyan-400` que **late** suavemente
  (`radio = CELL · (0.3 + sin(pulso · 4) · 0.12)`), con la palabra escrita arriba en
  `--sn-cyan-300`.

> **Dos bugs del original que hay que corregir acá:** la etiqueta se dibuja centrada en la
> celda de la comida, así que **se corta contra el borde derecho** cuando la comida cae en la
> última columna, y **se va de la pantalla por arriba** cuando cae en la fila 0. La `x` del
> texto se recorta a `[anchoTexto/2, ancho − anchoTexto/2]` (medido una vez por comida, no
> por cuadro) y, si la comida está en las dos primeras filas, la etiqueta va **debajo** del
> círculo en vez de arriba.

## Al comer

- Destello de 140 ms en la cabeza.
- La **palabra del principio sube y se desvanece** desde la cabeza (pool de 4, vida 0,9 s,
  sube 34 px/s).
- Sonido `pick` y vibración de 12 ms.

## `prefers-reduced-motion`

- Sin ondulación, sin latido de la comida, sin destello, sin desarmado, sin palabras
  flotantes.
- **El juego es idéntico**: nada de esto toca una regla.

---

# ADMINISTRABLES

| Grupo | Clave | Label | Default | Rango | Paso | Unidad |
|---|---|---|---|---|---|---|
| Dificultad | `startSpeed` | Velocidad inicial | **6** | 3–12 | 0.5 | celdas/s |
| Dificultad | `speedGain` | Aceleración por principio | **0.35** | 0–1 | 0.05 | celdas/s |
| Dificultad | `maxSpeed` | Velocidad máxima | **14** | 6–20 | 0.5 | celdas/s |
| Dificultad | `growth` | Crecimiento por principio | **2** | 1–5 | 1 | segmentos |
| Tablero | `cols` | Columnas del tablero | **24** | 12–32 | 1 | — |
| Tablero | `rows` | Filas del tablero | **16** | 8–24 | 1 | — |
| Puntaje | `pointsPerPrinciple` | Puntos por principio | **50** | 10–200 | 10 | — |
| Puntaje | `timeBonus` | Bono máximo por tiempo | **200** | 0–500 | 25 | — |
| Contenido | `principles` | Principios de la cultura | 8 palabras | 3–24 | — | lista |

Defaults de `principles`: *Transparencia, Foco, Equipo, Cliente, Simpleza, Coraje, Aprender,
Cuidado.*

Textos de ayuda que vale la pena mantener, porque explican **por qué** existe el número:

- `startSpeed`: "Celdas por segundo al arrancar. Debajo de 5 se siente lenta."
- `speedGain`: "Cuánto acelera cada vez que comés. En 0 la partida nunca se pone difícil."
- `maxSpeed`: "Techo duro. Arriba de 16 el deslizar deja de llegar a tiempo."
- `rows`: "Un tablero más chico hace partidas más cortas y más nerviosas."
- `timeBonus`: "Premia sobrevivir. Sin bono, la estrategia óptima es lanzarse a lo loco."
- `principles`: "Las palabras que la serpiente recoge. Son las que ve el jugador."

**Las palabras son contenido, no código.** Cambiar los principios de una empresa a otra no
puede pedir tocar un archivo `.ts`.

---

# CONTROL

Un solo esquema, que funciona en teléfono y en escritorio:

- **Deslizar** en cualquier dirección gira. Umbral de **24 px** para no girar por temblor.
- **Flechas y WASD** en escritorio.
- **No se puede girar 180°**: se ignora.
- **El giro se encola** (una posición), comparándose contra el último encolado.

---

# HUD Y ESTADOS

HUD en **DOM**, con `aria-live="polite"` y `data-game-ui`:

- **Puntos** — el dominante, cyan.
- **Principios** — cuántos comió.
- **Velocidad** — con un decimal.
- **Tiempo** — sólo si hay límite; rojo bajo 5 s.
- **fps** — sólo con `config.debug`.

Instrucciones, texto exacto: *"Deslizá o usá las flechas para girar. Comé los principios y no
te choques."*

Resumen: *"Juntaste N principios."*

---

# CONTRATO DE SALIDA

```ts
onFinish({
  completed,
  points: snakePoints(eaten, pointsPerPrinciple, survivedMs, durationMs, timeBonus),
  durationMs,
  meta: {
    principios: snake.eaten,
    largo: snake.length,
    velocidadFinal: Number(snake.speed.toFixed(2)),
    causa: snake.dead ? "choque" : completed ? "tiempo" : "forzado",
  },
});
```

---

# QUÉ NO HACER

- **No** dibujar el cuerpo como cajas separadas: es una polilínea trazada.
- **No** dejar la cabeza sin interpolar: es el artefacto que más rompe la ilusión.
- **No** dibujar pasadas translúcidas cápsula por cápsula: los solapes se ven como manchas.
- **No** ondular la cabeza.
- **No** indexar el degradé por índice absoluto en vez de por posición relativa.
- **No** recorrer el cuerpo para detectar el choque: está la grilla de ocupación.
- **No** reintentar tiradas del PRNG al ubicar la comida.
- **No** wrap-around en los bordes.
- **No** matar al jugador por un giro de 180°: se ignora.
- **No** perder el segundo giro de una deslizada rápida: se encola.
- **No** olvidar la excepción de la celda de la cola.
- **No** poner reglas del juego en el componente, ni dibujo en `logic.ts`.

---

# TESTS OBLIGATORIOS

Van sobre `logic.ts`, sin navegador.

**Determinismo**
1. La misma semilla pone la comida en el mismo lugar.
2. Semillas distintas divergen.
3. La misma semilla y los mismos giros dan la misma partida completa.

**Giros**
4. Ignora el giro de 180 grados.
5. Encola un giro válido.
6. **El segundo giro se compara contra el encolado, no contra la dirección actual.**

**Movimiento y muerte**
7. Choca contra el borde (probar los cuatro).
8. **Puede pisar la celda de la cola cuando no está creciendo** — y **no** puede cuando sí lo
   está.
9. Comer hace crecer y acelerar.
10. Respeta el techo de velocidad.
11. La comida nunca aparece sobre el cuerpo.

**Puntaje**
12. Suma base por principio y bono proporcional al tiempo.
13. Sin límite de tiempo no hay bono.
14. El bono no supera su techo aunque se pase de tiempo.

---

# CRITERIOS DE ACEPTACIÓN

- [ ] `tsc --noEmit` en verde, en modo `strict` con `noUncheckedIndexedAccess`.
- [ ] Todos los tests de la sección anterior pasan.
- [ ] Se juega de principio a fin: crece, acelera, choca, y "Jugar de nuevo" funciona.
- [ ] **Se ve un gusano, no una fila de cuadrados**: cuerpo continuo, cabeza con ojos, cola
      afinada, y el bocado bajando por el cuerpo después de comer.
- [ ] **La cabeza se mueve de forma continua**, sin saltar una celda por paso.
- [ ] En las articulaciones **no se ven manchas oscuras** (la regla de las pasadas
      translúcidas).
- [ ] El gusano ondula, y **la cabeza no tiembla**.
- [ ] La etiqueta del principio **nunca se corta contra un borde**.
- [ ] Dos deslizadas rápidas seguidas hacen dos giros, no uno.
- [ ] La serpiente **no muere persiguiéndose a sí misma** cuando la cola libera la celda.
- [ ] 60 fps con el gusano ocupando media pantalla.
- [ ] **Cero recolecciones de basura en 90 segundos**, verificable en el perfil de memoria.
- [ ] `force-end` emite el outcome con lo acumulado, **una sola vez**.
- [ ] Con `prefers-reduced-motion` no hay ondulación, latido, destello ni desarmado, y **la
      partida es idéntica**.
- [ ] Al desmontar no queda ni un `requestAnimationFrame`, ni un listener, ni un
      `ResizeObserver`, ni un `AudioContext` abierto.
- [ ] Cero errores y cero warnings en consola.

---

# ORDEN DE IMPLEMENTACIÓN

| # | Slice | Se cierra cuando |
|---|---|---|
| 1 | **Runtime**: loop de paso fijo, canvas con DPR, input con swipe y flechas, PRNG. | El swipe se lee como dirección y el loop corre a 60 fps. |
| 2 | **La lógica** (`logic.ts` + tests): ring buffer, grilla de ocupación, paso, giro encolado, comida, muerte, puntaje. | Los 14 tests pasan. Todavía no se ve nada. |
| 3 | **Render básico**: tablero, grilla, comida con etiqueta, y el cuerpo como polilínea trazada con la interpolación corregida. | Se juega, y el cuerpo ya se ve continuo y con cabeza. |
| 4 | **El gusano completo**: afinado de la cola, ondulación, anillos, ojos con pupilas, sombra, lomo, bulto que viaja. | Los criterios visuales del gusano. |
| 5 | **Cierre**: HUD, destello, palabras flotantes, desarmado al morir, outcome, reduced-motion. | Todos los criterios de aceptación. |

---

# ENTREGA

Cambios pequeños y revisables, un slice por vez. Explicá las decisiones no obvias con un
comentario que diga **por qué**, no qué.
Al terminar, listá qué quedó pendiente y por qué.

---
---

# APÉNDICE A · API de `logic.ts`

```ts
export type Direction = "up" | "down" | "left" | "right";

export type SnakeRules = {
  cols: number; rows: number;
  startSpeed: number; speedGain: number; maxSpeed: number;
  growth: number;
};

export type StepResult = "moved" | "ate" | "died";

export function createSnakeState(rules: SnakeRules, rng: Rng, wordCount: number): SnakeState;
export function queueTurn(state: SnakeState, dir: Direction): void;
export function placeFood(state: SnakeState, rng: Rng, wordCount: number): void;
export function stepSnake(state: SnakeState, rng: Rng, wordCount: number): StepResult;

/** Posición de un segmento contando desde la cabeza (0 = cabeza). */
export function segmentAt(state: SnakeState, fromHead: number): { x: number; y: number };

export function snakePoints(
  eaten: number, pointsPerPrinciple: number,
  survivedMs: number, durationMs: number | null, maxTimeBonus: number,
): number;
```

**Nota sobre `segmentAt`:** devuelve un objeto, y el render lo llama una vez por segmento y
por cuadro. En un juego de 40 segmentos son 2.400 objetos por segundo — poco, pero
innecesario. **En la reimplementación conviene una variante que escriba sobre un destino**
(`readSegment(state, fromHead, out)`) o que devuelva las coordenadas por separado, ya que el
render las necesita para armar la polilínea.

Estado inicial: 3 segmentos horizontales, mirando a la derecha, arrancando en
`(floor(cols/4), floor(rows/2))` — con lugar por delante para que el primer segundo no sea
una emergencia.

---

# APÉNDICE B · Constantes del render

```ts
const CELL = 40;
const UNRAVEL_MS = 400;        // desarmado desde la cola al morir
const MAX_FLOATERS = 4;
const FLASH_MS = 140;

/* El gusano */
const BODY_W = CELL * 0.78;    // ancho del cuerpo
const TAIL_SEGMENTS = 4;       // en cuántos segmentos se afina la cola
const TAIL_MIN = 0.35;         // ancho de la punta, como fracción del cuerpo
const HEAD_R = BODY_W * 0.62;
const EYE_R = BODY_W * 0.17;
const PUPIL_R = BODY_W * 0.085;
const EYE_SPREAD = BODY_W * 0.30;
const EYE_FORWARD = BODY_W * 0.12;

const WIGGLE_AMP = CELL * 0.07;
const WIGGLE_FREQ = 2.4;       // sobre la fase, que avanza con la velocidad
const WIGGLE_PHASE_PER_SEG = 0.55;

const RING_ALPHA = 0.16;
const RING_LEN = 0.72;         // fracción del ancho
const SHADOW_OFFSET_Y = 3;
const SHADOW_ALPHA = 0.35;
const SPINE_W = 0.34;          // fracción del ancho
const SPINE_ALPHA = 0.20;

const MAX_BUMPS = 4;
const BUMP_GAIN = 0.38;        // cuánto engorda el cuerpo el bocado
const BUMP_SPREAD = 1.6;       // ancho de la campana, en segmentos

const GRADIENT_STOPS = 64;
```

---

# APÉNDICE C · El `draw`, paso a paso

```
1. fondo + grilla (un solo Path2D)
2. comida: círculo que late + etiqueta con la x recortada al ancho del campo
3. armar la polilínea en el Float32Array preasignado:
     visible = length, o menos si se está desarmando
     para i = 0 … visible-2:
         p(i) = lerp(centro(c(i+1)), centro(c(i)), t)     ← t = stepClock
         más el offset perpendicular de la ondulación
4. sombra: UN trazo continuo de toda la polilínea, ancho BODY_W, +3 en Y, alpha .35
5. cuerpo: para cada i, trazo de p(i) a p(i+1)
     ancho = BODY_W · taper(i) · (1 + aporte de los bultos)
     color = degradé[ round(i/(visible-1) · 63) ]
     lineCap y lineJoin en "round", globalAlpha = 1
6. lomo: UN trazo continuo, ancho BODY_W·0.34, desplazado en la normal, alpha .20
7. anillos: una pasada, saltando los 2 primeros y los 2 últimos segmentos
8. cabeza: círculo + dos ojos + dos pupilas mirando a la comida
9. destello si acaba de comer
10. palabras flotantes
```

Y en el `update`, además del paso de grilla:

```
· fase de la ondulación += speed · dt
· al comer  → agregar un bulto en 0.5
· en cada paso de grilla → todos los bultos += 1, y se apagan al pasar el largo
```

---

# APÉNDICE D · Mapa del proyecto de origen

| Archivo | Qué es | ¿Portable tal cual? |
|---|---|---|
| `src/games/serpiente/logic.ts` | El juego entero (~200 líneas) | **Sí.** Sólo depende del tipo `Rng`. Conviene agregarle la variante de `segmentAt` que escribe sobre un destino. |
| `src/games/serpiente/logic.test.ts` | Los tests (~150 líneas) | **Sí**, tal cual. |
| `src/games/serpiente/settings.ts` | El schema, con los principios como contenido | Sí, si el destino tiene un panel equivalente; si no, hardcodear los defaults. |
| `src/games/serpiente/SerpienteGame.tsx` | Escena, input, dibujo, HUD (~310 líneas) | **El dibujo del cuerpo, no**: es justo lo que este prompt reemplaza. El resto (input, fases, HUD, comida, flotantes) se copia. |
| `src/core/engine/loop.ts` | Loop de paso fijo | **Sí**, tal cual. |
| `src/core/engine/canvas.ts` | Escalado, DPR, letterbox, `toWorld` | **Sí**, tal cual. |
| `src/core/engine/input.ts` | Swipe con umbral, `axis` de flechas y WASD | **Sí**, tal cual. |
| `src/core/engine/rng.ts` | PRNG sembrado | **Sí**, tal cual. |
| `src/core/engine/pool.ts` | Object pool | **Sí**, tal cual. Sólo para las palabras flotantes. |
| `src/core/engine/palette.ts` | Tokens CSS cacheados, `mixHex`, `withAlpha` | Sí, cambiando la lista de tokens. |
| `src/core/engine/audio.ts` | WebAudio, seis voces sintetizadas, `vibrate` | **Sí**, tal cual. |
| `src/core/engine/useGameLifecycle.ts` | Fases, cuenta regresiva, force-end, HUD, mute | Sí, si el destino usa React. |
| `src/core/engine/useGame2D.ts` | Une lo anterior: `init` / `update` / `draw` / `outcome` | Sí, si el destino usa React. |
| `src/ui/game/GameStage.tsx` | Canvas + HUD + los estados de partida | Reescribir con el design system del destino. |
| `games-guide/R3-SERPIENTE.md` | La guía original | Referencia. **Su sección de presentación describe el render viejo** ("una cadena de celdas redondeadas"): manda este prompt. |

**Última advertencia.** De todo el render del gusano, lo que más se nota si se hace mal no es
la ondulación ni los anillos: es **la interpolación de la cabeza**. Si la cabeza salta una
celda por paso mientras el cuerpo desliza, ninguna cantidad de detalle encima lo va a
arreglar — el bicho va a seguir viéndose como piezas sueltas. Es la primera cosa que hay que
mirar cuando el resultado no convence.
