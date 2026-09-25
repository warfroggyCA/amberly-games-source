import type { StrategyCoaching } from "./coaching";

/** Describe the same three terms the evaluator uses, without inventing odds or a rank. */
export function coachingTakeaways(result: StrategyCoaching): string[] {
  if (result.verdict === "same")
    return [
      "Your move led the options tested. Other legal moves were not all compared strategically.",
      `The sampled opponent replies averaged ${result.requested.replyPoints.toFixed(1)} points. These are possible replies, not a prediction of the opponent’s rack.`,
    ];
  const points = result.recommended.points - result.requested.points;
  const replies = result.requested.replyPoints - result.recommended.replyPoints;
  const rack = result.recommended.rackBalance - result.requested.rackBalance;
  return [
    points === 0
      ? "Both moves earn the same points now."
      : `The alternative earns ${Math.abs(points)} ${points > 0 ? "more" : "fewer"} points now.`,
    Math.abs(replies) < 0.05
      ? "Average opponent reply scores are about the same."
      : `The alternative leaves sampled opponent replies ${Math.abs(replies).toFixed(1)} points ${replies > 0 ? "lower" : "higher"} on average.`,
    Math.abs(rack) < 0.05
      ? "Estimated rack balance after both players draw is about the same."
      : `The rough rack-balance estimate after both players draw favours ${rack > 0 ? "the alternative" : "your move"} by ${Math.abs(rack).toFixed(1)}. This is a heuristic, not scored points.`,
    result.verdict === "uncertain"
      ? "The fresh samples disagree or tie, so there is no clear winner."
      : "The alternative led in every fresh sample tested; that does not guarantee it is best in the full game.",
  ];
}
