import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NetPlayer } from "@/core/contract/gameNet";
import type { GameProps } from "@/core/contract/game";
import { num } from "@/core/contract/settings";
import { useDeadline, usePrefersReducedMotion } from "@/core/corporate/hooks";
import type { RankingAggregate } from "@/core/corporate/ranking";
import {
  RankingConsensus,
  RankingDivision,
  RankingRoster,
  RankingStage,
} from "@/core/corporate/RankingStage";
import { buildDivisionRows } from "@/core/corporate/rankingChart";
import { createRng } from "@/core/engine/rng";
import { useGameNet } from "@/core/net/useGameNet";
import { buildPriorityDeck } from "./logic";
import {
  createPriorityRoom,
  projectorMeta,
  receiveOrder,
  roomAggregate,
  roomState,
  ROOM_SEATS,
  type PriorityInput,
  type PriorityMoment,
  type PriorityNetState,
} from "./room";

/**
 * C5 · Prioridades — el proyector.
 *
 * Es la mitad que faltaba del juego: la spec dice que el valor no esta en
 * jugarlo sino en lo que aparece despues en la pantalla grande, y hasta ahora
 * esa pantalla no existia porque el consenso necesita muchas respuestas de
 * mucha gente y no habia red.
 *
 * El proyector es el host autoritativo (`role: "host"`, `seat: -1`): no juega,
 * junta. Lo unico que entra por la red es un orden de ids por telefono; las
 * medias, el desvio y el item mas dividido los calcula aca `aggregateRanking`.
 * Un cliente modificado no tiene por donde mandar un resultado ya hecho.
 *
 * Tres momentos, y el tercero es el producto:
 *
 * 1. **Mientras responden.** El contador y quienes ya mandaron. Ni un
 *    resultado parcial: ver el consenso a medias cambia lo que ordena el que
 *    todavia no contesto. La regla vive en el protocolo —el estado difundido
 *    lleva `result: null` mientras la ronda esta abierta— y no en la vista.
 * 2. **El consenso.** Las ocho tarjetas se acomodan en su orden promedio.
 * 3. **La division.** El grafico de dispersion por item, ordenado por desvio.
 *    Ahi se para la conversacion.
 *
 * Sin reloj y sin puntaje. Cierra el host con un boton, o se cierra solo cuando
 * ya respondieron todos los que estan en la sala.
 */

/** Cada cuanto se reenvia el estado, para el que escanea el QR tarde. */
const BROADCAST_MS = 1000;
/** Respiro despues de la ultima respuesta: que alcance a ver su "gracias". */
const ALL_IN_HOLD_MS = 1200;
/**
 * Cuantas respuestas hacen falta para que la ronda se cierre sola.
 *
 * Sin este piso, la primera persona que entra y ordena rapido cierra la ronda
 * para toda la sala mientras el resto todavia esta escaneando el QR. Ademas un
 * "consenso" de una sola respuesta no es un consenso: el desvio da cero en todo
 * y la pantalla que importa queda vacia. Con menos que esto cierra el host.
 */
const MIN_AUTO_CLOSE = 2;
/** Mas filas de dispersion que estas no entran en una pantalla de sala. */
const DIVISION_ROWS = 5;
/** `broadcastState` completa los acks desde los asientos: no hay que armarlos. */
const EMPTY_ACKS: Readonly<Record<string, number>> = {};

export default function PriorityProjector({ config, signal, onFinish, onReady }: GameProps) {
  const reduced = usePrefersReducedMotion();

  /* El conjunto y la sala se arman una sola vez, con el PRNG sembrado por
     `config.seed`: el orden inicial que ve la sala es el mismo para todos. */
  const [engine] = useState(() => {
    const deck = buildPriorityDeck(config.settings, createRng(config.seed));
    return { deck, room: createPriorityRoom(deck) };
  });
  const { deck, room } = engine;

  const consensusHoldMs = Math.max(0, num(config.settings, "consensusHoldSec", 12)) * 1000;
  const divisionHoldMs = Math.max(0, num(config.settings, "divisionHoldSec", 0)) * 1000;

  const [moment, setMoment] = useState<PriorityMoment>("respondiendo");
  const [answered, setAnswered] = useState(0);
  const [arrivals, setArrivals] = useState<readonly string[]>([]);
  const [result, setResult] = useState<RankingAggregate | null>(null);

  /* El estado se difunde desde un intervalo registrado una vez: lee refs, no el
     estado congelado del montaje. */
  const momentRef = useRef<PriorityMoment>("respondiendo");
  const resultRef = useRef<RankingAggregate | null>(null);
  const eligibleRef = useRef(0);
  const broadcastRef = useRef<() => void>(() => {});
  const playersRef = useRef<Map<string, NetPlayer>>(new Map());
  const startedAtRef = useRef(performance.now());
  const finishedRef = useRef(false);

  /* ---------------------------------------------------------------- */
  /* Red                                                               */
  /* ---------------------------------------------------------------- */

  /**
   * La unica puerta por la que entra algo de un celular, y lo unico que acepta
   * es "este es mi orden". `receiveOrder` valida la forma, sanea los ids contra
   * las tarjetas de la sala y descarta el segundo mensaje del mismo aparato,
   * que es lo que hace cierto el "despues no se puede cambiar".
   */
  const netHandle = useGameNet<PriorityInput, PriorityNetState>({
    roomId: config.roomId,
    role: "host",
    // -1 = el proyector no juega. Los 40 asientos son todos de la sala.
    seat: -1,
    seats: ROOM_SEATS,
    name: "Proyector",

    onInput: (playerId, input) => {
      const player = playersRef.current.get(playerId);
      // Los bots que le guardan el lugar a la gente no opinan.
      if (player?.bot) return;
      if (momentRef.current !== "respondiendo") return;
      if (receiveOrder(room, playerId, player?.name ?? "Alguien", input) !== "accepted") return;

      setAnswered(room.entries.size);
      // En una ronda anonima `arrivals` esta vacio y sigue estandolo: el nombre
      // no se guardo, asi que no hay nada que copiar.
      setArrivals([...room.arrivals]);
    },
  });

  /* El indice del roster se refresca en el render y no en un efecto: si fuera
     en un efecto quedaria un render atrasado, y el orden de quien acaba de
     entrar se proyectaria como "Alguien". */
  playersRef.current = useMemo(
    () => new Map(netHandle.players.map((player) => [player.id, player])),
    [netHandle.players],
  );

  /** La sala son las personas. Los bots llenan asientos, no cuentan. */
  const eligible = useMemo(
    () => netHandle.players.reduce((count, player) => (player.bot ? count : count + 1), 0),
    [netHandle.players],
  );
  eligibleRef.current = eligible;

  const netPort = netHandle.net;
  useEffect(() => {
    if (!netPort) {
      broadcastRef.current = () => {};
      return;
    }
    let tick = 0;
    const push = () => {
      tick += 1;
      netPort.broadcastState(
        roomState(room, momentRef.current, eligibleRef.current, resultRef.current),
        tick,
        EMPTY_ACKS,
      );
    };
    broadcastRef.current = push;
    push();
    // El reenvio periodico es para quien escanea el QR a mitad de la ronda: el
    // puerto no le guarda el ultimo estado como si le guarda el ultimo control.
    const timer = window.setInterval(push, BROADCAST_MS);
    return () => {
      window.clearInterval(timer);
      broadcastRef.current = () => {};
    };
  }, [netPort, room]);

  /* Lo que cambia para la sala sale en el acto, sin esperar al intervalo. */
  useEffect(() => {
    broadcastRef.current();
  }, [answered, moment]);

  /* ---------------------------------------------------------------- */
  /* Los tres momentos                                                 */
  /* ---------------------------------------------------------------- */

  /** Cierra la ronda y calcula el agregado. Una sola vez. */
  const close = useCallback(() => {
    if (momentRef.current !== "respondiendo") return;
    const aggregate = roomAggregate(room);
    momentRef.current = "consenso";
    resultRef.current = aggregate;
    setResult(aggregate);
    setMoment("consenso");
  }, [room]);

  const showDivision = useCallback(() => {
    if (momentRef.current !== "consenso") return;
    momentRef.current = "division";
    setMoment("division");
  }, []);

  /* Ya respondieron todos los que estan en la sala: no hay a quien esperar. */
  useEffect(() => {
    if (moment !== "respondiendo" || eligible === 0) return;
    if (answered < eligible || answered < MIN_AUTO_CLOSE) return;
    const timer = window.setTimeout(close, ALL_IN_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [answered, close, eligible, moment]);

  useEffect(() => {
    if (moment !== "consenso") return;
    const timer = window.setTimeout(showDivision, consensusHoldMs);
    return () => window.clearTimeout(timer);
  }, [consensusHoldMs, moment, showDivision]);

  /* ---------------------------------------------------------------- */
  /* Cierre                                                            */
  /* ---------------------------------------------------------------- */

  const finish = useCallback(
    (completed: boolean) => {
      if (finishedRef.current) return; // el contrato pide exactamente una vez
      finishedRef.current = true;
      const aggregate = resultRef.current ?? roomAggregate(room);
      onFinish({
        completed,
        // El proyector tampoco puntua: puntuar una opinion ensuciaria el ranking.
        points: 0,
        durationMs: Math.round(performance.now() - startedAtRef.current),
        meta: projectorMeta(room, aggregate),
      });
    },
    [onFinish, room],
  );

  /* La division se queda en pantalla mientras el host la necesite. Con el
     administrable en 0 no se corta sola: ahi es donde pasa la conversacion. */
  useEffect(() => {
    if (moment !== "division" || divisionHoldMs <= 0) return;
    const timer = window.setTimeout(() => finish(true), divisionHoldMs);
    return () => window.clearTimeout(timer);
  }, [divisionHoldMs, finish, moment]);

  /* Forzar fin: emite lo acumulado hasta ahi, en el acto. */
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

  /* ---------------------------------------------------------------- */
  /* Pantalla                                                          */
  /* ---------------------------------------------------------------- */

  const rows = useMemo(
    () => (result ? buildDivisionRows(result, { limit: DIVISION_ROWS }) : []),
    [result],
  );

  if (moment === "respondiendo") {
    return (
      <RankingStage
        eyebrow="Mientras responden"
        title={deck.prompt}
        headline={
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              className="sn-btn sn-btn--primary h-11 px-6 text-[clamp(0.8rem,1.1vw,1.1rem)]"
              onClick={close}
              disabled={answered === 0}
            >
              Cerrar y mostrar
            </button>
            <span className="text-[clamp(0.65rem,0.9vw,0.9rem)] text-sn-dim">
              {answered === 0
                ? "Se habilita con la primera respuesta"
                : "O se cierra solo cuando respondan todos"}
            </span>
          </div>
        }
        footer={
          <p className="text-center text-[clamp(0.75rem,1.1vw,1.1rem)] text-sn-dim">
            Sala <span className="sn-num text-sn-muted">{config.roomId}</span> · sin reloj: es una
            reflexión, no una carrera.
          </p>
        }
      >
        <RankingRoster
          names={arrivals}
          answered={answered}
          eligible={eligible}
          anonymous={deck.anonymous}
          reduced={reduced}
        />
      </RankingStage>
    );
  }

  if (!result) return null;

  if (moment === "consenso") {
    return (
      <RankingStage
        eyebrow="El consenso"
        title={deck.prompt}
        headline={
          <div className="flex items-center gap-4">
            <ResponseCount responses={result.responses} />
            <button
              type="button"
              className="sn-btn h-11 px-5 text-[clamp(0.8rem,1.1vw,1.1rem)]"
              onClick={showDivision}
            >
              Ver la división
            </button>
          </div>
        }
        footer={
          <p className="text-center text-[clamp(0.8rem,1.3vw,1.4rem)] text-sn-muted">
            Un ranking promedio es un dato tibio. Lo que abre conversación viene ahora.
          </p>
        }
      >
        <RankingConsensus
          items={result.items}
          initialOrder={deck.initialOrder}
          reduced={reduced}
        />
      </RankingStage>
    );
  }

  const hidden = Math.max(0, result.items.filter((item) => item.samples > 0).length - rows.length);

  return (
    <RankingStage
      eyebrow="La división"
      title="Acá no se ponen de acuerdo"
      headline={
        <div className="flex items-center gap-4">
          <ResponseCount responses={result.responses} />
          <button
            type="button"
            className="sn-btn h-11 px-5 text-[clamp(0.8rem,1.1vw,1.1rem)]"
            onClick={() => finish(true)}
          >
            Terminar
          </button>
        </div>
      }
      footer={
        <p className="text-center text-[clamp(0.75rem,1.1vw,1.1rem)] text-sn-dim">
          Ordenado por desvío: arriba está donde el equipo se parte al medio.
          {hidden > 0 && ` Quedan ${hidden} tarjetas con menos desacuerdo.`}
        </p>
      }
    >
      <RankingDivision rows={rows} size={deck.cards.length} reduced={reduced} />
    </RankingStage>
  );
}

/* ------------------------------------------------------------------ */

function ResponseCount({ responses }: { responses: number }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="sn-num text-[clamp(1.6rem,4vw,4rem)] font-semibold leading-none text-sn-cyan">
        {responses}
      </span>
      <span className="text-[clamp(0.7rem,1.1vw,1.1rem)] uppercase tracking-[0.16em] text-sn-dim">
        {responses === 1 ? "respuesta" : "respuestas"}
      </span>
    </span>
  );
}
