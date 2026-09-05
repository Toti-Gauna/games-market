import type {
  Color} from "three";
import {
  AdditiveBlending,
  BackSide,
  DoubleSide,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from "three";
import type { PaletteToken } from "@/core/engine/palette";
import { getColor } from "./materials";

/**
 * Los tres shaders que hacen que una escena de primitivas se vea de marca y
 * no de tutorial: el cielo, el piso y el anillo.
 *
 * Son shaders y no materiales de three por una razon de presupuesto: un
 * degrade de cielo con `MeshBasicMaterial` pide una textura, una grilla en el
 * piso pide otra, y el contrato de la base 3D dice cero texturas. Con un
 * fragmento de diez lineas se consigue lo mismo, no pesa nada y se ve igual en
 * el proyector y en un telefono.
 *
 * Todos cachean como `materials.ts`: se crean una vez, se comparten y se
 * liberan en `disposeShaders()`, que `Stage` llama al desmontar. Cero hex: los
 * colores entran como tokens de la paleta.
 *
 * Dos detalles que si se olvidan se ven mal:
 *
 * - **`colorspace_fragment` al final de cada fragmento.** Con `ColorManagement`
 *   activo, three espera que el shader escriba en lineal y convierte a sRGB en
 *   ese chunk. Sin el, el cielo sale lavado y el token no coincide con la app.
 * - **La niebla se incluye a mano.** Un `ShaderMaterial` no participa de
 *   `scene.fog` solo: hay que mezclar `UniformsLib.fog` y meter los chunks. El
 *   piso lo hace, porque un piso que no se pierde en la niebla delata el borde
 *   del mundo; el cielo y el anillo no, porque tienen que verse siempre.
 */

const cache = new Map<string, ShaderMaterial>();
/** Los que llevan `uTime`: se les avanza el reloj una vez por cuadro. */
const animated = new Set<ShaderMaterial>();

const COLORSPACE = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/* ------------------------------------------------------------------ */
/* Cielo                                                               */
/* ------------------------------------------------------------------ */

const SKY_VERTEX = `
  varying float vHeight;
  void main() {
    vHeight = normalize(position).y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  varying float vHeight;
  void main() {
    float h = clamp(vHeight, -1.0, 1.0);
    // El horizonte concentra el color: una franja angosta de acento que se
    // apaga rapido hacia arriba. Es lo que hace que se lea como atmosfera y no
    // como una pelota pintada.
    vec3 up = mix(uHorizon, uTop, pow(h, 0.45));
    vec3 down = mix(uHorizon, uBottom, pow(-h, 0.7));
    vec3 color = h >= 0.0 ? up : down;
    gl_FragColor = vec4(color, 1.0);
    ${COLORSPACE}
  }
`;

/**
 * Domo de cielo: degrade de tres colores sobre una esfera vista desde adentro.
 * Sin textura, sin profundidad (`depthWrite: false`) y sin niebla.
 */
export function getSkyMaterial(top: PaletteToken, horizon: PaletteToken, bottom: PaletteToken): ShaderMaterial {
  const key = `sky|${top}|${horizon}|${bottom}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const material = new ShaderMaterial({
    uniforms: {
      uTop: { value: getColor(top).clone() },
      uHorizon: { value: getColor(horizon).clone() },
      uBottom: { value: getColor(bottom).clone() },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  material.name = key;
  cache.set(key, material);
  return material;
}

/* ------------------------------------------------------------------ */
/* Piso con grilla                                                     */
/* ------------------------------------------------------------------ */

const GRID_VERTEX = `
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorld = worldPosition.xyz;
    vec4 mvPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const GRID_FRAGMENT = `
  #include <fog_pars_fragment>
  uniform vec3 uBase;
  uniform vec3 uLine;
  uniform float uCell;
  uniform float uWidth;
  uniform float uGlow;
  varying vec3 vWorld;
  void main() {
    // Distancia en unidades del mundo a la linea de grilla mas cercana.
    vec2 g = abs(fract(vWorld.xz / uCell + 0.5) - 0.5) * uCell;
    float d = min(g.x, g.y);
    float line = 1.0 - smoothstep(0.0, uWidth, d);
    vec3 color = mix(uBase, uLine, line * uGlow);
    gl_FragColor = vec4(color, 1.0);
    #include <fog_fragment>
    ${COLORSPACE}
  }
`;

export type GridFloorOptions = {
  /** Lado de cada celda, en unidades del mundo. */
  cell?: number;
  /** Ancho de la linea, en unidades del mundo. */
  width?: number;
  /** Cuanto se acerca la linea al color de acento. 0..1. */
  glow?: number;
};

/**
 * Piso con grilla de acento. Participa de la niebla de la escena, que es lo
 * que hace que el borde del mundo desaparezca en vez de cortarse.
 */
export function getGridFloorMaterial(
  base: PaletteToken,
  line: PaletteToken,
  options: GridFloorOptions = {},
): ShaderMaterial {
  const cell = options.cell ?? 4;
  const width = options.width ?? 0.06;
  const glow = options.glow ?? 0.55;
  const key = `grid|${base}|${line}|${cell}|${width}|${glow}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uBase: { value: getColor(base).clone() },
        uLine: { value: getColor(line).clone() },
        uCell: { value: cell },
        uWidth: { value: width },
        uGlow: { value: glow },
      },
    ]),
    vertexShader: GRID_VERTEX,
    fragmentShader: GRID_FRAGMENT,
    fog: true,
  });
  material.name = key;
  cache.set(key, material);
  return material;
}

/* ------------------------------------------------------------------ */
/* Anillo                                                              */
/* ------------------------------------------------------------------ */

const RING_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    // Bandas verticales que corren, mas un barrido lento hacia arriba: se
    // tiene que leer como peligro en movimiento, no como una pared.
    float bands = 0.5 + 0.5 * sin(vUv.x * 80.0 + uTime * 2.5);
    float sweep = 0.5 + 0.5 * sin(vUv.y * 5.0 - uTime * 3.0);
    float alpha = 0.10 + bands * 0.16 + sweep * 0.10;
    // Se apaga arriba: un cilindro que termina en seco contra el cielo se ve
    // como un objeto; desvanecido se ve como un campo.
    alpha *= smoothstep(0.0, 0.05, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
    gl_FragColor = vec4(uColor, alpha);
    ${COLORSPACE}
  }
`;

/**
 * El anillo del shooter: cilindro translucido con bandas animadas. Aditivo,
 * doble cara y sin escribir profundidad, para que se vea a traves y desde
 * adentro y desde afuera.
 */
export function getRingMaterial(color: PaletteToken): ShaderMaterial {
  const key = `ring|${color}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const material = new ShaderMaterial({
    uniforms: {
      uColor: { value: getColor(color).clone() },
      uTime: { value: 0 },
    },
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  material.name = key;
  cache.set(key, material);
  animated.add(material);
  return material;
}

/* ------------------------------------------------------------------ */
/* Reloj y descarte                                                    */
/* ------------------------------------------------------------------ */

/** Avanza `uTime` de todo lo animado. Una llamada por cuadro, desde `useFrame`. */
export function tickShaders(elapsedS: number): void {
  for (const material of animated) {
    const uniform = material.uniforms.uTime;
    if (uniform) uniform.value = elapsedS;
  }
}

/** Cuantos shaders hay vivos. Para los tests y el panel de debug. */
export function shaderCacheSize(): number {
  return cache.size;
}

/** Descarte explicito. `Stage` lo llama al desmontar. */
export function disposeShaders(): void {
  for (const material of cache.values()) material.dispose();
  cache.clear();
  animated.clear();
}

/** Un `Color` de marca ya en lineal, para escribir uniforms sin tocar el cache. */
export function paletteColor(token: PaletteToken): Color {
  return getColor(token).clone();
}
