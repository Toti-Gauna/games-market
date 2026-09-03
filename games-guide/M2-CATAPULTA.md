# M2 · Catapulta

> **Tanda 5.** Requiere `00-BASES-2D.md` cerrada. Suma **Rapier2D**.
> Categoría **Moderno** · topología `solo` · 1 QR · esfuerzo **M** · motor `canvas2d`

El primer juego con física de verdad. La física lo vende sola: ver una estructura derrumbarse bien
es más satisfactorio que cualquier animación que puedas escribir a mano.

---

## La idea

Angry Birds. Tirás de la catapulta hacia atrás, soltás, y el proyectil vuela en parábola contra una
estructura que se derrumba. **Tres tiros por nivel**, cinco niveles.

Sin metáfora corporativa forzada. Es un juego de puntería y física, y con eso alcanza.

---

## La dependencia

```bash
npm i @dimforge/rapier2d-compat
```

Es la primera vez que entra al proyecto. La versión `-compat` trae el WASM embebido en base64 y
se inicializa con `await RAPIER.init()`, lo que evita configurar la carga del `.wasm` en Vite.
Pesa más, pero para un juego que se carga diferido es el intercambio correcto.

**Por qué Rapier y no Matter.js:** determinismo. Todos los participantes tienen que jugar los
mismos niveles con el mismo comportamiento, o los puntajes no son comparables. Matter.js es más
fácil de arrancar y no garantiza eso.

---

## Reglas

| | |
|---|---|
| Mundo | 1600 × 900, gravedad `−980` px/s² |
| Tiros | 3 por nivel, 5 niveles |
| Fuerza | Según cuánto se estira la banda, tope en 1200 px/s |
| Ángulo | Libre, 360° |
| Fin del nivel | Todos los objetivos destruidos, o se acabaron los tiros |
| Fin de la partida | Los 5 niveles, o `gameDurationMs` |

### Puntos

```ts
const porObjetivo   = 500;                        // cada objetivo destruido
const porEstructura = bloquesDerribados * 25;     // daño colateral
const tirosDeMenos  = tirosSinUsar * 300;         // premia la puntería
const points = porObjetivo + porEstructura + tirosDeMenos;
```

**El bono por tiros sin usar es lo que hace al juego de puntería y no de insistencia.** Sin él,
la estrategia óptima es tirar los tres siempre; con él, resolver un nivel de un tiro vale más que
resolverlo de tres.

---

## Física

- Paso fijo `1/60`, el default de la base. Acá no hace falta `1/120`: el proyectil va rápido pero
  Rapier ya resuelve colisión continua (CCD) internamente. **Activar CCD en el proyectil**, que es
  el único cuerpo veloz.
- La estructura son cuerpos dinámicos rectangulares con densidad y fricción. Los objetivos son
  cuerpos con menos vida.
- Un bloque se destruye si el impulso del impacto supera su umbral. Al destruirse, **se retira del
  mundo** y se emiten partículas.
- **Techo de cuerpos: 60.** Más que eso, con 40 dinámicos apilados, un teléfono de gama media no
  sostiene 60 fps.
- Los cuerpos que salen del mundo se retiran de inmediato. Un cuerpo cayendo al infinito sigue
  costando.
- **Dormir cuerpos quietos.** Rapier lo hace solo; hay que dejarlo, no forzar `wakeUp`.

### El nivel termina cuando el mundo se aquieta

Detalle que se suele errar: después de un tiro, no se puede evaluar el resultado hasta que todo
dejó de moverse. Un bloque tambaleándose puede caer tres segundos después y cambiar el resultado.

La regla: **el turno termina cuando todos los cuerpos duermen, o a los 5 segundos**, lo que pase
primero. Con un indicador sutil de que el mundo se está asentando.

---

## Control

- **Arrastrar hacia atrás** desde la catapulta. La dirección y la distancia definen ángulo y
  fuerza. Soltar dispara.
- **Vista previa de trayectoria**: una línea punteada que muestra la parábola de los primeros
  ~1,2 segundos, actualizada mientras se arrastra.

Esa vista previa es la decisión de diseño que más define el juego. Sin ella, los primeros tiros
son a ciegas y el jugador no aprende. Angry Birds la agregó recién con el tiempo, y es lo que hizo
que la gente pasara del ensayo y error a la puntería.

**Se calcula analíticamente** (parábola con la velocidad inicial), no simulando en el motor: no
hace falta ser exacta con los rebotes, sólo mostrar la salida.

- Zoom out automático mientras el proyectil vuela, para no perderlo de vista.
- En desktop, mismo gesto con el mouse.

---

## Presentación

- Catapulta y proyectiles con la paleta de marca: proyectil en `--sn-magenta` con estela corta.
- Estructura en tonos fríos, objetivos en `--sn-cyan` con un pulso suave para distinguirlos.
- **Cámara** que sigue al proyectil con suavizado y vuelve a la catapulta al terminar el turno.
- Al impactar: partículas del color del bloque, sacudida corta proporcional al impulso.
- Al destruir el último objetivo: **ralentí de 600 ms** con la última pieza cayendo, y después el
  resumen del nivel.
- Los tiros restantes como iconos arriba, del set de la Fase 1.
- Suelo con una textura simple y línea de horizonte. Sin parallax: distrae de la trayectoria.

Con `prefers-reduced-motion`: sin ralentí, sin sacudida, partículas al mínimo. La física es la
misma.

---

## Los cinco niveles

Definidos como **datos**, no generados:

```ts
export type NivelCatapulta = {
  id: string;
  bloques: Array<{ x: number; y: number; w: number; h: number; material: "madera" | "piedra" }>;
  objetivos: Array<{ x: number; y: number }>;
  tiros: number;
};
```

| # | Enseña |
|---|---|
| 1 | Tiro directo. Un objetivo, sin estructura. Es el tutorial sin cartel de tutorial |
| 2 | Que las estructuras se derrumban: el objetivo está debajo de una torre |
| 3 | Que hay que apuntar alto: el objetivo está detrás de un muro |
| 4 | Efecto dominó: dos torres encadenadas |
| 5 | Todo junto, con tres objetivos y tres tiros justos |

Niveles a mano, no procedurales: un nivel generado es un nivel que nadie diseñó, y en cinco niveles
se nota. La progresión es lo que hace que se sienta un juego.

---

## Presupuesto

| | |
|---|---|
| Objetivo | 60 fps en proyector y celular de gama media |
| Cuerpos dinámicos | máx. 60, con dormido activo |
| Partículas | máx. 150, pooleadas |
| Si no llega | Bajar partículas a 60, después reducir bloques por nivel |

Rapier corre en el hilo principal. Con 60 cuerpos alcanza; si en algún momento hiciera falta más,
va a un Web Worker, pero no antes de necesitarlo.

---

## Qué usa de la base

| De `_engine/` | Para qué |
|---|---|
| `useGame2D` | Montaje, loop, duración, `force-end`, outcome |
| `loop.ts` | Timestep fijo que alimenta a Rapier |
| `input.ts` | `pointer` para arrastrar y soltar |
| `rng.ts` | Nada crítico: los niveles son fijos. Sólo variación de partículas |
| `pool.ts` | Partículas |
| `camera.ts` | Seguimiento del proyectil y sacudida |
| `palette.ts` | Colores |
| `hud.tsx` | Tiros restantes, puntaje, nivel |

`collide.ts` **no se usa**: la colisión la resuelve Rapier.

---

## Qué NO hacer

- **No** Matter.js. Determinismo.
- **No** simular la trayectoria en el motor para la vista previa: se calcula analíticamente.
- **No** evaluar el turno antes de que el mundo se aquiete.
- **No** generar niveles proceduralmente.
- **No** dejar cuerpos fuera del mundo sin retirar.
- **No** forzar `wakeUp` en cuerpos dormidos.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Los cinco niveles se completan y la progresión se siente.
3. **Determinismo:** el mismo tiro (misma posición de arrastre) produce **exactamente** el mismo
   derrumbe dos veces. Verificable comparando posiciones finales de los cuerpos.
4. 60 fps con 60 cuerpos dinámicos y una torre derrumbándose.
5. La vista previa de trayectoria coincide con el vuelo real en el primer tramo.
6. El turno no se evalúa hasta que el mundo se aquieta o pasan 5 segundos.
7. El proyectil **nunca atraviesa** un bloque (CCD activo).
8. Resolver un nivel con un tiro da más puntos que con tres.
9. Los cuerpos quietos duermen — verificable: el tiempo de paso de Rapier baja cuando la escena se
   aquieta.
10. `force-end` emite el outcome con los niveles completados hasta ahí.
11. Con `prefers-reduced-motion` no hay ralentí ni sacudida.
12. El chunk de Rapier **no entra** en el bundle inicial.
13. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "catapulta",
  title: "Catapulta",
  description: "Apuntá, soltá y mirá cómo se cae todo. Tres tiros por nivel.",
  category: "moderno",
  status: "estable",
  enabled: true,
  engine: "canvas2d",
  topology: "solo",
  needsNet: false,
  minPlayers: 1,
  maxPlayers: 1,
  qrSlots: 1,
  estimatedMin: 5,
  inputs: ["touch"],
  tags: ["moderno", "física", "puntería", "individual"],
  mode: "internal",
  load: () => import("./catapulta/CatapultaGame"),
}
```
