---
name: storybook-transformation
description: "Prepará componentes, screens o estados visuales para migrarlos al design system documentado en Storybook. Usá esta skill cuando el equipo quiera trasladar UI existente, desacoplarla de lógica de pantalla, definir variantes, estados y stories, o convertir una pieza del producto en una unidad reutilizable para el entorno Storybook correspondiente."
---

# Storybook Transformation

## Propósito

Ayudar a transformar UI del producto en piezas reutilizables y trasladables al design system documentado en Storybook.

## Aclaración importante

No asumas que Storybook está instalado localmente en el repositorio actual.  
Primero determiná si:

1. el repo actual tiene infraestructura de stories;
2. la migración se hará hacia otro repo/design system;
3. conviene preparar un artefacto transferible, un plan de migración o stories listas para incorporar donde corresponda.

## Cuándo usarla

- El usuario quiere “llevar” un componente o screen al Storybook/design system.
- Una pieza de UI puede volverse reutilizable.
- Hace falta definir variantes y estados visuales.
- Se quiere documentar un componente para revisión de diseño/QA.

## Proceso

1. Identificá qué parte de la UI es realmente reusable.
2. Separá dependencias de routing, fetch, contexto de página y lógica innecesaria.
3. Definí API de props y variantes razonables.
4. Enumerá estados valiosos:
   - default;
   - loading si corresponde;
   - empty;
   - error;
   - disabled o read-only si aplica;
   - variantes visuales reales.
5. Prepará una de estas salidas según el repo:
   - story lista para incorporar;
   - componente refactorizado más story sugerida;
   - plan de migración hacia el repo del design system.

## No hacer

- No migres una pantalla entera a Storybook si no tiene sentido como unidad aislada.
- No inventes infraestructura de Storybook local si el repo no la tiene y el pedido no lo exige.
- No fuerces stories sin valor.

## Formato de cierre

```md
### Resultado Storybook
- Pieza reutilizable detectada:
- Desacoples realizados o necesarios:
- Estados/variantes sugeridos:
- Destino recomendado: repo actual / design system externo / plan de migración
```
