import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import { PATTERNS, eligiblePatterns } from "./patterns";
import {
  WORLD_W,
  COYOTE_MS,
  GROUND_Y,
  JUMP_BUFFER_MS,
  PX_PER_METER,
  SLIDE_H,
  RUNNER_H,
  checkHits,
  createRunner,
  createTrack,
  deriveGhostY,
  generateTrack,
  ghostHeight,
  isGapAt,
  reactionGap,
  requestJump,
  requestSlide,
  runnerBox,
  runnerPoints,
  runnerState,
  speedAt,
  stepRunner,
  type Track,
} from "./logic";

/**
 * Los casos marcados como criterio salen de M6-CORREDOR.md y no son
 * opcionales: el juego depende de que la pista sea identica para todos y de
 * que el control perdone lo que tiene que perdonar.
 */

const RULES = { baseSpeed: 320, speedGain: 8, maxSpeed: 900 };
const SCORE = { perMeter: 10, perCoin: 25, perGraze: 15 };
const DT = 1 / 60;

function trackFor(seed: string, untilX = 20_000): Track {
  const track = createTrack();
  generateTrack(track, untilX, createRng(seed), RULES);
  return track;
}

describe("la pista es la misma para todos", () => {
  it("con la misma semilla, la secuencia de tramos es identica", () => {
    // Criterio 3. Es lo que hace honestas a las siluetas: una 40 m adelante
    // esta 40 m adelante sobre el mismo terreno.
    expect(trackFor("abc7").emitted).toEqual(trackFor("abc7").emitted);
  });

  it("con la misma semilla, cada obstaculo cae en la misma X", () => {
    const a = trackFor("abc7").obstacles.map((o) => [o.kind, Math.round(o.x)]);
    const b = trackFor("abc7").obstacles.map((o) => [o.kind, Math.round(o.x)]);
    expect(a).toEqual(b);
  });

  it("semillas distintas dan pistas distintas", () => {
    expect(trackFor("abc7").emitted).not.toEqual(trackFor("zzz9").emitted);
  });
});

describe("ningun tramo es imposible", () => {
  it("todo tramo emitido es superable a la velocidad a la que aparece", () => {
    // Criterio 9. Generar obstaculo por obstaculo al azar produce
    // combinaciones imposibles, y eso se siente injusto porque lo es.
    const track = trackFor("dificil", 60_000);
    const byId = new Map(PATTERNS.map((p) => [p.id, p]));
    // El generador arranca una pantalla adelante, no en cero.
    let cursor = WORLD_W;

    for (const id of track.emitted) {
      const pattern = byId.get(id);
      expect(pattern, `patron desconocido: ${id}`).toBeDefined();
      if (!pattern) continue;
      const meters = cursor / PX_PER_METER;
      const speed = speedAt(meters, RULES.baseSpeed, RULES.speedGain, RULES.maxSpeed);
      expect(pattern.maxSpeed).toBeGreaterThanOrEqual(speed);
      expect(pattern.fromMeters).toBeLessThanOrEqual(meters);
      cursor += reactionGap(speed) + pattern.length;
    }
  });

  it("las mecanicas se desbloquean con la distancia", () => {
    // Al arrancar solo hay bloques; deslizarse y los huecos llegan despues.
    const kinds = (m: number, s: number) =>
      new Set(eligiblePatterns(m, s).flatMap((p) => p.pieces.map((piece) => piece.kind)));
    expect(kinds(0, 320)).toEqual(new Set(["lowBlock"]));
    expect(kinds(160, 320).has("highBar")).toBe(true);
    expect(kinds(160, 320).has("gap")).toBe(false);
    expect(kinds(320, 320).has("gap")).toBe(true);
    expect(kinds(650, 400).has("doubleBlock")).toBe(true);
  });

  it("la separacion entre tramos crece con la velocidad", () => {
    // El jugador necesita el mismo TIEMPO de reaccion, no la misma distancia.
    expect(reactionGap(900)).toBeGreaterThan(reactionGap(320));
    expect(reactionGap(900)).toBeGreaterThanOrEqual(400);
  });
});

describe("buffer de entrada", () => {
  it("tocar justo antes de aterrizar ejecuta el salto al tocar el piso", () => {
    // Criterio 7. Sin esto el jugador toca, no pasa nada, y culpa al juego.
    const track = createTrack();
    const runner = createRunner();

    requestJump(runner);
    stepRunner(runner, DT, 320, track);
    expect(runner.onGround).toBe(false);

    // Cae hasta estar a un cuadro del piso.
    while (runner.vy < 0 || runner.y < -20) stepRunner(runner, DT, 320, track);
    expect(runner.onGround).toBe(false);

    // Toca en el aire, cerca del piso: el pedido se guarda.
    requestJump(runner);
    expect(runner.bufferMs).toBe(JUMP_BUFFER_MS);

    // Aterriza y el salto sale solo, sin volver a tocar.
    for (let i = 0; i < 8; i++) stepRunner(runner, DT, 320, track);
    expect(runner.vy).toBeLessThan(0);
    expect(runner.onGround).toBe(false);
  });

  it("el pedido caduca: no se guarda para siempre", () => {
    const track = createTrack();
    const runner = createRunner();
    requestJump(runner);
    runner.bufferMs = 1;
    stepRunner(runner, DT, 320, track);
    // Ya salto (estaba en el piso), pero el buffer quedo limpio.
    expect(runner.bufferMs).toBe(0);
  });
});

describe("perdon de coyote", () => {
  it("se puede saltar hasta 100 ms despues de dejar el piso", () => {
    // Criterio 8.
    const track = createTrack();
    track.obstacles.push({
      kind: "gap",
      x: 100,
      width: 300,
      height: 0,
      top: GROUND_Y,
      grazed: false,
      phase: 0,
    });
    const runner = createRunner();
    runner.x = 99;

    // Entra al hueco caminando: deja de estar en el piso.
    stepRunner(runner, DT, 320, track);
    expect(runner.onGround).toBe(false);
    expect(runner.sinceGroundMs).toBeLessThanOrEqual(COYOTE_MS);

    // Salta tarde y el juego se lo perdona.
    requestJump(runner);
    stepRunner(runner, DT, 320, track);
    expect(runner.vy).toBeLessThan(0);
  });

  it("pasado el perdon, ya no hay salto de piso: queda el doble salto", () => {
    const track = createTrack();
    const runner = createRunner();
    requestJump(runner);
    stepRunner(runner, DT, 320, track);
    expect(runner.airJumps).toBe(1);

    requestJump(runner);
    stepRunner(runner, DT, 320, track);
    // Gasto el salto doble, no un salto de piso infinito.
    expect(runner.airJumps).toBe(0);

    requestJump(runner);
    const vy = runner.vy;
    stepRunner(runner, DT, 320, track);
    expect(runner.vy).toBeGreaterThan(vy);
  });
});

describe("colisiones a velocidad alta", () => {
  it("a 900 px/s no atraviesa un obstaculo", () => {
    // Criterio 10.
    const track = createTrack();
    track.obstacles.push({
      kind: "lowBlock",
      x: 200,
      width: 46,
      height: 48,
      top: GROUND_Y - 48,
      grazed: false,
      phase: 0,
    });
    const runner = createRunner();
    runner.x = 100;
    const prevX = runner.x;
    // Un paso enorme a proposito: 500 px contra un bloque de 46.
    runner.x = 600;
    const result = checkHits(runner, prevX, track);
    expect(result.hit).toBe(true);
    expect(runner.dead).toBe(true);
  });

  it("caer en un hueco mata", () => {
    const track = createTrack();
    track.obstacles.push({
      kind: "gap",
      x: 0,
      width: 400,
      height: 0,
      top: GROUND_Y,
      grazed: false,
      phase: 0,
    });
    const runner = createRunner();
    requestJump(runner);
    stepRunner(runner, DT, 320, track);
    for (let i = 0; i < 200 && !runner.dead; i++) stepRunner(runner, DT, 320, track);
    expect(runner.dead).toBe(true);
  });

  it("saltar el hueco no mata", () => {
    const track = createTrack();
    track.obstacles.push({
      kind: "gap",
      x: 300,
      width: 120,
      height: 0,
      top: GROUND_Y,
      grazed: false,
      phase: 0,
    });
    const runner = createRunner();
    runner.x = 260;
    requestJump(runner);
    for (let i = 0; i < 120 && !runner.dead; i++) stepRunner(runner, DT, 500, track);
    expect(runner.x).toBeGreaterThan(420);
    expect(runner.dead).toBe(false);
  });

  it("pasar cerca cuenta como roce, y una sola vez", () => {
    const track = createTrack();
    track.obstacles.push({
      kind: "lowBlock",
      x: 100,
      width: 40,
      height: 48,
      top: GROUND_Y - 48,
      grazed: false,
      phase: 0,
    });
    const runner = createRunner();
    // Justo por encima del bloque: el pie queda a pocos px del techo.
    runner.x = 200;
    runner.y = -52;
    runner.onGround = false;
    const first = checkHits(runner, 190, track);
    expect(first.grazes).toBe(1);
    const second = checkHits(runner, 199, track);
    expect(second.grazes).toBe(0);
  });
});

describe("deslizada", () => {
  it("agachado mide la mitad", () => {
    const runner = createRunner();
    expect(runnerBox(runner).h).toBe(RUNNER_H);
    requestSlide(runner);
    expect(runnerBox(runner).h).toBe(SLIDE_H);
    expect(runnerState(runner)).toBe("sliding");
  });

  it("no se puede deslizar en el aire", () => {
    const runner = createRunner();
    runner.onGround = false;
    requestSlide(runner);
    expect(runner.slideMs).toBe(0);
  });
});

describe("velocidad", () => {
  it("acelera cada 100 m y topea", () => {
    expect(speedAt(0, 320, 8, 900)).toBe(320);
    expect(speedAt(100, 320, 8, 900)).toBe(328);
    expect(speedAt(1000, 320, 8, 900)).toBe(400);
    expect(speedAt(999_999, 320, 8, 900)).toBe(900);
  });
});

describe("siluetas", () => {
  it("la altura se deriva del estado, no viaja por la red", () => {
    // Criterio 5. Es lo que hace que este juego cueste 6 bytes por jugador.
    expect(deriveGhostY("running")).toBe(0);
    expect(deriveGhostY("jumping")).toBeLessThan(0);
    expect(ghostHeight("sliding")).toBe(SLIDE_H);
    expect(ghostHeight("running")).toBe(RUNNER_H);
  });

  it("el estado del corredor se lee de su fisica", () => {
    const track = createTrack();
    const runner = createRunner();
    expect(runnerState(runner)).toBe("running");
    requestJump(runner);
    stepRunner(runner, DT, 320, track);
    expect(runnerState(runner)).toBe("jumping");
    runner.dead = true;
    expect(runnerState(runner)).toBe("dead");
  });
});

describe("puntaje", () => {
  it("suma distancia, monedas y roce", () => {
    const runner = createRunner();
    runner.x = 100 * PX_PER_METER;
    runner.coins = 4;
    runner.grazes = 3;
    expect(runnerPoints(runner, SCORE)).toBe(100 * 10 + 4 * 25 + 3 * 15);
  });
});

describe("huecos", () => {
  it("isGapAt detecta el vacio solo dentro del tramo", () => {
    const track = createTrack();
    track.obstacles.push({
      kind: "gap",
      x: 100,
      width: 50,
      height: 0,
      top: GROUND_Y,
      grazed: false,
      phase: 0,
    });
    expect(isGapAt(track, 99)).toBe(false);
    expect(isGapAt(track, 120)).toBe(true);
    expect(isGapAt(track, 151)).toBe(false);
  });
});
