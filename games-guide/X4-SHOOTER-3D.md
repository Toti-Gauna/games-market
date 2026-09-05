# X4 · Bubble Shooter Game

> **Tanda 11.** Requiere `01-BASES-3D.md` y `02-BASES-NETCODE.md` cerradas.
> Categoría **Creativos/3D** · topología `arena` · 1 QR · esfuerzo **XL** · motor `r3f`
>
> **Reescrita.** La guía anterior describía *Supernova Arena*: una arena cerrada de 80 x 80
> con plataformas de neón y armas de energía. El juego se rehizo como mundo abierto con
> pistolas de agua y cambió de nombre. Lo que sigue describe lo que hay implementado hoy;
> lo que cambió y por qué está al final.

Es el más caro del catálogo junto con el Espacio. Va al final del orden a propósito: cuando
se llega acá, las bases están probadas por otros nueve juegos.

---

Quiero **Bubble Shooter Game**: un shooter 3D en primera persona, **battle royale**, para
**hasta 10 personas**, que **cada una juega desde su celular**. Se mojan entre todos hasta
que queda uno. Con **Three.js** y **toda la geometría creada desde cero por código** — nada
de modelos importados, nada de texturas.

Tiene que verse premium y correr a **30 fps sostenidos en un celular de gama media**.

---

## 1. Topología: `arena`, con el proyector como autoridad

El proyector es el host y la única autoridad: corre la simulación, resuelve los disparos y
publica estado a 20 Hz. Cada celular entra por el QR con su asiento, ve en primera persona,
predice su propio cuerpo y manda intención 30 veces por segundo — nunca resultado.

El proyector además **puede jugar**: con Tab toma el asiento 0 (que si no lo juega un bot) y
pasa a primera persona con teclado y mouse. Es lo que permite probar el juego sin un celular
a mano, y que en un evento juegue quien proyecta.

Los asientos sin persona los juegan bots. Nadie espera a que se llene la sala.

---

## 2. El mundo: 200 x 200, generado por semilla

Nada de geometría se transfiere: el host manda un string y los diez aparatos construyen el
mismo valle. Un mapa que difiere entre clientes no se ve mal — se ve bien y se juega roto,
con gente cubriéndose detrás de rocas que en la otra pantalla no existen.

- **El terreno es una función de altura**, no una grilla de bloques. Entre 5 y 9 montañas,
  cada una una campana suave con posición, radio y altura propios, más una ondulación de
  ±0.5 que rompe el llano. `terrainHeight(map, x, z)` es la misma función que usan la
  física, el disparo, la generación y la malla que se dibuja: lo que se ve es lo que se pisa.
- **Las montañas son las estructuras.** Cobertura grande, altura táctica y referencia para
  orientarse. Una ladera suave se sube caminando; una empinada es pared (`MAX_WALK_SLOPE`).
  La más alta, cerca del centro, es el hito.
- **Las rocas** son la cobertura chica de siempre, apoyadas en el terreno y repartidas con
  ruido. Sin ellas, el pasto abierto no tendría dónde pelear de cerca.
- **18 cofres** con el arma decidida en la generación, nunca al abrirlos. Por red viaja solo
  la máscara de abiertos: un `int32` para los 32 posibles.
- **2 a 4 autos** en llano, lejos de las apariciones.
- **El anillo** cierra en cuatro fases hacia un centro que cambia por partida. Es lo que
  garantiza que la partida termine.

---

## 3. Las armas: todas de agua

Cuatro, y el hitscan las resuelve a todas. **El disparo se decide en el instante** —con
compensación de latencia, retrocediendo a los demás al momento en que el tirador los vio— y
se **dibuja** como agua: gotas que salen del caño y viajan con panza hacia abajo, más una
salpicadura al impacto. Reescribirlo a proyectiles simulados en red multiplicaría el riesgo
sin cambiar cómo se siente jugar.

| Arma | Cadencia | Cargador | Recarga | Cuerpo | Cabeza | Alcance |
|---|---|---|---|---|---|---|
| Pistola (inicial) | 0.15 s | 20 | 1.2 s | 25 | 45 | 22 |
| Aspersor | 0.55 s | 6 | 1.6 s | 14 × 5 rayos | igual | 10 |
| Manguera | 0.07 s | 40 | 1.8 s | 10 | 18 | 26 |
| Cañón | 1.1 s | 4 | 2.2 s | 45 | 100 | 40 |

El daño cae linealmente desde el 70 % del alcance hasta 0 en el máximo: el agua no llega
lejos, y eso es lo que hace que acercarse valga algo.

Todos aparecen con la pistola. Las otras tres salen de cofres. La recarga es automática al
quedarse seco y manual con R o el botón.

Los administrables tocan **la pistola** —la que todos tienen— y la dificultad de los bots en
tres niveles. Las de cofre son fijas: son el premio, no una perilla.

---

## 4. El auto

Uno solo, física de arcade: acelera con el mismo stick que camina, gira proporcional a la
velocidad, roza hasta frenar solo. No entra en el núcleo de una montaña, ni en una roca, ni
sale del mapa. Se sube y se baja con la señal de interactuar; manejando no se dispara, y
quien muere suelta el volante.

Viaja en el mismo snapshot que los jugadores, como entidades con id por encima de los
asientos. Cámara en tercera persona mientras se maneja.

No es destructible y no atropella. Es un medio de transporte para un mapa de 200 x 200, no
un arma.

---

## 5. Identidad: nombre y color

Cada uno elige cómo se llama y de qué color juega, en una pantalla de inicio que muestra el
personaje sobre un pedestal con el valle detrás. Las dos cosas se recuerdan entre partidas.

El color es un índice en una paleta de diez, no un color: es lo que viaja por red, empacado
en cuatro bits por asiento sobre dos escalares. Quien no elige se queda con el de su asiento.

El nombre **no puede escribirse en vivo sobre la red**: `useGameNet` rehace la sesión cuando
cambia. Se confirma al salir del campo o al empezar la partida.

---

## 6. Presupuesto, medido

Medido sobre la build de producción, contando llamadas de dibujo reales de WebGL, a 1280x720:

| Vista | Draw calls | Triángulos |
|---|---|---|
| Pantalla de inicio | 13 | 32.300 |
| Vista aérea | 17 | 37.400 |
| Primera persona | 18 | 35.500 |

Contra el presupuesto original —menos de 60 draw calls y menos de 40.000 triángulos— el
juego entra con margen aún después de sumar terreno, autos, cofres y sol. **No hace falta
LOD.** El grueso de los triángulos es la malla del terreno (120 × 120 celdas); si algún día
aprieta, ahí está el primer recorte.

La regla que lo sostiene es una sola: **un draw call por familia**. Diez jugadores son un
draw call de cuerpos, uno de cabezas, uno de visores, uno de armas y uno de sombras; sesenta
rocas son uno; todas las gotas de agua, uno.

Sin sombras dinámicas, sin PBR, sin texturas. El volumen sale del sombreado horneado por
vértice y de un sol bajo que lo resalta.

---

## 7. Lo que se ve

- **El sol baja mientras corre la partida**: de dorado y alto a rojizo y raspando el
  horizonte, con la luz apagándose. El anillo cerrándose y la luz yéndose empujan en la misma
  dirección: se hace tarde.
- **El terreno lleva el color horneado por vértice**: pasto manchado con dos escalas del
  mismo ruido que lo ondula, roca donde la pendiente aprieta, y una sombra de contacto al pie
  de cada roca que la hace verse apoyada y no pegada encima.
- **El anillo es una marea**: superficie de agua con espuma en el borde, no un campo de
  fuerza.
- **Aditivo para todo lo que brilla**: gotas, salpicaduras, destellos, halos de cofre.

---

## 8. Control

- **Celular**: stick izquierdo bajo el pulgar para moverse, arrastre a la derecha para
  mirar, botones de disparar y saltar, y un botón contextual que aparece cuando hay un cofre
  o un auto al alcance. Apaisado obligatorio, con aviso si está vertical.
- **PC**: WASD, mouse para mirar y disparar, espacio para saltar, E para interactuar, R para
  recargar, Tab para tomar o soltar el asiento del proyector.

---

## 9. Reparto del código

```
src/games/shooter/
  map.ts          → el valle por semilla: terreno, montañas, rocas, cofres, autos, anillo
  logic.ts        → la simulación pura: cuerpos, vehículo, armas, cofres, anillo, bots, snapshot
  logic.test.ts   → 52 casos sobre logic.ts, sin React ni three ni red
  map.test.ts     → 16 casos sobre la generación
  view.ts         → lo que se dibuja: predicción del celular, espejo del host-jugador, efectos
  ShooterScene.tsx→ adentro del <Canvas>: instancing, cámaras, sol, terreno
  ShooterGame.tsx → afuera: red, ciclo de vida, HUD en DOM, minimapa, sticks
  settings.ts     → administrables
```

---

## 10. Qué cambió respecto de la guía anterior

| Antes (Supernova Arena) | Ahora (Bubble Shooter Game) |
|---|---|
| Arena de 80 x 80 | Valle abierto de 200 x 200 |
| Plataformas y rampas rectangulares | Terreno continuo con montañas |
| Piso de grilla de neón | Pasto con manchas y roca por pendiente |
| Cielo violeta sci-fi | Atardecer que avanza con la partida |
| Un arma de energía | Cuatro pistolas de agua, tres de cofre |
| Sin vehículos | Un auto de arcade |
| Sin botín | 18 cofres, arma por semilla |
| Sin identidad | Nombre y color elegibles, con pantalla de inicio |
| Partida de 240 s | Partida de 300 s |

**Lo que no cambió**, porque estaba bien: la topología `arena` con el proyector como
autoridad, el hitscan con compensación de latencia, la predicción en el celular, el anillo
como garantía de final, los bots que completan la sala, y el presupuesto de rendimiento.

---

## 11. Pendiente

- **Bots al volante.** Hoy un bot abre el cofre que le queda al paso, pero no maneja. Un bot
  sin objetivo a la vista y lejos del anillo podría tomar el auto libre más cercano.
- **El arma tirada al morir.** Que quien cae suelte su arma en el piso y cualquiera la
  levante caminándole encima.
- **Sonido posicional.** Hoy suena lo propio —el chorro y lo que se acierta o se recibe—;
  los tiros ajenos no suenan.
