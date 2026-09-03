import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CATEGORY_LABEL,
  ENGINE_LABEL,
  isPlayable,
  TOPOLOGY_LABEL,
  type GameCategory,
  type GameEntry,
  type GameTopology,
} from "@/core/contract/catalog";
import { GAMES } from "@/games/registry";
import { EffortChip, StatusChip, TopologyChip } from "@/ui/catalog/badges";

/**
 * La bateria de experiencias: cualquier juego se abre y se prueba sin armar un
 * tour, sin abrir sesion y sin generar codigo de sala.
 *
 * Un juego apagado se puede probar igual: este es justamente el lugar donde se
 * prueba antes de prenderlo.
 */

type CategoryFilter = GameCategory | "all";
type TopologyFilter = GameTopology | "all";

export default function CatalogPage() {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [topology, setTopology] = useState<TopologyFilter>("all");
  const [onlyPlayable, setOnlyPlayable] = useState(false);

  const games = useMemo(
    () =>
      GAMES.filter((game) => {
        if (category !== "all" && game.category !== category) return false;
        if (topology !== "all" && game.topology !== topology) return false;
        if (onlyPlayable && !isPlayable(game)) return false;
        return true;
      }),
    [category, topology, onlyPlayable],
  );

  const playableCount = GAMES.filter(isPlayable).length;

  return (
    <div className="sn-nebula min-h-full">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <header className="mb-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl">Batería de experiencias</h1>
            <Link to="/quiosco" className="sn-btn text-xs">
              Modo quiosco
            </Link>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-sn-muted">
            Los {GAMES.length} juegos del catálogo, implementados o no. Abrí cualquiera para jugarlo
            con sus administrables en vivo. Lo que pase acá no escribe ninguna sesión ni resultado:
            se muestra y se descarta.
          </p>
          <p className="mt-2 text-xs text-sn-dim">
            <span className="sn-num text-sn-cyan">{playableCount}</span> jugables ·{" "}
            <span className="sn-num">{GAMES.length - playableCount}</span> pendientes
          </p>
        </header>

        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterRow
            label="Categoría"
            value={category}
            onChange={setCategory}
            options={[
              { value: "all", label: "Todas" },
              ...(Object.keys(CATEGORY_LABEL) as GameCategory[]).map((key) => ({
                value: key,
                label: CATEGORY_LABEL[key],
              })),
            ]}
          />
          <FilterRow
            label="Topología"
            value={topology}
            onChange={setTopology}
            options={[
              { value: "all", label: "Todas" },
              ...(Object.keys(TOPOLOGY_LABEL) as GameTopology[]).map((key) => ({
                value: key,
                label: TOPOLOGY_LABEL[key],
              })),
            ]}
          />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-sn-muted">
            <input
              type="checkbox"
              className="size-3.5 accent-sn-violet-400"
              checked={onlyPlayable}
              onChange={(e) => setOnlyPlayable(e.target.checked)}
            />
            Solo jugables
          </label>
        </div>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {games.map((game) => (
            <li key={game.id}>
              <GameCard game={game} />
            </li>
          ))}
        </ul>

        {games.length === 0 && (
          <p className="py-16 text-center text-sm text-sn-dim">
            Ningún juego con esos filtros. Probá aflojar alguno.
          </p>
        )}
      </div>
    </div>
  );
}

function FilterRow<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-sn-dim">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value as T)}
            aria-pressed={value === option.value}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              value === option.value
                ? "border-transparent bg-sn-violet text-white"
                : "border-sn-line bg-sn-bg-elev text-sn-muted hover:text-sn-text"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GameCard({ game }: { game: GameEntry }) {
  const playable = isPlayable(game);

  return (
    <Link
      to={`/juego/${game.id}`}
      className="sn-card group flex h-full flex-col gap-3 p-4 transition-colors hover:border-sn-violet"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="sn-num text-[10px] tracking-widest text-sn-dim">{game.code}</span>
          <h2 className="truncate text-base leading-snug text-sn-text group-hover:text-sn-cyan">
            {game.title}
          </h2>
        </div>
        <EffortChip entry={game} />
      </div>

      <p className="line-clamp-2 flex-1 text-xs leading-relaxed text-sn-muted">{game.tagline}</p>

      <div className="flex flex-wrap gap-1">
        <TopologyChip topology={game.topology} />
        <span className="sn-chip">{ENGINE_LABEL[game.engine]}</span>
        <StatusChip status={game.status} />
        {game.needsNet && <span className="sn-chip">Red</span>}
      </div>

      <div className="flex items-center justify-between border-t border-sn-line-soft pt-2.5 text-[11px] text-sn-dim">
        <span>
          {game.minPlayers === game.maxPlayers
            ? `${game.minPlayers} jugador${game.minPlayers > 1 ? "es" : ""}`
            : `${game.minPlayers}–${game.maxPlayers} jugadores`}
          {" · "}
          <span className="sn-num">~{game.estimatedMin} min</span>
        </span>
        <span className={playable ? "font-medium text-sn-cyan" : ""}>
          {playable ? "Jugar" : `Tanda ${game.batch}`}
        </span>
      </div>
    </Link>
  );
}
