import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import { isPlayable } from "@/core/contract/catalog";
import type { GameOutcome, GameProps, GameRuntimeConfig } from "@/core/contract/game";
import { loadSettings } from "@/core/admin/settingsStore";
import { randomSeed } from "@/core/engine/rng";
import { getGame } from "@/games/registry";
import { useFullscreen } from "@/ui/game/useFullscreen";

/**
 * Jugar de verdad, sin el banco de pruebas alrededor.
 *
 * `GameLabPage` (ruta `#/juego/:id`) es una herramienta de desarrollo: sidebar,
 * pestañas de administrables, sliders de semilla y transporte, el resultado
 * crudo. Sirve para construir un juego; no para jugarlo. Esta pagina es lo
 * otro: el juego ocupando la pantalla y nada mas.
 *
 * Va declarada FUERA del `AppShell` (ver `src/App.tsx`, al lado de `/quiosco`
 * y `/control/:sala`), que es lo que garantiza que no haya sidebar sin
 * importar el juego.
 *
 * Sobre la pantalla completa: el navegador solo la concede con un gesto de la
 * persona, asi que pedirla al cargar la pagina la rechaza en silencio. Se
 * engancha al primer toque —que va a ser el boton "Jugar" que el propio juego
 * muestra— y listo. Y si el navegador no la banca, no pasa nada: la pagina ya
 * ocupa el viewport entero igual, porque eso no depende de la API sino de que
 * esta ruta no monte el shell.
 *
 * Los parametros son los mismos que ya usa el QR del banco de pruebas
 * (`asiento`, `semilla`, `transporte`, `asientos`), asi que un link de este
 * tipo se lee igual en los dos lados.
 */

/** Una sala viva por juego, igual que `lab-<id>` en el banco de pruebas. */
const ROOM_PREFIX = "play-";

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export default function PlayPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const entry = getGame(id);

  const pageRef = useRef(typeof document === "undefined" ? null : document.documentElement);
  const fullscreen = useFullscreen(pageRef);

  /*
   * La pantalla completa se pide en el primer toque y una sola vez. El gesto
   * que la habilita es el mismo que empieza a jugar, asi que no hace falta
   * una pantalla previa pidiendo "tocá para empezar" — que seria una pantalla
   * mas entre la persona y el juego, justo lo que se quiere evitar.
   */
  const enterOnFirstGesture = fullscreen.supported && !fullscreen.active;
  useEffect(() => {
    if (!enterOnFirstGesture) return;
    const onDown = () => {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    };
    document.addEventListener("pointerdown", onDown, { once: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, [enterOnFirstGesture]);

  if (!entry || !entry.load || !isPlayable(entry)) {
    return (
      <div className="grid h-screen place-items-center bg-sn-bg p-6 text-center">
        <div>
          <p className="mb-3 text-sm text-sn-muted">
            {entry ? `${entry.title} todavía no se puede jugar.` : "No existe ese juego."}
          </p>
          <Link to="/" className="sn-btn text-xs">
            Volver al catálogo
          </Link>
        </div>
      </div>
    );
  }

  return <PlayRun entry={entry} params={searchParams} fullscreen={fullscreen} />;
}

type PlayRunProps = {
  entry: NonNullable<ReturnType<typeof getGame>>;
  params: URLSearchParams;
  fullscreen: ReturnType<typeof useFullscreen>;
};

function PlayRun({ entry, params, fullscreen }: PlayRunProps) {
  const [outcome, setOutcome] = useState<GameOutcome | null>(null);
  const [runId, setRunId] = useState(0);
  const [qr, setQr] = useState<{ url: string; image: string } | null>(null);
  /** A que asiento invita el proximo QR. Cada uno invita al siguiente. */
  const nextSeat = useRef(2);
  const abortRef = useRef<AbortController>(new AbortController());

  const seats = clampInt(params.get("asientos"), 1, entry.maxPlayers, entry.maxPlayers);
  const seat = clampInt(params.get("asiento"), 1, seats, 1) - 1;
  const transport = params.get("transporte") === "webrtc" ? "webrtc" : "local";
  // La semilla viaja en el link: sin ella cada aparato generaria su mundo.
  const urlSeed = params.get("semilla");
  const [seed, setSeed] = useState(() => urlSeed?.slice(0, 16) || randomSeed());

  // Los administrables los deja configurados quien quiera desde el banco de
  // pruebas; aca no hay UI para tocarlos, pero se respetan.
  const settings = useMemo(() => loadSettings(entry.id, entry.settings), [entry]);

  const config: GameRuntimeConfig = useMemo(
    () => ({
      roomId: `${ROOM_PREFIX}${entry.id}`,
      seed,
      durationMs: null,
      seat,
      isHost: seat === 0,
      playerCount: seats,
      transport,
      settings,
      debug: false,
    }),
    [entry.id, seed, seat, seats, transport, settings],
  );

  const GameComponent = useMemo(
    () => (entry.load ? lazy(entry.load as () => Promise<{ default: ComponentType<GameProps> }>) : null),
    [entry],
  );

  const playAgain = useCallback(() => {
    abortRef.current.abort();
    abortRef.current = new AbortController();
    setOutcome(null);
    setSeed(randomSeed());
    setRunId((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = abortRef.current;
    return () => controller.abort();
  }, []);

  const share = useCallback(async () => {
    if (qr) {
      setQr(null);
      return;
    }
    const url = new URL(window.location.href);
    url.hash = `#/jugar/${entry.id}?asiento=${nextSeat.current}&semilla=${encodeURIComponent(seed)}&transporte=${transport}`;
    // El proximo invita al asiento siguiente: dos celulares que escanean el
    // mismo codigo no se pelean por el mismo puesto.
    nextSeat.current = nextSeat.current >= seats ? 2 : nextSeat.current + 1;
    const link = url.toString();
    setQr({ url: link, image: await QRCode.toDataURL(link, { margin: 1, width: 200 }) });
  }, [qr, entry.id, seed, transport, seats]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-sn-bg">
      {/* Lo minimo: como se llama, invitar y salir. Sin pestañas ni sliders. */}
      <header className="flex shrink-0 items-center justify-between gap-3 px-3 py-1.5">
        <span className="truncate text-xs text-sn-dim">{entry.title}</span>
        <div className="flex items-center gap-2">
          {seat === 0 && (
            <button type="button" className="sn-btn sn-btn--ghost text-[11px]" onClick={() => void share()}>
              {qr ? "Cerrar" : "Compartir"}
            </button>
          )}
          {fullscreen.supported && (
            <button
              type="button"
              className="sn-btn sn-btn--ghost text-[11px]"
              onClick={fullscreen.toggle}
              aria-pressed={fullscreen.active}
            >
              {fullscreen.active ? "Salir de pantalla completa" : "Pantalla completa"}
            </button>
          )}
          <Link to="/" className="sn-btn sn-btn--ghost text-[11px]">
            Salir
          </Link>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {GameComponent && (
          <Suspense fallback={<div className="grid h-full place-items-center text-xs text-sn-dim">Cargando…</div>}>
            <GameComponent
              key={runId}
              config={config}
              net={null}
              signal={abortRef.current.signal}
              onFinish={setOutcome}
            />
          </Suspense>
        )}
      </div>

      {qr && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-sn-bg/85 p-6 backdrop-blur-sm">
          <div className="sn-card w-full max-w-xs p-6 text-center">
            <h2 className="mb-1 text-base">Que se sumen</h2>
            <p className="mb-4 text-xs text-sn-muted">
              Escaneá con el celular. Cada código invita a un puesto distinto.
            </p>
            <img src={qr.image} alt="Código QR para entrar a la partida" className="mx-auto rounded-lg" />
            <p className="mt-3 break-all text-[10px] text-sn-dim">{qr.url}</p>
            <button type="button" className="sn-btn mt-4 h-9 w-full text-xs" onClick={() => setQr(null)}>
              Listo
            </button>
          </div>
        </div>
      )}

      {outcome && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-sn-bg/90 p-6 backdrop-blur-sm">
          <div className="sn-card w-full max-w-sm p-7 text-center">
            <h2 className="mb-1 text-xl">Terminó</h2>
            <p className="sn-num mb-6 text-4xl font-semibold text-sn-cyan">{outcome.points}</p>
            <div className="flex flex-col gap-2">
              <button type="button" className="sn-btn sn-btn--primary h-11" onClick={playAgain} autoFocus>
                Jugar de nuevo
              </button>
              <Link to="/" className="sn-btn grid h-11 place-items-center">
                Salir
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
