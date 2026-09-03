# Frontend Follow-up After Backend

Usá este bloque cuando el frontend quede parcialmente preparado y la implementación completa dependa de que backend confirme o implemente un contrato.

## Objetivo

Dejar documentado con precisión:

- qué parte del frontend ya quedó lista;
- qué parte no debe cerrarse todavía;
- qué pasos exactos se ejecutarán cuando backend entregue el cambio;
- cómo se validará la integración final.

## Regla

No uses este bloque si la integración ya quedó completa en el mismo cambio.

Usalo solo cuando exista una dependencia backend pendiente que impida cerrar correctamente la feature frontend.

## Formato de salida obligatorio

```md
### Siguiente paso Frontend cuando Backend esté listo

**Estado actual del frontend**

- Qué quedó implementado:
  - ...
- Qué quedó preparado pero aún no conectado:
  - ...
- Qué comportamiento sigue siendo parcial o provisional:
  - ...

**Dependencia pendiente**

- Backend debe confirmar o entregar:
  - ...
- Contrato esperado a validar:
  - endpoint / payload / response / permisos / persistencia / archivos.

**Implementación frontend posterior**

1. Conectar la capa de integración correspondiente:
   - service / client / handler / repository / hook según el patrón del repo.

2. Incorporar el contrato backend confirmado:
   - request;
   - response;
   - tipos;
   - errores;
   - serialización;
   - manejo de archivos si aplica.

3. Vincular la UI ya preparada con la integración real:
   - evento o acción que dispara la llamada;
   - estado de loading;
   - success;
   - error;
   - limpieza/reset del estado local.

4. Ajustar el flujo funcional afectado:
   - persistencia visible;
   - actualización de detalle/listado;
   - permisos o restricciones;
   - mensajes al usuario.

5. Validar la integración completa:
   - caso feliz;
   - error del backend;
   - validaciones;
   - persistencia posterior al refresh;
   - comportamiento según rol;
   - edge cases relevantes.

**Archivos o zonas del frontend que probablemente deberán tocarse**

- ...
- ...
- ...

**Riesgos a revisar al conectar**

- ...
- ...

**Criterio de cierre frontend**

- La feature quedará cerrada cuando:
  - ...
```
