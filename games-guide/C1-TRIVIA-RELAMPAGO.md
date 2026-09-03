# C1 · Trivia relámpago

> **Tanda 4.** Requiere `03-BASES-CORPORATIVAS.md` y `02-BASES-NETCODE.md` cerradas.
> Categoría **Corporativo** · topología `arena` · 1 QR · esfuerzo **M** · motor `dom`

El juego que más se va a usar de los 24 en eventos de empresa. Y el primero donde el netcode
sirve para algo que no es un juego de reflejos.

---

## La idea

La pregunta se proyecta en la pantalla grande. Las opciones aparecen en el celular de cada uno.
Se contesta contra reloj, y **se puntúa por acertar y por ser rápido**.

Todo el mundo mira arriba, y eso es el punto: es una sala jugando a lo mismo al mismo tiempo, no
40 personas mirando su teléfono.

---

## La decisión de diseño que define el juego

**El celular muestra las opciones, no la pregunta.**

Es lo que hace que la gente levante la vista. Si la pregunta está en el teléfono, cada uno la lee
a su ritmo, contesta cuando quiere y la sala deja de existir como sala.

Pero eso deja afuera a quien no llega a leer la pantalla desde el fondo, o a quien tiene baja
visión. Así que:

- El celular muestra las opciones **grandes, con color y forma propia** — no basta el color.
- Un botón discreto **`Ver pregunta`** despliega el texto en el teléfono, para quien lo necesite.
- El proyector usa cuerpo grande de verdad: mínimo **48 px en el lienzo de 1920**, que es casi el
  doble del piso de legibilidad del chequeo previo de la Fase 2.

No es un compromiso a medias: la experiencia por defecto empuja a mirar arriba, y quien necesita
el texto lo tiene a un toque.

---

## Cómo puntúa

```
puntos del ítem = 1000 × acierto × (0.5 + 0.5 × tiempoRestante / tiempoTotal)
racha           = +100 por cada acierto consecutivo a partir del tercero, tope +500
```

Acertar sobre la chicharra da **500**; acertar al instante da **1000**. La mitad del puntaje es
por saber y la otra mitad por velocidad.

Esa proporción importa: si la velocidad pesa más, gana el que adivina rápido. Si pesa menos, no
hay tensión. Mitad y mitad es donde el juego premia saber **y** decidirse.

**Una respuesta incorrecta no resta.** Restar hace que la gente deje de contestar cuando no está
segura, y una sala que no contesta es una sala muerta.

---

## El problema de confianza

Este es el punto donde el juego se puede romper y nadie lo nota.

Si el celular manda *"acerté en 0,3 segundos"*, cualquiera con las herramientas de desarrollo
abiertas dice que contestó en 0,01 y gana siempre.

**El host es el único que mide el tiempo.**

1. El proyector marca `t0` al mostrar la pregunta y lo difunde con el enunciado.
2. El celular manda **sólo la opción elegida**, nunca un tiempo.
3. El proyector marca la llegada y calcula `Δ = llegada − t0 − (rtt / 2)`.
4. El `rtt` sale del ping continuo que ya lleva `GameNetPort`.

Descontar medio RTT compensa el viaje del paquete, para que no pierda el que tiene peor WiFi.
No es perfecto —nada lo es— pero mueve la ventaja de "quien miente" a "quien tiene mejor red", que
es un problema mucho menor y no se puede explotar a propósito.

Es la misma regla que ya rige el proyecto: **el host recibe input, nunca resultados.**

---

## Sincronía: lo que sí y lo que no hace falta

La tolerancia de latencia acá es **~200 ms**, no los 100 de Pong. Todos tienen que ver la pregunta
casi al mismo tiempo y la ventana tiene que cerrar junta, pero nadie está esquivando una pelota.

Eso significa que este juego **no necesita WebRTC**: funciona bien sobre cualquier transporte del
`GameNetPort`, incluido el mock y, el día que exista, un WebSocket común.

Lo que sí es obligatorio:

- La ventana **cierra en el host**, no en cada teléfono. Un celular con el reloj corrido no puede
  regalarse dos segundos extra.
- Las respuestas que llegan después del cierre **se descartan**, con aviso claro en el teléfono.
- Al cerrar, el host difunde la corrección y los puntos de todos a la vez.

---

## El ritmo

Un ciclo por pregunta, y el ritmo es la mitad del juego:

| Fase | Duración | Proyector | Celular |
|---|---|---|---|
| Anuncio | 2 s | `Pregunta 3 de 10` | Espera, con el color del jugador |
| Lectura | 3 s | Pregunta, **sin opciones** | Bloqueado, cuenta regresiva |
| Respuesta | 10–20 s | Pregunta + opciones + reloj | **Opciones, tocables** |
| Cierre | 3 s | Correcta resaltada + reparto | Acertaste / erraste + puntos |
| Ranking | 4 s | Top 5, con movimiento de posiciones | Tu posición |

Los **3 segundos de lectura antes de habilitar** son lo que evita que gane el que toca al azar
apenas aparecen los botones. Sin eso, la velocidad deja de medir conocimiento.

Cada 5 preguntas, ranking completo con las posiciones reacomodándose — es el momento que la gente
mira.

---

## El proyector

- Pregunta en cuerpo grande, centrada, con aire.
- Las cuatro opciones con **color y forma** propios, iguales a los del teléfono.
- Reloj como barra que se consume, no como número. Se lee de reojo.
- **Contador de respuestas** `23 de 41` que sube en vivo. Es lo que le dice al host cuándo cortar.
- Al cerrar: la correcta crece y se ilumina, las otras se apagan.
- Ranking con las filas moviéndose de posición, con `Flip` de la capa de motion.
- Los nombres se recortan a los primeros 20 si hay más — la lista completa no entra ni se lee.

---

## El celular

- Cuatro botones ocupando la pantalla entera. **Nada más.** Sin logo, sin menú, sin scroll.
- Cada uno con su color y su forma, ≥44 px con margen amplio.
- Al tocar: el botón se marca y los otros se atenúan. **No se puede cambiar** la respuesta.
- Feedback inmediato de que se registró, sin esperar al host.
- Vibración corta al confirmar.
- Tras cerrar: acertaste o no, puntos ganados, posición.
- Si llega tarde: *"Llegaste después del cierre"*, no un error.
- `Ver pregunta` disponible siempre durante la ventana.

---

## Contenido

Cuatro cuestionarios de ejemplo, como datos:

| Cuestionario | 10 preguntas sobre |
|---|---|
| `cultura` | Valores, historia y forma de trabajo de la empresa |
| `seguridad` | Phishing, contraseñas, datos sensibles |
| `producto` | Qué hace el producto y para quién |
| `mixto` | Las tres, para eventos generales |

Reglas de escritura:

- Una sola respuesta defendible. En trivia, a diferencia del test de perfil, la ambigüedad es un
  defecto.
- Enunciado de menos de 120 caracteres: tiene que leerse desde el fondo en 3 segundos.
- Opciones de menos de 40 caracteres.
- **Explicación de una línea** para el cierre. Es donde el juego enseña algo, y es la diferencia
  entre entretener y capacitar.
- Sin preguntas capciosas ni de memoria de fechas. Miden atención al detalle, no conocimiento.

---

## Qué usa de las bases

| De `_quiz/` | Para qué |
|---|---|
| `engine.ts` | Modo `score`, corrección, racha |
| `items/Choice.tsx` y `Image.tsx` | Los dos tipos que usa |
| `aggregate.ts` | `bars` para el reparto de respuestas |
| `content/` | Los cuatro cuestionarios |

| De `_net/` | Para qué |
|---|---|
| `GameNetPort` | Difundir pregunta, recibir opción, difundir resultado |
| `GamepadController` layout `buttons` | Los cuatro botones del teléfono |
| `rttMs` | Compensar latencia en el tiempo de respuesta |

---

## Qué NO hacer

- **No** mandar el tiempo de respuesta desde el celular.
- **No** cerrar la ventana en el teléfono.
- **No** mostrar la pregunta en el celular por defecto.
- **No** restar puntos por errar.
- **No** habilitar los botones antes de los 3 segundos de lectura.
- **No** distinguir opciones sólo por color.
- **No** dejar cambiar la respuesta una vez tocada.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Diez preguntas con 5 celulares reales, de principio a fin.
3. **La prueba de confianza:** un cliente modificado que manda un tiempo falso **no cambia su
   puntaje**. El host ignora cualquier tiempo que venga del celular.
4. Con 300 ms de latencia simulada en un cliente y 50 en otro, los dos contestando igual de
   rápido sacan **puntajes dentro del 5 %**.
5. Una respuesta que llega después del cierre se descarta y el teléfono lo dice.
6. Con la ventana en 10 s, contestar al instante da ~1000 y sobre la chicharra ~500.
7. La racha suma a partir del tercer acierto y topea en 500.
8. Los botones no responden durante los 3 segundos de lectura.
9. `Ver pregunta` muestra el enunciado en el teléfono.
10. Las cuatro opciones se distinguen **sin color**, en escala de grises.
11. Con 40 participantes, el ranking del proyector se lee y no se desborda.
12. `force-end` a mitad emite outcomes con lo acumulado hasta ahí.
13. Un participante que entra en la pregunta 4 juega de la 5 en adelante, sin romper el ranking.
14. Cero errores de consola en las tres superficies.

---

## Entrada en el registry

```ts
{
  id: "trivia-relampago",
  title: "Trivia relámpago",
  description: "La pregunta en la pantalla grande, las opciones en tu celular. Rápido.",
  category: "corporativo",
  status: "beta",
  enabled: false,        // multijugador: llega apagado
  engine: "dom",
  topology: "arena",
  needsNet: true,
  minPlayers: 2,
  maxPlayers: 200,
  qrSlots: 1,
  estimatedMin: 8,
  inputs: ["touch"],
  tags: ["corporativo", "competencia", "sala", "capacitación"],
  mode: "internal",
  load: () => import("./triviaRelampago/TriviaRelampagoGame"),
}
```
