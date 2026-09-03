import { afterEach, describe, expect, it } from "vitest";
import { InstancedMesh, Matrix4, MeshBasicMaterial } from "three";
import { disposeGeometries, geometryCacheSize, getGeometry, type GeometryKey } from "./geometry";
import { createInstanceWriter } from "./instancing";

/**
 * Un `new BoxGeometry()` por objeto es la version 3D de asignar adentro del
 * loop: no se nota en la primera partida y a la quinta la pestania va a los
 * tumbos. Lo que sigue es la prueba de que se comparten y de que se sueltan.
 */

const KEYS: readonly GeometryKey[] = [
  "box",
  "cylinder",
  "capsule",
  "sphere",
  "ramp",
  "arch",
  "column",
  "barrier",
  "avatar",
];

afterEach(() => {
  disposeGeometries();
});

describe("getGeometry", () => {
  it("devuelve el mismo objeto y no uno nuevo", () => {
    expect(getGeometry("box")).toBe(getGeometry("box"));
    expect(getGeometry("avatar")).toBe(getGeometry("avatar"));
  });

  it("mil pedidos crean una sola geometria", () => {
    const first = getGeometry("column");
    for (let i = 0; i < 1000; i++) expect(getGeometry("column")).toBe(first);
    expect(geometryCacheSize()).toBe(1);
  });

  it("cada primitiva es una geometria distinta", () => {
    const seen = new Set(KEYS.map((key) => getGeometry(key)));
    expect(seen.size).toBe(KEYS.length);
    expect(geometryCacheSize()).toBe(KEYS.length);
  });

  it("todas traen posiciones y normales", () => {
    for (const key of KEYS) {
      const geometry = getGeometry(key);
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      expect(position, key).toBeDefined();
      expect(normal, key).toBeDefined();
      expect(position.count, key).toBeGreaterThan(0);
      expect(normal.count, key).toBe(position.count);
    }
  });

  it("todas miden 1 de alto: la escala la pone la instancia", () => {
    for (const key of KEYS) {
      const geometry = getGeometry(key);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      expect(bounds, key).not.toBeNull();
      if (!bounds) continue;
      expect(bounds.max.y - bounds.min.y, key).toBeCloseTo(1, 2);
    }
  });

  it("las primitivas macizas tambien miden 1 de ancho", () => {
    // La capsula queda afuera a proposito: con radio 0.5 seria una esfera, y
    // lo que hace falta es una silueta de persona. Va esbelta, radio 0.25.
    for (const key of ["box", "cylinder", "sphere", "ramp", "column"] as const) {
      const geometry = getGeometry(key);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      expect(bounds, key).not.toBeNull();
      if (!bounds) continue;
      expect(bounds.max.x - bounds.min.x, key).toBeCloseTo(1, 2);
    }
  });

  it("el avatar es UNA geometria fundida, no tres", () => {
    const avatar = getGeometry("avatar");
    const body = getGeometry("capsule");
    // Cuerpo + cabeza + indicador: tiene que tener mas vertices que la
    // capsula sola, o quedaron partes afuera de la fusion.
    expect(avatar.getAttribute("position").count).toBeGreaterThan(
      body.getAttribute("position").count,
    );
    avatar.computeBoundingBox();
    const bounds = avatar.boundingBox;
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    // Mide 1 de alto con los pies en -0.5, y mira hacia +Z.
    expect(bounds.min.y).toBeCloseTo(-0.5, 2);
    expect(bounds.max.y).toBeCloseTo(0.5, 2);
    expect(bounds.max.z).toBeGreaterThan(0.25);
  });

  it("dispose vacia el cache y lo siguiente que se pida es nuevo", () => {
    const before = getGeometry("box");
    expect(geometryCacheSize()).toBe(1);
    disposeGeometries();
    expect(geometryCacheSize()).toBe(0);
    expect(getGeometry("box")).not.toBe(before);
  });
});

describe("createInstanceWriter", () => {
  it("un solo InstancedMesh para todas las cajas del nivel", () => {
    const material = new MeshBasicMaterial();
    const writer = createInstanceWriter(getGeometry("box"), material, 500);
    expect(writer.mesh).toBeInstanceOf(InstancedMesh);

    writer.begin();
    for (let i = 0; i < 500; i++) writer.push(i, 0, 0, 1);
    writer.end();

    expect(writer.count).toBe(500);
    expect(writer.mesh.count).toBe(500);
    writer.dispose();
    material.dispose();
  });

  it("escribe la posicion y la escala donde corresponde", () => {
    const material = new MeshBasicMaterial();
    const writer = createInstanceWriter(getGeometry("box"), material, 4);
    writer.begin();
    writer.push(1, 2, 3, 2, 4, 6);
    writer.end();

    const matrix = new Matrix4();
    writer.mesh.getMatrixAt(0, matrix);
    const e = matrix.elements;
    expect(e[12]).toBeCloseTo(1, 10);
    expect(e[13]).toBeCloseTo(2, 10);
    expect(e[14]).toBeCloseTo(3, 10);
    expect(e[0]).toBeCloseTo(2, 10);
    expect(e[5]).toBeCloseTo(4, 10);
    expect(e[10]).toBeCloseTo(6, 10);

    writer.dispose();
    material.dispose();
  });

  it("begin descarta la pasada anterior: lo que no se reescribe desaparece", () => {
    const material = new MeshBasicMaterial();
    const writer = createInstanceWriter(getGeometry("box"), material, 8);

    writer.begin();
    for (let i = 0; i < 8; i++) writer.push(i, 0, 0, 1);
    writer.end();
    expect(writer.mesh.count).toBe(8);

    writer.begin();
    writer.push(0, 0, 0, 1);
    writer.end();
    expect(writer.mesh.count).toBe(1);

    writer.dispose();
    material.dispose();
  });

  it("avisa cuando se lleno en vez de escribir fuera del buffer", () => {
    const material = new MeshBasicMaterial();
    const writer = createInstanceWriter(getGeometry("box"), material, 2);
    writer.begin();
    expect(writer.push(0, 0, 0, 1)).toBe(true);
    expect(writer.push(0, 0, 0, 1)).toBe(true);
    expect(writer.push(0, 0, 0, 1)).toBe(false);
    writer.end();
    expect(writer.mesh.count).toBe(2);
    writer.dispose();
    material.dispose();
  });

  it("dispose del escritor NO toca la geometria compartida", () => {
    const material = new MeshBasicMaterial();
    const geometry = getGeometry("box");
    const writer = createInstanceWriter(geometry, material, 4);
    writer.dispose();
    // Sigue siendo la misma y sigue en el cache: la libera `disposeGeometries`.
    expect(getGeometry("box")).toBe(geometry);
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
    material.dispose();
  });
});
