import { Link } from "react-router-dom";
import { isPlayable } from "@/core/contract/catalog";
import { GAMES } from "@/games/registry";
import { BATCHES } from "@/games/roadmap";
import { EffortChip, StatusDot, TopologyChip } from "@/ui/catalog/badges";

/**
 * El roadmap se arma desde el registry, no desde una lista aparte: cambiar la
 * tanda de un juego en registry.ts mueve la tarjeta acá sola.
 */
export default function RoadmapPage() {
  const done = GAMES.filter(isPlayable).length;

  return (
    <div className="sn-nebula min-h-full">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <header className="mb-8">
          <h1 className="text-2xl">Roadmap</h1>
          <p className="mt-1 max-w-2xl text-sm text-sn-muted">
            Doce tandas ordenadas por complejidad técnica y dependencia, no por categoría. Se puede
            parar en cualquiera y el producto sirve. El detalle y la justificación de cada
            reordenamiento están en <span className="sn-num text-sn-cyan">ROADMAP.md</span>.
          </p>

          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-sn-line">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sn-violet to-sn-magenta"
                style={{ width: `${(done / GAMES.length) * 100}%` }}
              />
            </div>
            <span className="sn-num shrink-0 text-xs text-sn-muted">
              {done}/{GAMES.length}
            </span>
          </div>
        </header>

        <ol className="flex flex-col gap-4">
          {BATCHES.map((batch) => {
            const games = GAMES.filter((game) => game.batch === batch.number);
            const complete = games.length > 0 && games.every(isPlayable);

            return (
              <li key={batch.number} className="sn-card p-4">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="sn-num text-[11px] tracking-widest text-sn-dim">
                    TANDA {String(batch.number).padStart(2, "0")}
                  </span>
                  <h2 className="text-base">{batch.title}</h2>
                  {complete && <span className="sn-chip text-sn-success">Lista</span>}
                </div>

                <p className="text-xs leading-relaxed text-sn-muted">{batch.unlocks}</p>
                <p className="mt-1 text-[11px] text-sn-dim">Requiere: {batch.requires}</p>

                {games.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 border-t border-sn-line-soft pt-3">
                    {games.map((game) => (
                      <li key={game.id}>
                        <Link
                          to={`/juego/${game.id}`}
                          className="flex items-center gap-2 rounded-sn px-2 py-1.5 hover:bg-sn-panel"
                        >
                          <StatusDot status={game.status} />
                          <span className="sn-num w-6 shrink-0 text-[10px] text-sn-dim">{game.code}</span>
                          <span
                            className={`w-32 shrink-0 truncate text-xs ${
                              isPlayable(game) ? "text-sn-text" : "text-sn-dim"
                            }`}
                          >
                            {game.title}
                          </span>
                          <span className="hidden min-w-0 flex-1 truncate text-[11px] text-sn-dim sm:block">
                            {game.tagline}
                          </span>
                          <TopologyChip topology={game.topology} />
                          <EffortChip entry={game} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
