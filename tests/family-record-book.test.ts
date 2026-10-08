import {
  createCrokinoleGame,
  applyCrokinoleCommand,
} from "../src/domain/crokinole";
import { expect, it } from "vitest";
import {
  recordBookGames,
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

it("orders confirmed games by instant, with deterministic ties, preserving timestamp bytes", () => {
  const make = (id: string, createdAt: string) => {
    const created = createCrokinoleGame({
      schemaVersion: 1,
      rulesVersion: 1,
      id,
      familyId: "f",
      mode: "confirmed",
      createdAt,
      players: [
        { id: "a", name: "A", seatOrder: 0 },
        { id: "b", name: "B", seatOrder: 1 },
      ],
      participants: [
        {
          id: "a",
          name: "A",
          playerIds: ["a"],
          colour: { id: "red", name: "Red", value: "#ff0000" },
        },
        {
          id: "b",
          name: "B",
          playerIds: ["b"],
          colour: { id: "blue", name: "Blue", value: "#0000ff" },
        },
      ],
      format: "singles",
      scoringMode: "cumulative_round_totals",
      endCondition: { type: "fixed_rounds", rounds: 1 },
      initialStartingPlayerId: "a",
    });
    return applyCrokinoleCommand(created, {
      id: "round-command",
      expectedRevision: 0,
      type: "record_round",
      roundId: "round",
      entries: [
        { participantId: "a", rawScore: 5 },
        { participantId: "b", rawScore: 0 },
      ],
    });
  };
  const earlier = make("earlier", "2026-10-08T12:00:00+02:00");
  const later = make("later", "2026-10-08T10:30:00Z");
  const tied = make("a-tie", "2026-10-08T12:30:00.000+02:00");
  const games = [earlier, later, tied];
  const before = JSON.stringify(games);
  const access = Object.fromEntries(
    games.map((g) => [
      g.definition.id,
      {
        mode: "confirmed" as const,
        concerns: [],
        scorerUserId: "scorer",
        generation: 1,
        canScore: false,
      },
    ]),
  );
  expect(
    recordBookGames([], {}, games, access).map((g) => [g.id, g.createdAt]),
  ).toEqual([
    ["a-tie", "2026-10-08T12:30:00.000+02:00"],
    ["later", "2026-10-08T10:30:00Z"],
    ["earlier", "2026-10-08T12:00:00+02:00"],
  ]);
  expect(JSON.stringify(games)).toBe(before);
});
