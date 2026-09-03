---
name: web-game-engine
description: "Elige e integra Phaser o PixiJS para juegos web 2D con escenas, sprites, loader, animaciones, cámara, score, timer o físicas simples. Usala cuando el juego 2D supera lo que resuelve un canvas a mano."
---

## Propósito

Elegir el engine 2D correcto e integrarlo en un proyecto React/TypeScript sin que el engine y React se peleen por el DOM.

## Cuándo usarla

- Hay escenas o niveles múltiples.
- Hace falta un loader de assets con barra de progreso.
- Hay spritesheets, animaciones por frames o tilemaps.
- Hacen falta físicas (aunque sean simples: gravedad, colisiones con mundo).
- Hay cámara que sigue al jugador o mundo más grande que la pantalla.
- Hay decenas o cientos de sprites simultáneos.

## Cuándo no usarla

- Microjuego de una pantalla: `canvas-motion`.
- 3D: `react-three-fiber-game`.
- Native: `native-game-motion`.

## Phaser o PixiJS

| | Phaser | PixiJS |
|---|---|---|
| Qué es | Framework de juego completo | Renderer 2D |
| Trae | Escenas, físicas (Arcade/Matter), input, audio, tweens, tilemaps | Sólo render, muy rápido |
| Elegilo si | Querés un juego 2D "clásico" y no querés escribir infraestructura | Necesitás control total del loop, o es una experiencia visual más que un juego |
| Costo | Bundle grande, opiniones fuertes | Tenés que traer físicas, input y escenas vos |

**Por defecto: Phaser** para un juego 2D con reglas. **PixiJS** cuando lo que pesa es el render (miles de partículas, efectos, visualizaciones interactivas) y el "juego" es liviano.

No mezcles los dos.

## Integración con React

La regla es una sola: **React monta y desmonta el engine; el engine es dueño de su canvas.**

```tsx
const hostRef = useRef<HTMLDivElement>(null);
const gameRef = useRef<Phaser.Game | null>(null);

useEffect(() => {
  if (!hostRef.current || gameRef.current) return;
  gameRef.current = new Phaser.Game({
    type: Phaser.AUTO,
    parent: hostRef.current,
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, PlayScene],
  });
  return () => {
    gameRef.current?.destroy(true);
    gameRef.current = null;
  };
}, []);
```

Puntos que rompen si se ignoran:

- **`destroy(true)` en el cleanup.** Sin eso, en desarrollo con StrictMode quedan dos instancias corriendo y el juego va al doble de velocidad.
- **El guard `if (gameRef.current) return`.** StrictMode monta dos veces.
- **El engine no lee props de React.** Pasale datos por su registry o por eventos.
- **React no re-renderiza el contenedor del canvas.** Si el componente padre re-renderiza y recrea el div, el engine pierde su parent.

### Comunicación en los dos sentidos

```ts
// engine -> React
this.game.events.emit("score", value);

// React -> engine
gameRef.current?.events.emit("pause");
```

El HUD vive en React y escucha esos eventos. No dibujes el HUD dentro del engine salvo que tenga que estar en el mundo del juego.

## Escenas mínimas

1. **Boot** — configuración, escala, nada visual.
2. **Preload** — carga de assets con barra de progreso.
3. **Play** — el juego.
4. **GameOver** — resultado y reintentar.

Separar Preload de Play es lo que evita el flash de "juego sin texturas".

## Assets

- Empaquetá sprites en un atlas: 40 requests de PNG sueltos es la causa más común de un loader lento.
- Definí un tamaño base y escalá desde ahí. Mezclar escalas produce bordes borrosos.
- Para pixel art: `pixelArt: true` en la config y `setScale` con enteros.
- Audio en dos formatos (`.ogg` + `.m4a`) o vas a perder Safari.

## Físicas

- **Arcade** (Phaser) para todo lo que sea AABB, gravedad y overlaps. Es rápido y alcanza casi siempre.
- **Matter** sólo si hace falta rotación, articulaciones o rebotes realistas. Cuesta bastante más.
- Empezá con Arcade. Migrar después es más barato que arrancar con Matter sin necesitarlo.

## Performance

- Fijá un presupuesto: 60 fps en un móvil de gama media, no en tu máquina.
- Reusá objetos con un pool: crear y destruir sprites por frame es lo que produce los tirones.
- Cuidá la cantidad de draw calls: mismo atlas = mismo batch.
- Medí con el debug del engine antes de optimizar a ojo.

## Salida esperada

- Escenas separadas por archivo.
- Un solo punto de montaje React con su cleanup.
- Contrato de eventos engine/UI escrito.
- Config de escala que funcione en móvil vertical y en escritorio.
