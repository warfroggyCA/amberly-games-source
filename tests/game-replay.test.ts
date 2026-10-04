import { describe, expect, it } from "vitest";
import { gameReplay } from "../src/domain/game";
import { replayStepLabel } from "../src/lib/game-replay";
import { replayFixture } from "./fixtures/replay";

describe("read-only recorded replay", () => {
  it("matches every authoritative prefix, including corrections, undo and final adjustments", () => {
    const { game, snapshots } = replayFixture();
    const original = structuredClone(game);
    const replay = gameReplay(game)!;
    expect(replay).not.toBeNull();
    snapshots.forEach((snapshot, index) =>
      expect(replay.at(index)).toEqual(snapshot),
    );
    expect(replay.at(2).board[7][7]?.blank).toBe(false);
    expect(replay.at(3).board[7][7]?.blank).toBe(true);
    expect(replay.at(3).scores).not.toEqual(replay.at(2).scores);
    expect(replay.at(4).board[7][10]).toBeNull();
    expect(replay.at(7).result?.scores).toEqual(game.result?.scores);
    expect(game).toEqual(original);
  });
  it("seeks backward and repeats idempotently without touching the source", () => {
    const { game, snapshots } = replayFixture();
    const replay = gameReplay(game)!;
    for (const index of [7, 1, 4, 0, 7, 2, 2, 0])
      expect(replay.at(index)).toEqual(snapshots[index]);
    expect(Object.isFrozen(replay.at(1).board)).toBe(true);
    for (const index of [-1, 8, NaN, 0.5])
      expect(() => replay.at(index)).toThrow(RangeError);
  });
  it("refuses gaps, missing legacy journals and inconsistent projections", () => {
    const { game } = replayFixture();
    expect(gameReplay({ ...game, events: [] })).toBeNull();
    expect(
      gameReplay({
        ...game,
        events: game.events.filter((event) => event.sequence !== 2),
      }),
    ).toBeNull();
    expect(gameReplay({ ...game, scores: { doug: 900, erin: 0 } })).toBeNull();
    expect(
      gameReplay({
        ...game,
        events: game.events.map((event, index) => ({
          ...event,
          sequence: index + 2,
        })),
      }),
    ).toBeNull();
  });
  it("labels non-placement steps without inventing exchanged letters or draws", () => {
    const { game } = replayFixture();
    expect(replayStepLabel(game, game.events[4])).toBe(
      "Erin exchanged 3 tiles",
    );
    expect(replayStepLabel(game, game.events[5])).toBe("Doug passed");
    expect(replayStepLabel(game, game.events[2])).toContain("corrected");
    expect(replayStepLabel(game, game.events[3])).toContain("undone");
  });
});
