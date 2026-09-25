import { expect, it } from "vitest";
import { createBoard } from "../src/domain/board";
import { comparisonCells } from "../src/domain/gym/comparison-cells";
it("colours both completed words including fixed tiles without reaching unrelated words", () => {
  const board = createBoard().map((row) => [...row]);
  board[7][6] = { letter: "A", blank: false };
  board[6][7] = { letter: "I", blank: false };
  board[7][9] = { letter: "A", blank: false };
  const before = JSON.stringify(board);
  expect(
    [
      ...comparisonCells(board, [
        { row: 7, col: 7, tile: { letter: "T", blank: false } },
      ]),
    ].sort(),
  ).toEqual(["6,7", "7,6", "7,7"]);
  expect(JSON.stringify(board)).toBe(before);
  expect(comparisonCells(board, []).size).toBe(0);
});
