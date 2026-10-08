import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  GameClock,
  TurnClock,
  PlayerElapsedTime,
  TimingSummary,
} from "../src/components/TurnTiming";
import { turnTiming, type TimingEvent } from "../src/lib/turn-timing";

const start: TimingEvent = {
  type: "start-clock",
  timedAt: "2026-10-08T10:00:00Z",
};
const now = Date.parse("2026-10-08T10:01:00Z");
const backwards = {
  type: "pass",
  turnId: "a",
  timedAt: "2026-10-08T11:00:00+02:00",
};

describe("historical timing uncertainty", () => {
  it.each([
    [start, backwards],
    [
      start,
      { type: "pause", timedAt: "2026-10-08T10:00:30Z" },
      { type: "resume", timedAt: "2026-10-08T09:59:00Z" },
    ],
    [start, { type: "pass", turnId: "a" }],
    [start, { type: "edit-turn", timedAt: "not-a-date" }],
    [{ type: "start-clock" }],
  ])(
    "suppresses uncertain totals without changing recorded events: %j",
    (...timingEvents) => {
      const game = { timingEvents };
      const original = JSON.stringify(game);
      expect(turnTiming(game, now)).toEqual({
        started: true,
        reliable: false,
        totalMs: null,
        currentMs: null,
        durations: {},
      });
      expect(JSON.stringify(game)).toBe(original);
    },
  );

  it("preserves valid offset/fraction instants, untimed correction metadata and untimed legacy turns", () => {
    const timingEvents: TimingEvent[] = [
      { type: "pass", turnId: "legacy" },
      start,
      { type: "edit-turn" },
      { type: "pass", turnId: "a", timedAt: "2026-10-08T12:00:00.500+02:00" },
      { type: "pause", timedAt: "2026-10-08T10:00:00.500Z" },
    ];
    expect(turnTiming({ timingEvents }, now)).toEqual({
      started: true,
      reliable: true,
      totalMs: 500,
      currentMs: 0,
      durations: { a: 500 },
    });
    expect(turnTiming({ timingEvents: [{ type: "pass" }] }, now)).toMatchObject(
      { started: false, reliable: true, durations: {} },
    );
  });

  it("shows uncertainty in every elapsed-time surface instead of false numbers or averages", () => {
    const game = {
      timingEvents: [start, backwards],
      turns: [],
      players: [],
      status: "active" as const,
      currentPlayerId: "p",
    };
    const before = JSON.stringify(game);
    for (const view of [
      createElement(GameClock, { game }),
      createElement(TurnClock, { game }),
      createElement(PlayerElapsedTime, { game, playerId: "p" }),
      createElement(TimingSummary, { game }),
    ]) {
      const html = renderToStaticMarkup(view);
      expect(html).toContain("Timing unavailable");
      expect(html).not.toMatch(/61:00|NaN|Average|<table/);
    }
    expect(JSON.stringify(game)).toBe(before);
  });
});
