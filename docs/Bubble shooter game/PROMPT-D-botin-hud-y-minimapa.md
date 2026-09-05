# Prompt D — para Opus 5 (botín, HUD, recarga manual, minimapa)

> Pegá todo lo que sigue en una sesión de Opus 5, después del Prompt C.

Estoy completando la interfaz de **Bubble Shooter Game** (`src/games/shooter/`), el battle royale 3D de mundo abierto que prompts anteriores reescribieron (montañas, auto, cofres con armas, pantalla de inicio, atardecer). No participaste de ese trabajo.

**Primero**: leé `src/games/shooter/logic.ts`, `view.ts`, `ShooterGame.tsx` tal como están, prestando especial atención a cómo quedó representado el arma actual de cada asiento (`world.weapon`, la tabla de armas) y los cofres (`S_CHESTS_OPENED` o el nombre que le hayan puesto) después del Prompt A. Corré la verificación completa y arreglá cualquier cabo suelto antes de sumar tu parte.

### Reglas del repo (universales, no las repitas ni las cuestiones)

- **Nunca importes `@react-three/drei`**: su copia de `three-mesh-bvh` (0.8.x) choca con la del proyecto (0.9.14) y rompe `tsc -b`.
- Cero asignaciones en el loop de simulación de `logic.ts`.
- Un draw call por familia de objetos repetidos (`createInstanceWriter`).
- Colores solo desde `src/styles/tokens.css` vía `getColor`/`getMaterial`.
- Comentarios de código en español, sin tildes.
- Antes de dar por terminado: `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (suite entera) y `npx vite build`.

## Lo que tenés que construir

**1. HUD del arma actual**

- Hoy el HUD de vida/munición asume un arma fija. Mostrá de qué arma se trata (nombre corto: "Pistola", "Aspersor", "Manguera", "Cañón") y ajustá los números de cargador/recarga a los de esa arma. Si el jugador tiene la pistola inicial vs. algo mejor conseguido en un cofre, que se note (un ícono o color distinto alcanza, no hace falta arte nuevo).

**2. Recarga manual**

- Hoy la recarga es automática al llegar a 0 balas (mirá `stepLocalWeapon` en `view.ts` y la parte de armas de `stepWorld` en `logic.ts`). Sumá un gatillo manual: una tecla (`KeyR`) y un botón táctil en el overlay (mismo patrón que el botón de interactuar que dejó el Prompt A), que dispara la recarga si hay menos balas que el cargador completo y no se está recargando ya. Tiene que funcionar simétrico en predicción del cliente (`view.ts`) y en la autoridad del host (`logic.ts`), como ya lo hace el resto del sistema de armas.

**3. Aviso de cofre/auto cercano**

- Cuando el jugador está en rango de interactuar con un cofre o un auto, mostrá un aviso breve en pantalla ("Abrir cofre", "Subir al auto") con la tecla/botón correspondiente — mismo lugar y estilo que usan los avisos existentes del anillo/despliegue.

**4. Minimapa**

- Un minimapa chico (esquina superior, DOM sobre el overlay, no 3D) con: la posición del jugador y su rumbo, el centro y radio actual del anillo, y los cofres sin abrir cerca (dentro de un radio razonable, no todo el mapa para no arruinar la sorpresa). Es una proyección simple de coordenadas de mundo a un `<canvas>` 2D pequeño o a posiciones porcentuales de `<div>`s — no hace falta que sea sofisticado.

**5. Botín visible en el mundo al morir (sugerencia mía, evaluá si suma)**

- Cuando alguien muere, que su arma quede "tirada" en su posición (un cofre chico o el ícono del arma en el piso) que cualquiera puede recoger caminando encima, sin necesidad de la señal de interactuar (a diferencia de los cofres cerrados). Es opcional: si el alcance ya se sintió grande, dejalo anotado y priorizá que lo demás quede bien pulido.

## Lo que NO tenés que hacer

- No toques la física del auto, la generación del mapa ni el atardecer/texturas.
- No toques rutas ni el ruteo del catálogo (sidebar, banco de pruebas).

## Verificación y cierre

1. `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (suite completa), `npx vite build`.
2. Jugá una partida completa (dos pestañas, proyector jugando con Tab + un celular o segunda pestaña) y confirmá: el HUD muestra el arma correcta, la recarga manual funciona sin romper la automática, aparecen los avisos de interacción cerca de cofres/auto, el minimapa se actualiza y ubica bien el anillo.
3. Commiteá en español, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, pusheá a `main` si todo pasó.
