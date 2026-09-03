import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameProps } from "@/core/contract/game";
import { createRng } from "@/core/engine/rng";
import { QuestionCard, QuestionProgress } from "@/core/corporate/QuestionCard";
import { useDeadline } from "@/core/corporate/hooks";
import {
  emptyValue,
  isAnswered,
  type Answer,
  type AnswerMap,
  type AnswerValue,
} from "@/core/corporate/question.types";
import { buildSurveyDeck, formatAnswer, pendingIndexes, surveyMeta } from "./logic";

/**
 * C3 · Pulso del equipo
 *
 * Una encuesta que no se siente una encuesta: una pregunta por pantalla,
 * progreso visible y micro-respuesta al avanzar.
 *
 * No puntua: `points: 0` con `completed: true`. Un formulario que reparte
 * puntos mete en el ranking un numero que no significa nada y, peor, incentiva
 * contestar rapido en vez de contestar en serio. El valor son las respuestas,
 * que viajan en `meta`.
 */
export default function FormularioVivoGame({ config, signal, onFinish, onReady }: GameProps) {
  const deck = useMemo(
    () => buildSurveyDeck(config.settings, createRng(config.seed)),
    [config.settings, config.seed],
  );
  const questions = deck.questions;

  const [phase, setPhase] = useState<"intro" | "playing" | "review" | "done">("intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [draft, setDraft] = useState<AnswerValue>(null);
  const [saved, setSaved] = useState(false);

  // El cierre por `force-end` corre desde un listener registrado una vez: lee
  // refs, no el estado congelado del montaje.
  const answersRef = useRef<AnswerMap>({});
  const startedAtRef = useRef(performance.now());
  const shownAtRef = useRef(performance.now());
  const finishedRef = useRef(false);
  const savedTimerRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const finish = useCallback(
    (completed: boolean) => {
      if (finishedRef.current) return; // el contrato pide exactamente una vez
      finishedRef.current = true;
      setPhase("done");
      onFinish({
        completed,
        points: 0,
        durationMs: Math.round(performance.now() - startedAtRef.current),
        meta: surveyMeta(questions, answersRef.current, deck.anonymous),
      });
    },
    [deck.anonymous, onFinish, questions],
  );

  /* Forzar fin: emite lo respondido hasta ahi, en el acto. */
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

  useEffect(
    () => () => {
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    },
    [],
  );

  /* Al cambiar de pregunta el foco la acompana; si no, queda en el body. */
  useEffect(() => {
    if (phase === "playing") stageRef.current?.focus();
  }, [phase, index]);

  const question = questions[index];

  /** Carga en el borrador lo que ya haya respondido para esa pregunta. */
  const openAt = (next: number) => {
    const target = questions[next];
    if (!target) return;
    const previous = answersRef.current[target.id];
    setDraft(previous && !previous.skipped ? previous.value : emptyValue(target));
    shownAtRef.current = performance.now();
    setIndex(next);
    setPhase("playing");
  };

  const store = (skipped: boolean) => {
    if (!question) return;
    const answer: Answer = {
      questionId: question.id,
      value: skipped ? emptyValue(question) : draft,
      elapsedMs: Math.round(performance.now() - shownAtRef.current),
      skipped,
    };
    const next: AnswerMap = { ...answersRef.current, [question.id]: answer };
    answersRef.current = next;
    setAnswers(next);
  };

  const flashSaved = () => {
    setSaved(true);
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => {
      savedTimerRef.current = null;
      setSaved(false);
    }, 900);
  };

  const advance = (skipped: boolean) => {
    store(skipped);
    if (!skipped) flashSaved();

    const next = index + 1;
    if (next < questions.length) {
      openAt(next);
      return;
    }
    // Al final se puede volver a las salteadas antes de enviar.
    const pending = pendingIndexes(questions, answersRef.current);
    if (pending.length > 0 && deck.allowSkip) {
      setPhase("review");
      return;
    }
    finish(true);
  };

  const start = () => {
    startedAtRef.current = performance.now();
    openAt(0);
  };

  const answeredCount = questions.filter((item) => {
    const answer = answers[item.id];
    return Boolean(answer && !answer.skipped && isAnswered(item, answer.value));
  }).length;

  const lowTime = remainingMs !== null && remainingMs <= 20_000;
  const anonymityNote = deck.anonymous
    ? "Tus respuestas se muestran sumadas al resto. Nadie ve cuál fue la tuya."
    : "Tus respuestas se muestran junto a tu nombre.";

  /* ---------------------------------------------------------------- */

  if (phase === "intro") {
    return (
      <Shell>
        <div className="sn-card flex flex-col gap-4 p-6 text-center">
          <h2 className="text-xl text-sn-text">Pulso del equipo</h2>
          <p className="text-sm text-sn-muted">
            {questions.length} preguntas cortas. Sin reloj y sin puntaje.
          </p>
          <p className="rounded-sn border border-sn-line-soft bg-sn-bg-elev p-3 text-xs text-sn-text">
            {anonymityNote}
          </p>
          <button
            type="button"
            className="sn-btn sn-btn--primary h-11 w-full"
            onClick={start}
            autoFocus
            disabled={questions.length === 0}
          >
            Empezar
          </button>
        </div>
      </Shell>
    );
  }

  if (phase === "playing" && question) {
    const ready = isAnswered(question, draft);
    const canSkip = deck.allowSkip && !question.required;
    const last = index === questions.length - 1;

    return (
      <Shell>
        <QuestionProgress
          current={index + 1}
          total={questions.length}
          answeredCount={answeredCount}
        />

        <div ref={stageRef} tabIndex={-1} className="rounded-sn-lg">
          <QuestionCard
            item={question}
            value={draft}
            onAnswer={setDraft}
            note={question.required ? "Esta no se puede saltear." : undefined}
          />
        </div>

        <footer className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="sn-btn sn-btn--ghost h-11"
            onClick={() => openAt(index - 1)}
            disabled={index === 0}
          >
            Atrás
          </button>
          {canSkip && (
            <button type="button" className="sn-btn h-11" onClick={() => advance(true)}>
              Saltear
            </button>
          )}
          <button
            type="button"
            className="sn-btn sn-btn--primary ml-auto h-11 min-w-32"
            onClick={() => advance(false)}
            disabled={!ready}
          >
            {last ? "Terminar" : "Siguiente"}
          </button>
        </footer>

        <div className="flex min-h-5 items-center justify-between gap-3" aria-live="polite">
          <span className="text-[11px] text-sn-dim">{anonymityNote}</span>
          {saved && (
            <span
              className="sn-chip text-sn-success"
              style={{ transition: "opacity var(--sn-dur) var(--sn-ease)" }}
            >
              <span aria-hidden="true">✓</span> Guardada
            </span>
          )}
        </div>

        {lowTime && (
          <p className="sn-num text-center text-xs text-sn-warn" aria-live="polite">
            Quedan {Math.ceil((remainingMs ?? 0) / 1000)} s
          </p>
        )}
      </Shell>
    );
  }

  if (phase === "review") {
    const pending = pendingIndexes(questions, answers);
    return (
      <Shell>
        <div className="sn-card flex flex-col gap-4 p-6" aria-live="polite">
          <h2 className="text-lg text-sn-text">
            Te quedaron {pending.length} sin responder
          </h2>
          <ul className="flex flex-col gap-1.5">
            {pending.map((position) => {
              const item = questions[position];
              if (!item) return null;
              return (
                <li key={item.id} className="flex items-baseline gap-2 text-xs text-sn-muted">
                  <span className="sn-num text-sn-dim">{position + 1}</span>
                  <span className="min-w-0 flex-1">{item.prompt}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sn-btn sn-btn--primary h-11 flex-1"
              onClick={() => openAt(pending[0] ?? 0)}
              autoFocus
            >
              Volver a las salteadas
            </button>
            <button type="button" className="sn-btn h-11" onClick={() => finish(true)}>
              Enviar así
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="sn-card flex flex-col gap-4 p-6" aria-live="polite">
        <header className="text-center">
          <h2 className="text-xl text-sn-text">Gracias</h2>
          <p className="text-sm text-sn-muted">
            {answeredCount} de {questions.length} respondidas. Tus respuestas ya se sumaron al
            resto.
          </p>
        </header>

        {deck.showOwnSummary && (
          <ul className="flex flex-col gap-2">
            {questions.map((item) => {
              const answer = answers[item.id];
              const done = Boolean(answer && !answer.skipped && isAnswered(item, answer.value));
              return (
                <li
                  key={item.id}
                  className="rounded-sn border border-sn-line-soft bg-sn-bg-elev p-3 text-xs"
                >
                  <p className="text-sn-muted">{item.prompt}</p>
                  <p className={done ? "text-sn-text" : "text-sn-dim"}>
                    {done && answer ? formatAnswer(item, answer.value) : "Salteada"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-center text-[11px] text-sn-dim">
          Esta encuesta no puntúa: no cambia el ranking.
        </p>
      </div>
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
