import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import { TRACKS, buildTrack, sampleAtArc, trackById, wrapAngle, type TrackGeometry } from "./track";
import {
  CHECKPOINTS,
  createRace,
  driftLevelOf,
  playerPosition,
  projectCar,
  racePoints,
  stepRace,
  type Car,
  type Race,
  type RaceRules,
} from "./logic";

/**
 * Lo que se testea son las cinco cosas que, si se rompen, rompen el juego y no
 * se ven mirando la pantalla: el determinismo (sin el, los tiempos del ranking
 * no son comparables), el castigo del pasto, el conteo de vueltas, la
 * aritmetica de los tiempos y que la IA sepa manejar.
 *
 * No hay tests de render. El Mode 7 se verifica mirando si la grilla converge
 * recta al horizonte, y eso no lo dice un `expect`.
 */

const DT = 1 / 60;

const RULES: RaceRules = {
  accel: 170,
  maxSpeed: 100,
  grip: 1,
  offTrackFactor: 0.6,
  laps: 3,
  rivalCount: 5,
  aiSkill: 0.9,
  targetTotalMs: 95_000,
};

function rules(patch: Partial<RaceRules> = {}): RaceRules {
  return { ...RULES, ...patch };
}

function raceOn(trackId: string, patch: Partial<RaceRules> = {}, seed = "abc7"): Race {
  return createRace(buildTrack(trackById(trackId)), rules(patch), createRng(seed));
}

/**
 * Piloto de referencia: apunta a un punto adelante sobre la linea central.
 * Es el mismo criterio que usa la IA, y sirve para correr una carrera entera
 * sin manos.
 */
function autopilot(car: Car, track: TrackGeometry): number {
  const look = 40 + car.speed * 0.6;
  const i = sampleAtArc(track, car.s + look);
  const diff = wrapAngle(
    Math.atan2((track.ys[i] ?? 0) - car.y, (track.xs[i] ?? 0) - car.x) - car.heading,
  );
  return Math.max(-1, Math.min(1, diff * 2.8));
}

/** Corre hasta terminar o hasta agotar el presupuesto de pasos. */
function runRace(race: Race, maxSteps = 60 * 300): number {
  let steps = 0;
  while (steps < maxSteps && !race.finished) {
    stepRace(race, DT, autopilot(race.player, race.track), false, false);
    steps++;
  }
  return steps;
}

/** Deja un auto sobre la pista en la posicion de arco pedida. */
function teleport(car: Car, track: TrackGeometry, arc: number, lateral: number): void {
  const i = sampleAtArc(track, arc);
  const h = track.headings[i] ?? 0;
  car.x = (track.xs[i] ?? 0) - Math.sin(h) * lateral;
  car.y = (track.ys[i] ?? 0) + Math.cos(h) * lateral;
  car.heading = h;
  car.velAngle = h;
  car.sample = i;
  projectCar(car, track);
}

/* ------------------------------------------------------------------ */

describe("la pista es la misma para todos", () => {
  it("el circuito cierra: la ultima muestra queda a un paso de la primera", () => {
    for (const def of TRACKS) {
      const track = buildTrack(def);
      const last = track.count - 1;
      const gap = Math.hypot(
        (track.xs[0] ?? 0) - (track.xs[last] ?? 0),
        (track.ys[0] ?? 0) - (track.ys[last] ?? 0),
      );
      // Un lazo que no cierra rompe el conteo de vueltas y la proyeccion.
      expect(gap).toBeLessThan(track.spacing * 1.5);
    }
  });

  it("construir el mismo circuito dos veces da la misma geometria", () => {
    const a = buildTrack(TRACKS[0] as (typeof TRACKS)[number]);
    const b = buildTrack(TRACKS[0] as (typeof TRACKS)[number]);
    expect(Array.from(a.xs)).toEqual(Array.from(b.xs));
    expect(a.length).toBe(b.length);
  });

  it("hay al menos dos circuitos y ninguno se pisa a si mismo", () => {
    expect(TRACKS.length).toBeGreaterThanOrEqual(2);
    for (const def of TRACKS) {
      const track = buildTrack(def);
      const apart = Math.ceil(400 / track.spacing);
      const needed = (track.halfWidth + track.shoulder) * 2;
      let worst = Infinity;
      for (let i = 0; i < track.count; i++) {
        for (let j = i + apart; j < track.count - apart; j++) {
          const d = Math.hypot(
            (track.xs[i] ?? 0) - (track.xs[j] ?? 0),
            (track.ys[i] ?? 0) - (track.ys[j] ?? 0),
          );
          if (d < worst) worst = d;
        }
      }
      // Si dos tramos lejanos se acercan mas que el ancho total, el bitmap los
      // fusiona y el auto salta de un tramo al otro al proyectarse.
      expect(worst).toBeGreaterThan(needed);
    }
  });
});

describe("determinismo", () => {
  it("dos corridas con la misma semilla y las mismas entradas dan el mismo tiempo", () => {
    // Es LA condicion del juego: no hay red, lo unico que hace comparables los
    // tiempos del ranking es que todos corran exactamente la misma carrera.
    const a = raceOn("nova");
    const b = raceOn("nova");
    runRace(a);
    runRace(b);

    expect(a.player.totalMs).toBe(b.player.totalMs);
    expect(a.player.bestLapMs).toBe(b.player.bestLapMs);
    expect(Array.from(a.player.lapTimes)).toEqual(Array.from(b.player.lapTimes));
    expect(a.player.x).toBe(b.player.x);
    expect(a.player.y).toBe(b.player.y);
    expect(racePoints(a)).toBe(racePoints(b));
  });

  it("los rivales tambien salen identicos, porque tambien salen de la semilla", () => {
    const a = raceOn("nova");
    const b = raceOn("nova");
    for (let i = 0; i < 600; i++) {
      stepRace(a, DT, 0.2, false, false);
      stepRace(b, DT, 0.2, false, false);
    }
    expect(a.rivals.map((r) => r.s)).toEqual(b.rivals.map((r) => r.s));
    expect(playerPosition(a)).toBe(playerPosition(b));
  });

  it("semillas distintas cambian la grilla de rivales", () => {
    const a = raceOn("nova", {}, "abc7");
    const b = raceOn("nova", {}, "zzz9");
    expect(a.rivals.map((r) => r.aiOffset)).not.toEqual(b.rivals.map((r) => r.aiOffset));
  });
});

describe("fuera de pista", () => {
  it("el auto pierde velocidad en el pasto", () => {
    const inside = raceOn("nova", { rivalCount: 0 });
    const outside = raceOn("nova", { rivalCount: 0 });

    // Los dos arrancan lanzados sobre la misma recta; uno, en la banquina.
    inside.player.speed = RULES.maxSpeed;
    outside.player.speed = RULES.maxSpeed;
    teleport(inside.player, inside.track, 60, 0);
    teleport(outside.player, outside.track, 60, outside.track.halfWidth + 12);
    expect(inside.player.onTrack).toBe(true);
    expect(outside.player.onTrack).toBe(false);

    for (let i = 0; i < 60; i++) {
      stepRace(inside, DT, 0, false, false);
      stepRace(outside, DT, 0, false, false);
    }

    expect(outside.player.speed).toBeLessThan(inside.player.speed);
    // Y no es un detalle: el techo del pasto es el que manda.
    expect(outside.player.speed).toBeLessThanOrEqual(RULES.maxSpeed * RULES.offTrackFactor + 1);
    expect(outside.player.offTrackCount).toBe(1);
  });

  it("salirse no descalifica: se sigue corriendo", () => {
    const race = raceOn("nova", { rivalCount: 0 });
    teleport(race.player, race.track, 60, race.track.halfWidth + 12);
    for (let i = 0; i < 120; i++) stepRace(race, DT, 0, false, false);
    expect(race.finished).toBe(false);
    expect(race.player.finished).toBe(false);
  });

  it("el muro frena y devuelve el auto a la pista", () => {
    const race = raceOn("nova", { rivalCount: 0 });
    const limit = race.track.halfWidth + race.track.shoulder;
    teleport(race.player, race.track, 60, limit - 2);
    race.player.speed = RULES.maxSpeed;
    // Apuntado hacia afuera: en dos pasos toca el muro.
    race.player.heading += 0.9;
    race.player.velAngle += 0.9;
    for (let i = 0; i < 20; i++) stepRace(race, DT, 1, false, false);
    expect(Math.abs(race.player.lateral)).toBeLessThanOrEqual(limit + 0.01);
    expect(race.player.speed).toBeLessThan(RULES.maxSpeed);
  });
});

describe("vueltas", () => {
  it("una vuelta se cuenta al cruzar la meta con todos los portones hechos", () => {
    const race = raceOn("nova", { rivalCount: 0, laps: 9 });
    expect(race.player.lap).toBe(0);
    let steps = 0;
    while (steps < 60 * 90 && race.player.lap === 0) {
      stepRace(race, DT, autopilot(race.player, race.track), false, false);
      steps++;
    }
    expect(race.player.lap).toBe(1);
    expect(race.player.nextGate).toBe(1);
  });

  it("cruzar la meta sin haber pasado los portones NO cuenta la vuelta", () => {
    // Sin esto, alguien corta campo traviesa, cruza la meta y "gana".
    const race = raceOn("nova", { rivalCount: 0, laps: 9 });
    const track = race.track;
    teleport(race.player, track, track.length - 60, 0);
    race.player.speed = RULES.maxSpeed;
    expect(race.player.nextGate).toBe(1);

    for (let i = 0; i < 90; i++) {
      stepRace(race, DT, autopilot(race.player, track), false, false);
    }
    expect(race.player.s).toBeLessThan(track.length * 0.25);
    expect(race.player.lap).toBe(0);
  });

  it("no se cuenta dos veces volviendo a cruzar la meta", () => {
    const race = raceOn("nova", { rivalCount: 0, laps: 9 });
    const track = race.track;
    let steps = 0;
    while (steps < 60 * 90 && race.player.lap === 0) {
      stepRace(race, DT, autopilot(race.player, track), false, false);
      steps++;
    }
    expect(race.player.lap).toBe(1);

    // Se lo devuelve justo antes de la meta y se lo hace cruzar de nuevo.
    teleport(race.player, track, track.length - 60, 0);
    race.player.speed = RULES.maxSpeed;
    for (let i = 0; i < 90; i++) {
      stepRace(race, DT, autopilot(race.player, track), false, false);
    }
    expect(race.player.lap).toBe(1);
  });

  it("cruzar la meta yendo para atras no suma ni resta vueltas", () => {
    const race = raceOn("nova", { rivalCount: 0, laps: 9 });
    const track = race.track;
    // Apenas pasada la meta, mirando de contramano.
    teleport(race.player, track, 40, 0);
    race.player.heading = wrapAngle(race.player.heading + Math.PI);
    race.player.velAngle = race.player.heading;
    race.player.speed = RULES.maxSpeed * 0.7;
    race.player.nextGate = 0;

    for (let i = 0; i < 60; i++) stepRace(race, DT, 0, false, false);

    expect(race.player.s).toBeGreaterThan(track.length * 0.75);
    expect(race.player.lap).toBe(0);
  });

  it("los portones se cruzan en orden", () => {
    const race = raceOn("nova", { rivalCount: 0, laps: 9 });
    const seen: number[] = [];
    let steps = 0;
    while (steps < 60 * 90 && race.player.lap === 0) {
      stepRace(race, DT, autopilot(race.player, race.track), false, false);
      const gate = race.player.nextGate;
      if (seen[seen.length - 1] !== gate) seen.push(gate);
      steps++;
    }
    expect(seen).toEqual([1, 2, 3, 0, 1]);
    expect(CHECKPOINTS).toBe(4);
  });
});

describe("tiempos", () => {
  it("los tiempos por vuelta suman el total y la mejor es la mas corta", () => {
    const race = raceOn("nova", { rivalCount: 0 });
    runRace(race);
    expect(race.finished).toBe(true);
    expect(race.player.lap).toBe(3);

    let sum = 0;
    const laps: number[] = [];
    for (let i = 0; i < RULES.laps; i++) {
      const lap = race.player.lapTimes[i] ?? 0;
      expect(lap).toBeGreaterThan(0);
      laps.push(lap);
      sum += lap;
    }
    expect(sum).toBeCloseTo(race.player.totalMs, 6);
    expect(race.player.bestLapMs).toBeCloseTo(Math.min(...laps), 6);
    // La primera vuelta arranca parado: siempre es la mas lenta.
    expect(laps[0]).toBeGreaterThan(race.player.bestLapMs);
  });

  it("el reloj se congela al terminar", () => {
    const race = raceOn("nova", { rivalCount: 0 });
    runRace(race);
    const frozen = race.player.totalMs;
    for (let i = 0; i < 120; i++) stepRace(race, DT, 0, false, false);
    expect(race.player.totalMs).toBe(frozen);
  });
});

describe("la IA maneja", () => {
  it("un rival completa una vuelta sin salirse de la pista", () => {
    for (const def of TRACKS) {
      const race = createRace(buildTrack(def), rules({ laps: 9 }), createRng("abc7"));
      const rival = race.rivals[0];
      expect(rival).toBeDefined();
      if (!rival) continue;

      let steps = 0;
      while (steps < 60 * 120 && rival.lap < 1) {
        stepRace(race, DT, 0, false, false);
        for (const other of race.rivals) {
          expect(other.onTrack, `${def.id}: un rival se fue al pasto`).toBe(true);
        }
        steps++;
      }
      expect(rival.lap, `${def.id}: el rival no completo la vuelta`).toBeGreaterThanOrEqual(1);
      expect(rival.offTrackCount).toBe(0);
    }
  });
});

describe("derrape y turbo", () => {
  it("la carga del derrape tiene tres niveles", () => {
    expect(driftLevelOf(0)).toBe(0);
    expect(driftLevelOf(419)).toBe(0);
    expect(driftLevelOf(420)).toBe(1);
    expect(driftLevelOf(950)).toBe(2);
    expect(driftLevelOf(1500)).toBe(3);
  });

  it("soltar el derrape cargado lanza turbo y acelera de mas", () => {
    const race = raceOn("nova", { rivalCount: 0 });
    race.player.speed = RULES.maxSpeed;
    // Un segundo sostenido alcanza para el nivel 2.
    for (let i = 0; i < 66; i++) stepRace(race, DT, 1, true, false);
    expect(race.player.driftLevel).toBeGreaterThanOrEqual(2);
    stepRace(race, DT, 0, false, false);
    expect(race.events.turboLaunch).toBeGreaterThanOrEqual(2);
    expect(race.player.turboMs).toBeGreaterThan(0);
  });
});

describe("puntaje", () => {
  it("terminar rapido puntua mas que terminar lento", () => {
    const fast = raceOn("nova", { rivalCount: 0 });
    runRace(fast);
    const slow = raceOn("nova", { rivalCount: 0 });
    runRace(slow);
    slow.player.totalMs += 20_000;
    expect(racePoints(fast)).toBeGreaterThan(racePoints(slow));
  });

  it("quien no termina recibe puntos por el avance, nunca cero", () => {
    const race = raceOn("nova", { rivalCount: 0 });
    for (let i = 0; i < 60 * 20; i++) {
      stepRace(race, DT, autopilot(race.player, race.track), false, false);
    }
    expect(race.finished).toBe(false);
    const partial = racePoints(race);
    expect(partial).toBeGreaterThanOrEqual(50);
    expect(partial).toBeLessThan(300);
  });

  it("nadie baja de 50 puntos, ni quedandose quieto", () => {
    const race = raceOn("nova", { rivalCount: 0 });
    expect(racePoints(race)).toBe(50);
  });
});
