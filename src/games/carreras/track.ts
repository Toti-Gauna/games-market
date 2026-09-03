/**
 * La pista, como datos.
 *
 * Un circuito se declara como una lista de piezas —recta o arco, con su
 * curvatura— y de ahi se derivan las tres capas que el juego necesita:
 *
 * 1. **La linea central muestreada** a paso de arco constante. Es lo que usa
 *    la fisica: proyectar el auto sobre ella da avance y desvio lateral, y con
 *    eso ya se sabe si esta en pista, en que vuelta va y en que puesto esta.
 *    Nada de leer pixeles: `getImageData` por cuadro es exactamente lo que la
 *    spec prohibe, y ademas seria menos exacto que la cuenta.
 * 2. **La severidad de cada curva**, precalculada por muestra. La IA la lee
 *    por indice para saber cuanto frenar. Calcularla por cuadro seria hacer la
 *    misma cuenta sesenta veces por segundo para un dato que no cambia.
 * 3. **El bitmap plano**, que es lo unico que ve el shader de Mode 7. Se pinta
 *    UNA vez al arrancar, en un canvas aparte, y se sube a la GPU como textura.
 *
 * Las piezas casi cierran el circuito por construccion: la suma de giros da
 * 360 grados. El error que queda —siempre hay uno, por el paso de
 * integracion— se reparte linealmente a lo largo del recorrido, que es lo que
 * hace que el lazo cierre exacto sin deformar la forma dibujada.
 */

/** Lado del mundo, en unidades. El bitmap cubre exactamente este cuadrado. */
export const TRACK_SPAN = 1024;
/** Lado de la textura, en pixeles. 1:1 con el mundo: un texel por unidad. */
export const TRACK_TEXTURE_SIZE = 1024;

/** Margen entre el circuito y el borde del bitmap. Deja lugar al pasto. */
const FIT_MARGIN = 104;
/** Paso de la integracion cruda. Fino, porque se remuestrea despues. */
const RAW_STEP = 1;
/** Separacion buscada entre muestras de la linea central, en unidades. */
const TARGET_SPACING = 6;
/** Cuanto mira adelante la medida de severidad de curva, en unidades. */
const CORNER_LOOKAHEAD = 170;

export type TrackPiece = {
  /** Largo del tramo en unidades crudas. */
  length: number;
  /** Radianes de giro por unidad. Positivo dobla a la izquierda. */
  curvature: number;
};

export type TrackDefinition = {
  id: string;
  /** Nombre visible, en castellano. */
  name: string;
  pieces: readonly TrackPiece[];
  /** Rampas de turbo, como fraccion 0..1 del recorrido. */
  boosts: readonly number[];
  /** Medio ancho del asfalto, en unidades. */
  halfWidth: number;
  /** Banquina de pasto antes del muro, en unidades. */
  shoulder: number;
};

export type TrackGeometry = {
  id: string;
  name: string;
  /** Cantidad de muestras de la linea central. */
  count: number;
  xs: Float32Array;
  ys: Float32Array;
  /** Angulo de la tangente en cada muestra, en radianes. */
  headings: Float32Array;
  /**
   * Giro absoluto acumulado en las proximas `CORNER_LOOKAHEAD` unidades.
   * La IA lo usa para decidir cuanto levantar el pie antes de doblar.
   */
  corners: Float32Array;
  /** Separacion real entre muestras. El arco de la muestra i es i * spacing. */
  spacing: number;
  /** Largo total del circuito, en unidades. */
  length: number;
  halfWidth: number;
  shoulder: number;
  /** Posiciones de arco de las rampas de turbo. */
  boosts: Float32Array;
  /** Media longitud de una rampa, en unidades de arco. */
  boostSpan: number;
};

/* ------------------------------------------------------------------ */
/* Declaracion de los circuitos                                         */
/* ------------------------------------------------------------------ */

function straight(length: number): TrackPiece {
  return { length, curvature: 0 };
}

/** Arco de `turnDeg` grados con radio `radius`. Positivo dobla a la izquierda. */
function arc(turnDeg: number, radius: number): TrackPiece {
  const turn = (turnDeg * Math.PI) / 180;
  const length = Math.abs(turn) * radius;
  return { length, curvature: turn >= 0 ? 1 / radius : -1 / radius };
}

/**
 * Anillo Nova: el circuito de entrada. Dos rectas largas para tomar carrera,
 * curvas amplias y una sola chicana. Se aprende en una vuelta.
 */
const NOVA: TrackDefinition = {
  id: "nova",
  name: "Anillo Nova",
  halfWidth: 46,
  shoulder: 30,
  boosts: [0.12, 0.47, 0.79],
  pieces: [
    straight(160),
    arc(90, 55),
    straight(70),
    arc(90, 55),
    straight(40),
    arc(-60, 45),
    arc(60, 45),
    straight(60),
    arc(90, 50),
    straight(90),
    arc(90, 45),
    straight(30),
    arc(60, 40),
    arc(-60, 40),
    straight(50),
  ],
};

/**
 * Cinturon Kuiper: mas largo y mas nervioso. La horquilla de 150 grados es el
 * lugar donde el derrape deja de ser adorno y pasa a ser la unica forma de
 * pasar rapido.
 */
const KUIPER: TrackDefinition = {
  id: "kuiper",
  name: "Cinturón Kuiper",
  halfWidth: 42,
  shoulder: 26,
  boosts: [0.08, 0.33, 0.61, 0.88],
  pieces: [
    straight(220),
    arc(120, 70),
    straight(40),
    arc(-45, 60),
    arc(45, 60),
    straight(120),
    arc(90, 45),
    straight(60),
    arc(90, 60),
    straight(100),
    arc(150, 55),
    arc(-60, 50),
    arc(60, 50),
    straight(80),
  ],
};

export const TRACKS: readonly TrackDefinition[] = [NOVA, KUIPER];

export function trackById(id: string): TrackDefinition {
  for (const track of TRACKS) if (track.id === id) return track;
  return NOVA;
}

/* ------------------------------------------------------------------ */
/* Derivacion de la geometria                                           */
/* ------------------------------------------------------------------ */

/** Angulo a (-PI, PI]. Se usa en todos lados: mejor una sola version. */
export function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

export function buildTrack(def: TrackDefinition): TrackGeometry {
  /* --- 1. Integracion cruda ---------------------------------------- */
  const rawX: number[] = [];
  const rawY: number[] = [];
  let x = 0;
  let y = 0;
  let heading = 0;

  for (const piece of def.pieces) {
    const steps = Math.max(1, Math.round(piece.length / RAW_STEP));
    const ds = piece.length / steps;
    for (let i = 0; i < steps; i++) {
      rawX.push(x);
      rawY.push(y);
      x += Math.cos(heading) * ds;
      y += Math.sin(heading) * ds;
      heading += piece.curvature * ds;
    }
  }

  const raw = rawX.length;

  /* --- 2. Cierre exacto del lazo ------------------------------------ */
  // El error de cierre se reparte a lo largo del recorrido en vez de
  // corregirse de golpe al final: asi el circuito cierra exacto y la forma
  // dibujada no se nota tocada. Un lazo que no cierra rompe todo lo que viene
  // despues, empezando por el conteo de vueltas.
  const errorX = x - (rawX[0] ?? 0);
  const errorY = y - (rawY[0] ?? 0);
  for (let i = 0; i < raw; i++) {
    const t = i / raw;
    rawX[i] = (rawX[i] ?? 0) - errorX * t;
    rawY[i] = (rawY[i] ?? 0) - errorY * t;
  }

  /* --- 3. Encuadre dentro del bitmap -------------------------------- */
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < raw; i++) {
    const px = rawX[i] ?? 0;
    const py = rawY[i] ?? 0;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const usable = TRACK_SPAN - FIT_MARGIN * 2;
  const scale = Math.min(usable / Math.max(1, maxX - minX), usable / Math.max(1, maxY - minY));
  const offsetX = (TRACK_SPAN - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (TRACK_SPAN - (maxY - minY) * scale) / 2 - minY * scale;
  for (let i = 0; i < raw; i++) {
    rawX[i] = (rawX[i] ?? 0) * scale + offsetX;
    rawY[i] = (rawY[i] ?? 0) * scale + offsetY;
  }

  /* --- 4. Remuestreo a paso de arco constante ----------------------- */
  // Con paso constante, el arco de la muestra i es i * spacing, y encontrar la
  // muestra de una posicion de arco es una division, no una busqueda.
  const cum = new Float64Array(raw + 1);
  for (let i = 0; i < raw; i++) {
    const px = rawX[i] ?? 0;
    const py = rawY[i] ?? 0;
    const nx = rawX[(i + 1) % raw] ?? 0;
    const ny = rawY[(i + 1) % raw] ?? 0;
    cum[i + 1] = (cum[i] ?? 0) + Math.hypot(nx - px, ny - py);
  }
  const total = cum[raw] ?? 1;
  const count = Math.max(64, Math.round(total / TARGET_SPACING));
  const spacing = total / count;

  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  let cursor = 0;
  for (let k = 0; k < count; k++) {
    const target = k * spacing;
    while (cursor < raw - 1 && (cum[cursor + 1] ?? 0) < target) cursor++;
    const a = cum[cursor] ?? 0;
    const b = cum[cursor + 1] ?? a + 1;
    const t = b > a ? (target - a) / (b - a) : 0;
    const ax = rawX[cursor] ?? 0;
    const ay = rawY[cursor] ?? 0;
    const bx = rawX[(cursor + 1) % raw] ?? ax;
    const by = rawY[(cursor + 1) % raw] ?? ay;
    xs[k] = ax + (bx - ax) * t;
    ys[k] = ay + (by - ay) * t;
  }

  /* --- 5. Tangentes y severidad de curva ---------------------------- */
  // La tangente sale de la diferencia central sobre las muestras ya
  // corregidas: asi es continua tambien en la costura del lazo, que es justo
  // donde el metodo ingenuo pega el salto.
  const headings = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const nx = xs[(i + 1) % count] ?? 0;
    const ny = ys[(i + 1) % count] ?? 0;
    const px = xs[(i - 1 + count) % count] ?? 0;
    const py = ys[(i - 1 + count) % count] ?? 0;
    headings[i] = Math.atan2(ny - py, nx - px);
  }

  const lookahead = Math.max(1, Math.round(CORNER_LOOKAHEAD / spacing));
  const corners = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let turn = 0;
    for (let k = 0; k < lookahead; k++) {
      const a = headings[(i + k) % count] ?? 0;
      const b = headings[(i + k + 1) % count] ?? 0;
      turn += Math.abs(wrapAngle(b - a));
    }
    corners[i] = turn;
  }

  const boosts = new Float32Array(def.boosts.length);
  for (let i = 0; i < def.boosts.length; i++) boosts[i] = (def.boosts[i] ?? 0) * total;

  return {
    id: def.id,
    name: def.name,
    count,
    xs,
    ys,
    headings,
    corners,
    spacing,
    length: total,
    halfWidth: def.halfWidth,
    shoulder: def.shoulder,
    boosts,
    boostSpan: 34,
  };
}

/** Indice de muestra para una posicion de arco. Envuelve solo. */
export function sampleAtArc(track: TrackGeometry, s: number): number {
  const i = Math.floor(s / track.spacing) % track.count;
  return i < 0 ? i + track.count : i;
}

/** Si `s` cae sobre una rampa de turbo. */
export function isBoostArc(track: TrackGeometry, s: number): boolean {
  const half = track.length / 2;
  for (let i = 0; i < track.boosts.length; i++) {
    let d = s - (track.boosts[i] ?? 0);
    if (d > half) d -= track.length;
    else if (d < -half) d += track.length;
    if (d > -track.boostSpan && d < track.boostSpan) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* La capa visual                                                       */
/* ------------------------------------------------------------------ */

export type TrackColors = {
  space: string;
  grass: string;
  asphalt: string;
  /**
   * Los bordes emisivos son funcionales antes que decorativos: son lo que
   * deja leer la curva desde lejos, cuando el asfalto ya es una mancha.
   */
  edge: string;
  centerLine: string;
  boost: string;
  finishDark: string;
  finishLight: string;
};

/**
 * Pinta el bitmap plano que despues deforma el shader.
 *
 * Corre UNA vez, al montar. Es el unico lugar del juego que toca un contexto
 * 2D, y a proposito: dibujar el circuito con `stroke` sobre la linea central
 * es mucho mas corto que declarar poligonos a mano, y sale identico.
 */
export function paintTrack(
  ctx: CanvasRenderingContext2D,
  track: TrackGeometry,
  colors: TrackColors,
): void {
  const scale = TRACK_TEXTURE_SIZE / TRACK_SPAN;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = colors.space;
  ctx.fillRect(0, 0, TRACK_SPAN, TRACK_SPAN);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(track.xs[0] ?? 0, track.ys[0] ?? 0);
    for (let i = 1; i < track.count; i++) ctx.lineTo(track.xs[i] ?? 0, track.ys[i] ?? 0);
    ctx.closePath();
  };

  // Pasto: la banquina que frena.
  outline();
  ctx.strokeStyle = colors.grass;
  ctx.lineWidth = (track.halfWidth + track.shoulder) * 2;
  ctx.stroke();

  // Borde emisivo: se pinta ancho y se tapa con el asfalto. Sale mas barato y
  // mas parejo que trazar dos lineas paralelas a mano.
  outline();
  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = (track.halfWidth + 5) * 2;
  ctx.stroke();

  outline();
  ctx.strokeStyle = colors.asphalt;
  ctx.lineWidth = track.halfWidth * 2;
  ctx.stroke();

  // Linea central punteada: la referencia de cuanto se esta yendo uno.
  ctx.setLineDash([18, 22]);
  outline();
  ctx.strokeStyle = colors.centerLine;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);

  // Rampas de turbo: acento cyan sobre el piso, a lo ancho de la pista.
  ctx.strokeStyle = colors.boost;
  ctx.lineWidth = track.halfWidth * 1.5;
  for (let b = 0; b < track.boosts.length; b++) {
    const at = track.boosts[b] ?? 0;
    const from = sampleAtArc(track, at - track.boostSpan);
    const steps = Math.max(2, Math.round((track.boostSpan * 2) / track.spacing));
    ctx.beginPath();
    for (let k = 0; k <= steps; k++) {
      const i = (from + k) % track.count;
      const px = track.xs[i] ?? 0;
      const py = track.ys[i] ?? 0;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Meta: damero de dos filas cruzando la pista en la muestra 0.
  const h0 = track.headings[0] ?? 0;
  const nx = -Math.sin(h0);
  const ny = Math.cos(h0);
  const fx = Math.cos(h0);
  const fy = Math.sin(h0);
  const cells = 12;
  const cell = (track.halfWidth * 2) / cells;
  const x0 = track.xs[0] ?? 0;
  const y0 = track.ys[0] ?? 0;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < cells; col++) {
      const lat = -track.halfWidth + col * cell;
      const along = row * cell - cell;
      const cx = x0 + nx * (lat + cell / 2) + fx * (along + cell / 2);
      const cy = y0 + ny * (lat + cell / 2) + fy * (along + cell / 2);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(h0);
      ctx.fillStyle = (row + col) % 2 === 0 ? colors.finishLight : colors.finishDark;
      ctx.fillRect(-cell / 2, -cell / 2, cell, cell);
      ctx.restore();
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
