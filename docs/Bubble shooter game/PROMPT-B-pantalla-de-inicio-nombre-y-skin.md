# Prompt B — para Opus 5 (pantalla de inicio, nombre y skin)

> Pegá todo lo que sigue en una sesión de Opus 5, después de que el Prompt A esté commiteado.

Estoy sumando una pantalla de inicio tipo videojuego a **Bubble Shooter Game** (`src/games/shooter/`, antes "Supernova Arena"), un battle royale 3D que un prompt anterior acaba de reescribir con mundo abierto (montañas, pasto, un auto, cofres con armas de agua). No participaste de ese trabajo — arrancá revisando qué dejó.

**Primero, antes de agregar nada**: leé `src/games/shooter/map.ts`, `logic.ts`, `view.ts`, `ShooterScene.tsx`, `ShooterGame.tsx` tal como están AHORA (no como los describa cualquier documento viejo). Corré `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` y `npx vite build`. Si algo de eso falla, o si notás algo a medio hacer del trabajo anterior (una función declarada y no usada, un TODO, un cabo suelto entre `logic.ts` y `view.ts`), arreglalo antes de seguir — sos parte de la cadena de calidad, no solo de sumar features.

### Reglas del repo (universales, no las repitas ni las cuestiones)

- **Nunca importes `@react-three/drei`**: su copia de `three-mesh-bvh` (0.8.x) choca con la del proyecto (0.9.14) y rompe `tsc -b`. Para lo que necesites de este prompt no debería hacer falta.
- Cero asignaciones en el loop de simulación de `logic.ts`.
- Un draw call por familia de objetos repetidos (`createInstanceWriter`, `src/core/engine3d/instancing.ts`).
- Colores solo desde `src/styles/tokens.css` vía `getColor`/`getMaterial`.
- Comentarios de código en español, sin tildes.
- Antes de dar por terminado: `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (la suite ENTERA, hoy ~787 tests en 39 archivos, no solo `src/games/shooter`) y `npx vite build`.

## Lo que tenés que construir

**1. Nombre del jugador**

- Hoy `ShooterGame.tsx` arma el nombre como `` `Jugador ${seat + 1}` `` fijo. Cambialo por un nombre elegible: un estado local inicializado desde `localStorage.getItem("sn-shooter-name")`, con un tope razonable de longitud (15-20 caracteres), que se pasa como `name` a `useGameNet` en vez del template fijo. Guardalo en `localStorage` cuando cambie.
- El proyector (host) puede dejar su nombre como "Proyector" cuando no está jugando; cuando toma el asiento 0 con Tab, usá el mismo nombre elegible.

**2. Skin: reusar los colores por asiento, no inventar un sistema nuevo**

- En `view.ts`/`ShooterScene.tsx` ya existe `SEAT_TOKENS`: un array de `PaletteToken` que hoy se usa para pintar a cada jugador según su número de asiento. Una skin es, simplemente, dejar que cada jugador elija su propio índice en ese mismo array en vez de que se lo asigne el número de asiento.
- Agregá un campo `skin: number` a `ShooterInput` (0 a `SEAT_TOKENS.length - 1`), lo manda el celular/PC continuamente igual que `mx`/`my` (no hace falta un canal aparte). El host lo copia a un `world.skin: Uint8Array` por asiento y lo empaqueta en un escalar nuevo del snapshot (`S_SKINS`): con 3 bits por asiento y 10 asientos entran cómodos en un solo `int32` (hay escalares libres: el shooter usa 12 de los 16 disponibles antes de este cambio, y probablemente 1 o 2 más después del Prompt A por los autos/cofres — igual sobra lugar).
- En la escena, el color con el que se pinta a un jugador pasa a salir de ese escalar (con `seat` como resguardo mientras no llegó ningún snapshot todavía), no directamente del índice de asiento.

**3. La pantalla de inicio**

- El `<Canvas>` de R3F ya está montado durante la fase `"intro"` (antes de apretar Jugar) — no hace falta un canvas aparte. Agregá un tercer modo de cámara en `ShooterScene.tsx` (junto a `"fpv"`/`"spectator"`/el modo del auto que dejó el prompt anterior): un modo `"lobby"`, activo mientras la fase no es `"playing"`, que apunta a un pedestal fijo con un solo avatar (podés reusar la geometría `"avatar"` de `getGeometry`, sin necesidad de instancing porque es uno solo) rotando lentamente sobre su eje, iluminado con una luz puntual o spot dedicada. Pintalo con el color de la skin elegida localmente — esto es feedback inmediato, no necesita red porque todavía no empezó la partida.
- En el DOM, usá el slot `introExtra` de `<Stage>` (mirá cómo lo arma `ShooterGame.tsx` hoy) para sumar: un `<input>` de texto para el nombre, y una fila de swatches de color (uno por cada token de `SEAT_TOKENS`) para elegir skin — al tocar un swatch, cambia el estado local de `skin` al instante (y con eso el pedestal 3D cambia de color en el mismo cuadro).
- Esto reemplaza/convive con lo que ya hay en `introExtra` (el texto de estado de conexión); no rompas esa información, agregala debajo o al lado.

## Lo que NO tenés que hacer

- No toques el atardecer, las texturas de pasto/roca ni el sonido.
- No armes inventario, minimapa ni recarga manual.
- No cambies la física del auto ni la tabla de armas que dejó el prompt anterior, salvo que estén rotas.
- No toques rutas ni el ruteo del catálogo (sidebar, banco de pruebas).

## Verificación y cierre

1. Sumá o ajustá tests si tocaste algo de `logic.ts` (el empaquetado del escalar de skins, sobre todo). Si no tocaste `logic.ts`, no hace falta.
2. `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (suite completa), `npx vite build` — los cuatro en verde.
3. Probá con dos pestañas (proyector + celular, transporte local): elegí nombre y skin distintos en cada una, empezá la partida, confirmá que cada uno ve al otro con su color elegido y su nombre en el feed/tabla.
4. Commiteá en español, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, y pusheá a `main` si todo pasó.
