/** Colisiones 2D. AABB y circulo alcanzan para casi todos los juegos del catalogo. */

export type Box = { x: number; y: number; w: number; h: number };
export type Circle = { x: number; y: number; r: number };

export function boxHitsBox(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function circleHitsCircle(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.r + b.r;
  return dx * dx + dy * dy < r * r;
}

export function circleHitsBox(c: Circle, b: Box): boolean {
  const nx = clamp(c.x, b.x, b.x + b.w);
  const ny = clamp(c.y, b.y, b.y + b.h);
  const dx = c.x - nx;
  const dy = c.y - ny;
  return dx * dx + dy * dy < c.r * c.r;
}

export function pointInBox(px: number, py: number, b: Box): boolean {
  return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Colision barrida circulo-vs-AABB estatico.
 * Necesaria cuando el movil se mueve mas que su propio radio en un paso:
 * sin barrido, la pelota atraviesa la pared y nadie entiende por que.
 * Devuelve el t en [0,1] del impacto, o null.
 */
export function sweepCircleBox(c: Circle, dx: number, dy: number, b: Box): number | null {
  const expanded: Box = { x: b.x - c.r, y: b.y - c.r, w: b.w + c.r * 2, h: b.h + c.r * 2 };
  return sweepPointBox(c.x, c.y, dx, dy, expanded);
}

function sweepPointBox(px: number, py: number, dx: number, dy: number, b: Box): number | null {
  let tMin = 0;
  let tMax = 1;

  for (const axis of [0, 1] as const) {
    const p = axis === 0 ? px : py;
    const d = axis === 0 ? dx : dy;
    const lo = axis === 0 ? b.x : b.y;
    const hi = axis === 0 ? b.x + b.w : b.y + b.h;

    if (Math.abs(d) < 1e-8) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let t1 = (lo - p) / d;
    let t2 = (hi - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin <= 1 ? tMin : null;
}
