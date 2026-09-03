/**
 * Las tandas del ROADMAP.md, en codigo.
 *
 * Estan aca y no solo en el .md para que la pantalla de roadmap se arme desde
 * el registry: si un juego cambia de tanda, la pantalla lo refleja sola y no
 * hay dos fuentes de verdad que se contradigan.
 */

export type Batch = {
  number: number;
  title: string;
  /** Que habilita, en una linea. */
  unlocks: string;
  /** Que hay que tener cerrado antes. */
  requires: string;
};

export const BATCHES: readonly Batch[] = [
  {
    number: 0,
    title: "Cimientos",
    unlocks: "Contrato, sidebar, catálogo, banco de pruebas y administrables.",
    requires: "Nada.",
  },
  {
    number: 1,
    title: "Bases 2D y corporativa",
    unlocks: "Loop de paso fijo, canvas, input, PRNG, pools y el motor de preguntas.",
    requires: "Tanda 0.",
  },
  {
    number: 2,
    title: "Primeros jugables, sin red",
    unlocks: "Cuatro juegos completos que validan las dos bases con esfuerzo bajo.",
    requires: "Tanda 1.",
  },
  {
    number: 3,
    title: "Corporativos DOM",
    unlocks: "Dos juegos más sin escribir una línea de canvas ni de red.",
    requires: "Base corporativa.",
  },
  {
    number: 4,
    title: "Modernos sobre la base 2D",
    unlocks: "Los que se ven bien en una demo. Ninguno necesita red.",
    requires: "Base 2D. Ninja y Match-3 suman PixiJS.",
  },
  {
    number: 5,
    title: "La base de red y su caso más simple",
    unlocks: "Celular como control de verdad. Pong es la prueba mínima de la base.",
    requires: "Base de netcode.",
  },
  {
    number: 6,
    title: "Corporativos en red",
    unlocks: "Un evento de empresa completo. Es el mayor valor real del catálogo.",
    requires: "Tandas 3 y 5.",
  },
  {
    number: 7,
    title: "Retro en red",
    unlocks: "Los tres que exigen estado compartido continuo.",
    requires: "Tanda 5 probada con latencia.",
  },
  {
    number: 8,
    title: "Sociales",
    unlocks: "Los que se disfrutan en grupo. Ludo primero: por turnos, la red es barata.",
    requires: "Tanda 5.",
  },
  {
    number: 9,
    title: "PixiJS y scroll de mundo",
    unlocks: "Render con cientos de sprites y cámara que sigue.",
    requires: "Tanda 4 (Pixi ya introducido).",
  },
  {
    number: 10,
    title: "Física determinista en red",
    unlocks: "Lo más difícil que no es 3D: simulación idéntica en dos máquinas.",
    requires: "Tandas 5 y 7.",
  },
  {
    number: 11,
    title: "3D",
    unlocks: "Base 3D, física 3D y BVH. Los tres juegos más caros del catálogo.",
    requires: "Todo lo anterior. Van al final a propósito.",
  },
];

export const BATCHES_BY_NUMBER = new Map(BATCHES.map((batch) => [batch.number, batch]));
