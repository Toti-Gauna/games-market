# C3 · Formulario vivo

> **Tanda 2.** Requiere `03-BASES-CORPORATIVAS.md` cerrada.
> Categoría **Corporativo** · topología `solo` · 1 QR · esfuerzo **S** · motor `dom`

El consumidor del modo `survey`, y el que **ejercita los ocho tipos de ítem** del motor. Si un
tipo de ítem está mal implementado, se descubre acá.

Es también la respuesta a un caso real: una empresa que quiere tomar una encuesta a 200 personas
en una sala, sin mandar un link por mail que contesta el 30 % tres días después.

---

## La idea

Una encuesta que no se siente una encuesta. Progreso visible, una pregunta por pantalla,
micro-respuestas al avanzar, y **el proyector mostrando los resultados aparecer en vivo**.

La diferencia con un formulario común es esa última parte: contestás y ves tu respuesta sumarse a
la de todos, proyectada. Eso sube la tasa de respuesta más que cualquier recordatorio.

---

## Los ocho tipos, ejercitados

La encuesta de ejemplo usa **todos** los tipos del motor, a propósito:

| # | Tipo | Pregunta de ejemplo | Proyector muestra |
|---|---|---|---|
| 1 | `scale` | ¿Qué tan claro está el objetivo del trimestre? (1–5) | Promedio y distribución |
| 2 | `choice` | ¿Qué te frena más hoy? | Barras |
| 3 | `multiple` | ¿En qué áreas necesitás apoyo? | Barras, suma > 100 % |
| 4 | `boolean` | ¿Sentís que tu trabajo se ve? | Dos números grandes |
| 5 | `order` | Ordená estas 5 prioridades | Posición promedio |
| 6 | `text` | Una palabra que describa el trimestre | **Nube de palabras** |
| 7 | `image` | ¿Cuál representa mejor al equipo? | Barras con miniatura |
| 8 | `match` | Uní cada valor con lo que significa para vos | Pares más elegidos |

Ocho preguntas, ocho tipos. Sirve de encuesta real y de banco de pruebas del motor al mismo
tiempo.

---

## Sin puntaje, y eso es una decisión

Modo `survey`:

```ts
onFinished({
  screenId: config.screenId,
  participantId: config.participantId,
  completed: true,
  points: 0,
  durationMs,
  meta: { answers: { q1: 4, q2: "tiempo", q3: ["a","c"], … }, answered: 8, skipped: 0 },
});
```

`points: 0` con `completed: true`. Un formulario que reparte puntos mete en el ranking del tour un
número que no significa nada, y peor: incentiva contestar rápido en vez de contestar en serio.

**Consecuencia que hay que tener presente:** si un tour es sólo formularios, su ranking queda todo
en cero. Está bien y es lo correcto — pero el chequeo previo de la Fase 2 (Etapa 12) debería
avisar de un tour con pantalla de ranking y ningún juego que puntúe. Vale la pena agregar ese
chequeo cuando se implemente.

---

## Anonimato

Es lo que decide si las respuestas sirven.

- La encuesta declara `anonymous: boolean`.
- Con `anonymous: true`, el `meta` del outcome **no lleva `participantId`** identificable en la
  agregación: el proyector nunca puede mostrar quién dijo qué.
- La pantalla del teléfono **lo dice explícitamente** antes de empezar: *"Tus respuestas se
  muestran sumadas al resto. Nadie ve cuál fue la tuya."*
- Con `anonymous: false`, lo dice igual de claro al revés.

Prometer anonimato y no cumplirlo es peor que no prometerlo. Si el `meta` viaja con el
`participantId` porque el port lo pide, entonces la agregación tiene que descartarlo antes de
proyectar, y eso hay que verificarlo.

---

## Poder saltear

Toda pregunta se puede saltear salvo las marcadas `required`. Una encuesta que obliga a contestar
todo obtiene respuestas inventadas en las que no aplican.

El progreso distingue contestadas de salteadas, y al final se puede volver a las salteadas.

---

## En el proyector

Es la mitad del valor. Mientras la gente responde:

- La pregunta actual en grande, con el agregado creciendo debajo.
- Contador de respuestas: `47 de 62`.
- La nube de palabras armándose es el momento que la gente mira.

**El texto libre pasa por el filtro de palabras del motor antes de proyectarse.** Es un evento de
empresa con una pantalla de tres metros: alguien va a probar. El filtro no es opcional.

Además, un tope: la nube muestra hasta 40 palabras, las más repetidas. Con 200 respuestas, sin
tope es ilegible.

---

## Presentación

- Una pregunta por pantalla, progreso arriba, `Saltear` abajo si aplica.
- Micro-respuesta al avanzar: un tilde breve, sin bloquear.
- **Sin temporizador.** Es una encuesta.
- Al terminar: agradecimiento y, si la encuesta lo permite, el agregado en el propio teléfono.
- Objetivos táctiles ≥44 px, separación ≥8.

Con `prefers-reduced-motion`: sin transición lateral, sin animación del tilde.

---

## Qué usa de la base

| De `_quiz/` | Para qué |
|---|---|
| `engine.ts` | Modo `survey`, avance, salteo |
| `items/` | **Los ocho** renderers |
| `aggregate.ts` | `bars`, `scale`, `cloud`, `ranking` |
| `QuizRunner.tsx` | El runner del celular |
| `QuizProjector.tsx` | La vista de la sala, con el filtro de texto |
| `content/` | Las ocho preguntas |

Igual que el test de perfil: **contenido más configuración**, sin lógica propia.

---

## Qué NO hacer

- **No** puntuar.
- **No** obligar a contestar todo.
- **No** proyectar texto libre sin filtrar.
- **No** poner temporizador.
- **No** mostrar quién respondió qué si la encuesta es anónima. Ni en el proyector, ni en el
  `meta`, ni en la consola.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. El juego es **contenido más configuración**, sin lógica propia.
3. Los **ocho tipos de ítem** se responden correctamente en un teléfono real. Es el criterio que
   valida el motor entero.
4. El outcome emite `points: 0`, `completed: true` y todas las respuestas en `meta`.
5. **Responder no cambia el ranking del tour.**
6. Saltear una pregunta opcional funciona; una `required` no se puede saltear.
7. Al final se puede volver a las salteadas.
8. El proyector actualiza el agregado en vivo, con el contador de respuestas.
9. **Con `anonymous: true`, no hay forma de saber quién respondió qué** — verificado inspeccionando
   lo que recibe el proyector, no sólo lo que muestra.
10. Una respuesta de texto con una palabra vetada **no se proyecta**.
11. Con 200 respuestas simuladas, la nube muestra 40 palabras y sigue legible.
12. `force-end` a mitad emite lo respondido con `completed: false`.
13. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "formulario-vivo",
  title: "Pulso del equipo",
  description: "Ocho preguntas. Los resultados aparecen en pantalla mientras respondés.",
  category: "corporativo",
  status: "estable",
  enabled: true,
  engine: "dom",
  topology: "solo",
  needsNet: false,
  minPlayers: 1,
  maxPlayers: 1,
  qrSlots: 1,
  estimatedMin: 5,
  inputs: ["touch"],
  tags: ["corporativo", "sin puntaje", "encuesta", "anónimo"],
  mode: "internal",
  load: () => import("./formularioVivo/FormularioVivoGame"),
}
```

---

## Nota sobre el solapamiento con Pulso

La **Fase 2b** propone *Pulso*: bloques de encuesta, nube de palabras y escala **dentro de una
pantalla de contenido**, sin ser un juego.

Los dos tienen sentido y no se pisan:

- **Formulario vivo** es una experiencia completa de 5 minutos, con su QR y su pantalla. Sirve
  para tomar una encuesta seria.
- **Pulso** es una pregunta suelta metida en medio de una slide, de 30 segundos, para tomar la
  temperatura sin cortar la presentación.

Cuando se implemente Pulso, **debería reutilizar los renderers y la agregación de `_quiz/`**. Si
termina con su propia implementación de nube de palabras, algo se hizo dos veces.
