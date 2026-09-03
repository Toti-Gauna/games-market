import type { RecordSubField, SettingsRecord, SettingsSchema } from "@/core/contract/settings";
import { DECKS, MAX_EXPLAIN_LENGTH, MAX_STATEMENT_LENGTH, type DeckId } from "./content";
import { MODE_OPTIONS } from "./logic";

/**
 * Administrables de "Verdadero o falso".
 *
 * Los cuatro juegos son contenido editable, no codigo: una sala de seguridad y
 * una de producto no comparten ni una afirmacion, y cambiar la tanda no
 * deberia exigir tocar un archivo .ts.
 *
 * El campo de la afirmacion tiene `maxLength: 90` a proposito. El limite no es
 * de base de datos: con una ventana de 5 s, una afirmacion que no se lee en
 * dos segundos convierte el juego en una carrera de lectura rapida. El panel
 * lo corta al escribir y `parseStatements` lo vuelve a cortar al leer.
 */

const STATEMENT_FIELDS: readonly RecordSubField[] = [
  {
    kind: "text",
    key: "text",
    label: "Afirmación",
    maxLength: MAX_STATEMENT_LENGTH,
    placeholder: "Un link de un remitente conocido siempre es seguro.",
    help: "Máximo 90 caracteres. Sin dobles negaciones.",
    default: "",
  },
  {
    kind: "toggle",
    key: "answer",
    label: "Es verdadera",
    default: false,
  },
  {
    kind: "text",
    key: "explain",
    label: "Explicación",
    maxLength: MAX_EXPLAIN_LENGTH,
    help: "Una línea, obligatoria. Se muestra al cerrar la afirmación.",
    default: "",
  },
];

/** El contenido por defecto sale de `content.ts`: una sola fuente de verdad. */
function rowsOf(deckId: DeckId): readonly SettingsRecord[] {
  return DECKS[deckId].statements.map((statement) => ({
    text: statement.text,
    answer: statement.answer,
    explain: statement.explain,
  }));
}

function deckField(deckId: DeckId, help: string) {
  return {
    kind: "records" as const,
    key: deckId,
    label: DECKS[deckId].title,
    group: "Contenido",
    titleKey: "text",
    min: 1,
    max: 20,
    help,
    fields: STATEMENT_FIELDS,
    default: rowsOf(deckId),
  };
}

export const verdaderoOFalsoSettings: SettingsSchema = [
  {
    kind: "select",
    key: "deck",
    label: "Juego",
    group: "Formato",
    options: [
      { value: "seguridad", label: DECKS.seguridad.title },
      { value: "cultura", label: DECKS.cultura.title },
      { value: "producto", label: DECKS.producto.title },
      { value: "mitos", label: DECKS.mitos.title },
      { value: "aleatorio", label: "Al azar (según la semilla)" },
    ],
    help: "Cuál de los cuatro se juega. Cada uno se edita más abajo.",
    default: "seguridad",
  },
  {
    kind: "select",
    key: "mode",
    label: "Modo",
    group: "Formato",
    options: [...MODE_OPTIONS],
    help: "Supervivencia genera el momento; puntos mide a todos por igual.",
    default: "supervivencia",
  },
  {
    kind: "number",
    key: "reviveAt",
    label: "Afirmación de repesca",
    group: "Formato",
    min: 0,
    max: 20,
    step: 1,
    help: "Quien acierte esa vuelve a la carrera. 0 la desactiva.",
    default: 6,
  },
  {
    kind: "toggle",
    key: "shuffleStatements",
    label: "Mezclar el orden",
    group: "Formato",
    help: "Siempre evita tres respuestas iguales seguidas.",
    default: true,
  },
  {
    kind: "number",
    key: "answerSeconds",
    label: "Ventana de respuesta",
    group: "Ritmo",
    min: 3,
    max: 15,
    step: 1,
    unit: "s",
    help: "Cinco es el ritmo del juego. Menos de tres premia el reflejo.",
    default: 5,
  },
  {
    kind: "number",
    key: "survivedBonus",
    label: "Bono por seguir vivo",
    group: "Puntaje",
    min: 0,
    max: 500,
    step: 10,
    unit: "pts",
    help: "Por cada afirmación superada estando en carrera.",
    default: 150,
  },
  {
    kind: "number",
    key: "finisherBonus",
    label: "Bono del sobreviviente",
    group: "Puntaje",
    min: 0,
    max: 2000,
    step: 50,
    unit: "pts",
    help: "Sólo para quien pasa todas las afirmaciones sin caer.",
    default: 500,
  },

  deckField("seguridad", "El ejemplo canónico: el link del remitente conocido."),
  deckField("cultura", "Prácticas y valores reales de la empresa."),
  deckField("producto", "Qué hace y qué no hace el producto."),
  deckField("mitos", "Creencias comunes del rubro, verdaderas y falsas."),
];
