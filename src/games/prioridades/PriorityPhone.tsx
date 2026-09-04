import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameProps } from "@/core/contract/game";
import { bool } from "@/core/contract/settings";
import { useDeadline, usePrefersReducedMotion } from "@/core/corporate/hooks";
import { OrderList } from "@/core/corporate/OrderList";
import { RankingConsensus, RankingDivision } from "@/core/corporate/RankingStage";
import { buildDivisionRows } from "@/core/corporate/rankingChart";
import { createRng } from "@/core/engine/rng";
import { seatRejectionMessage } from "@/core/net/mockNet";
import { useGameNet } from "@/core/net/useGameNet";
import { buildPriorityDeck, orderedCards, priorityMeta } from "./logic";
import { ROOM_SEATS, type PriorityInput, type PriorityNetState } from "./room";

/**
 * C5 · Prioridades — el telefono.
 *
 * El celular **corre el juego**, no hace de mando. Ordenar ocho tarjetas pide
 * arrastre por asa, botones de subir y bajar, teclado y una region viva que
 * anuncie cada movimiento; nada de eso entra en un `ControlSpec`, y con un
 * mando cada movimiento seria un viaje de ida y vuelta a la sala. Asi que
 * `OrderList` se usa entero, tal como quedo en la tanda 3, y lo unico que viaja
 * por la red es el orden final: un mensaje por persona.
 *
 * Cuatro cosas que el telefono NO hace, y son las que sostienen el resultado:
 *
 * 1. No calcula nada. Manda ids y el proyector agrega.
 * 2. No dibuja resultados parciales, porque no los recibe: mientras la ronda
 *    esta abierta el estado que llega trae `result: null`.
 * 3. No inventa su orden inicial si el proyector dice otro. El orden sembrado
 *    tiene que ser el mismo para todos o el sesgo de anclaje ensucia el
 *    agregado.
 * 4. No manda nada al confirmar por primera vez y despues se olvida: reintenta
 *    hasta que la ronda cierra, porque un paquete perdido seria una persona
 *    menos en el consenso.
 */

/** Cada cuanto se reintenta el envio hasta que el proyector cierra la ronda. */
const RESEND_MS = 1500;
/** Tope de reintentos: si el proyector no esta, no se trata de insistir para siempre. */
const MAX_RESENDS = 24;
/** Mas filas que estas no se leen en un telefono. El resto va en la pantalla grande. */
const PHONE_DIVISION_ROWS = 3;

type Phase = "intro" | "sorting" | "confirm" | "sent";

export default function PriorityPhone({ config, signal, onFinish, onReady }: GameProps) {
  const uid = useId();
  const reduced = usePrefersReducedMotion();

  const deck = useMemo(
    () => buildPriorityDeck(config.settings, createRng(config.seed)),
    [config.settings, config.seed],
  );
  const showOwnOrder = bool(config.settings, "showOwnOrder", true);

  const [phase, setPhase] = useState<Phase>("intro");
  const [order, setOrder] = useState<readonly string[]>(deck.initialOrder);
  const [room, setRoom] = useState<PriorityNetState | null>(null);

  // El cierre por `force-end` corre desde un listener registrado una vez: lee
  // refs, no el estado congelado del montaje.
  const orderRef = useRef<readonly string[]>(deck.initialOrder);
  const startedAtRef = useRef(performance.now());
  const finishedRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** true en cuanto la persona movio una tarjeta: la lista no se le mueve sola. */
  const touchedRef = useRef(false);

  /* ---------------------------------------------------------------- */
  /* Red                                                               */
  /* ---------------------------------------------------------------- */

  const netHandle = useGameNet<PriorityInput, PriorityNetState>({
    roomId: config.roomId,
    // Lo elige el contenedor, igual que la sala: el celular entra por donde
    // dice el QR y el proyector tiene que estar en la misma red.
    transport: config.transport,
    role: "client",
    /* El proyector se queda con el asiento 0 del contenedor —es el que trae
       `isHost`— asi que las personas entran desde el 1 y aca se les descuenta:
       la sala usa los asientos 0..39 y entran las 40. */
    seat: Math.max(0, config.seat - 1),
    seats: ROOM_SEATS,
    onState: (state) => setRoom(state),
  });

  const netRef = useRef(netHandle.net);
  netRef.current = netHandle.net;
  const sequenceRef = useRef(0);

  const applyOrder = useCallback((next: readonly string[], fromPerson: boolean) => {
    if (fromPerson) touchedRef.current = true;
    orderRef.current = next;
    setOrder(next);
  }, []);

  const onReorder = useCallback((next: readonly string[]) => applyOrder(next, true), [applyOrder]);

  /**
   * El orden inicial lo fija el proyector.
   *
   * La semilla de la partida ya deberia dar el mismo orden en todos los
   * aparatos, pero el que manda es el host: si un telefono entro con otra
   * semilla, adopta la de la sala **mientras todavia no toco nada**. Moverle la
   * lista a alguien que ya esta ordenando seria peor que el problema.
   */
  const canonicalOrder = room?.initialOrder;
  useEffect(() => {
    if (touchedRef.current || phase === "sent" || !canonicalOrder || canonicalOrder.length === 0) {
      return;
    }
    const next = orderedCards(deck.cards, canonicalOrder).map((card) => card.id);
    if (next.join() === orderRef.current.join()) return;
    applyOrder(next, false);
  }, [applyOrder, canonicalOrder, deck.cards, phase]);

  /** Lo unico que sale del telefono: ocho ids. Nunca un puntaje ni un tiempo. */
  const submit = useCallback(() => {
    const port = netRef.current;
    if (!port) return;
    sequenceRef.current += 1;
    port.sendInput(
      {
        kind: "order",
        deck: deck.id,
        // Se completa antes de mandarlo, con la misma regla que arma el `meta`.
        order: orderedCards(deck.cards, orderRef.current).map((card) => card.id),
      },
      sequenceRef.current,
    );
  }, [deck.cards, deck.id]);

  /**
   * Reintento hasta que la ronda cierra.
   *
   * El host descarta el repetido del mismo aparato, asi que insistir es gratis
   * y es lo unico que evita que un paquete perdido —el simulador tira el 1 %—
   * borre a una persona del consenso.
   */
  const moment = room?.moment ?? null;
  useEffect(() => {
    if (phase !== "sent" || (moment !== null && moment !== "respondiendo")) return;
    submit();
    let left = MAX_RESENDS;
    const timer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(timer);
        return;
      }
      submit();
    }, RESEND_MS);
    return () => window.clearInterval(timer);
  }, [moment, phase, submit]);

  /* ---------------------------------------------------------------- */
  /* Cierre                                                            */
  /* ---------------------------------------------------------------- */

  const finish = useCallback(
    (completed: boolean) => {
      if (finishedRef.current) return; // el contrato pide exactamente una vez
      finishedRef.current = true;
      onFinish({
        completed,
        // Sin puntaje: no hay orden correcto, y puntuar una opinion meteria en
        // el ranking del tour un numero sin significado.
        points: 0,
        durationMs: Math.round(performance.now() - startedAtRef.current),
        meta: priorityMeta(deck, orderRef.current),
      });
    },
    [deck, onFinish],
  );

  const confirm = useCallback(() => {
    setPhase("sent");
    finish(true);
  }, [finish]);

  /* Forzar fin: emite lo ordenado hasta ahi, en el acto. No lo manda a la sala:
     un orden que la persona no confirmo no es una opinion, es el orden inicial
     con dos tarjetas movidas. */
  useEffect(() => {
    if (signal.aborted) {
      finish(false);
      return;
    }
    const onAbort = () => finish(false);
    signal.addEventListener("abort", onAbort);
    return () => signal.removeEventListener("abort", onAbort);
  }, [finish, signal]);

  useDeadline(
    config.durationMs,
    useCallback(() => finish(false), [finish]),
  );

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  /* Al entrar a ordenar el foco acompana; si no, queda en el body. */
  useEffect(() => {
    if (phase === "sorting") stageRef.current?.focus();
  }, [phase]);

  /* ---------------------------------------------------------------- */
  /* Pantallas                                                         */
  /* ---------------------------------------------------------------- */

  const cards = orderedCards(deck.cards, order);
  const anonymityNote = deck.anonymous
    ? "Tu orden se suma al del resto. Nadie ve cuál fue el tuyo."
    : "Tu orden se muestra junto a tu nombre.";

  /**
   * Dos telefonos con el mismo asiento.
   *
   * Pasa apenas dos personas escanean el mismo QR, y hay que resolverlo ANTES
   * de que alguien ordene: un aparato rechazado ordena las ocho tarjetas, toca
   * "Listo" y su orden no llega a ningun lado. Se ofrece antes de empezar y no
   * despues, que es cuando ya costaria trabajo.
   */
  if (phase === "intro" && netHandle.rejection) {
    const rejection = netHandle.rejection;
    return (
      <Shell>
        <div className="sn-card flex flex-col gap-4 p-6 text-center">
          <h2 className="text-lg text-sn-text">{seatRejectionMessage(rejection)}</h2>
          {rejection.freeSeats.length > 0 ? (
            <>
              <p className="text-sm text-sn-muted">Elegí otro lugar:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {rejection.freeSeats.slice(0, 12).map((free) => (
                  <button
                    key={free}
                    type="button"
                    className="sn-btn sn-btn--primary h-12 min-w-24"
                    onClick={() => netHandle.claimSeat(free)}
                  >
                    Lugar {free + 1}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-sn-muted">
              No quedan lugares libres. Avisale a quien está proyectando.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  if (phase === "intro") {
    return (
      <Shell>
        <div className="sn-card flex flex-col gap-4 p-6">
          <header className="flex flex-col gap-1 text-center">
            <span className="text-[11px] uppercase tracking-wider text-sn-dim">Prioridades</span>
            <h2 className="text-xl text-sn-text">{deck.title}</h2>
            <p className="text-sm text-sn-muted">{deck.prompt}</p>
          </header>

          <p className="text-sm text-sn-muted">
            Son {deck.cards.length} tarjetas y todas son buenas: por eso cuesta. Sin reloj y sin
            puntaje, es una reflexión y no una carrera.
          </p>

          <ul className="flex flex-col gap-1.5 rounded-sn border border-sn-line-soft bg-sn-bg-elev p-3 text-xs text-sn-text">
            <li>
              <span aria-hidden="true">⠿</span> Arrastrá desde el asa de la izquierda.
            </li>
            <li>
              <span aria-hidden="true">▲ ▼</span> O movelas con los botones de cada fila.
            </li>
            <li>
              Con teclado: <kbd className="sn-num">Espacio</kbd> toma la fila, las flechas la mueven.
            </li>
          </ul>

          <p className="rounded-sn border border-sn-line-soft bg-sn-bg-elev p-3 text-xs text-sn-text">
            {anonymityNote}
          </p>

          <button
            type="button"
            className="sn-btn sn-btn--primary h-11 w-full"
            onClick={() => setPhase("sorting")}
            autoFocus
          >
            Empezar
          </button>

          <p className="text-center text-[11px] text-sn-dim">{connectionNote(netHandle.status)}</p>
        </div>
      </Shell>
    );
  }

  if (phase === "sorting") {
    return (
      <Shell>
        <div ref={stageRef} tabIndex={-1} className="flex flex-col gap-3 rounded-sn-lg">
          <header className="flex flex-col gap-1">
            <h2 id={`${uid}-prompt`} className="text-base leading-snug text-sn-text sm:text-lg">
              {deck.prompt}
            </h2>
            <p className="text-xs text-sn-muted">
              Arriba lo más importante. No hay respuesta correcta ni puntaje.
            </p>
          </header>

          <OrderList items={cards} onReorder={onReorder} labelledBy={`${uid}-prompt`} />
        </div>

        <footer className="flex items-center gap-2">
          <span className="text-[11px] text-sn-dim">{anonymityNote}</span>
          <button
            type="button"
            className="sn-btn sn-btn--primary ml-auto h-11 min-w-32"
            onClick={() => setPhase("confirm")}
          >
            Listo
          </button>
        </footer>
      </Shell>
    );
  }

  if (phase === "confirm") {
    return (
      <Shell>
        <div className="sn-card flex flex-col gap-4 p-5">
          <header className="flex flex-col gap-1">
            <h2 className="text-lg text-sn-text">¿Mandás este orden?</h2>
            <p className="text-sm text-sn-muted">Después no se puede cambiar.</p>
          </header>

          <OrderSummary cards={cards} />

          <div className="flex flex-wrap gap-2">
            <button type="button" className="sn-btn h-11 flex-1" onClick={() => setPhase("sorting")}>
              Volver a ordenar
            </button>
            <button
              type="button"
              className="sn-btn sn-btn--primary h-11 flex-1"
              onClick={confirm}
              autoFocus
            >
              Sí, mandarlo
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  /* Mandado. Primero la espera, y cuando el proyector cierra, el resultado. */
  const result = room?.result ?? null;

  if (!result) {
    const missing = room ? Math.max(0, room.eligible - room.answered) : null;
    return (
      <Shell>
        <div className="sn-card flex flex-col gap-4 p-6 text-center" aria-live="polite">
          <h2 className="text-xl text-sn-text">Gracias</h2>
          {room ? (
            <>
              <p className="sn-num text-4xl font-semibold text-sn-cyan">
                {room.answered} <span className="text-sn-dim">de</span> {room.eligible}
              </p>
              <p className="text-sm text-sn-muted">
                {missing === 0
                  ? "Ya ordenaron todos. Mirá la pantalla grande."
                  : missing === 1
                    ? "Falta 1 persona."
                    : `Faltan ${missing} personas.`}
              </p>
            </>
          ) : (
            <p className="text-sm text-sn-muted">
              Tu orden ya viajó. El consenso del equipo aparece en la pantalla grande cuando
              terminen todos.
            </p>
          )}

          {showOwnOrder && <OrderSummary cards={cards} />}

          <p className="text-[11px] text-sn-dim">Ordenar no puntúa: no cambia el ranking.</p>
        </div>
      </Shell>
    );
  }

  const rows = buildDivisionRows(result, { limit: PHONE_DIVISION_ROWS });

  return (
    <Shell>
      <div className="flex flex-col gap-5" aria-live="polite">
        <header className="text-center">
          <span className="text-[11px] uppercase tracking-wider text-sn-dim">El consenso</span>
          <h2 className="text-lg text-sn-text">{deck.prompt}</h2>
        </header>

        <RankingConsensus items={result.items} reduced={reduced} />

        <header className="text-center">
          <span className="text-[11px] uppercase tracking-wider text-sn-dim">La división</span>
          <p className="text-sm text-sn-muted">Donde el equipo está más repartido.</p>
        </header>

        <RankingDivision rows={rows} size={deck.cards.length} reduced={reduced} />

        <p className="text-center text-[11px] text-sn-dim">
          Están las {deck.cards.length} en la pantalla grande. Ordenar no puntúa.
        </p>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */

function connectionNote(status: string): string {
  if (status === "live") return "Conectado con el proyector.";
  if (status === "reconnecting") return "Reconectando con el proyector…";
  return "Buscando el proyector…";
}

function OrderSummary({ cards }: { cards: ReadonlyArray<{ id: string; label: string }> }) {
  return (
    <ol className="flex flex-col gap-1.5 text-left">
      {cards.map((card, index) => (
        <li
          key={card.id}
          className="flex items-center gap-2 rounded-sn border border-sn-line-soft bg-sn-bg-elev p-2 text-sm text-sn-text"
        >
          <span className="sn-num w-5 shrink-0 text-center text-xs text-sn-cyan">{index + 1}</span>
          <span className="min-w-0 flex-1 leading-snug">{card.label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * El scroll vive afuera y el centrado adentro: un flex centrado que ademas
 * scrollea recorta el principio del contenido cuando no entra, y con ocho
 * tarjetas en un telefono chico no siempre entra.
 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="sn-scroll-y h-full w-full">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-4 p-4">
        {children}
      </div>
    </div>
  );
}
