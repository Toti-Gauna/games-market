# Bubble shooter game — cómo usar estos prompts

Rediseño y ampliación de **X4 · Supernova Arena** (`src/games/shooter/`) hacia un battle royale de mundo abierto: montañas, pasto, atardecer, un auto manejable, pistolas de agua, cofres con armas, dificultad elegible, una pantalla de inicio con nombre y skin, y una entrada propia a pantalla completa, sin el banco de pruebas alrededor.

Este archivo **no implementa nada**: es el índice y la referencia compartida de la carpeta. Los archivos `PROMPT-*.md` de al lado sí son para pegar, tal cual, en una sesión de IA. Cada uno es autocontenido (repite las reglas del repo y recapitula qué asume que ya existe) para que se pueda dar de a uno, en sesiones separadas, sin que quien lo ejecute haya visto los anteriores.

## Orden

1. **`PROMPT-A-mundo-abierto-vehiculo-y-cofres.md`** — para **Fable 5**. Es la parte más cara: terreno, auto, armas y cofres a la vez, porque están entrelazados entre sí. Todo lo demás depende de que esto quede sólido.
2. **`PROMPT-B-pantalla-de-inicio-nombre-y-skin.md`** — para **Opus 5**. Depende de A (usa la codificación de escalares que A deja armada).
3. **`PROMPT-C-atardecer-texturas-y-agua.md`** — para **Opus 5**. Depende de A y B.
4. **`PROMPT-D-botin-hud-y-minimapa.md`** — para **Opus 5**. Depende de A (usa la tabla de armas y los cofres).
5. **`PROMPT-E-bots-rendimiento-y-documentacion.md`** — para **Opus 5**. Es el cierre: revisa todo el conjunto, no solo agrega.
6. **`PROMPT-F-pagina-propia-y-pantalla-completa.md`** — para **Opus 5**. Es **independiente** de los otros cinco: es ruteo e interfaz, no toca la simulación del juego. Se puede correr en cualquier momento de la cadena, incluso antes que el A, si preferís tener la experiencia de pantalla completa lista cuanto antes. Va último en esta lista porque fue lo último que se pidió, no porque dependa de algo.

Cada prompt trae su propio checklist de verificación (`tsc`, `eslint`, la suite completa de tests, `vite build`) y no se da por terminado hasta que los cuatro pasan.

---

## Decisiones de diseño (ya tomadas — están repetidas dentro de cada prompt donde aplican, esto es la referencia rápida)

- **Las pistolas de agua siguen resolviéndose por hitscan con compensación de latencia**, no por proyectiles simulados en red. El disparo se **dibuja** arqueado (parábola + salpicadura), pero el impacto se decide en el instante del disparo, como hoy.
- **Sin texturas fotográficas.** Pasto y roca se resuelven con shaders procedurales y el sombreado horneado por vértice que ya existe (`boxShaded`), no con imágenes.
- **El terreno es una función de altura continua**, no una grilla de bloques planos. Las plataformas y rampas rectangulares actuales se eliminan; las montañas cumplen ese rol.
- **Las montañas son estructuras puntuales** (posición, radio y altura propios), no ruido por todos lados. La cobertura chica actual se resignifica como rocas/peñascos dispersos, sigue siendo instanciada.
- **El auto es uno solo, con física de arcade**, sin daño ni destrucción. Los bots no manejan en el alcance base — queda opcional para el último prompt.
- **Las skins son un color, no una malla nueva**: reusan la paleta de colores por asiento que ya existe (`SEAT_TOKENS`).
- **El botín de los cofres se decide en la generación del mapa**, con la semilla, no al abrirlos. Solo el bit de "abierto o no" viaja por red.
- **El nombre del juego cambia a "Bubble Shooter Game"** en el catálogo, código `X4` intacto.
- **La cantidad de jugadores no cambia**: siguen siendo 10 asientos.

## Mapa del código (para no perder tiempo redescubriéndolo)

```
src/games/shooter/
  map.ts          → genera el mapa por semilla: tamaño, cobertura, plataformas, rampas, anillo, apariciones
  logic.ts        → la simulación pura (sin React/three/red): cuerpos, disparo, anillo, snapshot, bots
  logic.test.ts   → vitest sobre logic.ts, con helpers (freshWorld, place, humanInput, yawTowards, skipDeploy)
  view.ts         → el estado tal como se DIBUJA: predicción del cliente, espejo local del host-jugador, efectos
  ShooterScene.tsx→ adentro del <Canvas> de R3F: instancing, cámara, shaders
  ShooterGame.tsx → afuera del canvas: red (useGameNet), HUD en DOM, ciclo de vida, overlay táctil
  settings.ts     → Administrables (aparecen en la pestaña "Administrables" del banco de pruebas)

src/core/engine3d/  → motor 3D compartido por TODOS los juegos 3D (shooter y metaverso, por ahora)
  Stage.tsx         → <Canvas> de R3F + HUD en DOM (GameStage). No tocar salvo que haga falta un prop nuevo.
  instancing.ts     → createInstanceWriter: UN draw call por familia de objetos. Es la regla de oro del catálogo.
  geometry.ts       → primitivas compartidas y cacheadas (getGeometry). boxShaded ya tiene sombreado horneado.
  materials.ts      → getMaterial/getColor: SOLO leen colores de tokens.css, nunca hex sueltos en el código.
  shaders.ts        → getSkyMaterial, getGridFloorMaterial, getRingMaterial: ShaderMaterial cacheados.
  useFixedStep.ts   → paso fijo (1/60) para la simulación.
  perf.ts / lod.ts  → guardia de rendimiento y niveles de detalle.

src/core/net/       → red compartida: useGameNet, snapshot.ts (NetSnapshot: hasta 255 entidades, 16 escalares
                       int32), prediction.ts (createPrediction), interpolation.ts.
src/core/contract/  → game.ts (GameRuntimeConfig/GameProps), gameNet.ts (NetPlayer, GameNetPort),
                       settings.ts (SettingsSchema), catalog.ts (GameEntry, opensInTab, phoneRoleOf).
src/styles/tokens.css      → única fuente de color. Agregar tokens acá, nunca hex en el código del juego.
src/core/engine/palette.ts → TOKENS: el array que declara qué variables de tokens.css existen como PaletteToken.
src/ui/game/TouchSticks.tsx / sticks.ts → sticks táctiles COMPARTIDOS por shooter y metaverso. Un botón
                       contextual nuevo ("Subir al auto", "Abrir cofre") se arma en el overlay de
                       ShooterGame.tsx, no en este archivo compartido.
src/routes/GameLabPage.tsx → el banco de pruebas: sidebar, pestañas Partida/Administrables/Resultado, sliders.
src/routes/KioskPage.tsx   → un juego SIN sidebar ni pestañas, a pantalla completa. Es el modelo del Prompt F.
src/App.tsx                → el router. /quiosco y /control/:sala están fuera del AppShell (sin sidebar).
games-guide/X4-SHOOTER-3D.md → la guía de diseño original. Quedará desactualizada; el prompt E la reescribe.
```

## Reglas del repo (universales — cada prompt las repite, no hace falta que vengas a buscarlas acá)

- **Nunca importar `@react-three/drei`**: su copia de `three-mesh-bvh` (0.8.x) choca con la del proyecto (0.9.14) y rompe `tsc -b` en `src/core/engine3d/bvh.ts`.
- Cero asignaciones en el loop de simulación de `logic.ts`.
- Un draw call por familia de objetos repetidos (`createInstanceWriter`).
- Colores solo desde `tokens.css` vía `getColor`/`getMaterial`.
- Comentarios de código en español, sin tildes.
- Verificación completa antes de cerrar cualquier prompt: `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (suite entera), `npx vite build`.
