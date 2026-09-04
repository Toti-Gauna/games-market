import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { opensInTab, type GameEntry } from "@/core/contract/catalog";

/**
 * El enlace a un juego, que a veces no es un enlace de la aplicacion.
 *
 * Los juegos 3D se abren en una pestana propia (ver `opensInTab`), y eso no se
 * puede hacer navegando con el router: navegar es justo lo que hay que evitar.
 * Un `<a target="_blank">` con el hash es lo que abre una pestana nueva, y con
 * el router de hash alcanza con el `#/...` relativo — no hace falta armar el
 * origen ni el subpath, que es lo que romperia el deploy en GitHub Pages,
 * servido desde `/games-market/`.
 *
 * Existe este componente y no dos ternarios sueltos porque los dos lugares que
 * enlazan a un juego —el catalogo y el sidebar— tienen que decidir igual. Si
 * uno se olvidara, el juego 3D abriria adentro de la aplicacion desde ahi y
 * nadie se enteraria hasta que fuera lento.
 *
 * `activeClassName` solo se usa en el caso de adentro: un juego que vive en
 * otra pestana nunca es la ruta activa de esta.
 */

export type GameLaunchLinkProps = {
  game: GameEntry;
  className?: string;
  /** Se agrega cuando la ruta del juego es la activa. Solo aplica `inline`. */
  activeClassName?: string;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
};

export function GameLaunchLink({
  game,
  className = "",
  activeClassName = "",
  onClick,
  title,
  children,
}: GameLaunchLinkProps) {
  if (opensInTab(game)) {
    return (
      <a
        href={`#/juego/${game.id}`}
        target="_blank"
        // `noopener` no es opcional: sin el, la pestana nueva puede tocar el
        // `window.opener` de esta.
        rel="noopener noreferrer"
        className={className}
        onClick={onClick}
        title={title ?? `${game.title} — se abre en una pestaña nueva`}
      >
        {children}
      </a>
    );
  }

  return (
    <NavLink
      to={`/juego/${game.id}`}
      onClick={onClick}
      {...(title === undefined ? {} : { title })}
      className={({ isActive }) => `${className} ${isActive ? activeClassName : ""}`.trim()}
    >
      {children}
    </NavLink>
  );
}
