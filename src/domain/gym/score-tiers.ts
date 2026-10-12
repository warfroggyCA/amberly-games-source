import type { ScoredMove } from "../solver";

/** Shared by Gym and real-game review: ties must not crowd out distinct medals. */
export function scoreTiers() {
  const histogram = new Map<number, number>();
  const representatives = new Map<number, ScoredMove>();
  return {
    observe(move: ScoredMove) {
      histogram.set(move.score, (histogram.get(move.score) ?? 0) + 1);
      const old = representatives.get(move.score);
      if (!old || move.key < old.key) representatives.set(move.score, move);
      if (representatives.size > 3)
        representatives.delete(Math.min(...representatives.keys()));
    },
    summary() {
      return {
        histogram: [...histogram]
          .map(([score, count]) => ({ score, count }))
          .sort((a, b) => b.score - a.score),
        best: [...representatives.values()].sort((a, b) => b.score - a.score),
      };
    },
  };
}
