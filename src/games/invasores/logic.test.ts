import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import {
  cannonPosition,
  createInvadersState,
  fireCannon,
  hordeBottom,
  hordeShape,
  hordeSpeedOf,
  invaderX,
  invaderY,
  invadersPoints,
  seatPoints,
  setCannonActive,
  setCannonTarget,
  shieldCellsLeft,
  startWave,
  stepInvaders,
  EVENT_CANNON_HIT,
  EVENT_KILL,
  EVENT_WAVE_CLEARED,
  INVADERS_SEATS,
  type InvadersRules,
  type InvadersState,
} from "./logic";

const RULES: InvadersRules = {
  width: 1600,
  height: 900,
  floorY: 800,

  baseRows: 3,
  baseCols: 8,
  cellW: 96,
  cellH: 68,
  invaderW: 62,
  invaderH: 42,
  hordeTopY: 120,
  waveDropY: 24,
  maxWaveDrops: 6,

  marchSpeed: 95,
  accelFactor: 2.2,
  stepDown: 22,
  waveSpeedGain: 0.12,
  playerSpeedGain: 0.1,

  cannonW: 72,
  cannonH: 38,
  cannonY: 800,
  cannonFollow: 0.45,
  fireCooldownS: 0.32,

  bulletSpeed: 900,
  bulletW: 6,
  bulletH: 22,

  bombSpeed: 340,
  bombW: 8,
  bombH: 22,
  hordeFireRate: 1.1,
  hordeFireWaveGain: 0.15,

  lives: 3,
  regroupS: 1.5,
  waveBannerS: 3,

  pointsPerInvader: 100,
  pointsPerWave: 300,
  accuracyBonus: 500,

  shieldTopY: 640,
  shieldCellW: 8,
  shieldCellH: 8,
};

const STEP = 1 / 60;

function fresh(cannons = 1, rules: InvadersRules = RULES) {
  const state = createInvadersState(rules, cannons);
  return { state, rng: createRng("abc7") };
}

/** Mata a un invasor concreto poniendo un proyectil encima. Evita depender del bot. */
function shootAt(state: InvadersState, rng: ReturnType<typeof createRng>, row: number, col: number) {
  state.bulletAlive[0] = 1;
  state.bulletSeat[0] = 0;
  state.bulletX[0] = invaderX(state, col) + RULES.invaderW / 2;
  state.bulletY[0] = invaderY(state, row) + RULES.invaderH / 2;
  return stepInvaders(state, STEP, rng);
}

/* ------------------------------------------------------------------ */

describe("determinismo", () => {
  it("la misma semilla dispara los mismos invasores en el mismo orden", () => {
    const run = (seed: string) => {
      const state = createInvadersState(RULES, 4);
      const rng = createRng(seed);
      const trace: number[] = [];
      for (let i = 0; i < 600; i++) {
        stepInvaders(state, STEP, rng);
        if (i % 20 === 0) {
          trace.push(Math.round(state.hordeX), Math.round(state.hordeY), state.aliveCount);
          for (let b = 0; b < state.bombAlive.length; b++) {
            trace.push(state.bombAlive[b] ?? 0, Math.round(state.bombX[b] ?? 0));
          }
        }
      }
      return trace;
    };
    expect(run("abc7")).toEqual(run("abc7"));
  });

  it("semillas distintas divergen", () => {
    const columnsOf = (seed: string) => {
      const state = createInvadersState(RULES, 4);
      const rng = createRng(seed);
      const seen: number[] = [];
      let previous = 0;
      for (let i = 0; i < 900 && seen.length < 8; i++) {
        stepInvaders(state, STEP, rng);
        let live = 0;
        for (let b = 0; b < state.bombAlive.length; b++) live += state.bombAlive[b] ?? 0;
        // Solo interesa el momento en que aparece una bomba nueva: es ahi donde
        // el PRNG eligio columna.
        if (live > previous) {
          for (let b = 0; b < state.bombAlive.length; b++) {
            if (state.bombAlive[b] === 1) seen.push(Math.round(state.bombX[b] ?? 0));
          }
        }
        previous = live;
      }
      return seen.join(",");
    };
    expect(columnsOf("abc7")).not.toEqual(columnsOf("zzz9"));
  });

  it("la horda arranca igual con la misma cantidad de cañones", () => {
    const a = createInvadersState(RULES, 3);
    const b = createInvadersState(RULES, 3);
    expect([a.rows, a.cols, a.hordeX, a.hordeY]).toEqual([b.rows, b.cols, b.hordeX, b.hordeY]);
  });
});

/* ------------------------------------------------------------------ */

describe("forma de la horda", () => {
  it("reproduce la tabla de la guia", () => {
    expect(hordeShape(1, RULES)).toEqual({ rows: 3, cols: 8, speedMult: 1 });
    expect(hordeShape(2, RULES).rows).toBe(4);
    expect(hordeShape(2, RULES).cols).toBe(9);
    expect(hordeShape(3, RULES).rows).toBe(4);
    expect(hordeShape(3, RULES).cols).toBe(10);
    expect(hordeShape(4, RULES)).toEqual({ rows: 5, cols: 11, speedMult: 1.3 });
  });

  it("escala sublineal: cuatro cañones no enfrentan cuatro veces la horda", () => {
    const one = hordeShape(1, RULES);
    const four = hordeShape(4, RULES);
    expect(four.rows * four.cols).toBeLessThan(one.rows * one.cols * 4);
  });

  it("una cantidad de cañones absurda no rompe la grilla", () => {
    expect(hordeShape(0, RULES).cols).toBe(8);
    expect(hordeShape(99, RULES).cols).toBe(11);
    expect(hordeShape(Number.NaN, RULES).cols).toBe(8);
  });

  it("entrar o irse a mitad de oleada NO reescala la horda", () => {
    const { state, rng } = fresh(1);
    const rows = state.rows;
    const cols = state.cols;
    state.activeCannons = 4;
    for (let i = 0; i < 120; i++) stepInvaders(state, STEP, rng);
    expect([state.rows, state.cols]).toEqual([rows, cols]);

    // Recien la oleada siguiente toma la cantidad nueva.
    state.wavesCleared = 1;
    startWave(state);
    expect([state.rows, state.cols]).toEqual([5, 11]);
  });
});

/* ------------------------------------------------------------------ */

describe("aceleracion", () => {
  it("la horda acelera al quedar menos invasores", () => {
    const { state } = fresh(1);
    const full = hordeSpeedOf(state);
    state.aliveCount = Math.floor(state.totalCount / 2);
    const half = hordeSpeedOf(state);
    state.aliveCount = 1;
    const last = hordeSpeedOf(state);

    expect(half).toBeGreaterThan(full);
    expect(last).toBeGreaterThan(half);
    // El ultimo invasor va mas de tres veces mas rapido que la horda completa.
    expect(last / full).toBeGreaterThan(3);
  });

  it("matar invasores de verdad sube la velocidad", () => {
    const { state, rng } = fresh(1);
    const before = hordeSpeedOf(state);
    for (let col = 0; col < 4; col++) shootAt(state, rng, state.rows - 1, col);
    expect(state.aliveCount).toBe(state.totalCount - 4);
    expect(hordeSpeedOf(state)).toBeGreaterThan(before);
  });

  it("cada oleada arranca mas rapido que la anterior", () => {
    const { state } = fresh(1);
    const first = hordeSpeedOf(state);
    state.wavesCleared = 3;
    startWave(state);
    expect(hordeSpeedOf(state)).toBeGreaterThan(first);
  });
});

/* ------------------------------------------------------------------ */

describe("colision bala-invasor", () => {
  it("el proyectil derriba al invasor y lo cobra el asiento que disparo", () => {
    const { state, rng } = fresh(1);
    const total = state.totalCount;
    state.bulletAlive[0] = 1;
    state.bulletSeat[0] = 2;
    state.bulletX[0] = invaderX(state, 3) + RULES.invaderW / 2;
    state.bulletY[0] = invaderY(state, state.rows - 1) + RULES.invaderH / 2;

    const events = stepInvaders(state, STEP, rng);
    expect(events & EVENT_KILL).toBeTruthy();
    expect(state.aliveCount).toBe(total - 1);
    expect(state.seatKills[2]).toBe(1);
    expect(state.seatHits[2]).toBe(1);
    expect(state.bulletAlive[0]).toBe(0);
    expect(state.killCount).toBe(1);
  });

  it("un proyectil derriba a UN solo invasor, no a la columna", () => {
    const { state, rng } = fresh(1);
    shootAt(state, rng, state.rows - 1, 2);
    expect(state.aliveCount).toBe(state.totalCount - 1);
  });

  it("el proyectil que no toca nada sigue viaje", () => {
    const { state, rng } = fresh(1);
    state.bulletAlive[0] = 1;
    state.bulletSeat[0] = 0;
    state.bulletX[0] = invaderX(state, 0) - 400;
    state.bulletY[0] = 500;
    stepInvaders(state, STEP, rng);
    expect(state.aliveCount).toBe(state.totalCount);
    expect(state.bulletAlive[0]).toBe(1);
  });

  it("un solo proyectil propio en vuelo a la vez", () => {
    const { state } = fresh(1);
    expect(fireCannon(state, 0)).toBe(true);
    expect(fireCannon(state, 0)).toBe(false);
    expect(state.seatShots[0]).toBe(1);
  });

  it("la cadencia frena el segundo disparo aunque el primero ya no exista", () => {
    const { state, rng } = fresh(1);
    fireCannon(state, 0);
    state.bulletAlive.fill(0);
    expect(fireCannon(state, 0)).toBe(false);
    for (let i = 0; i < 30; i++) stepInvaders(state, STEP, rng);
    expect(fireCannon(state, 0)).toBe(true);
  });

  it("un asiento sin cañon no dispara", () => {
    const { state } = fresh(1);
    expect(fireCannon(state, 3)).toBe(false);
    setCannonActive(state, 3, true);
    expect(fireCannon(state, 3)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe("entrada saneada", () => {
  it("una posicion imposible no mueve el cañon fuera del campo", () => {
    const { state } = fresh(1);
    setCannonTarget(state, 0, 1e9);
    expect(state.cannonTargetX[0]).toBeLessThanOrEqual(RULES.width);
    setCannonTarget(state, 0, -1e9);
    expect(state.cannonTargetX[0]).toBeGreaterThanOrEqual(0);
  });

  it("NaN y asientos inventados se ignoran", () => {
    const { state } = fresh(1);
    const before = state.cannonTargetX[0];
    setCannonTarget(state, 0, Number.NaN);
    expect(state.cannonTargetX[0]).toBe(before);
    setCannonTarget(state, 9, 0.1);
    setCannonTarget(state, -1, 0.1);
    expect(state.cannonTargetX.length).toBe(INVADERS_SEATS);
  });

  it("la posicion normalizada es la inversa del objetivo", () => {
    const { state, rng } = fresh(1);
    setCannonTarget(state, 0, 0.25);
    for (let i = 0; i < 120; i++) stepInvaders(state, STEP, rng);
    expect(cannonPosition(state, 0)).toBeCloseTo(0.25, 2);
  });
});

/* ------------------------------------------------------------------ */

describe("final de partida", () => {
  it("termina cuando la horda toca el suelo", () => {
    const { state, rng } = fresh(1);
    state.hordeY = RULES.floorY - state.maxRow * RULES.cellH - RULES.invaderH + 1;
    stepInvaders(state, STEP, rng);
    expect(state.over).toBe(true);
    expect(state.reason).toBe("invaded");
    expect(hordeBottom(state)).toBeGreaterThanOrEqual(RULES.floorY);
  });

  it("una bomba en el cañon cuesta una vida DE TODOS", () => {
    const { state, rng } = fresh(1);
    setCannonActive(state, 1, true);
    state.cannonX[0] = 800;
    state.cannonTargetX[0] = 800;
    state.bombAlive[0] = 1;
    state.bombX[0] = 800 - RULES.bombW / 2;
    state.bombY[0] = RULES.cannonY - 2;

    const events = stepInvaders(state, STEP, rng);
    expect(events & EVENT_CANNON_HIT).toBeTruthy();
    expect(state.lives).toBe(2);
    expect(state.hitSeat).toBe(0);
    // La vida es una sola para la sala: el asiento 1 tambien la perdio.
    expect(state.phase).toBe("regroup");
    expect(state.pauseS).toBeCloseTo(RULES.regroupS, 3);
  });

  it("termina al quedarse sin vidas compartidas", () => {
    const { state, rng } = fresh(1);
    state.lives = 1;
    state.cannonX[0] = 800;
    state.cannonTargetX[0] = 800;
    state.bombAlive[0] = 1;
    state.bombX[0] = 800 - RULES.bombW / 2;
    state.bombY[0] = RULES.cannonY - 2;

    stepInvaders(state, STEP, rng);
    expect(state.over).toBe(true);
    expect(state.reason).toBe("lives");
    expect(state.lives).toBe(0);
  });

  it("terminada, la partida no vuelve a moverse", () => {
    const { state, rng } = fresh(1);
    state.lives = 1;
    state.cannonX[0] = 800;
    state.cannonTargetX[0] = 800;
    state.bombAlive[0] = 1;
    state.bombX[0] = 800 - RULES.bombW / 2;
    state.bombY[0] = RULES.cannonY - 2;
    stepInvaders(state, STEP, rng);

    const x = state.hordeX;
    for (let i = 0; i < 60; i++) stepInvaders(state, STEP, rng);
    expect(state.hordeX).toBe(x);
  });

  it("la pausa de reagrupamiento frena la horda pero deja mover el cañon", () => {
    const { state, rng } = fresh(1);
    state.cannonX[0] = 800;
    state.cannonTargetX[0] = 800;
    state.bombAlive[0] = 1;
    state.bombX[0] = 800 - RULES.bombW / 2;
    state.bombY[0] = RULES.cannonY - 2;
    stepInvaders(state, STEP, rng);

    const hordeX = state.hordeX;
    setCannonTarget(state, 0, 0.9);
    for (let i = 0; i < 30; i++) stepInvaders(state, STEP, rng);
    expect(state.hordeX).toBe(hordeX);
    expect(state.cannonX[0]).toBeGreaterThan(800);
  });
});

/* ------------------------------------------------------------------ */

describe("oleadas", () => {
  it("vaciar la horda supera la oleada y levanta el cartel", () => {
    const { state, rng } = fresh(1);
    state.aliveCount = 1;
    state.invaderAlive.fill(0);
    state.invaderAlive[0] = 1;
    state.minCol = 0;
    state.maxCol = 0;
    state.maxRow = 0;

    const events = shootAt(state, rng, 0, 0);
    expect(events & EVENT_WAVE_CLEARED).toBeTruthy();
    expect(state.wavesCleared).toBe(1);
    expect(state.phase).toBe("banner");
  });

  it("terminado el cartel arranca una horda nueva y entera", () => {
    const { state, rng } = fresh(1);
    state.aliveCount = 0;
    stepInvaders(state, STEP, rng);
    expect(state.phase).toBe("banner");
    const steps = Math.ceil(RULES.waveBannerS / STEP) + 2;
    for (let i = 0; i < steps; i++) stepInvaders(state, STEP, rng);
    expect(state.phase).toBe("marching");
    expect(state.aliveCount).toBe(state.totalCount);
    expect(state.aliveCount).toBeGreaterThan(0);
  });

  it("cada oleada empieza mas abajo, con tope", () => {
    const { state } = fresh(1);
    const first = state.hordeY;
    state.wavesCleared = 2;
    startWave(state);
    const third = state.hordeY;
    state.wavesCleared = 99;
    startWave(state);
    expect(third).toBeGreaterThan(first);
    expect(state.hordeY).toBe(RULES.hordeTopY + RULES.maxWaveDrops * RULES.waveDropY);
  });
});

/* ------------------------------------------------------------------ */

describe("escudos", () => {
  it("se erosionan por zonas, no desaparecen de golpe", () => {
    const { state, rng } = fresh(1);
    const before = shieldCellsLeft(state);
    state.bombAlive[0] = 1;
    state.bombX[0] = (state.shieldX[0] ?? 0) + 80;
    state.bombY[0] = (state.shieldY[0] ?? 0) - 4;
    stepInvaders(state, STEP, rng);

    const after = shieldCellsLeft(state);
    expect(after).toBeLessThan(before);
    // Un impacto se come un cráter, no el escudo entero.
    expect(after).toBeGreaterThan(before * 0.8);
  });

  it("cada oleada repone los escudos", () => {
    const { state } = fresh(1);
    state.shieldCell.fill(0);
    startWave(state);
    expect(shieldCellsLeft(state)).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */

describe("puntaje", () => {
  it("propios mas precision mas oleadas", () => {
    expect(invadersPoints(5, 5, 10, 2, RULES)).toBe(5 * 100 + 250 + 2 * 300);
  });

  it("disparar sin mirar cuesta el bono de precision", () => {
    const preciso = invadersPoints(10, 10, 10, 0, RULES);
    const ansioso = invadersPoints(10, 10, 40, 0, RULES);
    expect(preciso).toBeGreaterThan(ansioso);
    expect(preciso - ansioso).toBe(500 - 125);
  });

  it("sin disparos no hay bono de precision y no hay NaN", () => {
    expect(invadersPoints(0, 0, 0, 0, RULES)).toBe(0);
    expect(Number.isNaN(invadersPoints(0, 0, 0, 1, RULES))).toBe(false);
  });

  it("el bono por oleada es identico para todos los conectados", () => {
    const { state } = fresh(1);
    setCannonActive(state, 1, true);
    state.wavesCleared = 2;
    state.seatKills[0] = 7;
    state.seatHits[0] = 7;
    state.seatShots[0] = 7;
    // El asiento 1 no derribo nada y cobra el mismo bono colectivo.
    expect(seatPoints(state, 1)).toBe(2 * RULES.pointsPerWave);
    expect(seatPoints(state, 0) - seatPoints(state, 1)).toBe(7 * 100 + 500);
  });

  it("un asiento fuera de rango vale cero", () => {
    const { state } = fresh(1);
    expect(seatPoints(state, -1)).toBe(0);
    expect(seatPoints(state, INVADERS_SEATS)).toBe(0);
  });
});
