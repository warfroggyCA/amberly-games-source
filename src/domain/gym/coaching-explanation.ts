import type { StrategyCoaching } from "./coaching";

/** Player-facing advice uses measured points and actual retained tiles. */
export function coachingTakeaways(result: StrategyCoaching): string[] {
  if (result.verdict === "same")
    return [
      "Of the moves we checked, yours came out on top.",
      "That’s a good sign, though we can’t know what your opponent will play next.",
    ];
  const name = result.recommended.label.split(" at ")[0];
  const points = result.recommended.points - result.requested.points;
  const replies = result.requested.replyPoints - result.recommended.replyPoints;
  const retained = result.recommended.retained
    .map((tile) => (tile === "?" ? "blank" : tile))
    .join(" · ");
  return [
    points === 0
      ? "Both moves score the same points."
      : `${name} scores ${Math.abs(points)} ${points > 0 ? "more" : "fewer"} points than yours.`,
    Math.abs(replies) < 1
      ? `${name} gives your opponent about the same scoring chances.`
      : `After ${name}, we estimate your opponent could score about ${Math.abs(replies).toFixed(0)} ${replies > 0 ? "fewer" : "more"} ${Math.round(Math.abs(replies)) === 1 ? "point" : "points"} on their next turn.`,
    retained
      ? `With ${name}, you’d keep ${retained}${result.recommended.action.type === "pass" ? "." : ", then draw new tiles."}`
      : "You’d use all your tiles and draw a fresh rack.",
    ...(result.verdict === "uncertain"
      ? [
          "Neither move has a clear edge—it depends on what your opponent holds and what you draw.",
        ]
      : []),
  ];
}
