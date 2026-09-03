import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Quaternion,
  StaticDrawUsage,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";

/**
 * InstancedMesh, envuelto para que no haya forma de usarlo mal.
 *
 * Es LA regla que decide si un juego 3D corre o no: **un draw call por tipo
 * de objeto, no por objeto**. Quinientas cajas como quinientas mallas son
 * quinientos draw calls y veinte fps; las mismas cajas como una instancia son
 * uno y sesenta. En este catalogo el limite no son los triangulos, son los
 * draw calls.
 *
 * El escritor reserva su capacidad al crearse y no asigna NADA despues: los
 * `Vector3`, `Quaternion`, `Matrix4` y `Color` que hacen falta para componer
 * cada matriz viven aca adentro y se reusan. Se puede llamar desde `useFrame`
 * sin miedo.
 *
 * Uso por cuadro:
 *
 *     writer.begin();
 *     for (const wall of walls) writer.push(wall.x, wall.y, wall.z, wall.w, wall.h, wall.d);
 *     writer.end();
 *
 * Lo que sobra de la capacidad no se dibuja: `end()` deja `mesh.count` en lo
 * que se escribio de verdad.
 */

export type InstanceWriter = {
  readonly mesh: InstancedMesh;
  readonly capacity: number;
  /** Instancias escritas en la pasada actual. */
  readonly count: number;

  /** Arranca una pasada. Todo lo que no se vuelva a escribir desaparece. */
  begin(): void;
  /** Sin rotacion. Devuelve false si se lleno la capacidad. */
  push(x: number, y: number, z: number, sx: number, sy?: number, sz?: number): boolean;
  /** Rotacion sobre el eje Y, que es la del 95% de lo que gira en estos juegos. */
  pushYaw(
    x: number,
    y: number,
    z: number,
    yaw: number,
    sx: number,
    sy?: number,
    sz?: number,
  ): boolean;
  /** Rotacion libre. El cuaternion tiene que venir normalizado. */
  pushQuat(
    x: number,
    y: number,
    z: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    sx: number,
    sy?: number,
    sz?: number,
  ): boolean;
  /**
   * Color de la ultima instancia escrita, en componentes lineales 0..1.
   * Solo si el escritor se creo con `colors: true`.
   */
  tint(r: number, g: number, b: number): void;
  /** Cierra la pasada y sube los buffers a la GPU. */
  end(): void;
  /**
   * Libera el InstancedMesh. NO toca la geometria ni el material: son
   * compartidos y los libera `disposeGeometries` / `disposeMaterials`.
   */
  dispose(): void;
};

export type InstanceWriterOptions = {
  /** Reserva el buffer de color por instancia. Cuesta memoria: solo si se usa. */
  colors?: boolean;
  /**
   * Culling de frustum del conjunto.
   *
   * Apagado por defecto y a proposito. Un InstancedMesh es un solo draw call:
   * cullearlo no ahorra casi nada, y hacerlo bien obliga a recalcular la
   * esfera envolvente cada cuadro. Con la esfera vieja el conjunto entero
   * desaparece cuando las instancias se alejan, que es un bug caro de
   * encontrar y facil de evitar.
   */
  frustumCulled?: boolean;
  /** Sombras: apagadas por defecto, como manda el contrato. */
  castShadow?: boolean;
  receiveShadow?: boolean;
};

export function createInstanceWriter(
  geometry: BufferGeometry,
  material: Material,
  capacity: number,
  options: InstanceWriterOptions = {},
): InstanceWriter {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = options.frustumCulled ?? false;
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  mesh.count = 0;

  // Scratch: se crean una vez y se reusan en cada push.
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const matrix = new Matrix4();
  const color = new Color();
  const axisY = new Vector3(0, 1, 0);

  if (options.colors === true) {
    // `setColorAt` crea el buffer la primera vez: mejor tenerlo antes de
    // entrar al loop que descubrir la asignacion a mitad de partida.
    color.setRGB(1, 1, 1);
    for (let i = 0; i < capacity; i++) mesh.setColorAt(i, color);
  }

  let written = 0;

  function write(): boolean {
    if (written >= capacity) return false;
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(written, matrix);
    written++;
    return true;
  }

  return {
    mesh,
    capacity,
    get count() {
      return written;
    },

    begin() {
      written = 0;
    },

    push(x, y, z, sx, sy, sz) {
      position.set(x, y, z);
      quaternion.set(0, 0, 0, 1);
      scale.set(sx, sy ?? sx, sz ?? sx);
      return write();
    },

    pushYaw(x, y, z, yaw, sx, sy, sz) {
      position.set(x, y, z);
      quaternion.setFromAxisAngle(axisY, yaw);
      scale.set(sx, sy ?? sx, sz ?? sx);
      return write();
    },

    pushQuat(x, y, z, qx, qy, qz, qw, sx, sy, sz) {
      position.set(x, y, z);
      quaternion.set(qx, qy, qz, qw);
      scale.set(sx, sy ?? sx, sz ?? sx);
      return write();
    },

    tint(r, g, b) {
      if (written === 0) return;
      color.setRGB(r, g, b);
      mesh.setColorAt(written - 1, color);
    },

    end() {
      mesh.count = written;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    dispose() {
      mesh.dispose();
    },
  };
}

/**
 * Escribe una lista fija de una sola vez.
 *
 * Para lo que no se mueve —paredes, cobertura, decorado— que no tiene sentido
 * reescribir sesenta veces por segundo. Se llama una vez al armar el nivel y
 * despues el escritor no se toca.
 */
export function fillStatic<T>(
  writer: InstanceWriter,
  items: readonly T[],
  write: (item: T, writer: InstanceWriter) => void,
): void {
  writer.begin();
  for (const item of items) write(item, writer);
  writer.end();
  // Estatico: el buffer no se vuelve a tocar, asi que conviene avisarle a la
  // GPU que puede quedarse con el.
  writer.mesh.instanceMatrix.setUsage(StaticDrawUsage);
}
