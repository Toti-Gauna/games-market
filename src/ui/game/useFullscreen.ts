import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Pantalla completa sobre un elemento concreto.
 *
 * Va sobre el contenedor del juego y no sobre `documentElement` a proposito:
 * asi el encuadre se queda con la pantalla entera y desaparece todo lo que lo
 * rodea —sidebar, panel de administrables, barra del navegador—, que es lo
 * unico que de verdad cambia el rendimiento. Poner en pantalla completa el
 * documento entero deja el juego del mismo tamano y solo saca el cromo.
 *
 * Tres cosas que hay que respetar y que se resuelven aca una sola vez:
 *
 * 1. **Solo se puede pedir dentro de un gesto.** Por eso esto devuelve un
 *    `toggle` para colgar de un boton, y no algo que se dispare al montar.
 * 2. **No existe en todos lados.** Safari en iPhone no lo implementa sobre un
 *    elemento cualquiera, asi que `supported` es false y quien lo use tiene
 *    que esconder el boton en vez de mostrar uno que no hace nada.
 * 3. **Se puede salir sin tocar el boton**, con Escape o con el gesto del
 *    sistema. El estado sale del evento del documento, nunca de suponer que
 *    lo que se pidio paso.
 */

export type Fullscreen = {
  /** El elemento observado es el que esta en pantalla completa ahora. */
  active: boolean;
  /** false = el navegador no lo permite. Escondé el control. */
  supported: boolean;
  toggle: () => void;
};

export function useFullscreen(target: RefObject<HTMLElement | null>): Fullscreen {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const element = target.current;
    setSupported(
      typeof document !== "undefined" &&
        document.fullscreenEnabled === true &&
        typeof element?.requestFullscreen === "function",
    );
  }, [target]);

  useEffect(() => {
    const sync = () => {
      // Se compara contra el elemento propio: otro juego en pantalla completa
      // en la misma pagina no tiene que encender este boton.
      setActive(document.fullscreenElement === target.current);
    };
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [target]);

  const toggle = useCallback(() => {
    const element = target.current;
    if (!element) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    // Puede fallar por politica del navegador y no es un error del juego: se
    // ignora y el boton queda como estaba.
    void element.requestFullscreen().catch(() => undefined);
  }, [target]);

  return { active, supported, toggle };
}
