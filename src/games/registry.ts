import type { GameEntry } from "@/core/contract/catalog";
import { snakeSettings } from "./serpiente/settings";
import { flappySettings } from "./vuelo/settings";
import { saltarinSettings } from "./saltarin/settings";
import { ninjaSettings } from "./ninja/settings";
import { combinacionesSettings } from "./combinaciones/settings";
import { catapultaSettings } from "./catapulta/settings";
import { pongSettings } from "./pong/settings";
import { tetrisDueloSettings } from "./tetris-duelo/settings";
import { rompeladrillosSettings } from "./rompeladrillos/settings";
import { invasoresSettings } from "./invasores/settings";
import { pinturilloSettings } from "./pinturillo/settings";
import { ludoSettings } from "./ludo/settings";
import { corredorSettings } from "./corredor/settings";
import { futbolSettings } from "./futbol/settings";
import { carrerasSettings } from "./carreras/settings";
import { poolSettings } from "./pool/settings";
import { metaversoSettings } from "./metaverso/settings";
import { shooterSettings } from "./shooter/settings";

/**
 * Los 24 juegos de games-guide.
 *
 * Estan los 24 desde el dia uno, implementados o no: el catalogo tiene que
 * mostrar el plan completo, no solo lo que ya funciona. Un juego sin `load`
 * se ve, se lee y linkea a su spec, pero no se puede jugar todavia.
 *
 * `batch` es la tanda del ROADMAP.md, que ordena por complejidad tecnica real
 * y no por categoria.
 *
 * Todo lo multijugador llega con `enabled: false`: se prende cuando se usa.
 */

export const GAMES: readonly GameEntry[] = [
  /* ---------------------------------------------------------------- */
  /* Tanda 2 · primeros jugables, sin red                              */
  /* ---------------------------------------------------------------- */
  {
    id: "serpiente",
    code: "R3",
    title: "Serpiente",
    tagline: "Crecés juntando los principios de la cultura. Chocarte es el burnout.",
    category: "retro",
    topology: "solo",
    engine: "canvas2d",
    status: "stable",
    effort: "S",
    batch: 2,
    enabled: true,
    needsNet: false,
    minPlayers: 1,
    maxPlayers: 1,
    inputs: ["swipe", "keyboard"],
    estimatedMin: 1,
    tags: ["snake", "reflejos", "cultura"],
    guide: "R3-SERPIENTE.md",
    settings: snakeSettings,
    load: () => import("./serpiente/SerpienteGame"),
  },
  {
    id: "vuelo",
    code: "M3",
    title: "Vuelo",
    tagline: "Un toque para subir. La gravedad hace el resto.",
    category: "modern",
    topology: "solo",
    engine: "canvas2d",
    status: "stable",
    effort: "S",
    batch: 2,
    enabled: true,
    needsNet: false,
    minPlayers: 1,
    maxPlayers: 1,
    inputs: ["touch", "keyboard"],
    estimatedMin: 1,
    tags: ["flappy", "reflejos", "una tecla"],
    guide: "M3-FLAPPY.md",
    settings: flappySettings,
    load: () => import("./vuelo/VueloGame"),
  },

  /* ---------------------------------------------------------------- */
  /* Tanda 4 · modernos sobre la base 2D, sin red                      */
  /* ---------------------------------------------------------------- */
  {
    id: "saltarin",
    code: "M4",
    title: "Saltarín",
    tagline: "Doodle Jump con inclinación del teléfono.",
    category: "modern",
    topology: "solo",
    engine: "canvas2d",
    status: "stable",
    effort: "M",
    batch: 4,
    enabled: true,
    needsNet: false,
    minPlayers: 1,
    maxPlayers: 1,
    inputs: ["tilt", "touch", "keyboard"],
    estimatedMin: 2,
    tags: ["giroscopio", "plataformas", "vertical"],
    guide: "M4-SALTARIN.md",
    settings: saltarinSettings,
    load: () => import("./saltarin/SaltarinGame"),
  },
  {
    id: "catapulta",
    code: "M2",
    title: "Catapulta",
    tagline: "Tres tiros por nivel y estructuras que se derrumban.",
    category: "modern",
    topology: "solo",
    engine: "canvas2d",
    status: "stable",
    effort: "M",
    batch: 4,
    enabled: true,
    needsNet: false,
    minPlayers: 1,
    maxPlayers: 1,
    inputs: ["touch", "pointer"],
    estimatedMin: 4,
    tags: ["física", "puntería", "niveles"],
    guide: "M2-CATAPULTA.md",
    settings: catapultaSettings,
    load: () => import("./catapulta/CatapultaGame"),
  },
  {
    id: "ninja",
    code: "M5",
    title: "Ninja",
    tagline: "Deslizás para cortar. Las bombas terminan la partida.",
    category: "modern",
    topology: "solo",
    engine: "canvas2d",
    status: "stable",
    effort: "M",
    batch: 4,
    enabled: true,
    needsNet: false,
    minPlayers: 1,
    maxPlayers: 1,
    inputs: ["swipe", "touch"],
    estimatedMin: 2,
    tags: ["partículas", "deslizar", "arcade"],
    guide: "M5-NINJA.md",
    settings: ninjaSettings,
    load: () => import("./ninja/NinjaGame"),
  },
  {
    id: "combinaciones",
    code: "M1",
    title: "Combinaciones",
    tagline: "Todos juegan el mismo tablero con la misma semilla y compiten por puntaje.",
    category: "modern",
    topology: "solo",
    engine: "canvas2d",
    status: "stable",
    effort: "L",
    batch: 4,
    enabled: true,
    needsNet: false,
    minPlayers: 1,
    maxPlayers: 1,
    inputs: ["touch", "pointer"],
    estimatedMin: 4,
    tags: ["match-3", "semilla compartida", "puzzle"],
    guide: "M1-MATCH3.md",
    settings: combinacionesSettings,
    load: () => import("./combinaciones/CombinacionesGame"),
  },

  /* ---------------------------------------------------------------- */
  /* Tanda 5 · la base de red y su caso mas simple                     */
  /* ---------------------------------------------------------------- */
  {
    id: "pong",
    code: "R1",
    title: "Supernova Pong",
    tagline: "Dos celulares son las paletas, el proyector es la cancha.",
    category: "retro",
    topology: "gamepad",
    engine: "canvas2d",
    status: "beta",
    effort: "M",
    batch: 5,
    enabled: false,
    needsNet: true,
    minPlayers: 2,
    maxPlayers: 2,
    inputs: ["touch", "keyboard"],
    estimatedMin: 3,
    tags: ["pong", "duelo", "primer gamepad"],
    guide: "R1-PONG.md",
    settings: pongSettings,
    load: () => import("./pong/PongGame"),
  },

  /* ---------------------------------------------------------------- */
  /* Tanda 7 · retro en red                                            */
  /* ---------------------------------------------------------------- */
  {
    id: "invasores",
    code: "R4",
    title: "Invasores",
    tagline: "Hasta 4 celulares son cañones en la misma pantalla. La horda es común.",
    category: "retro",
    topology: "gamepad",
    engine: "canvas2d",
    status: "beta",
    effort: "M",
    batch: 7,
    enabled: false,
    needsNet: true,
    minPlayers: 1,
    maxPlayers: 4,
    inputs: ["touch", "keyboard"],
    estimatedMin: 4,
    tags: ["space invaders", "cooperativo"],
    guide: "R4-INVASORES.md",
    settings: invasoresSettings,
    load: () => import("./invasores/InvasoresGame"),
  },
  {
    id: "rompeladrillos",
    code: "R5",
    title: "Rompeladrillos",
    tagline: "Una paleta partida en dos: cada celular controla una mitad.",
    category: "retro",
    topology: "gamepad",
    engine: "canvas2d",
    status: "beta",
    effort: "M",
    batch: 7,
    enabled: false,
    needsNet: true,
    minPlayers: 2,
    maxPlayers: 2,
    inputs: ["touch", "keyboard"],
    estimatedMin: 4,
    tags: ["breakout", "coordinación"],
    guide: "R5-ROMPELADRILLOS.md",
    settings: rompeladrillosSettings,
    load: () => import("./rompeladrillos/RompeladrillosGame"),
  },
  {
    id: "tetris-duelo",
    code: "R6",
    title: "Tetris duelo",
    tagline: "Dos tableros lado a lado. Las líneas que hacés le mandan basura al otro.",
    category: "retro",
    topology: "gamepad",
    engine: "canvas2d",
    status: "beta",
    effort: "L",
    batch: 7,
    enabled: false,
    needsNet: true,
    minPlayers: 2,
    maxPlayers: 2,
    inputs: ["touch", "swipe", "keyboard"],
    estimatedMin: 6,
    tags: ["tetris", "duelo", "basura"],
    guide: "R6-TETRIS-DUELO.md",
    settings: tetrisDueloSettings,
    load: () => import("./tetris-duelo/TetrisDueloGame"),
  },

  /* ---------------------------------------------------------------- */
  /* Tanda 8 · sociales                                                */
  /* ---------------------------------------------------------------- */
  {
    id: "ludo",
    code: "X3",
    title: "Ludo",
    tagline: "Parchís de 4. Por turnos, así que la latencia no importa.",
    category: "creative",
    topology: "arena",
    engine: "dom",
    status: "beta",
    effort: "M",
    batch: 8,
    enabled: false,
    needsNet: true,
    minPlayers: 2,
    maxPlayers: 4,
    inputs: ["touch", "pointer"],
    estimatedMin: 10,
    tags: ["por turnos", "tablero", "red barata"],
    guide: "X3-LUDO.md",
    settings: ludoSettings,
    load: () => import("./ludo/LudoGame"),
  },
  {
    id: "pinturillo",
    code: "X1",
    title: "Pinturillo",
    tagline: "Uno dibuja en su celular, se ve en el proyector, los demás adivinan.",
    category: "creative",
    topology: "arena",
    engine: "canvas2d",
    status: "beta",
    effort: "L",
    batch: 8,
    enabled: false,
    needsNet: true,
    minPlayers: 3,
    maxPlayers: 20,
    inputs: ["touch", "pointer"],
    estimatedMin: 10,
    tags: ["dibujar", "adivinar", "el más social"],
    guide: "X1-PINTURILLO.md",
    settings: pinturilloSettings,
    load: () => import("./pinturillo/PinturilloGame"),
  },

  /* ---------------------------------------------------------------- */
  /* Tanda 9 · Pixi y scroll de mundo                                  */
  /* ---------------------------------------------------------------- */
  {
    id: "corredor",
    code: "M6",
    title: "Corredor",
    tagline: "Runner lateral con ranking por distancia. Ves fantasmas de los demás.",
    category: "modern",
    topology: "arena",
    engine: "pixi",
    status: "beta",
    effort: "L",
    batch: 9,
    enabled: false,
    needsNet: true,
    minPlayers: 1,
    maxPlayers: 20,
    inputs: ["touch", "keyboard"],
    estimatedMin: 3,
    tags: ["runner", "fantasmas", "ranking"],
    // Es `arena`, pero el celular corre la carrera entera: la spec dice que no
    // usa GamepadController porque el control es la pantalla propia del juego.
    phoneRole: "player",
    guide: "M6-CORREDOR.md",
    settings: corredorSettings,
    load: () => import("./corredor/CorredorGame"),
  },
  {
    id: "carreras",
    code: "R2",
    title: "Supernova Rush",
    tagline: "Perspectiva Mode 7. Cada uno corre en su celular, comparados por ranking.",
    category: "retro",
    topology: "solo",
    engine: "pixi",
    status: "beta",
    effort: "L",
    batch: 9,
    enabled: true,
    needsNet: false,
    minPlayers: 1,
    maxPlayers: 1,
    inputs: ["tilt", "touch", "keyboard"],
    estimatedMin: 4,
    tags: ["mode 7", "carreras", "pseudo 3D"],
    guide: "R2-CARRERAS.md",
    settings: carrerasSettings,
    load: () => import("./carreras/CarrerasGame"),
  },

  /* ---------------------------------------------------------------- */
  /* Tanda 10 · física determinista en red                             */
  /* ---------------------------------------------------------------- */
  {
    id: "futbol",
    code: "X6",
    title: "Supernova Fútbol",
    tagline: "Haxball. Física simple, red exigente.",
    category: "creative",
    topology: "arena",
    engine: "canvas2d",
    status: "beta",
    effort: "L",
    batch: 10,
    enabled: false,
    needsNet: true,
    minPlayers: 2,
    maxPlayers: 8,
    inputs: ["touch", "keyboard"],
    estimatedMin: 8,
    tags: ["haxball", "física", "equipos"],
    // El celular corre la partida como cliente: dibuja la cancha desde el
    // estado interpolado y predice su propio disco.
    phoneRole: "player",
    guide: "X6-FUTBOL.md",
    settings: futbolSettings,
    load: () => import("./futbol/FutbolGame"),
  },

  /* ---------------------------------------------------------------- */
  /* Tanda 11 · 3D                                                     */
  /* ---------------------------------------------------------------- */
  {
    id: "pool",
    code: "X2",
    title: "Pool",
    // Nada de inclinar el telefono: se apunta con el dedo sobre la vista
    // cenital, y se afina con zoom de dos dedos. La guia es explicita —
    // apuntar por inclinacion se ve bien en un video y es impreciso en la
    // mano, y el pool necesita precision.
    tagline: "La mesa en la pantalla, el taco en tu celular.",
    category: "creative",
    topology: "gamepad",
    engine: "r3f",
    // 3D en pestana propia: no compite por el hilo principal con el catalogo,
    // y cerrarla libera el contexto de GPU. Ver opensInTab.
    launch: "tab",
    status: "beta",
    effort: "L",
    batch: 11,
    enabled: true,
    needsNet: true,
    minPlayers: 2,
    maxPlayers: 2,
    inputs: ["touch"],
    estimatedMin: 8,
    tags: ["billar", "física 3D", "apuntar"],
    guide: "X2-POOL.md",
    settings: poolSettings,
    load: () => import("./pool/PoolGame"),
  },
  {
    id: "metaverso",
    code: "X5",
    title: "Espacio",
    tagline: "Un lobby con cuerpo: espacio 3D recorrible con avatares, sin objetivo.",
    category: "creative",
    topology: "arena",
    engine: "r3f",
    // 3D en pestana propia: no compite por el hilo principal con el catalogo,
    // y cerrarla libera el contexto de GPU. Ver opensInTab.
    launch: "tab",
    status: "beta",
    effort: "XL",
    batch: 11,
    enabled: true,
    needsNet: true,
    minPlayers: 1,
    maxPlayers: 20,
    // El celular es un avatar en primera persona; el proyector, la vista aerea.
    phoneRole: "player",
    inputs: ["touch", "keyboard"],
    estimatedMin: 10,
    tags: ["3D", "avatares", "social"],
    guide: "X5-METAVERSO.md",
    settings: metaversoSettings,
    load: () => import("./metaverso/MetaversoGame"),
  },
  {
    id: "shooter",
    code: "X4",
    title: "Bubble Shooter Game",
    tagline: "Battle royale de 10 a pistola de agua: montañas, cofres y un auto para cruzar el valle.",
    category: "creative",
    topology: "arena",
    engine: "r3f",
    // 3D en pestana propia: no compite por el hilo principal con el catalogo,
    // y cerrarla libera el contexto de GPU. Ver opensInTab.
    launch: "tab",
    /*
     * `beta`: jugable de punta a punta —mapa por semilla, hitscan con
     * compensacion de latencia, anillo, bots, prediccion en el celular— y
     * todavia sin partidas de verdad encima. Estable cuando lo hayan jugado.
     */
    status: "beta",
    effort: "XL",
    batch: 11,
    enabled: true,
    needsNet: true,
    minPlayers: 1,
    maxPlayers: 10,
    // El celular es el jugador, no un mando: abre el juego en primera persona.
    phoneRole: "player",
    // Stick tactil y arrastre en el celular; teclado y mouse para probar en
    // escritorio. Sin inclinacion: la guia la descarta para apuntar.
    inputs: ["touch", "keyboard"],
    estimatedMin: 8,
    // `three-mesh-bvh` NO se usa: el hitscan va contra diez capsulas, y una
    // lista de AABB es mas rapida que construir un BVH. Lo corrige la guia.
    tags: ["shooter", "battle royale", "el más caro"],
    guide: "X4-SHOOTER-3D.md",
    settings: shooterSettings,
    load: () => import("./shooter/ShooterGame"),
  },
];

export const GAMES_BY_ID = new Map(GAMES.map((game) => [game.id, game]));

export function getGame(id: string | undefined): GameEntry | undefined {
  return id ? GAMES_BY_ID.get(id) : undefined;
}
