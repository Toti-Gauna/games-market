import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Mesh,
  type PerspectiveCamera,
} from "three";
import type { PaletteToken } from "@/core/engine/palette";
import type { NetSnapshot } from "@/core/net/snapshot";
import { getGeometry } from "@/core/engine3d/geometry";
import { getColor, getMaterial } from "@/core/engine3d/materials";
import { getGridFloorMaterial, getSkyMaterial, tickShaders } from "@/core/engine3d/shaders";
import { createInstanceWriter, fillStatic } from "@/core/engine3d/instancing";
import { useFixedStep } from "@/core/engine3d/useFixedStep";
import { DOOR_WIDTH, MAX_AVATARS, WALL_HEIGHT, type SpaceLayout } from "./space";
import {
  AVATAR_TOKENS,
  EYE_HEIGHT,
  STATION_LABEL_OFFSET,
  ZONE_TOKENS,
  frameView,
  type SpaceView,
} from "./view";

/**
 * X5 · Espacio — la escena.
 *
 * Un lobby con cuerpo: cuatro a seis salas de color, paredes con una linea de
 * luz, paneles que brillan en las paredes y avatares de un color cada uno,
 * con su nombre encima. Todo instanciado por familia: paredes, franjas,
 * dinteles, paneles, halos, columnas, avatares y sombras son un draw call
 * cada uno. La escena entera anda en ~12, contra los 25 del presupuesto.
 *
 * Lo que la hace un lugar y no una grilla de cajas:
 *
 * - **Color por zona.** El piso de cada sala lleva un tinte, la franja alta
 *   de sus paredes lleva su color, y los paneles tambien. Uno sabe donde
 *   esta sin leer nada.
 * - **Luz que se ve de lejos.** Las franjas y las columnas de las estaciones
 *   son aditivas: desde cualquier punto del espacio se ve donde estan las
 *   estaciones, que es lo que evita perderse en 60 x 60.
 * - **Nombres en DOM**, proyectados desde aca por cuadro: texto nitido a
 *   cualquier tamano, sin atlas ni SDF, y sin cargar drei.
 */

const SKY_RADIUS = 150;
const FOV_FPV = 72;
const FOV_AERIAL = 46;
/** Hasta donde se leen los nombres en primera persona. */
const NAME_DISTANCE = 26;

export type SpaceSceneProps = {
  view: SpaceView;
  enabled: boolean;
  tick: (dt: number) => void;
  sampleState: () => NetSnapshot | null;
};

export function SpaceScene(props: SpaceSceneProps) {
  return (
    <>
      <fogExp2 attach="fog" args={[getColor("--sn-bg"), 0.015]} />
      <ambientLight intensity={0.38} />
      <hemisphereLight args={[getColor("--sn-cyan-300"), getColor("--sn-bg"), 0.7]} />
      <directionalLight position={[20, 50, 30]} intensity={0.95} />
      <Shell layout={props.view.layout} />
      <Runtime {...props} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* El lugar                                                            */
/* ------------------------------------------------------------------ */

function tintOf(token: PaletteToken | undefined): { r: number; g: number; b: number } {
  return getColor(token ?? "--sn-text");
}

function Shell({ layout }: { layout: SpaceLayout }) {
  const floor = useMemo(() => new PlaneGeometry(layout.size, layout.size), [layout.size]);
  useEffect(() => () => floor.dispose(), [floor]);

  const wallMaterial = getMaterial("--sn-violet-600", { kind: "lambert", vertexColors: true });
  const white = getMaterial("--sn-text", { kind: "basic" });
  const panelMaterial = getMaterial("--sn-text", { kind: "lambert" });
  const glow = useMemo(
    () =>
      new MeshBasicMaterial({
        color: getColor("--sn-text"),
        transparent: true,
        opacity: 0.22,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  const tint = useMemo(
    () =>
      new MeshBasicMaterial({
        color: getColor("--sn-text"),
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      glow.dispose();
      tint.dispose();
    },
    [glow, tint],
  );

  const writers = useMemo(
    () => ({
      walls: createInstanceWriter(getGeometry("boxShaded"), wallMaterial, 40),
      strips: createInstanceWriter(getGeometry("box"), white, 80, { colors: true }),
      lintels: createInstanceWriter(getGeometry("box"), white, 16, { colors: true }),
      zones: createInstanceWriter(getGeometry("box"), tint, 8, { colors: true }),
      panels: createInstanceWriter(getGeometry("box"), panelMaterial, 8, { colors: true }),
      halos: createInstanceWriter(getGeometry("disc"), glow, 8, { colors: true }),
      columns: createInstanceWriter(getGeometry("cylinder"), glow, 8, { colors: true }),
    }),
    [wallMaterial, white, panelMaterial, glow, tint],
  );
  useEffect(
    () => () => {
      for (const writer of Object.values(writers)) writer.dispose();
    },
    [writers],
  );

  useEffect(() => {
    fillStatic(writers.walls, layout.walls, (wall, writer) => {
      writer.push(wall.x, wall.y, wall.z, wall.w, wall.h, wall.d);
    });

    // Una franja de luz arriba y un zocalo abajo de cada pared, del color de
    // su zona. El perimetro va en cian: es el borde del lugar, no una sala.
    fillStatic(writers.strips, layout.walls, (wall, writer) => {
      const color = tintOf(wall.zone >= 0 ? ZONE_TOKENS[wall.zone % ZONE_TOKENS.length] : "--sn-cyan-400");
      writer.push(wall.x, wall.h + 0.04, wall.z, wall.w + 0.1, 0.1, wall.d + 0.1);
      writer.tint(color.r, color.g, color.b);
      writer.push(wall.x, 0.06, wall.z, wall.w + 0.08, 0.08, wall.d + 0.08);
      writer.tint(color.r, color.g, color.b);
    });

    fillStatic(writers.lintels, layout.doors, (door, writer) => {
      const color = tintOf("--sn-cyan-300");
      if (door.vertical) writer.push(door.x, WALL_HEIGHT - 0.25, door.z, 0.8, 0.12, DOOR_WIDTH + 0.5);
      else writer.push(door.x, WALL_HEIGHT - 0.25, door.z, DOOR_WIDTH + 0.5, 0.12, 0.8);
      writer.tint(color.r, color.g, color.b);
    });

    fillStatic(writers.zones, layout.zones, (zone, writer) => {
      const color = tintOf(ZONE_TOKENS[zone.color % ZONE_TOKENS.length]);
      writer.push(zone.cx, 0.012, zone.cz, zone.x1 - zone.x0 - 0.8, 0.02, zone.z1 - zone.z0 - 0.8);
      writer.tint(color.r, color.g, color.b);
    });

    // Panel en la pared, halo en el piso y columna de luz encima.
    fillStatic(writers.panels, layout.stations, (station, writer) => {
      const color = tintOf(ZONE_TOKENS[station.zone % ZONE_TOKENS.length]);
      const fx = -Math.sin(station.yaw);
      const fz = -Math.cos(station.yaw);
      writer.pushYaw(station.x + fx * 0.22, 1.75, station.z + fz * 0.22, station.yaw, 3, 1.8, 0.14);
      writer.tint(color.r, color.g, color.b);
    });
    fillStatic(writers.halos, layout.stations, (station, writer) => {
      const color = tintOf(ZONE_TOKENS[station.zone % ZONE_TOKENS.length]);
      const fx = -Math.sin(station.yaw);
      const fz = -Math.cos(station.yaw);
      writer.push(station.x + fx * 1.4, 0.03, station.z + fz * 1.4, station.radius * 2);
      writer.tint(color.r, color.g, color.b);
    });
    fillStatic(writers.columns, layout.stations, (station, writer) => {
      const color = tintOf(ZONE_TOKENS[station.zone % ZONE_TOKENS.length]);
      writer.push(station.x, WALL_HEIGHT + 4, station.z, 0.5, 8, 0.5);
      writer.tint(color.r, color.g, color.b);
    });
  }, [writers, layout]);

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        geometry={floor}
        material={getGridFloorMaterial("--sn-bg-elev", "--sn-cyan-500", { cell: 3, width: 0.04, glow: 0.32 })}
        dispose={null}
      />
      {Object.values(writers).map((writer, index) => (
        <primitive key={index} object={writer.mesh} />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* La gente                                                            */
/* ------------------------------------------------------------------ */

function Runtime({ view, enabled, tick, sampleState }: SpaceSceneProps) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const sampleRef = useRef(sampleState);
  sampleRef.current = sampleState;
  useFixedStep((dt) => tickRef.current(dt), { enabled, priority: -1 });

  const tinted = getMaterial("--sn-text", { kind: "lambert" });
  const shadowMaterial = getMaterial("--sn-bg", { kind: "basic", opacity: 0.5 });
  const avatars = useMemo(
    () => createInstanceWriter(getGeometry("avatar"), tinted, MAX_AVATARS, { colors: true }),
    [tinted],
  );
  const shadows = useMemo(
    () => createInstanceWriter(getGeometry("disc"), shadowMaterial, MAX_AVATARS),
    [shadowMaterial],
  );
  const skyGeometry = useMemo(() => new SphereGeometry(SKY_RADIUS, 24, 12), []);
  useEffect(
    () => () => {
      avatars.dispose();
      shadows.dispose();
      skyGeometry.dispose();
    },
    [avatars, shadows, skyGeometry],
  );

  const avatarRgb = useMemo(() => {
    const out = new Float32Array(MAX_AVATARS * 3);
    for (let seat = 0; seat < MAX_AVATARS; seat++) {
      const color = getColor(AVATAR_TOKENS[seat % AVATAR_TOKENS.length] ?? "--sn-text");
      out[seat * 3] = color.r;
      out[seat * 3 + 1] = color.g;
      out[seat * 3 + 2] = color.b;
    }
    return out;
  }, []);

  const skyRef = useRef<Mesh>(null);
  const scratch = useMemo(
    () => ({
      mode: "",
      settled: false,
      v: new Vector3(),
      pos: new Vector3(),
      target: new Vector3(),
      look: new Vector3(),
      lookTarget: new Vector3(),
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

    const fpv = !view.isHost || view.hostPlaying;
    driveCamera(view, camera, scratch, fpv, dt);
    // La camara se movio en este cuadro: sin esto, la proyeccion de las
    // etiquetas usaria las matrices del cuadro anterior.
    camera.updateMatrixWorld();
    const sky = skyRef.current;
    if (sky) sky.position.copy(camera.position);

    avatars.begin();
    shadows.begin();
    const camX = camera.position.x;
    const camZ = camera.position.z;
    for (let seat = 0; seat < MAX_AVATARS; seat++) {
      const active = view.active[seat] === 1;
      const self = fpv && seat === view.seat;
      const x = view.x[seat] ?? 0;
      const z = view.z[seat] ?? 0;
      const yaw = view.yaw[seat] ?? 0;
      const moving = view.moving[seat] === 1;

      let label = false;
      if (active && !self) {
        const bob = moving && !view.reducedMotion ? Math.sin(view.elapsed * 9 + seat * 1.3) * 0.035 : 0;
        // La geometria mira a +Z y el rumbo es el de three (-Z): media vuelta.
        avatars.pushYaw(x, 0.85 + bob, z, yaw + Math.PI, 1.7);
        avatars.tint(avatarRgb[seat * 3] ?? 1, avatarRgb[seat * 3 + 1] ?? 1, avatarRgb[seat * 3 + 2] ?? 1);
        shadows.push(x, 0.02, z, 0.9);
        const near = !fpv || Math.hypot(x - camX, z - camZ) < NAME_DISTANCE;
        label = view.showNames && near;
      }
      if (label) projectLabel(view, seat, x, 2.15, z, camera, scratch.v, fpv ? 14 : 0);
      else view.labelOn[seat] = 0;
    }
    avatars.end();
    shadows.end();

    for (const station of view.layout.stations) {
      projectLabel(
        view,
        STATION_LABEL_OFFSET + station.id,
        station.x - Math.sin(station.yaw) * 0.4,
        3.05,
        station.z - Math.cos(station.yaw) * 0.4,
        camera,
        scratch.v,
        fpv ? 16 : 0,
      );
    }
  });

  return (
    <>
      <mesh
        ref={skyRef}
        geometry={skyGeometry}
        material={getSkyMaterial("--sn-bg", "--sn-cyan-500", "--sn-bg")}
        dispose={null}
      />
      <primitive object={shadows.mesh} />
      <primitive object={avatars.mesh} />
    </>
  );
}

/**
 * Proyecta un punto del mundo a fraccion de pantalla y lo deja en la vista.
 * `reference` es la distancia a la que la etiqueta se ve a escala 1; con 0
 * la escala es fija (vista aerea).
 */
function projectLabel(
  view: SpaceView,
  index: number,
  x: number,
  y: number,
  z: number,
  camera: PerspectiveCamera,
  v: Vector3,
  reference: number,
): void {
  v.set(x, y, z);
  const distance = v.distanceTo(camera.position);
  v.project(camera);
  if (v.z >= 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) {
    view.labelOn[index] = 0;
    return;
  }
  view.labelOn[index] = 1;
  view.labelX[index] = (v.x + 1) / 2;
  view.labelY[index] = (1 - v.y) / 2;
  view.labelScale[index] =
    reference > 0 ? Math.min(1.35, Math.max(0.55, reference / Math.max(1, distance))) : 0.85;
}

type CameraScratch = {
  mode: string;
  settled: boolean;
  v: Vector3;
  pos: Vector3;
  target: Vector3;
  look: Vector3;
  lookTarget: Vector3;
};

/**
 * Primera persona en el celular; en el proyector, una vista aerea que gira
 * muy despacio alrededor del centro. Con movimiento reducido, queda quieta.
 */
function driveCamera(
  view: SpaceView,
  camera: PerspectiveCamera,
  scratch: CameraScratch,
  fpv: boolean,
  dt: number,
): void {
  const mode = fpv ? "fpv" : "aerial";
  if (mode !== scratch.mode) {
    scratch.mode = mode;
    scratch.settled = false;
    camera.fov = fpv ? FOV_FPV : FOV_AERIAL;
    camera.updateProjectionMatrix();
  }
  if (fpv) {
    const moving = view.moving[view.seat] === 1;
    const bob = moving && !view.reducedMotion ? Math.sin(view.elapsed * 9) * 0.02 : 0;
    camera.position.set(view.body.x, EYE_HEIGHT + bob, view.body.z);
    camera.rotation.set(0, view.camYaw, 0);
    return;
  }
  const half = view.layout.size / 2;
  const angle = view.reducedMotion ? 0.35 : 0.35 + view.elapsed * 0.025;
  const radius = half * 0.75;
  scratch.target.set(Math.sin(angle) * radius, half * 1.55, Math.cos(angle) * radius);
  scratch.lookTarget.set(0, 0, 0);
  if (!scratch.settled) {
    scratch.pos.copy(scratch.target);
    scratch.look.copy(scratch.lookTarget);
    scratch.settled = true;
  } else {
    const k = 1 - Math.exp(-dt * 2);
    scratch.pos.lerp(scratch.target, k);
    scratch.look.lerp(scratch.lookTarget, k);
  }
  camera.position.copy(scratch.pos);
  camera.lookAt(scratch.look);
}
