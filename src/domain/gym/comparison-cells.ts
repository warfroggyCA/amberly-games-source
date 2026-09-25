import type { Board, Placement } from "../types";
/** Highlight the words touched by a preview, including existing crossing letters. */
export function comparisonCells(
  board: Board,
  placements: Placement[],
): Set<string> {
  const cells = new Set<string>();
  const occupied = (r: number, c: number) =>
    Boolean(
      board[r]?.[c] || placements.some((p) => p.row === r && p.col === c),
    );
  for (const tile of placements) {
    cells.add(`${tile.row},${tile.col}`);
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
    ]) {
      for (const sign of [-1, 1]) {
        let r = tile.row + sign * dr,
          c = tile.col + sign * dc;
        while (occupied(r, c)) {
          cells.add(`${r},${c}`);
          r += sign * dr;
          c += sign * dc;
        }
      }
    }
  }
  return cells;
}
