# X4 · Shooter 3D

> **Tanda 8.** Requiere `01-BASES-3D.md` y `02-BASES-NETCODE.md` cerradas.
> Categoría **Creativos/3D** · topología `arena` · 1 QR · esfuerzo **XL** · motor `r3f`
>
> **Actualizado.** Viene de una tanda anterior a las fases 1 y 2. Se conservó todo lo que ya
> estaba bien —que es la mayor parte— y se reemplazó lo que ahora resuelven las bases. Ver
> "Qué cambió" al final.

Es el más caro de los 24 junto con el Metaverso. Va al final del orden a propósito: cuando se
llega acá, las bases están probadas por otros nueve juegos.

---

Usá las reglas de `CLAUDE.md` y `AGENTS.md`.

Quiero **Supernova Arena**: un shooter 3D en primera persona, **battle royale**, para
**hasta 10 personas**, que **cada una juega desde su celular**. Se matan entre todos hasta
que queda uno. Mapa mediano-chico. Con **Three.js** y **toda la geometría creada desde
cero por código** — nada de modelos importados.

Tiene que verse premium y correr a **30 fps sostenidos en un celular de gama media**.

---

## 0. Antes de escribir código

Leé `docs/CONTRATO-JUEGOS.md` completo. Después mostrame un plan por fases y **esperá mi
visto bueno antes de codear**.

**Aviso honesto:** este es, de lejos, el más difícil de los cuatro juegos. Un shooter 3D
multijugador en celulares tiene tres problemas duros a la vez — rendimiento móvil,
netcode autoritativo y control táctil. Si en la fase 1 no llegás a 30 fps con 10 cápsulas
moviéndose, decímelo y recortamos alcance antes de seguir. **Prefiero un shooter de 6
jugadores que corra bien a uno de 10 que va a tirones.**

---

## 1. Topología: `arena`, con el proyector como autoridad

```ts
{
  id: "shooter",
  title: "Supernova Arena",
  description: "Diez personas, un mapa que se achica. Cada uno desde su celular.",
  category: "creativo3d",
  status: "borrador",
  enabled: false,          // multijugador: llega apagado
  engine: "r3f",
  topology: "arena",
  needsNet: true,
  minPlayers: 2,
  maxPlayers: 10,
  qrSlots: 1,
  estimatedMin: 10,
  inputs: ["touch"],
  tags: ["3d", "acción", "battle royale", "celular"],
  mode: "internal",
  load: () => import("./shooter/ShooterGame"),
}
```

- **El proyector es el host autoritativo.** Corre la simulación completa: posiciones,
  disparos, daño, muertes y el anillo. Es la máquina de mejor hardware de la sala y no se
  va a ir a mitad de partida.
- **Además muestra la partida para la sala**, con una cámara de espectador. La autoridad y
  la pantalla grande son la misma cosa, y eso es medio punto de producto gratis: los que
  ya murieron miran la pantalla grande en vez de quedarse afuera.
- **Cada celular renderiza su propia vista en primera persona** y manda input.

**Nunca confíes en el cliente.** El celular manda intención (dirección de movimiento,
hacia dónde mira, si disparó). El host decide si el disparo pegó. Si el cliente manda
"maté a Fulano", cualquiera con las devtools abiertas gana todas las partidas.

---

## 2. Reglas

- 10 jugadores, todos contra todos. **Sin respawn.** Morís, mirás.
- Vida: 100. Sin escudo, sin curación: simplifica y acorta la partida.
- Un arma sola para todos, hitscan (§5). Sin inventario, sin recarga de munición
  limitada — sí con cadencia y un pequeño tiempo de recarga cada 20 tiros.
- **Anillo que achica** en 4 fases. Fuera del anillo: 4 de daño por segundo. El anillo es
  lo que obliga al encuentro y lo que garantiza que la partida termine.
- Duración objetivo: **4 minutos**. Tiene que entrar en una pantalla del tour.
- Gana el último vivo. Si se acaba el tiempo, gana el que más vida tiene; a igualdad, el
  que hizo más daño.

### Cronograma del anillo (ajustable, pero arrancá con esto)

| Fase | Empieza | Achica durante | Radio final |
|---|---|---|---|
| 1 | 0:45 | 40 s | 70 % |
| 2 | 1:40 | 35 s | 45 % |
| 3 | 2:30 | 30 s | 22 % |
| 4 | 3:15 | 25 s | 6 % |

---

## 3. El mapa

**Mediano-chico a propósito:** con 10 jugadores, un mapa grande son 4 minutos de caminar
sin ver a nadie. Arrancá con **80 × 80 unidades** (1 unidad ≈ 1 metro) y ajustá jugando.

- Piso plano con dos plataformas elevadas conectadas por rampas. **Sin escaleras**:
  subirlas con control táctil es una tortura.
- 25-35 bloques de cobertura de tres tamaños. Repartidos con ruido, no en grilla: una
  grilla regular se lee como un depósito y se juega peor.
- Un elemento central alto que sirva de referencia para orientarse. En un mapa chico sin
  hito, la gente se pierde.
- Bordes: paredes sólidas, sin salir del mapa. El anillo achica hacia un centro que **no**
  es siempre el mismo — variá el centro por partida con la semilla.
- **Todo generado por código**, con semilla determinista: el host manda la semilla y todos
  los clientes construyen el mismo mapa sin transferir geometría.

---

## 4. Geometría desde cero: cómo hacerla ver bien

Sin modelos importados. Componé todo con primitivas de Three.js:

- **Jugador**: cápsula (`CapsuleGeometry`) para el cuerpo + un cubo achatado para la
  "cabeza" + un prisma fino al frente como arma. Cuatro mallas por jugador como máximo.
  Cada uno con un color distinto de la paleta, emisivo, para distinguirse a distancia.
- **Cobertura**: cajas y cilindros con bordes biselados. Un `BoxGeometry` pelado se ve
  barato; con un chaflán mínimo se ve intencional.
- **Arma en primera persona**: 3-4 cajas compuestas, con un leve bob al caminar y
  retroceso al disparar. El bob es lo que separa "un shooter" de "una cámara flotando".

### Dirección de arte: low-poly flat-shaded con acentos emisivos

Es la estética que mejor combina con "geometría por código" **y** es la más barata de
renderizar. No intentes realismo: sin modelos ni texturas te va a salir mal y lento.

- `MeshLambertMaterial` o `MeshBasicMaterial` con `flatShading: true`. **Nada de PBR**
  (`MeshStandardMaterial` es caro en móvil y sin texturas ni entorno no aporta nada).
- Paleta: fondo `--sn-bg-deep`, geometría en violetas oscuros desaturados, y **acentos
  emisivos** en `--sn-cyan` y `--sn-magenta` en aristas, jugadores y el anillo.
- **Niebla exponencial** (`FogExp2`) del color del fondo. Cumple tres funciones a la vez:
  estética, oculta el plano lejano y **recorta overdraw**. No es opcional.
- Cielo: degradado simple en un `BackSide` sphere o un shader de dos colores. Nada de
  skybox con texturas.
- El anillo: cilindro translúcido con un shader de bandas verticales animadas en magenta.
  Tiene que verse a través de él y leerse como peligro.

---

## 5. Disparo: hitscan, no proyectiles

Raycast desde la cámara, resuelto **en el host**. Razones:

- Es muchísimo más barato: un `Raycaster` contra una lista corta, y listo.
- Con latencia móvil, un proyectil viajero se siente injusto y roto.
- No hay que sincronizar cientos de entidades de bala.

Detalles:

- Colisión contra cápsulas de jugador simplificadas, **no** contra la malla real.
- **Compensación de latencia (lag compensation):** el host rebobina las posiciones de los
  jugadores al instante en que el tirador disparó (guardá ~200 ms de historial de
  posiciones). Sin esto, en un celular con 100 ms de ping le tenés que apuntar adelante al
  rival y se siente roto.
- Daño: 25 al cuerpo, 45 a la cabeza. Cuatro tiros al cuerpo para matar.
- Cadencia: 150 ms entre tiros. Dispersión que crece al disparar sostenido.
- Feedback: trazadora (una línea que se desvanece en 60 ms), destello en la boca del arma,
  marca de impacto y partículas en el punto de choque, y un indicador de daño recibido que
  apunta a la dirección del atacante. **Este último no es opcional**: sin él, morir se
  siente arbitrario.

---

## 6. Controles táctiles (landscape obligatorio)

- **Stick izquierdo**: movimiento. Zona táctil, no un sprite fijo — el stick aparece donde
  el pulgar toca. Los sticks en posición fija son incómodos en pantallas distintas.
- **Lado derecho**: mirar, arrastrando. Sensibilidad ajustable, con un valor por defecto
  sensato y persistido.
- **Disparo**: botón a la derecha. Además, **auto-disparo cuando hay un enemigo en la mira**
  como opción activada por defecto — en móvil, apuntar y disparar con dos pulgares a la vez
  es muy difícil y arruina la experiencia para el 80 % de la sala.
- Botón de salto. Sin agacharse: no aporta y ocupa pulgar.
- Si el teléfono está en portrait: cartel de "girá el teléfono", **sin** intentar jugar en
  vertical.
- `touch-action: none`, sin zoom por doble tap, sin pull-to-refresh.
- Pedí fullscreen al arrancar (`requestFullscreen`); si el navegador lo niega, seguí igual.

---

## 7. Rendimiento: acá se gana o se pierde

**Objetivo: 30 fps en celular de gama media. 60 en el proyector.**

Esto no sale solo. Aplicá todo:

| Técnica | Por qué |
|---|---|
| `pixelRatio` capado a **1.5** en celular | Renderizar a 3× es la forma más rápida de perder la mitad de los frames |
| `InstancedMesh` para toda la cobertura | 30 bloques con una draw call en vez de 30 |
| **Un material por familia** | Cada material distinto es un cambio de estado en la GPU |
| **Sin sombras dinámicas** | El shadow map en móvil es carísimo. Usá un círculo oscuro bajo cada jugador |
| Una sola `DirectionalLight` + `AmbientLight` | Nada de luces por jugador |
| `FogExp2` agresiva | Recorta overdraw además de verse bien |
| Pooling de partículas y trazadoras | Cero asignaciones en el loop |
| Reusar `Vector3`/`Quaternion` | Un `new Vector3()` por frame por entidad es GC garantizado |
| `renderer.info` en pantalla en dev | Si no medís draw calls, no las controlás |
| Timestep fijo `1/60`, render interpolado | Determinismo y suavidad |
| `powerPreference: "high-performance"` | Pide la GPU buena en dispositivos híbridos |
| `antialias: false` en móvil | Caro; compensá con el look flat-shaded |

**Presupuesto duro:**

| Métrica | Objetivo móvil |
|---|---|
| Draw calls | **< 60** |
| Triángulos | < 40 000 |
| Tiempo de frame | < 33 ms |
| Asignaciones en el loop | cero |
| Texturas | cero (todo color plano) |

Poné un contador de FPS y de draw calls detrás de un flag de dev desde la fase 1. Medir
tarde es enterarse tarde.

---

## 8. Netcode

- **Tick del host: 20 Hz.** No 60. Mandá estado 20 veces por segundo e interpolá en el
  cliente entre los dos últimos estados recibidos. 60 Hz no mejora nada perceptible y
  triplica el tráfico.
- **Interpolación de entidades** con ~100 ms de buffer: el cliente dibuja el pasado
  reciente, suavemente, en vez de saltar entre snapshots.
- **Predicción local sólo del jugador propio**: tu movimiento responde al instante y se
  reconcilia con el host. Los demás, interpolados sin predecir.
- Delta encoding: mandá sólo lo que cambió.
- El input del cliente va a 30 Hz: dirección, rotación, flags de disparo/salto.
- **En la etapa de mockup**: `MockGameNetProvider` con 9 bots con IA simple (patrullar,
  perseguir al más cercano, disparar con precisión imperfecta) y **latencia simulada de
  80 ms**. Los bots también sirven de relleno si a la partida real entran menos de 10.

---

## 9. Estados

1. **Lobby** — QR en el proyector, lista de quién entró, botón de arrancar del host.
   Arranca con mínimo 2; los lugares vacíos se llenan con bots.
2. **Despliegue** — 5 segundos, cada uno aparece en un punto separado del mapa. Nunca dos
   jugadores a menos de 15 unidades.
3. **En partida.**
4. **Muerto** — pasa a cámara espectador siguiendo a su asesino. Emite su `GameOutcome`
   **en ese momento**, no al final: si el celular se cierra, el puntaje ya está.
5. **Fin** — pantalla de victoria en el proyector, con el ganador y el top 3.
6. **`forceEnd()`** — corta ya. Todos los vivos reciben outcome con `completed: false` y
   la posición que tenían.

---

## 10. Puntaje

Cada jugador emite su `GameOutcome` al morir o al ganar. Confirmame la fórmula:

```
puntos = (11 - posicionFinal) * 45     // 1.º = 450, 10.º = 45
       + kills * 40
       + (dañoHecho / 100) * 8
       + (sobrevivioHastaElFinal ? 100 : 0)
```

`meta`: `{ placement, kills, damageDealt, survivedMs, shotsFired, accuracy }`.

---

## 11. Fases

1. **Prueba de rendimiento primero.** Escena Three.js con el mapa generado, 10 cápsulas
   moviéndose y la cámara en primera persona. **Medí fps y draw calls en un celular real.**
   Si no llega a 30 fps, paramos y recortamos antes de escribir gameplay. No sigas sin esto.
2. **Movimiento y colisión.** Control táctil, caminar, saltar, colisión contra el mapa y
   la cobertura. Timestep fijo.
3. **Disparo.** Hitscan, daño, muerte, feedback visual, arma en primera persona.
4. **Battle royale.** Anillo, daño fuera, condición de victoria, cámara espectador.
5. **Red mock y bots.** `GameNetPort`, 9 bots, latencia simulada, interpolación.
6. **Vista del proyector.** Cámara espectador, marcador de vivos, ganador.
7. **Integración con el tour y pulido.** Registry, `GameOutcome`, `forceEnd()`, arte final.

---

## 12. Qué NO hacer

- No importes modelos GLTF/OBJ: **toda la geometría por código**.
- No uses `MeshStandardMaterial` ni PBR.
- No actives sombras dinámicas.
- No confíes en el cliente para el daño.
- No mandes estado a 60 Hz.
- No hagas proyectiles físicos: hitscan.
- No pongas escaleras ni agacharse.
- No dejes el `pixelRatio` sin capar.
- No hagas `new` dentro del loop.
- No importes nada de `core/tour/` dentro del juego.
- **No sigas a la fase 2 sin haber medido la fase 1 en un celular real.**

---

## 13. Criterios de aceptación

- [ ] `npm run typecheck` limpio.
- [ ] **30 fps sostenidos en un celular de gama media** con 10 entidades en pantalla,
      medido y reportado con número, no con "va bien".
- [ ] Menos de 60 draw calls, verificado con `renderer.info`.
- [ ] Heap plano durante una partida: cero asignaciones en el loop.
- [ ] Toda la geometría se genera por código; no hay ni un archivo de modelo en el repo.
- [ ] El mapa se genera igual en todos los clientes a partir de la misma semilla.
- [ ] El daño lo decide el host; un cliente modificado no puede otorgarse kills.
- [ ] El anillo achica según el cronograma y hace daño afuera.
- [ ] Morir emite el `GameOutcome` en ese momento y pasa a espectador.
- [ ] `forceEnd()` cierra y emite outcome para todos los vivos.
- [ ] En portrait aparece el cartel de girar el teléfono.
- [ ] El juego no importa nada de `core/tour/`.

---

## 14. Cómo reportar

Al terminar cada fase: qué construiste, **qué probaste y en qué dispositivo real**, qué
quedó sin probar, y qué decisión tomaste que yo no había definido.

En las fases 1 y 7, reportá **fps, tiempo de frame y draw calls medidos en celular**.
Si no probaste en un teléfono de verdad, decilo explícitamente.

---

## 15. Qué cambió respecto del prompt heredado

Para que quede registro de por qué este archivo se tocó:

- **La escena, el loop, el instancing, los materiales y la degradación de calidad salen de
  `01-BASES-3D.md`.** El prompt traía su propia tabla de técnicas de rendimiento; casi todas
  pasaron a la base porque las comparten los cuatro juegos 3D. Lo que queda acá es el
  presupuesto propio del shooter, que es el más exigente.
- **El transporte, la interpolación, la predicción y los bots salen de `02-BASES-NETCODE.md`.**
  El prompt ya definía 20 Hz de estado, 30 Hz de input, buffer de 100 ms y predicción sólo del
  jugador propio, que es exactamente lo que la base fija. No cambia nada; deja de estar duplicado.
- **`three-mesh-bvh` no se usa acá, y eso corrigió la base.** La base decía que el BVH era
  obligatorio en el shooter. Es falso: el hitscan va contra **cápsulas de jugador** —diez como
  mucho— y contra cobertura instanciada, y una lista de AABB es más rápida que construir un BVH.
  La base ahora dice cuándo hace falta cada cosa.
- **La compensación de latencia se queda acá**, porque es específica: rebobinar 200 ms de
  historial de posiciones al instante del disparo no lo necesita ningún otro juego del catálogo.
- **Entrada de registry actualizada** con los campos de las fases 2 y 3: `category`, `status`,
  `enabled: false`, `engine`, `needsNet`, `estimatedMin`, `inputs`, `tags`. Llega como `borrador`
  por el costo y el riesgo, no como `beta`.
- **La generación del mapa usa `config.seed`** a través del `rng.ts` compartido, para que todos
  los clientes generen el mismo mapa sin transferirlo.
- Se quitó la referencia a `docs/PROMPT-SUPERNOVA-TOUR.md §7`, que describía un registry anterior.
