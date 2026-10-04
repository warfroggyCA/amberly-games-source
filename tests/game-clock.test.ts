import { describe, expect, it } from "vitest";
import { commandTiming, turnTiming } from "../src/lib/turn-timing";
import type { GameState } from "../src/domain/game";

const at = (seconds: number) => new Date(seconds * 1000).toISOString();
describe("game and turn clocks", () => {
  it("counts all active game time, excludes pauses, and freezes after finalization", () => {
    const timingEvents = [
      { type: "start-clock", timedAt: at(100) },
      { type: "play", turnId: "a", timedAt: at(110) },
      { type: "pause", timedAt: at(115) },
      { type: "resume", timedAt: at(200) },
    ];
    expect(turnTiming({ timingEvents }, 210_000)).toMatchObject({
      totalMs: 25_000,
      currentMs: 15_000,
      durations: { a: 10_000 },
    });
    timingEvents.push({ type: "finalize", timedAt: at(220) });
    expect(turnTiming({ timingEvents }, 999_000).totalMs).toBe(35_000);
    expect(
      turnTiming(JSON.parse(JSON.stringify({ timingEvents })), 999_000).totalMs,
    ).toBe(35_000);
  });
  it("does not erase time spent when a move is undone", () => {
    expect(
      turnTiming(
        {
          timingEvents: [
            { type: "start-clock", timedAt: at(100) },
            { type: "play", turnId: "a", timedAt: at(110) },
            { type: "undo", timedAt: at(120) },
          ],
        },
        125_000,
      ),
    ).toMatchObject({ totalMs: 25_000, currentMs: 5_000 });
  });
  it("timestamps timed previews and saves identically without masking a backward clock", () => {
    const game = {
      events: [{ command: { type: "start-clock", timedAt: at(100) } }],
    } as Pick<GameState, "events">;
    expect(commandTiming(game, "finalize", new Date(110_000))).toEqual({
      timedAt: at(110),
    });
    expect(commandTiming(game, "finalize", new Date(90_000))).toEqual({
      timedAt: at(90),
    });
    expect(commandTiming({ events: [] }, "finalize")).toEqual({});
    expect(
      commandTiming({ events: [] }, "start-clock", new Date(100_000)),
    ).toEqual({ timedAt: at(100) });
  });
});
