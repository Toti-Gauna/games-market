# M4 · Saltarín

> **Tanda 5.** Requiere `00-BASES-2D.md` cerrada.
> Categoría **Moderno** · topología `solo` · 1 QR · esfuerzo **M** · motor `canvas2d`

Doodle Jump con **inclinación del teléfono**. Es el único de los 24 que se juega moviendo el
dispositivo, y eso lo hace memorable: en una sala, la gente inclinando el celular se ve, y se
contagia.

---

## La idea

Una nave sube saltando de plataforma en plataforma. Se mueve a izquierda y derecha **inclinando el
teléfono**. Se cae, se termina. El puntaje es la altura alcanzada.

---

## El giroscopio: lo que hace o rompe este juego

Es la parte difícil y la que hay que acertar. Un juego de inclinación mal calibrado es
insoportable a los diez segundos.

### El permiso en iOS

Desde iOS 13, `DeviceOrientationEvent` **requiere permiso explícito pedido desde un gesto del
usuario**:

```ts
if (typeof DeviceOrientationEvent.requestPermission === "function") {
  const res = await DeviceOrientationEvent.requestPermission();  // sólo dentro de un click/touch
}
```

No se puede pedir al montar. La base ya expone `requestTilt()`; el juego muestra una pantalla
previa con un botón **`Activar control por movimiento`**, y ese toque es el que dispara el pedido.

### La calibración es obligatoria

Nadie sostiene el teléfono perfectamente plano. Si el cero es el cero absoluto del sensor, el
jugador tiene que sostenerlo en una postura incómoda toda la partida.

La solución, en la misma pantalla previa:

> *Sostené el teléfono como te resulte cómodo y tocá `Listo`.*

Ese ángulo se guarda como **cero**, y todo se mide relativo a él. Es un paso de dos segundos que
cambia por completo cómo se siente el juego.

Además, **recalibración a mitad**: un toque de dos dedos vuelve a fijar el cero. La gente cambia
de postura, se sienta, se recuesta.

### Los números

| | Valor |
|---|---|
| Rango útil | ±25° desde el cero calibrado |
| Zona muerta | ±2°, para que quieto sea quieto |
| Velocidad máxima horizontal | 420 px/s en el extremo del rango |
| Curva | Cuadrática, no lineal: inclinaciones chicas mueven poco, grandes mucho |
| Suavizado | Media móvil de 3 lecturas |

**La curva cuadrática y la zona muerta son lo que separa un control preciso de uno nervioso.** El
sensor es ruidoso; sin suavizado, la nave tiembla parada.

### El fallback no es opcional

Si el permiso se niega, si el dispositivo no tiene giroscopio, o si es desktop: **el juego se
juega tocando las mitades izquierda y derecha de la pantalla**, o con las flechas.

Un juego que muere sin sensor está mal hecho. El giroscopio es la forma preferida, no la única.

---

## Reglas

| | |
|---|---|
| Mundo | 480 × 800, vertical |
| Gravedad | 1400 px/s² |
| Impulso de salto | −620 px/s, automático al tocar una plataforma desde arriba |
| Wrap horizontal | **Sí**: salir por un lado entra por el otro |
| Separación de plataformas | 70 px inicial, hasta 130 px con la altura |
| Cámara | Sube con la nave, **nunca baja** |
| Fin | Caer por debajo de la cámara, o `gameDurationMs` |

El wrap horizontal **sí va acá**, al revés que en Serpiente: en un juego de subir, salir por un
costado y volver por el otro es parte del movimiento y evita quedarse trabado contra un borde.

### Tipos de plataforma

| Tipo | Qué hace | Aparece desde |
|---|---|---|
| Normal | Rebote estándar | Altura 0 |
| Móvil | Se desplaza horizontal | 1.500 |
| Frágil | Se rompe al pisarla | 3.000 |
| Impulso | Rebote doble | 5.000 |

La progresión de tipos con la altura es lo que hace que el juego no se agote en 30 segundos.

### Puntos

```ts
const points = Math.floor(alturaMaxima / 10) + plataformasImpulso * 50;
```

Altura como métrica principal, directa y comparable. El bono por plataformas de impulso premia
buscarlas en vez de ir a lo seguro.

---

## Presentación

- Nave con degradé `--sn-violet` → `--sn-magenta`, que **se inclina hacia donde se mueve**.
- Plataformas: normales en cian tenue, móviles con un brillo, frágiles agrietadas, de impulso
  pulsando en magenta.
- Fondo con dos capas de parallax vertical: cuanto más alto, más oscuro y más estrellas.
- **Marcas de altura** cada 1.000: una línea tenue con el número. Da sensación de progreso.
- Al saltar: partículas debajo y una compresión breve de la nave.
- Al caer: la cámara sigue un momento la caída antes del resumen. Ver la caída es parte del juego.

Con `prefers-reduced-motion`: sin parallax, sin partículas, sin compresión.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en celular de gama media |
| Plataformas activas | ~14 en pantalla, recicladas |
| Partículas | máx. 60, pooleadas |
| Lecturas de sensor | Las que emita el dispositivo, típicamente 60 Hz, suavizadas |

Las plataformas se **reciclan**: la que sale por abajo reaparece arriba con tipo y posición nuevos
del PRNG sembrado. Nunca se crea ni se destruye una.

---

## Qué usa de la base

| De `_engine/` | Para qué |
|---|---|
| `useGame2D` | Montaje, loop, duración, `force-end`, outcome |
| `loop.ts` | Timestep fijo. Con gravedad, delta variable cambia la altura del salto |
| `input.ts` | **`tilt` con `requestTilt()`**, más `pointer` y `keys` de fallback |
| `rng.ts` | Posición y tipo de cada plataforma, sembrado |
| `pool.ts` | Plataformas y partículas |
| `camera.ts` | Seguimiento vertical con tope |
| `collide.ts` | AABB, sólo desde arriba y con velocidad descendente |
| `hud.tsx` | Altura, marcas, fin |

**La colisión sólo cuenta cayendo.** Si contara siempre, la nave se pegaría a la plataforma al
subir y el juego se rompe. Es el bug clásico del género.

---

## Qué NO hacer

- **No** pedir el permiso de giroscopio al montar: sólo desde un gesto.
- **No** usar el cero absoluto del sensor: hay que calibrar.
- **No** mapeo lineal ni sin zona muerta.
- **No** dejar el juego injugable sin giroscopio.
- **No** colisionar al subir.
- **No** delta variable.
- **No** generar plataformas con `Math.random()`: van sembradas, para que el recorrido sea
  comparable entre participantes.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. **En un iPhone real**: aparece la pantalla de permiso, el botón lo pide, y tras aceptar el
   control funciona.
3. **La calibración funciona**: sosteniendo el teléfono a 20° y calibrando, quieto significa
   quieto.
4. La recalibración con dos dedos vuelve a fijar el cero.
5. **Negar el permiso deja el juego jugable** tocando las mitades de la pantalla.
6. En desktop se juega con flechas.
7. La nave no tiembla estando el teléfono quieto (zona muerta y suavizado).
8. La nave **no se pega** a las plataformas al subir.
9. Con la misma semilla, las plataformas aparecen en las mismas posiciones y tipos.
10. La altura del salto es idéntica a 30 fps y a 60, verificado con CPU throttling.
11. 60 fps con 14 plataformas y partículas.
12. Cero recolecciones de basura en 60 segundos.
13. `force-end` emite el outcome con la altura alcanzada.
14. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "saltarin",
  title: "Saltarín",
  description: "Inclíná el teléfono para moverte. Subí todo lo que puedas.",
  category: "moderno",
  status: "estable",
  enabled: true,
  engine: "canvas2d",
  topology: "solo",
  needsNet: false,
  minPlayers: 1,
  maxPlayers: 1,
  qrSlots: 1,
  estimatedMin: 3,
  inputs: ["tilt", "touch", "keyboard"],
  tags: ["moderno", "giroscopio", "individual", "vertical"],
  mode: "internal",
  load: () => import("./saltarin/SaltarinGame"),
}
```

> El catálogo de juegos (Fase 2, Etapa 09) usa `inputs` para avisar cuando un dispositivo no tiene
> los sensores que el juego prefiere. Este es el caso para el que existe ese campo.
