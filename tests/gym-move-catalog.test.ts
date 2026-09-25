import { describe, it, expect } from "vitest";
import { createBoard } from "../src/domain/board";
import { findMoves, type EnumerableLexicon } from "../src/domain/solver";
import { catalogueMoves, groupMoves } from "../src/domain/gym/move-catalog";
import type { Position } from "../src/domain/gym/model";
const words = ["AT", "TA", "CAT", "ACT"];
const lexicon: EnumerableLexicon = {
  id: "catalogue-test",
  edition: "1",
  status: "test",
  words,
  has: (word) => words.includes(word),
};
const position: Position = {
  board: createBoard(),
  rack: ["A", "T", "?"],
  scores: [0, 0],
  opponentCount: 7,
  bagCount: 90,
  passes: 0,
};
describe("complete move catalogue", () => {
  it("retains every physical placement including blanks and groups repeated words", () => {
    const result = catalogueMoves(position, lexicon);
    const expected = findMoves(position.board, position.rack, lexicon, {
      limit: 100000,
    });
    expect(result.complete).toBe(true);
    expect(result.moves.map((m) => m.key).sort()).toEqual(
      expected.moves.map((m) => m.key).sort(),
    );
    expect(result.moves.length).toBeGreaterThan(8);
    expect(
      result.moves.some((m) => m.placements.some((p) => p.tile.blank)),
    ).toBe(true);
    expect(result.moves.map((m) => m.score)).toEqual(
      result.moves.map((m) => m.score).sort((a, b) => b - a),
    );
    const grouped = groupMoves(result.moves);
    expect(grouped.reduce((n, g) => n + g.placements.length, 0)).toBe(
      result.moves.length,
    );
    expect(grouped.some((g) => g.placements.length > 1)).toBe(true);
  });
  it("does not call capped or interrupted results exhaustive", () => {
    expect(catalogueMoves(position, lexicon, 12000, 2000000, 1)).toMatchObject({
      complete: false,
    });
    expect(catalogueMoves(position, lexicon, 12000, 1).complete).toBe(false);
    expect(catalogueMoves(position, lexicon, 0).complete).toBe(false);
  });
});
