import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { ControlInput, ControlSpec } from "@/core/contract/control";
import { WAITING } from "@/core/contract/control";
import { useGameNet } from "@/core/net/useGameNet";
import { seatRejectionMessage } from "@/core/net/mockNet";
import { GamepadController } from "@/ui/control/GamepadController";

/**
 * El celular como control.
 *
 * La sala y el asiento salen de la URL, que es lo que hace determinista la
 * reconexion: si el telefono pierde red, recargar lo devuelve a su lugar sin
 * que nadie tenga que coordinar nada.
 *
 * Esta pantalla **no conoce ningun juego**: se conecta, escucha que le manda a
 * dibujar el host y le devuelve lo que toco la persona. Sirve igual para la
 * paleta de Pong y para los botones de la trivia.
 *
 * Vive fuera del shell: sin sidebar, sin scroll, sin nada que tocar de mas.
 * Un celular haciendo de mando no es una pagina web.
 */

/** Cuantos asientos ofrece una sala mientras no haya un juego que diga otra cosa. */
const DEFAULT_SEATS = 4;

export default function ControlPage() {
  const { sala } = useParams();
  const [searchParams] = useSearchParams();

  const roomId = sala ?? "sala";
  // Un `arena` corporativo admite una sala entera, no cuatro paletas.
  const seats = clampInt(searchParams.get("asientos"), 1, 200, DEFAULT_SEATS);
  // El numero de la URL es 1-based porque es el que ve una persona en pantalla.
  const seat = clampInt(searchParams.get("asiento"), 1, seats, 1) - 1;

  // El transporte viaja en el QR: el celular tiene que entrar por la misma red
  // que el proyector, y no hay forma de que lo adivine.
  const transport = searchParams.get("transporte") === "webrtc" ? "webrtc" : "local";

  const [spec, setSpec] = useState<ControlSpec>(WAITING);

  const net = useGameNet<ControlInput, unknown>({
    roomId,
    role: "client",
    seat,
    seats,
    transport,
  });

  const port = net.net;

  useEffect(() => {
    if (!port) return;
    return port.onControl(setSpec);
  }, [port]);

  const sendInput = useCallback(
    (input: ControlInput) => {
      port?.sendInput(input, nextSequence());
    },
    [port],
  );

  const status = useMemo(() => {
    if (net.rejection) return "Lugar ocupado";
    if (net.status === "live") return `${net.rttMs} ms`;
    if (net.status === "reconnecting") return "Reconectando…";
    if (net.status === "off") return "Sin conexión";
    return "Conectando…";
  }, [net.rejection, net.status, net.rttMs]);

  /*
   * Por que no conecta, cuando se sabe.
   *
   * Sin esto el telefono dice "Conectando..." para siempre y las tres causas
   * —el proyector no abrio el juego, hay dos proyectores en la misma sala, la
   * red no deja armar el camino directo— se ven exactamente igual. En una sala
   * con gente esperando, eso es la diferencia entre arreglarlo en diez
   * segundos y no saber por donde empezar.
   *
   * Solo mientras no este conectado: una vez adentro, el ultimo error de
   * reconexion ya no le importa a nadie.
   */
  const trouble = net.status === "live" ? null : net.transportError;

  if (net.rejection) {
    return (
      <div className="grid h-full place-items-center bg-sn-bg p-6 text-center">
        <div className="w-full max-w-xs">
          <h1 className="mb-2 text-lg">{seatRejectionMessage(net.rejection)}</h1>
          {net.rejection.freeSeats.length > 0 ? (
            <>
              <p className="mb-5 text-sm text-sn-muted">Elegí otro lugar:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {net.rejection.freeSeats.map((free) => (
                  <button
                    key={free}
                    type="button"
                    className="sn-btn sn-btn--primary h-12 min-w-24"
                    onClick={() => net.claimSeat(free)}
                  >
                    Jugador {free + 1}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-sn-muted">
              No quedan lugares libres. Esperá a que alguien se vaya.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="min-h-0 flex-1">
        <GamepadController
          spec={spec}
          seat={port?.seat ?? seat}
          onInput={sendInput}
          status={status}
          connected={net.status === "live"}
        />
      </div>
      {trouble && (
        <p
          className="shrink-0 border-t border-sn-line-soft bg-sn-bg-elev px-4 py-2 text-center text-xs text-sn-warn"
          aria-live="polite"
        >
          {trouble}
        </p>
      )}
    </div>
  );
}

/* La secuencia es del aparato, no de React: tiene que sobrevivir a los renders
   y no reiniciarse nunca, porque es lo que el host usa para confirmar inputs. */
let sequence = 0;
function nextSequence(): number {
  sequence += 1;
  return sequence;
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}
