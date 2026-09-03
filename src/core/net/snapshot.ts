/**
 * Serializacion compacta de estado.
 *
 * A 20 Hz por 10 jugadores, mandar objetos serializados es basura y ancho de
 * banda: por eso el estado viaja como bytes crudos y no pasa nunca por
 * `JSON.stringify`. Tres decisiones cargan todo el peso:
 *
 * 1. **Cuantizacion.** Una posicion se dibuja en pixeles: 16 bits sobre el
 *    rango del mundo dan 0,03 px de resolucion, que nadie ve. Un angulo se
 *    dibuja en 256 pasos y tampoco se nota. Un `float64` por campo es pagar
 *    ocho bytes para tirar seis.
 * 2. **Delta contra el ultimo tick.** En un frame tipico se mueven dos cosas;
 *    mandar las otras veinte iguales es regalar el canal.
 * 3. **Comparar YA cuantizado.** El delta se calcula sobre los enteros de la
 *    grilla, no sobre los floats de entrada: si no, el ruido del float manda
 *    campos que no cambiaron y, peor, el host y el cliente terminan con bases
 *    distintas y el delta siguiente reconstruye mal.
 */

export const SNAPSHOT_VERSION = 1;
/** El id de entidad entra en un byte. */
export const MAX_ENTITIES = 255;
/** La mascara de escalares entra en un u16. */
export const MAX_SCALARS = 16;

const HEADER_BYTES = 11;
const ENTITY_MAX_BYTES = 12;
const SCALAR_MASK_BYTES = 2;
const SCALAR_BYTES = 4;
const TAU = Math.PI * 2;

const F_X = 1 << 0;
const F_Y = 1 << 1;
const F_VX = 1 << 2;
const F_VY = 1 << 3;
const F_ANGLE = 1 << 4;
const F_FLAGS = 1 << 5;
/** La entidad no estaba en la base: van todos los campos si o si. */
const F_NEW = 1 << 6;
const F_ALL = F_X | F_Y | F_VX | F_VY | F_ANGLE | F_FLAGS;

const FLAG_KEYFRAME = 1 << 0;

export type NetEntity = {
  /** 0..255. Para los jugadores conviene que sea el asiento. */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radianes. Se cuantiza a 8 bits. */
  angle: number;
  /** Byte libre del juego: vida, equipo, estado de animacion. */
  flags: number;
};

export type NetSnapshot = {
  tick: number;
  entities: readonly NetEntity[];
  /** Enteros que no son entidades: puntaje, ronda, tiempo. Hasta 16. */
  scalars: readonly number[];
};

/** El rango del mundo. Cuantizar exige saber entre que valores se reparte. */
export type QuantConfig = {
  posMin: number;
  posMax: number;
  velMin: number;
  velMax: number;
};

/** Cubre un diseno de 1920x1080 con margen: 0,033 px de resolucion. */
export const DEFAULT_QUANT: QuantConfig = {
  posMin: -128,
  posMax: 2048,
  velMin: -4096,
  velMax: 4096,
};

type CodedEntity = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  flags: number;
};

/** El estado ya sobre la grilla de la red: enteros, no floats. */
type CodedSnapshot = {
  tick: number;
  entities: CodedEntity[];
  scalars: number[];
};

/* ------------------------------------------------------------------ */
/* Cuantizacion                                                        */
/* ------------------------------------------------------------------ */

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function encodeRange(value: number, min: number, max: number, maxCode: number): number {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(value)) return 0;
  return Math.round(clamp01((value - min) / span) * maxCode);
}

function decodeRange(code: number, min: number, max: number, maxCode: number): number {
  return min + (code / maxCode) * (max - min);
}

export function encodePosition(value: number, quant: QuantConfig = DEFAULT_QUANT): number {
  return encodeRange(value, quant.posMin, quant.posMax, 0xffff);
}

export function decodePosition(code: number, quant: QuantConfig = DEFAULT_QUANT): number {
  return decodeRange(code, quant.posMin, quant.posMax, 0xffff);
}

export function encodeVelocity(value: number, quant: QuantConfig = DEFAULT_QUANT): number {
  return encodeRange(value, quant.velMin, quant.velMax, 0xffff);
}

export function decodeVelocity(code: number, quant: QuantConfig = DEFAULT_QUANT): number {
  return decodeRange(code, quant.velMin, quant.velMax, 0xffff);
}

export function encodeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const wrapped = ((angle % TAU) + TAU) % TAU;
  // El & 0xff cierra el circulo: 256 vuelve a ser 0, que es lo correcto.
  return Math.round((wrapped / TAU) * 256) & 0xff;
}

export function decodeAngle(code: number): number {
  return (code / 256) * TAU;
}

function toInt32(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded < -2147483648) return -2147483648;
  if (rounded > 2147483647) return 2147483647;
  return rounded;
}

function toCoded(snapshot: NetSnapshot, quant: QuantConfig): CodedSnapshot {
  if (snapshot.entities.length > MAX_ENTITIES) {
    throw new RangeError(`snapshot con ${snapshot.entities.length} entidades: el tope es ${MAX_ENTITIES}`);
  }
  if (snapshot.scalars.length > MAX_SCALARS) {
    throw new RangeError(`snapshot con ${snapshot.scalars.length} escalares: el tope es ${MAX_SCALARS}`);
  }
  const entities = snapshot.entities.map((entity) => ({
    id: entity.id & 0xff,
    x: encodePosition(entity.x, quant),
    y: encodePosition(entity.y, quant),
    vx: encodeVelocity(entity.vx, quant),
    vy: encodeVelocity(entity.vy, quant),
    angle: encodeAngle(entity.angle),
    flags: entity.flags & 0xff,
  }));
  // Orden por id: es lo que hace que el host y el cliente no discutan sobre
  // cual entidad es cual sin gastar bytes en decirlo.
  entities.sort((a, b) => a.id - b.id);
  return { tick: snapshot.tick >>> 0, entities, scalars: snapshot.scalars.map(toInt32) };
}

function fromCoded(coded: CodedSnapshot, quant: QuantConfig): NetSnapshot {
  return {
    tick: coded.tick,
    entities: coded.entities.map((entity) => ({
      id: entity.id,
      x: decodePosition(entity.x, quant),
      y: decodePosition(entity.y, quant),
      vx: decodeVelocity(entity.vx, quant),
      vy: decodeVelocity(entity.vy, quant),
      angle: decodeAngle(entity.angle),
      flags: entity.flags,
    })),
    scalars: [...coded.scalars],
  };
}

/** El estado tal como lo va a ver el cliente. Sirve para medir el error de la grilla. */
export function quantizeSnapshot(snapshot: NetSnapshot, quant: QuantConfig = DEFAULT_QUANT): NetSnapshot {
  return fromCoded(toCoded(snapshot, quant), quant);
}

/** Cota superior de bytes. El buffer se dimensiona con esto, no adivinando. */
export function snapshotByteBound(snapshot: NetSnapshot, removedCount = 0): number {
  return (
    HEADER_BYTES +
    snapshot.entities.length * ENTITY_MAX_BYTES +
    SCALAR_MASK_BYTES +
    snapshot.scalars.length * SCALAR_BYTES +
    removedCount
  );
}

/* ------------------------------------------------------------------ */
/* Empaquetado                                                         */
/* ------------------------------------------------------------------ */

function packCoded(next: CodedSnapshot, base: CodedSnapshot | null, target: ArrayBuffer): number {
  const keyframe = base === null;
  const baseOffset = base === null ? 0 : next.tick - base.tick;
  if (base !== null && (baseOffset <= 0 || baseOffset > 0xffff)) {
    throw new RangeError(`base fuera de rango: tick ${next.tick} contra ${base.tick}`);
  }

  const bound =
    HEADER_BYTES +
    next.entities.length * ENTITY_MAX_BYTES +
    SCALAR_MASK_BYTES +
    next.scalars.length * SCALAR_BYTES +
    (base?.entities.length ?? 0);
  if (target.byteLength < bound) {
    throw new RangeError(`buffer de ${target.byteLength} bytes para un snapshot de hasta ${bound}`);
  }

  const view = new DataView(target);
  const baseById = new Map<number, CodedEntity>();
  if (base) for (const entity of base.entities) baseById.set(entity.id, entity);

  let offset = HEADER_BYTES;
  let entityCount = 0;

  for (const entity of next.entities) {
    const previous = baseById.get(entity.id);
    let mask = 0;
    if (!previous) {
      mask = F_ALL | F_NEW;
    } else {
      if (entity.x !== previous.x) mask |= F_X;
      if (entity.y !== previous.y) mask |= F_Y;
      if (entity.vx !== previous.vx) mask |= F_VX;
      if (entity.vy !== previous.vy) mask |= F_VY;
      if (entity.angle !== previous.angle) mask |= F_ANGLE;
      if (entity.flags !== previous.flags) mask |= F_FLAGS;
    }
    // Lo que no cambio no viaja: es el grueso del ahorro en un tick tipico.
    if (mask === 0) continue;

    view.setUint8(offset, entity.id);
    view.setUint8(offset + 1, mask);
    offset += 2;
    if (mask & F_X) {
      view.setUint16(offset, entity.x, true);
      offset += 2;
    }
    if (mask & F_Y) {
      view.setUint16(offset, entity.y, true);
      offset += 2;
    }
    if (mask & F_VX) {
      view.setUint16(offset, entity.vx, true);
      offset += 2;
    }
    if (mask & F_VY) {
      view.setUint16(offset, entity.vy, true);
      offset += 2;
    }
    if (mask & F_ANGLE) {
      view.setUint8(offset, entity.angle);
      offset += 1;
    }
    if (mask & F_FLAGS) {
      view.setUint8(offset, entity.flags);
      offset += 1;
    }
    entityCount++;
  }

  let scalarMask = 0;
  const maskOffset = offset;
  offset += SCALAR_MASK_BYTES;
  for (let i = 0; i < next.scalars.length; i++) {
    const value = next.scalars[i] ?? 0;
    const previous = base?.scalars[i];
    if (!keyframe && previous !== undefined && previous === value) continue;
    scalarMask |= 1 << i;
    view.setInt32(offset, value, true);
    offset += SCALAR_BYTES;
  }
  view.setUint16(maskOffset, scalarMask, true);

  let removedCount = 0;
  if (base) {
    const nextIds = new Set(next.entities.map((entity) => entity.id));
    for (const entity of base.entities) {
      if (nextIds.has(entity.id)) continue;
      view.setUint8(offset, entity.id);
      offset += 1;
      removedCount++;
    }
  }

  view.setUint8(0, SNAPSHOT_VERSION);
  view.setUint8(1, keyframe ? FLAG_KEYFRAME : 0);
  view.setUint32(2, next.tick, true);
  view.setUint16(6, baseOffset, true);
  view.setUint8(8, entityCount);
  view.setUint8(9, next.scalars.length);
  view.setUint8(10, removedCount);
  return offset;
}

type Header = { keyframe: boolean; tick: number; baseTick: number };

function readHeader(bytes: Uint8Array): Header | null {
  if (bytes.byteLength < HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== SNAPSHOT_VERSION) return null;
  const keyframe = (view.getUint8(1) & FLAG_KEYFRAME) !== 0;
  const tick = view.getUint32(2, true);
  const baseOffset = view.getUint16(6, true);
  return { keyframe, tick, baseTick: tick - baseOffset };
}

function unpackCoded(bytes: Uint8Array, base: CodedSnapshot | null): CodedSnapshot | null {
  const header = readHeader(bytes);
  if (!header) return null;
  // Un delta sin su base no se puede reconstruir: se descarta y se pide
  // keyframe. Inventar el estado que falta es peor que perder un frame.
  if (!header.keyframe && (!base || base.tick !== header.baseTick)) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entityCount = view.getUint8(8);
  const scalarCount = view.getUint8(9);
  const removedCount = view.getUint8(10);

  const byId = new Map<number, CodedEntity>();
  if (!header.keyframe && base) {
    for (const entity of base.entities) byId.set(entity.id, { ...entity });
  }

  let offset = HEADER_BYTES;
  for (let i = 0; i < entityCount; i++) {
    if (offset + 2 > bytes.byteLength) return null;
    const id = view.getUint8(offset);
    const mask = view.getUint8(offset + 1);
    offset += 2;
    const entity: CodedEntity = byId.get(id) ?? { id, x: 0, y: 0, vx: 0, vy: 0, angle: 0, flags: 0 };
    if (mask & F_X) {
      entity.x = view.getUint16(offset, true);
      offset += 2;
    }
    if (mask & F_Y) {
      entity.y = view.getUint16(offset, true);
      offset += 2;
    }
    if (mask & F_VX) {
      entity.vx = view.getUint16(offset, true);
      offset += 2;
    }
    if (mask & F_VY) {
      entity.vy = view.getUint16(offset, true);
      offset += 2;
    }
    if (mask & F_ANGLE) {
      entity.angle = view.getUint8(offset);
      offset += 1;
    }
    if (mask & F_FLAGS) {
      entity.flags = view.getUint8(offset);
      offset += 1;
    }
    byId.set(id, entity);
  }

  if (offset + SCALAR_MASK_BYTES > bytes.byteLength) return null;
  const scalarMask = view.getUint16(offset, true);
  offset += SCALAR_MASK_BYTES;
  const scalars: number[] = [];
  for (let i = 0; i < scalarCount; i++) {
    if ((scalarMask & (1 << i)) !== 0) {
      scalars.push(view.getInt32(offset, true));
      offset += SCALAR_BYTES;
    } else {
      scalars.push(base?.scalars[i] ?? 0);
    }
  }

  for (let i = 0; i < removedCount; i++) {
    byId.delete(view.getUint8(offset));
    offset += 1;
  }

  const entities = [...byId.values()].sort((a, b) => a.id - b.id);
  return { tick: header.tick, entities, scalars };
}

export type PackOptions = {
  /** El ultimo tick confirmado. `null` empaqueta keyframe. */
  base?: NetSnapshot | null;
  quant?: QuantConfig;
};

/** Devuelve la cantidad de bytes escritos en `target`. */
export function packSnapshot(snapshot: NetSnapshot, target: ArrayBuffer, options: PackOptions = {}): number {
  const quant = options.quant ?? DEFAULT_QUANT;
  const base = options.base ? toCoded(options.base, quant) : null;
  return packCoded(toCoded(snapshot, quant), base, target);
}

/** `null` cuando el paquete esta roto o le falta la base del delta. */
export function unpackSnapshot(source: ArrayBuffer | Uint8Array, options: PackOptions = {}): NetSnapshot | null {
  const quant = options.quant ?? DEFAULT_QUANT;
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const base = options.base ? toCoded(options.base, quant) : null;
  const coded = unpackCoded(bytes, base);
  return coded ? fromCoded(coded, quant) : null;
}

/* ------------------------------------------------------------------ */
/* Codec con historial                                                 */
/* ------------------------------------------------------------------ */

/** Lo que el transporte necesita para mover estado sin conocer el juego. */
export type NetStateCodec<TState> = {
  /**
   * `confirmedTick` es el ultimo tick que el receptor dijo tener. Con eso el
   * delta se arma contra algo que el otro lado seguro puede reconstruir:
   * perder un paquete deja de romper la cadena entera.
   * `undefined` = contra el ultimo enviado. `null` = keyframe forzado.
   */
  encode(state: TState, confirmedTick?: number | null): Uint8Array;
  /** `null` = paquete inservible. El cliente pide keyframe y sigue. */
  decode(bytes: Uint8Array): TState | null;
  /** El host lo llama cuando un cliente se quedo sin base. */
  requestKeyframe(): void;
  reset(): void;
};

export type SnapshotCodecOptions = {
  quant?: QuantConfig;
  /** Keyframe periodico en ticks. 20 = uno por segundo a 20 Hz. */
  keyframeEvery?: number;
  /** Ticks que se guardan de cada lado para tolerar desorden y perdida. */
  historySize?: number;
};

export type SnapshotCodec = NetStateCodec<NetSnapshot> & { readonly lastBytes: number };

/**
 * El canal es un bus compartido: no hay una conexion por cliente. Por eso el
 * emisor guarda lo que mando y arma el delta contra el tick que el receptor
 * confirmo, no contra el ultimo que salio. La diferencia se nota con perdida:
 * con base "ultimo enviado", un paquete perdido invalida todos los siguientes
 * hasta el proximo keyframe; con base confirmada, se pierde ese y nada mas.
 * El keyframe periodico queda igual, como red para el que recien entra.
 */
/**
 * **Una instancia por consumidor.**
 *
 * El codec no es una funcion pura: guarda el ultimo enviado, el contador de
 * keyframes y el historial de lo que ya salio, porque el delta se arma contra
 * el tick que el receptor confirmo. Dos consumidores compartiendo una sola
 * instancia se pisan esa cadena y el segundo recibe deltas contra una base que
 * nunca vio — con el agravante de que no falla ruidosamente: decodifica y da
 * posiciones equivocadas.
 *
 * Si el mismo estado va a dos lados (por ejemplo el proyector dibujandose a si
 * mismo ademas de difundir), son dos `createSnapshotCodec()`.
 */
export function createSnapshotCodec(options: SnapshotCodecOptions = {}): SnapshotCodec {
  const quant = options.quant ?? DEFAULT_QUANT;
  const keyframeEvery = options.keyframeEvery ?? 20;
  const historySize = options.historySize ?? 32;

  let scratch = new ArrayBuffer(512);
  let lastSent: CodedSnapshot | null = null;
  let sinceKeyframe = 0;
  let forceKeyframe = false;
  let lastBytes = 0;

  const history = new Map<number, CodedSnapshot>();
  const order: number[] = [];
  const sent = new Map<number, CodedSnapshot>();
  const sentOrder: number[] = [];

  function remember(coded: CodedSnapshot) {
    history.set(coded.tick, coded);
    order.push(coded.tick);
    while (order.length > historySize) {
      const dropped = order.shift();
      if (dropped !== undefined) history.delete(dropped);
    }
  }

  function rememberSent(coded: CodedSnapshot) {
    sent.set(coded.tick, coded);
    sentOrder.push(coded.tick);
    while (sentOrder.length > historySize) {
      const dropped = sentOrder.shift();
      if (dropped !== undefined) sent.delete(dropped);
    }
  }

  return {
    encode(state, confirmedTick) {
      const coded = toCoded(state, quant);
      // Tick que no avanza (partida reiniciada) o keyframe pedido/periodico.
      const stale = lastSent !== null && coded.tick <= lastSent.tick;
      const forced = forceKeyframe || lastSent === null || stale || sinceKeyframe >= keyframeEvery;
      // Sin `confirmedTick` se cae al ultimo enviado: es lo correcto mientras
      // no haya nadie del otro lado diciendo que recibio.
      const candidate =
        confirmedTick === undefined ? lastSent : confirmedTick === null ? null : (sent.get(confirmedTick) ?? null);
      const base = forced || !candidate || candidate.tick >= coded.tick ? null : candidate;
      const keyframe = base === null;

      const bound =
        HEADER_BYTES +
        coded.entities.length * ENTITY_MAX_BYTES +
        SCALAR_MASK_BYTES +
        coded.scalars.length * SCALAR_BYTES +
        (base?.entities.length ?? 0);
      if (scratch.byteLength < bound) scratch = new ArrayBuffer(bound * 2);

      const length = packCoded(coded, base, scratch);
      lastSent = coded;
      rememberSent(coded);
      sinceKeyframe = keyframe ? 0 : sinceKeyframe + 1;
      forceKeyframe = false;
      lastBytes = length;
      // Copia: el scratch se reusa en el proximo tick y el paquete puede
      // seguir en vuelo por la latencia simulada.
      return new Uint8Array(scratch, 0, length).slice();
    },
    decode(bytes) {
      const header = readHeader(bytes);
      if (!header) return null;
      const base = header.keyframe ? null : (history.get(header.baseTick) ?? null);
      if (!header.keyframe && !base) return null;
      const coded = unpackCoded(bytes, base);
      if (!coded) return null;
      remember(coded);
      return fromCoded(coded, quant);
    },
    requestKeyframe() {
      forceKeyframe = true;
    },
    reset() {
      lastSent = null;
      sinceKeyframe = 0;
      forceKeyframe = true;
      history.clear();
      order.length = 0;
      sent.clear();
      sentOrder.length = 0;
    },
    get lastBytes() {
      return lastBytes;
    },
  };
}
