# Prompt F — para Opus 5 (página propia y pantalla completa de verdad)

> Pegá todo lo que sigue en una sesión de Opus 5. Es **independiente** de los prompts A a E: es ruteo e interfaz, no toca `logic.ts` ni la simulación del juego. Se puede correr en cualquier momento de la cadena, incluso antes que el resto.

Estoy dándole a **Bubble Shooter Game** (`src/games/shooter/`, id `"shooter"` en el catálogo) una entrada propia, separada del banco de pruebas. Hoy, cuando alguien lo abre desde el sidebar o el catálogo, termina en `GameLabPage` (ruta `#/juego/:id`): la misma pantalla de desarrollo que usan los otros 17 juegos, con sidebar, pestañas "Partida / Administrables / Resultado", sliders de semilla/duración/asiento/transporte, etc. Eso está bien para probar un juego mientras se lo construye, pero **no es una experiencia de juego real**: quiero que jugar a este juego en particular abra una página aparte, sin nada de esa interfaz — ni sidebar, ni pestañas, ni administrables — y que se vaya a pantalla completa apenas se empieza a jugar.

No participaste de las sesiones anteriores que armaron el mundo abierto, el auto, los cofres, etc. Este prompt no depende de haber leído ese trabajo: es puramente de ruteo e interfaz.

### Reglas del repo (universales, no las repitas ni las cuestiones)

- **Nunca importes `@react-three/drei`**: su copia de `three-mesh-bvh` (0.8.x) choca con la del proyecto (0.9.14) y rompe `tsc -b`. No debería hacerte falta para nada de este prompt.
- Colores solo desde `src/styles/tokens.css` vía `getColor`/`getMaterial`, si tocás algo visual (no debería hacer falta más que clases de Tailwind existentes).
- Comentarios de código en español, sin tildes.
- Antes de dar por terminado: `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (suite entera, hoy ~787 tests en 39 archivos) y `npx vite build`.

## Antes de tocar nada, mirá esto

`src/routes/KioskPage.tsx` (el "modo quiosco", ruta `/quiosco`) ya resuelve casi exactamente este problema: es una página SIN el `AppShell` (sin sidebar), que monta un juego directo con `<GameComponent config={...} net={null} .../>` en un contenedor a pantalla completa, con su propio botón de pantalla completa vía `useFullscreen` (`src/ui/game/useFullscreen.ts`) apuntado a `document.documentElement`. Es exactamente el nivel de "sin nada alrededor" que buscás — la diferencia es que Kiosk es de un jugador contra la máquina y elige el juego de una grilla; acá necesitás lo mismo pero para UN juego fijo (el que diga la URL), con la sala compartida entre el proyector y los celulares que se sumen.

Mirá también:

- `src/App.tsx`: el router. `AppShell` (con sidebar) envuelve `/` y `juego/:id`; `/quiosco` y `/control/:sala` están declarados COMO HERMANOS, afuera de ese `children`, y por eso no llevan sidebar. Tu ruta nueva va ahí.
- `src/ui/catalog/GameLaunchLink.tsx` y `opensInTab`/`phoneRoleOf` en `src/core/contract/catalog.ts`: cómo decide hoy el catálogo si un juego abre en pestaña nueva (`target="_blank"` a `#/juego/:id`) o navega adentro del shell.
- `src/routes/GameLabPage.tsx`: la función `showQr` (buscá `QRCode.toDataURL`, es la librería `qrcode`, ya es dependencia del proyecto) arma el link que ve un celular: `` `#/juego/${entry.id}?asiento=${seat}&semilla=${seed}&transporte=${transport}` ``. Tu página nueva usa el mismo esquema de parámetros (`asiento`, `semilla`, `transporte`) para que sea compatible con lo que la gente ya espera de un link de este tipo, pero apuntando a tu ruta nueva.
- `src/core/contract/game.ts` (`GameRuntimeConfig`, `GameProps`) y `src/games/registry.ts` (`getGame`, `entry.load`, `entry.maxPlayers`, `entry.settings`) para armar la config exactamente como ya lo hacen `GameLabPage`/`KioskRun`.

## Lo que tenés que construir

**1. Una ruta nueva, afuera del shell**

En `src/App.tsx`, agregá `{ path: "/jugar/:id", element: <PlayPage /> }` como hermano de `/quiosco` y `/control/:sala` (fuera del `children` de `AppShell`) — así nunca lleva sidebar, sea cual sea el juego. Cargala perezosa (`lazy(() => import("@/routes/PlayPage"))`) como el resto de las páginas.

**2. `src/routes/PlayPage.tsx`**

Una página nueva, chica, que:

- Lee `id` de la ruta y, de la query string: `asiento` (1-based, igual que `GameLabPage`; si falta, `1` = host), `semilla` (si falta, `randomSeed()`), `transporte` (`"local"` por defecto), `asientos` (si falta, `entry.maxPlayers`).
- Arma el `GameRuntimeConfig` igual que ya lo hace `GameLabPage` (o `KioskRun`, que es más corto y mejor referencia acá): `roomId` fijo por juego (`` `play-${entry.id}` ``, no por semilla — una sala viva por juego, misma idea que `` `lab-${entry.id}` `` en el banco de pruebas), `seat = asiento - 1`, `isHost = seat === 0`, `settings` desde `loadSettings(entry.id, entry.settings)` (los administrables los sigue configurando quien los necesite desde el banco de pruebas — acá NO hay UI para tocarlos, pero se siguen respetando), `debug: false`.
- Renderiza `entry.load()` (dynamic import, como ya hacen `GameLabPage`/`KioskRun`) dentro de un contenedor a pantalla completa (`h-screen w-screen` o equivalente, sin scroll), sin ningún encabezado de pestañas ni panel lateral. Un título chico y discreto arriba (nombre del juego) y un botón "Salir" (vuelve a `/`) alcanzan — nada más. Nada de "Partida / Administrables / Resultado".
- **Pantalla completa real, disparada por la primera interacción, no antes.** La API de Fullscreen del navegador exige un gesto del usuario — no se puede pedir pantalla completa apenas carga la página, el navegador lo rechaza en silencio. Solución: al montar, agregá un listener de `pointerdown` en `document` con `{ once: true }` que dispara la pantalla completa (fijate cómo ya lo resuelve `useFullscreen` en `src/ui/game/useFullscreen.ts` y reusalo en vez de reimplementar la llamada a `requestFullscreen` a mano). El primer toque/click que la persona haga —que va a ser el botón "Jugar" que ya trae el juego adentro— dispara la pantalla completa real al mismo tiempo. No hace falta (ni conviene) una pantalla previa propia pidiendo "tocá para empezar": sería una pantalla más entre la persona y el juego, justo lo que se quiere evitar.
- Si la pantalla completa no está soportada (`useFullscreen(...).supported === false`, pasa en algunos navegadores de escritorio en iframe o en iOS Safari con ciertas restricciones), la página igual tiene que ocupar el 100% del viewport y no mostrar sidebar ni pestañas — eso no depende de la API de Fullscreen del navegador, depende de que esta ruta nunca monte `AppShell`. La pantalla completa NATIVA (que además esconde la barra de direcciones) es una mejora cuando el navegador la banca, no un requisito para que la experiencia sea "sin chrome".
- El proyector (host, `asiento=1`) necesita poder invitar celulares sin abrir el banco de pruebas. Sumale un botón discreto "Compartir" que, con el mismo patrón que `showQr` en `GameLabPage.tsx` (`QRCode.toDataURL`), genere un código QR apuntando a `` `#/jugar/${id}?asiento=${siguienteAsientoLibre}&semilla=${semilla}&transporte=${transporte}` ``. No hace falta reconstruir todo el panel de `GameLabPage`: alcanza con el botón, el QR y el link en texto por si alguien prefiere copiarlo.

**3. Que el catálogo lleve ahí, solo para este juego**

- Agregá un campo opcional al contrato de catálogo: `standalonePlay?: boolean` en `GameEntry` (`src/core/contract/catalog.ts`), y una función `standalonePlayUrl(entry: GameEntry): string` al lado de `opensInTab`, que devuelve `` `#/jugar/${entry.id}?asiento=1` ``.
- En `src/games/registry.ts`, ponele `standalonePlay: true` a la entrada del shooter (`id: "shooter"`). No se lo pongas a ningún otro juego — es aditivo, así que el resto del catálogo sigue exactamente igual.
- En `GameLaunchLink.tsx`: si `entry.standalonePlay` es `true`, el `<a target="_blank">` apunta a `standalonePlayUrl(entry)` en vez de `` `#/juego/${game.id}` ``. Si es `false`/no está, el comportamiento actual no cambia para nada.

## Lo que NO tenés que hacer

- No toques `logic.ts`, `map.ts`, `view.ts` ni `ShooterScene.tsx` — esto es pura ruta e interfaz.
- No le saques a `GameLabPage` la capacidad de abrir este juego (`#/juego/shooter` sigue funcionando igual que hoy, para desarrollo/pruebas): estás agregando una puerta de entrada nueva, no reemplazando la que ya existía.
- No hace falta migrar el metaverso ni ningún otro juego a este esquema — dejá el campo `standalonePlay` y la ruta `/jugar/:id` armados de forma genérica (cualquier juego con `load` puede usarlos), pero solo activalo para el shooter en este prompt.

## Verificación y cierre

1. `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (suite completa), `npx vite build`.
2. Probá manualmente: desde el catálogo o el sidebar, hacé click en "Jugar" del shooter — tiene que abrir una pestaña nueva en `#/jugar/shooter?asiento=1`, SIN sidebar ni pestañas de arriba. Tocá "Jugar" adentro del juego y confirmá que el navegador entra en pantalla completa real (la barra de direcciones desaparece). Generá el QR con "Compartir", abrilo en otra pestaña con un asiento distinto y confirmá que los dos se conectan a la misma partida. Confirmá que `#/juego/shooter` (el banco de pruebas de siempre) sigue funcionando sin cambios.
3. Commiteá en español, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, pusheá a `main` si todo pasó.
