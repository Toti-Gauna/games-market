import { useEffect, useState } from "react";

/**
 * Mantiene la pantalla del celular encendida mientras dura la partida.
 *
 * Sin esto el telefono se apaga a los 30 segundos y el jugador pierde el
 * control en medio de un punto. Es de los detalles que no se notan cuando
 * estan y arruinan la demo cuando faltan.
 *
 * No existe en todos los navegadores y se cae solo cuando la pestana se
 * oculta, asi que se vuelve a pedir al volver.
 */

type WakeLockSentinelLike = { released: boolean; release(): Promise<void> };
type WakeLockApi = { request(type: "screen"): Promise<WakeLockSentinelLike> };

export function useWakeLock(active: boolean): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!active) return;
    const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
    if (!api) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const next = await api.request("screen");
        if (cancelled) {
          void next.release();
          return;
        }
        sentinel = next;
        setHeld(true);
      } catch {
        // Sin permiso o sin soporte: el control sigue funcionando igual.
        setHeld(false);
      }
    };

    // El navegador suelta el bloqueo al ocultar la pestana; hay que repedirlo.
    const onVisibility = () => {
      if (!document.hidden && (sentinel === null || sentinel.released)) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release();
      setHeld(false);
    };
  }, [active]);

  return held;
}
