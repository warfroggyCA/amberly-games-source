import { describe, it, expect } from "vitest";
import { isGameSummaryPage } from "../src/lib/game-summary";
const game = {
  gameType: "crokinole",
  id: "game",
  createdAt: "2026-09-17T12:00:00Z",
  status: "active",
  participants: [
    { id: "a", name: "Ada" },
    { id: "b", name: "Ben" },
  ],
  totals: { a: 5, b: 10 },
  winnerIds: [],
  mode: "confirmed",
  scorerUserId: "user",
  revision: 0,
};
describe("shared game summary response validation", () => {
  it("accepts valid game pages and negative finalized Scrabble totals", () => {
    expect(isGameSummaryPage({ games: [game], nextCursor: null })).toBe(true);
    expect(
      isGameSummaryPage({
        games: [
          {
            ...game,
            gameType: "scrabble",
            status: "finalized",
            totals: { a: -5, b: 10 },
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
  });
  it.each([
    { totals: { a: 5 } },
    { totals: { a: 5, b: Infinity } },
    { winnerIds: ["missing"] },
    { status: "bogus" },
    { revision: -1 },
    {
      participants: [
        { id: "a", name: "Ada" },
        { id: "a", name: "Ben" },
      ],
    },
    { createdAt: "invalid" },
  ])("rejects malformed summaries %j", (patch) => {
    expect(
      isGameSummaryPage({ games: [{ ...game, ...patch }], nextCursor: null }),
    ).toBe(false);
  });
  it("rejects duplicate rows and overlong cursors", () => {
    expect(isGameSummaryPage({ games: [game, game], nextCursor: null })).toBe(
      false,
    );
    expect(
      isGameSummaryPage({ games: [game], nextCursor: "x".repeat(601) }),
    ).toBe(false);
  });
});
