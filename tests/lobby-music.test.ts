import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  LobbyMusicAudio,
  readLobbyMusicVolume,
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

describe("lobby music playback permission", () => {
  test("is off without a user action, loops a decoded buffer and persists volume only", async () => {
    const music = player();
    music.configure(track, false);
    await music.enable();
    music.configure(track, true);
    music.setVolume(0.4);
    expect(construct).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(music.snapshot.mode).toBe("off");
    await music.enable();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      track.src,
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].loop).toBe(true);
    expect(context.sources[0].loopEnd).toBe(12);
    expect(context.sources[0].start).toHaveBeenCalledOnce();
    expect(
      context.gains[0].gain.linearRampToValueAtTime,
    ).toHaveBeenLastCalledWith(0.2, 0.18);
    expect(music.snapshot).toEqual({ mode: "playing", volume: 0.4 });
    expect([...storage.entries()]).toEqual([
      ["amberly-lobby-music-volume-v1", "0.4"],
    ]);
    await music.enable();
    expect(context.sources).toHaveLength(1);
  });

  test("leaving a lobby fades out and returning requires a new tap", async () => {
    const music = player();
    music.configure(track, true);
    await music.enable();
    music.configure(track, false);
    expect(context.sources[0].stop).toHaveBeenLastCalledWith(0.18);
    expect(music.snapshot.mode).toBe("paused");
    music.configure(track, true);
    expect(context.sources).toHaveLength(1);
    await music.enable();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(music.snapshot.mode).toBe("playing");
  });

  test("browser suspension stops immediately and state restoration does not autoplay", async () => {
    const music = player();
    music.configure(track, true);
    await music.enable();
    context.state = "interrupted";
    context.onstatechange?.();
    expect(music.snapshot.mode).toBe("paused");
    expect(context.sources[0].stop).toHaveBeenLastCalledWith();
    context.state = "running";
    context.onstatechange?.();
    music.interrupt(); // pageshow/foreground still does not grant permission.
    expect(context.sources).toHaveLength(1);
    expect(music.snapshot.mode).toBe("paused");
    await music.enable();
    expect(context.sources).toHaveLength(2);
    expect(music.snapshot.mode).toBe("playing");
  });

  test("off/on during a fade never stacks loops, and remount starts off", async () => {
    const music = player();
    music.configure(track, true);
    await music.enable();
    music.stop();
    expect(music.snapshot.mode).toBe("off");
    await music.enable();
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(context.sources[1].start).toHaveBeenCalledOnce();
    music.dispose();
    await vi.advanceTimersByTimeAsync(220);
    expect(context.close).toHaveBeenCalledOnce();
    const fresh = player();
    fresh.configure(track, true);
    expect(fresh.snapshot.mode).toBe("off");
    expect(construct).toHaveBeenCalledOnce();
  });
});

describe("lobby music async and failure paths", () => {
  test.each(["inactive", "interrupt", "off", "dispose"] as const)(
    "late decoding after %s cannot start audio",
    async (action) => {
      const decoding = deferred<AudioBuffer>();
      context.decodeAudioData.mockReturnValueOnce(decoding.promise);
      const music = player();
      music.configure(track, true);
      const pending = music.enable();
      await vi.waitFor(() =>
        expect(context.decodeAudioData).toHaveBeenCalledOnce(),
      );
      if (action === "inactive") music.configure(track, false);
      else if (action === "interrupt") music.interrupt();
      else if (action === "off") music.stop();
      else music.dispose();
      decoding.resolve({ duration: 20 } as AudioBuffer);
      await pending;
      expect(context.sources).toHaveLength(0);
      if (action === "inactive" || action === "interrupt") {
        expect(music.snapshot.mode).toBe("paused");
        music.configure(track, true);
        expect(context.sources).toHaveLength(0);
      } else if (action === "off") expect(music.snapshot.mode).toBe("off");
      if (action === "dispose") expect(context.close).toHaveBeenCalledOnce();
    },
  );

  test("inactive while fetch is pending aborts it and preserves the paused state", async () => {
    const fetching = deferred<Response>();
    request.mockReturnValueOnce(fetching.promise);
    const music = player();
    music.configure(track, true);
    const pending = music.enable();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    const signal = request.mock.calls[0][1]?.signal;
    music.configure(track, false);
    expect(signal?.aborted).toBe(true);
    fetching.reject(new Error("aborted"));
    await pending;
    expect(context.sources).toHaveLength(0);
    expect(music.snapshot.mode).toBe("paused");
  });

  test("late resume after interruption neither fetches nor plays", async () => {
    const resuming = deferred<void>();
    context.resume.mockReturnValueOnce(resuming.promise);
    const music = player();
    music.configure(track, true);
    const pending = music.enable();
    music.interrupt();
    resuming.resolve();
    await pending;
    expect(request).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);
    expect(music.snapshot.mode).toBe("paused");
  });

  test("track replacement ignores an old decode even when it completes last", async () => {
    const oldDecode = deferred<AudioBuffer>();
    context.decodeAudioData.mockReturnValueOnce(oldDecode.promise);
    const music = player();
    music.configure(track, true);
    const first = music.enable();
    await vi.waitFor(() =>
      expect(context.decodeAudioData).toHaveBeenCalledOnce(),
    );
    music.configure(
      { ...track, id: "replacement", src: "/sounds/lobby/replacement.mp3" },
      true,
    );
    expect(music.snapshot.mode).toBe("off");
    await music.enable();
    oldDecode.resolve({ duration: 99 } as AudioBuffer);
    await first;
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer?.duration).toBe(12);
    expect(music.snapshot.mode).toBe("playing");
  });

  test("a stalled decode times out, and late completion cannot recover playback", async () => {
    const stalled = deferred<AudioBuffer>();
    context.decodeAudioData.mockReturnValueOnce(stalled.promise);
    const music = player();
    music.configure(track, true);
    const pending = music.enable();
    await vi.advanceTimersByTimeAsync(15001);
    await pending;
    expect(music.snapshot.mode).toBe("unavailable");
    expect(context.sources).toHaveLength(0);
    stalled.resolve({ duration: 12 } as AudioBuffer);
    await Promise.resolve();
    expect(context.sources).toHaveLength(0);
    await music.enable();
    expect(music.snapshot.mode).toBe("playing");
  });

  test.each(["fetch", "decode", "resume"] as const)(
    "%s failure is retryable without granting playback permission",
    async (failure) => {
      if (failure === "fetch")
        request.mockResolvedValueOnce({ ok: false } as Response);
      else if (failure === "decode")
        context.decodeAudioData.mockRejectedValueOnce(new Error("bad audio"));
      else context.resume.mockRejectedValueOnce(new Error("not allowed"));
      const music = player();
      music.configure(track, true);
      await music.enable();
      expect(context.sources).toHaveLength(0);
      expect(music.snapshot.mode).toBe("unavailable");
      await music.enable();
      expect(context.sources).toHaveLength(1);
      expect(music.snapshot.mode).toBe("playing");
    },
  );

  test("dispose cancels work, finishes its fade and closes the context once", async () => {
    const changes = vi.fn();
    const music = new LobbyMusicAudio(changes);
    players.push(music);
    music.configure(track, true);
    await music.enable();
    const count = changes.mock.calls.length;
    music.dispose();
    expect(context.sources[0].stop).toHaveBeenLastCalledWith(0.18);
    expect(context.close).not.toHaveBeenCalled();
    music.dispose();
    music.configure(track, true);
    await music.enable();
    await vi.advanceTimersByTimeAsync(220);
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledTimes(count);
  });
});

test("bad or unavailable volume storage never prevents music playback", async () => {
  expect(readLobbyMusicVolume()).toBe(0.2);
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
  const music = player();
  music.configure(track, true);
  music.setVolume(0.35);
  await music.enable();
  expect(music.snapshot).toEqual({ mode: "playing", volume: 0.35 });
});
