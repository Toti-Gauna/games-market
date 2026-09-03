# R5 · Rompeladrillos

> **Tanda 6.** Requiere `00-BASES-2D.md` y `02-BASES-NETCODE.md` cerradas.
> Categoría **Retro** · topología `gamepad` · **2 QR** · esfuerzo **M** · motor `canvas2d`

Breakout con una vuelta que lo convierte en otra cosa: **la paleta está partida en dos y cada
persona controla una mitad.**

---

## La idea que lo hace distinto

No son dos paletas independientes. Es **una paleta con una junta en el medio**: dos segmentos que
se mueven por separado y, si se separan, dejan un **hueco por el que la pelota se cae**.

Eso crea la tensión del juego:

- **Juntos** cubren poco espacio pero no tienen hueco.
- **Separados** cubren todo el ancho pero con un agujero en el medio.

Cada decisión de moverse es una negociación silenciosa con la otra persona. En una sala, se
resuelve a los gritos, que es exactamente lo que se busca.

Es la mecánica más original de los 24 y la que mejor justifica la topología `gamepad`: sólo tiene
sentido con dos personas mirando la misma pantalla.

---

## Reglas de la paleta

| | |
|---|---|
| Ancho de cada segmento | 110 px |
| Separación mínima | 0 — se pueden tocar y forman una paleta sólida de 220 px |
| Separación máxima | 420 px entre centros |
| Orden | **El jugador 1 siempre está a la izquierda del 2.** No se pueden cruzar |
| Hueco | Si la distancia entre bordes internos supera 0, hay hueco real |

**No cruzarse es la restricción clave.** Sin ella, los dos van al mismo lugar y el juego se
convierte en dos paletas independientes que se pisan. Con ella, el espacio es un recurso que se
reparte.

Cuando uno empuja contra el otro, **el otro se corre**: se pueden empujar. Eso permite que uno
lleve al otro a una posición sin hablar, que es una forma de coordinación no verbal muy
satisfactoria cuando pasa.

---

## Reglas del juego

| | |
|---|---|
| Campo | 1600 × 900 |
| Ladrillos | 8 filas × 14 columnas, con huecos de diseño |
| Vidas | **Compartidas: 3** |
| Velocidad de la pelota | 420 px/s inicial, +3 % por rebote, tope 2× |
| Ángulo | El punto de impacto en el segmento define la salida, hasta ±60° |
| Niveles | 5, con distribuciones distintas |
| Fin | 3 vidas, los 5 niveles, o `gameDurationMs` |

### Tipos de ladrillo

| Tipo | Golpes | Puntos |
|---|---|---|
| Normal | 1 | 50 |
| Reforzado | 2 | 120 |
| Blindado | 3 | 250 |
| Explosivo | 1 | 100 + revienta los 8 vecinos |

### Cápsulas

Caen de algunos ladrillos y se agarran con **cualquiera** de los dos segmentos:

| Cápsula | Efecto | Dura |
|---|---|---|
| Ancho | +40 px a **los dos** segmentos | 20 s |
| Lento | Pelota a 0,7× | 15 s |
| Multi | Dos pelotas más | Hasta perderlas |
| Imán | La pelota se pega al segmento y se relanza tocando | 1 uso |
| **Junta** | Los segmentos quedan **unidos** 10 s: sin hueco posible | 10 s |

La cápsula **Junta** es la más interesante: durante 10 segundos el juego se vuelve un Breakout
normal de dos personas moviendo una sola paleta. Es un alivio, y hace notar por contraste lo que
significa el hueco.

### Puntos

```ts
const ladrillos = puntosDeLadrillosPropios;      // a quien lo rebotó por última vez
const niveles   = nivelesSuperados * 400;         // colectivo, igual para los dos
const rescates  = rebotesEnElBordeExterno * 30;   // premia estirarse
const points    = ladrillos + niveles + rescates;
```

El puntaje por ladrillo se atribuye a **quien rebotó la pelota por última vez**. Da competencia
sana dentro de un juego cooperativo: los dos quieren que no se caiga, pero cada uno quiere ser el
que la manda.

---

## Física

- Paso fijo **`1/120`**, como Pong y por lo mismo: la pelota acelera y a `1/60` recorre demasiado
  entre pasos.
- **Colisión barrida** contra los dos segmentos y contra los ladrillos. Sin barrido, a velocidad
  máxima la pelota atraviesa la paleta o un ladrillo delgado.
- El hueco entre segmentos **no es un objeto**: es la ausencia de uno. La pelota simplemente no
  colisiona ahí, y eso ya funciona si la colisión se hace contra cada segmento por separado.
- Los segmentos no aportan velocidad a la pelota, sólo ángulo por punto de impacto.

---

## El mando

Layout **`paddle`** de la base de netcode, horizontal:

- Franja táctil que ocupa la pantalla; el dedo mueve el segmento por posición absoluta.
- **El rango del dedo mapea al rango permitido**, que cambia según dónde está el otro: si el
  compañero está cerca, el rango propio se achica. El mando **muestra el límite** con una marca,
  para que se entienda por qué no puede seguir.
- Un indicador chico de dónde está el otro segmento, para no tener que mirar la pantalla grande
  todo el tiempo.
- Vibración al rebotar la pelota en el segmento propio, distinta al agarrar una cápsula.

Ese indicador del compañero es lo que hace el juego jugable: sin él, la coordinación depende de
mirar el proyector, y en el proyector la pelota va rápido.

---

## El proyector

- Segmento 1 en `--sn-cyan`, segmento 2 en `--sn-magenta`, con el mismo color en QR y teléfono.
- **El hueco entre segmentos se dibuja**: una línea de peligro tenue que se intensifica cuanto más
  grande es. Es la información más importante de la pantalla.
- Ladrillos con color por tipo y **grietas visibles** en los reforzados según los golpes recibidos.
- Pelota con estela corta.
- Al romper un ladrillo: partículas del color del ladrillo y un destello del color de quien la
  rebotó por última vez.
- Al perder una vida: flash y pausa de 1,5 s.
- Vidas compartidas arriba al centro.

Con `prefers-reduced-motion`: sin flash ni sacudida, estela corta. **La línea de peligro del hueco
se conserva**: es información, no adorno.

---

## Estados

1. **Lobby** — dos QR. **No arranca con uno solo**: el juego no existe con una persona.
2. **QR ya tomado** — se le ofrece el otro asiento.
3. **Uno se desconecta** — pausa inmediata, 30 s de gracia. Su segmento queda quieto donde estaba.
4. **No vuelve** — la partida termina; los dos reciben outcome, el que se fue con
   `completed: false`.
5. **`force-end`** — dos outcomes con lo acumulado.

Que el juego se pause al irse uno no es negociable: con un solo segmento y un hueco fijo, es
injugable.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en el proyector |
| Entidades | 112 ladrillos, 1–3 pelotas, 2 segmentos, ~150 partículas |
| Estado por tick | < 120 bytes |

Los ladrillos son una grilla en un array plano, no objetos: romper uno es marcar un índice.

---

## Qué usa de las bases

| De `_engine/` | Para qué |
|---|---|
| `loop.ts` a `1/120` | Timestep fijo por juego |
| `collide.ts` | **Barrido**, contra segmentos y ladrillos |
| `pool.ts`, `camera.ts`, `palette.ts`, `hud.tsx` | — |
| `rng.ts` | Qué ladrillo suelta cápsula, sembrado |

| De `_net/` | Para qué |
|---|---|
| `GameNetPort` | Estado a 20 Hz, input a 30 Hz |
| `GamepadController` layout `paddle` | Con el límite dinámico y el indicador del compañero |

---

## Qué NO hacer

- **No** dejar que los segmentos se crucen.
- **No** tratar el hueco como un objeto.
- **No** arrancar con un solo jugador.
- **No** seguir jugando si uno se desconecta.
- **No** colisión discreta.
- **No** ocultar el hueco: dibujarlo es la mitad del juego.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Partida completa con **dos celulares reales**, superando al menos un nivel.
3. **La prueba de la mecánica:** con los segmentos separados, la pelota pasa por el hueco y se
   pierde una vida. Con los segmentos juntos, rebota.
4. Los segmentos **no se cruzan**, y empujar mueve al otro.
5. El mando muestra el límite de recorrido y **dónde está el compañero**.
6. La pelota **nunca atraviesa** un segmento ni un ladrillo, ni a velocidad máxima.
7. La cápsula Junta une los segmentos 10 segundos y no se puede abrir hueco.
8. Los puntos del ladrillo se atribuyen a quien rebotó por última vez.
9. El bono por nivel es igual para los dos.
10. Desconectar un celular pausa; reconectar reanuda en el mismo asiento.
11. 60 fps con 3 pelotas y 150 partículas.
12. Con la misma semilla, las cápsulas caen de los mismos ladrillos.
13. `force-end` emite **dos** outcomes.
14. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "rompeladrillos",
  title: "Rompeladrillos",
  description: "Una paleta partida al medio. Uno cada mitad. Si se separan, hay hueco.",
  category: "retro",
  status: "beta",
  enabled: false,
  engine: "canvas2d",
  topology: "gamepad",
  needsNet: true,
  minPlayers: 2,
  maxPlayers: 2,
  qrSlots: 2,
  estimatedMin: 6,
  inputs: ["touch"],
  tags: ["retro", "cooperativo", "coordinación", "proyector"],
  mode: "internal",
  load: () => import("./rompeladrillos/RompeladrillosGame"),
}
```
