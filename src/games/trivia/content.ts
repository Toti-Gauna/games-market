/**
 * Los cuatro cuestionarios de C1, como datos.
 *
 * Son defaults: el panel de administrables los edita enteros sin tocar codigo,
 * y un cliente que quiere los suyos reescribe las cuarenta filas. Estan aca y
 * no adentro de `settings.ts` porque son contenido, no schema: se leen, se
 * corrigen y se traducen sin entender una linea de TypeScript.
 *
 * Reglas de escritura, que son las que hacen que la trivia sirva y no solo
 * entretenga:
 *
 * - Enunciado de MENOS de 120 caracteres: tiene que leerse desde el fondo de
 *   la sala en los 3 segundos de lectura.
 * - Opciones de MENOS de 40: cuatro botones en un telefono, sin scroll.
 * - Una sola respuesta defendible. En una trivia la ambiguedad es un defecto,
 *   al reves que en un test de perfil.
 * - Explicacion de UNA linea, obligatoria. Es el momento en que el juego
 *   ensena algo, y es toda la diferencia entre entretener y capacitar.
 * - Sin preguntas capciosas ni de memoria de fechas: miden atencion al
 *   detalle, no conocimiento.
 *
 * `logic.test.ts` verifica los dos limites de caracteres y la explicacion, asi
 * que una pregunta nueva que se pase rompe los tests antes de llegar al
 * proyector.
 */

/** Los ids los fija la spec de C1. Se usan como valor del select y como clave del contenido. */
export const TRIVIA_QUIZ_IDS = ["cultura", "seguridad", "producto", "mixto"] as const;

export type TriviaQuizId = (typeof TRIVIA_QUIZ_IDS)[number];

export type TriviaQuestionSeed = {
  /** Estable: si se renumeran las preguntas, el contenido guardado se despega. */
  id: string;
  prompt: string;
  /** Siempre cuatro: son los cuatro botones del telefono. */
  options: readonly [string, string, string, string];
  /** Indice 0..3 de la unica defendible. */
  correct: 0 | 1 | 2 | 3;
  /** Una linea. Se proyecta al cerrar, junto a la correcta. */
  explanation: string;
};

export type TriviaQuizSeed = {
  id: TriviaQuizId;
  title: string;
  /** Una linea para el panel: de que se trata y para que evento sirve. */
  description: string;
  questions: readonly TriviaQuestionSeed[];
};

/* ------------------------------------------------------------------ */
/* Cultura — valores, historia y forma de trabajo                       */
/* ------------------------------------------------------------------ */

const CULTURE: TriviaQuizSeed = {
  id: "cultura",
  title: "Cultura",
  description: "Valores, historia y forma de trabajo. Para onboarding y jornadas de equipo.",
  questions: [
    {
      id: "cul1",
      prompt: "¿Cómo se toma una decisión que afecta a dos equipos?",
      options: [
        "La define quien tiene más antigüedad",
        "La define el equipo más grande",
        "Se decide con los dos equipos juntos",
        "Se posterga al próximo trimestre",
      ],
      correct: 2,
      explanation: "Lo que afecta a dos equipos se decide con los dos presentes, no por jerarquía.",
    },
    {
      id: "cul2",
      prompt: "Encontrás un error tuyo que todavía nadie notó. ¿Qué hacés?",
      options: [
        "Lo avisás apenas lo ves",
        "Lo arreglás sin contarlo",
        "Esperás a que alguien lo note",
        "Lo anotás para la retro",
      ],
      correct: 0,
      explanation: "Un error avisado temprano cuesta una charla; avisado tarde, cuesta el doble.",
    },
    {
      id: "cul3",
      prompt: "Alguien pide ayuda con algo que no es tu tarea. ¿Qué se espera?",
      options: [
        "Que lo derives a su jefe",
        "Que lo escuches y lo orientes",
        "Que respondas cuando termines todo",
        "Que le pidas abrir un ticket",
      ],
      correct: 1,
      explanation: "Destrabar a otro es parte del trabajo, no una interrupción del trabajo.",
    },
    {
      id: "cul4",
      prompt: "¿Para qué sirve una retrospectiva?",
      options: [
        "Para buscar culpables de lo que falló",
        "Para repasar el presupuesto",
        "Para informar novedades de dirección",
        "Para mejorar cómo trabajamos la próxima",
      ],
      correct: 3,
      explanation: "La retro mira el proceso y el próximo cambio, nunca a la persona que falló.",
    },
    {
      id: "cul5",
      prompt: "¿Qué hace que una reunión valga la pena?",
      options: [
        "Que asista todo el equipo",
        "Que tenga objetivo y cierre con acuerdo",
        "Que dure menos de una hora",
        "Que quede grabada",
      ],
      correct: 1,
      explanation: "Sin objetivo y sin acuerdos, una reunión es una charla cara.",
    },
    {
      id: "cul6",
      prompt: "¿Cómo se da un feedback que sirva?",
      options: [
        "En público, para que aprendan todos",
        "Una vez al año, en la evaluación",
        "En privado, concreto y cerca del hecho",
        "Por escrito y sin ejemplos",
      ],
      correct: 2,
      explanation: "Privado, concreto y cerca del hecho: lo demás se escucha como un reproche.",
    },
    {
      id: "cul7",
      prompt: "Entra alguien nuevo al equipo. ¿Qué le damos el primer día?",
      options: [
        "Acceso a todos los sistemas",
        "El plan del año completo",
        "Una semana de lectura",
        "Un referente y una primera tarea chica",
      ],
      correct: 3,
      explanation: "Un referente y una tarea que se pueda terminar dan pertenencia más rápido.",
    },
    {
      id: "cul8",
      prompt: "¿Qué quiere decir que un proyecto es transversal?",
      options: [
        "Que lo trabajan varias áreas juntas",
        "Que dura más de un año",
        "Que lo aprueba la dirección",
        "Que no tiene presupuesto propio",
      ],
      correct: 0,
      explanation: "Transversal es que cruza áreas: nadie lo termina solo.",
    },
    {
      id: "cul9",
      prompt: "¿Cuándo se comparte un avance con el resto del equipo?",
      options: [
        "Cuando está terminado y probado",
        "Apenas hay algo que se pueda mostrar",
        "Sólo si alguien lo pide",
        "En la reunión de cierre de año",
      ],
      correct: 1,
      explanation: "Mostrar temprano corrige temprano: un avance a medias todavía se puede cambiar.",
    },
    {
      id: "cul10",
      prompt: "Una entrega tuya se va a atrasar. ¿Qué se espera?",
      options: [
        "Trabajar de noche para llegar igual",
        "Avisar el día de la entrega",
        "Bajar el alcance sin avisar",
        "Avisar apenas se sabe, con fecha nueva",
      ],
      correct: 3,
      explanation: "Un atraso avisado a tiempo se reorganiza; avisado el último día, ya es un problema.",
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Seguridad — phishing, contrasenas, datos sensibles                   */
/* ------------------------------------------------------------------ */

const SECURITY: TriviaQuizSeed = {
  id: "seguridad",
  title: "Seguridad de la información",
  description: "Phishing, contraseñas y datos sensibles. Para capacitación anual.",
  questions: [
    {
      id: "sec1",
      prompt: "Un mail del banco pide confirmar tu clave por un enlace. ¿Qué hacés?",
      options: [
        "Confirmás desde el enlace",
        "No lo abrís y lo reportás",
        "Respondés pidiendo más datos",
        "Se lo reenviás al equipo",
      ],
      correct: 1,
      explanation: "Ningún banco ni área interna pide una clave por mail: eso sólo lo hace un ataque.",
    },
    {
      id: "sec2",
      prompt: "¿Qué es lo que más fuerte hace a una contraseña?",
      options: [
        "Que termine con un símbolo",
        "Que se cambie todos los meses",
        "Que sea larga y no se repita",
        "Que mezcle nombres y números",
      ],
      correct: 2,
      explanation: "El largo y no repetirla pesan más que cualquier símbolo raro al final.",
    },
    {
      id: "sec3",
      prompt: "¿Para qué sirve el segundo factor de autenticación?",
      options: [
        "Protege la cuenta aunque roben la clave",
        "Hace más rápido el ingreso",
        "Reemplaza la contraseña",
        "Encripta los archivos del equipo",
      ],
      correct: 0,
      explanation: "El segundo factor es lo que salva la cuenta el día que la clave se filtra.",
    },
    {
      id: "sec4",
      prompt: "Un compañero te pide tu usuario para entrar a un sistema.",
      options: [
        "Se lo prestás sólo por hoy",
        "Le pasás la clave por chat",
        "Le pasás la clave por teléfono",
        "Le pedís que solicite su propio acceso",
      ],
      correct: 3,
      explanation: "Una cuenta prestada borra el rastro de quién hizo qué, y eso no se reconstruye.",
    },
    {
      id: "sec5",
      prompt: "¿Dónde se guarda un archivo con datos personales de clientes?",
      options: [
        "En el escritorio de tu máquina",
        "En el repositorio autorizado",
        "En tu correo personal",
        "En un pendrive propio",
      ],
      correct: 1,
      explanation: "Los datos personales viven donde hay control de acceso y respaldo, no en tu escritorio.",
    },
    {
      id: "sec6",
      prompt: "¿Cuál es la señal más constante de un intento de phishing?",
      options: [
        "Que llegue fuera de horario",
        "Que tenga un archivo adjunto",
        "Que te apure con una urgencia",
        "Que venga en inglés",
      ],
      correct: 2,
      explanation: "La urgencia inventada es la señal más constante: te apura para que no pienses.",
    },
    {
      id: "sec7",
      prompt: "Te levantás del escritorio cinco minutos. ¿Y la máquina?",
      options: [
        "La bloqueás",
        "La dejás abierta",
        "Cerrás sólo el navegador",
        "Apagás la pantalla",
      ],
      correct: 0,
      explanation: "Cinco minutos alcanzan para que alguien mande un mail con tu nombre.",
    },
    {
      id: "sec8",
      prompt: "Creés que hiciste clic en un enlace malicioso. ¿Qué hacés?",
      options: [
        "Esperás a ver si pasa algo",
        "Reiniciás y seguís trabajando",
        "Borrás el mail y listo",
        "Avisás enseguida al equipo de seguridad",
      ],
      correct: 3,
      explanation: "Reportar rápido es lo que corta el daño; esconderlo sólo le da tiempo al ataque.",
    },
    {
      id: "sec9",
      prompt: "¿Cómo se comparte un documento confidencial con alguien de afuera?",
      options: [
        "Adjunto por mail",
        "Con enlace restringido y vencimiento",
        "Con un enlace público",
        "Por mensajería personal",
      ],
      correct: 1,
      explanation: "Un enlace con permiso y vencimiento se puede cortar; un adjunto ya no vuelve.",
    },
    {
      id: "sec10",
      prompt: "¿Dónde conviene guardar las contraseñas del trabajo?",
      options: [
        "En una planilla con clave",
        "En el cuaderno del escritorio",
        "En el gestor aprobado por la empresa",
        "En el navegador de tu casa",
      ],
      correct: 2,
      explanation: "El gestor aprobado guarda una clave distinta por sitio sin que tengas que recordarlas.",
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Producto — que hace y para quien                                     */
/* ------------------------------------------------------------------ */

const PRODUCT: TriviaQuizSeed = {
  id: "producto",
  title: "Producto",
  description: "Qué hace el producto y para quién. Para equipos comerciales y gente nueva.",
  questions: [
    {
      id: "pro1",
      prompt: "¿Para qué sirve la plataforma?",
      options: [
        "Para jugar juegos cortos en un evento",
        "Para gestionar recursos humanos",
        "Para facturar clientes",
        "Para editar video",
      ],
      correct: 0,
      explanation: "Es una sala jugando junta: juegos cortos pensados para un evento presencial.",
    },
    {
      id: "pro2",
      prompt: "¿Cómo se suma alguien a una partida?",
      options: [
        "Instalando una app",
        "Escaneando el QR de la sala",
        "Creando un usuario",
        "Pidiendo una licencia",
      ],
      correct: 1,
      explanation: "Un QR y nada más: si hay que instalar algo, la mitad de la sala no juega.",
    },
    {
      id: "pro3",
      prompt: "En la trivia, ¿dónde se muestra la pregunta?",
      options: ["En el celular", "En las dos pantallas", "En el proyector", "En ninguna"],
      correct: 2,
      explanation: "La pregunta va arriba para que la sala levante la vista; el celular es el control.",
    },
    {
      id: "pro4",
      prompt: "¿Qué necesita una persona para jugar?",
      options: [
        "Un celular con navegador",
        "Una notebook",
        "Un joystick",
        "Un lector de QR aparte",
      ],
      correct: 0,
      explanation: "Corre en el navegador del teléfono: sin instalar nada y sin crear una cuenta.",
    },
    {
      id: "pro5",
      prompt: "¿Quién calcula el puntaje de una partida?",
      options: ["Cada celular", "Un servidor externo", "El organizador", "El proyector"],
      correct: 3,
      explanation: "El puntaje lo calcula el proyector: si lo dijera el celular, cualquiera ganaría.",
    },
    {
      id: "pro6",
      prompt: "¿Cuánto dura una partida típica?",
      options: ["Treinta segundos", "Entre cinco y diez minutos", "Una hora", "Todo el evento"],
      correct: 1,
      explanation: "Partidas cortas: entran varias en un evento y la sala no se cansa.",
    },
    {
      id: "pro7",
      prompt: "¿Qué se puede cambiar sin tocar código?",
      options: [
        "El motor de red",
        "La topología del juego",
        "Las preguntas y los tiempos",
        "Nada",
      ],
      correct: 2,
      explanation: "Contenido y tiempos son administrables: cada cliente escribe los suyos.",
    },
    {
      id: "pro8",
      prompt: "¿Para quién está pensada la plataforma?",
      options: [
        "Para equipos en un evento presencial",
        "Para jugar solo en casa",
        "Para torneos profesionales",
        "Para chicos en edad escolar",
      ],
      correct: 0,
      explanation: "Está pensada para una sala compartida, no para jugar solo en el sillón.",
    },
    {
      id: "pro9",
      prompt: "Alguien entra cuando la partida ya empezó. ¿Qué pasa?",
      options: [
        "Queda afuera hasta la próxima",
        "Se reinicia la partida",
        "Entra con el puntaje promedio",
        "Juega desde la pregunta siguiente",
      ],
      correct: 3,
      explanation: "Entra en la próxima: dejarlo contestar la que ya empezó le daría menos tiempo.",
    },
    {
      id: "pro10",
      prompt: "¿Qué hace falta para proyectar una partida?",
      options: [
        "Una pantalla y la misma red",
        "Un servidor propio",
        "Una licencia por persona",
        "Conexión de fibra",
      ],
      correct: 0,
      explanation: "Una pantalla y la misma red alcanzan: el proyector hace de anfitrión.",
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Mixto — las tres, para eventos generales                             */
/* ------------------------------------------------------------------ */

const MIXED: TriviaQuizSeed = {
  id: "mixto",
  title: "Mixto",
  description: "Las tres materias juntas. Es el que conviene en un evento general.",
  questions: [
    {
      id: "mix1",
      prompt: "¿Qué tiene que dejar por escrito una reunión?",
      options: [
        "Todo lo que se dijo",
        "Decisiones, responsables y fechas",
        "Sólo los temas pendientes",
        "La grabación completa",
      ],
      correct: 1,
      explanation: "Decisión, responsable y fecha: un acta más larga que eso no la lee nadie.",
    },
    {
      id: "mix2",
      prompt: "Un mensaje urgente de tu jefe pide comprar tarjetas de regalo.",
      options: [
        "Las comprás y avisás después",
        "Respondés el mensaje pidiendo detalles",
        "Verificás por otro canal antes",
        "Le pedís el número de factura",
      ],
      correct: 2,
      explanation: "Urgencia más canal raro es el fraude más común: verificá por otra vía.",
    },
    {
      id: "mix3",
      prompt: "¿Qué pasa con una respuesta que llega después del cierre?",
      options: [
        "Se descarta y el celular lo avisa",
        "Suma la mitad de los puntos",
        "Suma igual que las demás",
        "Reinicia la pregunta",
      ],
      correct: 0,
      explanation: "Se descarta, y se dice: un cierre que perdona no cierra nada.",
    },
    {
      id: "mix4",
      prompt: "¿Qué NO se comparte por chat de trabajo?",
      options: [
        "Links de reunión",
        "Fechas de entrega",
        "Notas de una retro",
        "Claves y datos de clientes",
      ],
      correct: 3,
      explanation: "Claves y datos de clientes viajan por canales con control de acceso, nunca por chat.",
    },
    {
      id: "mix5",
      prompt: "Todo el tablero está marcado como urgente. ¿Cómo priorizás?",
      options: [
        "Por orden de pedido",
        "Por impacto y fecha real",
        "Por quién lo pidió",
        "Por lo que salga más rápido",
      ],
      correct: 1,
      explanation: "Impacto y fecha real: un urgente sin fecha es una opinión, no una prioridad.",
    },
    {
      id: "mix6",
      prompt: "¿Qué hace que un juego funcione en un evento de empresa?",
      options: [
        "Premios caros",
        "Muchos jugadores",
        "Partidas cortas y reglas claras",
        "Una app instalada",
      ],
      correct: 2,
      explanation: "Corto y claro: si hay que explicar dos minutos, la sala ya se dispersó.",
    },
    {
      id: "mix7",
      prompt: "¿Qué se hace con un dato personal que ya no se usa?",
      options: [
        "Se guarda por las dudas",
        "Se copia a un pendrive",
        "Se archiva en el mail",
        "Se borra según la política",
      ],
      correct: 3,
      explanation: "Guardar por las dudas es guardar riesgo: el dato que no se usa se borra.",
    },
    {
      id: "mix8",
      prompt: "¿Cuándo conviene pedir ayuda con algo que te trabó?",
      options: [
        "Cuando pasó un rato y no avanzás",
        "Recién al día siguiente",
        "Nunca, se resuelve solo",
        "Sólo si te lo pide tu jefe",
      ],
      correct: 0,
      explanation: "Media hora trabado se pregunta; un día trabado ya costó un día de equipo.",
    },
    {
      id: "mix9",
      prompt: "Durante la trivia, ¿qué manda tu celular al proyector?",
      options: [
        "Tu tiempo de respuesta",
        "Sólo la opción que tocaste",
        "Tus puntos del ítem",
        "Tu posición en el ranking",
      ],
      correct: 1,
      explanation: "Manda la opción y nada más: el tiempo lo mide el proyector, no el teléfono.",
    },
    {
      id: "mix10",
      prompt: "¿Qué hace que una capacitación se recuerde?",
      options: ["Que dure más", "Que tenga examen", "Que sea obligatoria", "Practicarla ese mismo día"],
      correct: 3,
      explanation: "Lo que se practica el mismo día se recuerda; lo que sólo se escucha, no.",
    },
  ],
};

/* ------------------------------------------------------------------ */

export const TRIVIA_QUIZZES: readonly TriviaQuizSeed[] = [CULTURE, SECURITY, PRODUCT, MIXED];

export function findQuizSeed(id: string): TriviaQuizSeed | undefined {
  return TRIVIA_QUIZZES.find((quiz) => quiz.id === id);
}
