---
name: asset-style-prompts
description: "Crea prompts y specs de assets para sprites, fondos, personajes, UI kits, iconografía, Lottie y audio, con estilo visual consistente. Usala cuando haga falta generar o encargar arte para un juego."
---

## Propósito

Producir arte **consistente y usable**, no una colección de imágenes lindas que no encajan entre sí ni entran en el juego.

El problema típico no es la calidad de cada asset: es que cada uno tiene otra paleta, otro grosor de línea, otra perspectiva y otro tamaño.

## Cuándo usarla

- Hay que generar o encargar sprites, fondos, personajes, iconos, UI o audio.
- El juego ya tiene loop y arte de placeholder que hay que reemplazar.
- Hay que definir la dirección visual antes de producir.

## Primero la guía de estilo, después los assets

Ningún prompt individual sirve sin esto. Definí y **fijá por escrito**:

```txt
ESTILO:        pixel art 32x32 / vectorial flat / cartoon con contorno / low poly
PALETA:        6-8 colores con sus hex, más 2 de acento
PERSPECTIVA:   frontal / top-down / isométrica / side-scroll
LÍNEA:         sin contorno / contorno 2px oscuro / contorno de color
SOMBRA:        sin sombra / sombra plana en un tono / degradé suave
ILUMINACIÓN:   desde arriba / desde arriba-izquierda
FONDO:         transparente (siempre, para sprites)
GRILLA:        múltiplo base (16, 32, 64 px)
```

Esa guía se copia **completa** en cada prompt. Es lo único que hace que veinte assets generados por separado parezcan del mismo juego.

## Plantilla de prompt para sprites

```txt
[SUJETO], [acción o pose], para videojuego 2D.

Estilo: [ESTILO de la guía]
Paleta: [los hex exactos]
Perspectiva: [PERSPECTIVA]
Línea: [LÍNEA]
Sombra: [SOMBRA]

Fondo transparente. Sprite centrado, ocupando el 80% del lienzo.
Sin texto, sin marca de agua, sin borde de imagen.
Tamaño: [N]x[N] px.

Negativo: fotorrealismo, degradés complejos, múltiples fuentes de luz,
fondo con escenario, sombra proyectada sobre el suelo, recorte parcial.
```

Los negativos importan tanto como el prompt: "sombra proyectada" y "fondo con escenario" son los dos que más arruinan un sprite que después hay que recortar.

## Por tipo de asset

### Personajes y enemigos
Pedí el **set completo en una sola tanda**: idle, caminar, acción, daño, muerte. Generados por separado nunca coinciden en volumen ni en paleta. Especificá cuántos frames por animación.

### Fondos
Definí si es una capa o si hay parallax (y cuántas). Cada capa se pide por separado, con transparencia salvo la del fondo. Especificá que tiene que ser **tileable horizontalmente** si hay scroll.

### Tiles y plataformas
Pedí un tileset con las piezas: centro, bordes, esquinas interiores y exteriores. Un tile suelto no sirve para construir un nivel.

### UI kit
Botón (normal, hover, presionado, deshabilitado), panel, barra de progreso, marco de icono, badge. Todo en la misma tanda y con el mismo radio de esquina.

### Iconos
Grilla fija, mismo peso de trazo, mismo padding óptico. Pedilos en una sola imagen de contacto y recortá.

### Lottie
No se generan con prompt: se encargan a diseño con una referencia. Lo que sí definís es la spec: duración, si loopea, en qué momento del juego dispara, y peso máximo del `.json`.

## Audio

```txt
SFX: [acción], estilo [8-bit / orgánico / UI limpio],
duración [0.1-0.4]s, sin cola de reverb, mono, normalizado a -3 dBFS.
```

- El set mínimo: click, acierto, error, subir de nivel, game over.
- Música: loop perfecto (el final tiene que empalmar con el principio), no más de 60-90 s, y con una versión más suave para el menú.
- Todo en dos formatos: `.ogg` + `.m4a`. Safari no reproduce ogg.
- Volumen relativo definido: los SFX no pueden tapar la música ni al revés.

## Especificación técnica de entrega

Cerrá siempre con esto, o vas a recibir PNGs de 4000 px:

```txt
FORMATO:   PNG-24 con alpha (sprites) / JPG (fondos sin transparencia)
TAMAÑOS:   1x y 2x
NOMBRES:   kebab-case, prefijo por categoría (chr-, env-, ui-, fx-)
ATLAS:     todos los sprites en un spritesheet + su JSON
PESO:      < 200 KB por asset después de comprimir
LICENCIA:  confirmada y compatible con uso comercial
```

## Checklist antes de integrar

- [ ] Todos los assets comparten paleta, línea y perspectiva.
- [ ] Fondos transparentes reales, sin halo blanco en los bordes.
- [ ] Sprites alineados a la grilla base.
- [ ] Empaquetados en atlas.
- [ ] Comprimidos (`pngquant`, `oxipng`, o el equivalente).
- [ ] Licencia verificada y anotada.
- [ ] Se ven bien al tamaño real de juego, no sólo al 400 %.
