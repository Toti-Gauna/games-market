# C2 · Test de perfil

> **Tanda 2.** Requiere `03-BASES-CORPORATIVAS.md` cerrada.
> Categoría **Corporativo** · topología `solo` · 1 QR · esfuerzo **S** · motor `dom`

El primer consumidor del motor de quiz en modo `profile`. Y probablemente el juego que más se use
del catálogo: no compite, no exige reflejos, y todo el mundo quiere saber qué le tocó.

---

## La idea

Doce preguntas de situación laboral. Cada respuesta suma peso a uno o más **arquetipos**. Al
terminar, la persona ve el suyo con una explicación breve, y **el proyector muestra cómo se
reparte el equipo**.

El valor no está en el resultado individual: está en la pantalla grande mostrando que el equipo
tiene ocho Constructores y ningún Explorador. Eso abre una conversación, que es para lo que se
usa en un evento.

---

## Los arquetipos

Cinco. Sin ganadores ni perdedores: es la diferencia entre una herramienta que se usa y una que
incomoda.

| Arquetipo | En una frase |
|---|---|
| **Explorador** | Va primero, prueba, y después pregunta |
| **Constructor** | Convierte ideas en cosas que funcionan |
| **Conector** | Hace que la información llegue a quien la necesita |
| **Guardián** | Ve el riesgo que los demás no ven |
| **Estratega** | Piensa dos movimientos más adelante |

Cada uno tiene su color de la paleta de marca, su forma —del set SVG de la Fase 1— y un párrafo
de descripción. **Ninguno se describe en negativo.**

---

## Las preguntas

Doce ítems tipo `choice` con cuatro opciones, cada una con pesos:

```ts
{
  id: "q1",
  type: "choice",
  prompt: "Llega un proyecto nuevo sin definición clara. ¿Qué hacés primero?",
  correct: null,                       // modo profile: no hay correcta
  options: [
    { id: "a", label: "Armo un prototipo para ver qué pasa" },
    { id: "b", label: "Busco a quien ya hizo algo parecido" },
    { id: "c", label: "Escribo qué puede salir mal" },
    { id: "d", label: "Dibujo cómo encaja con lo que ya existe" },
  ],
  weights: {
    a: { explorador: 3, constructor: 1 },
    b: { conector: 3, estratega: 1 },
    c: { guardian: 3, estratega: 1 },
    d: { estratega: 3, constructor: 1 },
  },
}
```

**Reglas de escritura, que son lo que hace que el test sirva:**

- Situaciones concretas de trabajo, no rasgos de personalidad. "¿Qué hacés cuando…?" y no "¿Sos
  una persona ordenada?".
- Las cuatro opciones tienen que ser **defendibles**. Si una es obviamente la buena, el test mide
  quién adivina lo que la empresa quiere oír.
- Pesos repartidos: cada opción suma a dos arquetipos, no a uno. Evita resultados de 12 a 0 y hace
  que el resultado se sienta matizado.
- Nada de preguntas sobre vida privada, salud, política ni creencias. Es un evento de trabajo.

---

## El resultado

Individual, en el teléfono:

```
        ◆
   EXPLORADOR
   
   Vas primero, probás,
   y después preguntás.

   ▓▓▓▓▓▓▓▓░░  Explorador  34%
   ▓▓▓▓▓░░░░░  Constructor 22%
   ▓▓▓▓░░░░░░  Estratega   18%
   ▓▓▓░░░░░░░  Conector    14%
   ▓▓░░░░░░░░  Guardián    12%
```

Se muestra el perfil dominante **y la mezcla completa**. Nadie es 100 % de una cosa, y mostrar
sólo el ganador hace que el resultado se sienta arbitrario a quien quedó 34 % contra 32 %.

Si los dos primeros están dentro de 5 puntos, se muestran los dos: *"Explorador con mucho de
Constructor"*.

---

## En el proyector

La agregación en vivo del motor, tipo `profiles`:

- Cinco columnas creciendo mientras la gente responde.
- Cuando alguien termina, su nombre aparece brevemente sobre su arquetipo.
- Al cerrar: el reparto final del equipo, con el conteo.

Es lo que convierte doce preguntas en un momento de la presentación.

---

## El outcome

Modo `profile`: **no puntúa**.

```ts
onFinished({
  screenId: config.screenId,
  participantId: config.participantId,
  completed: true,
  points: 0,
  durationMs,
  meta: {
    profile: "explorador",
    scores: { explorador: 34, constructor: 22, estratega: 18, conector: 14, guardian: 12 },
    answered: 12,
  },
});
```

`points: 0` a propósito. Un test de perfil que reparte puntos ensucia el ranking del tour con un
número que no significa nada: nadie "gana" un test de personalidad. El valor está en `meta`.

---

## Presentación

- Una pregunta por pantalla, con progreso `4 / 12`.
- Las cuatro opciones como tarjetas grandes, apiladas. **Objetivo táctil ≥44 px**, separación ≥8.
- Al elegir: la tarjeta se marca y avanza sola tras 250 ms. Sin botón "siguiente" — son doce
  preguntas y un toque de más por pregunta se nota.
- **Se puede volver atrás** una pregunta. Alguien va a tocar sin querer.
- Transición lateral entre preguntas, con la capa de motion de la Fase 1.
- Sin temporizador visible. Este test no es una carrera y poner reloj cambia las respuestas.

Con `prefers-reduced-motion`: sin deslizamiento lateral, cambio directo.

---

## Qué usa de la base

| De `_quiz/` | Para qué |
|---|---|
| `engine.ts` | Modo `profile`, avance, pesos, cálculo del arquetipo |
| `items/Choice.tsx` | El único tipo de ítem que usa |
| `aggregate.ts` | Agregado `profiles` para el proyector |
| `QuizRunner.tsx` | El runner del celular |
| `QuizProjector.tsx` | La vista de la sala |
| `content/` | Las doce preguntas, como datos |

**El juego en sí es un archivo de contenido más una configuración.** Si hace falta escribir lógica
nueva, la base corporativa está incompleta.

---

## Qué NO hacer

- **No** puntuar. `points: 0`.
- **No** mostrar sólo el arquetipo ganador sin la mezcla.
- **No** describir ningún arquetipo en negativo.
- **No** preguntar por vida privada, salud, política ni creencias.
- **No** poner temporizador.
- **No** barajar las opciones dentro de una pregunta: el orden está pensado para que los pesos
  queden repartidos y barajarlo no aporta nada acá.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. El juego es **contenido más configuración**, sin lógica propia. Si hubo que escribir lógica, la
   base corporativa se completa primero.
3. Responder las doce preguntas devuelve un arquetipo coherente con los pesos, verificable a mano.
4. El resultado muestra la **mezcla completa**, no sólo el dominante.
5. Con los dos primeros dentro de 5 puntos, se muestran los dos.
6. El outcome emite `points: 0`, `completed: true` y el perfil en `meta`.
7. **Jugarlo no cambia el ranking del tour.**
8. El proyector muestra las cinco columnas actualizándose mientras se responde.
9. Volver atrás una pregunta funciona y recalcula.
10. `force-end` a mitad emite lo respondido con `completed: false`.
11. Todos los objetivos táctiles miden ≥44 px, verificado en un teléfono real.
12. **Inspeccionar el DOM no revela los pesos** de las opciones antes de responder.
13. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "test-de-perfil",
  title: "¿Cómo trabajás?",
  description: "Doce situaciones. Descubrí tu perfil y el del equipo.",
  category: "corporativo",
  status: "estable",
  enabled: true,
  engine: "dom",
  topology: "solo",
  needsNet: false,
  minPlayers: 1,
  maxPlayers: 1,
  qrSlots: 1,
  estimatedMin: 4,
  inputs: ["touch"],
  tags: ["corporativo", "sin puntaje", "equipo", "conversación"],
  mode: "internal",
  load: () => import("./testDePerfil/TestDePerfilGame"),
}
```
