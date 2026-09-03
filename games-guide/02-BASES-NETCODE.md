# Base netcode · proyector autoritativo y celular como control

> Leé `docs/CONTRATO-JUEGOS.md` §5 primero: ya define `GameNetPort` y quién manda.
> **La usan 10 de los 24 juegos.** Es la base que habilita `gamepad` y `arena`.

Es la que resuelve lo que pediste: **dos personas jugando al Pong en una sola pantalla
proyectada, con sus celulares de control.**

---

## Qué existe hoy

### El contrato ya define la forma

```ts
// docs/CONTRATO-JUEGOS.md §5
interface GameNetPort {
  sendInput(input: unknown): void;
  onState(cb: (state: unknown) => void): () => void;
  onPlayerJoin(cb: (p: Player) => void): () => void;
  onPlayerLeave(cb: (id: string) => void): () => void;
}
```

Y la decisión de autoridad: **el proyector es el host autoritativo**. Es la máquina que ya está en
la sala, tiene mejor hardware que un celular y no se va a ir a mitad de partida. Corre la
simulación y manda estado; los celulares mandan input y renderizan.

### Lo que existe de transporte

`mockTourSyncProvider.ts` usa `BroadcastChannel` para sincronizar el tour entre pestañas. Sirve
para "avanzá de pantalla" (~2 s de tolerancia) y es **inservible para netcode de juego**
(<100 ms). El contrato ya lo dice explícitamente: no reusar `TourSyncPort` para esto.

No hay ningún transporte de juego implementado.

### Lo que ya está resuelto y hay que aprovechar

Las URLs por asiento ya existen: `/tour/j/:joinCode/s/:screenId/p/:slot`. El QR de cada asiento ya
se genera solo al soltar un juego con `qrSlots > 1`. **El emparejamiento celular↔asiento ya está
hecho**: el celular que escanea el QR del asiento 2 sabe que es el jugador 2. Esa es la mitad
difícil del problema y ya está.

---

## Qué construir

```
src/games/_net/
├── GameNetPort.ts          ← el puerto (del contrato)
├── mockNetProvider.ts      ← BroadcastChannel + bots + latencia simulada
├── peerNetProvider.ts      ← WebRTC DataChannel, proyector = host
├── snapshot.ts             ← serialización compacta de estado
├── interpolation.ts        ← buffer y suavizado en el cliente
├── prediction.ts           ← predicción local y reconciliación
└── useGameNet.ts           ← el hook
```

### 1. El puerto, tipado

El contrato lo define con `unknown`; acá se cierra con genéricos:

```ts
export interface GameNetPort<TInput, TState> {
  readonly role: "host" | "client";
  readonly playerId: string;
  readonly slot: number;
  sendInput(input: TInput): void;
  onInput(cb: (playerId: string, input: TInput) => void): () => void;  // sólo host
  broadcastState(state: TState): void;                                  // sólo host
  onState(cb: (state: TState, serverTick: number) => void): () => void; // sólo cliente
  onPlayerJoin(cb: (p: NetPlayer) => void): () => void;
  onPlayerLeave(cb: (id: string) => void): () => void;
  readonly rttMs: number;
  dispose(): void;
}
```

### 2. Adapter mock — hoy

`BroadcastChannel` con **latencia simulada configurable**. El contrato es explícito: probá con
80 ms, no con 0, o el día que haya red se rompe todo.

```ts
export function createMockNet<TI, TS>(opts: {
  runId: string; screenId: string; role: "host" | "client";
  slot: number; latencyMs?: number;   // default 80
  jitterMs?: number;                  // default 20
  packetLoss?: number;                // default 0.01
}): GameNetPort<TI, TS>
```

Incluye **bots** para completar jugadores que no están, que es lo que permite probar un Pong sin
dos personas y lo que consume el ensayo de la Parte 2.

### 3. Adapter WebRTC — producción

Es la recomendación para `gamepad` y `arena`, y encaja exacto con la autoridad del contrato: los
celulares se conectan **directo al proyector**, sin pasar por un servidor de juego.

- El proyector abre un `RTCPeerConnection` por celular, con un `RTCDataChannel` no confiable y no
  ordenado (`{ ordered: false, maxRetransmits: 0 }`) — que es lo correcto para estado de juego:
  un paquete viejo que llega tarde no sirve, retransmitirlo sólo suma latencia.
- Señalización mínima. Es lo **único** que necesita servidor, y mueve unos pocos mensajes por
  partida. Puede ser un endpoint del backend cuando exista, o `peerjs` con su servidor público
  para las pruebas.
- Input del celular por un canal aparte, **confiable y ordenado**, porque perder un "disparé"
  se nota más que perder un frame de posición.

**Lo que hay que decir con honestidad:** WebRTC entre dispositivos en la misma red WiFi
corporativa casi siempre funciona directo. Cuando no, hace falta un TURN, que sí es
infraestructura. Para una sala donde el proyector y los celulares están en la misma red, el caso
normal es el bueno.

### 4. Snapshots

```ts
// Nada de JSON.stringify por frame: a 20 Hz × 10 jugadores es basura y ancho de banda.
export function packSnapshot(state: GameState, buf: ArrayBuffer): number;
export function unpackSnapshot(buf: ArrayBuffer): GameState;
```

- Estado en `Float32Array` / `Int16Array`, no en objetos.
- **Cuantización**: posiciones a 16 bits, ángulos a 8. Un jugador no necesita precisión de
  `float64` para dibujarse.
- **Delta encoding**: sólo lo que cambió desde el último tick confirmado.
- Estado a **20 Hz**, no a 60. El render interpola entre snapshots.

### 5. Interpolación en el cliente

El cliente **nunca** dibuja el último snapshot recibido: dibuja el estado de hace ~100 ms,
interpolando entre los dos que lo rodean. Es lo que hace que el movimiento ajeno se vea suave a
pesar de llegar a 20 Hz con jitter.

### 6. Predicción y reconciliación

Sólo para lo que controla el propio jugador. Sin esto, mover el dedo y ver la paleta reaccionar
80 ms después se siente roto.

1. El cliente aplica su input **localmente y al instante**, y lo guarda con su número de secuencia.
2. Manda el input al host.
3. El host simula y devuelve estado con el último input procesado de cada jugador.
4. El cliente descarta los inputs ya confirmados y **re-simula** los pendientes sobre el estado
   autoritativo.

Esto exige que la simulación sea **determinista y con timestep fijo** — que es exactamente lo que
garantiza la base 2D. Las dos piezas están hechas para encajar.

### 7. El celular como control

La parte que hace posible el Pong proyectado.

```tsx
// src/games/_net/controller/
<GamepadController
  layout="paddle" | "dpad" | "joystick" | "buttons" | "tilt" | "aim"
  onInput={(input) => net.sendInput(input)}
/>
```

Seis disposiciones que cubren los 10 juegos de red:

| Layout | Para | Qué muestra |
|---|---|---|
| `paddle` | Pong, Rompeladrillos | Franja vertical u horizontal; el dedo arrastra |
| `dpad` | Tetris, Ludo | Cruceta + botón de acción |
| `joystick` | Fútbol, Shooter, Metaverso | `nipplejs` + botones |
| `buttons` | Trivia, Verdadero o falso | Botones grandes de opción |
| `tilt` | Carreras | Inclinación + acelerador |
| `aim` | Pool | Arrastrar para dirección y fuerza |

Reglas del control, que son las que deciden si se siente bien:

- **`touch-action: none`** en toda la superficie. Sin esto, el navegador se come el gesto para
  scrollear y el control no responde.
- **Sin scroll, sin zoom, sin rebote.** El celular es un mando, no una página.
- **Feedback local inmediato**: el control vibra o ilumina al tocar, sin esperar respuesta del
  host. La sensación de latencia se combate acá.
- **Vibración** con `navigator.vibrate()` donde exista, respetando reduced-motion.
- **Wake lock** (`navigator.wakeLock`) para que no se apague la pantalla en medio de la partida.
- El input se manda a **30 Hz**, no a 60: el dedo no se mueve tan rápido y son la mitad de
  paquetes.
- **Reconexión**: si el celular pierde conexión, reintenta y vuelve a su asiento. El asiento sale
  de la URL, así que recuperarlo es determinista.

### 8. Estados feos que hay que resolver

Un juego multijugador es sus casos de error. Los que hay que cubrir:

| Caso | Qué pasa |
|---|---|
| Un jugador se va a mitad | Un bot lo reemplaza, o la partida sigue con menos. Nunca se cuelga |
| El proyector recarga | La partida se pierde. **Es aceptable y hay que decirlo**: el host es la pantalla |
| Un celular pierde red | Reintenta 10 s y vuelve a su asiento; su entidad queda inerte mientras tanto |
| Nadie entra | Tras el tiempo de espera, la pantalla avanza sin partida |
| Entra menos gente que `minPlayers` | Se completa con bots |
| Dos escanean el mismo asiento | El segundo ve "ese lugar está ocupado" y puede tomar otro |

Ese último es el más probable en una sala real y el más fácil de olvidar.

---

## Qué NO tocar

- **`TourSyncPort` no se usa para netcode.** Es polling y sirve para otra cosa.
- La regla de los dos relojes. En `gamepad` y `arena` el temporizador es **de la partida**, no de
  cada jugador (contrato §4).
- La regla de oro: el juego no conoce el tour.
- Las URLs por asiento y el QR autogenerado: ya funcionan y son el emparejamiento.
- `AGENTS.md`: el backend calcula el tiempo válido. El host **nunca confía** en un puntaje que le
  manda un cliente; recibe **input**, no resultados.

---

## Reglas

- El host recibe **input**, nunca estado ni puntaje. Un cliente que manda "hice 500 puntos" se
  ignora. Es la misma regla que ya rige el resto del proyecto.
- Estado a 20 Hz, input a 30 Hz, render a 60.
- Nada de `JSON.stringify` en el loop de red.
- El mock corre con **80 ms de latencia por defecto**, nunca 0.
- Predicción sólo sobre la entidad propia.
- Todo juego de red funciona **en solitario contra bots**. Si necesita dos personas para probarse,
  no se puede desarrollar.
- Todo juego de red llega con `enabled: false` (Parte 2, Etapa 09).

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. **La prueba que define esta base:** Pong con el proyector en una pantalla y **dos celulares
   reales** como paletas. Se juega un punto completo.
3. Con el mock a 80 ms de latencia simulada, la paleta propia responde **al instante** (predicción)
   y la ajena se ve suave (interpolación).
4. Con 20 % de pérdida de paquetes simulada, el juego sigue jugable.
5. Un jugador cierra su celular a mitad: la partida sigue y no se cuelga.
6. Dos celulares escanean el mismo asiento: el segundo recibe el aviso y puede tomar otro.
7. Sin nadie conectado, la partida arranca con bots.
8. El estado de un tick de 4 jugadores ocupa **menos de 200 bytes** empaquetado.
9. La pantalla del celular no se apaga durante la partida.
10. `git grep "core/tour" src/games/_net/` no devuelve nada.
11. Cero errores de consola en las cinco superficies involucradas.

---

## Decisión a registrar

```json
{
  "id": "games-netcode-projector-authoritative-webrtc",
  "status": "accepted",
  "decision": "Multiplayer games run on a typed GameNetPort with two adapters: a BroadcastChannel mock with simulated latency, jitter, packet loss and bots for development, and a WebRTC DataChannel adapter for production where phones connect directly to the projector, which is the authoritative host. State is quantised and delta-encoded at 20Hz, input at 30Hz, with client-side interpolation and local prediction plus reconciliation for the player's own entity. A GamepadController component provides six control layouts for the phone.",
  "reason": "The tour's BroadcastChannel sync tolerates about two seconds and is useless for game netcode, which needs under 100ms, and the contract already fixed the projector as authoritative because it is the machine already in the room. WebRTC suits that exactly: phones connect straight to the host, so no game server is needed, only signalling. The per-seat QR URLs already solve phone-to-slot pairing, which is the hard half.",
  "consequence": "The host accepts input and never scores, keeping the AGENTS.md rule that clients are not trusted. Prediction requires the deterministic fixed-timestep simulation the 2D base provides, so the two bases are designed to fit. If the projector reloads the match is lost, which is an accepted consequence of host-on-the-screen. WebRTC may need TURN when devices are not on the same network; on a shared corporate WiFi the direct path is the normal case. Every networked game must be playable solo against bots, or it cannot be developed."
}
```
