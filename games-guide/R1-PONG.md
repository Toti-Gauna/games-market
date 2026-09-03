# R1 · Pong

> **Tanda 3.** Requiere `00-BASES-2D.md` y `02-BASES-NETCODE.md` cerradas.
> Categoría **Retro** · topología `gamepad` · **2 QR** · esfuerzo **M** · motor `canvas2d`

Es **la prueba de fuego de la base de netcode** y el juego que hace la demo del producto: dos
personas jugando en la pantalla proyectada, con sus celulares de control. Si esto anda, andan los
otros nueve juegos de red.

> **Actualizado.** Este prompt viene de una tanda anterior a las fases 1 y 2. Se conservó todo lo
> que ya estaba bien —que es casi todo— y se reescribió lo que ahora resuelven las bases.

---

## La idea

Un Pong que se ve en el proyector con **dos QR** en pantalla. Cada persona escanea el suyo y su
celular queda como mando. La pelota, el campo y el marcador viven en la pantalla grande; los
teléfonos sólo mueven la paleta.

**El proyector es el host autoritativo y la única superficie de juego.** Corre la simulación, la
física y el render. Los celulares no simulan nada.

- QR izquierdo → `…/s/:screenId/p/1` → Jugador 1, paleta izquierda
- QR derecho → `…/s/:screenId/p/2` → Jugador 2, paleta derecha

El emparejamiento celular↔asiento **ya está resuelto**: las rutas por asiento existen y el QR por
asiento se autogenera cuando `qrSlots > 1`. No hay que construirlo.

---

## Reglas

- Campo `1600 × 900` en unidades de simulación, independiente de la resolución real.
- Dos paletas verticales, una por lado. Sólo se mueven en Y.
- **Primero a 7 puntos**, diferencia mínima de 2, techo duro en **11** para que la partida entre
  en la pantalla del tour.
- Saque hacia el que acaba de recibir el gol, con ángulo aleatorio dentro de ±35° de la
  horizontal. **Nunca con ángulo casi vertical**: se ve como que el juego se colgó.
- Cada rebote en paleta acelera un 4 %, con tope en **2,2×** la velocidad inicial. Sin tope, a los
  30 segundos es injugable.
- **El punto de impacto en la paleta cambia el ángulo de salida**: centro sale plano, puntas
  abren hasta ±60°. Es lo que convierte al Pong en un juego de habilidad y no de suerte. No lo
  omitas.
- Cuenta regresiva de 3 s antes del primer saque y de 1,5 s después de cada gol.

El ángulo del saque sale del **PRNG sembrado** con `config.seed`, no de `Math.random()`.

---

## Física

**Paso de simulación `1/120`**, no `1/60`. La base lo acepta como parámetro por juego
(`createLoop(update, render, 1/120)`) justamente por este caso: con la pelota a 2,2× de velocidad
y pasos de 1/60, entre dos pasos recorre demasiado y el barrido trabaja de más.

Los dos clientes de una partida usan el mismo paso, o la simulación diverge.

- **Colisión continua (swept), no discreta.** Con la pelota acelerada, preguntar "¿está dentro de
  la paleta este frame?" la deja pasar de largo: en un frame está antes y en el siguiente ya pasó.
  Se resuelve con `collide.ts` de la base, calculando el instante exacto del impacto dentro del
  paso.
- Rebote en paredes con **corrección de penetración**: reposicionar la pelota fuera de la pared
  antes de invertir la velocidad, o queda vibrando pegada al borde.
- La paleta **no aporta velocidad** a la pelota más allá del ángulo por punto de impacto. Con
  input remoto y ruidoso, sumar la velocidad de la paleta se descontrola.

---

## Latencia

El input viaja del celular al proyector. A 150 ms el juego se siente roto. El diseño asume eso:

- El celular manda **posición absoluta normalizada** (`0..1` en Y), **no** eventos de
  arriba/abajo. Con posición absoluta, un paquete perdido se corrige solo en el siguiente; con
  eventos, el error se acumula.
- Envío a **30 Hz** con throttle, como fija la base. Más no mejora nada perceptible.
- En el proyector, la paleta **persigue** el objetivo recibido con un lerp de ~0,35 por frame en
  vez de saltar. Absorbe el jitter y se ve mucho mejor.
- **Sin predicción de la paleta remota.** Predecir un dedo humano produce corrección visible y es
  peor que el retardo.

Eso último **no contradice** la regla de la base de netcode. La base dice "predicción sólo sobre
la entidad propia", y en topología `gamepad` **el celular no renderiza ninguna entidad**: no hay
nada que predecir de su lado. La única corrección local es el indicador del mando, que sigue al
dedo sin esperar al host.

- El aviso de latencia aparece **sólo si supera 200 ms**, discreto. Callarla hace que la gente
  crea que el juego anda mal.
- El mock corre con **80 ms por defecto**. Probar a 0 ms es engañarse.

---

## El mando

Pantalla completa, sin scroll, **landscape y portrait**, los dos.

- Layout **`paddle`** de la base de netcode: una franja táctil vertical que ocupa casi toda la
  pantalla. La paleta sigue la posición absoluta del dedo. **Nada de botones ▲▼**: se sienten
  lentos y son peores en todo sentido.
- **Feedback local inmediato**: un indicador que se mueve con el dedo sin esperar confirmación
  del proyector. El jugador tiene que sentir respuesta instantánea aunque la paleta real vaya
  80 ms atrás.
- Vibración corta en cada rebote propio, más larga en gol. Respeta `prefers-reduced-motion`.
- Arriba: quién sos, con **tu color**, y el marcador. Nada más.
- `touch-action: none` y `overscroll-behavior: none`, o Android hace pull-to-refresh en pleno
  partido. Zoom por doble toque bloqueado.
- **Wake lock** para que no se apague la pantalla a mitad del partido.
- Si se cae la conexión: cartel de reconexión, **sin sacar al jugador del asiento**.

Todo esto lo da `GamepadController` de la base. El Pong aporta el layout y los colores.

---

## Render y arte

**Canvas 2D alcanza y sobra.** No metas WebGL: no lo necesita.

- Fondo `--sn-bg-deep` con un degradado radial sutil al centro y línea de mitad punteada, tenue.
- Paleta 1 en `--sn-cyan`, paleta 2 en `--sn-magenta`, cada una con glow suave. **El mismo color
  en su QR y en su celular**: es lo que hace que cada uno sepa cuál es la suya de un vistazo.
- Pelota blanca con **estela**: las últimas ~12 posiciones con opacidad decreciente. Es el detalle
  que más "premium" agrega por menos costo.
- Al rebotar en paleta: destello del color de esa paleta en el punto de impacto y 8-12 partículas
  pooleadas.
- Al gol: flash blanco de 120 ms, shake de ~6 px que decae en 300 ms, y el marcador del que anotó
  escala con rebote.
- Marcador en `Colour Sans`, gigante y semitransparente, **detrás** del juego. No compite con la
  pelota y se lee desde el fondo de la sala.
- Vignette sutil. **Sin scanlines ni CRT**: es un cliché y ensucia.

Los colores salen de `palette.ts` de la base, leídos una vez. Cero hex hardcodeado.

Con `prefers-reduced-motion`: sin shake, sin flash, sin partículas, estela más corta. El juego se
juega igual.

---

## Presupuesto

| Métrica | Objetivo |
|---|---|
| FPS en el proyector | **60 estables** |
| Tiempo de frame | < 8 ms |
| Asignaciones en el loop | **cero** |
| Partículas vivas | máx. 120, pooleadas |
| Estado por tick en red | < 60 bytes |

- Partículas y estela en arrays circulares preasignados, vía `pool.ts`.
- Sin `ctx.save()`/`restore()` por partícula: agrupar por estilo.
- Los `CanvasGradient` se crean una vez, no por frame.
- Loop pausado con `document.hidden`.

---

## Estados raros

Es lo que separa un demo de un juego. Los ocho:

1. **Lobby** — 0 o 1 jugador. Los dos QR grandes, marcando cuál asiento está tomado. No arranca
   hasta tener los dos.
2. **QR ya tomado** — "El Jugador 1 ya está conectado", y se le ofrece el otro asiento si está
   libre. Es el caso más probable en una sala real.
3. **Cuenta regresiva** — los dos conectados, 3… 2… 1.
4. **Jugando.**
5. **Desconexión a mitad** — pausa automática, "Esperando al Jugador 2", **30 s de gracia**. Si
   vuelve, sigue el partido.
6. **No vuelve** — el otro gana por abandono. El que se fue igual recibe su `GameOutcome` con
   `completed: false`.
7. **`force-end` del host** — corta ya, gana el que va arriba (o empate), y emite **los dos**
   outcomes en el acto.
8. **Fin normal** — resultado con marcador y puntos.

**Reconexión: el asiento se guarda contra el `participantId`, no contra la conexión.** Si el
celular se bloquea y vuelve, recupera su paleta. El asiento sale de la URL, así que es determinista.

---

## Puntaje

Los dos jugadores reciben `GameOutcome`:

```
ganador  = 400 + (golesPropios - golesRival) * 30 + golesPropios * 20
perdedor = 120 + golesPropios * 25
abandono = 80    // el que se fue, completed: false
```

`meta`: `{ goalsFor, goalsAgainst, rallyMasLargo, seat: 1 | 2 }`.

---

## Fases de implementación

1. **Pong local jugable.** Un dispositivo, las dos paletas con teclado (W/S y ↑/↓). Timestep fijo
   a 1/120 y colisión continua, reglas completas, marcador. Sin red, sin arte fino. **Si acá la
   pelota atraviesa la paleta, no sigas.**
2. **Arte y game feel.** Estela, partículas, shake, flash, marcador grande, cuenta regresiva.
3. **Mando y red mock.** `GamepadController` layout `paddle`, `GameNetPort` con el mock a 80 ms.
   Dos pestañas en la misma máquina controlando el proyector.
4. **Integración con el tour.** Registry con `qrSlots: 2`, los dos QR, asientos, outcomes,
   `force-end`.
5. **Estados raros.** Los ocho.
6. **Dos celulares de verdad.** La prueba que importa.

---

## Qué NO hacer

- **No** WebGL. Canvas 2D sobra.
- **No** eventos de arriba/abajo desde el celular: posición absoluta.
- **No** predicción del input remoto.
- **No** delta variable ni colisión discreta.
- **No** hex hardcodeados: tokens vía `palette.ts`.
- **No** dejar que la pelota acelere sin tope.
- **No** poner el juego en el celular: en `gamepad` el celular es **sólo** un mando.
- **No** importar nada de `core/tour/` salvo los tipos.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. **La prueba que define la tanda:** proyector en una pantalla, **dos celulares reales** como
   paletas, un partido completo hasta 7.
3. 60 fps estables durante el partido, medido en Performance.
4. Cero asignaciones en el loop: la curva de heap plana durante el partido.
5. **La pelota nunca atraviesa una paleta**, ni a velocidad máxima.
6. Pegarle con la punta abre el ángulo; al centro sale plano.
7. Con 80 ms simulados, el mando se siente responsivo y la paleta se ve suave.
8. Con 20 % de pérdida de paquetes, el juego sigue jugable.
9. Escanear un QR ya tomado da un mensaje claro y ofrece el otro asiento.
10. Desconectar un celular pausa; reconectarlo reanuda **en el mismo asiento**.
11. `force-end` emite **dos** `GameOutcome`.
12. Con la misma semilla, los ángulos de saque se repiten.
13. La pantalla del celular no se apaga durante el partido.
14. Con `prefers-reduced-motion` no hay shake ni flash, y se juega igual.
15. `git grep "core/tour" src/games/pong/` no devuelve nada.
16. Cero errores de consola en las tres superficies.

---

## Entrada en el registry

```ts
{
  id: "pong",
  title: "Supernova Pong",
  description: "Dos celulares, una pantalla. El clásico, con la cancha proyectada.",
  category: "retro",
  status: "beta",
  enabled: false,        // multijugador: llega apagado, se prende al usarlo
  engine: "canvas2d",
  topology: "gamepad",
  needsNet: true,
  minPlayers: 2,
  maxPlayers: 2,
  qrSlots: 2,            // el proyector pinta DOS QR
  estimatedMin: 4,
  inputs: ["touch"],
  tags: ["retro", "versus", "dos jugadores", "proyector"],
  mode: "internal",
  load: () => import("./pong/PongGame"),
}
```

---

## Qué cambió respecto del prompt heredado

Para que quede registro de por qué este archivo se tocó:

- **Timestep `1/120` reconciliado con la base.** La base fijaba `1/60` para todos los juegos; se
  cambió para aceptar el paso como parámetro por juego. El conflicto lo encontró este prompt, y se
  arregló la base, no el Pong.
- **El mando y el transporte salen de `02-BASES-NETCODE.md`** en vez de especificarse acá:
  `GamepadController` layout `paddle`, `GameNetPort`, mock a 80 ms, wake lock, reconexión.
- **El loop, el pooling, la paleta y la colisión barrida salen de `00-BASES-2D.md`.**
- **Se explicitó que "sin predicción" no contradice a la base**, porque en `gamepad` el celular no
  renderiza entidades.
- **Entrada de registry actualizada** con los campos de la Fase 2 (Etapa 09) y de la Fase 3:
  `category`, `status`, `enabled: false`, `engine`, `needsNet`, `estimatedMin`, `inputs`, `tags`.
- **Ángulo de saque sembrado** con `config.seed`.
- Se quitó la referencia a `docs/PROMPT-SUPERNOVA-TOUR.md §7`, que describía un registry anterior.
