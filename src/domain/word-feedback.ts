import { isBoard, isCoordinate, isTile } from "./board";
import type { Board, Lexicon, Placement } from "./types";

export interface WordFeedback {
  word: string;
  valid: boolean;
  cells: string[];
  direction: "across" | "down";
}

/** Dictionary feedback for each contiguous word touched by the draft.
 * Independent of whole-move legality: a valid crossing stays valid while editing.
 * Isolated letters and untouched setup words remain neutral.
 */
export function draftWordFeedback(
  board: Board,
  placements: readonly Placement[],
  lexicon: Lexicon,
): WordFeedback[] {
  if (!isBoard(board) || !["ready", "test"].includes(lexicon.status)) return [];
  const next = board.map((row) => [...row]);
  for (const p of placements) {
    if (
      !p ||
      !isCoordinate(p.row) ||
      !isCoordinate(p.col) ||
      !isTile(p.tile) ||
      next[p.row][p.col]
    )
      return [];
    next[p.row][p.col] = p.tile;
  }
  const seen = new Set<string>();
  const words: WordFeedback[] = [];
  try {
    for (const p of placements)
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ]) {
        let r = p.row,
          c = p.col;
        while (next[r - dr]?.[c - dc]) {
          r -= dr;
          c -= dc;
        }
        const key = `${r},${c},${dr}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let word = "";
        const cells: string[] = [];
        while (next[r]?.[c]) {
          word += next[r][c]!.letter;
          cells.push(`${r},${c}`);
          r += dr;
          c += dc;
        }
        if (word.length < 2) continue;
        const valid = lexicon.has(word);
        if (typeof valid !== "boolean") return [];
        words.push({ word, valid, cells, direction: dr ? "down" : "across" });
      }
  } catch {
    return [];
  }
  return words;
}

export function wordCellFeedback(words: readonly WordFeedback[]) {
  const cells: Record<
    string,
    {
      state: "valid" | "invalid" | "mixed";
      label: string;
      validDirection?: "across" | "down";
      edges: Partial<Record<"top" | "right" | "bottom" | "left", boolean>>;
    }
  > = {};
  for (const word of words)
    for (const [index, cell] of word.cells.entries()) {
      const state = word.valid ? "valid" : "invalid";
      const previous = cells[cell];
      cells[cell] = {
        state: previous && previous.state !== state ? "mixed" : state,
        validDirection: word.valid ? word.direction : previous?.validDirection,
        edges: {
          ...previous?.edges,
          ...(index > 0
            ? { [word.direction === "across" ? "left" : "top"]: word.valid }
            : {}),
          ...(index < word.cells.length - 1
            ? { [word.direction === "across" ? "right" : "bottom"]: word.valid }
            : {}),
        },
        label: `${previous ? previous.label + "; " : ""}${word.word}: ${state} ${word.direction}`,
      };
    }
  return cells;
}
