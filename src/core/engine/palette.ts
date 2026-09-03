/**
 * Los colores del canvas salen de los tokens CSS, no de hex sueltos.
 *
 * getComputedStyle fuerza layout, asi que se lee UNA vez y se cachea.
 * Cambiar el tema invalida el cache con clearPaletteCache().
 */

const TOKENS = [
  "--sn-bg",
  "--sn-bg-elev",
  "--sn-panel",
  "--sn-panel-hi",
  "--sn-line",
  "--sn-line-soft",
  "--sn-text",
  "--sn-text-muted",
  "--sn-text-dim",
  "--sn-violet-300",
  "--sn-violet-400",
  "--sn-violet-500",
  "--sn-violet-600",
  "--sn-magenta-300",
  "--sn-magenta-400",
  "--sn-magenta-500",
  "--sn-cyan-300",
  "--sn-cyan-400",
  "--sn-cyan-500",
  "--sn-success",
  "--sn-warn",
  "--sn-danger",
] as const;

export type PaletteToken = (typeof TOKENS)[number];
export type Palette = Record<PaletteToken, string>;

let cache: Palette | null = null;

export function readPalette(): Palette {
  if (cache) return cache;
  const styles = getComputedStyle(document.documentElement);
  const palette = {} as Palette;
  for (const token of TOKENS) {
    // El magenta chillon es a proposito: si aparece, falta un token.
    palette[token] = styles.getPropertyValue(token).trim() || "#ff00ff";
  }
  cache = palette;
  return palette;
}

export function clearPaletteCache(): void {
  cache = null;
}

function parseHex(hex: string): readonly [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.replace(/./g, (c) => c + c) : clean;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ] as const;
}

/** Hex + alpha a rgba(). Precalcular fuera del loop: arma un string. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
}

/** Mezcla dos hex. Sirve para degrades precalculados, nunca por frame. */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const to = (x: number) => Math.round(x).toString(16).padStart(2, "0");
  return "#" + to(r1 + (r2 - r1) * t) + to(g1 + (g2 - g1) * t) + to(b1 + (b2 - b1) * t);
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
