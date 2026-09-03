import type { SettingsSchema } from "@/core/contract/settings";

/**
 * Administrables de Combinaciones.
 *
 * Los defaults son los de games-guide/M1-MATCH3.md. Todo lo que cambie el
 * tablero (tamano y cantidad de tipos) altera la partida de TODOS los que
 * juegan con la misma semilla, asi que se toca antes del tour, no durante.
 */
export const combinacionesSettings: SettingsSchema = [
  {
    kind: "number",
    key: "cols",
    label: "Columnas del tablero",
    group: "Tablero",
    min: 6,
    max: 10,
    step: 1,
    default: 8,
  },
  {
    kind: "number",
    key: "rows",
    label: "Filas del tablero",
    group: "Tablero",
    min: 6,
    max: 10,
    step: 1,
    default: 8,
    help: "Un tablero más chico deja menos jugadas y sube el ritmo.",
  },
  {
    kind: "number",
    key: "typeCount",
    label: "Tipos de ficha",
    group: "Tablero",
    min: 4,
    max: 6,
    step: 1,
    default: 6,
    help: "Cada tipo tiene forma y color propios. Con menos tipos, las combinaciones salen solas.",
  },

  {
    kind: "number",
    key: "pointsPerTile",
    label: "Puntos por ficha",
    group: "Puntaje",
    min: 5,
    max: 100,
    step: 5,
    default: 20,
    help: "Lo que vale cada ficha que se limpia.",
  },
  {
    kind: "number",
    key: "cascadeMultiplier",
    label: "Multiplicador de cascada",
    group: "Puntaje",
    unit: "×",
    min: 0,
    max: 1.5,
    step: 0.1,
    default: 0.5,
    help: "Cuánto suma cada cascada encadenada. En 0 pensar la jugada deja de rendir.",
  },
  {
    kind: "number",
    key: "specialPoints",
    label: "Puntos por especial usada",
    group: "Puntaje",
    min: 0,
    max: 400,
    step: 25,
    default: 150,
    help: "Premio extra cada vez que estalla un rayo, una bomba o un prisma.",
  },

  {
    kind: "toggle",
    key: "specialsEnabled",
    label: "Piezas especiales",
    group: "Piezas especiales",
    default: true,
    help: "Rayo con 4 en línea, bomba con 5 en L o T, prisma con 5 en línea.",
  },
  {
    kind: "number",
    key: "bombRadius",
    label: "Radio de la bomba",
    group: "Piezas especiales",
    unit: "celdas",
    min: 1,
    max: 3,
    step: 1,
    default: 1,
    help: "En 1 la bomba arrasa un bloque de 3×3. En 3 se lleva medio tablero.",
  },

  {
    kind: "number",
    key: "animationSpeed",
    label: "Velocidad de las animaciones",
    group: "Ritmo",
    unit: "×",
    min: 0.5,
    max: 2,
    step: 0.1,
    default: 1,
    help: "Más rápido se juegan más movimientos, pero cuesta seguir qué se movió.",
  },
  {
    kind: "number",
    key: "maxParticles",
    label: "Partículas máximas",
    group: "Rendimiento",
    min: 0,
    max: 300,
    step: 20,
    default: 220,
    help: "Bajalo si el celular no llega a 60 fps. No cambia ninguna regla.",
  },
];
