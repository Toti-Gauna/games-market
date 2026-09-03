import { describe, expect, it } from "vitest";
import {
  createSnapshotBuffer,
  createSnapshotInterpolator,
  createSnapshotLerp,
  lerpAngle,
  lerpSnapshot,
} from "./interpolation";
import type { NetSnapshot } from "./snapshot";

/** Un jugador que cruza la pantalla. Alcanza para medir la mezcla. */
function tickAt(tick: number, x: number, angle = 0): NetSnapshot {
  return {
    tick,
    entities: [{ id: 0, x, y: 300, vx: 200, vy: 0, angle, flags: 1 }],
    scalars: [tick],
  };
}

function firstX(snapshot: NetSnapshot | null): number {
  return snapshot?.entities[0]?.x ?? Number.NaN;
}

describe("lerpSnapshot", () => {
  it("devuelve el punto medio entre dos snapshots", () => {
    const mid = lerpSnapshot(tickAt(1, 100), tickAt(2, 200), 0.5);
    expect(firstX(mid)).toBe(150);
  });

  it("recorta fuera de 0..1: interpola, nunca extrapola", () => {
    expect(firstX(lerpSnapshot(tickAt(1, 100), tickAt(2, 200), 2))).toBe(200);
    expect(firstX(lerpSnapshot(tickAt(1, 100), tickAt(2, 200), -1))).toBe(100);
  });

  it("el angulo va por el arco corto", () => {
    // De 350 a 10 grados son 20 grados, no 340.
    const a = (350 / 180) * Math.PI;
    const b = (10 / 180) * Math.PI;
    expect(lerpAngle(a, b, 0.5)).toBeCloseTo(Math.PI * 2, 5);
    expect(firstX(lerpSnapshot(tickAt(1, 0, a), tickAt(2, 0, b), 0.5))).toBe(0);
  });

  it("una entidad que ya no esta deja de dibujarse y una nueva aparece", () => {
    const before: NetSnapshot = { tick: 1, entities: [...tickAt(1, 10).entities], scalars: [] };
    const after: NetSnapshot = {
      tick: 2,
      entities: [{ id: 5, x: 80, y: 0, vx: 0, vy: 0, angle: 0, flags: 0 }],
      scalars: [],
    };
    const mixed = lerpSnapshot(before, after, 0.5);
    expect(mixed.entities.map((entity) => entity.id)).toEqual([5]);
  });

  it("los escalares no se mezclan: un puntaje de 3,5 no existe", () => {
    const mixed = lerpSnapshot(tickAt(3, 0), tickAt(4, 0), 0.5);
    expect(mixed.scalars).toEqual([3]);
  });
});

describe("buffer de interpolacion", () => {
  const setup = () => createSnapshotInterpolator({ delayMs: 100, tickRateHz: 20 });

  it("dibuja el punto medio entre los dos snapshots que rodean al momento de render", () => {
    const buffer = setup();
    // Tick 10 = 500 ms del host, recibido a los 1000 ms locales: 500 de desfase.
    buffer.push(tickAt(10, 100), 10, 1000);
    buffer.push(tickAt(11, 200), 11, 1050);

    // 1125 - 500 de desfase - 100 de retraso = 525, justo entre 500 y 550.
    expect(firstX(buffer.sample(1125))).toBe(150);
  });

  it("nunca dibuja el ultimo snapshot recibido", () => {
    const buffer = setup();
    buffer.push(tickAt(10, 100), 10, 1000);
    buffer.push(tickAt(11, 200), 11, 1050);

    // Es la razon de ser del buffer: a 20 Hz con jitter, dibujar lo ultimo es
    // saltar de a 50 ms y congelarse cada vez que un paquete llega tarde.
    expect(firstX(buffer.sample(1050))).toBe(100);
    expect(firstX(buffer.latest())).toBe(200);
  });

  it("sin datos nuevos se congela en el ultimo en vez de inventar", () => {
    const buffer = setup();
    buffer.push(tickAt(10, 100), 10, 1000);
    buffer.push(tickAt(11, 200), 11, 1050);

    // Extrapolar aca es lo que produce el rebote de goma cuando el paquete
    // que faltaba finalmente llega.
    expect(firstX(buffer.sample(2000))).toBe(200);
  });

  it("un snapshot que llega desordenado se inserta en su lugar", () => {
    const buffer = setup();
    buffer.push(tickAt(10, 100), 10, 1000);
    buffer.push(tickAt(12, 300), 12, 1100);
    buffer.push(tickAt(11, 200), 11, 1105);

    expect(buffer.size).toBe(3);
    const sampled = firstX(buffer.sample(1175));
    expect(sampled).toBeGreaterThan(200);
    expect(sampled).toBeLessThan(300);
  });

  it("el duplicado se descarta", () => {
    const buffer = setup();
    buffer.push(tickAt(10, 100), 10, 1000);
    buffer.push(tickAt(10, 999), 10, 1010);
    expect(buffer.size).toBe(1);
  });

  it("sin nada recibido no hay que dibujar nada", () => {
    expect(setup().sample(1000)).toBeNull();
  });

  it("un host reiniciado limpia el historial en vez de interpolar al pasado", () => {
    const buffer = setup();
    buffer.push(tickAt(900, 100), 900, 1000);
    buffer.push(tickAt(1, 10), 1, 1100);
    expect(buffer.size).toBe(1);
  });

  it("respeta el tope de capacidad", () => {
    const buffer = createSnapshotBuffer<NetSnapshot>({ lerp: lerpSnapshot, capacity: 4 });
    for (let tick = 0; tick < 10; tick++) buffer.push(tickAt(tick, tick * 10), tick, 1000 + tick * 50);
    expect(buffer.size).toBe(4);
  });
});

describe("recuperacion despues de una pausa", () => {
  /**
   * Regresion. El estimador de desfase baja al instante y sube de a 0,5 ms por
   * snapshot, asi que una pestana oculta unos segundos lo dejaba varios miles
   * de ms atrasado y tardaba MINUTOS en recuperarse, dibujando el ultimo
   * snapshot congelado todo ese tiempo.
   *
   * Lo encontro Futbol, que es el primer juego que uso esta capa de verdad.
   */
  function feed(buffer: ReturnType<typeof createSnapshotBuffer<number>>, tick: number, at: number) {
    buffer.push(tick, tick, at);
  }

  it("vuelve a interpolar enseguida despues de una pausa larga", () => {
    const buffer = createSnapshotBuffer<number>({ lerp: (a, b, t) => a + (b - a) * t });

    let now = 0;
    for (let tick = 0; tick < 10; tick++) {
      feed(buffer, tick, now);
      now += 50;
    }
    expect(buffer.sample(now)).not.toBeNull();

    // La pestana estuvo oculta 5 segundos: el host siguio, el reloj local dio
    // un salto y los snapshots llegan de golpe con timestamps muy posteriores.
    now += 5000;
    for (let tick = 10; tick < 16; tick++) {
      feed(buffer, tick, now);
      now += 50;
    }

    // renderLagMs se calcula DENTRO de sample: hay que muestrear para medirlo.
    buffer.sample(now);
    // Con el arrastre de 0,5 ms esto quedaba en varios miles de ms negativos.
    expect(Math.abs(buffer.renderLagMs)).toBeLessThan(500);
  });

  it("un jitter normal NO dispara el re-anclaje", () => {
    // Si se re-anclara con cualquier diferencia, el estimador seguiria al peor
    // camino de la red en vez de al mejor, que es justo lo que hay que evitar.
    const buffer = createSnapshotBuffer<number>({ lerp: (a, b, t) => a + (b - a) * t });
    let now = 0;
    for (let tick = 0; tick < 20; tick++) {
      // 40 ms de jitter: mucho para una red, nada para un reloj.
      feed(buffer, tick, now + (tick % 2 === 0 ? 0 : 40));
      now += 50;
    }
    expect(buffer.sample(now)).not.toBeNull();
    expect(Math.abs(buffer.renderLagMs)).toBeLessThan(200);
  });
});

describe("createSnapshotLerp: mismo resultado, sin asignar", () => {
  const A: NetSnapshot = {
    tick: 10,
    entities: [
      { id: 1, x: 0, y: 0, vx: 0, vy: 0, angle: 0, flags: 7 },
      { id: 2, x: 100, y: 50, vx: 10, vy: 0, angle: 1, flags: 0 },
    ],
    scalars: [3, 4],
  };
  const B: NetSnapshot = {
    tick: 11,
    entities: [
      { id: 1, x: 10, y: 20, vx: 5, vy: 5, angle: 0.5, flags: 9 },
      { id: 2, x: 120, y: 50, vx: 10, vy: 0, angle: 1.2, flags: 1 },
    ],
    scalars: [5, 6],
  };

  it("da exactamente lo mismo que lerpSnapshot", () => {
    const reuse = createSnapshotLerp();
    for (const t of [0, 0.25, 0.5, 1]) {
      expect(reuse(A, B, t)).toEqual(lerpSnapshot(A, B, t));
    }
  });

  it("reusa el mismo objeto: no asigna por llamada", () => {
    // Es el punto entero. La capa de red no puede violar la regla de cero
    // asignaciones que el proyecto le exige a los juegos.
    const reuse = createSnapshotLerp();
    const first = reuse(A, B, 0.3);
    const second = reuse(A, B, 0.7);
    expect(second).toBe(first);
    expect(second.entities).toBe(first.entities);
  });

  it("una entidad que desaparece en B deja de dibujarse", () => {
    const reuse = createSnapshotLerp();
    const shrunk: NetSnapshot = { ...B, entities: [B.entities[0]!] };
    expect(reuse(A, shrunk, 0.5).entities.map((e) => e.id)).toEqual([1]);
  });

  it("una entidad nueva en B aparece, y el largo se achica al bajar", () => {
    const reuse = createSnapshotLerp();
    const grown: NetSnapshot = {
      ...B,
      entities: [...B.entities, { id: 9, x: 1, y: 2, vx: 0, vy: 0, angle: 0, flags: 0 }],
    };
    expect(reuse(A, grown, 0.5).entities.map((e) => e.id)).toEqual([1, 2, 9]);
    // Al volver a dos, el array reusado NO puede seguir mostrando tres.
    expect(reuse(A, B, 0.5).entities.map((e) => e.id)).toEqual([1, 2]);
  });

  it("dos interpoladores no se pisan los buffers", () => {
    const one = createSnapshotLerp();
    const two = createSnapshotLerp();
    const a = one(A, B, 0);
    two(A, B, 1);
    expect(a.entities[0]?.x).toBe(0);
  });
});
