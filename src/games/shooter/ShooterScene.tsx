import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  CylinderGeometry,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Group,
  type Mesh,
  type PerspectiveCamera,
} from "three";
import type { NetSnapshot } from "@/core/net/snapshot";
import { getGeometry } from "@/core/engine3d/geometry";
import { getColor, getMaterial } from "@/core/engine3d/materials";
import { getGridFloorMaterial, getRingMaterial, getSkyMaterial, tickShaders } from "@/core/engine3d/shaders";
import { createInstanceWriter, fillStatic, type InstanceWriter } from "@/core/engine3d/instancing";
import { useFixedStep } from "@/core/engine3d/useFixedStep";
import { MAP_SIZE, MAX_PLAYERS, type ShooterMap } from "./map";
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
 * X4 · Supernova Arena — la escena.
 *
 * Todo lo que se ve sale de `ShooterView`; aca no hay estado de juego, solo
 * buffers de instancias que se reescriben por cuadro y una camara. La regla
 * que decide si esto corre en un celular es una sola: **un draw call por
 * familia**. Diez jugadores son un draw call de cuerpos, uno de cabezas, uno
 * de visores, uno de armas y uno de sombras; treinta bloques de cobertura son
 * uno; todas las estelas, uno. La escena entera anda en ~26.
 *
 * Lo que la hace linda sin pagar PBR ni sombras:
 *
 * - **Sombreado horneado.** Las cajas usan `boxShaded`: tapa clara, lados a
 *   medio tono, base oscura. Volumen sin una sola sombra dinamica.
 * - **Cielo de tres colores y piso con grilla**, los dos por shader. Es lo
 *   que le da al mapa la firma de la marca en vez de "cubos grises".
 * - **Niebla exponencial** del color del fondo: el borde del mundo se funde
 *   en vez de cortarse, y de paso recorta overdraw lejano.
 * - **Aditivo para lo que brilla**: destellos, estelas, chispas, balizas y
 *   el anillo. Sobre un fondo oscuro, aditivo es luz.
 */

const WALL_HEIGHT = 6;
const RING_HEIGHT = 34;
const SKY_RADIUS = 170;
const FOV_FPV = 78;
const FOV_SPECTATOR = 58;

export type ShooterSceneProps = {
  view: ShooterView;
  /** Con `false` no simula: pausa, cuenta regresiva, resumen. */
  enabled: boolean;
  /** Un paso fijo. Lo arma `ShooterGame` sobre el ciclo de vida. */
  tick: (dt: number) => void;
  /** El estado interpolado de `useGameNet`. En el host devuelve null. */
  sampleState: () => NetSnapshot | null;
};

export function ShooterScene(props: ShooterSceneProps) {
  const fogColor = getColor("--sn-bg");
  return (
    <>
      <fogExp2 attach="fog" args={[fogColor, 0.011]} />
      <ambientLight intensity={0.32} />
      {/*
        Hemisferica: cielo violeta arriba, fondo oscuro abajo. Es la luz que
        hace que una capsula de un solo color no se vea plana desde ningun
        angulo, y cuesta lo mismo que la ambiente.
      */}
      <hemisphereLight args={[getColor("--sn-violet-300"), getColor("--sn-bg"), 0.75]} />
      <directionalLight position={[30, 60, 20]} intensity={1.05} />

      <Arena map={props.view.map} />
      <Runtime {...props} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Lo que no se mueve                                                   */
/* ------------------------------------------------------------------ */

function Arena({ map }: { map: ShooterMap }) {
  const half = MAP_SIZE / 2;

  const floor = useMemo(() => new PlaneGeometry(MAP_SIZE, MAP_SIZE), []);
  useEffect(() => () => floor.dispose(), [floor]);
  const gridMaterial = getGridFloorMaterial("--sn-bg-elev", "--sn-violet-500", {
    cell: 4,
    width: 0.05,
    glow: 0.42,
  });

  const shaded = getMaterial("--sn-violet-600", { kind: "lambert", vertexColors: true });
  const rampMaterial = getMaterial("--sn-violet-500", { kind: "lambert" });
  const tower = getMaterial("--sn-panel-hi", { kind: "lambert", vertexColors: true });
  const cyanGlow = getMaterial("--sn-cyan-400", { kind: "basic" });
  const magentaGlow = getMaterial("--sn-magenta-400", { kind: "basic" });

  const blocks = useMemo<InstanceWriter>(
    () => createInstanceWriter(getGeometry("boxShaded"), shaded, 48),
    [shaded],
  );
  const walls = useMemo<InstanceWriter>(
    () => createInstanceWriter(getGeometry("boxShaded"), shaded, 4),
    [shaded],
  );
  const strips = useMemo<InstanceWriter>(
    () => createInstanceWriter(getGeometry("box"), cyanGlow, 8),
    [cyanGlow],
  );
  useEffect(
    () => () => {
      blocks.dispose();
      walls.dispose();
      strips.dispose();
    },
    [blocks, walls, strips],
  );

  useEffect(() => {
    // Cobertura y plataformas en un solo escritor: son la misma familia.
    fillStatic(blocks, [...map.cover, ...map.platforms], (box, writer) => {
      writer.push(box.x, box.y, box.z, box.w, box.h, box.d);
    });
    fillStatic(
      walls,
      [
        { x: 0, z: -half, w: MAP_SIZE + 1, d: 1 },
        { x: 0, z: half, w: MAP_SIZE + 1, d: 1 },
        { x: -half, z: 0, w: 1, d: MAP_SIZE + 1 },
        { x: half, z: 0, w: 1, d: MAP_SIZE + 1 },
      ],
      (wall, writer) => {
        writer.push(wall.x, WALL_HEIGHT / 2, wall.z, wall.w, WALL_HEIGHT, wall.d);
      },
    );
    // Una linea de luz en el borde alto de cada pared y cuatro en el hito:
    // es lo que se lee de lejos entre la niebla, mucho antes que la pared.
    const l = map.landmark;
    fillStatic(
      strips,
      [
        { x: 0, y: WALL_HEIGHT, z: -half, w: MAP_SIZE + 1, h: 0.14, d: 0.3 },
        { x: 0, y: WALL_HEIGHT, z: half, w: MAP_SIZE + 1, h: 0.14, d: 0.3 },
        { x: -half, y: WALL_HEIGHT, z: 0, w: 0.3, h: 0.14, d: MAP_SIZE + 1 },
        { x: half, y: WALL_HEIGHT, z: 0, w: 0.3, h: 0.14, d: MAP_SIZE + 1 },
        { x: l.x + l.w / 2, y: l.y, z: l.z + l.d / 2, w: 0.18, h: l.h, d: 0.18 },
        { x: l.x - l.w / 2, y: l.y, z: l.z + l.d / 2, w: 0.18, h: l.h, d: 0.18 },
        { x: l.x + l.w / 2, y: l.y, z: l.z - l.d / 2, w: 0.18, h: l.h, d: 0.18 },
        { x: l.x - l.w / 2, y: l.y, z: l.z - l.d / 2, w: 0.18, h: l.h, d: 0.18 },
      ],
      (strip, writer) => {
        writer.push(strip.x, strip.y, strip.z, strip.w, strip.h, strip.d);
      },
    );
  }, [blocks, walls, strips, map, half]);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} geometry={floor} material={gridMaterial} dispose={null} />
      <primitive object={blocks.mesh} />
      <primitive object={walls.mesh} />
      <primitive object={strips.mesh} />

      {map.ramps.map((ramp, index) => (
        <mesh
          key={`ramp-${index}`}
          position={[ramp.x, ramp.y, ramp.z]}
          rotation={[0, -ramp.yaw, 0]}
          material={rampMaterial}
          geometry={getGeometry("ramp")}
          scale={[ramp.w, ramp.h, ramp.d]}
          dispose={null}
        />
      ))}

      {/* El hito: torre oscura con aristas de luz y una corona que gira. */}
      <mesh
        position={[map.landmark.x, map.landmark.y, map.landmark.z]}
        material={tower}
        geometry={getGeometry("boxShaded")}
        scale={[map.landmark.w, map.landmark.h, map.landmark.d]}
        dispose={null}
      />
      <mesh
        position={[map.landmark.x, map.landmark.h + 0.6, map.landmark.z]}
        material={magentaGlow}
        geometry={getGeometry("box")}
        scale={[map.landmark.w + 1.2, 0.25, map.landmark.d + 1.2]}
        dispose={null}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Lo que se mueve                                                      */
/* ------------------------------------------------------------------ */

const Z_AXIS = new Vector3(0, 0, 1);

function Runtime({ view, enabled, tick, sampleState }: ShooterSceneProps) {
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
  const visorMaterial = getMaterial("--sn-cyan-300", { kind: "basic" });
  const gunMaterial = getMaterial("--sn-panel-hi", { kind: "lambert" });
  const shadowMaterial = getMaterial("--sn-bg", { kind: "basic", opacity: 0.55 });

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
  const beaconMaterial = useMemo(
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
      beaconMaterial.dispose();
      ringGeometry.dispose();
      skyGeometry.dispose();
    },
    [additive, beaconMaterial, ringGeometry, skyGeometry],
  );

  const writers = useMemo(
    () => ({
      bodies: createInstanceWriter(getGeometry("capsule"), tinted, MAX_PLAYERS, { colors: true }),
      heads: createInstanceWriter(getGeometry("sphere"), tinted, MAX_PLAYERS, { colors: true }),
      visors: createInstanceWriter(getGeometry("box"), visorMaterial, MAX_PLAYERS),
      guns: createInstanceWriter(getGeometry("box"), gunMaterial, MAX_PLAYERS),
      shadows: createInstanceWriter(getGeometry("disc"), shadowMaterial, MAX_PLAYERS),
      flashes: createInstanceWriter(getGeometry("sphere"), additive, MAX_PLAYERS, { colors: true }),
      beacons: createInstanceWriter(getGeometry("cylinder"), beaconMaterial, MAX_PLAYERS, {
        colors: true,
      }),
      tracers: createInstanceWriter(getGeometry("box"), additive, TRACER_MAX, { colors: true }),
      sparks: createInstanceWriter(getGeometry("box"), additive, SPARK_MAX, { colors: true }),
    }),
    [tinted, visorMaterial, gunMaterial, shadowMaterial, additive, beaconMaterial],
  );
  useEffect(
    () => () => {
      for (const writer of Object.values(writers)) writer.dispose();
    },
    [writers],
  );

  /** Colores por asiento en lineal, listos para `tint`. */
  const seatRgb = useMemo(() => {
    const out = new Float32Array(MAX_PLAYERS * 3);
    SEAT_TOKENS.forEach((token, index) => {
      const color = getColor(token);
      out[index * 3] = color.r;
      out[index * 3 + 1] = color.g;
      out[index * 3 + 2] = color.b;
    });
    return out;
  }, []);
  const warm = useMemo(() => getColor("--sn-warn"), []);

  const skyRef = useRef<Mesh>(null);
  const ringRef = useRef<Mesh>(null);
  const crownRef = useRef<Mesh>(null);
  const viewmodelRef = useRef<Group>(null);
  const gunRef = useRef<Group>(null);
  const muzzleRef = useRef<Mesh>(null);

  /** Scratch de la camara y de las estelas: se crean una vez. */
  const scratch = useMemo(
    () => ({
      dir: new Float32Array(3),
      v: new Vector3(),
      q: new Quaternion(),
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

    const fpv = (!view.isHost || view.hostPlaying) && !view.spectating && view.state !== 3;
    driveCamera(view, camera, scratch, fpv, dt);

    const sky = skyRef.current;
    if (sky) sky.position.copy(camera.position);

    const ring = ringRef.current;
    if (ring) {
      ring.visible = view.state >= 1 && view.ringRadius > 0.5;
      ring.position.set(view.ringX, 0, view.ringZ);
      ring.scale.set(view.ringRadius, RING_HEIGHT, view.ringRadius);
    }
    const crown = crownRef.current;
    if (crown && !view.reducedMotion) crown.rotation.y = view.elapsed * 0.35;

    writePlayers(view, writers, seatRgb, warm, fpv, scratch.dir);
    writeEffects(view, writers, seatRgb, warm, scratch);
    driveViewmodel(view, viewmodelRef.current, gunRef.current, muzzleRef.current, camera, fpv);
  });

  const landmark = view.map.landmark;

  return (
    <>
      <mesh
        ref={skyRef}
        geometry={skyGeometry}
        material={getSkyMaterial("--sn-bg", "--sn-violet-500", "--sn-bg")}
        dispose={null}
      />
      <mesh ref={ringRef} geometry={ringGeometry} material={getRingMaterial("--sn-magenta-400")} dispose={null} />
      <mesh
        ref={crownRef}
        position={[landmark.x, landmark.h + 2.2, landmark.z]}
        geometry={getGeometry("box")}
        material={getMaterial("--sn-cyan-400", { kind: "basic" })}
        scale={[landmark.w + 3, 0.16, landmark.d + 3]}
        dispose={null}
      />

      <primitive object={writers.shadows.mesh} />
      <primitive object={writers.bodies.mesh} />
      <primitive object={writers.heads.mesh} />
      <primitive object={writers.visors.mesh} />
      <primitive object={writers.guns.mesh} />
      <primitive object={writers.beacons.mesh} />
      <primitive object={writers.tracers.mesh} />
      <primitive object={writers.sparks.mesh} />
      <primitive object={writers.flashes.mesh} />

      {/*
        El arma en primera persona. Cuelga de un grupo que se pega a la camara
        por cuadro; no es hijo de la camara porque R3F no la monta en el arbol.
        Tres cajas y una esfera: se lee como un rifle y son cuatro draw calls.
      */}
      <group ref={viewmodelRef} visible={false}>
        {/*
          Chico y abajo a la derecha, apenas girado hacia la mira: a 0,6 de
          la camara cualquier caja se ve enorme, y un arma que tapa un cuarto
          de la pantalla es un arma que estorba.
        */}
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
            material={getMaterial("--sn-cyan-400", { kind: "basic" })}
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

type Writers = Record<
  "bodies" | "heads" | "visors" | "guns" | "shadows" | "flashes" | "beacons" | "tracers" | "sparks",
  InstanceWriter
>;

type CameraScratch = {
  dir: Float32Array;
  v: Vector3;
  q: Quaternion;
  camPos: Vector3;
  camTarget: Vector3;
  lookAt: Vector3;
  mode: string;
  settled: boolean;
};

/**
 * La camara.
 *
 * En el celular, primera persona en los ojos del cuerpo predicho, con un
 * balanceo minimo al caminar y una sacudida corta al recibir dano. En el
 * proyector —y en el celular de un eliminado— una orbita lenta alrededor
 * del centro de la accion, que se abre o se cierra segun cuan repartidos
 * esten los vivos. Con movimiento reducido no hay balanceo, ni sacudida, ni
 * orbita: la camara aerea queda fija.
 */
function driveCamera(
  view: ShooterView,
  camera: PerspectiveCamera,
  scratch: CameraScratch,
  fpv: boolean,
  dt: number,
): void {
  const mode = fpv ? "fpv" : "spectator";
  if (mode !== scratch.mode) {
    scratch.mode = mode;
    scratch.settled = false;
    camera.fov = fpv ? FOV_FPV : FOV_SPECTATOR;
    camera.updateProjectionMatrix();
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
  const radius = Math.min(54, Math.max(18, spread * 1.25 + 14));
  const angle = view.reducedMotion ? 0.8 : 0.8 + view.elapsed * 0.09;
  scratch.camTarget.set(cx + Math.cos(angle) * radius, 9 + radius * 0.72, cz + Math.sin(angle) * radius);
  scratch.v.set(cx, 1.2, cz);

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

function writePlayers(
  view: ShooterView,
  writers: Writers,
  seatRgb: Float32Array,
  warm: { r: number; g: number; b: number },
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
    const x = view.x[seat] ?? 0;
    const y = view.y[seat] ?? 0;
    const z = view.z[seat] ?? 0;
    const yaw = view.yaw[seat] ?? 0;
    const pitch = view.pitch[seat] ?? 0;
    const r = seatRgb[seat * 3] ?? 1;
    const g = seatRgb[seat * 3 + 1] ?? 1;
    const b = seatRgb[seat * 3 + 2] ?? 1;

    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    // El arma: a la derecha del cuerpo, apuntando adonde mira.
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
        0.8,
      );
      const ground = groundHeight(view.map, x, z, y);
      const lift = y - ground;
      shadows.push(x, ground + 0.02, z, Math.max(0.35, 0.95 - lift * 0.12));
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
      flashes.tint(warm.r, warm.g, warm.b);
    }

    // Durante el despliegue, una columna de luz sobre cada uno: en el
    // proyector se ve donde cayo cada quien; en el celular, donde estan los demas.
    if (view.state === 1) {
      beacons.push(x, y + 7, z, 1.4, 14, 1.4);
      beacons.tint(r, g, b);
    }
  }

  bodies.end();
  heads.end();
  visors.end();
  guns.end();
  shadows.end();
  flashes.end();
  beacons.end();
}

function writeEffects(
  view: ShooterView,
  writers: Writers,
  seatRgb: Float32Array,
  warm: { r: number; g: number; b: number },
  scratch: CameraScratch,
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
    scratch.v.set(dx / length, dy / length, dz / length);
    scratch.q.setFromUnitVectors(Z_AXIS, scratch.v);
    const thickness = 0.02 + 0.06 * age;
    tracers.pushQuat(
      x0 + dx / 2,
      y0 + dy / 2,
      z0 + dz / 2,
      scratch.q.x,
      scratch.q.y,
      scratch.q.z,
      scratch.q.w,
      thickness,
      thickness,
      length,
    );
    const seat = Math.max(0, Math.min(MAX_PLAYERS - 1, Math.round(t[base + 7] ?? 0)));
    tracers.tint(seatRgb[seat * 3] ?? 1, seatRgb[seat * 3 + 1] ?? 1, seatRgb[seat * 3 + 2] ?? 1);
  }
  tracers.end();

  const s = view.sparks;
  sparks.begin();
  for (let i = 0; i < SPARK_MAX; i++) {
    const base = i * SPARK_STRIDE;
    const age = s[base + 6] ?? 0;
    if (age <= 0) continue;
    sparks.push(s[base] ?? 0, s[base + 1] ?? 0, s[base + 2] ?? 0, 0.05 + 0.14 * age);
    sparks.tint(warm.r, warm.g, warm.b);
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
    if (view.reloadLeft > 0) {
      // Recargando: el arma baja y se ladea. Es la unica animacion que hace
      // falta para que la recarga se entienda sin leer el HUD.
      const progress = 1 - view.reloadLeft / Math.max(0.01, view.rules.reloadS);
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
