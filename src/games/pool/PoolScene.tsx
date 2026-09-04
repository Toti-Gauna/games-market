import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BallCollider,
  CuboidCollider,
  InstancedRigidBodies,
  Physics,
  RigidBody,
} from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { Color, SphereGeometry, TorusGeometry } from "three";
import type { InstancedMesh } from "three";
import { getMaterial } from "@/core/engine3d/materials";
import { createInstanceWriter, type InstanceWriter } from "@/core/engine3d/instancing";
import {
  BALL_COUNT,
  BALL_RADIUS,
  CUE_BALL,
  PHYSICS,
  POCKETS,
  POCKET_RADIUS,
  SETTLE_SPEED,
  SETTLE_TIMEOUT_MS,
  TABLE_LENGTH,
  TABLE_WIDTH,
  kindOf,
  type BallState,
  type ShotEvents,
} from "./logic";

/**
 * X2 · Pool — la escena.
 *
 * Todo lo que corre adentro del `<Canvas>`: la mesa, las 16 bolas con su
 * fisica, la camara y la deteccion de que el turno termino. **No sabe una sola
 * regla**: no conoce grupos, ni faltas, ni de quien es el turno. Cuando la
 * mesa se aquieta arma un `ShotEvents` —que toco primero, que cayo— y se lo
 * entrega a `logic.ts`, que es quien decide la partida.
 *
 * Esa division es la que hace que las reglas se puedan probar sin GPU, y es
 * tambien la que evita el error clasico de un juego de fisica: mezclar "la
 * bola entro en el bolsillo" con "entonces gana", y terminar con un
 * reglamento escrito adentro de un `useFrame`.
 *
 * Lo que hace que la fisica se sienta bien, en orden de importancia:
 *
 * 1. **CCD en las 16 bolas.** Un tiro fuerte mueve la blanca varios diametros
 *    por paso. Sin colision continua, la atraviesa y el juego pierde toda
 *    credibilidad de golpe. Es la primera cosa que hay que verificar si algo
 *    se ve raro.
 * 2. **Paso fijo `1/120`.** Va en `<Physics timeStep>`, no en el delta del
 *    cuadro: un solver con delta variable da resultados distintos en cada
 *    maquina, y con eso se cae la reproducibilidad por semilla.
 * 3. **El turno no se evalua hasta que todo duerme.** Una bola rodando lento
 *    puede caer tres segundos despues, y evaluar antes es declarar un
 *    resultado que la mesa todavia no dio.
 */

/** Lo que el juego le puede pedir a la mesa. */
export type PoolTableHandle = {
  /** Pega con la blanca. Angulo en radianes, fuerza y efecto 0..1 y -1..1. */
  shoot(angle: number, power: number, spin: number): void;
  /** Coloca la blanca. Para el saque y para la bola en mano. */
  placeCue(x: number, z: number): void;
  /** Devuelve las posiciones actuales, para pintar el mando. */
  read(): readonly BallState[];
  /** true mientras las bolas siguen moviendose. */
  isSettling(): boolean;
};

/** Altura del centro de una bola apoyada en el pano. */
const BALL_Y = BALL_RADIUS;

/** Espesor y alto de las bandas. */
const RAIL = 0.05;

/**
 * Impulso maximo, en unidades de Rapier.
 *
 * Calibrado para que `power: 1` sea un saque que abre el triangulo entero y
 * `power: 0.2` un tiro de posicion. Es el numero que mas se va a tocar
 * jugando, y por eso esta solo y con nombre en vez de multiplicado adentro de
 * una linea.
 */
const MAX_IMPULSE = 0.62;

/** Cuanto efecto vertical se le puede imprimir. */
const MAX_SPIN_TORQUE = 0.0055;

const BALL_COLOR: Record<string, string> = {
  cue: "#f4f1ea",
  solids: "#f2b134",
  stripes: "#3aa3d6",
  eight: "#15131d",
};

export type PoolSceneProps = {
  /** Posiciones con las que arranca la mesa. Cambiarlas rehace el rack. */
  rack: readonly BallState[];
  /** Con `false` el solver no avanza: pausa, cuenta regresiva, fin. */
  running: boolean;
  reduced: boolean;
  /** La mesa se aquieto y este es el resultado crudo del tiro. */
  onSettled: (events: ShotEvents) => void;
  handleRef: RefObject<PoolTableHandle | null>;
};

export function PoolScene({ rack, running, reduced, onSettled, handleRef }: PoolSceneProps) {
  return (
    <>
      {/*
        `timeStep` fijo, no el delta del cuadro. Es la condicion para que la
        misma semilla y el mismo tiro den el mismo resultado en dos maquinas:
        un solver con delta variable diverge aunque el codigo sea identico.

        `paused` en vez de desmontar: la mesa tiene que quedar como estaba
        durante la pausa y la cuenta regresiva, no volver al rack.
      */}
      <Physics timeStep={PHYSICS.step} gravity={[0, -9.81, 0]} paused={!running}>
        <Cushions />
        <Balls rack={rack} onSettled={onSettled} handleRef={handleRef} />
      </Physics>
      <CameraRig handleRef={handleRef} reduced={reduced} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* La mesa                                                             */
/* ------------------------------------------------------------------ */

/**
 * Pano y bandas.
 *
 * Cuatro paredes enteras, sin recortar las bocas de los bolsillos. La caida
 * NO se resuelve con un agujero en la geometria: se mide la distancia al
 * centro del bolsillo, que es exacto, barato y —lo que mas importa—
 * determinista. Un agujero real depende de que el solver deje pasar la bola
 * justo por ahi, y eso cambia con el paso y con la velocidad.
 */
function Cushions() {
  const cloth = getMaterial("--sn-bg-elev", { kind: "lambert" });
  const rail = getMaterial("--sn-violet-600", { kind: "lambert" });

  const halfL = TABLE_LENGTH / 2;
  const halfW = TABLE_WIDTH / 2;

  return (
    <RigidBody type="fixed" restitution={PHYSICS.restitutionRail} friction={0.2}>
      {/* El pano. Un cuboide fino en vez de un plano: un plano sin espesor
          deja pasar una bola rapida por debajo. */}
      <CuboidCollider args={[halfL, 0.02, halfW]} position={[0, -0.02, 0]} />
      <mesh position={[0, -0.02, 0]} material={cloth} dispose={null}>
        <boxGeometry args={[TABLE_LENGTH, 0.04, TABLE_WIDTH]} />
      </mesh>

      {[
        { position: [halfL + RAIL / 2, 0, 0], size: [RAIL / 2, RAIL, halfW] },
        { position: [-halfL - RAIL / 2, 0, 0], size: [RAIL / 2, RAIL, halfW] },
        { position: [0, 0, halfW + RAIL / 2], size: [halfL + RAIL, RAIL, RAIL / 2] },
        { position: [0, 0, -halfW - RAIL / 2], size: [halfL + RAIL, RAIL, RAIL / 2] },
      ].map((wall, index) => (
        <group key={index}>
          <CuboidCollider
            args={wall.size as [number, number, number]}
            position={wall.position as [number, number, number]}
          />
          <mesh
            position={wall.position as [number, number, number]}
            material={rail}
            dispose={null}
          >
            <boxGeometry args={[wall.size[0]! * 2, wall.size[1]! * 2, wall.size[2]! * 2]} />
          </mesh>
        </group>
      ))}

      {/* Las bocas, solo como marca visual: quien decide es la distancia. */}
      {POCKETS.map((pocket, index) => (
        <mesh
          key={index}
          position={[pocket.x, 0.001, pocket.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={getMaterial("--sn-bg", { kind: "basic" })}
          dispose={null}
        >
          <circleGeometry args={[POCKET_RADIUS, 20]} />
        </mesh>
      ))}
    </RigidBody>
  );
}

/* ------------------------------------------------------------------ */
/* Las bolas                                                           */
/* ------------------------------------------------------------------ */

function Balls({
  rack,
  onSettled,
  handleRef,
}: {
  rack: readonly BallState[];
  onSettled: (events: ShotEvents) => void;
  handleRef: RefObject<PoolTableHandle | null>;
}) {
  const bodiesRef = useRef<(RapierRigidBody | null)[] | null>(null);
  const meshRef = useRef<InstancedMesh | null>(null);

  /*
   * Esfera propia y no la compartida de `geometry.ts`.
   *
   * La compartida es de 12x8 segmentos, que alcanza para un decorado lejano y
   * no para el objeto que la sala mira de cerca durante ocho minutos: a esa
   * resolucion una bola de pool se lee como un dado. 24x16 son ~12.000
   * triangulos entre las dieciseis, muy por debajo del presupuesto de 40.000.
   * Al ser propia, la libera este componente.
   */
  const sphere = useMemo(() => new SphereGeometry(BALL_RADIUS, 24, 16), []);
  const band = useMemo(
    () => new TorusGeometry(BALL_RADIUS * 0.92, BALL_RADIUS * 0.3, 8, 20),
    [],
  );
  useEffect(() => {
    return () => {
      sphere.dispose();
      band.dispose();
    };
  }, [sphere, band]);

  /*
   * La franja de las rayadas, como segunda capa instanciada.
   *
   * Distinguir lisas de rayadas SOLO por color romperia la misma regla que el
   * resto del catalogo respeta con las formas de las opciones: en cualquier
   * sala de 40 personas hay alguien que no separa esos dos colores. Un anillo
   * sobre la esfera es la diferencia de forma, y cuesta un draw call.
   */
  const stripes = useMemo<InstanceWriter>(
    () => createInstanceWriter(band, getMaterial("--sn-text", { kind: "lambert" }), 7),
    [band],
  );
  useEffect(() => () => stripes.dispose(), [stripes]);

  const instances = useMemo(
    () =>
      rack.map((ball) => ({
        key: ball.id,
        position: [ball.x, BALL_Y, ball.z] as [number, number, number],
        userData: { id: ball.id },
      })),
    [rack],
  );

  /** Estado del tiro en curso. En una ref: cambia por cuadro y no se pinta. */
  const shotRef = useRef({
    active: false,
    startedAt: 0,
    firstContact: null as number | null,
    pocketed: [] as number[],
  });

  /** Bolas fuera de la mesa. Se consulta en cada cuadro, asi que es un Set. */
  const pocketedRef = useRef(new Set<number>());

  useEffect(() => {
    // Rack nuevo: la mesa vuelve a estar entera.
    pocketedRef.current.clear();
    shotRef.current = { active: false, startedAt: 0, firstContact: null, pocketed: [] };
  }, [rack]);

  /** Pinta cada bola una sola vez, cuando el mesh ya existe. */
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const color = new Color();
    for (let i = 0; i < BALL_COUNT; i++) {
      const ball = rack[i];
      if (!ball) continue;
      color.set(BALL_COLOR[kindOf(ball.id)] ?? "#ffffff");
      mesh.setColorAt(i, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [rack]);

  const bodyOf = useCallback((id: number): RapierRigidBody | null => {
    const bodies = bodiesRef.current;
    if (!bodies) return null;
    // El orden de `instances` es el de `rack`, que viene ordenado por id.
    return bodies[id] ?? null;
  }, []);

  /* ---------------------------------------------------------------- */
  /* El handle que usa el juego                                        */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const handle: PoolTableHandle = {
      shoot(angle, power, spin) {
        const cue = bodyOf(CUE_BALL);
        if (!cue || shotRef.current.active) return;

        const dx = Math.cos(angle);
        const dz = Math.sin(angle);
        const impulse = MAX_IMPULSE * Math.min(1, Math.max(0, power));

        cue.wakeUp();
        cue.applyImpulse({ x: dx * impulse, y: 0, z: dz * impulse }, true);

        /*
         * Efecto vertical.
         *
         * El eje de rodadura de una bola que va hacia `d` es `arriba x d`.
         * Girar sobre ese eje adelanta la bola tras el impacto (corrida) y
         * girar al reves la frena o la devuelve (retroceso). El eje lateral
         * NO se toca a proposito: con efecto completo el juego es injugable
         * para quien no juega al pool.
         */
        if (spin !== 0) {
          const torque = MAX_SPIN_TORQUE * spin * Math.max(0.25, power);
          cue.applyTorqueImpulse({ x: dz * torque, y: 0, z: -dx * torque }, true);
        }

        shotRef.current = {
          active: true,
          startedAt: performance.now(),
          firstContact: null,
          pocketed: [],
        };
      },

      placeCue(x, z) {
        const cue = bodyOf(CUE_BALL);
        if (!cue || shotRef.current.active) return;
        cue.setTranslation({ x, y: BALL_Y, z }, true);
        cue.setLinvel({ x: 0, y: 0, z: 0 }, true);
        cue.setAngvel({ x: 0, y: 0, z: 0 }, true);
        cue.setEnabled(true);
        pocketedRef.current.delete(CUE_BALL);
      },

      read() {
        const out: BallState[] = [];
        for (let id = 0; id < BALL_COUNT; id++) {
          const body = bodyOf(id);
          const pocketed = pocketedRef.current.has(id);
          if (!body) continue;
          const position = body.translation();
          out.push({ id, x: position.x, z: position.z, pocketed });
        }
        return out;
      },

      isSettling() {
        return shotRef.current.active;
      },
    };

    handleRef.current = handle;
    return () => {
      handleRef.current = null;
    };
  }, [bodyOf, handleRef]);

  /* ---------------------------------------------------------------- */
  /* Bolsillos y reposo                                                */
  /* ---------------------------------------------------------------- */

  const sink = useCallback(
    (id: number, body: RapierRigidBody) => {
      pocketedRef.current.add(id);
      shotRef.current.pocketed.push(id);
      // Se la manda debajo del pano y se apaga: se lee como que cayo, y deja
      // de costar un cuerpo simulado por el resto de la partida.
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.setTranslation({ x: 0, y: -0.6, z: 0 }, true);
      body.setEnabled(false);
    },
    [],
  );

  useFrame(() => {
    const bodies = bodiesRef.current;
    if (!bodies) return;

    const shot = shotRef.current;
    let moving = false;

    for (let id = 0; id < BALL_COUNT; id++) {
      const body = bodies[id];
      if (!body || pocketedRef.current.has(id)) continue;

      const position = body.translation();

      // Fuera de la mesa por un tiro que la saco volando: cuenta como caida.
      // Sin esto, una bola perdida deja el turno sin cerrar para siempre.
      if (position.y < -BALL_RADIUS * 2) {
        sink(id, body);
        continue;
      }

      for (const pocket of POCKETS) {
        if (Math.hypot(position.x - pocket.x, position.z - pocket.z) < POCKET_RADIUS) {
          sink(id, body);
          break;
        }
      }
      if (pocketedRef.current.has(id)) continue;

      const velocity = body.linvel();
      if (Math.hypot(velocity.x, velocity.y, velocity.z) > SETTLE_SPEED) moving = true;
    }

    // Las rayadas llevan su anillo encima, con la rotacion de su bola.
    stripes.begin();
    for (let id = 0; id < BALL_COUNT; id++) {
      if (kindOf(id) !== "stripes" || pocketedRef.current.has(id)) continue;
      const body = bodies[id];
      if (!body) continue;
      const p = body.translation();
      const q = body.rotation();
      stripes.pushQuat(p.x, p.y, p.z, q.x, q.y, q.z, q.w, 1);
    }
    stripes.end();

    if (!shot.active) return;

    /*
     * El turno cierra cuando todo duerme, o a los 12 segundos.
     *
     * El tope no es paranoia: dos bolas apoyadas una contra otra pueden
     * quedar temblando por debajo del umbral durante mucho tiempo, y dejar la
     * mesa trabada es peor que cerrar un turno un segundo antes.
     */
    const timedOut = performance.now() - shot.startedAt > SETTLE_TIMEOUT_MS;
    if (moving && !timedOut) return;

    shot.active = false;
    onSettled({ firstContact: shot.firstContact, pocketed: [...shot.pocketed] });
  });

  return (
    <InstancedRigidBodies
      ref={bodiesRef}
      instances={instances}
      colliders={false}
      colliderNodes={[<BallCollider key="ball" args={[BALL_RADIUS]} />]}
      // CCD: lo unico que evita que un tiro fuerte atraviese otra bola.
      ccd
      restitution={PHYSICS.restitutionBall}
      friction={PHYSICS.rollingFriction}
      linearDamping={0.42}
      angularDamping={PHYSICS.angularDamping}
      onCollisionEnter={({ target, other }) => {
        const shot = shotRef.current;
        if (!shot.active || shot.firstContact !== null) return;
        // Solo interesa lo que toca la blanca, y solo la primera vez.
        const self = (target.rigidBody?.userData as { id?: number } | undefined)?.id;
        const hit = (other.rigidBody?.userData as { id?: number } | undefined)?.id;
        if (self !== CUE_BALL || hit === undefined) return;
        shot.firstContact = hit;
      }}
    >
      <instancedMesh
        ref={meshRef}
        args={[sphere, getMaterial("--sn-text", { kind: "lambert" }), BALL_COUNT]}
        count={BALL_COUNT}
        castShadow={false}
        receiveShadow={false}
      />
      <primitive object={stripes.mesh} />
    </InstancedRigidBodies>
  );
}

/* ------------------------------------------------------------------ */
/* Camara                                                              */
/* ------------------------------------------------------------------ */

/**
 * Vista cenital apenas inclinada, que sigue a la blanca durante el tiro.
 *
 * No es perfectamente desde arriba a proposito: unos grados de inclinacion
 * dan profundidad sin perder la lectura de los angulos, que es lo unico que
 * importa para entender un tiro de pool.
 *
 * Con movimiento reducido **el seguimiento se conserva**. Es la excepcion
 * deliberada: perder la bola de vista seria peor que el movimiento, y la
 * guia lo pide explicitamente. Lo que se apaga es el ralenti y la sacudida,
 * que no viven aca.
 */
function CameraRig({
  handleRef,
  reduced,
}: {
  handleRef: RefObject<PoolTableHandle | null>;
  reduced: boolean;
}) {
  const camera = useThree((state) => state.camera);

  useFrame((_, delta) => {
    const handle = handleRef.current;
    const settling = handle?.isSettling() ?? false;

    // Durante el tiro se acerca a la blanca; en reposo vuelve a ver la mesa
    // entera, que es cuando hay que decidir el proximo tiro.
    const cue = settling ? handle?.read().find((b) => b.id === CUE_BALL) : undefined;
    const targetX = cue && !cue.pocketed ? cue.x * 0.35 : 0;
    const height = settling ? 1.85 : 2.25;

    // Sin lerp la camara salta en cada cambio de estado. El factor sale del
    // delta para que no dependa de los cuadros por segundo.
    const k = reduced ? 1 : 1 - Math.exp(-4 * delta);
    camera.position.x += (targetX - camera.position.x) * k;
    camera.position.y += (height - camera.position.y) * k;
    camera.position.z += (TABLE_WIDTH * 0.95 - camera.position.z) * k;
    camera.lookAt(targetX * 0.5, 0, 0);
  });

  return null;
}
