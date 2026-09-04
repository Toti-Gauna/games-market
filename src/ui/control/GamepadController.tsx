import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ControlButton,
  ControlHaptic,
  ControlInput,
  ControlOption,
  ControlSlider,
  ControlSpec,
  ControlStatus,
  OptionShape,
  StrokePoint,
} from "@/core/contract/control";
import { SKETCH_ASPECT } from "@/core/contract/control";
import { prefersReducedMotion } from "@/core/engine/palette";
import { vibrate } from "@/core/engine/audio";
import { clampToTable, cueBallOf, overlapsBall, projectAim } from "./aim";
import { useWakeLock } from "./useWakeLock";

/**
 * El celular como control.
 *
 * No sabe nada de ningun juego: el host le manda un `ControlSpec` y esto lo
 * dibuja. La misma pantalla sirve para la paleta de Pong y para los botones de
 * la trivia, y para lo que venga.
 *
 * Lo que decide si se siente bien no es la red:
 *
 *  - `touch-action: none` en toda la superficie. Sin eso el navegador se come
 *    el gesto para scrollear y el control no responde.
 *  - **Feedback local inmediato**: lo tocado se marca sin esperar al host. La
 *    sensacion de latencia se combate aca, no en el netcode.
 *  - Input a 30 Hz en la paleta: el dedo no se mueve mas rapido y son la mitad
 *    de los paquetes.
 */

export type GamepadControllerProps = {
  spec: ControlSpec;
  seat: number;
  onInput: (input: ControlInput) => void;
  status?: string;
  connected: boolean;
};

/** 30 Hz. Ver comentario del encabezado. */
const SEND_INTERVAL_MS = 1000 / 30;

const SEAT_COLOR = ["var(--sn-cyan-400)", "var(--sn-magenta-400)", "var(--sn-violet-300)", "var(--sn-warn)"];
const OPTION_COLOR = ["var(--sn-cyan-400)", "var(--sn-magenta-400)", "var(--sn-violet-400)", "var(--sn-warn)"];

export function GamepadController({ spec, seat, onInput, status, connected }: GamepadControllerProps) {
  useWakeLock(connected);
  const accent = SEAT_COLOR[seat % SEAT_COLOR.length] ?? "var(--sn-cyan-400)";

  return (
    <div className="flex h-full w-full flex-col overscroll-none bg-sn-bg">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm font-medium" style={{ color: accent }}>
          Jugador {seat + 1}
        </span>
        <span className="sn-chip" aria-live="polite">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: connected ? "var(--sn-success)" : "var(--sn-warn)" }}
          />
          {status ?? (connected ? "Conectado" : "Conectando…")}
        </span>
      </header>

      {spec.layout === "wait" && <WaitBody message={spec.message} />}
      {spec.layout === "paddle" && (
        <PaddleBody accent={accent} orientation={spec.orientation} onInput={onInput} />
      )}
      {spec.layout === "buttons" && <ButtonsBody spec={spec} onInput={onInput} />}
      {spec.layout === "pad" && <PadBody spec={spec} accent={accent} onInput={onInput} />}
      {spec.layout === "aim" && <AimBody spec={spec} accent={accent} onInput={onInput} />}
      {spec.layout === "draw" && <DrawBody spec={spec} onInput={onInput} />}
      {spec.layout === "text" && <TextBody spec={spec} onInput={onInput} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function WaitBody({ message }: { message: string }) {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center" aria-live="polite">
      <p className="text-sm text-sn-muted">{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PaddleBody({
  accent,
  orientation,
  onInput,
}: {
  accent: string;
  orientation: "vertical" | "horizontal";
  onInput: (input: ControlInput) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(0.5);
  const [touching, setTouching] = useState(false);

  const positionRef = useRef(0.5);
  const lastSentRef = useRef(-1);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  const reduced = prefersReducedMotion();
  const vertical = orientation === "vertical";

  /* El muestreo va por su cuenta a 30 Hz: mandar en cada pointermove seria
     mandar a la frecuencia del sensor tactil, que en algunos telefonos es 120. */
  useEffect(() => {
    const timer = window.setInterval(() => {
      const value = positionRef.current;
      if (Math.abs(value - lastSentRef.current) < 0.002) return;
      lastSentRef.current = value;
      onInputRef.current({ kind: "paddle", position: value });
    }, SEND_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const readPointer = useCallback(
    (clientX: number, clientY: number) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const box = surface.getBoundingClientRect();
      const raw = vertical ? (clientY - box.top) / box.height : (clientX - box.left) / box.width;
      const clamped = Math.min(1, Math.max(0, raw));
      positionRef.current = clamped;
      setPosition(clamped);
    },
    [vertical],
  );

  return (
    <>
      <div
        ref={surfaceRef}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden rounded-sn-lg border border-sn-line-soft bg-sn-bg-elev"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setTouching(true);
          readPointer(e.clientX, e.clientY);
          if (!reduced) vibrate(8);
        }}
        onPointerMove={(e) => {
          if (touching) readPointer(e.clientX, e.clientY);
        }}
        onPointerUp={() => setTouching(false)}
        onPointerCancel={() => setTouching(false)}
        role="slider"
        tabIndex={0}
        aria-label="Tu paleta"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position * 100)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.03;
          if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
            positionRef.current = Math.max(0, positionRef.current - step);
            setPosition(positionRef.current);
          } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
            positionRef.current = Math.min(1, positionRef.current + step);
            setPosition(positionRef.current);
          }
        }}
      >
        <div
          className="pointer-events-none absolute bg-sn-line-soft"
          style={
            vertical
              ? { left: 0, right: 0, top: "50%", height: 1 }
              : { top: 0, bottom: 0, left: "50%", width: 1 }
          }
        />
        {/* La paleta se mueve con el dedo YA, sin esperar al host. */}
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            background: accent,
            boxShadow: touching ? `0 0 28px -2px ${accent}` : "none",
            opacity: touching ? 1 : 0.75,
            ...(vertical
              ? { left: "12%", right: "12%", height: "18%", top: `calc(${position * 100}% - 9%)` }
              : { top: "12%", bottom: "12%", width: "18%", left: `calc(${position * 100}% - 9%)` }),
          }}
        />
        {!touching && (
          <p className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-xs text-sn-dim">
            Deslizá para mover tu paleta
          </p>
        )}
      </div>
      <p className="shrink-0 px-4 py-2 text-center text-[11px] text-sn-dim">
        Mirá la pantalla grande. Este teléfono es sólo el control.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */

type ButtonsSpec = Extract<ControlSpec, { layout: "buttons" }>;

function ButtonsBody({
  spec,
  onInput,
}: {
  spec: ButtonsSpec;
  onInput: (input: ControlInput) => void;
}) {
  const [showQuestion, setShowQuestion] = useState(false);
  /** Lo tocado se marca YA. El host confirma despues; la mano no espera. */
  const [localPick, setLocalPick] = useState<string | null>(null);

  // Cada ronda nueva limpia la eleccion local, o la anterior quedaria pegada.
  const optionsKey = spec.options.map((o) => o.id).join("|");
  useEffect(() => {
    setLocalPick(null);
    setShowQuestion(false);
  }, [optionsKey]);

  const picked = spec.picked ?? localPick;
  const locked = picked !== null || !spec.enabled;

  const choose = (option: ControlOption) => {
    if (locked) return;
    setLocalPick(option.id);
    vibrate(12);
    onInput({ kind: "pick", optionId: option.id });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      {spec.remainingMs !== undefined && (
        <div className="h-1.5 shrink-0 overflow-hidden rounded-full bg-sn-line">
          <div
            className="h-full rounded-full"
            style={{
              // La barra va contra la ventana REAL del juego. Asumir 10 s hacia
              // que una ronda de 5 arrancara por la mitad.
              width: `${Math.max(0, Math.min(100, (spec.remainingMs / (spec.windowMs ?? 10_000)) * 100))}%`,
              background: spec.remainingMs < 2000 ? "var(--sn-magenta-400)" : "var(--sn-cyan-400)",
            }}
          />
        </div>
      )}

      {spec.notice && (
        <p
          className="shrink-0 rounded-sn border border-sn-line-soft bg-sn-bg-elev px-3 py-2 text-center text-xs text-sn-muted"
          aria-live="polite"
        >
          {spec.notice}
        </p>
      )}

      {/* La pregunta va en la pantalla grande a proposito: es lo que hace que
          la sala levante la vista. Pero quien no llega a leerla la tiene aca. */}
      {spec.question && (
        <div className="shrink-0">
          <button
            type="button"
            className="sn-btn sn-btn--ghost h-8 w-full text-xs"
            onClick={() => setShowQuestion((v) => !v)}
            aria-expanded={showQuestion}
          >
            {showQuestion ? "Ocultar pregunta" : "Ver pregunta"}
          </button>
          {showQuestion && (
            <p className="mt-1 rounded-sn border border-sn-line-soft bg-sn-bg-elev px-3 py-2 text-sm text-sn-text">
              {spec.question}
            </p>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2" role="group" aria-label="Opciones">
        {spec.options.map((option, index) => {
          const color = OPTION_COLOR[index % OPTION_COLOR.length] ?? "var(--sn-cyan-400)";
          const isPicked = picked === option.id;
          const dimmed = picked !== null && !isPicked;

          return (
            <button
              key={option.id}
              type="button"
              disabled={locked && !isPicked}
              onClick={() => choose(option)}
              aria-pressed={isPicked}
              className="flex min-h-16 touch-none items-center gap-3 rounded-sn-lg border-2 px-4 text-left text-base font-medium transition-opacity"
              style={{
                borderColor: isPicked ? color : "var(--sn-line)",
                background: isPicked ? `color-mix(in oklab, ${color} 22%, transparent)` : "var(--sn-bg-elev)",
                color: "var(--sn-text)",
                opacity: dimmed ? 0.35 : spec.enabled || isPicked ? 1 : 0.55,
              }}
            >
              {/* Forma ademas de color: en escala de grises tienen que distinguirse. */}
              <ShapeIcon shape={option.shape} color={color} />
              <span className="min-w-0 flex-1">{option.label}</span>
            </button>
          );
        })}
      </div>

      {!spec.enabled && picked === null && (
        <p className="shrink-0 text-center text-[11px] text-sn-dim" aria-live="polite">
          Leé en la pantalla grande. Ya se habilitan.
        </p>
      )}
    </div>
  );
}

function ShapeIcon({ shape, color }: { shape: OptionShape; color: string }) {
  const common = { fill: color, stroke: "none" };
  return (
    <svg viewBox="0 0 24 24" className="size-7 shrink-0" aria-hidden="true">
      {shape === "circle" && <circle cx="12" cy="12" r="9" {...common} />}
      {shape === "square" && <rect x="4" y="4" width="16" height="16" rx="2" {...common} />}
      {shape === "triangle" && <polygon points="12,3 22,20 2,20" {...common} />}
      {shape === "diamond" && <polygon points="12,2 22,12 12,22 2,12" {...common} />}
    </svg>
  );
}

/* ------------------------------------------------------------------ */

type AimSpec = Extract<ControlSpec, { layout: "aim" }>;

/** Cuanto tarda la barra de fuerza en llenarse. */
const CHARGE_MS = 1100;

/** Tope del zoom con dos dedos. Mas que esto y se pierde la mesa de vista. */
const MAX_ZOOM = 5;

const BALL_FILL = {
  cue: "#f4f1ea",
  solids: "var(--sn-cyan-400)",
  stripes: "var(--sn-magenta-400)",
  eight: "#14121c",
} as const;

/**
 * El taco.
 *
 * Es el unico layout que dibuja una escena, y aun asi son circulos en un SVG:
 * el telefono no renderiza una sola cara 3D. Todo el 3D pasa en el proyector,
 * que es la maquina buena.
 *
 * Tres decisiones que hacen que se pueda apuntar de verdad:
 *
 * 1. **Se apunta senalando, no girando.** Arrastrar mueve la mira al punto que
 *    toca el dedo y la direccion sale de la blanca hacia ahi. Un gesto de
 *    "girar" acumula error en cada arrastre y obliga a corregir de a poco.
 * 2. **El zoom es el ajuste fino.** El `viewBox` se achica alrededor de la
 *    blanca, asi que acercar los dedos no solo agranda: multiplica la
 *    precision del mismo gesto, porque el pixel del dedo vale menos mesa. Sin
 *    esto, apuntarle a una bola en el otro extremo es adivinar.
 * 3. **La conversion de coordenadas sale del `viewBox`.** Es una sola cuenta y
 *    vale para cualquier zoom, en vez de un factor de escala aparte que hay
 *    que mantener sincronizado con lo que se dibuja.
 */
function AimBody({
  spec,
  accent,
  onInput,
}: {
  spec: AimSpec;
  accent: string;
  onInput: (input: ControlInput) => void;
}) {
  const { table } = spec;
  const maxZ = 1 / table.aspect;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [angle, setAngle] = useState(0);
  const [spin, setSpin] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [power, setPower] = useState(0);
  const [charging, setCharging] = useState(false);

  useHaptic(spec.haptic);

  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  const cue = cueBallOf(table);
  const reduced = prefersReducedMotion();

  /*
   * El `viewBox` se centra en la blanca y se achica con el zoom, pero nunca
   * se sale de la mesa: sin el encierro, acercarse a una bola contra la banda
   * mostraria medio rectangulo vacio.
   */
  const viewW = 1 / zoom;
  const viewH = maxZ / zoom;
  const viewX = cue ? clampRange(cue.x - viewW / 2, 0, 1 - viewW) : 0;
  const viewZ = cue ? clampRange(cue.z - viewH / 2, 0, maxZ - viewH) : 0;

  /** Pantalla a coordenadas de mesa. Una cuenta, y sirve para cualquier zoom. */
  const toTable = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return null;
      return {
        x: viewX + ((clientX - rect.left) / rect.width) * viewW,
        z: viewZ + ((clientY - rect.top) / rect.height) * viewH,
      };
    },
    [viewX, viewZ, viewW, viewH],
  );

  /*
   * Los punteros activos, para el pellizco. Se guardan en una ref y no en
   * estado: cambian en cada `pointermove` y no hay nada que redibujar por
   * cada uno.
   */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!spec.enabled) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()];
        pinchRef.current = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom };
        return;
      }

      const point = toTable(event.clientX, event.clientY);
      if (!point || !cue) return;

      /*
       * Bola en mano: el primer toque coloca la blanca en vez de apuntar. Es
       * lo unico que cambia el gesto, y por eso el cartel de "bola en mano"
       * tiene que estar visible.
       */
      if (spec.ballInHand) {
        const placed = clampToTable(table, point);
        if (!overlapsBall(table, placed)) {
          onInputRef.current({ kind: "place", x: placed.x, z: placed.z });
        }
        return;
      }

      setAngle(Math.atan2(point.z - cue.z, point.x - cue.x));
    },
    [spec.enabled, spec.ballInHand, table, toTable, cue, zoom],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!spec.enabled || !pointersRef.current.has(event.pointerId)) return;
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      const pinch = pinchRef.current;
      if (pointersRef.current.size === 2 && pinch) {
        const [a, b] = [...pointersRef.current.values()];
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch.distance > 0) {
          setZoom(clampRange((distance / pinch.distance) * pinch.zoom, 1, MAX_ZOOM));
        }
        return;
      }

      if (spec.ballInHand || !cue) return;
      const point = toTable(event.clientX, event.clientY);
      if (point) setAngle(Math.atan2(point.z - cue.z, point.x - cue.x));
    },
    [spec.enabled, spec.ballInHand, toTable, cue],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
  }, []);

  /*
   * La barra de fuerza.
   *
   * Se llena en `CHARGE_MS` y se queda arriba en vez de rebotar. Un medidor
   * que sube y baja es mas exigente, y en un evento donde la mitad de la sala
   * no juega al pool solo produce tiros al azar: si se paso, se espera y se
   * suelta al toque.
   */
  useEffect(() => {
    if (!charging) return;
    let raf = 0;
    const startedAt = performance.now();
    const tick = () => {
      setPower(Math.min(1, (performance.now() - startedAt) / CHARGE_MS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [charging]);

  const release = useCallback(() => {
    if (!charging) return;
    setCharging(false);
    // Un roce sin carga no es un tiro: seria un toque de fuerza cero que
    // gasta el turno sin mover nada.
    if (power > 0.05) {
      if (!reduced) vibrate(25);
      onInputRef.current({ kind: "shoot", angle, power, spin });
    }
    setPower(0);
  }, [charging, power, angle, spin, reduced]);

  const shot = projectAim(table, angle);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
      {spec.title && (
        <h2 className="shrink-0 text-center text-sm font-medium text-sn-text">{spec.title}</h2>
      )}
      {spec.status && spec.status.length > 0 && <PadStatus items={spec.status} />}

      {spec.remainingMs !== undefined && spec.windowMs !== undefined && spec.windowMs > 0 && (
        <div className="h-1 shrink-0 overflow-hidden rounded-full bg-sn-line-soft">
          <div
            className="h-full rounded-full transition-[width] duration-200"
            style={{
              width: `${clampRange(spec.remainingMs / spec.windowMs, 0, 1) * 100}%`,
              background: accent,
            }}
          />
        </div>
      )}

      {(spec.notice || spec.ballInHand) && (
        <p
          className="shrink-0 rounded-sn border border-sn-line-soft bg-sn-bg-elev px-3 py-2 text-center text-xs text-sn-muted"
          aria-live="polite"
        >
          {spec.notice ?? "Bola en mano: tocá la mesa para colocar la blanca."}
        </p>
      )}

      <div
        className="min-h-0 flex-1"
        style={{ opacity: spec.enabled ? 1 : 0.45, transition: reduced ? undefined : "opacity 150ms" }}
      >
        <svg
          ref={svgRef}
          viewBox={`${viewX} ${viewZ} ${viewW} ${viewH}`}
          className="h-full w-full touch-none rounded-sn border border-sn-line-soft"
          style={{ aspectRatio: String(table.aspect), background: "#0f3b2e" }}
          role="application"
          aria-label="Mesa de pool. Arrastrá para apuntar, acercá los dedos para el ajuste fino."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {table.pockets.map((pocket, index) => (
            <circle
              key={index}
              cx={pocket.x}
              cy={pocket.z}
              r={table.pocketRadius}
              fill="#0a0a12"
            />
          ))}

          {/* La linea del tiro, en el color del jugador. Sin ella el juego es
              adivinar, y esto es exactamente lo que la guia pide mostrar. */}
          {cue && spec.enabled && (
            <>
              <line
                x1={cue.x}
                y1={cue.z}
                x2={shot.end.x}
                y2={shot.end.z}
                stroke={accent}
                strokeWidth={table.ballRadius * 0.25}
                strokeDasharray={`${table.ballRadius} ${table.ballRadius}`}
              />
              {/* Donde queda la blanca al tocar. */}
              <circle
                cx={shot.end.x}
                cy={shot.end.z}
                r={table.ballRadius}
                fill="none"
                stroke={accent}
                strokeWidth={table.ballRadius * 0.12}
                opacity={0.7}
              />
              {shot.hitDir && (
                <line
                  x1={shot.end.x}
                  y1={shot.end.z}
                  x2={shot.end.x + shot.hitDir.x * table.ballRadius * 6}
                  y2={shot.end.z + shot.hitDir.z * table.ballRadius * 6}
                  stroke="var(--sn-warn)"
                  strokeWidth={table.ballRadius * 0.2}
                  opacity={0.85}
                />
              )}
            </>
          )}

          {table.balls.map((ball) => (
            <g key={ball.id}>
              <circle
                cx={ball.x}
                cy={ball.z}
                r={table.ballRadius}
                fill={BALL_FILL[ball.kind]}
                stroke={table.own !== null && ball.kind === table.own ? accent : "#00000055"}
                strokeWidth={table.ballRadius * 0.16}
              />
              {ball.kind !== "cue" && (
                <text
                  x={ball.x}
                  y={ball.z}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={table.ballRadius * 1.1}
                  fill={ball.kind === "eight" ? "#f4f1ea" : "#14121c"}
                >
                  {ball.id}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      <SpinDial spin={spin} accent={accent} enabled={spec.enabled} onChange={setSpin} />

      <div className="shrink-0">
        <div className="mb-1 h-2 overflow-hidden rounded-full bg-sn-line-soft">
          <div
            className="h-full rounded-full"
            style={{ width: `${power * 100}%`, background: accent }}
          />
        </div>
        <button
          type="button"
          disabled={!spec.enabled}
          className="w-full rounded-sn border px-3 py-4 text-base font-semibold transition-colors disabled:opacity-40"
          style={{
            borderColor: accent,
            background: charging ? accent : "transparent",
            color: charging ? "var(--sn-bg)" : accent,
          }}
          onPointerDown={() => spec.enabled && setCharging(true)}
          onPointerUp={release}
          onPointerLeave={release}
          onPointerCancel={release}
        >
          {charging ? "Soltá para pegar" : "PEGAR"}
        </button>
      </div>
    </div>
  );
}

/**
 * El efecto vertical.
 *
 * Un circulo que representa la blanca vista de frente: arriba del centro es
 * corrida, abajo retroceso. **No hay eje horizontal a proposito.** Con efecto
 * lateral el pool es injugable para quien no juega al pool, y con este solo
 * se explica en una frase.
 */
function SpinDial({
  spin,
  accent,
  enabled,
  onChange,
}: {
  spin: number;
  accent: string;
  enabled: boolean;
  onChange: (next: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const pick = useCallback(
    (clientY: number) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      // Arriba de la pantalla es corrida, asi que el eje se invierte.
      const ratio = 1 - ((clientY - rect.top) / rect.height) * 2;
      onChange(clampRange(ratio, -1, 1));
    },
    [onChange],
  );

  const label = spin > 0.15 ? "corrida" : spin < -0.15 ? "retroceso" : "centro";

  return (
    <div className="flex shrink-0 items-center gap-3">
      <div
        ref={ref}
        className="size-16 shrink-0 touch-none rounded-full border"
        style={{ borderColor: enabled ? accent : "var(--sn-line-soft)", opacity: enabled ? 1 : 0.4 }}
        role="slider"
        aria-label="Efecto vertical"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Number(spin.toFixed(2))}
        aria-valuetext={label}
        tabIndex={0}
        onPointerDown={(event) => {
          if (!enabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event.clientY);
        }}
        onPointerMove={(event) => {
          if (!enabled || event.buttons === 0) return;
          pick(event.clientY);
        }}
        onKeyDown={(event) => {
          if (!enabled) return;
          if (event.key === "ArrowUp") onChange(clampRange(spin + 0.1, -1, 1));
          if (event.key === "ArrowDown") onChange(clampRange(spin - 0.1, -1, 1));
        }}
      >
        <div className="relative h-full w-full">
          <div
            className="absolute left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ top: `${(1 - spin) * 50}%`, background: accent }}
          />
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-sn-dim">Efecto</div>
        <div className="text-sm text-sn-text">{label}</div>
      </div>
    </div>
  );
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type PadSpec = Extract<ControlSpec, { layout: "pad" }>;

/**
 * El mando de un juego de accion.
 *
 * Tres piezas opcionales que se combinan: franja de posicion absoluta,
 * botones y un estado chico. Invasores usa franja + disparo, Rompeladrillos
 * solo franja (con el rango recortado), Tetris duelo solo botones.
 */
function PadBody({
  spec,
  accent,
  onInput,
}: {
  spec: PadSpec;
  accent: string;
  onInput: (input: ControlInput) => void;
}) {
  const grouped = groupButtons(spec.buttons ?? []);
  useHaptic(spec.haptic);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
      {spec.title && (
        <h2 className="shrink-0 text-center text-sm font-medium text-sn-text">{spec.title}</h2>
      )}
      {spec.status && spec.status.length > 0 && <PadStatus items={spec.status} />}

      {spec.notice && (
        <p
          className="shrink-0 rounded-sn border border-sn-line-soft bg-sn-bg-elev px-3 py-2 text-center text-xs text-sn-muted"
          aria-live="polite"
        >
          {spec.notice}
        </p>
      )}

      {grouped.top.length > 0 && (
        <PadRow buttons={grouped.top} accent={accent} enabled={spec.enabled} onInput={onInput} />
      )}

      {spec.slider && (
        <PadSlider slider={spec.slider} accent={accent} enabled={spec.enabled} onInput={onInput} />
      )}

      {grouped.main.length > 0 && (
        <PadRow buttons={grouped.main} accent={accent} enabled={spec.enabled} onInput={onInput} tall />
      )}
      {grouped.rotate.length > 0 && (
        <PadRow buttons={grouped.rotate} accent={accent} enabled={spec.enabled} onInput={onInput} tall />
      )}

      {/* Separada del resto a proposito: es irreversible, y tocarla sin querer
          cuesta la partida. El margen extra es la mitad del diseno. */}
      {grouped.danger.length > 0 && (
        <div className="mt-2 shrink-0 border-t border-sn-line-soft pt-3">
          <PadRow
            buttons={grouped.danger}
            accent="var(--sn-magenta-400)"
            enabled={spec.enabled}
            onInput={onInput}
            tall
          />
        </div>
      )}
    </div>
  );
}

/**
 * Vibra una vez por cada `id` nuevo.
 *
 * El spec se reenvia muchas veces por segundo; sin comparar el id, el telefono
 * vibraria en cada refresco y el mando temblaria sin parar.
 */
function useHaptic(haptic: ControlHaptic | undefined) {
  const lastIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!haptic || haptic.id === lastIdRef.current) return;
    lastIdRef.current = haptic.id;
    if (prefersReducedMotion()) return;
    vibrate(Array.isArray(haptic.pattern) ? [...haptic.pattern] : (haptic.pattern as number));
  }, [haptic]);
}

function groupButtons(buttons: readonly ControlButton[]) {
  return {
    top: buttons.filter((b) => b.group === "top"),
    main: buttons.filter((b) => b.group === undefined || b.group === "main"),
    rotate: buttons.filter((b) => b.group === "rotate"),
    danger: buttons.filter((b) => b.group === "danger"),
  };
}

const STATUS_TONE = {
  default: "var(--sn-text)",
  warn: "var(--sn-warn)",
  danger: "var(--sn-danger)",
} as const;

function PadStatus({ items }: { items: readonly ControlStatus[] }) {
  return (
    <div className="flex shrink-0 gap-2" aria-live="polite">
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 flex-1 rounded-sn border border-sn-line-soft bg-sn-bg-elev px-2.5 py-1.5"
        >
          <div className="truncate text-[10px] uppercase tracking-wider text-sn-dim">{item.label}</div>
          <div
            className="sn-num truncate text-lg font-semibold"
            style={{ color: STATUS_TONE[item.tone ?? "default"] }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function PadRow({
  buttons,
  accent,
  enabled,
  onInput,
  tall = false,
}: {
  buttons: readonly ControlButton[];
  accent: string;
  enabled: boolean;
  onInput: (input: ControlInput) => void;
  tall?: boolean;
}) {
  return (
    <div className="flex shrink-0 gap-2">
      {buttons.map((button) => (
        <PadButton
          key={button.id}
          button={button}
          accent={accent}
          enabled={enabled}
          onInput={onInput}
          tall={tall}
        />
      ))}
    </div>
  );
}

function PadButton({
  button,
  accent,
  enabled,
  onInput,
  tall,
}: {
  button: ControlButton;
  accent: string;
  enabled: boolean;
  onInput: (input: ControlInput) => void;
  tall: boolean;
}) {
  const [held, setHeld] = useState(false);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  /* Un boton que se mantiene tiene que soltarse SIEMPRE, aunque el dedo salga
     del boton, la pestana pierda el foco o el navegador se lleve el puntero.
     Si no, el host lo cree apretado para siempre y la pieza cruza sola el
     tablero. Es el bug clasico de un mando tactil. */
  const release = useCallback(() => {
    setHeld((wasHeld) => {
      if (wasHeld && button.hold) {
        onInputRef.current({ kind: "hold", buttonId: button.id, pressed: false });
      }
      return false;
    });
  }, [button.hold, button.id]);

  useEffect(() => {
    if (!held) return;
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [held, release]);

  const press = () => {
    if (button.hold) onInputRef.current({ kind: "hold", buttonId: button.id, pressed: true });
    else onInputRef.current({ kind: "press", buttonId: button.id });
  };

  // Un boton apagado que explica por que ensena las reglas sin tutorial; uno
  // apagado y mudo solo confunde.
  const off = !enabled || button.disabled === true;
  const subtitle = button.disabled === true ? (button.disabledReason ?? button.hint) : button.hint;

  return (
    <button
      type="button"
      disabled={off}
      className={`flex flex-1 touch-none select-none flex-col items-center justify-center gap-0.5 rounded-sn-lg border-2 px-2 text-center text-base font-semibold ${
        tall ? "min-h-16" : "min-h-12"
      }`}
      style={{
        borderColor: held ? accent : "var(--sn-line)",
        background: held ? `color-mix(in oklab, ${accent} 26%, transparent)` : "var(--sn-bg-elev)",
        color: "var(--sn-text)",
        opacity: off ? 0.45 : 1,
        touchAction: "none",
      }}
      onPointerDown={(e) => {
        if (off) return;
        e.preventDefault();
        setHeld(true);
        vibrate(8);
        // Sale en pointerdown y no en click: esperar al click le agrega el
        // retardo del navegador a un juego que se mide en cuadros.
        press();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={(e) => {
        if (e.repeat || (e.key !== " " && e.key !== "Enter")) return;
        setHeld(true);
        press();
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") release();
      }}
      aria-pressed={button.hold ? held : undefined}
    >
      <span>{button.label}</span>
      {subtitle && <span className="text-[11px] font-normal text-sn-dim">{subtitle}</span>}
    </button>
  );
}

function PadSlider({
  slider,
  accent,
  enabled,
  onInput,
}: {
  slider: ControlSlider;
  accent: string;
  enabled: boolean;
  onInput: (input: ControlInput) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(0.5);
  const [touching, setTouching] = useState(false);

  const positionRef = useRef(0.5);
  const lastSentRef = useRef(-1);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  const vertical = slider.orientation === "vertical";
  const { min, max } = slider;

  useEffect(() => {
    const timer = window.setInterval(() => {
      const value = positionRef.current;
      if (Math.abs(value - lastSentRef.current) < 0.002) return;
      lastSentRef.current = value;
      onInputRef.current({ kind: "paddle", position: value });
    }, SEND_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const readPointer = useCallback(
    (clientX: number, clientY: number) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const box = surface.getBoundingClientRect();
      const raw = vertical ? (clientY - box.top) / box.height : (clientX - box.left) / box.width;
      // El recorte al rango permitido se hace ACA y tambien en el host: en el
      // telefono para que el dedo no vaya donde no puede, y en el host porque
      // un cliente puede mandar cualquier numero.
      const clamped = Math.min(max, Math.max(min, raw));
      positionRef.current = clamped;
      setPosition(clamped);
    },
    [vertical, min, max],
  );

  const limited = min > 0 || max < 1;

  return (
    <div
      ref={surfaceRef}
      className="relative min-h-0 flex-1 touch-none select-none overflow-hidden rounded-sn-lg border border-sn-line-soft bg-sn-bg-elev"
      style={{ touchAction: "none", opacity: enabled ? 1 : 0.5 }}
      onPointerDown={(e) => {
        if (!enabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setTouching(true);
        readPointer(e.clientX, e.clientY);
        vibrate(8);
      }}
      onPointerMove={(e) => {
        if (touching) readPointer(e.clientX, e.clientY);
      }}
      onPointerUp={() => setTouching(false)}
      onPointerCancel={() => setTouching(false)}
      role="slider"
      tabIndex={0}
      aria-label="Tu posicion"
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      aria-valuenow={Math.round(position * 100)}
    >
      {/* La zona prohibida se ve. Sin esto el dedo se frena y nadie entiende
          por que: el limite lo pone donde esta el companero. */}
      {limited && (
        <>
          <div
            className="pointer-events-none absolute bg-sn-bg/70"
            style={
              vertical
                ? { left: 0, right: 0, top: 0, height: `${min * 100}%` }
                : { top: 0, bottom: 0, left: 0, width: `${min * 100}%` }
            }
          />
          <div
            className="pointer-events-none absolute bg-sn-bg/70"
            style={
              vertical
                ? { left: 0, right: 0, bottom: 0, height: `${(1 - max) * 100}%` }
                : { top: 0, bottom: 0, right: 0, width: `${(1 - max) * 100}%` }
            }
          />
        </>
      )}

      {slider.markers?.map((marker) => (
        <div
          key={marker.label}
          className="pointer-events-none absolute"
          style={{
            background: marker.tone === "warn" ? "var(--sn-warn)" : "var(--sn-text-dim)",
            ...(vertical
              ? { left: 0, right: 0, top: `${marker.at * 100}%`, height: 2 }
              : { top: 0, bottom: 0, left: `${marker.at * 100}%`, width: 2 }),
          }}
          aria-hidden="true"
          title={marker.label}
        />
      ))}

      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          background: accent,
          boxShadow: touching ? `0 0 28px -2px ${accent}` : "none",
          opacity: touching ? 1 : 0.75,
          ...(vertical
            ? { left: "12%", right: "12%", height: "16%", top: `calc(${position * 100}% - 8%)` }
            : { top: "12%", bottom: "12%", width: "16%", left: `calc(${position * 100}% - 8%)` }),
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

type DrawSpec = Extract<ControlSpec, { layout: "draw" }>;

/** Cada cuanto sale un lote de puntos. Ver el comentario de `stroke`. */
const STROKE_BATCH_MS = 50;

/**
 * El lienzo del que dibuja.
 *
 * Dos cosas separadas a proposito:
 *
 * - **Lo que se ve**: se pinta en el acto, con cada movimiento del dedo. La
 *   mano no puede esperar a la red.
 * - **Lo que se manda**: puntos normalizados en lotes de 50 ms. A 120 Hz de
 *   sensor tactil, mandar punto por punto serian 120 paquetes por segundo.
 *
 * Se manda el punto normalizado y NUNCA la imagen: asi el dibujo escala solo
 * a la resolucion del proyector, que no tiene por que ser la del telefono.
 */
function DrawBody({
  spec,
  onInput,
}: {
  spec: DrawSpec;
  onInput: (input: ControlInput) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [color, setColor] = useState(spec.colors[0] ?? "#000000");
  const [width, setWidth] = useState(spec.widths[1] ?? spec.widths[0] ?? 6);
  const [eraser, setEraser] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  /* El lote pendiente vive en un ref: acumular en estado dispararia un render
     por cada movimiento del dedo, que es exactamente lo que hay que evitar. */
  const pendingRef = useRef<StrokePoint[]>([]);
  const drawingRef = useRef(false);
  const startedRef = useRef(false);
  const toolRef = useRef({ color, width, eraser });
  toolRef.current = { color, width, eraser };

  const flush = useCallback((phase: "start" | "move" | "end") => {
    const points = pendingRef.current;
    if (phase !== "end" && points.length === 0) return;
    pendingRef.current = [];
    onInputRef.current({
      kind: "stroke",
      phase,
      points,
      color: toolRef.current.color,
      width: toolRef.current.width,
      eraser: toolRef.current.eraser,
    });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (drawingRef.current) flush(startedRef.current ? "move" : "start");
      if (startedRef.current === false && drawingRef.current) startedRef.current = true;
    }, STROKE_BATCH_MS);
    return () => window.clearInterval(timer);
  }, [flush]);

  /** Pinta localmente. Es feedback, no la fuente de verdad: esa es el host. */
  const paint = useCallback((from: StrokePoint, to: StrokePoint) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { color: c, width: w, eraser: e } = toolRef.current;
    ctx.globalCompositeOperation = e ? "destination-out" : "source-over";
    ctx.strokeStyle = c;
    ctx.lineWidth = w * (canvas.width / 1000);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
    ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
    ctx.stroke();
  }, []);

  const lastRef = useRef<StrokePoint | null>(null);

  const readPoint = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const box = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
      ...(e.pressure > 0 && e.pressure !== 0.5 ? { p: e.pressure } : {}),
    };
  };

  const clearLocal = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <span className="text-xs text-sn-dim">Dibujá</span>
        <span className="font-display text-lg font-semibold text-sn-cyan">{spec.prompt}</span>
      </div>

      {spec.remainingMs !== undefined && (
        <div className="h-1.5 shrink-0 overflow-hidden rounded-full bg-sn-line">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, (spec.remainingMs / (spec.windowMs ?? 75_000)) * 100))}%`,
              background: spec.remainingMs < 10_000 ? "var(--sn-magenta-400)" : "var(--sn-cyan-400)",
            }}
          />
        </div>
      )}

      {spec.notice && (
        <p className="shrink-0 text-center text-xs text-sn-muted" aria-live="polite">
          {spec.notice}
        </p>
      )}

      {/* El lienzo se encuadra con la proporcion del contrato y se centra en
          el espacio que le toque: es lo que hace que el trazo llegue al
          proyector con la misma forma que se hizo en la mano. Antes se
          estiraba a lo que diera el layout y cada pantalla lo deformaba a su
          manera. El mismo encuadre que usa el proyector. */}
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          width={1000}
          height={Math.round(1000 / SKETCH_ASPECT)}
          className="absolute inset-0 m-auto touch-none rounded-sn-lg border border-sn-line-soft bg-white"
          style={{
            touchAction: "none",
            aspectRatio: String(SKETCH_ASPECT),
            maxWidth: "100%",
            maxHeight: "100%",
          }}
          aria-label="Lienzo"
          onPointerDown={(e) => {
            if (!spec.enabled) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drawingRef.current = true;
            startedRef.current = false;
            const point = readPoint(e);
            lastRef.current = point;
            pendingRef.current.push(point);
            paint(point, point);
          }}
          onPointerMove={(e) => {
            if (!drawingRef.current) return;
            const point = readPoint(e);
            if (lastRef.current) paint(lastRef.current, point);
            lastRef.current = point;
            pendingRef.current.push(point);
          }}
          onPointerUp={() => {
            if (!drawingRef.current) return;
            drawingRef.current = false;
            flush("end");
            startedRef.current = false;
            lastRef.current = null;
          }}
          onPointerCancel={() => {
            if (!drawingRef.current) return;
            drawingRef.current = false;
            flush("end");
            lastRef.current = null;
          }}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {spec.colors.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`Color ${swatch}`}
            aria-pressed={!eraser && color === swatch}
            onClick={() => {
              setColor(swatch);
              setEraser(false);
            }}
            className="size-9 shrink-0 rounded-full border-2"
            style={{
              background: swatch,
              borderColor: !eraser && color === swatch ? "var(--sn-text)" : "var(--sn-line)",
            }}
          />
        ))}
        {spec.widths.map((w) => (
          <button
            key={w}
            type="button"
            aria-label={`Grosor ${w}`}
            aria-pressed={width === w}
            onClick={() => setWidth(w)}
            className="grid size-9 shrink-0 place-items-center rounded-sn border-2"
            style={{ borderColor: width === w ? "var(--sn-cyan-400)" : "var(--sn-line)" }}
          >
            <span
              className="block rounded-full bg-sn-text"
              style={{ width: Math.min(20, w * 2), height: Math.min(20, w * 2) }}
            />
          </button>
        ))}
        <button
          type="button"
          className="sn-btn h-9 text-xs"
          aria-pressed={eraser}
          onClick={() => setEraser((v) => !v)}
          style={eraser ? { borderColor: "var(--sn-cyan-400)" } : undefined}
        >
          Borrador
        </button>
        <button
          type="button"
          className="sn-btn h-9 text-xs"
          onClick={() => onInputRef.current({ kind: "canvas", action: "undo" })}
        >
          Deshacer
        </button>
        {/* Con confirmacion: borrar sin querer a los 60 segundos es doloroso. */}
        <button
          type="button"
          className={`sn-btn h-9 text-xs ${confirmClear ? "sn-btn--danger" : ""}`}
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              window.setTimeout(() => setConfirmClear(false), 3000);
              return;
            }
            setConfirmClear(false);
            clearLocal();
            onInputRef.current({ kind: "canvas", action: "clear" });
          }}
        >
          {confirmClear ? "¿Seguro?" : "Borrar todo"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

type TextSpec = Extract<ControlSpec, { layout: "text" }>;

/** Cada cuanto se avisa "esta escribiendo". No hace falta mas seguido. */
const TYPING_PING_MS = 1200;

/**
 * El campo para adivinar.
 *
 * El campo va ARRIBA de todo a proposito: es la unica pantalla de los 24 con
 * teclado, y el teclado virtual ocupa media pantalla. Abajo quedaria tapado
 * justo mientras se escribe.
 */
function TextBody({
  spec,
  onInput,
}: {
  spec: TextSpec;
  onInput: (input: ControlInput) => void;
}) {
  const [value, setValue] = useState("");
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const lastTypingRef = useRef(0);

  // El campo se limpia cuando cambia la ronda, no cuando cambia el spec.
  useEffect(() => {
    setValue("");
  }, [spec.placeholder]);

  const submit = () => {
    const clean = value.trim();
    if (clean === "" || !spec.enabled || spec.locked) return;
    onInputRef.current({ kind: "text", value: clean });
    setValue("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
      <form
        className="flex shrink-0 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          type="text"
          className="sn-input h-12 flex-1 text-base"
          placeholder={spec.placeholder}
          value={value}
          disabled={!spec.enabled || spec.locked}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            const now = Date.now();
            if (now - lastTypingRef.current > TYPING_PING_MS) {
              lastTypingRef.current = now;
              // El proyector muestra "Ana esta escribiendo", nunca que escribe.
              onInputRef.current({ kind: "typing" });
            }
          }}
        />
        <button
          type="submit"
          className="sn-btn sn-btn--primary h-12 shrink-0 px-4"
          disabled={!spec.enabled || spec.locked || value.trim() === ""}
        >
          Enviar
        </button>
      </form>

      {spec.notice && (
        <p
          className="shrink-0 rounded-sn border border-sn-line-soft bg-sn-bg-elev px-3 py-2 text-center text-sm text-sn-text"
          aria-live="polite"
        >
          {spec.notice}
        </p>
      )}

      {spec.remainingMs !== undefined && (
        <div className="h-1.5 shrink-0 overflow-hidden rounded-full bg-sn-line">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, (spec.remainingMs / (spec.windowMs ?? 75_000)) * 100))}%`,
              background: spec.remainingMs < 10_000 ? "var(--sn-magenta-400)" : "var(--sn-cyan-400)",
            }}
          />
        </div>
      )}

      <div className="grid min-h-0 flex-1 place-items-center">
        {spec.hint && (
          <p className="sn-num text-center text-2xl tracking-[0.3em] text-sn-muted" aria-label="Pista">
            {spec.hint}
          </p>
        )}
      </div>

      <p className="shrink-0 text-center text-[11px] text-sn-dim">
        Mirá la pantalla grande. Acá sólo escribís.
      </p>
    </div>
  );
}
