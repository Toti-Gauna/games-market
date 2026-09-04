import type { AimTable } from "@/core/contract/control";

/**
 * La linea de tiro proyectada.
 *
 * Es geometria pura sobre lo que trae `AimTable`: un rayo contra circulos y
 * contra el rectangulo de la mesa. No sabe de pool ni de reglas, igual que el
 * resto del mando — le pasas circulos y te dice contra cual pega primero.
 *
 * **Por que vive aca y no en el juego.** El proyector calcula la trayectoria
 * real con Rapier; el telefono no puede correr un solver para dibujar una
 * linea. Esta es la aproximacion que se dibuja en el mando, y el criterio de
 * aceptacion 5 pide que coincida con la trayectoria real. Coincide porque el
 * primer tramo de un tiro de pool ES una recta: la blanca no cambia de
 * direccion hasta que toca algo, y el efecto vertical actua despues del
 * impacto, no antes.
 *
 * La direccion de la bola golpeada sale de la linea de centros en el momento
 * del contacto, que es exactamente como se comporta un choque elastico entre
 * dos esferas iguales. Por eso "aproximada" es casi una exageracion: sin
 * efecto lateral, es la direccion correcta.
 */

export type AimPoint = { x: number; z: number };

export type AimProjection = {
  /** Donde queda el centro de la blanca al tocar, o donde pega en la banda. */
  end: AimPoint;
  /** Bola golpeada. `null` = el tiro no toca ninguna. */
  hitId: number | null;
  /** Direccion unitaria de la bola golpeada. `null` si no golpea. */
  hitDir: AimPoint | null;
};

/** El borde util: un centro de bola nunca pasa de aca. */
export function tableBounds(table: AimTable): { maxX: number; maxZ: number } {
  return { maxX: 1, maxZ: 1 / table.aspect };
}

/** La blanca, si esta en la mesa. */
export function cueBallOf(table: AimTable): AimPoint | null {
  const cue = table.balls.find((b) => b.kind === "cue");
  return cue ? { x: cue.x, z: cue.z } : null;
}

/**
 * Contra que pega el tiro.
 *
 * Se resuelve el rayo contra cada bola como un choque de circulos: el contacto
 * ocurre cuando los centros quedan a `2r`, no a `r`. Confundir esas dos
 * distancias es el error clasico y da una linea que atraviesa media bola.
 */
export function projectAim(table: AimTable, angle: number): AimProjection {
  const cue = cueBallOf(table);
  if (!cue) return { end: { x: 0, z: 0 }, hitId: null, hitDir: null };

  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const contactDistance = table.ballRadius * 2;

  let best = Number.POSITIVE_INFINITY;
  let hitId: number | null = null;

  for (const ball of table.balls) {
    if (ball.kind === "cue") continue;

    const fx = cue.x - ball.x;
    const fz = cue.z - ball.z;
    const b = fx * dx + fz * dz;
    const c = fx * fx + fz * fz - contactDistance * contactDistance;

    // Con `b > 0` la bola queda detras del tiro; con discriminante negativo,
    // el rayo pasa de largo sin llegar a rozarla.
    const discriminant = b * b - c;
    if (discriminant < 0) continue;

    const t = -b - Math.sqrt(discriminant);
    if (t > 0 && t < best) {
      best = t;
      hitId = ball.id;
    }
  }

  const wall = distanceToCushion(table, cue, dx, dz);

  if (hitId === null || best > wall) {
    return {
      end: { x: cue.x + dx * wall, z: cue.z + dz * wall },
      hitId: null,
      hitDir: null,
    };
  }

  const end = { x: cue.x + dx * best, z: cue.z + dz * best };
  const target = table.balls.find((b) => b.id === hitId);
  if (!target) return { end, hitId: null, hitDir: null };

  const hx = target.x - end.x;
  const hz = target.z - end.z;
  const length = Math.hypot(hx, hz) || 1;

  return { end, hitId, hitDir: { x: hx / length, z: hz / length } };
}

/**
 * Cuanto viaja el centro de la blanca hasta la banda.
 *
 * Se mira el cruce con los cuatro bordes utiles y se toma el mas cercano hacia
 * adelante. Un componente en cero —un tiro perfectamente paralelo a una
 * banda— no cruza ese par de bordes nunca, y por eso se saltea en vez de
 * dividir por cero.
 */
function distanceToCushion(table: AimTable, from: AimPoint, dx: number, dz: number): number {
  const { maxX, maxZ } = tableBounds(table);
  const r = table.ballRadius;
  let best = Number.POSITIVE_INFINITY;

  if (dx !== 0) {
    const limit = dx > 0 ? maxX - r : r;
    const t = (limit - from.x) / dx;
    if (t > 0) best = Math.min(best, t);
  }
  if (dz !== 0) {
    const limit = dz > 0 ? maxZ - r : r;
    const t = (limit - from.z) / dz;
    if (t > 0) best = Math.min(best, t);
  }

  return Number.isFinite(best) ? best : 0;
}

/** Encierra un punto en la mesa. Para colocar la blanca con bola en mano. */
export function clampToTable(table: AimTable, point: AimPoint): AimPoint {
  const { maxX, maxZ } = tableBounds(table);
  const r = table.ballRadius;
  return {
    x: Math.min(Math.max(point.x, r), maxX - r),
    z: Math.min(Math.max(point.z, r), maxZ - r),
  };
}

/**
 * Si un punto pisa una bola que no es la blanca.
 *
 * Con bola en mano no se puede dejar la blanca encima de otra: el solver la
 * expulsaria en el primer paso y el tiro saldria de un lugar que nadie eligio.
 */
export function overlapsBall(table: AimTable, point: AimPoint): boolean {
  const minimum = table.ballRadius * 2;
  return table.balls.some(
    (ball) => ball.kind !== "cue" && Math.hypot(ball.x - point.x, ball.z - point.z) < minimum,
  );
}
