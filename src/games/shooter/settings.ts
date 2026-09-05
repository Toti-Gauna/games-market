import type { SettingsSchema } from "@/core/contract/settings";

/**
 * Administrables de Supernova Arena.
 *
 * Los defaults son los de games-guide/X4-SHOOTER-3D.md. Lo que mas cambia el
 * juego es el dano por tiro —cuatro al cuerpo para matar— y el cronograma del
 * anillo, que se escala entero con la duracion de la partida.
 */
export const shooterSettings: SettingsSchema = [
  {
    kind: "number",
    key: "matchSeconds",
    label: "Duración de la partida",
    group: "Partida",
    unit: "s",
    min: 120,
    max: 480,
    step: 15,
    default: 240,
    help: "El anillo se escala con esto: a la mitad del tiempo, cierra al doble de velocidad.",
  },
  {
    kind: "number",
    key: "ringDps",
    label: "Daño fuera del anillo",
    group: "Partida",
    unit: "por segundo",
    min: 1,
    max: 15,
    step: 1,
    default: 4,
    help: "Es lo que obliga al encuentro. Muy alto y nadie llega vivo al centro.",
  },

  {
    kind: "number",
    key: "moveSpeed",
    label: "Velocidad de movimiento",
    group: "Jugador",
    unit: "u/s",
    min: 4,
    max: 10,
    step: 0.5,
    default: 6.5,
    help: "1 unidad ≈ 1 metro. Arriba de 8 el control táctil deja de alcanzar.",
  },

  {
    kind: "number",
    key: "bodyDamage",
    label: "Daño al cuerpo",
    group: "Arma",
    min: 10,
    max: 50,
    step: 5,
    default: 25,
    help: "Con 25, cuatro tiros al cuerpo matan.",
  },
  {
    kind: "number",
    key: "headDamage",
    label: "Daño a la cabeza",
    group: "Arma",
    min: 25,
    max: 100,
    step: 5,
    default: 45,
  },
  {
    kind: "number",
    key: "fireIntervalMs",
    label: "Cadencia",
    group: "Arma",
    unit: "ms",
    min: 80,
    max: 400,
    step: 10,
    default: 150,
  },
  {
    kind: "number",
    key: "magazine",
    label: "Tiros por cargador",
    group: "Arma",
    min: 6,
    max: 40,
    step: 1,
    default: 20,
  },
  {
    kind: "number",
    key: "reloadMs",
    label: "Recarga",
    group: "Arma",
    unit: "ms",
    min: 500,
    max: 3000,
    step: 100,
    default: 1200,
  },

  {
    kind: "select",
    key: "botDifficulty",
    label: "Dificultad de los bots",
    group: "Bots",
    options: [
      { value: "facil", label: "Fácil" },
      { value: "normal", label: "Normal" },
      { value: "dificil", label: "Difícil" },
    ],
    default: "normal",
    help: "Los lugares vacíos los juega un bot. Fácil apunta peor y dispara menos; difícil casi no falla.",
  },
];
