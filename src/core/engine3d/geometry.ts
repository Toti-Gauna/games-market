import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Shape,
  SphereGeometry,
  TorusGeometry,
} from "three";

/**
 * Primitivas procedurales compartidas.
 *
 * Los cuatro juegos 3D del catalogo generan su geometria desde cero, sin
 * assets: eso evita todo el pipeline de modelado, texturas y carga. Lo que si
 * hay que evitar es la version 3D del error de asignar en el loop, que es
 * `new BoxGeometry()` por objeto. Cada primitiva se construye UNA vez, se
 * cachea y se comparte entre todas las instancias que la usen.
 *
 * Todas vienen en tamanio unitario y centradas en el origen: **1 de alto**,
 * y 1 de ancho las macizas. Las diferencias de tamanio las pone la escala de
 * cada instancia, que es gratis; una geometria por medida no lo es.
 *
 * Las dos excepciones al ancho, por lo que son: la capsula va esbelta (radio
 * 0.25) porque con radio 0.5 seria una esfera y lo que hace falta es una
 * silueta de persona, y la barrera es un panel de 0.1 de espesor.
 *
 * Al desmontar el juego hay que llamar `disposeGeometries()`. Lo hace `Stage`
 * solo; si un juego arma su propio canvas, es cosa suya. Sin eso los buffers
 * quedan vivos en la GPU y montar y desmontar el juego veinte veces hace
 * crecer la memoria hasta tirar la pestania.
 *
 * **Trampa de R3F, y es la que mas caro sale**: al desmontar una malla, R3F
 * libera su geometria y su material. Con una primitiva compartida eso es un
 * desastre: se desmonta un enemigo y desaparecen todas las cajas del nivel,
 * porque el buffer que se libero era el de todos. Cuando una primitiva de
 * aca va como prop, la malla tiene que declararlo:
 *
 *     <mesh geometry={getGeometry("box")} material={wall} dispose={null} />
 *
 * Con `createInstanceWriter` no hace falta: el `InstancedMesh` entra por
 * `<primitive object={writer.mesh} />`, que R3F no libera.
 */

export type GeometryKey =
  | "box"
  | "boxShaded"
  | "disc"
  | "cylinder"
  | "capsule"
  | "sphere"
  | "ramp"
  | "arch"
  | "column"
  | "barrier"
  | "avatar";

const cache = new Map<GeometryKey, BufferGeometry>();

/**
 * La primitiva compartida. Dos llamadas con la misma clave devuelven el mismo
 * objeto: si hace falta una copia propia (para deformarla, por ejemplo), es
 * `getGeometry(k).clone()` y la disposicion corre por cuenta de quien clona.
 */
export function getGeometry(key: GeometryKey): BufferGeometry {
  const cached = cache.get(key);
  if (cached) return cached;
  const created = build(key);
  created.name = `sn-${key}`;
  cache.set(key, created);
  return created;
}

/** Cuantas primitivas hay vivas. Existe para los tests y para el panel de debug. */
export function geometryCacheSize(): number {
  return cache.size;
}

/** Descarte explicito. Va en el desmontaje del juego, siempre. */
export function disposeGeometries(): void {
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
}

/* ------------------------------------------------------------------ */
/* Construccion                                                        */
/* ------------------------------------------------------------------ */

function build(key: GeometryKey): BufferGeometry {
  switch (key) {
    case "box":
      return new BoxGeometry(1, 1, 1);

    case "boxShaded":
      return buildBoxShaded();

    case "disc":
      return buildDisc();

    case "cylinder":
      // 16 lados: por debajo se ve el poligono, por encima no se nota nada.
      return new CylinderGeometry(0.5, 0.5, 1, 16);

    case "capsule":
      // Radio 0.25 + tramo recto 0.5 = 1 de alto total.
      return new CapsuleGeometry(0.25, 0.5, 4, 8);

    case "sphere":
      return new SphereGeometry(0.5, 12, 8);

    case "ramp":
      return buildRamp();

    case "arch":
      return buildArch();

    case "column":
      // Apenas conica: una columna perfectamente cilindrica se lee como cano.
      return new CylinderGeometry(0.45, 0.5, 1, 12);

    case "barrier":
      // Panel de 0.1 de espesor. La escala lo estira a lo largo y a lo alto.
      return new BoxGeometry(1, 1, 0.1);

    case "avatar":
      return buildAvatar();
  }
}

/**
 * Caja con sombreado horneado en los vertices.
 *
 * Es lo que hace que una caja de color plano se lea como un volumen y no como
 * un recorte: la tapa va clara, los lados a medio tono y la base oscura. El
 * material tiene que pedirse con `vertexColors: true`, y el color por vertice
 * MULTIPLICA al del material: blanco arriba es "el color del material tal
 * cual", gris abajo es "el mismo, mas oscuro". Cuesta cero: es un atributo
 * mas en el buffer que ya existia.
 */
function buildBoxShaded(): BufferGeometry {
  const geometry = new BoxGeometry(1, 1, 1);
  const normals = geometry.getAttribute("normal");
  const count = normals.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const nx = normals.getX(i);
    const ny = normals.getY(i);
    const nz = normals.getZ(i);
    // Arriba 1.0, los lados que dan a +x/+z un poco mas claros que los
    // opuestos (una direccional imaginaria), y abajo apenas visible.
    let shade = 0.62;
    if (ny > 0.5) shade = 1.0;
    else if (ny < -0.5) shade = 0.35;
    else if (nx > 0.5 || nz > 0.5) shade = 0.74;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Disco horizontal de diametro 1, mirando hacia arriba. Para halos y sombras. */
function buildDisc(): BufferGeometry {
  const geometry = new CircleGeometry(0.5, 20);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * Prisma triangular que sube hacia +X.
 *
 * Sale de extruir un triangulo rectangulo en vez de armar los vertices a
 * mano: `ExtrudeGeometry` resuelve el orden de las caras y las normales, que
 * es justo donde se equivoca uno cuando lo escribe a mano y termina con la
 * rampa invisible desde un lado.
 */
function buildRamp(): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0.5, 0.5);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  // ExtrudeGeometry extruye desde z=0: hay que recentrar para que la caja
  // envolvente sea la unidad como en el resto de las primitivas.
  geometry.translate(0, 0, -0.5);
  return geometry;
}

/**
 * Arco de medio punto en el plano XY.
 *
 * Es el unico que no entra en el cubo unitario: un medio circulo mide el
 * doble de ancho que de alto y forzarlo lo dejaria elipsoide. Se normaliza a
 * 1 de alto —que es lo que hace que `scale.y` signifique lo mismo en todas
 * las primitivas— y el ancho queda en 2.
 */
function buildArch(): BufferGeometry {
  return fitUnitHeight(new TorusGeometry(0.5, 0.06, 6, 16, Math.PI));
}

/** Escala uniforme para que la pieza mida 1 de alto, y la centra en Y. */
function fitUnitHeight(geometry: BufferGeometry): BufferGeometry {
  geometry.computeBoundingBox();
  const raw = geometry.boundingBox;
  if (!raw) return geometry;
  const height = raw.max.y - raw.min.y;
  if (height > 0) geometry.scale(1 / height, 1 / height, 1 / height);

  geometry.computeBoundingBox();
  const scaled = geometry.boundingBox;
  if (scaled) geometry.translate(0, -(scaled.min.y + scaled.max.y) / 2, 0);
  return geometry;
}

/**
 * El avatar: capsula + cabeza + indicador de direccion. Sin rig y sin
 * animacion esqueletica.
 *
 * Las tres partes se funden en UNA geometria a proposito. Con tres mallas
 * separadas, diez jugadores son treinta draw calls; fundidas y instanciadas
 * son una sola, que es toda la diferencia entre correr y no correr.
 *
 * Mide 1 de alto con los pies en y = -0.5 y mira hacia +Z.
 */
function buildAvatar(): BufferGeometry {
  const matrix = new Matrix4();

  const body = new CapsuleGeometry(0.16, 0.36, 4, 8);
  body.translate(0, -0.16, 0);

  const head = new SphereGeometry(0.15, 10, 8);
  head.translate(0, 0.35, 0);

  // El cono nace apuntando a +Y: se lo acuesta para que marque el frente.
  const nose = new ConeGeometry(0.09, 0.2, 6);
  matrix.makeRotationX(Math.PI / 2);
  nose.applyMatrix4(matrix);
  nose.translate(0, 0.06, 0.2);

  const merged = mergeParts([body, head, nose]);
  // Las partes ya no se usan: sus buffers se sueltan en el acto.
  body.dispose();
  head.dispose();
  nose.dispose();
  return merged;
}

/**
 * Fusion minima de geometrias no indexadas: posicion y normal, nada mas.
 *
 * No entra `BufferGeometryUtils` de los ejemplos de three porque lo unico que
 * hace falta son estos veinte renglones, y las primitivas de aca no tienen ni
 * UVs ni grupos que respetar.
 */
function mergeParts(parts: readonly BufferGeometry[]): BufferGeometry {
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));

  let total = 0;
  for (const part of flat) total += attribute(part, "position").count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  let offset = 0;
  for (const part of flat) {
    const positions = attribute(part, "position");
    const normals = attribute(part, "normal");
    position.set(positions.array as Float32Array, offset * 3);
    normal.set(normals.array as Float32Array, offset * 3);
    offset += positions.count;
  }

  // `toNonIndexed` devuelve geometrias nuevas: las que no son la original se
  // descartan aca o quedan colgadas.
  for (let i = 0; i < flat.length; i++) {
    const copy = flat[i];
    if (copy && copy !== parts[i]) copy.dispose();
  }

  const merged = new BufferGeometry();
  merged.setAttribute("position", new BufferAttribute(position, 3));
  merged.setAttribute("normal", new BufferAttribute(normal, 3));
  merged.computeBoundingSphere();
  return merged;
}

function attribute(geometry: BufferGeometry, name: "position" | "normal"): BufferAttribute {
  const found = geometry.getAttribute(name);
  if (!found) throw new Error(`La geometria no tiene el atributo ${name}`);
  return found as BufferAttribute;
}
