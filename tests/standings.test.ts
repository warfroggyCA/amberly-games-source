import { describe, expect, it } from "vitest";
import { rankStandings, type Standing } from "../src/lib/standings";
const rows: Standing[] = [
  { playerId: "a", gameType: "scrabble", played: 10, wins: 4, ties: 2 },
  { playerId: "a", gameType: "crokinole", played: 5, wins: 3, ties: 0 },
  { playerId: "b", gameType: "crokinole", played: 9, wins: 7, ties: 1 },
  { playerId: "c", gameType: "scrabble", played: 4, wins: 2, ties: 1 },
];
describe("family standings", () => {
  it("combines full-history totals with shared ranks and weighted win rates", () => {
    const result = rankStandings(rows, "overall");
    expect(
      result.map(({ playerId, rank, wins }) => ({ playerId, rank, wins })),
    ).toEqual([
      { playerId: "a", rank: 1, wins: 7 },
      { playerId: "b", rank: 1, wins: 7 },
      { playerId: "c", rank: 3, wins: 2 },
    ]);
    expect(result[0]).toMatchObject({
      played: 15,
      ties: 2,
      winRate: 7 / 15,
      byGame: {
        scrabble: { played: 10, wins: 4, ties: 2 },
        crokinole: { played: 5, wins: 3, ties: 0 },
      },
    });
    expect(rows[0].played).toBe(10);
  });
  it("ranks each game independently without counting ties as wins", () => {
    expect(
      rankStandings(rows, "crokinole").map(({ playerId, rank }) => ({
        playerId,
        rank,
      })),
    ).toEqual([
      { playerId: "b", rank: 1 },
      { playerId: "a", rank: 2 },
    ]);
    expect(rankStandings(rows, "scrabble")[0].wins).toBe(4);
  });
  it("handles empty history and avoids division by zero", () => {
    expect(rankStandings([], "overall")).toEqual([]);
    expect(
      rankStandings(
        [{ playerId: "z", gameType: "scrabble", played: 0, wins: 0, ties: 0 }],
        "overall",
      )[0].winRate,
    ).toBe(0);
  });
});
