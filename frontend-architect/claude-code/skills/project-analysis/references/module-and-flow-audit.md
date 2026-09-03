# Module and Flow Audit

Consultá esta referencia cuando el usuario pida analizar un módulo, feature, screen, modal, carpeta o flujo puntual.

## Qué entender primero

Antes de criticar, reconstruí:

- objetivo del flujo;
- usuarios/roles involucrados;
- inputs y outputs;
- puntos de decisión;
- piezas del repo que intervienen.

## Qué revisar

### 1. Flujo funcional

Preguntas guía:

- ¿La secuencia de pasos se entiende?
- ¿Dónde se decide qué acción ocurre?
- ¿Hay ramas duplicadas para casos parecidos?
- ¿El flujo depende de flags dispersos?

### 2. Distribución de responsabilidades

Revisá si cada archivo cumple una responsabilidad razonable.

Señales de alerta:

- un modal que renderiza, valida, transforma, persiste y decide flujos;
- hooks que mezclan chat, approvals, filtros y uploads;
- services que alteran datos para satisfacer detalles de UI;
- componentes con mucha lógica de permisos.

### 3. UI del flujo

Observá:

- componentes reutilizables vs específicos;
- exceso de JSX inline;
- bloques repetibles que podrían extraerse;
- estados empty/loading/error;
- responsive si el cambio de layout importa.

### 4. Estado y sincronización

Evaluá:

- fuente de verdad principal;
- duplicación de estado;
- resets manuales;
- estados derivados guardados innecesariamente;
- side effects difíciles de seguir.

### 5. Integración con datos

Detectá:

- services/hooks/contextos tocados;
- contratos implícitos;
- persistencia real vs staging local;
- dependencias backend pendientes;
- si el flujo usa el patrón real del repo.

### 6. Riesgo de modificación

Preguntate:

- ¿Qué tan caro es cambiar este flujo?
- ¿Qué errores son más probables?
- ¿Hay tests o checks naturales que lo protejan?
- ¿Hay lugares donde un dev puede romper algo sin notarlo?

## Formato sugerido de hallazgo

```md
### Hallazgo: [nombre corto]

- Evidencia:
- Impacto:
- Riesgo:
- Mejora sugerida:
- Prioridad: Alta / Media / Baja
```

## Cuándo sugerir otras skills

- `ui-component-architecture`: si la mejora principal es separar o rediseñar UI.
- `frontend-data-integration`: si el problema central es contrato, persistencia o backend.
- `vertical-slice-planning`: si el refactor conviene dividirlo en entregas.
