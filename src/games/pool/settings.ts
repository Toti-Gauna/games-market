import type { SettingsSchema } from "@/core/contract/settings";

/**
 * Administrables de Pool.
 *
 * Casi todo lo que decide como se siente el juego —restitucion, friccion,
 * paso del solver— NO esta aca: vive en `PHYSICS` de `logic.ts`, porque son
 * las proporciones de un pool real y tocarlas no es configurar, es romper.
 *
 * Lo que si se expone es lo que un evento necesita ajustar sin recompilar: el
 * ritmo de los turnos y las dos ayudas que separan una partida entre gente
 * que juega al pool de una entre gente que no.
 */
export const poolSettings: SettingsSchema = [
  {
    kind: "number",
    key: "turnSeconds",
    label: "Segundos por turno",
    group: "Ritmo",
    unit: "s",
    min: 20,
    max: 90,
    step: 5,
    default: 45,
    help: "Al vencer se ejecuta un tiro automático suave. Nunca se deja la mesa trabada esperando a alguien.",
  },
  {
    kind: "toggle",
    key: "aimLine",
    label: "Línea de tiro proyectada",
    group: "Ayudas",
    default: true,
    help: "Muestra la trayectoria de la blanca y hacia dónde sale la bola golpeada. Sin ella el juego es adivinar; apagala sólo para una mesa de gente que juega.",
  },
  {
    kind: "toggle",
    key: "spin",
    label: "Efecto vertical",
    group: "Ayudas",
    default: true,
    help: "Corrida y retroceso. Sin efecto el pool es plano, pero apagarlo simplifica el mando para una sala que nunca jugó.",
  },
];
