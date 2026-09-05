# Prompt E — para Opus 5 (bots, rendimiento y documentación — cierre)

> Pegá todo lo que sigue en una sesión de Opus 5, después del Prompt D. Es el último de la cadena de contenido (el Prompt F, aparte, es independiente y no depende de este).

Estoy cerrando el rediseño de **Bubble Shooter Game** (`src/games/shooter/`), el battle royale 3D de mundo abierto que los cuatro prompts anteriores construyeron (montañas, auto, cofres/armas de agua, pantalla de inicio con nombre y skin, atardecer, HUD de botín y minimapa). No participaste de nada de eso: es tu trabajo revisar todo el conjunto con ojo crítico antes de cerrar.

**Primero**: leé el juego completo tal como quedó (`map.ts`, `logic.ts`, `logic.test.ts`, `view.ts`, `ShooterScene.tsx`, `ShooterGame.tsx`, `settings.ts`, `registry.ts`). Corré la verificación completa y jugá al menos dos partidas de punta a punta (una completa hasta que gane alguien, con el proyector jugando vía Tab). Anotá y arreglá cualquier bug o cabo suelto que encuentres ANTES de sumar lo que sigue — esta es la última red de seguridad antes de considerar el trabajo terminado.

### Reglas del repo (universales, no las repitas ni las cuestiones)

- **Nunca importes `@react-three/drei`**: su copia de `three-mesh-bvh` (0.8.x) choca con la del proyecto (0.9.14) y rompe `tsc -b`.
- Cero asignaciones en el loop de simulación de `logic.ts`.
- Un draw call por familia de objetos repetidos (`createInstanceWriter`).
- Colores solo desde `src/styles/tokens.css` vía `getColor`/`getMaterial`.
- Comentarios de código en español, sin tildes.
- Antes de dar por terminado: `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (suite entera) y `npx vite build`.

## Lo que tenés que construir

**1. Bots con criterio sobre autos y cofres (opcional, evaluá el costo)**

- Hoy los bots (`botThink` en `logic.ts`) caminan, apuntan y disparan, pero no suben a un auto ni abren cofres. Si el alcance lo permite: un bot sin objetivo a la vista y lejos del centro del anillo puede dirigirse al auto libre más cercano y usarlo para desplazarse más rápido (subir, acelerar hacia su punto de paseo, bajar cerca); y un bot que pasa cerca de un cofre sin abrir puede abrirlo. Si esto agrega demasiada complejidad o riesgo a esta altura de la cadena, no lo fuerces: dejalo explícitamente anotado como pendiente (en un comentario en `botThink` o en `games-guide/X4-SHOOTER-3D.md`) y priorizá el resto.

**2. Pasada de rendimiento**

- Con el mapa a 200 de lado, montañas, rocas, cofres, auto y todos los efectos nuevos, medí draw calls y triángulos en un dispositivo de gama media (o con el `debug` del banco de pruebas, que muestra `r3f-perf`). El presupuesto original de la guía era <60 draw calls / 30fps sostenidos en celular — con todo lo agregado es razonable relajarlo, pero definí un número y verificalo, no lo dejes sin medir. Si algo quedó sin instanciar y debería estarlo (rocas, cofres, chispas de agua), corregilo.
- Si las montañas lejanas cuestan demasiado, aplicá un nivel de detalle simple con lo que ya existe en `src/core/engine3d/lod.ts` (`createLodBands`, `lodLevel`) — no hace falta un sistema nuevo.

**3. Documentación de cierre**

- Reescribí `games-guide/X4-SHOOTER-3D.md` para que describa el juego tal como quedó (mundo abierto, montañas, auto, cofres, armas de agua, atardecer, dificultad de bots, skins) en vez del diseño original de arena cerrada sci-fi. Mantené el mismo estilo del resto de las guías del catálogo (`games-guide/`).
- Confirmá que `registry.ts` tiene el `tagline` y `status` correctos para el estado final (¿sigue siendo `"beta"`? subilo a `"stable"` si jugaste varias partidas sin problemas y te parece que corresponde).

## Verificación y cierre

1. `npx tsc -b --noEmit`, `npx eslint .`, `npx vitest run` (suite completa), `npx vite build`.
2. Commiteá en español, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, pusheá a `main` si todo pasó.
3. Reportá al final, en texto plano, un resumen de una pantalla: qué quedó implementado, qué quedó pendiente (bots en auto, botín en el piso al morir, o cualquier otra cosa que se haya dejado anotada en el camino), y el número de draw calls/triángulos medido.
