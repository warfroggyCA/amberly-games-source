import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createGame,
  type GameState,
  type GameCommand,
  type GameResult,
} from "../src/domain/game";
import { buildRoundRows } from "../src/lib/round-scores";
import type { Letter } from "../src/domain/types";
const lexicon = {
  id: "round-fixture",
  edition: "1",
  status: "test" as const,
  has: (word: string) => ["CAT", "CATS", "AT", "TO"].includes(word),
};
function ok(result: GameResult) {
  if (!result.ok) throw new Error(result.error.message);
  return result.game;
}
function start() {
  return ok(
    createGame({
      id: "round-test",
      players: [
        { id: "a", name: "A", seat: 0 },
        { id: "b", name: "B", seat: 2 },
      ],
      firstPlayerId: "a",
      direction: "clockwise",
      lexicon,
      createdAt: "2026-09-14T12:00:00.000Z",
    }),
  );
}
function play(game: GameState, tiles: Array<[number, number, Letter]>) {
  return ok(
    applyCommand(
      game,
      {
        id: `c${game.revision}`,
        expectedRevision: game.revision,
        type: "play",
        placements: tiles.map(([row, col, letter]) => ({
          row,
          col,
          tile: { letter, blank: false },
        })),
      },
      lexicon,
    ),
  );
}
describe("round score display", () => {
  it("shows distinct per-round and accumulated scores from verified legal moves", () => {
    let game = start();
    game = play(game, [
      [7, 7, "C"],
      [7, 8, "A"],
      [7, 9, "T"],
    ]);
    game = play(game, [[7, 10, "S"]]);
    // I9 doubles the newly placed T: AT earns 1 + 2 = 3.
    game = play(game, [[8, 8, "T"]]);
    game = play(game, [[8, 9, "O"]]);
    expect(
      buildRoundRows(game, false)
        .slice(0, 2)
        .map((r) => r.cells.map((c) => c.value)),
    ).toEqual([
      [10, 6],
      [3, 4],
    ]);
    expect(
      buildRoundRows(game, true)
        .slice(0, 2)
        .map((r) => r.cells.map((c) => c.value)),
    ).toEqual([
      [10, 6],
      [13, 10],
    ]);
    expect(
      buildRoundRows(game, true)[2].cells.map((c) => [c.value, c.turn]),
    ).toEqual([
      [13, undefined],
      [10, undefined],
    ]);
  });
  it("keeps a missing first turn blank and carries totals through a pass", () => {
    let game = play(start(), [
      [7, 7, "C"],
      [7, 8, "A"],
      [7, 9, "T"],
    ]);
    expect(buildRoundRows(game, true)[0].cells.map((c) => c.value)).toEqual([
      10,
      null,
    ]);
    for (const type of ["pass", "pass"]) {
      game = ok(
        applyCommand(
          game,
          {
            id: `c${game.revision}`,
            expectedRevision: game.revision,
            type,
          } as GameCommand,
          lexicon,
        ),
      );
    }
    expect(buildRoundRows(game, false)[1].cells[0].value).toBe(0);
    expect(buildRoundRows(game, true)[1].cells[0].value).toBe(10);
  });
});
