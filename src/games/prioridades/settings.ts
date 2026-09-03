import type { SettingsSchema } from "@/core/contract/settings";
import { DECK_OPTIONS, MAX_CARDS, PRIORITY_DECKS, defaultCardRows } from "./logic";

/**
 * Administrables de Prioridades.
 *
 * Cinco conjuntos de ocho tarjetas viven como datos en una sola tabla: cada
 * fila declara a que conjunto pertenece y el select de arriba elige cual se
 * juega. Cambiar el contenido para un cliente no deberia requerir tocar codigo.
 *
 * Escribir tarjetas nuevas tiene reglas, y estan en el `help` de la tabla
 * porque son la diferencia entre un resultado que abre conversacion y uno tibio.
 */
export const prioridadesSettings: SettingsSchema = [
  {
    kind: "select",
    key: "deck",
    label: "Conjunto que se juega",
    group: "Contenido",
    options: DECK_OPTIONS,
    default: PRIORITY_DECKS[0]?.id ?? "producto",
    help: "Se ordenan las tarjetas de este conjunto. Las demás quedan guardadas.",
  },
  {
    kind: "records",
    key: "cards",
    label: "Tarjetas",
    group: "Contenido",
    titleKey: "label",
    min: 2,
    max: DECK_OPTIONS.length * MAX_CARDS,
    help: "Ocho por conjunto. Todas tienen que ser buenas: si hay una obviamente mala, todos la mandan última y el ítem no aporta. Menos de 40 caracteres, sin jerga y sin dos que digan lo mismo.",
    fields: [
      {
        kind: "select",
        key: "deck",
        label: "Conjunto",
        options: DECK_OPTIONS,
        default: PRIORITY_DECKS[0]?.id ?? "producto",
      },
      {
        kind: "text",
        key: "label",
        label: "Tarjeta",
        maxLength: 40,
        placeholder: "Entregar rápido",
        default: "",
      },
    ],
    default: defaultCardRows(),
  },

  {
    kind: "toggle",
    key: "anonymous",
    label: "Respuestas anónimas",
    group: "Privacidad",
    default: true,
    help: "Se lo dice a la persona antes de empezar. El resultado nunca lleva quién ordenó qué.",
  },
  {
    kind: "toggle",
    key: "anonymousPersonal",
    label: "Forzar anónimo en el conjunto Personal",
    group: "Privacidad",
    default: true,
    help: "Es el conjunto más revelador. Proyectar con nombre que alguien puso el sueldo primero expone a una persona.",
  },

  {
    kind: "toggle",
    key: "showOwnOrder",
    label: "Mostrar tu orden al terminar",
    group: "Presentación",
    default: true,
    help: "El consenso del equipo aparece en el proyector, no en el teléfono.",
  },
  {
    kind: "number",
    key: "consensusHoldSec",
    label: "Segundos de consenso antes de la división",
    group: "Presentación",
    min: 0,
    max: 60,
    step: 1,
    unit: "s",
    default: 12,
    help: "El consenso es la antesala. Lo que abre conversación es la división, y el host también puede pasar antes con el botón.",
  },
  {
    kind: "number",
    key: "divisionHoldSec",
    label: "Segundos de división antes de terminar",
    group: "Presentación",
    min: 0,
    max: 600,
    step: 10,
    unit: "s",
    default: 0,
    help: "0 la deja en pantalla hasta que el host corte. Es donde se para la conversación: cortarla sola por reloj sería cortar la charla.",
  },
];
