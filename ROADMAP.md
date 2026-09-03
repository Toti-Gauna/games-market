# ROADMAP · orden de construcción de los 24 juegos

Este documento ordena los 24 juegos de `games-guide/` **por complejidad técnica real y por
dependencia**, no por categoría ni por atractivo.

El `README.md` de `games-guide/` propone nueve tandas. Este roadmap propone doce y **mueve cuatro
juegos de lugar**. Las diferencias están justificadas al final, en *Dónde me aparto del README*.
Donde no hay justificación, gana el README.

Regla que se mantiene intacta: **se puede parar en cualquier tanda y el producto sirve.**

---

## Cómo se mide la complejidad

Cada juego se puntúa de 0 a 3 en seis ejes. La suma es lo que ordena, y los empates los rompe la
dependencia (nada va antes que su base).

| Eje | 0 | 3 |
|---|---|---|
| **Simulación** | No hay loop: es DOM y eventos | Estado grande con reglas acopladas (Tetris, Match-3, runner) |
| **Render** | Formas planas en Canvas 2D | Cientos de sprites, cámara, o 3D con post-proceso |
| **Física** | Nada, o rebote AABB a mano | Cuerpos rígidos, apilamiento, restitución determinista |
| **Red** | `solo`, no existe `GameNetPort` | Estado continuo compartido con autoridad y predicción |
| **Contenido** | Sin nada editable | Banco de ítems, corrección y agregación administrables |
| **Input** | Un botón o un tap | Giroscopio con permisos, multitouch o apuntado 3D |

**El eje de red es el que más cuesta y el que más se subestima.** Un juego de 4 puntos con red vale
más trabajo que uno de 8 sin red: la red no se prueba sola, hay que degradarla a mano, y el banco
de pruebas ya trae latencia y pérdida ajustables justamente para eso.

---

## Tabla maestra

Ordenada de menor a mayor complejidad total. `T` = topología · `Esf.` = esfuerzo del README.

| # | Juego | Sim | Rnd | Fís | Red | Cont | Inp | **Total** | T | Esf. | Tanda |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|:-:|:-:|
| R3 | Serpiente | 1 | 1 | 0 | 0 | 1 | 1 | **4** | solo | S | 2 |
| M3 | Vuelo | 1 | 1 | 1 | 0 | 0 | 1 | **4** | solo | S | 2 |
| C2 | ¿Cómo trabajás? | 0 | 1 | 0 | 0 | 2 | 1 | **4** | solo | S | 2 |
| C3 | Pulso del equipo | 0 | 1 | 0 | 0 | 2 | 1 | **4** | solo | S | 2 |
| C4 | Memoria de valores | 1 | 1 | 0 | 0 | 1 | 1 | **4** | solo | S | 3 |
| C5 | Prioridades | 1 | 1 | 0 | 0 | 2 | 2 | **6** | solo | M | 3 |
| M4 | Saltarín | 2 | 1 | 1 | 0 | 0 | 3 | **7** | solo | M | 4 |
| M5 | Ninja | 2 | 3 | 1 | 0 | 0 | 2 | **8** | solo | M | 4 |
| C6 | Verdadero o falso | 1 | 1 | 0 | 3 | 2 | 1 | **8** | arena | S | 6 |
| M1 | Combinaciones | 3 | 3 | 0 | 0 | 1 | 2 | **9** | solo | L | 4 |
| R1 | Supernova Pong | 2 | 1 | 1 | 3 | 0 | 2 | **9** | gamepad | M | 5 |
| C1 | Trivia relámpago | 1 | 1 | 0 | 3 | 3 | 1 | **9** | arena | M | 6 |
| X3 | Ludo | 2 | 2 | 0 | 2 | 1 | 2 | **9** | arena | M | 8 |
| M2 | Catapulta | 2 | 2 | 3 | 0 | 1 | 2 | **10** | solo | M | 4 |
| R4 | Invasores | 2 | 2 | 1 | 3 | 0 | 2 | **10** | gamepad | M | 7 |
| R5 | Rompeladrillos | 2 | 1 | 2 | 3 | 0 | 2 | **10** | gamepad | M | 7 |
| R6 | Tetris duelo | 3 | 2 | 0 | 3 | 0 | 2 | **10** | gamepad | L | 7 |
| M6 | Corredor | 3 | 3 | 1 | 2 | 0 | 2 | **11** | arena | L | 9 |
| R2 | Supernova Rush | 3 | 3 | 2 | 0 | 0 | 3 | **11** | solo | L | 9 |
| X1 | Pinturillo | 2 | 3 | 0 | 3 | 2 | 3 | **13** | arena | L | 8 |
| X6 | Supernova Fútbol | 3 | 2 | 3 | 3 | 0 | 2 | **13** | arena | L | 10 |
| X2 | Pool | 2 | 3 | 3 | 3 | 0 | 3 | **14** | gamepad | L | 11 |
| X5 | Espacio | 2 | 3 | 2 | 3 | 1 | 3 | **14** | arena | XL | 11 |
| X4 | Supernova Arena | 3 | 3 | 3 | 3 | 1 | 3 | **16** | arena | XL | 11 |

---

## Las doce tandas

### Tanda 0 · Cimientos — **hecha**

El contrato, el shell y el banco de pruebas. No hay juegos, pero sin esto ninguno se puede probar.

- `src/core/contract/` — `GameProps`, `GameOutcome`, `NetPort`, el schema de administrables.
- `src/games/registry.ts` — los 24 declarados desde el día uno.
- Sidebar, catálogo y banco de pruebas con semilla editable, forzar fin y outcome crudo.
- Tokens de color: **ningún hex hardcodeado en ningún juego, nunca.**
- **Modo quiosco** (`/quiosco`): pantalla completa, sin sidebar, solo los juegos habilitados, y
  vuelve sola a la grilla al terminar una partida. Es la batería convertida en producto para
  dejar una notebook en un stand. Respeta los administrables y la duración que dejó configurados
  el operador en el banco de pruebas, y no escribe nada.
- El asiento viaja en la URL (`#/juego/<id>?asiento=N`), que es como el QR reparte los puestos.

**Listo cuando:** un juego nuevo se vuelve administrable declarando un schema, sin tocar UI.

### Tanda 1 · Bases 2D y corporativa — **hecha**

Las dos bases que sostienen 20 de los 24 juegos.

- `src/core/engine/` — loop de paso fijo, canvas con DPR, input unificado, PRNG sembrado, pools,
  colisiones, paleta cacheada, audio.
- `src/core/corporate/` — motor de preguntas, corrección y agregación. **7 de los 8 tipos de ítem**
  (`match` se cerró en la tanda 3). Falta `image`, que espera a que haya imágenes que mostrar.

**Listo cuando:** Serpiente entra en un archivo. Si pide más, la base está mal y se arregla la base.

### Tanda 2 · Primeros jugables, sin red — **hecha**

| | | |
|---|---|---|
| R3 | Serpiente | Estrena la base 2D: grilla, swipe, PRNG, pool |
| M3 | Vuelo | Estrena gravedad y colisión continua |
| C2 | ¿Cómo trabajás? | Estrena la agregación por dimensiones |
| C3 | Pulso del equipo | Estrena el outcome sin puntaje |

Cuatro juegos completos sin tocar una línea de red. **Después de esta tanda ya hay producto.**

### Tanda 3 · Corporativos DOM — **hecha**

| | | |
|---|---|---|
| C4 | Memoria de valores | Unir principios con su definición. Estrena el renderer `match` |
| C5 | Prioridades | Ordenar 8 tarjetas. Estrena el renderer `order` accesible |

Ninguno necesita canvas ni red. C5 tiene la única dificultad real de la tanda: arrastrar tiene que
funcionar **también con teclado**, o la mitad de la gente no puede jugar.

**Dos desvíos respecto de las specs, y por qué:**

- **C4 se construye, no se integra.** Su spec está escrita como tarea de integración: asume que ya
  existe `principios-culturales` con su `MergeGameBoard` en un proyecto anfitrión. Acá no existe,
  así que se escribe de cero. Todo lo demás de la spec se respeta: la fórmula de puntos
  (100 por par + 2 por segundo restante), el barajado sembrado, el contenido como datos y el
  renderer `match` compartido en vez de duplicado. El id acá es `memoria`, no
  `principios-culturales`: no hay tours guardados que romper.
  *La propia spec de C4 dice que conviene hacerlo temprano y no en la tanda 9. Coincide con este
  roadmap.*
- **De C5 no se construye el proyector.** El consenso y la división del equipo necesitan muchas
  respuestas de muchas personas, o sea red: eso llega en la tanda 5. Lo que sí se construye ahora
  es toda la **matemática** de consenso y desvío con tests, porque los criterios 9 y 10 de la spec
  son verificables sin UI. La pantalla se arma cuando haya con qué llenarla.

> **Deuda pagada acá.** La base corporativa quedó en **7 de los 8** tipos de ítem: `match` se
> escribió en esta tanda junto con C4, que es el juego que lo estrena. La respuesta se codifica
> como `readonly string[]` de `"<leftId>|<rightId>"`, así que `AnswerValue` no se ensanchó y los
> otros renderers no se tocaron. Sigue faltando **`image`**, que espera a que haya imágenes.
>
> Los dos renderers nuevos son **compartidos, no propios de su juego**: `MatchBoard` y `OrderList`
> viven en `src/core/corporate/` y los monta `QuestionCard`, así que cualquier cuestionario del
> Formulario vivo puede tener una pregunta de unir pares o de ordenar sin escribir nada nuevo.
> `OrderList` resuelve los tres caminos de entrada —arrastre por el asa, botones ▲▼ y teclado
> completo con anuncio por región viva— que es lo que la spec de C5 pedía definir de una vez.

### Tanda 4 · Modernos sobre la base 2D — **hecha**

| | | |
|---|---|---|
| M4 | Saltarín | Giroscopio. Fallback a touch obligatorio |
| M5 | Ninja | Entra PixiJS y el sistema de partículas |
| M1 | Combinaciones | Match-3: la lógica de cascadas es el trabajo real |
| M2 | Catapulta | Entra `rapier2d`. El más caro de la tanda |

Los cuatro son `solo`: **no dependen de la tanda 5**. Se pueden hacer en paralelo con el netcode.

**Desvío: Ninja y Match-3 quedaron en Canvas 2D, no en Pixi.** La guía pone el umbral de Pixi en
"~200 sprites móviles" y avisa que no hay que meter un motor donde alcanza un `fillRect`. Un
tablero de Match-3 son 64 fichas y las partículas de Ninja son formas simples que salen de un
pool: ninguno llega al umbral. Meter Pixi ahí obligaba a construir una segunda base de render
completa para dos juegos que no la necesitan. El criterio para revisarlo está a la vista: el
**contador de FPS del banco de pruebas**. Pixi entra en la tanda 9, con Corredor y Carreras, que
sí tienen scroll de mundo y cientos de sprites. El `engine` del registry se corrigió a `canvas2d`
para que el catálogo no mienta.

**Rapier no se negocia**: Catapulta apila y derrumba cuerpos rígidos, y eso a mano es
genuinamente difícil. Son 2,1 MB de WASM, pero viven en su propio chunk y los baja únicamente
quien abre Catapulta.

### Tanda 5 · La base de red y su caso más simple — **hecha**

| | | |
|---|---|---|
| — | `02-BASES-NETCODE` | Proyector autoritativo, celular como control, predicción |
| R1 | Supernova Pong | Dos celulares, una pantalla. La prueba mínima de la base |

Pong es el caso más simple posible de `gamepad`, y por eso es el que tiene que estrenar la base. Se
prueba **con latencia y pérdida encendidas** desde el banco de pruebas, no a 0 ms.

**Hecho:** el contrato `GameNetPort<TInput, TState>`, los snapshots binarios cuantizados (un tick
de 4 jugadores ocupa 89 bytes contra el techo de 200 que pide la spec), la interpolación a −100 ms,
la predicción con reconciliación, el adapter **mock** con bots y degradación simulable, el control
del celular en `/control/:sala`, y **Pong**, jugable en solitario contra bots.

**El adapter WebRTC también está**, y con él el camino a los celulares reales.

La pieza que lo hizo barato: `mockNet` usaba el transporte **sólo** por la interfaz de `NetPort`,
así que el transporte se volvió inyectable. El protocolo entero —reparto de asientos, bots,
autoridad del host, snapshots, reconexión— vive una sola vez y no sabe por dónde viajan los bytes.
`peerNet.ts` es sólo el caño: topología en estrella, cada celular abre un `DataChannel` directo
contra el proyector, y la señalización la pone el broker público de PeerJS, así que **no hay nada
que levantar**. PeerJS se carga diferido: quien no usa WebRTC no paga sus 117 KB.

Y un obstáculo que la spec no menciona: **un teléfono no abre una `RTCPeerConnection` sobre HTTP**.
Se resuelve con `npm run dev:https`, que levanta el mismo servidor con un certificado local. El
teléfono avisa que no es de confianza y hay que aceptarlo una vez por aparato.

> **Lo que no pude verificar.** El criterio 2 de la spec —Pong con el proyector en una pantalla y
> **dos celulares reales**— necesita dos teléfonos físicos en la misma WiFi. El código está y todo
> lo demás está verificado (compila, 346 tests, PeerJS en su propio chunk, el servidor HTTPS
> levanta y expone la LAN), pero esa prueba es de cancha y la tiene que hacer una persona.
> Por eso Pong queda en `beta` y no en `estable`.
>
> **Cómo se prueba:** `npm run dev:https` → en el banco de pruebas, Transporte → `WebRTC` →
> `Abrir en el celular` → escanear con dos teléfonos, aceptando el aviso de certificado.
>
> Si en esa red WebRTC no encuentra camino directo, hace falta un TURN, que sí es infraestructura.
> Con proyector y celulares en la misma WiFi, el caso normal es el bueno.

> **Bug de la base encontrado acá.** `useGame2D` declaraba la opción `step` y **nunca se la pasaba
> a `createLoop`**: un juego que pedía `1/120` recibía `1/60` en silencio. No afectaba a ninguno de
> los diez juegos anteriores porque todos usan el default, pero habría mordido a cualquiera con
> física rápida. Arreglado.

### Tanda 6 · Corporativos en red — **hecha**

| | | |
|---|---|---|
| C6 | Verdadero o falso | El más barato: por turnos, 5 segundos por ítem |
| C1 | Trivia relámpago | Suma puntaje por velocidad y ranking en vivo |

**El mayor valor real para un evento de empresa.** Después de esta tanda hay un evento completo.

### Tanda 7 · Retro en red — **hecha**

| | | |
|---|---|---|
| R4 | Invasores | Cooperativo hasta 4. Horda común |
| R5 | Rompeladrillos | Paleta partida: coordinación forzada |
| R6 | Tetris duelo | Dos tableros + basura cruzada |

> **Corrección al plan original.** Este documento decía que los tres exigían *estado continuo
> compartido* y que ése era el salto de dificultad respecto de la tanda 6. **Es falso**, y se vio
> al leer las tres specs: los tres son `gamepad`, o sea que **sólo el proyector dibuja** y los
> celulares son mandos, exactamente igual que Pong. Ninguno usa `broadcastState` ni snapshots.
>
> El motor de snapshots, interpolación y predicción **sigue sin estrenarse**. Se estrena en los
> `arena` de verdad —Corredor, Fútbol, Metaverso y Shooter—, donde cada dispositivo renderiza la
> partida y hay algo propio que predecir. Ahí está el salto, no acá.
>
> Lo difícil de esta tanda resultó ser otra cosa: **la lógica de juego y el mando.** Tetris depende
> de seis detalles que casi nadie implementa (bolsa de 7 compartida, DAS/ARR, retardo de fijado,
> patadas SRS, fantasma, retención) y Rompeladrillos, de que cada mitad sepa dónde está la otra.

**Lo que estrenó la tanda es el layout `pad` del mando**, y lo comparten los tres:

- **`hold`**: el teléfono manda "empecé a mantener" y "solté"; **la repetición la calcula el host**.
  El DAS/ARR de Tetris no puede vivir en el teléfono o la latencia arruina el ritmo.
- **`press`**: evento de una vez, para disparar y para la caída dura. Sale en `pointerdown`, no en
  `click`: esperar al click le suma el retardo del navegador a un juego que se mide en cuadros.
- **Franja con rango recortado y marcas**: Rompeladrillos achica el rango propio según dónde esté
  el compañero, y la zona prohibida **se ve**. Sin eso el dedo se frena y nadie entiende por qué.
- **Canal háptico** (`haptic`), que faltaba y las tres specs pedían. Va con `id` y no con un patrón
  suelto: el spec se reenvía muchas veces por segundo, así que sin identificador el mando
  temblaría en cada refresco.

### Tanda 8 · Sociales — **hecha**

| | | |
|---|---|---|
| X3 | Ludo | Por turnos: la latencia no importa. Multijugador más barato del catálogo |
| X1 | Pinturillo | Trazo en vivo desde el celular al proyector |

Ludo va primero aunque el README ponga Pinturillo antes: ver más abajo.

### Tanda 9 · PixiJS y scroll de mundo — **hecha**

| | | |
|---|---|---|
| M6 | Corredor | Runner con fantasmas de los demás |
| R2 | Supernova Rush | Mode 7: renderer propio, no reutiliza nada |

### Tanda 10 · Física determinista en red — **hecha**

| | | |
|---|---|---|
| X6 | Supernova Fútbol | Haxball |

Lo más difícil que no es 3D: la misma simulación física tiene que dar el mismo resultado en dos
máquinas. Nada antes de esta tanda lo exige.

### Tanda 11 · 3D

| | | |
|---|---|---|
| — | `01-BASES-3D` | Three + R3F, instancing, física 3D, LOD |
| X2 | Pool | Apuntar con el celular como taco |
| X5 | Espacio | Lobby con cuerpo, sin objetivo |
| X4 | Supernova Arena | Shooter. `three-mesh-bvh` obligatorio |

Los tres más caros, al final **a propósito**. Si el presupuesto se corta antes, no se pierde nada
que un cliente esté esperando.

---

## Dónde me aparto del README de games-guide

### C4 Memoria y C5 Prioridades: de las tandas 9 y 7 → a la tanda 3

Son DOM, `solo`, sin red y sin canvas. Su única dependencia es el motor de preguntas, que ya está
cerrado en la tanda 1. Dejarlos para el final es dejar dos juegos baratos sin cobrar durante ocho
tandas. C4 además **ya existe** en el proyecto viejo: es integración, no construcción.

### X3 Ludo antes que X1 Pinturillo

El README los pone juntos en la tanda 7, con Pinturillo primero por ser "el que más se disfruta".
Técnicamente es al revés: Ludo es **por turnos**, así que tolera cualquier latencia y no necesita
predicción; Pinturillo transmite trazo continuo, necesita compresión de puntos y es el juego con
más superficie de UI del catálogo (13 puntos contra 9). Ludo primero valida la red barata; con eso
andando, Pinturillo arranca sobre terreno probado.

### R2 Carreras: de la tanda 9 → a la 9, pero desacoplado de Fútbol

El README los mete en la misma tanda de cierre. No comparten nada: Carreras es un renderer Mode 7
sin red, Fútbol es física determinista con red. Juntarlos hace que un bloqueo en uno frene al otro.

### La tanda 4 no depende de la 5

El README ya lo dice y este roadmap lo hace explícito: **los cuatro modernos son `solo`**. Si hay
dos personas trabajando, la tanda 4 y la tanda 5 corren en paralelo desde el día uno.

---

## Definición de "listo" — vale para los 24

Un juego no está listo hasta que:

- [ ] Corre a **60 fps** en proyector y en celular de gama media.
- [ ] **Cero asignaciones** dentro de `update` y `draw`. Balas, partículas y vectores desde pools.
- [ ] La misma **semilla** reproduce la misma partida, verificado desde el banco de pruebas.
- [ ] **Forzar fin** emite un outcome parcial coherente, en el acto.
- [ ] Los colores salen de **tokens**, leídos una vez y cacheados. Ningún hex hardcodeado.
- [ ] `prefers-reduced-motion` saca shake, destellos y partículas, y **el juego sigue jugable**.
- [ ] Se **pausa** con `document.hidden`, con Escape y con un botón.
- [ ] El HUD está en **DOM**, con números tabulares y `aria-live`.
- [ ] Feedback en **dos canales** (visual + sonido, o visual + vibración).
- [ ] Tiene **administrables** declarados, y su contenido es editable desde el panel.
- [ ] La **lógica pura** tiene tests: determinismo, puntaje y colisión.
- [ ] Declara su **presupuesto de frame** y qué baja si no llega.

---

## Pendientes transversales

No pertenecen a ninguna tanda. Se resuelven cuando el juego que los necesita llega.

| Qué | Cuándo | Nota |
|---|---|---|
| **Celular como control real** (`/control/:sala`) | Tanda 5 | Hoy el QR abre el mismo banco de pruebas con el asiento correcto. Sirve para probar un `solo` en un teléfono, no es todavía un control |
| **Probar Pong con dos celulares reales** | Cuando haya dos teléfonos | El código está y todo lo verificable está verificado. Es prueba de cancha: `npm run dev:https`, transporte WebRTC, escanear el QR con dos aparatos |
| **TURN** | Sólo si hace falta | Si en esa red WebRTC no encuentra camino directo. Con proyector y celulares en la misma WiFi no aparece |
| **Proyector de Prioridades** (consenso y división) | Tanda 6 | La matemática y sus tests ya están en `core/corporate/ranking.ts`. Falta la pantalla, que necesita muchas respuestas y por lo tanto red |
| **Tipo de ítem `image`** | Sin fecha | Necesita imágenes que todavía no hay |
| **Ranking y persistencia** | Sin fecha | Hoy el outcome se muestra y se descarta, por diseño. El día que valga algo, el score se valida en servidor, nunca en el cliente |
| **Contraste medido en canvas** | Con cada juego | Los tokens están verificados; el resultado sobre el fondo de partida no |
| **Tests de render / e2e** | Sin fecha | Decisión tomada: solo lógica pura. Si el sidebar o la batería se vuelven críticos, ahí entra Playwright |
| **Sonidos reales** | Sin fecha | Hoy es un sintetizador WebAudio propio de ~90 líneas. Si hace falta audio de verdad, ahí entra `howler` |

### Dependencias que todavía no están instaladas

Se agregan **en la tanda que las estrena**, no antes:

| Paquete | Tanda | Para qué |
|---|---|---|
| `pixi.js` v8 | 9 | Corredor y Carreras: scroll de mundo y cientos de sprites. Ninja y Match-3 no lo necesitaron |
| `peerjs` *(si se decide WebRTC)* | 5 | Celulares conectados directo al proyector |
| `nipplejs` | 5 o 7 | Joystick virtual, solo si algún juego lo declara |
| `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier` | 11 | La base 3D |
| `three-mesh-bvh` | 11 | **Obligatorio** en el shooter: sin BVH cada disparo recorre toda la geometría |
| `miniplex` | 10-11 | ECS. Solo shooter, metaverso y fútbol; en los chicos es sobreingeniería |

> `gsap` y `zustand` estaban instalados sin usarse y se sacaron. Si la tanda 4 los necesita
> (gsap para transiciones de HUD, zustand para estado de menús), se reinstalan ahí.

---

## Estado

| Tanda | Estado |
|---|---|
| 0 · Cimientos | Hecha |
| 1 · Bases 2D y corporativa | Hecha |
| 2 · Primeros jugables | Hecha — R3, M3, C2, C3 |
| 3 · Corporativos DOM | Hecha — C4, C5 |
| 4 · Modernos sobre la base 2D | Hecha — M4, M5, M1, M2 |
| 5 · Base de red y Pong | Hecha — base, control, WebRTC y Pong. Falta la prueba con dos celulares |
| 6 · Corporativos en red | Hecha — C1, C6. Falta la prueba con celulares reales |
| 7 · Retro en red | Hecha — R4, R5, R6. Falta la prueba con celulares reales |
| 8 · Sociales | Hecha — X3, X1. Falta la prueba con celulares reales |
| 9 · Pixi y scroll | Hecha — M6, R2. El shader de Mode 7 no se probó en GPU real |
| 10 · Física determinista en red | Hecha — X6 Fútbol |
| 11 | Pendiente |

`21 de 24` juegos jugables. El catálogo muestra los 24 igual: ver el plan completo es parte de lo
que hace útil a este patio de juegos.

---

## Lo que Fútbol encontró en la capa de red

La capa de snapshots, interpolación y predicción se escribió en la tanda 5 y
**estuvo cinco tandas sin un solo consumidor**. Sus tests probaban cada pieza
por separado; ninguno probaba que encajaran en un juego real.

X6 Fútbol fue el primero en usarlas juntas, y encontró cinco cosas. Vale
anotarlas: son la evidencia de que una capa con tests verdes no está probada
hasta que algo la usa de verdad.

**Lo que funcionó** — 105 bytes por tick con 9 discos, predicción con 2,5 px de
error medio sobre un disco de 28 px de radio, y con 20 % de pérdida simulada
**121 paquetes perdidos y cero fallos de decodificación**, porque el delta se
arma contra el tick que el receptor confirmó y no contra el último enviado.
Esa decisión se tomó en la tanda 5 y se sostuvo.

| # | Qué | Estado |
|---|---|---|
| 1 | ~~**La mitad cliente de `arena` es inalcanzable.**~~ `useGameNet` con `role: "host"` acepta `codec` e `interpolate` pero son inertes: `onState` es un no-op del lado host. Y el celular corre `ControlPage`, que sólo pinta un `ControlSpec` — no hay un segundo renderer en el repo | **Abierto.** Fútbol lo esquiva haciendo que el proyector se dibuje a sí mismo como cliente, con la latencia y la pérdida configuradas. Es honesto y sirve, pero no es un cliente de verdad |
| 2 | **El estimador de desfase no volvía de una pausa.** Bajaba al instante y subía 0,5 ms por snapshot: 5 s de pestaña oculta lo dejaban a −4,8 s y tardaba ~8 minutos en recuperarse, dibujando el último snapshot congelado | **Arreglado**, con test de regresión verificado a mano |
| 3 | `broadcastState` toma el estado **por referencia** y lo codifica después. Un juego que reusa su snapshot —que es lo que pide la regla de cero asignaciones— manda el tick N con el contenido del N+2 | **Documentado.** No se puede arreglar adentro: `TState` es opaco y no hay copia genérica. La solución es doble buffer del lado del juego |
| 4 | `lerpSnapshot` asigna ~700 objetos por segundo a 60 fps, contra la regla de cero asignaciones | **Abierto.** Se esquiva pasando una mezcla propia a `createSnapshotBuffer`, que es genérico; `createSnapshotInterpolator` no lo permite |
| 5 | Una instancia de `createSnapshotCodec` no puede servir a dos consumidores: guarda historial de enviados | **Documentado.** No falla ruidosamente —decodifica y da posiciones equivocadas—, asi que el aviso va en el factory |

### Lo que aparecio despues, arreglando lo anterior

Cada cosa que se cerro destapo la siguiente. Vale como registro de por que una
capa con tests verdes no esta probada hasta que algo la usa.

| Qué | Quién lo encontró | Estado |
|---|---|---|
| **`createInput` atendía un solo puntero.** Correr con un pulgar y patear con el otro era imposible con la base | Fútbol, escribiendo su mando táctil | **Arreglado.** `InputState.pointers` con la posición y **dónde empezó** cada dedo, que es lo que ancla una palanca donde cayó el pulgar. `pointer` sigue siendo el primero, con un test que lo fija |
| **`config.isHost` no existía.** Cada juego `arena` deducía "soy el host" con `config.seat === 0`: una convención que cada uno reinventaba | Fútbol | **Arreglado.** Lo decide el contenedor |
| `sendInput` toma el input por referencia y el limitador lo difiere hasta 33 ms | Fútbol | **Documentado.** Mismo caso que `broadcastState` |
| **El QR no llevaba la semilla.** Cada navegador generaba la suya, así que "todos corren la misma pista" (Corredor), "el mismo tablero" (Match-3) y "el mismo orden inicial" (Prioridades) eran falsos en cuanto entraba un segundo aparato | Prioridades, al armar su proyector | **Arreglado.** La semilla viaja en el QR y manda sobre la local |
| El QR de un juego en red donde el celular juega ofrecía un asiento que pisaba al del banco | Prioridades | **Arreglado** |
| Un gol en contra sumaba 70 puntos: no se filtraba por equipo | El test que compara los números del cliente contra los del host | **Arreglado** |

**Lo que sigue sin verificarse, y no se puede desde acá:** ningún juego en red
se probó con celulares reales, y el shader de Mode 7 no se compiló en una GPU.
Las dos cosas necesitan una máquina con navegador y teléfonos.
