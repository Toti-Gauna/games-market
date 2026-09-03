# Backend Handoff

Usá este bloque cuando una implementación frontend detecte que necesita un cambio backend real, un contrato nuevo o una confirmación técnica antes de poder quedar completa.

## Objetivo

Generar un mensaje claro, accionable y reutilizable para el equipo backend, explicando:

- qué feature se está implementando en frontend;
- qué dependencia backend apareció;
- qué cambio concreto se necesita;
- qué contrato debe validarse;
- qué quedará pendiente del lado frontend hasta que backend lo resuelva.

## Regla

No presentes como existente lo que todavía es una propuesta.

Si el frontend necesita un endpoint nuevo, un campo adicional, un permiso, un cambio de payload o persistencia nueva:

- formulalo como **requerimiento backend a validar**;
- explicá por qué es necesario;
- dejá claro qué parte del frontend depende de esa definición.

## Formato de salida obligatorio

````md
### Mensaje para Backend

**Contexto de la feature**

- Flujo o pantalla involucrada:
- Acción que está intentando resolver frontend:
- Comportamiento esperado para el usuario:

**Qué ya quedó preparado en frontend**

- [Componente, UI, estado local, integración parcial o validación ya implementada.]
- [Qué parte funciona hoy sin backend adicional.]

**Dependencia backend detectada**

- [Qué no puede completarse correctamente solo desde frontend.]
- [Por qué hace falta backend para cerrar la solución.]

**Cambio requerido en backend**

- Tipo de cambio:
  - [ ] endpoint nuevo
  - [ ] ajuste de endpoint existente
  - [ ] nuevo campo en request
  - [ ] nuevo campo en response
  - [ ] persistencia
  - [ ] permiso / autorización
  - [ ] validación de servidor
  - [ ] procesamiento de archivos
  - [ ] otro: ...
- Descripción concreta del cambio requerido:
  - ...

**Propuesta de contrato a validar**

- Método:
- Ruta o flujo sugerido:
- Request / payload esperado:
  ```json
  {
    "..."
  }
  ```
````
