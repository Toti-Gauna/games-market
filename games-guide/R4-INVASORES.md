# R4 · Invasores

> **Tanda 6.** Requiere `00-BASES-2D.md` y `02-BASES-NETCODE.md` cerradas.
> Categoría **Retro** · topología `gamepad` · **hasta 4 QR** · esfuerzo **M** · motor `canvas2d`

Space Invaders, pero **cooperativo**. Es el único de los 24 donde la sala gana o pierde junta, y
en un catálogo lleno de competencia eso lo hace valioso: sirve para el momento del evento en que
no querés que la gente compita.

---

## La idea

Hasta cuatro personas escanean su QR y cada una controla un cañón en la parte de abajo de la
pantalla proyectada. **La horda es una sola y es de todos.** Si llega abajo, pierden todos.

---

## Por qué el fracaso compartido es la mecánica

Un juego cooperativo sin un estado de derrota común no es cooperativo: es gente jugando al lado
de otra gente. La horda bajando es lo que obliga a mirar el conjunto en vez del propio puntaje.

Por eso, aunque cada uno tenga su puntaje individual, **el resultado es colectivo**: se sobrevive
la oleada o no.

---

## El problema de la cantidad variable

Entre 1 y 4 jugadores, la dificultad tiene que funcionar en los dos extremos. Con 1 tiene que ser
posible; con 4 no puede ser trivial.

La horda escala **al empezar la oleada**, según cuántos hay conectados:

| Jugadores | Filas | Columnas | Velocidad base |
|---|---|---|---|
| 1 | 3 | 8 | 1,0× |
| 2 | 4 | 9 | 1,1× |
| 3 | 4 | 10 | 1,2× |
| 4 | 5 | 11 | 1,3× |

Escala **sublineal a propósito**: cuatro jugadores no matan cuatro veces más rápido, porque se
pisan los disparos y se estorban. Duplicar la horda con el doble de gente la haría más fácil, no
más difícil.

**Si alguien entra o se va a mitad de oleada, la horda no cambia.** Reescalarla en caliente es
injusto en las dos direcciones. Se ajusta en la oleada siguiente.

---

## Reglas

| | |
|---|---|
| Campo | 1600 × 900 |
| Cañones | Hasta 4, sólo se mueven en X, atraviesan entre sí |
| Disparo | 1 proyectil propio en vuelo a la vez |
| Horda | Baja un escalón al tocar un borde, acelera al quedar menos |
| Escudos | 4 bloques destructibles, compartidos |
| Vidas | **Compartidas: 3.** Un cañón alcanzado cuesta una vida de todos |
| Oleadas | Infinitas, más rápidas y más bajas cada vez |
| Fin | 3 vidas perdidas, la horda toca el suelo, o `gameDurationMs` |

**Los cañones se atraviesan entre sí.** Podrían chocar y sería más "realista", pero en la práctica
sólo genera frustración y acusaciones cruzadas. La coordinación tiene que venir de la horda, no de
estorbarse.

### La aceleración

Es lo que da la tensión del original: la horda se mueve más rápido cuanto menos invasores quedan.

```
velocidad = base × (1 + (1 - vivos / total) × 2.2)
```

El último invasor se mueve más de tres veces más rápido que la horda completa. Con 4 jugadores la
horda se vacía rápido, así que la aceleración llega antes: la dificultad se autorregula.

### Puntos

```ts
const propios     = invasoresDerribados * 100;
const precision   = Math.floor(aciertos / disparos * 500);
const oleadas     = oleadasSuperadas * 300;      // igual para todos: es colectivo
const points      = propios + precision + oleadas;
```

El bono por precisión evita la estrategia de disparar sin mirar, que con cuatro personas llenaría
la pantalla de proyectiles.

El bono por oleada es **idéntico para todos los conectados**, incluido el que jugó peor. Es
cooperativo: si la sala superó la oleada, la superó la sala.

---

## El mando

Layout **`dpad`** de la base de netcode, simplificado:

- **Franja táctil horizontal** abajo: el dedo mueve el cañón por posición absoluta, igual que la
  paleta de Pong.
- **Botón grande de disparo** a la derecha, o toque en cualquier lugar de la mitad superior.
- Arriba: tu color y tu puntaje.
- Vibración corta al acertar, larga al ser alcanzado.

Posición absoluta y no eventos de dirección, por lo mismo que en Pong: un paquete perdido se
corrige solo en el siguiente.

El disparo **sí es un evento**, y va por el canal confiable: perder un "disparé" se nota mucho más
que perder un frame de posición.

---

## El proyector

- Cada cañón con su color de la paleta, **igual al de su QR y su teléfono**.
- Invasores como formas geométricas simples en tres tipos, con dos fotogramas de animación
  alternados al ritmo del movimiento — el paso característico del original.
- Los escudos se erosionan por píxeles al recibir impactos, no desaparecen de golpe.
- Vidas compartidas arriba al centro, grandes. Es el número que importa.
- Al perder una vida: flash rojo breve y una pausa de 1,5 s para reagruparse.
- Nombre de cada jugador sobre su cañón, chico.
- Entre oleadas: cartel con el número de oleada y los puntajes de todos.

Con `prefers-reduced-motion`: sin flash, sin sacudida. La animación de la horda se conserva —
es información, no decoración.

---

## Estados

1. **Lobby** — hasta 4 QR, marcando los tomados. Arranca con **al menos 1**, tras 20 s de espera
   o cuando el host lo decida. No hace falta llenar los cuatro.
2. **Alguien entra a mitad** — aparece su cañón en la oleada siguiente, no en la actual.
3. **Alguien se va** — su cañón desaparece; la horda no cambia hasta la próxima oleada.
4. **Todos se van** — la partida se pausa 30 s esperando; después termina.
5. **`force-end`** — outcomes de todos con lo acumulado.
6. **Derrota** — pantalla compartida con oleadas superadas y puntajes.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en el proyector |
| Entidades | ~55 invasores, 4 cañones, ~12 proyectiles, ~200 partículas |
| Píxeles de escudo | 4 × 200, en un `ImageData` por escudo |
| Estado por tick | < 400 bytes con 4 jugadores |

Los escudos se manejan como máscaras de bits, no como entidades. Erosionar un escudo es apagar
bits, no destruir objetos.

---

## Qué usa de las bases

| De `_engine/` | Para qué |
|---|---|
| `useGame2D`, `loop.ts` | Loop a `1/60` |
| `rng.ts` | Qué invasor dispara y cuándo, sembrado |
| `pool.ts` | Proyectiles y partículas |
| `collide.ts` | AABB. Los proyectiles son lentos: **no hace falta barrido** |
| `camera.ts`, `palette.ts`, `hud.tsx` | — |

| De `_net/` | Para qué |
|---|---|
| `GameNetPort` | Estado a 20 Hz, input a 30 Hz |
| `GamepadController` | Layout `dpad` adaptado |

---

## Qué NO hacer

- **No** reescalar la horda en caliente al entrar o salir alguien.
- **No** hacer que los cañones choquen entre sí.
- **No** fuego amigo.
- **No** puntaje de oleada distinto por jugador: es colectivo.
- **No** mandar eventos de dirección: posición absoluta.
- **No** manejar los escudos como entidades.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Partida completa con **4 celulares reales**, superando al menos dos oleadas.
3. Con **1 solo jugador** la primera oleada es superable; con 4 no es trivial.
4. La horda acelera al quedar menos invasores, notoriamente.
5. Entrar a mitad de oleada agrega el cañón **en la siguiente**, y la horda no cambia.
6. Irse a mitad no rompe la partida ni reescala la horda.
7. Las vidas son compartidas: si a un jugador le pegan, el contador común baja.
8. El bono por oleada es idéntico para todos los conectados.
9. Los escudos se erosionan por zonas, no desaparecen de golpe.
10. 60 fps con 55 invasores, 12 proyectiles y 200 partículas.
11. Con la misma semilla, los invasores disparan en el mismo orden.
12. `force-end` emite un outcome por jugador conectado.
13. Cero errores de consola en las superficies involucradas.

---

## Entrada en el registry

```ts
{
  id: "invasores",
  title: "Invasores",
  description: "Hasta cuatro cañones, una sola horda. O la frenan entre todos, o no.",
  category: "retro",
  status: "beta",
  enabled: false,
  engine: "canvas2d",
  topology: "gamepad",
  needsNet: true,
  minPlayers: 1,
  maxPlayers: 4,
  qrSlots: 4,
  estimatedMin: 6,
  inputs: ["touch"],
  tags: ["retro", "cooperativo", "proyector", "sala"],
  mode: "internal",
  load: () => import("./invasores/InvasoresGame"),
}
```
