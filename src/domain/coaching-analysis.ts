import { findMoves, type EnumerableLexicon } from "./solver";
import { scoreTiers } from "./gym/score-tiers";
import { validateReviewRack, type CoachingPosition } from "./turn-coaching";

export type CoachingAnswer = ReturnType<
  ReturnType<typeof scoreTiers>["summary"]
> & {
  status: "complete" | "incomplete" | "unavailable";
  totalMoves: number;
  message?: string;
};
export function analyseCoaching(
  position: CoachingPosition,
  rack: string[],
  lexicon: EnumerableLexicon,
  maxNodes = 2_000_000,
): CoachingAnswer {
  validateReviewRack(position, rack);
  const tiers = scoreTiers();
  const result = findMoves(position.board, rack, lexicon, {
    limit: 1,
    maxNodes,
    tileSupply: position.tileSupply,
    onMove: tiers.observe,
  });
  if (result.status !== "complete")
    return {
      status: result.status === "incomplete" ? "incomplete" : "unavailable",
      totalMoves: 0,
      best: [],
      histogram: [],
      message:
        result.status === "invalid"
          ? result.error
          : "The search did not finish. No medals or maximum are certified.",
    };
  return {
    status: "complete",
    totalMoves: result.totalMoves,
    ...tiers.summary(),
  };
}
