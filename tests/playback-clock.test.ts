import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlaybackClock } from "../src/lib/playback-clock";

beforeEach(() =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }),
);
afterEach(() => vi.useRealTimers());

it.each([1, 2, 4, 8])(
  "scales concurrent delays and animations at %sx",
  async (speed) => {
    const clock = new PlaybackClock(speed);
    const animation = { updatePlaybackRate: vi.fn(), cancel: vi.fn() };
    clock.track(animation as unknown as Animation);
    const first = vi.fn(),
      second = vi.fn();
    void clock.wait(800).then(first);
    void clock.wait(1600).then(second);
    await vi.advanceTimersByTimeAsync(800 / speed - 1);
    expect(first).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800 / speed);
    expect(second).toHaveBeenCalledOnce();
    expect(animation.updatePlaybackRate).toHaveBeenCalledWith(speed);
    clock.dispose();
  },
);

it("preserves elapsed progress when speeding up and slowing down", async () => {
  const clock = new PlaybackClock();
  const done = vi.fn();
  const animation = { updatePlaybackRate: vi.fn(), cancel: vi.fn() };
  const untrack = clock.track(animation as unknown as Animation);
  void clock.wait(1100).then(done);
  await vi.advanceTimersByTimeAsync(300);
  clock.setRate(8);
  await vi.advanceTimersByTimeAsync(50);
  expect(clock.now()).toBe(700);
  clock.setRate(2);
  await vi.advanceTimersByTimeAsync(199);
  expect(done).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toHaveBeenCalledOnce();
  expect(animation.updatePlaybackRate.mock.calls).toEqual([[1], [8], [2]]);
  untrack();
  clock.dispose();
  expect(animation.cancel).not.toHaveBeenCalled();
});

it("cancels every pending delay and animation exactly once", async () => {
  const clock = new PlaybackClock(4);
  const animation = { updatePlaybackRate: vi.fn(), cancel: vi.fn() };
  clock.track(animation as unknown as Animation);
  const failures: string[] = [];
  const waits = [clock.wait(100), clock.wait(200)].map((wait) =>
    wait.catch((error: Error) => failures.push(error.name)),
  );
  clock.dispose();
  clock.dispose();
  await Promise.all(waits);
  expect(failures).toEqual(["AbortError", "AbortError"]);
  expect(animation.cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  await expect(clock.wait(100)).rejects.toHaveProperty("name", "AbortError");
});
