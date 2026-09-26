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
