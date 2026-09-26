import { inferDirection } from "../../lib/board-entry";
import { isCoordinate, isLetter } from "../board";
import type { Board, Direction, Letter, Placement } from "../types";
import type { Physical } from "./model";
export interface Square {
  row: number;
  col: number;
}
export interface DraftTile extends Placement {
  id: number;
}
export interface Draft {
  tiles: DraftTile[];
  order: number[];
  start: Square | null;
  cursor: Square | null;
  direction: Direction;
  manualDirection?: boolean;
}
export const emptyDraft = (rack: readonly Physical[]): Draft => ({
  tiles: [],
  order: rack.map((_, id) => id),
  start: null,
  cursor: null,
  direction: "across",
});
const same = (a: Square | null, b: Square) =>
  a?.row === b.row && a.col === b.col;
const validSquare = (p: Square) => isCoordinate(p.row) && isCoordinate(p.col);
export function selectSquare(
  draft: Draft,
  board: Board,
  square: Square,
): Draft {
  if (
    !validSquare(square) ||
    board[square.row][square.col] ||
    draft.tiles.some((p) => same(p, square))
  )
    throw new Error("Select an empty square for the next letter.");
  if (same(draft.cursor, square))
    return {
      ...draft,
      direction: draft.direction === "across" ? "down" : "across",
      manualDirection: true,
    };
  return {
    ...draft,
    start: square,
    cursor: square,
    direction: autoDirection(
      { ...draft, manualDirection: false },
      board,
      square,
    ),
    manualDirection: false,
  };
}
export function nextSquare(
  square: Square,
  direction: Direction,
  board: Board,
  tiles: readonly DraftTile[],
): Square | null {
  const p = { ...square };
  for (let i = 0; i < 15; i++) {
    if (direction === "across") p.col++;
    else p.row++;
    if (!validSquare(p)) return null;
    if (!board[p.row][p.col] && !tiles.some((t) => same(t, p))) return p;
  }
  return null;
}
export function autoDirection(
  draft: Draft,
  board: Board,
  square: Square,
): Direction {
  if (draft.manualDirection) return draft.direction;
  // Once several tiles form a line, never bend that word around a board edge.
  const direction = inferDirection(
    board,
    square.row,
    square.col,
    draft.direction,
    draft.tiles,
  );
  if (draft.tiles.length > 0) return direction;
  const other = direction === "across" ? "down" : "across";
  return !nextSquare(square, direction, board, []) &&
    nextSquare(square, other, board, [])
    ? other
    : direction;
}

/** Fisher-Yates on physical tile IDs; repeated letters and placed slots keep their identity. */
export function shuffledOrder(
  order: readonly number[],
  random: () => number = Math.random,
): number[] {
  const result = [...order];
  for (let i = result.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid random value.");
    const j = Math.floor(value * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function placeTile(
  draft: Draft,
  board: Board,
  rack: readonly Physical[],
  id: number,
  assigned?: Letter,
  target = draft.cursor,
): Draft {
  if (!Number.isInteger(id) || id < 0 || id >= rack.length)
    throw new Error("Choose a tile from your rack.");
  if (!target)
    throw new Error(
      "Tap an empty board square to choose where the next tile goes.",
    );
  if (
    !validSquare(target) ||
    board[target.row][target.col] ||
    draft.tiles.some((t) => t.id !== id && same(t, target))
  )
    throw new Error("That square is occupied. Your tile has been kept.");
  const previous = draft.tiles.find((t) => t.id === id);
  if (previous && target === draft.cursor)
    throw new Error("That rack tile is already on the board.");
  const letter =
    rack[id] === "?" ? (assigned ?? previous?.tile.letter) : rack[id];
  if (!isLetter(letter))
    throw new Error("Choose the letter represented by your blank.");
  const tile: DraftTile = {
    ...target,
    id,
    tile: { letter, blank: rack[id] === "?" },
  };
  const tiles = previous
    ? draft.tiles.map((t) => (t.id === id ? tile : t))
    : [...draft.tiles, tile];
  const direction = autoDirection(
    {
      ...draft,
      tiles: draft.tiles.filter((t) => t.id !== id),
      manualDirection: target === draft.cursor && draft.manualDirection,
    },
    board,
    target,
  );
  return {
    ...draft,
    tiles,
    manualDirection: target === draft.cursor && draft.manualDirection,
    direction,
    cursor: nextSquare(target, direction, board, tiles),
  };
}
export function returnTile(draft: Draft, id: number): Draft {
  const tile = draft.tiles.find((t) => t.id === id);
  if (!tile) return draft;
  return {
    ...draft,
    tiles: draft.tiles.filter((t) => t.id !== id),
    cursor: { row: tile.row, col: tile.col },
  };
}
export function undoTile(draft: Draft): Draft {
  const last = draft.tiles.at(-1);
  return last ? returnTile(draft, last.id) : draft;
}
export function clearTiles(draft: Draft): Draft {
  return {
    ...draft,
    tiles: [],
    start: null,
    cursor: null,
    direction: "across",
    manualDirection: false,
  };
}
export function draftPlacements(draft: Draft): Placement[] {
  return draft.tiles.map(({ row, col, tile }) => ({ row, col, tile }));
}
