# M6 · Corredor

> **Tanda 9.** Requiere `00-BASES-2D.md` y `02-BASES-NETCODE.md` cerradas. Usa **PixiJS**.
> Categoría **Moderno** · topología `arena` · 1 QR · esfuerzo **L** · motor `pixi`

Un runner lateral donde **ves a los demás corriendo tu misma pista**. Es el juego con menos
netcode de todos los `arena`: se difunde un número por jugador, dos veces por segundo.

---

## La idea

Corrés hacia la derecha, saltás y te deslizás para esquivar obstáculos. La pista es infinita y se
acelera. El puntaje es la distancia.

Y en tu pantalla, semitransparentes, **las siluetas de los demás participantes** en la posición
donde van. Ves si te están pasando.

---

## Por qué las siluetas son honestas

Todos corren **la misma pista**, generada con `config.seed`. Mismos obstáculos en el mismo orden,
a la misma distancia.

Eso significa que una silueta 40 metros adelante está realmente 40 metros adelante, sobre el mismo
terreno. No es una animación decorativa: es información comparable.

Es el mismo truco que Match-3, pero acá se puede mostrar en vivo porque **la única información que
hay que compartir es la distancia recorrida**, un número.

### El costo de red, en concreto

```ts
type EstadoCorredor = {
  id: number;        // int8
  distancia: number; // int32, en centímetros
  estado: number;    // int8: corriendo | saltando | deslizando | caído
};                   // 6 bytes por jugador
```

A **2 Hz** con 30 participantes: 360 bytes por segundo. Es el juego de red más barato del catálogo
después de Ludo.

La posición vertical de cada silueta **no se transmite**: se deriva. Como la pista es idéntica y el
estado dice si está saltando, el cliente sabe dónde debería estar. Transmitir la Y sería mandar
información que ya se tiene.

---

## Reglas

| | |
|---|---|
| Mundo | 960 × 540, cámara lateral fija |
| Velocidad | 320 px/s inicial, +8 px/s cada 100 m, tope 900 |
| Salto | −680 px/s, gravedad 2000 px/s² |
| Deslizada | 500 ms, altura reducida a la mitad |
| Salto doble | Sí, uno solo en el aire |
| Fin | Chocar un obstáculo, o `gameDurationMs` |

**Un solo choque y se termina.** Con vidas, el juego pierde tensión y las partidas se estiran; sin
ellas, una carrera dura entre 40 y 90 segundos, que es lo que hace que valga la pena reintentar.

### Obstáculos

| Tipo | Se esquiva | Aparece desde |
|---|---|---|
| Bloque bajo | Saltando | 0 m |
| Barrera alta | Deslizándose | 150 m |
| Hueco | Saltando | 300 m |
| Doble bloque | Salto doble | 600 m |
| Bloque móvil | Ritmo | 1.000 m |

La progresión con la distancia es lo que hace que el juego enseñe sus mecánicas sin tutorial.

### Generación de la pista

Por **tramos**, no obstáculo por obstáculo. Cada tramo es un patrón corto ya validado como
superable, elegido con el PRNG sembrado.

Generar obstáculo a obstáculo al azar produce combinaciones imposibles —un hueco justo después de
una barrera alta, sin espacio para recuperarse— y eso se siente injusto porque lo es. Los patrones
predefinidos garantizan que todo tramo tenga solución.

**Distancia mínima entre tramos:** el tiempo de reacción a la velocidad actual, que a 900 px/s son
unos 400 px. La separación crece con la velocidad.

---

## Puntos

```ts
const distancia = Math.floor(metros) * 10;
const monedas   = monedasRecogidas * 25;
const roce      = esquivadasAjustadas * 15;   // pasar a menos de 20 px de un obstáculo
const points    = distancia + monedas + roce;
```

El bono por roce premia jugar al límite en vez de saltar por las dudas con mucha anticipación. Es
lo que le da techo al que domina el juego.

---

## Control

- **Deslizar arriba** o tocar la mitad superior: saltar.
- **Deslizar abajo** o tocar la mitad inferior: deslizarse.
- **Espacio** y flechas en desktop.
- **Buffer de entrada de 120 ms:** si se toca justo antes de aterrizar, el salto se ejecuta al
  tocar el piso.

Ese buffer es el detalle que separa un runner que se siente justo de uno que se siente sordo. Sin
él, el jugador toca, no pasa nada, y culpa al juego — con razón.

- **Perdón de coyote, 100 ms:** se puede saltar hasta 100 ms después de salir de una plataforma.
  Misma lógica.

---

## Presentación

- Corredor y siluetas como formas geométricas simples con estela.
- **Las siluetas de los demás al 35 % de opacidad**, en gris, con el nombre chico. Nunca en color:
  tienen que leerse como fondo, no competir con tu propio personaje.
- Si alguien te pasa: su nombre destella un instante. Es el momento que genera reacción en la sala.
- Tres capas de parallax: cielo, medio, suelo.
- Al chocar: ralentí de 300 ms, la cámara se acerca, y recién ahí el resumen.
- Marcador de distancia grande, en mono tabular.
- **Marcas cada 100 m** con la posición actual entre los participantes.

Con `prefers-reduced-motion`: sin parallax, sin ralentí, sin destellos. Las siluetas se conservan
—son información— pero quietas en su posición, sin animación de carrera.

---

## El proyector

Distinto a los demás `arena`: acá el proyector **no muestra el juego de nadie**, sino la carrera.

- Una pista horizontal con **todos los participantes como puntos**, en su distancia real.
- El líder destacado.
- Los que van cayendo se apagan y quedan en su marca final.
- Podio en vivo con los tres primeros.

Es un gráfico de carrera actualizándose, y se entiende de un vistazo desde el fondo de la sala.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en celular de gama media |
| Sprites | ~40 de pista, hasta 30 siluetas, ~120 partículas |
| Draw calls | < 8 con el batching de Pixi |
| Red | 360 B/s con 30 participantes |
| Si no llega | Bajar siluetas visibles a las 10 más cercanas, después partículas |

Las siluetas son el elemento que escala con la gente, así que son lo primero que se recorta.

---

## Qué usa de las bases

| De `_engine/` | Para qué |
|---|---|
| `useGame2D`, `loop.ts` | Timestep fijo: con gravedad, delta variable cambia la altura del salto |
| `input.ts` | `swipe` y `keys`, con buffer de entrada |
| `rng.ts` | **La secuencia de tramos**, sembrada e idéntica para todos |
| `pool.ts` | Obstáculos, monedas, partículas |
| `palette.ts`, `hud.tsx` | — |
| `collide.ts` | AABB. A 900 px/s conviene **barrido** en los huecos |

| De `_net/` | Para qué |
|---|---|
| `GameNetPort` | Difusión de distancia a 2 Hz |

**No usa** `GamepadController`: el control es la pantalla propia del juego, no un mando.

---

## Qué NO hacer

- **No** transmitir la posición vertical de las siluetas: se deriva.
- **No** generar obstáculos sueltos al azar: tramos validados.
- **No** siluetas en color.
- **No** vidas.
- **No** omitir el buffer de entrada ni el perdón de coyote.
- **No** difundir a más de 2 Hz.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Carrera con **5 celulares reales**, viéndose las siluetas entre sí.
3. **Con la misma semilla, todos corren exactamente la misma pista.** Verificable comparando la
   secuencia de tramos.
4. Una silueta 40 m adelante está realmente 40 m adelante sobre el mismo terreno.
5. **La posición vertical de las siluetas nunca viaja por la red** — comprobable inspeccionando
   los mensajes.
6. Con 30 participantes, el tráfico no supera 400 B/s.
7. Tocar 100 ms antes de aterrizar **ejecuta el salto** al tocar el piso.
8. Se puede saltar hasta 100 ms después de salir de una plataforma.
9. Ningún tramo generado es imposible de superar a la velocidad a la que aparece.
10. A 900 px/s, el corredor **no atraviesa** un obstáculo ni cae en un hueco sin detectarlo.
11. El proyector muestra la carrera con todos los participantes en su distancia real.
12. 60 fps con 30 siluetas y 120 partículas.
13. `force-end` emite el outcome con la distancia alcanzada.
14. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "corredor",
  title: "Corredor",
  description: "Corré la misma pista que todos. Vas viendo quién te pasa.",
  category: "moderno",
  status: "beta",
  enabled: false,
  engine: "pixi",
  topology: "arena",
  needsNet: true,
  minPlayers: 1,
  maxPlayers: 30,
  qrSlots: 1,
  estimatedMin: 4,
  inputs: ["swipe", "keyboard"],
  tags: ["moderno", "carrera", "reflejos", "misma pista"],
  mode: "internal",
  load: () => import("./corredor/CorredorGame"),
}
```
