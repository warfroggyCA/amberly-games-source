export interface LobbyMusicTrack {
  id: string;
  title: string;
  src: string;
  credit: string;
  source: string;
  licenseUrl: string;
  gain?: number;
}
export type LobbyMusicMode =
  "off" | "loading" | "playing" | "paused" | "unavailable";
export interface LobbyMusicState {
  mode: LobbyMusicMode;
  volume: number;
  muted: boolean;
}
const DEFAULT_VOLUME = 0.2;
const VOLUME_KEY = "amberly-lobby-music-volume-v1";
const MUTED_KEY = "amberly-lobby-music-muted-v1";
const FADE_SECONDS = 0.18;
const validVolume = (value: number) =>
  Number.isFinite(value) && value >= 0 && value <= 1;

export function readLobbyMusicVolume(): number {
  try {
    const saved = localStorage.getItem(VOLUME_KEY);
    const value = saved === null ? NaN : Number(saved);
    return validVolume(value) ? value : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function readLobbyMusicMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "true";
  } catch {
    return false;
  }
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/** Default-on device music, gated by visible lobby state and the browser's autoplay policy. */
export class LobbyMusicAudio {
  private context: AudioContext | null = null;
  private track: LobbyMusicTrack | null = null;
  private buffer: AudioBuffer | null = null;
  private voice: Voice | null = null;
  private retiring = new Set<Voice>();
  private request: AbortController | null = null;
  private generation = 0;
  private active = false;
  private visible = true;
  private requested = false;
  private pending: Promise<void> | null = null;
  private phase: "waiting" | "loading" | null = null;
  private running: (() => void) | null = null;
  private disposed = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private state: LobbyMusicState = {
    mode: "off",
    volume: readLobbyMusicVolume(),
    muted: readLobbyMusicMuted(),
  };

  constructor(private readonly onChange: (state: LobbyMusicState) => void) {}

  get snapshot(): LobbyMusicState {
    return { ...this.state };
  }

  private publish(mode = this.state.mode) {
    if (this.disposed) return;
    this.state = { ...this.state, mode };
    this.onChange(this.snapshot);
  }

  configure(track: LobbyMusicTrack | null, active: boolean) {
    if (this.disposed) return;
    const changed =
      this.track?.id !== track?.id || this.track?.src !== track?.src;
    this.track = track;
    if (changed) {
      this.invalidate();
      this.buffer = null;
      this.stopVoice(true);
      this.publish("off");
    }
    this.active = active && !!track;
    if (!this.active) this.pauseForInterruption(true);
    else {
      this.updateGain();
      void this.activate();
    }
  }

  setVisible(visible: boolean) {
    if (this.disposed) return;
    this.visible = visible;
    if (!visible) this.pauseForInterruption(false);
    else void this.activate();
  }

  setMuted(muted: boolean): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.state = { ...this.state, muted };
    try {
      localStorage.setItem(MUTED_KEY, String(muted));
    } catch {}
    if (muted) {
      this.invalidate();
      this.stopVoice(true);
      this.publish("off");
      return Promise.resolve();
    }
    // Explicit unmute can retry a failed asset; arbitrary document taps cannot.
    this.publish(
      this.state.mode === "unavailable" ? "paused" : this.state.mode,
    );
    return this.activate();
  }

  setVolume(value: number) {
    if (this.disposed) return;
    const volume = validVolume(value) ? value : DEFAULT_VOLUME;
    this.state = { ...this.state, volume };
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {}
    this.updateGain();
    this.publish();
  }

  private level() {
    const gain = this.track?.gain ?? 1;
    return (
      this.state.volume *
      (Number.isFinite(gain) ? Math.min(1, Math.max(0, gain)) : 1)
    );
  }

  private updateGain() {
    if (!this.voice || !this.context) return;
    const now = this.context.currentTime;
    const gain = this.voice.gain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(this.level(), now + 0.08);
  }

  /** Call synchronously from trusted pointer/key events to retry a browser-blocked resume. */
  activate(): Promise<void> {
    if (
      this.disposed ||
      !this.active ||
      !this.visible ||
      this.state.muted ||
      !this.track ||
      this.state.mode === "playing" ||
      this.state.mode === "unavailable"
    )
      return Promise.resolve();
    if (this.pending) {
      if (this.context?.state !== "running") this.resumeContext();
      return this.pending;
    }
    try {
      if (!this.context) {
        const context = new AudioContext();
        this.context = context;
        context.onstatechange = () => {
          if (context !== this.context || this.disposed) return;
          if (context.state === "running") {
            if (this.running) this.running();
            else if (this.state.mode === "paused" && !this.pending)
              void this.activate();
          } else if (this.voice || this.phase === "loading")
            this.pauseForInterruption(false);
          else if (this.phase === "waiting") this.publish("paused");
        };
      }
    } catch {
      this.publish("unavailable");
      return Promise.resolve();
    }
    const generation = this.generation;
    const track = this.track;
    const request = new AbortController();
    this.request = request;
    this.requested = true;
    this.phase = "waiting";
    this.publish("paused");
    const context = this.context;
    const pending = this.load(context, track, generation, request).finally(
      () => {
        if (this.pending === pending) this.pending = null;
      },
    );
    this.pending = pending;
    // This remains in the original gesture even when an earlier autoplay attempt is pending.
    this.resumeContext();
    return pending;
  }

  enable(): Promise<void> {
    return this.setMuted(false);
  }

  private resumeContext() {
    const context = this.context;
    if (!context) return;
    try {
      void context.resume().then(
        () => {
          if (context === this.context) this.running?.();
        },
        () => {
          if (context === this.context && this.phase === "waiting")
            this.publish("paused");
        },
      );
    } catch {
      if (this.phase === "waiting") this.publish("paused");
    }
  }

  private waitUntilRunning(
    context: AudioContext,
    signal: AbortSignal,
  ): Promise<void> {
    if (context.state === "running") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        if (this.running === running) this.running = null;
      };
      const abort = () => {
        cleanup();
        reject(new Error("Music interrupted"));
      };
      const running = () => {
        if (context.state !== "running") return;
        cleanup();
        resolve();
      };
      this.running = running;
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else running();
    });
  }

  private async load(
    context: AudioContext,
    track: LobbyMusicTrack,
    generation: number,
    request: AbortController,
  ) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.waitUntilRunning(context, request.signal);
      if (!this.isCurrent(generation, context)) return;
      this.phase = "loading";
      this.publish("loading");
      const loading = (async () => {
        if (this.buffer) return this.buffer;
        const response = await fetch(track.src, {
          signal: request.signal,
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Music unavailable");
        if (!this.isCurrent(generation, context))
          throw new Error("Music interrupted");
        return context.decodeAudioData(await response.arrayBuffer());
      })();
      const expired = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          request.abort();
          reject(new Error("Music loading timed out"));
        }, 15000);
      });
      const buffer = await Promise.race([loading, expired]);
      if (!this.isCurrent(generation, context)) return;
      if (context.state !== "running") {
        this.pauseForInterruption(false);
        return;
      }
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0)
        throw new Error("Music could not be decoded");
      this.buffer = buffer;
      // A fast off/on cycle must never layer two copies of the same loop.
      for (const voice of this.retiring) this.releaseVoice(voice);
      this.retiring.clear();
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      source.connect(gain);
      gain.connect(context.destination);
      const voice = { source, gain };
      source.onended = () => this.releaseVoice(voice, false);
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(
        this.level(),
        context.currentTime + FADE_SECONDS,
      );
      this.voice = voice;
      source.start();
      this.phase = null;
      this.publish("playing");
    } catch {
      if (generation === this.generation && !this.disposed) {
        this.invalidate();
        this.stopVoice(false);
        this.publish("unavailable");
      }
    } finally {
      clearTimeout(timeout);
      if (this.request === request) this.request = null;
    }
  }

  private isCurrent(generation: number, context: AudioContext) {
    return (
      !this.disposed &&
      this.active &&
      this.visible &&
      !this.state.muted &&
      this.requested &&
      generation === this.generation &&
      context === this.context
    );
  }

  private invalidate() {
    this.generation++;
    this.requested = false;
    this.request?.abort();
    this.request = null;
    this.pending = null;
    this.running = null;
    this.phase = null;
  }

  stop() {
    void this.setMuted(true);
  }

  interrupt() {
    if (!this.disposed) this.pauseForInterruption(false);
  }

  private pauseForInterruption(fade: boolean) {
    const wasEnabled =
      this.requested ||
      this.state.mode === "playing" ||
      this.state.mode === "loading" ||
      this.state.mode === "paused";
    this.invalidate();
    this.stopVoice(fade);
    if (wasEnabled) this.publish("paused");
  }

  private stopVoice(fade: boolean) {
    if (!fade) {
      for (const voice of this.retiring) this.releaseVoice(voice);
      this.retiring.clear();
    }
    const voice = this.voice;
    this.voice = null;
    if (!voice) return;
    if (!fade || !this.context || this.context.state !== "running") {
      this.releaseVoice(voice);
      return;
    }
    const now = this.context.currentTime;
    const gain = voice.gain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
    this.retiring.add(voice);
    voice.source.stop(now + FADE_SECONDS);
  }

  private releaseVoice(voice: Voice, stop = true) {
    voice.source.onended = null;
    if (stop) {
      try {
        voice.source.stop();
      } catch {}
    }
    voice.source.disconnect();
    voice.gain.disconnect();
    this.retiring.delete(voice);
    if (this.voice === voice) this.voice = null;
  }

  dispose() {
    if (this.disposed) return;
    this.invalidate();
    this.disposed = true;
    this.stopVoice(true);
    const context = this.context;
    if (context) context.onstatechange = null;
    const close = () => {
      for (const voice of this.retiring) this.releaseVoice(voice);
      this.retiring.clear();
      this.buffer = null;
      this.context = null;
      void context?.close().catch(() => {});
      this.closeTimer = null;
    };
    if (this.retiring.size) this.closeTimer = setTimeout(close, 220);
    else close();
  }
}
