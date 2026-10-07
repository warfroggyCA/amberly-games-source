import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { hydrateGame, hydrateGameCooperatively } from "../src/domain/game";
import { testLexicon } from "../src/lib/test-lexicon";
import { replayFixture } from "./fixtures/replay";

it("cooperative verification returns exactly the synchronous projection through correction, undo and finalization", async () => {
  for (const snapshot of replayFixture().snapshots) {
    const raw = JSON.parse(JSON.stringify(snapshot));
    expect(
      await hydrateGameCooperatively(raw, testLexicon, () => setImmediate()),
    ).toEqual(hydrateGame(raw, testLexicon));
  }
});
it("cooperative verification rejects corrupted projections and journal events exactly as synchronous verification", async () => {
  const { game } = replayFixture();
  const score = structuredClone(game);
  score.scores.doug++;
  const turn = structuredClone(game);
  turn.events[0].turn!.score++;
  const correction = structuredClone(game);
  correction.events[2].correctedTurns![0].score++;
  const badCommand = structuredClone(game);
  badCommand.events[0].command.expectedRevision++;
  for (const value of [
    score,
    turn,
    correction,
    badCommand,
    null,
    { events: [] },
  ]) {
    const sync = hydrateGame(value, testLexicon);
    expect(sync.ok).toBe(false);
    expect(
      await hydrateGameCooperatively(value, testLexicon, () => setImmediate()),
    ).toEqual(sync);
  }
});
it("cancellation propagates separately from malformed-history failures, including after verification", async () => {
  const { game } = replayFixture();
  const aborted = new Error("cancelled by caller");
  await expect(
    hydrateGameCooperatively(game, testLexicon, async () => {
      throw aborted;
    }),
  ).rejects.toBe(aborted);
  let calls = 0;
  await expect(
    hydrateGameCooperatively(game, testLexicon, async () => {
      if (++calls === 2) throw aborted;
    }),
  ).rejects.toBe(aborted);
});

it("schedules and cancels inside historical correction reconstruction", async () => {
  const game = replayFixture().snapshots[3]; // Two plays, then a correction that replays both.
  const expected = hydrateGame(game, testLexicon);
  let clock = 0;
  const now = vi
    .spyOn(performance, "now")
    .mockImplementation(() => (clock += 13));
  try {
    let checkpoints = 0;
    expect(
      await hydrateGameCooperatively(game, testLexicon, async () => {
        checkpoints++;
      }),
    ).toEqual(expected);
    expect(checkpoints).toBeGreaterThan(game.events.length + 2);
    const cancelled = new Error("cancel inside correction replay");
    let reached = 0;
    await expect(
      hydrateGameCooperatively(game, testLexicon, async () => {
        // Start + two outer commands + two nested commands; correction not yet returned.
        if (++reached === 5) throw cancelled;
      }),
    ).rejects.toBe(cancelled);
    expect(reached).toBe(5);
  } finally {
    now.mockRestore();
  }
});
