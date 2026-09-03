# X6 · Fútbol

> **Tanda 9.** Requiere `00-BASES-2D.md` y `02-BASES-NETCODE.md` cerradas. Suma **Rapier2D**.
> Categoría **Creativos** · topología `arena` · 1 QR · esfuerzo **L** · motor `canvas2d`
>
> **Actualizado.** Viene de una tanda anterior a las fases 1 y 2. Se conservó lo que ya estaba
> bien y se reemplazó lo que ahora resuelven las bases. Ver "Qué cambió" al final.

Cenital, tipo Haxball. Hasta 5 contra 5 desde el celular, con la cancha completa en el proyector.

> Copiá y pegá todo lo que sigue en el chat. Se implementa dentro de
> `supernova-experience/frontend`, como juego del registry de Supernova Tour.
> Requiere que el dashboard del tour ya exista.

---

Usá las reglas de `CLAUDE.md` y `AGENTS.md`.

Quiero **Supernova Fútbol**: un fútbol **2D visto desde arriba**, tipo **Haxball** —
jugadores y pelota son discos, la física es de choques elásticos, y patear es aplicar un
impulso. Dos equipos, partido corto, y el proyector muestra la cancha para la sala.

Tiene que verse premium y correr a **60 fps**.

---

## 0. Antes de escribir código

Leé `docs/CONTRATO-JUEGOS.md` completo. Después mostrame un plan por fases y esperá mi
visto bueno antes de codear.

---

## 1. Topología: `arena`, con el proyector como autoridad

```ts
{
  id: "futbol",
  title: "Supernova Fútbol",
  description: "Cinco contra cinco, cenital. La cancha en la pantalla grande.",
  category: "creativo3d",
  status: "beta",
  enabled: false,          // multijugador: llega apagado
  engine: "canvas2d",
  topology: "arena",
  needsNet: true,
  minPlayers: 2,
  maxPlayers: 10,          // 5 vs 5
  qrSlots: 1,
  estimatedMin: 8,
  inputs: ["touch"],
  tags: ["creativo", "equipo", "versus", "proyector"],
  mode: "internal",
  load: () => import("./futbol/FutbolGame"),
}
```

- **El proyector corre la simulación y muestra la cancha completa** para la sala. Es la
  vista principal del partido: acá el espectáculo está en la pantalla grande.
- **Los celulares son el control** y muestran **la misma cancha en chico**, porque en un
  juego cenital la cancha entera entra en una pantalla. A diferencia del shooter, acá el
  celular no necesita una vista propia distinta.
- Equipos armados automáticamente por orden de llegada, alternando, y **rebalanceados** si
  queda desparejo. Colores: equipo A en `--sn-cyan`, equipo B en `--sn-magenta`.

**El host es autoritativo.** El celular manda dirección y si patea; el host decide todo lo
demás. Nunca aceptes "hice un gol" de un cliente.

---

## 2. La física: acá está todo el juego

Haxball se siente bien por una razón: la física de discos es simple, predecible y
consistente. Copiá ese modelo, no inventes.

- Todo es un **círculo con masa**: jugadores y pelota.
- **Timestep fijo `1/60`** con acumulador. Sin excepciones.
- Integración: `posición += velocidad * dt`, con **amortiguación** por frame
  (`velocidad *= damping`). Jugadores ~0.96, pelota ~0.99. La pelota tiene que rodar más
  que los jugadores: es lo que hace que los pases funcionen.
- **Colisión círculo-círculo** con resolución por impulso:
  1. Detectar solape (`distancia < r1 + r2`).
  2. Separar las posiciones proporcionalmente a la masa inversa (si no, los discos se
     hunden y quedan pegados vibrando).
  3. Aplicar impulso a lo largo de la normal, con restitución ~0.5.
- La **pelota es mucho más liviana** que un jugador (masa ~0.4 contra 1.0). Es lo que
  permite que un choque la mande lejos.
- Paredes: reflejo con restitución, y corrección de penetración antes de invertir.
- **Patear** es un impulso extra en la dirección jugador→pelota, sólo si la pelota está a
  menos de un radio de distancia del borde del jugador. No es "agarrar y tirar": es un
  golpe.

**Errores clásicos que tenés que evitar:**
- Resolver colisiones en un solo paso con muchos cuerpos amontonados: hacé **2-3
  iteraciones** de resolución por tick, o en un rebote de 4 jugadores se atraviesan.
- No separar antes de aplicar impulso: quedan pegados temblando.
- Simular con `deltaTime` variable: la física deja de ser determinista y en celulares
  lentos el juego cambia de reglas.

---

## 3. Reglas

- Cancha rectangular con **arcos con postes sólidos** (los postes son cuerpos de colisión,
  no huecos: los rebotes en el palo son la mitad de la gracia).
- Partido: **primero a 3 goles o 3 minutos**, lo que llegue antes. Tiene que entrar en una
  pantalla del tour.
- Tras un gol: celebración 2 s, reposición al centro, cuenta regresiva de 2 s. La pelota
  arranca quieta en el centro.
- **Sin arqueros ni faltas ni offside.** Es Haxball, no FIFA: la simplicidad es la virtud.
- **Sin salidas laterales**: la pelota rebota en las paredes. Simplifica y acelera el juego.
- Empate al terminar el tiempo: se queda empatado. Sin alargue.
- Los lugares vacíos se llenan con **bots** para que ningún equipo quede corto.

---

## 4. Controles (celular)

- **Stick virtual** a la izquierda para moverse: zona táctil, el stick aparece donde toca
  el pulgar. Movimiento analógico, no de 8 direcciones.
- **Botón de patear** grande a la derecha.
- Portrait como orientación principal — es el modo natural de agarrar el teléfono y la
  cancha cenital entra bien. Landscape también tiene que andar.
- Vibración corta al patear y al chocar. En `try/catch`: no existe en iOS.
- Feedback local inmediato del stick, sin esperar al host.
- Mini-cancha en el celular con: tu disco resaltado, tus compañeros, los rivales, la
  pelota y el marcador.
- `touch-action: none`, sin zoom, sin pull-to-refresh.

---

## 5. Arte: donde se gana lo "premium"

- Cancha oscura sobre `--sn-bg-deep`, con líneas finas emisivas: círculo central, áreas,
  medio campo. Nada de césped verde — esto es Supernova, no un simulador.
- Jugadores: discos con relleno del color de equipo, **anillo brillante** y la inicial del
  nombre en el centro. El disco propio con un anillo extra que pulsa, para no perderse.
- Pelota blanca con **estela** (últimas ~10 posiciones con opacidad decreciente) que se
  alarga con la velocidad.
- **Al patear**: onda circular expansiva desde el punto de contacto.
- **Al gol**: flash del color del equipo, screen shake, explosión de partículas desde el
  arco, y el marcador escalando con rebote.
- **Repetición en cámara lenta del gol** (3 segundos) en el proyector: guardá los últimos
  ~180 ticks de posiciones en un buffer circular y reproducilos a 0.35×. Es el detalle que
  hace que la sala aplauda, y cuesta muy poco porque ya tenés todas las posiciones.
- Marcador grande en `Colour Sans`, con los colores de cada equipo. Reloj con `tabular-nums`.
- Rastro tenue detrás de cada jugador al correr rápido.

Con `prefers-reduced-motion`: sin shake ni flash, estelas cortas, repetición sin cámara
lenta (o directamente sin repetición).

---

## 6. Netcode

- **Tick del host: 30 Hz.** Es un juego rápido pero con pocas entidades; 30 alcanza y es
  la mitad del tráfico que 60.
- **Interpolación** en el cliente con ~80 ms de buffer.
- **Predicción local sólo del disco propio**, con reconciliación. El resto interpolado.
- Input del cliente a 30 Hz: vector de dirección normalizado + flag de patear.
- Estado por tick: posición y velocidad de cada disco, pelota, marcador y reloj. Con 11
  discos es un paquete chico; no hace falta optimizar de más.
- **En mockup**: `MockGameNetProvider` con bots (perseguir la pelota, patear al arco
  rival, con imprecisión) y **80 ms de latencia simulada**.

---

## 7. Presupuesto de rendimiento

| Métrica | Objetivo |
|---|---|
| FPS (proyector y celular) | **60** |
| Tiempo de frame | < 10 ms |
| Asignaciones en el loop | cero |
| Partículas vivas | máx. 200, pooleadas |
| Iteraciones de física por tick | 2-3 |

Canvas 2D alcanza de sobra: son ~12 círculos. **No metas WebGL.**

- Pooling de partículas y de las posiciones de estela.
- Gradientes y sombras creados una vez, no por frame.
- Agrupá los dibujos por estilo para no hacer `save()`/`restore()` por disco.
- Buffer circular preasignado para la repetición: **no** vayas acumulando un array.
- Loop pausado con `document.hidden`.

---

## 8. Estados

1. **Lobby** — QR, lista de conectados, equipos formándose en vivo. Arranca con mínimo 2;
   el resto son bots.
2. **Cuenta regresiva** — 3 segundos, formaciones en su lugar.
3. **Jugando.**
4. **Gol** — celebración + repetición en el proyector + reposición.
5. **Alguien se desconecta** — su disco lo toma un bot al instante. **No pauses el
   partido**: en un juego de 10, frenar por uno arruina a los otros nueve. Si vuelve,
   recupera su disco.
6. **Fin** — marcador final, mejor jugador, puntos de cada uno.
7. **`forceEnd()`** — corta ya, gana el que va arriba, emite outcome para todos.

---

## 9. Puntaje

Cada participante emite su `GameOutcome`. Confirmame la fórmula:

```
puntos = (ganó ? 300 : empató ? 180 : 90)
       + goles * 70
       + asistencias * 35        // último toque del mismo equipo antes del gol
       + (toquesDePelota * 2)    // premia participar, tope 60
```

`meta`: `{ team, goals, assists, touches, won, scoreFor, scoreAgainst }`.

El bono por toques existe para que quien no metió goles igual sume algo. Sin eso, en un
5 vs 5 la mitad de la sala termina con el puntaje mínimo y el juego se siente injusto.

---

## 10. Fases

1. **Física de discos, local.** Cancha, un disco con teclado, pelota, paredes, arcos con
   postes, choques y pateo. **Iterá hasta que se sienta bien**: si la pelota se siente
   pesada o los choques pegajosos, no sigas. Es el 70 % del juego.
2. **Partido completo local.** Dos equipos con bots, goles, marcador, reloj, reposición,
   fin de partido.
3. **Arte y game feel.** Estelas, ondas de pateo, partículas, shake, marcador, repetición
   en cámara lenta.
4. **Control táctil y red mock.** Stick, botón de patear, `GameNetPort` con latencia
   simulada, interpolación y predicción del disco propio.
5. **Vista del proyector.** Cancha grande, marcador, repeticiones, lobby con QR.
6. **Integración con el tour.** Registry, `GameOutcome` por participante, `forceEnd()`,
   desconexiones.

---

## 11. Qué NO hacer

- No uses un motor de física externo (Matter.js, Planck): son ~12 círculos, escribir la
  resolución a mano son 60 líneas y te da control total sobre el feel.
- No uses WebGL: Canvas 2D sobra.
- No simules con `deltaTime` variable.
- No resuelvas colisiones en una sola iteración.
- No apliques impulso sin separar antes: quedan pegados.
- No pauses el partido cuando alguien se desconecta: metele un bot.
- No agregues arqueros, faltas ni offside.
- No acumules la repetición en un array que crece: buffer circular.
- No confíes en el cliente para los goles.
- No importes nada de `core/tour/` dentro del juego.

---

## 12. Criterios de aceptación

- [ ] `npm run typecheck` limpio.
- [ ] **60 fps** con 10 jugadores y partículas de gol, medido y reportado con número.
- [ ] Los discos **nunca** se atraviesan ni quedan pegados vibrando, ni con 5 amontonados.
- [ ] La pelota rebota en los postes.
- [ ] Patear se siente como un golpe, no como un arrastre.
- [ ] La pelota rueda más que los jugadores: los pases funcionan.
- [ ] Heap plano durante un partido completo.
- [ ] La repetición del gol se ve en el proyector en cámara lenta.
- [ ] Desconectar un celular pone un bot al instante, sin pausar; reconectar devuelve el disco.
- [ ] `forceEnd()` cierra y emite un `GameOutcome` **por participante**.
- [ ] Jugable con una mano en portrait.
- [ ] Con `prefers-reduced-motion` no hay shake ni flash y sigue jugable.
- [ ] El juego no importa nada de `core/tour/`.

---

## 13. Cómo reportar

Al terminar cada fase: qué construiste, **qué probaste en el navegador y en qué celular**,
qué quedó sin probar, y qué decisión tomaste que yo no había definido.

En la fase 1, contame **cómo se siente la física** antes de avanzar. Si la pelota se siente
pesada, pegajosa o impredecible, decilo: todo lo demás se construye encima de eso.

---

## 14. Qué cambió respecto del prompt heredado

- **El transporte, la interpolación, la predicción y los bots salen de `02-BASES-NETCODE.md`.** El
  prompt ya fijaba proyector autoritativo, 20 Hz de estado y predicción sólo de la entidad propia,
  que es exactamente lo que la base define. Deja de estar duplicado.
- **La física pasa a `@dimforge/rapier2d-compat`**, el mismo motor que M2 Catapulta y X2 Pool. Es
  determinista, que es lo que hace falta cuando el host simula y los clientes interpolan.
- **Paso de simulación `1/120`**, como Pong y Rompeladrillos: la pelota acelera y a `1/60` recorre
  demasiado entre pasos.
- **El loop, el pooling, la paleta y la cámara salen de `00-BASES-2D.md`.**
- **El mando usa `GamepadController` layout `joystick`** con `nipplejs`, en vez de definir su
  propio control.
- **Entrada de registry actualizada** con los campos de las fases 2 y 3, y `enabled: false` por ser
  multijugador.
- **El saque y los rebotes se siembran con `config.seed`**, para que una partida sea reproducible.
- Se quitó la referencia a `docs/PROMPT-SUPERNOVA-TOUR.md §7`.
