import { useEffect, useId, useState } from "react";
import {
  emptyValue,
  isAnswered,
  type AnswerValue,
  type MatchPair,
  type Question,
  type QuestionOption,
} from "./question.types";
import { isCorrect } from "./scoring";
import { MatchBoard } from "./MatchBoard";
import { OrderList, type OrderListItem } from "./OrderList";
import { usePrefersReducedMotion } from "./hooks";

/**
 * La tarjeta que dibuja CUALQUIER item corporativo.
 *
 * Las props son del dominio (item, value, onAnswer, revealed) y no de un juego
 * puntual: la misma tarjeta la usan el test de perfil, el formulario vivo, el
 * trivia y el verdadero/falso. Un juego que necesite algo propio lo pone
 * alrededor, no adentro.
 *
 * La tarjeta SOLO dibuja. No corrige ni puntua: eso vive en scoring.ts.
 * `revealed` decide cuando se puede mostrar el resultado; mientras sea false,
 * conviene pasarle `publicQuestion(item)` para que la respuesta correcta ni
 * siquiera llegue al componente.
 */

export type QuestionCardClassNames = {
  root?: string;
  header?: string;
  prompt?: string;
  help?: string;
  options?: string;
  option?: string;
  status?: string;
};

export type QuestionCardProps = {
  item: Question;
  /** Lo respondido hasta ahora. null = sin responder. */
  value: AnswerValue;
  onAnswer: (value: AnswerValue) => void;
  /** true = ya se puede mostrar si estuvo bien o mal. */
  revealed?: boolean;
  disabled?: boolean;
  /** Posicion dentro del cuestionario, 1-based. Solo para el encabezado. */
  index?: number;
  total?: number;
  /** Texto opcional debajo del enunciado, por encima del `help` del item. */
  note?: string;
  className?: string;
  classNames?: QuestionCardClassNames;
};


/** Barra de progreso compartida. Numeros tabulares para que no tiemble. */
export function QuestionProgress({
  current,
  total,
  answeredCount,
  className = "",
}: {
  /** 1-based. */
  current: number;
  total: number;
  /** Cuantas se respondieron, si el juego distingue respondidas de vistas. */
  answeredCount?: number;
  className?: string;
}) {
  const safeTotal = Math.max(1, total);
  const done = answeredCount ?? current - 1;
  const pct = Math.round((Math.min(done, safeTotal) / safeTotal) * 100);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="sn-num text-xs text-sn-muted">
          {current} / {safeTotal}
        </span>
        {answeredCount !== undefined && (
          <span className="text-[11px] text-sn-dim">{answeredCount} respondidas</span>
        )}
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-sn bg-sn-panel"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuenow={Math.min(done, safeTotal)}
        aria-label="Progreso del cuestionario"
      >
        <div
          className="h-full rounded-sn bg-sn-cyan"
          style={{ width: `${pct}%`, transition: "width var(--sn-dur) var(--sn-ease)" }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

type OptionState = "idle" | "chosen" | "correct" | "wrong";

const OPTION_TONE: Record<OptionState, string> = {
  idle: "border-sn-line-soft bg-sn-bg-elev hover:border-sn-violet-400 hover:bg-sn-panel",
  chosen: "border-sn-cyan bg-sn-panel-hi",
  correct: "border-sn-success bg-sn-panel-hi",
  wrong: "border-sn-danger bg-sn-panel-hi",
};

/** Nunca solo color: cada estado tambien tiene simbolo y texto. */
const OPTION_MARK: Record<OptionState, { symbol: string; label: string } | null> = {
  idle: null,
  chosen: { symbol: "•", label: "Tu respuesta" },
  correct: { symbol: "✓", label: "Correcta" },
  wrong: { symbol: "✕", label: "Incorrecta" },
};

function OptionMark({ state }: { state: OptionState }) {
  const mark = OPTION_MARK[state];
  if (!mark) return null;
  const tone =
    state === "correct" ? "text-sn-success" : state === "wrong" ? "text-sn-danger" : "text-sn-cyan";
  return (
    <span className={`ml-auto flex shrink-0 items-center gap-1 text-[11px] ${tone}`}>
      <span aria-hidden="true">{mark.symbol}</span>
      {mark.label}
    </span>
  );
}

export function QuestionCard({
  item,
  value,
  onAnswer,
  revealed = false,
  disabled = false,
  index,
  total,
  note,
  className = "",
  classNames = {},
}: QuestionCardProps) {
  const uid = useId();
  const groupName = `${uid}-${item.id}`;
  const reduced = usePrefersReducedMotion();
  const locked = disabled || revealed;

  // Entrada lateral suave por pregunta. Con reduced-motion, cambio directo.
  const [entered, setEntered] = useState(reduced);
  useEffect(() => {
    if (reduced) {
      setEntered(true);
      return;
    }
    setEntered(false);
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [item.id, reduced]);

  const answered = isAnswered(item, value);
  const verdict = revealed ? isCorrect(item, value) : null;

  const status = !revealed
    ? answered
      ? "Respondida"
      : ""
    : verdict === true
      ? "Respuesta correcta"
      : verdict === false
        ? "Respuesta incorrecta"
        : "Respuesta registrada";

  const stateOf = (optionId: string, chosen: boolean): OptionState => {
    if (!revealed) return chosen ? "chosen" : "idle";
    const correctIds = normalizeCorrect(item);
    if (correctIds === null) return chosen ? "chosen" : "idle";
    if (correctIds.includes(optionId)) return "correct";
    return chosen ? "wrong" : "idle";
  };

  return (
    <section
      className={`sn-card flex flex-col gap-4 p-4 sm:p-5 ${className} ${classNames.root ?? ""}`}
      aria-labelledby={`${uid}-prompt`}
      style={{
        opacity: entered ? 1 : 0,
        transform: entered || reduced ? "none" : "translateX(14px)",
        transition: reduced
          ? "none"
          : "opacity var(--sn-dur) var(--sn-ease), transform var(--sn-dur) var(--sn-ease)",
      }}
    >
      <header className={`flex flex-col gap-1.5 ${classNames.header ?? ""}`}>
        {index !== undefined && total !== undefined && (
          <span className="sn-num text-[11px] uppercase tracking-wider text-sn-dim">
            Pregunta {index} de {total}
          </span>
        )}
        <h3
          id={`${uid}-prompt`}
          className={`text-base leading-snug text-sn-text sm:text-lg ${classNames.prompt ?? ""}`}
        >
          {item.prompt}
        </h3>
        {(note ?? item.help) && (
          <p className={`text-xs leading-snug text-sn-muted ${classNames.help ?? ""}`}>
            {note ?? item.help}
          </p>
        )}
      </header>

      <QuestionBody
        item={item}
        value={value}
        onAnswer={onAnswer}
        locked={locked}
        revealed={revealed}
        groupName={groupName}
        uid={uid}
        stateOf={stateOf}
        classNames={classNames}
      />

      {/* Un lector de pantalla tiene que enterarse del cambio de estado. */}
      <p
        className={`min-h-4 text-[11px] ${
          verdict === true ? "text-sn-success" : verdict === false ? "text-sn-danger" : "text-sn-dim"
        } ${classNames.status ?? ""}`}
        aria-live="polite"
      >
        {status}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function normalizeCorrect(item: Question): readonly string[] | null {
  switch (item.kind) {
    case "single":
      return typeof item.correct === "string" ? [item.correct] : null;
    case "multiple":
    case "order":
      return Array.isArray(item.correct) ? item.correct : null;
    default:
      return null;
  }
}

type BodyProps = {
  item: Question;
  value: AnswerValue;
  onAnswer: (value: AnswerValue) => void;
  locked: boolean;
  /** Unir pares muestra la solucion de lo que quedo suelto; el resto solo se bloquea. */
  revealed: boolean;
  groupName: string;
  uid: string;
  stateOf: (optionId: string, chosen: boolean) => OptionState;
  classNames: QuestionCardClassNames;
};

function QuestionBody(props: BodyProps) {
  switch (props.item.kind) {
    case "single":
      return <SingleBody {...props} options={props.item.options} />;
    case "multiple":
      return <MultipleBody {...props} options={props.item.options} />;
    case "boolean":
      return <BooleanBody {...props} labels={props.item.labels} />;
    case "scale":
      return (
        <ScaleBody
          {...props}
          min={props.item.min}
          max={props.item.max}
          minLabel={props.item.minLabel}
          maxLabel={props.item.maxLabel}
        />
      );
    case "text":
      return (
        <TextBody {...props} maxLength={props.item.maxLength} placeholder={props.item.placeholder} />
      );
    case "order":
      return <OrderBody {...props} options={props.item.options} />;
    case "match":
      return (
        <MatchBody {...props} pairs={props.item.pairs} rightOrder={props.item.rightOrder} />
      );
  }
}

const OPTION_BASE =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-sn border p-3 text-left text-sm text-sn-text";

const OPTION_TRANSITION = {
  transition: "border-color var(--sn-dur-fast) var(--sn-ease), background var(--sn-dur-fast) var(--sn-ease)",
} as const;

function SingleBody({
  options,
  value,
  onAnswer,
  locked,
  groupName,
  stateOf,
  classNames,
}: BodyProps & { options: readonly QuestionOption[] }) {
  return (
    <fieldset className={`flex flex-col gap-2 ${classNames.options ?? ""}`} disabled={locked}>
      <legend className="sr-only">Elegí una opción</legend>
      {options.map((option) => {
        const chosen = value === option.id;
        const state = stateOf(option.id, chosen);
        return (
          <label
            key={option.id}
            className={`${OPTION_BASE} ${OPTION_TONE[state]} ${classNames.option ?? ""}`}
            style={OPTION_TRANSITION}
          >
            <input
              type="radio"
              name={groupName}
              value={option.id}
              checked={chosen}
              onChange={() => onAnswer(option.id)}
              className="size-4 shrink-0 accent-sn-violet-400"
            />
            <span className="min-w-0 flex-1">
              {option.label}
              {option.hint && <span className="block text-xs text-sn-muted">{option.hint}</span>}
            </span>
            <OptionMark state={state} />
          </label>
        );
      })}
    </fieldset>
  );
}

function MultipleBody({
  options,
  value,
  onAnswer,
  locked,
  stateOf,
  classNames,
}: BodyProps & { options: readonly QuestionOption[] }) {
  const chosenIds = Array.isArray(value) ? (value as readonly string[]) : [];

  const toggle = (optionId: string) => {
    const next = chosenIds.includes(optionId)
      ? chosenIds.filter((id) => id !== optionId)
      : [...chosenIds, optionId];
    onAnswer(next);
  };

  return (
    <fieldset className={`flex flex-col gap-2 ${classNames.options ?? ""}`} disabled={locked}>
      <legend className="sr-only">Elegí todas las que apliquen</legend>
      {options.map((option) => {
        const chosen = chosenIds.includes(option.id);
        const state = stateOf(option.id, chosen);
        return (
          <label
            key={option.id}
            className={`${OPTION_BASE} ${OPTION_TONE[state]} ${classNames.option ?? ""}`}
            style={OPTION_TRANSITION}
          >
            <input
              type="checkbox"
              checked={chosen}
              onChange={() => toggle(option.id)}
              className="size-4 shrink-0 accent-sn-violet-400"
            />
            <span className="min-w-0 flex-1">{option.label}</span>
            <OptionMark state={state} />
          </label>
        );
      })}
    </fieldset>
  );
}

function BooleanBody({
  value,
  onAnswer,
  locked,
  groupName,
  item,
  classNames,
  labels,
}: BodyProps & { labels?: { yes: string; no: string } }) {
  const yes = labels?.yes ?? "Verdadero";
  const no = labels?.no ?? "Falso";
  const correct = item.kind === "boolean" ? item.correct : undefined;

  const cell = (label: string, boolValue: boolean) => {
    const chosen = value === boolValue;
    const state: OptionState =
      correct === undefined || correct === null
        ? chosen
          ? "chosen"
          : "idle"
        : correct === boolValue
          ? "correct"
          : chosen
            ? "wrong"
            : "idle";
    return (
      <label
        key={label}
        className={`${OPTION_BASE} justify-center sm:flex-1 ${OPTION_TONE[state]} ${classNames.option ?? ""}`}
        style={OPTION_TRANSITION}
      >
        <input
          type="radio"
          name={groupName}
          checked={chosen}
          onChange={() => onAnswer(boolValue)}
          className="size-4 shrink-0 accent-sn-violet-400"
        />
        <span>{label}</span>
      </label>
    );
  };

  return (
    <fieldset
      className={`flex flex-col gap-2 sm:flex-row ${classNames.options ?? ""}`}
      disabled={locked}
    >
      <legend className="sr-only">Verdadero o falso</legend>
      {cell(yes, true)}
      {cell(no, false)}
    </fieldset>
  );
}

function ScaleBody({
  value,
  onAnswer,
  locked,
  groupName,
  min,
  max,
  minLabel,
  maxLabel,
  classNames,
}: BodyProps & { min: number; max: number; minLabel?: string; maxLabel?: string }) {
  const steps: number[] = [];
  for (let step = min; step <= max; step += 1) steps.push(step);

  return (
    <fieldset className={`flex flex-col gap-2 ${classNames.options ?? ""}`} disabled={locked}>
      <legend className="sr-only">
        Elegí un valor de {min} a {max}
      </legend>
      <div className="flex gap-2">
        {steps.map((step) => {
          const chosen = value === step;
          return (
            <label
              key={step}
              className={`flex min-h-11 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-sn border p-2 ${
                chosen ? "border-sn-cyan bg-sn-panel-hi" : OPTION_TONE.idle
              } ${classNames.option ?? ""}`}
              style={OPTION_TRANSITION}
            >
              <input
                type="radio"
                name={groupName}
                checked={chosen}
                onChange={() => onAnswer(step)}
                className="sr-only"
              />
              <span className={`sn-num text-base ${chosen ? "text-sn-cyan" : "text-sn-muted"}`}>
                {step}
              </span>
            </label>
          );
        })}
      </div>
      {(minLabel ?? maxLabel) && (
        <div className="flex justify-between gap-3 text-[11px] text-sn-dim">
          <span>{minLabel}</span>
          <span className="text-right">{maxLabel}</span>
        </div>
      )}
    </fieldset>
  );
}

function TextBody({
  value,
  onAnswer,
  locked,
  uid,
  maxLength,
  placeholder,
  classNames,
}: BodyProps & { maxLength?: number; placeholder?: string }) {
  const text = typeof value === "string" ? value : "";
  const limit = maxLength ?? 80;

  return (
    <div className={`flex flex-col gap-1.5 ${classNames.options ?? ""}`}>
      <label className="sr-only" htmlFor={`${uid}-text`}>
        Tu respuesta
      </label>
      <input
        id={`${uid}-text`}
        type="text"
        className="sn-input h-11"
        value={text}
        maxLength={limit}
        placeholder={placeholder}
        disabled={locked}
        autoComplete="off"
        onChange={(event) => onAnswer(event.target.value)}
      />
      <span className="sn-num self-end text-[11px] text-sn-dim">
        {text.length} / {limit}
      </span>
    </div>
  );
}

function OrderBody({
  options,
  value,
  onAnswer,
  locked,
  item,
  classNames,
}: BodyProps & { options: readonly QuestionOption[] }) {
  const current = Array.isArray(value)
    ? (value as readonly string[])
    : (emptyValue(item) as readonly string[]);

  // Solo ids conocidos y sin faltantes: un id viejo guardado no puede dejar la
  // lista incompleta.
  const ids = [
    ...current.filter((id) => options.some((option) => option.id === id)),
    ...options.map((option) => option.id).filter((id) => !current.includes(id)),
  ];

  // La mecanica de ordenar vive en OrderList: arrastre por el asa (la fila
  // entera sigue scrolleando), botones que son el camino accesible y no un
  // fallback, y teclado completo con anuncio por region viva. La estreno
  // Prioridades (C5) y desde aca la hereda cualquier pregunta de ordenar.
  const listItems: OrderListItem[] = ids.flatMap((id) => {
    const option = options.find((candidate) => candidate.id === id);
    return option ? [{ id: option.id, label: option.label }] : [];
  });

  return (
    <OrderList
      items={listItems}
      onReorder={onAnswer}
      disabled={locked}
      className={classNames.options ?? ""}
    />
  );
}

/**
 * Unir pares. La tarjeta no reimplementa nada: monta el mismo tablero que usa
 * el juego Memoria de valores y solo traduce su aviso a una respuesta.
 *
 * Guarda unicamente las uniones que cerraron bien, asi que la respuesta ya es
 * el parcial: cinco pares unidos son cinco elementos en la lista.
 */
function MatchBody({
  value,
  onAnswer,
  locked,
  revealed,
  pairs,
  rightOrder,
  classNames,
}: BodyProps & { pairs: readonly MatchPair[]; rightOrder?: readonly string[] }) {
  const links = Array.isArray(value) ? (value as readonly string[]) : [];

  return (
    <MatchBoard
      className={classNames.options ?? ""}
      pairs={pairs}
      rightOrder={rightOrder}
      matched={links}
      disabled={locked}
      revealed={revealed}
      onMatch={(link, correct) => {
        if (!correct || links.includes(link)) return;
        onAnswer([...links, link]);
      }}
    />
  );
}
