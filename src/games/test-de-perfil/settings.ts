import type { RecordSubField, SettingsRecord, SettingsSchema } from "@/core/contract/settings";
import {
  ARCHETYPE_LABEL,
  ARCHETYPE_OPTIONS,
  ARCHETYPE_OPTIONS_WITH_NONE,
  NO_ARCHETYPE,
  OPTION_KEYS,
} from "./logic";

/**
 * Administrables del test de perfil.
 *
 * El contenido es lo que mas se toca: cada cliente reescribe las situaciones y
 * renombra los arquetipos. Por eso las doce preguntas y los cinco arquetipos
 * son registros editables y no constantes en el codigo.
 *
 * Reglas de escritura, que son lo que hace que el test sirva:
 * situaciones concretas de trabajo, cuatro salidas defendibles, pesos
 * repartidos entre dos arquetipos y nada de vida privada, salud, politica ni
 * creencias.
 */

const OPTION_LETTER: Record<(typeof OPTION_KEYS)[number], string> = {
  a: "A",
  b: "B",
  c: "C",
  d: "D",
};

/** Las cuatro opciones repiten estructura: texto + arquetipo fuerte + arquetipo flojo. */
const optionFields: RecordSubField[] = OPTION_KEYS.flatMap((key) => [
  {
    kind: "text",
    key,
    label: `Opción ${OPTION_LETTER[key]}`,
    maxLength: 120,
    default: "",
  },
  {
    kind: "select",
    key: `${key}Main`,
    label: `${OPTION_LETTER[key]} · suma fuerte a`,
    options: ARCHETYPE_OPTIONS,
    default: "explorer",
  },
  {
    kind: "select",
    key: `${key}Alt`,
    label: `${OPTION_LETTER[key]} · suma flojo a`,
    options: ARCHETYPE_OPTIONS_WITH_NONE,
    default: NO_ARCHETYPE,
  },
]);

type Row = [prompt: string, ...options: string[]];

/** Cada fila: enunciado y cuatro tercias de texto, arquetipo fuerte y flojo. */
function question(...[prompt, ...cells]: Row): SettingsRecord {
  const row: SettingsRecord = { prompt };
  OPTION_KEYS.forEach((key, index) => {
    row[key] = cells[index * 3] ?? "";
    row[`${key}Main`] = cells[index * 3 + 1] ?? "explorer";
    row[`${key}Alt`] = cells[index * 3 + 2] ?? NO_ARCHETYPE;
  });
  return row;
}

const DEFAULT_QUESTIONS: readonly SettingsRecord[] = [
  question(
    "Llega un proyecto nuevo sin definición clara. ¿Qué hacés primero?",
    "Armo un prototipo rápido para ver qué pasa", "explorer", "builder",
    "Busco a quien ya hizo algo parecido", "connector", "strategist",
    "Escribo qué puede salir mal antes de arrancar", "guardian", "strategist",
    "Dibujo cómo encaja con lo que ya existe", "strategist", "builder",
  ),
  question(
    "Una reunión se está yendo de tema. ¿Cuál es tu reflejo?",
    "Propongo cerrar con una decisión concreta", "builder", "strategist",
    "Anoto quién falta y le llevo el resumen después", "connector", "builder",
    "Marco el riesgo de salir sin definir nada", "guardian", "connector",
    "Tiro una idea nueva a ver si destraba", "explorer", "connector",
  ),
  question(
    "Te toca una herramienta que nadie del equipo usó. ¿Cómo arrancás?",
    "La abro y toco todo hasta entenderla", "explorer", "builder",
    "Leo la documentación y armo una guía corta", "builder", "connector",
    "Pregunto en otro equipo cómo la usan", "connector", "explorer",
    "Reviso qué pasa si falla antes de meterla", "guardian", "strategist",
  ),
  question(
    "El plan del trimestre cambió a mitad de camino. ¿Qué hacés?",
    "Rearmo el orden de prioridades", "strategist", "builder",
    "Aviso a todos los que dependían de lo que venía haciendo", "connector", "guardian",
    "Busco la oportunidad que abre el cambio", "explorer", "strategist",
    "Chequeo qué se rompe con el cambio", "guardian", "builder",
  ),
  question(
    "Algo salió mal y el equipo se enteró recién ahora. Primera reacción.",
    "Voy a la causa y la arreglo", "builder", "explorer",
    "Abro un canal y mantengo a todos al tanto", "connector", "guardian",
    "Reviso qué otro lugar puede tener el mismo problema", "guardian", "strategist",
    "Propongo cómo evitar que se repita el trimestre que viene", "strategist", "builder",
  ),
  question(
    "Tenés una hora libre en la semana. ¿En qué la usás?",
    "Pruebo una idea que me viene dando vueltas", "explorer", "builder",
    "Termino de dejar prolijo algo que quedó a medias", "builder", "guardian",
    "Me junto con alguien de otro equipo", "connector", "explorer",
    "Miro a dónde va esto dentro de seis meses", "strategist", "connector",
  ),
  question(
    "Alguien propone un cambio grande de proceso. Tu primer aporte.",
    "Pregunto qué problema resuelve", "strategist", "guardian",
    "Ofrezco probarlo en chico antes de escalarlo", "explorer", "builder",
    "Reviso a quién le cambia el día a día", "guardian", "connector",
    "Me ofrezco a armar la primera versión", "builder", "explorer",
  ),
  question(
    "Entra alguien nuevo al equipo. ¿Qué hacés sin que te lo pidan?",
    "Le paso el mapa de quién es quién", "connector", "strategist",
    "Le armo una primera tarea que se pueda terminar", "builder", "guardian",
    "Le muestro los lugares donde es fácil equivocarse", "guardian", "connector",
    "Lo invito a romper algo en un ambiente de prueba", "explorer", "builder",
  ),
  question(
    "Tenés dos caminos y poca información. ¿Cómo decidís?",
    "Pruebo el más barato de los dos y veo qué pasa", "explorer", "builder",
    "Consulto a tres personas que ya pasaron por eso", "connector", "strategist",
    "Elijo el que deja menos puertas cerradas", "strategist", "guardian",
    "Elijo el que puedo revertir si sale mal", "guardian", "explorer",
  ),
  question(
    "El equipo festeja un logro. ¿Qué mirás vos?",
    "Qué parte se puede repetir la próxima", "strategist", "builder",
    "Quién hizo un trabajo que no se vio", "connector", "guardian",
    "Qué quedó sin terminar del todo", "guardian", "builder",
    "Qué probamos que antes no hacíamos", "explorer", "strategist",
  ),
  question(
    "Te piden estimar algo que nunca hiciste.",
    "Doy un rango y lo ajusto cuando sepa más", "strategist", "explorer",
    "Lo parto en pedazos y estimo cada uno", "builder", "strategist",
    "Agrego margen para lo que seguro no vimos", "guardian", "builder",
    "Consulto a quien hizo algo parecido", "connector", "guardian",
  ),
  question(
    "Fin del día. ¿Con qué te quedás conforme?",
    "Con algo terminado y funcionando", "builder", "guardian",
    "Con haber destrabado a otra persona", "connector", "builder",
    "Con haber aprendido algo que no sabía a la mañana", "explorer", "connector",
    "Con el próximo paso más claro que ayer", "strategist", "explorer",
  ),
];

/** Ninguno se describe en negativo: es lo que separa una herramienta que se usa de una que incomoda. */
const DEFAULT_ARCHETYPES: readonly SettingsRecord[] = [
  {
    id: "explorer",
    name: ARCHETYPE_LABEL.explorer,
    description: "Vas primero, probás, y después preguntás. Abrís caminos que nadie recorrió.",
  },
  {
    id: "builder",
    name: ARCHETYPE_LABEL.builder,
    description: "Convertís ideas en cosas que funcionan. Lo tuyo se puede usar el mismo día.",
  },
  {
    id: "connector",
    name: ARCHETYPE_LABEL.connector,
    description: "Hacés que la información llegue a quien la necesita, y el equipo avanza junto.",
  },
  {
    id: "guardian",
    name: ARCHETYPE_LABEL.guardian,
    description: "Ves el riesgo que los demás no ven. Por vos las cosas siguen en pie.",
  },
  {
    id: "strategist",
    name: ARCHETYPE_LABEL.strategist,
    description: "Pensás dos movimientos más adelante y ordenás lo que viene.",
  },
];

export const profileTestSettings: SettingsSchema = [
  {
    kind: "records",
    key: "questions",
    label: "Situaciones",
    group: "Contenido",
    titleKey: "prompt",
    min: 3,
    max: 24,
    help: "Cada opción suma 3 al arquetipo fuerte y 1 al flojo. Las cuatro tienen que ser defendibles.",
    fields: [
      { kind: "text", key: "prompt", label: "Situación", maxLength: 160, default: "" },
      ...optionFields,
    ],
    default: DEFAULT_QUESTIONS,
  },
  {
    kind: "records",
    key: "archetypes",
    label: "Arquetipos",
    group: "Contenido",
    titleKey: "name",
    min: 5,
    max: 5,
    help: "Cinco, sin ganadores ni perdedores. Ninguno se describe en negativo.",
    fields: [
      { kind: "select", key: "id", label: "Arquetipo", options: ARCHETYPE_OPTIONS, default: "explorer" },
      { kind: "text", key: "name", label: "Nombre visible", maxLength: 40, default: "" },
      {
        kind: "text",
        key: "description",
        label: "Descripción",
        multiline: true,
        maxLength: 220,
        default: "",
      },
    ],
    default: DEFAULT_ARCHETYPES,
  },

  {
    kind: "number",
    key: "autoAdvanceMs",
    label: "Avance automático",
    group: "Presentación",
    unit: "ms",
    min: 0,
    max: 1200,
    step: 50,
    default: 250,
    help: "Cuánto queda visible la elección antes de pasar sola. Son doce preguntas: un toque de más se nota.",
  },
  {
    kind: "toggle",
    key: "allowBack",
    label: "Permitir volver una pregunta",
    group: "Presentación",
    default: true,
    help: "Alguien va a tocar sin querer. Volver recalcula la mezcla.",
  },
  {
    kind: "toggle",
    key: "showMix",
    label: "Mostrar la mezcla completa",
    group: "Presentación",
    default: true,
    help: "Nadie es 100 % de una cosa. Mostrar solo el ganador hace que el resultado se sienta arbitrario.",
  },
  {
    kind: "number",
    key: "closeMargin",
    label: "Margen para nombrar el segundo",
    group: "Presentación",
    unit: "puntos",
    min: 0,
    max: 15,
    step: 1,
    default: 5,
    help: 'Con los dos primeros dentro de este margen se muestra "X con mucho de Y".',
  },
  {
    kind: "toggle",
    key: "shuffleQuestions",
    label: "Barajar el orden de las situaciones",
    group: "Presentación",
    default: false,
    help: "Con la semilla de la partida: todos ven el mismo orden. Las opciones nunca se barajan.",
  },
];
