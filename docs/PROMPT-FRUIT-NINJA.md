# Prompt maestro · Fruit Ninja (portable)

> **Qué es este archivo.** El prompt autocontenido para reimplementar el juego Ninja
> (Fruit Ninja) de este repo en **otro proyecto**, sin tener acceso a este código.
> Todo lo que hace falta —reglas, números, fórmulas, algoritmos, presupuesto,
> tests y criterios de aceptación— está escrito acá.
>
> **Cómo usarlo.** Copiá el archivo entero, desde `# ROL` hasta el final, y pegalo
> como prompt en Claude Code, Codex, Cursor o Copilot. No necesita nada más.
>
> **Origen.** `src/games/ninja/` de `juegos-supernova` (guía `games-guide/M5-NINJA.md`).
> El apéndice C mapea archivo por archivo por si el proyecto destino prefiere copiar
> la base en vez de reescribirla.

---

# ROL

Actuá como **Game-arquitect**: agente arquitecto de videojuegos web.
Priorizá simplicidad, vertical slicing, game feel y performance.
Usá el stack más chico que resuelva el juego. Primero loop jugable, después polish.
Leé los archivos antes de modificarlos y explicá las decisiones no obvias.

---

# OBJETIVO

Implementar **Ninja**: un Fruit Ninja para navegador, vertical, de partida corta
(2–3 minutos), jugable con el dedo en un teléfono y con el mouse en escritorio.

Es un juego `solo`: un jugador, sin red, sin backend, sin cuentas. Termina emitiendo
un resultado (`outcome`) que el contenedor guarda o muestra; el juego no sabe qué se
hace con él.

---

# CORE LOOP

El jugador **desliza el dedo sobre la pantalla**, el trazo **corta las frutas que
atraviesa**, cada fruta cortada suma puntos, y vuelve a deslizar sobre la tanda
siguiente.

- **Suma** cortando; cortar **3 o más frutas de un solo trazo** paga combo, y ese
  combo es lo que hace que valga la pena **esperar** a que se junten en vez de cortar
  apenas aparecen. Sin el combo, el juego es reflejo puro y no tiene decisión.
- **Pierde** cuando se le caen 3 frutas sin cortar, cuando **corta una bomba**
  (termina en el acto), o cuando se acaba el tiempo si el contenedor fijó duración.

---

# PLATAFORMA Y STACK

- **Plataforma:** web, mobile-first, orientación vertical.
- **Render:** **Canvas 2D** (`ctx.fill`, `ctx.arc`, `ctx.fillRect`). Nada más.
- **Lenguaje:** TypeScript en modo `strict`, con `noUncheckedIndexedAccess`.
- **UI/HUD:** React 19 (o el framework del proyecto destino). El HUD va en **DOM**
  encima del canvas, **nunca** dibujado adentro.
- **Tests:** Vitest (o el runner del destino), sin navegador.

**No usar:**

- **No** Pixi, Phaser, Three, ni ningún engine. La guía original pedía Pixi y fue un
  desvío deliberado: el umbral real de Pixi son ~200 sprites móviles con
  transformaciones propias, y acá son formas geométricas simples que salen de pools.
  Meter un engine obliga a construir una segunda base de render para un juego que no
  la necesita. **El criterio para revisarlo es el contador de FPS, no la intuición.**
- **No** motor de física. La parábola es `v += g·dt; p += v·dt` y con eso alcanza.
- **No** `requestAnimationFrame` con delta variable alimentando la simulación.
- **No** librerías de partículas, de tween ni de audio (howler son 30 KB para
  reproducir seis tonos).
- **No** assets de imagen ni de sonido: todo se dibuja y se sintetiza.

---

# ARQUITECTURA OBLIGATORIA

## 1. La simulación va separada de React y del canvas

```
ninja/
  logic.ts        # simulación pura: sin React, sin canvas, sin DOM. Testeable en Node.
  logic.test.ts   # los tests de logic.ts
  settings.ts     # el schema de administrables (defaults, min, max, unidades)
  NinjaGame.tsx   # montaje, input, dibujo, HUD. Nada de reglas.
```

**Regla dura:** si una función decide *qué pasa en el juego*, va en `logic.ts`. Si
decide *cómo se ve*, va en el componente. `logic.ts` no importa nada del navegador.

## 2. El runtime mínimo que el juego necesita

Si el proyecto destino ya tiene estas piezas, **usalas**. Si no, implementalas con
exactamente este contrato antes de escribir el juego. Son ~250 líneas en total y
resuelven de una vez lo que si no cada juego resuelve a su manera, y alguno mal.

| Pieza | Contrato | Por qué no se puede saltear |
|---|---|---|
| **Loop de paso fijo** | `createLoop(update: (dt) => void, render: (alpha) => void, { step })`. `update` recibe **siempre** `dt = 1/60`. Acumulador + `while (acc >= step)`. Tope de `0.25 s` de tiempo procesado por frame. `render` recibe `alpha = acc/step` para interpolar. | Con delta variable, la parábola de la fruta cambia entre un teléfono lento y un proyector, y la partida deja de ser reproducible. El tope evita la espiral de la muerte al volver de una pestaña oculta. |
| **Canvas escalado** | `setupCanvas(canvas, { designWidth, designHeight, maxDpr })` → `{ ctx, toWorld(clientX, clientY), dispose() }`. Letterbox conservando aspecto, `ctx.setTransform(dpr*scale, 0, 0, dpr*scale, 0, 0)` una vez por layout, `ResizeObserver` con debounce por rAF. | El juego dibuja siempre en 480×800 y no se entera del tamaño real. `toWorld` mide el `getBoundingClientRect()` **en el momento** del evento: el canvas se mueve por scroll o por cualquier reflow que el ResizeObserver no ve. |
| **DPR topeado** | `min(devicePixelRatio, 1.5)` en puntero grueso (`matchMedia("(pointer: coarse)")`), `2` en escritorio. | Renderizar a 3× es la forma más rápida de perder frames en un celular. |
| **Input** | `createInput(container, { toWorld, swipeThreshold })` → `state.pointer { x, y, down, justPressed, justReleased }` y `state.swipe { dx, dy, dir, speed } \| null`. `endFrame()` limpia los flags de un frame. Ignora los eventos cuyo `target.closest("[data-game-ui]")` exista. | El juego lee intenciones, no eventos del navegador. Y sin la guarda del HUD, la captura de puntero se come el `click` del botón "Jugar": la interfaz queda muerta. |
| **PRNG sembrado** | `createRng(seed: string)` → `{ next(): [0,1), range(min,max), int(min,max) inclusive, pick, shuffle, chance }`. FNV-1a para derivar el estado + mulberry32 para la secuencia. | `Math.random()` no acepta semilla: sin semilla no hay bug reproducible ("con semilla abc7 la bomba sale en la primera tanda"). |
| **Object pool** | `createPool<T extends { alive: boolean }>(capacity, factory)` → `{ spawn(init), each(fn), release(item), releaseAll(), active, capacity }`. Todo preasignado en la construcción. | Cero asignaciones dentro del loop. Un `{}` por partícula y por frame es el GC corriendo a mitad de partida. |
| **Paleta** | `readPalette()` lee los tokens CSS **una sola vez** y cachea (`getComputedStyle` fuerza layout). `withAlpha(hex, a)` arma un `rgba()` — **precalcular fuera del loop**. | Armar un `rgba()` por partícula y por frame es basura de GC pura. |
| **Audio** | WebAudio a mano: un oscilador + un gain por sonido, ataque de 8 ms y caída exponencial (sin eso se escucha un click). Seis voces: `pick`, `hit`, `lose`, `win`, `tick`, `select`. **Arranca en silencio.** | Un juego que suena solo al abrirlo en una oficina es un juego que se cierra. |
| **Ciclo de vida** | Fases `intro → countdown → playing → paused → over`, cuenta regresiva de 3, pausa con Escape/P, pausa automática al ocultar la pestaña, `AbortSignal` para force-end, y un `setHud` que **sólo dispara render si algo cambió**. | Es la mitad que siempre se rompe y nadie prueba: un juego que emite dos resultados, o ninguno. |

## 3. Contrato del componente

```ts
type GameOutcome = {
  completed: boolean;          // false si se cortó por tiempo o por force-end
  points: number;
  durationMs: number;          // ms jugados, sin contar cuenta regresiva ni pausa
  meta?: Record<string, unknown>;
};

type GameProps = {
  config: {
    seed: string;                  // misma semilla ⇒ misma partida
    durationMs: number | null;     // null = sin límite de tiempo
    settings: Record<string, ...>; // administrables ya mezclados con los defaults
    debug: boolean;                // habilita el contador de fps
  };
  signal: AbortSignal;         // al abortar, emitir el resultado parcial EN EL ACTO
  onFinish: (outcome: GameOutcome) => void;  // exactamente una vez
  onReady?: () => void;
};
```

Tres reglas: el juego recibe `GameProps` y no importa nada del shell; termina llamando
`onFinish` **exactamente una vez**; si `signal` aborta, emite lo que lleva hecho
inmediatamente.

---

# ESPECIFICACIÓN FUNCIONAL

## Mundo

| | |
|---|---|
| Dimensiones | **480 × 800**, vertical (se juega con el teléfono como está) |
| Paso de simulación | **1/60 s**, fijo |
| Cuenta regresiva | 3 s |
| Frutas vivas máx. | **16** (5 por tanda × hasta 3 tandas en el aire) |
| Cortes máx. por trazo | **8** (buffer del resultado del corte) |
| Formas de fruta | **4**: círculo, hexágono, gota, rombo |
| Colores de fruta | **5** |

## Frutas y tandas

- Cada `waveMinDelay`–`waveMaxDelay` segundos sale una tanda de `waveMinCount`–`waveMaxCount`
  frutas. **El intervalo irregular es lo que evita que el juego se vuelva un metrónomo.**
- La primera tanda sale a los **0,4 s**: nadie quiere mirar una pantalla vacía.
- Cada fruta se lanza desde abajo: `y = worldHeight + radius`, `vy = -speed`.
- `x` sale en `[70, worldWidth - 70]`.
- `vx = drift + (worldWidth/2 - x) · 0.35`, con `drift ∈ [-70, 70]`. **Ese empujón hacia
  el centro no es cosmético: sin él, la mitad de la tanda sale de pantalla.**
- Física: `vy += gravity·dt`, `x += vx·dt`, `y += vy·dt`, `rot += spin·dt`, con
  `spin ∈ [-3.4, 3.4]` rad/s. Parábola simple, sin motor.
- Se descarta la fruta cuando `y - radius > worldHeight + 90`:
  - si **no** es bomba → `missed++`, `lives--`, `streak = 0`, suena `hit` + vibración;
  - si **es** bomba → se descarta y **no cuesta nada**. Dejar pasar una bomba es la jugada.
- **Antes de integrar**, cada fruta guarda `px`, `py`, `prot` (posición y rotación del
  paso anterior) para que el dibujo interpole con el `alpha` del loop.

## El corte — el detalle que define el juego

Es el error clásico del género y hay que resolverlo bien desde la primera línea.

**Mal:** preguntar en cada frame si el dedo está encima de una fruta. Con un
deslizamiento rápido, el dedo salta 200 px entre frames y pasa por arriba de tres
frutas sin tocar ninguna. Falla justo cuando el jugador es rápido, que es cuando el
juego se pone bueno.

**Bien:** el movimiento del dedo entre dos frames es un **segmento**, y se prueba
intersección **segmento–círculo** contra cada fruta viva.

```ts
/** Distancia mínima del centro de la fruta al segmento del trazo. */
export function segmentHitsCircle(
  x1: number, y1: number, x2: number, y2: number,
  cx: number, cy: number, radius: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  // Proyección del centro sobre el segmento, acotada a [0,1]: fuera de ese
  // rango el punto más cercano es un extremo, no la recta infinita.
  let t = 0;
  if (lengthSq > 1e-9) {
    t = ((cx - x1) * dx + (cy - y1) * dy) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }

  const nx = cx - (x1 + dx * t);
  const ny = cy - (y1 + dy * t);
  return nx * nx + ny * ny <= radius * radius;
}
```

Dos condiciones más, que son las que hacen que se sienta justo:

1. **Velocidad mínima del trazo: 300 px/s.** Apoyar el dedo y moverlo despacio no
   corta. Sin esto, la estrategia óptima es dejar el dedo quieto en el medio de la
   pantalla y el juego se termina solo. La velocidad es `hypot(dx, dy) / dt`, con el
   `dt` **fijo** del paso.
2. **El ángulo del trazo** (`atan2(y2-y1, x2-x1)`) viaja en el resultado del corte y
   define cómo se separan las mitades. Un corte diagonal separa en diagonal. Es puro
   detalle y es lo que hace que se vea bien.

### Orden exacto de `sliceFruits`

```
1. out.count = 0; out.gained = 0; out.bomb = false
2. si world.over o speed < minSliceSpeed → devolver out vacío
3. out.angle = atan2(y2-y1, x2-x1)
4. para cada fruta viva:
     si no segmentHitsCircle(...) → seguir
     fruit.alive = false
     si out.count < MAX_SLICES → registrar x, y, radius, shape y color
                                  (color = -1 cuando es bomba)
     world.strokeX / strokeY = posición de la fruta  // dónde sale el número del combo
     si es bomba:
         out.bomb = true; world.over = true; world.overReason = "bomba"
         world.streak = 0
         RETURN INMEDIATO  ← lo que estaba detrás de la bomba no se cobra
     cut++; strokeCut++; streak++; bestStreak = max(bestStreak, streak)
     out.gained += pointsPerFruit
     out.gained += streakAward(streak)
5. world.points += out.gained
```

El `return` inmediato al tocar la bomba no es un detalle de implementación: es la regla
de que la bomba **corta el trazo**.

### Combo por trazo

El combo se cuenta **por trazo**, no por partida, y se paga **al soltar el dedo**:

```ts
beginStroke(world)   // en pointer.justPressed → strokeCut = 0
endStroke(world)     // en pointer.justReleased → paga y devuelve los puntos

export function comboPoints(strokeCut: number, tuning: NinjaTuning): number {
  return strokeCut >= tuning.comboMin ? strokeCut * tuning.comboPerFruit : 0;
}
```

`endStroke` además actualiza `bestCombo` y resetea `strokeCut`. **Ojo:** hay que leer
`world.strokeCut` **antes** de llamar a `endStroke`, porque lo reinicia — el número del
combo que flota en pantalla sale de ahí.

### Racha

```ts
/** Se paga cada vez que la cuenta cruza un múltiplo. */
export function streakAward(streak: number, tuning: NinjaTuning): number {
  if (tuning.streakLength <= 0 || streak <= 0) return 0;
  return streak % tuning.streakLength === 0 ? tuning.streakBonus : 0;
}
```

La racha se corta con cualquier fruta que caiga sin cortar y con cualquier bomba cortada.

### Bombas

```ts
/** Aparecen desde cierto puntaje, con probabilidad creciente hasta su techo. */
export function bombChance(points: number, tuning: NinjaTuning): number {
  if (points < tuning.bombFromPoints) return 0;
  if (tuning.bombRamp <= 0) return tuning.bombMaxChance;
  const ramp = Math.min(1, (points - tuning.bombFromPoints) / tuning.bombRamp);
  return tuning.bombMaxChance * ramp;
}
```

La probabilidad se evalúa **una vez por tanda** y se aplica a cada fruta de esa tanda.
Antes de `bombFromPoints`, la partida es sólo aprender a cortar.

### Fin de partida

| Causa | `overReason` | Qué pasa |
|---|---|---|
| Se acabaron las vidas | `"vidas"` | `over = true` en el mismo paso |
| Se cortó una bomba | `"bomba"` | `over = true` en el acto, dentro del corte |
| Se acabó el tiempo | `""` → `"tiempo"` | lo decide el contenedor por `durationMs` |
| Force-end (`AbortSignal`) | `""` → `"forzado"` | emite el resultado parcial ya |

Con `over = true`, **`stepNinja` no simula nada más y `sliceFruits` no corta nada más**.
Todo se detiene: es lo que hace que se lea el error.

Después de `over`, el componente espera **800 ms** (200 ms con `prefers-reduced-motion`)
antes de llamar a `finish(true)` y mostrar el resumen. Se ve el final antes del cartel.

## Orden exacto de `stepNinja(world, dt, rng)`

```
1. events.missed = 0; events.spawned = 0     ← se reescriben en cada paso
2. si world.over → return
3. spawnTimer -= dt
   si spawnTimer <= 0:
       spawnWave(world, rng)
       spawnTimer = rng.range(waveMinDelay, waveMaxDelay)
4. para cada fruta viva:
       guardar px, py, prot
       vy += gravity·dt; x += vx·dt; y += vy·dt; rot += spin·dt
       si y - radius <= worldHeight + 90 → seguir
       fruit.alive = false
       si es bomba → seguir (no cuesta nada)
       missed++; lives--; streak = 0; events.missed++
5. si lives <= 0 → over = true, overReason = "vidas"
```

## Determinismo del spawn

`spawnWave` consume una cantidad **fija** de números del PRNG por fruta y **en este
orden**. Cambiar el orden rompe la reproducibilidad con la misma semilla:

```
count  = rng.int(waveMinCount, waveMaxCount)
chance = bombChance(points)
por cada fruta:
  1. radius = rng.range(fruitRadiusMin, fruitRadiusMax)
  2. x      = rng.range(70, worldWidth - 70)
  3. speed  = rng.range(launchSpeedMin, launchSpeedMax)
  4. drift  = rng.range(-70, 70)
  5. shape  = rng.int(0, 3)
  6. color  = rng.int(0, 4)
  7. spin   = rng.range(-3.4, 3.4)
  8. bomb   = rng.next() < chance
```

Los ocho números se consumen **antes** de buscar un hueco libre en el arreglo de frutas:
si no hay lugar, la fruta se descarta pero el PRNG ya avanzó igual. Así el consumo por
tanda no depende de cuántas frutas haya vivas.

---

# ADMINISTRABLES

El juego publica un **schema declarativo**; el panel de administración lo recorre y
dibuja el control que corresponda, sin saber nada del juego. El schema es también la
fuente de los defaults y lo que se usa para sanear lo guardado: un valor fuera de rango
se descarta, no rompe la partida.

| Grupo | Clave | Label | Default | Rango | Paso | Unidad |
|---|---|---|---|---|---|---|
| Corte | `minSliceSpeed` | Velocidad mínima del corte | **300** | 0–900 | 25 | px/s |
| Corte | `lives` | Vidas | **3** | 1–9 | 1 | — |
| Frutas | `gravity` | Gravedad | **900** | 500–1800 | 25 | px/s² |
| Frutas | `launchSpeedMin` | Impulso mínimo | **760** | 400–1200 | 20 | px/s |
| Frutas | `launchSpeedMax` | Impulso máximo | **980** | 500–1500 | 20 | px/s |
| Frutas | `fruitRadiusMin` | Radio mínimo | **26** | 14–50 | 1 | px |
| Frutas | `fruitRadiusMax` | Radio máximo | **38** | 18–70 | 1 | px |
| Tandas | `waveMinDelay` | Espera mínima entre tandas | **1.2** | 0.3–4 | 0.1 | s |
| Tandas | `waveMaxDelay` | Espera máxima entre tandas | **2.5** | 0.5–6 | 0.1 | s |
| Tandas | `waveMinCount` | Frutas mínimas por tanda | **1** | 1–6 | 1 | — |
| Tandas | `waveMaxCount` | Frutas máximas por tanda | **5** | 1–8 | 1 | — |
| Bombas | `bombFromPoints` | Bombas desde | **300** | 0–3000 | 50 | puntos |
| Bombas | `bombMaxChance` | Probabilidad máxima de bomba | **17** | 0–40 | 1 | % |
| Bombas | `bombRamp` | Puntos hasta el techo | **900** | 100–5000 | 100 | puntos |
| Puntaje | `pointsPerFruit` | Puntos por fruta | **50** | 10–200 | 10 | — |
| Puntaje | `comboMin` | Frutas para que haya combo | **3** | 2–6 | 1 | — |
| Puntaje | `comboPerFruit` | Combo por fruta del trazo | **30** | 0–120 | 5 | — |
| Puntaje | `streakLength` | Largo de la racha | **10** | 3–30 | 1 | — |
| Puntaje | `streakBonus` | Bono de racha | **200** | 0–600 | 25 | — |

Textos de ayuda que vale la pena mantener, porque explican **por qué** existe el número:

- `minSliceSpeed`: "Debajo de esto el trazo no corta. En 0, apoyar el dedo quieto se
  vuelve la mejor jugada."
- `lives`: "Se pierde una por cada fruta que cae sin cortar. Las bombas que caen solas
  no cuestan."
- `waveMaxDelay`: "El intervalo irregular es lo que evita que el juego se vuelva un
  metrónomo."
- `waveMaxCount`: "Arriba de 6 no entran en pantalla y la partida se vuelve injusta."
- `bombMaxChance`: "Techo por fruta. 17 % es aproximadamente una de cada seis."
- `comboPerFruit`: "Es lo que hace que valga esperar a que se junten tres en vez de
  cortar de a una."
- `launchSpeedMax`: "Contra 900 de gravedad, 980 px/s deja la fruta poco más de dos
  segundos en el aire."

**Los administrables entran una sola vez** (un `useMemo` sobre `config.settings`) y
salen tipados en un `NinjaTuning`, saneando los pares min/max:
`waveMaxDelay = max(waveMinDelay, …)`, `waveMaxCount = max(waveMinCount, …)`,
`fruitRadiusMax = max(fruitRadiusMin, …)`, `launchSpeedMax = max(launchSpeedMin, …)`.
`bombMaxChance` entra en % y sale en 0..1. `lives`, `waveMinCount`, `waveMaxCount`,
`comboMin` y `streakLength` se redondean.

---

# PRESENTACIÓN Y GAME FEEL

Es el juego donde el apartado visual justifica el esfuerzo. Todo esto es forma
geométrica dibujada con Canvas 2D: **cero assets**.

## Presupuesto de objetos (todo preasignado al iniciar)

| Pool | Capacidad | Vida | Notas |
|---|---|---|---|
| Frutas | 16 | — | arreglo fijo en `logic.ts`, no pool |
| Gotas de jugo | **240** | 0,55 s | 14 por fruta (7 con reduced-motion) |
| Mitades | **32** | 1,6 s | 2 por fruta cortada |
| Salpicaduras | **48** | 4 s | 1 por fruta cortada |
| Números de combo | **8** | 0,9 s | 1 por trazo que paga combo |

**344 objetos vivos como máximo.** Ninguno se crea durante la partida.

## Colores — todos de tokens CSS, ninguno hardcodeado

Se leen **una vez** al iniciar con `readPalette()` y los `rgba()` se componen ahí mismo.

| Uso | Token |
|---|---|
| Fondo | `--sn-bg` |
| Frutas (5) | `--sn-cyan-400`, `--sn-magenta-400`, `--sn-violet-400`, `--sn-success`, `--sn-warn` |
| Brillo interior (5) | `--sn-cyan-300`, `--sn-magenta-300`, `--sn-violet-300`, `--sn-success`, `--sn-warn` |
| Salpicaduras | el color de la fruta con `alpha 0.18`, precalculado |
| Bomba (cuerpo) | `--sn-bg-elev` — **lo más oscuro de la pantalla** |
| Bomba (anillo) | `--sn-danger` |
| Bomba (mecha) | `--sn-warn` |
| Estela (halo) | `--sn-cyan-300` con `alpha 0.55` |
| Estela (núcleo) | `--sn-text` |
| Flash | `--sn-text` |
| Número del combo | `--sn-magenta-300` |

Valores de referencia de la paleta de origen (fondo `#07060f`):
`cyan-300 #7df0fb`, `cyan-400 #22e3f5`, `magenta-300 #ff7ac6`, `magenta-400 #ff3dae`,
`violet-300 #a78bfa`, `violet-400 #8b5cf6`, `success #2be38a`, `warn #ffb020`,
`danger #ff4d6d`, `text #f2efff`, `bg-elev #100d1e`.

## Frutas

Cuatro siluetas dibujadas en el origen; la misma función sirve para la entera y para
las mitades:

```ts
function fruitPath(g: CanvasRenderingContext2D, shape: number, r: number): void {
  g.beginPath();
  if (shape === 1) {            // hexágono
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  } else if (shape === 2) {     // gota
    g.moveTo(0, -r * 1.25);
    g.quadraticCurveTo(r, -r * 0.2, 0, r);
    g.quadraticCurveTo(-r, -r * 0.2, 0, -r * 1.25);
  } else if (shape === 3) {     // rombo
    g.moveTo(0, -r); g.lineTo(r * 0.82, 0); g.lineTo(0, r); g.lineTo(-r * 0.82, 0);
    g.closePath();
  } else {                      // círculo
    g.arc(0, 0, r, 0, Math.PI * 2);
  }
}
```

Cada fruta entera se dibuja con `translate(x, y)` + `rotate(rot)`, relleno del color, y
encima la misma silueta a `r · 0.52` con el color de brillo y `alpha 0.55`.
`x`, `y` y `rot` se **interpolan** con el `alpha` del loop entre el paso anterior y el
actual (`lerp(px, x, alpha)`), y se saltea el dibujo si `y < -80` o `y > 880`.

## Bomba

Tiene que ser **inconfundible a un vistazo, también en escala de grises**, porque
cortarla termina la partida y confundirla se siente injusto. **No se parece a ninguna
fruta**: no usa `fruitPath`.

- Esfera del color más oscuro de la pantalla (`--sn-bg-elev`).
- Anillo rojo pulsante: `lineWidth = 3 + beat·2`, con
  `beat = sin(elapsedMs / 110) · 0.5 + 0.5` (fijo en `0.5` con reduced-motion).
- Mecha: línea de `(0, -r)` a `(r·0.45, -r·1.5)` y una chispa (círculo de `3 + beat·2`)
  en la punta, en `--sn-warn`.

## Al cortar

- **Dos mitades** por fruta. Con `normal = angle + π/2` y `signo = ±1`:
  `vx = cos(normal)·130·signo + cos(angle)·40`, `vy = sin(normal)·130·signo − 120`,
  `spin = ±3.2`, gravedad 900 propia, vida 1,6 s, `alpha = min(1, life/0.5)`.
  Se dibujan con `rotate(cut + rot)` y un semicírculo (`arc` de `0` a `π`, o de `π` a
  `2π` según el lado). La **cara del corte va más clara**: un `fillRect` de 3 px de alto
  con el color de brillo. Es lo que hace que se lea partida y no dos gajos sueltos.
- **Chorro de jugo:** 14 gotas por fruta (7 con reduced-motion), del color de la fruta.
  Salen de `centro ± jitter·radio·0.5`, con `vx = jx·300 + pushX·90`,
  `vy = jy·300 + pushY·90 − 60`, tamaño `3 + |jy|·3`, gravedad 900, vida 0,55 s,
  `alpha = life/max`. Se dibujan con `fillRect`: no vale un `arc` para 3 px.
  El "azar" sale de una **tabla de 96 valores en [-1,1]** generada al iniciar con el RNG
  sembrado, recorrida con dos índices desfasados (`i` e `i+31`). Nada de `Math.random()`
  en el loop.
- **Salpicadura de fondo:** círculo de `radio·0.9` con el color de la fruta al 18 %, que
  dura 4 s y se desvanece con `min(1, life/1.4)`. Se acumulan: dan la sensación de que
  la partida deja marca. **No se dibujan con reduced-motion.**
- **La bomba no reparte jugo, ni mitades, ni salpicadura** (su color llega como `-1`).

## Estela del corte

Es el elemento más vistoso del juego y cuesta casi nada.

- **Buffers circulares** de 14 posiciones (`Float32Array` de x, y y vida), no objetos.
- Se agrega un punto sólo si el dedo se movió más de **1,5 px** en el frame.
- Cada punto se apaga en **0,22 s** (`life -= dt / 0.22`). **Sin esto queda una cinta
  colgada en la pantalla cuando el jugador levanta el dedo.**
- Se dibuja como segmentos entre puntos consecutivos, del más nuevo al más viejo, con
  `taper = 1 - k/points`: `alpha = min(lifeA, lifeB) · taper`, halo de
  `lineWidth = 2 + taper·12` en cyan translúcido y núcleo de `1 + taper·3` en blanco.
  `lineCap` y `lineJoin` en `"round"`.
- Con reduced-motion: **6 puntos** en vez de 14.

## Número del combo

Aparece **en el punto del último corte del trazo** (`world.strokeX/strokeY`), grande, en
magenta, y sube 70 px/s desvaneciéndose en 0,9 s (`alpha = min(1, life/0.4)`).
Las etiquetas (`+90`, `+120`, …) se **precalculan al iniciar** para los 9 valores
posibles (`0..MAX_SLICES`): armar un string por frame es asignar.
Fuente `700 30px "Space Grotesk", sans-serif`, `textAlign: "center"`,
`textBaseline: "middle"`.

## Cortar una bomba

Flash blanco + sacudida fuerte + todo se detiene.

- **Sacudida:** 320 ms. `translate(sin(shakeMs·0.8)·12·decay, cos(shakeMs·1.3)·12·decay)`
  con `decay = shakeMs / 320`.
- **Flash:** 260 ms, rectángulo blanco a pantalla completa con
  `alpha = (flashMs / 260) · 0.8`. Va **fuera** del `save/restore` de la sacudida.
- Sonido `lose` + vibración `[60, 40, 120]`.

## Orden de dibujo

```
1. fondo (fillRect del mundo entero)
2. save() + translate de la sacudida
3. salpicaduras          (van al fondo)
4. frutas enteras        (interpoladas con alpha)
5. mitades
6. gotas de jugo
7. estela del corte
8. números de combo
9. restore()
10. flash                (a pantalla completa, sin sacudida)
```

## Sonido y vibración

| Evento | Sonido | Vibración |
|---|---|---|
| Cortar fruta | `pick` | `10` |
| Cortar bomba | `lose` | `[60, 40, 120]` |
| Cerrar un trazo con combo | `win` | `[12, 30, 12]` |
| Fruta que cae sin cortar | `hit` | `24` |
| Soltar con un swipe rápido | `select` | — (es el silbido del sable) |

El swipe de la base llega **recién al soltar**: sirve para el silbido, **no para
cortar**. El corte se resuelve frame a frame por segmento.

## `prefers-reduced-motion`

Se respeta en todo el juego, y **las frutas y el corte funcionan exactamente igual**:

- Sin sacudida y sin flash.
- Estela de 6 puntos en vez de 14.
- La mitad de las gotas de jugo.
- Sin salpicaduras de fondo.
- El pulso de la bomba queda fijo (`beat = 0.5`).
- La espera antes del resumen baja de 800 ms a 200 ms.

---

# HUD Y ESTADOS

El HUD va en **DOM** encima del canvas, con `aria-live="polite"`, `pointer-events: none`
salvo en los botones, y `data-game-ui` para que el input del juego lo ignore. Se lee
mejor, lo anuncia un lector de pantalla, se estila con CSS y no consume frames.

- **Puntos** — el dominante, cyan, número tabular (`font-variant-numeric: tabular-nums`,
  o el score tiembla al cambiar de dígito).
- **Vidas** — pasa a rojo cuando queda 1 o menos.
- **Racha** — magenta.
- **Tiempo** — sólo si `durationMs !== null`; rojo bajo 6 s. Formato `m:ss`.
- **fps** — sólo con `config.debug`. Naranja si baja de 50.

El HUD se actualiza **por evento, no por frame**: se empuja un patch cuando hay un
corte, cuando cae una fruta y cuando se paga un combo, y el setter descarta el patch si
no cambió nada. El loop corre a 60 fps; React no.

Los estados que el juego no puede no tener:

- **intro** — una línea de instrucciones y un botón "Jugar". Texto exacto:
  *"Deslizá para cortar. Tres o más de un solo trazo dan combo. Las bombas terminan la
  partida."*
- **countdown** — 3, 2, 1, "Ya".
- **playing** — botón de pausa; Escape y P también pausan.
- **paused** — "Seguir" y "Reiniciar".
- **over** — el resumen, y "Jugar de nuevo" como acción principal, ancho completo, donde
  ya está el pulgar.

Resumen: *"Cortaste N frutas"* + tres tarjetas (Puntos, Cortadas, Racha).

---

# CONTRATO DE SALIDA

```ts
onFinish({
  completed,                    // false si fue por tiempo o force-end
  points: world.points,
  durationMs,                   // ms jugados, sin cuenta regresiva ni pausa
  meta: {
    cortadas: world.cut,
    caidas: world.missed,
    mejorRacha: world.bestStreak,
    mejorCombo: world.bestCombo,
    vidas: Math.max(0, world.lives),
    causa: world.overReason || (completed ? "tiempo" : "forzado"),
  },
});
```

---

# PERFORMANCE

| | |
|---|---|
| Objetivo | **60 fps en celular de gama media** |
| Objetos activos | máx. 344, todos preasignados |
| Asignaciones por frame | **cero** |
| DPR efectivo | `min(devicePixelRatio, 1.5)` en celular |
| Si no llega | primero las gotas a la mitad, después las salpicaduras del fondo |

Cómo se consigue el "cero asignaciones", que es la parte que hay que hacer bien:

- **Pools preasignados** para jugo, mitades, salpicaduras y números; arreglo fijo de 16
  frutas que nunca crece.
- **Buffers tipados** (`Float32Array`, `Int32Array`) para el resultado del corte, la
  estela y la tabla de jitter.
- **Un solo objeto puente** (`frame`) que lleva los parámetros del spawn a los callbacks
  del pool. Ese objeto y esos callbacks se crean **una vez en `init`**, nunca por frame.
- **Strings precalculados**: los `rgba()` de las salpicaduras y las etiquetas del combo.
- Nada de `Math.random()`, `new`, `{}`, `[]`, `.map`, `.filter` ni template literals
  dentro de `update` ni de `draw`.

---

# QUÉ NO HACER

- **No** detectar el corte por punto. Es por **segmento**.
- **No** cortar sin velocidad mínima.
- **No** delta variable en la simulación.
- **No** hacer la bomba parecida a una fruta.
- **No** crear objetos, strings ni colores dentro del loop.
- **No** meter un engine (Pixi/Phaser) "por si acaso": sin evidencia del contador de
  fps, no hay caso.
- **No** dibujar el HUD adentro del canvas.
- **No** poner reglas del juego en el componente, ni dibujo en `logic.ts`.
- **No** olvidar limpiar el loop, el input, el `ResizeObserver` y el `AudioContext` al
  desmontar.
- **No** dejar que el `pointerdown` sobre un botón del HUD cuente como input de juego.

---

# TESTS OBLIGATORIOS

Van sobre `logic.ts`, sin navegador. Estos son los que hay que escribir sí o sí, porque
son los que fallan cuando alguien "mejora" el corte.

**Determinismo**
1. La misma semilla lanza las mismas frutas en el mismo orden (posición, impulso, forma).
2. La misma semilla da la misma partida completa: correr 900 pasos, muestrear cada 30
   (`waves`, `lives`, `missed` y el estado de las 16 frutas) y comparar dos corridas.
3. Semillas distintas divergen.

**Intersección trazo–fruta**
4. Un trazo que pasa por el centro corta.
5. Un trazo que pasa lejos no corta.
6. **Roza el borde:** con una fruta de radio 30 en `(200, 129)` y el trazo en `y = 100`,
   corta; en `(200, 131)`, no. *La distancia al segmento cuenta, no al centro.*
7. **La proyección se acota al segmento:** un círculo sobre la prolongación del segmento
   pero fuera de él **no** corta; contra el extremo más cercano, sí.
8. Un trazo de longitud cero se resuelve como punto contra círculo.
9. **La prueba del corte:** tres frutas alineadas en `x = 120, 240, 360` y un trazo de
   `(40, 400)` a `(440, 400)` en un solo frame **corta las tres**. *Con detección por
   punto, este test falla.*
10. Apoyar el dedo y moverlo despacio (velocidad `minSliceSpeed - 1`) **no corta**.
11. El ángulo del trazo viaja en el resultado.

**Bombas**
12. Cortar una bomba termina la partida en el acto, con `overReason === "bomba"`.
13. La bomba corta el trazo: la fruta que estaba detrás no se cobra.
14. Terminada la partida no se corta más nada.
15. `bombChance` arranca en 0, es 0 justo en `bombFromPoints`, vale la mitad del techo a
    media rampa y tiende al techo.
16. Una bomba que cae sola no cuesta vidas.

**Vidas y caídas**
17. Una fruta que cae sin cortar cuesta una vida y corta la racha.
18. Sin vidas se termina la partida, con `overReason === "vidas"`.
19. La parábola vuelve: la fruta sube, el `vy` se da vuelta y baja.

**Puntaje**
20. Cada fruta paga `pointsPerFruit`.
21. Menos de `comboMin` en un trazo no da combo; `comboMin` o más, sí.
22. El combo se paga al cerrar el trazo, actualiza `bestCombo` y resetea `strokeCut`.
23. La racha paga al cruzar el múltiplo y no antes.
24. Diez cortes seguidos suman el bono de racha **una sola vez**:
    `points === streakLength · pointsPerFruit + streakBonus`.

Para los tests que no pueden depender del azar, hace falta un helper `placeFruit(world,
x, y, bomb?, radius?)` que ocupe a mano el primer hueco libre del arreglo de frutas.

---

# CRITERIOS DE ACEPTACIÓN

- [ ] `tsc --noEmit` en verde, en modo `strict` con `noUncheckedIndexedAccess`.
- [ ] Los 24 tests de la sección anterior pasan.
- [ ] Se puede jugar de principio a fin sin recargar, y "Jugar de nuevo" funciona.
- [ ] **La prueba del corte:** un deslizamiento muy rápido sobre tres frutas alineadas
      corta las tres, en el juego real y no sólo en el test.
- [ ] Apoyar el dedo y moverlo despacio no corta.
- [ ] Cortar tres o más de un trazo da combo, y el número aparece en el punto del corte.
- [ ] La bomba se distingue de cualquier fruta a un vistazo, **también en escala de
      grises**.
- [ ] Cortar una bomba: flash, sacudida, todo se detiene, y el resumen llega 800 ms
      después.
- [ ] 60 fps con las 344 entidades vivas, medido en el panel de Performance.
- [ ] **Cero recolecciones de basura en 60 segundos** de partida, verificable en el
      perfil de memoria.
- [ ] Con la misma semilla salen las mismas frutas en el mismo orden.
- [ ] El DPR efectivo en celular no supera 1,5.
- [ ] `force-end` (abortar el `AbortSignal`) emite el outcome con lo cortado hasta ahí,
      **una sola vez**.
- [ ] Con `prefers-reduced-motion` no hay sacudida, flash ni salpicaduras, la estela es
      corta, hay la mitad de partículas, y **se juega igual**.
- [ ] Al desmontar no queda ni un `requestAnimationFrame`, ni un listener, ni un
      `ResizeObserver`, ni un `AudioContext` abierto.
- [ ] El sonido arranca apagado y se puede prender desde el HUD.
- [ ] Cero errores y cero warnings en consola.

---

# ORDEN DE IMPLEMENTACIÓN

Cuatro slices, cada uno verificable solo. No pasar al siguiente sin cerrar el anterior.

| # | Slice | Se cierra cuando |
|---|---|---|
| 1 | **Runtime**: loop de paso fijo, canvas con DPR y letterbox, input de puntero, PRNG, pool. | Un cuadrado cae con gravedad a 60 fps y el puntero se lee en coordenadas del mundo. |
| 2 | **Simulación** (`logic.ts` + tests): tandas, parábola, corte por segmento, vidas, bombas, puntaje. | Los 24 tests pasan. Todavía no se ve nada. |
| 3 | **Juego jugable**: componente, dibujo de frutas y bomba, HUD, fases, outcome. | Se juega, se pierde, se reinicia, y el resultado sale bien. |
| 4 | **Game feel**: mitades, jugo, salpicaduras, estela, número del combo, sacudida, flash, sonido, vibración, reduced-motion. | Los criterios de aceptación visuales y de performance. |

---

# ENTREGA

Cambios pequeños y revisables, un slice por vez. Explicá las decisiones no obvias con un
comentario que diga **por qué**, no qué (el qué ya está en el código).
Al terminar, listá qué quedó pendiente y por qué.

---
---

# APÉNDICE A · Tipos de referencia

```ts
export const WORLD_WIDTH = 480;
export const WORLD_HEIGHT = 800;
export const MAX_FRUITS = 16;
export const MAX_SLICES = 8;
export const FRUIT_SHAPES = 4;
export const FRUIT_COLORS = 5;

export type NinjaTuning = {
  worldWidth: number; worldHeight: number; gravity: number;
  waveMinDelay: number; waveMaxDelay: number;
  waveMinCount: number; waveMaxCount: number;
  fruitRadiusMin: number; fruitRadiusMax: number;
  launchSpeedMin: number; launchSpeedMax: number;
  lives: number;
  bombFromPoints: number; bombMaxChance: number; bombRamp: number;  // bombMaxChance en 0..1
  pointsPerFruit: number; comboMin: number; comboPerFruit: number;
  streakLength: number; streakBonus: number;
  minSliceSpeed: number;
};

export type Fruit = {
  alive: boolean;
  x: number; px: number;      // px/py/prot: el paso anterior, para interpolar el dibujo
  y: number; py: number;
  vx: number; vy: number;
  radius: number; shape: number; color: number;
  bomb: boolean;
  rot: number; prot: number; spin: number;
};

/** Se reescriben en cada paso: el componente los lee para sonido y HUD. */
export type NinjaEvents = { missed: number; spawned: number };

export type NinjaWorld = {
  fruits: Fruit[];            // arreglo fijo de MAX_FRUITS, nunca crece
  spawnTimer: number;         // arranca en 0.4
  waves: number;
  lives: number;
  cut: number;
  missed: number;
  points: number;
  streak: number;
  bestStreak: number;
  bestCombo: number;
  strokeCut: number;          // frutas cortadas por el trazo en curso
  strokeX: number;            // dónde aparece el número del combo
  strokeY: number;
  over: boolean;
  overReason: "" | "vidas" | "bomba";
  events: NinjaEvents;
  tuning: NinjaTuning;
};

/** Lo que un trazo cortó en un paso. Buffers fijos: el corte no asigna. */
export type SliceResult = {
  count: number;
  xs: Float32Array;           // los cinco arreglos son de largo MAX_SLICES
  ys: Float32Array;
  radii: Float32Array;
  shapes: Int32Array;
  colors: Int32Array;         // -1 = bomba
  gained: number;
  bomb: boolean;
  angle: number;              // define cómo se separan las mitades
};

/* API pública de logic.ts */
export function tuningFromSettings(values: SettingsValues): NinjaTuning;
export function createNinjaWorld(tuning: NinjaTuning): NinjaWorld;
export function createSliceResult(): SliceResult;
export function spawnWave(world: NinjaWorld, rng: Rng): void;
export function stepNinja(world: NinjaWorld, dt: number, rng: Rng): void;
export function beginStroke(world: NinjaWorld): void;
export function endStroke(world: NinjaWorld): number;
export function sliceFruits(
  world: NinjaWorld,
  x1: number, y1: number, x2: number, y2: number,
  speed: number, out: SliceResult,
): SliceResult;
export function segmentHitsCircle(
  x1: number, y1: number, x2: number, y2: number,
  cx: number, cy: number, radius: number,
): boolean;
export function comboPoints(strokeCut: number, tuning: NinjaTuning): number;
export function streakAward(streak: number, tuning: NinjaTuning): number;
export function bombChance(points: number, tuning: NinjaTuning): number;
```

---

# APÉNDICE B · El `update` del componente, paso a paso

Este es el orden que hay que respetar; cada línea tiene un motivo.

```
si pointer.justPressed:
    beginStroke(world)                  // el combo se cuenta por trazo
    prevX = pointer.x; prevY = pointer.y
    hasPrev = true                      // el primer frame no tiene segmento válido:
                                        // el punto anterior es de otro gesto

si pointer.down y hasPrev:
    dx = pointer.x - prevX; dy = pointer.y - prevY
    distance = hypot(dx, dy)
    speed = distance / dt               // dt fijo

    si distance > 1.5 → empujar un punto a la estela

    slice = sliceFruits(world, prevX, prevY, pointer.x, pointer.y, speed, sliceBuffer)

    si slice.count > 0:
        normal = slice.angle + π/2
        por cada corte (salteando color < 0, que es la bomba):
            2 mitades, 1 salpicadura (salvo reduced-motion), 14 gotas (7 con reduced)
        si slice.bomb → sfx "lose", vibrar [60,40,120], shake 320 ms, flash 260 ms
        si no        → sfx "pick", vibrar 10
        empujar al HUD puntos, vidas, racha y cortadas

    prevX = pointer.x; prevY = pointer.y

si pointer.justReleased:
    strokeCut = world.strokeCut         // LEER ANTES: endStroke lo reinicia
    combo = endStroke(world)
    si hay swipe y swipe.speed >= minSliceSpeed → sfx "select"   (sólo el silbido)
    si combo > 0:
        sfx "win", vibrar [12,30,12]
        número flotante en (world.strokeX, world.strokeY) con min(MAX_SLICES, strokeCut)
        empujar puntos al HUD
    hasPrev = false

apagar la estela: life -= dt / 0.22

stepNinja(world, dt, rng)

si world.events.missed > 0 → sfx "hit", vibrar 24, empujar vidas y racha al HUD

avanzar los cuatro pools (jugo, mitades, salpicaduras, números)
descontar shakeMs y flashMs

si world.over:
    overMs += dt·1000
    si overMs >= (reducedMotion ? 200 : 800) → finish(true)
```

---

# APÉNDICE C · Mapa del proyecto de origen

Si el proyecto destino prefiere copiar en vez de reescribir, estos son los archivos. Los
de `core/` son genéricos: sirven para cualquier juego 2D del catálogo, no sólo para éste.

| Archivo | Qué es | ¿Portable tal cual? |
|---|---|---|
| `src/games/ninja/logic.ts` | La simulación completa (~450 líneas) | **Sí.** Sólo depende de `Rng` y del lector de settings. |
| `src/games/ninja/logic.test.ts` | Los 24 tests | **Sí.** |
| `src/games/ninja/settings.ts` | El schema de administrables | Sí, si el destino tiene un panel equivalente; si no, hardcodear los defaults. |
| `src/games/ninja/NinjaGame.tsx` | Montaje, input, dibujo, HUD (~840 líneas) | Depende del runtime y del `GameStage` del destino. |
| `src/core/engine/loop.ts` | Loop de paso fijo con render interpolado | **Sí**, tal cual. |
| `src/core/engine/canvas.ts` | Escalado, DPR, letterbox, `toWorld` | **Sí**, tal cual. |
| `src/core/engine/input.ts` | Puntero, multitouch, swipe, teclado, tilt | **Sí**, tal cual. |
| `src/core/engine/rng.ts` | PRNG sembrado | **Sí**, tal cual. |
| `src/core/engine/pool.ts` | Object pool | **Sí**, tal cual. |
| `src/core/engine/palette.ts` | Tokens CSS cacheados, `withAlpha`, `prefersReducedMotion` | Sí, cambiando la lista de tokens. |
| `src/core/engine/audio.ts` | WebAudio, seis voces sintetizadas, `vibrate` | **Sí**, tal cual. |
| `src/core/engine/collide.ts` | `lerp`, `clamp` y colisiones varias | Sí; el juego sólo usa `lerp`. |
| `src/core/engine/useGameLifecycle.ts` | Fases, cuenta regresiva, force-end, HUD, mute | Sí, si el destino usa React. |
| `src/core/engine/useGame2D.ts` | Une lo anterior: `init` / `update` / `draw` / `outcome` | Sí, si el destino usa React. |
| `src/ui/game/GameStage.tsx` | Canvas + HUD + los cuatro estados | Reescribir con el design system del destino. |
| `src/styles/tokens.css` | Los tokens de color | Reemplazar por los del destino. |
| `games-guide/M5-NINJA.md` | La guía original del juego | Referencia. |

**Nota sobre la guía original:** pedía PixiJS. La implementación quedó en Canvas 2D a
propósito, y el motivo está arriba en *Plataforma y stack*. Si el proyecto destino llega
a un caso donde el contador de fps no da 60, ahí hay evidencia para cambiar — y no antes.
