# X1 · Pinturillo

> **Tanda 7.** Requiere `00-BASES-2D.md` y `02-BASES-NETCODE.md` cerradas.
> Categoría **Creativos** · topología `arena` · 1 QR · esfuerzo **L** · motor `canvas2d`

El más disfrutable en grupo de los 24. Una persona dibuja en su celular, se ve en la pantalla
grande, y el resto adivina. No hay reflejos ni puntería: hay una sala riéndose.

---

## La idea

Rondas. En cada una, alguien **dibuja** una palabra que le tocó; los demás **escriben** qué creen
que es. Puntos por adivinar rápido, y el que dibuja también puntúa según cuánta gente acertó.

El turno rota hasta que todos dibujaron una vez, o hasta que se acaba el tiempo.

---

## El riesgo que hay que nombrar

Es un evento de empresa con una pantalla de tres metros, y alguien va a dibujar algo que no
corresponde. No es una posibilidad remota: es lo que pasa.

Tres medidas, y ninguna es opcional:

1. **Botón de pánico en el control en vivo.** El host puede **borrar el lienzo** y **saltear la
   ronda** en un toque, desde su pantalla, sin tocar el proyector.
2. **Filtro de texto** en los intentos de adivinanza, el mismo del motor de quiz. Los mensajes se
   proyectan; van filtrados.
3. **Los intentos no aciertos no se proyectan por defecto.** Sólo se ve *"Ana está escribiendo"* y
   los aciertos. Se puede activar el chat completo si el host quiere, pero el default es el
   seguro.

Sin esto, el juego es un riesgo para quien organiza el evento. Con esto, es el mejor momento de la
presentación.

---

## Rondas

| Fase | Duración | Proyector | El que dibuja | Los demás |
|---|---|---|---|---|
| Elección | 10 s | *"Le toca a Ana"* | **3 palabras a elegir** | Espera |
| Dibujo | 75 s | El dibujo apareciendo + pistas | Lienzo y herramientas | Campo de texto |
| Cierre | 8 s | La palabra + quién acertó + puntos | Su puntaje | Su puntaje |

**Pistas progresivas.** La palabra se muestra como guiones `_ _ _ _ _`, y se van revelando letras:

- A los 45 s restantes: una letra.
- A los 25 s: otra.
- A los 10 s: una más.

Es lo que evita que una ronda se muera en silencio. Cuanto peor va el dibujo, más ayuda la palabra.

---

## Puntos

```ts
// Quien adivina
const acierto = 400 + Math.floor(tiempoRestante / tiempoTotal * 600);

// Quien dibuja
const dibujante = acertaron === 0
  ? 0
  : 200 + acertaron * 150;   // tope natural: si aciertan todos, saca mucho
```

Que el dibujante puntúe **según cuánta gente acertó** es lo que lo alinea con la sala: no le
conviene hacer un dibujo imposible ni uno que resuelva una sola persona. Le conviene que lo
entiendan todos.

Y si **nadie** acierta, saca cero. Eso desalienta el dibujo críptico mejor que cualquier regla.

---

## El dibujo por red

La parte técnica interesante. **No se mandan imágenes.**

```ts
type TrazoDelta = {
  t: "start" | "move" | "end";
  x: number;      // 0..1 normalizado
  y: number;
  p?: number;     // presión, si el dispositivo la reporta
};
```

- El celular manda **puntos normalizados**, agrupados en lotes de ~50 ms. Cada lote son unos pocos
  puntos, no una imagen.
- El proyector reconstruye el trazo. Como los puntos vienen normalizados, el dibujo escala solo a
  cualquier resolución.
- **`perfect-freehand`** convierte la secuencia de puntos en un contorno relleno, en vez de una
  polilínea. Es la diferencia entre un trazo que parece dibujado y uno que parece un gráfico.

```bash
npm i perfect-freehand
```

- Cada trazo terminado se guarda en una lista. **Deshacer** quita el último; **borrar** vacía la
  lista. Las dos operaciones se mandan como un evento, no como un redibujado.
- Un jugador que entra tarde recibe **la lista de trazos completa** y reconstruye el dibujo. Sin
  esto, entra a una pantalla en blanco mientras todos ven un dibujo a medias.

Tolerancia de latencia: **~200 ms**. El dibujo aparece un instante después y nadie lo nota. No
hace falta WebRTC.

---

## Adivinar

- Campo de texto en el celular, con teclado. **Es el único de los 24 que necesita teclado**, y por
  eso el campo tiene que estar arriba, donde el teclado virtual no lo tape.
- Comparación **normalizada**: sin mayúsculas, sin acentos, sin espacios de más, sin signos.
- **Casi acierto:** si la palabra escrita está a una letra de distancia (Levenshtein 1), el
  teléfono avisa *"¡Casi!"* sólo a esa persona. Es lo que evita la frustración de escribir bien
  una palabra con un dedo torpe.
- Al acertar: el campo se bloquea, la persona pasa a ver los aciertos de los demás, y **puede
  seguir mirando el dibujo**.
- Quien dibuja no puede escribir.

---

## Herramientas del que dibuja

Lo mínimo que hace falta, y nada más:

- **6 colores** de la paleta de marca, más negro y blanco.
- **3 grosores.**
- **Borrador.**
- **Deshacer.**
- **Borrar todo**, con confirmación: borrar sin querer a los 60 segundos es doloroso.

Sin relleno, sin formas, sin capas. Cada herramienta de más es una que hay que explicar, y la
ronda dura 75 segundos.

---

## El proyector

- El dibujo grande, centrado, ocupando la mayor parte.
- La palabra en guiones arriba, con las letras reveladas.
- Reloj como barra.
- Lista de jugadores al costado con su puntaje y **un tilde cuando aciertan** — verlos caer uno a
  uno es parte de la gracia.
- *"Ana está escribiendo…"* cuando alguien tipea, sin mostrar qué.
- Al cerrar: la palabra en grande, quién acertó y en qué orden.

---

## Palabras

Cuatro listas, como datos:

| Lista | Ejemplos |
|---|---|
| `general` | Objetos y acciones cotidianas |
| `oficina` | Reunión, café, teclado, pizarra |
| `empresa` | Productos, áreas, hitos propios |
| `dificil` | Conceptos abstractos, para rondas finales |

Reglas de escritura:

- **Dibujables.** "Sinergia" no es una palabra para este juego, por más corporativa que suene.
- Sustantivos y acciones concretas, no adjetivos.
- Sin nombres de personas de la empresa. Dibujar a un compañero en una pantalla gigante sale mal
  la mitad de las veces.
- Tres niveles de dificultad, y las tres opciones que se ofrecen son de niveles distintos: una
  fácil, una media y una difícil. Elegir es parte del juego.

---

## Estados

1. **Lobby** — un QR, se necesitan **al menos 3**: uno dibuja y dos adivinan. Con dos, es raro.
2. **Alguien entra a mitad** — recibe los trazos actuales y entra a adivinar. Dibuja en la ronda
   siguiente.
3. **El dibujante se desconecta** — la ronda se cancela sin puntos y pasa al siguiente. **No** se
   espera: dejar a la sala mirando un lienzo congelado es peor que perder la ronda.
4. **Se desconecta alguien que adivina** — sigue todo, su puntaje queda donde estaba.
5. **Nadie acierta** — se muestra la palabra igual, el dibujante saca 0.
6. **El host saltea** — ronda cancelada sin puntos.
7. **`force-end`** — outcomes de todos con lo acumulado.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en proyector y celular |
| Trazos por dibujo | ~120, con ~40 puntos cada uno |
| Ancho de banda | < 2 KB/s mientras se dibuja |
| Redibujado | **Sólo el trazo en curso.** Los terminados van a un canvas de fondo |

Ese último punto es la clave del rendimiento: redibujar 120 trazos cada frame no escala. Los
trazos cerrados se pintan **una vez** en un canvas de caché; sólo el que se está dibujando se
repinta.

---

## Qué usa de las bases

| De `_engine/` | Para qué |
|---|---|
| `useGame2D`, `loop.ts` | Loop y ciclo de vida |
| `input.ts` | `pointer` con historial de puntos |
| `palette.ts`, `hud.tsx` | — |

| De `_net/` | Para qué |
|---|---|
| `GameNetPort` | Lotes de trazo, intentos, estado de ronda |
| `_quiz/live/` | **La máquina de fases y el filtro de texto**, reutilizados |

Que la máquina de rondas salga de `_quiz/live/` no es forzado: es exactamente el mismo patrón de
fases cronometradas por el host que usan Trivia y Verdadero o falso.

---

## Qué NO hacer

- **No** mandar imágenes ni `toDataURL`: puntos normalizados.
- **No** redibujar los trazos cerrados cada frame.
- **No** proyectar los intentos sin filtrar.
- **No** dejar al host sin botón de borrar y saltear.
- **No** esperar al dibujante desconectado.
- **No** poner palabras abstractas ni nombres de personas.
- **No** más herramientas de las cinco.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Ronda completa con **4 celulares reales**: uno dibuja, tres adivinan, se reparten puntos.
3. El dibujo aparece en el proyector **mientras se dibuja**, con menos de 300 ms de retraso.
4. Alguien que entra a mitad de la ronda **ve el dibujo ya hecho**, no un lienzo vacío.
5. El trazo se ve como trazo, no como polilínea.
6. Escribir la palabra con un error de una letra muestra *"¡Casi!"* sólo a esa persona.
7. Acentos, mayúsculas y espacios de más **no** impiden el acierto.
8. **El host puede borrar el lienzo y saltear la ronda** desde el control en vivo.
9. Un intento con una palabra vetada no se proyecta.
10. Los intentos fallidos no se proyectan por defecto.
11. Si nadie acierta, el dibujante saca 0.
12. Desconectar al dibujante cancela la ronda y pasa a la siguiente.
13. 60 fps con 120 trazos en el lienzo.
14. Menos de 2 KB/s de tráfico mientras se dibuja.
15. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "pinturillo",
  title: "Pinturillo",
  description: "Uno dibuja, todos adivinan. En la pantalla grande.",
  category: "creativo3d",
  status: "beta",
  enabled: false,
  engine: "canvas2d",
  topology: "arena",
  needsNet: true,
  minPlayers: 3,
  maxPlayers: 20,
  qrSlots: 1,
  estimatedMin: 12,
  inputs: ["touch"],
  tags: ["creativo", "social", "sala", "dibujo"],
  mode: "internal",
  load: () => import("./pinturillo/PinturilloGame"),
}
```
