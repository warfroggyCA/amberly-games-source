import { isBoard, isCoordinate, isTile } from "../domain/board";
import type { Board, Letter, Placement } from "../domain/types";
import type { Draft } from "./preview-store";

type CursorDraft = Draft & { atEdge?: boolean };
export type InsertResult =
  { ok: true; draft: Draft } | { ok: false; message: string };
const reject = (message: string): InsertResult => ({ ok: false, message });
const clonePlacements = (placements: readonly Placement[]): Placement[] =>
  placements.map((placement) => ({
    ...placement,
    tile: { ...placement.tile },
  }));
function validDraft(draft: CursorDraft): boolean {
  if (
    !draft ||
    !Number.isSafeInteger(draft.revision) ||
    draft.revision < 0 ||
    !isCoordinate(draft.row) ||
    !isCoordinate(draft.col) ||
    !["across", "down"].includes(draft.direction) ||
    !Array.isArray(draft.placements) ||
    draft.placements.length > 7 ||
    (draft.atEdge !== undefined && typeof draft.atEdge !== "boolean")
  )
    return false;
  const occupied = new Set<string>();
  for (const placement of draft.placements) {
    if (
      !placement ||
      !isCoordinate(placement.row) ||
      !isCoordinate(placement.col) ||
      !isTile(placement.tile)
    )
      return false;
    const key = `${placement.row},${placement.col}`;
    if (occupied.has(key)) return false;
    occupied.add(key);
  }
  return true;
}
export const FINISH_WORD_MESSAGE =
  "Finish or clear the current word before starting somewhere else.";

/** Allow editing the same line, including gaps left by deletion and committed bridges. */
export function canSelectDraftSquare(
  draft: Draft,
  board: Board,
  row: number,
  col: number,
): boolean {
  if (
    !validDraft(draft) ||
    !isBoard(board) ||
    !isCoordinate(row) ||
    !isCoordinate(col)
  )
    return false;
  const placements = draft.placements;
  if (!placements.length) return true;
  // Old disconnected drafts remain editable so their letters can be removed safely.
  if (placements.some((p) => p.row === row && p.col === col)) return true;
  const alongRow = placements.every((p) => p.row === row);
  const alongCol = placements.every((p) => p.col === col);
  if (!alongRow && !alongCol) return false;
  const positions = placements.map((p) => (alongRow ? p.col : p.row));
  const target = alongRow ? col : row;
  const start = Math.min(...positions);
  const end = Math.max(...positions);
  if (target >= start && target <= end) return true;
  const edge = target < start ? start : end;
  for (
    let at = Math.min(target, edge) + 1;
    at < Math.max(target, edge);
    at += 1
  ) {
    if (board[alongRow ? row : at][alongRow ? at : col] === null) return false;
  }
  return true;
}

/** A complete insertion succeeds or the entire draft is preserved, including paste and physical blank identity. */
export function insertLetters(
  draft: Draft,
  board: Board,
  text: string,
  blank: boolean,
  maxTiles: number,
): InsertResult {
  const cursor = draft as CursorDraft;
  if (!validDraft(cursor) || !isBoard(board))
    return reject("The board selection is invalid. Select a square again.");
  if (
    typeof text !== "string" ||
    !text.length ||
    text.length > 15 ||
    /[^A-Za-z]/.test(text)
  ) {
    return reject(
      "Enter letters A–Z only. Use the Blank button or Space for a blank tile.",
    );
  }
  if (typeof blank !== "boolean" || (blank && text.length !== 1))
    return reject("Choose one letter for the blank tile.");
  if (!Number.isInteger(maxTiles) || maxTiles < 0 || maxTiles > 7)
    return reject("The available rack count must be between zero and seven.");
  if (cursor.atEdge)
    return reject(
      "The cursor has reached the board edge. Select another square or use Backspace.",
    );
  if (
    cursor.placements.some(
      (placement) => board[placement.row][placement.col] !== null,
    )
  ) {
    return reject(
      "A draft tile overlaps the committed board. Reconcile the draft before entering more letters.",
    );
  }
  const letters = text.toUpperCase();
  const placements = clonePlacements(cursor.placements);
  let row = cursor.row;
  let col = cursor.col;
  let atEdge = false;
  for (let index = 0; index < letters.length; index += 1) {
    if (!canSelectDraftSquare({ ...cursor, placements }, board, row, col))
      return reject(FINISH_WORD_MESSAGE);
    const letter = letters[index] as Letter;
    const committed = board[row][col];
    if (committed !== null) {
      if (blank)
        return reject(
          "A blank cannot replace a committed tile. Select an empty square.",
        );
      if (committed.letter !== letter)
        return reject(
          `This square already contains ${committed.letter}. Existing tiles cannot be changed.`,
        );
    } else {
      const placementIndex = placements.findIndex(
        (placement) => placement.row === row && placement.col === col,
      );
      const placement: Placement = { row, col, tile: { letter, blank } };
      if (placementIndex < 0) placements.push(placement);
      else placements[placementIndex] = placement;
    }
    if (placements.length > maxTiles)
      return reject(
        `This turn can place at most ${maxTiles} new tile${maxTiles === 1 ? "" : "s"}.`,
      );
    const nextRow = row + Number(cursor.direction === "down");
    const nextCol = col + Number(cursor.direction === "across");
    if (!isCoordinate(nextRow) || !isCoordinate(nextCol)) {
      if (index !== letters.length - 1)
        return reject(
          "Those letters extend past the board edge. The draft has not changed.",
        );
      atEdge = true;
    } else {
      row = nextRow;
      col = nextCol;
    }
  }
  const next: CursorDraft = { ...cursor, placements, row, col, atEdge };
  return { ok: true, draft: next };
}
/** Backspace erases a selected draft tile first, otherwise steps back; committed tiles are never removed. */
export function erasePrevious(draft: Draft): Draft {
  const cursor = draft as CursorDraft;
  if (!validDraft(cursor)) return draft;
  let row = cursor.row;
  let col = cursor.col;
  const selectedTile = cursor.placements.some(
    (placement) => placement.row === row && placement.col === col,
  );
  if (!cursor.atEdge && !selectedTile) {
    const previousRow = row - Number(cursor.direction === "down");
    const previousCol = col - Number(cursor.direction === "across");
    if (!isCoordinate(previousRow) || !isCoordinate(previousCol)) {
      const unchanged: CursorDraft = {
        ...cursor,
        placements: clonePlacements(cursor.placements),
        atEdge: false,
      };
      return unchanged;
    }
    row = previousRow;
    col = previousCol;
  }
  const next: CursorDraft = {
    ...cursor,
    row,
    col,
    atEdge: false,
    placements: clonePlacements(
      cursor.placements.filter(
        (placement) => placement.row !== row || placement.col !== col,
      ),
    ),
  };
  return next;
}

/** Delete removes only the selected uncommitted letter, without moving the caret. */
export function eraseSelected(draft: Draft): Draft {
  if (!validDraft(draft)) return draft;
  return {
    ...draft,
    atEdge: false,
    placements: clonePlacements(
      draft.placements.filter(
        (placement) =>
          placement.row !== draft.row || placement.col !== draft.col,
      ),
    ),
  };
}

/** Infer an axis from an existing draft or unambiguous neighbours; ambiguity preserves the chosen axis. */
export function inferDirection(
  board: Board,
  row: number,
  col: number,
  fallback: Draft["direction"],
  placements: readonly Placement[] = [],
): Draft["direction"] {
  if (
    !isBoard(board) ||
    !isCoordinate(row) ||
    !isCoordinate(col) ||
    !Array.isArray(placements) ||
    Array.from(placements).some(
      (placement) =>
        !placement ||
        !isCoordinate(placement.row) ||
        !isCoordinate(placement.col) ||
        !isTile(placement.tile),
    )
  )
    return fallback;
  if (placements.length > 0) {
    const sameRow = placements.every((placement) => placement.row === row);
    const sameCol = placements.every((placement) => placement.col === col);
    if (sameRow && !sameCol) return "across";
    if (sameCol && !sameRow) return "down";
    if (placements.length > 1) {
      if (placements.every((placement) => placement.row === placements[0].row))
        return "across";
      if (placements.every((placement) => placement.col === placements[0].col))
        return "down";
    }
  }
  const occupied = (r: number, c: number) =>
    isCoordinate(r) &&
    isCoordinate(c) &&
    (board[r][c] !== null ||
      placements.some(
        (placement) => placement.row === r && placement.col === c,
      ));
  const horizontal = occupied(row, col - 1) || occupied(row, col + 1);
  const vertical = occupied(row - 1, col) || occupied(row + 1, col);
  if (horizontal !== vertical) return horizontal ? "across" : "down";
  return fallback;
}
