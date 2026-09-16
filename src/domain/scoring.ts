import {
  BOARD_SIZE,
  countUnplayed,
  LETTER_COUNTS,
  isTileSupply,
  type TileSupply,
  isBoard,
  isCoordinate,
  isTile,
  LETTER_VALUES,
  premiumAt,
} from "./board";
import type {
  Board,
  Lexicon,
  MoveResult,
  Placement,
  ScoredWord,
  Tile,
} from "./types";

function fail(code: string, message: string, words?: string[]): MoveResult {
  return { ok: false, error: { code, message, ...(words ? { words } : {}) } };
}
const key = (row: number, col: number) => `${row},${col}`;

/** Validates and scores a placement; never mutates the supplied board, tiles, or draft. */
export function scoreMove(
  board: Board,
  placements: readonly Placement[],
  lexicon: Lexicon,
  availableTiles = 7,
  tileSupply: TileSupply = LETTER_COUNTS,
): MoveResult {
  if (!isTileSupply(tileSupply))
    return fail(
      "INVALID_TILE_SUPPLY",
      "A valid complete physical tile supply is required.",
    );
  if (!isBoard(board))
    return fail(
      "INVALID_BOARD",
      "The board must contain 15 rows of 15 valid squares.",
    );
  try {
    countUnplayed(board, tileSupply);
  } catch {
    return fail(
      "INVALID_INVENTORY",
      "The board contains more physical tiles than the set allows.",
    );
  }
  if (
    !Number.isInteger(availableTiles) ||
    availableTiles < 0 ||
    availableTiles > 7
  ) {
    return fail(
      "INVALID_RACK_COUNT",
      "Available rack tiles must be an integer between 0 and 7.",
    );
  }
  if (!Array.isArray(placements) || placements.length === 0)
    return fail(
      "EMPTY_PLACEMENT",
      "Place at least one tile, or record a pass.",
    );
  if (placements.length > availableTiles)
    return fail(
      "TOO_MANY_TILES",
      `Only ${availableTiles} rack tiles are available.`,
    );
  const placed = new Set<string>();
  const draft: Placement[] = [];
  for (const p of placements) {
    if (
      typeof p !== "object" ||
      p === null ||
      !isCoordinate(p.row) ||
      !isCoordinate(p.col) ||
      !isTile(p.tile)
    ) {
      return fail(
        "INVALID_PLACEMENT",
        "Each new tile needs a valid letter, blank status, and board coordinate.",
      );
    }
    const square = key(p.row, p.col);
    if (placed.has(square))
      return fail(
        "DUPLICATE_SQUARE",
        "A square can contain only one new tile.",
      );
    if (board[p.row][p.col] !== null)
      return fail(
        "OCCUPIED_SQUARE",
        "Existing tiles cannot be replaced. Enter only new tiles.",
      );
    placed.add(square);
    draft.push({
      row: p.row,
      col: p.col,
      tile: { letter: p.tile.letter, blank: p.tile.blank },
    });
  }
  const across = draft.every((p) => p.row === draft[0].row);
  const down = draft.every((p) => p.col === draft[0].col);
  if (!across && !down)
    return fail("NOT_IN_LINE", "New tiles must lie in one row or one column.");
  draft.sort((a, b) => a.row - b.row || a.col - b.col);
  const next: (Tile | null)[][] = board.map((row) =>
    row.map((tile) => (tile === null ? null : { ...tile })),
  );
  for (const p of draft) next[p.row][p.col] = p.tile;
  const first = draft[0];
  const last = draft[draft.length - 1];
  for (
    let position = across ? first.col : first.row;
    position <= (across ? last.col : last.row);
    position++
  ) {
    if (
      next[across ? first.row : position][across ? position : first.col] ===
      null
    ) {
      return fail(
        "GAP",
        "The placement cannot have empty squares between its tiles.",
      );
    }
  }
  const opening = board.every((row) => row.every((tile) => tile === null));
  if (opening) {
    if (!placed.has(key(7, 7)))
      return fail(
        "CENTRE_REQUIRED",
        "The opening word must cover the centre star.",
      );
    if (draft.length < 2)
      return fail(
        "OPENING_TOO_SHORT",
        "The opening word needs at least two tiles.",
      );
  } else if (
    !draft.some(({ row, col }) =>
      [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ].some(
        ([r, c]) => isCoordinate(r) && isCoordinate(c) && board[r][c] !== null,
      ),
    )
  ) {
    return fail(
      "DISCONNECTED",
      "The placement must connect to the existing board.",
    );
  }
  try {
    countUnplayed(next, tileSupply);
  } catch {
    return fail(
      "INVALID_INVENTORY",
      "This placement uses more physical tiles than the set allows. Check blanks and letters.",
    );
  }
  const words = scoreFormedWords(next, draft);
  if (words.length === 0)
    return fail(
      "NO_WORD",
      "A placement must form a word of at least two letters.",
    );
  if (
    typeof lexicon !== "object" ||
    lexicon === null ||
    !["ready", "test"].includes(lexicon.status) ||
    typeof lexicon.has !== "function"
  ) {
    return fail(
      "DICTIONARY_UNAVAILABLE",
      "Word verification is unavailable. Your placement has not been recorded.",
    );
  }
  const invalid: string[] = [];
  try {
    for (const word of words) {
      const verdict = lexicon.has(word.word);
      if (typeof verdict !== "boolean")
        return fail(
          "DICTIONARY_UNAVAILABLE",
          "The word reference returned an unusable verdict.",
        );
      if (!verdict && !invalid.includes(word.word)) invalid.push(word.word);
    }
  } catch {
    return fail(
      "DICTIONARY_UNAVAILABLE",
      "Word verification failed. Keep the placement and try again.",
    );
  }
  if (invalid.length)
    return fail(
      "INVALID_WORD",
      `Not in the selected word reference: ${invalid.join(", ")}.`,
      invalid,
    );
  const bingo = draft.length === 7 ? 50 : 0;
  const immutableBoard: Board = Object.freeze(
    next.map((row) =>
      Object.freeze(
        row.map((tile) => (tile === null ? null : Object.freeze(tile))),
      ),
    ),
  );
  return {
    ok: true,
    board: immutableBoard,
    words,
    score: words.reduce((sum, word) => sum + word.score, 0) + bingo,
    bingo,
    newTileCount: draft.length,
    placements: draft,
  };
}

/** Arithmetic shared by draft feedback and validated turns. Singleton prefixes count once. */
function scoreFormedWords(
  next: Board,
  draft: readonly Placement[],
  includeSingleTiles = false,
): ScoredWord[] {
  const placed = new Set(draft.map((p) => key(p.row, p.col)));
  const words: ScoredWord[] = [];
  const seenWords = new Set<string>();
  for (const p of draft)
    for (const direction of ["across", "down"] as const) {
      const dr = direction === "down" ? 1 : 0;
      const dc = direction === "across" ? 1 : 0;
      let row = p.row;
      let col = p.col;
      while (
        row - dr >= 0 &&
        col - dc >= 0 &&
        next[row - dr][col - dc] !== null
      ) {
        row -= dr;
        col -= dc;
      }
      const wordKey = `${key(row, col)},${direction}`;
      if (seenWords.has(wordKey)) continue;
      seenWords.add(wordKey);
      const startRow = row;
      const startCol = col;
      let word = "";
      let sum = 0;
      let multiplier = 1;
      while (row < BOARD_SIZE && col < BOARD_SIZE && next[row][col] !== null) {
        const tile = next[row][col]!;
        word += tile.letter;
        let value = tile.blank ? 0 : LETTER_VALUES[tile.letter];
        if (placed.has(key(row, col))) {
          const premium = premiumAt(row, col);
          if (premium === "DL") value *= 2;
          if (premium === "TL") value *= 3;
          if (premium === "DW") multiplier *= 2;
          if (premium === "TW") multiplier *= 3;
        }
        sum += value;
        row += dr;
        col += dc;
      }
      if (
        word.length > 1 ||
        (includeSingleTiles &&
          direction === "across" &&
          word.length === 1 &&
          !next[startRow - 1]?.[startCol] &&
          !next[startRow + 1]?.[startCol])
      )
        words.push({
          word,
          score: sum * multiplier,
          row: startRow,
          col: startCol,
          direction,
        });
    }
  return words;
}

/** Display-only potential points; never a word verdict or authority to record a turn. */
export function calculateDraftScore(
  board: Board,
  placements: readonly Placement[],
): number | null {
  if (!isBoard(board) || !Array.isArray(placements) || placements.length > 7)
    return null;
  const seen = new Set<string>();
  const next = board.map((row) => [...row]);
  for (const placement of placements) {
    if (
      !placement ||
      !isCoordinate(placement.row) ||
      !isCoordinate(placement.col) ||
      !isTile(placement.tile) ||
      next[placement.row][placement.col] !== null
    )
      return null;
    const square = key(placement.row, placement.col);
    if (seen.has(square)) return null;
    seen.add(square);
    next[placement.row][placement.col] = placement.tile;
  }
  return (
    scoreFormedWords(next, placements, true).reduce(
      (sum, word) => sum + word.score,
      0,
    ) + (placements.length === 7 ? 50 : 0)
  );
}
