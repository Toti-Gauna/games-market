# Prompt A — para Fable 5 (mundo abierto, auto y cofres)

> Pegá todo lo que sigue, tal cual, en una sesión de Fable 5 dentro de este repo.

Estoy rediseñando **X4 · Supernova Arena**, un battle royale 3D en `src/games/shooter/` (React Three Fiber, host autoritativo, hasta 10 jugadores), hacia un juego de mundo abierto llamado **Bubble Shooter Game**: montañas y pasto en vez de plataformas de neón, atardecer en vez de cielo sci-fi, pistolas de agua en vez de armas de energía, y un auto manejable. Es la reescritura más grande que va a tener este juego. Sos la primera de varias sesiones que van a trabajar sobre esto — las siguientes (de Opus 5) van a agregar la pantalla de inicio, el pulido visual y la interfaz de botín sobre lo que vos dejes, así que la base tiene que quedar sólida y sin cabos sueltos.

Antes de tocar nada, leé:

- `src/games/shooter/map.ts`, `logic.ts`, `logic.test.ts`, `view.ts`, `ShooterScene.tsx`, `ShooterGame.tsx`, `settings.ts` — es el juego completo tal como está hoy (battle royale de arena cerrada, ya jugable, con hitscan, compensación de latencia, anillo que cierra, bots, predicción en el celular).
- `src/core/engine3d/` completo (motor 3D compartido con `src/games/metaverso/`).
- `src/core/net/snapshot.ts`, `prediction.ts` — el protocolo de red: `NetSnapshot` tiene hasta 255 "entidades" (`{id, x, y, vx, vy, angle, flags}`, `flags` es UN byte) y hasta 16 "escalares" (cada uno un `int32`). El shooter hoy usa 10 entidades (una por asiento) y 12 escalares de los 16 disponibles.
- `src/styles/tokens.css` y `src/core/engine/palette.ts` — de acá salen TODOS los colores. Nunca hex sueltos en el código del juego.
- `games-guide/X4-SHOOTER-3D.md` — la guía de diseño original. Vas a dejarla desactualizada a propósito; no hace falta que la reescribas (eso lo hace un prompt posterior), pero no la contradigas sin necesidad en las partes que sigan aplicando (presupuesto de rendimiento, convenciones de cámara).

### Reglas del repo (universales, no las repitas ni las cuestiones)

- **Nunca importes `@react-three/drei`**: su copia de `three-mesh-bvh` (0.8.x) choca con la del proyecto (0.9.14) y rompe `tsc -b` en `src/core/engine3d/bvh.ts`. Para texto anclado al mundo, proyectá con `Vector3.project(camera)` y posicioná un `<div>` desde afuera del canvas — hay un ejemplo funcionando en `src/games/metaverso/SpaceScene.tsx` (`projectLabel`) y `MetaversoGame.tsx` (`Labels`).
- Cero asignaciones en el loop de simulación de `logic.ts`: todo en `Float32Array`/`Int32Array`/`Uint8Array` indexado por asiento.
- Un draw call por familia de objetos repetidos: `createInstanceWriter` (`src/core/engine3d/instancing.ts`), nunca N `<mesh>` sueltos.
- Colores solo desde `src/styles/tokens.css` vía `getColor`/`getMaterial` (`src/core/engine3d/materials.ts`). Si un color no está ahí, agregalo — es aditivo y no rompe otros juegos.
- Comentarios de código en español, sin tildes.
- Antes de dar por terminado: `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (la suite ENTERA — hoy ronda 787 tests en 39 archivos, no solo `src/games/shooter`, porque el motor 3D y la red son compartidos con `src/games/metaverso/` y el resto del catálogo) y `npx vite build`. Los cuatro en verde, siempre.

## Lo que tenés que construir

**1. Terreno: montañas y pasto, mapa mucho más grande**

- Subí `MAP_SIZE` de 80 a **200**. Escalá proporcionalmente `MIN_SPAWN_DISTANCE` (15 → ~35), `RING_START_RADIUS` (57 → ~140, mantiene la misma fracción de la diagonal) y las fracciones de `RING_SCHEDULE` (dejalas como fracciones del radio inicial, no cambian). Subí `MATCH_SECONDS` de 240 a 300 y reescalá los `at` de `RING_SCHEDULE` proporcionalmente a la nueva duración.
- **Eliminá** las dos plataformas rectangulares elevadas y sus rampas. En su lugar, `createShooterMap` genera **entre 5 y 9 montañas**: cada una con `{x, z, radius, height}` sacados del `Rng` de la semilla, repartidas con la misma técnica de muestreo por rechazo que ya usa `placeSpawns`/`placeCover` (mínima separación entre sí, lejos de las apariciones). Una de ellas —la más alta, aproximadamente central— cumple el rol que hoy cumple `landmark` (referencia visual para no perderse); podés conservar el campo `landmark` apuntando a esa montaña o reemplazarlo, tu criterio, pero mantené la idea de "un punto alto central para orientarse".
- Agregá una función de altura de terreno: `terrainHeight(map: ShooterMap, x: number, z: number): number`. Cada montaña aporta una campana suave (por ejemplo `height * smoothstep` sobre `1 - distancia/radius`, en 0 fuera del radio); sumá las contribuciones que se solapen. Encima de eso, sumá una ondulación suave de baja amplitud (±0.5, uno o dos octavos de ruido de valor determinístico con el mismo `Rng`) para que el pasto entre montañas no sea perfectamente plano. Esta función reemplaza al `0` implícito que hoy asume el piso: `groundHeight` en `logic.ts` tiene que consultarla para cualquier punto que no esté sobre cobertura/rampa (ya no hay rampas, así que en la práctica `groundHeight` pasa a ser básicamente `terrainHeight` más lo que siga haciendo falta para la cobertura chica).
- Las laderas empinadas de una montaña **no se caminan**: reusá el mismo criterio de pendiente máxima que hoy resuelven las rampas (mirá `STEP_UP` y la lógica de `rampHeight`/empuje horizontal) generalizado a la pendiente local de `terrainHeight`. Una montaña sigue siendo cobertura y altura táctica, no una pared invisible ni una rampa infinita.
- La cobertura chica actual (las cajas de `COVER_SIZES`) se conserva como sistema (sigue siendo instanciada, sigue evitando el hito/apariciones/montañas con el mismo criterio de `placeCover`), pero se resignifica visualmente como rocas — el cambio de color y forma es trabajo de un prompt posterior, vos solo asegurate de que `placeCover` siga funcionando sobre el terreno nuevo (nada de cobertura enterrada en una montaña ni flotando sobre el pasto: la `y` de cada roca tiene que apoyarse en `terrainHeight` en su posición, no asumir `y = size.h/2` sobre un piso plano).
- Sumá `MAX_MOUNTAINS`, ajustá capacidades de `InstanceWriter` que dependan del conteo de cobertura (subí `COVER_MIN`/`COVER_MAX` proporcionalmente al área nueva, algo así como 55–80, y la capacidad del `InstanceWriter` de cobertura en `ShooterScene.tsx` a juego).
- Actualizá el chequeo de rango de la niebla, el plano lejano de la cámara (`camera.far` en el `<Stage>` de `ShooterGame.tsx`, hoy 260) y el radio máximo de la cámara aérea del espectador en `ShooterScene.tsx` (`driveCamera`, hoy tope `Math.min(54, ...)`) para que tengan sentido en un mapa de 200 unidades de lado. No hace falta que sea perfecto, sí que nada se vea cortado ni perdido en niebla a mitad del mapa nuevo.

**2. El auto**

- Un solo tipo de vehículo, física de arcade (no suspensión real, no destructible, no le hace daño a nadie por atropello en esta etapa — dejalo anotado como pendiente si querés, pero no lo implementes). Entre 2 y 4 autos, posiciones generadas por semilla lejos de laderas empinadas.
- Estado por auto: `{x, z, yaw, speed}`. Adelante/atrás acelera `speed` (con fricción); el giro escala con `speed` (no gira en el lugar). Sigue el terreno con `terrainHeight` para la altura; el pitch/roll visual por pendiente es opcional, no es requisito.
- Un asiento puede estar caminando o manejando. Cuando maneja, **reinterpretá** el mismo `ShooterInput` que ya existe: `my` es acelerador/freno, `mx` es volante — no agregues un tipo de input nuevo. En `stepWorld`, si el asiento está en un auto, ese paso llama a una función `stepVehicle` en vez de `simulateBody`.
- Subir/bajar: proximidad al auto (vacío) + una señal de "interactuar" en el input (agregá un campo `interact: boolean` a `ShooterInput`, es un flanco como `jump`). El auto queda "tomado" por ese asiento hasta que se baje (misma señal). Solo lo puede tomar quien esté vacío de auto y el auto esté libre.
- Colisión del auto: contra el borde del mapa y contra el pie de las montañas (una montaña bloquea igual que hoy bloquea un bloque de cobertura — no hace falta que sea más sofisticado que un círculo por montaña).
- Cámara en tercera persona detrás del auto mientras se maneja: es un tercer modo de cámara en `driveCamera` (`ShooterScene.tsx`), junto a los que ya existen `"fpv"`/`"spectator"`.
- Red: los autos viajan en el mismo `NetSnapshot` que los jugadores, como entidades extra con `id` por encima de `MAX_PLAYERS` (por ejemplo 16 a 19 para hasta 4 autos). Subí `ENTITY_COUNT` de 10 a 10 + la cantidad de autos. `flags` de la entidad-auto codifica quién lo maneja (0 = libre, asiento+1 si no). Actualizá `createMutableSnapshot`, `writeSnapshot`/lectura del lado cliente, y los tests de snapshot.

**3. Cofres y armas de agua**

- Reemplazá el arma única actual por una tabla de armas (`WeaponKind`), todas "de agua": `pistola` (la inicial, con la que todos aparecen), `aspersor` (spray corto alcance, multi-rayo), `manguera` (cadencia alta, dispersión que crece con el disparo sostenido — reusá el campo `spread` que ya existe en `ShooterWorld`) y `cañon` (una sola bala fuerte, cadencia lenta). Puntos de partida razonables (ajustables después):

  | Arma | Cadencia | Cargador | Recarga | Daño cuerpo | Daño cabeza | Alcance máx. |
  |---|---|---|---|---|---|---|
  | Pistola (inicial) | 0.15 s | 20 | 1.2 s | 25 | 45 | 22 |
  | Aspersor | 0.55 s | 6 | 1.6 s | ~14 por perdigón (5 rayos) | igual | 10 |
  | Manguera | 0.07 s | 40 | 1.8 s | 10 | 18 | 26 |
  | Cañón | 1.1 s | 4 | 2.2 s | 45 | 100 | 40 |

  Más allá de esos 30 unidades de alcance, el daño cae linealmente hasta 0 en el máximo (agregalo a `fireHitscan`, no existe hoy). Todos disparan por el mismo hitscan con compensación de latencia que ya existe; el aspersor tira varios rayos en un cono en el mismo paso.
- Cada asiento carga qué arma tiene (`world.weapon: Uint8Array`, índice a la tabla) y su munición/cargador/recarga pasan a depender del arma actual en vez de una regla global fija. El slider `botDifficulty` ya existente sigue aplicando su multiplicador de puntería/gatillo sobre cualquier arma que el bot tenga en mano.
- **Cofres**: entre 16 y 20, posiciones por semilla (lejos de apariciones, cerca de montañas/puntos de interés, con la misma técnica de rechazo). El arma que da cada cofre se asigna **en la generación del mapa**, con el `Rng` de la semilla — nunca al abrirlo. Lo único que viaja por red es si ya se abrió: un solo `int32` (escalar nuevo `S_CHESTS_OPENED`) alcanza y sobra como máscara de bits para hasta 32 cofres.
- Abrir: proximidad + la misma señal `interact` que sube al auto (si hay un auto Y un cofre cerca a la vez, priorizá el cofre — es la interacción más específica). Es host-autoritativo: el host es quien decide qué asiento lo abrió primero.
- Todos aparecen con `pistola`. Las otras tres armas solo se consiguen en cofres.

**4. Esqueleto de sol/atardecer y pasto (dejalo funcional, el pulido fino es de otro prompt)**

No hace falta que quede hermoso — eso es explícitamente el trabajo de un prompt posterior — pero si dejás la escena con el cielo/piso de neón actual, cada prompt siguiente tiene que pisar tu código de terreno para poder ver algo razonable, y eso es doble trabajo. Dejá funcionando:

- El piso ya no es la grilla de neón (`getGridFloorMaterial`): es una malla que sigue `terrainHeight` (o un plano suficientemente subdividido si preferís desplazar vértices en el shader — tu criterio de cuál rinde mejor a este tamaño de mapa) con un material de pasto, aunque sea un verde liso por ahora.
- Las montañas se ven como montañas (conos o formas similares, con el mismo truco de sombreado horneado por vértice que ya usa `boxShaded`), aunque sea con un solo color de roca por ahora.
- El cielo usa `getSkyMaterial` con tonos cálidos en vez de los violetas actuales (no hace falta el sol animado ni el barrido de atardecer — eso es de un prompt posterior), para que la escena no quede con un cielo sci-fi sobre un paisaje natural.
- Si necesitás colores que no existen en `tokens.css` (verde de pasto, gris de roca, naranja de atardecer), agregalos ahí y a `TOKENS` en `palette.ts` — es aditivo, no rompe ningún otro juego.

## Lo que NO tenés que hacer (para no comerte el prompt)

- No toques la pantalla de inicio, el nombre del jugador ni las skins.
- No afines el atardecer animado, las texturas de pasto/roca con variación, ni el sonido.
- No armes la interfaz de inventario/HUD de botín, el minimapa ni la recarga manual.
- No hagas que los bots manejen autos ni abran cofres con criterio.
- No cambies `MAX_PLAYERS`, ni la topología de red (`useGameNet`, host-autoritativo), ni el resto del catálogo.
- No toques rutas ni el ruteo del catálogo (sidebar, banco de pruebas): eso es un prompt aparte y no depende de nada de lo que hagas acá.

## Verificación y cierre

1. Actualizá `logic.test.ts` con casos nuevos para: `terrainHeight` (determinístico, una montaña conocida da la altura esperada en su centro y decae con la distancia), colisión de laderas empinadas, `stepVehicle` (acelera, frena, gira proporcional a la velocidad, no atraviesa una montaña), apertura de cofres (asigna el arma correcta según semilla, el bit de abierto persiste, dos intentos simultáneos solo lo abre uno), y las cuatro armas (cadencia, daño, caída por distancia, el aspersor pega varios rayos). Los tests existentes (determinismo, movimiento, hitscan, anillo, bots, snapshot) tienen que seguir pasando — ajustalos si el mapa más grande corre alguna constante (por ejemplo los `LANE_SHOOTER`/`LANE_VICTIM` de los tests actuales), pero no borres cobertura.
2. Actualizá `registry.ts`: `title: "Bubble Shooter Game"`, `tagline` acorde (mundo abierto, cofres, auto), mantené `code: "X4"` y el resto de los campos.
3. Corré, en este orden, y confirmá que los cuatro pasen: `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (toda la suite, no solo el shooter), `npx vite build`.
4. Abrí el juego en el banco de pruebas (ruta `#/juego/shooter`), tomá el asiento 0 con Tab, y confirmá a ojo: el mapa es notablemente más grande, hay montañas que se caminan y bloquean, hay pasto y cielo cálido (aunque sea liso), podés acercarte a un auto y subir con la tecla/botón de interactuar y manejarlo, podés acercarte a un cofre y abrirlo y tu arma cambia.
5. Commiteá con un mensaje en español que resuma el alcance, terminando con `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Si todo lo anterior pasó, pusheá a `main` (el deploy a GitHub Pages es automático al pushear) — es el patrón que este proyecto viene siguiendo.
