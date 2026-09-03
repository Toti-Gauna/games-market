import type { SettingsRecord } from "@/core/contract/settings";

/**
 * Los cinco niveles, como datos.
 *
 * Un nivel generado es un nivel que nadie diseno, y en cinco niveles se nota:
 * la progresion (tiro directo, derrumbe, apuntar alto, domino, todo junto) es
 * justamente lo que hace que se sienta un juego y no una demo de fisica.
 *
 * Todo esta en pixeles del mundo, con Y hacia abajo igual que el canvas. Asi
 * la fisica y el dibujo comparten sistema de coordenadas y no hay una sola
 * conversion por frame.
 */

export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;
/** Cara superior del suelo. Todo el nivel se apoya contra esta linea. */
export const GROUND_Y = 820;
/** Los objetivos son todos del mismo tamano: se reconocen de una. */
export const TARGET_SIZE = 46;

export type BlockMaterial = "wood" | "stone";

/** `x` e `y` son el centro del bloque, no su esquina. */
export type BlockData = {
  x: number;
  y: number;
  w: number;
  h: number;
  material: BlockMaterial;
};

export type TargetData = { x: number; y: number };

export type LevelData = {
  id: string;
  name: string;
  /** 0 = usar el valor general de "Tiros por nivel". */
  shots: number;
  blocks: readonly BlockData[];
  targets: readonly TargetData[];
};

/** Etiquetas del material en el panel: lo edita una persona, no un programa. */
const MATERIAL_LABEL: Record<BlockMaterial, string> = { wood: "madera", stone: "piedra" };

function block(x: number, y: number, w: number, h: number, material: BlockMaterial): BlockData {
  return { x, y, w, h, material };
}

/** Centro de un bloque de alto `h` apoyado en el suelo. */
function onGround(h: number): number {
  return GROUND_Y - h / 2;
}

const TARGET_ON_GROUND = onGround(TARGET_SIZE);

export const DEFAULT_LEVELS: readonly LevelData[] = [
  {
    id: "n1",
    name: "Tiro directo",
    shots: 0,
    blocks: [],
    targets: [{ x: 1150, y: TARGET_ON_GROUND }],
  },
  {
    id: "n2",
    name: "La torre",
    shots: 0,
    // El objetivo esta debajo: la torre tiene que venirse abajo encima suyo.
    blocks: [
      block(1080, 745, 26, 150, "wood"),
      block(1220, 745, 26, 150, "wood"),
      block(1150, 657, 190, 26, "wood"),
      block(1105, 589, 26, 110, "wood"),
      block(1195, 589, 26, 110, "wood"),
      block(1150, 521, 150, 26, "wood"),
    ],
    targets: [{ x: 1150, y: TARGET_ON_GROUND }],
  },
  {
    id: "n3",
    name: "Detrás del muro",
    shots: 0,
    // El muro de piedra no se rompe de frente: hay que pasarlo por arriba. Las
    // dos torres flanquean al objetivo pero no lo techan: si lo taparan, el
    // unico tiro posible seria imposible y el nivel quedaria sin solucion.
    blocks: [
      block(1060, 760, 40, 120, "stone"),
      block(1060, 640, 40, 120, "stone"),
      block(1060, 520, 40, 120, "stone"),
      block(1240, 770, 26, 100, "wood"),
      block(1240, 670, 26, 100, "wood"),
      block(1480, 770, 26, 100, "wood"),
      block(1480, 670, 26, 100, "wood"),
    ],
    targets: [{ x: 1360, y: TARGET_ON_GROUND }],
  },
  {
    id: "n4",
    name: "Dominó",
    shots: 0,
    // La tabla larga une las dos torres: voltear una empuja a la otra.
    blocks: [
      block(960, 740, 24, 160, "wood"),
      block(1060, 740, 24, 160, "wood"),
      block(1010, 649, 150, 22, "wood"),
      block(1260, 740, 24, 160, "wood"),
      block(1360, 740, 24, 160, "wood"),
      block(1310, 649, 150, 22, "wood"),
      block(1160, 628, 380, 20, "wood"),
    ],
    // Los dos objetivos viajan arriba de la tabla: voltear cualquiera de las
    // torres tira el puente y se los lleva a los dos. Ahi esta el domino.
    targets: [
      { x: 1010, y: 595 },
      { x: 1310, y: 595 },
    ],
  },
  {
    id: "n5",
    name: "Todo junto",
    shots: 3,
    blocks: [
      block(980, 755, 40, 130, "stone"),
      block(980, 625, 40, 130, "stone"),
      block(1200, 745, 26, 150, "wood"),
      block(1330, 745, 26, 150, "wood"),
      block(1265, 658, 180, 24, "wood"),
      block(1220, 596, 24, 100, "wood"),
      block(1310, 596, 24, 100, "wood"),
      block(1265, 534, 140, 24, "wood"),
    ],
    targets: [
      { x: 1265, y: TARGET_ON_GROUND },
      { x: 1265, y: 623 },
      { x: 1480, y: TARGET_ON_GROUND },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Formato editable                                                     */
/* ------------------------------------------------------------------ */

/**
 * Un nivel entra al panel como una fila con dos listas de texto. El schema de
 * administrables solo maneja escalares y listas de strings, asi que cada bloque
 * viaja como "x,y,ancho,alto,material" y cada objetivo como "x,y".
 */
export function encodeBlock(item: BlockData): string {
  return [item.x, item.y, item.w, item.h, MATERIAL_LABEL[item.material]].join(",");
}

export function encodeTarget(item: TargetData): string {
  return item.x + "," + item.y;
}

function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
}

export function decodeBlock(raw: string): BlockData | null {
  const parts = raw.split(",");
  const x = toNumber(parts[0]);
  const y = toNumber(parts[1]);
  const w = toNumber(parts[2]);
  const h = toNumber(parts[3]);
  if (x === null || y === null || w === null || h === null) return null;
  if (w <= 0 || h <= 0) return null;
  const label = (parts[4] ?? "").trim().toLowerCase();
  const material: BlockMaterial = label === "piedra" || label === "stone" ? "stone" : "wood";
  return { x, y, w, h, material };
}

export function decodeTarget(raw: string): TargetData | null {
  const parts = raw.split(",");
  const x = toNumber(parts[0]);
  const y = toNumber(parts[1]);
  if (x === null || y === null) return null;
  return { x, y };
}

export function encodeLevel(level: LevelData): SettingsRecord {
  return {
    name: level.name,
    shots: level.shots,
    blocks: level.blocks.map(encodeBlock),
    targets: level.targets.map(encodeTarget),
  };
}

/** Lo que el panel muestra por defecto. Se deriva de DEFAULT_LEVELS, no se repite. */
export const LEVEL_RECORDS: readonly SettingsRecord[] = DEFAULT_LEVELS.map(encodeLevel);
