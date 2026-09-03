import { lazy, Suspense } from "react";
import type { GameProps } from "@/core/contract/game";

/**
 * C5 · Prioridades
 *
 * Se ordenan ocho tarjetas por importancia. El valor no esta en jugarlo sino en
 * lo que aparece despues en la pantalla grande: el consenso del equipo y, sobre
 * todo, en que no se ponen de acuerdo. Un ranking promedio es un dato tibio;
 * el desacuerdo es informacion de verdad.
 *
 * **El mismo componente sirve las dos puntas**, y quien es cual lo decide el
 * contenedor con `config.isHost`, no una regla no escrita sobre el asiento:
 *
 * - `isHost` = el proyector. Es el host autoritativo, no juega: junta ordenes
 *   y agrega.
 * - Cualquier otro aparato = un telefono. Corre el juego entero con su propia
 *   pantalla, ordena y manda un solo mensaje.
 *
 * **El celular corre el juego, no hace de mando** (`phoneRole: "player"`).
 * Ordenar ocho tarjetas pide arrastre por asa, botones de subir y bajar,
 * teclado y una region viva que anuncie cada movimiento: nada de eso se puede
 * expresar con un `ControlSpec`, y con el layout `pad` cada movimiento seria un
 * viaje de ida y vuelta a la sala, con la latencia metida justo en el medio de
 * una lista que se arrastra. Ademas el flujo del telefono tiene aviso de
 * anonimato, confirmacion, espera con contador y resultado propio, y un mando
 * no sabe dibujar nada de eso.
 *
 * Las dos mitades se cargan por separado: un telefono no baja el proyector y el
 * proyector no baja el telefono.
 */

const PriorityProjector = lazy(() => import("./PriorityProjector"));
const PriorityPhone = lazy(() => import("./PriorityPhone"));

export default function PrioridadesGame(props: GameProps) {
  return (
    <Suspense fallback={<Loading />}>
      {props.config.isHost ? <PriorityProjector {...props} /> : <PriorityPhone {...props} />}
    </Suspense>
  );
}

function Loading() {
  return <div className="grid h-full place-items-center text-xs text-sn-dim">Cargando…</div>;
}
