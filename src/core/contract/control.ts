/**
 * Lo que el host le dice al celular que muestre.
 *
 * El telefono no sabe nada del juego: recibe una descripcion de que dibujar y
 * devuelve que toco la persona. Es lo que permite que la MISMA pantalla de
 * control sirva para Pong, para la trivia y para lo que venga, sin que
 * `ControlPage` conozca ningun juego.
 */

/**
 * Las opciones NO se pueden distinguir solo por color: hay gente daltonica en
 * cualquier sala de 40 personas. Cada una lleva ademas su forma.
 */
export type OptionShape = "circle" | "triangle" | "square" | "diamond";

export type ControlOption = {
  id: string;
  label: string;
  shape: OptionShape;
};


/** Un dato chico que el mando muestra: tus lineas, la basura en camino. */
export type ControlStatus = {
  label: string;
  value: string;
  /** Destaca lo que cambia una decision, como "vienen 4 filas". */
  tone?: "default" | "warn" | "danger";
};

export type ControlButton = {
  id: string;
  label: string;
  /**
   * true = manda "empece a mantener" y "solte", y **la repeticion la calcula
   * el host**. Si la calculara el telefono, la latencia arruinaria el ritmo.
   */
  hold?: boolean;
  /**
   * Agrupa para separar en pantalla. `danger` va aparte de todo lo demas: una
   * caida dura es irreversible y tocarla sin querer cuesta la partida.
   */
  group?: "top" | "main" | "rotate" | "danger";
  shape?: OptionShape;
  /** Segunda linea chica: "casilla 14", "en casa". */
  hint?: string;
  /**
   * Deshabilitado con motivo. Un boton apagado que explica por que —"en casa,
   * necesitas 5 o 6"— ensena las reglas sin tutorial; uno apagado y mudo solo
   * confunde.
   */
  disabled?: boolean;
  disabledReason?: string;
};

/** Franja de posicion absoluta. Un paquete perdido se corrige solo en el siguiente. */
export type ControlSlider = {
  orientation: "vertical" | "horizontal";
  /** Rango permitido, 0..1. Achicarlo es como se limita a un jugador sin trabarlo. */
  min: number;
  max: number;
  /** Referencias visibles: donde esta el companero, donde esta el limite. */
  markers?: ReadonlyArray<{ at: number; label: string; tone?: "default" | "warn" }>;
};

/**
 * Una bola en la vista cenital del que apunta.
 *
 * El celular **no renderiza 3D**: recibe circulos en un plano y los dibuja.
 * Es lo que hace que el mando de un juego 3D cueste lo mismo que el de Pong.
 */
export type AimBall = {
  id: number;
  x: number;
  z: number;
  /** Como pintarla. El mando no sabe de reglas, solo de colores. */
  kind: "cue" | "solids" | "eight" | "stripes";
};

/**
 * La mesa como la ve el que apunta.
 *
 * **Las dos coordenadas se normalizan con la misma escala**, la del lado
 * largo: `x` va de 0 a 1 y `z` de 0 a `1 / aspect`. Normalizar cada eje por su
 * propio lado seria mas comodo de escribir y estaria mal: con escalas
 * distintas las bolas dejan de ser circulos y la linea de tiro proyectada no
 * coincide con la trayectoria real, que es el criterio de aceptacion 5.
 */
export type AimTable = {
  balls: readonly AimBall[];
  /** Largo dividido ancho. El mando dibuja el rectangulo con esto. */
  aspect: number;
  /** Radio de bola en la misma escala que `x`. */
  ballRadius: number;
  pockets: readonly { x: number; z: number }[];
  /** Boca del bolsillo, misma escala. */
  pocketRadius: number;
  /** El grupo propio ya asignado. `null` con la mesa abierta. */
  own: "solids" | "stripes" | "eight" | null;
};

export type ControlSpec =
  /** Todavia no hay nada que hacer: esperando al proyector o entre rondas. */
  | { layout: "wait"; message: string }
  /**
   * El taco.
   *
   * Vista cenital de la mesa, efecto vertical y una barra de fuerza que se
   * llena manteniendo apretado. Es el unico layout que muestra una escena, y
   * aun asi son circulos en 2D: el telefono no dibuja una sola cara 3D.
   *
   * El zoom con dos dedos no es un lujo. Sin ajuste fino, apuntarle a una bola
   * en el otro extremo de la mesa desde una pantalla de 6 pulgadas es
   * imposible, y el juego pasa a ser adivinar.
   */
  | {
      layout: "aim";
      /** "Tu turno", "Esperando a que la mesa se aquiete". */
      title?: string;
      table: AimTable;
      /** false mientras la mesa se mueve o no es su turno. */
      enabled: boolean;
      /**
       * Puede arrastrar la blanca antes de apuntar: el rival cometio falta.
       * Es la unica compensacion del juego y hay que verla, no deducirla.
       */
      ballInHand: boolean;
      status?: readonly ControlStatus[];
      notice?: string;
      /** Para la barra del turno de 45 s. */
      remainingMs?: number;
      windowMs?: number;
      haptic?: ControlHaptic;
    }
  | { layout: "paddle"; orientation: "vertical" | "horizontal" }
  | {
      layout: "buttons";
      options: readonly ControlOption[];
      /** false durante la ventana de lectura: sin eso gana el reflejo, no el criterio. */
      enabled: boolean;
      /** Ya elegido. No se puede cambiar una vez tocado. */
      picked: string | null;
      /**
       * El enunciado. Por defecto el telefono NO lo muestra —la gracia es que
       * la sala mire la pantalla grande— pero lo tiene a un toque para quien
       * no llega a leer de lejos.
       */
      question?: string;
      /** "Llegaste después del cierre", "Seguís jugando por puntos". */
      notice?: string;
      /** Para la barra de tiempo del telefono. */
      remainingMs?: number;
      /**
       * La ventana completa de este item. Sin esto el telefono tendria que
       * asumir una duracion, y una ventana de 5 s arrancaria la barra por la
       * mitad.
       */
      windowMs?: number;
    }
  /**
   * El mando de un juego de accion: franja de posicion, botones y un estado
   * chico. Lo comparten Invasores (franja + disparo), Rompeladrillos (franja
   * con rango limitado) y Tetris duelo (solo botones).
   */
  | {
      layout: "pad";
      /** "Tu turno", "Elegi que ficha mover". */
      title?: string;
      slider?: ControlSlider;
      buttons?: readonly ControlButton[];
      status?: readonly ControlStatus[];
      enabled: boolean;
      notice?: string;
      haptic?: ControlHaptic;
    }
  /**
   * El lienzo del que dibuja.
   *
   * Solo lo recibe quien tiene el turno. Manda **puntos normalizados en lotes**,
   * nunca imagenes: asi el dibujo escala a cualquier resolucion del proyector y
   * el trafico se mide en cientos de bytes, no en megas.
   */
  | {
      layout: "draw";
      /** La palabra que le toco. Solo la ve quien dibuja. */
      prompt: string;
      colors: readonly string[];
      widths: readonly number[];
      enabled: boolean;
      notice?: string;
      remainingMs?: number;
      windowMs?: number;
      haptic?: ControlHaptic;
    }
  /**
   * El campo para adivinar.
   *
   * Es el unico de los 24 que necesita teclado, y por eso el campo va ARRIBA:
   * el teclado virtual ocupa media pantalla y taparia lo que la persona escribe.
   */
  | {
      layout: "text";
      placeholder: string;
      /** La palabra en guiones con las letras ya reveladas. */
      hint?: string;
      enabled: boolean;
      /** Ya acerto: el campo se bloquea y pasa a mirar. */
      locked: boolean;
      notice?: string;
      remainingMs?: number;
      windowMs?: number;
      haptic?: ControlHaptic;
    };

/**
 * Vibracion disparada por el host.
 *
 * Va con `id` y no como un simple patron porque el spec se reenvia muchas
 * veces por segundo: sin un identificador, el telefono vibraria en cada
 * refresco. Vibra una vez por `id` nuevo, y nada mas.
 *
 * Es el segundo canal de feedback que pide el proyecto —visual mas tactil— y
 * lo que permite que fijar una pieza y completar cuatro lineas no se sientan
 * igual. `prefers-reduced-motion` lo apaga.
 */
export type ControlHaptic = {
  id: string;
  /** ms, o un patron de vibracion y pausa. */
  pattern: number | readonly number[];
};

/** Lo que el celular manda de vuelta. Nunca un tiempo ni un puntaje. */
export type ControlInput =
  | { kind: "paddle"; position: number }
  | { kind: "pick"; optionId: string }
  /** Evento de una vez: disparar, caida dura. Perder uno se nota. */
  | { kind: "press"; buttonId: string }
  /** Mantener y soltar. El host decide cada cuanto repite. */
  | { kind: "hold"; buttonId: string; pressed: boolean }
  /**
   * Un lote de puntos del trazo, normalizados 0..1.
   *
   * En lotes y no punto por punto: a 120 Hz de sensor tactil serian 120
   * paquetes por segundo por persona. Agrupados cada ~50 ms son 20, y el trazo
   * se ve igual de fluido porque el proyector interpola entre puntos.
   */
  | {
      kind: "stroke";
      phase: "start" | "move" | "end";
      points: readonly StrokePoint[];
      color: string;
      width: number;
      eraser: boolean;
    }
  /** Deshacer y borrar viajan como evento, no como un redibujado. */
  | { kind: "canvas"; action: "undo" | "clear" }
  /**
   * El tiro. Un solo mensaje por turno, y por eso el pool no necesita netcode
   * en tiempo real: se manda esto y se recibe el resultado, como en Ludo.
   */
  | {
      kind: "shoot";
      /** Radianes. 0 apunta hacia el lado positivo del eje largo. */
      angle: number;
      /** 0..1. Lo que se cargo con la barra. */
      power: number;
      /**
       * Efecto vertical, -1..1. Negativo es pegarle abajo (retroceso) y
       * positivo arriba (corrida). **No hay efecto lateral**: con el completo
       * el juego es injugable para quien no juega al pool.
       */
      spin: number;
    }
  /** Colocar la blanca con bola en mano. Coordenadas de `AimTable`. */
  | { kind: "place"; x: number; z: number }
  | { kind: "text"; value: string }
  /** "Ana esta escribiendo", sin decir que. */
  | { kind: "typing" };

/**
 * Proporcion del lienzo, compartida por el celular y el proyector.
 *
 * Los puntos de un trazo viajan normalizados 0..1 en los dos ejes, asi que
 * cada lado los multiplica por SU ancho y SU alto. Si los dos rectangulos no
 * tienen la misma proporcion, el mismo dibujo sale con otra forma: una pelota
 * hecha redonda en la mano llega al proyector como un huevo acostado.
 *
 * Por eso la proporcion es del contrato y no de cada pantalla. Cada lado
 * encuadra su lienzo con esta proporcion y deja aire alrededor: aire de mas es
 * gratis, y una figura deformada no se arregla mirandola de lejos.
 *
 * 4:3 y no 1:1 porque el que tiene que verse es el proyector, que es apaisado:
 * un cuadrado le deja la mitad del ancho sin usar.
 */
export const SKETCH_ASPECT = 4 / 3;

export type StrokePoint = {
  x: number;
  y: number;
  /** Presion 0..1, si el aparato la reporta. */
  p?: number;
};

export const WAITING: ControlSpec = { layout: "wait", message: "Esperando al proyector…" };
