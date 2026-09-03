import { num, records, type SettingsRecord, type SettingsValues } from "@/core/contract/settings";
import type { Rng } from "@/core/engine/rng";
import {
  DEFAULT_LEVELS,
  TARGET_SIZE,
  decodeBlock,
  decodeTarget,
  type BlockData,
  type BlockMaterial,
  type LevelData,
  type TargetData,
} from "./levels";

/**
 * Todo lo de Catapulta que se puede decidir sin fisica: reglas, armado del
 * nivel, estado de la tirada, puntaje y fin de partida.
 *
 * Sin React, sin Rapier y sin DOM. La fisica resuelve QUE se cae; esto resuelve
 * que significa que se haya caido, y es lo unico que necesita test.
 */

/** Un turno no se puede evaluar en el primer frame: nada se movio todavia. */
export const MIN_TURN_MS = 350;
/** Debajo de esto es un toque, no un arrastre: no dispara. */
export const MIN_DRAG = 26;
/** Techo de cuerpos dinamicos. Con 40 apilados un telefono medio ya no llega. */
export const MAX_PIECES = 60;

export type CatapultRules = {
  shotsPerLevel: number;
  settleMs: number;
  gravity: number;
  maxLaunchSpeed: number;
  woodStrength: number;
  stoneStrength: number;
  targetStrength: number;
  pointsPerTarget: number;
  pointsPerBlock: number;
  pointsPerSpareShot: number;
};

export const DEFAULT_RULES: CatapultRules = {
  shotsPerLevel: 3,
  settleMs: 5000,
  gravity: 980,
  maxLaunchSpeed: 1200,
  woodStrength: 700,
  stoneStrength: 2400,
  targetStrength: 140,
  pointsPerTarget: 500,
  pointsPerBlock: 25,
  pointsPerSpareShot: 300,
};

export function rulesFromSettings(values: SettingsValues): CatapultRules {
  return {
    shotsPerLevel: Math.round(num(values, "shotsPerLevel", DEFAULT_RULES.shotsPerLevel)),
    settleMs: num(values, "settleMs", DEFAULT_RULES.settleMs),
    gravity: num(values, "gravity", DEFAULT_RULES.gravity),
    maxLaunchSpeed: num(values, "maxLaunchSpeed", DEFAULT_RULES.maxLaunchSpeed),
    woodStrength: num(values, "woodStrength", DEFAULT_RULES.woodStrength),
    stoneStrength: num(values, "stoneStrength", DEFAULT_RULES.stoneStrength),
    targetStrength: num(values, "targetStrength", DEFAULT_RULES.targetStrength),
    pointsPerTarget: num(values, "pointsPerTarget", DEFAULT_RULES.pointsPerTarget),
    pointsPerBlock: num(values, "pointsPerBlock", DEFAULT_RULES.pointsPerBlock),
    pointsPerSpareShot: num(values, "pointsPerSpareShot", DEFAULT_RULES.pointsPerSpareShot),
  };
}

/* ------------------------------------------------------------------ */
/* Niveles: de las filas del panel a datos utilizables                  */
/* ------------------------------------------------------------------ */

function textOf(row: SettingsRecord, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

function numberOf(row: SettingsRecord, key: string): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function listOf(row: SettingsRecord, key: string): readonly string[] {
  const value = row[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseLevels(rows: readonly SettingsRecord[]): LevelData[] {
  const out: LevelData[] = [];
  rows.forEach((row, index) => {
    const blocks: BlockData[] = [];
    for (const raw of listOf(row, "blocks")) {
      const parsed = decodeBlock(raw);
      if (parsed) blocks.push(parsed);
    }
    const targets: TargetData[] = [];
    for (const raw of listOf(row, "targets")) {
      const parsed = decodeTarget(raw);
      if (parsed) targets.push(parsed);
    }
    // Un nivel sin objetivos no se puede ganar nunca: se descarta antes de que
    // llegue al mundo, no despues de que el jugador gasto los tres tiros.
    if (targets.length === 0) return;
    out.push({
      id: "n" + (index + 1),
      name: textOf(row, "name") || "Nivel " + (index + 1),
      shots: Math.round(numberOf(row, "shots")),
      blocks,
      targets,
    });
  });
  return out;
}

export function resolveLevels(values: SettingsValues): readonly LevelData[] {
  const parsed = parseLevels(records(values, "levels"));
  return parsed.length > 0 ? parsed : DEFAULT_LEVELS;
}

/* ------------------------------------------------------------------ */
/* Armado del nivel                                                     */
/* ------------------------------------------------------------------ */

export type PieceKind = "block" | "target";

export type PiecePlan = {
  kind: PieceKind;
  material: BlockMaterial;
  /** Centro de la pieza. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Golpe acumulado que aguanta antes de romperse. */
  strength: number;
  /** 0..1 del PRNG sembrado. Solo veta y particulas: no toca la fisica. */
  grain: number;
};

export type LevelPlan = {
  id: string;
  name: string;
  shots: number;
  pieces: readonly PiecePlan[];
  targetCount: number;
};

function strengthOf(kind: PieceKind, material: BlockMaterial, rules: CatapultRules): number {
  if (kind === "target") return rules.targetStrength;
  return material === "stone" ? rules.stoneStrength : rules.woodStrength;
}

/**
 * Los niveles son fijos a proposito, asi que el PRNG no decide donde va nada:
 * solo la variacion decorativa de cada pieza. Sembrado igual, para que dos
 * maquinas dibujen la misma veta y una captura sirva de referencia.
 */
export function buildLevelPlan(
  level: LevelData,
  rules: CatapultRules,
  rng: Rng,
  maxPieces = MAX_PIECES,
): LevelPlan {
  const pieces: PiecePlan[] = [];
  // Los objetivos nunca se recortan: son la condicion de victoria.
  const blockBudget = Math.max(0, maxPieces - level.targets.length);

  for (let i = 0; i < level.blocks.length && i < blockBudget; i++) {
    const item = level.blocks[i];
    if (!item) continue;
    pieces.push({
      kind: "block",
      material: item.material,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      strength: strengthOf("block", item.material, rules),
      grain: rng.next(),
    });
  }

  for (const item of level.targets) {
    pieces.push({
      kind: "target",
      material: "wood",
      x: item.x,
      y: item.y,
      w: TARGET_SIZE,
      h: TARGET_SIZE,
      strength: strengthOf("target", "wood", rules),
      grain: rng.next(),
    });
  }

  return {
    id: level.id,
    name: level.name,
    shots: level.shots > 0 ? level.shots : rules.shotsPerLevel,
    pieces,
    targetCount: level.targets.length,
  };
}

export function buildRunPlans(
  levels: readonly LevelData[],
  rules: CatapultRules,
  rng: Rng,
): LevelPlan[] {
  return levels.map((level) => buildLevelPlan(level, rules, rng));
}

/* ------------------------------------------------------------------ */
/* Apuntado y vista previa                                              */
/* ------------------------------------------------------------------ */

export type Aim = {
  vx: number;
  vy: number;
  /** 0..1 de cuanto se estiro la banda. */
  power: number;
  angle: number;
  /** Vector de tension ya limitado, en la direccion del disparo. */
  pullX: number;
  pullY: number;
};

export function createAim(): Aim {
  return { vx: 0, vy: 0, power: 0, angle: 0, pullX: 0, pullY: 0 };
}

/**
 * `dx`/`dy` van del punto actual al punto donde se apreto: arrastrar hacia
 * atras apunta hacia adelante. Escribe sobre `out` porque esto corre por frame
 * mientras se arrastra.
 */
export function aimFromDrag(
  dx: number,
  dy: number,
  maxDrag: number,
  maxSpeed: number,
  out: Aim,
): boolean {
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < MIN_DRAG) {
    out.vx = 0;
    out.vy = 0;
    out.power = 0;
    out.angle = 0;
    out.pullX = 0;
    out.pullY = 0;
    return false;
  }
  const clamped = Math.min(length, maxDrag);
  const ux = dx / length;
  const uy = dy / length;
  out.power = clamped / maxDrag;
  out.pullX = ux * clamped;
  out.pullY = uy * clamped;
  out.vx = ux * out.power * maxSpeed;
  out.vy = uy * out.power * maxSpeed;
  out.angle = Math.atan2(uy, ux);
  return true;
}

export type Point = { x: number; y: number };

/**
 * Parabola analitica, no simulada en el motor: la vista previa solo tiene que
 * mostrar la salida del tiro, y simularla costaria un mundo entero por frame.
 */
export function trajectoryPoint(
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  gravity: number,
  t: number,
  out: Point,
): Point {
  out.x = x0 + vx * t;
  out.y = y0 + vy * t + 0.5 * gravity * t * t;
  return out;
}

/* ------------------------------------------------------------------ */
/* Puntaje                                                              */
/* ------------------------------------------------------------------ */

export type LevelTally = {
  targetsDown: number;
  blocksDown: number;
  shotsLeft: number;
  cleared: boolean;
};

export function levelPoints(tally: LevelTally, rules: CatapultRules): number {
  const targets = tally.targetsDown * rules.pointsPerTarget;
  const blocks = tally.blocksDown * rules.pointsPerBlock;
  // El bono por tiros sin usar es lo que hace al juego de punteria y no de
  // insistencia: sin el, la estrategia optima es tirar los tres siempre.
  const spare = tally.cleared ? Math.max(0, tally.shotsLeft) * rules.pointsPerSpareShot : 0;
  return targets + blocks + spare;
}

/* ------------------------------------------------------------------ */
/* Estado de la partida                                                 */
/* ------------------------------------------------------------------ */

export type TurnPhase = "aiming" | "resolving" | "review" | "done";

export type RunState = {
  rules: CatapultRules;
  plans: readonly LevelPlan[];
  levelIndex: number;
  phase: TurnPhase;
  shotsLeft: number;
  targetsLeft: number;
  /** Del nivel en curso. */
  targetsDown: number;
  blocksDown: number;
  /** De toda la partida. */
  totalTargetsDown: number;
  totalBlocksDown: number;
  shotsFired: number;
  turnMs: number;
  /** Puntos de los niveles ya cerrados. */
  points: number;
  levelsCleared: number;
  lastLevelPoints: number;
  lastLevelCleared: boolean;
};

export function createRun(plans: readonly LevelPlan[], rules: CatapultRules): RunState {
  const run: RunState = {
    rules,
    plans,
    levelIndex: 0,
    phase: "done",
    shotsLeft: 0,
    targetsLeft: 0,
    targetsDown: 0,
    blocksDown: 0,
    totalTargetsDown: 0,
    totalBlocksDown: 0,
    shotsFired: 0,
    turnMs: 0,
    points: 0,
    levelsCleared: 0,
    lastLevelPoints: 0,
    lastLevelCleared: false,
  };
  loadLevel(run);
  return run;
}

export function currentLevel(run: RunState): LevelPlan | null {
  return run.plans[run.levelIndex] ?? null;
}

/** Deja el estado listo para el nivel `levelIndex`. */
export function loadLevel(run: RunState): LevelPlan | null {
  const plan = currentLevel(run);
  if (!plan) {
    run.phase = "done";
    return null;
  }
  run.shotsLeft = plan.shots;
  run.targetsLeft = plan.targetCount;
  run.targetsDown = 0;
  run.blocksDown = 0;
  run.turnMs = 0;
  run.phase = "aiming";
  return plan;
}

export function fireShot(run: RunState): boolean {
  if (run.phase !== "aiming" || run.shotsLeft <= 0) return false;
  run.shotsLeft--;
  run.shotsFired++;
  run.turnMs = 0;
  run.phase = "resolving";
  return true;
}

export function registerBlockDown(run: RunState): void {
  run.blocksDown++;
  run.totalBlocksDown++;
}

export function registerTargetDown(run: RunState): void {
  if (run.targetsLeft <= 0) return;
  run.targetsLeft--;
  run.targetsDown++;
  run.totalTargetsDown++;
}

/**
 * El turno no se evalua hasta que el mundo se aquieta o se acaba la paciencia.
 * Un bloque tambaleandose puede caer tres segundos despues y cambiar todo.
 */
export function tickTurn(run: RunState, dtMs: number, quiet: boolean): boolean {
  if (run.phase !== "resolving") return false;
  run.turnMs += dtMs;
  // Sin objetivos en pie ya no hay nada que un escombro pueda cambiar.
  if (run.targetsLeft <= 0) return true;
  if (run.turnMs < MIN_TURN_MS) return false;
  return quiet || run.turnMs >= run.rules.settleMs;
}

export type TurnResult = "cleared" | "failed" | "aim";

export function endTurn(run: RunState): TurnResult {
  if (run.phase !== "resolving") return "aim";
  if (run.targetsLeft <= 0) {
    closeLevel(run, true);
    return "cleared";
  }
  if (run.shotsLeft <= 0) {
    closeLevel(run, false);
    return "failed";
  }
  run.turnMs = 0;
  run.phase = "aiming";
  return "aim";
}

function closeLevel(run: RunState, cleared: boolean): void {
  const gained = levelPoints(
    {
      targetsDown: run.targetsDown,
      blocksDown: run.blocksDown,
      shotsLeft: run.shotsLeft,
      cleared,
    },
    run.rules,
  );
  run.points += gained;
  run.lastLevelPoints = gained;
  run.lastLevelCleared = cleared;
  if (cleared) run.levelsCleared++;
  run.phase = "review";
}

/** true si arranco otro nivel; false si la partida termino. */
export function nextLevel(run: RunState): boolean {
  if (run.phase !== "review") return false;
  run.levelIndex++;
  if (run.levelIndex >= run.plans.length) {
    run.phase = "done";
    return false;
  }
  loadLevel(run);
  return true;
}

/**
 * Puntos de la partida en cualquier momento, incluido `force-end` a mitad de un
 * nivel: lo derribado hasta ahi cuenta, el bono por punteria no.
 */
export function runPoints(run: RunState): number {
  if (run.phase === "review" || run.phase === "done") return run.points;
  return (
    run.points +
    levelPoints(
      { targetsDown: run.targetsDown, blocksDown: run.blocksDown, shotsLeft: 0, cleared: false },
      run.rules,
    )
  );
}

export function runMeta(run: RunState): Record<string, unknown> {
  return {
    nivelesSuperados: run.levelsCleared,
    nivelesTotales: run.plans.length,
    tirosUsados: run.shotsFired,
    objetivosDerribados: run.totalTargetsDown,
    bloquesDerribados: run.totalBlocksDown,
  };
}
