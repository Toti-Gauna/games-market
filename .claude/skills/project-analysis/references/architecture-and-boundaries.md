# Architecture and Boundaries

Consultá esta referencia cuando el análisis sea de arquitectura general, organización del repo o límites entre capas.

## Qué revisar

### 1. Estructura de carpetas

Evaluá si el repo:

- permite encontrar rápido cada responsabilidad;
- distingue razonablemente entre UI, dominio, datos, utilidades y configuración;
- crece sin concentrar demasiada lógica en carpetas genéricas;
- evita duplicar soluciones por feature.

Preguntas guía:

- ¿La estructura ayuda a entender el producto?
- ¿Las carpetas reflejan responsabilidades o solo tipos técnicos?
- ¿Hay zonas "catch-all" donde se acumula de todo?
- ¿El repo tiene patrones claros o múltiples estilos coexistiendo?

### 2. Límites entre capas

Revisá si existe una separación entendible entre:

- componentes;
- screens/pages;
- hooks;
- contexts/stores;
- services/clients;
- utils/helpers;
- types/contracts.

Señales positivas:

- cada capa cumple una función clara;
- la UI no sabe demasiado de infraestructura;
- los services no contienen reglas de render;
- los hooks no mezclan demasiadas features;
- los contextos no se convierten en "god objects".

Señales de alerta:

- componentes que llaman fetches de forma inconsistente;
- services usados como helpers genéricos;
- contextos que concentran lógica de medio producto;
- UI mezclada con reglas de negocio o serialización compleja.

### 3. Acoplamiento

Detectá:

- módulos que conocen demasiado de otros módulos;
- utilidades o hooks globales usados para flujos muy específicos;
- componentes con demasiadas props porque dependen de múltiples dominios;
- tipos compartidos que arrastran detalles de features no relacionadas.

Preguntas guía:

- ¿Qué piezas se romperían juntas si cambia una regla?
- ¿Qué parte es difícil de mover o reutilizar?
- ¿Dónde hay dependencias implícitas?

### 4. Consistencia arquitectónica

Compará flujos similares:

- alta/baja/edición;
- aprobación/rechazo;
- modales;
- tablas;
- formularios;
- llamadas backend.

Buscá:

- naming consistente;
- manejo de loading/error común;
- patrones repetidos;
- endpoints o clients usados de forma homogénea.

### 5. Escalabilidad del código

Identificá qué zonas podrían crecer mal si se agregan nuevas features:

- archivos centrales que ya están grandes;
- hooks con múltiples responsabilidades;
- componentes que absorben subflujos;
- providers demasiado amplios;
- services que empiezan a parecer orquestadores.

## Cómo reportarlo

Para cada problema de arquitectura, explicá:

1. **Dónde está.**
2. **Qué responsabilidad se mezcla o se difumina.**
3. **Qué riesgo genera.**
4. **Qué mejora concreta proponés.**
5. **Qué no tocarías todavía**, si el costo de cambio supera el beneficio.
