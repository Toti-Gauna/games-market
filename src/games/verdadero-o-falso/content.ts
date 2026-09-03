/**
 * Los cuatro juegos de C6, como datos.
 *
 * Las reglas de escritura de abajo no son estilo: son lo que separa un
 * verdadero-o-falso que ensena de uno que hace sentir enganado, y estan
 * verificadas en `logic.test.ts` sobre este archivo y sobre cualquier
 * contenido que se cargue desde el panel.
 *
 * 1. **90 caracteres.** La afirmacion se lee en los 2 s de lectura o no se
 *    lee. Con una ventana de 5 s, leer de mas es responder de menos.
 * 2. **Sin dobles negaciones.** "No es cierto que nunca..." es una trampa de
 *    lectura, no una pregunta.
 * 3. **Sin adverbios ambiguos** salvo a proposito. "Siempre", "nunca" y
 *    "todos" hacen que una afirmacion tecnicamente falsa se sienta injusta;
 *    cuando se usan, la explicacion lo aclara.
 * 4. **Reparto parejo y mezclado.** Cinco y cinco, con tiradas de dos como
 *    maximo: tres seguidas iguales y la sala juega al patron en vez de leer.
 * 5. **Explicacion de una linea, obligatoria.** Sin explicacion el juego no
 *    ensena nada; solo reparte puntos.
 */

export type DeckId = "seguridad" | "cultura" | "producto" | "mitos";

export type Statement = {
  id: string;
  /** Maximo `MAX_STATEMENT_LENGTH`. Es una restriccion dura, no una sugerencia. */
  text: string;
  answer: boolean;
  /** Una linea. Se muestra recien en el cierre, nunca antes. */
  explain: string;
};

export type StatementDeck = {
  id: DeckId;
  title: string;
  statements: readonly Statement[];
};

/** Lo que entra en dos segundos de lectura a tres metros de la pantalla. */
export const MAX_STATEMENT_LENGTH = 90;
/** La explicacion tiene que caber en un renglon del proyector. */
export const MAX_EXPLAIN_LENGTH = 120;
/** Tiradas de la misma respuesta permitidas seguidas. Tres ya es un patron. */
export const MAX_SAME_ANSWER_RUN = 2;

export const DECK_IDS: readonly DeckId[] = ["seguridad", "cultura", "producto", "mitos"];

/* ------------------------------------------------------------------ */

/** F V V F V F F V F V */
const SEGURIDAD: readonly Statement[] = [
  {
    id: "seg-1",
    text: "Un link de un remitente conocido siempre es seguro.",
    answer: false,
    explain: "La cuenta conocida puede estar tomada: mirá el dominio antes de tocar.",
  },
  {
    id: "seg-2",
    text: "El segundo factor protege la cuenta aunque te roben la contraseña.",
    answer: true,
    explain: "Sin el código del teléfono, la contraseña sola no alcanza para entrar.",
  },
  {
    id: "seg-3",
    text: "Reportar un correo sospechoso sirve aunque después resulte legítimo.",
    answer: true,
    explain: "Un falso positivo cuesta un minuto; un phishing sin reportar cuesta semanas.",
  },
  {
    id: "seg-4",
    text: "Compartir la contraseña con el equipo agiliza el trabajo.",
    answer: false,
    explain: "Lo que se hace con tu usuario queda a tu nombre: se comparte el acceso, no la clave.",
  },
  {
    id: "seg-5",
    text: "Bloquear la pantalla al dejar el escritorio es parte del protocolo.",
    answer: true,
    explain: "Son dos teclas contra un incidente que se explica en una reunión larga.",
  },
  {
    id: "seg-6",
    text: "Una planilla adjunta no puede ejecutar código en tu máquina.",
    answer: false,
    explain: "Las macros son código: por eso vienen bloqueadas hasta que alguien las habilita.",
  },
  {
    id: "seg-7",
    text: "La WiFi abierta del aeropuerto alcanza para entrar al panel interno.",
    answer: false,
    explain: "En una red abierta el tráfico se puede leer: primero la VPN, después el panel.",
  },
  {
    id: "seg-8",
    text: "Un pedido urgente de transferencia por chat conviene verificarlo aparte.",
    answer: true,
    explain: "La urgencia es la herramienta del estafador: llamá al número que ya tenías.",
  },
  {
    id: "seg-9",
    text: "Guardar las claves en un archivo de la compu equivale a usar un gestor.",
    answer: false,
    explain: "El archivo se copia entero en un segundo; el gestor cifra y pide clave maestra.",
  },
  {
    id: "seg-10",
    text: "Un USB que aparece en la oficina se entrega, no se conecta.",
    answer: true,
    explain: "Es una técnica vieja y sigue funcionando: el USB puede hacerse pasar por teclado.",
  },
];

/** V F F V F V V F V F */
const CULTURA: readonly Statement[] = [
  {
    id: "cul-1",
    text: "Una reunión sin agenda escrita se puede rechazar sin pedir permiso.",
    answer: true,
    explain: "La agenda es el mínimo para que la reunión valga la hora de cada uno.",
  },
  {
    id: "cul-2",
    text: "Las vacaciones se piden con tres meses de anticipación.",
    answer: false,
    explain: "El acuerdo real es avisar con dos semanas y coordinar con el equipo.",
  },
  {
    id: "cul-3",
    text: "El feedback lo da quien está más arriba en el organigrama.",
    answer: false,
    explain: "Acá el feedback va en las dos direcciones y se pide tanto como se da.",
  },
  {
    id: "cul-4",
    text: "Escribir la decisión en un documento es parte de tomarla.",
    answer: true,
    explain: "Lo que no queda escrito se vuelve a discutir en la reunión siguiente.",
  },
  {
    id: "cul-5",
    text: "Contestar mensajes fuera de horario suma en la evaluación.",
    answer: false,
    explain: "Se evalúa el resultado, no la hora del mensaje.",
  },
  {
    id: "cul-6",
    text: "Cualquiera puede proponer un tema para la reunión general.",
    answer: true,
    explain: "El formulario está abierto todo el mes y se responden todos los temas.",
  },
  {
    id: "cul-7",
    text: "Un error contado a tiempo se trata como información, no como falta.",
    answer: true,
    explain: "Esconder un error siempre sale más caro que el error.",
  },
  {
    id: "cul-8",
    text: "El horario de entrada es idéntico para todas las áreas.",
    answer: false,
    explain: "Hay bandas por área; lo que se comparte es la franja de solapamiento.",
  },
  {
    id: "cul-9",
    text: "Pedir ayuda después de dos horas trabado es lo que se espera.",
    answer: true,
    explain: "Dos horas trabado es una señal del problema, no una falta de esfuerzo.",
  },
  {
    id: "cul-10",
    text: "Los objetivos del trimestre los define cada jefe por su cuenta.",
    answer: false,
    explain: "Se acuerdan entre equipo y liderazgo, y quedan públicos para todos.",
  },
];

/** V V F F V F V F V F */
const PRODUCTO: readonly Statement[] = [
  {
    id: "pro-1",
    text: "El cliente puede exportar sus datos sin pedirle nada a soporte.",
    answer: true,
    explain: "La exportación vive en Ajustes y sale en CSV.",
  },
  {
    id: "pro-2",
    text: "El plan base incluye las actualizaciones sin costo extra.",
    answer: true,
    explain: "Las mejoras entran para todos los planes el mismo día.",
  },
  {
    id: "pro-3",
    text: "La plataforma reemplaza al sistema contable de la empresa.",
    answer: false,
    explain: "Se integra con el contable; no lo reemplaza.",
  },
  {
    id: "pro-4",
    text: "Cada usuario nuevo necesita una instalación en su computadora.",
    answer: false,
    explain: "Corre en el navegador: alcanza con la invitación por correo.",
  },
  {
    id: "pro-5",
    text: "Se puede probar la plataforma sin cargar una tarjeta.",
    answer: true,
    explain: "La prueba dura catorce días y no pide medio de pago.",
  },
  {
    id: "pro-6",
    text: "El soporte atiende únicamente por teléfono.",
    answer: false,
    explain: "El canal principal es el chat; el teléfono queda para casos críticos.",
  },
  {
    id: "pro-7",
    text: "Los permisos se pueden definir por equipo y no sólo por persona.",
    answer: true,
    explain: "El rol se asigna al equipo y lo hereda cada integrante.",
  },
  {
    id: "pro-8",
    text: "Los datos se borran del todo apenas se cancela la cuenta.",
    answer: false,
    explain: "Quedan treinta días de gracia para recuperarlos antes del borrado.",
  },
  {
    id: "pro-9",
    text: "La plataforma guarda un historial de cambios por registro.",
    answer: true,
    explain: "Cada edición queda con autor y fecha en la pestaña Historial.",
  },
  {
    id: "pro-10",
    text: "Conectar la plataforma con otras herramientas se paga aparte.",
    answer: false,
    explain: "Las integraciones estándar y la API están incluidas en todos los planes.",
  },
];

/** F V F F V V F V F V */
const MITOS: readonly Statement[] = [
  {
    id: "mit-1",
    text: "Sumar gente a un proyecto atrasado lo acelera.",
    answer: false,
    explain: "Ley de Brooks: cada persona nueva suma coordinación antes que trabajo.",
  },
  {
    id: "mit-2",
    text: "Una reunión de pie tiende a durar menos que una sentada.",
    answer: true,
    explain: "La incomodidad leve funciona de reloj: es el motivo del formato.",
  },
  {
    id: "mit-3",
    text: "Trabajar más horas seguidas sostiene la calidad de las decisiones.",
    answer: false,
    explain: "La calidad cae bastante antes que las ganas de seguir.",
  },
  {
    id: "mit-4",
    text: "Hacer varias tareas a la vez rinde más que hacerlas de a una.",
    answer: false,
    explain: "Cada cambio de contexto cuesta minutos que no se ven en la agenda.",
  },
  {
    id: "mit-5",
    text: "Escribir el problema antes que la solución acorta la discusión.",
    answer: true,
    explain: "Si el problema no está claro, cada uno defiende una solución distinta.",
  },
  {
    id: "mit-6",
    text: "Un prototipo feo y temprano ahorra rehacer el diseño después.",
    answer: true,
    explain: "Se descarta rápido lo que no funciona, cuando todavía es barato.",
  },
  {
    id: "mit-7",
    text: "El mejor equipo es el que no discute.",
    answer: false,
    explain: "Los equipos sanos discuten ideas; lo que evitan es discutir personas.",
  },
  {
    id: "mit-8",
    text: "Estimar en rangos es más útil que estimar con un número exacto.",
    answer: true,
    explain: "El rango transmite la incertidumbre en vez de esconderla.",
  },
  {
    id: "mit-9",
    text: "Los usuarios saben decir qué función les falta.",
    answer: false,
    explain: "Saben describir el problema; la función la propone el equipo.",
  },
  {
    id: "mit-10",
    text: "Una métrica bien elegida decide mejor que un tablero de veinte.",
    answer: true,
    explain: "Veinte métricas sin jerarquía dejan la decisión igual de difícil.",
  },
];

export const DECKS: Readonly<Record<DeckId, StatementDeck>> = {
  seguridad: { id: "seguridad", title: "Seguridad de la información", statements: SEGURIDAD },
  cultura: { id: "cultura", title: "Cultura y prácticas", statements: CULTURA },
  producto: { id: "producto", title: "El producto", statements: PRODUCTO },
  mitos: { id: "mitos", title: "Mitos del rubro", statements: MITOS },
};

export function isDeckId(value: unknown): value is DeckId {
  return typeof value === "string" && (DECK_IDS as readonly string[]).includes(value);
}
