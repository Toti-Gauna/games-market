# R2 · Carreras

> **Tanda 9.** Requiere `00-BASES-2D.md` cerrada.
> Categoría **Retro** · topología `solo` · 1 QR · esfuerzo **L** · motor `pixi` (WebGL)
>
> **Actualizado.** Viene de una tanda anterior a las fases 1 y 2. Se conservó lo que ya estaba
> bien y se reemplazó lo que ahora resuelven las bases. Ver "Qué cambió" al final.

Perspectiva Mode 7, como los karts de 16 bits. **Sin netcode**: cada persona corre sola en su
celular y el ranking del tour los compara.

> Copiá y pegá todo lo que sigue en el chat. Se implementa dentro de
> `supernova-experience/frontend`, como juego del registry de Supernova Tour.
> Requiere que el dashboard del tour ya exista.

---

Usá las reglas de `CLAUDE.md` y `AGENTS.md`.

Quiero **Supernova Rush**: un juego de carreras **2D** que se juega **individual desde el
celular** — cada persona corre su propia partida — con la **perspectiva de un Mario Kart:
la cámara detrás del auto, mirando la pista que se abre hacia el horizonte**. Al final,
los tiempos arman un ranking.

Tiene que verse premium y correr a **60 fps en celular**.

---

## 0. Antes de escribir código

Leé `docs/CONTRATO-JUEGOS.md` completo. Después mostrame un plan por fases y esperá mi
visto bueno antes de codear.

---

## 1. La técnica: Mode 7

Lo que pedís —2D pero con la pista abriéndose en perspectiva detrás del auto— tiene nombre:
es **Mode 7**, lo que usaba el Super Mario Kart original. Y es exactamente la técnica
correcta acá.

**Cómo funciona:** la pista es **un bitmap plano visto desde arriba**. No hay geometría 3D.
Para cada línea horizontal de la pantalla se calcula qué franja del bitmap le corresponde
según la distancia al horizonte, y se dibuja deformada. El resultado se lee como 3D, pero
todo el juego sigue siendo 2D: posiciones en un plano, colisiones en 2D, IA en 2D.

Ventajas para nosotros: el gameplay es simple de razonar y depurar, la pista se diseña
dibujando una imagen, y el costo de render es predecible.

### Implementalo en WebGL, no en Canvas 2D

Mode 7 es una transformación **por píxel**. Hacerlo en JS sobre un `ImageData` es
jugar con fuego en un celular: a 1080p son dos millones de píxeles por frame en el hilo
principal.

- **Camino principal:** un quad a pantalla completa con un **fragment shader** que hace la
  proyección inversa. La GPU lo resuelve sin despeinarse y te queda margen para efectos.
  Podés usar Three.js con una `OrthographicCamera` y un `ShaderMaterial`, o WebGL pelado.
- **Fallback:** Canvas 2D con `drawImage` por franjas (agrupá de a 3-4 líneas, no una por
  una) y **resolución interna baja** (480×270) escalada por CSS. Se ve retro y es
  aceptable, pero es plan B.

La matemática de la proyección por scanline: para cada línea `y` bajo el horizonte,
la distancia es `d = (alturaCamara * escala) / (y - horizonte)`, y de ahí sacás las
coordenadas del bitmap rotando por el ángulo de la cámara. Verificalo con una pista de
grilla antes de dibujar nada lindo: si la grilla no converge recta al horizonte, la
proyección está mal y todo lo que construyas encima va a estar torcido.

---

## 2. Topología: `solo`

```ts
{
  id: "carreras",
  title: "Supernova Rush",
  description: "Tres vueltas en perspectiva. Todos corren el mismo circuito.",
  category: "retro",
  status: "beta",
  enabled: true,           // es `solo`: no hace falta apagarlo
  engine: "pixi",
  topology: "solo",
  needsNet: false,
  minPlayers: 1,
  maxPlayers: 1,
  qrSlots: 1,
  estimatedMin: 4,
  inputs: ["tilt", "touch"],
  tags: ["retro", "carrera", "individual", "mode 7"],
  mode: "internal",
  load: () => import("./carreras/CarrerasGame"),
}
```

**Sin netcode.** Cada persona corre sola en su celular. Es el más simple de los cuatro en
ese aspecto, y por eso conviene hacerlo antes que el shooter.

Los rivales en pista son **IA local**, iguales para todos porque salen de la misma semilla
determinista. El ranking se arma después, comparando tiempos.

---

## 3. Reglas

- **3 vueltas** a un circuito cerrado.
- Duración objetivo: **90-120 segundos** por partida completa.
- 5 rivales de IA en pista, para que no se sienta vacío y para tener referencia visual.
  **No compiten por el puntaje**: el ranking del tour compara tiempos entre personas reales.
- Cuenta regresiva de 3 al arrancar. El acelerador arranca solo (auto-acelerar): en móvil,
  pedir que mantengan un botón de gas ocupa un pulgar que hace falta para girar.
- **Salirse de la pista** no descalifica: frena fuerte (60 % de velocidad máxima) y hace
  temblar la cámara. Es castigo suficiente y no frustra.
- **Checkpoints obligatorios** repartidos por el circuito. Una vuelta sólo cuenta si se
  pasaron todos en orden. Sin esto, alguien cruza la meta en reversa y "gana".
- Si alguien se queda trabado o de contramano por más de 5 segundos, reposicionarlo en el
  último checkpoint mirando bien, con 1 segundo de invulnerabilidad visual.

---

## 4. Manejo: dónde está el jugo

Un juego de carreras se define por cómo se siente el auto. Prestale más tiempo a esto que
al arte.

- **Derrape (drift).** Mantener el botón de derrape al girar hace que el auto deslice, y
  al soltarlo da un **impulso de turbo** proporcional a cuánto se sostuvo (tres niveles,
  con el color de las chispas cambiando: cyan → violeta → magenta). Es *el* mecanismo que
  hace divertido a un Mario Kart. No lo omitas.
- Modelo de manejo **arcade, no simulación**: velocidad, ángulo, y un factor de deslizamiento
  lateral. Nada de neumáticos ni suspensión.
- Aceleración con curva: rápido al principio, asintótico al final.
- La cámara **se retrasa** al acelerar y **se acerca** al frenar. Aumentá levemente el FOV
  con la velocidad. Es lo que da sensación de velocidad sin cambiar la velocidad real.
- Al chocar contra una pared: rebote, pérdida de velocidad y screen shake.
- **Rampas de turbo** en la pista: paneles que dan un impulso corto. Se leen como acento
  cyan brillante en el suelo.

---

## 5. La pista

Cada circuito son **tres capas**, todas generadas o dibujadas por código:

1. **Bitmap visual** — lo que se ve. Asfalto, líneas, bordes, zonas de pasto.
2. **Mapa de superficie** — misma resolución, colores planos que codifican el tipo de
   suelo: pista, pasto (frena), pared (choca), turbo, meta. El juego lee **este** bitmap
   para la física, con un `getImageData` cacheado en un `Uint8Array` al cargar.
   **Nunca hagas `getImageData` por frame.**
3. **Datos del circuito** — checkpoints en orden, línea de meta, puntos de salida y la
   ruta que siguen los rivales de IA (una polilínea con velocidad sugerida por tramo).

Arrancá con **un circuito**, hecho a mano y bien afinado. Un generador procedural de
circuitos que se sientan bien es un proyecto en sí mismo; si sobra tiempo, después.

---

## 6. Sprites y profundidad

Los rivales, los objetos y los carteles son **sprites 2D escalados por distancia**, como
en el original.

- Escala inversamente proporcional a la distancia; posición en pantalla desde la misma
  proyección del suelo.
- **Dibujalos de lejos a cerca** (painter's algorithm). Si no ordenás por profundidad, un
  auto lejano se dibuja encima de uno cercano y se rompe la ilusión al instante.
- El auto propio va fijo en la parte baja de la pantalla, con inclinación al girar y un
  leve rebote al acelerar.
- Sombra: una elipse oscura bajo cada sprite. Barato y ancla los objetos al piso; sin
  ella todo parece flotar.

---

## 7. Arte

- Cielo con degradado violeta profundo a magenta en el horizonte, con estrellas. Es
  Supernova: la pista corre por el espacio.
- Asfalto oscuro con líneas emisivas cyan en los bordes. **Los bordes brillantes son lo
  que te deja leer la curva desde lejos** — es funcional antes que decorativo.
- Niebla hacia el horizonte, del color del cielo, para fundir el corte del bitmap.
- Estela de las ruedas al derrapar, con el color del nivel de turbo cargado.
- Líneas de velocidad radiales sutiles en los bordes de la pantalla al ir rápido o con
  turbo activo.
- HUD: vuelta actual, tiempo total, tiempo de vuelta y mejor vuelta, en `Colour Sans` con
  `tabular-nums`. Posición contra los rivales, discreta.
- Al cruzar la meta: destello, congelamiento breve y el tiempo en grande.

Con `prefers-reduced-motion`: sin shake, sin líneas de velocidad, sin cambio de FOV.

---

## 8. Controles (celular)

- **Portrait o landscape**: los dos tienen que andar, con el HUD adaptado. Landscape es
  mejor y podés sugerirlo, pero no lo fuerces — es un juego corto y mucha gente lo va a
  agarrar en vertical.
- **Girar**: dos zonas táctiles grandes, izquierda y derecha, en la mitad inferior. Alternativa
  con acelerómetro (`deviceorientation`) **como opción, no como default**: no siempre hay
  permiso y no todos lo disfrutan.
- **Derrapar**: un botón grande en la esquina inferior derecha.
- Sin botón de gas (auto-acelerar). Freno: tocar las dos zonas de giro a la vez.
- Zonas táctiles **grandes y generosas** — mínimo 64 px — y con feedback visual al tocar.
- `touch-action: none`, sin zoom, sin pull-to-refresh.

---

## 9. Presupuesto de rendimiento

| Métrica | Objetivo |
|---|---|
| FPS en celular | **60** |
| Tiempo de frame | < 16 ms |
| Draw calls (WebGL) | < 25 |
| Asignaciones en el loop | cero |
| Sprites en pantalla | < 40 |

- Mode 7 en la GPU, no en JS.
- El mapa de superficie leído una vez a un `Uint8Array` y consultado por índice.
- Pooling de partículas (chispas de derrape, humo).
- Timestep fijo `1/60` con acumulador; render interpolado.
- Loop pausado con `document.hidden`.
- Cap de `pixelRatio` en 1.5 en celular.

---

## 10. Puntaje

Es un juego contrarreloj: el puntaje sale del tiempo, pero el **ranking del tour es por
puntos** (ver `CONTRATO-JUEGOS.md`). Confirmame la fórmula:

```
tiempoObjetivo = 95_000 ms          // afinar cuando el circuito esté listo
base           = 300
bonusTiempo    = max(0, (tiempoObjetivo - tiempoTotal) / 1000) * 6
bonusVuelta    = max(0, (tiempoObjetivo/3 - mejorVuelta) / 1000) * 4
penalizacion   = salidasDePista * 5

puntos = round(base + bonusTiempo + bonusVuelta - penalizacion)   // mínimo 50
```

Quien no termina las 3 vueltas recibe puntos proporcionales al avance
(`completed: false`), nunca cero: si no, la mitad de la sala no ve su nombre.

`meta`: `{ totalMs, bestLapMs, laps, offTrackCount, topSpeed }`.

---

## 11. Fases

1. **Mode 7 andando.** Un quad con el shader, una pista de grilla, cámara que se mueve y
   rota con el teclado. **Verificá que la grilla converja recta al horizonte** antes de
   seguir. Nada de gameplay todavía.
2. **Auto y manejo.** Aceleración, giro, derrape con turbo, colisión contra el mapa de
   superficie, cámara dinámica. Acá es donde se define si el juego es divertido: iterá
   hasta que se sienta bien **antes** de dibujar nada lindo.
3. **Circuito completo.** Las tres capas, checkpoints, vueltas, meta, reposicionamiento.
4. **Rivales y sprites.** IA por polilínea, escalado por distancia, orden por profundidad,
   sombras.
5. **Arte y HUD.** Cielo, niebla, bordes emisivos, partículas, líneas de velocidad, HUD,
   pantalla de resultado.
6. **Controles táctiles y perfilado en celular.** Zonas grandes, opción de acelerómetro,
   medición real de fps.
7. **Integración con el tour.** Registry, `GameOutcome`, `forceEnd()`.

---

## 12. Qué NO hacer

- No hagas Mode 7 por píxel en JS sobre `ImageData`.
- No llames `getImageData` dentro del loop.
- No dibujes sprites sin ordenar por profundidad.
- No hagas simulación física realista: es arcade.
- No pongas botón de acelerar.
- No descalifiques por salirse de la pista.
- No dejes que una vuelta cuente sin pasar todos los checkpoints.
- No hardcodees colores: leé los tokens `--sn-*` una vez y cacheá.
- No importes nada de `core/tour/` dentro del juego.
- No pases a la fase 3 si el manejo todavía no se siente bien.

---

## 13. Criterios de aceptación

- [ ] `npm run typecheck` limpio.
- [ ] **60 fps en celular real**, medido y reportado con número.
- [ ] La pista converge correctamente al horizonte, sin deformaciones raras al girar.
- [ ] El derrape carga turbo en tres niveles y el impulso al soltar se siente.
- [ ] Salirse de la pista frena; chocar una pared rebota; los turbos impulsan.
- [ ] Cruzar la meta sin pasar los checkpoints **no** cuenta la vuelta.
- [ ] Quedarse trabado o de contramano reposiciona a los 5 segundos.
- [ ] Los sprites lejanos nunca se dibujan encima de los cercanos.
- [ ] Heap plano durante una carrera completa.
- [ ] Jugable con una sola mano en portrait y con dos en landscape.
- [ ] `forceEnd()` emite outcome parcial proporcional al avance.
- [ ] Con `prefers-reduced-motion` no hay shake ni líneas de velocidad y sigue jugable.
- [ ] El juego no importa nada de `core/tour/`.

---

## 14. Cómo reportar

Al terminar cada fase: qué construiste, **qué probaste en el navegador y en qué celular**,
qué quedó sin probar, y qué decisión tomaste que yo no había definido.

En la fase 2, además de lo técnico, contame **cómo se siente el manejo**. Si no se siente
bien, decilo: es lo único que no se arregla después.

---

## 15. Qué cambió respecto del prompt heredado

- **Entrada de registry actualizada** con los campos de las fases 2 y 3. Llega **encendido**: es
  `solo`, así que no aplica la regla de apagar los multijugador.
- **El loop, el input, el pooling y la paleta salen de `00-BASES-2D.md`.** El timestep fijo que el
  prompt ya pedía es el de la base, con `step` configurable por juego.
- **El renderizador Mode 7 va sobre PixiJS**, no sobre WebGL a mano. Pixi ya entra al proyecto por
  Ninja y Match-3, y expone el contexto WebGL para el shader de proyección sin montar otra capa.
- **El circuito se genera con `config.seed`** desde el `rng.ts` compartido: todos corren el mismo,
  que es lo que hace comparables los tiempos en el ranking.
- **El control por inclinación reutiliza `requestTilt()`** de la base, con el mismo flujo de
  permiso y calibración que M4 Saltarín, incluido el fallback táctil obligatorio.
- Se corrigió el catálogo, que lo tenía mal como `arena` con red. Es `solo` y siempre lo fue.
- Se quitó la referencia a `docs/PROMPT-SUPERNOVA-TOUR.md §7`.
