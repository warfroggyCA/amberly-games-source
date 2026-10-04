import { expect, it } from "vitest";
import {
  bookHighlights,
  bookRivalry,
  type BookGame,
} from "../src/lib/family-record-book";
import { badgePortraitCrownRect } from "../src/lib/result-badge";
const game = (
  id: string,
  a: number,
  b: number,
  winners: string[] = [a > b ? "a" : "b"],
): BookGame => ({
  id,
  kind: "scrabble",
  createdAt: "2026-10-04T00:00:00Z",
  group: "same-rules",
  context: "2 players",
  eligible: true,
  players: [
    { id: "a", name: "Ada", score: a, winner: winners.includes("a") },
    { id: "b", name: "Ben", score: b, winner: winners.includes("b") },
  ],
});
it("preserves ties and excludes noncompetitive finishes from high scores and rivalries", () => {
  const games = [
    game("win", 300, 290),
    game("loss", 280, 310),
    game("tie", 300, 300, ["a", "b"]),
    { ...game("early", 900, 100), eligible: false },
  ];
  expect(bookRivalry(games, "a", "b")).toMatchObject({
    firstWins: 1,
    secondWins: 1,
    ties: 1,
    closest: { margin: 0 },
  });
  expect(bookHighlights(games).best.map((p) => [p.id, p.score])).toEqual([
    ["b", 310],
  ]);
});
it("retains shared high scores and never treats a third-player game as a duel", () => {
  const games = [
    game("one", 300, 200),
    game("two", 300, 250),
    {
      ...game("three", 400, 100),
      players: [
        ...game("x", 400, 100).players,
        { id: "c", name: "Cici", score: 600, winner: true },
      ],
    },
  ];
  expect(bookRivalry(games, "a", "b").matches).toHaveLength(2);
  expect(bookHighlights(games.slice(0, 2)).best).toHaveLength(2);
});
it("keeps the entire result crown above portraits at single, paired and four-winner sizes", () => {
  for (const radius of [58, 78, 130]) {
    const box = badgePortraitCrownRect(540, 584, radius);
    expect(box.y + box.height).toBeLessThan(584 - radius - 5);
    expect(box.x + box.width / 2).toBe(540);
  }
});
