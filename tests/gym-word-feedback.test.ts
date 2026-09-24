import { describe, expect, it } from "vitest";
import { createBoard } from "../src/domain/board";
import {
  draftWordFeedback,
  wordCellFeedback,
} from "../src/domain/gym/word-feedback";
import type { Lexicon, Placement, Tile } from "../src/domain/types";
const lexicon: Lexicon = {
  id: "test",
  edition: "test",
  status: "test",
  has: (word) => ["ARE", "EM", "AT"].includes(word),
};
const tile = (letter: Tile["letter"], blank = false): Tile => ({
  letter,
  blank,
});
const placement = (
  row: number,
  col: number,
  letter: Tile["letter"],
  blank = false,
): Placement => ({ row, col, tile: tile(letter, blank) });
describe("Gym per-word feedback", () => {
  it("keeps ARE green while NEM is red, including existing letters", () => {
    const board = createBoard().map((row) => [...row]);
    board[5][7] = tile("A");
    board[6][7] = tile("R");
    board[5][8] = tile("N");
    board[6][8] = tile("E");
    const words = draftWordFeedback(
      board,
      [placement(7, 7, "E"), placement(7, 8, "M")],
      lexicon,
    );
    expect(words.map((w) => [w.word, w.valid])).toEqual([
      ["EM", true],
      ["ARE", true],
      ["NEM", false],
    ]);
    const cells = wordCellFeedback(words);
    expect(cells["5,7"].state).toBe("valid");
    expect(cells["7,7"].state).toBe("valid");
    expect(cells["5,8"].state).toBe("invalid");
    expect(cells["7,8"]).toEqual({
      state: "mixed",
      label: "EM: valid; NEM: invalid",
      validDirection: "across",
    });
    expect(board[7][7]).toBeNull();
  });
  it("checks separate contiguous fragments and blanks without claiming move legality", () => {
    const board = createBoard();
    const words = draftWordFeedback(
      board,
      [
        placement(0, 0, "A", true),
        placement(0, 1, "T"),
        placement(14, 14, "Q"),
      ],
      lexicon,
    );
    expect(words).toEqual([
      { word: "AT", valid: true, direction: "across", cells: ["0,0", "0,1"] },
    ]);
  });
  it("updates a word on extension/removal and leaves untouched words neutral", () => {
    const board = createBoard().map((row) => [...row]);
    board[0][0] = tile("A");
    board[0][1] = tile("T");
    expect(draftWordFeedback(board, [], lexicon)).toEqual([]);
    expect(
      draftWordFeedback(board, [placement(0, 2, "Q")], lexicon)[0].valid,
    ).toBe(false);
  });
  it("does not colour malformed placements or failed dictionary responses", () => {
    const board = createBoard();
    expect(draftWordFeedback(board, [placement(-1, 0, "A")], lexicon)).toEqual(
      [],
    );
    expect(
      draftWordFeedback(
        board,
        [placement(0, 0, "A"), placement(0, 0, "T")],
        lexicon,
      ),
    ).toEqual([]);
    expect(
      draftWordFeedback(board, [placement(0, 0, "A"), placement(0, 1, "T")], {
        ...lexicon,
        has: () => {
          throw Error("offline");
        },
      }),
    ).toEqual([]);
  });
});

it("tracks a valid down word for the direction-aware split", () => {
  const cells = wordCellFeedback([
    { word: "ND", valid: false, direction: "across", cells: ["7,6", "7,7"] },
    {
      word: "BIRD",
      valid: true,
      direction: "down",
      cells: ["4,7", "5,7", "6,7", "7,7"],
    },
  ]);
  expect(cells["7,7"]).toMatchObject({
    state: "mixed",
    validDirection: "down",
  });
});
