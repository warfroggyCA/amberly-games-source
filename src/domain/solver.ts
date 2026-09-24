import {
  BOARD_SIZE,
  countUnplayed,
  isBoard,
  isLetter,
  type TileSupply,
} from "./board";
import { scoreMove } from "./scoring";
import type { Board, Letter, Lexicon, Placement, ScoredWord } from "./types";

export interface ScoredMove {
  placements: Placement[];
  score: number;
  bingo: number;
  newTileCount: number;
  words: ScoredWord[];
  /** Canonical physical placement, including which letters are blanks. */
  key: string;
}
export interface SearchOptions {
  tileSupply?: TileSupply;
  /** Return the highest-scoring N moves; the entire search still runs. */
  limit?: number;
  /** Maximum trie-search states; an exhausted budget never certifies a pass. */
  maxNodes?: number;
  signal?: AbortSignal;
  /** Trusted in-process observer, once per unique legal move. Partial until complete. */
  onMove?: (move: ScoredMove) => void;
}
interface SearchProgress {
  moves: ScoredMove[];
  visitedNodes: number;
  totalMoves: number;
}
export type MoveSearchResult =
  | ({ status: "complete" } & SearchProgress)
  | ({
      status: "incomplete";
      reason: "node-budget" | "cancelled";
    } & SearchProgress)
  | {
      status: "unavailable";
      reason: string;
      moves: [];
      visitedNodes: 0;
      totalMoves: 0;
    }
  | {
      status: "invalid";
      error: string;
      moves: [];
      visitedNodes: 0;
      totalMoves: 0;
    };
export type EnumerableLexicon = Lexicon & { readonly words: readonly string[] };
export type MoveExistenceResult =
  | { status: "found"; move: ScoredMove; visitedNodes: number }
  | { status: "none"; visitedNodes: number }
  | Exclude<MoveSearchResult, { status: "complete" }>;

interface TrieNode {
  terminal: boolean;
  children: Map<Letter, TrieNode>;
}
const node = (): TrieNode => ({ terminal: false, children: new Map() });
// Only frozen registry assets are reusable. Mutable caller-supplied references are checked anew.
const preparedLexicons = new WeakMap<
  EnumerableLexicon,
  { root: TrieNode; words: Set<string> }
>();
const inside = (row: number, col: number) =>
  row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
const compareKey = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;
const compareMoves = (left: ScoredMove, right: ScoredMove) =>
  right.score - left.score ||
  right.newTileCount - left.newTileCount ||
  compareKey(left.key, right.key);
const squareKey = (row: number, col: number) =>
  `${String(row).padStart(2, "0")}:${String(col).padStart(2, "0")}`;

function placementKey(placements: readonly Placement[]): string {
  const ordered = [...placements].sort(
    (a, b) => a.row - b.row || a.col - b.col,
  );
  // A one-tile play has one identity even when it makes words in both directions.
  const direction = ordered.every((p) => p.row === ordered[0].row) ? "A" : "D";
  return `${squareKey(ordered[0].row, ordered[0].col)}:${direction}|${ordered
    .map(
      (p) =>
        `${squareKey(p.row, p.col)}:${p.tile.letter}:${p.tile.blank ? "1" : "0"}`,
    )
    .join("|")}`;
}
const invalid = (error: string): MoveSearchResult => ({
  status: "invalid",
  error,
  moves: [],
  visitedNodes: 0,
  totalMoves: 0,
});
const unavailable = (reason: string): MoveSearchResult => ({
  status: "unavailable",
  reason,
  moves: [],
  visitedNodes: 0,
  totalMoves: 0,
});

/**
 * Exhaustive, immediate-score search over the supplied enumerable lexicon.
 * `words` must be the complete word set for that lexicon, not a suggestions list.
 * `complete` is relative to that supplied set; a test list is never official NWL.
 * No strategy/equity assumptions and no tile draws are used.
 */
export function findMoves(
  board: Board,
  rack: readonly string[],
  lexicon: EnumerableLexicon,
  options: SearchOptions = {},
): MoveSearchResult {
  const result = search(board, rack, lexicon, options, false);
  if (result.status === "found" || result.status === "none")
    throw new Error("Unexpected search completion state.");
  return result;
}

/** A legal witness proves existence immediately; only a complete empty search proves absence. */
export function verifyMoveExists(
  board: Board,
  rack: readonly string[],
  lexicon: EnumerableLexicon,
  options: SearchOptions = {},
): MoveExistenceResult {
  const result = search(board, rack, lexicon, options, true);
  return result.status === "complete"
    ? { status: "none", visitedNodes: result.visitedNodes }
    : result;
}

function search(
  board: Board,
  rack: readonly string[],
  lexicon: EnumerableLexicon,
  options: SearchOptions,
  existenceOnly: boolean,
): MoveSearchResult | MoveExistenceResult {
  if (typeof options !== "object" || options === null)
    return invalid("Search options must be an object.");
  if (options.onMove !== undefined && typeof options.onMove !== "function")
    return invalid("The move observer must be a function.");
  if (!isBoard(board))
    return invalid("Expected a 15 by 15 board of valid tiles or null.");
  let unplayed: Record<string, number>;
  try {
    unplayed = countUnplayed(board, options.tileSupply);
  } catch {
    return invalid("The board exceeds the physical tile distribution.");
  }
  if (
    !Array.isArray(rack) ||
    rack.length > 7 ||
    Array.from(rack).some((tile) => tile !== "?" && !isLetter(tile))
  ) {
    return invalid(
      "A rack must contain up to seven uppercase letters or ? for a physical blank.",
    );
  }
  const counts = new Map<string, number>();
  for (const tile of rack) {
    counts.set(tile, (counts.get(tile) ?? 0) + 1);
    if ((counts.get(tile) ?? 0) > unplayed[tile])
      return invalid(
        "The board and rack exceed the physical tile distribution.",
      );
  }
  if (typeof options !== "object" || options === null)
    return invalid("Search options must be an object.");
  const limit = options.limit ?? 5;
  const maxNodes = options.maxNodes ?? 250_000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000)
    return invalid("The result limit must be an integer from 1 to 100000.");
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 0)
    return invalid("The node budget must be a nonnegative safe integer.");
  if (
    options.signal !== undefined &&
    (typeof options.signal !== "object" ||
      options.signal === null ||
      typeof options.signal.aborted !== "boolean")
  ) {
    return invalid("The cancellation signal is invalid.");
  }
  if (
    !lexicon ||
    !["ready", "test"].includes(lexicon.status) ||
    typeof lexicon.has !== "function" ||
    !Array.isArray(lexicon.words)
  ) {
    return unavailable("A complete enumerable word reference is required.");
  }
  if (options.signal?.aborted)
    return {
      status: "incomplete",
      reason: "cancelled",
      moves: [],
      totalMoves: 0,
      visitedNodes: 0,
    };
  // Bound configuration ingestion as well as the search; the production asset is validated at import.
  if (lexicon.words.length === 0)
    return unavailable("The word reference has no words.");
  if (lexicon.words.length > 500_000)
    return invalid("The word reference exceeds the supported asset size.");
  if (maxNodes === 0 && rack.length > 0)
    return {
      status: "incomplete",
      reason: "node-budget",
      moves: [],
      totalMoves: 0,
      visitedNodes: 0,
    };
  const cacheable = Object.isFrozen(lexicon) && Object.isFrozen(lexicon.words);
  let prepared = cacheable ? preparedLexicons.get(lexicon) : undefined;
  if (!prepared) {
    const root = node();
    const words = new Set<string>();
    try {
      for (const word of lexicon.words) {
        if (options.signal?.aborted)
          return {
            status: "incomplete",
            reason: "cancelled",
            moves: [],
            totalMoves: 0,
            visitedNodes: 0,
          };
        if (
          typeof word !== "string" ||
          word.length < 2 ||
          word.length > 15 ||
          /[^A-Z]/.test(word)
        )
          return invalid(
            "Word assets must contain uppercase words of 2 to 15 letters.",
          );
        if (words.has(word)) continue;
        if (lexicon.has(word) !== true)
          return unavailable(
            "The word reference and its enumerable asset disagree.",
          );
        words.add(word);
        let current = root;
        for (const character of word) {
          const letter = character as Letter;
          let child = current.children.get(letter);
          if (!child) {
            child = node();
            current.children.set(letter, child);
          }
          current = child;
        }
        current.terminal = true;
      }
    } catch {
      return unavailable("The word reference could not be read.");
    }

    prepared = { root, words };
    if (cacheable) preparedLexicons.set(lexicon, prepared);
  }
  const { root, words } = prepared;

  const opening = board.every((row) => row.every((tile) => tile === null));
  // Admissible lower bounds: how many further new tiles are needed to reach the
  // opening centre, an existing main-word tile, or an adjacent-board anchor.
  // This avoids spending the node budget on starts that cannot ever connect.
  const anchors = board.map((line, row) =>
    line.map((_, col) =>
      opening
        ? row === 7 && col === 7
        : [
            [row - 1, col],
            [row + 1, col],
            [row, col - 1],
            [row, col + 1],
          ].some(([r, c]) => inside(r, c) && board[r][c] !== null),
    ),
  );
  const connectionCosts = [
    [0, 1],
    [1, 0],
  ].map(([dr, dc]) => {
    const costs = Array.from({ length: BOARD_SIZE }, () =>
      Array<number>(BOARD_SIZE).fill(Infinity),
    );
    for (let row = BOARD_SIZE - 1; row >= 0; row--)
      for (let col = BOARD_SIZE - 1; col >= 0; col--) {
        costs[row][col] =
          board[row][col] !== null
            ? 0
            : anchors[row][col]
              ? 1
              : inside(row + dr, col + dc)
                ? 1 + costs[row + dr][col + dc]
                : Infinity;
      }
    return costs;
  });
  const seen = new Set<string>();
  const best: ScoredMove[] = [];
  let visitedNodes = 0;
  let stopped: "node-budget" | "cancelled" | undefined;
  let referenceFailure = false;
  let witness: ScoredMove | null = null;
  const placements: Placement[] = [];
  const crossCache = new Map<string, boolean>();

  function mayVisit(): boolean {
    if (options.signal?.aborted) {
      stopped = "cancelled";
      return false;
    }
    if (visitedNodes >= maxNodes) {
      stopped = "node-budget";
      return false;
    }
    visitedNodes++;
    return true;
  }
  function crossAllowed(
    row: number,
    col: number,
    letter: Letter,
    dr: number,
    dc: number,
  ): boolean {
    const cacheKey = `${row},${col},${dr},${letter}`;
    const cached = crossCache.get(cacheKey);
    if (cached !== undefined) return cached;
    // Perpendicular to the current traversal. Other new tiles lie on its line,
    // so the perpendicular prefix/suffix comes entirely from the original board.
    let prefix = "";
    let suffix = "";
    for (
      let r = row - dc, c = col - dr;
      inside(r, c) && board[r][c];
      r -= dc, c -= dr
    )
      prefix = board[r][c]!.letter + prefix;
    for (
      let r = row + dc, c = col + dr;
      inside(r, c) && board[r][c];
      r += dc, c += dr
    )
      suffix += board[r][c]!.letter;
    const allowed =
      prefix.length + suffix.length === 0 ||
      words.has(prefix + letter + suffix);
    crossCache.set(cacheKey, allowed);
    return allowed;
  }
  function collect(): void {
    const key = placementKey(placements);
    if (seen.has(key)) return;
    const result = scoreMove(
      board,
      placements,
      lexicon,
      rack.length,
      options.tileSupply,
    );
    if (!result.ok) {
      if (
        result.error.code === "DICTIONARY_UNAVAILABLE" ||
        result.error.code === "INVALID_WORD"
      )
        referenceFailure = true;
      return;
    }
    seen.add(key);
    const candidate: ScoredMove = {
      placements: result.placements,
      score: result.score,
      bingo: result.bingo,
      newTileCount: result.newTileCount,
      words: result.words,
      key,
    };
    if (existenceOnly) {
      witness = candidate;
      return;
    }
    options.onMove?.(candidate);
    // Keep memory proportional to requested output, while counting every unique move.
    if (
      best.length < limit ||
      compareMoves(candidate, best[best.length - 1]) < 0
    ) {
      best.push(candidate);
      best.sort(compareMoves);
      if (best.length > limit) best.pop();
    }
  }
  function walk(
    row: number,
    col: number,
    current: TrieNode,
    dr: number,
    dc: number,
    connected: boolean,
    coversCentre: boolean,
  ): void {
    if (stopped || referenceFailure || witness) return;
    if (
      !(opening ? coversCentre : connected) &&
      (!inside(row, col) ||
        connectionCosts[dr][row][col] > rack.length - placements.length)
    )
      return;
    if (!mayVisit()) return;
    const tile = inside(row, col) ? board[row][col] : null;
    // A complete main word cannot end before an existing tile. A terminal may
    // also continue into longer words, so collecting never stops this traversal.
    if (
      current.terminal &&
      tile === null &&
      placements.length > 0 &&
      (opening ? coversCentre && placements.length >= 2 : connected)
    )
      collect();
    if (!inside(row, col) || referenceFailure || witness) return;
    if (tile) {
      const child = current.children.get(tile.letter);
      if (child)
        walk(
          row + dr,
          col + dc,
          child,
          dr,
          dc,
          true,
          coversCentre || (row === 7 && col === 7),
        );
      return;
    }
    if (placements.length === rack.length) return;
    const touches = !opening && anchors[row][col];
    for (const [letter, child] of current.children) {
      // An unavailable physical letter cannot extend this branch. Avoid cross
      // checks for it; blanks still permit every represented letter.
      if (!(counts.get(letter) ?? 0) && !(counts.get("?") ?? 0)) continue;
      if (!crossAllowed(row, col, letter, dr, dc)) continue;
      // Branch for both physical choices. Spending a blank in a different square
      // can change premiums even when the displayed word is identical.
      for (const physical of [letter, "?"]) {
        const available = counts.get(physical) ?? 0;
        if (available === 0) continue;
        counts.set(physical, available - 1);
        placements.push({
          row,
          col,
          tile: { letter, blank: physical === "?" },
        });
        walk(
          row + dr,
          col + dc,
          child,
          dr,
          dc,
          connected || touches,
          coversCentre || (row === 7 && col === 7),
        );
        placements.pop();
        counts.set(physical, available);
        if (stopped || referenceFailure || witness) return;
      }
    }
  }

  if (rack.length > 0 && words.size > 0) {
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
    ]) {
      for (
        let row = 0;
        row < BOARD_SIZE && !stopped && !referenceFailure && !witness;
        row++
      ) {
        for (
          let col = 0;
          col < BOARD_SIZE && !stopped && !referenceFailure && !witness;
          col++
        ) {
          // Every legal main word has exactly one start with an empty predecessor.
          if (inside(row - dr, col - dc) && board[row - dr][col - dc] !== null)
            continue;
          walk(row, col, root, dr, dc, false, false);
        }
      }
    }
  }
  if (referenceFailure)
    return unavailable(
      "The word reference failed or changed during the search.",
    );
  if (witness) return { status: "found", move: witness, visitedNodes };
  const progress = { moves: best, visitedNodes, totalMoves: seen.size };
  return stopped
    ? { status: "incomplete", reason: stopped, ...progress }
    : { status: "complete", ...progress };
}
