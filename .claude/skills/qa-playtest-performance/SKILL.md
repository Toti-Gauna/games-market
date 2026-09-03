---
name: qa-playtest-performance
description: "Checklist de QA, playtest y performance para juegos web, native, R3F y VR antes de cerrar una tarea. Usala antes de dar por terminado un juego, un prototipo, un refactor de gameplay, un release mobile, VR o un flujo de rewards."
---

## Propósito

Un juego "terminado" que nunca se probó en un dispositivo real, con las manos de otra persona, no está terminado. Esta skill es la última puerta antes de entregar.

## Cuándo usarla

Antes de cerrar: un juego, un prototipo, un refactor de gameplay, un release mobile, una experiencia VR o cualquier flujo de rewards.

## 1. Funcional — el loop

- [ ] Se puede empezar una partida desde cero.
- [ ] Se puede terminar una partida (ganando y perdiendo).
- [ ] Se puede reintentar sin recargar la página.
- [ ] Después de 5 partidas seguidas el estado sigue limpio (score, timers, entidades).
- [ ] La pausa detiene **todo**: loop, timers, sonido, animaciones.
- [ ] Cambiar de pestaña y volver no rompe nada ni acelera el juego.
- [ ] Redimensionar la ventana no descoloca ni deforma.
- [ ] Refrescar en medio de una partida deja el sistema en un estado coherente.

## 2. Input

- [ ] Teclado funciona.
- [ ] Touch funciona (probado en un teléfono real, no en el emulador).
- [ ] Mantener presionado, doble tap y multitouch no producen estados imposibles.
- [ ] El input no se pierde al salir y volver a la ventana.
- [ ] No hay teclas que hagan scroll de la página (espacio, flechas) sin `preventDefault`.
- [ ] El juego no captura el teclado cuando el foco está en un input de la UI.

## 3. Performance

Presupuesto por defecto: **60 fps en escritorio, 30 fps sostenidos en un móvil de gama media**.

- [ ] Medido con el profiler, no a ojo.
- [ ] Sin caídas al aparecer partículas, enemigos o efectos.
- [ ] Sin crecimiento de memoria: 3 minutos jugando y la heap no sube en escalera (eso es una fuga).
- [ ] El loop se cancela al desmontar (`cancelAnimationFrame`, `destroy`, listeners).
- [ ] No se crean objetos por frame.
- [ ] Assets comprimidos; carga inicial por debajo de lo acordado.
- [ ] En móvil: la batería no se dispara y el dispositivo no se calienta en 3 minutos.

Específicos por stack:

| Stack | Chequeo extra |
|---|---|
| Canvas | DPR capeado, `clearRect` correcto, sin objetos por frame |
| Phaser/Pixi | Draw calls, pooling de sprites, atlas único, `destroy(true)` en cleanup |
| R3F | Estado fuera de React, geometrías/materiales compartidos, `dpr` limitado |
| VR | 72 fps sin caídas, foveation, sin sombras dinámicas |
| Native | Animación en hilo de UI, sin `setState` por frame, probado en Android e iOS |

## 4. Rewards y seguridad

Sólo si el juego entrega algo con valor. Ver `reward-economy-security`.

- [ ] El score se valida en el servidor.
- [ ] Un `POST` con un score absurdo se rechaza.
- [ ] El claim es idempotente: doble click no entrega dos premios.
- [ ] Los cooldowns se calculan con el reloj del servidor.
- [ ] Cambiar la hora del dispositivo no da intentos extra.
- [ ] El stock no se puede sobregirar con dos claims simultáneos.
- [ ] Queda auditoría de cada claim.

## 5. Playtest — con otra persona

Esto es lo que más información da y lo que más se saltea.

Sentá a alguien que no vio el juego, **no le expliques nada** y mirá:

- [ ] ¿Entendió qué hacer en los primeros 10 segundos?
- [ ] ¿Descubrió el control sin ayuda?
- [ ] ¿Entendió por qué perdió?
- [ ] ¿Quiso jugar de nuevo sin que se lo pidas?
- [ ] ¿Dónde se frustró?
- [ ] ¿En qué momento se aburrió?

Anotá **lo que hizo**, no lo que dijo. Si tuviste que explicarle algo, ese algo es un bug de diseño.

## 6. Accesibilidad

- [ ] `prefers-reduced-motion` respetado.
- [ ] Contraste del HUD ≥ 4.5:1.
- [ ] Ninguna información sólo por color.
- [ ] Sin parpadeo rápido.
- [ ] Navegable por teclado, con foco visible.
- [ ] Hay pausa.
- [ ] Audio con control de volumen y opción de silenciar; nada crítico sólo por audio.

## 7. Compatibilidad

- [ ] Chrome, Firefox y **Safari** (el que más rompe: audio, formatos, `backdrop-filter`).
- [ ] Móvil vertical y horizontal.
- [ ] Pantalla chica (360 px de ancho) y grande.
- [ ] Sin errores en consola.
- [ ] Funciona con la caché vacía.

## Salida esperada

Un reporte corto:

```txt
PROBADO EN:   navegadores y dispositivos reales
FPS:          escritorio / móvil, medidos
BLOQUEANTES:  lo que impide entregar
NO BLOQUEA:   lo que se puede dejar para después
PLAYTEST:     qué observaste, qué hay que arreglar del diseño
```

No cierres una tarea de juego sin este reporte.
