import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import { createShooterMap, MAX_PLAYERS, type ShooterMap } from "./map";
import {
  DEFAULT_RULES,
  EVENT_DEPLOYED,
  EVENT_HIT,
  EVENT_KILL,
  EVENT_OVER,
  EVENT_RING_PHASE,
  EYE_HEIGHT,
  HP_MAX,
  LAG_COMP_TICKS,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  RING_SCHEDULE,
  RING_START_RADIUS,
  activateSeat,
  botThink,
  createInput,
  createMutableSnapshot,
  createShooterWorld,
  entityHp,
  fireHitscan,
  groundHeight,
  hasLineOfSight,
  markHuman,
  placementOf,
  rayBox,
  rayCapsule,
  readEntity,
  ringDistance,
  setInput,
  shooterPoints,
  simulateBody,
  stepWorld,
  writeSnapshot,
  type PlayerBody,
  type ShooterInput,
  type ShooterWorld,
} from "./logic";

const STEP = 1 / 60;

function freshMap(seed = "arena"): ShooterMap {
  return createShooterMap(createRng(seed));
}

/**
 * Una partida con `count` asientos activos, los primeros `humans` como
 * personas (sin bot que los mueva ni les dispare).
 *
 * Los tests de geometria activan de a dos: con diez bots sueltos el humano
 * del test muere a los tiros antes de terminar la medicion, y lo que se
 * queria probar era el rayo, no la punteria de los bots.
 */
function freshWorld(seed = "arena", humans = 0, count = MAX_PLAYERS): ShooterWorld {
  const world = createShooterWorld(freshMap(seed), DEFAULT_RULES);
  for (let seat = 0; seat < count; seat++) {
    activateSeat(world, seat);
    if (seat < humans) markHuman(world, seat, true);
  }
  return world;
}

/**
 * Un pasillo garantizado sin cobertura: el generador deja libres 8 unidades
 * alrededor del hito, y el hito ocupa solo 2 x 2 en el centro. Entre z = 3 y
 * z = 7,5 sobre x = 0 no hay nada que tape un tiro.
 */
const LANE_SHOOTER = { x: 0, z: 7.5 };
const LANE_VICTIM = { x: 0, z: 3 };

function body(x: number, z: number, yaw = 0): PlayerBody {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, onGround: true };
}

/** Deja a un asiento en un lugar exacto, mirando hacia donde se le diga. */
function place(world: ShooterWorld, seat: number, x: number, z: number, yaw: number, y = 0): void {
  world.x[seat] = x;
  world.y[seat] = y;
  world.z[seat] = z;
  world.yaw[seat] = yaw;
  world.pitch[seat] = 0;
  world.inYaw[seat] = yaw;
  world.inPitch[seat] = 0;
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
    const map = freshMap();
    // Yaw 0 mira hacia -z.
    const b = body(0, 20, 0);
    simulateBody(b, humanInput({ my: 1 }), STEP, map, DEFAULT_RULES, true);
    expect(b.z).toBeLessThan(20);
    expect(Math.abs(b.x)).toBeLessThan(1e-6);
  });

  it("la diagonal no va mas rapido que el frente", () => {
    const map = freshMap();
    const straight = body(0, 20, 0);
    const diagonal = body(0, 20, 0);
    for (let i = 0; i < 30; i++) {
      simulateBody(straight, humanInput({ my: 1 }), STEP, map, DEFAULT_RULES, true);
      simulateBody(diagonal, humanInput({ my: 1, mx: 1 }), STEP, map, DEFAULT_RULES, true);
    }
    const ds = Math.hypot(straight.x, straight.z - 20);
    const dd = Math.hypot(diagonal.x, diagonal.z - 20);
    expect(dd).toBeCloseTo(ds, 3);
  });

  it("no atraviesa un bloque de cobertura", () => {
    const map = freshMap();
    const cover = map.cover[0]!;
    // Arranca apenas al lado del bloque, empujando hacia adentro. Yaw -90
    // mira hacia +x: adelante = (-sin yaw, -cos yaw).
    const b = body(cover.x - cover.w / 2 - PLAYER_RADIUS - 0.2, cover.z, -Math.PI / 2);
    const input = humanInput({ my: 1, yaw: -Math.PI / 2 });
    for (let i = 0; i < 120; i++) simulateBody(b, input, STEP, map, DEFAULT_RULES, true);
    expect(b.x + PLAYER_RADIUS).toBeLessThanOrEqual(cover.x - cover.w / 2 + 0.05);
  });

  it("no sale del mapa", () => {
    const map = freshMap();
    const b = body(0, 0, Math.PI); // adelante = (0, +1)
    const input = humanInput({ my: 1, yaw: Math.PI });
    for (let i = 0; i < 1200; i++) simulateBody(b, input, STEP, map, DEFAULT_RULES, true);
    expect(b.z).toBeLessThan(map.size / 2);
  });

  it("salta y vuelve a caer", () => {
    const map = freshMap();
    const b = body(0, 25, 0);
    simulateBody(b, humanInput({ jump: true }), STEP, map, DEFAULT_RULES, true);
    expect(b.vy).toBeGreaterThan(0);
    expect(b.onGround).toBe(false);
    let apex = 0;
    for (let i = 0; i < 120; i++) {
      simulateBody(b, humanInput({}), STEP, map, DEFAULT_RULES, true);
      if (b.y > apex) apex = b.y;
    }
    expect(apex).toBeGreaterThan(0.8);
    expect(b.y).toBe(0);
    expect(b.onGround).toBe(true);
  });

  it("una plataforma sostiene desde arriba y bloquea desde el costado", () => {
    const map = freshMap();
    const platform = map.platforms[0]!;
    const top = platform.y + platform.h / 2;
    // Desde arriba: cae sobre la tapa.
    expect(groundHeight(map, platform.x, platform.z, top + 2)).toBeCloseTo(top, 5);
    // Desde abajo: el piso es el piso.
    expect(groundHeight(map, platform.x, platform.z, 0)).toBe(0);
    // Y caminando de frente contra ella, no se entra.
    const b = body(platform.x - platform.w / 2 - 2, platform.z, -Math.PI / 2);
    const input = humanInput({ my: 1, yaw: -Math.PI / 2 });
    for (let i = 0; i < 120; i++) simulateBody(b, input, STEP, map, DEFAULT_RULES, true);
    expect(b.x + PLAYER_RADIUS).toBeLessThanOrEqual(platform.x - platform.w / 2 + 0.05);
    expect(b.y).toBe(0);
  });

  it("la rampa sube hasta la plataforma sin saltar", () => {
    const map = freshMap();
    const ramp = map.ramps[0]!;
    const platform = map.platforms[0]!;
    // Parado al pie de la rampa, caminando hacia arriba (hacia +x local).
    const startX = ramp.x - Math.cos(ramp.yaw) * (ramp.w / 2 - 0.5);
    const startZ = ramp.z - Math.sin(ramp.yaw) * (ramp.w / 2 - 0.5);
    const towards = yawTowards(startX, startZ, platform.x, platform.z);
    const b = body(startX, startZ, towards);
    const input = humanInput({ my: 1, yaw: towards });
    let highest = 0;
    for (let i = 0; i < 240; i++) {
      simulateBody(b, input, STEP, map, DEFAULT_RULES, true);
      if (b.y > highest) highest = b.y;
    }
    expect(highest).toBeGreaterThan(platform.y);
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
    setInput(world, 0, { mx: Number.NaN, my: 99, yaw: Number.POSITIVE_INFINITY, pitch: 9, fire: false, jump: false });
    expect(world.inMx[0]).toBe(0);
    expect(world.inMy[0]).toBe(1);
    // Float32: 1.45 guardado vuelve como 1.4500000476.
    expect(world.inPitch[0]).toBeLessThanOrEqual(1.45 + 1e-6);
    expect(Number.isFinite(world.inYaw[0] ?? 0)).toBe(true);
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
    // Rayo horizontal a la altura del pecho, hacia +x, contra alguien en x = 10.
    const bodyHit = rayCapsule(0, 1.0, 0, 1, 0, 0, 10, 0, 0, out);
    expect(bodyHit).toBeGreaterThan(9);
    expect(out[0]).toBe(0);
    // A la altura de la cabeza.
    const headHit = rayCapsule(0, PLAYER_HEIGHT - 0.1, 0, 1, 0, 0, 10, 0, 0, out);
    expect(headHit).toBeGreaterThan(9);
    expect(out[0]).toBe(1);
    // Por arriba de la coronilla, nada.
    expect(rayCapsule(0, PLAYER_HEIGHT + 0.5, 0, 1, 0, 0, 10, 0, 0, out)).toBe(-1);
    // Al costado, nada.
    expect(rayCapsule(0, 1, 2, 1, 0, 0, 10, 0, 0, out)).toBe(-1);
  });

  it("un disparo de frente pega y hace dano de cuerpo", () => {
    const world = freshWorld("hit", 2, 2);
    skipDeploy(world);
    place(world, 0, LANE_SHOOTER.x, LANE_SHOOTER.z, yawTowards(LANE_SHOOTER.x, LANE_SHOOTER.z, LANE_VICTIM.x, LANE_VICTIM.z));
    place(world, 1, LANE_VICTIM.x, LANE_VICTIM.z, 0);
    const hit = fireHitscan(world, 0, 0);
    expect(hit).toBe(1);
    expect(world.hp[1]).toBe(HP_MAX - DEFAULT_RULES.bodyDamage);
    expect(world.damage[0]).toBe(DEFAULT_RULES.bodyDamage);
  });

  it("la cobertura tapa el tiro", () => {
    const world = freshWorld("cover", 2);
    skipDeploy(world);
    const cover = world.map.cover.find((c) => c.h >= 3)!;
    // Tirador de un lado del bloque, victima del otro, alineados en x.
    place(world, 0, cover.x - cover.w / 2 - 6, cover.z, yawTowards(cover.x - 6, cover.z, cover.x + 6, cover.z));
    place(world, 1, cover.x + cover.w / 2 + 6, cover.z, 0);
    expect(fireHitscan(world, 0, 0)).toBe(-1);
    expect(hasLineOfSight(world, 0, 1)).toBe(false);
  });

  it("la compensacion de latencia pega donde el tirador VIO al rival", () => {
    const world = freshWorld("lag", 2, 2);
    skipDeploy(world);
    const rng = createRng("lag");
    // La victima corre en +x; el tirador le apunta a donde estaba.
    place(world, 0, LANE_SHOOTER.x, LANE_SHOOTER.z, yawTowards(LANE_SHOOTER.x, LANE_SHOOTER.z, LANE_VICTIM.x, LANE_VICTIM.z));
    place(world, 1, LANE_VICTIM.x, LANE_VICTIM.z, -Math.PI / 2);
    setInput(world, 1, humanInput({ my: 1, yaw: -Math.PI / 2 }));
    for (let i = 0; i < LAG_COMP_TICKS + 2; i++) stepWorld(world, STEP, rng);
    // Ahora esta corrida a la derecha: sin rebobinar, el tiro falla.
    expect(world.x[1]).toBeGreaterThan(PLAYER_RADIUS);
    expect(fireHitscan(world, 0, 0)).toBe(-1);
    // Rebobinando, pega donde estaba hace ~100 ms.
    expect(fireHitscan(world, 0, LAG_COMP_TICKS)).toBe(1);
  });

  it("la cadencia y el cargador se respetan", () => {
    // Dos personas, no una: con un solo vivo la partida termina en el primer
    // paso, que es exactamente lo que debe pasar y lo que no se quiere medir.
    const world = freshWorld("rate", 2, 2);
    skipDeploy(world);
    const rng = createRng("rate");
    place(world, 0, LANE_SHOOTER.x, LANE_SHOOTER.z, Math.PI);
    place(world, 1, -30, 30, 0);
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

describe("muerte, anillo y final", () => {
  it("cuatro tiros al cuerpo matan y asignan el puesto", () => {
    const world = freshWorld("kill", 2, 2);
    skipDeploy(world);
    place(world, 0, LANE_SHOOTER.x, LANE_SHOOTER.z, yawTowards(LANE_SHOOTER.x, LANE_SHOOTER.z, LANE_VICTIM.x, LANE_VICTIM.z));
    place(world, 1, LANE_VICTIM.x, LANE_VICTIM.z, 0);
    for (let i = 0; i < 4; i++) fireHitscan(world, 0, 0);
    expect(world.alive[1]).toBe(0);
    // Quedaban dos en pie al caer: segundo puesto.
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
    // Alguien afuera del anillo perdio vida; alguien adentro no.
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
    const world = freshWorld("last", MAX_PLAYERS);
    skipDeploy(world);
    const rng = createRng("last");
    for (let seat = 1; seat < MAX_PLAYERS; seat++) {
      place(world, 0, LANE_SHOOTER.x, LANE_SHOOTER.z, yawTowards(LANE_SHOOTER.x, LANE_SHOOTER.z, LANE_VICTIM.x, LANE_VICTIM.z));
      place(world, seat, LANE_VICTIM.x, LANE_VICTIM.z, 0);
      for (let i = 0; i < 4; i++) fireHitscan(world, 0, 0);
      // Los ya caidos se apartan del pasillo: un muerto no tapa el tiro, pero
      // dos cuerpos en el mismo punto no es un caso que valga la pena probar.
      place(world, seat, 30, 30, 0);
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
    // Con todos quietos y adentro del anillo el paso solo agota el reloj.
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
    const world = freshWorld("aim", 1, 2);
    skipDeploy(world);
    const rng = createRng("aim");
    place(world, 0, LANE_VICTIM.x, LANE_VICTIM.z, 0);
    place(world, 1, LANE_SHOOTER.x, LANE_SHOOTER.z, 0);
    const out = createInput();
    let fired = false;
    let sawTarget = false;
    // Se mira DURANTE la pelea: el bot mata al humano quieto en un par de
    // segundos, la partida termina y el objetivo vuelve a -1. Lo que se prueba
    // es que lo vio y le tiro, no que siga mirandolo despues de matarlo.
    for (let i = 0; i < 180 && world.phase !== "over"; i++) {
      botThink(world, 1, STEP, rng, out);
      setInput(world, 1, out);
      stepWorld(world, STEP, rng);
      if (world.botTarget[1] === 0) sawTarget = true;
      if ((world.shots[1] ?? 0) > 0) fired = true;
    }
    expect(sawTarget).toBe(true);
    expect(fired).toBe(true);
  });

  it("diez bots juegan una partida entera y alguien gana", () => {
    const world = freshWorld("match");
    const rng = createRng("match");
    let steps = 0;
    while (world.phase !== "over" && steps < 60 * 300) {
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
    const out: PlayerBody = body(0, 0);
    readEntity(snapshot.entities[1]!, out);
    expect(out.x).toBeCloseTo(-17.25, 5);
    expect(out.z).toBeCloseTo(33.5, 5);
    expect(out.y).toBeCloseTo(4, 5);
    expect(out.yaw).toBeCloseTo(1.2, 5);
    expect(out.pitch).toBeCloseTo(-0.35, 5);
    expect(entityHp(snapshot.entities[1]!)).toBe(62);
  });

  it("el ojo esta donde dice la constante", () => {
    expect(EYE_HEIGHT).toBeLessThan(PLAYER_HEIGHT);
  });
});
