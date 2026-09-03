# C6 · Verdadero o falso

> **Tanda 4.** Requiere `03-BASES-CORPORATIVAS.md` y `02-BASES-NETCODE.md` cerradas.
> Se implementa **después de C1 Trivia**: comparte casi toda la infraestructura.
> Categoría **Corporativo** · topología `arena` · 1 QR · esfuerzo **S** · motor `dom`

Cinco minutos, mucha tensión, y sirve de cierre o de rompehielo. Es el hermano rápido de la
trivia y reutiliza casi todo lo suyo.

---

## La idea

Diez afirmaciones. **Cinco segundos cada una.** Verdadero o falso, dos botones enormes.

La diferencia con la trivia no es tener dos opciones en vez de cuatro: es el **formato de
supervivencia**. Errás y quedás fuera de la carrera principal. El proyector muestra cuánta gente
queda en pie, y ese número bajando es todo el juego.

---

## El problema del formato de eliminación, y cómo se resuelve

La eliminación genera tensión, pero tiene un defecto obvio: **el que sale en la pregunta 2 se
queda ocho preguntas mirando el techo**. En una sala, eso es gente sacando el teléfono para otra
cosa.

La solución: **nadie deja de jugar.**

- Quien se equivoca sale de la **carrera de supervivencia**, pero sigue contestando.
- Sus aciertos suman a un **puntaje de honor** con su propio ranking.
- El proyector muestra las dos cosas: `Quedan 12` arriba, y el ranking de puntos al costado.
- En la afirmación 6 hay **repesca**: quien acierte esa vuelve a la carrera. Reinyecta a media
  sala justo cuando el interés empezaba a caer.

Dos carreras en paralelo con la misma mecánica. El que sobrevive gana; el que cayó primero pero
acertó nueve de diez tiene su reconocimiento.

---

## Modos

La experiencia declara cuál usa:

| Modo | Qué pasa al errar | Cuándo usarlo |
|---|---|---|
| `supervivencia` | Salís de la carrera, seguís sumando puntos. Repesca en la 6 | **Default.** Es el que genera el momento |
| `puntos` | Nada, todos juegan las 10 | Cuando importa medir a todos por igual |

---

## Puntaje

```
acierto      = 200 × (0.5 + 0.5 × tiempoRestante / 5s)
supervivencia = +150 por cada afirmación superada estando vivo
ganador       = +500 si sobrevive las 10
```

Con cinco segundos de ventana, el rango por acierto va de 100 a 200. El bono por seguir vivo pesa
más que la velocidad, que es lo correcto: acá lo que se premia es no equivocarse.

**Errar no resta.** Ya cuesta la eliminación; restar además es castigar dos veces.

---

## El ritmo

Cinco segundos es muy poco tiempo, y eso obliga a que la lectura sea perfecta:

| Fase | Duración | Proyector | Celular |
|---|---|---|---|
| Anuncio | 1,5 s | `Afirmación 3 de 10` · `Quedan 24` | Espera |
| Lectura | 2 s | La afirmación, **botones bloqueados** | Cuenta regresiva |
| Respuesta | **5 s** | Afirmación + barra que se consume | **V / F**, tocables |
| Cierre | 2,5 s | Correcta + explicación + cuántos cayeron | Seguís / caíste |

**Los 2 segundos de lectura antes de habilitar son más críticos acá que en la trivia.** Con cinco
segundos de ventana, sin ese margen el juego premia el reflejo y no el criterio.

Las afirmaciones tienen que leerse en dos segundos: **máximo 90 caracteres**. Es una restricción
de escritura dura, no una sugerencia.

---

## El proyector

- La afirmación en cuerpo enorme, centrada. Es lo único en pantalla.
- Barra de 5 segundos que se consume, en `--sn-cyan` y virando a `--sn-magenta` al final.
- **`Quedan 24`** arriba, en mono tabular, grande. Es el marcador real del juego.
- Al cerrar: `VERDADERO` o `FALSO` en grande, la explicación en una línea, y **cuántos cayeron**
  con esa afirmación.
- Cuando alguien queda eliminado, su nombre baja de la lista de vivos con una transición corta.
  Verlo caer es parte del juego.
- Al final: el sobreviviente, o los que quedaron; y el ranking de puntos al lado.

Si con una afirmación **cae más de la mitad de la sala**, el proyector lo destaca: *"Esa la falló
el 70 %"*. Es el momento que genera conversación, y es información útil para quien capacita.

---

## El celular

- **Dos botones, mitad y mitad de la pantalla.** Verdadero arriba, falso abajo.
- Distinguibles sin color: uno con tilde, otro con cruz, del set de iconos de la Fase 1.
- Al tocar: se marca, el otro se atenúa, no se puede cambiar.
- Vibración corta al confirmar.
- Al caer: la pantalla lo dice claro y **cambia de modo**, mostrando `Seguís jugando por puntos`.
  No es un cartel de derrota: es un cambio de carrera.
- En la afirmación 6, si está eliminado: **`REPESCA — acertá y volvés`**, bien visible.

---

## Contenido

Cuatro juegos de diez afirmaciones:

| Juego | Sobre |
|---|---|
| `seguridad` | *"Un link de un remitente conocido siempre es seguro."* → Falso |
| `cultura` | Prácticas y valores reales de la empresa |
| `producto` | Qué hace y qué no hace el producto |
| `mitos` | Creencias comunes del rubro, verdaderas y falsas |

Reglas de escritura:

- **Máximo 90 caracteres.** Se lee en dos segundos o no sirve.
- Sin dobles negaciones. *"No es cierto que nunca…"* es una trampa de lectura, no una pregunta.
- Sin adverbios ambiguos: *"siempre"*, *"nunca"* y *"todos"* hacen que una afirmación técnicamente
  falsa se sienta injusta. Si se usan, tiene que ser a propósito y la explicación lo aclara.
- Reparto parejo entre verdaderas y falsas, **en orden mezclado**. Tres falsas seguidas hacen que
  la gente empiece a jugar al patrón en vez de leer.
- Explicación de una línea, obligatoria.

Ese conjunto de reglas es lo que separa un verdadero-o-falso que enseña de uno que hace sentir
engañado.

---

## Qué usa de las bases

| De `_quiz/` | Para qué |
|---|---|
| `engine.ts` | Modo `score`, corrección |
| `items/Boolean.tsx` | El único tipo que usa |
| `content/` | Los cuatro juegos |

| De `_net/` | Para qué |
|---|---|
| `GameNetPort` | Difundir afirmación, recibir respuesta, difundir resultado |
| `GamepadController` layout `buttons` | Los dos botones |
| `rttMs` | Compensación de latencia |

**Y sobre todo `_quiz/live/`**, la capa de rondas cronometradas de la base corporativa §5: la
máquina de fases, la medición de tiempo en el host, el cierre de ventana, el descarte de
respuestas tardías y la entrada tardía. Ese módulo existe **porque estos dos juegos lo comparten
entero**; C6 no debería escribir ni una línea de eso.

Lo único propio de C6 es el formato de supervivencia: eliminación, puntaje de honor y repesca.

---

## Qué NO hacer

- **No** mandar el tiempo desde el celular. Lo mide el host, como en C1.
- **No** cerrar la ventana en el teléfono.
- **No** dejar a nadie sin jugar tras ser eliminado.
- **No** restar por errar.
- **No** habilitar antes de los 2 segundos de lectura.
- **No** afirmaciones de más de 90 caracteres ni con doble negación.
- **No** distinguir los botones sólo por color.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Diez afirmaciones con 5 celulares reales, con eliminaciones y repesca.
3. **Un eliminado en la afirmación 2 sigue contestando** las ocho restantes y aparece en el
   ranking de puntos.
4. La repesca de la 6 devuelve a la carrera a quien acierta.
5. Un cliente que manda un tiempo falso **no cambia su puntaje**.
6. Las respuestas posteriores al cierre se descartan con aviso.
7. Los botones no responden durante los 2 segundos de lectura.
8. Los dos botones se distinguen **en escala de grises**.
9. Ninguna afirmación del contenido pasa de 90 caracteres — verificable con un test.
10. Cada juego tiene reparto parejo de verdaderas y falsas, sin tres seguidas iguales.
11. Con más de la mitad de caídos en una afirmación, el proyector lo destaca.
12. `force-end` emite outcomes con lo acumulado.
13. Con 40 participantes, la lista de vivos del proyector se lee y no se desborda.
14. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "verdadero-o-falso",
  title: "Verdadero o falso",
  description: "Diez afirmaciones, cinco segundos cada una. El que se equivoca, cae.",
  category: "corporativo",
  status: "beta",
  enabled: false,
  engine: "dom",
  topology: "arena",
  needsNet: true,
  minPlayers: 2,
  maxPlayers: 200,
  qrSlots: 1,
  estimatedMin: 5,
  inputs: ["touch"],
  tags: ["corporativo", "rápido", "supervivencia", "rompehielo"],
  mode: "internal",
  load: () => import("./verdaderoOFalso/VerdaderoOFalsoGame"),
}
```
