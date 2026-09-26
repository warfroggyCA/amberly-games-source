import type { CrokinoleDefinition, CrokinoleScoringMode } from "./crokinole";
export type CrokinoleDefaults = {
  playerCount: 2 | 3 | 4;
  format: CrokinoleDefinition["format"];
  scoringMode: CrokinoleScoringMode;
  endCondition: CrokinoleDefinition["endCondition"];
};
export const DEFAULT_CROKINOLE_SETTINGS: CrokinoleDefaults = {
  playerCount: 4,
  format: "free_for_all",
  scoringMode: "net_winner_only",
  endCondition: { type: "target", target: 300 },
};
export function isCrokinoleDefaults(
  value: unknown,
): value is CrokinoleDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join() !==
    ["playerCount", "format", "scoringMode", "endCondition"].sort().join()
  )
    return false;
  if (![2, 3, 4].includes(v.playerCount as number)) return false;
  if (
    !(v.playerCount === 2
      ? v.format === "singles"
      : v.playerCount === 3
        ? v.format === "free_for_all"
        : ["doubles", "free_for_all"].includes(v.format as string))
  )
    return false;
  if (
    typeof v.scoringMode !== "string" ||
    ![
      "net_winner_only",
      "cumulative_round_totals",
      "traditional_differential",
      "nca_match_points",
    ].includes(v.scoringMode)
  )
    return false;
  if (
    v.format === "free_for_all" &&
    !["net_winner_only", "cumulative_round_totals"].includes(v.scoringMode)
  )
    return false;
  if (
    !v.endCondition ||
    typeof v.endCondition !== "object" ||
    Array.isArray(v.endCondition)
  )
    return false;
  const e = v.endCondition as Record<string, unknown>;
  if (e.type === "target" && Object.keys(e).sort().join() === "target,type")
    return (
      Number.isSafeInteger(e.target) &&
      Number(e.target) > 0 &&
      Number(e.target) < 2147483646 &&
      (v.scoringMode === "nca_match_points"
        ? [5, 7, 9, 11].includes(Number(e.target))
        : Number(e.target) % 5 === 0)
    );
  return (
    e.type === "fixed_rounds" &&
    Object.keys(e).sort().join() === "rounds,type" &&
    Number.isSafeInteger(e.rounds) &&
    Number(e.rounds) > 0 &&
    Number(e.rounds) <= 5000 &&
    v.scoringMode !== "traditional_differential" &&
    (v.scoringMode !== "nca_match_points" || e.rounds === 4)
  );
}
