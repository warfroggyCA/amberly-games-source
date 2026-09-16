import {
  countUnplayed,
  isCoordinate,
  isTile,
  type TileSupply,
} from "../domain/board";
import type { Board, Placement } from "../domain/types";

/** Physical tiles not yet on the board include both the bag and players' racks. */
export function draftInventory(
  board: Board,
  placements: readonly Placement[],
  supply?: TileSupply,
) {
  const remaining = countUnplayed(board, supply);
  const exhausted: Placement[] = [];
  const seen = new Set<string>();
  for (const placement of placements) {
    if (
      !placement ||
      !isCoordinate(placement.row) ||
      !isCoordinate(placement.col) ||
      !isTile(placement.tile)
    )
      throw new RangeError("Invalid draft tile.");
    const cell = `${placement.row}:${placement.col}`;
    if (seen.has(cell) || board[placement.row][placement.col])
      throw new RangeError("Draft tiles must occupy separate empty squares.");
    seen.add(cell);
    const letter = placement.tile.blank ? "?" : placement.tile.letter;
    if (--remaining[letter] < 0) exhausted.push(placement);
  }
  return { remaining, exhausted };
}
