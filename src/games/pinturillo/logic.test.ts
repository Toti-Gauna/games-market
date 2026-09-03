import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import {
  DEFAULT_SCORING,
  appendStroke,
  applyCanvasAction,
  buildChoiceDeck,
  createPinturilloScorer,
  drawerPoints,
  guesserPoints,
  hintFor,
  judgeGuess,
  levenshtein,
  nextDrawer,
  normalizeGuess,
  resolveInk,
  revealCount,
  revealOrder,
  revealedLetters,
  strokePointCount,
  type Stroke,
} from "./logic";
import {
  NOT_DRAWABLE,
  PINTURILLO_WORD_LISTS,
  WORD_LEVELS,
  type WordLevel,
} from "./words";

/**
 * Los criterios de aceptacion de X1, uno por bloque.
 *
 * Todo lo de aca es puro: no hay canvas, no hay red y no hay relojes. Lo que
 * se prueba es lo que decide si alguien acerta, cuanto suma y que se puede
 * proyectar - que es exactamente donde el juego se rompe si se hace mal.
 */

/* ------------------------------------------------------------------ */
/* Acertar                                                              */
/* ------------------------------------------------------------------ */

describe("normalizeGuess", () => {
  it("saca acentos, mayúsculas, espacios de más y signos", () => {
    expect(normalizeGuess("  Á R B O L ")).toBe("a r b o l");
    expect(normalizeGuess("Árbol!")).toBe("arbol");
    expect(normalizeGuess("Molino   de  Viento")).toBe("molino de viento");
    expect(normalizeGuess("¿café?")).toBe("cafe");
  });
});

describe("judgeGuess", () => {
  it("acentos, mayúsculas y espacios de más NO impiden el acierto", () => {
    // Es el criterio 7 de la spec: se escribe con un dedo en un teclado
    // virtual, y castigar la tilde seria castigar el teclado.
    for (const attempt of ["árbol", "ARBOL", "Árbol", "  arbol  ", "arbol."]) {
      expect(judgeGuess(attempt, "árbol")).toBe("correct");
    }
    expect(judgeGuess("MOLINO   DE   VIENTO", "molino de viento")).toBe("correct");
    // Y al reves: la palabra tambien puede venir escrita con tilde del panel.
    expect(judgeGuess("cafe", "café")).toBe("correct");
  });

  it("una palabra a distancia 1 dispara “¡Casi!”, a distancia 2 no", () => {
    expect(levenshtein("guitara", "guitarra")).toBe(1);
    expect(judgeGuess("guitara", "guitarra")).toBe("near");

    expect(levenshtein("gitara", "guitarra")).toBe(2);
    expect(judgeGuess("gitara", "guitarra")).toBe("wrong");
  });

  it("no ofrece “¡Casi!” en palabras cortas: ahí distancia 1 es cualquier cosa", () => {
    expect(levenshtein("sal", "sol")).toBe(1);
    expect(judgeGuess("sal", "sol")).toBe("wrong");
  });

  it("un intento con palabra vetada no pasa el filtro", () => {
    // El filtro corre ANTES de comparar: un intento vetado no se proyecta ni
    // aunque acierte, y tampoco se evalua.
    expect(judgeGuess("sos un boludo", "árbol")).toBe("blocked");
    expect(judgeGuess("mierda", "mierda")).toBe("blocked");
    expect(judgeGuess("MIERDA!!", "árbol")).toBe("blocked");
    // Un intento limpio sigue pasando.
    expect(judgeGuess("árbol", "árbol")).toBe("correct");
  });

  it("un intento vacío nunca acierta", () => {
    expect(judgeGuess("   ", "árbol")).toBe("wrong");
    expect(judgeGuess("...", "árbol")).toBe("wrong");
  });
});

describe("levenshtein", () => {
  it("es simétrica y da 0 para lo mismo", () => {
    expect(levenshtein("casa", "casa")).toBe(0);
    expect(levenshtein("casa", "caza")).toBe(levenshtein("caza", "casa"));
    expect(levenshtein("", "casa")).toBe(4);
    expect(levenshtein("casa", "")).toBe(4);
  });
});

/* ------------------------------------------------------------------ */
/* Pistas                                                               */
/* ------------------------------------------------------------------ */

describe("pistas progresivas", () => {
  const HINTS = [45_000, 25_000, 10_000] as const;
  const word = "molino de viento";
  const order = revealOrder(word, createRng("pinturillo-test"));

  it("revelan la cantidad correcta de letras en cada umbral", () => {
    const at = (remainingMs: number): number =>
      revealedLetters(hintFor(word, order, revealCount(remainingMs, HINTS)));

    expect(at(75_000)).toBe(0);
    expect(at(45_001)).toBe(0);
    expect(at(45_000)).toBe(1);
    expect(at(25_001)).toBe(1);
    expect(at(25_000)).toBe(2);
    expect(at(10_001)).toBe(2);
    expect(at(10_000)).toBe(3);
    expect(at(0)).toBe(3);
  });

  it("los guiones no cuentan los espacios como letras", () => {
    // 14 letras y dos espacios: la pista dice cuantas letras tiene cada
    // palabra, no cuantas tiene la frase.
    const blank = hintFor(word, order, 0);
    expect(blank.split("_").length - 1).toBe(14);
  });

  it("nunca revelan la última letra que queda", () => {
    const short = "sol";
    const shortOrder = revealOrder(short, createRng("sol"));
    expect(revealedLetters(hintFor(short, shortOrder, 99))).toBe(2);
  });

  it("son estables: la misma semilla revela las mismas letras", () => {
    const a = revealOrder(word, createRng("misma"));
    const b = revealOrder(word, createRng("misma"));
    expect(a).toEqual(b);
    expect(hintFor(word, a, 2)).toBe(hintFor(word, b, 2));
  });
});

/* ------------------------------------------------------------------ */
/* Puntaje                                                              */
/* ------------------------------------------------------------------ */

describe("puntaje de quien adivina", () => {
  it("paga la base al cerrar y la base más el bono al instante", () => {
    expect(guesserPoints(0, 75_000)).toBe(1000);
    expect(guesserPoints(75_000, 75_000)).toBe(400);
    expect(guesserPoints(37_500, 75_000)).toBe(700);
  });

  it("no paga nada a quien no acertó", () => {
    const scorer = createPinturilloScorer(DEFAULT_SCORING);
    const base = {
      participantId: "s1",
      question: { id: "r1", kind: "text", prompt: "" } as const,
      value: "no",
      elapsedMs: 1000,
      windowMs: 75_000,
      streak: 0,
      itemIndex: 0,
      pointsBefore: 0,
    };
    expect(scorer({ ...base, correct: false })).toEqual({ base: 0, bonus: 0 });
    expect(scorer({ ...base, correct: null })).toEqual({ base: 0, bonus: 0 });
    expect(scorer({ ...base, correct: true }).base).toBeGreaterThan(0);
  });
});

describe("puntaje de quien dibuja", () => {
  it("si nadie acierta, el dibujante saca 0", () => {
    // Es la regla que desalienta el dibujo criptico mejor que cualquier otra.
    expect(drawerPoints(0)).toBe(0);
  });

  it("puntúa según cuánta gente acertó", () => {
    expect(drawerPoints(1)).toBe(350);
    expect(drawerPoints(2)).toBe(500);
    expect(drawerPoints(5)).toBe(950);

    // Monotona: un dibujo que entienden mas personas nunca paga menos.
    let previous = drawerPoints(0);
    for (let count = 1; count <= 19; count++) {
      const points = drawerPoints(count);
      expect(points).toBeGreaterThan(previous);
      previous = points;
    }
  });

  it("respeta la configuración del panel", () => {
    const scoring = { ...DEFAULT_SCORING, drawerBase: 0, drawerPerGuess: 100 };
    expect(drawerPoints(0, scoring)).toBe(0);
    expect(drawerPoints(3, scoring)).toBe(300);
  });
});

/* ------------------------------------------------------------------ */
/* Turno                                                                */
/* ------------------------------------------------------------------ */

describe("nextDrawer", () => {
  it("rota hasta que todos dibujaron una vez y ahí reinicia el ciclo", () => {
    const room = ["s0", "s1", "s2"];
    let drawn: readonly string[] = [];
    const turns: string[] = [];

    for (let round = 0; round < 4; round++) {
      const pick = nextDrawer(room, drawn);
      drawn = pick.drawn;
      if (pick.drawerId) turns.push(pick.drawerId);
    }

    expect(turns).toEqual(["s0", "s1", "s2", "s0"]);
  });

  it("no le da el turno a quien ya no está en la sala", () => {
    const pick = nextDrawer(["s1", "s2"], ["s0"]);
    expect(pick.drawerId).toBe("s1");
  });

  it("sin nadie conectado no hay turno", () => {
    expect(nextDrawer([], []).drawerId).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Lienzo                                                               */
/* ------------------------------------------------------------------ */

describe("lista de trazos", () => {
  const stroke = (id: number): Stroke => ({
    id,
    color: "black",
    width: 12,
    eraser: false,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ],
  });

  it("deshacer quita el último y borrar vacía la lista", () => {
    const list = [stroke(1), stroke(2), stroke(3)];
    expect(applyCanvasAction(list, "undo").map((s) => s.id)).toEqual([1, 2]);
    expect(applyCanvasAction(list, "clear")).toEqual([]);
    // Deshacer sobre un lienzo vacio no explota.
    expect(applyCanvasAction([], "undo")).toEqual([]);
  });

  it("no guarda trazos sin puntos ni pasa del tope", () => {
    const empty: Stroke = { ...stroke(9), points: [] };
    expect(appendStroke([], empty)).toEqual([]);
    expect(appendStroke([stroke(1)], stroke(2), 1).length).toBe(1);
  });

  it("cuenta los puntos del lienzo para el presupuesto", () => {
    expect(strokePointCount([stroke(1), stroke(2)])).toBe(4);
  });
});

describe("resolveInk", () => {
  it("resuelve los tokens contra la paleta y deja pasar las palabras clave", () => {
    const palette = { "--sn-cyan-400": "#00d1ff" };
    expect(resolveInk("var(--sn-cyan-400)", palette)).toBe("#00d1ff");
    expect(resolveInk("black", palette)).toBe("black");
    expect(resolveInk("white", palette)).toBe("white");
    // Un token que no esta en la paleta cae al negro: una tinta invisible
    // seria peor que una equivocada.
    expect(resolveInk("var(--sn-no-existe)", palette)).toBe("black");
  });
});

/* ------------------------------------------------------------------ */
/* Palabras                                                             */
/* ------------------------------------------------------------------ */

/** Minusculas, acentos del espanol y espacios. Nada mas. */
const WORD_SHAPE = /^[a-záéíóúüñ]+( [a-záéíóúüñ]+)*$/;

describe("las cuatro listas de palabras", () => {
  it("tienen las cuatro de la spec", () => {
    expect(PINTURILLO_WORD_LISTS.map((list) => list.id)).toEqual([
      "general",
      "oficina",
      "empresa",
      "dificil",
    ]);
  });

  for (const list of PINTURILLO_WORD_LISTS) {
    describe(list.id, () => {
      it("no tiene ninguna palabra abstracta", () => {
        // "Sinergia" no es una palabra para este juego, por mas corporativa
        // que suene: alguien tiene 75 segundos y un dedo.
        const banned = new Set(NOT_DRAWABLE.map(normalizeGuess));
        for (const word of list.words) {
          expect(banned.has(normalizeGuess(word.text))).toBe(false);
        }
      });

      it("tiene palabras de largo razonable y bien escritas", () => {
        for (const word of list.words) {
          expect(word.text.length).toBeGreaterThanOrEqual(3);
          expect(word.text.length).toBeLessThanOrEqual(24);
          // En minuscula: un nombre propio se delata solo, y dibujar a un
          // companero en una pantalla de tres metros sale mal.
          expect(word.text).toBe(word.text.toLowerCase());
          expect(word.text).toMatch(WORD_SHAPE);
        }
      });

      it("cubre los tres niveles y ninguna palabra está en el nivel equivocado", () => {
        const seen = new Set<WordLevel>();
        for (const word of list.words) {
          expect(WORD_LEVELS).toContain(word.level);
          seen.add(word.level);
        }
        expect([...seen].sort()).toEqual([...WORD_LEVELS].sort());

        for (const level of WORD_LEVELS) {
          const count = list.words.filter((word) => word.level === level).length;
          // Con una sola palabra por nivel, la segunda ronda repite.
          expect(count).toBeGreaterThanOrEqual(4);
        }
      });

      it("no repite palabras", () => {
        const keys = list.words.map((word) => normalizeGuess(word.text));
        expect(new Set(keys).size).toBe(keys.length);
      });
    });
  }
});

describe("buildChoiceDeck", () => {
  const pool = PINTURILLO_WORD_LISTS[0]?.words ?? [];

  it("ofrece tres palabras de niveles distintos, una por nivel", () => {
    const deck = buildChoiceDeck(pool, 4, createRng("mesa-7"));
    expect(deck.length).toBe(4);
    for (const trio of deck) {
      expect(trio.length).toBe(3);
      expect(trio.map((word) => word.level)).toEqual([...WORD_LEVELS]);
    }
  });

  it("no repite palabras mientras queden sin usar", () => {
    const deck = buildChoiceDeck(pool, 4, createRng("mesa-7"));
    const all = deck.flatMap((trio) => trio.map((word) => word.text));
    expect(new Set(all).size).toBe(all.length);
  });

  it("es determinista con la misma semilla", () => {
    const a = buildChoiceDeck(pool, 3, createRng("igual"));
    const b = buildChoiceDeck(pool, 3, createRng("igual"));
    expect(a).toEqual(b);
  });

  it("sin palabras no arma nada, en vez de explotar", () => {
    expect(buildChoiceDeck([], 5, createRng("vacio"))).toEqual([]);
  });
});
