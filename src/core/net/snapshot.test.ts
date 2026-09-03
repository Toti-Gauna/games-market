import { describe, expect, it } from "vitest";
import {
  createSnapshotCodec,
  decodeAngle,
  decodePosition,
  encodeAngle,
  encodePosition,
  packSnapshot,
  quantizeSnapshot,
  snapshotByteBound,
  unpackSnapshot,
  type NetEntity,
  type NetSnapshot,
} from "./snapshot";

/** Un tick real de Pong a 4: cuatro paletas, la pelota y el tanteador. */
function fourPlayerTick(tick: number, drift = 0): NetSnapshot {
  const entities: NetEntity[] = [];
  for (let seat = 0; seat < 4; seat++) {
    entities.push({
      id: seat,
      x: seat < 2 ? 40 : 1240,
      y: 180 + seat * 90 + drift,
      vx: 0,
      vy: 240,
      angle: 0,
      flags: 1,
    });
  }
  entities.push({ id: 200, x: 640 + drift, y: 360 - drift, vx: 420, vy: -180, angle: 1.2, flags: 0 });
  return { tick, entities, scalars: [3, 2, 1, 0] };
}

describe("presupuesto de bytes", () => {
  it("un tick de 4 jugadores entra en menos de 200 bytes", () => {
    // Criterio 8 de la spec. Es el numero que decide si la base sirve: a 20 Hz
    // por diez juegos simultaneos, pasarse de aca es saturar el WiFi de la sala.
    const snapshot = fourPlayerTick(1);
    const buffer = new ArrayBuffer(snapshotByteBound(snapshot));
    const bytes = packSnapshot(snapshot, buffer);

    expect(bytes).toBeLessThan(200);
    expect(bytes).toBe(89);
  });

  it("el delta de un tick tipico es una fraccion del keyframe", () => {
    const previous = fourPlayerTick(1);
    const next = fourPlayerTick(2, 3);
    const buffer = new ArrayBuffer(snapshotByteBound(next, previous.entities.length));

    const keyframe = packSnapshot(previous, buffer);
    const delta = packSnapshot(next, buffer, { base: previous });

    expect(delta).toBeLessThan(keyframe);
    expect(delta).toBe(35);
  });

  it("lo que no se movio no ocupa ni un byte", () => {
    const snapshot = fourPlayerTick(7);
    const buffer = new ArrayBuffer(snapshotByteBound(snapshot, snapshot.entities.length));
    // Mismo estado dos veces: solo viaja la cabecera.
    const bytes = packSnapshot(snapshot, buffer, { base: { ...snapshot, tick: 6 } });
    expect(bytes).toBe(13);
  });
});

describe("ida y vuelta", () => {
  it("el keyframe reconstruye el estado cuantizado", () => {
    const snapshot = fourPlayerTick(12);
    const buffer = new ArrayBuffer(snapshotByteBound(snapshot));
    const bytes = packSnapshot(snapshot, buffer);

    const decoded = unpackSnapshot(buffer.slice(0, bytes));
    expect(decoded).toEqual(quantizeSnapshot(snapshot));
  });

  it("el delta reconstruye lo mismo que el keyframe", () => {
    const previous = fourPlayerTick(20);
    const next = fourPlayerTick(21, 5);
    const buffer = new ArrayBuffer(snapshotByteBound(next, previous.entities.length));
    const bytes = packSnapshot(next, buffer, { base: previous });

    const decoded = unpackSnapshot(buffer.slice(0, bytes), { base: previous });
    expect(decoded).toEqual(quantizeSnapshot(next));
  });

  it("una entidad que aparece y otra que se va viajan bien", () => {
    const previous = fourPlayerTick(30);
    const next: NetSnapshot = {
      tick: 31,
      entities: [
        ...previous.entities.filter((entity) => entity.id !== 3),
        { id: 90, x: 500, y: 500, vx: -60, vy: 0, angle: 0, flags: 9 },
      ],
      scalars: previous.scalars,
    };
    const buffer = new ArrayBuffer(snapshotByteBound(next, previous.entities.length));
    const bytes = packSnapshot(next, buffer, { base: previous });

    const decoded = unpackSnapshot(buffer.slice(0, bytes), { base: previous });
    expect(decoded?.entities.map((entity) => entity.id)).toEqual([0, 1, 2, 90, 200]);
    expect(decoded).toEqual(quantizeSnapshot(next));
  });

  it("un paquete con la base equivocada devuelve null en vez de basura", () => {
    const previous = fourPlayerTick(40);
    const next = fourPlayerTick(41, 2);
    const buffer = new ArrayBuffer(snapshotByteBound(next, previous.entities.length));
    const bytes = packSnapshot(next, buffer, { base: previous });

    expect(unpackSnapshot(buffer.slice(0, bytes), { base: fourPlayerTick(39) })).toBeNull();
    expect(unpackSnapshot(new ArrayBuffer(4))).toBeNull();
  });
});

describe("cuantizacion", () => {
  it("una posicion pierde menos de 0,05 px", () => {
    for (const value of [0, 1, 640.5, 1279.9, 1920]) {
      expect(Math.abs(decodePosition(encodePosition(value)) - value)).toBeLessThan(0.05);
    }
  });

  it("un angulo pierde menos de un grado y media vuelta cierra el circulo", () => {
    for (const angle of [0, 0.5, Math.PI, 5.9]) {
      expect(Math.abs(decodeAngle(encodeAngle(angle)) - angle)).toBeLessThan(0.0123);
    }
    expect(encodeAngle(Math.PI * 2)).toBe(encodeAngle(0));
    expect(encodeAngle(-Math.PI)).toBe(encodeAngle(Math.PI));
  });

  it("lo que se sale del mundo se recorta, no envuelve", () => {
    expect(encodePosition(-9999)).toBe(0);
    expect(encodePosition(999999)).toBe(0xffff);
  });
});

describe("codec con historial", () => {
  it("el cliente sigue la cadena de deltas", () => {
    const host = createSnapshotCodec();
    const client = createSnapshotCodec();

    const first = client.decode(host.encode(fourPlayerTick(1)));
    const second = client.decode(host.encode(fourPlayerTick(2, 4)));

    expect(first).toEqual(quantizeSnapshot(fourPlayerTick(1)));
    expect(second).toEqual(quantizeSnapshot(fourPlayerTick(2, 4)));
    expect(host.lastBytes).toBeLessThan(60);
  });

  it("el delta se arma contra el tick confirmado, no contra el ultimo enviado", () => {
    // Con base "ultimo enviado", un solo paquete perdido invalida todos los
    // que siguen hasta el proximo keyframe. Con base confirmada se pierde ese
    // paquete y nada mas, que es lo que hace jugable un 20 % de perdida.
    const host = createSnapshotCodec();
    const client = createSnapshotCodec();

    expect(client.decode(host.encode(fourPlayerTick(1)))).not.toBeNull();
    // El tick 2 se pierde: el cliente nunca lo ve.
    host.encode(fourPlayerTick(2, 4), 1);
    // El 3 se arma contra el 1, que es lo ultimo que el cliente confirmo.
    const third = client.decode(host.encode(fourPlayerTick(3, 8), 1));

    expect(third).toEqual(quantizeSnapshot(fourPlayerTick(3, 8)));
  });

  it("un cliente que se perdio la base pide keyframe y se recupera", () => {
    const host = createSnapshotCodec();
    const client = createSnapshotCodec();

    host.encode(fourPlayerTick(1));
    // El cliente nunca vio el tick 1: el delta del 2 no le sirve.
    expect(client.decode(host.encode(fourPlayerTick(2, 4)))).toBeNull();

    host.requestKeyframe();
    expect(client.decode(host.encode(fourPlayerTick(3, 8)))).toEqual(quantizeSnapshot(fourPlayerTick(3, 8)));
  });

  it("manda keyframe una vez por segundo sin que nadie lo pida", () => {
    const host = createSnapshotCodec({ keyframeEvery: 20 });
    const client = createSnapshotCodec();
    let recovered = 0;

    for (let tick = 1; tick <= 25; tick++) {
      const bytes = host.encode(fourPlayerTick(tick, tick));
      // El cliente arranca recien en el tick 5: hasta el keyframe no entiende nada.
      if (tick < 5) continue;
      if (client.decode(bytes) !== null) recovered++;
    }

    expect(recovered).toBeGreaterThan(0);
  });
});
