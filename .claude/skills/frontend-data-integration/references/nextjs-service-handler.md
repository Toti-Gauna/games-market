# Next.js Service + Handler Reference

Usá esta referencia solo si el repo realmente emplea una capa intermedia de Next.js.

## Patrón posible

```txt
UI / hook / feature
  |
service frontend
  |
handler o route API de Next.js
  |
backend
```

## Reglas

- Confirmá si el repo usa `pages/api`, `app/api` u otra forma de handler.
- Reutilizá handlers y services equivalentes antes de crear nuevos.
- Si el repo usa `basePath` en services frontend, respetalo.
- Si los handlers llaman directo al backend sin `basePath`, no lo introduzcas.
- Conservá auth, headers, serialización y manejo de errores según el patrón existente.
- No conviertas un handler en requisito si el repo no lo usa para ese flujo.

## Cuando falta backend

Si el handler/frontend puede prepararse pero el endpoint real no existe:

- no inventes el contrato como definitivo;
- documentá el endpoint sugerido solo como propuesta;
- derivá el pedido al bloque de `backend-handoff.md`.
