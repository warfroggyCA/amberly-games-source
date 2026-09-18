import { expect, it } from "vitest";
import {
  DEFAULT_CROKINOLE_SETTINGS,
  isCrokinoleDefaults,
} from "../src/domain/crokinole-defaults";
it("seeds the family winner-only, four-individual, 300-point game", () => {
  expect(isCrokinoleDefaults(DEFAULT_CROKINOLE_SETTINGS)).toBe(true);
  expect(DEFAULT_CROKINOLE_SETTINGS.endCondition).toEqual({
    type: "target",
    target: 300,
  });
});
it.each([
  { playerCount: 1 },
  { format: "doubles", playerCount: 3 },
  { format: "singles" },
  { scoringMode: "nca_match_points" },
  { scoringMode: ["net_winner_only"] },
  { endCondition: { type: "target", target: 0 } },
  { endCondition: { type: "target", target: 302 } },
  { endCondition: { type: "fixed_rounds", rounds: 0 } },
  { unexpected: true },
])("rejects incompatible or malformed defaults %j", (patch) => {
  expect(isCrokinoleDefaults({ ...DEFAULT_CROKINOLE_SETTINGS, ...patch })).toBe(
    false,
  );
});
it("accepts two-side NCA and fixed cumulative options", () => {
  expect(
    isCrokinoleDefaults({
      ...DEFAULT_CROKINOLE_SETTINGS,
      format: "doubles",
      scoringMode: "nca_match_points",
      endCondition: { type: "target", target: 7 },
    }),
  ).toBe(true);
  expect(
    isCrokinoleDefaults({
      ...DEFAULT_CROKINOLE_SETTINGS,
      scoringMode: "cumulative_round_totals",
      endCondition: { type: "fixed_rounds", rounds: 6 },
    }),
  ).toBe(true);
});
