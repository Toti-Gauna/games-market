---
name: reward-economy-security
description: "Diseña rewards, scoring, claims, cooldowns, rankings y anti-abuse para juegos con premios, puntos, gigas, inventario o valor real. Usala SIEMPRE que el resultado del juego tenga valor fuera del juego."
---

## Propósito

En cuanto un juego entrega algo con valor real —gigas, cupones, puntos canjeables, un lugar en un ranking— deja de ser un juego y pasa a ser un sistema con dinero adentro. Esta skill define cómo se diseña para que no se pueda romper desde la consola del navegador.

## Cuándo usarla

**Siempre** que exista alguno de estos: puntos canjeables, premios, gigas, ranking competitivo, streaks, inventario, claims, cooldowns, sorteos, cupones.

Ante la duda, usala.

## La regla fundacional

> **El cliente reporta intención; el servidor decide el resultado.**

Todo lo que llegue del cliente es una afirmación no verificada. `POST /score { "score": 999999 }` es la primera cosa que va a intentar cualquiera que abra las devtools.

## Los tres modelos

Elegí el más barato que resista el valor en juego.

### 1. Sin valor real — score local

Nada que proteger. `localStorage`, y listo. Un récord local inflado no le hace daño a nadie.

### 2. Valor bajo — score firmado y validado por reglas

El servidor no simula la partida, pero verifica que el resultado sea **posible**:

- cota superior de score por duración de partida;
- duración mínima plausible (un score alto en 2 segundos es imposible);
- ritmo de eventos coherente;
- un token de sesión de partida emitido por el servidor al empezar, obligatorio al cerrar;
- ventana de tiempo: la partida se cierra dentro de X minutos de abierta.

```txt
POST /game/session        -> { sessionId, seed, startedAt }   (servidor)
... el jugador juega ...
POST /game/session/:id/end { score, events }                  (cliente)
   -> el servidor valida contra startedAt, seed y las cotas
```

El `seed` que da el servidor sirve doble: hace la partida reproducible y permite revalidarla si hace falta.

### 3. Valor real — simulación o autoridad de servidor

Para premios canjeables por dinero, el servidor tiene que poder **recomputar** el resultado a partir del log de inputs, o directamente correr la lógica crítica del lado del servidor.

Es caro; usalo sólo cuando el valor lo justifique.

## Claims: idempotencia y transacción

Un claim es la operación más delicada del sistema.

```txt
POST /rewards/claim
Idempotency-Key: <uuid del cliente>
```

Reglas:

- **Idempotente.** Doble click, reintento por red o pestaña duplicada no pueden entregar dos premios. La clave de idempotencia se guarda y se responde lo mismo.
- **Transaccional.** Descontar stock, marcar el claim y acreditar al usuario ocurren en una sola transacción, o no ocurre nada.
- **Con verificación de stock dentro de la transacción**, no antes: entre el chequeo y la escritura hay una carrera.
- **Auditado.** Cada claim deja registro: usuario, premio, timestamp, sessionId, IP. Sin log no hay forma de investigar un abuso.

## Cooldowns y límites

Todos calculados y guardados **en el servidor**, con su reloj:

- intentos por día / por hora;
- tiempo mínimo entre partidas;
- máximo de premios por usuario y por período;
- stock global del premio.

Nunca uses `Date.now()` del cliente para nada que limite. El reloj del dispositivo se cambia en dos toques.

## Rankings

- El ranking se arma con scores ya validados, nunca con lo que reporta el cliente.
- Guardá el `sessionId` junto al score para poder invalidar después.
- Un score sospechoso se marca, no se borra: borrarlo esconde la evidencia.
- Paginado y cacheado: el top se consulta mucho más de lo que se escribe.
- Definí desempate (el primero en llegar al score, normalmente) o vas a tener empates arbitrarios.

## Señales de abuso a monitorear

- Score en el percentil altísimo con duración mínima.
- Muchas partidas por unidad de tiempo desde la misma cuenta o IP.
- Claims desde múltiples cuentas con el mismo dispositivo.
- Sesiones abiertas y cerradas sin eventos intermedios.
- Distribución de scores con un salto: los tramposos no se distribuyen como los jugadores.

## Lo que nunca va en el cliente

- La tabla de premios y sus probabilidades.
- El cálculo del reward.
- El estado del cooldown.
- Las cotas de validación (si el cliente las conoce, el atacante sabe qué score pedir).
- Cualquier clave o secreto.

## Legal y comunicación

- Si hay sorteo o premio, revisá si aplica normativa local: bases y condiciones, edad mínima, alcance geográfico.
- Mostrá claramente qué se gana, cuántos intentos quedan y cuándo se renuevan.
- Un premio agotado se comunica antes de jugar, no después de ganar.

## Salida esperada

- Modelo elegido (1, 2 o 3) y por qué.
- Contrato de endpoints de sesión y claim.
- Lista de validaciones del servidor.
- Reglas de cooldown y límites, con dónde se guardan.
- Qué se audita.
