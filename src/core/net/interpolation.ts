import type { NetEntity, NetSnapshot } from "./snapshot";

/**
 * Buffer de snapshots y suavizado.
 *
 * El cliente **nunca** dibuja el ultimo snapshot recibido: dibuja el estado de
 * hace ~100 ms, interpolando entre los dos que lo rodean. Suena a agregar
 * latencia y lo es, pero es la unica forma de que lo ajeno se vea suave
 * llegando a 20 Hz con jitter. Dibujar el ultimo paquete significa mostrar
 * saltos de 50 ms y congelarse cada vez que uno llega tarde.
 *
 * El reloj es el del tick del host (`tick * intervalo`), no el de llegada: los
 * ticks son regulares y las llegadas no. El desfase entre los dos relojes se
 * estima con el minimo observado, que es el camino mas rapido de la red y por
 * lo tanto el que no tiene jitter adentro; despues se deja subir de a poco
 * para que el estimador se recupere si la red mejora o la pestana se oculto.
 */

const DRIFT_MS_PER_SNAPSHOT = 0.5;
/** Un salto de tick mas grande que esto es host reiniciado, no desorden. */
const RESET_TICK_GAP = 200;
/**
 * Por encima de esto no es jitter: es un salto del reloj local.
 *
 * El estimador baja al instante y sube de a 0,5 ms por snapshot, que a 20 Hz
 * son 10 ms por segundo. Eso esta bien para seguir una mejora de la red, y
 * esta MAL para volver de una pausa: una pestana oculta 5 segundos deja el
 * desfase a -4,8 s y tardaria unos ocho minutos en recuperarse, dibujando
 * mientras tanto el ultimo snapshot congelado.
 *
 * Medio segundo de diferencia no lo produce ninguna red: lo produce el reloj.
 * Ahi se re-ancla de una en vez de arrastrarse.
 */
const RESYNC_MS = 500;

export type TimedState<T> = {
  state: T;
  tick: number;
  /** ms en el reloj del host, derivado del tick. */
  timeMs: number;
};

export type InterpolationOptions<T> = {
  /** Como mezclar dos estados. Para `NetSnapshot` ya esta `lerpSnapshot`. */
  lerp: (a: T, b: T, t: number) => T;
  /** Cuanto atras vive el cliente. 100 ms = dos ticks a 20 Hz mas margen. */
  delayMs?: number;
  /** Ritmo de estado del host. 20 Hz por contrato. */
  tickRateHz?: number;
  capacity?: number;
};

export type SnapshotBuffer<T> = {
  /** `receivedAtMs` es el reloj local; en produccion, `performance.now()`. */
  push(state: T, tick: number, receivedAtMs: number): void;
  /** Lo que hay que dibujar ahora. `null` mientras no llego nada. */
  sample(nowMs: number): T | null;
  /** El ultimo recibido, sin interpolar. Es para diagnostico, no para dibujar. */
  latest(): T | null;
  clear(): void;
  readonly size: number;
  readonly delayMs: number;
  /** ms entre el ultimo snapshot y lo que se esta dibujando. Para el HUD. */
  readonly renderLagMs: number;
};

export function createSnapshotBuffer<T>(options: InterpolationOptions<T>): SnapshotBuffer<T> {
  const delayMs = options.delayMs ?? 100;
  const tickIntervalMs = 1000 / (options.tickRateHz ?? 20);
  const capacity = options.capacity ?? 32;
  const lerp = options.lerp;

  let items: TimedState<T>[] = [];
  let offsetMs: number | null = null;
  let renderLagMs = 0;

  function clear() {
    items = [];
    offsetMs = null;
    renderLagMs = 0;
  }

  return {
    push(state, tick, receivedAtMs) {
      const newest = items[items.length - 1];
      // Host reiniciado (o partida nueva): el historial viejo solo puede
      // hacer que el cliente interpole hacia un estado que ya no existe.
      if (newest && Math.abs(tick - newest.tick) > RESET_TICK_GAP) clear();

      const timeMs = tick * tickIntervalMs;
      const sample = receivedAtMs - timeMs;
      if (offsetMs === null || sample < offsetMs) {
        // Baja al instante: el camino mas rapido visto es el que no tiene
        // jitter adentro, y es el que hay que creer.
        offsetMs = sample;
      } else if (sample - offsetMs > RESYNC_MS) {
        // Salto de reloj, no red. Re-anclar en vez de arrastrarse minutos.
        offsetMs = sample;
      } else {
        offsetMs = Math.min(sample, offsetMs + DRIFT_MS_PER_SNAPSHOT);
      }

      const entry: TimedState<T> = { state, tick, timeMs };
      const last = items[items.length - 1];
      if (!last || tick > last.tick) {
        items.push(entry);
      } else {
        // Llego desordenado: se inserta en su lugar en vez de tirarlo, que a
        // 20 Hz es un hueco visible. El duplicado si se descarta.
        let index = items.length;
        while (index > 0) {
          const previous = items[index - 1];
          if (!previous || previous.tick < tick) break;
          if (previous.tick === tick) return;
          index--;
        }
        items.splice(index, 0, entry);
      }
      while (items.length > capacity) items.shift();
    },

    sample(nowMs) {
      if (items.length === 0 || offsetMs === null) return null;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return null;

      const renderTime = nowMs - offsetMs - delayMs;
      renderLagMs = last.timeMs - renderTime;

      // Todavia llenando el buffer: se muestra el mas viejo antes que nada.
      if (renderTime <= first.timeMs) return first.state;
      // Sin datos nuevos: se congela en el ultimo. Extrapolar aca es lo que
      // produce el rebote de goma cuando el paquete que faltaba llega.
      if (renderTime >= last.timeMs) return last.state;

      for (let i = items.length - 1; i > 0; i--) {
        const a = items[i - 1];
        const b = items[i];
        if (!a || !b) continue;
        if (a.timeMs <= renderTime && renderTime < b.timeMs) {
          const span = b.timeMs - a.timeMs;
          const t = span > 0 ? (renderTime - a.timeMs) / span : 0;
          // Lo anterior al par que se esta dibujando ya no se usa nunca mas.
          if (i > 1) items = items.slice(i - 1);
          return lerp(a.state, b.state, t);
        }
      }
      return last.state;
    },

    latest() {
      return items[items.length - 1]?.state ?? null;
    },

    clear,

    get size() {
      return items.length;
    },
    get delayMs() {
      return delayMs;
    },
    get renderLagMs() {
      return renderLagMs;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Mezcla de NetSnapshot                                               */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

/** Por el arco corto: de 350 a 10 grados son 20, no 340. */
export function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return a + delta * t;
}

function lerpEntity(a: NetEntity, b: NetEntity, t: number): NetEntity {
  return {
    id: a.id,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    vx: a.vx + (b.vx - a.vx) * t,
    vy: a.vy + (b.vy - a.vy) * t,
    angle: lerpAngle(a.angle, b.angle, t),
    // `flags` es discreto: "murio" no tiene mitad. Vale el de `a`, que es el
    // que rige durante el intervalo que se esta dibujando.
    flags: a.flags,
  };
}

/**
 * `t` fuera de 0..1 se recorta: interpolar, nunca extrapolar.
 * Los escalares (puntaje, ronda) no se mezclan por la misma razon que
 * `flags`: un puntaje de 3,5 no existe.
 */
export function lerpSnapshot(a: NetSnapshot, b: NetSnapshot, t: number): NetSnapshot {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const byIdB = new Map<number, NetEntity>();
  for (const entity of b.entities) byIdB.set(entity.id, entity);

  const entities: NetEntity[] = [];
  for (const entity of a.entities) {
    const next = byIdB.get(entity.id);
    // Sin par en `b` la entidad ya no existe: se deja de dibujar en vez de
    // arrastrar un fantasma hasta el proximo snapshot.
    if (next) entities.push(lerpEntity(entity, next, clamped));
  }
  const byIdA = new Set(a.entities.map((entity) => entity.id));
  for (const entity of b.entities) {
    if (!byIdA.has(entity.id)) entities.push({ ...entity });
  }
  entities.sort((x, y) => x.id - y.id);

  return { tick: a.tick, entities, scalars: [...a.scalars] };
}

/**
 * Igual que `lerpSnapshot` pero **sin asignar nada**.
 *
 * `lerpSnapshot` crea un Map, un Set, un array y una entidad por jugador en
 * cada llamada. Muestrear a 60 fps con 9 entidades son unas 700 asignaciones
 * por segundo, que es exactamente lo que el proyecto le prohibe a los juegos
 * en su loop: no puede ser que la capa de red lo haga por ellos.
 *
 * **El snapshot devuelto se reusa.** Vale hasta la proxima llamada: se lee y
 * se dibuja, no se guarda. Es el precio de no asignar, y para un estado que se
 * consume en el mismo cuadro no cuesta nada.
 */
export function createSnapshotLerp(): (a: NetSnapshot, b: NetSnapshot, t: number) => NetSnapshot {
  const entities: NetEntity[] = [];
  const scalars: number[] = [];
  const out = { tick: 0, entities, scalars } as unknown as NetSnapshot;
  /** Entidades reutilizadas. Crecen una vez y se quedan. */
  const pool: NetEntity[] = [];
  const indexB = new Map<number, NetEntity>();
  const seenA = new Set<number>();

  function take(index: number): NetEntity {
    let entity = pool[index];
    if (!entity) {
      entity = { id: 0, x: 0, y: 0, vx: 0, vy: 0, angle: 0, flags: 0 };
      pool[index] = entity;
    }
    return entity;
  }

  function write(target: NetEntity, a: NetEntity, b: NetEntity, t: number): void {
    target.id = a.id;
    target.x = a.x + (b.x - a.x) * t;
    target.y = a.y + (b.y - a.y) * t;
    target.vx = a.vx + (b.vx - a.vx) * t;
    target.vy = a.vy + (b.vy - a.vy) * t;
    target.angle = lerpAngle(a.angle, b.angle, t);
    target.flags = a.flags;
  }

  return (a, b, t) => {
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    indexB.clear();
    seenA.clear();
    for (const entity of b.entities) indexB.set(entity.id, entity);

    let count = 0;
    for (const entity of a.entities) {
      seenA.add(entity.id);
      const next = indexB.get(entity.id);
      // Sin par en `b` la entidad ya no existe: se deja de dibujar en vez de
      // arrastrar un fantasma hasta el proximo snapshot.
      if (!next) continue;
      write(take(count), entity, next, clamped);
      count++;
    }
    for (const entity of b.entities) {
      if (seenA.has(entity.id)) continue;
      const target = take(count);
      target.id = entity.id;
      target.x = entity.x;
      target.y = entity.y;
      target.vx = entity.vx;
      target.vy = entity.vy;
      target.angle = entity.angle;
      target.flags = entity.flags;
      count++;
    }

    entities.length = count;
    for (let i = 0; i < count; i++) entities[i] = take(i);
    entities.sort(byId);

    scalars.length = a.scalars.length;
    for (let i = 0; i < a.scalars.length; i++) scalars[i] = a.scalars[i] ?? 0;

    (out as { tick: number }).tick = a.tick;
    return out;
  };
}

function byId(a: NetEntity, b: NetEntity): number {
  return a.id - b.id;
}

/**
 * El buffer listo para el estado estandar. Es lo que usa `useGameNet`.
 *
 * Usa la version que no asigna: cada interpolador tiene su propio juego de
 * buffers, asi que dos consumidores no se pisan.
 */
export function createSnapshotInterpolator(
  options: Omit<InterpolationOptions<NetSnapshot>, "lerp"> = {},
): SnapshotBuffer<NetSnapshot> {
  return createSnapshotBuffer<NetSnapshot>({ ...options, lerp: createSnapshotLerp() });
}
