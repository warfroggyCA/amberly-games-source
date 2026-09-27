import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import type { GameSummary } from "../../src/lib/game-summary";

test("history displays profile photos, nicknames and safe fallbacks across pages", async ({
  page,
}, info) => {
  const fixture = await installFixture(page);
  fixture.family.players[0].nickname = "Froggy";
  fixture.family.players[0].photoDataUrl = `data:image/jpeg;base64,${(
    await sharp({
      create: { width: 96, height: 96, channels: 3, background: "#258855" },
    })
      .jpeg()
      .toBuffer()
  ).toString("base64")}`;
  fixture.family.playerAccess.doug = {
    revision: 1,
    userId: null,
    archived: true,
  };
  // An accepted JPEG envelope can still fail to decode in the browser.
  fixture.family.players[1].photoDataUrl = "data:image/jpeg;base64,/9j/AP/Z";
  const summary: GameSummary = {
    gameType: "scrabble",
    id: "portraits",
    createdAt: "2026-09-26T12:00:00Z",
    status: "finalized",
    participants: [
      { id: "doug", name: "Doug" },
      { id: "erin", name: "Erin" },
    ],
    totals: { doug: 197, erin: 126 },
    winnerIds: ["doug"],
    mode: "confirmed",
    scorerUserId: fixture.family.member.userId,
    revision: 0,
  };
  await page.route("**/api/family/games?*", (route) => {
    const nextPage = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({
      json: {
        games: nextPage
          ? [
              {
                ...summary,
                id: "older-portraits",
                participants: [
                  { id: "removed", name: "Former player" },
                  { id: "erin", name: "Erin" },
                ],
                totals: { removed: 155, erin: 150 },
                winnerIds: ["removed"],
              },
            ]
          : [summary],
        nextCursor: nextPage ? null : "next-page",
      },
    });
  });
  await page.goto("/family/history");
  const row = page.locator(".hub-recent-game").first();
  await expect(row.getByAltText("Froggy’s profile photo")).toBeVisible();
  await expect(row.locator(".history-participant-winner")).toContainText(
    "Froggy",
  );
  await expect(row.locator(".winner-portrait-crown")).toHaveCount(1);
  await expect(row.locator(".player-portrait-initial")).toHaveText("E");
  await expect(row.locator("button, a, input")).toHaveCount(0);
  await page.getByRole("button", { name: "More games", exact: true }).click();
  const older = page.locator(".hub-recent-game").last();
  await expect(older).toContainText("Former player");
  await expect(older.locator(".winner-crown")).toHaveCount(1);
  await expect(older.locator(".history-participant-score").first()).toHaveText(
    "155 points",
  );
  await fitsWidth(page);
  await page.screenshot({ path: info.outputPath("history-portraits.png") });
});

test("Crokinole tied teams show both partners without assigning a teammate's photo", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  fixture.family.players[0].nickname = "Froggy";
  fixture.family.players[1].nickname = "Cici";
  await page.route("**/api/family/games?*", (route) =>
    route.fulfill({
      json: {
        games: [
          {
            gameType: "crokinole",
            id: "tied-teams",
            createdAt: "2026-09-26T12:00:00Z",
            status: "completed",
            participants: [
              {
                id: "team-one",
                name: "Doug & Erin",
                playerIds: ["doug", "erin"],
              },
              {
                id: "team-two",
                name: "Nate & Cristine",
                playerIds: ["nate", "cristine"],
              },
            ],
            totals: { "team-one": 60, "team-two": 60 },
            winnerIds: ["team-one", "team-two"],
            mode: "confirmed",
            scorerUserId: fixture.family.member.userId,
            revision: 0,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.goto("/family/history");
  const row = page.locator(".hub-recent-game");
  await expect(row.locator(".history-participant-name").first()).toHaveText(
    "Froggy & Cici",
  );
  await expect(row.locator(".history-participant-result")).toHaveText([
    "Tied winner",
    "Tied winner",
  ]);
  await expect(row.locator(".history-portrait-slot")).toHaveCount(4);
  await expect(row.locator(".winner-crown")).toHaveCount(4);
  await fitsWidth(page);
});

test("saved Scrabble results return to history and use the latest profile photo", async ({
  page,
}, info) => {
  const fixture = await installFixture(page);
  const { createGame } = await import("../../src/domain/game");
  const { testLexicon } = await import("../../src/lib/test-lexicon");
  const created = createGame({
    id: "return-history",
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!created.ok) throw new Error(created.error.message);
  const game = {
    ...created.game,
    status: "finalized" as const,
    result: {
      scores: { doug: 197, erin: 126 },
      winnerIds: ["doug"],
      reason: "natural" as const,
      racks: {},
      actualBagCount: 0,
      competitiveEligible: true,
      revision: 0,
      assisted: false,
      unequalTurns: false,
      scoresBeforeAdjustments: { doug: 197, erin: 126 },
      adjustments: {
        doug: { deduction: 0, transfer: 0, finalScore: 197 },
        erin: { deduction: 0, transfer: 0, finalScore: 126 },
      },
    },
  };
  fixture.family.games.push(game);
  const saved = JSON.stringify(game);
  const photo = async (background: string) =>
    `data:image/png;base64,${(
      await sharp({
        create: { width: 96, height: 96, channels: 4, background },
      })
        .png()
        .toBuffer()
    ).toString("base64")}`;
  const oldPhoto = await photo("#25885580");
  const newPhoto = await photo("#aa558880");
  fixture.family.players[0].photoDataUrl = oldPhoto;
  await page.route("**/api/family/games?*", (route) =>
    route.fulfill({
      json: {
        games: [
          {
            gameType: "scrabble",
            id: game.id,
            createdAt: game.definition.createdAt,
            status: "finalized",
            participants: game.players,
            totals: game.result.scores,
            winnerIds: ["doug"],
            mode: "confirmed",
            scorerUserId: fixture.family.member.userId,
            revision: 0,
          },
        ],
        nextCursor: null,
        standings: [
          {
            playerId: "doug",
            gameType: "scrabble",
            played: 1,
            wins: 1,
            ties: 0,
          },
        ],
      },
    }),
  );
  await page.goto("/family/history");
  const row = page.locator(".hub-recent-game");
  await expect(row.getByAltText("Doug’s profile photo")).toHaveAttribute(
    "src",
    oldPhoto,
  );
  // Opening a saved game refreshes the current family profiles as well.
  fixture.family.players[0].photoDataUrl = newPhoto;
  await row.click();
  const back = page.getByRole("button", { name: "Back to history" });
  await expect(back).toBeVisible();
  await page.screenshot({ path: info.outputPath("history-return.png") });
  await back.click();
  await expect(page).toHaveURL(/\/family\/history$/);
  await expect(row.getByAltText("Doug’s profile photo")).toHaveAttribute(
    "src",
    newPhoto,
  );
  await page
    .getByText("Family standings · wins & ranks", { exact: true })
    .click();
  await expect(
    page.locator(".family-standings").getByAltText("Doug’s profile photo"),
  ).toHaveAttribute("src", newPhoto);
  await fitsWidth(page);
  // The Scrabble recent-games screen also returns to its own list.
  await page.goto("/family/scrabble");
  await page.locator(".game-list button").first().click();
  await page.getByRole("button", { name: "Back to leaderboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Recent games" }),
  ).toBeVisible();
  expect(JSON.stringify(fixture.family.games[0])).toBe(saved);
  await page.screenshot({
    path: info.outputPath("current-profile-standings.png"),
  });
});
