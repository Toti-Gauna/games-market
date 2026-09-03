# Base 3D · Three.js y React Three Fiber

> Leé `docs/CONTRATO-JUEGOS.md` y `docs/fase-3/README.md` primero.
> **La usan 4 juegos**: Pool, Shooter, Metaverso y, parcialmente, Carreras.

Son los cuatro más caros de los 24. Por eso van al final del orden y por eso esta base existe:
para que el costo se pague una vez.

---

## Qué existe hoy

Nada 3D. Ni `three` ni nada relacionado en `package.json`. El proyecto es 2D entero.

`docs/fase-3/X4-SHOOTER-3D.md` ya define un battle royale de 10 jugadores con **geometría
generada desde cero**, sin assets externos. Esa decisión se conserva y es la correcta: evita todo
el pipeline de modelado, texturas y carga, que sería más trabajo que los cuatro juegos juntos.

---

## Dependencias

```bash
npm i three @react-three/fiber @react-three/drei @react-three/rapier three-mesh-bvh
npm i -D @types/three r3f-perf
```

| Paquete | Para qué |
|---|---|
| `three` | El motor |
| `@react-three/fiber` | Three declarativo en React. Un juego 3D es un componente más, con el mismo ciclo de vida que los 2D |
| `@react-three/drei` | `Instances`, cámaras, `Html`, controles. Evita reescribir lo obvio |
| `@react-three/rapier` | Física 3D. Mismo motor WASM que el 2D, mismo determinismo |
| `three-mesh-bvh` | Raycast acelerado **contra mallas complejas**. Ver §6: no todos los 3D lo necesitan |
| `r3f-perf` | Métricas en desarrollo. Nunca en producción |

`@react-three/postprocessing` queda **fuera del set base**: se agrega sólo si un juego lo pide y
es lo primero que se apaga si no se llega a 60 fps.

---

## Qué construir

```
src/games/_engine3d/
├── Stage.tsx           ← Canvas configurado, DPR topeado, cámara, luces
├── useFixedStep.ts     ← timestep fijo dentro de useFrame
├── instancing.ts       ← helpers de InstancedMesh
├── geometry.ts         ← primitivas procedurales compartidas
├── materials.ts        ← materiales con la paleta de marca, cacheados
├── bvh.ts              ← raycast acelerado
├── lod.ts              ← niveles de detalle por distancia
├── audio3d.ts          ← audio posicional
└── perf.ts             ← degradación automática de calidad
```

### 1. `Stage.tsx`

El `<Canvas>` con todo lo que hay que acertar una vez:

```tsx
<Canvas
  dpr={[1, isPhone ? 1.5 : 2]}          // el tope del contrato
  gl={{
    antialias: !isPhone,                 // en celular cuesta más de lo que aporta
    powerPreference: "high-performance",
    stencil: false,
    depth: true,
  }}
  frameloop="demand"                     // sólo para escenas quietas; los juegos usan "always"
  shadows={false}                        // sombras dinámicas: apagadas por defecto
/>
```

Decisiones que vienen del presupuesto, no del gusto:

- **Sombras apagadas por defecto.** Un shadow map dinámico es lo más caro que hay y en un juego de
  formas geométricas casi no se nota. Quien las quiera, las enciende y paga.
- **Antialias off en celular.** Con MSAA en un teléfono se pierden más frames de los que se ganan
  en calidad percibida.
- **`ColorManagement` activo** y salida en sRGB, para que los colores de marca se vean como en el
  resto de la app.

### 2. Timestep fijo dentro de `useFrame`

Mismo principio que la base 2D, y por la misma razón: la física de Rapier tiene que ser
determinista para que `arena` pueda sincronizar.

```ts
export function useFixedStep(update: (dt: number) => void) {
  const acc = useRef(0);
  useFrame((_, delta) => {
    acc.current += Math.min(delta, 0.25);
    while (acc.current >= STEP) { update(STEP); acc.current -= STEP; }
  });
}
```

Rapier se configura con el mismo `1/60` y **no** con el delta del frame.

### 3. Instancing

La regla que decide si un juego 3D corre o no: **un draw call por tipo de objeto, no por objeto**.

```tsx
<Instances limit={500} geometry={boxGeometry} material={wallMaterial}>
  {walls.map((w) => <Instance key={w.id} position={w.pos} scale={w.scale} />)}
</Instances>
```

En el shooter, todas las paredes son una instancia; todos los proyectiles, otra. La diferencia
entre 500 draw calls y 3 es la diferencia entre 20 fps y 60.

### 4. Geometría procedural

Como los prompts existentes deciden generar todo desde cero, conviene compartir el generador:

```ts
export const geometry = {
  box, cylinder, capsule, ramp, arch, column, crate, barrier,
  // Personaje: cápsula + cabeza + indicador de dirección. Sin rig, sin animación esquelética.
  avatar(seed: string): BufferGeometry,
  // Nivel: BSP simple sembrado, para el shooter
  arena(seed: string, size: number): { walls: Transform[]; spawns: Vector3[] },
};
```

**Las geometrías se crean una vez y se comparten.** Un `new BoxGeometry()` por objeto es la
versión 3D del error de asignar en el loop.

### 5. Materiales

Mismo problema que en 2D: no se pueden usar variables CSS. Se leen una vez de `palette.ts` de la
base 2D —que ya lo resuelve— y se construyen materiales cacheados.

`MeshBasicMaterial` y `MeshLambertMaterial` por defecto. `MeshStandardMaterial` sólo donde el PBR
aporte algo: es notablemente más caro y en geometría plana de colores planos no se nota.

### 6. Raycast: cuándo hace falta BVH y cuándo no

Es una decisión por juego, no una regla general.

**No hace falta** cuando el objetivo del raycast es un puñado de volúmenes simples. En el shooter,
el disparo se resuelve contra **cápsulas de jugador** —diez como mucho— y contra la cobertura, que
son cajas instanciadas. Comprobar un rayo contra 40 AABB es más rápido que construir y consultar
un BVH, y no cuesta memoria.

**Sí hace falta** cuando hay que rayar contra una malla de miles de triángulos: geometría de nivel
detallada, terreno, o una escena importada.

```ts
// Sólo para mallas complejas.
mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);
raycaster.firstHitOnly = true;
```

Como los cuatro juegos 3D del catálogo generan su geometría con primitivas instanciadas, **hoy
ninguno necesita BVH**. Se deja en la base y en las dependencias porque el día que entre una malla
detallada, sin él el raycast pasa a costar milisegundos por disparo.

Regla práctica: si el objetivo son menos de ~100 volúmenes simples, lista de AABB. Si son miles de
triángulos, BVH.

### 7. LOD y degradación automática

```ts
export function usePerfGuard(opts: { target: 60; floor: 45 }) {
  // Mide fps promedio en ventanas de 2 s y baja calidad por escalones:
  // 1. postproceso off → 2. densidad de partículas ÷2 → 3. LOD más agresivo
  //    → 4. resolución ×0.8 → 5. sombras off (si estaban)
}
```

El contrato dice: **si no se llega, se baja calidad, no se baja el framerate**. Esto lo
implementa, y es lo que permite que el mismo juego corra en el proyector de la sala y en un
teléfono de gama media.

### 8. Audio posicional

`PositionalAudio` de Three para lo que pasa en el mundo (un disparo lejano se oye lejos) y Howler
para música y UI. Con un tope de voces simultáneas: 30 disparos a la vez saturan y suenan peor
que 8.

---

## Qué NO tocar

- **La decisión de geometría desde cero** de los prompts existentes. Sin assets externos.
- La regla de oro: el juego no conoce el tour.
- El contrato de `GameComponentProps`.
- El tope de DPR: 2 en proyector, 1.5 en celular.

---

## Reglas

- Un draw call por tipo, no por objeto. Todo lo repetido va instanciado.
- Geometrías y materiales creados una vez y compartidos. Cero `new` en `useFrame`.
- Física con timestep fijo `1/60`.
- Sombras y postproceso apagados por defecto.
- Todo juego 3D declara su presupuesto: triángulos, draw calls, y qué baja primero si no llega.
- `r3f-perf` sólo bajo `import.meta.env.DEV`.
- Con `prefers-reduced-motion`: sin shake de cámara, sin motion blur, sin bob de caminata. El
  juego sigue jugable.
- Descarte explícito al desmontar: geometrías, materiales, texturas y el renderer. Una fuga en 3D
  es de las que tiran la pestaña.

---

## Criterios de aceptación

1. `npx tsc --noEmit` en verde.
2. **Escena de prueba**: 500 cajas instanciadas, 10 avatares y física activa a **60 fps** en
   desktop y **45+** en un celular de gama media.
3. La escena de prueba usa **menos de 20 draw calls** (verificable con `r3f-perf`).
4. Montar y desmontar el juego 20 veces **no crece la memoria** (DevTools → Memory).
5. Con la simulación cargada a propósito, el guardia de rendimiento **baja calidad** y el
   framerate se mantiene.
6. El raycast contra 40 AABB resuelve en menos de 0,1 ms; el helper de BVH existe y se
   verifica con una malla de prueba de 50.000 triángulos por debajo de 1 ms.
7. Los colores del juego coinciden con los tokens de marca de la app.
8. El bundle del juego 3D **no entra** en el chunk inicial: abrir el dashboard no descarga `three`.
9. Cero errores de consola y cero warnings de Three sobre geometrías no descartadas.

---

## Decisión a registrar

```json
{
  "id": "games-3d-base-r3f",
  "status": "accepted",
  "decision": "3D games share a base in src/games/_engine3d/ built on three, @react-three/fiber, drei, @react-three/rapier and three-mesh-bvh: a preconfigured Stage with capped DPR, fixed-timestep physics inside useFrame, instancing helpers, shared procedural geometry and cached materials, raycast helpers (AABB lists for simple volumes, BVH only for complex meshes), positional audio and an automatic quality-degradation guard. Shadows and postprocessing are off by default.",
  "reason": "The project had no 3D at all, and the four 3D games are the most expensive of the twenty-four, so the cost of getting the canvas, the loop, instancing and disposal right should be paid once. The existing shooter prompt already chose procedurally generated geometry over external assets, which avoids an entire modelling and loading pipeline.",
  "consequence": "Physics runs at a fixed 1/60 like the 2D base, which is what lets arena topologies agree on state. Instancing is mandatory for repeated objects because draw calls, not triangles, are the limit here. The perf guard implements the contract's rule that quality drops before framerate does, which is what lets the same game run on the room projector and on a mid-range phone. three is lazily imported per game, so opening the dashboard never downloads it."
}
```
