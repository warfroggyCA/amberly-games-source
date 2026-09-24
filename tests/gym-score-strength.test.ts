import { expect, it } from "vitest";
import { scoreStrength } from "../src/domain/gym/score-strength";
const summary = {
  maximum: 40,
  totalMoves: 9,
  histogram: [
    { score: 40, count: 2 },
    { score: 30, count: 3 },
    { score: 10, count: 4 },
  ],
};
it("counts better placements, handles ties and reserves five bars for maximum", () => {
  expect(scoreStrength(40, summary)).toMatchObject({
    rank: 1,
    tied: true,
    bars: 5,
    best: true,
    percentage: 100,
    total: 9,
  });
  expect(scoreStrength(30, summary)).toMatchObject({
    rank: 3,
    tied: true,
    bars: 3,
    best: false,
    percentage: 75,
  });
  expect(scoreStrength(10, summary)).toMatchObject({
    rank: 6,
    bars: 1,
    percentage: 25,
  });
});
it("does not invent a comparison for an absent score or unavailable maximum", () => {
  expect(scoreStrength(41, summary)).toBeNull();
  expect(scoreStrength(0, { ...summary, maximum: 0 })).toBeNull();
});

it("awards medals by distinct scores while retaining competition ranks", () => {
  expect(scoreStrength(40, summary)).toMatchObject({ medal: "gold", rank: 1 });
  expect(scoreStrength(30, summary)).toMatchObject({
    medal: "silver",
    rank: 3,
  });
  expect(scoreStrength(10, summary)).toMatchObject({
    medal: "bronze",
    rank: 6,
  });
  expect(
    scoreStrength(5, {
      ...summary,
      histogram: [...summary.histogram, { score: 5, count: 1 }],
      totalMoves: 10,
    })?.medal,
  ).toBeNull();
});
