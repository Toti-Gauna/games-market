# X5 · Metaverso

> **Tanda 8.** Requiere `01-BASES-3D.md` y `02-BASES-NETCODE.md` cerradas.
> Categoría **Creativos/3D** · topología `arena` · 1 QR · esfuerzo **XL** · motor `r3f`

El más caro de los 24 y el único que **no es un juego**. Antes de escribir una línea hay que
resolver para qué sirve, porque un espacio 3D sin propósito es una demo técnica que se recorre una
vez.

---

## Para qué sirve, en concreto

Un espacio recorrible tiene sentido en tres momentos reales de un evento:

1. **Antes de empezar.** La gente llega de a poco. En vez de una pantalla de "esperando
   participantes", entran a un espacio y se mueven mientras espera el resto.
2. **Entre bloques.** El intermedio de la Fase 2, pero con cuerpo: la gente se dispersa, charla,
   vuelve.
3. **Como feria.** Un espacio con **estaciones**: cada una muestra contenido —un área de la
   empresa, un producto, un hito— y quien se acerca lo ve.

El tercero es el que justifica el costo. Sin estaciones es un lobby bonito; con estaciones es un
stand recorrible, que es algo que las empresas hoy montan en persona y no pueden repetir cuando la
mitad del equipo es remota.

**Si sólo se va a usar como lobby, no vale la pena construirlo.** Es honesto decirlo antes de
empezar: hay 23 juegos más baratos.

---

## Dónde corre cada cosa

Es la decisión que define el proyecto:

| Superficie | Qué muestra |
|---|---|
| **Celular** | Primera persona. Cada uno ve desde su avatar |
| **Proyector** | Vista aérea del espacio, con todos moviéndose y las estaciones marcadas |

Eso significa que **el 3D corre en el teléfono**, y ahí está el costo. Un celular de gama media
con 30 avatares en pantalla es exigente, y por eso el presupuesto de abajo es estricto.

El proyector con vista aérea es lo que hace la experiencia legible para la sala: se ve dónde se
junta la gente, qué estación tiene cola, quién se quedó solo en un rincón.

---

## El espacio

Generado proceduralmente con `config.seed`, como el shooter. Sin assets externos.

| | |
|---|---|
| Tamaño | 60 × 60 unidades, con paredes perimetrales |
| Zonas | 4 a 6, conectadas por pasillos anchos |
| Estaciones | 4 a 8, una por zona, en las paredes |
| Altura | Una planta. **Sin escaleras ni desniveles** |
| Iluminación | Ambiental + una luz por zona, del color de esa zona |

**Una sola planta a propósito.** Los desniveles multiplican los problemas de cámara, de colisión y
de orientación, y no aportan nada a un espacio para charlar.

Cada zona tiene un color de la paleta que la identifica, y ese color se ve en el suelo y en la
vista aérea. Es lo que permite decir "nos vemos en la zona violeta".

---

## Las estaciones

Una estación es un panel en la pared con contenido:

```ts
export type Estacion = {
  id: string;
  zona: number;
  titulo: string;
  contenido: { tipo: "texto" | "imagen" | "video"; valor: string };
  /** A qué distancia se activa. */
  radio: number;
};
```

- Al **acercarse**, el panel se enfoca y el contenido aparece en el celular, legible, superpuesto.
- Al alejarse, vuelve al espacio.
- La vista aérea del proyector muestra **cuánta gente hay en cada estación**, en vivo. Es una
  métrica real: qué interesó.

Ese último dato es lo que convierte la experiencia en algo medible y no sólo en un paseo.

---

## Avatares

Sin rig, sin animación esquelética, sin assets.

- **Cápsula + cabeza + un indicador de dirección**, del generador de `geometry.ts`.
- Color asignado por participante, estable.
- **Nombre flotando encima**, siempre orientado a la cámara, con tamaño acotado por distancia.
- Movimiento: sólo desplazamiento y giro. Un pequeño balanceo al caminar, que se apaga con
  `prefers-reduced-motion`.

Es deliberadamente austero. Un avatar personalizable es un proyecto entero y no agrega nada al
propósito.

---

## Movimiento y red

- **Joystick virtual** (`nipplejs`, layout `joystick`) para desplazarse; **arrastrar** en la
  pantalla para girar la cámara.
- Velocidad 3,5 u/s. Sin correr, sin saltar: no hay nada que esquivar ni que alcanzar.
- Colisión sólo contra paredes, con cápsula. **Los avatares se atraviesan entre sí**: un espacio
  social donde la gente se bloquea es un espacio donde la gente se traba en las puertas.

### El estado por red

Es lo que decide si escala:

| | |
|---|---|
| Frecuencia | **10 Hz**, no 20. Nadie está apuntando |
| Por avatar | posición (2 × int16), rotación (int8), estado (int8) = **6 bytes** |
| 30 avatares | 180 bytes por tick |
| Interpolación | Buffer de 150 ms, más generoso que en un juego de acción |

**Área de interés:** un cliente recibe con detalle sólo los avatares de su zona y las
adyacentes. Los lejanos llegan a 2 Hz o directamente no llegan. Con 30 personas repartidas en 6
zonas, cada uno sigue de cerca a unos 8.

Sin área de interés, el tráfico y el costo de render crecen con el cuadrado de la gente.

---

## Presupuesto — el más estricto de los 24

Porque corre en teléfonos:

| | Objetivo |
|---|---|
| FPS en celular de gama media | **45 mínimo**, 60 deseable |
| FPS en el proyector | 60 |
| Triángulos en pantalla | < 60.000 |
| Draw calls | **< 25** |
| Avatares renderizados | máx. 20, los más cercanos |
| Texturas | Ninguna. Todo color plano y degradados por vértice |

Cómo se llega:

- **Todos los avatares en un `InstancedMesh`.** 20 avatares es una llamada de dibujo, no veinte.
- **Paredes y suelo instanciados** por tipo.
- **Sin sombras dinámicas.** Una oclusión ambiental horneada en los vértices al generar el nivel
  da la sensación de volumen a costo cero.
- **Culling por zona**: no se renderiza lo que está detrás de una pared, usando la partición en
  zonas que ya existe.
- El `perf.ts` de la base baja avatares visibles antes que resolución: es preferible ver 12
  personas fluido que 30 a los tirones.

---

## Estados

1. **Lobby** — un QR. Entra el que quiera, no hace falta esperar a nadie.
2. **Entra a mitad** — aparece en la zona de entrada. No interrumpe nada.
3. **Se desconecta** — su avatar se desvanece en 2 segundos. Sin pausas, sin bots.
4. **Nadie conectado** — el proyector muestra el espacio vacío con el QR grande.
5. **`force-end`** — outcome para todos.
6. **Dispositivo que no soporta WebGL2** — mensaje claro y una **vista 2D cenital** como
   alternativa, donde igual se puede caminar y ver estaciones.

Ese último punto no es opcional: en una sala de 40 personas va a haber teléfonos viejos, y
dejarlos afuera del único juego que dura 15 minutos es un problema de evento, no técnico.

---

## Outcome

No hay puntaje. Es un espacio, no una competencia.

```ts
onFinished({
  screenId: config.screenId,
  participantId: config.participantId,
  completed: true,
  points: 0,
  durationMs,
  meta: {
    estacionesVisitadas: ["e1", "e4", "e7"],
    distanciaRecorrida: 342,
    tiempoPorZona: { 1: 120000, 3: 45000 },
  },
});
```

`points: 0`, como los corporativos sin puntaje. El `meta` es el valor: **qué estaciones se
visitaron** es la métrica que le interesa a quien organiza.

---

## Qué usa de las bases

| De `_engine3d/` | Para qué |
|---|---|
| `Stage.tsx` | Canvas con DPR topeado, cámara en primera persona |
| `useFixedStep.ts` | Movimiento y colisión |
| `instancing.ts` | **Avatares, paredes, suelo.** Es la pieza crítica |
| `geometry.ts` | Avatares y generación del espacio |
| `materials.ts` | Colores planos de la paleta |
| `lod.ts` | Avatares lejanos simplificados |
| `audio3d.ts` | Ambiente por zona |
| `perf.ts` | Degradación, bajando avatares primero |

`bvh.ts` no se usa: no hay raycast intensivo.

| De `_net/` | Para qué |
|---|---|
| `GameNetPort` | Posiciones a 10 Hz con área de interés |
| `GamepadController` layout `joystick` | Movimiento |

---

## Qué NO hacer

- **No** construirlo si sólo se va a usar de lobby.
- **No** avatares personalizables ni animación esquelética.
- **No** desniveles ni varias plantas.
- **No** colisión entre avatares.
- **No** sombras dinámicas ni texturas.
- **No** 20 Hz de estado: 10 alcanzan.
- **No** difundir a todos el estado de todos: área de interés.
- **No** dejar afuera a los dispositivos sin WebGL2.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. **10 celulares reales** moviéndose a la vez en el mismo espacio, viéndose entre sí.
3. **45 fps mínimo en un celular de gama media** con 20 avatares visibles.
4. Menos de 25 draw calls con el espacio completo poblado — verificable con `r3f-perf`.
5. Acercarse a una estación muestra su contenido; alejarse lo cierra.
6. El proyector muestra la vista aérea con todos y **cuánta gente hay en cada estación**.
7. Con la misma semilla, el espacio generado es idéntico.
8. **El área de interés funciona:** un cliente en la zona 1 no recibe actualizaciones detalladas
   de la zona 5, comprobable midiendo el tráfico.
9. Con 30 conectados, el tráfico por cliente se mantiene por debajo de 3 KB/s.
10. Un dispositivo sin WebGL2 recibe la vista 2D cenital y puede recorrer y ver estaciones.
11. Desconectarse desvanece el avatar sin afectar a los demás.
12. El outcome lleva las estaciones visitadas en `meta` y `points: 0`.
13. Montar y desmontar 20 veces no crece la memoria.
14. El chunk de Three **no entra** en el bundle inicial.
15. Cero errores de consola.

---

## Entrada en el registry

```ts
{
  id: "metaverso",
  title: "Espacio",
  description: "Un lugar recorrible con estaciones. Para juntarse, no para competir.",
  category: "creativo3d",
  status: "borrador",
  enabled: false,
  engine: "r3f",
  topology: "arena",
  needsNet: true,
  minPlayers: 1,
  maxPlayers: 30,
  qrSlots: 1,
  estimatedMin: 15,
  inputs: ["touch"],
  tags: ["3d", "social", "sin puntaje", "networking", "feria"],
  mode: "internal",
  load: () => import("./metaverso/MetaversoGame"),
}
```

> Llega como `borrador`, no `beta`: es el único de los 24 cuyo valor depende de cómo se use más
> que de cómo esté hecho. Conviene probarlo en un evento real antes de darlo por bueno.
