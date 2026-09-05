import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type {
  Color} from "three";
import {
  AdditiveBlending,
  CylinderGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type DirectionalLight,
  type Group,
  type Mesh,
  type PerspectiveCamera,
} from "three";
import type { NetSnapshot } from "@/core/net/snapshot";
import { getGeometry } from "@/core/engine3d/geometry";
import { getColor, getMaterial } from "@/core/engine3d/materials";
import { getSkyMaterial, getTideMaterial, tickShaders } from "@/core/engine3d/shaders";
import { createInstanceWriter, fillStatic, type InstanceWriter } from "@/core/engine3d/instancing";
import { useFixedStep } from "@/core/engine3d/useFixedStep";
import {
  MAP_SIZE,
  MAX_CARS,
  MAX_CHESTS,
  MAX_PLAYERS,
  WEAPON_CANON,
  WEAPON_MANGUERA,
  mountainHeight,
  terrainHeight,
  terrainSlope,
  valueNoise,
  type ShooterMap,
} from "./map";
import { EYE_HEIGHT, groundHeight, lookDirection } from "./logic";
import {
  SEAT_TOKENS,
  SPARK_MAX,
  SPARK_STRIDE,
  TRACER_MAX,
  TRACER_STRIDE,
  frameView,
  type ShooterView,
} from "./view";

/**
 * X4 · Bubble Shooter Game — la escena.
 *
 * Todo lo que se ve sale de `ShooterView`; aca no hay estado de juego, solo
 * buffers de instancias que se reescriben por cuadro y una camara. La regla
 * que decide si esto corre en un celular es una sola: **un draw call por
 * familia**. Diez jugadores son un draw call de cuerpos, uno de cabezas, uno
 * de visores, uno de armas y uno de sombras; sesenta rocas son uno; todos los
 * cofres, dos; los autos, tres; todas las estelas, uno.
 *
 * Lo que la hace un lugar y no una grilla de cajas:
 *
 * - **El terreno es UNA malla** que sigue `terrainHeight` —la misma funcion
 *   que usa la fisica, asi lo que se ve es exactamente lo que se pisa— con
 *   el color horneado por vertice: pasto en el llano, roca en la ladera,
 *   mas oscuro donde la pendiente aprieta. Sin texturas, sin sombras.
 * - **Cielo de atardecer** por shader, con la niebla del mismo tono para que
 *   el borde del mundo se funda en la luz en vez de cortarse.
 * - **Aditivo para lo que brilla**: destellos, estelas, salpicaduras, halos
 *   de cofre y el anillo. Sobre un atardecer, aditivo es luz.
 */

const WALL_HEIGHT = 3;
const RING_HEIGHT = 40;
const SKY_RADIUS = 300;
const FOV_FPV = 78;
const FOV_DRIVE = 68;
const FOV_SPECTATOR = 58;
/** Mas cerrado que el resto: es un retrato, no un paisaje. */
const FOV_LOBBY = 42;
/** Cuantas celdas por lado tiene la malla del terreno. */
const TERRAIN_SEGMENTS = 120;
/**
 * Gotas por chorro. El disparo se resuelve como un rayo recto —eso es lo que
 * decide si pega— pero se DIBUJA como agua: unas cuantas gotas repartidas a
 * lo largo, con una panza hacia abajo que es cero en las dos puntas.
 */
const DROPS = 7;
const DROP_SAG = 0.055;

export type ShooterSceneProps = {
  view: ShooterView;
  /** Con `false` no simula: pausa, cuenta regresiva, resumen. */
  enabled: boolean;
  /** Un paso fijo. Lo arma `ShooterGame` sobre el ciclo de vida. */
  tick: (dt: number) => void;
  /** El estado interpolado de `useGameNet`. En el host devuelve null. */
  sampleState: () => NetSnapshot | null;
  /**
   * La pantalla de inicio: el personaje sobre un pedestal, con el valle
   * detras. Se prende antes de empezar, que es cuando se elige nombre y color.
   */
  lobby: boolean;
};

export function ShooterScene(props: ShooterSceneProps) {
  return (
    <>
      <fogExp2 attach="fog" args={[getColor("--sn-sunset-low"), 0.0045]} />
      <ambientLight intensity={0.25} />
      {/*
        Hemisferica: el cielo calido arriba, el pasto abajo. Es la luz que hace
        que una capsula de un solo color no se vea plana desde ningun angulo.
      */}
      <hemisphereLight args={[getColor("--sn-sunset-horizon"), getColor("--sn-grass-600"), 0.85]} />

      <Terrain map={props.view.map} />
      <Arena map={props.view.map} />
      <Runtime {...props} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* El terreno                                                          */
/* ------------------------------------------------------------------ */

/** Hasta donde llega la sombra de contacto al pie de una roca, en unidades. */
const AO_REACH = 2.4;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(a: number, b: number, t: number): number {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

/**
 * La malla del terreno: un plano subdividido, cada vertice a la altura que
 * dice `terrainHeight`, con el color horneado segun pendiente y altura.
 *
 * Se construye una vez por mapa. 121 x 121 vertices son ~29 mil triangulos:
 * es el objeto mas pesado de la escena y aun asi un solo draw call.
 */
function buildTerrain(map: ShooterMap): BufferGeometry {
  const geometry = new PlaneGeometry(MAP_SIZE, MAP_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  const count = position.count;
  const colors = new Float32Array(count * 3);

  const grassA = getColor("--sn-grass-400");
  const grassB = getColor("--sn-grass-600");
  const rockA = getColor("--sn-rock-400");
  const rockB = getColor("--sn-rock-600");

  for (let i = 0; i < count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const h = terrainHeight(map, x, z);
    position.setY(i, h);

    let mountain = 0;
    for (const m of map.mountains) mountain += mountainHeight(m, x, z);
    const slope = terrainSlope(map, x, z);

    // Roca donde la ladera aprieta o el cerro sube; pasto en el resto.
    const rockiness = Math.min(1, smoothstep(0.45, 0.95, slope) + smoothstep(6, 20, mountain) * 0.65);
    /*
     * Manchones de pasto: dos escalas de ruido, una de claros grandes y otra
     * de mata chica. Es el mismo ruido que ondula el terreno, con otra escala,
     * asi el color acompania a la forma en vez de contradecirla.
     */
    const patch = clamp01(
      valueNoise(x, z, 17, map.noiseSeed) * 0.7 + valueNoise(x, z, 4.5, map.noiseSeed + 31) * 0.3,
    );
    const rockShade = smoothstep(4, 24, mountain);
    /*
     * Oclusion horneada: oscurece donde la pendiente aprieta y al pie de las
     * rocas. Es lo que hace que una caja apoyada en el pasto se vea apoyada y
     * no pegada encima, sin una sola sombra dinamica.
     */
    let contact = 0;
    for (const box of map.cover) {
      const dx = Math.max(0, Math.abs(x - box.x) - box.w / 2);
      const dz = Math.max(0, Math.abs(z - box.z) - box.d / 2);
      const d = Math.hypot(dx, dz);
      if (d < AO_REACH) contact = Math.max(contact, 1 - d / AO_REACH);
    }
    const shade = (1 - Math.min(0.35, slope * 0.22)) * (1 - contact * 0.4);

    const gr = grassA.r + (grassB.r - grassA.r) * patch;
    const gg = grassA.g + (grassB.g - grassA.g) * patch;
    const gb = grassA.b + (grassB.b - grassA.b) * patch;
    const rr = rockA.r + (rockB.r - rockA.r) * rockShade;
    const rg = rockA.g + (rockB.g - rockA.g) * rockShade;
    const rb = rockA.b + (rockB.b - rockA.b) * rockShade;

    colors[i * 3] = (gr + (rr - gr) * rockiness) * shade;
    colors[i * 3 + 1] = (gg + (rg - gg) * rockiness) * shade;
    colors[i * 3 + 2] = (gb + (rb - gb) * rockiness) * shade;
  }
  position.needsUpdate = true;
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function Terrain({ map }: { map: ShooterMap }) {
  const geometry = useMemo(() => buildTerrain(map), [map]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Blanco por vertice: el color viene entero del atributo.
  const material = getMaterial("--sn-text", { kind: "lambert", vertexColors: true });
  return <mesh geometry={geometry} material={material} dispose={null} />;
}

/* ------------------------------------------------------------------ */
/* Lo que no se mueve                                                   */
/* ------------------------------------------------------------------ */

function Arena({ map }: { map: ShooterMap }) {
  const half = MAP_SIZE / 2;
  const rock = getMaterial("--sn-rock-400", { kind: "lambert", vertexColors: true });
  const wall = getMaterial("--sn-rock-600", { kind: "lambert", vertexColors: true });

  const rocks = useMemo<InstanceWriter>(
    () => createInstanceWriter(getGeometry("boxShaded"), rock, 96, { colors: true }),
    [rock],
  );
  const walls = useMemo<InstanceWriter>(
    () => createInstanceWriter(getGeometry("boxShaded"), wall, 4),
    [wall],
  );
  useEffect(
    () => () => {
      rocks.dispose();
      walls.dispose();
    },
    [rocks, walls],
  );

  useEffect(() => {
    fillStatic(rocks, map.cover, (box, writer) => {
      writer.push(box.x, box.y, box.z, box.w, box.h, box.d);
      /*
       * Cada roca, un gris apenas distinto. Sale de su posicion y no de un
       * azar: es el mismo peniasco en las diez pantallas. Sin esto, sesenta
       * cajas del mismo tono exacto se leen como sesenta copias.
       */
      const tone = 0.82 + valueNoise(box.x, box.z, 7, map.noiseSeed + 91) * 0.36;
      writer.tint(tone, tone, tone);
    });
    // Un murete bajo de roca en el borde: del mapa no se sale, y se ve donde
    // termina sin una pared de neon.
    fillStatic(
      walls,
      [
        { x: 0, z: -half, w: MAP_SIZE + 1, d: 1 },
        { x: 0, z: half, w: MAP_SIZE + 1, d: 1 },
        { x: -half, z: 0, w: 1, d: MAP_SIZE + 1 },
        { x: half, z: 0, w: 1, d: MAP_SIZE + 1 },
      ],
      (segment, writer) => {
        writer.push(segment.x, WALL_HEIGHT / 2, segment.z, segment.w, WALL_HEIGHT + 2, segment.d);
      },
    );
  }, [rocks, walls, map, half]);

  return (
    <>
      <primitive object={rocks.mesh} />
      <primitive object={walls.mesh} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Lo que se mueve                                                      */
/* ------------------------------------------------------------------ */

/**
 * El color de un asiento: el que esa persona eligio, o el de su numero
 * mientras no haya llegado ningun estado que lo diga.
 */
function skinOf(view: ShooterView, seat: number): number {
  const skin = view.skin[seat] ?? seat;
  return skin < SEAT_TOKENS.length ? skin : seat % SEAT_TOKENS.length;
}

type Writers = Record<
  | "bodies"
  | "heads"
  | "visors"
  | "guns"
  | "shadows"
  | "flashes"
  | "beacons"
  | "tracers"
  | "sparks"
  | "carBodies"
  | "carCabins"
  | "wheels"
  | "chestBases"
  | "chestLids"
  | "halos",
  InstanceWriter
>;

function Runtime({ view, enabled, tick, sampleState, lobby }: ShooterSceneProps) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;

  const tickRef = useRef(tick);
  tickRef.current = tick;
  const sampleRef = useRef(sampleState);
  sampleRef.current = sampleState;

  // Paso fijo ANTES del cuadro (prioridad negativa): primero se simula,
  // despues se dibuja lo simulado.
  useFixedStep((dt) => tickRef.current(dt), { enabled, priority: -1 });

  /* Materiales y escritores. Se crean una vez y se reusan por cuadro. */
  const tinted = getMaterial("--sn-text", { kind: "lambert" });
  const tintedShaded = getMaterial("--sn-text", { kind: "lambert", vertexColors: true });
  const visorMaterial = getMaterial("--sn-cyan-300", { kind: "basic" });
  const gunMaterial = getMaterial("--sn-panel-hi", { kind: "lambert" });
  const shadowMaterial = getMaterial("--sn-bg", { kind: "basic", opacity: 0.45 });
  const wheelMaterial = getMaterial("--sn-panel", { kind: "lambert" });

  const additive = useMemo(
    () =>
      new MeshBasicMaterial({
        color: getColor("--sn-text"),
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  const glow = useMemo(
    () =>
      new MeshBasicMaterial({
        color: getColor("--sn-text"),
        transparent: true,
        opacity: 0.28,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  const ringGeometry = useMemo(() => {
    const geometry = new CylinderGeometry(1, 1, 1, 72, 1, true);
    geometry.translate(0, 0.5, 0);
    return geometry;
  }, []);
  const skyGeometry = useMemo(() => new SphereGeometry(SKY_RADIUS, 24, 12), []);
  useEffect(
    () => () => {
      additive.dispose();
      glow.dispose();
      ringGeometry.dispose();
      skyGeometry.dispose();
    },
    [additive, glow, ringGeometry, skyGeometry],
  );

  const writers = useMemo<Writers>(
    () => ({
      bodies: createInstanceWriter(getGeometry("capsule"), tinted, MAX_PLAYERS, { colors: true }),
      heads: createInstanceWriter(getGeometry("sphere"), tinted, MAX_PLAYERS, { colors: true }),
      visors: createInstanceWriter(getGeometry("box"), visorMaterial, MAX_PLAYERS),
      guns: createInstanceWriter(getGeometry("box"), gunMaterial, MAX_PLAYERS),
      shadows: createInstanceWriter(getGeometry("disc"), shadowMaterial, MAX_PLAYERS + MAX_CARS),
      flashes: createInstanceWriter(getGeometry("sphere"), additive, MAX_PLAYERS, { colors: true }),
      beacons: createInstanceWriter(getGeometry("cylinder"), glow, MAX_PLAYERS, { colors: true }),
      tracers: createInstanceWriter(getGeometry("sphere"), additive, TRACER_MAX * DROPS, { colors: true }),
      sparks: createInstanceWriter(getGeometry("box"), additive, SPARK_MAX, { colors: true }),
      carBodies: createInstanceWriter(getGeometry("boxShaded"), tintedShaded, MAX_CARS, { colors: true }),
      carCabins: createInstanceWriter(getGeometry("boxShaded"), tintedShaded, MAX_CARS, { colors: true }),
      wheels: createInstanceWriter(getGeometry("cylinder"), wheelMaterial, MAX_CARS * 4),
      chestBases: createInstanceWriter(getGeometry("boxShaded"), tintedShaded, MAX_CHESTS, { colors: true }),
      chestLids: createInstanceWriter(getGeometry("boxShaded"), tintedShaded, MAX_CHESTS, { colors: true }),
      halos: createInstanceWriter(getGeometry("disc"), glow, MAX_CHESTS, { colors: true }),
    }),
    [tinted, tintedShaded, visorMaterial, gunMaterial, shadowMaterial, wheelMaterial, additive, glow],
  );
  useEffect(
    () => () => {
      for (const writer of Object.values(writers)) writer.dispose();
    },
    [writers],
  );

  /** Colores por asiento en lineal, listos para `tint`. */
  const skinRgb = useMemo(() => {
    const out = new Float32Array(MAX_PLAYERS * 3);
    SEAT_TOKENS.forEach((token, index) => {
      const color = getColor(token);
      out[index * 3] = color.r;
      out[index * 3 + 1] = color.g;
      out[index * 3 + 2] = color.b;
    });
    return out;
  }, []);
  const palette = useMemo(
    () => ({
      warm: getColor("--sn-warn"),
      water: getColor("--sn-water-400"),
      carPaint: getColor("--sn-rock-400"),
      carFree: getColor("--sn-text-dim"),
      // Un color por arma de cofre: se sabe que da antes de abrirlo.
      chestCommon: getColor("--sn-cyan-400"),
      chestUncommon: getColor("--sn-violet-300"),
      chestRare: getColor("--sn-warn"),
      chestOpened: getColor("--sn-text-dim"),
    }),
    [],
  );

  const skyRef = useRef<Mesh>(null);
  const ringRef = useRef<Mesh>(null);
  const avatarRef = useRef<Mesh>(null);
  const sunRef = useRef<Mesh>(null);
  const sunLightRef = useRef<DirectionalLight>(null);

  /**
   * El sol: un disco emisivo lejano y la luz que lo acompania.
   *
   * El material es propio y no del cache porque su color cambia durante la
   * partida — mutar uno compartido pintaria medio catalogo de naranja.
   */
  const sunMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: getColor("--sn-sunset-horizon").clone(),
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => sunMaterial.dispose(), [sunMaterial]);
  /** Los dos extremos del atardecer y el color que se mezcla entre ellos. */
  const sunColors = useMemo(
    () => ({
      alto: getColor("--sn-sunset-horizon").clone(),
      bajo: getColor("--sn-sunset-low").clone(),
      actual: getColor("--sn-sunset-horizon").clone(),
      dir: new Vector3(),
    }),
    [],
  );

  /**
   * Donde se para el personaje en la pantalla de inicio: su propio punto de
   * aparicion, sobre el terreno. Es un lugar del mapa y no un limbo negro,
   * asi que detras se ve el valle y el atardecer de esta partida.
   */
  const pedestal = useMemo(() => {
    const spawn = view.map.spawns[view.seat] ?? { x: 0, z: 40 };
    return { x: spawn.x, y: terrainHeight(view.map, spawn.x, spawn.z), z: spawn.z };
  }, [view.map, view.seat]);
  const viewmodelRef = useRef<Group>(null);
  const gunRef = useRef<Group>(null);
  const muzzleRef = useRef<Mesh>(null);

  /** Scratch de la camara y de las estelas: se crean una vez. */
  const scratch = useMemo(
    () => ({
      dir: new Float32Array(3),
      v: new Vector3(),
      camPos: new Vector3(),
      camTarget: new Vector3(),
      lookAt: new Vector3(),
      mode: "",
      settled: false,
    }),
    [],
  );

  useEffect(() => {
    camera.rotation.order = "YXZ";
  }, [camera]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    frameView(view, dt, sampleRef.current());
    tickShaders(view.elapsed);

    const local = !view.isHost || view.hostPlaying;
    const driving = !lobby && local && view.ownDriving >= 0 && !view.spectating && view.state !== 3;
    const fpv = !lobby && local && !driving && !view.spectating && view.state !== 3;
    driveCamera(view, camera, scratch, fpv, driving, lobby, pedestal, dt);

    // El personaje del pedestal: gira despacio y lleva el color elegido.
    const avatar = avatarRef.current;
    if (avatar) {
      avatar.rotation.y = view.reducedMotion ? 0.6 : view.elapsed * 0.5;
      // Lo elegido en el acto, sin pasar por la red: la partida no empezo.
      // `getMaterial` cachea por token, asi que asignar el mismo no cuesta.
      const chosen = SEAT_TOKENS[view.ownSkin % SEAT_TOKENS.length] ?? "--sn-text";
      avatar.material = getMaterial(chosen, { kind: "lambert" });
    }

    const sky = skyRef.current;
    if (sky) sky.position.copy(camera.position);
    driveSun(view, camera, sunLightRef.current, sunRef.current, sunMaterial, sunColors);

    const ring = ringRef.current;
    if (ring) {
      ring.visible = view.state >= 1 && view.ringRadius > 0.5;
      ring.position.set(view.ringX, -2, view.ringZ);
      ring.scale.set(view.ringRadius, RING_HEIGHT, view.ringRadius);
    }

    writePlayers(view, writers, skinRgb, palette, fpv, scratch.dir);
    writeCars(view, writers, skinRgb, palette);
    writeChests(view, writers, palette);
    writeEffects(view, writers, skinRgb, palette);
    driveViewmodel(view, viewmodelRef.current, gunRef.current, muzzleRef.current, camera, fpv);
  });

  return (
    <>
      <mesh
        ref={skyRef}
        geometry={skyGeometry}
        material={getSkyMaterial("--sn-sunset-top", "--sn-sunset-horizon", "--sn-sunset-low")}
        dispose={null}
      />
      {/* El sol y su luz. Bajan juntos durante la partida (ver `driveSun`). */}
      <directionalLight ref={sunLightRef} position={[70, 55, -40]} intensity={1.15} />
      <mesh
        ref={sunRef}
        geometry={getGeometry("sphere")}
        material={sunMaterial}
        scale={26}
        dispose={null}
      />

      <mesh ref={ringRef} geometry={ringGeometry} material={getTideMaterial("--sn-water-400")} dispose={null} />

      {Object.values(writers).map((writer, index) => (
        <primitive key={index} object={writer.mesh} />
      ))}

      {/*
        El personaje de la pantalla de inicio. Se monta y se desmonta con la
        fase, asi que ni la malla ni su luz existen mientras se juega.
      */}
      {lobby && (
        <group position={[pedestal.x, pedestal.y, pedestal.z]}>
          <mesh
            ref={avatarRef}
            position={[0, 1.5, 0]}
            geometry={getGeometry("avatar")}
            material={getMaterial("--sn-text", { kind: "lambert" })}
            scale={1.8}
            dispose={null}
          />
          <mesh
            position={[0, 0.3, 0]}
            geometry={getGeometry("cylinder")}
            material={getMaterial("--sn-rock-600", { kind: "lambert" })}
            scale={[1.9, 0.6, 1.9]}
            dispose={null}
          />
          {/* Una luz propia: el sol esta bajo y el personaje quedaria plano. */}
          <pointLight position={[1.6, 3.2, 2.4]} intensity={18} distance={14} decay={2} />
        </group>
      )}

      {/*
        El arma en primera persona. Cuelga de un grupo que se pega a la camara
        por cuadro; no es hijo de la camara porque R3F no la monta en el arbol.
      */}
      <group ref={viewmodelRef} visible={false}>
        <group ref={gunRef} position={[0.36, -0.32, -0.7]} rotation={[0, -0.1, 0]}>
          <mesh
            geometry={getGeometry("boxShaded")}
            material={getMaterial("--sn-panel-hi", { kind: "lambert", vertexColors: true })}
            scale={[0.055, 0.085, 0.36]}
            dispose={null}
          />
          <mesh
            position={[0, 0.015, -0.34]}
            geometry={getGeometry("box")}
            material={getMaterial("--sn-panel", { kind: "lambert" })}
            scale={[0.028, 0.028, 0.34]}
            dispose={null}
          />
          <mesh
            position={[0, 0.05, -0.08]}
            geometry={getGeometry("box")}
            material={getMaterial("--sn-water-400", { kind: "basic" })}
            scale={[0.012, 0.008, 0.26]}
            dispose={null}
          />
          <mesh
            ref={muzzleRef}
            position={[0, 0.015, -0.54]}
            geometry={getGeometry("sphere")}
            material={additive}
            scale={0.1}
            dispose={null}
          />
        </group>
      </group>
    </>
  );
}

type CameraScratch = {
  dir: Float32Array;
  v: Vector3;
  camPos: Vector3;
  camTarget: Vector3;
  lookAt: Vector3;
  mode: string;
  settled: boolean;
};

type Palette = {
  warm: { r: number; g: number; b: number };
  water: { r: number; g: number; b: number };
  carPaint: { r: number; g: number; b: number };
  carFree: { r: number; g: number; b: number };
  chestCommon: { r: number; g: number; b: number };
  chestUncommon: { r: number; g: number; b: number };
  chestRare: { r: number; g: number; b: number };
  chestOpened: { r: number; g: number; b: number };
};

/**
 * La camara.
 *
 * En primera persona, en los ojos del cuerpo predicho, con un balanceo
 * minimo al caminar y una sacudida corta al recibir dano. Manejando, en
 * tercera persona detras del auto. En el proyector —y en el celular de un
 * eliminado— una orbita lenta alrededor del centro de la accion. Con
 * movimiento reducido no hay balanceo, ni sacudida, ni orbita.
 */
function driveCamera(
  view: ShooterView,
  camera: PerspectiveCamera,
  scratch: CameraScratch,
  fpv: boolean,
  driving: boolean,
  lobby: boolean,
  pedestal: { x: number; y: number; z: number },
  dt: number,
): void {
  const mode = lobby ? "lobby" : fpv ? "fpv" : driving ? "drive" : "spectator";
  if (mode !== scratch.mode) {
    scratch.mode = mode;
    scratch.settled = false;
    camera.fov = lobby ? FOV_LOBBY : fpv ? FOV_FPV : driving ? FOV_DRIVE : FOV_SPECTATOR;
    camera.updateProjectionMatrix();
  }

  if (lobby) {
    /*
     * Retrato con el valle detras. Dos cosas que no son obvias:
     *
     * - La camara mira desde donde viene el sol, para que el personaje se vea
     *   iluminado y no en contraluz.
     * - No apunta al personaje sino a un punto A SU DERECHA, lo que lo corre
     *   hacia la izquierda del encuadre. El panel del intro ocupa la derecha
     *   (ver `introShowcase` en GameStage): apuntando al centro, el personaje
     *   quedaria justo detras del panel.
     */
    const ox = 3.4;
    const oz = 4.6;
    camera.position.set(pedestal.x + ox, pedestal.y + 2.4, pedestal.z + oz);
    // Derecha de la camara = (-fz, fx) con el frente horizontal normalizado.
    const length = Math.hypot(ox, oz);
    const rightX = oz / length;
    const rightZ = -ox / length;
    const shift = 1.8;
    scratch.lookAt.set(
      pedestal.x + rightX * shift,
      pedestal.y + 1.35,
      pedestal.z + rightZ * shift,
    );
    camera.lookAt(scratch.lookAt);
    return;
  }

  if (fpv) {
    const body = view.body;
    const moving = Math.hypot(body.vx, body.vz) > 0.8 && body.onGround;
    const calm = view.reducedMotion;
    const bob = moving && !calm ? Math.sin(view.elapsed * 11) * 0.022 : 0;
    const shake = calm ? 0 : view.shake * 0.05;
    camera.position.set(
      body.x + Math.sin(view.elapsed * 97) * shake,
      body.y + EYE_HEIGHT + bob + Math.cos(view.elapsed * 89) * shake,
      body.z,
    );
    camera.rotation.set(view.camPitch + (calm ? 0 : view.recoil * 0.03), view.camYaw, 0);
    return;
  }

  if (driving) {
    const car = view.ownDriving;
    const cx = view.carX[car] ?? 0;
    const cy = view.carY[car] ?? 0;
    const cz = view.carZ[car] ?? 0;
    const yaw = view.carYaw[car] ?? 0;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    scratch.camTarget.set(cx - fx * 7.5, cy + 3.4, cz - fz * 7.5);
    scratch.v.set(cx + fx * 2, cy + 1.2, cz + fz * 2);
    if (!scratch.settled || view.reducedMotion) {
      scratch.camPos.copy(scratch.camTarget);
      scratch.lookAt.copy(scratch.v);
      scratch.settled = true;
    } else {
      const k = 1 - Math.exp(-dt * 6);
      scratch.camPos.lerp(scratch.camTarget, k);
      scratch.lookAt.lerp(scratch.v, k);
    }
    // La camara no se mete bajo el terreno en una bajada.
    const floor = terrainHeight(view.map, scratch.camPos.x, scratch.camPos.z) + 1.2;
    if (scratch.camPos.y < floor) scratch.camPos.y = floor;
    camera.position.copy(scratch.camPos);
    camera.lookAt(scratch.lookAt);
    return;
  }

  // Centro de la accion: el centroide de los vivos, o el anillo si no queda nadie.
  let cx = 0;
  let cz = 0;
  let count = 0;
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (view.active[seat] !== 1 || view.alive[seat] !== 1) continue;
    cx += view.x[seat] ?? 0;
    cz += view.z[seat] ?? 0;
    count++;
  }
  if (count === 0) {
    cx = view.ringX;
    cz = view.ringZ;
  } else {
    cx /= count;
    cz /= count;
  }
  let spread = 0;
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (view.active[seat] !== 1 || view.alive[seat] !== 1) continue;
    const d = Math.hypot((view.x[seat] ?? 0) - cx, (view.z[seat] ?? 0) - cz);
    if (d > spread) spread = d;
  }
  const radius = Math.min(130, Math.max(24, spread * 1.25 + 18));
  const angle = view.reducedMotion ? 0.8 : 0.8 + view.elapsed * 0.07;
  const groundAt = terrainHeight(view.map, cx, cz);
  scratch.camTarget.set(cx + Math.cos(angle) * radius, groundAt + 14 + radius * 0.72, cz + Math.sin(angle) * radius);
  scratch.v.set(cx, groundAt + 1.2, cz);

  if (!scratch.settled) {
    scratch.camPos.copy(scratch.camTarget);
    scratch.lookAt.copy(scratch.v);
    scratch.settled = true;
  } else {
    const k = 1 - Math.exp(-dt * 1.7);
    scratch.camPos.lerp(scratch.camTarget, k);
    scratch.lookAt.lerp(scratch.v, k);
  }
  camera.position.copy(scratch.camPos);
  camera.lookAt(scratch.lookAt);
}

/**
 * El sol baja mientras corre la partida.
 *
 * Arranca alto y dorado y termina raspando el horizonte y rojizo, de modo que
 * el anillo cerrandose y la luz apagandose empujan en la misma direccion: se
 * hace tarde. Sin sombras dinamicas — el volumen ya esta horneado en los
 * vertices, y un sol bajo lo resalta solo.
 *
 * El disco va pegado a la camara a 260 unidades, adentro del domo de cielo:
 * asi se ve igual de lejos desde cualquier punto del valle, como el cielo.
 */
function driveSun(
  view: ShooterView,
  camera: PerspectiveCamera,
  light: DirectionalLight | null,
  disc: Mesh | null,
  material: MeshBasicMaterial,
  scratch: { alto: Color; bajo: Color; actual: Color; dir: Vector3 },
): void {
  const total = Math.max(1, view.rules.matchSeconds);
  // Antes de empezar el sol esta en su punto mas alto: la pantalla de inicio
  // y el despliegue se ven con la mejor luz.
  const progress = Math.min(1, Math.max(0, view.timeS / total));
  const elevation = 0.62 - 0.56 * progress;
  const azimuth = -0.5;
  const cos = Math.cos(elevation);
  scratch.dir.set(cos * Math.sin(azimuth), Math.sin(elevation), cos * Math.cos(azimuth));

  scratch.actual.copy(scratch.alto).lerp(scratch.bajo, progress * 0.85);
  material.color.copy(scratch.actual);

  if (light) {
    light.position.set(scratch.dir.x * 120, scratch.dir.y * 120, scratch.dir.z * 120);
    light.color.copy(scratch.actual);
    // Se apaga a medida que cae, pero nunca del todo: en la ultima fase del
    // anillo todavia hay que ver a quien se le dispara.
    light.intensity = 1.25 - 0.6 * progress;
  }
  if (disc) {
    disc.position.set(
      camera.position.x + scratch.dir.x * 260,
      camera.position.y + scratch.dir.y * 260,
      camera.position.z + scratch.dir.z * 260,
    );
  }
}

/** Cuaternion de rumbo + inclinacion (orden YXZ), sin asignar. */
function writeAim(yaw: number, pitch: number, out: Float32Array): void {
  const ay = Math.sin(yaw / 2);
  const aw = Math.cos(yaw / 2);
  const bx = Math.sin(pitch / 2);
  const bw = Math.cos(pitch / 2);
  out[0] = aw * bx;
  out[1] = ay * bw;
  out[2] = -ay * bx;
  out[3] = aw * bw;
}

const aimScratch = new Float32Array(4);
const SQRT_HALF = Math.SQRT1_2;

function writePlayers(
  view: ShooterView,
  writers: Writers,
  skinRgb: Float32Array,
  palette: Palette,
  fpv: boolean,
  dir: Float32Array,
): void {
  const { bodies, heads, visors, guns, shadows, flashes, beacons } = writers;
  bodies.begin();
  heads.begin();
  visors.begin();
  guns.begin();
  shadows.begin();
  flashes.begin();
  beacons.begin();

  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (view.active[seat] !== 1 || view.alive[seat] !== 1) continue;
    const self = fpv && seat === view.seat;
    // Adentro del auto no se dibuja el cuerpo: la cabina lleva su color.
    const inCar = (view.driving[seat] ?? -1) >= 0;
    if (inCar) continue;
    const x = view.x[seat] ?? 0;
    const y = view.y[seat] ?? 0;
    const z = view.z[seat] ?? 0;
    const yaw = view.yaw[seat] ?? 0;
    const pitch = view.pitch[seat] ?? 0;
    const skin = skinOf(view, seat);
    const r = skinRgb[skin * 3] ?? 1;
    const g = skinRgb[skin * 3 + 1] ?? 1;
    const b = skinRgb[skin * 3 + 2] ?? 1;

    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    const gx = x + rx * 0.3 + fx * 0.32;
    const gy = y + 1.24;
    const gz = z + rz * 0.3 + fz * 0.32;

    if (!self) {
      bodies.pushYaw(x, y + 0.68, z, yaw, 1.5, 1.36, 1.5);
      bodies.tint(r, g, b);
      heads.pushYaw(x, y + 1.57, z, yaw, 0.42);
      heads.tint(r, g, b);
      visors.pushYaw(x + fx * 0.17, y + 1.6, z + fz * 0.17, yaw, 0.3, 0.09, 0.1);
      writeAim(yaw, pitch, aimScratch);
      // Un canion mas grande cuando el arma es de cofre: se ve que trae algo.
      const kind = view.weapon[seat] ?? 0;
      const gunLength = kind === WEAPON_CANON ? 1.1 : kind === WEAPON_MANGUERA ? 0.95 : 0.8;
      guns.pushQuat(
        gx,
        gy,
        gz,
        aimScratch[0] ?? 0,
        aimScratch[1] ?? 0,
        aimScratch[2] ?? 0,
        aimScratch[3] ?? 1,
        0.11,
        0.13,
        gunLength,
      );
      const ground = groundHeight(view.map, x, z, y);
      const lift = y - ground;
      shadows.push(x, ground + 0.03, z, Math.max(0.35, 0.95 - lift * 0.12));
    }

    const flash = view.flashes[seat] ?? 0;
    if (flash > 0 && !self) {
      lookDirection(yaw, pitch, dir);
      flashes.push(
        gx + (dir[0] ?? 0) * 0.5,
        gy + (dir[1] ?? 0) * 0.5,
        gz + (dir[2] ?? 0) * 0.5,
        0.55 * flash + 0.1,
      );
      flashes.tint(palette.water.r, palette.water.g, palette.water.b);
    }

    // Durante el despliegue, una columna de luz sobre cada uno.
    if (view.state === 1) {
      beacons.push(x, y + 7, z, 1.4, 14, 1.4);
      beacons.tint(r, g, b);
    }
  }

  // Las sombras de los autos van en el mismo escritor: misma familia.
  for (let car = 0; car < view.carCount; car++) {
    const x = view.carX[car] ?? 0;
    const z = view.carZ[car] ?? 0;
    shadows.push(x, (view.carY[car] ?? 0) + 0.04, z, 3.2);
  }

  bodies.end();
  heads.end();
  visors.end();
  guns.end();
  shadows.end();
  flashes.end();
  beacons.end();
}

/**
 * Los autos: carroceria, cabina y cuatro ruedas, tres draw calls para todos.
 * La cabina lleva el color de quien maneja: desde lejos se sabe quien va.
 */
function writeCars(view: ShooterView, writers: Writers, skinRgb: Float32Array, palette: Palette): void {
  const { carBodies, carCabins, wheels } = writers;
  carBodies.begin();
  carCabins.begin();
  wheels.begin();
  for (let car = 0; car < view.carCount; car++) {
    const x = view.carX[car] ?? 0;
    const y = view.carY[car] ?? 0;
    const z = view.carZ[car] ?? 0;
    const yaw = view.carYaw[car] ?? 0;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const driver = view.carDriver[car] ?? -1;

    carBodies.pushYaw(x, y + 0.62, z, yaw, 2.2, 0.7, 4.2);
    carBodies.tint(palette.carPaint.r, palette.carPaint.g, palette.carPaint.b);
    carCabins.pushYaw(x - fx * 0.3, y + 1.22, z - fz * 0.3, yaw, 1.7, 0.62, 2);
    if (driver >= 0) {
      const skin = skinOf(view, driver);
      carCabins.tint(skinRgb[skin * 3] ?? 1, skinRgb[skin * 3 + 1] ?? 1, skinRgb[skin * 3 + 2] ?? 1);
    } else {
      carCabins.tint(palette.carFree.r, palette.carFree.g, palette.carFree.b);
    }

    // Ruedas: el cilindro nace parado; se lo acuesta 90 grados en Z y se lo
    // gira con el auto. q = q_yaw * q_z90, sin asignar.
    const ay = Math.sin(yaw / 2);
    const aw = Math.cos(yaw / 2);
    const qx = ay * SQRT_HALF;
    const qy = ay * SQRT_HALF;
    const qz = aw * SQRT_HALF;
    const qw = aw * SQRT_HALF;
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const front = i < 2 ? 1 : -1;
      const wx = x + rx * side * 1.05 + fx * front * 1.4;
      const wz = z + rz * side * 1.05 + fz * front * 1.4;
      wheels.pushQuat(wx, y + 0.42, wz, qx, qy, qz, qw, 0.84, 0.36, 0.84);
    }
  }
  carBodies.end();
  carCabins.end();
  wheels.end();
}

/**
 * Los cofres: base y tapa instanciadas, con el color del arma que traen, y un
 * halo en el piso mientras esten cerrados. La tapa se levanta al abrirse.
 */
function writeChests(view: ShooterView, writers: Writers, palette: Palette): void {
  const { chestBases, chestLids, halos } = writers;
  chestBases.begin();
  chestLids.begin();
  halos.begin();
  const chests = view.map.chests;
  const pulse = 0.85 + 0.15 * Math.sin(view.elapsed * 2.4);
  for (let i = 0; i < chests.length && i < MAX_CHESTS; i++) {
    const chest = chests[i];
    if (!chest) continue;
    const opened = (view.chestOpened & (1 << i)) !== 0;
    const color = opened
      ? palette.chestOpened
      : chest.weapon === WEAPON_CANON
        ? palette.chestRare
        : chest.weapon === WEAPON_MANGUERA
          ? palette.chestUncommon
          : palette.chestCommon;

    chestBases.push(chest.x, chest.y + 0.45, chest.z, 1.4, 0.9, 1);
    chestBases.tint(color.r, color.g, color.b);

    // Bisagra atras (z + 0.5): la tapa gira sobre X y se para al abrirse.
    const angle = opened ? -1.4 : 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ly = 0.125 * cos - 0.5 * sin;
    const lz = 0.125 * sin + 0.5 * cos;
    chestLids.pushQuat(
      chest.x,
      chest.y + 0.9 + ly,
      chest.z + 0.5 - lz,
      Math.sin(angle / 2),
      0,
      0,
      Math.cos(angle / 2),
      1.4,
      0.25,
      1,
    );
    chestLids.tint(color.r, color.g, color.b);

    if (!opened) {
      halos.push(chest.x, chest.y + 0.05, chest.z, 3.6 * pulse);
      halos.tint(color.r, color.g, color.b);
    }
  }
  chestBases.end();
  chestLids.end();
  halos.end();
}

function writeEffects(
  view: ShooterView,
  writers: Writers,
  skinRgb: Float32Array,
  palette: Palette,
): void {
  const { tracers, sparks } = writers;
  const t = view.tracers;
  tracers.begin();
  for (let i = 0; i < TRACER_MAX; i++) {
    const base = i * TRACER_STRIDE;
    const age = t[base + 6] ?? 0;
    if (age <= 0) continue;
    const x0 = t[base] ?? 0;
    const y0 = t[base + 1] ?? 0;
    const z0 = t[base + 2] ?? 0;
    const dx = (t[base + 3] ?? 0) - x0;
    const dy = (t[base + 4] ?? 0) - y0;
    const dz = (t[base + 5] ?? 0) - z0;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.01) continue;

    // Agua del color de quien tira, apenas: se sabe de donde vino el chorro.
    const seat = Math.max(0, Math.min(MAX_PLAYERS - 1, Math.round(t[base + 7] ?? 0)));
    const skin = skinOf(view, seat);
    const r = (palette.water.r + (skinRgb[skin * 3] ?? 1)) * 0.5;
    const g = (palette.water.g + (skinRgb[skin * 3 + 1] ?? 1)) * 0.5;
    const b = (palette.water.b + (skinRgb[skin * 3 + 2] ?? 1)) * 0.5;

    /*
     * Las gotas avanzan con la edad en vez de aparecer todas juntas: el
     * chorro sale del canio y viaja, que es lo que lo hace leerse como agua
     * y no como un rayo laser. `age` va de 1 a 0, asi que el frente del
     * chorro es (1 - age).
     */
    const front = 1 - age;
    const sag = length * DROP_SAG;
    for (let drop = 0; drop < DROPS; drop++) {
      // Cada gota queda un poco atras del frente, repartidas en la cola.
      const along = front - (drop / DROPS) * 0.55;
      if (along <= 0 || along > 1) continue;
      const droop = sag * along * (1 - along) * 4;
      const size = (0.2 - drop * 0.014) * (0.5 + age * 0.5);
      tracers.push(x0 + dx * along, y0 + dy * along - droop, z0 + dz * along, Math.max(0.03, size));
      tracers.tint(r, g, b);
    }
  }
  tracers.end();

  const s = view.sparks;
  sparks.begin();
  for (let i = 0; i < SPARK_MAX; i++) {
    const base = i * SPARK_STRIDE;
    const age = s[base + 6] ?? 0;
    if (age <= 0) continue;
    sparks.push(s[base] ?? 0, s[base + 1] ?? 0, s[base + 2] ?? 0, 0.05 + 0.16 * age);
    sparks.tint(palette.water.r, palette.water.g, palette.water.b);
  }
  sparks.end();
}

/**
 * El arma en pantalla: pegada a la camara, con retroceso al disparar y un
 * balanceo al caminar. Se esconde fuera de primera persona.
 */
function driveViewmodel(
  view: ShooterView,
  root: Group | null,
  gun: Group | null,
  muzzle: Mesh | null,
  camera: PerspectiveCamera,
  fpv: boolean,
): void {
  if (!root) return;
  root.visible = fpv;
  if (!fpv) return;
  root.position.copy(camera.position);
  root.quaternion.copy(camera.quaternion);
  if (gun) {
    const body = view.body;
    const moving = Math.hypot(body.vx, body.vz) > 0.8 && body.onGround;
    const calm = view.reducedMotion;
    const bobX = moving && !calm ? Math.cos(view.elapsed * 5.5) * 0.012 : 0;
    const bobY = moving && !calm ? Math.sin(view.elapsed * 11) * 0.01 : 0;
    const kick = calm ? 0 : view.recoil;
    gun.position.set(0.36 + bobX, -0.32 + bobY + kick * 0.015, -0.7 + kick * 0.07);
    gun.rotation.set(kick * 0.1, -0.1, 0);
    // El arma de cofre se ve mas larga en la mano.
    const kind = view.ownWeapon;
    const stretch = kind === WEAPON_CANON ? 1.35 : kind === WEAPON_MANGUERA ? 1.15 : 1;
    gun.scale.set(1, 1, stretch);
    if (view.reloadLeft > 0) {
      const progress = 1 - view.reloadLeft / Math.max(0.01, view.ownSpec.reloadS);
      const dip = Math.sin(progress * Math.PI) * 0.16;
      gun.position.y -= dip;
      gun.rotation.z = dip * 2.2;
    }
  }
  if (muzzle) {
    const flash = view.flashes[view.seat] ?? 0;
    muzzle.visible = flash > 0;
    muzzle.scale.setScalar(0.06 + flash * 0.14);
  }
}
