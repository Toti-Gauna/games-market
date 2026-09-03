import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type { RankingItem } from "./ranking";
import { decimal, type DivisionRow } from "./rankingChart";

/**
 * El proyector de una ronda de ordenamiento.
 *
 * Hermano de `LiveStage`, y aparte por una razon concreta: `LiveStage` modela
 * "un item con enunciado y una ventana de tiempo", y ordenar no tiene ninguna
 * de las dos cosas. No hay reloj —es una reflexion, no una carrera— asi que la
 * barra de tiempo de aquel marco estaria mintiendo, y tampoco hay "3 de 10"
 * porque hay una sola consigna.
 *
 * Lo que si comparte es la escala: esto es un PROYECTOR, no un monitor. Todo
 * arranca en tamanos que se leen desde el fondo de una sala y crece con la
 * pantalla. Si se lee comodo en un portatil a 40 cm, esta chico.
 *
 * Son tres momentos y el orden importa:
 *
 * 1. Mientras responden: cuantos van, y nada mas. Ver el consenso a medias
 *    influye a quien todavia no contesto, asi que los resultados parciales no
 *    se dibujan.
 * 2. El consenso: las tarjetas acomodandose en su orden promedio.
 * 3. La division: el momento que importa. Un promedio es un dato tibio; el
 *    desacuerdo es informacion de verdad.
 */

/** Cuanto dura el reacomodamiento de las tarjetas al pasar al consenso. */
const FLIP_MS = 560;
/** Lo que se sostiene el orden sembrado antes de que las tarjetas se muevan. */
const SETTLE_MS = 900;
const APPEAR_MS = 260;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/* ------------------------------------------------------------------ */
/* Marco                                                               */
/* ------------------------------------------------------------------ */

export type RankingStageProps = {
  /** El momento, en versalitas: "MIENTRAS RESPONDEN", "EL CONSENSO". */
  eyebrow: string;
  /** La consigna que ordeno la sala. */
  title: string;
  /** Arriba a la derecha: el contador, el boton del host. */
  headline?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export function RankingStage({ eyebrow, title, headline, children, footer }: RankingStageProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-5 bg-sn-bg p-6">
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[clamp(0.8rem,1.3vw,1.3rem)] font-semibold uppercase tracking-[0.18em] text-sn-dim">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-balance font-display text-[clamp(1.2rem,2.6vw,2.8rem)] font-semibold leading-tight text-sn-text">
            {title}
          </h1>
        </div>
        {headline}
      </header>

      <div className="sn-scroll-y min-h-0 flex-1">{children}</div>

      {footer && <footer className="shrink-0">{footer}</footer>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Momento 1 · mientras responden                                       */
/* ------------------------------------------------------------------ */

export type RankingRosterProps = {
  /** Quienes ya mandaron su orden, por orden de llegada. Vacio si es anonima. */
  names: readonly string[];
  answered: number;
  eligible: number;
  anonymous: boolean;
  /** Mas nombres que estos no se leen desde el fondo de la sala. */
  limit?: number;
  reduced?: boolean;
};

/**
 * El contador y los que ya contestaron.
 *
 * **Aca no hay ningun resultado**, y no es un olvido: el consenso a medias
 * cambia lo que ordena quien todavia no contesto, y entonces el agregado deja
 * de medir lo que la sala piensa para medir lo que la sala vio en la pantalla.
 *
 * En una ronda anonima no llega ni un nombre: se dibujan fichas sin texto, que
 * transmiten lo mismo —la sala se esta llenando— sin exponer a nadie.
 */
export function RankingRoster({
  names,
  answered,
  eligible,
  anonymous,
  limit = 24,
  reduced = false,
}: RankingRosterProps) {
  const missing = Math.max(0, eligible - answered);
  const visible = anonymous ? [] : names.slice(-limit);
  const anonymousChips = anonymous ? Math.min(answered, limit) : 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <p className="sn-num text-[clamp(3rem,11vw,11rem)] font-semibold leading-none text-sn-cyan">
        {answered} <span className="text-sn-dim">de</span> {eligible}
      </p>
      <p className="text-[clamp(0.9rem,1.7vw,1.8rem)] text-sn-muted" aria-live="polite">
        {missingLabel(eligible, missing)}
      </p>

      <ul className="flex max-w-6xl flex-wrap justify-center gap-2">
        {visible.map((name, index) => (
          <Appear
            as="li"
            key={`${name}-${index}`}
            reduced={reduced}
            className="rounded-sn border border-sn-line-soft bg-sn-bg-elev px-4 py-2 text-[clamp(0.8rem,1.2vw,1.3rem)] text-sn-text"
          >
            {name}
          </Appear>
        ))}
        {Array.from({ length: anonymousChips }, (_, index) => (
          <Appear
            as="li"
            key={`anon-${index}`}
            reduced={reduced}
            className="h-[clamp(1.2rem,2vw,2rem)] w-[clamp(1.2rem,2vw,2rem)] rounded-sn-sm border border-sn-line bg-sn-panel-hi"
            label="Una respuesta anónima"
          />
        ))}
      </ul>

      {anonymous && (
        <p className="text-[clamp(0.75rem,1.1vw,1.1rem)] text-sn-dim">
          Ronda anónima: quién ordenó qué no llega a esta pantalla.
        </p>
      )}
    </div>
  );
}

function missingLabel(eligible: number, missing: number): string {
  if (eligible === 0) return "Esperando a que entre la primera persona.";
  if (missing === 0) return "Ya ordenaron todos.";
  if (missing === 1) return "Falta 1 persona.";
  return `Faltan ${missing} personas.`;
}

/* ------------------------------------------------------------------ */
/* Momento 2 · el consenso                                              */
/* ------------------------------------------------------------------ */

export type RankingConsensusProps = {
  /** Ya en orden de consenso, tal como los devuelve `aggregateRanking`. */
  items: readonly RankingItem[];
  /**
   * El orden sembrado con el que la sala vio las tarjetas. Se dibuja primero y
   * de ahi se reacomoda: el movimiento ES informacion, porque muestra cuanto se
   * corrio cada tarjeta respecto de como se la planteo.
   */
  initialOrder?: readonly string[];
  reduced?: boolean;
};

export function RankingConsensus({ items, initialOrder, reduced = false }: RankingConsensusProps) {
  // Quien pide menos movimiento ve el resultado directo: la animacion es el
  // adorno, el orden es el contenido.
  const [settled, setSettled] = useState(() => reduced || !initialOrder);

  useEffect(() => {
    if (settled) return;
    const timer = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settled]);

  const rows = useMemo(
    () => (settled || !initialOrder ? items : sortByOrder(items, initialOrder)),
    [items, initialOrder, settled],
  );

  const nodes = useFlip(rows.map((row) => row.id).join(","), !reduced);

  return (
    <ol className="mx-auto flex w-full max-w-5xl flex-col gap-2">
      {rows.map((row) => (
        <li
          key={row.id}
          ref={(node) => {
            if (node) nodes.current.set(row.id, node);
            else nodes.current.delete(row.id);
          }}
          className="flex items-center gap-4 rounded-sn border border-sn-line-soft bg-sn-bg-elev px-4 py-3"
        >
          <span className="sn-num w-[2ch] shrink-0 text-center text-[clamp(1.1rem,2.4vw,2.6rem)] font-semibold text-sn-cyan">
            {settled ? row.consensusPosition : "·"}
          </span>
          <span className="min-w-0 flex-1 truncate text-[clamp(1rem,2.1vw,2.3rem)] text-sn-text">
            {row.label}
          </span>
          {/* La posicion media es el dato fino: "3,4" dice que la sala lo dejo
              entre tercero y cuarto, cosa que un "3" pelado esconde. */}
          <span
            className={`sn-num shrink-0 text-[clamp(0.8rem,1.4vw,1.5rem)] text-sn-muted transition-opacity ${
              settled ? "opacity-100" : "opacity-0"
            }`}
            style={{ transitionDuration: "var(--sn-dur-slow)" }}
          >
            {decimal(row.avgPosition)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Los mismos items, en el orden pedido. Lo que no aparece va al final. */
function sortByOrder(
  items: readonly RankingItem[],
  order: readonly string[],
): readonly RankingItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const out: RankingItem[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  for (const item of items) if (!seen.has(item.id)) out.push(item);
  return out;
}

/* ------------------------------------------------------------------ */
/* Momento 3 · la division                                              */
/* ------------------------------------------------------------------ */

export type RankingDivisionProps = {
  rows: readonly DivisionRow[];
  /** Cuantas tarjetas tiene el conjunto: es la escala del eje. */
  size: number;
  reduced?: boolean;
};

/**
 * El grafico de dispersion, ordenado por desvio.
 *
 * La primera fila es la mas discutida y es donde se para la conversacion: por
 * eso se destaca con color Y con borde Y con texto, no solo con color. Cada
 * punto es una posicion y su tamano es cuanta gente la eligio; los extremos
 * poblados con el medio vacio se ven de una, que es justo lo que la media
 * esconde.
 */
export function RankingDivision({ rows, size, reduced = false }: RankingDivisionProps) {
  if (rows.length === 0) {
    return (
      <p className="grid h-full place-items-center text-[clamp(0.9rem,1.6vw,1.6rem)] text-sn-dim">
        Todavía no hay respuestas para comparar.
      </p>
    );
  }

  return (
    <ol className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      {rows.map((row) => (
        <Appear
          as="li"
          key={row.id}
          reduced={reduced}
          className={`rounded-sn-lg border px-5 py-4 ${
            row.leader ? "bg-sn-panel" : "border-sn-line-soft bg-sn-bg-elev"
          }`}
          style={
            row.leader
              ? { borderColor: "var(--sn-magenta-400)", boxShadow: "var(--sn-glow-magenta)" }
              : undefined
          }
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[clamp(1rem,2vw,2.2rem)] font-semibold text-sn-text">
              {row.label}
            </span>
            {row.leader && (
              <span
                className="text-[clamp(0.7rem,1.1vw,1.1rem)] font-semibold uppercase tracking-[0.16em]"
                style={{ color: "var(--sn-magenta-400)" }}
              >
                El más discutido
              </span>
            )}
          </div>

          <Scatter row={row} size={size} />

          <p className="mt-2 text-[clamp(0.85rem,1.5vw,1.6rem)] text-sn-muted">{row.headline}</p>
        </Appear>
      ))}
    </ol>
  );
}

function Scatter({ row, size }: { row: DivisionRow; size: number }) {
  const tone = row.leader ? "var(--sn-magenta-400)" : "var(--sn-violet-300)";

  return (
    <div className="mt-3 text-[clamp(0.8rem,1.3vw,1.4rem)]">
      <div
        className="relative h-[2.4em]"
        role="img"
        aria-label={`${row.label}: entre el puesto ${row.minPosition} y el ${row.maxPosition} de ${size}, promedio ${decimal(row.avgPosition)}`}
      >
        {/* El eje entero: sin el, un tramo corto parece un tramo largo. */}
        <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-sn-line" />

        {/* El tramo que ocupa el desacuerdo. */}
        <span
          className="absolute top-1/2 h-[4px] -translate-y-1/2 rounded-full"
          style={{
            left: `${row.spanFrom * 100}%`,
            width: `${Math.max(0, row.spanTo - row.spanFrom) * 100}%`,
            background: `color-mix(in oklab, ${tone} 45%, transparent)`,
          }}
        />

        {/* La media, como marca fina: es el numero que el grafico desmiente. */}
        <span
          className="absolute top-1/2 h-[1.5em] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sn-dim"
          style={{ left: `${row.avgAt * 100}%` }}
        />

        {row.dots.map((dot) => {
          const diameter = 0.8 + dot.weight * 1.2;
          return (
            <span
              key={dot.position}
              className="absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
              style={{
                left: `${dot.at * 100}%`,
                width: `${diameter}em`,
                height: `${diameter}em`,
                background: tone,
              }}
            >
              {/* El numero adentro del punto: el tamano solo no se lee de lejos. */}
              <span className="sn-num text-[0.6em] font-semibold text-sn-bg">{dot.count}</span>
            </span>
          );
        })}
      </div>

      <div className="sn-num flex justify-between text-[0.72em] text-sn-dim">
        <span>1º</span>
        <span>{size}º</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Piezas internas                                                      */
/* ------------------------------------------------------------------ */

/**
 * FLIP a mano.
 *
 * Se mide el `top` de cada fila antes y despues del reordenamiento y se anima
 * la diferencia con la Web Animations API. Solo interesa el eje vertical: una
 * lista ordenada no se mueve de costado.
 *
 * Sin libreria de motion porque el proyecto no tiene ninguna y esto son treinta
 * lineas: traer una dependencia para animar ocho filas seria al reves.
 */
function useFlip(signature: string, enabled: boolean): RefObject<Map<string, HTMLElement>> {
  const nodes = useRef<Map<string, HTMLElement>>(new Map());
  const tops = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const previous = tops.current;
    const next = new Map<string, number>();

    for (const [id, node] of nodes.current) {
      const top = node.getBoundingClientRect().top;
      next.set(id, top);
      const before = previous.get(id);
      if (!enabled || before === undefined) continue;
      const delta = before - top;
      if (Math.abs(delta) < 1 || typeof node.animate !== "function") continue;
      node.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" }], {
        duration: FLIP_MS,
        easing: EASE,
      });
    }

    tops.current = next;
  }, [signature, enabled]);

  return nodes;
}

type AppearProps = {
  as: "li" | "div";
  reduced: boolean;
  className?: string;
  style?: CSSProperties;
  /** Para las fichas anonimas, que no tienen texto adentro. */
  label?: string;
  children?: ReactNode;
};

/** Entrada suave sin CSS global: una animacion al montar y nada mas. */
function Appear({ as: Tag, reduced, className, style, label, children }: AppearProps) {
  const ref = useRef<HTMLLIElement & HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced || typeof node.animate !== "function") return;
    node.animate(
      [
        { opacity: 0, transform: "translateY(0.5em)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      { duration: APPEAR_MS, easing: EASE },
    );
  }, [reduced]);

  return (
    <Tag ref={ref} className={className} style={style} aria-label={label}>
      {children}
    </Tag>
  );
}
