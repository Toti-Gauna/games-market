import type { SettingsSchema } from "@/core/contract/settings";

/**
 * Administrables de Ludo.
 *
 * Los defaults son los tres recortes de games-guide/X3-LUDO.md, y no son
 * arbitrarios: un parchis normal dura de 30 a 60 minutos y una pantalla de
 * tour tiene 8 o 10. Dos fichas en vez de cuatro, 32 casillas en vez de 52 y
 * salir con 6 o 5 en vez de solo con 6 dejan una partida de 4 en 8 a 10
 * minutos sin dejar de ser Ludo.
 *
 * Estan expuestos igual porque un evento largo puede querer la version de 48
 * casillas, y porque el panel es la unica forma de probar un balance sin
 * recompilar.
 */
export const ludoSettings: SettingsSchema = [
  {
    kind: "number",
    key: "tokensPerPlayer",
    label: "Fichas por jugador",
    group: "Tablero",
    min: 1,
    max: 4,
    step: 1,
    default: 2,
    help: "Dos, no cuatro: menos micro-decisiones y la misma tensión. Con 4 la partida se va a 30 minutos.",
  },
  {
    kind: "number",
    key: "trackLength",
    label: "Casillas del recorrido",
    group: "Tablero",
    unit: "casillas",
    min: 24,
    max: 48,
    step: 8,
    default: 32,
    help: "Comunes a los cuatro colores. Con 32, una vuelta completa son ~11 tiradas. Va de a 8 porque el tablero en cruz necesita un número par de casillas por brazo.",
  },
  {
    kind: "select",
    key: "entryRolls",
    label: "Se sale de casa con",
    group: "Tablero",
    options: [
      { value: "6", label: "Sólo con 6 (clásico, lento)" },
      { value: "56", label: "Con 6 o 5" },
      { value: "456", label: "Con 6, 5 o 4 (arranque exprés)" },
    ],
    default: "56",
    help: "Esperar un 6 es lo más aburrido del original. Con 5 también, la partida arranca enseguida.",
  },

  {
    kind: "number",
    key: "turnSeconds",
    label: "Segundos por turno",
    group: "Ritmo",
    unit: "s",
    min: 5,
    max: 40,
    step: 1,
    default: 15,
    help: "Al agotarse se juega solo el mejor movimiento, o se pasa. Un turno sin límite es una persona distraída frenando a tres.",
  },
  {
    kind: "toggle",
    key: "extraRoll",
    label: "Tirada extra al sacar 6 o al capturar",
    group: "Ritmo",
    default: true,
    help: "Apagarlo hace la partida más pareja y más lenta. Hay un tope de dos extras por turno, así que tres seises no son infinitos.",
  },
  {
    kind: "select",
    key: "botSkill",
    label: "Dificultad del bot",
    group: "Ritmo",
    options: [
      { value: "calmo", label: "Calmo · elige al azar" },
      { value: "normal", label: "Normal · captura, mete, saca, avanza" },
      { value: "filoso", label: "Filoso · además busca casilla segura" },
    ],
    default: "normal",
    help: "Un bot de Ludo demasiado bueno frustra sin aportar: la mayor parte del juego es el dado.",
  },

  {
    kind: "number",
    key: "pointsPerStep",
    label: "Puntos por casilla avanzada",
    group: "Puntos",
    min: 0,
    max: 40,
    step: 1,
    default: 10,
    help: "Suma las dos fichas. Que el avance puntúe hace que quien pierde igual se lleve un número que refleja cómo le fue.",
  },
  {
    kind: "number",
    key: "pointsPerCapture",
    label: "Puntos por captura",
    group: "Puntos",
    min: 0,
    max: 600,
    step: 10,
    default: 150,
  },
  {
    kind: "number",
    key: "pointsPerToken",
    label: "Puntos por ficha en la meta",
    group: "Puntos",
    min: 0,
    max: 1200,
    step: 25,
    default: 400,
  },
  {
    kind: "number",
    key: "pointsWin",
    label: "Puntos por ganar la partida",
    group: "Puntos",
    min: 0,
    max: 2000,
    step: 50,
    default: 500,
    help: "En un juego con tanta suerte un puntaje binario sería injusto: el bono de victoria es chico al lado del avance.",
  },
];
