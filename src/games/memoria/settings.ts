import type { SettingsRecord, SettingsSchema } from "@/core/contract/settings";

/**
 * Administrables de Memoria de valores.
 *
 * Lo que mas se toca es el contenido: los principios de Clouders no son los de
 * la empresa que contrata el evento siguiente. Por eso los pares son registros
 * editables y no constantes adentro del componente; cambiar la cultura de una
 * empresa por la de otra es editar una tabla, no tocar codigo.
 *
 * Reglas de escritura: principio corto —entra en una tarjeta angosta— y
 * definicion en una linea, en presente y sin jerga interna. Si dos definiciones
 * podrian valer para el mismo principio, el juego deja de medir memoria y pasa
 * a medir suerte.
 */

const DEFAULT_PAIRS: readonly SettingsRecord[] = [
  {
    principle: "Cliente primero",
    definition: "Decidimos mirando el impacto en quien nos elige.",
  },
  {
    principle: "Transparencia",
    definition: "Lo que se puede contar, se cuenta antes de que lo pregunten.",
  },
  {
    principle: "Dueño del resultado",
    definition: "Nadie termina su parte si el problema sigue abierto.",
  },
  {
    principle: "Mejora continua",
    definition: "Cada entrega deja algo mejor que como lo encontró.",
  },
  {
    principle: "Equipo antes que ego",
    definition: "Ganamos juntos o aprendemos juntos, nunca a costa del otro.",
  },
  {
    principle: "Simplicidad",
    definition: "La solución más corta que resuelve el problema completo.",
  },
  {
    principle: "Confianza",
    definition: "Se asume buena intención y se pregunta antes de suponer.",
  },
  {
    principle: "Aprender rápido",
    definition: "Probamos en chico, medimos y ajustamos sin hacer drama.",
  },
];

export const memoriaSettings: SettingsSchema = [
  {
    kind: "records",
    key: "pairs",
    label: "Pares",
    group: "Contenido",
    titleKey: "principle",
    min: 3,
    max: 16,
    help: "Cada principio con lo que significa. Dos definiciones no pueden servir para el mismo principio.",
    fields: [
      { kind: "text", key: "principle", label: "Principio", maxLength: 40, default: "" },
      { kind: "text", key: "definition", label: "Qué significa", maxLength: 90, default: "" },
    ],
    default: DEFAULT_PAIRS,
  },
  {
    kind: "text",
    key: "prompt",
    label: "Consigna",
    group: "Contenido",
    maxLength: 120,
    default: "Uní cada principio con lo que significa.",
    help: "Lo que se lee arriba del tablero, antes de empezar.",
  },

  {
    kind: "number",
    key: "pairCount",
    label: "Pares en juego",
    group: "Partida",
    min: 3,
    max: 16,
    step: 1,
    default: 5,
    help: "Cuántos pares de la lista entran. Los elige la semilla, así todos juegan los mismos.",
  },
  {
    kind: "toggle",
    key: "shuffle",
    label: "Barajar la disposición",
    group: "Partida",
    default: true,
    help: "Con la semilla de la partida: todos reciben las mismas tarjetas en el mismo lugar.",
  },
  {
    kind: "toggle",
    key: "showTimer",
    label: "Mostrar el reloj",
    group: "Partida",
    default: true,
    help: "Solo aparece si la partida tiene límite de tiempo.",
  },

  {
    kind: "number",
    key: "pointsPerPair",
    label: "Puntos por par",
    group: "Puntaje",
    unit: "pts",
    min: 10,
    max: 500,
    step: 10,
    default: 100,
    help: "Lo que vale cada par bien unido, aunque después se corte el tiempo.",
  },
  {
    kind: "number",
    key: "bonusPerSecond",
    label: "Bono por segundo restante",
    group: "Puntaje",
    unit: "pts",
    min: 0,
    max: 20,
    step: 1,
    default: 2,
    help: "Solo si completás el tablero y la partida tiene límite: sin techo no se puede medir qué sobró.",
  },

  {
    kind: "number",
    key: "wrongFeedbackMs",
    label: "Feedback de error",
    group: "Presentación",
    unit: "ms",
    min: 300,
    max: 2000,
    step: 100,
    default: 900,
    help: "Cuánto queda marcada una unión equivocada antes de deshacerse sola.",
  },
];
