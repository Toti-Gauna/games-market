# Prompt maestro · Catapulta (portable)

> **Qué es este archivo.** El prompt autocontenido para reimplementar el juego Catapulta
> (Angry Birds con física real) de este repo en **otro proyecto**, sin tener acceso a este
> código. Todo lo que hace falta —reglas, números, integración con Rapier, los cinco
> niveles como datos, tests y criterios de aceptación— está escrito acá.
>
> **Cómo usarlo.** Copiá el archivo entero, desde `# ROL` hasta el final, y pegalo como
> prompt en Claude Code, Codex, Cursor o Copilot. No necesita nada más.
>
> **Origen.** `src/games/catapulta/` de `juegos-supernova` (guía
> `games-guide/M2-CATAPULTA.md`). El apéndice E mapea archivo por archivo por si el
> proyecto destino prefiere copiar la base en vez de reescribirla.

---

# ROL

Actuá como **Game-arquitect**: agente arquitecto de videojuegos web.
Priorizá simplicidad, vertical slicing, game feel y performance.
Usá el stack más chico que resuelva el juego. Primero loop jugable, después polish.
Leé los archivos antes de modificarlos y explicá las decisiones no obvias.

Este juego trae una dependencia pesada y un recurso que el recolector de JavaScript **no
alcanza** (memoria WASM). Las dos cosas tienen reglas explícitas más abajo y no son
negociables.

---

# OBJETIVO

Implementar **Catapulta**: tirás de una banda elástica hacia atrás, soltás, y el
proyectil vuela en parábola contra una estructura que se derrumba encima de los objetivos.
**Tres tiros por nivel, cinco niveles.**

Sin metáfora forzada: es un juego de puntería y física, y con eso alcanza. La física lo
vende sola — ver una estructura derrumbarse bien es más satisfactorio que cualquier
animación escrita a mano.

Es un juego `solo`: un jugador, sin red, sin backend. Termina emitiendo un `outcome` que
el contenedor guarda o muestra.

---

# CORE LOOP

El jugador **arrastra hacia atrás para tensar la banda**, ve la **parábola de salida**
mientras apunta, **suelta para disparar**, y mira cómo la estructura se derrumba sobre los
objetivos. Si quedan objetivos en pie y quedan tiros, vuelve a apuntar.

- **Gana el nivel** cuando cae el último objetivo; pasa al siguiente.
- **Pierde el nivel** cuando se acaban los tiros; igual pasa al siguiente, sumando sólo lo
  derribado.
- **El bono por tiros sin usar es lo que hace al juego de puntería y no de insistencia.**
  Sin él, la estrategia óptima es tirar los tres siempre. Con él, resolver de un tiro vale
  más que resolver de tres, y esa es toda la tensión del juego.

---

# PLATAFORMA Y STACK

- **Plataforma:** web, escritorio y móvil, orientación apaisada.
- **Física:** **`@dimforge/rapier2d-compat`** (probado con `^0.20`).
- **Render:** **Canvas 2D**. Rapier resuelve la simulación, el canvas la dibuja.
- **Lenguaje:** TypeScript en modo `strict`, con `noUncheckedIndexedAccess`.
- **UI/HUD:** React 19 (o el framework del destino). El HUD va en **DOM** encima del
  canvas, **nunca** dibujado adentro.
- **Tests:** Vitest (o el runner del destino), sin navegador **y sin Rapier**.

## Por qué Rapier y no Matter.js

**Determinismo.** El mismo tiro tiene que producir exactamente el mismo derrumbe en dos
máquinas, o los puntajes dejan de ser comparables. Matter.js es más fácil de arrancar y no
lo garantiza.

## Por qué la variante `-compat`

Trae el WASM embebido en base64 y se inicializa con `await RAPIER.init()`, lo que evita
configurar la carga del `.wasm` en el bundler. Pesa más (~2,1 MB, ~790 KB comprimido) pero
para un juego que se carga diferido es el intercambio correcto.

**Ese peso obliga a dos cosas:**

1. **Import dinámico**: `await import("@dimforge/rapier2d-compat")` dentro del componente,
   nunca un import estático. El WASM no puede entrar en el bundle inicial ni bloquear el
   primer render.
2. **Chunk propio** en la configuración del bundler, y el límite de aviso de tamaño subido
   apenas por encima, para que **un chunk nuevo que se desmadre siga avisando** en vez de
   esconderse detrás de éste.

**No usar:**

- **No** Matter.js, ni Planck, ni Box2D compilado a mano.
- **No** un engine de render (Pixi/Phaser): las piezas son rectángulos redondeados.
- **No** simular la trayectoria en el motor para la vista previa: se calcula
  analíticamente.
- **No** delta variable: el paso de Rapier **es** el paso del loop.
- **No** assets de imagen ni de sonido: todo se dibuja y se sintetiza.

---

# ARQUITECTURA OBLIGATORIA

## 1. Cuatro archivos, y la lógica no toca la física

```
catapulta/
  levels.ts       # los cinco niveles como datos + el formato editable. Sin lógica.
  logic.ts        # reglas, armado, estado del turno, puntaje. SIN Rapier, sin React, sin DOM.
  logic.test.ts   # los tests de logic.ts (corren sin el motor de física)
  settings.ts     # el schema de administrables, con los niveles como contenido editable
  CatapultaGame.tsx  # ata Rapier, la base 2D y logic.ts, y dibuja
```

**El reparto que hace testeable el juego:**

- **La física resuelve QUÉ se cae.**
- **`logic.ts` resuelve qué significa que se haya caído** — y es lo único que necesita
  test.
- **El componente sólo los ata y dibuja.**

Por eso `logic.ts` no importa Rapier: los tests corren en Node, sin WASM, en milisegundos.

## 2. El montaje en dos etapas

`RAPIER.init()` es **asincrónico** y el `init` de la base 2D **no lo es**. La solución es
partir el componente en dos:

```tsx
export default function CatapultaGame(props: GameProps) {
  const [api, setApi] = useState<RapierModule | null>(null);
  const [failed, setFailed] = useState(false);

  // El aviso de "ya se puede sacar el loader" NO puede estar en las dependencias
  // del efecto: si el padre lo recrea, el motor se recargaría entero.
  const onReadyRef = useRef(props.onReady);
  onReadyRef.current = props.onReady;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("@dimforge/rapier2d-compat");
        await mod.init();
        if (cancelled) return;
        setApi(mod);
        onReadyRef.current?.();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!api) return <Placeholder failed={failed} />;   // "Cargando el motor de física…"
  return <CatapultaStage api={api} {...props} />;     // acá sí, todo síncrono
}
```

El estado de error importa: si el WASM no carga, el juego tiene que **decirlo**, no quedar
en un canvas negro.

## 3. El runtime mínimo que el juego necesita

Si el proyecto destino ya tiene estas piezas, **usalas**. Si no, implementalas con
exactamente este contrato.

| Pieza | Contrato | Por qué |
|---|---|---|
| **Loop de paso fijo** | `createLoop(update: (dt) => void, render: (alpha) => void, { step })` con `dt = 1/60` constante, acumulador, tope de `0.25 s` por frame, y `alpha = acc/step` para interpolar. | **Es lo que alimenta a Rapier.** Con delta variable, la simulación deja de ser determinista y el mismo tiro se derrumba distinto en cada máquina. |
| **Canvas escalado** | `setupCanvas(canvas, { designWidth, designHeight, maxDpr })` → `{ ctx, toWorld(clientX, clientY), dispose() }`. Letterbox conservando aspecto, `setTransform` una vez por layout. | El juego dibuja en 1600×900 y no se entera del tamaño real. `toWorld` convierte el arrastre en coordenadas del mundo, que son **las mismas de la física**. |
| **DPR topeado** | `min(devicePixelRatio, 1.5)` en puntero grueso, `2` en escritorio. | Renderizar a 3× es la forma más rápida de perder frames. |
| **Input** | `createInput(container, { toWorld })` → `state.pointer { x, y, down, justPressed, justReleased }`. `endFrame()` limpia los flags. Ignora los eventos cuyo `target.closest("[data-game-ui]")` exista. | Sin la guarda del HUD, la captura de puntero se come el `click` del botón "Jugar". |
| **PRNG sembrado** | `createRng(seed)` → `{ next, range, int, pick, shuffle, chance }`. | Acá **no decide nada del juego**: los niveles son fijos. Sólo la veta decorativa de cada pieza y las partículas. Sembrado igual, para que dos máquinas dibujen la misma veta y una captura sirva de referencia. |
| **Object pool** | `createPool<T extends { alive: boolean }>(capacity, factory)`. | Partículas. Cero asignaciones en el loop. |
| **Paleta** | `readPalette()` lee los tokens CSS una vez y cachea. `mixHex(a,b,t)` y `withAlpha(hex,a)` **precalculados fuera del loop**. | Armar un color por frame es basura de GC. |
| **Audio** | WebAudio a mano. Voces usadas: `pick`, `hit`, `tick`, `win`, `lose`, `select`. **Arranca en silencio.** | — |
| **Ciclo de vida** | Fases `intro → playing → paused → over`, `AbortSignal` para force-end, `setHud` que sólo dispara render si algo cambió, y `restart` que remonta la escena. | El remonte es donde se libera el mundo WASM: ver más abajo. |

## 4. Contrato del componente

```ts
type GameOutcome = {
  completed: boolean;          // true sólo si se llegó al final de los cinco niveles
  points: number;
  durationMs: number;
  meta?: Record<string, unknown>;
};

type GameProps = {
  config: {
    seed: string;                  // sólo veta y partículas; los niveles son fijos
    durationMs: number | null;
    settings: Record<string, ...>; // administrables ya mezclados con los defaults
    debug: boolean;
  };
  signal: AbortSignal;         // al abortar, emitir el resultado parcial EN EL ACTO
  onFinish: (outcome: GameOutcome) => void;  // exactamente una vez
  onReady?: () => void;        // se llama cuando el motor de física terminó de cargar
};
```

---

# LA FÍSICA — las reglas que no se negocian

## 1. Un paso de Rapier por paso del loop, siempre

```ts
const FIXED_STEP = 1 / 60;
world.timestep = FIXED_STEP;   // el mismo número que declara el loop
```

Y en el `update`, **antes que nada y en todas las fases**:

```ts
physics.world.step(physics.events);
physics.events.drainContactForceEvents(scene.onContactForce);
```

Se pisa siempre, también mientras el jugador apunta: así el nivel se asienta solo antes
del primer tiro, y la simulación no depende de en qué fase esté la interfaz.

## 2. El mundo comparte sistema de coordenadas con el canvas

```ts
const PIXELS_PER_METER = 100;
world.lengthUnit = PIXELS_PER_METER;
const world = new api.World({ x: 0, y: gravity });   // gravity POSITIVA: Y va hacia abajo
```

Todo está en **píxeles del mundo, con Y hacia abajo igual que el canvas**. Así la física y
el dibujo comparten sistema y **no hay una sola conversión por frame**. `lengthUnit` es lo
que le dice a Rapier cuántos píxeles considera "un metro", para que los umbrales internos
del solver sigan teniendo sentido.

## 3. Los cuerpos

**Suelo** — cuerpo fijo, un cuboide ancho apoyado bajo la línea del suelo:

```ts
const ground = world.createRigidBody(
  api.RigidBodyDesc.fixed().setTranslation(WORLD_WIDTH / 2, GROUND_Y + 80),
);
world.createCollider(
  api.ColliderDesc.cuboid(WORLD_WIDTH, 80).setFriction(0.92).setRestitution(0.02),
  ground,
);
```

**Proyectil** — se crea **una sola vez** y se apaga entre tiros. Crear y destruir un cuerpo
por disparo sería basura para el GC en mitad de la partida.

```ts
const projectile = world.createRigidBody(
  api.RigidBodyDesc.dynamic()
    .setTranslation(PARK_X, PARK_Y)     // -4000, -4000: estacionado fuera del mundo
    .setCcdEnabled(true)                // ← CCD SÓLO acá
    .setEnabled(false)
    .setLinearDamping(0.02)
    .setAngularDamping(0.6),
);
world.createCollider(
  api.ColliderDesc.ball(PROJECTILE_RADIUS)   // 18
    .setDensity(0.0018)
    .setFriction(0.55)
    .setRestitution(0.22)
    .setActiveEvents(api.ActiveEvents.CONTACT_FORCE_EVENTS)
    .setContactForceEventThreshold(FORCE_FLOOR),
  projectile,
);
```

**CCD sólo en el proyectil**: es el único cuerpo lo bastante rápido como para cruzar un
bloque entre dos pasos. Activarlo en todo sería pagar por nada.

**Piezas** — cuerpos dinámicos rectangulares, creados al montar el nivel y **nunca por
frame**:

| Tipo | Densidad | Fricción | Restitución |
|---|---|---|---|
| Objetivo | `0.0005` | `0.62` | `0.04` |
| Madera | `0.0006` | `0.62` | `0.04` |
| Piedra | `0.0016` | `0.72` | `0.04` |

Todas con `linearDamping 0.05`, `angularDamping 0.2`, colisionador `cuboid(w/2, h/2)`, y
los mismos eventos de fuerza de contacto que el proyectil.

## 4. El daño sale de la **fuerza de contacto**, no del cambio de velocidad

```ts
const FORCE_FLOOR = 12000;

function onContactForce(event: ContactForceEvent) {
  if (run.phase !== "resolving") return;         // el asentado inicial no rompe nada
  const impulse = (event.maxForceMagnitude() - FORCE_FLOOR) * FIXED_STEP;
  if (impulse <= 0) return;
  // resta impulse a la vida de cada pieza involucrada, y las marca con un flash
}
```

> **Por qué la fuerza y no el delta de velocidad.** Un objetivo aplastado contra el suelo
> no cambia de velocidad, pero la plataforma que le cae encima **sí le mete fuerza**.
> Medirlo así es lo que hace que derrumbar la torre cuente como derribar lo que hay debajo
> — que es el nivel 2 entero.

> **De dónde sale `FORCE_FLOOR = 12000`.** Es el piso por debajo del cual no hay golpe sino
> peso: una torre en reposo apoya hasta ~5.500 y un impacto real pasa de 13.000. **Medido,
> no adivinado.** Si el proyecto destino cambia densidades o gravedad, **hay que volver a
> medirlo**, o las torres se autodestruyen por su propio peso.

**El handler sólo resta vida.** Sacar un cuerpo del mundo mientras Rapier está drenando sus
propios eventos es pedir un cuelgue. La pieza con vida ≤ 0 se retira **después**, en el
barrido de lectura de cuerpos.

## 5. La memoria WASM se libera a mano

El recolector de JavaScript **no alcanza** al mundo de Rapier. Hay que soltarlo en dos
lugares o cada reinicio deja un mundo entero colgado en memoria:

```ts
dispose() {
  if (disposed) return;
  disposed = true;
  events.free();
  world.free();
}
```

- **Al desmontar el componente** (efecto de limpieza).
- **Al principio de cada `init`**, porque reiniciar remonta la escena sin desmontar el
  componente.

Y al retirar una pieza: `world.removeRigidBody(body)` **y borrarla del mapa de
colisionadores**, porque **Rapier recicla los handles** — dejarla ahí haría que el próximo
cuerpo le cargue el daño a una pieza que ya no existe.

## 6. Dormir cuerpos quietos

Rapier duerme los cuerpos quietos solo. **Hay que dejarlo, nunca forzar `wakeUp`**: es lo
que hace que el tiempo de paso baje cuando la escena se aquieta, y es la señal con la que
se decide que el turno terminó.

## 7. Retiro de cuerpos

- **Fuera del mundo:** cualquier cuerpo con `y > WORLD_HEIGHT + 600`, `x < -600` o
  `x > WORLD_WIDTH + 600` se retira en el acto. Un cuerpo cayendo al infinito sigue
  costando. Si era un objetivo, **cuenta como derribado**: ya no está en pie.
- **Proyectil gastado:** si su velocidad baja de `70 px/s` durante más de `300 ms`, se
  estaciona. **Una bola rodando por el suelo tarda muchísimo en dormirse y es la razón
  número uno de que un turno llegue al tope de espera.**

---

# ESPECIFICACIÓN FUNCIONAL

## Mundo

| | |
|---|---|
| Dimensiones | **1600 × 900** |
| Suelo | cara superior en **y = 820** (`GROUND_Y`); todo el nivel se apoya contra esa línea |
| Gravedad | **980 px/s²** hacia abajo (administrable) |
| Ancla de la catapulta | **(250, 636)** |
| Arrastre máximo | **260 px** |
| Radio del proyectil | **18 px** |
| Tamaño de objetivo | **46 × 46**, todos iguales: se reconocen de una |
| Cuerpos dinámicos | tope de **60** |
| Partículas | tope de **150**, pooleadas |
| Cuenta regresiva | **0** — este juego no la usa: se entra apuntando |

## Apuntado

El arrastre es **relativo a donde se apretó**, no a la honda. En un proyector o en un
celular chico, exigir agarrar la bolsa exacta hace fallar el gesto.

```ts
export const MIN_DRAG = 26;   // debajo de esto es un toque, no un arrastre: no dispara

/**
 * dx/dy van del punto actual al punto donde se apretó: arrastrar hacia atrás
 * apunta hacia adelante. Escribe sobre `out` porque corre por frame.
 */
export function aimFromDrag(dx, dy, maxDrag, maxSpeed, out: Aim): boolean {
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < MIN_DRAG) { /* todo a 0 */ return false; }
  const clamped = Math.min(length, maxDrag);
  const ux = dx / length, uy = dy / length;
  out.power = clamped / maxDrag;          // 0..1
  out.pullX = ux * clamped;               // tensión ya limitada, para dibujar la banda
  out.pullY = uy * clamped;
  out.vx = ux * out.power * maxSpeed;
  out.vy = uy * out.power * maxSpeed;
  out.angle = Math.atan2(uy, ux);
  return true;
}
```

Ángulo libre, 360°. Al soltar con `power > 0` se dispara; al perder el foco con el dedo
apoyado, el arrastre se cancela (si no, la banda queda tensada para siempre).

## Vista previa de la trayectoria

**Es la decisión de diseño que más define el juego.** Sin ella los primeros tiros son a
ciegas y el jugador no aprende; con ella pasa del ensayo y error a la puntería.

**Se calcula analíticamente**, no simulando en el motor: la vista previa sólo tiene que
mostrar la salida del tiro, y simularla costaría un mundo entero por frame.

```ts
export function trajectoryPoint(x0, y0, vx, vy, gravity, t, out: Point): Point {
  out.x = x0 + vx * t;
  out.y = y0 + vy * t + 0.5 * gravity * t * t;
  return out;
}
```

Se dibujan **26 puntos** repartidos sobre los primeros **1,2 s**, arrancando en la posición
de la bolsa tensada, y se corta apenas la parábola cruza el suelo. La opacidad decae de
`0.85` a `0.20` a lo largo del arco.

## El turno

```ts
export type TurnPhase = "aiming" | "resolving" | "review" | "done";
export const MIN_TURN_MS = 350;
```

| Fase | Qué pasa |
|---|---|
| `aiming` | se lee el arrastre; al soltar se descuenta un tiro y se dispara |
| `resolving` | el mundo se sacude; el daño **sólo cuenta acá** |
| `review` | el nivel se cerró (limpio o fallado); banner y espera antes del siguiente |
| `done` | se acabaron los niveles: la partida termina |

**Cuándo se evalúa el turno** — el detalle que se suele errar:

```ts
export function tickTurn(run, dtMs, quiet: boolean): boolean {
  if (run.phase !== "resolving") return false;
  run.turnMs += dtMs;
  if (run.targetsLeft <= 0) return true;          // sin objetivos en pie, nada puede cambiar
  if (run.turnMs < MIN_TURN_MS) return false;     // no se evalúa en el primer frame
  return quiet || run.turnMs >= run.rules.settleMs;
}
```

- **No se puede evaluar en el primer frame:** todavía no se movió nada y el mundo parece
  quieto.
- **Se espera a que todo duerma, o hasta `settleMs` (5 s por defecto)**, lo que pase
  primero. Un bloque tambaleándose puede caer tres segundos después y cambiar el resultado.
- **Si ya no quedan objetivos en pie, se resuelve sin esperar:** ningún escombro puede
  cambiar el resultado.
- Pasado `1,2 s` de turno, se muestra un aviso sutil de que el mundo se está asentando.

`endTurn` cierra: si no quedan objetivos → nivel limpio; si no quedan tiros → fallado; si
no, vuelve a `aiming`.

## Puntaje

```ts
export function levelPoints(tally: LevelTally, rules: CatapultRules): number {
  const targets = tally.targetsDown * rules.pointsPerTarget;   // 500 c/u
  const blocks  = tally.blocksDown  * rules.pointsPerBlock;    // 25 c/u, daño colateral
  // El bono por tiros sin usar sólo se paga si el nivel quedó limpio.
  const spare = tally.cleared ? Math.max(0, tally.shotsLeft) * rules.pointsPerSpareShot : 0;
  return targets + blocks + spare;
}
```

Con los defaults, resolver un nivel de un tiro (500 + 2×300 = **1100**) vale casi el doble
que resolverlo de tres (**500**). El daño colateral suma pero **nunca alcanza para ganar el
nivel**.

**Puntaje parcial (force-end a mitad de un nivel):** cuenta lo derribado hasta ahí, **sin**
el bono de puntería. En `review` o `done` ya está todo contabilizado y no se cuenta dos
veces.

---

# LOS NIVELES SON CONTENIDO, NO CÓDIGO

**Un nivel generado es un nivel que nadie diseñó, y en cinco niveles se nota**: la
progresión (tiro directo → derrumbe → apuntar alto → dominó → todo junto) es justamente lo
que hace que se sienta un juego y no una demo de física.

Los cinco niveles **no son constantes escondidas en el componente**: entran como contenido
editable desde el panel de administración, así que se puede armar un nivel nuevo sin tocar
código.

## Formato editable

El schema de administrables sólo maneja escalares y listas de strings, así que cada nivel
viaja como una fila con dos listas de texto:

- **bloque** → `"x,y,ancho,alto,material"` — el centro en píxeles, y `madera` o `piedra`
- **objetivo** → `"x,y"` — el centro en píxeles

El parseo es **tolerante**: un bloque mal escrito se ignora sin romper el nivel. Pero **un
nivel sin objetivos se descarta entero**, porque no se puede ganar nunca — y se descarta
*antes* de que llegue al mundo, no después de que el jugador gastó los tres tiros. Si no
queda ningún nivel válido, se cae a los cinco por defecto.

## Presupuesto de piezas

`buildLevelPlan` recorta bloques si el nivel excede las 60 piezas, pero **los objetivos
nunca se recortan**: son la condición de victoria. El presupuesto de bloques es
`60 - cantidad de objetivos`.

## Los cinco niveles (datos exactos)

Coordenadas en píxeles del mundo de 1600×900, con **Y hacia abajo** y el centro de cada
pieza. `GROUND_Y = 820`, `TARGET_SIZE = 46`, así que un objetivo apoyado en el suelo tiene
`y = 820 - 23 = 797`.

**N1 · "Tiro directo"** — *el tutorial sin cartel de tutorial.*
```
bloques:  ninguno
objetivo: (1150, 797)
```

**N2 · "La torre"** — *enseña que las estructuras se derrumban: el objetivo está debajo.*
```
bloques:  (1080, 745, 26, 150, madera)   (1220, 745, 26, 150, madera)
          (1150, 657, 190, 26, madera)
          (1105, 589, 26, 110, madera)   (1195, 589, 26, 110, madera)
          (1150, 521, 150, 26, madera)
objetivo: (1150, 797)
```

**N3 · "Detrás del muro"** — *enseña a apuntar alto.*
```
bloques:  (1060, 760, 40, 120, piedra)   (1060, 640, 40, 120, piedra)
          (1060, 520, 40, 120, piedra)
          (1240, 770, 26, 100, madera)   (1240, 670, 26, 100, madera)
          (1480, 770, 26, 100, madera)   (1480, 670, 26, 100, madera)
objetivo: (1360, 797)
```
> El muro de piedra no se rompe de frente: hay que pasarlo por arriba. Las dos torres
> flanquean al objetivo **pero no lo techan**: si lo taparan, el único tiro posible sería
> imposible y el nivel quedaría sin solución.

**N4 · "Dominó"** — *dos torres encadenadas.*
```
bloques:  (960, 740, 24, 160, madera)    (1060, 740, 24, 160, madera)
          (1010, 649, 150, 22, madera)
          (1260, 740, 24, 160, madera)   (1360, 740, 24, 160, madera)
          (1310, 649, 150, 22, madera)
          (1160, 628, 380, 20, madera)   ← la tabla larga que une las dos torres
objetivos: (1010, 595)  (1310, 595)
```
> Los dos objetivos viajan **arriba** de la tabla: voltear cualquiera de las torres tira el
> puente y se los lleva a los dos. Ahí está el dominó.

**N5 · "Todo junto"** — *tres objetivos y tres tiros justos.*
```
tiros: 3 (declarados por el nivel, no heredados)
bloques:  (980, 755, 40, 130, piedra)    (980, 625, 40, 130, piedra)
          (1200, 745, 26, 150, madera)   (1330, 745, 26, 150, madera)
          (1265, 658, 180, 24, madera)
          (1220, 596, 24, 100, madera)   (1310, 596, 24, 100, madera)
          (1265, 534, 140, 24, madera)
objetivos: (1265, 797)  (1265, 623)  (1480, 797)
```

Un nivel con `shots: 0` usa el valor general de "Tiros por nivel".

---

# ADMINISTRABLES

| Grupo | Clave | Label | Default | Rango | Paso | Unidad |
|---|---|---|---|---|---|---|
| Partida | `shotsPerLevel` | Tiros por nivel | **3** | 1–6 | 1 | tiros |
| Partida | `settleMs` | Espera hasta que se aquiete | **5000** | 1500–8000 | 250 | ms |
| Física | `gravity` | Gravedad | **980** | 400–1600 | 20 | px/s² |
| Física | `maxLaunchSpeed` | Fuerza máxima del lanzamiento | **1200** | 600–2000 | 50 | px/s |
| Resistencia | `woodStrength` | Resistencia de la madera | **700** | 100–2000 | 25 | — |
| Resistencia | `stoneStrength` | Resistencia de la piedra | **2400** | 400–6000 | 50 | — |
| Resistencia | `targetStrength` | Resistencia del objetivo | **140** | 40–1000 | 10 | — |
| Puntaje | `pointsPerTarget` | Puntos por objetivo | **500** | 50–2000 | 50 | — |
| Puntaje | `pointsPerBlock` | Puntos por bloque derribado | **25** | 0–200 | 5 | — |
| Puntaje | `pointsPerSpareShot` | Puntos por tiro sin usar | **300** | 0–1000 | 50 | — |
| Contenido | `levels` | Niveles | los 5 | 1–10 filas | — | — |

Textos de ayuda que vale la pena mantener, porque explican **por qué** existe el número:

- `shotsPerLevel`: "Se usa en los niveles que no declaran los suyos. Con más de cuatro deja
  de ser puntería."
- `settleMs`: "Tope de espera después del tiro. Un bloque puede caer tres segundos tarde y
  cambiar el resultado."
- `stoneStrength`: "La piedra está para no romperse de frente: obliga a buscar otro
  ángulo."
- `targetStrength`: "Los objetivos aguantan menos que la estructura que los protege."
- `pointsPerBlock`: "Daño colateral. Suma, pero nunca alcanza para ganar el nivel."
- `pointsPerSpareShot`: "Es lo que hace al juego de puntería y no de insistencia: resolver
  de un tiro vale más."
- `levels`: "Cada bloque es «x,y,ancho,alto,material» y cada objetivo «x,y», con el centro
  en píxeles del mundo de 1600×900."

Cada fila de nivel tiene: `name` (texto), `shots` (0 = usar el general), `blocks` (lista) y
`targets` (lista, mínimo 1).

---

# PRESENTACIÓN Y GAME FEEL

Todo es forma geométrica dibujada con Canvas 2D: **cero assets**.

## Colores (tokens CSS, leídos y compuestos una sola vez)

| Uso | Token |
|---|---|
| Cielo | degradé vertical de `--sn-bg-elev` a `--sn-bg`, creado **una vez** en el `init` |
| Suelo / borde | `--sn-panel` / `--sn-line` |
| Horizonte (guiones) | `--sn-violet-500` al 22 % |
| Estructura de la catapulta | `--sn-line`, con `--sn-panel-hi` para el medidor |
| Banda elástica | `--sn-magenta-500` |
| Proyectil / estela | `--sn-magenta-400` / `--sn-magenta-300` |
| Vista previa | `--sn-cyan-300` |
| Objetivos | `--sn-cyan-400`, con halo de `--sn-cyan-300` al 30 % |
| Madera | `--sn-violet-400`, borde mezclado 45 % contra el fondo |
| Piedra | `--sn-violet-600`, borde mezclado 45 % contra el fondo |
| Banner de nivel limpio / fallado | `--sn-success` / `--sn-danger` |

## La catapulta

Estructura en Y: un poste vertical desde el suelo hasta `ancla + 52`, y dos brazos que se
abren `±30 px` hasta la altura del ancla, con trazo de 16 px y puntas redondeadas.

La **banda** va del brazo izquierdo a la bolsa y de la bolsa al brazo derecho. La bolsa se
desplaza `−pull · 0.5` mientras se arrastra: la banda se estira la mitad de lo que se
arrastra, que es lo que hace que el gesto se lea sin ocupar media pantalla. El trazo pasa
de 6 a 9 px al tensarse.

**La bola espera en la bolsa** cuando queda tiro y la fase es `aiming`: se ve que hay con
qué tirar.

## Medidor de fuerza

Una barra de 120×12 px pegada bajo la catapulta, que se llena con `aim.power`. Sirve para
leer la potencia **sin mirar el HUD**, que está en la otra punta de la pantalla.

## Las piezas

- **Objetivos:** rectángulo redondeado en cyan, con un **halo pulsante** detrás
  (`0.25 + pulso·0.35`) y un círculo oscuro en el centro. El pulso es lo que los distingue
  de un vistazo de la estructura que los protege.
- **Bloques:** rectángulo redondeado del color del material, con **una veta** —una sola
  línea, en la dirección corta de la pieza, con la posición sacada del PRNG sembrado—. Da
  textura sin costar nada.
- **Desgaste:** cuanto más daño acumulado, más oscura la pieza
  (`wear = 1 - hp/maxHp`, aplicado como una capa al `wear · 0.5` de opacidad). **El estado
  se ve antes de romper**, así el jugador entiende que el segundo tiro va a alcanzar.
- **Flash de impacto:** 150 ms de blanco al 55 % sobre la pieza golpeada. Nunca con
  reduced-motion.

Las posiciones y ángulos se **interpolan con el `alpha` del loop**, con un `lerpAngle` que
no se vuelve loco cuando el ángulo cruza de π a −π:

```ts
function lerpAngle(prev: number, next: number, alpha: number): number {
  return Math.abs(next - prev) > Math.PI ? next : prev + (next - prev) * alpha;
}
```

## Proyectil, partículas y sacudida

- **Estela** de 16 posiciones en buffer circular, con opacidad creciente hacia la punta.
  No se dibuja con reduced-motion.
- **Partículas:** 12 por impacto (3 con reduced-motion), del color de la pieza rota,
  ángulo uniforme, velocidad 90–340 con un empujón de −90 en Y, vida 0,35–0,85 s, tamaño
  3–8, y gravedad al **55 %** de la del mundo.
- **Sacudida** proporcional a lo que se rompió: 10 por un objetivo, 8 por piedra, 5 por
  madera, con tope de 14 y 180 ms de duración. Nunca con reduced-motion.
- **Tiros restantes** como círculos llenos junto al suelo, y huecos los ya usados.
- **Banner** del nombre del nivel al empezar, y de `¡Nivel limpio!` / `Sin tiros` al
  cerrarlo.
- **Aviso de asentado** (`"Esperando que se asiente…"`) con un latido suave, a partir de
  1,2 s de turno.

## Sonido y vibración

| Evento | Sonido | Vibración |
|---|---|---|
| Disparar | `pick` | `20` |
| Impacto (con cooldown de 90 ms) | `tick` | — |
| Bloque derribado | `hit` | `14` |
| Objetivo derribado | `win` | `[18, 30, 18]` |
| Nivel limpio | `win` | `[20, 40, 20, 40]` |
| Sin tiros | `lose` | `[40, 60]` |
| Nivel siguiente | `select` | — |

El **cooldown del sonido de impacto no es opcional**: un derrumbe genera decenas de
contactos por segundo y sin él suena a estática.

## `prefers-reduced-motion`

**La física es exactamente la misma.** Lo que cambia es el envoltorio:

- sin sacudida, sin flash de impacto, sin estela;
- 3 partículas por impacto en vez de 12;
- sin pulso en los objetivos ni latido en el aviso;
- la espera de `review` baja de 1500 a 600 ms.

---

# HUD Y ESTADOS

HUD en **DOM**, con `aria-live="polite"` y `data-game-ui`:

- **Puntos** — dominante, cyan.
- **Nivel** — `n/total`.
- **Tiros** — magenta, **rojo cuando llega a 0**.
- **Objetivos** — los que quedan en pie.
- **Estado** — `Apuntá` / `Volando` / `Asentándose` / `¡Nivel limpio!` / `Sin tiros`.
- **Tiempo** — sólo si hay límite; rojo bajo 15 s.
- **fps** — sólo con `config.debug`.

**El HUD se publica sólo cuando algo cambió de verdad**, con una bandera `hudDirty` que se
levanta en los eventos (disparo, derribo, cierre de nivel) más un chequeo del texto de
estado. Armar el objeto del parche por frame sería una asignación por frame para pintar los
mismos números.

Instrucciones, texto exacto: *"Arrastrá hacia atrás para tensar la banda y soltá para
disparar. Tres tiros por nivel, y los que no usás suman."*

Resumen: *"Superaste N niveles con M puntos"*, más la línea *"El bono por tiros sin usar es
donde está el puntaje: resolvé de un tiro."*

---

# CONTRATO DE SALIDA

```ts
onFinish({
  // completed sólo si se llegó al final de los cinco niveles
  completed: completed && run.phase === "done",
  points: runPoints(run),      // incluye el nivel en curso, sin bono, si fue force-end
  durationMs,
  meta: {
    nivelesSuperados: run.levelsCleared,
    nivelesTotales: run.plans.length,
    tirosUsados: run.shotsFired,
    objetivosDerribados: run.totalTargetsDown,
    bloquesDerribados: run.totalBlocksDown,
  },
});
```

---

# PERFORMANCE

| | |
|---|---|
| Objetivo | **60 fps en proyector y celular de gama media** |
| Cuerpos dinámicos | máx. **60**, con dormido activo |
| Partículas | máx. **150**, pooleadas |
| Si no llega | bajar partículas a 60, después reducir bloques por nivel |

Rapier corre en el hilo principal. Con 60 cuerpos alcanza; si alguna vez hiciera falta más,
va a un Web Worker, **pero no antes de necesitarlo**.

Cómo se consigue el "cero asignaciones", que es la parte que hay que hacer bien:

- **Vectores de scratch reusados** (`vec`, `vec2`): Rapier escribe adentro en vez de crear
  uno nuevo. `body.translation(vec)` y `body.linvel(vec2)`, nunca la variante que devuelve
  objeto.
- **El proyectil se crea una vez** y se estaciona entre tiros.
- **Las 60 piezas se preasignan** en el `init` y se reciclan al cambiar de nivel.
- **El handler de fuerza de contacto se crea una sola vez** en el `init`: un closure nuevo
  por frame sería basura por frame.
- **Colores, degradé del cielo y fuentes precalculados.**
- **Mapa `handle de collider → pieza`** armado al montar el nivel, nunca por frame. Es la
  única forma de mapear un evento de Rapier a su pieza.
- Nada de `new`, `{}`, `[]`, `.map` ni template literals dentro de `update` ni de `draw`.

---

# QUÉ NO HACER

- **No** Matter.js ni otro motor: determinismo.
- **No** desacoplar el paso de Rapier del paso del loop.
- **No** simular la trayectoria en el motor para la vista previa: se calcula
  analíticamente.
- **No** evaluar el turno antes de que el mundo se aquiete (ni en el primer frame).
- **No** retirar un cuerpo dentro del handler de eventos de contacto.
- **No** dejar una pieza retirada en el mapa de colisionadores: Rapier recicla los handles.
- **No** olvidar `world.free()` y `events.free()` al remontar y al desmontar.
- **No** forzar `wakeUp` en cuerpos dormidos.
- **No** dejar cuerpos fuera del mundo sin retirar.
- **No** generar niveles proceduralmente.
- **No** importar Rapier estáticamente: import dinámico y chunk propio.
- **No** poner reglas del juego en el componente, ni física en `logic.ts`.
- **No** quitar el cooldown del sonido de impacto.

---

# TESTS OBLIGATORIOS

Van sobre `logic.ts` y `levels.ts`, **sin navegador y sin Rapier**. Que se pueda testear
todo esto sin cargar el WASM es exactamente el punto de la separación.

**Determinismo y validez de los niveles**
1. La misma semilla arma exactamente los mismos niveles.
2. Semillas distintas cambian la veta **pero no la geometría**.
3. Los cinco niveles **se apoyan en el suelo** (`y + h/2 ≤ GROUND_Y`), caben dentro del
   ancho del mundo y no superan el techo de 60 cuerpos.
4. **Ninguna pieza empieza encimada con otra.** Dos piezas interpenetradas hacen que Rapier
   las escupa y el nivel se desarma solo antes del primer tiro. *Es el error que más fácil
   se cuela al editar un nivel a mano, y no se ve hasta que se juega.*

**Niveles como contenido**
5. Los defaults del schema vuelven a los cinco niveles.
6. Descarta filas sin objetivos: un nivel así no se puede ganar.
7. Un bloque mal escrito se ignora sin romper el nivel.
8. Un nivel con 0 tiros usa el valor general.
9. `rulesFromSettings` lee los defaults del schema.

**Puntaje**
10. Suma objetivos, daño colateral y tiros sin usar.
11. **Resolver de un tiro vale más que resolver de tres.**
12. Sin limpiar el nivel no hay bono por puntería.

**La tirada**
13. No se evalúa en el primer frame aunque todo parezca quieto.
14. Espera hasta el tope cuando el mundo no se aquieta.
15. Con los objetivos ya caídos resuelve sin esperar.

**Tres tiros y se acabó**
16. El cuarto tiro no sale.
17. Derrota cuando se agotan los tiros: sólo suma lo derribado.

**Victoria**
18. Cae el último objetivo y el nivel se cierra con el bono de puntería.
19. Un objetivo de más no suma: no quedan objetivos en pie.
20. Se recorren los niveles hasta terminar la partida.

**Puntaje parcial**
21. Force-end a mitad de nivel cuenta lo derribado, **sin** bono.
22. En `review` no se cuenta dos veces lo del nivel cerrado.

**Apuntado**
23. Un toque corto no dispara.
24. Estirar del todo da la fuerza máxima y la dirección del arrastre: arrastrar hacia
    abajo-izquierda dispara hacia arriba-derecha, con `power = 1` y módulo de velocidad
    igual a `maxLaunchSpeed`.
25. La fuerza es proporcional a cuánto se estiró la banda (medio arrastre ⇒ media fuerza).
26. La vista previa arranca en el punto de salida y cae con la gravedad
    (`t = 1 s` con `vy = -600` y `g = 980` ⇒ `y = y0 - 600 + 490`).

Helpers que hacen falta: un `labRun()` que arme una partida de laboratorio con un nivel de
dos objetivos sin estructura que estorbe, y un `shootAndSettle(run, objetivos, bloques)`
que dispare, registre derribos y cierre el turno como lo haría el mundo real.

---

# CRITERIOS DE ACEPTACIÓN

- [ ] `tsc --noEmit` en verde, en modo `strict` con `noUncheckedIndexedAccess`.
- [ ] Todos los tests de la sección anterior pasan, **sin cargar Rapier**.
- [ ] Los cinco niveles se completan y la progresión se siente.
- [ ] **Determinismo:** el mismo tiro (misma posición de arrastre) produce exactamente el
      mismo derrumbe dos veces, verificable comparando posiciones finales de los cuerpos.
- [ ] La vista previa coincide con el vuelo real en el primer tramo.
- [ ] El turno no se evalúa hasta que el mundo se aquieta o pasa `settleMs`.
- [ ] El proyectil **nunca atraviesa** un bloque (CCD activo).
- [ ] Resolver un nivel con un tiro da más puntos que con tres.
- [ ] Los cuerpos quietos duermen: el tiempo de paso de Rapier baja cuando la escena se
      aquieta.
- [ ] **Ningún nivel arranca con piezas interpenetradas** (se ve porque la estructura salta
      sola en el primer segundo).
- [ ] 60 fps con 60 cuerpos dinámicos y una torre derrumbándose.
- [ ] **El mundo WASM se libera** al reiniciar y al desmontar: reiniciar diez veces no hace
      crecer la memoria.
- [ ] El chunk de Rapier **no entra** en el bundle inicial.
- [ ] Si el WASM no carga, el juego lo dice en pantalla en vez de quedar en negro.
- [ ] `force-end` emite el outcome con los niveles completados hasta ahí, **una sola vez**.
- [ ] Con `prefers-reduced-motion` no hay sacudida, flash ni estela, y **la física es la
      misma**.
- [ ] Al desmontar no queda ni un `requestAnimationFrame`, ni un listener, ni un
      `ResizeObserver`, ni un `AudioContext` abierto.
- [ ] Cero errores y cero warnings en consola.

---

# ORDEN DE IMPLEMENTACIÓN

Cinco slices, cada uno verificable solo. No pasar al siguiente sin cerrar el anterior.

| # | Slice | Se cierra cuando |
|---|---|---|
| 1 | **Runtime**: loop de paso fijo, canvas con DPR y letterbox, input de puntero, PRNG, pool. | El puntero se lee en coordenadas del mundo y el loop corre a 60 fps. |
| 2 | **Lógica sin física** (`levels.ts` + `logic.ts` + tests): niveles como datos, parseo, armado, apuntado, trayectoria, estado del turno, puntaje. | Los 26 tests pasan. Todavía no se ve nada. |
| 3 | **Rapier**: carga en dos etapas, mundo, suelo, proyectil reusado, piezas del nivel, `dispose()`. | Se dispara una bola, la torre se cae, y reiniciar diez veces no hace crecer la memoria. |
| 4 | **Reglas atadas**: eventos de fuerza, daño por pieza, retiro, `worldQuiet`, cierre de turno, avance de nivel, HUD, outcome. | Se juegan los cinco niveles de principio a fin y el puntaje cierra. |
| 5 | **Game feel**: vista previa, medidor, veta y desgaste, flash, estela, partículas, sacudida, banners, sonido, reduced-motion. | Los criterios de aceptación visuales y de performance. |

---

# ENTREGA

Cambios pequeños y revisables, un slice por vez. Explicá las decisiones no obvias con un
comentario que diga **por qué**, no qué.
Al terminar, listá qué quedó pendiente y por qué.

---
---

# APÉNDICE A · Tipos y API de `logic.ts`

```ts
export const MIN_TURN_MS = 350;   // un turno no se evalúa en el primer frame
export const MIN_DRAG = 26;       // debajo de esto es un toque, no un arrastre
export const MAX_PIECES = 60;     // techo de cuerpos dinámicos

export type CatapultRules = {
  shotsPerLevel: number; settleMs: number;
  gravity: number; maxLaunchSpeed: number;
  woodStrength: number; stoneStrength: number; targetStrength: number;
  pointsPerTarget: number; pointsPerBlock: number; pointsPerSpareShot: number;
};

export const DEFAULT_RULES: CatapultRules = {
  shotsPerLevel: 3, settleMs: 5000,
  gravity: 980, maxLaunchSpeed: 1200,
  woodStrength: 700, stoneStrength: 2400, targetStrength: 140,
  pointsPerTarget: 500, pointsPerBlock: 25, pointsPerSpareShot: 300,
};

export type PieceKind = "block" | "target";

export type PiecePlan = {
  kind: PieceKind; material: BlockMaterial;
  x: number; y: number; w: number; h: number;   // x/y es el CENTRO
  strength: number;                              // golpe acumulado que aguanta
  grain: number;                                 // 0..1 del PRNG: sólo veta y partículas
};

export type LevelPlan = {
  id: string; name: string; shots: number;
  pieces: readonly PiecePlan[]; targetCount: number;
};

export type Aim = {
  vx: number; vy: number;
  power: number;                 // 0..1 de cuánto se estiró la banda
  angle: number;
  pullX: number; pullY: number;  // tensión ya limitada, en la dirección del disparo
};

export type TurnPhase = "aiming" | "resolving" | "review" | "done";

export type RunState = {
  rules: CatapultRules; plans: readonly LevelPlan[];
  levelIndex: number; phase: TurnPhase;
  shotsLeft: number; targetsLeft: number;
  targetsDown: number; blocksDown: number;          // del nivel en curso
  totalTargetsDown: number; totalBlocksDown: number; // de toda la partida
  shotsFired: number; turnMs: number;
  points: number;                                    // sólo niveles ya cerrados
  levelsCleared: number; lastLevelPoints: number; lastLevelCleared: boolean;
};

export type LevelTally = {
  targetsDown: number; blocksDown: number; shotsLeft: number; cleared: boolean;
};

/* Reglas y niveles */
export function rulesFromSettings(values: SettingsValues): CatapultRules;
export function parseLevels(rows: readonly SettingsRecord[]): LevelData[];
export function resolveLevels(values: SettingsValues): readonly LevelData[];
export function buildLevelPlan(level, rules, rng, maxPieces?): LevelPlan;
export function buildRunPlans(levels, rules, rng): LevelPlan[];

/* Apuntado */
export function createAim(): Aim;
export function aimFromDrag(dx, dy, maxDrag, maxSpeed, out: Aim): boolean;
export function trajectoryPoint(x0, y0, vx, vy, gravity, t, out: Point): Point;

/* Puntaje */
export function levelPoints(tally: LevelTally, rules: CatapultRules): number;

/* Estado de la partida */
export function createRun(plans, rules): RunState;
export function currentLevel(run): LevelPlan | null;
export function loadLevel(run): LevelPlan | null;
export function fireShot(run): boolean;
export function registerBlockDown(run): void;
export function registerTargetDown(run): void;
export function tickTurn(run, dtMs, quiet: boolean): boolean;
export function endTurn(run): "cleared" | "failed" | "aim";
export function nextLevel(run): boolean;
export function runPoints(run): number;
export function runMeta(run): Record<string, unknown>;
```

Y de `levels.ts`:

```ts
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;
export const GROUND_Y = 820;      // cara superior del suelo
export const TARGET_SIZE = 46;

export type BlockMaterial = "wood" | "stone";
export type BlockData = { x: number; y: number; w: number; h: number; material: BlockMaterial };
export type TargetData = { x: number; y: number };
export type LevelData = {
  id: string; name: string;
  shots: number;                  // 0 = usar el valor general
  blocks: readonly BlockData[]; targets: readonly TargetData[];
};

export function encodeBlock(item: BlockData): string;    // "x,y,w,h,madera"
export function encodeTarget(item: TargetData): string;  // "x,y"
export function decodeBlock(raw: string): BlockData | null;
export function decodeTarget(raw: string): TargetData | null;
export function encodeLevel(level: LevelData): SettingsRecord;

export const DEFAULT_LEVELS: readonly LevelData[];
/** Lo que el panel muestra por defecto. Se DERIVA de DEFAULT_LEVELS, no se repite. */
export const LEVEL_RECORDS: readonly SettingsRecord[];
```

---

# APÉNDICE B · Constantes del componente

```ts
const FIXED_STEP = 1 / 60;        // el mismo número alimenta al loop y a Rapier
const PIXELS_PER_METER = 100;     // world.lengthUnit

const ANCHOR_X = 250;             // ancla de la catapulta
const ANCHOR_Y = 636;
const MAX_DRAG = 260;
const POUCH_SCALE = 0.5;          // la bolsa se estira la mitad de lo que se arrastra
const PROJECTILE_RADIUS = 18;
const PARK_X = -4000;             // dónde se estaciona el proyectil entre tiros
const PARK_Y = -4000;

const PREVIEW_STEPS = 26;
const PREVIEW_SPAN_S = 1.2;
const MAX_PARTICLES = 150;
const BURST_FULL = 12;
const BURST_CALM = 3;             // con prefers-reduced-motion
const TRAIL_POINTS = 16;
const REVIEW_MS = 1500;           // 600 con reduced-motion
const BANNER_MS = 1600;
const SETTLING_HINT_MS = 1200;
const HIT_SOUND_COOLDOWN_MS = 90;

/**
 * Fuerza de contacto por debajo de la cual no hay golpe sino peso: una torre en
 * reposo apoya hasta ~5.500, y un impacto real pasa de 13.000. MEDIDO, no adivinado.
 */
const FORCE_FLOOR = 12000;
const SPENT_SPEED = 70;           // el proyectil se da por gastado bajo esta velocidad…
const SPENT_MS = 300;             // …sostenida este tiempo
const OUT_MARGIN = 600;           // margen fuera del mundo antes de retirar un cuerpo
```

El estado de escena guarda además: el mapa `collider handle → pieza`, el handler de fuerza
de contacto creado una sola vez, los buffers de la estela, los acumuladores de sacudida,
banner, review y cooldown, y una bandera `hudDirty`.

---

# APÉNDICE C · El `update`, paso a paso

```
1. world.step(events)                    ← SIEMPRE, en todas las fases
2. events.drainContactForceEvents(handler)   ← el handler sólo RESTA VIDA
3. readBodies():
     por cada pieza viva:
         guardar prevX/prevY/prevAngle, leer translation y rotation
         descontar flashMs
         si está resolviendo y hp <= 0 → destruir y puntuar
         si salió del mundo → destruir (puntúa sólo si estaba resolviendo)
     si el proyectil está activo:
         guardar prev, leer posición y velocidad
         acumular projSlowMs si va lento
         empujar un punto a la estela
         si salió del mundo o está gastado → estacionar
4. avanzar partículas, sacudida, banner y cooldown de sonido
5. según la fase:
     aiming    → leer el arrastre; al soltar, descontar tiro y disparar
     resolving → si tickTurn(...) → estacionar, endTurn(), banner y sonido
     review    → contar reviewMs; al vencer, nextLevel() y montar el nivel siguiente
6. si la fase quedó en "done" → finish(true) y salir
7. publishHud()  ← sólo si hudDirty o si cambió el texto de estado
```

---

# APÉNDICE D · Desvíos respecto de la guía original

El proyecto de origen tiene una guía escrita antes de implementar
(`M2-CATAPULTA.md`). Cuatro cosas quedaron distintas; si el proyecto destino sigue la guía
en vez de este prompt, va a obtener otro juego.

1. **Signo de la gravedad.** La guía dice `−980`; la implementación usa **+980 con Y hacia
   abajo**, para compartir sistema de coordenadas con el canvas y no convertir nada por
   frame.
2. **Modelo de daño.** La guía dice "se destruye si el impulso del impacto supera su
   umbral" (evento único). La implementación **acumula daño**: cada contacto por encima de
   `FORCE_FLOOR` resta vida, y la pieza se rompe cuando llega a cero. Es lo que permite
   mostrar el desgaste antes de romper, y lo que hace que dos tiros medianos sumen.
3. **Cámara.** La guía pide seguimiento del proyectil con zoom out. **No está
   implementado**: la vista es fija y sólo hay sacudida. El mundo de 1600×900 entra entero
   en pantalla, así que el proyectil nunca se pierde de vista; una cámara agregaría
   complejidad sin resolver un problema real. Si el proyecto destino agranda el mundo, ahí
   sí hace falta.
4. **Ralentí de 600 ms** al caer el último objetivo. **No está implementado**: en su lugar
   hay un banner de `¡Nivel limpio!` y 1500 ms de review antes del nivel siguiente.

---

# APÉNDICE E · Mapa del proyecto de origen

Si el proyecto destino prefiere copiar en vez de reescribir. Los de `core/` son genéricos:
sirven para cualquier juego 2D, no sólo para éste.

| Archivo | Qué es | ¿Portable tal cual? |
|---|---|---|
| `src/games/catapulta/levels.ts` | Los cinco niveles como datos + el formato editable (~200 líneas) | **Sí.** Sólo depende del tipo `SettingsRecord`. |
| `src/games/catapulta/logic.ts` | Reglas, armado, turno, puntaje (~480 líneas) | **Sí.** No importa Rapier ni React. |
| `src/games/catapulta/logic.test.ts` | Los 26 tests (~310 líneas) | **Sí.** Corren sin el motor de física. |
| `src/games/catapulta/settings.ts` | El schema, con los niveles como contenido editable | Sí, si el destino tiene un panel equivalente; si no, hardcodear los defaults. |
| `src/games/catapulta/CatapultaGame.tsx` | Carga del motor, mundo, escena, dibujo, HUD (~1265 líneas) | Depende del runtime, del `GameStage` y de la versión de Rapier del destino. |
| `src/core/engine/loop.ts` | Loop de paso fijo con render interpolado | **Sí**, tal cual. Es lo que alimenta a Rapier. |
| `src/core/engine/canvas.ts` | Escalado, DPR, letterbox, `toWorld` | **Sí**, tal cual. |
| `src/core/engine/input.ts` | Puntero, multitouch, swipe, teclado | **Sí**, tal cual. |
| `src/core/engine/rng.ts` | PRNG sembrado | **Sí**, tal cual. |
| `src/core/engine/pool.ts` | Object pool | **Sí**, tal cual. |
| `src/core/engine/palette.ts` | Tokens CSS cacheados, `mixHex`, `withAlpha` | Sí, cambiando la lista de tokens. |
| `src/core/engine/audio.ts` | WebAudio, seis voces sintetizadas, `vibrate` | **Sí**, tal cual. |
| `src/core/engine/useGameLifecycle.ts` | Fases, force-end, HUD, mute | Sí, si el destino usa React. |
| `src/core/engine/useGame2D.ts` | Une lo anterior: `init` / `update` / `draw` / `outcome` | Sí, si el destino usa React. |
| `src/ui/game/GameStage.tsx` | Canvas + HUD + los estados de partida | Reescribir con el design system del destino. |
| `src/styles/tokens.css` | Los tokens de color | Reemplazar por los del destino. |
| `vite.config.ts` | El chunk propio de Rapier y el límite de aviso de tamaño | Adaptar al bundler del destino. |
| `games-guide/M2-CATAPULTA.md` | La guía original | Referencia, con los desvíos del apéndice D. |

**Última advertencia.** Si el proyecto destino cambia la versión de Rapier, las densidades,
la gravedad o el `lengthUnit`, **hay que volver a medir `FORCE_FLOOR`**. Ese número es el
único del juego que no se puede derivar de las reglas: sale de observar qué fuerza apoya
una torre en reposo contra qué fuerza mete un impacto real. Si queda bajo, las estructuras
se autodestruyen solas antes del primer tiro; si queda alto, el proyectil rebota sin romper
nada.
