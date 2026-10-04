import { expect, test } from "@playwright/test";
import { createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
const releasedFamilyLexicon = {
  ...testLexicon,
  id: "amberly-family-v1-2121ea84c411",
  edition: "Amberly family reference v1 (website 2026-09-14 + OSPD5)",
  status: "ready" as const,
};
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import {
  createCrokinoleGame,
  applyCrokinoleCommand,
  DEFAULT_PIECE_COLOURS,
} from "../../src/domain/crokinole";

test("Record Book keeps highlights, compatible rivalries and both-game journal readable", async ({
  page,
}, info) => {
  const f = await installFixture(page);
  for (const [index, a, b] of [
    [0, 412, 368],
    [1, 380, 398],
    [2, 390, 390],
  ]) {
    const made = createGame({
      id: `book-${index}`,
      players: [
        { id: "doug", name: "Doug", seat: 0 },
        { id: "erin", name: "Erin", seat: 2 },
      ],
      firstPlayerId: "doug",
      direction: "clockwise",
      lexicon: releasedFamilyLexicon,
      createdAt: `2026-10-0${index + 1}T18:00:00Z`,
    });
    if (!made.ok) throw Error(made.error.message);
    const g = structuredClone(made.game);
    g.status = "finalized";
    g.scores = { doug: a, erin: b };
    g.result = {
      scores: g.scores,
      scoresBeforeAdjustments: g.scores,
      adjustments: {
        doug: { deduction: 0, transfer: 0, finalScore: a },
        erin: { deduction: 0, transfer: 0, finalScore: b },
      },
      winnerIds: a === b ? ["doug", "erin"] : [a > b ? "doug" : "erin"],
      reason: "blocked",
      assisted: false,
      racks: { doug: [], erin: [] },
      actualBagCount: 86,
      competitiveEligible: true,
      eligibilityPolicy: 2,
      revision: 0,
      unequalTurns: false,
    };
    f.family.games.push(g);
    f.family.gameAccess[g.id] = {
      scorerUserId: f.family.member.userId,
      deviceId: "fixture",
      generation: 1,
      mode: "confirmed",
      recordsEligible: true,
      protests: [],
      canScore: true,
      approvals: [],
    };
  }
  let disc = createCrokinoleGame({
    schemaVersion: 1,
    rulesVersion: 1,
    id: "book-discs",
    familyId: f.family.family.id,
    mode: "confirmed",
    createdAt: "2026-10-03T19:00:00Z",
    players: [
      { id: "doug", name: "Doug", seatOrder: 0 },
      { id: "erin", name: "Erin", seatOrder: 1 },
    ],
    participants: [
      {
        id: "doug",
        name: "Doug",
        playerIds: ["doug"],
        colour: {
          id: DEFAULT_PIECE_COLOURS[0].id,
          name: DEFAULT_PIECE_COLOURS[0].name,
          value: DEFAULT_PIECE_COLOURS[0].value,
        },
      },
      {
        id: "erin",
        name: "Erin",
        playerIds: ["erin"],
        colour: {
          id: DEFAULT_PIECE_COLOURS[1].id,
          name: DEFAULT_PIECE_COLOURS[1].name,
          value: DEFAULT_PIECE_COLOURS[1].value,
        },
      },
    ],
    format: "singles",
    scoringMode: "cumulative_round_totals",
    endCondition: { type: "target", target: 100 },
    initialStartingPlayerId: "doug",
  });
  disc = applyCrokinoleCommand(
    disc,
    {
      type: "record_round",
      id: "one",
      roundId: "one",
      expectedRevision: 0,
      entries: [
        { participantId: "doug", rawScore: 100 },
        { participantId: "erin", rawScore: 80 },
      ],
    },
    { actorId: f.family.member.userId, createdAt: "2026-10-03T19:20:00Z" },
  );
  f.shared.games.push(disc);
  f.shared.access[disc.definition.id] = {
    scorerUserId: f.family.member.userId,
    generation: 1,
    canScore: true,
    mode: "confirmed",
    concerns: [],
  };
  await page.goto("/family/records");
  await expect(
    page.getByRole("heading", { name: "A game worth remembering" }),
  ).toBeVisible();
  await expect(page.locator(".book-score")).toHaveText("412");
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("record-book-highlights.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Rivalries", exact: true }).click();
  await expect(page.locator(".book-match")).toContainText(
    "3 games together · 1 tie",
  );
  await expect(page.locator(".book-match")).toContainText("Level on wins");
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("record-book-rivalries.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("button", { name: "All games", exact: true }).click();
  await expect(page.locator(".book-journal-entry")).toHaveCount(4);
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("record-book-journal.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Highlights", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Scrabble", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".book-score")).toHaveText("412");
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("button", { name: "Crokinole", exact: true }).click();
  await expect(page.locator(".book-journal-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "Highlights", exact: true }).click();
  await expect(page.locator(".book-score")).toHaveText("100");
});

test("Record Book refuses partial records and private practice", async ({
  page,
}) => {
  const f = await installFixture(page);
  f.family.nextCursor = "older";
  await page.goto("/family/records");
  await expect(
    page.getByText("Bring the whole history to the table."),
  ).toBeVisible();
  await expect(page.locator(".book-hero")).toHaveCount(0);
  f.family.nextCursor = null;
  await page.reload();
  await expect(
    page.getByText("Your next game can make history."),
  ).toBeVisible();
});
