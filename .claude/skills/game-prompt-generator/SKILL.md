---
name: game-prompt-generator
description: "Genera prompts maestros para Codex, Copilot, Claude o Cursor usando Game-arquitect, con stack fijo, alcance, restricciones y criterios de aceptación. Usala cuando el usuario pida un prompt para ejecutar el trabajo en otro agente o en otra sesión."
---

## Propósito

Convertir una idea de juego —o un slice ya planificado— en **un prompt autocontenido** que otro agente pueda ejecutar sin tener el contexto de esta conversación.

Un prompt que dice "hacé el juego de la ruleta" produce un resultado distinto cada vez. Uno con stack fijo, alcance cerrado y criterios de aceptación produce el mismo resultado siempre.

## Cuándo usarla

- El usuario pide "dame un prompt para Codex / Copilot / Cursor".
- El trabajo se va a ejecutar en otra sesión o por otra persona.
- Hay que dejar documentado qué se pidió exactamente.

## Cuándo no usarla

- El trabajo se va a hacer acá y ahora.
- Todavía no está claro el alcance: primero `game-discovery`.

## Regla

**Un prompt no puede depender de nada que sólo exista en esta conversación.** Si algo se decidió acá, va escrito en el prompt.

Antes de generarlo, verificá que estén resueltos: loop, plataforma, stack, alcance y criterios. Si falta alguno, resolvelo con `game-discovery` primero.

## Plantilla

```txt
# ROL
Actuá como Game-arquitect: agente arquitecto de videojuegos web, native y VR.
Priorizá simplicidad, vertical slicing, game feel y performance.
Elegí el stack más chico que resuelva el juego. Primero loop jugable, después polish.

# OBJETIVO
[Una frase: qué juego y para qué.]

# CORE LOOP
El jugador [acción], ocurre [consecuencia], y vuelve a [acción].
Gana cuando [condición]. Pierde cuando [condición].

# PLATAFORMA Y STACK
Plataforma: [web / mobile web / native / VR]
Stack: [exacto, con versiones si importan]
No usar: [librerías o enfoques vetados]

# ALCANCE DE ESTA TANDA
Incluye:
- [punto 1]
- [punto 2]

NO incluye:
- [lo que explícitamente queda afuera]

# RESTRICCIONES
- [convenciones del repo que hay que respetar]
- [archivos que no se tocan]
- [presupuesto de performance: fps objetivo y dispositivo]
- [accesibilidad: prefers-reduced-motion, contraste, pausa]

# ARQUITECTURA ESPERADA
- Estados: [lista]
- Entidades: [lista]
- Loop con delta clampeado; estado caliente fuera de React.
- HUD en DOM, no en el canvas.
- Limpieza del loop y de los listeners al desmontar.

# REWARDS
[No hay / Sí: describir. Si hay valor real, el score se valida en servidor,
el claim es idempotente y transaccional, los cooldowns usan el reloj del servidor.]

# CRITERIOS DE ACEPTACIÓN
- [ ] Se puede jugar de principio a fin sin recargar.
- [ ] [criterio propio del juego]
- [ ] [criterio propio del juego]
- [ ] 60 fps en escritorio, 30 fps en móvil de gama media.
- [ ] Sin errores en consola.
- [ ] prefers-reduced-motion respetado.

# ENTREGA
Cambios pequeños y revisables. Explicá las decisiones no obvias.
Al terminar, listá qué quedó pendiente y por qué.
```

## Ajustes por agente destino

| Destino | Qué cambiar |
|---|---|
| **Codex** | Referí `AGENTS.md`. Pedí explícitamente que lea los archivos antes de modificarlos. |
| **GitHub Copilot** | Referí el agente de `.github/agents/` y las skills por nombre. Un slash prompt por vez. |
| **Claude Code** | Referí `CLAUDE.md` y las skills por nombre. Pedí plan antes de implementar si el alcance es grande. |
| **Cursor** | Incluí las rutas de los archivos relevantes: el contexto automático no siempre alcanza. |

## Errores comunes al generar el prompt

- Dejar el stack abierto ("usá lo que te parezca"): garantiza que cada ejecución elija otra cosa.
- No declarar qué NO hacer: el agente va a sobre-construir.
- Omitir los criterios de aceptación: sin ellos no hay forma de decir si terminó.
- Pedir el juego completo en un prompt cuando son tres slices. Ver `game-vertical-slice-planning`.
- Olvidar el presupuesto de performance y el dispositivo objetivo.

## Salida

Entregá el prompt en un bloque de código, listo para copiar, sin comentarios alrededor salvo una línea diciendo para qué agente está preparado.
