import { Suspense, lazy, useEffect, useRef, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { ColorManagement, NoToneMapping, SRGBColorSpace } from "three";
import type { GamePhase } from "@/core/engine/useGameLifecycle";
import { GameStage } from "@/ui/game/GameStage";
import { disposeGeometries } from "./geometry";
import { disposeMaterials } from "./materials";
import { disposeShaders } from "./shaders";

/**
 * El escenario 3D: el `<Canvas>` de R3F con todo lo que hay que acertar una
 * sola vez, y el HUD en DOM encima.
 *
 * El HUD, la cuenta regresiva, la pantalla de instrucciones, la pausa y el
 * resumen son los de `GameStage`, los mismos que usan los doce juegos 2D. No
 * hay una version 3D de nada de eso: R3F trae su propio canvas, asi que lo
 * unico que cambia es la superficie, y `GameStage` la acepta por prop.
 *
 * Todo lo que se configura aca sale del presupuesto, no del gusto:
 *
 * - **DPR topeado**: 2 en el proyector, 1.5 en celular. Renderizar a 3x es la
 *   forma mas rapida de perder cuadros y la que menos se nota.
 * - **Antialias apagado en celular**: con MSAA en un telefono se pierden mas
 *   cuadros de los que se ganan en calidad percibida.
 * - **Sombras apagadas por defecto**: un shadow map dinamico es lo mas caro
 *   que hay, y sobre geometria de caras planas y colores planos casi no se
 *   nota. Quien las quiera, las enciende y las paga.
 * - **Sin tone mapping**: R3F usa ACES filmico por defecto, que reasigna todo
 *   el rango de color. Es lindo para PBR fotografico y es exactamente lo que
 *   haria que el violeta del juego NO fuera el violeta de la app. Con
 *   `NoToneMapping` y salida sRGB, el token y el pixel coinciden.
 *
 * Descarte: al desmontar se liberan las geometrias y los materiales
 * compartidos. El renderer lo libera R3F solo. Una fuga en 3D no es un
 * megabyte de mas, es la pestania.
 *
 * **Movimiento reducido**: el escenario no anima nada por su cuenta —no hay
 * shake de camara, ni motion blur, ni bob— justamente para no tener que
 * apagarlo. Lo que el juego si anime tiene que consultar el `reducedMotion`
 * que ya trae `useGameLifecycle`, y con la animacion apagada el juego tiene
 * que seguir siendo jugable, no verse quieto.
 */

/**
 * `ColorManagement` a mano y explicito.
 *
 * Es el default de three desde hace varias versiones, pero de esto depende
 * que un `#8b5cf6` de `tokens.css` se vea como `#8b5cf6`: si un dia alguien
 * lo apaga en otro lado, que rompa aca y no en la percepcion del color.
 */
ColorManagement.enabled = true;

/**
 * Metricas de desarrollo, nunca en produccion.
 *
 * En build, `import.meta.env.DEV` es `false` literal, la rama muere y el
 * `import()` se va con ella: `r3f-perf` no entra al bundle.
 */
const Perf = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import("r3f-perf")).Perf }))
  : null;

/** Mismo criterio que `canvas.ts`: puntero grueso es telefono o tablet. */
function isCoarsePointer(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

export type StageCamera = {
  position: readonly [number, number, number];
  fov?: number;
  near?: number;
  far?: number;
};

export type StageProps = {
  /** La escena. Todo lo que vaya aca corre adentro del `<Canvas>`. */
  children: ReactNode;

  phase: GamePhase;
  countdownLeft: number;
  /** Una linea. "Apuntá con el celular", no un tutorial de tres pantallas. */
  instructions: string;
  hud?: ReactNode;
  summary?: ReactNode;
  introExtra?: ReactNode;
  /** Capa de DOM entre el canvas y el HUD: sticks, mira, indicadores. */
  overlay?: ReactNode;
  muted: boolean;
  onToggleMuted: () => void;
  onStart: () => void;
  onResume: () => void;
  onPause: () => void;
  onRestart: () => void;
  /** Proporcion del encuadre, para reservar el espacio correcto. */
  aspect?: number;
  /** Solo en el banco de pruebas (`config.debug`). Nunca en produccion. */
  fps?: number;
  /** Enciende `r3f-perf`. Solo tiene efecto en desarrollo. */
  debug?: boolean;

  camera?: StageCamera;
  /** Cuesta caro. Solo si el juego demuestra que lo necesita. */
  shadows?: boolean;
  /**
   * Multiplicador de resolucion del guardia de rendimiento. El escalon 4 lo
   * baja a 0.8; el resto del tiempo es 1.
   */
  resolutionScale?: number;
  /**
   * Luces por defecto: una ambiente y una direccional, sin sombras. Con
   * `false` las pone el juego.
   */
  lights?: boolean;
  /** Color de fondo. Sale de `tokens.css`, nunca un hex suelto. */
  background?: string;
  /**
   * `"demand"` solo dibuja cuando algo cambia. Sirve para una escena quieta
   * —un lobby, un selector— y no para un juego, que usa `"always"`.
   */
  frameloop?: "always" | "demand" | "never";
};

export function Stage({
  children,
  phase,
  countdownLeft,
  instructions,
  hud,
  summary,
  introExtra,
  overlay,
  muted,
  onToggleMuted,
  onStart,
  onResume,
  onPause,
  onRestart,
  aspect = 16 / 9,
  fps,
  debug = false,
  camera,
  shadows = false,
  resolutionScale = 1,
  lights = true,
  background,
  frameloop = "always",
}: StageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  /*
   * Descarte explicito al desmontar.
   *
   * Las geometrias y los materiales compartidos viven en caches de modulo, o
   * sea fuera del arbol de React: nadie los libera solo. Montar y desmontar
   * un juego veinte veces sin esto deja veinte juegos de buffers vivos en la
   * GPU, y ese es el tipo de fuga que termina tirando la pestania.
   *
   * Corre despues del desmontaje de los hijos, que es el orden correcto: para
   * cuando toca, ya no hay nadie usandolos.
   */
  useEffect(() => {
    return () => {
      disposeGeometries();
      disposeMaterials();
      disposeShaders();
    };
  }, []);

  const maxDpr = (isCoarsePointer() ? 1.5 : 2) * resolutionScale;
  const antialias = !isCoarsePointer();

  const surface = (
    <Canvas
      // El tope del contrato, con el escalon de resolucion del guardia.
      dpr={[1, maxDpr]}
      gl={{
        antialias,
        powerPreference: "high-performance",
        // Sin stencil: no hay nada en el catalogo que lo use y ocupa memoria
        // de framebuffer en todas las resoluciones.
        stencil: false,
        depth: true,
      }}
      frameloop={frameloop}
      shadows={shadows}
      {...(camera
        ? {
            camera: {
              position: [camera.position[0], camera.position[1], camera.position[2]] as [
                number,
                number,
                number,
              ],
              fov: camera.fov ?? 60,
              near: camera.near ?? 0.1,
              far: camera.far ?? 200,
            },
          }
        : {})}
      onCreated={({ gl }) => {
        gl.outputColorSpace = SRGBColorSpace;
        gl.toneMapping = NoToneMapping;
      }}
      /*
       * El fondo va por CSS y no por `scene.background`: el clear del canvas
       * queda transparente, asi que el color sale del token tal cual, sin
       * pasar por el pipeline de color. Un degrade de marca detras de la
       * escena tampoco cuesta un solo cuadro.
       */
      style={background ? { background } : undefined}
    >
      {lights && (
        <>
          {/*
            Dos luces y se acabo. La ambiente levanta las caras que no miran a
            la direccional, y la direccional da el volumen. Sin sombras: no
            estan encendidas y aunque lo estuvieran, `castShadow` va objeto
            por objeto y lo decide el juego.
          */}
          <ambientLight intensity={0.65} />
          <directionalLight position={[6, 10, 4]} intensity={1.1} />
        </>
      )}
      {children}
      {Perf && debug && (
        <Suspense fallback={null}>
          <Perf position="bottom-left" />
        </Suspense>
      )}
    </Canvas>
  );

  return (
    <GameStage
      containerRef={containerRef}
      surface={surface}
      phase={phase}
      countdownLeft={countdownLeft}
      instructions={instructions}
      {...(hud !== undefined ? { hud } : {})}
      {...(summary !== undefined ? { summary } : {})}
      {...(introExtra !== undefined ? { introExtra } : {})}
      {...(overlay !== undefined ? { overlay } : {})}
      muted={muted}
      onToggleMuted={onToggleMuted}
      onStart={onStart}
      onResume={onResume}
      onPause={onPause}
      onRestart={onRestart}
      aspect={aspect}
      {...(fps !== undefined ? { fps } : {})}
    />
  );
}
