/**
 * Las cuatro listas de palabras de X1, como dato plano.
 *
 * Son solo los DEFAULTS: lo que se juega sale de los administrables, porque
 * cada cliente reescribe la lista `empresa` antes del evento. Aca viven para
 * que el juego arranque cargado y para que las reglas de escritura tengan un
 * ejemplo al lado.
 *
 * Las tres reglas de escritura, que el test verifica una por una:
 *
 * 1. **Dibujable.** "Sinergia" no es una palabra para este juego por mas
 *    corporativa que suene. Alguien tiene 75 segundos y un dedo: si no se
 *    puede dibujar, la ronda se muere en silencio.
 * 2. **Sustantivos y acciones concretas**, nunca adjetivos ni conceptos.
 * 3. **Sin nombres de personas.** Dibujar a un companero en una pantalla de
 *    tres metros sale mal la mitad de las veces. Por eso todo va en minuscula:
 *    un nombre propio se delata solo.
 *
 * Los tres niveles no son decoracion. Las tres opciones que se le ofrecen al
 * que dibuja son una de cada nivel, asi que elegir -jugar seguro o arriesgar-
 * es parte del juego.
 */

export type WordLevel = "facil" | "media" | "dificil";

/** En el orden en que se ofrecen las tres opciones: facil primero. */
export const WORD_LEVELS: readonly WordLevel[] = ["facil", "media", "dificil"];

export const WORD_LEVEL_LABELS: Readonly<Record<WordLevel, string>> = {
  facil: "Fácil",
  media: "Media",
  dificil: "Difícil",
};

export type WordSeed = {
  /** Siempre en minuscula: es lo que impide que se cuele un nombre propio. */
  text: string;
  level: WordLevel;
};

export type WordListId = "general" | "oficina" | "empresa" | "dificil";

export type WordListSeed = {
  id: WordListId;
  title: string;
  /** Se muestra como ayuda del campo en el panel. */
  description: string;
  words: readonly WordSeed[];
};

/**
 * El contraejemplo de la spec, escrito.
 *
 * No es un filtro de seguridad -para eso esta `isBlockedText`- sino la regla
 * de escritura hecha dato: son palabras que suenan bien en una diapositiva y
 * no se pueden dibujar. El test las usa para probar que ninguna se filtro a
 * las listas, y el panel las nombra en la ayuda.
 */
export const NOT_DRAWABLE: readonly string[] = [
  "sinergia",
  "liderazgo",
  "cultura",
  "compromiso",
  "excelencia",
  "estrategia",
  "innovacion",
  "innovación",
  "proposito",
  "propósito",
  "vision",
  "visión",
  "mision",
  "misión",
  "empatia",
  "empatía",
  "confianza",
  "calidad",
  "valores",
  "transformacion",
  "transformación",
];

/* ------------------------------------------------------------------ */

const GENERAL: readonly WordSeed[] = [
  { text: "casa", level: "facil" },
  { text: "sol", level: "facil" },
  { text: "perro", level: "facil" },
  { text: "árbol", level: "facil" },
  { text: "pelota", level: "facil" },
  { text: "auto", level: "facil" },
  { text: "luna", level: "facil" },
  { text: "flor", level: "facil" },
  { text: "barco", level: "facil" },
  { text: "globo", level: "facil" },
  { text: "paraguas", level: "media" },
  { text: "bicicleta", level: "media" },
  { text: "guitarra", level: "media" },
  { text: "semáforo", level: "media" },
  { text: "escalera", level: "media" },
  { text: "heladera", level: "media" },
  { text: "pingüino", level: "media" },
  { text: "cocinar", level: "media" },
  { text: "correr", level: "media" },
  { text: "regar una planta", level: "media" },
  { text: "acordeón", level: "dificil" },
  { text: "trampolín", level: "dificil" },
  { text: "molino de viento", level: "dificil" },
  { text: "brújula", level: "dificil" },
  { text: "submarino", level: "dificil" },
  { text: "cascada", level: "dificil" },
  { text: "laberinto", level: "dificil" },
  { text: "telesilla", level: "dificil" },
];

const OFICINA: readonly WordSeed[] = [
  { text: "café", level: "facil" },
  { text: "teclado", level: "facil" },
  { text: "mate", level: "facil" },
  { text: "silla", level: "facil" },
  { text: "reloj", level: "facil" },
  { text: "lápiz", level: "facil" },
  { text: "tijera", level: "facil" },
  { text: "taza", level: "facil" },
  { text: "pizarra", level: "media" },
  { text: "ascensor", level: "media" },
  { text: "impresora", level: "media" },
  { text: "calendario", level: "media" },
  { text: "auriculares", level: "media" },
  { text: "cafetera", level: "media" },
  { text: "escritorio", level: "media" },
  { text: "abrochadora", level: "media" },
  { text: "sala de reuniones", level: "dificil" },
  { text: "videollamada", level: "dificil" },
  { text: "organigrama", level: "dificil" },
  { text: "tarjeta de acceso", level: "dificil" },
  { text: "cable de red", level: "dificil" },
  { text: "aire acondicionado", level: "dificil" },
  { text: "planilla de cálculo", level: "dificil" },
  { text: "sello", level: "dificil" },
];

const EMPRESA: readonly WordSeed[] = [
  { text: "logo", level: "facil" },
  { text: "caja", level: "facil" },
  { text: "camión", level: "facil" },
  { text: "casco", level: "facil" },
  { text: "llave", level: "facil" },
  { text: "carrito", level: "facil" },
  { text: "sucursal", level: "media" },
  { text: "depósito", level: "media" },
  { text: "mostrador", level: "media" },
  { text: "uniforme", level: "media" },
  { text: "vidriera", level: "media" },
  { text: "carretilla", level: "media" },
  { text: "cinta transportadora", level: "dificil" },
  { text: "corte de cinta", level: "dificil" },
  { text: "torta de aniversario", level: "dificil" },
  { text: "brindis", level: "dificil" },
  { text: "podio", level: "dificil" },
  { text: "planta industrial", level: "dificil" },
  { text: "sala de servidores", level: "dificil" },
  { text: "camión de reparto", level: "dificil" },
];

const DIFICIL: readonly WordSeed[] = [
  { text: "iceberg", level: "facil" },
  { text: "tornado", level: "facil" },
  { text: "esqueleto", level: "facil" },
  { text: "carrusel", level: "facil" },
  { text: "dominó", level: "facil" },
  { text: "reloj de arena", level: "facil" },
  { text: "espantapájaros", level: "media" },
  { text: "malabarista", level: "media" },
  { text: "colmena", level: "media" },
  { text: "origami", level: "media" },
  { text: "veleta", level: "media" },
  { text: "acueducto", level: "media" },
  { text: "hormiguero", level: "media" },
  { text: "eclipse", level: "dificil" },
  { text: "espejismo", level: "dificil" },
  { text: "planetario", level: "dificil" },
  { text: "equilibrista", level: "dificil" },
  { text: "caballo de troya", level: "dificil" },
  { text: "géiser", level: "dificil" },
  { text: "faro en la tormenta", level: "dificil" },
];

export const PINTURILLO_WORD_LISTS: readonly WordListSeed[] = [
  {
    id: "general",
    title: "General",
    description: "Objetos y acciones cotidianas. Es la lista con la que se arranca.",
    words: GENERAL,
  },
  {
    id: "oficina",
    title: "Oficina",
    description: "Lo que hay a la vista todos los días: reunión, café, teclado, pizarra.",
    words: OFICINA,
  },
  {
    id: "empresa",
    title: "Empresa",
    description:
      "Productos, áreas e hitos propios. Es la lista para reescribir antes del evento: sin nombres de personas.",
    words: EMPRESA,
  },
  {
    id: "dificil",
    title: "Difícil",
    description:
      "Para las rondas finales. Difíciles de dibujar, nunca abstractas: si no se puede dibujar, no entra.",
    words: DIFICIL,
  },
];

export function findWordList(id: string): WordListSeed | undefined {
  return PINTURILLO_WORD_LISTS.find((list) => list.id === id);
}

export function isWordLevel(value: unknown): value is WordLevel {
  return typeof value === "string" && (WORD_LEVELS as readonly string[]).includes(value);
}
