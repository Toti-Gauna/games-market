# Prioritization and Roadmap

Consultá esta referencia cuando el usuario pida ordenar mejoras, elegir qué refactor hacer primero o convertir un diagnóstico en plan de acción.

## Marco de priorización

Evaluá cada mejora según cuatro dimensiones:

1. **Impacto técnico**
   - reduce bugs;
   - reduce acoplamiento;
   - mejora mantenibilidad;
   - habilita evolución.

2. **Esfuerzo**
   - bajo;
   - medio;
   - alto.

3. **Urgencia**
   - bloquea trabajo actual;
   - duele con frecuencia;
   - puede esperar.

4. **Riesgo de ejecución**
   - probabilidad de romper comportamiento;
   - dependencia de backend;
   - necesidad de coordinación.

## Matriz práctica

| Tipo de mejora | Qué hacer |
|---|---|
| Alto impacto + bajo esfuerzo | Priorizar de inmediato |
| Alto impacto + alto esfuerzo | Planificar en slices |
| Bajo impacto + bajo esfuerzo | Hacer si ayuda al flujo |
| Bajo impacto + alto esfuerzo | Postergar |

## Formato de roadmap recomendado

```md
## Orden recomendado de mejora

### Fase 1 — Quick wins seguros
- Mejora:
- Motivo:
- Riesgo:
- Resultado esperado:

### Fase 2 — Refactors de impacto
- Mejora:
- Motivo:
- Dependencias:
- Resultado esperado:

### Fase 3 — Evolución estructural
- Mejora:
- Motivo:
- Costo:
- Resultado esperado:
```

## Cuándo sugerir vertical slicing

Sugerí `vertical-slice-planning` si:

- una mejora toca varias capas;
- hay refactor funcional + UI + datos;
- conviene entregar valor parcial sin mezclar todo;
- el cambio puede partirse en incrementos verificables.

## Qué evitar

- No propongas 15 mejoras sin orden.
- No conviertas todo en prioridad alta.
- No armes roadmaps de meses si el usuario solo pidió detectar problemas.
- No uses "modernizar" como justificación vacía.
