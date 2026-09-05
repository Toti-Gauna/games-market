import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import {
  MAX_PLAYERS,
  WEAPON_ASPERSOR,
  WEAPON_CANON,
  WEAPON_MANGUERA,
  WEAPON_PISTOLA,
  createShooterMap,
  terrainHeight,
  type Mountain,
  type ShooterMap,
} from "./map";
import {
  CAR_ENTITY_BASE,
  DEFAULT_RULES,
  EVENT_CAR,
  EVENT_CHEST,
  EVENT_DEPLOYED,
  EVENT_HIT,
  EVENT_KILL,
  EVENT_OVER,
  EVENT_RING_PHASE,
  EYE_HEIGHT,
  HP_MAX,
  LAG_COMP_TICKS,
  MAX_WALK_SLOPE,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  RING_SCHEDULE,
  RING_START_RADIUS,
  SKIN_COUNT,
  S_SKINS_A,
  S_SKINS_B,
  activateSeat,
  botThink,
  createInput,
  createMutableSnapshot,
  createShooterWorld,
  damageFalloff,
  enterCar,
  entityHp,
  fireHitscan,
  groundHeight,
  hasLineOfSight,
  markHuman,
  placementOf,
  rayBox,
  rayCapsule,
  readCar,
  readEntity,
  ringDistance,
  setInput,
  shooterPoints,
  simulateBody,
  snapshotChestOpened,
  snapshotSkin,
  snapshotWeapon,
  stepVehicle,
  stepWorld,
  terrainBlocks,
  weaponSpec,
  writeSnapshot,
  type CarBody,
  type PlayerBody,
  type ShooterInput,
  type ShooterWorld,
} from "./logic";
import { SEAT_TOKENS } from "./view";

const STEP = 1 / 60;

function freshMap(seed = "arena"): ShooterMap {
  return createShooterMap(createRng(seed));
}

/**
 * Un mapa llano: el mismo generador, sin montanias ni rocas ni cofres ni
 * autos. Queda la ondulacion del pasto (+-0.5), que es lo que los tests de
 * geometria tienen que tolerar apuntando en vez de asumir piso cero.
 */
function flatMap(seed = "llano", patch: Partial<ShooterMap> = {}): ShooterMap {
  const base = freshMap(seed);
  return { ...base, mountains: [], cover: [], chests: [], cars: [], ...patch };
}

/**
 * Una partida con `count` asientos activos, los primeros `humans` como
 * personas (sin bot que los mueva ni les dispare).
 *
 * Los tests de geometria activan de a dos: con diez bots sueltos el humano
 * del test muere a los tiros antes de terminar la medicion, y lo que se
 * queria probar era el rayo, no la punteria de los bots.
 */
function freshWorld(seed = "arena", humans = 0, count = MAX_PLAYERS, map?: ShooterMap): ShooterWorld {
  const world = createShooterWorld(map ?? freshMap(seed), DEFAULT_RULES);
  for (let seat = 0; seat < count; seat++) {
    activateSeat(world, seat);
    if (seat < humans) markHuman(world, seat, true);
  }
  return world;
}

/** Dos puntos del llano, separados 4,5 unidades sobre el eje z. */
const LANE_SHOOTER = { x: 0, z: 30 };
const LANE_VICTIM = { x: 0, z: 25.5 };

function body(map: ShooterMap, x: number, z: number, yaw = 0): PlayerBody {
  return { x, y: terrainHeight(map, x, z), z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, onGround: true };
}

/** Deja a un asiento en un lugar exacto, sobre el terreno, mirando hacia donde se le diga. */
function place(world: ShooterWorld, seat: number, x: number, z: number, yaw: number, y?: number): void {
  world.x[seat] = x;
  world.y[seat] = y ?? terrainHeight(world.map, x, z);
  world.z[seat] = z;
  world.yaw[seat] = yaw;
  world.pitch[seat] = 0;
  world.inYaw[seat] = yaw;
  world.inPitch[seat] = 0;
  world.onGround[seat] = 1;
}

/** Apunta a un asiento al pecho de otro: rumbo e inclinacion. */
function aimAt(world: ShooterWorld, shooter: number, victim: number): void {
  const sx = world.x[shooter] ?? 0;
  const sz = world.z[shooter] ?? 0;
  const vx = world.x[victim] ?? 0;
  const vz = world.z[victim] ?? 0;
  const yaw = yawTowards(sx, sz, vx, vz);
  const dy = (world.y[victim] ?? 0) + 1.0 - ((world.y[shooter] ?? 0) + EYE_HEIGHT);
  const pitch = Math.atan2(dy, Math.hypot(vx - sx, vz - sz));
  world.yaw[shooter] = yaw;
  world.pitch[shooter] = pitch;
  world.inYaw[shooter] = yaw;
  world.inPitch[shooter] = pitch;
}

/** Sin despliegue: la partida arranca jugando. */
function skipDeploy(world: ShooterWorld): void {
  world.phase = "playing";
  world.deployLeft = 0;
}

/** Yaw que apunta desde (fx, fz) a (tx, tz) con la convencion de three. */
function yawTowards(fx: number, fz: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - fx), -(tz - fz));
}

const humanInput = (patch: Partial<ShooterInput>): ShooterInput => ({ ...createInput(), ...patch });

/** Un cerro que se sube (alto/radio 0,5) y una penia que no (1,3). */
const GENTLE: Mountain = { x: 0, z: 0, radius: 20, height: 10 };
const STEEP: Mountain = { x: 0, z: 0, radius: 20, height: 26 };

/* ------------------------------------------------------------------ */

describe("determinismo", () => {
  it("la misma semilla y los mismos inputs dan la misma partida", () => {
    const run = (): number[] => {
      const world = freshWorld("det");
      const rng = createRng("det");
      const trace: number[] = [];
      for (let i = 0; i < 600; i++) {
        stepWorld(world, STEP, rng);
        if (i % 60 === 0) {
          for (let seat = 0; seat < MAX_PLAYERS; seat++) {
            trace.push(Math.round((world.x[seat] ?? 0) * 100), Math.round((world.hp[seat] ?? 0) * 10));
          }
        }
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });

  it("semillas distintas divergen", () => {
    const a = freshWorld("uno");
    const b = freshWorld("dos");
    const ra = createRng("uno");
    const rb = createRng("dos");
    for (let i = 0; i < 300; i++) {
      stepWorld(a, STEP, ra);
      stepWorld(b, STEP, rb);
    }
    expect(Array.from(a.x)).not.toEqual(Array.from(b.x));
  });
});

describe("movimiento", () => {
  it("adelante es hacia donde mira, con la convencion de camara de three", () => {
    const map = flatMap();
    // Yaw 0 mira hacia -z.
    const b = body(map, 0, 20, 0);
    simulateBody(b, humanInput({ my: 1 }), STEP, map, DEFAULT_RULES, true);
    expect(b.z).toBeLessThan(20);
    expect(Math.abs(b.x)).toBeLessThan(1e-6);
  });

  it("la diagonal no va mas rapido que el frente", () => {
    const map = flatMap();
    const straight = body(map, 0, 20, 0);
    const diagonal = body(map, 0, 20, 0);
    for (let i = 0; i < 30; i++) {
      simulateBody(straight, humanInput({ my: 1 }), STEP, map, DEFAULT_RULES, true);
      simulateBody(diagonal, humanInput({ my: 1, mx: 1 }), STEP, map, DEFAULT_RULES, true);
    }
    const ds = Math.hypot(straight.x, straight.z - 20);
    const dd = Math.hypot(diagonal.x, diagonal.z - 20);
    expect(dd).toBeCloseTo(ds, 3);
  });

  it("no atraviesa una roca", () => {
    const base = flatMap();
    const ground = terrainHeight(base, 0, 20);
    const rock = { x: 0, y: ground + 1.5 - 0.25, z: 20, w: 4, h: 3, d: 2 };
    const map = { ...base, cover: [rock] };
    // Arranca apenas al lado de la roca, empujando hacia adentro. Yaw -90
    // mira hacia +x: adelante = (-sin yaw, -cos yaw).
    const b = body(map, rock.x - rock.w / 2 - PLAYER_RADIUS - 0.2, rock.z, -Math.PI / 2);
    const input = humanInput({ my: 1, yaw: -Math.PI / 2 });
    for (let i = 0; i < 120; i++) simulateBody(b, input, STEP, map, DEFAULT_RULES, true);
    expect(b.x + PLAYER_RADIUS).toBeLessThanOrEqual(rock.x - rock.w / 2 + 0.05);
  });

  it("no sale del mapa", () => {
    const map = flatMap();
    const b = body(map, 0, 0, Math.PI); // adelante = (0, +1)
    const input = humanInput({ my: 1, yaw: Math.PI });
    for (let i = 0; i < 2400; i++) simulateBody(b, input, STEP, map, DEFAULT_RULES, true);
    expect(b.z).toBeLessThan(map.size / 2);
  });

  it("salta y vuelve a caer sobre el terreno", () => {
    const map = flatMap();
    const b = body(map, 0, 25, 0);
    const floor = b.y;
    simulateBody(b, humanInput({ jump: true }), STEP, map, DEFAULT_RULES, true);
    expect(b.vy).toBeGreaterThan(0);
    expect(b.onGround).toBe(false);
    let apex = floor;
    for (let i = 0; i < 120; i++) {
      simulateBody(b, humanInput({}), STEP, map, DEFAULT_RULES, true);
      if (b.y > apex) apex = b.y;
    }
    expect(apex - floor).toBeGreaterThan(0.8);
    expect(b.y).toBeCloseTo(floor, 3);
    expect(b.onGround).toBe(true);
  });

  it("una roca sostiene desde arriba y bloquea desde el costado", () => {
    const base = flatMap();
    const ground = terrainHeight(base, 10, -10);
    const rock = { x: 10, y: ground + 2 - 0.25, z: -10, w: 6, h: 4, d: 3 };
    const map = { ...base, cover: [rock] };
    const top = rock.y + rock.h / 2;
    // Desde arriba: cae sobre la tapa.
    expect(groundHeight(map, rock.x, rock.z, top + 2)).toBeCloseTo(top, 5);
    // Desde abajo: el piso es el terreno.
    expect(groundHeight(map, rock.x, rock.z, ground)).toBeCloseTo(ground, 5);
    // Y caminando de frente contra ella, no se entra.
    const b = body(map, rock.x - rock.w / 2 - 2, rock.z, -Math.PI / 2);
    const input = humanInput({ my: 1, yaw: -Math.PI / 2 });
    for (let i = 0; i < 120; i++) simulateBody(b, input, STEP, map, DEFAULT_RULES, true);
    expect(b.x + PLAYER_RADIUS).toBeLessThanOrEqual(rock.x - rock.w / 2 + 0.05);
    expect(b.y).toBeLessThan(top - 1);
  });

  it("durante el despliegue no se mueve ni dispara", () => {
    const world = freshWorld("deploy", 1);
    const rng = createRng("deploy");
    const x0 = world.x[0] ?? 0;
    setInput(world, 0, humanInput({ my: 1, fire: true }));
    for (let i = 0; i < 30; i++) stepWorld(world, STEP, rng);
    expect(world.x[0]).toBeCloseTo(x0, 5);
    expect(world.shots[0]).toBe(0);
    expect(world.phase).toBe("deploy");
  });

  it("el despliegue dura lo que dice la regla y avisa al terminar", () => {
    const world = freshWorld("deploy2");
    const rng = createRng("deploy2");
    let deployed = false;
    for (let i = 0; i < DEFAULT_RULES.deploySeconds * 60 + 2; i++) {
      if (stepWorld(world, STEP, rng) & EVENT_DEPLOYED) deployed = true;
    }
    expect(deployed).toBe(true);
    expect(world.phase).toBe("playing");
  });

  it("un input absurdo de un celular no rompe nada", () => {
    const world = freshWorld("nan", 1);
    setInput(world, 0, {
      mx: Number.NaN,
      my: 99,
      yaw: Number.POSITIVE_INFINITY,
      pitch: 9,
      fire: false,
      jump: false,
      interact: false,
      reload: false,
      skin: 99,
    });
    expect(world.inMx[0]).toBe(0);
    expect(world.inMy[0]).toBe(1);
    // Un color fuera de la paleta se ignora: se queda con el del asiento.
    expect(world.skin[0]).toBe(0);
    // Float32: 1.45 guardado vuelve como 1.4500000476.
    expect(world.inPitch[0]).toBeLessThanOrEqual(1.45 + 1e-6);
    expect(Number.isFinite(world.inYaw[0] ?? 0)).toBe(true);
  });
});

describe("terreno", () => {
  it("un cerro suave se sube caminando hasta la cima", () => {
    const map = flatMap("cerro", { mountains: [GENTLE] });
    // Desde el sur, caminando hacia el centro (yaw 0 = hacia -z).
    const b = body(map, 0, 30, 0);
    const input = humanInput({ my: 1, yaw: 0 });
    let highest = b.y;
    // 290 pasos a 6,5 u/s son ~31 unidades: justo la cima, no la bajada.
    for (let i = 0; i < 290; i++) {
      simulateBody(b, input, STEP, map, DEFAULT_RULES, true);
      if (b.y > highest) highest = b.y;
    }
    expect(highest).toBeGreaterThan(GENTLE.height * 0.85);
    expect(Math.abs(b.z)).toBeLessThan(4);
    // Sigue apoyado en el suelo, no flotando ni enterrado.
    expect(b.y).toBeCloseTo(groundHeight(map, b.x, b.z, b.y), 2);
  });

  it("una ladera empinada es pared: se llega al pie y no mas", () => {
    const map = flatMap("penia", { mountains: [STEEP] });
    const b = body(map, 0, 30, 0);
    const input = humanInput({ my: 1, yaw: 0 });
    for (let i = 0; i < 600; i++) simulateBody(b, input, STEP, map, DEFAULT_RULES, true);
    // La pendiente supera el maximo antes de la sexta parte del radio: el
    // cuerpo se queda en la falda, lejos de la cima.
    expect(Math.hypot(b.x, b.z)).toBeGreaterThan(STEEP.radius * 0.7);
    expect(b.y).toBeLessThan(4);
  });

  it("terrainBlocks distingue pendiente transitable de acantilado", () => {
    const map = flatMap("bloqueo", { mountains: [STEEP] });
    const run = 0.1;
    // En la falda (t chico) la pendiente es suave y se pasa.
    const farZ = 19.5;
    const farGround = terrainHeight(map, 0, farZ);
    expect(terrainBlocks(map, 0, farZ, farGround, 0, farZ - run, farGround)).toBe(false);
    // A media ladera la pendiente es 1,5 * alto/radio = 1,95 > MAX_WALK_SLOPE.
    const midZ = 10;
    const midGround = terrainHeight(map, 0, midZ);
    expect(terrainBlocks(map, 0, midZ, midGround, 0, midZ - run, midGround)).toBe(true);
    expect(MAX_WALK_SLOPE).toBeLessThan(1.95);
    // Volando por encima del terreno destino no hay con que chocar.
    expect(terrainBlocks(map, 0, midZ, midGround, 0, midZ - run, midGround + 5)).toBe(false);
  });

  it("bajando una ladera el cuerpo queda pegado al suelo", () => {
    const map = flatMap("bajada", { mountains: [GENTLE] });
    // Arranca cerca de la cima, caminando hacia afuera (yaw PI = hacia +z).
    const b = body(map, 0, -2, Math.PI);
    const input = humanInput({ my: 1, yaw: Math.PI });
    let airborne = 0;
    for (let i = 0; i < 300; i++) {
      simulateBody(b, input, STEP, map, DEFAULT_RULES, true);
      if (!b.onGround) airborne++;
    }
    expect(airborne).toBeLessThan(5);
    expect(b.z).toBeGreaterThan(GENTLE.radius);
  });
});

describe("hitscan", () => {
  it("el rayo entra en una caja por el punto correcto y no la toca de costado", () => {
    const box = { x: 10, y: 1, z: 0, w: 2, h: 2, d: 2 };
    expect(rayBox(0, 1, 0, 1, 0, 0, box)).toBeCloseTo(9, 5);
    expect(rayBox(0, 1, 5, 1, 0, 0, box)).toBe(-1);
    expect(rayBox(20, 1, 0, 1, 0, 0, box)).toBe(-1); // detras
  });

  it("la capsula distingue cuerpo de cabeza", () => {
    const out = new Float32Array(1);
    const bodyHit = rayCapsule(0, 1.0, 0, 1, 0, 0, 10, 0, 0, out);
    expect(bodyHit).toBeGreaterThan(9);
    expect(out[0]).toBe(0);
    const headHit = rayCapsule(0, PLAYER_HEIGHT - 0.1, 0, 1, 0, 0, 10, 0, 0, out);
    expect(headHit).toBeGreaterThan(9);
    expect(out[0]).toBe(1);
    expect(rayCapsule(0, PLAYER_HEIGHT + 0.5, 0, 1, 0, 0, 10, 0, 0, out)).toBe(-1);
    expect(rayCapsule(0, 1, 2, 1, 0, 0, 10, 0, 0, out)).toBe(-1);
  });

  it("un disparo de frente pega y hace dano de cuerpo", () => {
    const world = freshWorld("hit", 2, 2, flatMap("hit"));
    skipDeploy(world);
    place(world, 0, LANE_SHOOTER.x, LANE_SHOOTER.z, 0);
    place(world, 1, LANE_VICTIM.x, LANE_VICTIM.z, 0);
    aimAt(world, 0, 1);
    const hit = fireHitscan(world, 0, 0);
    expect(hit).toBe(1);
    expect(world.hp[1]).toBe(HP_MAX - DEFAULT_RULES.bodyDamage);
    expect(world.damage[0]).toBe(DEFAULT_RULES.bodyDamage);
  });

  it("una roca tapa el tiro", () => {
    const base = flatMap("cover");
    const ground = terrainHeight(base, 0, 20);
    const rock = { x: 0, y: ground + 1.5 - 0.25, z: 20, w: 4, h: 3, d: 2 };
    const world = freshWorld("cover", 2, 2, { ...base, cover: [rock] });
    skipDeploy(world);
    place(world, 0, rock.x - rock.w / 2 - 6, rock.z, 0);
    place(world, 1, rock.x + rock.w / 2 + 6, rock.z, 0);
    aimAt(world, 0, 1);
    expect(fireHitscan(world, 0, 0)).toBe(-1);
    expect(hasLineOfSight(world, 0, 1)).toBe(false);
  });

  it("una montania tapa el tiro y la linea de vision", () => {
    const world = freshWorld("monte", 2, 2, flatMap("monte", { mountains: [{ x: 0, z: 0, radius: 12, height: 12 }] }));
    skipDeploy(world);
    // Uno a cada lado de la montania, a la misma altura de pasto.
    place(world, 0, 0, 16, 0);
    place(world, 1, 0, -16, 0);
    aimAt(world, 0, 1);
    expect(fireHitscan(world, 0, 0)).toBe(-1);
    expect(hasLineOfSight(world, 0, 1)).toBe(false);
    // Sin la montania, se ven.
    const open = freshWorld("monte2", 2, 2, flatMap("monte"));
    skipDeploy(open);
    place(open, 0, 0, 16, 0);
    place(open, 1, 0, -16, 0);
    expect(hasLineOfSight(open, 0, 1)).toBe(true);
  });

  it("la compensacion de latencia pega donde el tirador VIO al rival", () => {
    const world = freshWorld("lag", 2, 2, flatMap("lag"));
    skipDeploy(world);
    const rng = createRng("lag");
    place(world, 0, LANE_SHOOTER.x, LANE_SHOOTER.z, 0);
    place(world, 1, LANE_VICTIM.x, LANE_VICTIM.z, -Math.PI / 2);
    aimAt(world, 0, 1);
    // La victima corre en +x; el tirador le apunta a donde estaba.
    setInput(world, 1, humanInput({ my: 1, yaw: -Math.PI / 2 }));
    for (let i = 0; i < LAG_COMP_TICKS + 2; i++) stepWorld(world, STEP, rng);
    expect(world.x[1]).toBeGreaterThan(PLAYER_RADIUS);
    expect(fireHitscan(world, 0, 0)).toBe(-1);
    expect(fireHitscan(world, 0, LAG_COMP_TICKS)).toBe(1);
  });

  it("la cadencia y el cargador se respetan", () => {
    // Dos personas, no una: con un solo vivo la partida termina en el primer
    // paso, que es exactamente lo que debe pasar y lo que no se quiere medir.
    const world = freshWorld("rate", 2, 2, flatMap("rate"));
    skipDeploy(world);
    const rng = createRng("rate");
    place(world, 0, 0, 30, Math.PI);
    place(world, 1, -60, 60, 0);
    setInput(world, 0, humanInput({ fire: true, yaw: Math.PI }));
    for (let i = 0; i < 60; i++) stepWorld(world, STEP, rng);
    // Un segundo a 150 ms por tiro: siete tiros, no sesenta.
    expect(world.shots[0]).toBeLessThanOrEqual(7);
    expect(world.shots[0]).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < 60 * 4; i++) stepWorld(world, STEP, rng);
    // A los 20 tiros recarga sola y sigue.
    expect(world.shots[0]).toBeGreaterThan(DEFAULT_RULES.magazine);
    expect(world.reload[0] ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe("armas", () => {
  it("la pistola sale de las reglas y las de cofre son fijas", () => {
    const pistol = weaponSpec(DEFAULT_RULES, WEAPON_PISTOLA);
    expect(pistol.name).toBe("Pistola");
    expect(pistol.magazine).toBe(DEFAULT_RULES.magazine);
    expect(pistol.bodyDamage).toBe(DEFAULT_RULES.bodyDamage);
    const custom = weaponSpec({ ...DEFAULT_RULES, magazine: 7, bodyDamage: 33 }, WEAPON_PISTOLA);
    expect(custom.magazine).toBe(7);
    expect(custom.bodyDamage).toBe(33);
    // Las de cofre no leen las reglas.
    expect(weaponSpec({ ...DEFAULT_RULES, magazine: 7 }, WEAPON_CANON).magazine).toBe(4);
    expect(weaponSpec(DEFAULT_RULES, WEAPON_ASPERSOR).rays).toBe(5);
    expect(weaponSpec(DEFAULT_RULES, WEAPON_MANGUERA).fireIntervalS).toBeCloseTo(0.07, 6);
    // Un indice absurdo vuelve a la pistola, nunca a undefined.
    expect(weaponSpec(DEFAULT_RULES, 99).kind).toBe(WEAPON_PISTOLA);
  });

  it("el dano cae con la distancia hasta el alcance", () => {
    const pistol = weaponSpec(DEFAULT_RULES, WEAPON_PISTOLA);
    expect(damageFalloff(pistol, 0)).toBe(1);
    expect(damageFalloff(pistol, pistol.maxRange * 0.7)).toBe(1);
    expect(damageFalloff(pistol, pistol.maxRange * 0.85)).toBeCloseTo(0.5, 5);
    expect(damageFalloff(pistol, pistol.maxRange)).toBe(0);
  });

  it("mas alla del alcance el agua no llega, y el canion llega mas lejos", () => {
    const world = freshWorld("range", 2, 2, flatMap("range"));
    skipDeploy(world);
    place(world, 0, 0, 30, 0);
    place(world, 1, 0, 0, 0); // a 30 unidades
    aimAt(world, 0, 1);
    expect(fireHitscan(world, 0, 0)).toBe(-1); // pistola: 22
    world.weapon[0] = WEAPON_CANON;
    expect(fireHitscan(world, 0, 0)).toBe(1); // canion: 40
  });

  it("cada arma tiene su cadencia", () => {
    const run = (kind: number): number => {
      const world = freshWorld("cadencia", 2, 2, flatMap("cadencia"));
      skipDeploy(world);
      const rng = createRng("cadencia");
      place(world, 0, 0, 30, Math.PI);
      place(world, 1, -60, 60, 0);
      world.weapon[0] = kind;
      world.ammo[0] = 40;
      setInput(world, 0, humanInput({ fire: true, yaw: Math.PI }));
      for (let i = 0; i < 60; i++) stepWorld(world, STEP, rng);
      return world.shots[0] ?? 0;
    };
    // 70 ms a pasos de 16,7 ms son cinco pasos por tiro: doce por segundo.
    expect(run(WEAPON_MANGUERA)).toBeGreaterThanOrEqual(11);
    expect(run(WEAPON_CANON)).toBeLessThanOrEqual(1);
    expect(run(WEAPON_ASPERSOR)).toBeLessThanOrEqual(2);
  });

  it("el aspersor rocia varios rayos y pega mas de una vez de cerca", () => {
    const world = freshWorld("spray", 2, 2, flatMap("spray"));
    skipDeploy(world);
    const rng = createRng("spray");
    place(world, 0, 0, 30, 0);
    place(world, 1, 0, 26.5, 0);
    world.weapon[0] = WEAPON_ASPERSOR;
    world.ammo[0] = 6;
    aimAt(world, 0, 1);
    // Una persona dispara con compensacion de latencia: la historia de
    // posiciones tiene que estar llena, como en una partida real.
    setInput(world, 0, humanInput({ yaw: world.yaw[0] ?? 0, pitch: world.pitch[0] ?? 0 }));
    for (let i = 0; i < 12; i++) stepWorld(world, STEP, rng);
    setInput(world, 0, humanInput({ fire: true, yaw: world.yaw[0] ?? 0, pitch: world.pitch[0] ?? 0 }));
    stepWorld(world, STEP, rng);
    expect(world.shotCount).toBe(5);
    expect(world.hits[0]).toBeGreaterThanOrEqual(2);
    expect(world.hp[1]).toBeLessThan(HP_MAX - 14);
  });
});

describe("cofres", () => {
  function chestMap(seed: string): ShooterMap {
    const base = flatMap(seed);
    return { ...base, chests: [{ x: 0, z: 0, y: terrainHeight(base, 0, 0), weapon: WEAPON_CANON }] };
  }

  it("abrirlo da el arma con el cargador lleno y marca el bit", () => {
    const world = freshWorld("cofre", 2, 2, chestMap("cofre"));
    skipDeploy(world);
    const rng = createRng("cofre");
    place(world, 0, 1.2, 0, 0);
    place(world, 1, 40, 40, 0);
    setInput(world, 0, humanInput({ interact: true }));
    const events = stepWorld(world, STEP, rng);
    expect(events & EVENT_CHEST).not.toBe(0);
    expect(world.chestOpened & 1).toBe(1);
    expect(world.weapon[0]).toBe(WEAPON_CANON);
    expect(world.ammo[0]).toBe(weaponSpec(DEFAULT_RULES, WEAPON_CANON).magazine);
    expect(world.chestEventSeat[0]).toBe(0);
  });

  it("dos personas en el mismo paso: lo abre una sola", () => {
    const world = freshWorld("dos", 2, 2, chestMap("dos"));
    skipDeploy(world);
    const rng = createRng("dos");
    place(world, 0, 1.2, 0, 0);
    place(world, 1, -1.2, 0, 0);
    setInput(world, 0, humanInput({ interact: true }));
    setInput(world, 1, humanInput({ interact: true }));
    stepWorld(world, STEP, rng);
    const winners = [world.weapon[0], world.weapon[1]].filter((w) => w === WEAPON_CANON).length;
    expect(winners).toBe(1);
    expect(world.chestEventCount).toBe(1);
    // Y lejos del cofre, interactuar no hace nada.
    place(world, 1, 30, 30, 0);
    setInput(world, 1, humanInput({ interact: true }));
    stepWorld(world, STEP, rng);
    expect(world.chestOpened).toBe(1);
  });

  it("el bit de abierto persiste y viaja en el snapshot", () => {
    const world = freshWorld("bit", 2, 2, chestMap("bit"));
    skipDeploy(world);
    const rng = createRng("bit");
    place(world, 0, 1, 0, 0);
    place(world, 1, 40, 40, 0);
    setInput(world, 0, humanInput({ interact: true }));
    for (let i = 0; i < 30; i++) stepWorld(world, STEP, rng);
    expect(world.chestOpened & 1).toBe(1);
    const snapshot = createMutableSnapshot();
    writeSnapshot(world, snapshot, 0);
    expect(snapshotChestOpened(snapshot, 0)).toBe(true);
    expect(snapshotChestOpened(snapshot, 1)).toBe(false);
    expect(snapshotWeapon(snapshot, 0)).toBe(WEAPON_CANON);
    expect(snapshotWeapon(snapshot, 1)).toBe(WEAPON_PISTOLA);
  });
});

describe("vehiculo", () => {
  function carMap(seed: string, patch: Partial<ShooterMap> = {}): ShooterMap {
    return flatMap(seed, { cars: [{ x: 0, z: 0, yaw: 0 }], ...patch });
  }

  it("acelera hacia adelante, gira segun la velocidad y frena solo", () => {
    const world = freshWorld("auto", 2, 2, carMap("auto"));
    skipDeploy(world);
    // Quieto no gira; en marcha, si.
    stepVehicle(world, 0, 0, 1, STEP);
    expect(world.carYaw[0]).toBeCloseTo(0, 6);
    world.carSpeed[0] = 20;
    stepVehicle(world, 0, 0, 1, STEP);
    expect(world.carYaw[0]).toBeLessThan(0);
    // Acelerando avanza hacia -z (yaw 0) y gana velocidad.
    world.carYaw[0] = 0;
    world.carSpeed[0] = 0;
    world.carX[0] = 0;
    world.carZ[0] = 0;
    for (let i = 0; i < 60; i++) stepVehicle(world, 0, 1, 0, STEP);
    expect(world.carSpeed[0]).toBeGreaterThan(5);
    expect(world.carZ[0]).toBeLessThan(-2);
    // Sin acelerador, roza hasta parar.
    const before = world.carSpeed[0] ?? 0;
    for (let i = 0; i < 300; i++) stepVehicle(world, 0, 0, 0, STEP);
    expect(world.carSpeed[0]).toBeLessThan(before * 0.2);
  });

  it("no entra en el nucleo de una montania ni sale del mapa", () => {
    const mountain: Mountain = { x: 0, z: -40, radius: 20, height: 12 };
    const world = freshWorld("choque", 2, 2, carMap("choque", { mountains: [mountain] }));
    skipDeploy(world);
    for (let i = 0; i < 400; i++) stepVehicle(world, 0, 1, 0, STEP);
    const d = Math.hypot((world.carX[0] ?? 0) - mountain.x, (world.carZ[0] ?? 0) - mountain.z);
    expect(d).toBeGreaterThanOrEqual(mountain.radius * 0.55 - 0.01);
    // Hacia el borde: se frena contra el murete.
    world.carYaw[0] = Math.PI; // adelante = +z
    for (let i = 0; i < 1200; i++) stepVehicle(world, 0, 1, 0, STEP);
    expect(world.carZ[0]).toBeLessThan(world.map.size / 2);
  });

  it("se sube con interactuar, el cuerpo viaja con el auto y se baja al costado", () => {
    const world = freshWorld("subir", 2, 2, carMap("subir"));
    skipDeploy(world);
    const rng = createRng("subir");
    place(world, 0, 2, 0, 0);
    place(world, 1, 60, 60, 0);
    setInput(world, 0, humanInput({ interact: true }));
    const events = stepWorld(world, STEP, rng);
    expect(events & EVENT_CAR).not.toBe(0);
    expect(world.driving[0]).toBe(0);
    expect(world.carDriver[0]).toBe(0);
    // Acelera: el auto y el cuerpo se mueven juntos hacia -z.
    setInput(world, 0, humanInput({ my: 1 }));
    for (let i = 0; i < 90; i++) stepWorld(world, STEP, rng);
    expect(world.carZ[0]).toBeLessThan(-3);
    expect(world.x[0]).toBeCloseTo(world.carX[0] ?? 0, 4);
    expect(world.z[0]).toBeCloseTo(world.carZ[0] ?? 0, 4);
    // Manejando no dispara.
    setInput(world, 0, humanInput({ fire: true }));
    stepWorld(world, STEP, rng);
    expect(world.shots[0]).toBe(0);
    // Se baja al costado, sobre el terreno, y el auto queda libre.
    setInput(world, 0, humanInput({ interact: true }));
    stepWorld(world, STEP, rng);
    expect(world.driving[0]).toBe(-1);
    expect(world.carDriver[0]).toBe(-1);
    const d = Math.hypot((world.x[0] ?? 0) - (world.carX[0] ?? 0), (world.z[0] ?? 0) - (world.carZ[0] ?? 0));
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(4);
  });

  it("un auto ocupado no se comparte y el cofre gana al auto", () => {
    const base = carMap("ocupado");
    const world = freshWorld("ocupado", 3, 3, {
      ...base,
      chests: [{ x: 3, z: 0, y: terrainHeight(base, 3, 0), weapon: WEAPON_MANGUERA }],
    });
    skipDeploy(world);
    place(world, 0, 1, 0, 0);
    place(world, 1, -1, 0, 0);
    place(world, 2, 60, 60, 0);
    expect(enterCar(world, 0, 0)).toBe(true);
    expect(enterCar(world, 1, 0)).toBe(false);
    // El asiento 2 llega con auto y cofre al alcance: abre el cofre.
    const rng = createRng("ocupado");
    world.carDriver[0] = -1;
    world.driving[0] = -1;
    place(world, 2, 2, 0, 0);
    setInput(world, 2, humanInput({ interact: true }));
    stepWorld(world, STEP, rng);
    expect(world.weapon[2]).toBe(WEAPON_MANGUERA);
    expect(world.driving[2]).toBe(-1);
  });

  it("un chofer muerto suelta el auto", () => {
    const world = freshWorld("volante", 2, 2, carMap("volante"));
    skipDeploy(world);
    place(world, 0, 1, 0, 0);
    enterCar(world, 0, 0);
    world.x[0] = 0;
    world.z[0] = 0;
    world.y[0] = terrainHeight(world.map, 0, 0) + 0.3;
    place(world, 1, 0, 6, 0);
    aimAt(world, 1, 0);
    for (let i = 0; i < 4; i++) fireHitscan(world, 1, 0);
    expect(world.alive[0]).toBe(0);
    expect(world.carDriver[0]).toBe(-1);
    expect(world.driving[0]).toBe(-1);
  });
});

describe("muerte, anillo y final", () => {
  it("cuatro tiros al cuerpo matan y asignan el puesto", () => {
    const world = freshWorld("kill", 2, 2, flatMap("kill"));
    skipDeploy(world);
    place(world, 0, LANE_SHOOTER.x, LANE_SHOOTER.z, 0);
    place(world, 1, LANE_VICTIM.x, LANE_VICTIM.z, 0);
    aimAt(world, 0, 1);
    for (let i = 0; i < 4; i++) fireHitscan(world, 0, 0);
    expect(world.alive[1]).toBe(0);
    expect(world.placement[1]).toBe(2);
    expect(world.kills[0]).toBe(1);
    expect(world.killer[1]).toBe(0);
    expect(world.aliveCount).toBe(1);
    expect(world.events & EVENT_KILL).not.toBe(0);
    expect(world.events & EVENT_HIT).not.toBe(0);
  });

  it("el anillo cierra segun el cronograma y hace dano afuera", () => {
    // Diez personas quietas y sin disparar: lo unico que pasa es el anillo.
    const world = freshWorld("ring", MAX_PLAYERS);
    const rng = createRng("ring");
    expect(world.ringRadius).toBe(RING_START_RADIUS);
    let phases = 0;
    const first = RING_SCHEDULE[0]!;
    const untilShrunk = (DEFAULT_RULES.deploySeconds + first.at + first.shrink + 1) * 60;
    for (let i = 0; i < untilShrunk; i++) {
      if (stepWorld(world, STEP, rng) & EVENT_RING_PHASE) phases++;
    }
    expect(phases).toBe(1);
    expect(world.ringRadius).toBeCloseTo(RING_START_RADIUS * first.radius, 3);
    let outside = -1;
    let inside = -1;
    for (let seat = 0; seat < MAX_PLAYERS; seat++) {
      const d = ringDistance(world, world.x[seat] ?? 0, world.z[seat] ?? 0);
      if (d > 0 && outside < 0) outside = seat;
      if (d < -2 && inside < 0) inside = seat;
    }
    if (outside >= 0) expect(world.hp[outside]).toBeLessThan(HP_MAX);
    if (inside >= 0) expect(world.hp[inside]).toBe(HP_MAX);
  });

  it("gana el ultimo vivo", () => {
    const world = freshWorld("last", MAX_PLAYERS, MAX_PLAYERS, flatMap("last"));
    skipDeploy(world);
    const rng = createRng("last");
    for (let seat = 1; seat < MAX_PLAYERS; seat++) {
      place(world, 0, LANE_SHOOTER.x, LANE_SHOOTER.z, 0);
      place(world, seat, LANE_VICTIM.x, LANE_VICTIM.z, 0);
      aimAt(world, 0, seat);
      for (let i = 0; i < 4; i++) fireHitscan(world, 0, 0);
      // Los ya caidos se apartan del pasillo.
      place(world, seat, 60, 60, 0);
    }
    const events = stepWorld(world, STEP, rng);
    expect(events & EVENT_OVER).not.toBe(0);
    expect(world.winner).toBe(0);
    expect(world.placement[0]).toBe(1);
    expect(world.phase).toBe("over");
  });

  it("con el tiempo agotado gana el de mas vida", () => {
    const world = freshWorld("time", MAX_PLAYERS);
    skipDeploy(world);
    const rng = createRng("time");
    world.time = DEFAULT_RULES.deploySeconds + DEFAULT_RULES.matchSeconds - STEP;
    world.hp[3] = 90;
    for (let seat = 0; seat < MAX_PLAYERS; seat++) if (seat !== 3) world.hp[seat] = 40;
    world.ringRadius = 1000;
    stepWorld(world, STEP, rng);
    expect(world.phase).toBe("over");
    expect(world.winner).toBe(3);
  });

  it("el puesto de un vivo sale de la vida y del dano", () => {
    const world = freshWorld("place", MAX_PLAYERS);
    skipDeploy(world);
    world.hp[0] = 50;
    world.hp[1] = 80;
    world.hp[2] = 50;
    world.damage[2] = 100;
    for (let seat = 3; seat < MAX_PLAYERS; seat++) world.hp[seat] = 10;
    expect(placementOf(world, 1)).toBe(1);
    expect(placementOf(world, 2)).toBe(2);
    expect(placementOf(world, 0)).toBe(3);
  });

  it("los puntos premian el puesto, las bajas y sobrevivir", () => {
    expect(shooterPoints(1, 0, 0, true)).toBe(450 + 100);
    expect(shooterPoints(10, 0, 0, false)).toBe(45);
    expect(shooterPoints(5, 3, 250, false)).toBe(6 * 45 + 3 * 40 + 20);
  });
});

describe("bots", () => {
  it("un bot solo en el mapa camina y no se queda quieto", () => {
    const world = freshWorld("bot");
    skipDeploy(world);
    const rng = createRng("bot");
    const x0 = world.x[0] ?? 0;
    const z0 = world.z[0] ?? 0;
    for (let i = 0; i < 300; i++) stepWorld(world, STEP, rng);
    expect(Math.hypot((world.x[0] ?? 0) - x0, (world.z[0] ?? 0) - z0)).toBeGreaterThan(2);
  });

  it("un bot con un rival a la vista le apunta y dispara", () => {
    const world = freshWorld("aim", 1, 2, flatMap("aim"));
    skipDeploy(world);
    const rng = createRng("aim");
    place(world, 0, LANE_VICTIM.x, LANE_VICTIM.z, 0);
    place(world, 1, LANE_SHOOTER.x, LANE_SHOOTER.z, 0);
    const out = createInput();
    let fired = false;
    let sawTarget = false;
    for (let i = 0; i < 240 && world.phase !== "over"; i++) {
      botThink(world, 1, STEP, rng, out);
      setInput(world, 1, out);
      stepWorld(world, STEP, rng);
      if (world.botTarget[1] === 0) sawTarget = true;
      if ((world.shots[1] ?? 0) > 0) fired = true;
    }
    expect(sawTarget).toBe(true);
    expect(fired).toBe(true);
  });

  it("diez bots juegan una partida entera en el valle y alguien gana", () => {
    const world = freshWorld("match");
    const rng = createRng("match");
    let steps = 0;
    const cap = (DEFAULT_RULES.deploySeconds + DEFAULT_RULES.matchSeconds + 10) * 60;
    while (world.phase !== "over" && steps < cap) {
      stepWorld(world, STEP, rng);
      steps++;
    }
    expect(world.phase).toBe("over");
    expect(world.winner).toBeGreaterThanOrEqual(0);
    expect(world.deaths).toBeGreaterThan(0);
  });
});

describe("snapshot", () => {
  it("lo que se escribe se lee igual, con la precision del cable", () => {
    const world = freshWorld("snap", 2);
    skipDeploy(world);
    place(world, 1, -17.25, 33.5, 1.2, 4);
    world.pitch[1] = -0.35;
    world.hp[1] = 62;
    const snapshot = createMutableSnapshot();
    writeSnapshot(world, snapshot, 0);
    const out: PlayerBody = body(world.map, 0, 0);
    readEntity(snapshot.entities[1]!, out);
    expect(out.x).toBeCloseTo(-17.25, 5);
    expect(out.z).toBeCloseTo(33.5, 5);
    expect(out.y).toBeCloseTo(4, 5);
    expect(out.yaw).toBeCloseTo(1.2, 5);
    expect(out.pitch).toBeCloseTo(-0.35, 5);
    expect(entityHp(snapshot.entities[1]!)).toBe(62);
  });

  it("los autos viajan como entidades aparte, con su chofer", () => {
    const world = freshWorld("snapcar", 2, 2, flatMap("snapcar", { cars: [{ x: 12.5, z: -40, yaw: 0.8 }] }));
    skipDeploy(world);
    world.carSpeed[0] = 15.5;
    place(world, 1, 12.5, -40, 0);
    enterCar(world, 1, 0);
    const snapshot = createMutableSnapshot();
    writeSnapshot(world, snapshot, 0);
    const entity = snapshot.entities[MAX_PLAYERS]!;
    expect(entity.id).toBe(CAR_ENTITY_BASE);
    const car: CarBody = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, driver: -1 };
    readCar(entity, car);
    expect(car.x).toBeCloseTo(12.5, 5);
    expect(car.z).toBeCloseTo(-40, 5);
    expect(car.yaw).toBeCloseTo(0.8, 5);
    expect(car.speed).toBeCloseTo(15.5, 5);
    expect(car.driver).toBe(1);
    // Un auto libre dice -1.
    world.carDriver[0] = -1;
    writeSnapshot(world, snapshot, 0);
    readCar(snapshot.entities[MAX_PLAYERS]!, car);
    expect(car.driver).toBe(-1);
  });

  it("el ojo esta donde dice la constante", () => {
    expect(EYE_HEIGHT).toBeLessThan(PLAYER_HEIGHT);
  });
});

describe("colores elegidos", () => {
  it("cada asiento manda el suyo y viaja completo por los dos escalares", () => {
    const world = freshWorld("skins", MAX_PLAYERS);
    skipDeploy(world);
    // Los diez colores, uno por asiento, al reves: asi ningun asiento
    // coincide con su valor por defecto y un error de indice se nota.
    for (let seat = 0; seat < MAX_PLAYERS; seat++) {
      setInput(world, seat, humanInput({ skin: MAX_PLAYERS - 1 - seat }));
    }
    const snapshot = createMutableSnapshot();
    writeSnapshot(world, snapshot, 0);
    for (let seat = 0; seat < MAX_PLAYERS; seat++) {
      expect(world.skin[seat]).toBe(MAX_PLAYERS - 1 - seat);
      expect(snapshotSkin(snapshot, seat)).toBe(MAX_PLAYERS - 1 - seat);
    }
    // Los dos escalares entran holgados en un entero de 32 bits con signo.
    expect(snapshot.scalars[S_SKINS_A]).toBeGreaterThan(0);
    expect(snapshot.scalars[S_SKINS_A]).toBeLessThan(2 ** 31);
    expect(snapshot.scalars[S_SKINS_B]).toBeGreaterThan(0);
    expect(snapshot.scalars[S_SKINS_B]).toBeLessThan(2 ** 31);
  });

  it("sin eleccion, el color es el del asiento", () => {
    const world = freshWorld("default", MAX_PLAYERS);
    const snapshot = createMutableSnapshot();
    writeSnapshot(world, snapshot, 0);
    for (let seat = 0; seat < MAX_PLAYERS; seat++) {
      expect(snapshotSkin(snapshot, seat)).toBe(seat);
    }
  });

  it("recargar a mano solo cuando falta agua", () => {
    const world = freshWorld("recarga", 2, 2, flatMap("recarga"));
    skipDeploy(world);
    const rng = createRng("recarga");
    place(world, 0, 0, 30, Math.PI);
    place(world, 1, -60, 60, 0);
    // Con el cargador lleno no pasa nada: el flanco se consume igual, para
    // que no salte solo tres segundos despues.
    setInput(world, 0, humanInput({ reload: true, yaw: Math.PI }));
    stepWorld(world, STEP, rng);
    expect(world.reload[0]).toBe(0);
    expect(world.inReload[0]).toBe(0);
    // Con el cargador a medias, recarga y deja el cargador lleno.
    world.ammo[0] = 5;
    setInput(world, 0, humanInput({ reload: true, yaw: Math.PI }));
    stepWorld(world, STEP, rng);
    expect(world.reload[0]).toBeGreaterThan(0);
    for (let i = 0; i < Math.ceil(DEFAULT_RULES.reloadS * 60) + 2; i++) stepWorld(world, STEP, rng);
    expect(world.ammo[0]).toBe(DEFAULT_RULES.magazine);
  });

  it("un bot se queda con el color de su asiento", () => {
    // Con el scratch de input compartido, un bot que no escribe `skin`
    // pintaria a todos del color del ultimo que hablo.
    const world = freshWorld("botskin", 1, MAX_PLAYERS);
    skipDeploy(world);
    setInput(world, 0, humanInput({ skin: 7 }));
    const rng = createRng("botskin");
    for (let i = 0; i < 30; i++) stepWorld(world, STEP, rng);
    expect(world.skin[0]).toBe(7);
    for (let seat = 1; seat < MAX_PLAYERS; seat++) expect(world.skin[seat]).toBe(seat);
  });

  it("la paleta de la vista tiene tantos colores como dice la simulacion", () => {
    expect(SEAT_TOKENS).toHaveLength(SKIN_COUNT);
  });
});
