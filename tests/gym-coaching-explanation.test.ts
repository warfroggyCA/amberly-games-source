import { expect, it } from "vitest";
import { coachingTakeaways } from "../src/domain/gym/coaching-explanation";
import type { StrategyCoaching } from "../src/domain/gym/coaching";
const move = {
  action: { type: "pass" as const },
  label: "Pass",
  points: 10,
  retained: [],
  replyPoints: 20,
  rackBalance: 2,
  estimate: -8,
};
const result: StrategyCoaching = {
  policy: "sampled-reply-rack-v1",
  horizon: "opponent-reply",
  requested: move,
  recommended: {
    ...move,
    points: 8,
    replyPoints: 16,
    rackBalance: 5,
    estimate: -3,
  },
  gap: 5,
  sampleGapRange: [-1, 8],
  verdict: "uncertain",
  considered: 20,
  available: 100,
  discoverySamples: 4,
  validationSamples: 12,
  completedSamples: 104,
};
it("explains a lower scoring alternative without calling it a certain winner", () => {
  const text = coachingTakeaways(result).join(" ");
  expect(text).toContain("2 fewer points now");
  expect(text).toContain("4.0 points lower");
  expect(text).toContain("alternative by 3.0");
  expect(text).toContain("no clear winner");
});
it("reverses the trade-offs and qualifies agreement and shortlist coverage", () => {
  const text = coachingTakeaways({
    ...result,
    requested: result.recommended,
    recommended: result.requested,
    verdict: "favoured",
  }).join(" ");
  expect(text).toContain("2 more points now");
  expect(text).toContain("4.0 points higher");
  expect(text).toContain("your move by 3.0");
  expect(text).toContain("does not guarantee");
  expect(coachingTakeaways({ ...result, verdict: "same" }).join(" ")).toContain(
    "not all compared",
  );
});
