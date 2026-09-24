import type { ScoreSummary } from "./analysis";
/** Medals use distinct score tiers, independently of competition placement rank. */
export function scoreMedal(
  points: number,
  summary: Pick<ScoreSummary, "histogram">,
) {
  const scores = [...new Set(summary.histogram.map((b) => b.score))].sort(
    (a, b) => b - a,
  );
  const tier = scores.indexOf(points);
  return tier >= 0 && tier < 3
    ? (["gold", "silver", "bronze"] as const)[tier]
    : null;
}
/** Exact competition rank among placements; bars represent points/max, not percentile. */
export function scoreStrength(
  points: number,
  summary: Pick<ScoreSummary, "maximum" | "histogram" | "totalMoves">,
) {
  const bucket = summary.histogram.find((b) => b.score === points);
  if (!bucket || summary.maximum <= 0 || !Number.isFinite(points)) return null;
  const percentage = (100 * points) / summary.maximum;
  const best = points === summary.maximum;
  return {
    rank:
      1 +
      summary.histogram.reduce(
        (n, b) => n + (b.score > points ? b.count : 0),
        0,
      ),
    tied: bucket.count > 1,
    total: summary.totalMoves,
    percentage,
    best,
    medal: scoreMedal(points, summary),
    bars: best ? 5 : Math.min(4, Math.max(0, Math.ceil(percentage / 25))),
  };
}
