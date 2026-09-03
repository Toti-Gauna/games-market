# C4 · Memoria de valores

> **Tanda 9.** Requiere `00-BASES-2D.md` y `03-BASES-CORPORATIVAS.md` cerradas.
> Categoría **Corporativo** · topología `solo` · 1 QR · esfuerzo **S** · motor `dom`

**Este juego ya existe.** Es `principios-culturales`, el único del registry hoy. Este prompt no
construye un juego: lo **integra** al sistema que armaron las tres fases.

---

## Qué existe hoy

```
src/games/principiosCulturales/
├── MergeGameBoard.tsx           ← el tablero, COMPARTIDO con el juego original
└── PrincipiosCulturalesGame.tsx ← el envoltorio del tour
```

Funciona: unir cinco principios de la cultura con su definición, arrastrando. Y ya resuelve bien
el puntaje:

```ts
export function computePoints(result: MergeGameResult, gameDurationMs: number | null): number {
  const basePoints = result.completedPairs * 100;
  const timeBonus = result.completed && gameDurationMs !== null
      ? Math.max(0, Math.ceil((gameDurationMs - result.durationMs) / 1000)) * 2 : 0;
  return basePoints + timeBonus;
}
```

Esa fórmula —base por acierto más bono por velocidad— es la que la base corporativa generalizó
para los seis juegos de la categoría. **Salió de acá.**

### La restricción que manda

`MergeGameBoard.tsx` lo usan **dos flujos**: el juego original de Supernova Experience y el tour.
No es del tour: es compartido.

Eso significa que **no se puede migrar al motor de quiz sin romper el juego original**, que está
fuera del alcance de este rediseño. Cualquier cambio en ese archivo tiene que seguir funcionando
para los dos.

Es la razón por la que este prompt es de integración y no de reconstrucción.

---

## Qué hacer

### 1. Entrada de registry completa

Hoy le faltan todos los campos que agregaron las fases 2 y 3:

```ts
{
  id: "principios-culturales",   // el id NO cambia: hay tours guardados que lo referencian
  title: "Memoria de valores",
  description: "Uní cada principio con lo que significa. Cinco pares, contra reloj.",
  category: "corporativo",
  status: "estable",
  enabled: true,
  engine: "dom",
  topology: "solo",
  needsNet: false,
  minPlayers: 1,
  maxPlayers: 1,
  qrSlots: 1,
  estimatedMin: 3,
  inputs: ["touch"],
  tags: ["corporativo", "cultura", "memoria", "individual"],
  mode: "internal",
  load: () => import("./principiosCulturales/PrincipiosCulturalesGame"),
}
```

**El `id` no cambia.** Cualquier tour ya guardado tiene bloques con
`content.gameId: "principios-culturales"`. Cambiarlo dejaría esos bloques apuntando a un juego que
no existe, y el QR autogenerado quedaría huérfano — el mismo modo de falla que las plantillas de
la Fase 2 tienen como criterio de aceptación.

El `title` sí puede cambiar: es sólo lo que se muestra.

### 2. Aplicar el sistema visual de la Fase 1

`MergeGameBoard.tsx` se puede revestir sin cambiar su comportamiento, y como es compartido, el
juego original se beneficia igual.

- Colores desde tokens, nunca hex.
- Radios de la escala nueva: `--r-sm` en las tarjetas, no pill.
- Un solo hairline por tarjeta, como realce superior.
- Tipografía y mono tabular en el reloj y el contador de pares.
- Iconos SVG donde haya glifos.

**Sin tocar la lógica de arrastre ni el cálculo de puntos.** Si el juego original cambia de
comportamiento, el cambio está mal.

### 3. Barajar con la semilla

Hoy el orden de las tarjetas probablemente sale de `Math.random()`. Tiene que salir del PRNG
sembrado con `config.seed`, del `rng.ts` de la base 2D.

Es el mismo motivo que en Match-3 y en Corredor: si cada participante recibe un orden distinto, los
puntajes no son comparables y el ranking del tour pierde sentido. Con la semilla, todos enfrentan
la misma disposición.

Es un cambio de una línea con un efecto grande, y es lo más importante de este prompt.

### 4. El renderer `match` de la base corporativa

La base corporativa dice que `items/Match.tsx` **reutiliza la mecánica de `MergeGameBoard`**. Acá
se cierra ese contrato:

- `MergeGameBoard` se mantiene como está, compartido.
- `items/Match.tsx` lo **envuelve** y lo adapta a la firma `ItemProps` del motor de quiz.
- No se duplica la mecánica de arrastre.

Así, cualquier cuestionario del Formulario vivo puede tener una pregunta de unir pares sin escribir
nada nuevo.

### 5. Contenido como datos

Hoy los cinco principios están, muy probablemente, dentro del componente. Pasan a
`_quiz/content/`, como los demás:

```ts
export const principiosCulturales: Quiz = {
  id: "principios-culturales",
  mode: "score",
  items: [{ type: "match", pairs: [...] }],
};
```

Con eso, cambiar los valores de una empresa por los de otra es editar un archivo de datos, que es
lo que va a pedir el primer cliente que no sea Clouders.

---

## Qué NO tocar

- **La lógica de `MergeGameBoard.tsx`.** Lo comparte el juego original. Sólo revestimiento.
- **El `id` del registry.**
- **La fórmula de puntos.** Ya está bien y la base la generalizó.
- El flujo del juego original: Home → Login → Tutorial → Game → Resultado → Ranking.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. **El juego original sigue funcionando igual**, recorrido completo de punta a punta. Es el
   criterio más importante: es código compartido.
3. El juego se ve con el sistema de la Fase 1 en **los dos** flujos.
4. **Con la misma semilla, todos los participantes reciben el mismo orden de tarjetas.**
5. Un tour guardado antes de este cambio, con una pantalla de este juego, **sigue funcionando**:
   el bloque encuentra el juego y el QR entra a jugar.
6. El catálogo de juegos (Fase 2, Etapa 09) lo muestra con su categoría, topología y duración.
7. `items/Match.tsx` del motor de quiz monta el tablero sin duplicar la mecánica.
8. Los cinco principios viven en `_quiz/content/` y se pueden cambiar sin tocar componentes.
9. El puntaje da lo mismo que antes ante el mismo desempeño.
10. Cero glifos Unicode y cero colores hardcodeados en los dos flujos.
11. Cero errores de consola.

---

## Nota sobre el orden

Este prompt conviene hacerlo **temprano**, no en la tanda 9, aunque figure acá por ser
"recategorización".

Motivo: es el único juego que existe, así que es el mejor banco de pruebas del sistema de diseño
de la Fase 1 y del catálogo de la Fase 2. Y el cambio de la semilla arregla un problema real de
comparabilidad que hoy afecta a cualquier tour que lo use.

Si se hace junto con la Etapa 09 de la Fase 2 —cuando se construye el catálogo de juegos— sale casi
gratis.
