---
name: game-discovery
description: "Aclara el alcance de una idea de juego antes de implementarla: plataforma, mecánica, core loop, reglas, duración, target, rewards y criterios de aceptación. Hace pocas preguntas y sólo las que cambian la solución. Usala cuando el pedido no defina claramente alguno de esos puntos."
---

## Propósito

Evitar que se construya el juego equivocado. Una idea de juego suele llegar como una frase ("un juego de preguntas con premios", "algo tipo Flappy Bird para la landing") y esa frase esconde decisiones que cambian por completo el stack, el alcance y el riesgo.

Esta skill se usa **al inicio**, antes de elegir engine, antes de escribir gameplay y antes de estimar.

## Cuándo usarla

Cuando falte definición sobre alguno de estos ejes:

- **plataforma** — web, mobile web, native, VR;
- **mecánica y core loop** — qué hace el jugador una y otra vez;
- **condición de victoria y derrota**;
- **duración de sesión** — 20 segundos, 3 minutos, sesión abierta;
- **target** — edad, contexto de uso, si se juega sentado o en una fila de espera;
- **rewards** — si hay puntos, premios, ranking o algo con valor real;
- **criterios de aceptación** — cómo se sabe que está terminado.

## Cuándo no usarla

- El pedido ya define plataforma, loop y alcance.
- Es un fix acotado sobre un juego que ya existe.
- La duda es puramente técnica y se responde leyendo el repo.

## Presupuesto de preguntas

- **1 a 3 preguntas** como estándar.
- **Hasta 5** cuando el juego tenga rewards con valor real: ahí un supuesto equivocado es un problema de seguridad, no de diseño.
- **Una sola ronda.** No encadenes cuestionarios.

## Las preguntas que valen

Preguntá sólo lo que cambie el resultado. En orden de impacto:

1. **¿Cuál es el core loop?** Una frase: "el jugador hace X, pasa Y, y vuelve a X". Si no se puede escribir esa frase, todavía no hay juego.
2. **¿Dónde se juega?** Define el stack, el input y el presupuesto de performance.
3. **¿Cuánto dura una partida?** Define si hace falta persistencia, pausa, guardado y progresión.
4. **¿Hay algo con valor real en juego?** Define si el score se valida en servidor.
5. **¿Qué NO hay que hacer?** Assets que no se pueden usar, librerías vetadas, tiempo disponible.

## Qué NO preguntar

- Detalles de arte antes de que exista el loop.
- Paleta, nombre o música.
- Preferencias de librería cuando el stack se deduce de la plataforma.
- Cualquier cosa que puedas asumir y declarar como supuesto.

## Salida

Cerrá con un bloque corto y accionable:

```txt
LOOP:             el jugador hace X, pasa Y, vuelve a X
PLATAFORMA:       web / mobile web / native / VR
STACK PROPUESTO:  el mínimo que resuelve el loop
SESIÓN:           duración objetivo
REWARDS:          no / puntos locales / valor real (requiere validación server)
FUERA DE ALCANCE: lo que explícitamente no entra
SUPUESTOS:        lo que asumiste sin preguntar
```

Si el alcance quedó claro y el trabajo es amplio, seguí con `game-vertical-slice-planning`.
