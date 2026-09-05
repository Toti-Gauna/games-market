import {
  Color,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  type Material,
} from "three";
import { readPalette, type PaletteToken } from "@/core/engine/palette";

/**
 * Materiales de marca, cacheados.
 *
 * Mismo problema que en 2D: un material no puede leer una variable CSS. Los
 * tokens los resuelve `palette.ts`, que ya los lee una sola vez y los cachea;
 * aca solo se convierten a materiales y se comparten.
 *
 * Cero hex en este archivo: si un color no esta en `tokens.css`, no existe.
 *
 * Que tipo usar, por costo:
 *
 * - `basic`: no se ilumina. Para HUD en el mundo, lineas, siluetas y todo lo
 *   que tiene que verse igual mire donde mire la camara.
 * - `lambert`: difuso por vertice. Es el default del catalogo: con geometria
 *   de caras planas da todo el volumen que hace falta por casi nada.
 * - `standard`: PBR. Notablemente mas caro y en colores planos no se nota.
 *   Solo donde el metal o el reflejo sean parte del juego —las bolas de Pool
 *   son el unico caso claro—.
 *
 * El material que devuelve `getMaterial` es COMPARTIDO. Mutarlo cambia todo
 * lo que lo use; si hace falta uno propio, se pide con otras opciones.
 */

export type MaterialKind = "basic" | "lambert" | "standard";

export type MaterialOptions = {
  kind?: MaterialKind;
  /** < 1 enciende la transparencia, que obliga a ordenar por profundidad. */
  opacity?: number;
  /** Para planos sin espesor: rampas de una cara, carteles, agua. */
  doubleSide?: boolean;
  /** Emisivo de marca. Solo tiene efecto en `lambert` y `standard`. */
  emissive?: PaletteToken;
  /** Solo `standard`. */
  roughness?: number;
  /** Solo `standard`. */
  metalness?: number;
  /**
   * Multiplica el color por el atributo `color` de la geometria. Es lo que
   * enciende el sombreado horneado de `boxShaded` y la oclusion ambiental
   * por vertice del piso: volumen sin una sola sombra dinamica.
   */
  vertexColors?: boolean;
  /** Cuanto brilla el emisivo. 1 por defecto; mas de 1 para acentos que se ven de lejos. */
  emissiveIntensity?: number;
};

const materials = new Map<string, Material>();
const colors = new Map<PaletteToken, Color>();

/**
 * El color de marca como `Color` de three, cacheado.
 *
 * Con `ColorManagement` activo, `Color.set` interpreta el hex como sRGB y lo
 * lleva al espacio lineal de trabajo, que es lo que hace que el violeta del
 * juego sea el mismo violeta del resto de la app.
 *
 * Es compartido y de solo lectura: para modificarlo, `.clone()`.
 */
export function getColor(token: PaletteToken): Color {
  const cached = colors.get(token);
  if (cached) return cached;
  const color = new Color(readPalette()[token]);
  colors.set(token, color);
  return color;
}

export function getMaterial(token: PaletteToken, options: MaterialOptions = {}): Material {
  const kind = options.kind ?? "lambert";
  const key = cacheKey(token, kind, options);
  const cached = materials.get(key);
  if (cached) return cached;

  const created = build(token, kind, options);
  created.name = key;
  materials.set(key, created);
  return created;
}

/** Cuantos materiales hay vivos. Para los tests y el panel de debug. */
export function materialCacheSize(): number {
  return materials.size;
}

/** Descarte explicito. Va en el desmontaje del juego, siempre. */
export function disposeMaterials(): void {
  for (const material of materials.values()) material.dispose();
  materials.clear();
  colors.clear();
}

/* ------------------------------------------------------------------ */

function cacheKey(token: PaletteToken, kind: MaterialKind, options: MaterialOptions): string {
  return [
    token,
    kind,
    options.opacity ?? 1,
    options.doubleSide === true ? "ds" : "fs",
    options.emissive ?? "-",
    options.roughness ?? "-",
    options.metalness ?? "-",
    options.vertexColors === true ? "vc" : "-",
    options.emissiveIntensity ?? "-",
  ].join("|");
}

function build(token: PaletteToken, kind: MaterialKind, options: MaterialOptions): Material {
  const color = getColor(token);
  const opacity = options.opacity ?? 1;
  const shared = {
    color,
    side: options.doubleSide === true ? DoubleSide : FrontSide,
    transparent: opacity < 1,
    opacity,
    vertexColors: options.vertexColors === true,
  };

  if (kind === "basic") return new MeshBasicMaterial(shared);

  const emissive = options.emissive !== undefined ? getColor(options.emissive) : undefined;
  const glow = emissive
    ? { emissive, emissiveIntensity: options.emissiveIntensity ?? 1 }
    : {};

  if (kind === "lambert") {
    return new MeshLambertMaterial({ ...shared, ...glow });
  }

  return new MeshStandardMaterial({
    ...shared,
    roughness: options.roughness ?? 0.6,
    metalness: options.metalness ?? 0.1,
    ...glow,
  });
}
