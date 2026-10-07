import { describe, expect, it } from "vitest";
import {
  aggregateLeadStandings,
  isLeadStandings,
  type LeadAssessment,
} from "../src/lib/lead-standings";
import { deriveLeadCounts } from "../src/domain/lead-counts";
import { replayFixture } from "./fixtures/replay";
function assessed(
  gameId: string,
  turns: number,
  led: number,
  spells: number,
  playerIds = ["a", "b"],
): LeadAssessment {
  return {
    gameId,
    revision: 1,
    playerIds,
    outcome: "eligible",
    counts: {
      available: true,
      version: "corrected-turn-leads-v1",
      completedTurns: turns,
      finalLeadChanged: false,
      players: playerIds.map((playerId, index) => ({
        playerId,
        spells: [],
        entries: index ? 0 : spells,
        regains: index ? 0 : Math.max(0, spells - 1),
        turnsLed: index ? 0 : led,
        coLeadingTurns: 0,
        longest: index || !spells ? null : Math.ceil(led / spells),
        average: index || !spells ? null : led / spells,
      })),
    },
  };
}
describe("lead standings from an authorized complete snapshot", () => {
  it("weights average by spells, not games, and uses only games each player participated in", () => {
    const result = aggregateLeadStandings([
      assessed("one", 10, 8, 2),
      assessed("two", 100, 90, 1, ["a", "c"]),
    ]);
    expect(result.rows[0]).toMatchObject({
      completedGames: 2,
      eligibleGames: 2,
      eligibleTurns: 110,
      leads: 3,
      turnsLed: 98,
      average: 98 / 3,
      turnShare: 98 / 110,
      regains: 1,
      longest: 90,
    });
    expect(result.rows[1]).toMatchObject({
      eligibleGames: 1,
      eligibleTurns: 10,
      leads: 0,
      average: null,
      turnShare: 0,
    });
    expect(result.rows[2].eligibleTurns).toBe(100);
    expect(isLeadStandings(result)).toBe(true);
  });
  it("keeps tied checkpoints out of sole lead percentage and all-zero starts out of streaks", () => {
    const game = assessed("tie", 4, 1, 1);
    game.counts!.players.forEach((p) => (p.coLeadingTurns = 2));
    const zero = assessed("zero", 4, 0, 0);
    const result = aggregateLeadStandings([game, zero]);
    expect(result.rows[0]).toMatchObject({
      turnsLed: 1,
      tiedTurns: 2,
      turnShare: 1 / 8,
      leads: 1,
    });
    expect(result.rows[1]).toMatchObject({
      turnsLed: 0,
      tiedTurns: 2,
      average: null,
    });
  });
  it("deduplicates games and revisions, never falls back when the newest history is unavailable", () => {
    const old = assessed("same", 10, 8, 2);
    const next = { ...assessed("same", 4, 3, 1), revision: 2 };
    expect(
      aggregateLeadStandings([old, next, next, old]).rows[0],
    ).toMatchObject({ completedGames: 1, leads: 1, turnsLed: 3 });
    const missing: LeadAssessment = {
      ...next,
      revision: 3,
      outcome: "unavailable",
      counts: undefined,
    };
    const result = aggregateLeadStandings([old, next, missing]);
    expect(result).toMatchObject({
      completedGames: 1,
      eligibleGames: 0,
      unavailableGames: 1,
    });
    expect(result.rows[0]).toMatchObject({
      eligibleGames: 0,
      average: null,
      turnShare: null,
    });
  });
  it("refuses conflicting same-revision evidence", () => {
    const result = aggregateLeadStandings([
      assessed("same", 4, 3, 1),
      assessed("same", 4, 2, 1),
    ]);
    expect(result.eligibleGames).toBe(0);
    expect(result.unavailableGames).toBe(1);
  });
  it("replaces removed/access-lost games rather than retaining historical accumulated totals", () => {
    const first = assessed("one", 10, 8, 2),
      second = assessed("two", 4, 3, 1);
    expect(aggregateLeadStandings([first, second]).rows[0].turnsLed).toBe(11);
    expect(aggregateLeadStandings([second]).rows[0].turnsLed).toBe(3);
    expect(aggregateLeadStandings([])).toEqual({
      completedGames: 0,
      eligibleGames: 0,
      unavailableGames: 0,
      excludedGames: 0,
      rows: [],
    });
  });
  it("separates policy exclusions from missing reliable history without inventing eligibility", () => {
    const missing: LeadAssessment = {
      gameId: "missing",
      revision: 1,
      playerIds: ["a", "b"],
      outcome: "unavailable",
    };
    const excluded: LeadAssessment = {
      ...missing,
      gameId: "excluded",
      outcome: "excluded",
    };
    const result = aggregateLeadStandings([missing, excluded]);
    expect(result).toMatchObject({
      eligibleGames: 0,
      unavailableGames: 1,
      excludedGames: 1,
    });
    expect(
      result.rows.every(
        (r) =>
          r.eligibleTurns === 0 && r.turnShare === null && r.average === null,
      ),
    ).toBe(true);
  });
  it("accepts the real corrected/undone journal's effective turns exactly once", () => {
    const game = replayFixture().game;
    const counts = deriveLeadCounts(game);
    if (!counts.available) throw Error(counts.reason);
    const a: LeadAssessment = {
      gameId: game.id,
      revision: game.revision,
      playerIds: game.order,
      outcome: "eligible",
      counts,
    };
    expect(
      aggregateLeadStandings([a, a]).rows.find((r) => r.playerId === "doug"),
    ).toMatchObject({
      eligibleGames: 1,
      eligibleTurns: 3,
      turnsLed: 3,
      leads: 1,
    });
  });
  it("validates responses including impossible coverage and nonfinite totals", () => {
    const result = aggregateLeadStandings([assessed("one", 10, 8, 2)]);
    expect(isLeadStandings({ ...result, eligibleGames: 2 })).toBe(false);
    expect(
      isLeadStandings({
        ...result,
        rows: [{ ...result.rows[0], average: Infinity }],
      }),
    ).toBe(false);
    expect(
      isLeadStandings({ ...result, rows: [result.rows[0], result.rows[0]] }),
    ).toBe(false);
  });
});
