---
name: game-vertical-slice-planning
description: "Divide un juego o prototipo en slices pequeños, jugables y verificables, cada uno con su criterio de aceptación. Usala para ordenar la implementación cuando la tarea cruza gameplay, UI, assets, backend, rewards o QA."
---

## Propósito

Un juego construido de abajo hacia arriba (primero el motor, después las entidades, después la UI, y recién al final se juega) no se puede validar hasta el último día. Un vertical slice se juega desde el primer día, aunque sea feo.

Esta skill ordena el trabajo en **entregas jugables**, no en capas técnicas.

## La regla

**Cada slice tiene que poder abrirse y jugarse.** Si un slice termina y no hay nada que probar con las manos, no es un slice: es una tarea interna que va dentro de otro.

## Cuándo usarla

- El trabajo cruza gameplay + UI + assets + backend.
- El juego tiene más de una mecánica.
- Hay rewards, ranking o persistencia.
- El pedido es "hacé el juego" sin más detalle.

## Cuándo no usarla

- Un cambio acotado sobre un juego existente.
- Un bug fix.
- Un prototipo de una sola mecánica que se resuelve en un archivo.

## El orden por defecto

1. **Slice 0 — loop crudo.** Render mínimo, input, la mecánica principal, condición de fin. Sin arte, sin sonido, sin HUD. Rectángulos de colores.
2. **Slice 1 — estados del juego.** Menú, jugando, fin, reintentar. Es lo que convierte una demo en un juego.
3. **Slice 2 — score y progresión.** Puntaje, dificultad creciente, timers.
4. **Slice 3 — HUD y feedback.** Ver `game-ui-hud-polish`.
5. **Slice 4 — assets reales.** Recién acá entra el arte definitivo. Ver `asset-style-prompts`.
6. **Slice 5 — juice.** Partículas, screen shake, easing, sonido.
7. **Slice 6 — rewards y persistencia.** Sólo si aplica. Ver `reward-economy-security`.
8. **Slice 7 — QA y performance.** Ver `qa-playtest-performance`.

Este orden no es caprichoso: **el arte y el juice se agregan al final porque son lo primero que se tira** si el loop no funciona. Ponerlos antes es trabajo que se pierde.

## Formato de cada slice

```txt
SLICE N — nombre
Qué se ve:    qué puede hacer el jugador al terminar este slice
Qué se toca:  archivos o módulos
Criterio:     cómo se verifica, con las manos
Riesgo:       qué puede salir mal
Depende de:   slices previos
```

## Reglas

- Un slice no debería superar lo que se puede revisar en un diff razonable.
- Si un slice necesita backend, separá "frontend con mock" de "integración real" en dos slices.
- Si el juego tiene rewards, el slice de rewards **siempre** incluye la validación de servidor. No se entrega la mitad cliente sola.
- Declará explícitamente qué queda fuera de esta tanda.
- Si un slice no se puede jugar al terminarlo, reagrupalo.
