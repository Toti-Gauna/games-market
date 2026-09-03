import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { usePrefersReducedMotion } from "./hooks";

/**
 * El renderer de ordenamiento compartido.
 *
 * Tres caminos de entrada, los tres de primera clase:
 *
 * 1. Arrastrar DESDE EL ASA. Si arrastrara la fila entera, la lista no se
 *    podria scrollear en un telefono: al intentar bajar se agarra una tarjeta.
 *    El asa separa las dos intenciones y es la unica zona con
 *    `touch-action: none`.
 * 2. Botones de subir y bajar en cada fila. No son un fallback: arrastrar no
 *    funciona con teclado, no funciona bien con lector de pantalla y es dificil
 *    con movilidad reducida. Una pantalla que solo se completa arrastrando deja
 *    gente afuera.
 * 3. Teclado: Tab recorre las filas, Espacio toma, flechas mueven, Espacio
 *    suelta, Escape cancela.
 *
 * Las props son de dominio (items, onReorder, disabled, labelledBy) y no de un
 * juego puntual: lo usan Prioridades y cualquier pregunta `order` del
 * formulario vivo.
 */

/** Con mas de ocho, ordenar deja de ser una decision y pasa a ser una tarea. */
export const MAX_ORDER_ITEMS = 8;

export type OrderListItem = {
  id: string;
  label: string;
  /** Segunda linea, mas chica. */
  hint?: string;
};

export type OrderListProps = {
  /** En el orden actual, de primero a ultimo. Componente controlado. */
  items: readonly OrderListItem[];
  onReorder: (ids: readonly string[]) => void;
  disabled?: boolean;
  /** id del encabezado que nombra a la lista. */
  labelledBy?: string;
  className?: string;
};

/** Distancia al borde del contenedor donde arranca el auto-scroll. */
const EDGE_PX = 56;
/** Techo de px por frame. Mas rapido que esto se pasa de largo. */
const EDGE_SPEED_PX = 14;
/** Espacio de ancho cero: no se ve ni se lee, solo hace distinto al anuncio. */
const ZERO_WIDTH = "​";

type DragState = {
  pointerId: number;
  /** Indice actual del item arrastrado: cambia durante el arrastre. */
  index: number;
  /** Distancia del dedo al borde superior de la fila al agarrarla. */
  grabOffset: number;
  /** Transform vertical aplicado en el ultimo render. */
  dy: number;
  clientY: number;
  scroller: HTMLElement | null;
  handle: Element;
};

function moveItem(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}

/** El ancestro que realmente scrollea. null = scrollea el documento. */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    const scrolls = overflowY === "auto" || overflowY === "scroll";
    if (scrolls && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
}

function scrollBounds(scroller: HTMLElement | null): { top: number; bottom: number } {
  if (!scroller) return { top: 0, bottom: window.innerHeight };
  const rect = scroller.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
}

function scrollByPx(scroller: HTMLElement | null, delta: number): void {
  if (scroller) scroller.scrollTop += delta;
  else window.scrollBy(0, delta);
}

export function OrderList({
  items,
  onReorder,
  disabled = false,
  labelledBy,
  className = "",
}: OrderListProps) {
  const uid = useId();
  const reduced = usePrefersReducedMotion();

  const visible = items.slice(0, MAX_ORDER_ITEMS);
  const total = visible.length;

  const listRef = useRef<HTMLOListElement | null>(null);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);
  /** Desde donde salio la fila tomada con teclado, para que Escape la devuelva. */
  const originRef = useRef<number | null>(null);
  const updateRef = useRef<() => void>(() => {});

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragDy, setDragDy] = useState(0);
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  /**
   * Dos movimientos seguidos pueden generar el mismo texto y una region viva
   * no repite lo identico. El espacio de ancho cero alterna y garantiza que
   * cada anuncio sea un cambio.
   */
  const announce = (text: string) => {
    setMessage((prev) => (prev.endsWith(ZERO_WIDTH) ? text : `${text}${ZERO_WIDTH}`));
  };

  const positionText = (label: string, index: number) =>
    `${label}, posición ${index + 1} de ${total}`;

  const emitMove = (from: number, to: number) => {
    if (disabled || from === to || to < 0 || to >= total) return;
    // Lo que exceda el maximo no se dibuja, pero tampoco se pierde: vuelve al
    // final para que el llamador reciba siempre su lista completa.
    const tail = items.slice(MAX_ORDER_ITEMS).map((item) => item.id);
    onReorder([...moveItem(visible.map((item) => item.id), from, to), ...tail]);
  };

  const focusRow = (index: number) => {
    if (index < 0 || index >= total) return;
    rowRefs.current[index]?.focus();
  };

  /* ---------------------------------------------------------------- */
  /* Arrastre                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Se recalcula contra el layout real en cada evento, asi que se corrige sola:
   * cuando la fila cambia de puesto el transform se reajusta y la tarjeta sigue
   * pegada al dedo. Nunca asume que todas las filas midan lo mismo.
   */
  const updateDrag = () => {
    const drag = dragRef.current;
    const list = listRef.current;
    if (!drag || !list) return;

    const rows: Array<{ top: number; height: number }> = [];
    for (let i = 0; i < total; i += 1) {
      const node = rowRefs.current[i];
      if (!node) return;
      const rect = node.getBoundingClientRect();
      // A la arrastrada se le descuenta el transform para leer su lugar de layout.
      rows.push({ top: i === drag.index ? rect.top - drag.dy : rect.top, height: rect.height });
    }

    const own = rows[drag.index];
    if (!own) return;

    const listRect = list.getBoundingClientRect();
    const wanted = drag.clientY - drag.grabOffset - own.top;
    const dy = Math.max(
      listRect.top - own.top,
      Math.min(listRect.bottom - (own.top + own.height), wanted),
    );

    let target = 0;
    for (let i = 0; i < total; i += 1) {
      const row = rows[i];
      if (row && drag.clientY > row.top + row.height / 2) target = i;
    }

    if (target !== drag.index) {
      const from = drag.index;
      const to = rows[target];
      if (!to) return;
      // Donde va a quedar el borde superior una vez reordenada la lista. Sin
      // esta correccion la fila pegaria un salto de un puesto por cada cambio.
      const nextTop = target > from ? to.top + to.height - own.height : to.top;
      const nextDy = dy + own.top - nextTop;
      drag.dy = nextDy;
      drag.index = target;
      setDragDy(nextDy);
      setDragIndex(target);
      emitMove(from, target);
      const item = visible[from];
      if (item) announce(positionText(item.label, target));
      return;
    }

    drag.dy = dy;
    setDragDy(dy);
  };

  useEffect(() => {
    updateRef.current = updateDrag;
  });

  const stopAutoScroll = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const autoScrollStep = () => {
    const drag = dragRef.current;
    if (!drag) {
      rafRef.current = null;
      return;
    }
    const bounds = scrollBounds(drag.scroller);
    let delta = 0;
    if (drag.clientY < bounds.top + EDGE_PX) {
      const ratio = Math.min(1, (bounds.top + EDGE_PX - drag.clientY) / EDGE_PX);
      delta = -EDGE_SPEED_PX * ratio;
    } else if (drag.clientY > bounds.bottom - EDGE_PX) {
      const ratio = Math.min(1, (drag.clientY - (bounds.bottom - EDGE_PX)) / EDGE_PX);
      delta = EDGE_SPEED_PX * ratio;
    }
    if (delta !== 0) {
      scrollByPx(drag.scroller, delta);
      updateRef.current();
    }
    rafRef.current = requestAnimationFrame(autoScrollStep);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    stopAutoScroll();
    dragRef.current = null;
    setDragIndex(null);
    setDragDy(0);
    const item = visible[drag.index];
    if (item) announce(`${item.label} queda en la posición ${drag.index + 1} de ${total}`);
  };

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLSpanElement>, index: number) => {
    if (disabled || dragRef.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const row = rowRefs.current[index];
    if (!row) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setGrabbedId(null);
    originRef.current = null;

    dragRef.current = {
      pointerId: event.pointerId,
      index,
      grabOffset: event.clientY - row.getBoundingClientRect().top,
      dy: 0,
      clientY: event.clientY,
      scroller: findScrollParent(row),
      handle: event.currentTarget,
    };
    setDragIndex(index);
    setDragDy(0);
    stopAutoScroll();
    rafRef.current = requestAnimationFrame(autoScrollStep);
  };

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.clientY = event.clientY;
    updateDrag();
  };

  const onHandlePointerUp = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.handle.hasPointerCapture(event.pointerId)) {
      drag.handle.releasePointerCapture(event.pointerId);
    }
    endDrag();
  };

  useEffect(() => stopAutoScroll, []);

  /* ---------------------------------------------------------------- */
  /* Teclado                                                            */
  /* ---------------------------------------------------------------- */

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLLIElement>, index: number) => {
    const item = visible[index];
    if (!item || disabled) return;
    const grabbed = grabbedId === item.id;

    switch (event.key) {
      case " ":
      case "Spacebar": {
        event.preventDefault(); // el espacio scrollea la pagina si se lo deja pasar
        if (grabbed) {
          setGrabbedId(null);
          originRef.current = null;
          announce(`${item.label} soltada en la posición ${index + 1} de ${total}`);
          return;
        }
        setGrabbedId(item.id);
        originRef.current = index;
        announce(`${item.label} tomada. Movela con las flechas y soltala con Espacio`);
        return;
      }

      case "ArrowUp":
      case "ArrowDown": {
        event.preventDefault();
        const to = index + (event.key === "ArrowUp" ? -1 : 1);
        if (!grabbed) {
          // Sin tomar, las flechas solo recorren: mover sin querer una lista
          // que se estaba leyendo seria peor que no poder moverla.
          focusRow(to);
          return;
        }
        if (to < 0 || to >= total) return;
        emitMove(index, to);
        announce(positionText(item.label, to));
        return;
      }

      case "Home":
      case "End": {
        if (!grabbed) return;
        event.preventDefault();
        const to = event.key === "Home" ? 0 : total - 1;
        emitMove(index, to);
        announce(positionText(item.label, to));
        return;
      }

      case "Escape": {
        if (!grabbed) return;
        event.preventDefault();
        const origin = originRef.current ?? index;
        emitMove(index, origin);
        setGrabbedId(null);
        originRef.current = null;
        announce(`Movimiento cancelado. ${positionText(item.label, origin)}`);
        return;
      }

      default:
        return;
    }
  };

  const onButtonMove = (index: number, delta: number) => {
    const item = visible[index];
    const to = index + delta;
    if (!item || to < 0 || to >= total) return;
    emitMove(index, to);
    announce(positionText(item.label, to));
    // El foco viaja con la tarjeta: si se quedara en el boton, al llegar al
    // borde el boton se deshabilita y el foco se cae al body.
    requestAnimationFrame(() => focusRow(to));
  };

  /* ---------------------------------------------------------------- */

  return (
    <div className={className}>
      <ol
        ref={listRef}
        aria-labelledby={labelledBy}
        className={`flex flex-col gap-2 ${dragIndex !== null ? "select-none" : ""}`}
      >
        {visible.map((item, index) => {
          const dragging = dragIndex === index;
          const grabbed = grabbedId === item.id;
          const lifted = dragging || grabbed;

          return (
            <li
              key={item.id}
              ref={(node) => {
                rowRefs.current[index] = node;
              }}
              tabIndex={disabled ? -1 : 0}
              aria-label={positionText(item.label, index)}
              aria-describedby={`${uid}-help`}
              aria-roledescription="fila ordenable"
              onKeyDown={(event) => onRowKeyDown(event, index)}
              onBlur={() => {
                if (grabbed) {
                  setGrabbedId(null);
                  originRef.current = null;
                }
              }}
              className={`relative flex min-h-14 touch-pan-y items-center gap-2 rounded-sn border bg-sn-bg-elev p-1.5 text-sm text-sn-text ${
                lifted ? "border-sn-cyan bg-sn-panel-hi" : "border-sn-line-soft"
              } ${disabled ? "opacity-60" : ""}`}
              style={{
                transform: dragging ? `translateY(${dragDy}px)` : undefined,
                boxShadow: lifted ? "var(--sn-shadow-2)" : undefined,
                zIndex: lifted ? 2 : undefined,
                transition:
                  dragging || reduced
                    ? "none"
                    : "border-color var(--sn-dur-fast) var(--sn-ease), background var(--sn-dur-fast) var(--sn-ease)",
              }}
            >
              <span
                aria-hidden="true"
                onPointerDown={(event) => onHandlePointerDown(event, index)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
                className={`flex size-11 shrink-0 items-center justify-center rounded-sn text-base text-sn-muted ${
                  disabled ? "" : "cursor-grab hover:bg-sn-panel active:cursor-grabbing"
                }`}
                // Solo el asa bloquea el gesto nativo. El resto de la fila sigue
                // scrolleando la lista con el dedo.
                style={{ touchAction: disabled ? "auto" : "none" }}
              >
                ⠿
              </span>

              <span
                className="sn-num w-5 shrink-0 text-center text-xs text-sn-cyan"
                aria-hidden="true"
              >
                {index + 1}
              </span>

              <span className="min-w-0 flex-1 leading-snug">
                {item.label}
                {item.hint && <span className="block text-xs text-sn-muted">{item.hint}</span>}
              </span>

              {grabbed && (
                <span className="sn-chip shrink-0 text-sn-cyan" aria-hidden="true">
                  Tomada
                </span>
              )}

              {/*
                Fuera del recorrido de Tab a proposito: Tab recorre las FILAS,
                que ya tienen el camino completo por teclado. Con los botones
                adentro cada fila costaria tres tabuladas y ordenar ocho serian
                veinticuatro. Siguen operables con dedo, mouse y lector.
              */}
              <button
                type="button"
                tabIndex={-1}
                className="sn-btn sn-btn--ghost size-11 shrink-0 px-0"
                onClick={() => onButtonMove(index, -1)}
                disabled={disabled || index === 0}
                aria-label={`Subir ${item.label}`}
              >
                <span aria-hidden="true">▲</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                className="sn-btn sn-btn--ghost size-11 shrink-0 px-0"
                onClick={() => onButtonMove(index, 1)}
                disabled={disabled || index === total - 1}
                aria-label={`Bajar ${item.label}`}
              >
                <span aria-hidden="true">▼</span>
              </button>
            </li>
          );
        })}
      </ol>

      <p id={`${uid}-help`} className="sr-only">
        Arrastrá desde el asa, usá los botones de subir y bajar, o con el teclado: Espacio toma la
        fila, las flechas la mueven, Espacio la suelta y Escape cancela.
      </p>

      {/* Cada movimiento se anuncia: sin esto, ordenar a ciegas es imposible. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </div>
  );
}
