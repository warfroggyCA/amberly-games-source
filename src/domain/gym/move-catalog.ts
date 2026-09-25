import { findMoves, type EnumerableLexicon, type ScoredMove } from "../solver";
import type { Position } from "./model";
export interface MoveCatalog {
  moves: ScoredMove[];
  complete: boolean;
}
/** Preserve unique physical placements, not just the solver's top-N shortlist. */
export function catalogueMoves(
  position: Position,
  lexicon: EnumerableLexicon,
  milliseconds = 12000,
  maxNodes = 2000000,
  cap = 25000,
): MoveCatalog {
  const moves: ScoredMove[] = [];
  const deadline = performance.now() + milliseconds;
  let complete = false;
  const exhausted = new Error("catalogue-budget");
  try {
    const result = findMoves(position.board, position.rack, lexicon, {
      limit: 1,
      maxNodes,
      onMove(move) {
        if (moves.length >= cap || performance.now() >= deadline)
          throw exhausted;
        moves.push(move);
      },
    });
    if (result.status === "invalid" || result.status === "unavailable")
      throw new Error("Move search is unavailable for this position.");
    complete = result.status === "complete";
  } catch (error) {
    if (error !== exhausted) throw error;
  }
  moves.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return { moves, complete };
}
export function moveWord(move: ScoredMove): string {
  return (
    [...move.words].sort(
      (a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word),
    )[0]?.word ?? "Move"
  );
}
export function groupMoves(moves: ScoredMove[]) {
  const groups = new Map<string, ScoredMove[]>();
  for (const move of moves) {
    const word = moveWord(move);
    const group = groups.get(word) ?? [];
    group.push(move);
    groups.set(word, group);
  }
  return [...groups].map(([word, placements]) => ({ word, placements }));
}
