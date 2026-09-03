import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import { schemaDefaults } from "@/core/contract/settings";
import { catapultaSettings } from "./settings";
import { DEFAULT_LEVELS, GROUND_Y, WORLD_WIDTH, type LevelData } from "./levels";
import {
  DEFAULT_RULES,
  MIN_TURN_MS,
  aimFromDrag,
  buildRunPlans,
  createAim,
  createRun,
  endTurn,
  fireShot,
  levelPoints,
  nextLevel,
  parseLevels,
  registerBlockDown,
  registerTargetDown,
  resolveLevels,
  rulesFromSettings,
  runPoints,
  tickTurn,
  trajectoryPoint,
  type CatapultRules,
  type RunState,
} from "./logic";

const RULES: CatapultRules = DEFAULT_RULES;

/** Un nivel de laboratorio: dos objetivos, sin estructura que estorbe. */
const LAB: LevelData = {
  id: "lab",
  name: "Laboratorio",
  shots: 3,
  blocks: [{ x: 900, y: 760, w: 40, h: 120, material: "wood" }],
  targets: [
    { x: 1100, y: 797 },
    { x: 1300, y: 797 },
  ],
};

function labRun(rules: CatapultRules = RULES, level: LevelData = LAB): RunState {
  const plans = buildRunPlans([level], rules, createRng("lab"));
  return createRun(plans, rules);
}

/** Dispara y deja que el mundo se aquiete, que es como termina un turno real. */
function shootAndSettle(run: RunState, knockTargets = 0, knockBlocks = 0) {
  fireShot(run);
  for (let i = 0; i < knockTargets; i++) registerTargetDown(run);
  for (let i = 0; i < knockBlocks; i++) registerBlockDown(run);
  // Un tick corto no alcanza; despues, con el mundo quieto, resuelve.
  tickTurn(run, MIN_TURN_MS + 100, true);
  return endTurn(run);
}

describe("determinismo", () => {
  it("la misma semilla arma exactamente los mismos niveles", () => {
    const a = buildRunPlans(DEFAULT_LEVELS, RULES, createRng("abc7"));
    const b = buildRunPlans(DEFAULT_LEVELS, RULES, createRng("abc7"));
    expect(a).toEqual(b);
  });

  it("semillas distintas cambian la veta pero no la geometria", () => {
    const a = buildRunPlans(DEFAULT_LEVELS, RULES, createRng("abc7"));
    const b = buildRunPlans(DEFAULT_LEVELS, RULES, createRng("zzz9"));
    const geometry = (plans: typeof a) =>
      plans.map((plan) => plan.pieces.map((p) => [p.x, p.y, p.w, p.h, p.kind, p.strength]));
    expect(geometry(a)).toEqual(geometry(b));
    const grain = (plans: typeof a) => plans.map((plan) => plan.pieces.map((p) => p.grain));
    expect(grain(a)).not.toEqual(grain(b));
  });

  it("los cinco niveles se apoyan en el suelo y caben en el techo de cuerpos", () => {
    const plans = buildRunPlans(DEFAULT_LEVELS, RULES, createRng("abc7"));
    expect(plans).toHaveLength(5);
    for (const plan of plans) {
      expect(plan.targetCount).toBeGreaterThan(0);
      expect(plan.pieces.length).toBeLessThanOrEqual(60);
      for (const piece of plan.pieces) {
        expect(piece.y + piece.h / 2).toBeLessThanOrEqual(GROUND_Y + 0.001);
        expect(piece.x - piece.w / 2).toBeGreaterThan(0);
        expect(piece.x + piece.w / 2).toBeLessThan(WORLD_WIDTH);
      }
    }
  });

  // Dos piezas encimadas arrancan interpenetradas y Rapier las escupe: el nivel
  // se desarma solo antes del primer tiro. Es el error que mas facil se cuela
  // al editar un nivel a mano, y no se ve hasta que se juega.
  it("ninguna pieza empieza encimada con otra", () => {
    const plans = buildRunPlans(DEFAULT_LEVELS, RULES, createRng("abc7"));
    const clashes: string[] = [];
    for (const plan of plans) {
      for (let a = 0; a < plan.pieces.length; a++) {
        for (let b = a + 1; b < plan.pieces.length; b++) {
          const first = plan.pieces[a];
          const second = plan.pieces[b];
          if (!first || !second) continue;
          const overlapX =
            Math.min(first.x + first.w / 2, second.x + second.w / 2) -
            Math.max(first.x - first.w / 2, second.x - second.w / 2);
          const overlapY =
            Math.min(first.y + first.h / 2, second.y + second.h / 2) -
            Math.max(first.y - first.h / 2, second.y - second.h / 2);
          if (overlapX > 0.001 && overlapY > 0.001) {
            clashes.push(plan.id + ": " + first.kind + "@" + first.x + " vs " + second.kind + "@" + second.x);
          }
        }
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe("niveles como contenido", () => {
  it("los defaults del schema vuelven a los cinco niveles", () => {
    const values = schemaDefaults(catapultaSettings);
    const levels = resolveLevels(values);
    expect(levels.map((l) => l.name)).toEqual(DEFAULT_LEVELS.map((l) => l.name));
    expect(levels[1]?.blocks).toHaveLength(6);
  });

  it("descarta filas sin objetivos: un nivel asi no se puede ganar", () => {
    const parsed = parseLevels([
      { name: "Vacío", shots: 3, blocks: ["100,100,40,40,madera"], targets: [] },
      { name: "Sirve", shots: 0, blocks: [], targets: ["500,700"] },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("Sirve");
  });

  it("un bloque mal escrito se ignora sin romper el nivel", () => {
    const parsed = parseLevels([
      { name: "Mixto", shots: 0, blocks: ["ni,idea", "100,200,40,120,piedra"], targets: ["500,700"] },
    ]);
    expect(parsed[0]?.blocks).toEqual([{ x: 100, y: 200, w: 40, h: 120, material: "stone" }]);
  });

  it("un nivel con 0 tiros usa el valor general", () => {
    const rules = { ...RULES, shotsPerLevel: 5 };
    const plans = buildRunPlans([{ ...LAB, shots: 0 }], rules, createRng("s"));
    expect(plans[0]?.shots).toBe(5);
  });

  it("rulesFromSettings lee los defaults del schema", () => {
    expect(rulesFromSettings(schemaDefaults(catapultaSettings))).toEqual(DEFAULT_RULES);
  });
});

describe("puntaje", () => {
  it("suma objetivos, daño colateral y tiros sin usar", () => {
    const points = levelPoints({ targetsDown: 2, blocksDown: 4, shotsLeft: 1, cleared: true }, RULES);
    expect(points).toBe(2 * 500 + 4 * 25 + 1 * 300);
  });

  it("resolver de un tiro vale mas que resolver de tres", () => {
    const oneShot = levelPoints({ targetsDown: 2, blocksDown: 0, shotsLeft: 2, cleared: true }, RULES);
    const threeShots = levelPoints({ targetsDown: 2, blocksDown: 0, shotsLeft: 0, cleared: true }, RULES);
    expect(oneShot).toBeGreaterThan(threeShots);
    expect(oneShot - threeShots).toBe(2 * RULES.pointsPerSpareShot);
  });

  it("sin limpiar el nivel no hay bono por punteria", () => {
    const points = levelPoints({ targetsDown: 1, blocksDown: 2, shotsLeft: 2, cleared: false }, RULES);
    expect(points).toBe(500 + 50);
  });
});

describe("la tirada", () => {
  it("no se evalua en el primer frame aunque todo parezca quieto", () => {
    const run = labRun();
    fireShot(run);
    expect(tickTurn(run, 16, true)).toBe(false);
    expect(tickTurn(run, MIN_TURN_MS, true)).toBe(true);
  });

  it("espera hasta el tope cuando el mundo no se aquieta", () => {
    const run = labRun();
    fireShot(run);
    expect(tickTurn(run, RULES.settleMs - 100, false)).toBe(false);
    expect(tickTurn(run, 200, false)).toBe(true);
  });

  it("con los objetivos ya caidos resuelve sin esperar", () => {
    const run = labRun();
    fireShot(run);
    registerTargetDown(run);
    registerTargetDown(run);
    expect(tickTurn(run, 16, false)).toBe(true);
  });
});

describe("tres tiros y se acabo", () => {
  it("el cuarto tiro no sale", () => {
    const run = labRun();
    expect(shootAndSettle(run)).toBe("aim");
    expect(run.shotsLeft).toBe(2);
    expect(shootAndSettle(run)).toBe("aim");
    expect(run.shotsLeft).toBe(1);
    expect(shootAndSettle(run)).toBe("failed");
    expect(run.shotsLeft).toBe(0);
    expect(fireShot(run)).toBe(false);
    expect(run.shotsFired).toBe(3);
  });

  it("derrota cuando se agotan los tiros: solo suma lo derribado", () => {
    const run = labRun();
    shootAndSettle(run, 0, 2);
    shootAndSettle(run, 1, 0);
    expect(shootAndSettle(run)).toBe("failed");
    expect(run.phase).toBe("review");
    expect(run.lastLevelCleared).toBe(false);
    expect(run.levelsCleared).toBe(0);
    expect(run.points).toBe(1 * 500 + 2 * 25);
  });
});

describe("victoria", () => {
  it("cae el ultimo objetivo y el nivel se cierra con el bono de punteria", () => {
    const run = labRun();
    expect(shootAndSettle(run, 2, 3)).toBe("cleared");
    expect(run.phase).toBe("review");
    expect(run.lastLevelCleared).toBe(true);
    expect(run.levelsCleared).toBe(1);
    // 2 objetivos + 3 bloques + los 2 tiros que quedaron sin usar.
    expect(run.points).toBe(2 * 500 + 3 * 25 + 2 * 300);
  });

  it("un objetivo de mas no suma: no quedan objetivos en pie", () => {
    const run = labRun();
    fireShot(run);
    registerTargetDown(run);
    registerTargetDown(run);
    registerTargetDown(run);
    expect(run.targetsDown).toBe(2);
    expect(run.targetsLeft).toBe(0);
  });

  it("se recorren los niveles hasta terminar la partida", () => {
    const plans = buildRunPlans(DEFAULT_LEVELS, RULES, createRng("abc7"));
    const run = createRun(plans, RULES);
    for (let level = 0; level < plans.length; level++) {
      const plan = plans[level];
      expect(plan).toBeDefined();
      fireShot(run);
      for (let i = 0; i < (plan?.targetCount ?? 0); i++) registerTargetDown(run);
      tickTurn(run, 16, false);
      expect(endTurn(run)).toBe("cleared");
      const more = nextLevel(run);
      expect(more).toBe(level < plans.length - 1);
    }
    expect(run.phase).toBe("done");
    expect(run.levelsCleared).toBe(5);
  });
});

describe("puntaje parcial", () => {
  it("force-end a mitad de nivel cuenta lo derribado, sin bono", () => {
    const run = labRun();
    fireShot(run);
    registerTargetDown(run);
    registerBlockDown(run);
    expect(runPoints(run)).toBe(500 + 25);
  });

  it("en review no se cuenta dos veces lo del nivel cerrado", () => {
    const run = labRun();
    shootAndSettle(run, 2, 0);
    expect(runPoints(run)).toBe(run.points);
  });
});

describe("apuntado", () => {
  it("un toque corto no dispara", () => {
    const aim = createAim();
    expect(aimFromDrag(6, 4, 260, 1200, aim)).toBe(false);
    expect(aim.power).toBe(0);
  });

  it("estirar del todo da la fuerza maxima y la direccion del arrastre", () => {
    const aim = createAim();
    // Arrastrar hacia abajo-izquierda dispara hacia arriba-derecha.
    expect(aimFromDrag(400, -400, 260, 1200, aim)).toBe(true);
    expect(aim.power).toBe(1);
    expect(Math.hypot(aim.vx, aim.vy)).toBeCloseTo(1200, 6);
    expect(aim.vx).toBeGreaterThan(0);
    expect(aim.vy).toBeLessThan(0);
    expect(Math.hypot(aim.pullX, aim.pullY)).toBeCloseTo(260, 6);
  });

  it("la fuerza es proporcional a cuanto se estiro la banda", () => {
    const aim = createAim();
    aimFromDrag(130, 0, 260, 1200, aim);
    expect(aim.power).toBeCloseTo(0.5, 6);
    expect(aim.vx).toBeCloseTo(600, 6);
  });

  it("la vista previa arranca en el punto de salida y cae con la gravedad", () => {
    const out = { x: 0, y: 0 };
    trajectoryPoint(250, 640, 800, -600, 980, 0, out);
    expect(out).toEqual({ x: 250, y: 640 });
    trajectoryPoint(250, 640, 800, -600, 980, 1, out);
    expect(out.x).toBeCloseTo(1050, 6);
    expect(out.y).toBeCloseTo(640 - 600 + 490, 6);
  });
});
