# Batería de experiencias · la sección para probar todo suelto

> Requiere la Etapa 09 de la Parte 2 (el sidebar de cinco secciones) y al menos una base cerrada.

Una sección donde cada juego, test o formulario se puede abrir y jugar **sin armar un tour, sin
abrir una sesión y sin generar código de sala**.

Es a la vez herramienta de desarrollo, herramienta de demo y catálogo para el que arma un tour.

---

## Qué existe hoy

Nada. Para ver un juego hay que:

1. Crear un tour.
2. Agregarle una pantalla de juego.
3. Elegir el juego.
4. Guardar.
5. Presentar, lo que **abre una sesión real** y marca el tour como `live`.
6. Escanear el QR con un teléfono.

Seis pasos y una sesión sucia en Administración para ver si un juego se ve bien. Con 24 juegos,
es inviable.

La Etapa 09 agrega `/tour/juegos` con un botón `Probar`. **Esta sección es su versión completa**:
`/tour/juegos` es el catálogo para elegir; la Batería es el banco de pruebas.

---

## Qué construir

Ruta `/tour/bateria`, dentro de `TourShell`. Sexta entrada del sidebar, en el grupo `TRABAJO`.

### 1. La grilla

```
┌─────────────────────────────────────────────────────────────┐
│  BATERÍA DE EXPERIENCIAS                                     │
│  Probá cualquier juego sin armar un tour.                    │
│                                                               │
│  [Todas] [Retro] [Moderno] [Corporativo] [Creativo/3D]       │
│  [solo] [gamepad] [arena]   [estables] [beta] [borrador]     │
│  ☐ Mostrar apagados                                          │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐    │
│  │ [ vista ] │ │ [ vista ] │ │ [ vista ] │ │ [ vista ] │    │
│  │ Serpiente │ │ Pong      │ │ Trivia    │ │ Shooter   │    │
│  │ solo · S  │ │ gamepad·M │ │ arena · M │ │ arena· XL │    │
│  │ ● estable │ │ ● beta    │ │ ● estable │ │ ○ apagado │    │
│  │ [Jugar]   │ │ [Jugar]   │ │ [Jugar]   │ │ [Jugar]   │    │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘    │
└─────────────────────────────────────────────────────────────┘
```

Filtros por categoría, topología y estado. Un juego apagado (`enabled: false`) **se puede jugar
acá**: es justamente el lugar donde se prueba antes de encenderlo.

### 2. El banco de pruebas

Al abrir un juego, una pantalla con el juego montado y un panel de control al costado:

```
┌──────────────────────────────┬──────────────────┐
│                              │  PARÁMETROS      │
│                              │  Duración  [90s] │
│        [ el juego ]          │  Semilla  [abc7] │
│                              │  Asiento  [ 1 ]  │
│                              │  Jugadores [ 4 ] │
│                              │  ☑ Bots          │
│                              │  Latencia [80ms] │
│                              │  Pérdida  [ 1% ] │
│                              │                  │
│                              │  ── MÉTRICAS ──  │
│                              │  FPS      59     │
│                              │  Draw calls 12   │
│                              │  Memoria  34 MB  │
│                              │  RTT      82 ms  │
│                              │                  │
│                              │  [Reiniciar]     │
│                              │  [Forzar fin]    │
│                              │  [Abrir en móvil]│
├──────────────────────────────┴──────────────────┤
│  ÚLTIMO RESULTADO                                │
│  completed: true · points: 616 · 2.583 s         │
│  meta: { completedPairs: 5, totalPairs: 5 }      │
└──────────────────────────────────────────────────┘
```

**Lo que hace que esto valga:**

- **Semilla editable.** Escribir la misma semilla reproduce la misma partida. Es lo que permite
  reportar un bug de forma útil: "con semilla `abc7` el enemigo aparece dentro de la pared".
- **`Forzar fin`** dispara el mismo camino que usa el host con `forceEndGames()`. Es el caso que
  siempre se rompe y que nadie prueba.
- **El outcome se muestra crudo**, tal como lo emitió el juego. Sirve para ver si los puntos
  tienen sentido antes de que ensucien un ranking real.
- **Latencia y pérdida** ajustables para los juegos de red, alimentando el mock de la base de
  netcode.
- **`Abrir en móvil`** muestra un QR que apunta a este mismo banco de pruebas en el teléfono, con
  la misma semilla y asiento. Es como se prueban los `gamepad` de verdad: la pantalla acá, el
  control en la mano.

### 3. El outcome se descarta

Regla dura. Jugar en la Batería **nunca** escribe una sesión, un participante ni un resultado. Se
muestra en pantalla y se descarta.

`AGENTS.md` dice que `gameResults` y `gameSessions` los escribe el backend. Una prueba no es una
partida, y si los ensayos ya se excluyen de la auditoría (Parte 2, Etapa 11), esto con más razón:
ni siquiera crea la sesión.

### 4. Modo quiosco

Un botón `Modo quiosco` que deja la Batería en pantalla completa, sin sidebar, mostrando sólo los
juegos habilitados y volviendo a la grilla cuando una partida termina.

Sirve para dejar una notebook en la recepción de un evento, o un stand, con la gente probando sola.
Es la Batería convertida en producto, sin escribir un producto nuevo.

### 5. Enlace directo

`/tour/bateria/:gameId?seed=abc7&slot=1&duration=90` monta el juego directo con esos parámetros.
Es la URL que se pega en un ticket para reproducir un bug.

---

## Qué NO tocar

- `/tour/juegos` de la Etapa 09 sigue existiendo: es el catálogo para **elegir** un juego para un
  tour. La Batería es para **probarlo**. Comparten la tarjeta de juego como componente.
- Los juegos no se enteran de que corren acá: reciben el mismo `GameRuntimeConfig` de siempre. Si
  un juego necesita saber que está en la Batería, algo se diseñó mal.
- El registry es la única fuente. La Batería no mantiene su propia lista.

---

## Reglas

- **El outcome se descarta siempre.** Ni sesión, ni participante, ni resultado.
- Los juegos apagados se pueden probar acá y sólo acá.
- Las vistas previas de las tarjetas no corren el juego: imagen o canvas estático.
- El panel de métricas sólo en `import.meta.env.DEV`; en producción quedan los parámetros.
- Ningún juego se importa estático: todo por `import()` como ya hace el registry.
- El modo quiosco no expone nada de administración ni de edición.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. Los juegos del registry aparecen, con sus filtros funcionando.
3. Abrir un juego, jugarlo y terminarlo muestra el outcome crudo.
4. **Después de jugar cinco veces, Administración no tiene ninguna sesión nueva.**
5. La misma semilla produce la misma partida dos veces seguidas.
6. `Forzar fin` emite el outcome parcial en el acto.
7. Un juego con `enabled: false` se puede jugar en la Batería y **no** aparece en el inspector del
   editor.
8. `Abrir en móvil` muestra un QR que abre el mismo juego en el teléfono con la misma semilla.
9. El enlace directo con parámetros monta el juego con esos valores.
10. El modo quiosco ocupa toda la pantalla y vuelve a la grilla al terminar una partida.
11. Abrir la Batería **no descarga** el código de ningún juego hasta que se abre uno (verificable
    en Network).
12. Cero errores de consola.

---

## Decisión a registrar

```json
{
  "id": "tour-experience-bench",
  "status": "accepted",
  "decision": "A sixth sidebar section at /tour/bateria mounts any game, test or form standalone with an editable seed, duration, slot, bot count and simulated latency, shows live FPS and draw-call metrics in dev, displays the raw emitted GameOutcome and discards it. Disabled games are playable here, a kiosk mode runs it fullscreen for stands, and a deep link with parameters reproduces an exact run.",
  "reason": "Seeing a game required creating a tour, adding a game screen, saving, presenting — which opens a real run and marks the tour live — and scanning a QR: six steps and a polluted audit trail to check whether a game looks right. With twenty-four games that is unworkable.",
  "consequence": "Playing here never writes a session, participant or result, which is stricter than rehearsal runs that at least create a flagged run, and keeps the AGENTS.md rule that game results come from the backend. The editable seed makes runs reproducible, so a bug report can carry the seed that triggers it. Games receive the ordinary GameRuntimeConfig and never learn they are in the bench; needing to know would mean a design error."
}
```
