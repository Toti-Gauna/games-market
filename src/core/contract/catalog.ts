import type { GameComponent } from "./game";
import type { SettingsSchema } from "./settings";

export type GameCategory = "retro" | "modern" | "creative";

/** Como se reparten pantallas y controles. */
export type GameTopology = "solo" | "gamepad" | "arena";

export type GameEngineKind = "canvas2d" | "pixi" | "r3f" | "dom";

export type GameStatus = "stable" | "beta" | "draft" | "planned";

export type GameEffort = "S" | "M" | "L" | "XL";

export type GameInput = "touch" | "swipe" | "tilt" | "keyboard" | "pointer";

export type GameEntry = {
  /** Slug de la ruta: /juego/serpiente */
  id: string;
  /** Codigo de games-guide: R3, M1, C4... */
  code: string;
  title: string;
  /** Una linea. Es lo que se lee en la tarjeta del catalogo. */
  tagline: string;
  category: GameCategory;
  topology: GameTopology;
  engine: GameEngineKind;
  status: GameStatus;
  effort: GameEffort;
  /** Tanda del ROADMAP.md. */
  batch: number;
  /** Los multijugador llegan apagados y se prenden cuando se usan. */
  enabled: boolean;
  needsNet: boolean;
  minPlayers: number;
  maxPlayers: number;
  inputs: readonly GameInput[];
  /** Duracion tipica de una partida, en minutos. */
  estimatedMin: number;
  tags: readonly string[];
  /**
   * Que hace el celular cuando alguien escanea el QR.
   *
   * Casi siempre se deduce de la topologia: en `solo` el telefono corre el
   * juego, y en `gamepad` es un mando. Pero **`arena` tiene las dos clases**
   * y eso no hay forma de deducirlo: en la trivia el telefono muestra
   * opciones, y en Corredor corre la carrera entera con su propia pantalla.
   * Por eso se declara donde no coincide con el default.
   */
  phoneRole?: "control" | "player";
  /**
   * El juego tiene pagina propia (`#/jugar/:id`): sin sidebar, sin
   * administrables y a pantalla completa. El banco de pruebas
   * (`#/juego/:id`) sigue funcionando igual para desarrollarlo.
   */
  standalonePlay?: boolean;
  /** Archivo de games-guide que lo especifica. */
  guide: string;
  /** Administrables. Vacio mientras el juego no exista. */
  settings: SettingsSchema;
  /**
   * Donde se abre. Por defecto `inline`, adentro del catalogo.
   *
   * `tab` es para los juegos 3D: dejan de competir por el hilo principal con
   * el resto de la aplicacion y cerrar la pestana libera el contexto de GPU
   * sin depender de que el desmontaje limpie todo. Ver `opensInTab`.
   */
  launch?: "inline" | "tab";
  /** undefined = todavia no implementado. El catalogo lo muestra igual. */
  load?: () => Promise<{ default: GameComponent }>;
};

export const CATEGORY_LABEL: Record<GameCategory, string> = {
  retro: "Retro",
  modern: "Moderno",
  creative: "Creativo / 3D",
};

export const TOPOLOGY_LABEL: Record<GameTopology, string> = {
  solo: "Individual",
  gamepad: "Celular como control",
  arena: "Arena compartida",
};

export const STATUS_LABEL: Record<GameStatus, string> = {
  stable: "Estable",
  beta: "Beta",
  draft: "Borrador",
  planned: "Pendiente",
};

export const ENGINE_LABEL: Record<GameEngineKind, string> = {
  canvas2d: "Canvas 2D",
  pixi: "PixiJS",
  r3f: "React Three Fiber",
  dom: "DOM + React",
};

export const INPUT_LABEL: Record<GameInput, string> = {
  touch: "Toque",
  swipe: "Deslizar",
  tilt: "Inclinacion",
  keyboard: "Teclado",
  pointer: "Mouse",
};

export const EFFORT_LABEL: Record<GameEffort, string> = {
  S: "Chico",
  M: "Medio",
  L: "Grande",
  XL: "Muy grande",
};

export function isPlayable(entry: GameEntry): boolean {
  return typeof entry.load === "function";
}

/**
 * Si el juego se abre en una pestana propia en vez de adentro del catalogo.
 *
 * Es para la 3D, y el motivo es concreto: un juego con WebGL y fisica en WASM
 * comparte el hilo principal con el sidebar, el panel de administrables y el
 * resto del catalogo. En su propia pestana no compite con nada, el navegador
 * le da su propio presupuesto de cuadros, y **al cerrarla se libera seguro**
 * el contexto de GPU —que es lo que no se puede garantizar al cambiar de ruta,
 * donde basta una referencia viva para que la textura siga ocupando memoria.
 *
 * Por defecto es `inline`: para un canvas 2D abrir una pestana seria molestar
 * sin ganar nada.
 */
export function opensInTab(entry: GameEntry): boolean {
  return entry.launch === "tab";
}

/**
 * Adonde lleva "Jugar" cuando el juego tiene pagina propia.
 *
 * El asiento 1 es quien abre: es el host. Los demas entran por el codigo que
 * esa pantalla reparte.
 */
export function standalonePlayUrl(entry: GameEntry): string {
  return `#/jugar/${entry.id}?asiento=1`;
}

/** Un juego `solo` se juega en el propio telefono; el resto manda un mando. */
export function phoneRoleOf(entry: GameEntry): "control" | "player" {
  return entry.phoneRole ?? (entry.topology === "solo" ? "player" : "control");
}
