import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  LobbyMusicAudio,
  readLobbyMusicVolume,
  readLobbyMusicMuted,
  type LobbyMusicTrack,
} from "../src/lib/lobby-music";

const track: LobbyMusicTrack = {
  id: "test-lobby",
  title: "Test lobby loop",
  src: "/sounds/lobby/test.mp3",
  credit: "Test fixture",
  source: "https://example.test/track",
  licenseUrl: "https://example.test/license",
  gain: 0.5,
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
class FakeParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  linearRampToValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
}
class FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn((time = 0) => {
    setTimeout(() => this.onended?.(), Math.max(0, time * 1000 - Date.now()));
  });
}
class FakeContext {
  state = "running";
  onstatechange: (() => void) | null = null;
  destination = {};
  sources: FakeSource[] = [];
  gains: {
    gain: FakeParam;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  get currentTime() {
    return Date.now() / 1000;
  }
  resume = vi.fn(async () => {
    this.state = "running";
    this.onstatechange?.();
  });
  close = vi.fn(async () => {
    this.state = "closed";
    this.onstatechange?.();
  });
  decodeAudioData = vi.fn(async () => ({ duration: 12 }) as AudioBuffer);
  createBufferSource = vi.fn(() => {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  });
  createGain = vi.fn(() => {
    const gain = {
      gain: new FakeParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    this.gains.push(gain);
    return gain;
  });
}

let context: FakeContext;
let construct: ReturnType<typeof vi.fn>;
let request: ReturnType<typeof vi.fn<typeof fetch>>;
let storage: Map<string, string>;
let players: LobbyMusicAudio[];
function player() {
  const music = new LobbyMusicAudio(vi.fn());
  players.push(music);
  return music;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  context = new FakeContext();
  construct = vi.fn(function () {
    return context;
  });
  vi.stubGlobal("AudioContext", construct);
  request = vi.fn<typeof fetch>().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as Response);
  vi.stubGlobal("fetch", request);
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  players = [];
});
afterEach(async () => {
  for (const music of players) music.dispose();
  await vi.advanceTimersByTimeAsync(250);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("default-on music lifecycle", () => {
  test("visible lobby starts automatically and preserves volume without duplicate loops", async () => {
    storage.set("amberly-lobby-music-volume-v1", "0.4");
    const music = player();
    music.configure(track, false);
    await music.activate();
    expect(construct).not.toHaveBeenCalled();
    music.configure(track, true);
    await vi.waitFor(() => expect(music.snapshot.mode).toBe("playing"));
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].loop).toBe(true);
    expect(context.sources[0].loopEnd).toBe(12);
    expect(music.snapshot).toEqual({
      mode: "playing",
      volume: 0.4,
      muted: false,
    });
    expect(
      context.gains[0].gain.linearRampToValueAtTime,
    ).toHaveBeenLastCalledWith(0.2, expect.any(Number));
    for (let i = 0; i < 4; i++) {
      music.configure(track, true);
      await music.activate();
    }
    expect(context.sources).toHaveLength(1);
    expect(request).toHaveBeenCalledOnce();
    expect(storage.has("amberly-lobby-music-muted-v1")).toBe(false);
  });

  test("saved mute blocks automatic and gesture attempts until explicit unmute", async () => {
    storage.set("amberly-lobby-music-muted-v1", "true");
    const music = player();
    expect(readLobbyMusicMuted()).toBe(true);
    music.configure(track, true);
    music.setVisible(true);
    await music.activate();
    expect(construct).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    await music.setMuted(false);
    expect(music.snapshot.mode).toBe("playing");
    expect(storage.get("amberly-lobby-music-muted-v1")).toBe("false");
    await music.setMuted(true);
    music.setVisible(false);
    music.setVisible(true);
    music.configure(track, false);
    music.configure(track, true);
    await music.activate();
    expect(context.sources).toHaveLength(1);
    const fresh = player();
    fresh.configure(track, true);
    await fresh.activate();
    expect(fresh.snapshot.muted).toBe(true);
    expect(construct).toHaveBeenCalledOnce();
  });

  test("game entry fades, return resumes, and rapid toggles do not layer loops", async () => {
    const music = player();
    music.configure(track, true);
    await music.activate();
    const now = context.currentTime;
    music.configure(track, false);
    expect(context.sources[0].stop).toHaveBeenLastCalledWith(now + 0.18);
    expect(music.snapshot).toMatchObject({ mode: "paused", muted: false });
    await music.activate();
    expect(context.sources).toHaveLength(1);
    music.configure(track, true);
    await music.activate();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    await music.setMuted(true);
    await music.setMuted(false);
    expect(context.sources).toHaveLength(3);
    expect(context.sources[1].disconnect).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  test("hidden mount stays silent, and foreground restore resumes without changing mute", async () => {
    const music = player();
    music.setVisible(false);
    music.configure(track, true);
    await music.activate();
    expect(construct).not.toHaveBeenCalled();
    music.setVisible(true);
    await music.activate();
    expect(context.sources).toHaveLength(1);
    music.setVisible(false);
    await music.activate();
    expect(context.sources[0].stop).toHaveBeenLastCalledWith();
    expect(context.sources).toHaveLength(1);
    music.setVisible(true);
    await music.activate();
    expect(context.sources).toHaveLength(2);
    expect(request).toHaveBeenCalledOnce();
    expect(music.snapshot.muted).toBe(false);
  });

  test.each(["pending", "rejected"] as const)(
    "first gesture retries %s autoplay resume synchronously without replacing the load",
    async (kind) => {
      context.state = "suspended";
      const blocked = deferred<void>();
      if (kind === "pending")
        context.resume.mockImplementationOnce(() => blocked.promise);
      else context.resume.mockRejectedValueOnce(new Error("Autoplay blocked"));
      const music = player();
      music.configure(track, true);
      await Promise.resolve();
      await Promise.resolve();
      expect(context.resume).toHaveBeenCalledOnce();
      expect(request).not.toHaveBeenCalled();
      expect(music.snapshot.mode).toBe("paused");
      const gesture = music.activate();
      expect(context.resume).toHaveBeenCalledTimes(2);
      await gesture;
      expect(context.sources).toHaveLength(1);
      expect(request).toHaveBeenCalledOnce();
      blocked.resolve();
      await Promise.resolve();
      expect(context.sources).toHaveLength(1);
    },
  );

  test.each(["muted", "dispose"] as const)(
    "unresolved autoplay is cancelled by %s and late resume stays silent",
    async (action) => {
      context.state = "suspended";
      const blocked = deferred<void>();
      context.resume.mockImplementationOnce(() => blocked.promise);
      const music = player();
      music.configure(track, true);
      if (action === "muted") await music.setMuted(true);
      else music.dispose();
      context.state = "running";
      context.onstatechange?.();
      blocked.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(request).not.toHaveBeenCalled();
      expect(context.sources).toHaveLength(0);
      if (action === "muted")
        expect(music.snapshot).toMatchObject({ mode: "off", muted: true });
      else expect(context.close).toHaveBeenCalledOnce();
    },
  );

  test("native audio recovery resumes only while visible, active and unmuted", async () => {
    const music = player();
    music.configure(track, true);
    await music.activate();
    context.state = "interrupted";
    context.onstatechange?.();
    expect(music.snapshot).toMatchObject({ mode: "paused", muted: false });
    context.state = "running";
    context.onstatechange?.();
    await vi.waitFor(() => expect(context.sources).toHaveLength(2));
    expect(request).toHaveBeenCalledOnce();
    context.state = "interrupted";
    context.onstatechange?.();
    music.configure(track, false);
    context.state = "running";
    context.onstatechange?.();
    await Promise.resolve();
    expect(context.sources).toHaveLength(2);
    music.configure(track, true);
    await music.activate();
    music.setVisible(false);
    context.state = "interrupted";
    context.onstatechange?.();
    context.state = "running";
    context.onstatechange?.();
    await Promise.resolve();
    expect(context.sources).toHaveLength(3);
    music.setVisible(true);
    await music.activate();
    await music.setMuted(true);
    context.state = "interrupted";
    context.onstatechange?.();
    context.state = "running";
    context.onstatechange?.();
    await Promise.resolve();
    expect(context.sources).toHaveLength(4);
  });
});

describe("music loading races", () => {
  test.each(["inactive", "hidden", "muted", "dispose"] as const)(
    "late decoding after %s cannot start audio",
    async (action) => {
      const decoding = deferred<AudioBuffer>();
      context.decodeAudioData.mockReturnValueOnce(decoding.promise);
      const music = player();
      music.configure(track, true);
      const pending = music.activate();
      await vi.waitFor(() =>
        expect(context.decodeAudioData).toHaveBeenCalledOnce(),
      );
      if (action === "inactive") music.configure(track, false);
      else if (action === "hidden") music.setVisible(false);
      else if (action === "muted") await music.setMuted(true);
      else music.dispose();
      decoding.resolve({ duration: 20 } as AudioBuffer);
      await pending;
      expect(context.sources).toHaveLength(0);
      if (action === "inactive" || action === "hidden")
        expect(music.snapshot).toMatchObject({ mode: "paused", muted: false });
      if (action === "muted")
        expect(music.snapshot).toMatchObject({ mode: "off", muted: true });
      if (action === "dispose") expect(context.close).toHaveBeenCalledOnce();
    },
  );

  test("repeated gestures during loading share one fetch and decoder", async () => {
    const decoding = deferred<AudioBuffer>();
    context.decodeAudioData.mockReturnValueOnce(decoding.promise);
    const music = player();
    music.configure(track, true);
    const first = music.activate();
    await vi.waitFor(() =>
      expect(context.decodeAudioData).toHaveBeenCalledOnce(),
    );
    expect(music.activate()).toBe(first);
    expect(music.activate()).toBe(first);
    decoding.resolve({ duration: 12 } as AudioBuffer);
    await first;
    expect(context.sources).toHaveLength(1);
    expect(request).toHaveBeenCalledOnce();
  });

  test("inactive during fetch aborts it and stale failure cannot replace paused state", async () => {
    const fetching = deferred<Response>();
    request.mockReturnValueOnce(fetching.promise);
    const music = player();
    music.configure(track, true);
    const pending = music.activate();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    const signal = request.mock.calls[0][1]?.signal;
    music.configure(track, false);
    expect(signal?.aborted).toBe(true);
    fetching.reject(new Error("aborted"));
    await pending;
    expect(context.sources).toHaveLength(0);
    expect(music.snapshot.mode).toBe("paused");
  });

  test("old decode cannot replace a newer track even when it completes last", async () => {
    const oldDecode = deferred<AudioBuffer>();
    context.decodeAudioData.mockReturnValueOnce(oldDecode.promise);
    const music = player();
    music.configure(track, true);
    const first = music.activate();
    await vi.waitFor(() =>
      expect(context.decodeAudioData).toHaveBeenCalledOnce(),
    );
    music.configure(
      { ...track, id: "replacement", src: "/sounds/lobby/replacement.mp3" },
      true,
    );
    await music.activate();
    oldDecode.resolve({ duration: 99 } as AudioBuffer);
    await first;
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer?.duration).toBe(12);
  });

  test.each(["fetch", "decode", "timeout"] as const)(
    "%s failure ignores arbitrary gestures until explicit mute/unmute",
    async (failure) => {
      const stalled = deferred<AudioBuffer>();
      if (failure === "fetch")
        request.mockResolvedValueOnce({ ok: false } as Response);
      else if (failure === "decode")
        context.decodeAudioData.mockRejectedValueOnce(new Error("bad audio"));
      else context.decodeAudioData.mockReturnValueOnce(stalled.promise);
      const music = player();
      music.configure(track, true);
      const pending = music.activate();
      if (failure === "timeout") await vi.advanceTimersByTimeAsync(15001);
      await pending;
      expect(music.snapshot.mode).toBe("unavailable");
      const calls = request.mock.calls.length;
      for (let i = 0; i < 4; i++) await music.activate();
      music.configure(track, false);
      music.configure(track, true);
      music.setVisible(false);
      music.setVisible(true);
      expect(request).toHaveBeenCalledTimes(calls);
      stalled.resolve({ duration: 99 } as AudioBuffer);
      await Promise.resolve();
      expect(context.sources).toHaveLength(0);
      await music.setMuted(true);
      await music.setMuted(false);
      expect(music.snapshot.mode).toBe("playing");
      expect(context.sources).toHaveLength(1);
    },
  );

  test("dispose finishes fade and closes once without stale state notifications", async () => {
    const changes = vi.fn();
    const music = new LobbyMusicAudio(changes);
    players.push(music);
    music.configure(track, true);
    await music.activate();
    const count = changes.mock.calls.length;
    const now = context.currentTime;
    music.dispose();
    music.dispose();
    expect(context.sources[0].stop).toHaveBeenLastCalledWith(now + 0.18);
    expect(context.close).not.toHaveBeenCalled();
    music.configure(track, true);
    await music.activate();
    await vi.advanceTimersByTimeAsync(220);
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledTimes(count);
  });
});

test("malformed or denied preferences cannot block playback or undo an explicit mute", async () => {
  expect(readLobbyMusicVolume()).toBe(0.2);
  expect(readLobbyMusicMuted()).toBe(false);
  for (const bad of ["NaN", "-1", "2", "broken"]) {
    storage.set("amberly-lobby-music-volume-v1", bad);
    expect(readLobbyMusicVolume()).toBe(0.2);
  }
  storage.set("amberly-lobby-music-volume-v1", "0");
  expect(readLobbyMusicVolume()).toBe(0);
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("disabled");
    },
    setItem: () => {
      throw new Error("disabled");
    },
  });
  expect(readLobbyMusicVolume()).toBe(0.2);
  expect(readLobbyMusicMuted()).toBe(false);
  const music = player();
  music.setVolume(0.35);
  music.configure(track, true);
  await music.activate();
  expect(music.snapshot).toEqual({
    mode: "playing",
    volume: 0.35,
    muted: false,
  });
  await music.setMuted(true);
  await music.activate();
  expect(context.sources).toHaveLength(1);
});
