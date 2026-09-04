import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleGeometry, MeshLambertMaterial, type Material } from "three";
import { getGeometry } from "@/core/engine3d/geometry";
import { getMaterial } from "@/core/engine3d/materials";
import { createInstanceWriter, fillStatic, type InstanceWriter } from "@/core/engine3d/instancing";
import { MAP_SIZE, MAX_PLAYERS, type ShooterMap } from "./map";

/**
 * X4 · Supernova Arena — la escena, fase 1.
 *
 * **Esto es un instrumento de medicion, no un juego.** La guia pone una puerta
 * antes de escribir gameplay: mapa generado, diez capsulas moviendose, camara
 * en primera persona, y medir fps y draw calls **en un celular real**. Si no
 * llega a 30 fps, se recorta el alcance antes de construir encima.
 *
 * Todo lo que decide si esa medicion da bien esta aca, y es lo mismo que va a
 * sostener el juego terminado:
 *
 * - **Un draw call por familia, no por objeto.** La cobertura entera es un
 *   `InstancedMesh`; los cuerpos de los diez jugadores, otro; las cabezas,
 *   otro. Treinta bloques como treinta mallas son treinta draw calls y veinte
 *   fps.
 * - **Niebla exponencial, y no es decoracion.** Ademas de verse bien, oculta
 *   el plano lejano y recorta overdraw, que en un GPU movil es de lo mas caro
 *   que hay.
 * - **Cero asignaciones por cuadro.** La simulacion de las capsulas vive en
 *   `Float32Array` y el escritor de instancias reusa sus vectores. Un `new`
 *   por entidad por cuadro es basura garantizada y tirones cada dos segundos.
 * - **Nada de PBR ni sombras dinamicas.** Lambert plano y un circulo oscuro
 *   bajo cada jugador cuando llegue el momento.
 */

/** Alto de los ojos. Define como se lee la escala del mapa entero. */
const EYE_HEIGHT = 1.7;

/** Radio y alto del cuerpo de un jugador. */
const BODY_RADIUS = 0.4;
const BODY_HEIGHT = 1.1;

/** Cuanto camina un bot de la fase 1. Suficiente para mover la escena. */
const BOT_SPEED = 6;

export type ShooterStats = {
  fps: number;
  /** Lo que reporta `renderer.info`. El presupuesto de la guia son 60. */
  drawCalls: number;
  triangles: number;
};

export type ShooterSceneProps = {
  map: ShooterMap;
  running: boolean;
  /** Se llama a 2 Hz, no por cuadro: es un HUD, no un profiler. */
  onStats: (stats: ShooterStats) => void;
};

export function ShooterScene({ map, running, onStats }: ShooterSceneProps) {
  return (
    <>
      {/*
        Niebla del color del fondo. Sin esto se ve el borde del mundo y ademas
        se paga overdraw por geometria que no aporta nada.
      */}
      <fogExp2 attach="fog" args={["#07060f", 0.018]} />
      <ambientLight intensity={0.55} />
      {/* Una sola direccional. Nada de luces por jugador. */}
      <directionalLight position={[30, 60, 20]} intensity={1.15} />

      <Arena map={map} />
      <Players map={map} running={running} />
      <PerfProbe onStats={onStats} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* El mapa                                                             */
/* ------------------------------------------------------------------ */

/**
 * Piso, paredes, cobertura, plataformas, rampas y el hito.
 *
 * La cobertura se escribe **una sola vez** con `fillStatic`: no se mueve en
 * toda la partida, asi que reescribir su buffer sesenta veces por segundo
 * seria trabajo puro sin efecto.
 */
function Arena({ map }: { map: ShooterMap }) {
  const floor = getMaterial("--sn-bg-elev", { kind: "lambert" });
  const block = getMaterial("--sn-violet-600", { kind: "lambert" });
  const accent = getMaterial("--sn-cyan-400", { kind: "lambert" });

  const cover = useMemo<InstanceWriter>(
    () => createInstanceWriter(getGeometry("box"), block, 40),
    [block],
  );
  useEffect(() => () => cover.dispose(), [cover]);

  useEffect(() => {
    fillStatic(cover, map.cover, (box, writer) => {
      writer.push(box.x, box.y, box.z, box.w, box.h, box.d);
    });
  }, [cover, map.cover]);

  const half = MAP_SIZE / 2;
  const wallHeight = 6;

  return (
    <>
      <mesh position={[0, -0.5, 0]} material={floor} dispose={null}>
        <boxGeometry args={[MAP_SIZE, 1, MAP_SIZE]} />
      </mesh>

      {/* Cuatro paredes solidas: del mapa no se sale. */}
      {[
        { x: 0, z: -half, w: MAP_SIZE, d: 1 },
        { x: 0, z: half, w: MAP_SIZE, d: 1 },
        { x: -half, z: 0, w: 1, d: MAP_SIZE },
        { x: half, z: 0, w: 1, d: MAP_SIZE },
      ].map((wall, index) => (
        <mesh
          key={index}
          position={[wall.x, wallHeight / 2, wall.z]}
          material={block}
          dispose={null}
        >
          <boxGeometry args={[wall.w, wallHeight, wall.d]} />
        </mesh>
      ))}

      <primitive object={cover.mesh} />

      {map.platforms.map((platform, index) => (
        <mesh
          key={index}
          position={[platform.x, platform.y, platform.z]}
          material={block}
          dispose={null}
        >
          <boxGeometry args={[platform.w, platform.h, platform.d]} />
        </mesh>
      ))}

      {map.ramps.map((ramp, index) => (
        <mesh
          key={index}
          position={[ramp.x, ramp.y, ramp.z]}
          rotation={[0, -ramp.yaw, 0]}
          material={block}
          geometry={getGeometry("ramp")}
          scale={[ramp.w, ramp.h, ramp.d]}
          dispose={null}
        />
      ))}

      {/* El hito. En acento para que se lea de lejos entre la niebla. */}
      <mesh
        position={[map.landmark.x, map.landmark.y, map.landmark.z]}
        material={accent}
        dispose={null}
      >
        <boxGeometry args={[map.landmark.w, map.landmark.h, map.landmark.d]} />
      </mesh>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Los diez jugadores                                                  */
/* ------------------------------------------------------------------ */

/**
 * Diez capsulas caminando, y la camara en los ojos de la primera.
 *
 * Los bots de esta fase no son IA: van a un punto, llegan, eligen otro. Lo que
 * importa medir es el costo de mover y dibujar diez entidades, no que jueguen
 * bien — eso llega en la fase 5.
 *
 * El estado va en `Float32Array` y no en objetos: es lo que garantiza el
 * "cero asignaciones en el loop" del presupuesto, y a la vez lo que hace que
 * la simulacion sea trivial de mover al host cuando entre la red.
 */
function Players({ map, running }: { map: ShooterMap; running: boolean }) {
  const camera = useThree((state) => state.camera);

  const body = useMemo(
    () => new CapsuleGeometry(BODY_RADIUS, BODY_HEIGHT, 4, 8),
    [],
  );
  const flat = useMemo<Material>(
    () => new MeshLambertMaterial({ color: "#8b5cf6", flatShading: true }),
    [],
  );
  useEffect(() => {
    return () => {
      body.dispose();
      flat.dispose();
    };
  }, [body, flat]);

  const bodies = useMemo(() => createInstanceWriter(body, flat, MAX_PLAYERS), [body, flat]);
  const heads = useMemo(
    () => createInstanceWriter(getGeometry("box"), getMaterial("--sn-magenta-400", { kind: "lambert" }), MAX_PLAYERS),
    [],
  );
  useEffect(() => {
    return () => {
      bodies.dispose();
      heads.dispose();
    };
  }, [bodies, heads]);

  /** x, z, destino x, destino z, y el angulo hacia el que mira. */
  const state = useMemo(() => {
    const positions = new Float32Array(MAX_PLAYERS * 2);
    const targets = new Float32Array(MAX_PLAYERS * 2);
    const yaw = new Float32Array(MAX_PLAYERS);
    map.spawns.forEach((spawn, index) => {
      positions[index * 2] = spawn.x;
      positions[index * 2 + 1] = spawn.z;
      // Primer destino: el spawn de enfrente, asi arrancan cruzando el mapa.
      const other = map.spawns[(index + 5) % map.spawns.length]!;
      targets[index * 2] = other.x;
      targets[index * 2 + 1] = other.z;
    });
    return { positions, targets, yaw, seed: 1 };
  }, [map.spawns]);

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05);
    const { positions, targets, yaw } = state;

    if (running) {
      for (let i = 0; i < MAX_PLAYERS; i++) {
        const px = positions[i * 2]!;
        const pz = positions[i * 2 + 1]!;
        const dx = targets[i * 2]! - px;
        const dz = targets[i * 2 + 1]! - pz;
        const length = Math.hypot(dx, dz);

        if (length < 1.5) {
          // Nuevo destino, sin asignar nada: un PRNG entero de una linea.
          state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
          const pick = state.seed % map.spawns.length;
          const next = map.spawns[pick]!;
          targets[i * 2] = next.x;
          targets[i * 2 + 1] = next.z;
          continue;
        }

        positions[i * 2] = px + (dx / length) * BOT_SPEED * step;
        positions[i * 2 + 1] = pz + (dz / length) * BOT_SPEED * step;
        yaw[i] = Math.atan2(dx, dz);
      }
    }

    bodies.begin();
    heads.begin();
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const x = positions[i * 2]!;
      const z = positions[i * 2 + 1]!;
      bodies.pushYaw(x, BODY_HEIGHT / 2 + BODY_RADIUS, z, yaw[i]!, 1);
      heads.pushYaw(x, BODY_HEIGHT + BODY_RADIUS + 0.25, z, yaw[i]!, 0.5, 0.35, 0.5);
    }
    bodies.end();
    heads.end();

    /*
     * La camara va en los ojos del jugador 0. Es primera persona de verdad y
     * no una vista aerea a proposito: lo que hay que medir es el caso peor,
     * que es tener la geometria cerca y media arena en el campo de vision.
     */
    const px = positions[0]!;
    const pz = positions[1]!;
    camera.position.set(px, EYE_HEIGHT, pz);
    camera.rotation.set(0, yaw[0]!, 0);
  });

  return (
    <>
      <primitive object={bodies.mesh} />
      <primitive object={heads.mesh} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* La medicion                                                         */
/* ------------------------------------------------------------------ */

/**
 * Cuenta cuadros y lee `renderer.info`.
 *
 * Existe desde la fase 1 y no despues porque medir tarde es enterarse tarde:
 * el presupuesto de la guia son 60 draw calls y 40.000 triangulos, y sin un
 * numero en pantalla no hay forma de saber cuando se rompio.
 *
 * Reporta a 2 Hz. Llamar a React por cuadro para pintar un contador de fps es
 * exactamente la clase de cosa que hace bajar los fps que se estan midiendo.
 */
function PerfProbe({ onStats }: { onStats: (stats: ShooterStats) => void }) {
  const gl = useThree((state) => state.gl);
  const acc = useRef({ frames: 0, elapsed: 0 });
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;

  useFrame((_, delta) => {
    const current = acc.current;
    current.frames++;
    current.elapsed += delta;
    if (current.elapsed < 0.5) return;

    onStatsRef.current({
      fps: Math.round(current.frames / current.elapsed),
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
    });
    current.frames = 0;
    current.elapsed = 0;
  });

  return null;
}
