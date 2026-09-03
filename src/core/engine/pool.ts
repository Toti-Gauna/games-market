/**
 * Object pool.
 *
 * La regla del proyecto es cero asignaciones dentro del loop. Balas,
 * particulas y vectores salen de aca; el GC no corre a mitad de partida y no
 * se pierde el frame.
 */

export type Pool<T> = {
  /** Toma uno del pool y lo inicializa. null si esta lleno. */
  spawn(init: (item: T) => void): T | null;
  /** Recorre solo los vivos. El callback puede llamar `release`. */
  each(fn: (item: T, index: number) => void): void;
  release(item: T): void;
  releaseAll(): void;
  readonly active: number;
  readonly capacity: number;
};

export function createPool<T extends { alive: boolean }>(capacity: number, factory: () => T): Pool<T> {
  const items: T[] = new Array(capacity);
  for (let i = 0; i < capacity; i++) {
    const item = factory();
    item.alive = false;
    items[i] = item;
  }
  let active = 0;

  return {
    spawn(init) {
      for (let i = 0; i < capacity; i++) {
        const item = items[i] as T;
        if (item.alive) continue;
        item.alive = true;
        init(item);
        active++;
        return item;
      }
      return null;
    },
    each(fn) {
      for (let i = 0; i < capacity; i++) {
        const item = items[i] as T;
        if (item.alive) fn(item, i);
      }
    },
    release(item) {
      if (!item.alive) return;
      item.alive = false;
      active--;
    },
    releaseAll() {
      for (let i = 0; i < capacity; i++) (items[i] as T).alive = false;
      active = 0;
    },
    get active() {
      return active;
    },
    get capacity() {
      return capacity;
    },
  };
}
