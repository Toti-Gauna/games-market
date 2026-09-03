# Pattern Detection

Usá esta referencia para identificar cómo integra datos el proyecto antes de implementar.

## Señales a revisar

Buscá carpetas, archivos o convenciones como:

- `services/`
- `api/`
- `clients/`
- `handlers/`
- `repositories/`
- `hooks/`
- `lib/http`
- `utils/fetch`
- `pages/api`
- `app/api`

También revisá:

- uso de `fetch`, `axios`, `ky`, SDKs o clientes propios;
- helpers de auth/token;
- shape de errores;
- tipado de request/response;
- si la UI llama directo a un client o pasa por hooks/services.

## Resultado esperado

Antes de tocar código, identificá:

1. Capa consumidora:
   - UI;
   - hook;
   - feature.
2. Capa de integración:
   - service;
   - API client;
   - repository;
   - handler;
   - route API;
   - SDK.
3. Backend o fuente remota.
4. Patrón que debe respetarse.

No impongas una arquitectura externa si el repo ya tiene una convención clara.
