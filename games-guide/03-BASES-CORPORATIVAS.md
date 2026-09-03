# Base corporativa · motor de preguntas y experiencias sin juego

> Leé `docs/CONTRATO-JUEGOS.md` y `docs/fase-3/README.md` primero.
> **La usan los 6 juegos de la categoría Corporativo.**

Es la base más barata de las cuatro y la que un cliente pide primero. Un trivia y un test de
perfil se usan en todos los eventos; un shooter 3D, en algunos.

---

## Qué existe hoy

`principios-culturales` es el único juego, y es exactamente de esta familia: unir cinco pares de
principio y definición. Está hecho a mano, con DOM y framer-motion.

```
src/games/principiosCulturales/
├── MergeGameBoard.tsx           ← compartido con el juego original
└── PrincipiosCulturalesGame.tsx ← wrapper del tour
```

Y ya resuelve bien el cálculo de puntos, que conviene conservar como criterio:

```ts
export function computePoints(result: MergeGameResult, gameDurationMs: number | null): number {
  const basePoints = result.completedPairs * 100;
  const timeBonus = result.completed && gameDurationMs !== null
      ? Math.max(0, Math.ceil((gameDurationMs - result.durationMs) / 1000)) * 2 : 0;
  return basePoints + timeBonus;
}
```

**Base por acierto más bono por velocidad.** Es la fórmula que van a compartir los seis.

Lo que falta: todo lo demás está cableado. No hay forma de crear un trivia sin escribir un
componente nuevo.

---

## Qué construir

```
src/games/_quiz/
├── types.ts          ← ítems, respuestas, resultados
├── engine.ts         ← estado, avance, corrección, puntaje
├── items/            ← un renderer por tipo de ítem
│   ├── Choice.tsx  Multiple.tsx  Scale.tsx  Order.tsx
│   ├── Match.tsx   Text.tsx      Boolean.tsx  Image.tsx
├── aggregate.ts      ← agregación para el proyector
├── live/             ← rondas cronometradas por el host (Trivia, V/F)
├── QuizRunner.tsx    ← el runner del celular
├── QuizProjector.tsx ← la vista de la sala
└── content/          ← los cuestionarios, como datos
```

### 1. Los tipos

```ts
export type QuizItemType =
  | "choice"    // una correcta
  | "multiple"  // varias correctas
  | "boolean"   // verdadero / falso
  | "scale"     // 1–5, Likert
  | "order"     // ordenar por prioridad
  | "match"     // unir pares (lo que ya hace principios-culturales)
  | "text"      // respuesta abierta, corta
  | "image";    // elegir entre imágenes

export type QuizItem = {
  id: string;
  type: QuizItemType;
  prompt: string;
  media?: { src: string; alt: string };
  options?: Array<{ id: string; label: string; media?: string }>;
  /** null = no hay respuesta correcta (encuestas, tests de perfil). */
  correct?: string[] | null;
  /** Segundos. null = sin límite. */
  timeLimitSec?: number | null;
  points?: number;
  /** Para tests de perfil: a qué arquetipo suma cada opción. */
  weights?: Record<string, Record<string, number>>;
  explanation?: string;
};

export type Quiz = {
  id: string;
  title: string;
  mode: "score" | "profile" | "survey";
  items: QuizItem[];
  shuffleItems?: boolean;
  shuffleOptions?: boolean;
  /** score: bono por velocidad. */
  speedBonus?: boolean;
  /** profile: los arquetipos posibles. */
  profiles?: Array<{ id: string; name: string; description: string }>;
};
```

**Los tres modos cubren los seis juegos:**

| Modo | Corrige | Puntúa | Juegos |
|---|---|---|---|
| `score` | Sí | Aciertos + velocidad | Trivia, Verdadero/Falso, Memoria |
| `profile` | No | Suma pesos → arquetipo | Test de perfil |
| `survey` | No | No | Formulario vivo, Prioridades |

Que `survey` no puntúe importa: `GameOutcome` pide puntos, y para una encuesta se emiten **0 con
`completed: true`**. El valor está en las respuestas, no en el ranking. Un formulario que reparte
puntos arbitrarios ensucia el ranking del tour.

### 2. El motor

```ts
export function createQuizEngine(quiz: Quiz, config: GameRuntimeConfig) {
  // Baraja con el PRNG sembrado por config.seed:
  // todos ven el mismo orden, que es lo que hace comparables los puntajes.
  …
}
```

Resuelve avance, tiempo por ítem, corrección, puntaje y el outcome final. Los renderers de ítem
sólo dibujan y avisan la respuesta.

**El puntaje**, unificando la fórmula que ya funciona:

```
puntos del ítem = base × acierto  +  (speedBonus ? restante/límite × base × 0.5 : 0)
```

Hasta 50 % extra por velocidad. Suficiente para premiar rapidez, no tanto como para que el que
sabe pero piensa quede afuera — que es el defecto típico de los trivias.

### 3. Los renderers de ítem

Ocho componentes con la misma firma:

```tsx
type ItemProps = {
  item: QuizItem;
  value: unknown;
  onChange: (v: unknown) => void;
  onSubmit: () => void;
  disabled: boolean;
  remainingSec: number | null;
};
```

Se dibujan con el sistema de la Parte 1 y **se pensarán para pulgar**: objetivos de 44×44 px
mínimo, separación de 8, opciones en columna y no en grilla apretada.

`match` reutiliza la mecánica de `MergeGameBoard`, que ya existe y funciona.

### 4. Agregación para el proyector

Es lo que convierte un formulario en algo que vale proyectar:

```ts
export type Aggregate =
  | { type: "bars"; options: Array<{ label: string; count: number; pct: number }> }
  | { type: "scale"; avg: number; distribution: number[] }
  | { type: "cloud"; words: Array<{ text: string; weight: number }> }
  | { type: "profiles"; counts: Record<string, number> }
  | { type: "ranking"; items: Array<{ label: string; avgPosition: number }> };
```

Mientras la gente responde en el celular, **el proyector muestra el agregado en vivo**: las barras
creciendo, la nube armándose. Es la mitad del valor de estos juegos y es lo que hoy no existe.

Las respuestas de texto pasan por un filtro de palabras antes de proyectarse. Es un evento de
empresa con una pantalla gigante: alguien va a probar.

### 5. Quiz en vivo — `_quiz/live/`

Los cuestionarios `solo` (Test de perfil, Formulario vivo) los responde cada uno a su ritmo. Pero
**Trivia relámpago y Verdadero o falso comparten un patrón entero** que no es del motor de quiz ni
del netcode, sino de la unión de los dos:

```ts
// _quiz/live/liveRound.ts
export type LiveRoundPhase = "anuncio" | "lectura" | "respuesta" | "cierre" | "ranking";

export type LiveRoundConfig = {
  announceMs: number;
  /** Ventana de lectura ANTES de habilitar. Sin esto gana el reflejo, no el criterio. */
  readMs: number;
  answerMs: number;
  revealMs: number;
  /** Cada cuántos ítems se muestra el ranking completo. 0 = nunca. */
  rankingEvery: number;
};
```

Lo que resuelve, una vez:

- **La máquina de fases** con sus tiempos, corriendo en el host y difundida a los clientes.
- **La medición de tiempo de respuesta en el host.** El cliente manda **sólo la opción elegida**,
  nunca un tiempo. El host marca la llegada y descuenta medio RTT:
  `Δ = llegada − t0 − rtt / 2`. Si el cliente pudiera declarar su tiempo, cualquiera con las
  herramientas de desarrollo abiertas diría que contestó en 0,01 s y ganaría siempre.
- **El cierre de ventana en el host**, no en cada teléfono. Un celular con el reloj corrido no
  puede regalarse segundos.
- **El descarte de respuestas tardías**, con aviso claro al que llegó tarde.
- **La agregación y el ranking** difundidos a la vez a todos al cerrar.
- **Entrada tardía**: quien llega en el ítem 4 juega del 5 en adelante sin romper el ranking.

Tolerancia de latencia: **~200 ms**, no los 100 de un juego de reflejos. Estos juegos **no
necesitan WebRTC**: andan bien sobre cualquier transporte del `GameNetPort`.

Cualquier experiencia corporativa sincronizada futura —una votación en vivo, un Pulso de la
Fase 2b— se apoya acá y no reimplementa la máquina de fases.

### 6. Contenido como datos

```ts
// src/games/_quiz/content/onboarding-cultura.ts
export const onboardingCultura: Quiz = { … };
```

Cuatro cuestionarios de ejemplo listos para usar: cultura, seguridad de la información, producto,
y un test de perfil de equipo. Agregar uno es agregar un archivo.

**Más adelante** esto se edita desde el editor de tours. Por ahora son datos, y alcanza.

---

## Qué NO tocar

- `MergeGameBoard.tsx`: lo comparte el juego original. El renderer `match` lo **usa**, no lo migra.
- La fórmula de puntos de `PrincipiosCulturalesGame.tsx`: se generaliza, no se cambia.
- La regla de oro: el quiz no conoce el tour.
- `AGENTS.md`: los resultados los escribe el backend. El quiz llama a `onFinished`, nada más.

---

## Reglas

- Los tres modos emiten `GameOutcome`. `survey` emite 0 puntos con `completed: true`.
- El barajado usa el PRNG sembrado con `config.seed`: todos ven el mismo orden.
- Los renderers **sólo dibujan**. La corrección y el puntaje viven en el motor, en un solo lugar.
- Nada de respuestas correctas visibles en el DOM antes de tiempo: `correct` no se manda al
  renderer hasta que se contestó. En una sala llena hay alguien mirando el inspector.
- Objetivos táctiles ≥44×44 px, separación ≥8 px.
- El texto libre se filtra antes de proyectarse.
- Todo cuestionario responde a `force-end` emitiendo lo respondido hasta ahí.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Los ocho tipos de ítem se renderizan y responden en un teléfono real.
3. Un quiz `score` de 10 ítems da el mismo puntaje ante las mismas respuestas y tiempos.
4. Un quiz `profile` devuelve el arquetipo correcto según los pesos.
5. Un quiz `survey` emite `points: 0` y `completed: true`, y **no altera el ranking del tour**.
6. Con la misma semilla, dos participantes ven **el mismo orden** de ítems y de opciones.
7. **Inspeccionar el DOM antes de contestar no revela la respuesta correcta.**
8. El proyector muestra el agregado actualizándose mientras se responde.
9. `force-end` a mitad emite lo respondido hasta ese momento.
10. Una respuesta de texto con una palabra vetada no se proyecta.
11. Cero errores de consola.

---

## Decisión a registrar

```json
{
  "id": "games-quiz-engine",
  "status": "accepted",
  "decision": "The six corporate experiences share a quiz engine in src/games/_quiz/ with eight item types (choice, multiple, boolean, scale, order, match, text, image) and three modes: score, profile and survey. Scoring generalises the existing principios-culturales formula of base points per correct answer plus up to fifty percent speed bonus. A live aggregate view renders results on the projector while people answer, and quizzes are authored as data files.",
  "reason": "The only existing game is exactly this family but hardwired, so creating a trivia meant writing a new component. Corporate experiences are also the ones a client asks for first: a trivia and a profile test are used at every event, while a 3D shooter is used at some.",
  "consequence": "Survey mode emits zero points with completed true, because a form that awards arbitrary points would pollute the tour ranking, and its value is in the answers. Item order and option order are shuffled with the seeded PRNG so all participants see the same sequence and scores stay comparable. Correct answers are withheld from the renderer until a question is answered, since at a live event someone will open the inspector. The match renderer reuses MergeGameBoard rather than reimplementing it."
}
```
