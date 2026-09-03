import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  isMatchingPair,
  matchLink,
  orderedRightPairs,
  parseMatchLink,
  type MatchPair,
} from "./question.types";
import { usePrefersReducedMotion } from "./hooks";

/**
 * Unir pares: la mecanica, no un juego.
 *
 * La usan el renderer `match` de QuestionCard y el juego Memoria de valores.
 * Por eso las props son de dominio (pares, uniones hechas, aviso de union) y no
 * traen puntaje, reloj ni textos de una partida.
 *
 * Dos caminos de entrada, los dos de primera clase:
 *
 * 1. Arrastrar de una columna a la otra, con eventos de puntero —no con la API
 *    de drag&drop del navegador, que en un telefono no existe.
 * 2. Tocar una tarjeta y despues su pareja. Es el mismo camino que funciona con
 *    teclado y con lector de pantalla: son botones de verdad, asi que Tab y
 *    Enter alcanzan sin escribir una sola tecla de mas.
 *
 * El tablero decide si una union cierra bien, porque el feedback inmediato es
 * parte de la mecanica: sin eso no se puede deshacer un error. La correccion
 * que puntua sigue viviendo en scoring.ts, sobre la respuesta emitida.
 *
 * Los ids de par NO viajan al DOM: las tarjetas se resuelven por posicion. En
 * una sala llena alguien abre el inspector, y con `data-pair="p3"` de los dos
 * lados la solucion se leeria sin jugar.
 */

export type MatchSide = "left" | "right";

export type MatchBoardProps = {
  pairs: readonly MatchPair[];
  /** Orden de la columna derecha, por id de par. Lo baraja quien tiene la semilla. */
  rightOrder?: readonly string[];
  /** Uniones ya cerradas, `"<leftId>|<rightId>"`. */
  matched: readonly string[];
  /** Cada intento, con si cerro bien. Quien recibe decide que guarda. */
  onMatch: (link: string, correct: boolean) => void;
  disabled?: boolean;
  /** Muestra a que par pertenece cada tarjeta que quedo sin unir. */
  revealed?: boolean;
  leftLabel?: string;
  rightLabel?: string;
  /** ms que queda visible una union fallida antes de deshacerse sola. */
  wrongFeedbackMs?: number;
  className?: string;
};

/** Debajo de esto el gesto fue un toque, no un arrastre. */
const DRAG_THRESHOLD_PX = 8;
const DEFAULT_WRONG_FEEDBACK_MS = 900;

type CardState = "idle" | "selected" | "target" | "matched" | "wrong";

const CARD_TONE: Record<CardState, string> = {
  idle: "border-sn-line-soft bg-sn-bg-elev text-sn-text hover:border-sn-violet-400 hover:bg-sn-panel",
  selected: "border-sn-cyan bg-sn-panel-hi text-sn-text",
  target: "border-sn-magenta bg-sn-panel-hi text-sn-text",
  matched: "border-sn-success bg-sn-panel text-sn-muted",
  wrong: "border-sn-danger bg-sn-panel-hi text-sn-text",
};

/** Nunca solo color: cada estado trae simbolo y texto para el lector. */
const CARD_MARK: Record<CardState, { symbol: string; label: string } | null> = {
  idle: null,
  selected: { symbol: "•", label: "Seleccionada" },
  target: { symbol: "+", label: "Soltá acá para unir" },
  matched: { symbol: "✓", label: "Unida" },
  wrong: { symbol: "✕", label: "No es esa" },
};

const MARK_TONE: Record<CardState, string> = {
  idle: "text-sn-dim",
  selected: "text-sn-cyan",
  target: "text-sn-magenta",
  matched: "text-sn-success",
  wrong: "text-sn-danger",
};

type StatusTone = "info" | "ok" | "bad";

const STATUS_TONE: Record<StatusTone, string> = {
  info: "text-sn-muted",
  ok: "text-sn-success",
  bad: "text-sn-danger",
};

const STATUS_SYMBOL: Record<StatusTone, string> = { info: "•", ok: "✓", bad: "✕" };

type PointerDrag = {
  pointerId: number;
  side: MatchSide;
  id: string;
  startX: number;
  startY: number;
  moved: boolean;
};

export function MatchBoard({
  pairs,
  rightOrder,
  matched,
  onMatch,
  disabled = false,
  revealed = false,
  leftLabel = "Columna izquierda",
  rightLabel = "Columna derecha",
  wrongFeedbackMs = DEFAULT_WRONG_FEEDBACK_MS,
  className = "",
}: MatchBoardProps) {
  const uid = useId();
  const reduced = usePrefersReducedMotion();

  const rights = useMemo(() => orderedRightPairs(pairs, rightOrder), [pairs, rightOrder]);

  const { matchedLeft, matchedRight } = useMemo(() => {
    const left = new Set<string>();
    const right = new Set<string>();
    for (const link of matched) {
      const parsed = parseMatchLink(link);
      if (!parsed) continue;
      left.add(parsed.leftId);
      right.add(parsed.rightId);
    }
    return { matchedLeft: left, matchedRight: right };
  }, [matched]);

  const [selected, setSelected] = useState<{ side: MatchSide; id: string } | null>(null);
  const [wrong, setWrong] = useState<{ leftId: string; rightId: string } | null>(null);
  const [drag, setDrag] = useState<{ side: MatchSide; id: string; x: number; y: number } | null>(
    null,
  );
  const [hover, setHover] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; tone: StatusTone; nonce: number }>({
    text: "",
    tone: "info",
    nonce: 0,
  });

  const pointerRef = useRef<PointerDrag | null>(null);
  const wrongTimerRef = useRef<number | null>(null);
  // Un arrastre que termina sobre la misma tarjeta dispara ademas un click: sin
  // esto el gesto contaria dos veces.
  const skipClickRef = useRef(false);

  useEffect(
    () => () => {
      if (wrongTimerRef.current !== null) window.clearTimeout(wrongTimerRef.current);
    },
    [],
  );

  const textOf = (side: MatchSide, id: string): string => {
    const pair = pairs.find((candidate) => candidate.id === id);
    if (!pair) return "";
    return side === "left" ? pair.left : pair.right;
  };

  /** El numero es el canal que no depende del color para atar las dos columnas. */
  const badgeOf = (id: string): number => pairs.findIndex((pair) => pair.id === id) + 1;

  const isCardLocked = (side: MatchSide, id: string): boolean =>
    disabled || revealed || (side === "left" ? matchedLeft : matchedRight).has(id);

  const announce = (text: string, tone: StatusTone) => {
    setStatus((prev) => ({ text, tone, nonce: prev.nonce + 1 }));
  };

  const attempt = (leftId: string, rightId: string) => {
    setSelected(null);
    setHover(null);

    const correct = isMatchingPair(leftId, rightId);
    const leftText = textOf("left", leftId);
    const rightText = textOf("right", rightId);

    if (wrongTimerRef.current !== null) window.clearTimeout(wrongTimerRef.current);

    if (correct) {
      setWrong(null);
      announce(`${leftText} va con “${rightText}”. Par ${badgeOf(leftId)} resuelto.`, "ok");
    } else {
      // El error se ve y se deshace solo: dejarlo unido obligaria a un gesto de
      // mas para corregir algo que el tablero ya sabe que esta mal.
      setWrong({ leftId, rightId });
      announce(`${leftText} no va con “${rightText}”. La unión se deshizo.`, "bad");
      wrongTimerRef.current = window.setTimeout(() => {
        wrongTimerRef.current = null;
        setWrong(null);
      }, wrongFeedbackMs);
    }

    onMatch(matchLink(leftId, rightId), correct);
  };

  const activate = (side: MatchSide, id: string) => {
    if (isCardLocked(side, id)) return;

    if (selected === null) {
      setSelected({ side, id });
      const other = side === "left" ? rightLabel : leftLabel;
      announce(`Elegiste “${textOf(side, id)}”. Ahora tocá su pareja en ${other}.`, "info");
      return;
    }

    if (selected.side === side) {
      if (selected.id === id) {
        setSelected(null);
        announce("Selección cancelada.", "info");
        return;
      }
      setSelected({ side, id });
      announce(`Ahora tenés elegida “${textOf(side, id)}”.`, "info");
      return;
    }

    const leftId = side === "left" ? id : selected.id;
    const rightId = side === "left" ? selected.id : id;
    attempt(leftId, rightId);
  };

  /** Que tarjeta hay bajo el dedo. Por posicion, que es lo unico ya visible. */
  const hitTest = (x: number, y: number): { side: MatchSide; id: string } | null => {
    const element = document.elementFromPoint(x, y);
    const card = element?.closest<HTMLElement>("[data-match-side]");
    if (!card) return null;
    const side: MatchSide = card.dataset["matchSide"] === "right" ? "right" : "left";
    const index = Number(card.dataset["matchIndex"]);
    const pair = (side === "left" ? pairs : rights)[index];
    return pair ? { side, id: pair.id } : null;
  };

  const handlePointerDown = (
    side: MatchSide,
    id: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    skipClickRef.current = false;
    if (isCardLocked(side, id) || event.button > 0) return;
    pointerRef.current = {
      pointerId: event.pointerId,
      side,
      id,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    try {
      // Con captura, el gesto sigue vivo aunque el dedo salga de la tarjeta.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* si el navegador rechaza la captura, el arrastre igual funciona */
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = pointerRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (!gesture.moved && distance < DRAG_THRESHOLD_PX) return;
    gesture.moved = true;

    setDrag({ side: gesture.side, id: gesture.id, x: event.clientX, y: event.clientY });
    const target = hitTest(event.clientX, event.clientY);
    setHover(target && target.side !== gesture.side ? target.id : null);
  };

  const endGesture = () => {
    pointerRef.current = null;
    setDrag(null);
    setHover(null);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = pointerRef.current;
    endGesture();
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.moved) return; // fue un toque: lo resuelve el click

    skipClickRef.current = true;
    const target = hitTest(event.clientX, event.clientY);
    if (!target || target.side === gesture.side || isCardLocked(target.side, target.id)) {
      announce("Soltaste fuera de una tarjeta. No se unió nada.", "info");
      return;
    }

    const leftId = gesture.side === "left" ? gesture.id : target.id;
    const rightId = gesture.side === "left" ? target.id : gesture.id;
    attempt(leftId, rightId);
  };

  const handleClick = (side: MatchSide, id: string) => {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    activate(side, id);
  };

  const renderCard = (side: MatchSide, pair: MatchPair, index: number) => {
    const isMatched = (side === "left" ? matchedLeft : matchedRight).has(pair.id);
    const isSelected = selected !== null && selected.side === side && selected.id === pair.id;
    const isWrong = wrong !== null && (side === "left" ? wrong.leftId : wrong.rightId) === pair.id;
    const isTarget = drag !== null && drag.side !== side && hover === pair.id;
    const isDragging = drag !== null && drag.side === side && drag.id === pair.id;

    const state: CardState = isMatched
      ? "matched"
      : isWrong
        ? "wrong"
        : isSelected
          ? "selected"
          : isTarget
            ? "target"
            : "idle";
    const mark = CARD_MARK[state];
    const badge = isMatched || revealed ? badgeOf(pair.id) : null;
    const locked = isCardLocked(side, pair.id);

    return (
      <li key={pair.id}>
        <button
          type="button"
          data-match-side={side}
          data-match-index={index}
          className={`flex min-h-11 w-full touch-none select-none items-center gap-2 rounded-sn border p-3 text-left text-sm ${CARD_TONE[state]}`}
          style={{
            opacity: isDragging ? 0.5 : 1,
            transform: !reduced && state === "wrong" ? "translateX(4px)" : "none",
            transition: reduced
              ? "none"
              : "border-color var(--sn-dur-fast) var(--sn-ease), background var(--sn-dur-fast) var(--sn-ease), transform var(--sn-dur-fast) var(--sn-ease), opacity var(--sn-dur-fast) var(--sn-ease)",
          }}
          aria-pressed={locked ? undefined : isSelected}
          aria-disabled={locked || undefined}
          onClick={() => handleClick(side, pair.id)}
          onPointerDown={(event) => handlePointerDown(side, pair.id, event)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={endGesture}
        >
          {badge !== null && (
            <span
              className="sn-num flex size-5 shrink-0 items-center justify-center rounded-sn border border-sn-line text-[11px] text-sn-cyan"
              aria-hidden="true"
            >
              {badge}
            </span>
          )}
          <span className="min-w-0 flex-1">{side === "left" ? pair.left : pair.right}</span>
          {mark && (
            <span className={`shrink-0 text-xs ${MARK_TONE[state]}`}>
              <span aria-hidden="true">{mark.symbol}</span>
              <span className="sr-only">{mark.label}</span>
            </span>
          )}
          {badge !== null && <span className="sr-only">Par {badge}</span>}
        </button>
      </li>
    );
  };

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <p className="text-[11px] leading-snug text-sn-muted">
        Tocá una tarjeta de la izquierda y después su pareja de la derecha. También podés
        arrastrarla de una columna a la otra.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className="flex flex-col gap-2">
          <p id={`${uid}-left`} className="text-[11px] uppercase tracking-wider text-sn-dim">
            {leftLabel}
          </p>
          <ul className="flex flex-col gap-2" aria-labelledby={`${uid}-left`}>
            {pairs.map((pair, index) => renderCard("left", pair, index))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <p id={`${uid}-right`} className="text-[11px] uppercase tracking-wider text-sn-dim">
            {rightLabel}
          </p>
          <ul className="flex flex-col gap-2" aria-labelledby={`${uid}-right`}>
            {rights.map((pair, index) => renderCard("right", pair, index))}
          </ul>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="sn-num shrink-0 text-[11px] text-sn-muted">
          {matchedLeft.size} / {pairs.length} unidos
        </span>
        {/* El estado del tablero tiene que llegar tambien a quien no lo ve. */}
        <p
          role="status"
          aria-live="polite"
          className={`min-h-4 min-w-0 flex-1 text-right text-[11px] ${STATUS_TONE[status.tone]}`}
        >
          {/* La clave cambia en cada aviso: dos errores iguales seguidos se
              anuncian las dos veces, porque el nodo se reemplaza. */}
          <span key={status.nonce}>
            {status.text && (
              <span aria-hidden="true" className="mr-1">
                {STATUS_SYMBOL[status.tone]}
              </span>
            )}
            {status.text}
          </span>
        </p>
      </div>

      {drag !== null && (
        <div
          className="pointer-events-none fixed z-50 max-w-[min(16rem,70vw)] truncate rounded-sn border border-sn-cyan bg-sn-panel-hi px-3 py-2 text-xs text-sn-text"
          style={{
            left: drag.x,
            top: drag.y,
            transform: "translate(-50%, -150%)",
            boxShadow: "var(--sn-shadow-2)",
          }}
          aria-hidden="true"
        >
          {textOf(drag.side, drag.id)}
        </div>
      )}
    </div>
  );
}
