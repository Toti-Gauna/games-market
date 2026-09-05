import type { SettingsSchema } from "@/core/contract/settings";

/**
 * Administrables de Espacio.
 *
 * Lo unico que importa de verdad es el contenido de las estaciones: sin
 * estaciones es un lobby bonito, con estaciones es un stand recorrible. Por
 * eso entran como registros editables, no como constantes en el codigo.
 */
export const metaversoSettings: SettingsSchema = [
  {
    kind: "records",
    key: "stations",
    label: "Estaciones",
    group: "Contenido",
    titleKey: "title",
    min: 0,
    max: 8,
    help: "Una por zona, en la pared. Al acercarse se abre el contenido en el celular.",
    fields: [
      { kind: "text", key: "title", label: "Título", maxLength: 40, default: "" },
      {
        kind: "text",
        key: "body",
        label: "Contenido",
        multiline: true,
        maxLength: 400,
        default: "",
      },
    ],
    default: [
      { title: "Quiénes somos", body: "Un equipo distribuido que se junta pocas veces al año. Este espacio es una de esas veces." },
      { title: "Lo que hacemos", body: "Producto, clientes y el problema que resolvemos, contado en tres frases." },
      { title: "Hitos del año", body: "Lo que salió, lo que se lanzó y lo que aprendimos en el camino." },
      { title: "Principios", body: "Transparencia, foco, equipo, cliente, simpleza, coraje, aprender, cuidado." },
      { title: "Lo que viene", body: "El trimestre que arranca y qué esperamos de él." },
      { title: "Personas", body: "Quién es quién, y a quién buscar para cada cosa." },
    ],
  },

  {
    kind: "number",
    key: "sessionMinutes",
    label: "Duración del espacio",
    group: "Sesión",
    unit: "min",
    min: 0,
    max: 60,
    step: 5,
    default: 0,
    help: "0 = abierto hasta que se cierre a mano. Con tiempo, avisa un minuto antes.",
  },
  {
    kind: "toggle",
    key: "showNames",
    label: "Nombres sobre los avatares",
    group: "Presentación",
    default: true,
    help: "Apagado, se ven solo los colores. Sirve cuando hay más de veinte personas.",
  },
];
