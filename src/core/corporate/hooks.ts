import { useEffect, useRef, useState } from "react";

/**
 * Hooks compartidos por los juegos corporativos.
 *
 * Viven aparte de QuestionCard.tsx para que ese archivo exporte solo
 * componentes y el fast refresh siga funcionando.
 */
/**
 * Quien pide menos movimiento no recibe el deslizamiento lateral. Los tokens
 * ya achican las duraciones; esto ademas saca el desplazamiento de entrada.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * El limite duro de `config.durationMs`. Devuelve lo que queda y avisa una vez
 * al vencer, para que el juego cierre con lo respondido hasta ahi.
 *
 * Un cuestionario no muestra reloj —poner reloj cambia las respuestas—, pero
 * si hay limite hay que avisar antes de cortar.
 */
export function useDeadline(durationMs: number | null, onExpire: () => void): number | null {
  const [remainingMs, setRemainingMs] = useState<number | null>(durationMs);
  const expireRef = useRef(onExpire);

  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (durationMs === null) {
      setRemainingMs(null);
      return;
    }
    const endsAt = performance.now() + durationMs;
    const id = window.setInterval(() => {
      const left = Math.max(0, endsAt - performance.now());
      // Un render por segundo alcanza: el segundo visible no cambia mas rapido.
      setRemainingMs((prev) =>
        prev === null || Math.ceil(left / 1000) !== Math.ceil(prev / 1000) ? left : prev,
      );
      if (left <= 0) {
        window.clearInterval(id);
        expireRef.current();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [durationMs]);

  return remainingMs;
}
