import { expect, it } from "vitest";
import {
  applyCommand,
  createGame,
  hydrateGame,
  gameReplay,
  type GameState,
  type GameResult,
} from "../src/domain/game";
import fixture from "./fixtures/legacy-offset-clock.json";
const lexicon = {
  id: "fixture",
  edition: "1",
  status: "test",
  has: () => true,
} as const;
function success(result: GameResult): GameState {
  if (!result.ok) throw new Error(result.error.code);
  return result.game;
}
function started(timedAt: string) {
  const game = success(
    createGame(fixture.definition as GameState["definition"]),
  );
  return success(
    applyCommand(
      game,
      { type: "start-clock", id: "start", expectedRevision: 0, timedAt },
      lexicon,
    ),
  );
}
it.each([
  ["2026-10-08T12:00:00+02:00", "2026-10-08T10:01:00Z"],
  ["2026-10-08T10:00:00Z", "2026-10-08T10:00:00.500Z"],
  ["2026-10-08T10:00:00Z", "2026-10-08T12:00:00+02:00"],
])(
  "compares instants and hydrates newly accepted timestamps: %s to %s",
  (first, next) => {
    const game = success(
      applyCommand(
        started(first),
        { id: "pass", expectedRevision: 1, type: "pass", timedAt: next },
        lexicon,
      ),
    );
    expect(success(hydrateGame(game, lexicon))).toEqual(game);
  },
);
it("rejects backward instants even when their text sorts forwards", () => {
  expect(
    applyCommand(
      started("2026-10-08T10:00:00Z"),
      {
        id: "pass",
        expectedRevision: 1,
        type: "pass",
        timedAt: "2026-10-08T11:00:00+02:00",
      },
      lexicon,
    ),
  ).toMatchObject({ ok: false, error: { code: "CLOCK_MOVED_BACK" } });
});
it("preserves the original-engine backward-instant journal, including correction and undo", () => {
  // Captured with the released pre-repair engine; never reconstruct this fixture
  // using the new validator or normalize its timestamp/fingerprint bytes.
  const original = JSON.stringify(fixture);
  const game = success(hydrateGame(fixture, lexicon));
  expect(game).toEqual(fixture);
  expect(gameReplay(game)?.at(2)).toEqual(game);
  const corrected = success(
    applyCommand(
      game,
      {
        id: "edit",
        expectedRevision: 2,
        type: "edit-turn",
        turnId: "play",
        reason: "Correct the recorded word",
        placements: [
          { row: 7, col: 7, tile: { letter: "A", blank: false } },
          { row: 7, col: 8, tile: { letter: "N", blank: false } },
        ],
      },
      lexicon,
    ),
  );
  expect(corrected.turns[0].words[0].word).toBe("AN");
  expect(success(hydrateGame(corrected, lexicon))).toEqual(corrected);
  const undone = success(
    applyCommand(
      corrected,
      {
        id: "undo",
        expectedRevision: 3,
        type: "undo",
        reason: "Remove the recorded play",
        timedAt: "2026-10-08T10:01:00Z",
      },
      lexicon,
    ),
  );
  expect(undone.turns).toHaveLength(0);
  expect(success(hydrateGame(undone, lexicon))).toEqual(undone);
  expect(JSON.stringify(fixture)).toBe(original);
  expect(
    applyCommand(
      game,
      {
        id: "new-backward",
        expectedRevision: 2,
        type: "pass",
        timedAt: "2026-10-08T11:30:00+02:00",
      },
      lexicon,
    ),
  ).toMatchObject({ ok: false, error: { code: "CLOCK_MOVED_BACK" } });
});
it("does not expose replay compatibility through a command field", () => {
  const command = {
    id: "pass",
    expectedRevision: 1,
    type: "pass" as const,
    timedAt: "2026-10-08T11:00:00+02:00",
    replayClockCompatibility: true,
  };
  expect(
    applyCommand(started("2026-10-08T10:00:00Z"), command, lexicon),
  ).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
});
it("rejects saved sequences violating both clock orderings", () => {
  const invalid = structuredClone(fixture);
  invalid.events[1].command.timedAt = "2026-10-08T09:00:00Z";
  expect(hydrateGame(invalid, lexicon)).toMatchObject({
    ok: false,
    error: {
      code: "INVALID_SAVED_GAME",
      message: expect.stringContaining("clock moved backwards"),
    },
  });
});
