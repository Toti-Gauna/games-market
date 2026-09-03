# M5 · Ninja

> **Tanda 5.** Requiere `00-BASES-2D.md` cerrada. Primer juego con **PixiJS**.
> Categoría **Moderno** · topología `solo` · 1 QR · esfuerzo **M** · motor `pixi`

Fruit Ninja. El juego más visual de los `solo` y el que estrena Pixi en el proyecto: es el primero
donde Canvas 2D empieza a quedarse corto.

---

## Por qué Pixi acá y no en los otros

Serpiente, Flappy y Saltarín dibujan decenas de formas simples. Este dibuja **cientos de sprites
con rotación, escala y opacidad propias**: cada mitad de fruta cortada, cada gota, cada partícula
de jugo, la estela del corte.

A partir de ~200 sprites móviles con transformaciones, Canvas 2D empieza a costar por el
`ctx.save()`/`restore()` y el cambio de estado por objeto. Pixi los agrupa en lotes y los manda
en pocas llamadas de dibujo.

```bash
npm i pixi.js
```

**No arrastra `@pixi/react`.** El juego usa la API imperativa de Pixi dentro del loop de la base:
meter un reconciliador de React en un loop a 60 fps es exactamente lo que las reglas del proyecto
prohíben.

---

## La idea

Las frutas salen despedidas desde abajo. Se cortan **deslizando el dedo**. Las bombas terminan la
partida. Cortar varias de un solo trazo da combo.

---

## El corte: el detalle que define el juego

Es el error clásico del género y hay que resolverlo bien desde el principio.

**Mal:** preguntar en cada frame si el dedo está encima de una fruta. Con un deslizamiento rápido,
el dedo salta 200 px entre frames y pasa por arriba de tres frutas sin tocar ninguna.

**Bien:** tratar el movimiento del dedo entre dos frames como un **segmento**, y comprobar
intersección segmento-círculo contra cada fruta.

```ts
// distancia mínima del centro de la fruta al segmento del trazo
function corta(p1: Vec2, p2: Vec2, centro: Vec2, radio: number): boolean {
  // proyección del centro sobre el segmento, acotada a [0,1]
  // corta si la distancia resultante <= radio
}
```

Dos condiciones más, que son las que hacen que se sienta justo:

- **Velocidad mínima** del trazo: 300 px/s. Apoyar el dedo y moverlo despacio no corta. Sin esto,
  la estrategia óptima es dejar el dedo quieto en el medio.
- **El ángulo del corte** define cómo se separan las mitades. Un corte diagonal separa en
  diagonal. Es puro detalle y es lo que hace que se vea bien.

---

## Reglas

| | |
|---|---|
| Mundo | 480 × 800, vertical |
| Lanzamiento | Tandas de 1 a 5 frutas cada 1,2–2,5 s |
| Física | Parábola simple, sin motor. Gravedad 900 px/s² |
| Vidas | 3. Se pierde una por cada fruta que cae sin cortar |
| Bombas | Cortar una **termina la partida** en el acto |
| Fin | 3 vidas perdidas, una bomba, o `gameDurationMs` |

Las bombas aparecen desde los 300 puntos, con probabilidad creciente hasta 1 de cada 6.

### Puntos

```ts
const porFruta = 50;
const combo    = frutasEnUnTrazo >= 3 ? frutasEnUnTrazo * 30 : 0;
const racha    = cortesConsecutivosSinFallar >= 10 ? 200 : 0;
const points   = porFruta * frutasCortadas + sumaDeCombos + rachas;
```

El combo por trazo es lo que hace que valga esperar a que se junten tres frutas en vez de cortar
apenas aparecen. Le da decisión a un juego que si no sería reflejo puro.

---

## Presentación

Es el juego donde el apartado visual justifica el esfuerzo.

- **Frutas** como formas geométricas con degradé de la paleta: círculos, hexágonos, gotas. Sin
  assets: se generan como texturas de Pixi al arrancar y se reutilizan.
- **Al cortar:** la fruta se parte en dos mitades que salen con rotación e inercia propias, más un
  chorro de 12–20 partículas de jugo del color de la fruta.
- **Estela del corte:** una cinta que sigue al dedo con las últimas ~14 posiciones, con ancho
  decreciente y desvanecimiento. Es el elemento más vistoso del juego y cuesta poco.
- **Salpicaduras** en el fondo que quedan durante unos segundos, acumulándose. Dan la sensación de
  que la partida deja marca.
- **Bomba:** esfera oscura con mecha animada y un pulso rojo. Tiene que ser **inconfundible** a un
  vistazo, porque cortarla termina la partida y confundirla se siente injusto.
- Al cortar una bomba: flash blanco, sacudida fuerte, todo se detiene.
- Combo: el número aparece grande en el punto del corte y sube desvaneciéndose.

Con `prefers-reduced-motion`: sin sacudida, sin flash, estela más corta, la mitad de partículas.
Las frutas y el corte funcionan igual.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en celular de gama media |
| Sprites activos | máx. 400 (frutas, mitades, partículas, salpicaduras) |
| Draw calls | < 10, por el batching de Pixi |
| Texturas | Generadas una vez al arrancar, reutilizadas |
| Si no llega | Partículas de jugo a la mitad, después salpicaduras del fondo |

Todo pooleado: frutas, mitades, partículas y salpicaduras salen de pools preasignados. Un
`new Sprite()` por partícula es exactamente lo que la base prohíbe.

**Resolución de Pixi topeada** con el mismo criterio de la base: `min(devicePixelRatio, 1.5)` en
celular.

---

## Qué usa de la base

| De `_engine/` | Para qué |
|---|---|
| `useGame2D` | Montaje, loop, duración, `force-end`, outcome |
| `loop.ts` | Timestep fijo alimentando la física de las frutas |
| `input.ts` | `pointer` con posición **del frame anterior**, para armar el segmento |
| `rng.ts` | Qué fruta, desde dónde, con qué impulso — sembrado |
| `pool.ts` | Todo |
| `camera.ts` | Sólo sacudida |
| `palette.ts` | Colores |
| `hud.tsx` | Puntaje, vidas, combo |

`canvas.ts` **no se usa**: el escalado lo maneja Pixi. Pero **el tope de DPR es el mismo** y hay
que aplicarlo a mano al crear la aplicación de Pixi.

---

## Qué NO hacer

- **No** `@pixi/react`. API imperativa dentro del loop.
- **No** detectar el corte por punto: es por segmento.
- **No** cortar sin velocidad mínima.
- **No** crear sprites ni texturas en el loop.
- **No** hacer la bomba parecida a una fruta.
- **No** delta variable.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. **La prueba del corte:** un deslizamiento muy rápido sobre tres frutas alineadas **corta las
   tres**. Con detección por punto, fallaría.
3. Apoyar el dedo y moverlo despacio **no corta**.
4. Cortar tres o más de un trazo da combo, y el número aparece en el punto del corte.
5. 60 fps con 400 sprites activos, medido en Performance.
6. Menos de 10 draw calls, verificable con el inspector de Pixi.
7. Cero recolecciones de basura en 60 segundos.
8. La bomba se distingue de cualquier fruta a un vistazo, **también en escala de grises**.
9. Con la misma semilla, salen las mismas frutas en el mismo orden.
10. El DPR efectivo en celular no supera 1.5.
11. `force-end` emite el outcome con lo cortado hasta ahí.
12. Con `prefers-reduced-motion` no hay sacudida ni flash, y se juega igual.
13. El chunk de Pixi **no entra** en el bundle inicial.
14. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "ninja",
  title: "Ninja",
  description: "Cortá todo lo que salga. Menos las bombas.",
  category: "moderno",
  status: "estable",
  enabled: true,
  engine: "pixi",
  topology: "solo",
  needsNet: false,
  minPlayers: 1,
  maxPlayers: 1,
  qrSlots: 1,
  estimatedMin: 3,
  inputs: ["swipe"],
  tags: ["moderno", "reflejos", "individual", "vistoso"],
  mode: "internal",
  load: () => import("./ninja/NinjaGame"),
}
```
