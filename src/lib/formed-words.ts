import { BOARD_SIZE, isBoard, isCoordinate, isTile } from "../domain/board";
import type { Board, Direction, Lexicon, Placement } from "../domain/types";

export type FormedWord = {
  word: string;
  row: number;
  col: number;
  endRow: number;
  endCol: number;
  direction: Direction;
  valid: boolean | "unavailable";
};

/**
 * Complete contiguous runs touched by the draft, for word feedback before recording.
 * Word-list membership does not certify turn geometry, inventory, or scoring.
 */
export function getFormedWords(
  board: Board,
  placements: readonly Placement[],
  lexicon: Lexicon,
): FormedWord[] {
  if (
    !isBoard(board) ||
    !Array.isArray(placements) ||
    placements.length === 0 ||
    placements.length > 7
  )
    return [];
  const squares = new Set<string>();
  for (const placement of placements) {
    if (
      !placement ||
      !isCoordinate(placement.row) ||
      !isCoordinate(placement.col) ||
      !isTile(placement.tile) ||
      board[placement.row][placement.col] !== null
    )
      return [];
    const key = `${placement.row},${placement.col}`;
    if (squares.has(key)) return [];
    squares.add(key);
  }
  const combined = board.map((row) => [...row]);
  for (const placement of placements)
    combined[placement.row][placement.col] = placement.tile;
  const seen = new Set<string>();
  const formed: FormedWord[] = [];
  for (const placement of placements) {
    for (const direction of ["across", "down"] as const) {
      const dr = Number(direction === "down");
      const dc = Number(direction === "across");
      let row = placement.row;
      let col = placement.col;
      while (
        row - dr >= 0 &&
        col - dc >= 0 &&
        combined[row - dr][col - dc] !== null
      ) {
        row -= dr;
        col -= dc;
      }
      const key = `${row},${col},${direction}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const startRow = row;
      const startCol = col;
      let word = "";
      while (
        row < BOARD_SIZE &&
        col < BOARD_SIZE &&
        combined[row][col] !== null
      ) {
        word += combined[row][col]!.letter;
        row += dr;
        col += dc;
      }
      if (word.length > 1)
        formed.push({
          word,
          row: startRow,
          col: startCol,
          endRow: row - dr,
          endCol: col - dc,
          direction,
          valid: "unavailable",
        });
    }
  }
  formed.sort(
    (a, b) =>
      a.row - b.row ||
      a.col - b.col ||
      (a.direction === b.direction ? 0 : a.direction === "across" ? -1 : 1),
  );
  if (
    !lexicon ||
    !["ready", "test"].includes(lexicon.status) ||
    typeof lexicon.has !== "function"
  )
    return formed;
  try {
    const verdicts = formed.map(({ word }) => lexicon.has(word));
    if (verdicts.some((verdict) => typeof verdict !== "boolean")) return formed;
    return formed.map((word, index) => ({ ...word, valid: verdicts[index] }));
  } catch {
    return formed;
  }
}
