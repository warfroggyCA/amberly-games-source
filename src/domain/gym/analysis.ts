import { findMoves, type EnumerableLexicon, type ScoredMove } from "../solver";
import {
  actionKey,
  checkBudget,
  consumedTiles,
  removeTiles,
  unseenTiles,
  validateAction,
  type Action,
  type Budget,
  type Physical,
  type Position,
} from "./model";

export interface ScoreSummary {
  maximum: number;
  maximumCount: number;
  totalMoves: number;
  /** Sorted descending, one entry per distinct attainable whole-turn score. */
  histogram: { score: number; count: number }[];
  /** One representative for each of the top three distinct score tiers. */
  best: ScoredMove[];
  candidates: Action[];
  candidateCount: number;
  nodes: number;
}
/** Hand-written rack heuristic for shortlisting and labelled coaching, never winning odds or a grade. */
export function leaveValue(rack: readonly Physical[]): number {
  let total = 0;
  let vowels = 0;
  const seen = new Map<Physical, number>();
  for (const tile of rack) {
    total +=
      tile === "?"
        ? 18
        : tile === "S"
          ? 6
          : "AEINRT".includes(tile)
            ? 2
            : "QJV".includes(tile)
              ? -5
              : 0;
    if ("AEIOU".includes(tile)) vowels++;
    seen.set(tile, (seen.get(tile) ?? 0) + 1);
  }
  for (const [tile, count] of seen)
    if (tile !== "?") total -= Math.max(0, count - 1) * 2;
  return (
    total -
    Math.abs(
      vowels - (rack.length - rack.filter((t) => t === "?").length) / 2,
    ) *
      2
  );
}
export function exchanges(
  rack: readonly Physical[],
  bagCount: number,
): Action[] {
  const result = new Map<string, Action>();
  for (let mask = 1; mask < 2 ** rack.length; mask++) {
    const tiles = rack.filter((_, i) => mask & (1 << i));
    if (tiles.length > bagCount) continue;
    const action: Action = { type: "exchange", tiles };
    result.set(actionKey(action), action);
  }
  return [...result.values()];
}
export function analyseScore(
  position: Position,
  lexicon: EnumerableLexicon,
  budget: Budget,
): ScoreSummary {
  unseenTiles(position);
  checkBudget(budget);
  const histogram = new Map<number, number>();
  const medalMoves = new Map<number, ScoredMove>();
  const retained: { action: Action; value: number; key: string }[] = [];
  const result = findMoves(position.board, position.rack, lexicon, {
    limit: 8,
    maxNodes: budget.maxNodes,
    signal: budget.signal,
    onMove(move) {
      histogram.set(move.score, (histogram.get(move.score) ?? 0) + 1);
      const representative = medalMoves.get(move.score);
      if (!representative || move.key < representative.key)
        medalMoves.set(move.score, move);
      if (medalMoves.size > 3)
        medalMoves.delete(Math.min(...medalMoves.keys()));
      const action: Action = { type: "play", placements: move.placements };
      const value =
        move.score +
        leaveValue(removeTiles(position.rack, consumedTiles(action)));
      retained.push({ action, value, key: actionKey(action) });
      retained.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
      if (retained.length > 12) retained.pop();
    },
  });
  checkBudget(budget);
  if (result.status !== "complete")
    throw new Error(
      `Exact score search ${result.status}; no maximum or rank is available.`,
    );
  const other = exchanges(position.rack, position.bagCount);
  // Consider every legal exchange subset before shortlisting, including duplicates/blanks.
  other.sort(
    (a, b) =>
      leaveValue(removeTiles(position.rack, consumedTiles(b))) -
        leaveValue(removeTiles(position.rack, consumedTiles(a))) ||
      actionKey(a).localeCompare(actionKey(b)),
  );
  const candidates = new Map<string, Action>();
  for (const action of [
    ...result.moves.map((m) => ({
      type: "play" as const,
      placements: m.placements,
    })),
    ...retained.map((r) => r.action),
    ...other.slice(0, 3),
    { type: "pass" as const },
  ])
    candidates.set(actionKey(action), action);
  const maximum = result.moves[0]?.score ?? 0;
  return {
    maximum,
    maximumCount: histogram.get(maximum) ?? 0,
    totalMoves: result.totalMoves,
    histogram: [...histogram]
      .map(([score, count]) => ({ score, count }))
      .sort((a, b) => b.score - a.score),
    best: [...medalMoves.values()].sort((a, b) => b.score - a.score),
    candidates: [...candidates.values()],
    candidateCount: result.totalMoves + other.length + 1,
    nodes: result.visitedNodes,
  };
}
export function gradeScore(
  position: Position,
  action: Action,
  lexicon: EnumerableLexicon,
  summary: ScoreSummary,
) {
  const points = validateAction(position, action, lexicon);
  if (action.type !== "play") return { points, rank: null, percentage: null };
  if (
    summary.maximum <= 0 ||
    !summary.histogram.some((b) => b.score === points)
  )
    throw new Error(
      "The completed answer set does not contain this valid score. Reanalyse the puzzle.",
    );
  return {
    points,
    rank:
      1 +
      summary.histogram.reduce(
        (n, b) => n + (b.score > points ? b.count : 0),
        0,
      ),
    percentage: (100 * points) / summary.maximum,
  };
}
