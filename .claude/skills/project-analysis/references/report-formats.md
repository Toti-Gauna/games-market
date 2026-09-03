# Report Formats

Consultá esta referencia cuando necesites elegir una salida clara y útil para el usuario.

## Formato A — Auditoría general del proyecto

```md
# Análisis del proyecto

## Diagnóstico general
- Estado actual:
- Fortalezas:
- Riesgos principales:

## Hallazgos priorizados

### Alta prioridad
1. ...
   - Evidencia:
   - Impacto:
   - Mejora sugerida:

### Media prioridad
1. ...
   - Evidencia:
   - Impacto:
   - Mejora sugerida:

### Baja prioridad
1. ...
   - Evidencia:
   - Impacto:
   - Mejora sugerida:

## Oportunidades estratégicas
- ...

## Qué no tocaría todavía
- ...

## Orden recomendado de mejora
1. ...
2. ...
3. ...

## Skills o análisis complementarios que aplicarían
- ...
```

## Formato B — Análisis de módulo o feature

```md
# Análisis de [módulo / feature]

## Qué entendí del flujo
- ...

## Qué está bien resuelto
- ...

## Problemas detectados
1. ...
   - Evidencia:
   - Riesgo:
   - Mejora:

## Oportunidades de refactor
- ...

## Priorización
1. Corto plazo:
2. Mediano plazo:
3. Más adelante:

## Próximo paso recomendado
- ...
```

## Formato C — Auditoría rápida orientada a mejoras

```md
# Mejoras sugeridas

| Mejora | Impacto | Esfuerzo | Prioridad | Motivo |
|---|---:|---:|---:|---|
| ... | Alto/Medio/Bajo | Alto/Medio/Bajo | Alta/Media/Baja | ... |

## Top 3 mejoras recomendadas
1. ...
2. ...
3. ...
```

## Formato D — Diagnóstico ejecutivo para presentación

```md
# Diagnóstico ejecutivo

## Resumen
- ...

## 3 fortalezas
1. ...
2. ...
3. ...

## 3 riesgos
1. ...
2. ...
3. ...

## Recomendación principal
- ...

## Próximos pasos
1. ...
2. ...
3. ...
```

## Regla de elección

- Proyecto completo → Formato A.
- Módulo o flujo → Formato B.
- El usuario quiere foco en acciones → Formato C.
- El usuario va a comunicar a terceros → Formato D.
