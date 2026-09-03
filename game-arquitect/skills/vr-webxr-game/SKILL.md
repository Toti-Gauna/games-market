---
name: vr-webxr-game
description: "Diseña prototipos y juegos VR con WebXR, React Three Fiber y @react-three/xr, priorizando confort, input simple, performance y sesiones cortas. Usala para headset, controllers, gaze/tap interaction, teleport o comfort rules."
---

## Propósito

VR no es 3D con dos cámaras. Cambia el presupuesto de performance, el input, el diseño de UI y —sobre todo— **el confort del usuario**, que es un requisito de salud, no una preferencia.

## Cuándo usarla

- Experiencias VR/WebXR en navegador.
- Prototipos para Quest, Vision Pro u otros headsets.
- Interacción con controllers, manos, gaze o teleport.

## Cuándo no usarla

- 3D en pantalla plana: `react-three-fiber-game`.
- "VR" que en realidad es un panorama 360 con hotspots: eso es un visor, no un juego.

## Stack

`three` + `@react-three/fiber` + `@react-three/xr` + `@react-three/drei`.

```tsx
const store = createXRStore();

<button onClick={() => store.enterVR()}>Entrar en VR</button>
<Canvas>
  <XR store={store}>
    <Scene />
  </XR>
</Canvas>
```

La sesión XR **sólo puede iniciarse desde un gesto del usuario**. No hay autoplay en VR.

## Confort: las reglas que no se negocian

El mareo (cybersickness) aparece cuando lo que el ojo ve no coincide con lo que el oído interno siente.

1. **Nunca muevas la cámara sin que el usuario lo pida.** Cero cámara automática, cero cinemáticas con desplazamiento, cero shake.
2. **Teleport por defecto** para desplazarse. El movimiento continuo es opcional y va con viñeta (túnel que oscurece la periferia al moverse).
3. **Nunca gires la cámara por el usuario.** Rotación por snap (30-45° por click), no continua.
4. **Framerate estable > detalle.** Un frame perdido en VR se siente físicamente. Preferí bajar la calidad antes que perder fps.
5. **Horizonte estable.** No inclines el mundo.
6. **Sin aceleración.** Arranques y frenados instantáneos marean menos que rampas.
7. **Sesión corta.** Diseñá para 3-10 minutos. Si necesita más, hay que ofrecer pausa cómoda.

## Presupuesto de performance

VR renderiza **dos veces por frame** a 72-90 Hz. El presupuesto es aproximadamente la mitad que en escritorio, con el doble de exigencia.

| Recurso | Objetivo Quest |
|---|---|
| Triángulos | < 100 k |
| Draw calls | < 80 |
| Luces con sombra | 0-1 |
| Texturas | 1024², KTX2 |
| Framerate | 72 fps sostenidos, sin caídas |

- Iluminación bakeada siempre que se pueda.
- `foveation` activado.
- Postprocessing: prácticamente nada.
- Sin sombras dinámicas salvo que el juego dependa de ellas.

## Input

Diseñá para el input más simple que resuelva la experiencia, en este orden:

1. **Gaze + tap** — mirar y confirmar. Funciona en todos los dispositivos, incluido mobile cardboard.
2. **Controller ray + trigger** — apuntar y disparar. El estándar de Quest.
3. **Manos (hand tracking)** — sólo si la interacción física aporta algo real.

Reglas:

- Objetivos grandes: mínimo 2-3° de ángulo visual.
- Nada interactivo a menos de 0.5 m ni a más de 3 m de la cabeza.
- Feedback inmediato: highlight al apuntar, haptic al tocar, sonido al confirmar.
- Todo lo interactivo tiene que verse interactivo antes de tocarlo.

## UI en VR

- **La UI vive en el mundo, no pegada a la cara.** Un panel anclado a la cámara marea y no se puede mirar.
- Panel a ~1.5-2 m, ligeramente por debajo de la línea de horizonte, inclinado hacia el usuario.
- Texto grande: lo que en pantalla es 16 px, en VR necesita el equivalente a 30-40 px.
- Alto contraste. Las pantallas de headset pierden detalle en sombras.
- Nada de scroll fino ni de listas largas.

## Fallback

Un WebXR sin fallback es una página en blanco para el 95 % de los visitantes.

- Detectá soporte: `navigator.xr?.isSessionSupported("immersive-vr")`.
- Sin soporte, mostrá la escena en pantalla plana con controles orbitales, o un mensaje claro con qué dispositivo hace falta.
- Nunca dejes el botón "Entrar en VR" activo si no hay sesión posible.

## Accesibilidad

- Modo sentado y modo de pie, con altura configurable.
- Opción de mano dominante.
- Subtítulos para cualquier audio con información.
- Salida de la sesión siempre accesible.
- Respetá `prefers-reduced-motion` bajando aún más el movimiento.

## Salida esperada

- Entrada a la sesión desde gesto explícito, con fallback 2D.
- Locomoción por teleport y rotación por snap.
- Presupuesto medido en el dispositivo objetivo, no en el emulador.
- Lista de comprobación de confort revisada antes de entregar.
