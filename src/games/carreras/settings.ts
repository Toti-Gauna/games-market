import type { SettingsSchema } from "@/core/contract/settings";
import { TRACKS } from "./track";

/**
 * Administrables de Supernova Rush.
 *
 * El grupo "Manejo" va primero porque es donde esta el juego: un auto que se
 * siente mal no se arregla despues con arte. `grip` y `offTrack` son los dos
 * numeros que se tocan en vivo cuando alguien dice "patina de mas" o "el pasto
 * no castiga".
 *
 * `fov` no toca la fisica: es el campo de vision del Mode 7. Abrirlo da mas
 * sensacion de velocidad a la misma velocidad real, y encima deja ver mas
 * pista antes de la curva.
 */
export const carrerasSettings: SettingsSchema = [
  /* --- Manejo -------------------------------------------------------- */
  {
    key: "accel",
    kind: "number",
    label: "Aceleración",
    help: "Unidades por segundo al cuadrado. La curva es asintótica: rápido al principio, lento al final.",
    group: "Manejo",
    min: 60,
    max: 400,
    step: 10,
    unit: "u/s²",
    default: 170,
  },
  {
    key: "maxSpeed",
    kind: "number",
    label: "Velocidad máxima",
    help: "Con turbo se pasa un 45 % de este techo. Arriba de 130 la vuelta baja de 15 segundos y deja de haber carrera.",
    group: "Manejo",
    min: 50,
    max: 160,
    step: 5,
    unit: "u/s",
    default: 100,
  },
  {
    key: "grip",
    kind: "number",
    label: "Agarre en curva",
    help: "Cuánto persigue el movimiento al morro. En 1 el auto va donde apunta; abajo de 0,6 desliza en toda curva.",
    group: "Manejo",
    min: 0.4,
    max: 1.4,
    step: 0.05,
    default: 1,
  },
  {
    key: "offTrack",
    kind: "number",
    label: "Techo fuera de pista",
    help: "Fracción de la velocidad máxima en el pasto. Salirse frena fuerte, pero nunca descalifica.",
    group: "Manejo",
    min: 0.25,
    max: 0.95,
    step: 0.05,
    default: 0.6,
  },

  /* --- Carrera ------------------------------------------------------- */
  {
    key: "track",
    kind: "select",
    label: "Circuito",
    help: "Todos corren el mismo: es lo que hace comparables los tiempos del ranking.",
    group: "Carrera",
    options: TRACKS.map((track) => ({ value: track.id, label: track.name })),
    default: "nova",
  },
  {
    key: "laps",
    kind: "number",
    label: "Vueltas",
    help: "Tres vueltas dan entre 90 y 120 segundos de partida, que es el objetivo.",
    group: "Carrera",
    min: 1,
    max: 9,
    step: 1,
    default: 3,
  },
  {
    key: "rivals",
    kind: "number",
    label: "Rivales de IA",
    help: "No compiten por el puntaje: están para dar referencia de velocidad y para que la pista no se sienta vacía.",
    group: "Carrera",
    min: 0,
    max: 7,
    step: 1,
    default: 5,
  },
  {
    key: "aiSkill",
    kind: "number",
    label: "Dificultad de la IA",
    help: "Fracción de la velocidad máxima que persiguen. En 1 andan como un buen piloto.",
    group: "Carrera",
    min: 0.4,
    max: 1.1,
    step: 0.05,
    default: 0.9,
  },
  {
    key: "targetMs",
    kind: "number",
    label: "Tiempo de referencia",
    help: "El puntaje sale de comparar contra este tiempo. Afinarlo cuando el circuito esté rodado.",
    group: "Carrera",
    min: 30000,
    max: 240000,
    step: 5000,
    unit: "ms",
    default: 95000,
  },

  /* --- Cámara y control ---------------------------------------------- */
  {
    key: "fov",
    kind: "number",
    label: "Campo de visión",
    help: "Grados de apertura del Mode 7. Más abierto se ve más pista y se siente más rápido; arriba de 85 deforma.",
    group: "Cámara",
    min: 50,
    max: 90,
    step: 1,
    unit: "°",
    default: 70,
  },
  {
    key: "tiltRange",
    kind: "number",
    label: "Rango de inclinación",
    help: "Grados desde el cero calibrado hasta el volante al tope. Más rango, control más suave.",
    group: "Cámara",
    min: 10,
    max: 45,
    step: 1,
    unit: "°",
    default: 22,
  },
];
