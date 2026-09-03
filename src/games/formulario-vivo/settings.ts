import type { SettingsRecord, SettingsSchema } from "@/core/contract/settings";
import { SURVEY_KIND_OPTIONS } from "./logic";

/**
 * Administrables de "Pulso del equipo".
 *
 * Las preguntas son registros editables: cambiar la encuesta no deberia
 * requerir tocar codigo. Cada fila declara su tipo de item y el motor
 * corporativo dibuja el control que corresponde.
 *
 * La encuesta de ejemplo usa los seis tipos a proposito: si un tipo esta mal
 * implementado, se descubre aca y no en la sala.
 */

const EMPTY_ROW: SettingsRecord = {
  kind: "single",
  prompt: "",
  options: [],
  required: false,
  minLabel: "",
  maxLabel: "",
  yesLabel: "Sí",
  noLabel: "No",
};

function survey(row: SettingsRecord): SettingsRecord {
  return { ...EMPTY_ROW, ...row };
}

const DEFAULT_QUESTIONS: readonly SettingsRecord[] = [
  survey({
    kind: "scale",
    prompt: "¿Qué tan claro está el objetivo del trimestre?",
    minLabel: "Nada claro",
    maxLabel: "Clarísimo",
    required: true,
  }),
  survey({
    kind: "single",
    prompt: "¿Qué te frena más hoy?",
    options: [
      "El tiempo",
      "Las prioridades que cambian",
      "Depender de otros equipos",
      "Las herramientas",
    ],
  }),
  survey({
    kind: "multiple",
    prompt: "¿En qué áreas necesitás apoyo?",
    options: [
      "Definir prioridades",
      "Herramientas",
      "Formación",
      "Coordinación entre equipos",
      "Nada por ahora",
    ],
  }),
  survey({
    kind: "boolean",
    prompt: "¿Sentís que tu trabajo se ve?",
    yesLabel: "Sí, se ve",
    noLabel: "No tanto",
  }),
  survey({
    kind: "order",
    prompt: "Ordená estas prioridades para el trimestre que viene",
    options: ["Calidad", "Velocidad", "Aprendizaje", "Clima de equipo", "Alcance"],
  }),
  survey({
    kind: "text",
    prompt: "Una palabra que describa el trimestre",
    minLabel: "Escribí una sola palabra",
  }),
];

export const livePollSettings: SettingsSchema = [
  {
    kind: "records",
    key: "questions",
    label: "Preguntas",
    group: "Contenido",
    titleKey: "prompt",
    min: 1,
    max: 30,
    help: "El tipo decide el control: las opciones solo se usan en única, múltiple y ordenar.",
    fields: [
      {
        kind: "select",
        key: "kind",
        label: "Tipo de pregunta",
        options: SURVEY_KIND_OPTIONS,
        default: "single",
      },
      { kind: "text", key: "prompt", label: "Pregunta", maxLength: 160, default: "" },
      {
        kind: "words",
        key: "options",
        label: "Opciones",
        itemLabel: "Opción",
        min: 0,
        max: 12,
        default: [],
      },
      {
        kind: "toggle",
        key: "required",
        label: "Obligatoria",
        default: false,
      },
      {
        kind: "text",
        key: "minLabel",
        label: "Etiqueta del mínimo (o ayuda del texto)",
        maxLength: 40,
        default: "",
      },
      { kind: "text", key: "maxLabel", label: "Etiqueta del máximo", maxLength: 40, default: "" },
      { kind: "text", key: "yesLabel", label: "Etiqueta del sí", maxLength: 24, default: "Sí" },
      { kind: "text", key: "noLabel", label: "Etiqueta del no", maxLength: 24, default: "No" },
    ],
    default: DEFAULT_QUESTIONS,
  },

  {
    kind: "toggle",
    key: "anonymous",
    label: "Respuestas anónimas",
    group: "Privacidad",
    default: true,
    help: "Se lo dice a la persona antes de empezar. El resultado nunca lleva quién respondió.",
  },
  {
    kind: "toggle",
    key: "allowSkip",
    label: "Permitir saltear",
    group: "Privacidad",
    default: true,
    help: "Obligar a contestar todo devuelve respuestas inventadas en las que no aplican.",
  },

  {
    kind: "number",
    key: "scaleMax",
    label: "Máximo de la escala",
    group: "Presentación",
    min: 3,
    max: 7,
    step: 1,
    default: 5,
    help: "La escala arranca siempre en 1. Cinco pasos es lo que se responde sin pensarlo.",
  },
  {
    kind: "number",
    key: "textMaxLength",
    label: "Largo máximo del texto",
    group: "Presentación",
    unit: "caracteres",
    min: 10,
    max: 140,
    step: 5,
    default: 40,
    help: "Corto a propósito: las respuestas largas no entran en una nube de palabras.",
  },
  {
    kind: "toggle",
    key: "shuffleQuestions",
    label: "Barajar el orden de las preguntas",
    group: "Presentación",
    default: false,
    help: "Con la semilla de la partida: todos ven el mismo orden.",
  },
  {
    kind: "toggle",
    key: "shuffleOptions",
    label: "Barajar las opciones",
    group: "Presentación",
    default: true,
    help: "Evita que la primera opción se lleve los votos por estar primera.",
  },
  {
    kind: "toggle",
    key: "showOwnSummary",
    label: "Mostrar tus respuestas al final",
    group: "Presentación",
    default: true,
  },
];
