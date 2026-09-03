/**
 * Los tramos de pista, como datos.
 *
 * La pista NO se genera obstaculo por obstaculo al azar. Al azar salen
 * combinaciones imposibles —un hueco justo despues de una barrera alta, sin
 * espacio para recuperarse— y eso se siente injusto porque lo es.
 *
 * Cada tramo de aca es un patron corto ya validado como superable, con dos
 * datos que el generador usa para no ponerlo donde no corresponde:
 *
 * - `fromMeters`: desde que distancia puede aparecer. La progresion es lo que
 *   hace que el juego ensene sus mecanicas sin tutorial.
 * - `maxSpeed`: hasta que velocidad sigue siendo superable. Un patron que se
 *   pasa a 400 px/s puede ser imposible a 900.
 */

export type ObstacleKind =
  /** Se salta. */
  | "lowBlock"
  /** Se pasa deslizandose. */
  | "highBar"
  /** Se salta, y caerse adentro es perder. */
  | "gap"
  /** Pide salto doble. */
  | "doubleBlock"
  /** Se mueve: es cuestion de ritmo. */
  | "movingBlock";

export type PatternPiece = {
  kind: ObstacleKind;
  /** Offset en px desde el arranque del tramo. */
  dx: number;
  /** Ancho en px. Para `gap` es el largo del vacio. */
  width: number;
};

export type Pattern = {
  id: string;
  pieces: readonly PatternPiece[];
  /** Largo total del tramo en px. */
  length: number;
  fromMeters: number;
  /** px/s. Por encima de esto el tramo deja de ser superable. */
  maxSpeed: number;
};

/** Techo de velocidad del juego. Un tramo con esto es superable siempre. */
export const ANY_SPEED = 900;

export const PATTERNS: readonly Pattern[] = [
  /* --- desde el arranque: solo saltar --- */
  {
    id: "block-solo",
    pieces: [{ kind: "lowBlock", dx: 0, width: 46 }],
    length: 46,
    fromMeters: 0,
    maxSpeed: ANY_SPEED,
  },
  {
    id: "block-doble-separado",
    // 260 px de separacion: a 900 px/s son 290 ms, alcanza para aterrizar y
    // volver a saltar sin buffer.
    pieces: [
      { kind: "lowBlock", dx: 0, width: 46 },
      { kind: "lowBlock", dx: 260, width: 46 },
    ],
    length: 306,
    fromMeters: 40,
    maxSpeed: ANY_SPEED,
  },

  /* --- desde 150 m: deslizarse --- */
  {
    id: "barra-sola",
    pieces: [{ kind: "highBar", dx: 0, width: 120 }],
    length: 120,
    fromMeters: 150,
    maxSpeed: ANY_SPEED,
  },
  {
    id: "barra-luego-bloque",
    // La deslizada dura 500 ms; a 900 px/s son 450 px. El bloque va despues de
    // eso o el jugador sigue agachado cuando tiene que saltar.
    pieces: [
      { kind: "highBar", dx: 0, width: 120 },
      { kind: "lowBlock", dx: 520, width: 46 },
    ],
    length: 566,
    fromMeters: 220,
    maxSpeed: 780,
  },

  /* --- desde 300 m: huecos --- */
  {
    id: "hueco-corto",
    pieces: [{ kind: "gap", dx: 0, width: 130 }],
    length: 130,
    fromMeters: 300,
    maxSpeed: ANY_SPEED,
  },
  {
    id: "hueco-largo",
    pieces: [{ kind: "gap", dx: 0, width: 190 }],
    length: 190,
    fromMeters: 420,
    maxSpeed: ANY_SPEED,
  },
  {
    id: "bloque-y-hueco",
    pieces: [
      { kind: "lowBlock", dx: 0, width: 46 },
      { kind: "gap", dx: 300, width: 140 },
    ],
    length: 440,
    fromMeters: 480,
    maxSpeed: 800,
  },

  /* --- desde 600 m: salto doble --- */
  {
    id: "bloque-alto",
    pieces: [{ kind: "doubleBlock", dx: 0, width: 60 }],
    length: 60,
    fromMeters: 600,
    maxSpeed: ANY_SPEED,
  },
  {
    id: "bloque-alto-y-barra",
    pieces: [
      { kind: "doubleBlock", dx: 0, width: 60 },
      { kind: "highBar", dx: 560, width: 120 },
    ],
    length: 680,
    fromMeters: 720,
    maxSpeed: 760,
  },

  /* --- desde 1000 m: ritmo --- */
  {
    id: "movil-solo",
    pieces: [{ kind: "movingBlock", dx: 0, width: 50 }],
    length: 50,
    fromMeters: 1000,
    maxSpeed: ANY_SPEED,
  },
  {
    id: "movil-y-hueco",
    pieces: [
      { kind: "movingBlock", dx: 0, width: 50 },
      { kind: "gap", dx: 340, width: 140 },
    ],
    length: 480,
    fromMeters: 1200,
    maxSpeed: 820,
  },
];

/** Los tramos que pueden salir a esta distancia y a esta velocidad. */
export function eligiblePatterns(meters: number, speed: number): Pattern[] {
  return PATTERNS.filter((p) => p.fromMeters <= meters && p.maxSpeed >= speed);
}
