import { describe, expect, it } from "vitest";
import { createRng } from "@/core/engine/rng";
import {
  AVATAR_RADIUS,
  AVATAR_SPEED,
  DOOR_WIDTH,
  MAX_STATIONS,
  SPACE_SIZE,
  createMutableSnapshot,
  createSpace,
  createSpaceWorld,
  entityActive,
  entityMoving,
  entityZone,
  joinAvatar,
  leaveAvatar,
  moveAvatar,
  nearestStation,
  readAvatar,
  setAvatarInput,
  snapshotOccupancy,
  stepSpace,
  visitedStations,
  wallProximity,
  writeSpaceSnapshot,
  zoneAt,
  type AvatarBody,
  type SpaceLayout,
  type StationContent,
} from "./space";

const STEP = 1 / 60;

const CONTENT: StationContent[] = [
  { title: "Quiénes somos", body: "Un equipo de 40 personas repartidas en tres países." },
  { title: "Producto", body: "Lo que vendemos y a quién." },
  { title: "Hitos", body: "De 0 a 1.000 clientes en dos años." },
  { title: "Cultura", body: "Los principios que nos importan." },
  { title: "Roadmap", body: "Lo que viene este trimestre." },
];

function layoutFor(seed: string, content = CONTENT): SpaceLayout {
  return createSpace(createRng(seed), content);
}

function hash(layout: SpaceLayout): string {
  return JSON.stringify({
    cols: layout.cols,
    walls: layout.walls.map((w) => [w.x, w.z, w.w, w.d]),
    stations: layout.stations.map((s) => [s.x, s.z, s.zone]),
    zones: layout.zones.map((z) => z.color),
  });
}

/* ------------------------------------------------------------------ */

describe("la planta", () => {
  it("con la misma semilla sale identica", () => {
    expect(hash(layoutFor("evento"))).toBe(hash(layoutFor("evento")));
  });

  it("con otra semilla sale distinta", () => {
    expect(hash(layoutFor("uno"))).not.toBe(hash(layoutFor("dos")));
  });

  it("tiene entre cuatro y seis zonas, todas dentro del espacio", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const layout = layoutFor(seed);
      expect(layout.zones.length).toBeGreaterThanOrEqual(4);
      expect(layout.zones.length).toBeLessThanOrEqual(6);
      for (const zone of layout.zones) {
        expect(zone.x0).toBeGreaterThanOrEqual(-SPACE_SIZE / 2);
        expect(zone.x1).toBeLessThanOrEqual(SPACE_SIZE / 2);
      }
    }
  });

  it("cada particion interior tiene una puerta por la que pasa una persona", () => {
    const layout = layoutFor("puertas");
    expect(layout.doors.length).toBeGreaterThan(0);
    for (const door of layout.doors) {
      // En el centro del hueco no hay pared.
      const body: AvatarBody = { x: door.x, z: door.z, yaw: 0 };
      moveAvatar(layout, body, { mx: 0, my: 0, yaw: 0 }, STEP);
      expect(Math.hypot(body.x - door.x, body.z - door.z)).toBeLessThan(0.05);
    }
    expect(DOOR_WIDTH).toBeGreaterThan(AVATAR_RADIUS * 4);
  });

  it("las estaciones van una por zona, hasta agotar el contenido, y nunca mas de ocho", () => {
    const layout = layoutFor("estaciones");
    expect(layout.stations.length).toBe(Math.min(CONTENT.length, MAX_STATIONS));
    const zones = new Set(layout.stations.slice(0, layout.zones.length).map((s) => s.zone));
    expect(zones.size).toBe(Math.min(layout.zones.length, layout.stations.length));
    expect(layout.stations[0]?.title).toBe(CONTENT[0]?.title);
  });

  it("sin contenido no hay estaciones: es un lobby y se dice", () => {
    expect(layoutFor("vacio", []).stations).toHaveLength(0);
  });

  it("las estaciones estan pegadas a una pared exterior, mirando adentro", () => {
    const layout = layoutFor("paredes");
    const half = SPACE_SIZE / 2;
    for (const station of layout.stations) {
      const nearEdge =
        Math.abs(Math.abs(station.x) - half) < 1.2 || Math.abs(Math.abs(station.z) - half) < 1.2;
      expect(nearEdge).toBe(true);
      // Un paso hacia donde mira la estacion aleja de la pared.
      const ahead = { x: station.x - Math.sin(station.yaw), z: station.z - Math.cos(station.yaw) };
      expect(Math.max(Math.abs(ahead.x), Math.abs(ahead.z))).toBeLessThan(
        Math.max(Math.abs(station.x), Math.abs(station.z)),
      );
    }
  });

  it("la zona de entrada es el centro de la primera zona", () => {
    const layout = layoutFor("entrada");
    expect(zoneAt(layout, layout.spawn.x, layout.spawn.z)).toBe(0);
  });

  it("la oclusion horneada es 1 contra la pared y 0 lejos", () => {
    const layout = layoutFor("ao");
    expect(wallProximity(layout, -SPACE_SIZE / 2 + 0.3, 0, 3)).toBeGreaterThan(0.9);
    const zone = layout.zones[0]!;
    expect(wallProximity(layout, zone.cx, zone.cz, 3)).toBe(0);
  });
});

describe("caminar", () => {
  it("adelante es hacia donde mira, a la velocidad de la regla", () => {
    const layout = layoutFor("walk");
    const zone = layout.zones[0]!;
    const body: AvatarBody = { x: zone.cx, z: zone.cz, yaw: 0 };
    for (let i = 0; i < 60; i++) moveAvatar(layout, body, { mx: 0, my: 1, yaw: 0 }, STEP);
    expect(zone.cz - body.z).toBeCloseTo(AVATAR_SPEED, 1);
  });

  it("no atraviesa una pared", () => {
    const layout = layoutFor("wall");
    const half = SPACE_SIZE / 2;
    const body: AvatarBody = { x: 0, z: half - 3, yaw: Math.PI }; // adelante = +z
    for (let i = 0; i < 300; i++) moveAvatar(layout, body, { mx: 0, my: 1, yaw: Math.PI }, STEP);
    expect(body.z).toBeLessThan(half);
    expect(body.z).toBeGreaterThan(half - 1.5);
  });

  it("se desliza a lo largo de la pared en vez de trabarse", () => {
    const layout = layoutFor("slide");
    const half = SPACE_SIZE / 2;
    const body: AvatarBody = { x: 0, z: half - 1, yaw: Math.PI };
    const x0 = body.x;
    // Empuja en diagonal contra la pared del fondo: avanza en x igual.
    for (let i = 0; i < 120; i++) moveAvatar(layout, body, { mx: 1, my: 1, yaw: Math.PI }, STEP);
    expect(Math.abs(body.x - x0)).toBeGreaterThan(2);
  });

  it("un input absurdo no mueve a nadie fuera de rango", () => {
    const layout = layoutFor("nan");
    const zone = layout.zones[0]!;
    const body: AvatarBody = { x: zone.cx, z: zone.cz, yaw: 0 };
    moveAvatar(layout, body, { mx: Number.NaN, my: 50, yaw: Number.NaN }, STEP);
    expect(Number.isFinite(body.x)).toBe(true);
    expect(zone.cz - body.z).toBeLessThanOrEqual(AVATAR_SPEED * STEP + 1e-6);
  });
});

describe("el mundo del host", () => {
  it("entrar y salir cuenta, y el que entra aparece en la entrada", () => {
    const world = createSpaceWorld(layoutFor("host"));
    joinAvatar(world, 3);
    joinAvatar(world, 3);
    expect(world.activeCount).toBe(1);
    expect(world.x[3]).toBe(world.layout.spawn.x);
    leaveAvatar(world, 3);
    expect(world.activeCount).toBe(0);
  });

  it("acercarse a una estacion la marca como visitada y la ocupa", () => {
    const layout = layoutFor("visita");
    const world = createSpaceWorld(layout);
    joinAvatar(world, 0);
    const station = layout.stations[0]!;
    world.x[0] = station.x - Math.sin(station.yaw) * 1.5;
    world.z[0] = station.z - Math.cos(station.yaw) * 1.5;
    stepSpace(world, STEP);
    expect(nearestStation(layout, world.x[0] ?? 0, world.z[0] ?? 0)).toBe(station.id);
    expect(world.station[0]).toBe(station.id);
    expect(world.occupancy[station.id]).toBe(1);
    expect(visitedStations(world, 0)).toEqual([station.id]);
  });

  it("caminar suma distancia y tiempo por zona", () => {
    const world = createSpaceWorld(layoutFor("dist"));
    joinAvatar(world, 0);
    setAvatarInput(world, 0, { mx: 0, my: 1, yaw: 0 });
    for (let i = 0; i < 60; i++) stepSpace(world, STEP);
    expect(world.distance[0]).toBeGreaterThan(3);
    expect(world.moving[0]).toBe(1);
    const zone = world.zone[0] ?? 0;
    expect(world.zoneTime[zone]).toBeCloseTo(1, 1);
  });

  it("el snapshot lleva posicion, zona, movimiento y ocupacion", () => {
    const layout = layoutFor("snap");
    const world = createSpaceWorld(layout);
    joinAvatar(world, 2);
    const station = layout.stations[1]!;
    world.x[2] = station.x - Math.sin(station.yaw) * 1.2;
    world.z[2] = station.z - Math.cos(station.yaw) * 1.2;
    setAvatarInput(world, 2, { mx: 1, my: 0, yaw: 0.7 });
    stepSpace(world, STEP);

    const snapshot = createMutableSnapshot();
    writeSpaceSnapshot(world, snapshot);
    const entity = snapshot.entities[2]!;
    const body: AvatarBody = { x: 0, z: 0, yaw: 0 };
    readAvatar(entity, body);
    expect(body.x).toBeCloseTo(world.x[2] ?? 0, 4);
    expect(body.yaw).toBeCloseTo(0.7, 5);
    expect(entityActive(entity)).toBe(true);
    expect(entityMoving(entity)).toBe(true);
    expect(entityZone(entity)).toBe(world.zone[2]);
    expect(entityActive(snapshot.entities[5]!)).toBe(false);
    expect(snapshotOccupancy(snapshot, station.id)).toBe(1);
  });
});
