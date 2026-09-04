# Prompt maestro · Invasores, un jugador (portable)

> **Qué es este archivo.** El prompt autocontenido para implementar Invasores —el Space
> Invaders de este repo— **en versión de un jugador**, en otro proyecto, sin tener acceso a
> este código. Todo lo que hace falta —reglas, números, estructuras de datos, escudos
> erosionables, tests y criterios de aceptación— está escrito acá.
>
> **Cómo usarlo.** Copiá el archivo entero, desde `# ROL` hasta el final, y pegalo como
> prompt en Claude Code, Codex, Cursor o Copilot. No necesita nada más.
>
> **Origen.** `src/games/invasores/` de `juegos-supernova` (guía
> `games-guide/R4-INVASORES.md`). **El original es cooperativo de hasta cuatro celulares**;
> el apéndice D explica exactamente qué se sacó y qué se conservó. El apéndice E mapea
> archivo por archivo.

---

# ROL

Actuá como **Game-arquitect**: agente arquitecto de videojuegos web.
Priorizá simplicidad, vertical slicing, game feel y performance.
Usá el stack más chico que resuelva el juego. Primero loop jugable, después polish.
Leé los archivos antes de modificarlos y explicá las decisiones no obvias.

Este juego tiene tres decisiones de estructura de datos que cargan todo el peso (la horda
como grilla, los escudos como máscara de bits, los eventos como bitmask). Están explicadas
abajo y no son negociables: sin ellas no hay forma de sostener 60 fps con cero
asignaciones.

---

# OBJETIVO

Implementar **Invasores**: un Space Invaders para navegador. Una horda de invasores baja en
zigzag hacia el jugador, que la barre desde abajo con un cañón mientras se esconde detrás de
escudos que se van deshaciendo.

**Oleadas infinitas**, cada una más rápida y más baja que la anterior. Tres vidas. Se pierde
cuando la horda toca el suelo o cuando se acaban las vidas — la partida siempre termina, la
pregunta es cuántas oleadas aguantaste.

Un jugador, sin red, sin backend. Termina emitiendo un `outcome` que el contenedor guarda o
muestra.

---

# CORE LOOP

El jugador **mueve el cañón a lo ancho y dispara hacia arriba**, cada invasor derribado
**acelera a los que quedan**, y cuando la horda se vacía **empieza otra oleada** más rápida
y más abajo.

- **La tensión es la aceleración.** La horda se mueve más rápido cuanto menos invasores
  quedan: el último va **más de tres veces más rápido** que la horda completa. Los primeros
  disparos son cómodos; los últimos son una carrera.
- **Los escudos son un recurso que se gasta.** Protegen, pero se erosionan con cada impacto
  —propio y ajeno— y la horda los pisa al bajar. Esconderse tiene fecha de vencimiento.
- **El bono por precisión** existe para que disparar sin mirar no sea gratis.

---

# PLATAFORMA Y STACK

- **Plataforma:** web, escritorio y móvil, orientación apaisada.
- **Render:** **Canvas 2D**, y casi todo con `fillRect`. El juego es pixel art geométrico.
- **Lenguaje:** TypeScript en modo `strict`, con `noUncheckedIndexedAccess`.
- **UI/HUD:** React 19 (o el framework del destino). El HUD va en **DOM** encima del canvas,
  **nunca** dibujado adentro.
- **Tests:** Vitest (o el runner del destino), sin navegador.

**No usar:**

- **No** engine de render ni de física: son rectángulos moviéndose en línea recta.
- **No** red, ni salas, ni mandos, ni bots. Esta versión es de un jugador **local**.
- **No** una entidad por invasor, ni una por celda de escudo: ver la sección siguiente.
- **No** delta variable: el paso de simulación es fijo, **1/60**.
- **No** colisión barrida: los proyectiles son lentos **a propósito** y entran en un paso de
  1/60 sin necesidad de barrer.
- **No** assets de imagen ni de sonido: todo se dibuja y se sintetiza.

---

# LAS TRES DECISIONES QUE CARGAN EL JUEGO

## 1. La horda es una grilla, no una lista de entidades

Cada invasor es **un bit** en un `Uint8Array`, y su fila y su columna están **implícitas en
el índice**. La posición sale de `hordeX/hordeY` más el desplazamiento de la celda.

**Mover 55 invasores es mover dos números.** Sin esto no hay forma de cumplir cero
asignaciones ni de sostener 60 fps con la horda completa.

```ts
export function invaderX(state, col) { return state.hordeX + col * state.rules.cellW; }
export function invaderY(state, row) { return state.hordeY + row * state.rules.cellH; }
```

Y como la horda rebota contra los **extremos vivos** —no contra los de la grilla original—,
esos extremos se **cachean** (`minCol`, `maxCol`, `maxRow`) y se recalculan sólo cuando
muere alguien. Recalcularlos por cuadro sería recorrer 98 celdas 60 veces por segundo.

## 2. Los escudos son máscaras de bits, no entidades

Cuatro escudos de 20 × 10 celdas viven en **un solo `Uint8Array` de 800 posiciones**.
Erosionar es apagar celdas.

**Un escudo que desaparece de golpe no da la lectura de "acá ya no me puedo esconder".** Se
tienen que comer por zonas, dejando el agujero exactamente donde pegaron los tiros.

## 3. Los eventos del paso viajan como bitmask más contadores

En un mismo paso puede morir un invasor, romperse un escudo y caer el cañón. Un array de
eventos por cuadro son 60 asignaciones por segundo.

```ts
export const EVENT_NONE = 0;
export const EVENT_KILL         = 1 << 0;
export const EVENT_SHIELD       = 1 << 1;
export const EVENT_CANNON_HIT   = 1 << 2;
export const EVENT_WAVE_CLEARED = 1 << 3;
export const EVENT_INVADED      = 1 << 4;
export const EVENT_OVER         = 1 << 5;
export const EVENT_MARCH        = 1 << 6;
export const EVENT_STEP_DOWN    = 1 << 7;
export const EVENT_WAVE_STARTED = 1 << 8;
```

Y para pintar sin asignar, el estado guarda **lo último que pasó**: `killX/killY` (hasta
tantas como proyectiles), `shieldHitX/shieldHitY`, y las banderas del paso. Se pisan en el
paso siguiente: leerlos es cosa del cuadro.

---

# ARQUITECTURA OBLIGATORIA

## 1. La lógica va separada de React y del canvas

```
invasores/
  logic.ts        # el juego entero: sin React, sin canvas, sin DOM. Testeable en Node.
  logic.test.ts   # los tests de logic.ts
  settings.ts     # el schema de administrables
  InvasoresGame.tsx  # escena, input, efectos, dibujo, HUD. Cero reglas.
```

**Regla dura:** el componente **no decide nada del juego**. Lee el input, lo traduce a una
posición normalizada y a un evento de disparo, corre la simulación, y dibuja.

## 2. El runtime mínimo que el juego necesita

Si el proyecto destino ya tiene estas piezas, **usalas**. Si no, implementalas con
exactamente este contrato.

| Pieza | Contrato | Por qué |
|---|---|---|
| **Loop de paso fijo** | `createLoop(update: (dt) => void, render: (alpha) => void, { step })` con `dt = 1/60` constante, acumulador, tope de `0.25 s` por frame, y `alpha = acc/step`. | Con delta variable la simulación deja de ser determinista y la misma semilla deja de dar la misma partida. El `alpha` interpola el avance de la horda: en un monitor a 120 Hz, sin eso va a saltos. |
| **Canvas escalado** | `setupCanvas(canvas, { designWidth, designHeight, maxDpr })` → `{ ctx, toWorld(clientX, clientY), dispose() }`. Letterbox conservando aspecto, `setTransform` una vez por layout. | El juego dibuja en 1600×900 y no se entera del tamaño real. |
| **DPR topeado** | `min(devicePixelRatio, 1.5)` en puntero grueso, `2` en escritorio. | Renderizar a 3× es la forma más rápida de perder frames. |
| **Input** | `createInput(container, { toWorld })` → `state.pointer { x, y, down, justPressed, justReleased }`, `state.axis.x` (derivado de ←/→ y A/D) y `state.keys`. `endFrame()` limpia los flags. Ignora los eventos cuyo `target.closest("[data-game-ui]")` exista. | Sin la guarda del HUD, la captura de puntero se come el `click` del botón "Jugar". |
| **PRNG sembrado** | `createRng(seed)` → `{ next, int, range, chance }`. FNV-1a + mulberry32. | **Quién dispara y cuándo sale de acá.** Con la misma semilla, los invasores disparan en el mismo orden — y eso es criterio de aceptación. |
| **Paleta** | `readPalette()` lee los tokens CSS una vez y cachea. `withAlpha(hex, a)` **precalculado fuera del loop**. | Armar un color por frame es basura de GC. |
| **Audio** | WebAudio a mano. Voces usadas: `pick`, `hit`, `tick`, `win`, `lose`. **Arranca en silencio.** | — |
| **Ciclo de vida** | Fases `intro → countdown → playing → paused → over`, `AbortSignal` para force-end, `setHud` que sólo dispara render si algo cambió. | El loop corre a 60 fps; React no. |

## 3. Contrato del componente

```ts
type GameOutcome = {
  completed: boolean;          // false en force-end
  points: number;
  durationMs: number;
  meta?: Record<string, unknown>;
};

type GameProps = {
  config: {
    seed: string;                  // decide qué invasor dispara y cuándo
    durationMs: number | null;
    settings: Record<string, ...>; // administrables ya mezclados con los defaults
    debug: boolean;
  };
  signal: AbortSignal;         // al abortar, emitir el resultado parcial EN EL ACTO
  onFinish: (outcome: GameOutcome) => void;  // exactamente una vez
};
```

---

# ESPECIFICACIÓN FUNCIONAL

## Geometría del campo

| | |
|---|---|
| Campo | **1600 × 900** |
| Margen lateral | **70 u** — la horda rebota contra esto, no contra el borde |
| Celda de la horda | **96 × 68** |
| Invasor | **62 × 42** |
| Y de la primera fila, oleada 1 | **120** |
| Cañón | **72 × 38**, con el techo en **y = 800** |
| Suelo (invasión) | **y = 800** — coincide con el techo del cañón |
| Proyectil propio | **6 × 22** |
| Bomba | **8 × 22** |
| Escudos | 4 bloques de **20 × 10 celdas de 8 px**, con el techo en **y = 640** |
| Bombas simultáneas | máx. **8** |
| Proyectiles propios | **1 en vuelo** — es regla del juego, no límite técnico |
| Paso de simulación | **1/60 s** |
| Tope de la grilla | 7 filas × 14 columnas (el resto es aire para que un administrable no desborde un array) |

## La horda

**Forma:** `baseRows` × `baseCols` (3 × 8 por defecto). La fila de arriba usa el tipo de
invasor más chico, las dos siguientes el mediano, el resto el grande. **El tipo es sólo la
forma dibujada: todos valen lo mismo.**

**Marcha:**

```
hordeX += hordeDir · velocidad · dt

// Los límites se calculan sobre las COLUMNAS VIVAS: cuando se vacía una columna
// del borde, la horda gana recorrido, igual que en el original.
leftLimit  = FIELD_MARGIN - minCol · cellW
rightLimit = width - FIELD_MARGIN - invaderW - maxCol · cellW

si se pasa de un límite → se pega al límite y BAJA UN ESCALÓN (22 u) invirtiendo la dirección
```

**El paso característico:** cada **34 unidades recorridas** se alterna el fotograma de los
invasores (`animFrame ^= 1`) y se emite `EVENT_MARCH`. Como la horda acelera, el paso se
acelera solo — es el sonido del original y es información: **la horda va más rápido**.

**La aceleración**, que es lo que da la tensión del juego:

```ts
export function hordeSpeedOf(state): number {
  const waveMult  = 1 + state.wavesCleared * rules.waveSpeedGain;
  const emptiness = 1 - state.aliveCount / state.totalCount;
  return rules.marchSpeed * waveMult * (1 + emptiness * rules.accelFactor);
}
```

Con `accelFactor = 2.2`, el último invasor se mueve **3,2× más rápido** que la horda
completa.

**Al bajar un escalón, la horda come escudo.** Sin eso, esconderse abajo del escudo es una
estrategia ganadora y el juego se vuelve estático.

## El cañón

- Sólo se mueve en X, entre `FIELD_MARGIN + cannonW/2` y su espejo.
- **Persigue** la posición pedida con un lerp en vez de saltar:
  `alpha = min(1, cannonFollow · dt · 60)`. El factor está expresado por cuadro de 60 Hz
  **porque es como se percibe**; se convierte al paso real para que cambiar el timestep no
  cambie la sensación.
- **Un proyectil propio en vuelo a la vez**, más una cadencia de 0,32 s. Las dos condiciones
  son independientes: la cadencia frena el segundo disparo **aunque el primero ya no
  exista**.
- El disparo **se cuenta como disparo en el momento de apretar**, aunque todavía no haya
  impactado: la precisión se mide sobre lo que la persona apretó.
- Durante las pausas (reagrupamiento y cartel de oleada) **el cañón se sigue moviendo**: es
  justamente el momento de reacomodarse. Lo que no corre es la horda ni los proyectiles.

## Las bombas de la horda

```ts
const rate = rules.hordeFireRate * (1 + state.wavesCleared * rules.hordeFireWaveGain);
state.fireClock += dt * rate;
while (state.fireClock >= 1) { state.fireClock -= 1; spawnBomb(state, rng); }
```

**Quién dispara sale del PRNG sembrado**, y con una regla que hay que respetar al pie de la
letra:

> **Se consume UN valor del PRNG siempre, elija la columna que elija.** Se sortea una
> columna de arranque y se recorren las columnas desde ahí buscando la primera con un
> invasor vivo. Si la cantidad de valores consumidos dependiera de qué columnas quedan
> vivas, la serie dejaría de ser reproducible entre dos partidas con la misma semilla.

Dispara **el invasor más bajo** de la columna elegida — el de arriba no le puede tirar a
través del de abajo. Si no hay lugar en el pool de bombas, **el disparo se pierde**:
encolarlo lo haría salir tarde y desde un invasor que a esa altura ya puede estar muerto.

Un tope de **4 sub-eventos por paso** protege el `while` de un administrable absurdo.

## Los escudos

Forma: **domo con bisel arriba y muesca triangular abajo** (por donde sale el propio
disparo).

```ts
function shieldMask(col: number, row: number): number {
  const bevel = 3;
  if (row < bevel && (col < bevel - row || col >= SHIELD_COLS - (bevel - row))) return 0;
  const notchTop = SHIELD_ROWS - 4;
  if (row >= notchTop) {
    const spread = row - notchTop + 1;
    if (Math.abs(col - SHIELD_COLS / 2 + 0.5) < spread) return 0;
  }
  return 1;
}
```

**Erosión:** al impactar se busca la primera celda encendida que toque la caja del
proyectil, y se apaga un **círculo de celdas** alrededor de ese punto:

| Impacto | Radio de erosión (en celdas) |
|---|---|
| Proyectil propio | **1.6** |
| Bomba | **2.1** |
| La horda pisando al bajar | **3** |

**Los invasores se testean ANTES que el escudo.** Cuando la horda ya bajó sobre los
escudos, matarla tiene que seguir siendo posible.

**Escudos nuevos en cada oleada.** Conservarlos erosionados suena más "puro", pero a la
tercera oleada no queda refugio y la dificultad deja de venir de la horda para venir de en
qué oleada te tocó entrar.

## Vidas, oleadas y fin

| Fase | Qué pasa |
|---|---|
| `marching` | el juego normal |
| `regroup` | 1,5 s de pausa tras perder una vida |
| `banner` | 3 s de cartel entre oleadas, con el número y el puntaje |
| `over` | terminó |

- Una bomba en el cañón **cuesta una vida** y limpia todos los proyectiles de la pantalla.
- **Sin pausa, la segunda vida se pierde antes de entender la primera.**
- Vaciar la horda supera la oleada: `wavesCleared++`, cartel, y horda nueva y entera.
- **Cada oleada empieza más abajo** (`waveDrop = 24 u`), **con un tope de 6 descensos**: sin
  tope, la oleada 12 nace invadiendo. Es lo que hace que alguna vez se pierda.
- **Fin:** la horda toca el suelo (`reason: "invaded"`), se acaban las vidas
  (`reason: "lives"`), o se acaba el tiempo si el contenedor fijó duración.
- Terminada la partida, **nada se vuelve a mover**.
- Ojo con el temporizador de las pausas: restar 90 veces `1/60` a `1,5` no da 0 exacto. Hace
  falta un `TIMER_EPS = 1e-6` o la pausa dura un paso de más.

## Puntaje

```ts
export function invadersPoints(kills, hits, shots, wavesCleared, rules): number {
  const own      = kills * rules.pointsPerInvader;                       // 100 c/u
  const accuracy = shots > 0 ? Math.floor((hits / shots) * rules.accuracyBonus) : 0;
  const waves    = wavesCleared * rules.pointsPerWave;                   // 300 c/u
  return Math.max(0, own + accuracy + waves);
}
```

**Sin disparos no hay bono de precisión y no hay `NaN`** — la guarda del `shots > 0` no es
decorativa.

---

# EL CONTROL, EN UN JUGADOR

Dos esquemas, los dos activos a la vez.

## Puntero — la franja de abajo mueve, el toque de arriba dispara

- **Franja táctil inferior** (por debajo de la línea de los escudos): el dedo mueve el cañón
  por **posición absoluta** — donde está el dedo a lo ancho, ahí va el cañón. Es lo mismo
  que hacía el mando del original, ahora dibujado en la propia pantalla.
- **Toque en la mitad superior**: dispara. Un toque, un disparo (por flanco, no por estado:
  mantener el dedo apoyado no dispara en ráfaga).

La posición absoluta es mejor que el control relativo acá: es preciso, no acumula deriva, y
el cañón ya suaviza el salto con su lerp.

## Teclado

- **← / →** (y **A / D**) mueven, a `1.05` pantallas por segundo.
- **Espacio** dispara, **por flanco**: mantener la barra no dispara en ráfaga.
- Al tomar el control se arranca **desde donde está el cañón**, no desde el último valor
  guardado: si no, el cañón salta al apretar la primera tecla.

## Prioridad

El último esquema usado manda, con una **retención de 1,5 s**, para que soltar las teclas un
instante no le devuelva el control al dedo y el cañón pegue un salto.

---

# ADMINISTRABLES

| Grupo | Clave | Label | Default | Rango | Paso | Unidad |
|---|---|---|---|---|---|---|
| Horda | `baseRows` | Filas de la horda | **3** | 2–5 | 1 | — |
| Horda | `baseCols` | Columnas de la horda | **8** | 6–11 | 1 | — |
| Horda | `marchSpeed` | Velocidad de la horda | **95** | 40–300 | 5 | u/s |
| Horda | `accelFactor` | Aceleración por bajas | **2.2** | 0–5 | 0.1 | × |
| Horda | `stepDown` | Escalón al tocar el borde | **22** | 8–60 | 2 | u |
| Horda | `hordeFireRate` | Cadencia de la horda | **1.1** | 0.2–6 | 0.1 | disp/s |
| Cañón | `fireCooldown` | Cadencia del cañón | **0.32** | 0.1–1.5 | 0.05 | s |
| Cañón | `bulletSpeed` | Velocidad del disparo | **900** | 400–1600 | 50 | u/s |
| Cañón | `bombSpeed` | Velocidad de las bombas | **340** | 150–900 | 25 | u/s |
| Cañón | `cannonFollow` | Suavizado del cañón | **0.6** | 0.1–1 | 0.05 | — |
| Partida | `lives` | Vidas | **3** | 1–9 | 1 | — |
| Partida | `regroupPause` | Pausa al perder una vida | **1.5** | 0.5–4 | 0.5 | s |
| Partida | `wavePause` | Cartel entre oleadas | **3** | 1–6 | 0.5 | s |
| Partida | `waveSpeedGain` | Aceleración por oleada | **12** | 0–40 | 1 | % |
| Partida | `waveDrop` | Descenso por oleada | **24** | 0–60 | 5 | u |
| Puntos | `pointsPerInvader` | Puntos por invasor | **100** | 10–400 | 10 | — |
| Puntos | `accuracyBonus` | Bono máximo por precisión | **500** | 0–1200 | 50 | — |
| Puntos | `pointsPerWave` | Puntos por oleada superada | **300** | 0–900 | 50 | — |

> **`cannonFollow` sube a 0,6 en esta versión.** En el original valía 0,45 para absorber el
> jitter de la red; con el dedo o el teclado encima, ese suavizado se siente pastoso.

Textos de ayuda que vale la pena mantener, porque explican **por qué** existe el número:

- `marchSpeed`: "Sobre un campo de 1600 × 900, con la horda completa y en la primera
  oleada."
- `accelFactor`: "velocidad = base × (1 + (1 − vivos/total) × esto). El último invasor va
  3,2× más rápido."
- `hordeFireRate`: "Bombas por segundo en la primera oleada. Quién dispara sale del PRNG
  sembrado."
- `fireCooldown`: "Además hay un solo proyectil propio en vuelo."
- `bulletSpeed`: "Los proyectiles son lentos a propósito: entran en un paso de 1/60 sin
  barrido."
- `bombSpeed`: "Bajar esto es la forma más directa de hacer la partida más indulgente."
- `regroupPause`: "Tiempo para reagruparse. Sin pausa, la segunda vida se pierde antes de
  entender la primera."
- `waveDrop`: "Cada oleada empieza más abajo, hasta un tope. Es lo que hace que alguna vez
  se pierda."
- `accuracyBonus`: "aciertos / disparos × esto. Evita la estrategia de disparar sin mirar."

---

# PRESENTACIÓN Y GAME FEEL

Todo es `fillRect`: **cero assets**, y el pixel art se dibuja con rectángulos sobre una
grilla de 8 × 6 unidades por invasor.

## Colores (tokens CSS, leídos y compuestos una sola vez)

| Uso | Token |
|---|---|
| Fondo | `--sn-bg`, con un halo radial arriba |
| Viñeta | radial de `--sn-bg` transparente al 80 % en los bordes |
| Cañón y sus disparos | `--sn-cyan-400`, con un halo suave detrás |
| Invasores (3 tipos) | tres tonos distintos de la paleta, **agrupados por tipo al dibujar** |
| Escudos | `--sn-success` |
| Bombas | `--sn-danger` |
| Línea del suelo | `--sn-danger` atenuado |
| Vidas | `--sn-text`, en `--sn-danger` cuando queda 1 |
| Cartel de oleada | fondo semitransparente + texto grande |

## Los invasores

Tres formas, **dos fotogramas cada una**, dibujadas con `fillRect` sobre una grilla de
`u = w/8` por `v = h/6`. El fotograma alterna con el avance (cada 34 u recorridas).

**Los dos fotogramas se conservan con `prefers-reduced-motion`:** son **información** (la
horda acelera, y se ve en el ritmo del paso), no decoración.

Se dibujan **agrupados por tipo** para cambiar `fillStyle` tres veces y no 55.

El avance se **interpola con el `alpha` del loop**:
`drift = hordeDir · hordeSpeed · SIM_STEP · alpha`. En un monitor a 120 Hz, sin eso la horda
va a saltos de un paso de simulación.

## Los escudos

Se dibujan **por corridas de celdas encendidas**, no celda por celda:

> 4 × 200 `fillRect` por cuadro son **48.000 llamadas por segundo** para dibujar cuatro
> bloques. Recorriendo cada fila y emitiendo un rectángulo por cada tramo contiguo, son unas
> pocas decenas.

## Proyectiles

- **Propio:** un rectángulo del color del cañón.
- **Bomba:** un **zigzag** de tres trozos alternados (el del medio desplazado un 40 % del
  ancho). Se lee como "esto cae", no como "esto sube" — que es exactamente la distinción que
  hay que hacer a diez metros de un proyector.

Los dos se adelantan con el `alpha` del loop, igual que la horda.

## Cañón, vidas y carteles

- **Cañón:** tres rectángulos (base, torreta y caño) más un halo suave detrás.
- **Al ser alcanzado, parpadea** 900 ms (encendido/apagado cada 90 ms). Con reduced-motion
  se saca el parpadeo, **no el cañón**: la regla del juego no cambia.
- **Vidas: enormes, arriba al centro.** 84 px, con la etiqueta debajo. Es el número que
  importa y tiene que leerse sin buscarlo.
- **Cartel de oleada:** banda semitransparente con el número de oleada y el puntaje.
- **Aviso** de una línea para los eventos (oleada superada, cañón alcanzado), 2,6 s.
- **"A reagruparse"** durante la pausa por vida perdida.

## Partículas, flash y sacudida

- **Chispas:** 200 máximo en arrays planos, 12 por invasor derribado, 4 por impacto en
  escudo, 24 al caer el cañón. Gravedad 520, vida 0,25–0,60 s, dibujadas como cuadraditos
  de 5 px.
- **Flash** de 160 ms y **sacudida** de 320 ms (±7 px) al ser alcanzado. Con la sacudida
  activa hay que **sobredibujar el fondo** unos píxeles fuera del campo, o queda una franja
  vacía en el borde.
- **El azar de las partículas NO puede salir del PRNG sembrado.** Con
  `prefers-reduced-motion` no se emiten partículas, así que consumir el PRNG de la
  simulación acá haría que **dos máquinas con la misma semilla vieran disparar a invasores
  distintos según una preferencia del sistema operativo**. Se precalcula una tabla de 64
  valores de ruido y se recorre con un cursor.

## Sonido

| Evento | Sonido |
|---|---|
| Disparo propio | `pick` |
| Invasor derribado | `hit` |
| Paso de la horda | `tick`, **con un mínimo de 110 ms entre sonidos** |
| Oleada superada | `win` |
| Cañón alcanzado | `lose` |
| Fin de partida | `lose` |

**El cooldown del paso no es opcional:** con la horda acelerada, `EVENT_MARCH` se dispara
hasta 37 veces por segundo y sin el mínimo suena a estática.

## `prefers-reduced-motion`

- Sin chispas, sin flash, sin sacudida, sin parpadeo del cañón.
- **Los dos fotogramas de los invasores se conservan**: son información.
- El fin de partida no espera 1,8 s: se resuelve en el acto.

---

# HUD Y ESTADOS

HUD en **DOM**, con `aria-live="polite"` y `data-game-ui`:

- **Puntos** — el dominante, magenta.
- **Oleada** — cyan.
- **Invasores** — los que quedan en pie.
- **Vidas** — también en el canvas, en grande; en el HUD como respaldo, rojo cuando queda 1.
- **Tiempo** — sólo si hay límite.
- **fps** — sólo con `config.debug`.

El HUD se actualiza reusando **un objeto de patch**: un literal nuevo por cuadro es basura
por cuadro.

Instrucciones, texto exacto: *"Deslizá abajo para mover el cañón y tocá arriba para
disparar. Con teclado: ← → mueven y Espacio dispara. La horda acelera cuantos menos quedan,
y los escudos no duran para siempre."*

Resumen: los puntos, las oleadas superadas y la causa del final.

---

# CONTRATO DE SALIDA

```ts
onFinish({
  completed,                    // false en force-end
  points: invadersPoints(kills, hits, shots, wavesCleared, rules),
  durationMs,
  meta: {
    oleadasSuperadas: state.wavesCleared,
    invasoresDerribados: state.kills,
    disparos: state.shots,
    precision: state.shots > 0 ? Math.round((state.hits / state.shots) * 100) : 0,
    vidasRestantes: state.lives,
    motivo: state.reason === "invaded" ? "la horda llegó abajo"
          : state.reason === "lives"   ? "sin vidas"
          : completed ? "tiempo" : "forzado",
  },
});
```

---

# PERFORMANCE

| | |
|---|---|
| Objetivo | **60 fps con la horda completa** |
| En pantalla | hasta 98 invasores + 800 celdas de escudo + 9 proyectiles + 200 chispas |
| Asignaciones por frame | **cero** |
| Si no llega | primero las chispas, después el halo del cañón |

Cómo se consigue, que es la parte que hay que hacer bien:

- **La horda es una grilla de bits** y se mueve con dos números.
- **Los extremos vivos están cacheados** y se recalculan sólo al morir alguien.
- **Los escudos son un `Uint8Array`** y se dibujan por corridas.
- **Los eventos son un bitmask** más contadores, no objetos.
- **Las chispas viven en arrays planos**, no en un pool con callback: `pool.each` pide un
  callback, y eso es una closure nueva por cuadro.
- **Etiquetas numéricas precalculadas**: `String(n)` por cuadro es una asignación por
  cuadro. Una tabla de 0..255 alcanza.
- **El patch del HUD se reusa**, y el texto del cartel de oleada se recalcula sólo cuando
  cambia la oleada.
- **Los scratch de colisión (`boxA`, `boxB`) viven en el estado.**
- **Degradés precalculados** en el `init`.
- Nada de `new`, `{}`, `[]`, `.map` ni template literals dentro de `update` ni de `draw`.

---

# QUÉ NO HACER

- **No** una entidad por invasor ni una por celda de escudo.
- **No** recalcular los extremos vivos por cuadro.
- **No** dibujar los escudos celda por celda.
- **No** delta variable.
- **No** consumir una cantidad variable de valores del PRNG al elegir quién dispara.
- **No** consumir el PRNG sembrado dentro del `draw` ni para las partículas.
- **No** encolar las bombas que no entran en el pool: se pierden.
- **No** dejar que la horda ignore los escudos al bajar.
- **No** conservar los escudos erosionados entre oleadas.
- **No** quitar los dos fotogramas de los invasores con reduced-motion: son información.
- **No** quitar el cooldown del sonido del paso.
- **No** poner reglas del juego en el componente, ni dibujo en `logic.ts`.

---

# TESTS OBLIGATORIOS

Van sobre `logic.ts`, sin navegador. Hacen falta helpers para armar un estado con reglas de
laboratorio, colocar la horda a mano y correr N pasos.

**Determinismo**
1. La misma semilla dispara los mismos invasores en el mismo orden.
2. Semillas distintas divergen.
3. La horda arranca igual con la misma configuración.

**Aceleración**
4. La horda acelera al quedar menos invasores (por fórmula).
5. **Matar invasores de verdad sube la velocidad** (no sólo la fórmula: el estado real).
6. Cada oleada arranca más rápido que la anterior.

**Colisión proyectil–invasor**
7. El proyectil derriba al invasor y lo cobra el jugador.
8. **Un proyectil derriba a UN solo invasor, no a la columna.**
9. El proyectil que no toca nada sigue viaje.
10. Un solo proyectil propio en vuelo a la vez.
11. **La cadencia frena el segundo disparo aunque el primero ya no exista.**

**Entrada saneada**
12. Una posición imposible no mueve el cañón fuera del campo.
13. `NaN` y valores inventados se ignoran.
14. La posición normalizada es la inversa exacta del objetivo.

**Final de partida**
15. Termina cuando la horda toca el suelo, con `reason: "invaded"`.
16. Una bomba en el cañón cuesta una vida y limpia los proyectiles.
17. Termina al quedarse sin vidas, con `reason: "lives"`.
18. **Terminada, la partida no vuelve a moverse.**
19. La pausa de reagrupamiento **frena la horda pero deja mover el cañón**.

**Oleadas**
20. Vaciar la horda supera la oleada y levanta el cartel.
21. Terminado el cartel arranca una horda nueva y entera.
22. **Cada oleada empieza más abajo, con tope**: la oleada 12 no nace invadiendo.

**Escudos**
23. **Se erosionan por zonas, no desaparecen de golpe** (contar celdas antes y después).
24. Cada oleada repone los escudos.
25. La horda pisa el escudo al bajar sobre él.

**Puntaje**
26. Propios más precisión más oleadas.
27. **Disparar sin mirar cuesta el bono de precisión.**
28. Sin disparos no hay bono de precisión **y no hay `NaN`**.

---

# CRITERIOS DE ACEPTACIÓN

- [ ] `tsc --noEmit` en verde, en modo `strict` con `noUncheckedIndexedAccess`.
- [ ] Todos los tests de la sección anterior pasan.
- [ ] Se juegan varias oleadas seguidas y la dificultad sube de forma legible.
- [ ] **La horda acelera de verdad**: el último invasor va notoriamente más rápido que la
      horda completa.
- [ ] El paso de la horda (fotograma + sonido) acelera con ella.
- [ ] **Los escudos se comen por zonas**, dejando el agujero donde pegaron los tiros, y la
      horda los pisa al bajar.
- [ ] Con la misma semilla, los invasores disparan en el mismo orden.
- [ ] **Un proyectil derriba a un solo invasor.**
- [ ] Se puede jugar entero **con el dedo** (franja abajo + toque arriba) y entero **con el
      teclado**, y cambiar de uno a otro no hace saltar el cañón.
- [ ] La bomba se distingue del proyectil propio **de un vistazo** (zigzag vs recto, y
      color).
- [ ] 60 fps con la horda completa, 200 chispas y los cuatro escudos intactos.
- [ ] **Cero recolecciones de basura en 90 segundos**, verificable en el perfil de memoria.
- [ ] `force-end` (abortar el `AbortSignal`) emite el outcome con lo acumulado, **una sola
      vez**.
- [ ] Con `prefers-reduced-motion` no hay chispas, flash, sacudida ni parpadeo, **pero los
      dos fotogramas de los invasores siguen alternando**.
- [ ] Al desmontar no queda ni un `requestAnimationFrame`, ni un listener, ni un
      `ResizeObserver`, ni un `AudioContext` abierto.
- [ ] Cero errores y cero warnings en consola.

---

# ORDEN DE IMPLEMENTACIÓN

Cinco slices, cada uno verificable solo. No pasar al siguiente sin cerrar el anterior.

| # | Slice | Se cierra cuando |
|---|---|---|
| 1 | **Runtime**: loop de paso fijo, canvas con DPR y letterbox, input de puntero y teclado, PRNG. | El cañón se mueve con el dedo y con las flechas a 60 fps. |
| 2 | **La horda** (`logic.ts` + tests): grilla de bits, marcha, rebote contra columnas vivas, escalón, aceleración, extremos cacheados. | Los tests de aceleración pasan y la horda rebota bien al vaciarse una columna del borde. |
| 3 | **Disparos y colisión**: proyectil propio, cadencia, bombas con PRNG, impactos, vidas, fin de partida. | Los tests de colisión, entrada saneada y final pasan. |
| 4 | **Escudos y oleadas**: máscara de bits, erosión por zonas, aplastado de la horda, cartel, descenso por oleada, puntaje. | Los tests de escudos, oleadas y puntaje pasan. |
| 5 | **Juego**: componente, dibujo pixel art, chispas, carteles, HUD, sonido, outcome. | Los criterios de aceptación visuales y de performance. |

---

# ENTREGA

Cambios pequeños y revisables, un slice por vez. Explicá las decisiones no obvias con un
comentario que diga **por qué**, no qué.
Al terminar, listá qué quedó pendiente y por qué.

---
---

# APÉNDICE A · Tipos y API de `logic.ts`

```ts
export const MAX_ROWS = 7;      // tope de la grilla: el resto es aire
export const MAX_COLS = 14;
export const MAX_INVADERS = MAX_ROWS * MAX_COLS;

export const MAX_BULLETS = 1;   // un proyectil propio en vuelo: es REGLA, no límite técnico
export const MAX_BOMBS = 8;

export const SHIELD_COUNT = 4;
export const SHIELD_COLS = 20;
export const SHIELD_ROWS = 10;
export const SHIELD_CELLS = SHIELD_COLS * SHIELD_ROWS;

export const INVADER_TYPES = 3; // sólo cambian la forma dibujada: todos valen lo mismo
export const FIELD_MARGIN = 70; // la horda rebota contra esto, no contra el borde

const MARCH_DISTANCE = 34;      // distancia entre fotogramas: el paso del original
const TIMER_EPS = 1e-6;         // restar 90 veces 1/60 a 1,5 no da 0 exacto
const MAX_EVENTS_PER_STEP = 4;  // un administrable absurdo no puede colgar el while

export type InvadersPhase = "marching" | "regroup" | "banner" | "over";
export type InvadersReason = "" | "invaded" | "lives";

export type InvadersRules = {
  width: number; height: number;
  floorY: number;                    // llegar acá es invasión; coincide con cannonY
  baseRows: number; baseCols: number;
  cellW: number; cellH: number; invaderW: number; invaderH: number;
  hordeTopY: number;                 // Y de la primera fila en la oleada 1
  waveDropY: number;                 // cuánto más abajo arranca cada oleada
  maxWaveDrops: number;              // tope de descensos acumulados
  marchSpeed: number; accelFactor: number; stepDown: number;
  waveSpeedGain: number;
  cannonW: number; cannonH: number; cannonY: number;
  cannonFollow: number;              // lerp por cuadro de 60 Hz
  fireCooldownS: number;
  bulletSpeed: number; bulletW: number; bulletH: number;
  bombSpeed: number; bombW: number; bombH: number;
  hordeFireRate: number; hordeFireWaveGain: number;
  lives: number; regroupS: number; waveBannerS: number;
  pointsPerInvader: number; pointsPerWave: number; accuracyBonus: number;
  shieldTopY: number; shieldCellW: number; shieldCellH: number;
};

export type InvadersState = {
  rules: InvadersRules;
  phase: InvadersPhase;
  pauseS: number;                    // segundos que faltan de la pausa. 0 = jugando

  wavesCleared: number;

  rows: number; cols: number;
  totalCount: number; aliveCount: number;
  invaderAlive: Uint8Array;          // un BIT por invasor; fila y columna implícitas
  invaderType: Uint8Array;
  minCol: number; maxCol: number; maxRow: number;   // extremos vivos, CACHEADOS

  hordeX: number; hordeY: number; hordeDir: number;
  hordeSpeed: number;                // u/s efectivos del último paso: lo mira el HUD
  animFrame: number; animAccum: number;
  fireClock: number;

  cannonX: number; cannonTargetX: number; cannonCooldown: number;

  bulletAlive: Uint8Array; bulletX: Float32Array; bulletY: Float32Array;
  bombAlive: Uint8Array;   bombX: Float32Array;   bombY: Float32Array;

  shieldCell: Uint8Array;            // 4 escudos × 200 celdas. 1 = queda material
  shieldX: Float32Array; shieldY: Float32Array;

  lives: number;
  kills: number; shots: number; hits: number;

  over: boolean; reason: InvadersReason;

  /* Eventos del paso. Se pisan en el paso siguiente. */
  events: number;
  killCount: number; killX: Float32Array; killY: Float32Array;
  wasHit: boolean;
  shieldHitCount: number; shieldHitX: Float32Array; shieldHitY: Float32Array;

  /* Scratch de colisión: vive acá para no crear un objeto por paso. */
  boxA: Box; boxB: Box;
};

/* Construcción */
export function createInvadersState(rules: InvadersRules): InvadersState;
export function startWave(state: InvadersState): void;
export function rebuildShields(state: InvadersState): void;

/* Entrada saneada */
export function setCannonTarget(state: InvadersState, position: number): void;  // 0..1
export function cannonPosition(state: InvadersState): number;                   // la inversa
export function fireCannon(state: InvadersState): boolean;

/* Lecturas para el render */
export function invaderX(state, col): number;
export function invaderY(state, row): number;
export function hordeBottom(state): number;      // decide la invasión
export function hordeSpeedOf(state): number;
export function shieldCellsLeft(state): number;  // para el HUD y los tests de erosión
export function clearProjectiles(state): void;

/* El paso: la ÚNICA función que mueve algo. Devuelve la máscara de eventos. */
export function stepInvaders(state: InvadersState, dt: number, rng: Rng): number;

/* Puntaje */
export function invadersPoints(kills, hits, shots, wavesCleared, rules): number;
```

---

# APÉNDICE B · Constantes del componente

```ts
const FIELD_W = 1600;      const FIELD_H = 900;

const CELL_W = 96;         const CELL_H = 68;
const INVADER_W = 62;      const INVADER_H = 42;
const HORDE_TOP_Y = 120;   const MAX_WAVE_DROPS = 6;

const CANNON_W = 72;       const CANNON_H = 38;
const CANNON_Y = 800;      // techo del cañón = línea de invasión

const BULLET_W = 6;        const BULLET_H = 22;
const BOMB_W = 8;          const BOMB_H = 22;

const SHIELD_TOP_Y = 640;  const SHIELD_CELL = 8;

const SIM_STEP = 1 / 60;   // los proyectiles son lentos y entran sin barrido
const HORDE_FIRE_WAVE_GAIN = 0.15;

const MAX_SPARKS = 200;    const SPARKS_PER_KILL = 12;
const SPARKS_PER_SHIELD = 4;
const SPARK_GRAVITY = 520; const NOISE_SIZE = 64;

const FLASH_MS = 160;      const SHAKE_MS = 320;   const SHAKE_PX = 7;
const NOTICE_MS = 2600;    const OVER_HOLD_MS = 1800;
const MARCH_SFX_MS = 110;  // el paso no puede sonar 37 veces por segundo al acelerar
const HIT_FLASH_MS = 900;  // parpadeo del cañón alcanzado, alternando cada 90 ms

const KEYBOARD_SPEED = 1.05;   // pantallas por segundo
const INPUT_HOLD_S = 1.5;      // retención antes de ceder el control al otro esquema
```

---

# APÉNDICE C · El `update`, paso a paso

```
1. descontar temporizadores visuales (flash, sacudida, aviso, parpadeo, cooldown de sonido)
2. leer el input:
     · dedo en la franja inferior → setCannonTarget(x normalizado)
     · toque en la mitad superior → fireCannon()  (por flanco)
     · ← → / A D → mover; Espacio → disparar (por flanco)
     · el esquema usado por última vez retiene el control 1,5 s
3. avanzar las chispas
4. si la partida terminó → sostener el tablero 1,8 s y llamar a finish(false)
5. mask = stepInvaders(state, 1/60, rng)
6. reaccionar a la máscara: sonido, chispas, avisos, flash, sacudida
7. publicar el HUD reusando el objeto de patch
```

Y el orden interno de `stepInvaders`:

```
1. limpiar events, killCount, shieldHitCount, wasHit
2. si terminó → devolver EVENT_NONE
3. mover el cañón (lerp) y descontar su cooldown
4. si hay pausa activa:
       descontarla; al vencer, si venía del cartel → startWave()
       RETURN  ← la horda y los proyectiles NO corren durante la pausa
5. mover la horda (rebote contra columnas vivas, escalón, fotograma)
6. mover proyectil y bombas
7. la horda dispara (PRNG: UN valor siempre)
8. resolver el proyectil propio: invasores PRIMERO, escudo después
9. resolver las bombas: escudo primero, después el cañón
10. si no quedan invasores → oleada superada, cartel
11. si el borde inferior de la horda llegó al suelo → invasión, fin
```

---

# APÉNDICE D · Qué cambió respecto del original

**El original es cooperativo de hasta cuatro personas**: topología `gamepad`, un proyector
que simula y renderiza, y **hasta cuatro celulares que son cañones**. Esta versión es de un
jugador.

## Lo que se conservó entero

**Toda la mecánica.** La grilla de bits, la marcha con rebote contra columnas vivas, la
aceleración por bajas, el escalón, las bombas sembradas, los escudos erosionables, las
oleadas infinitas con descenso y tope, el puntaje con bono de precisión. Nada de eso
depende de cuánta gente juegue.

## Lo que se sacó

| Se sacó | Por qué |
|---|---|
| `useGameNet`, la sala, el rol de host, el roster | no hay red |
| El `ControlSpec` del mando (franja táctil, botón de disparo, puntaje propio, hápticos dirigidos por asiento) | no hay celulares — su función la cumple ahora la pantalla del propio juego |
| Los **bots** de los asientos vacíos | existían para poder probar la sala en solitario; ahora **es** de a uno |
| Los **4 asientos**: arrays por asiento de posición, cooldown, kills, shots, hits, colores, nombres y notificaciones | se colapsan a escalares |
| **El escalado de la horda por cantidad de jugadores** (3×8 → 5×11 y 1,0× → 1,3×) | con un solo cañón siempre es la forma base. `baseRows`/`baseCols` siguen siendo administrables |
| El HUD de latencia, el aviso de salas distintas, el temporizador de abandono | no hay red |
| "VIDAS DE TODOS" | ahora son las tuyas |

## Lo que se agregó

- **El control táctil en la propia pantalla**: la franja inferior mueve, el toque superior
  dispara. Es el mando del original, dibujado donde antes estaba el teléfono.
- **`cannonFollow` sube de 0,45 a 0,6**, porque el suavizado existía para absorber jitter de
  red.

## Una nota sobre `MAX_BULLETS`

En el original era 4 —uno por asiento— con la regla "un proyectil propio en vuelo a la vez"
implementada como una búsqueda por asiento. Acá es **1**, y la regla se vuelve trivial: si
hay un proyectil vivo, no se puede disparar. **Conservala igual**: es lo que hace que cada
disparo cuente, y sin ella el bono de precisión no significa nada.

---

# APÉNDICE E · Mapa del proyecto de origen

| Archivo | Qué es | ¿Portable tal cual? |
|---|---|---|
| `src/games/invasores/logic.ts` | Horda, escudos, colisiones, oleadas, puntaje (~1060 líneas) | **Casi.** Colapsar los arrays por asiento a escalares; el resto queda. |
| `src/games/invasores/logic.test.ts` | Los tests (~490 líneas) | **Sí**, ajustando los de asientos y los de forma de horda por jugadores. |
| `src/games/invasores/settings.ts` | El schema de administrables | Sí, sacando el grupo "Bots" y subiendo `cannonFollow`. |
| `src/games/invasores/InvasoresGame.tsx` | Escena, red, mando, efectos, dibujo (~1545 líneas) | **No tal cual**: el dibujo se copia entero, la red y el mando se tiran. |
| `src/core/engine/loop.ts` | Loop de paso fijo con render interpolado | **Sí**, tal cual. |
| `src/core/engine/canvas.ts` | Escalado, DPR, letterbox, `toWorld` | **Sí**, tal cual. |
| `src/core/engine/input.ts` | Puntero, multitouch, teclado, `axis` | **Sí**, tal cual. |
| `src/core/engine/collide.ts` | `clamp` y `boxHitsBox` | **Sí**, tal cual. Es toda la colisión que este juego necesita. |
| `src/core/engine/rng.ts` | PRNG sembrado | **Sí**, tal cual. |
| `src/core/engine/palette.ts` | Tokens CSS cacheados, `withAlpha` | Sí, cambiando la lista de tokens. |
| `src/core/engine/audio.ts` | WebAudio, seis voces sintetizadas, `vibrate` | **Sí**, tal cual. |
| `src/core/engine/useGameLifecycle.ts` | Fases, cuenta regresiva, force-end, HUD, mute | Sí, si el destino usa React. |
| `src/core/engine/useGame2D.ts` | Une lo anterior: `init` / `update` / `draw` / `outcome` | Sí, si el destino usa React. |
| `src/ui/game/GameStage.tsx` | Canvas + HUD + los estados de partida | Reescribir con el design system del destino. |
| `src/core/net/*`, `src/core/contract/control.ts` | Red y contrato del mando | **No se usan** en esta versión. |
| `games-guide/R4-INVASORES.md` | La guía original (cooperativa) | Referencia, leyendo el apéndice D antes. |

**Última advertencia.** El detalle que más fácil se rompe al portar es el **consumo del PRNG
al elegir qué invasor dispara**. Si la implementación recorre columnas tirando un número por
cada una hasta encontrar una viva, el juego va a funcionar perfecto — y va a dejar de ser
reproducible, porque la cantidad de valores consumidos pasa a depender de qué invasores
siguen vivos. Es un valor por bomba, siempre, y el test de determinismo es lo que lo
defiende.
