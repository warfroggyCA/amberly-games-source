import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GameAudio } from "../src/lib/game-audio";

class Context {
  static instances: Context[] = [];
  state = "suspended";
  currentTime = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  sources: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  constructor() {
    Context.instances.push(this);
  }
  resume = vi.fn(async () => {
    this.state = "running";
    this.onstatechange?.();
  });
  close = vi.fn(async () => {
    this.state = "closed";
    this.onstatechange?.();
  });
  decodeAudioData = vi.fn(async () => ({ duration: 1 }));
  createGain() {
    return {
      connect() {},
      disconnect() {},
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
    };
  }
  createBufferSource() {
    const source = {
      buffer: null,
      connect() {},
      disconnect() {},
      onended: null,
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.sources.push(source);
    return source;
  }
}
beforeEach(() => {
  Context.instances = [];
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());

it.each(["suspended", "interrupted"])(
  "stops pending cues on %s and resumes without replaying them",
  async (state) => {
    const unavailable = vi.fn();
    const audio = new GameAudio(unavailable);
    await audio.enable();
    const context = Context.instances[0];
    audio.play(["score", "turn"]);
    context.state = state;
    context.onstatechange?.();
    expect(audio.running).toBe(false);
    expect(unavailable).toHaveBeenCalledOnce();
    expect(
      context.sources.every((source) => source.stop.mock.calls.length === 1),
    ).toBe(true);
    await audio.enable();
    expect(audio.running).toBe(true);
    expect(context.sources).toHaveLength(2);
    audio.play(["score"]);
    expect(context.sources).toHaveLength(3);
    expect(context.resume).toHaveBeenCalledTimes(2);
    audio.dispose();
  },
);

it("checks foreground state even if the context omitted a statechange event", async () => {
  const unavailable = vi.fn();
  const audio = new GameAudio(unavailable);
  await audio.enable();
  Context.instances[0].state = "interrupted";
  expect(audio.running).toBe(false);
  audio.checkState();
  expect(unavailable).toHaveBeenCalledOnce();
  audio.disable();
  audio.checkState();
  expect(unavailable).toHaveBeenCalledOnce();
  audio.dispose();
});

it("recreates a closed context and detaches the disposed context callback", async () => {
  const unavailable = vi.fn();
  const audio = new GameAudio(unavailable);
  await audio.enable();
  const first = Context.instances[0];
  await first.close();
  expect(unavailable).toHaveBeenCalledOnce();
  await audio.enable();
  expect(Context.instances).toHaveLength(2);
  expect(first.onstatechange).toBeNull();
  audio.play(["score"]);
  expect(Context.instances[1].sources).toHaveLength(1);
  audio.dispose();
  expect(Context.instances[1].onstatechange).toBeNull();
  expect(unavailable).toHaveBeenCalledOnce();
});

it("permits retry after resume rejection without scheduling a cue", async () => {
  const audio = new GameAudio(vi.fn());
  await audio.enable();
  const context = Context.instances[0];
  context.state = "suspended";
  context.resume.mockRejectedValueOnce(new Error("Gesture rejected"));
  await expect(audio.enable()).rejects.toThrow("Gesture rejected");
  expect(context.sources).toHaveLength(0);
  await audio.enable();
  expect(audio.running).toBe(true);
  expect(context.sources).toHaveLength(0);
  audio.dispose();
});

it("does not load or reactivate after mute or disposal while resume is pending", async () => {
  const audio = new GameAudio(vi.fn());
  await audio.enable();
  const context = Context.instances[0];
  let resolve!: () => void;
  context.resume.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const fetches = vi.mocked(fetch).mock.calls.length;
  const pending = audio.enable();
  audio.disable();
  resolve();
  await expect(pending).rejects.toThrow("Audio interrupted");
  expect(vi.mocked(fetch).mock.calls).toHaveLength(fetches);
  audio.dispose();
});
