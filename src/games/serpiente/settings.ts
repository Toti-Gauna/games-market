import type { SettingsSchema } from "@/core/contract/settings";

/**
 * Administrables de Serpiente.
 *
 * Los defaults son los de games-guide/R3-SERPIENTE.md. Lo que se toque en el
 * panel se guarda aparte; cambiar un default aca sigue llegando a todos los
 * que no lo tocaron.
 */
export const snakeSettings: SettingsSchema = [
  {
    kind: "number",
    key: "startSpeed",
    label: "Velocidad inicial",
    group: "Dificultad",
    unit: "celdas/s",
    min: 3,
    max: 12,
    step: 0.5,
    default: 6,
    help: "Celdas por segundo al arrancar. Debajo de 5 se siente lenta.",
  },
  {
    kind: "number",
    key: "speedGain",
    label: "Aceleración por principio",
    group: "Dificultad",
    unit: "celdas/s",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    help: "Cuánto acelera cada vez que comés. En 0 la partida nunca se pone difícil.",
  },
  {
    kind: "number",
    key: "maxSpeed",
    label: "Velocidad máxima",
    group: "Dificultad",
    unit: "celdas/s",
    min: 6,
    max: 20,
    step: 0.5,
    default: 14,
    help: "Techo duro. Arriba de 16 el deslizar deja de llegar a tiempo.",
  },
  {
    kind: "number",
    key: "growth",
    label: "Crecimiento por principio",
    group: "Dificultad",
    unit: "segmentos",
    min: 1,
    max: 5,
    step: 1,
    default: 2,
    help: "Segmentos que suma cada principio comido.",
  },

  {
    kind: "number",
    key: "cols",
    label: "Columnas del tablero",
    group: "Tablero",
    min: 12,
    max: 32,
    step: 1,
    default: 24,
  },
  {
    kind: "number",
    key: "rows",
    label: "Filas del tablero",
    group: "Tablero",
    min: 8,
    max: 24,
    step: 1,
    default: 16,
    help: "Un tablero más chico hace partidas más cortas y más nerviosas.",
  },

  {
    kind: "number",
    key: "pointsPerPrinciple",
    label: "Puntos por principio",
    group: "Puntaje",
    min: 10,
    max: 200,
    step: 10,
    default: 50,
  },
  {
    kind: "number",
    key: "timeBonus",
    label: "Bono máximo por tiempo",
    group: "Puntaje",
    min: 0,
    max: 500,
    step: 25,
    default: 200,
    help: "Premia sobrevivir. Sin bono, la estrategia óptima es lanzarse a lo loco.",
  },

  {
    kind: "words",
    key: "principles",
    label: "Principios de la cultura",
    group: "Contenido",
    itemLabel: "Principio",
    min: 3,
    max: 24,
    default: [
      "Transparencia",
      "Foco",
      "Equipo",
      "Cliente",
      "Simpleza",
      "Coraje",
      "Aprender",
      "Cuidado",
    ],
    help: "Las palabras que la serpiente recoge. Son las que ve el jugador.",
  },
];
