# Technical Debt and Risk Signals

Consultá esta referencia cuando necesites detectar deuda técnica, fragilidad o riesgo de evolución.

## Señales de deuda técnica

### A. Duplicación con variantes pequeñas

- lógica repetida en dos flujos;
- componentes casi iguales con nombres distintos;
- validaciones duplicadas;
- payloads construidos manualmente en varios lugares.

Impacto:
- aumenta retrabajo;
- provoca bugs asimétricos;
- dificulta extender funcionalidades.

### B. Archivos "centro de gravedad"

- hooks enormes;
- providers demasiado amplios;
- modales que concentran subfeatures;
- services que orquestan demasiados casos.

Impacto:
- más conflictos;
- más dificultad de onboarding;
- mayor costo de cambio.

### C. Estado difícil de rastrear

- múltiples fuentes de verdad;
- estado que se copia y se transforma varias veces;
- resets dispersos;
- efectos que dependen de demasiadas variables.

Impacto:
- bugs intermitentes;
- renderizados innecesarios;
- refactors inseguros.

### D. Contratos implícitos

- campos "mágicos";
- strings sin tipos o enums;
- payloads asumidos;
- backend no confirmado pero codificado como hecho.

Impacto:
- rompe integraciones;
- genera retrabajo con BE;
- debilita la confianza del flujo.

### E. Abstracciones prematuras

- utilidades demasiado genéricas;
- componentes muy configurables sin consumidores reales;
- capas extra que no simplifican;
- patrones copiados por moda.

Impacto:
- sobreingeniería;
- más tokens/tiempo para humanos e IA;
- curva de entrada mayor.

### F. Falta de límites claros

- UI que conoce reglas de negocio;
- service que transforma para render;
- helper que muta estado;
- contextos que mezclan dominios.

Impacto:
- acoplamiento;
- baja reutilización;
- testing más difícil.

## Señales de fortalezas

También detectá lo que está bien:

- patrón de integración consistente;
- componentes reutilizables bien aislados;
- naming claro;
- manejo homogéneo de loading/error;
- folders por dominio coherentes;
- APIs internas previsibles.

## Cómo priorizar deuda

Una deuda merece prioridad alta si:

- se toca seguido;
- provoca bugs;
- impide nuevas features;
- multiplica el costo de cambios futuros.

Una deuda puede esperar si:

- está localizada;
- rara vez se modifica;
- no afecta claridad ni estabilidad;
- corregirla tiene costo alto sin beneficio cercano.
