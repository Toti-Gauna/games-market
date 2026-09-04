import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import {
  AIM_ASPECT,
  AIM_BALL_RADIUS,
  BALL_RADIUS,
  CUE_BALL,
  EIGHT_BALL,
  TABLE_LENGTH,
  TABLE_WIDTH,
  fromAimPoint,
  toAimPoint,
  createPoolState,
  foulTextOf,
  kindOf,
  otherGroup,
  poolPoints,
  rackPositions,
  remainingFor,
  resolveShot,
  winnerByRemaining,
  type PoolState,
} from "./logic";

/**
 * Las reglas de Pool, sin GPU ni red.
 *
 * Cada falta de la guia tiene su caso, y cada caso comprueba las dos cosas
 * que importan: que se detecte, y que el motivo sea el correcto. Un cartel
 * que dice "embocaste la blanca" cuando en realidad no tocaste ninguna lisa
 * ensena mal las reglas, que es peor que no decir nada.
 */

/** Estado listo para tirar, con los grupos ya repartidos. */
function assignedState(seed = "test"): PoolState {
  const state = createPoolState(createRng(seed));
  state.breaking = false;
  state.groups = ["solids", "stripes"];
  return state;
}

/** Marca bolas como embocadas sin pasar por `resolveShot`. */
function sink(state: PoolState, ids: readonly number[]): void {
  for (const id of ids) {
    const ball = state.balls[id];
    if (ball) ball.pocketed = true;
  }
}

describe("rackPositions", () => {
  it("pone las 16 bolas, una por id", () => {
    const balls = rackPositions(createRng("s1"));
    expect(balls).toHaveLength(16);
    expect(balls.map((b) => b.id)).toEqual([...Array(16).keys()]);
  });

  it("deja la 8 en el centro de la tercera fila", () => {
    const balls = rackPositions(createRng("s1"));
    const eight = balls[EIGHT_BALL];
    // Centro de fila: simetrico respecto del eje largo de la mesa.
    expect(eight?.z).toBeCloseTo(0, 6);
    expect(eight?.x).toBeGreaterThan(balls[CUE_BALL]!.x);
  });

  it("pone una de cada grupo en las dos esquinas del fondo", () => {
    // Varias semillas: la regla tiene que valer siempre, no para una.
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const balls = rackPositions(createRng(seed));
      const backRow = balls.filter((b) => b.id !== CUE_BALL).sort((p, q) => q.x - p.x);
      const corners = backRow.slice(0, 5).sort((p, q) => p.z - q.z);
      const first = corners[0];
      const last = corners[corners.length - 1];
      expect(kindOf(first!.id)).not.toBe(kindOf(last!.id));
    }
  });

  it("no superpone bolas", () => {
    const balls = rackPositions(createRng("s2"));
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i]!;
        const b = balls[j]!;
        const distance = Math.hypot(a.x - b.x, a.z - b.z);
        expect(distance).toBeGreaterThanOrEqual(BALL_RADIUS * 2);
      }
    }
  });

  it("es reproducible con la misma semilla y distinto con otra", () => {
    expect(rackPositions(createRng("igual"))).toEqual(rackPositions(createRng("igual")));
    expect(rackPositions(createRng("uno"))).not.toEqual(rackPositions(createRng("dos")));
  });
});

describe("asignacion de grupo", () => {
  it("el saque no asigna aunque emboque", () => {
    const state = createPoolState(createRng("break"));
    const result = resolveShot(state, { firstContact: 1, pocketed: [1] });
    expect(result.assigned).toBeNull();
    expect(state.groups).toEqual([null, null]);
  });

  it("la primera embocada tras el saque asigna los dos grupos", () => {
    const state = createPoolState(createRng("break"));
    state.breaking = false;
    const result = resolveShot(state, { firstContact: 3, pocketed: [3] });
    expect(result.assigned).toBe("solids");
    expect(state.groups).toEqual(["solids", "stripes"]);
  });

  it("con la mesa abierta, tocar primero una del otro grupo no es falta", () => {
    const state = createPoolState(createRng("open"));
    state.breaking = false;
    const result = resolveShot(state, { firstContact: 12, pocketed: [] });
    expect(result.foul).toBeNull();
  });

  it("con la mesa abierta, tocar primero la 8 si es falta", () => {
    const state = createPoolState(createRng("open"));
    state.breaking = false;
    const result = resolveShot(state, { firstContact: EIGHT_BALL, pocketed: [] });
    expect(result.foul).toBe("wrong-first");
    expect(result.foulText).toBe("Falta: tocaste primero la 8.");
  });
});

describe("faltas", () => {
  it("embocar la blanca", () => {
    const state = assignedState();
    const result = resolveShot(state, { firstContact: 2, pocketed: [CUE_BALL] });
    expect(result.foul).toBe("cue-pocketed");
    expect(result.foulText).toBe("Falta: embocaste la blanca.");
    expect(state.ballInHand).toBe(true);
    expect(state.turn).toBe(1);
  });

  it("no tocar ninguna bola", () => {
    const state = assignedState();
    const result = resolveShot(state, { firstContact: null, pocketed: [] });
    expect(result.foul).toBe("no-contact");
    expect(result.foulText).toBe("Falta: no tocaste ninguna bola.");
  });

  it("tocar primero una del rival nombra el grupo propio", () => {
    const state = assignedState();
    const result = resolveShot(state, { firstContact: 11, pocketed: [] });
    expect(result.foul).toBe("wrong-first");
    expect(result.foulText).toBe("Falta: no tocaste ninguna lisa.");
  });

  it("embocar una del rival, aunque el primer contacto sea legal", () => {
    const state = assignedState();
    const result = resolveShot(state, { firstContact: 2, pocketed: [11] });
    expect(result.foul).toBe("opponent-pocketed");
    expect(result.foulText).toBe("Falta: embocaste una del rival.");
  });

  it("una falta cuenta y cede el turno con bola en mano", () => {
    const state = assignedState();
    resolveShot(state, { firstContact: null, pocketed: [] });
    expect(state.fouls).toEqual([1, 0]);
    expect(state.cleanShots).toEqual([0, 0]);
    expect(state.ballInHand).toBe(true);
    expect(state.turn).toBe(1);
  });

  it("el texto de cada motivo es distinto", () => {
    const texts = new Set([
      foulTextOf("cue-pocketed", "solids"),
      foulTextOf("no-contact", "solids"),
      foulTextOf("wrong-first", "solids"),
      foulTextOf("opponent-pocketed", "solids"),
    ]);
    expect(texts.size).toBe(4);
  });
});

describe("turnos", () => {
  it("embocar una propia da turno extra", () => {
    const state = assignedState();
    const result = resolveShot(state, { firstContact: 2, pocketed: [2] });
    expect(result.foul).toBeNull();
    expect(result.keepsTurn).toBe(true);
    expect(result.ownPocketed).toBe(1);
    expect(state.turn).toBe(0);
  });

  it("un tiro limpio sin embocar cede el turno y suma tiro limpio", () => {
    const state = assignedState();
    const result = resolveShot(state, { firstContact: 2, pocketed: [] });
    expect(result.keepsTurn).toBe(false);
    expect(state.turn).toBe(1);
    expect(state.cleanShots).toEqual([1, 0]);
  });

  it("dos propias en un tiro cuentan las dos", () => {
    const state = assignedState();
    const result = resolveShot(state, { firstContact: 2, pocketed: [2, 5] });
    expect(result.ownPocketed).toBe(2);
    expect(result.keepsTurn).toBe(true);
  });
});

describe("la 8", () => {
  it("embocarla con propias en la mesa pierde", () => {
    const state = assignedState();
    const result = resolveShot(state, { firstContact: 2, pocketed: [EIGHT_BALL] });
    expect(result.lostOnEight).toBe(true);
    expect(state.over).toBe(true);
    expect(state.winner).toBe(1);
    expect(result.foulText).toBe("Embocaste la 8 antes de tiempo.");
  });

  it("embocarla despues de las siete propias gana", () => {
    const state = assignedState();
    sink(state, [1, 2, 3, 4, 5, 6, 7]);
    const result = resolveShot(state, { firstContact: EIGHT_BALL, pocketed: [EIGHT_BALL] });
    expect(result.lostOnEight).toBe(false);
    expect(state.winner).toBe(0);
    expect(state.over).toBe(true);
  });

  it("la ultima propia y la 8 en el mismo tiro pierde", () => {
    const state = assignedState();
    sink(state, [1, 2, 3, 4, 5, 6]);
    const result = resolveShot(state, { firstContact: 7, pocketed: [7, EIGHT_BALL] });
    expect(result.lostOnEight).toBe(true);
    expect(state.winner).toBe(1);
  });

  it("embocarla junto con la blanca pierde aunque le tocara", () => {
    const state = assignedState();
    sink(state, [1, 2, 3, 4, 5, 6, 7]);
    const result = resolveShot(state, {
      firstContact: EIGHT_BALL,
      pocketed: [EIGHT_BALL, CUE_BALL],
    });
    expect(result.lostOnEight).toBe(true);
    expect(state.winner).toBe(1);
  });

  it("con las siete embocadas, tocar otra primero es falta", () => {
    const state = assignedState();
    sink(state, [1, 2, 3, 4, 5, 6, 7]);
    const result = resolveShot(state, { firstContact: 11, pocketed: [] });
    expect(result.foul).toBe("wrong-first");
  });
});

describe("fin por tiempo", () => {
  it("gana el que tiene menos propias en la mesa", () => {
    const state = assignedState();
    sink(state, [1, 2, 3]);
    expect(remainingFor(state, 0)).toBe(4);
    expect(remainingFor(state, 1)).toBe(7);
    expect(winnerByRemaining(state)).toBe(0);
  });

  it("empate en cantidad no declara ganador", () => {
    const state = assignedState();
    expect(winnerByRemaining(state)).toBeNull();
  });
});

describe("poolPoints", () => {
  it("aplica la formula de la guia", () => {
    // 3*200 + 2*-50 + 800 + 4*40 = 600 - 100 + 800 + 160
    expect(poolPoints({ ownPocketed: 3, fouls: 2, won: true, cleanShots: 4 })).toBe(1460);
  });

  it("nunca devuelve negativo", () => {
    expect(poolPoints({ ownPocketed: 0, fouls: 10, won: false, cleanShots: 0 })).toBe(0);
  });

  it("la falta es la unica resta y es leve frente a una embocada", () => {
    const conFalta = poolPoints({ ownPocketed: 1, fouls: 1, won: false, cleanShots: 0 });
    const sinFalta = poolPoints({ ownPocketed: 1, fouls: 0, won: false, cleanShots: 0 });
    expect(sinFalta - conFalta).toBe(50);
  });
});

describe("coordenadas del mando", () => {
  it("el centro de la mesa cae en el centro del rectangulo", () => {
    const center = toAimPoint(0, 0);
    expect(center.x).toBeCloseTo(0.5, 6);
    expect(center.z).toBeCloseTo(0.5 / AIM_ASPECT, 6);
  });

  it("las esquinas caen en los bordes", () => {
    expect(toAimPoint(-TABLE_LENGTH / 2, -TABLE_WIDTH / 2)).toEqual({ x: 0, z: 0 });
    const far = toAimPoint(TABLE_LENGTH / 2, TABLE_WIDTH / 2);
    expect(far.x).toBeCloseTo(1, 6);
    expect(far.z).toBeCloseTo(1 / AIM_ASPECT, 6);
  });

  it("ida y vuelta devuelve el mismo punto", () => {
    const original = { x: 0.42, z: -0.31 };
    const aim = toAimPoint(original.x, original.z);
    const back = fromAimPoint(aim.x, aim.z);
    expect(back.x).toBeCloseTo(original.x, 9);
    expect(back.z).toBeCloseTo(original.z, 9);
  });

  it("los dos ejes usan la misma escala, asi que un angulo se conserva", () => {
    // Un desplazamiento igual en x y en z tiene que dar 45 grados en las dos
    // escalas. Si cada eje se normalizara por su lado, aca daria otro angulo
    // y la linea de tiro no coincidiria con la trayectoria real.
    const from = toAimPoint(0, 0);
    const to = toAimPoint(0.2, 0.2);
    expect(Math.atan2(to.z - from.z, to.x - from.x)).toBeCloseTo(Math.PI / 4, 9);
  });

  it("el radio de bola queda en la misma escala que las posiciones", () => {
    const left = toAimPoint(-BALL_RADIUS, 0);
    const right = toAimPoint(BALL_RADIUS, 0);
    expect(right.x - left.x).toBeCloseTo(AIM_BALL_RADIUS * 2, 9);
  });
});

describe("helpers", () => {
  it("kindOf reparte blanca, lisas, 8 y rayadas", () => {
    expect(kindOf(CUE_BALL)).toBe("cue");
    expect(kindOf(1)).toBe("solids");
    expect(kindOf(7)).toBe("solids");
    expect(kindOf(EIGHT_BALL)).toBe("eight");
    expect(kindOf(9)).toBe("stripes");
    expect(kindOf(15)).toBe("stripes");
  });

  it("otherGroup es su propia inversa", () => {
    expect(otherGroup("solids")).toBe("stripes");
    expect(otherGroup(otherGroup("solids"))).toBe("solids");
  });
});
