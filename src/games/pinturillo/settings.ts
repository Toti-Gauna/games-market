import type {
  RecordSubField,
  RecordsField,
  SettingsRecord,
  SettingsSchema,
} from "@/core/contract/settings";
import { POOL_OPTIONS } from "./logic";
import {
  NOT_DRAWABLE,
  PINTURILLO_WORD_LISTS,
  WORD_LEVELS,
  WORD_LEVEL_LABELS,
  type WordListSeed,
  type WordSeed,
} from "./words";

/**
 * Administrables de X1.
 *
 * Lo que mas se toca es el contenido: la lista `empresa` se reescribe entera
 * antes de cada evento y las otras tres se recortan segun la sala. Por eso las
 * cuatro estan como registros editables y no como constantes: cambiar una
 * palabra no puede exigir un despliegue.
 *
 * De ritmo se exponen solo las perillas que cambian como se siente la partida
 * -los 10 / 75 / 8 segundos de la spec y los tres momentos de las pistas- y
 * ninguna mas. Cada perilla de mas es una forma de romper el ritmo sin darse
 * cuenta.
 *
 * Y una que no es una perilla de ritmo sino de riesgo: **proyectar los
 * intentos fallidos viene APAGADO**. Es un evento de empresa con una pantalla
 * de tres metros; el default tiene que ser el seguro y el chat completo, una
 * decision explicita de quien organiza. El filtro de texto sobre los intentos
 * no es un administrable justamente porque no es opcional.
 */

const LEVEL_OPTIONS = WORD_LEVELS.map((level) => ({
  value: level,
  label: WORD_LEVEL_LABELS[level],
}));

/**
 * Las dos columnas de cada palabra. El limite de 24 caracteres es la regla de
 * escritura puesta donde se escribe: lo que no entra en guiones en el
 * proyector no es una palabra para este juego.
 */
const WORD_FIELDS: readonly RecordSubField[] = [
  {
    kind: "text",
    key: "text",
    label: "Palabra",
    maxLength: 24,
    default: "",
    help: `Dibujable, en minúscula y sin nombres de personas. "${NOT_DRAWABLE[0] ?? "sinergia"}" no es una palabra para este juego.`,
  },
  {
    kind: "select",
    key: "level",
    label: "Dificultad",
    options: LEVEL_OPTIONS,
    default: "media",
    help: "Las tres opciones que se ofrecen son de niveles distintos: elegir es parte del juego.",
  },
];

function toRecord(seed: WordSeed): SettingsRecord {
  return { text: seed.text, level: seed.level };
}

/** Una lista editable por cada una de las cuatro de la spec. */
function listField(list: WordListSeed): RecordsField {
  return {
    kind: "records",
    key: list.id,
    label: list.title,
    group: "Palabras",
    titleKey: "text",
    min: 1,
    max: 120,
    help: list.description,
    fields: WORD_FIELDS,
    default: list.words.map(toRecord),
  };
}

export const pinturilloSettings: SettingsSchema = [
  {
    kind: "select",
    key: "pool",
    label: "Listas en juego",
    group: "Contenido",
    options: [...POOL_OPTIONS],
    default: "mixta",
    help: "General y oficina es la mezcla que mejor funciona en una sala mixta. Las otras quedan cargadas y listas.",
  },
  ...PINTURILLO_WORD_LISTS.map(listField),

  {
    kind: "number",
    key: "rounds",
    label: "Rondas",
    group: "Ritmo",
    unit: "rondas",
    min: 1,
    max: 20,
    step: 1,
    default: 8,
    help: "El turno rota hasta que todos dibujaron una vez, o hasta que se acaban las rondas.",
  },
  {
    kind: "number",
    key: "chooseSec",
    label: "Elección de palabra",
    group: "Ritmo",
    unit: "s",
    min: 5,
    max: 20,
    step: 1,
    default: 10,
    help: "Lo que tiene quien dibuja para elegir entre las tres. Si no elige, sale la del medio.",
  },
  {
    kind: "number",
    key: "drawSec",
    label: "Dibujo",
    group: "Ritmo",
    unit: "s",
    min: 30,
    max: 180,
    step: 5,
    default: 75,
    help: "75 segundos alcanzan para un dibujo entendible y no para uno perfecto. Es a propósito.",
  },
  {
    kind: "number",
    key: "closeSec",
    label: "Cierre",
    group: "Ritmo",
    unit: "s",
    min: 4,
    max: 20,
    step: 1,
    default: 8,
    help: "La palabra en grande, quién acertó y en qué orden.",
  },
  {
    kind: "number",
    key: "rankingEvery",
    label: "Posiciones completas cada",
    group: "Ritmo",
    unit: "rondas",
    min: 0,
    max: 10,
    step: 1,
    default: 0,
    help: "0 lo apaga: las posiciones ya se ven al costado del dibujo durante toda la ronda.",
  },

  {
    kind: "number",
    key: "hint1Sec",
    label: "Primera letra a los",
    group: "Pistas",
    unit: "s restantes",
    min: 5,
    max: 170,
    step: 5,
    default: 45,
    help: "Las pistas son lo que evita que una ronda se muera en silencio.",
  },
  {
    kind: "number",
    key: "hint2Sec",
    label: "Segunda letra a los",
    group: "Pistas",
    unit: "s restantes",
    min: 5,
    max: 170,
    step: 5,
    default: 25,
    help: "Cuanto peor va el dibujo, más ayuda la palabra.",
  },
  {
    kind: "number",
    key: "hint3Sec",
    label: "Tercera letra a los",
    group: "Pistas",
    unit: "s restantes",
    min: 5,
    max: 170,
    step: 5,
    default: 10,
    help: "Nunca se revela la última letra que queda: la palabra no se regala entera.",
  },

  {
    kind: "number",
    key: "guessBase",
    label: "Puntos por acertar",
    group: "Puntaje",
    min: 0,
    max: 2000,
    step: 50,
    default: 400,
    help: "Lo que paga entender el dibujo, sin importar cuándo.",
  },
  {
    kind: "number",
    key: "guessSpeed",
    label: "Bono por rapidez",
    group: "Puntaje",
    min: 0,
    max: 2000,
    step: 50,
    default: 600,
    help: "Se reparte por lo que queda del reloj: acertar al instante paga todo, sobre la chicharra nada.",
  },
  {
    kind: "number",
    key: "drawerBase",
    label: "Piso de quien dibuja",
    group: "Puntaje",
    min: 0,
    max: 1000,
    step: 50,
    default: 200,
    help: "Sólo si acertó al menos una persona. Si no acierta nadie, saca 0.",
  },
  {
    kind: "number",
    key: "drawerPerGuess",
    label: "Por cada persona que acierta",
    group: "Puntaje",
    min: 0,
    max: 500,
    step: 25,
    default: 150,
    help: "Es lo que alinea a quien dibuja con la sala: le conviene que lo entiendan todos.",
  },

  {
    kind: "toggle",
    key: "showGuesses",
    label: "Proyectar los intentos fallidos",
    group: "Seguridad",
    default: false,
    help: "Apagado, el proyector muestra sólo “está escribiendo” y los aciertos. Encendido va el chat completo, siempre filtrado.",
  },
  {
    kind: "toggle",
    key: "demoBots",
    label: "Completar la sala con simulados",
    group: "Sala",
    default: false,
    help: "Sólo para probar el proyector sin celulares: garabatean y tiran intentos. Apagalo en un evento real.",
  },
];
