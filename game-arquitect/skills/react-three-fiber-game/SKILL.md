---
name: react-three-fiber-game
description: "Diseña e implementa juegos o prototipos 3D web con React Three Fiber, Drei, Three.js, assets glTF, cámaras, iluminación y presupuesto de performance. Usala para cualquier gameplay 3D en el navegador que no sea VR."
---

## Propósito

Construir 3D web sin que el proyecto se convierta en una demo que sólo corre en la máquina del que la hizo. El 90 % del trabajo de un juego 3D web es **presupuesto**: polígonos, texturas, draw calls y luces.

## Cuándo usarla

- Juegos o prototipos 3D en el navegador.
- Escenas interactivas con cámara, modelos glTF e iluminación.
- Configuradores, visualizaciones jugables, experiencias de producto.

## Cuándo no usarla

- VR/WebXR: `vr-webxr-game` (se apoya en esta, pero cambia todo lo de confort e input).
- Un juego 2D con perspectiva falsa: sale más barato en 2D.
- Native: `native-game-motion`.

## Stack

- `three` + `@react-three/fiber` — base.
- `@react-three/drei` — helpers (cámaras, controles, loaders, texto, `useGLTF`).
- `@react-three/rapier` — físicas, sólo si hacen falta.
- `leva` — panel de tuning en desarrollo, fuera del build de producción.

No agregues postprocessing hasta que el juego corra bien sin él.

## Reglas de React Three Fiber

### El estado caliente no vive en React

```tsx
// mal: 60 renders por segundo
const [y, setY] = useState(0);
useFrame((_, delta) => setY((v) => v + delta));

// bien: se muta la ref directamente
const ref = useRef<THREE.Mesh>(null);
useFrame((_, delta) => {
  if (ref.current) ref.current.position.y += delta;
});
```

Esta es la regla número uno. Casi todos los problemas de performance en R3F son estado de gameplay en `useState`.

### No crear objetos en `useFrame`

`new THREE.Vector3()` dentro del frame es basura para el GC 60 veces por segundo. Declaralos afuera y reusalos:

```tsx
const tmp = useMemo(() => new THREE.Vector3(), []);
```

### Geometrías y materiales se comparten

Cien cubos con cien materiales son cien draw calls. Cien cubos con **un** material compartido son uno. Para muchas instancias iguales, `<Instances>` de drei o `InstancedMesh`.

### Suspense y carga

```tsx
<Suspense fallback={<Loader />}>
  <Model />
</Suspense>
```

`useGLTF.preload(url)` fuera del componente para que la carga arranque antes del montaje.

## Presupuesto por defecto

Objetivo: 60 fps en un notebook integrado y 30 fps sostenidos en móvil.

| Recurso | Móvil | Escritorio |
|---|---|---|
| Triángulos en pantalla | < 150 k | < 500 k |
| Draw calls | < 100 | < 300 |
| Texturas | 1024², comprimidas | 2048² |
| Luces con sombra | 1 | 1-2 |
| `dpr` | `[1, 1.5]` | `[1, 2]` |

```tsx
<Canvas dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }}>
```

## Iluminación

- Empezá con `<Environment preset="city" />` de drei: resuelve el 80 % del look con un solo componente.
- Una sola luz direccional con sombra. Las sombras son lo más caro de la escena.
- `shadow-mapSize` en 1024 y ajustá el frustum de la sombra al área que realmente la necesita: una sombra que cubre todo el mundo se ve pixelada aunque tenga 4096.
- Bakeá lo que no cambia.

## Assets glTF

- Pasá todo por `gltf-transform` o `gltfjsx`: comprime, deduplica y genera el componente tipado.
- Draco o Meshopt para la geometría; KTX2 para las texturas.
- Un modelo de 40 MB no es un modelo: es un error de exportación.
- Verificá la escala al importar (Blender exporta en metros; muchos assets vienen en centímetros).

## Cámara

- Elegí el tipo de cámara según el juego, no por costumbre: tercera persona, orbital, fija o cenital cambian el diseño completo.
- La cámara sigue al jugador con interpolación (`lerp`), nunca pegada: una cámara rígida marea.
- Fijá `near` y `far` lo más ajustados posible; un `far` de 10000 destruye la precisión del z-buffer.

## Físicas

Con `@react-three/rapier`:

- Colliders simples (box, capsule, sphere) para todo lo que se mueva.
- Trimesh sólo para geometría estática.
- Un personaje se mueve con un `KinematicCharacterController`, no empujando un rigidbody dinámico.

## No hacer

- No pongas `<OrbitControls>` en un juego con control de personaje: pelean por el mouse.
- No animes la cámara con GSAP y con `useFrame` a la vez.
- No cargues todos los modelos en el montaje inicial si hay niveles.
- No uses postprocessing pesado (SSAO, bloom en cadena) sin medir el costo en móvil.

## Salida esperada

- Escena, entidades y HUD separados.
- Estado de gameplay fuera de React.
- Presupuesto declarado y medido con el panel de stats.
- Limpieza de listeners y de la escena al desmontar.
