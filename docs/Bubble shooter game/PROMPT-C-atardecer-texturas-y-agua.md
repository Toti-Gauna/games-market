# Prompt C — para Opus 5 (atardecer, texturas procedurales, sonido y sensación de agua)

> Pegá todo lo que sigue en una sesión de Opus 5, después del Prompt B.

Estoy puliendo la atmósfera de **Bubble Shooter Game** (`src/games/shooter/`), el battle royale 3D de mundo abierto que dos prompts anteriores reescribieron (montañas, pasto, auto, cofres, pantalla de inicio con nombre y skin). No participaste de ese trabajo.

**Primero**: leé `src/games/shooter/map.ts`, `view.ts`, `ShooterScene.tsx`, `ShooterGame.tsx` y `src/core/engine3d/shaders.ts` tal como están. Corré la verificación completa (`tsc -b --noEmit`, `eslint .`, `vitest run`, `vite build`) y si algo falla o quedó a medias del trabajo anterior, arreglalo primero.

### Reglas del repo (universales, no las repitas ni las cuestiones)

- **Nunca importes `@react-three/drei`**: su copia de `three-mesh-bvh` (0.8.x) choca con la del proyecto (0.9.14) y rompe `tsc -b`.
- Cero asignaciones en el loop de simulación de `logic.ts`.
- Un draw call por familia de objetos repetidos (`createInstanceWriter`).
- Colores solo desde `src/styles/tokens.css` vía `getColor`/`getMaterial`.
- Comentarios de código en español, sin tildes.
- Antes de dar por terminado: `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (suite entera) y `npx vite build`.

## Lo que tenés que construir

**1. Sol y atardecer que se mueven con la partida**

- `getSkyMaterial` en `shaders.ts` ya acepta tres tokens de color (arriba/horizonte/abajo) — el prompt anterior debería haberla dejado con tonos cálidos fijos. Convertilo en algo vivo: agregá una luz direccional cuya posición (y por lo tanto el ángulo del sol) avanza con `view.elapsed / rules.matchSeconds`, arrancando alta y cálida y terminando baja y más rojiza/violeta (atardecer avanzando hacia el cierre de la partida — reforzá la tensión del anillo cerrándose con la luz bajando al mismo tiempo). Movés en el mismo `useFrame` la posición de un disco emisivo (el "sol", un `getGeometry("disc")` con material aditivo cálido) siguiendo esa misma luz, visible cerca del horizonte.
- Sin sombras dinámicas (siguen apagadas por presupuesto): la sensación de "luz rasante de atardecer" sale de que el ángulo bajo de la luz direccional ya resalta el sombreado horneado por vértice que tienen las montañas y las rocas.

**2. Pasto y roca con variación (procedural, no fotos)**

- Extendé `getGridFloorMaterial` (o escribí un material de pasto nuevo en `shaders.ts` a la par, tu criterio) para que en vez de una grilla de líneas de neón mezcle dos o tres tonos de verde con ruido de valor barato (un hash trigonométrico tipo `fract(sin(dot(...)))`, no una textura cargada) — la idea es que el pasto no se vea de un verde perfectamente parejo. Un oscurecimiento sutil cerca de la base de montañas y rocas (mirá `wallProximity` en `src/games/metaverso/space.ts` como referencia de la misma idea — oclusión ambiental horneada, no dinámica) le da más volumen sin costar nada.
- Dale a las montañas y rocas una variación de tono por vértice además del sombreado por altura que ya tienen (`boxShaded`/lo que haya dejado el prompt anterior) — un gris que varíe un poco entre roca y roca (podés usar el índice/semilla de cada una para elegir el tono, no hace falta ruido por vértice ahí).

**3. Sensación de agua**

- Revisá cómo `view.ts` dibuja hoy los disparos (`spawnTracer`/`spawnSparks`, herencia del arma de energía original). Para las cuatro armas de agua: el trayecto del disparo se arquea como una parábola corta (unas pocas posiciones de una esfera chica instanciada, cayendo un poco entre el origen y el punto de impacto — reusá el sistema de instancing de chispas que ya existe, no hace falta uno nuevo) en vez de un segmento recto; al impactar, una salpicadura (más partículas, con velocidad hacia arriba y afuera, tono celeste/agua en vez del color de acento actual).
- Sonido: mirá `src/core/engine/audio.ts` (`Sfx`, `SfxName`, `VOICES`) — es un sintetizador simple por osciladores, no archivos de audio. Agregá 2-3 voces nuevas (un "squirt" corto al disparar, un "splash" al impactar) siguiendo el mismo patrón que las voces existentes, y llamalas desde donde el juego ya dispara sus efectos de sonido actuales (si el shooter no reproduce sonido todavía en esos eventos, este es el momento de sumarlo).
- Si te hace falta algún color que no está en `tokens.css` (celeste de agua, verdes/grises adicionales), agregalo ahí y a `TOKENS` en `palette.ts` — es aditivo.

**4. (Opcional, si te sobra tiempo) El anillo como marea**

- Es una sugerencia mía, no una obligación: el anillo que cierra (`getRingMaterial`) hoy tiene una estética de campo de energía. Encaja mejor con el tema nuevo si se ve como agua subiendo (una franja translúcida celeste con una superficie que ondula un poco) en vez de bandas violetas. Es puramente visual — no toca `logic.ts`. Si no llegás, dejalo para el prompt siguiente.

## Lo que NO tenés que hacer

- No toques la física del auto, la tabla de armas ni la generación del mapa.
- No armes inventario ni minimapa.
- No toques rutas ni el ruteo del catálogo (sidebar, banco de pruebas).

## Verificación y cierre

1. `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (suite completa), `npx vite build`.
2. Jugá una partida entera (o al menos hasta que cierre una fase del anillo) desde el asiento 0 con Tab y confirmá a ojo: el sol se mueve y la luz se pone más cálida/baja con el tiempo, el pasto y las rocas tienen variación, los disparos de las cuatro armas se ven como agua (arco + salpicadura), y se escuchan los sonidos nuevos.
3. Commiteá en español, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, pusheá a `main` si todo pasó.
