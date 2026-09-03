/**
 * Audio minimo por WebAudio.
 *
 * No entra howler: son 30 KB para reproducir seis tonos. Lo unico que howler
 * resuelve y hay que resolver igual es el desbloqueo tras el primer gesto del
 * usuario, y eso son diez lineas.
 *
 * Arranca en silencio: un juego que suena solo al abrirlo en una oficina es
 * un juego que se cierra.
 */

export type SfxName = "pick" | "hit" | "lose" | "win" | "tick" | "select";

type Voice = {
  wave: OscillatorType;
  freq: number;
  /** Salto de frecuencia al final del sonido. */
  toFreq?: number;
  durationS: number;
  gain: number;
};

const VOICES: Record<SfxName, Voice> = {
  pick: { wave: "triangle", freq: 660, toFreq: 990, durationS: 0.1, gain: 0.22 },
  hit: { wave: "square", freq: 180, toFreq: 90, durationS: 0.14, gain: 0.2 },
  lose: { wave: "sawtooth", freq: 220, toFreq: 70, durationS: 0.45, gain: 0.18 },
  win: { wave: "triangle", freq: 520, toFreq: 1040, durationS: 0.35, gain: 0.22 },
  tick: { wave: "sine", freq: 880, durationS: 0.05, gain: 0.14 },
  select: { wave: "sine", freq: 440, toFreq: 560, durationS: 0.08, gain: 0.16 },
};

export type Sfx = {
  play(name: SfxName): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  dispose(): void;
};

export function createSfx(initiallyMuted = true): Sfx {
  let ctx: AudioContext | null = null;
  let muted = initiallyMuted;

  function ensureContext(): AudioContext | null {
    if (typeof AudioContext === "undefined") return null;
    if (!ctx) ctx = new AudioContext();
    // Los navegadores lo dejan suspendido hasta que hay un gesto del usuario.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }

  return {
    play(name) {
      if (muted) return;
      const audio = ensureContext();
      if (!audio) return;
      const voice = VOICES[name];
      const now = audio.currentTime;

      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = voice.wave;
      osc.frequency.setValueAtTime(voice.freq, now);
      if (voice.toFreq !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(voice.toFreq, now + voice.durationS);
      }
      // Ataque corto y caida exponencial: sin esto se escucha un click al cortar.
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(voice.gain, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + voice.durationS);

      osc.connect(gain).connect(audio.destination);
      osc.start(now);
      osc.stop(now + voice.durationS + 0.02);
    },
    setMuted(next) {
      muted = next;
      if (!next) ensureContext();
    },
    get muted() {
      return muted;
    },
    dispose() {
      void ctx?.close();
      ctx = null;
    },
  };
}

/** Segundo canal de feedback en movil. Silencioso donde no existe. */
export function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}
