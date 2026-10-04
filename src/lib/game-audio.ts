import manifest from "../../config/game-sounds.json";
import type { GameSound } from "./game-sounds";

/** One audio context per mounted game, unlocked by an explicit tap on this device. */
export class GameAudio {
  private context: AudioContext | null = null;
  private buffers = new Map<GameSound, AudioBuffer>();
  private sources: AudioBufferSourceNode[] = [];
  private request: AbortController | null = null;
  private generation = 0;
  private active = false;
  constructor(private onUnavailable: () => void) {}
  get running() {
    return this.context?.state === "running";
  }
  checkState = () => {
    if (this.active && !this.running) {
      // Suspended sources must not replay when a later gesture resumes audio.
      this.stop();
      this.onUnavailable();
    }
  };
  async enable() {
    const generation = ++this.generation;
    this.active = false;
    this.stop();
    this.request?.abort();
    if (!this.context || this.context.state === "closed") {
      if (this.context) this.context.onstatechange = null;
      this.context = new AudioContext();
      this.context.onstatechange = this.checkState;
    }
    const context = this.context;
    // Resume within the click gesture, before any network/decode await (Safari).
    await context.resume();
    if (generation !== this.generation) throw new Error("Audio interrupted");
    const request = new AbortController();
    this.request = request;
    await Promise.all(
      manifest.map(async (asset) => {
        const key = asset.key as GameSound;
        if (this.buffers.has(key)) return;
        const response = await fetch(`/sounds/${key}.wav`, {
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) throw new Error("Audio unavailable");
        const buffer = await context.decodeAudioData(
          await response.arrayBuffer(),
        );
        if (generation === this.generation) this.buffers.set(key, buffer);
      }),
    );
    if (generation !== this.generation || context.state !== "running")
      throw new Error("Audio interrupted");
    this.active = true;
  }
  play(cues: GameSound[]) {
    this.stop();
    if (!cues.length) return;
    const context = this.context;
    if (!context || context.state !== "running") {
      this.onUnavailable();
      return;
    }
    let start = context.currentTime + 0.03;
    for (const cue of cues) {
      const buffer = this.buffers.get(cue);
      const asset = manifest.find((a) => a.key === cue);
      if (!buffer || !asset) {
        this.onUnavailable();
        return;
      }
      const duration = Math.min(buffer.duration, asset.maxDuration);
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(context.destination);
      const volume = cue === "crowd" ? 0.35 : cue === "turn" ? 0.3 : 0.5;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.015);
      gain.gain.setValueAtTime(
        volume,
        start + Math.max(0.015, duration - 0.18),
      );
      gain.gain.linearRampToValueAtTime(0, start + duration);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        this.sources = this.sources.filter((s) => s !== source);
      };
      this.sources.push(source);
      source.start(start, 0, duration);
      start += duration + 0.08;
    }
  }
  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
    this.sources = [];
  }
  disable() {
    this.active = false;
    this.generation++;
    this.request?.abort();
    this.stop();
  }
  dispose() {
    this.disable();
    if (this.context) this.context.onstatechange = null;
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
