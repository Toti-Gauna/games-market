# C5 · Prioridades

> **Tanda 7.** Requiere `03-BASES-CORPORATIVAS.md` cerrada.
> Categoría **Corporativo** · topología `solo` · 1 QR · esfuerzo **M** · motor `dom`

Ordenás ocho tarjetas por importancia. El proyector muestra qué piensa el equipo. Es el único de
los 24 cuyo valor no está en jugar sino **en lo que aparece después en la pantalla grande**.

---

## Lo que realmente aporta

Un ranking promedio del equipo es un dato tibio: *"lo más importante es la calidad"*. Nadie
discute con eso y nadie aprende nada.

**Lo que abre conversación es el desacuerdo.**

Si un ítem quedó primero para la mitad del equipo y último para la otra mitad, eso es información
de verdad: significa que dos partes de la organización están optimizando cosas distintas y no lo
sabían.

Así que el proyector muestra dos cosas, y **la segunda es la importante**:

1. El **consenso**: el orden promedio.
2. La **división**: en qué ítems el equipo está más repartido.

```ts
// Por ítem, sobre las posiciones que le asignó cada persona
const media    = posiciones.reduce((a, b) => a + b, 0) / posiciones.length;
const desvio   = Math.sqrt(posiciones.reduce((a, p) => a + (p - media) ** 2, 0) / posiciones.length);
```

El ítem con mayor desvío se destaca: **"Acá no se ponen de acuerdo"**. Ese es el producto del
juego.

---

## Sin puntaje

Modo `survey` del motor de quiz:

```ts
onFinished({
  screenId: config.screenId,
  participantId: config.participantId,
  completed: true,
  points: 0,
  durationMs,
  meta: { orden: ["c3", "c1", "c7", "c2", "c8", "c5", "c4", "c6"] },
});
```

No hay orden correcto. Puntuar una opinión sería absurdo, y además metería en el ranking del tour
un número sin significado.

---

## El control: ordenar en un teléfono

Es la parte difícil. Arrastrar ocho tarjetas en una pantalla de 6 pulgadas es incómodo si se hace
mal.

### Dos caminos, los dos de primera clase

**Arrastrar**, con un detalle que se suele omitir: **un asa de agarre** en cada fila, no la fila
entera. Si toda la fila arrastra, la lista no se puede scrollear — se agarra una tarjeta al
intentar bajar. El asa separa las dos intenciones.

Además: auto-scroll al arrastrar cerca de los bordes, y la fila arrastrada levantada con sombra.

**Botones de subir y bajar** en cada fila. **No es un fallback: es el camino accesible.**

Arrastrar y soltar no funciona con teclado, no funciona bien con lectores de pantalla y es
difícil con movilidad reducida. Una pantalla que sólo se puede completar arrastrando excluye
gente, y en un evento de empresa eso se nota.

Los dos caminos conviven visibles. Cada fila:

```
┌────────────────────────────────────┐
│ ⠿  1.  Entregar rápido      ▲  ▼  │
└────────────────────────────────────┘
     ↑ asa            ↑ posición  ↑ mover
```

- Con teclado: `Tab` recorre las filas, `Espacio` la toma, flechas la mueven, `Espacio` la suelta.
- Cada movimiento se **anuncia** por región viva: *"Entregar rápido, posición 3 de 8"*.

### Ocho es el máximo

Con más de ocho, ordenar deja de ser una decisión y pasa a ser una tarea. Ocho entra en una
pantalla de teléfono sin scroll en la mayoría de los dispositivos, que es la otra razón.

---

## El flujo

| Paso | Qué pasa |
|---|---|
| Entrada | Las 8 tarjetas en **orden aleatorio sembrado** — el mismo para todos |
| Ordenar | Sin reloj visible. Es una reflexión, no una carrera |
| Confirmar | Botón `Listo`, con confirmación: no se puede cambiar después |
| Espera | *"Faltan 12 personas"*, con el contador en vivo |
| Resultado | El consenso y la división, también en el teléfono |

**El orden inicial va sembrado y es igual para todos.** Si cada uno recibiera un orden distinto,
el sesgo de anclaje —tendemos a dejar arriba lo que ya estaba arriba— afectaría a cada persona de
forma distinta y ensuciaría el agregado. Igual para todos, el sesgo es parejo y se puede
descontar.

Ese detalle es el que hace que el resultado sirva para algo.

---

## El proyector

Tres momentos:

**Mientras responden.** Contador `18 de 34` y una lista de nombres apareciendo. Nada de resultados
parciales: ver el consenso a medias influye a quien todavía no contestó.

**El consenso.** Las ocho tarjetas se acomodan en su orden promedio, con una animación de
reordenamiento (`Flip` de la capa de motion). Cada una con su posición media.

**La división.** El momento que importa:

```
        ACÁ NO SE PONEN DE ACUERDO

   Entregar rápido
   ├──────●────────────────────●──────┤
   1                                  8
   
   14 personas lo pusieron en el podio.
   11 lo pusieron último.
```

Un gráfico de dispersión por ítem, ordenado por desvío. El primero es el más discutido y es donde
se para la conversación.

---

## Contenido

Cinco conjuntos de ocho tarjetas, como datos:

| Conjunto | Sobre |
|---|---|
| `producto` | Qué prioriza el equipo al construir: velocidad, calidad, alcance, deuda… |
| `equipo` | Qué hace bueno a un lugar de trabajo |
| `cliente` | Qué valora quien nos usa |
| `trimestre` | Los objetivos declarados del período |
| `personal` | Qué busca cada uno en su trabajo |

Reglas de escritura:

- **Todas las opciones tienen que ser buenas.** Si hay una obviamente mala, todos la mandan última
  y el ítem no aporta. La tensión aparece cuando hay que elegir entre cosas deseables.
- Menos de 40 caracteres, para que entren en una fila de teléfono.
- Sin jerga interna que la mitad no entienda.
- Sin opciones que se solapen: si dos dicen casi lo mismo, se reparten los votos y el resultado
  pierde nitidez.

`personal` merece una advertencia: es el conjunto más revelador y el que más conviene correr
**anónimo**. Proyectar que alguien puso "el sueldo" primero, con nombre, es exponer a una persona.

---

## Anonimato

Igual que en Formulario vivo, y por el mismo motivo:

- El conjunto declara `anonymous: boolean`.
- Con `anonymous: true`, la agregación **descarta el `participantId`** antes de llegar al
  proyector. No es que no se muestre: es que no llega.
- El teléfono lo dice antes de empezar, con todas las letras.

---

## Qué usa de las bases

| De `_quiz/` | Para qué |
|---|---|
| `engine.ts` | Modo `survey` |
| `items/Order.tsx` | **El renderer de ordenamiento**, que este juego estrena |
| `aggregate.ts` | Agregado `ranking`, extendido con el desvío por ítem |
| `QuizRunner.tsx`, `QuizProjector.tsx` | — |
| `content/` | Los cinco conjuntos |

Este juego es el que **define cómo tiene que ser `items/Order.tsx`**. Si se implementa bien acá,
queda resuelto para cualquier pregunta de ordenar del Formulario vivo.

La única lógica propia es el cálculo de desvío y su visualización.

---

## Qué NO hacer

- **No** puntuar.
- **No** ofrecer sólo arrastrar: los botones son el camino accesible, no un extra.
- **No** hacer que toda la fila arrastre: asa de agarre.
- **No** más de ocho tarjetas.
- **No** dar a cada persona un orden inicial distinto.
- **No** mostrar resultados parciales mientras la gente responde.
- **No** incluir una opción obviamente mala.
- **No** proyectar con nombre si el conjunto es anónimo.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Las ocho tarjetas se ordenan **arrastrando** en un teléfono real, y la lista **sigue
   scrolleando** al tocar fuera del asa.
3. Las ocho se ordenan **sólo con los botones**, sin arrastrar nunca.
4. Se ordenan **sólo con teclado**, y cada movimiento se anuncia por región viva.
5. Todos reciben **el mismo orden inicial**.
6. El outcome emite `points: 0` y el orden completo en `meta`.
7. **Ordenar no cambia el ranking del tour.**
8. El proyector no muestra resultados parciales mientras se responde.
9. El consenso se calcula bien: verificable a mano con 5 respuestas.
10. **El ítem más dividido se identifica correctamente** por desvío, comprobado con un caso
    armado: uno que la mitad pone 1° y la otra mitad 8°.
11. Con `anonymous: true`, el `participantId` **no llega** al proyector.
12. `force-end` a mitad emite lo ordenado hasta ahí con `completed: false`.
13. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "prioridades",
  title: "Prioridades",
  description: "Ordená ocho cosas por importancia. Después vemos qué piensa el equipo.",
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
  tags: ["corporativo", "sin puntaje", "equipo", "conversación", "anónimo"],
  mode: "internal",
  load: () => import("./prioridades/PrioridadesGame"),
}
```
