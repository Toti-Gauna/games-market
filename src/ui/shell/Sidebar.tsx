import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { GameLaunchLink } from "@/ui/catalog/GameLaunchLink";
import { CATEGORY_LABEL, isPlayable, type GameCategory, type GameEntry } from "@/core/contract/catalog";
import { GAMES } from "@/games/registry";
import { EffortChip, StatusDot } from "@/ui/catalog/badges";

/**
 * El sidebar es el indice del proyecto: los 24 juegos siempre visibles,
 * implementados o no. Ver el plan completo es parte de lo que hace util a
 * este patio de juegos.
 */

const CATEGORY_ORDER: readonly GameCategory[] = ["retro", "modern", "creative"];

export type SidebarProps = {
  /** En movil el sidebar es un cajon; en escritorio esta siempre. */
  onNavigate?: () => void;
};

export function Sidebar({ onNavigate }: SidebarProps) {
  const [query, setQuery] = useState("");
  const [onlyPlayable, setOnlyPlayable] = useState(false);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = GAMES.filter((game) => {
      if (onlyPlayable && !isPlayable(game)) return false;
      if (!needle) return true;
      return (
        game.title.toLowerCase().includes(needle) ||
        game.code.toLowerCase().includes(needle) ||
        game.tagline.toLowerCase().includes(needle) ||
        game.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
    return CATEGORY_ORDER.map((category) => ({
      category,
      games: matches.filter((game) => game.category === category),
    })).filter((group) => group.games.length > 0);
  }, [query, onlyPlayable]);

  const playableCount = GAMES.filter(isPlayable).length;

  return (
    <nav className="flex h-full w-full flex-col border-r border-sn-line-soft bg-sn-bg-elev">
      <div className="shrink-0 border-b border-sn-line-soft px-4 py-4">
        <NavLink to="/" onClick={onNavigate} className="block">
          <span className="block bg-gradient-to-r from-sn-violet-300 via-sn-magenta-300 to-sn-cyan-300 bg-clip-text font-display text-[15px] font-bold tracking-tight text-transparent">
            SUPERNOVA
          </span>
          <span className="block text-[11px] text-sn-dim">Patio de juegos</span>
        </NavLink>
      </div>

      <div className="flex shrink-0 flex-col gap-2 px-3 py-3">
        <input
          type="search"
          className="sn-input"
          placeholder="Buscar juego, código o etiqueta"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar juego"
        />
        <label className="flex cursor-pointer items-center gap-2 px-1 text-[11px] text-sn-muted">
          <input
            type="checkbox"
            className="size-3.5 accent-sn-violet-400"
            checked={onlyPlayable}
            onChange={(e) => setOnlyPlayable(e.target.checked)}
          />
          Solo los jugables ({playableCount} de {GAMES.length})
        </label>
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 px-2 pb-2">
        <ShellLink to="/" label="Catálogo" onNavigate={onNavigate} end />
        <ShellLink to="/roadmap" label="Roadmap" onNavigate={onNavigate} />
      </div>

      <div className="sn-scroll-y min-h-0 flex-1 px-2 pb-6">
        {groups.map((group) => (
          <section key={group.category} className="mb-3">
            <h3 className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sn-dim">
              {CATEGORY_LABEL[group.category]}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {group.games.map((game) => (
                <li key={game.id}>
                  <GameLink game={game} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {groups.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-sn-dim">Ningún juego coincide.</p>
        )}
      </div>
    </nav>
  );
}

function ShellLink({
  to,
  label,
  onNavigate,
  end = false,
}: {
  to: string;
  label: string;
  onNavigate?: () => void;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `rounded-sn px-3 py-2 text-xs font-medium transition-colors ${
          isActive ? "bg-sn-panel-hi text-sn-text" : "text-sn-muted hover:bg-sn-panel hover:text-sn-text"
        }`
      }
    >
      {label}
    </NavLink>
  );
}

function GameLink({ game, onNavigate }: { game: GameEntry; onNavigate?: () => void }) {
  const playable = isPlayable(game);
  return (
    <GameLaunchLink
      game={game}
      onClick={onNavigate}
      className="group flex items-center gap-2 rounded-sn px-2 py-1.5 transition-colors hover:bg-sn-panel"
      activeClassName="bg-sn-panel-hi"
      title={game.tagline}
    >
      <StatusDot status={game.status} />
      <span className="sn-num w-6 shrink-0 text-[10px] text-sn-dim">{game.code}</span>
      <span
        className={`min-w-0 flex-1 truncate text-xs ${
          playable ? "text-sn-text" : "text-sn-dim group-hover:text-sn-muted"
        }`}
      >
        {game.title}
      </span>
      <EffortChip entry={game} />
    </GameLaunchLink>
  );
}
