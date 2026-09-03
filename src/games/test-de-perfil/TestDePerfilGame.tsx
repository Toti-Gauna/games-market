import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameProps } from "@/core/contract/game";
import { createRng } from "@/core/engine/rng";
import { QuestionCard, QuestionProgress } from "@/core/corporate/QuestionCard";
import { useDeadline } from "@/core/corporate/hooks";
import {
  publicQuestion,
  type Answer,
  type AnswerMap,
  type AnswerValue,
} from "@/core/corporate/question.types";
import { aggregateProfile, type ProfileResult } from "@/core/corporate/scoring";
import { buildProfileDeck, describeProfile, findArchetype, profileMeta } from "./logic";

/**
 * C2 - Test de perfil ("Como trabajas?")
 *
 * Doce situaciones de trabajo, cinco arquetipos, sin puntaje y sin reloj
 * visible. Todo el motor esta en core/corporate: aca solo viven el avance, el
 * cierre y la pantalla de resultado.
 *
 * `points: 0` a proposito. Nadie "gana" un test de perfil, y repartir puntos
 * ensuciaria el ranking del tour con un numero que no significa nada. El valor
 * viaja en `meta`.
 */
export default function TestDePerfilGame({ config, signal, onFinish, onReady }: GameProps) {
  const deck = useMemo(
    () => buildProfileDeck(config.settings, createRng(config.seed)),
    [config.settings, config.seed],
  );
  const questions = deck.questions;
  const dimensions = useMemo(() => deck.archetypes.map((archetype) => archetype.id), [deck]);

  const [phase, setPhase] = useState<"intro" | "playing" | "done">("intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [result, setResult] = useState<ProfileResult | null>(null);

  // El estado que lee el cierre por `force-end` va en refs: el listener se
  // registra una vez y tiene que ver lo ultimo respondido, no lo del montaje.
  const answersRef = useRef<AnswerMap>({});
  const startedAtRef = useRef(performance.now());
  const shownAtRef = useRef(performance.now());
  const finishedRef = useRef(false);
  const advanceRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const finish = useCallback(
    (completed: boolean) => {
      if (finishedRef.current) return; // el contrato pide exactamente una vez
      finishedRef.current = true;

      const tally = aggregateProfile(questions, answersRef.current, dimensions, {
        closeMargin: deck.closeMargin,
      });
      setResult(tally);
      setPhase("done");
      onFinish({
        completed,
        points: 0,
        durationMs: Math.round(performance.now() - startedAtRef.current),
        meta: profileMeta(tally, deck.archetypes, questions.length),
      });
    },
    [deck, dimensions, onFinish, questions],
  );

  /* Forzar fin: emite el parcial en el acto. */
  useEffect(() => {
    if (signal.aborted) {
      finish(false);
      return;
    }
    const onAbort = () => finish(false);
    signal.addEventListener("abort", onAbort);
    return () => signal.removeEventListener("abort", onAbort);
  }, [finish, signal]);

  const remainingMs = useDeadline(
    config.durationMs,
    useCallback(() => finish(false), [finish]),
  );

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  /* Un timeout huerfano avanzaria sobre un componente desmontado. */
  useEffect(
    () => () => {
      if (advanceRef.current !== null) window.clearTimeout(advanceRef.current);
    },
    [],
  );

  /* Tras avanzar, el foco vuelve a la pregunta: si no, queda en el body. */
  useEffect(() => {
    if (phase === "playing") stageRef.current?.focus();
  }, [phase, index]);

  const clearPendingAdvance = () => {
    if (advanceRef.current === null) return;
    window.clearTimeout(advanceRef.current);
    advanceRef.current = null;
  };

  const goTo = (next: number) => {
    clearPendingAdvance();
    if (next >= questions.length) {
      finish(true);
      return;
    }
    shownAtRef.current = performance.now();
    setIndex(Math.max(0, next));
  };

  const question = questions[index];

  const handleAnswer = (value: AnswerValue) => {
    if (!question) return;

    const answer: Answer = {
      questionId: question.id,
      value,
      elapsedMs: Math.round(performance.now() - shownAtRef.current),
      skipped: false,
    };
    const next: AnswerMap = { ...answersRef.current, [question.id]: answer };
    answersRef.current = next;
    setAnswers(next);

    // La tarjeta queda marcada un instante y pasa sola: son doce preguntas y un
    // toque de mas por pregunta se nota.
    clearPendingAdvance();
    const target = index + 1;
    if (deck.autoAdvanceMs <= 0) {
      goTo(target);
      return;
    }
    advanceRef.current = window.setTimeout(() => {
      advanceRef.current = null;
      goTo(target);
    }, deck.autoAdvanceMs);
  };

  const start = () => {
    shownAtRef.current = performance.now();
    setPhase("playing");
  };

  const lowTime = remainingMs !== null && remainingMs <= 20_000;

  /* ---------------------------------------------------------------- */

  if (phase === "intro") {
    return (
      <Shell>
        <div className="sn-card flex flex-col gap-4 p-6 text-center">
          <h2 className="text-xl text-sn-text">¿Cómo trabajás?</h2>
          <p className="text-sm text-sn-muted">
            {questions.length} situaciones de trabajo. No hay respuestas correctas ni puntaje: al
            final ves tu perfil y la mezcla completa.
          </p>
          <button type="button" className="sn-btn sn-btn--primary h-11 w-full" onClick={start} autoFocus>
            Empezar
          </button>
        </div>
      </Shell>
    );
  }

  if (phase === "playing" && question) {
    return (
      <Shell>
        <QuestionProgress
          current={index + 1}
          total={questions.length}
          answeredCount={Object.keys(answers).length}
        />

        <div ref={stageRef} tabIndex={-1} className="rounded-sn-lg">
          <QuestionCard
            item={publicQuestion(question)}
            value={answers[question.id]?.value ?? null}
            onAnswer={handleAnswer}
          />
        </div>

        <footer className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="sn-btn sn-btn--ghost h-11"
            onClick={() => goTo(index - 1)}
            disabled={!deck.allowBack || index === 0}
          >
            Atrás
          </button>
          <span className="text-[11px] text-sn-dim">Elegí lo que más se parezca a vos.</span>
        </footer>

        {lowTime && (
          <p className="sn-num text-center text-xs text-sn-warn" aria-live="polite">
            Quedan {Math.ceil((remainingMs ?? 0) / 1000)} s
          </p>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <ProfileSummary result={result} deck={deck} answered={Object.keys(answers).length} />
    </Shell>
  );
}

/* ------------------------------------------------------------------ */

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-xl flex-col justify-center gap-4 p-4">
      {children}
    </div>
  );
}

function ProfileSummary({
  result,
  deck,
  answered,
}: {
  result: ProfileResult | null;
  deck: ReturnType<typeof buildProfileDeck>;
  answered: number;
}) {
  if (!result) return null;

  const { headline, description } = describeProfile(result, deck.archetypes);
  const ranking = deck.showMix ? result.ranking : result.ranking.slice(0, 1);

  return (
    <div className="sn-card flex flex-col gap-5 p-6" aria-live="polite">
      <header className="flex flex-col items-center gap-2 text-center">
        <span className="sn-chip">Tu perfil</span>
        <h2 className="text-2xl text-sn-cyan">{headline}</h2>
        {description && <p className="text-sm text-sn-muted">{description}</p>}
      </header>

      {ranking.length > 0 && (
        <ul className="flex flex-col gap-2">
          {ranking.map((row, position) => {
            const archetype = findArchetype(deck.archetypes, row.id);
            const top = position === 0;
            return (
              <li key={row.id} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-xs text-sn-text">
                  {archetype?.name ?? row.id}
                </span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-sn bg-sn-panel">
                  <span
                    className={`block h-full rounded-sn ${top ? "bg-sn-cyan" : "bg-sn-violet-400"}`}
                    style={{ width: `${row.percent}%`, transition: "width var(--sn-dur-slow) var(--sn-ease)" }}
                  />
                </span>
                <span className="sn-num w-10 shrink-0 text-right text-xs text-sn-muted">
                  {row.percent}%
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-center text-[11px] text-sn-dim">
        {answered} de {deck.questions.length} situaciones respondidas. Este test no puntúa: no hay
        perfiles mejores ni peores.
      </p>
    </div>
  );
}
