import type {
  RecordSubField,
  RecordsField,
  SettingsRecord,
  SettingsSchema,
} from "@/core/contract/settings";
import { TRIVIA_QUIZZES, type TriviaQuestionSeed, type TriviaQuizSeed } from "./content";
import { OPTION_KEYS } from "./logic";

/**
 * Administrables de C1.
 *
 * El contenido es lo que mas se toca: cada cliente reescribe las preguntas
 * antes del evento y elige cual de los cuatro cuestionarios corre esa noche.
 * Por eso los cuatro estan enteros como registros editables y no como
 * constantes: cambiar una pregunta no puede exigir un despliegue.
 *
 * Los limites de caracteres del panel son las reglas de escritura de la spec
 * puestas donde se escriben: 120 para el enunciado —tiene que leerse desde el
 * fondo en 3 segundos— y 40 para cada opcion, que son cuatro botones en un
 * telefono. La explicacion es obligatoria porque es el unico momento en que la
 * trivia ensena algo, y es lo que separa entretener de capacitar.
 *
 * De ritmo se exponen las cuatro perillas que cambian como se siente la
 * partida y ninguna mas. El anuncio y el cierre quedan en los 2 y 3 segundos
 * de `TRIVIA_ROUND_CONFIG`: nadie pide cambiarlos y cada perilla de mas es una
 * forma de romper el ritmo sin darse cuenta.
 */

const CORRECT_OPTIONS = [
  { value: "a", label: "Opción A" },
  { value: "b", label: "Opción B" },
  { value: "c", label: "Opción C" },
  { value: "d", label: "Opción D" },
] as const;

/** Las columnas de cada pregunta. Iguales en los cuatro cuestionarios. */
const QUESTION_FIELDS: readonly RecordSubField[] = [
  {
    kind: "text",
    key: "prompt",
    label: "Enunciado",
    maxLength: 120,
    default: "",
    help: "Menos de 120 caracteres: se lee desde el fondo de la sala en 3 segundos.",
  },
  { kind: "text", key: "a", label: "Opción A", maxLength: 40, default: "" },
  { kind: "text", key: "b", label: "Opción B", maxLength: 40, default: "" },
  { kind: "text", key: "c", label: "Opción C", maxLength: 40, default: "" },
  { kind: "text", key: "d", label: "Opción D", maxLength: 40, default: "" },
  {
    kind: "select",
    key: "correct",
    label: "Correcta",
    options: [...CORRECT_OPTIONS],
    default: "a",
    help: "Una sola defendible. En una trivia la ambigüedad es un defecto, no una gracia.",
  },
  {
    kind: "text",
    key: "explanation",
    label: "Explicación",
    maxLength: 120,
    default: "",
    help: "Una línea, obligatoria. Se proyecta al cerrar: es donde el juego enseña algo.",
  },
];

function toRecord(seed: TriviaQuestionSeed): SettingsRecord {
  const row: SettingsRecord = {
    prompt: seed.prompt,
    correct: OPTION_KEYS[seed.correct] ?? "a",
    explanation: seed.explanation,
  };
  OPTION_KEYS.forEach((key, index) => {
    row[key] = seed.options[index] ?? "";
  });
  return row;
}

/** Un cuestionario editable por cada uno de los cuatro de la spec. */
function quizField(quiz: TriviaQuizSeed): RecordsField {
  return {
    kind: "records",
    key: quiz.id,
    label: quiz.title,
    group: "Cuestionarios",
    titleKey: "prompt",
    min: 1,
    max: 30,
    help: quiz.description,
    fields: QUESTION_FIELDS,
    default: quiz.questions.map(toRecord),
  };
}

export const triviaSettings: SettingsSchema = [
  {
    kind: "select",
    key: "quiz",
    label: "Cuestionario activo",
    group: "Contenido",
    options: TRIVIA_QUIZZES.map((quiz) => ({ value: quiz.id, label: quiz.title })),
    default: "cultura",
    help: "El que se juega esta noche. Los otros tres quedan cargados y listos.",
  },
  ...TRIVIA_QUIZZES.map(quizField),

  {
    kind: "number",
    key: "answerSec",
    label: "Ventana de respuesta",
    group: "Ritmo",
    unit: "s",
    min: 5,
    max: 30,
    step: 1,
    default: 10,
    help: "Con 10 s, contestar al instante paga 1000 y sobre la chicharra, 500.",
  },
  {
    kind: "number",
    key: "readSec",
    label: "Lectura antes de habilitar",
    group: "Ritmo",
    unit: "s",
    min: 0,
    max: 8,
    step: 1,
    default: 3,
    help: "Los botones no responden durante este rato. Sin él gana el reflejo, no el criterio.",
  },
  {
    kind: "number",
    key: "rankingEvery",
    label: "Ranking completo cada",
    group: "Ritmo",
    unit: "preguntas",
    min: 0,
    max: 20,
    step: 1,
    default: 5,
    help: "0 lo apaga. Es el momento en que la sala mira: cada 5 preguntas está bien.",
  },

  {
    kind: "toggle",
    key: "streak",
    label: "Bono por racha",
    group: "Puntaje",
    default: true,
    help: "+100 por cada acierto seguido a partir del tercero, con tope de 500. Errar nunca resta.",
  },
  {
    kind: "toggle",
    key: "shuffleQuestions",
    label: "Barajar las preguntas",
    group: "Puntaje",
    default: false,
    help: "Con la semilla de la partida: toda la sala ve el mismo orden.",
  },
  {
    kind: "toggle",
    key: "shuffleOptions",
    label: "Barajar las opciones",
    group: "Puntaje",
    default: true,
    help: "Evita que la correcta caiga siempre en el mismo botón cuando se repite el cuestionario.",
  },

  {
    kind: "toggle",
    key: "demoBots",
    label: "Completar la sala con simulados",
    group: "Sala",
    default: false,
    help: "Sólo para probar el proyector sin celulares. Apagalo en un evento real.",
  },
];
