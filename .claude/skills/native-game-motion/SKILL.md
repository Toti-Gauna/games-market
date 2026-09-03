---
name: native-game-motion
description: "Crea minijuegos y experiencias gamificadas nativas con React Native, Reanimated, Gesture Handler, Lottie y haptics. Usala para mini-juegos native, animaciones de app con game feel o gamificación dentro de una app existente."
---

## Propósito

Resolver juegos casuales y gamificación **dentro de una app React Native**, sin traer un engine de juego y sin caer en el error clásico de animar desde el hilo de JavaScript.

## Cuándo usarla

- Minijuegos casuales dentro de una app (raspadito, ruleta, memotest, tap game, cartas).
- Gamificación: rachas, progreso, recompensas animadas, confetti.
- Animaciones de app con game feel (rebotes, arrastres, snap).

## Cuándo no usarla

- Juegos con loop de 60 fps y decenas de entidades: eso quiere un engine web en WebView o un motor nativo.
- 3D nativo. No fuerces `expo-gl` / three en React Native salvo que sea indispensable.
- Cualquier cosa que se resuelva mejor en web.

## Stack

- `react-native-reanimated` — animación en el hilo de UI.
- `react-native-gesture-handler` — gestos nativos.
- `lottie-react-native` — animaciones vectoriales complejas hechas por diseño.
- `expo-haptics` — feedback táctil.
- `react-native-svg` — formas y trazados si hacen falta.

## La regla que define todo

**La animación corre en el hilo de UI, no en el de JS.** En Reanimated eso significa `worklets`, valores compartidos y estilos animados. Si la animación pasa por `setState`, va a tironear en cuanto la app haga cualquier otra cosa.

```tsx
const x = useSharedValue(0);

const style = useAnimatedStyle(() => ({
  transform: [{ translateX: x.value }],
}));

const gesture = Gesture.Pan()
  .onUpdate((e) => {
    x.value = e.translationX;          // corre en el hilo de UI
  })
  .onEnd((e) => {
    x.value = withSpring(0, { damping: 14, stiffness: 180 });
  });
```

Para volver al mundo de React (actualizar un score, navegar), `runOnJS`. Usalo **sólo en los bordes**, no por frame.

## Qué animar

Sólo `transform` y `opacity`. Animar `width`, `height`, `margin` o `top` fuerza layout en cada frame y tira los fps en dispositivos de gama media.

Para tamaño usá `scale`. Para posición, `translateX/Y`.

## Game feel en native

| Efecto | Cómo |
|---|---|
| Tap satisfactorio | `scale` 0.94 al presionar, `withSpring` al soltar + haptic `Light` |
| Acierto | `scale` 1.0 → 1.12 → 1.0 con `withSequence` + haptic `Success` |
| Error | shake horizontal (3 oscilaciones, 6 px) + haptic `Error` |
| Racha | contador con `withTiming` y un pop en el cambio de decena |
| Recompensa | Lottie de confetti disparado una vez, no en loop |
| Arrastre | seguir el dedo 1:1, y al soltar `withSpring` al slot más cercano |

Los haptics son la mitad del game feel en móvil y cuestan una línea. No los omitas, pero no los dispares en cada frame.

## Lottie

- Sirve para lo que sería carísimo a mano: confetti, celebraciones, personajes.
- No sirve para nada interactivo: una vez que corre, no reacciona.
- Pedile a diseño el `.json` optimizado; los exports crudos de After Effects traen capas y expresiones que no se usan.
- Precargá antes de mostrarlo o vas a ver el salto.

## Loop de juego, si hace falta

Para un juego con loop real (algo cayendo, un timer que mueve cosas), usá `useFrameCallback` de Reanimated en vez de `setInterval`:

```tsx
useFrameCallback((info) => {
  const delta = (info.timeSincePreviousFrame ?? 16) / 1000;
  y.value += speed * delta;
});
```

`setInterval` en JS se desincroniza del refresco y produce tirones.

## Reglas de plataforma

- Probá en un dispositivo de gama media real, no en el simulador. El simulador miente sobre performance.
- Android e iOS difieren en haptics y en el timing de los springs: verificá los dos.
- Cuidá el consumo: un loop permanente vacía la batería. Pausalo cuando la app pierde foco (`AppState`).
- Respetá `Reduce Motion` del sistema (`AccessibilityInfo.isReduceMotionEnabled`).

## Salida esperada

- Gestos con Gesture Handler, animación con Reanimated, cero `setState` por frame.
- Haptics en las interacciones clave.
- Pausa automática al perder foco.
- Verificado en Android y iOS en dispositivo real.
