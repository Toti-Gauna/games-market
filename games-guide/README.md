# Parte 3 · Batería de juegos — catálogo y bases

24 juegos en 4 categorías, más las bases técnicas que comparten. La idea es tenerlos todos con
prompt listo, implementarlos por tandas, **probar, descartar y pulir**.

> Leé `docs/CONTRATO-JUEGOS.md` antes que nada. Define las tres topologías, `GameOutcome`, el
> ciclo de vida, los dos relojes, `GameNetPort` y la regla de oro: **un juego no sabe nada del
> tour**. Nada de acá lo contradice; esto lo extiende.

---

## Las bases primero

Ningún juego se empieza sin su base cerrada.

| Archivo | Qué sienta | Lo usan |
|---|---|---|
| `00-BASES-2D.md` | Loop de timestep fijo, canvas, input, sprites, cámara, audio, PRNG sembrado | 14 juegos |
| `01-BASES-3D.md` | Three.js + R3F, escena, loop, instancing, física 3D, LOD | 4 juegos |
| `02-BASES-NETCODE.md` | `GameNetPort`, proyector autoritativo, celular como control, predicción | 10 juegos |
| `03-BASES-CORPORATIVAS.md` | Motor de preguntas, tipos de ítem, corrección, agregación | 6 juegos |
| `04-BATERIA-DE-EXPERIENCIAS.md` | La sección del sidebar para probar todo suelto | — |

---

## Librerías recomendadas

El proyecto hoy tiene: React 19, Vite 6, TypeScript, `gsap` 3.15, `framer-motion`, `qrcode`,
`react-router-dom`. Todo lo de abajo es incremental y **cada juego carga sólo lo suyo** por
`import()` diferido, que es como ya funciona `GAME_REGISTRY`.

### Render 2D

| Librería | Cuándo | Por qué |
|---|---|---|
| **Canvas 2D nativo** | Pong, Serpiente, Flappy, Rompeladrillos, Tetris | Cero dependencias y sobra para geometría simple. No metas un motor donde alcanza un `fillRect` |
| **`pixi.js` v8** | Match-3, Invasores, Corredor, Ninja de frutas, Carreras | WebGL/WebGPU con batching automático. A partir de ~200 sprites móviles, Canvas 2D se cae y Pixi no |

**No** uses Pixi para todo. Un Pong en Pixi es 400 KB para dibujar tres rectángulos.

### Física 2D

| Librería | Cuándo |
|---|---|
| **`@dimforge/rapier2d-compat`** | Catapulta, Fútbol, Pool | Rust compilado a WASM. Rápido y **determinista**, que es lo que hace falta cuando dos máquinas simulan lo mismo |
| *(a mano)* | Pong, Rompeladrillos, Serpiente | Colisión AABB y rebote. Meter un motor de física acá es peor |

Matter.js es más fácil de arrancar pero no es determinista y no vale para netcode. Si algún juego
lo necesita, va en uno `solo` y nunca en `arena`.

### 3D

| Librería | Para qué |
|---|---|
| **`three`** | El motor |
| **`@react-three/fiber`** | Three declarativo en React. Es el puente que hace que un juego 3D sea un componente más |
| **`@react-three/drei`** | Helpers: cámaras, controles, `Instances`, `Html` |
| **`@react-three/rapier`** | Física 3D. Mismo motor que en 2D, misma determinismo |
| **`three-mesh-bvh`** | Raycast acelerado. **Obligatorio en el shooter**: sin BVH, cada disparo recorre toda la geometría |
| **`@react-three/postprocessing`** | Bloom y demás. Con cuidado: es lo primero que hay que apagar si no se llega a 60 fps |

### Netcode

| Opción | Cuándo | Notas |
|---|---|---|
| **BroadcastChannel** | Hoy, mock | Ya es el patrón del proyecto. Misma máquina, distintas pestañas. Sirve para desarrollar y para el ensayo de la Etapa 11 |
| **WebRTC DataChannel** (`peerjs` o a mano) | Producción de `gamepad` y `arena` | **Es la que recomiendo.** El contrato dice que el proyector es el host autoritativo; con WebRTC los celulares se conectan directo a él. Latencia mínima y **no hace falta servidor de juego**, sólo señalización |
| **`colyseus.js`** | Si en algún momento la autoridad tiene que ser del servidor | Rooms, sincronización por schema, reconexión. Es la opción correcta el día que haya backend y haga falta que la partida sobreviva a que el proyector se cierre |

WebSocket puro también sirve como relay, pero pasa todo por el servidor y suma un salto de
latencia que WebRTC evita.

### Input, audio y utilidades

| Librería | Para qué |
|---|---|
| **`nipplejs`** | Joystick virtual en el celular. 8 KB, resuelve bien el multitouch |
| **`howler.js`** | Audio. Sprites, y resuelve solo el desbloqueo de audio en iOS, que es un dolor conocido |
| **`zustand`** | Estado de HUD y menús. **Nunca** el estado del loop |
| **`miniplex`** | ECS mínimo en TS. Sólo para shooter, metaverso y fútbol; en los chicos es sobreingeniería |
| **`perfect-freehand`** | Trazo de Pinturillo. Convierte puntos en un contorno que se ve dibujado y no como una polilínea |
| **`stats.js`** / **`r3f-perf`** | FPS en desarrollo. Nunca en producción |

### Lo que NO hace falta

- **Ningún motor de juego completo** (Phaser, Babylon, PlayCanvas). Traen su propio loop, su
  propio sistema de escenas y su propio ciclo de vida, y acá el ciclo de vida lo manda
  `GameComponentProps`. Pelearían con React y con el contrato.
- **Redux o similar** para estado de juego. El loop corre a 60 fps: cualquier cosa que dispare un
  render de React por frame es el problema, no la solución.
- **Librería de tweening extra.** `gsap` ya está.

---

## Los 24 juegos

Columnas: **T** = topología (`solo` / `gamepad` / `arena`) · **QR** = cuántos escanea el
proyector · **Base** = qué prompt fundacional necesita · **Esf.** = esfuerzo relativo (S/M/L/XL).

### Retro

| # | Juego | T | QR | Base | Esf. | Idea |
|---|---|---|---|---|---|---|
| R1 | **Pong Supernova** | gamepad | 2 | 2D + net | M | Dos celulares son las paletas, el proyector es la cancha. Ya tiene prompt en `docs/fase-3/R1-PONG.md` |
| R2 | **Carreras** | solo | 1 | 2D + WebGL | L | Perspectiva Mode 7 tipo Mario Kart. **Sin red**: cada uno corre en su celular, comparados por el ranking |
| R3 | **Serpiente** | solo | 1 | 2D | S | Snake. Comés principios de la cultura y crecés; chocarte es el burnout. Deslizás para girar |
| R4 | **Invasores** | gamepad | 1–4 | 2D + net | M | Space Invaders cooperativo: hasta 4 celulares son cañones en la misma pantalla, y la horda es común |
| R5 | **Rompeladrillos** | gamepad | 2 | 2D + net | M | Breakout con **una paleta partida en dos**: cada celular controla una mitad y hay que coordinarse |
| R6 | **Tetris duelo** | gamepad | 2 | 2D + net | L | Dos tableros lado a lado en el proyector. Las líneas que hacés le mandan basura al otro |

### Moderno

| # | Juego | T | QR | Base | Esf. | Idea |
|---|---|---|---|---|---|---|
| M1 | **Match-3** | solo | 1 | 2D + Pixi | L | Estilo Candy Crush. **Todos juegan el mismo tablero con la misma semilla** y compiten por puntaje: mismo desafío, sin red |
| M2 | **Catapulta** | solo | 1 | 2D + física | M | Angry Birds. Tres tiros por nivel, estructuras que se derrumban. La física vende sola |
| M3 | **Flappy** | solo | 1 | 2D | S | Flappy Bird. Arranca `solo`; cuando exista la base de red se le suman las **siluetas de los demás** volando en la misma pantalla |
| M4 | **Saltarín** | solo | 1 | 2D | M | Doodle Jump con **inclinación del teléfono**. El giroscopio hace que se sienta distinto a todo lo demás |
| M5 | **Ninja de frutas** | solo | 1 | 2D + Pixi | M | Fruit Ninja. Deslizás para cortar; las bombas terminan la partida. Partículas a full |
| M6 | **Corredor infinito** | arena | 1 | 2D + Pixi | L | Runner lateral con obstáculos. Ranking por distancia. Ves fantasmas de los demás |

### Corporativo

| # | Juego | T | QR | Base | Esf. | Idea |
|---|---|---|---|---|---|---|
| C1 | **Trivia relámpago** | arena | 1 | Corp + net | M | Kahoot. La pregunta va en el proyector, las opciones en el celular, puntos por acierto **y por velocidad** |
| C2 | **Test de perfil** | solo | 1 | Corp | S | Cuestionario que devuelve un arquetipo. El proyector muestra la distribución del equipo |
| C3 | **Formulario vivo** | solo | 1 | Corp | S | Encuesta con progreso y micro-recompensas. Sin puntaje: el outcome es la respuesta |
| C4 | **Memoria de valores** | solo | 1 | Corp | — | **Ya existe**: `principios-culturales`. Se recategoriza y se le pasa el sistema visual |
| C5 | **Prioridades** | solo | 1 | Corp | M | Ordenás 8 tarjetas por importancia arrastrando. El proyector muestra el consenso del equipo |
| C6 | **Verdadero o falso** | arena | 1 | Corp + net | S | Ronda rápida, 10 afirmaciones, 5 segundos cada una. Muerte súbita |

### Creativos / 3D

| # | Juego | T | QR | Base | Esf. | Idea |
|---|---|---|---|---|---|---|
| X1 | **Pinturillo** | arena | 1 | 2D + net | L | Skribbl. Uno dibuja en su celular, se ve en el proyector, los demás adivinan. **El más social de los 24** |
| X2 | **Pool** | gamepad | 2 | 3D + física | L | Billar. Apuntás con el celular como si fuera el taco, la mesa está en el proyector |
| X3 | **Ludo** | arena | 1 | 2D | M | Parchís de 4. Por turnos, así que la latencia no importa: es el multijugador más barato de los 24 |
| X4 | **Shooter 3D** | arena | 1 | 3D + net | XL | Battle royale de 10, geometría desde cero. Ya tiene prompt en `docs/fase-3/X4-SHOOTER-3D.md` |
| X5 | **Metaverso** | arena | 1 | 3D + net | XL | Espacio 3D recorrible con avatares, para recorrer libremente. Sin objetivo: es un lobby con cuerpo |
| X6 | **Fútbol** | arena | 1 | 2D + física + net | L | Haxball. Ya tiene prompt en `docs/fase-3/X6-FUTBOL.md` |

**Cuatro ya tienen prompt** (R1, R2, X4, X6) de una tanda anterior. Hay que **actualizarlos** para
que hereden el sistema de diseño de la Parte 1 y estas bases, en vez de definir lo suyo.

---

## Extensión del registry

La Etapa 09 de la Parte 2 ya agrega a `GameEntry`: `category`, `status`, `enabled`,
`estimatedMin` y `tags`. La Parte 3 suma lo que hace falta para 24 juegos:

```ts
// src/core/tour/game.types.ts
export type GameEngine = "canvas2d" | "pixi" | "r3f" | "dom";

type GameEntryBase = {
  … // lo de hoy + lo de la Etapa 09
  engine: GameEngine;
  /** true si necesita GameNetPort. Los `solo` casi nunca. */
  needsNet: boolean;
  /** Rango de jugadores por partida compartida (gamepad/arena). */
  minPlayers: number;
  maxPlayers: number;
  /** Sensores que pide. El catálogo avisa si el dispositivo no los tiene. */
  inputs: Array<"touch" | "tilt" | "swipe" | "keyboard">;
};
```

**`enabled: false` por defecto en todo lo multijugador.** Es lo que pediste: los juegos de red
llegan apagados y se prenden cuando se usan en un tour o en una prueba. Un juego apagado se ve
en el catálogo y se puede probar, pero no aparece en el inspector del editor.

---

## Orden sugerido

Por dependencia y por retorno, no por categoría:

| Tanda | Qué | Por qué |
|---|---|---|
| **1 · Bases** | `00-BASES-2D` + `03-BASES-CORPORATIVAS` | Sin ellas no se puede empezar nada. Y las corporativas son las que un cliente pide primero |
| **2 · Rápidos `solo`** | R3 Serpiente, M3 Flappy, C2 Test, C3 Formulario | Cuatro juegos jugables sin tocar red. Validan la base 2D y la corporativa con esfuerzo bajo |
| **3 · Netcode** | `02-BASES-NETCODE` + R1 Pong | Pong es el caso más simple de `gamepad` y es la mejor prueba de la base de red: dos celulares, una pantalla |
| **4 · Corporativos en red** | C1 Trivia, C6 Verdadero o falso | El mayor valor real para un evento de empresa |
| **5 · Modernos** | M2 Catapulta, M4 Saltarín, M5 Ninja, M1 Match-3 | Los que se ven bien en una demo. **Los cuatro son `solo`**: no dependen de la tanda 3 |
| **6 · Retro que faltan** | R4 Invasores, R5 Rompeladrillos, R6 Tetris | Más red, más complejos |
| **7 · Sociales** | X1 Pinturillo, X3 Ludo, C5 Prioridades | Pinturillo es el que más se disfruta en grupo |
| **8 · 3D** | `01-BASES-3D` + X2 Pool, X4 Shooter, X5 Metaverso | Los más caros. Van al final a propósito |
| **9 · Cierre** | M6 Corredor, C4 Memoria, R2 Carreras, X6 Fútbol | Los dos últimos juegos nuevos y la actualización de los prompts viejos |

**Se puede parar en cualquier tanda y el producto sirve.** Después de la 2 ya hay cuatro juegos;
después de la 4, un evento corporativo completo.

---

## Reglas que valen para los 24

Además de todo `docs/CONTRATO-JUEGOS.md`:

- **Un juego no importa nada de `core/tour/`** salvo sus propios tipos. Regla de oro del contrato.
- **Timestep fijo** `1/60` con acumulador, render interpolado. Nunca simular con delta variable.
- **Cero asignaciones en el loop.** Pools para balas, partículas y vectores.
- `devicePixelRatio` topeado: **2 en proyector, 1.5 en celular**.
- El loop se pausa con `document.hidden`.
- Colores desde los tokens, leídos una vez con `getComputedStyle` y cacheados. **Nunca hex
  hardcodeado** (`AGENTS.md`).
- `prefers-reduced-motion` saca screen shake, destellos y post-proceso; el juego sigue jugable.
- Todo juego responde a `force-end` emitiendo su outcome parcial **en el acto**.
- El PRNG se siembra con `config.seed`. `Math.random()` y `gsap.utils.random()` **no aceptan
  semilla**: usar el `seededRandom` compartido.
- Cada juego declara su presupuesto de frame y qué baja si no llega.

---

## Prompts escritos

| Prompt | Juego | Tanda | Estado |
|---|---|---|---|
| `R3-SERPIENTE.md` | Serpiente | 2 | Listo |
| `M3-FLAPPY.md` | Vuelo | 2 | Listo |
| `C2-TEST-DE-PERFIL.md` | ¿Cómo trabajás? | 2 | Listo |
| `C3-FORMULARIO-VIVO.md` | Pulso del equipo | 2 | Listo |
| `C1-TRIVIA-RELAMPAGO.md` | Trivia relámpago | 4 | Listo |
| `C6-VERDADERO-O-FALSO.md` | Verdadero o falso | 4 | Listo |
| `M2-CATAPULTA.md` | Catapulta | 5 | Listo |
| `M4-SALTARIN.md` | Saltarín | 5 | Listo |
| `M5-NINJA.md` | Ninja | 5 | Listo |
| `M1-MATCH3.md` | Combinaciones | 5 | Listo |
| `M6-CORREDOR.md` | Corredor | 9 | Listo |
| `C4-MEMORIA.md` | Memoria de valores | 9 | Listo · integración |
| `R4-INVASORES.md` | Invasores | 6 | Listo |
| `R5-ROMPELADRILLOS.md` | Rompeladrillos | 6 | Listo |
| `R6-TETRIS-DUELO.md` | Tetris duelo | 6 | Listo |
| `X1-PINTURILLO.md` | Pinturillo | 7 | Listo |
| `X3-LUDO.md` | Ludo | 7 | Listo |
| `C5-PRIORIDADES.md` | Prioridades | 7 | Listo |
| `X2-POOL.md` | Pool | 8 | Listo |
| `X5-METAVERSO.md` | Espacio | 8 | Listo |
| `R1-PONG.md` | Supernova Pong | 3 | Listo · actualizado |
| `R2-CARRERAS.md` | Supernova Rush | 9 | Listo · actualizado |
| `X4-SHOOTER-3D.md` | Supernova Arena | 8 | Listo · actualizado |
| `X6-FUTBOL.md` | Supernova Fútbol | 9 | Listo · actualizado |

Los cuatro heredados son de una tanda anterior a las fases 1 y 2: hay que actualizarlos para que
hereden el sistema de diseño, la capa de motion y estas bases, en vez de definir lo suyo.
