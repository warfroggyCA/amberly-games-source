import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { installFixture, fitsWidth } from "./fixtures/crokinole";

async function resultFixture(page: Page, photoDataUrl?: string, tied = false) {
  const f = await installFixture(page);
  f.family.players[0].photoDataUrl = photoDataUrl;
  const made = createGame({
    id: "portrait-result",
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw Error(made.error.message);
  const game = structuredClone(made.game);
  game.status = "finalized";
  game.scores = { doug: 197, erin: tied ? 197 : 126 };
  game.result = {
    scores: game.scores,
    scoresBeforeAdjustments: game.scores,
    adjustments: {
      doug: { deduction: 0, transfer: 0, finalScore: 197 },
      erin: { deduction: 0, transfer: 0, finalScore: tied ? 197 : 126 },
    },
    winnerIds: tied ? ["doug", "erin"] : ["doug"],
    reason: "early",
    assisted: false,
    racks: { doug: [], erin: [] },
    actualBagCount: 86,
    competitiveEligible: false,
    revision: 0,
    unequalTurns: false,
  };
  f.family.games.push(game);
  f.family.gameAccess[game.id] = {
    scorerUserId: f.family.member.userId,
    deviceId: "test-device",
    generation: 1,
    mode: "confirmed",
    recordsEligible: false,
    protests: [],
    canScore: true,
    approvals: [],
  };
  await page.route("**/api/family/games?*", (route) =>
    route.fulfill({
      json: {
        games: [
          {
            gameType: "scrabble",
            id: game.id,
            createdAt: "2026-09-26T12:00:00.000Z",
            status: game.status,
            participants: game.players,
            totals: game.scores,
            winnerIds: game.result!.winnerIds,
            mode: "confirmed",
            scorerUserId: f.family.member.userId,
            revision: game.revision,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.goto("/family/history");
  await page.getByRole("button", { name: /Doug vs Erin/ }).click();
  await expect(
    page.getByRole("heading", { name: "Final results", exact: true }),
  ).toBeVisible();
  return f;
}

async function photo() {
  return `data:image/jpeg;base64,${(
    await sharp({
      create: { width: 96, height: 96, channels: 3, background: "#c52b81" },
    })
      .jpeg()
      .toBuffer()
  ).toString("base64")}`;
}

test("historical results have one viewing link, a crowned portrait and an overlay score drawer", async ({
  page,
}, testInfo) => {
  await resultFixture(page, await photo());
  const banner = page.getByRole("region", { name: "Game result" });
  await expect(banner.getByAltText("Doug’s profile photo")).toBeVisible();
  await expect(page.locator(".watch-link-button")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Share viewing link" }),
  ).toBeVisible();
  const opener = page.getByRole("button", {
    name: "Expand score panel",
    exact: true,
  });
  await expect(opener).toContainText("Scores");
  await opener.scrollIntoViewIfNeeded();
  const board = page.getByRole("grid", { name: "Scrabble board, 15 by 15" });
  const before = await board.boundingBox();
  await opener.click();
  const sheet = page.getByRole("dialog", { name: "Score sheet" });
  await expect(sheet).toBeVisible();
  const bounds = (await sheet.boundingBox())!;
  expect(bounds.y).toBe(0);
  expect(bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  expect(await board.boundingBox()).toEqual(before);
  await sheet.getByRole("button", { name: "Turns", exact: true }).click();
  await expect(
    sheet.getByRole("button", { name: "Turns", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("score-drawer.png") });
  await sheet.getByRole("button", { name: "Close dialog" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();
  await fitsWidth(page);
  await page.getByRole("button", { name: "Share result", exact: true }).click();
  const badge = page.getByRole("dialog", { name: "Well played!" });
  const downloadEvent = page.waitForEvent("download");
  await badge.getByRole("link", { name: "Save image" }).click();
  const download = await downloadEvent;
  const path = testInfo.outputPath("portrait-result.png");
  await download.saveAs(path);
  const pixel = await sharp(path)
    .extract({ left: 535, top: 525, width: 10, height: 10 })
    .raw()
    .toBuffer();
  expect(pixel[0]).toBeGreaterThan(180);
  expect(pixel[1]).toBeLessThan(70);
  expect(pixel[2]).toBeGreaterThan(95);
  await page.screenshot({ path: testInfo.outputPath("portrait-badge.png") });
});

test("missing and undecodable photos retain crown-only results and export", async ({
  page,
}) => {
  // Structurally accepted JPEG data whose pixels cannot decode.
  await resultFixture(page, "data:image/jpeg;base64,/9j/AP/Z");
  const banner = page.getByRole("region", { name: "Game result" });
  await expect(banner.locator(".winner-crown")).toBeVisible();
  await expect(banner.locator(".winner-portrait-photo")).toHaveCount(0);
  await page.getByRole("button", { name: "Share result", exact: true }).click();
  const badge = page.getByRole("dialog", { name: "Well played!" });
  await expect(badge.getByRole("link", { name: "Save image" })).toBeVisible();
  await expect(badge.getByRole("alert")).toHaveCount(0);
});

test("tied results include both winners with a crown for a missing portrait", async ({
  page,
}) => {
  await resultFixture(page, await photo(), true);
  const banner = page.getByRole("region", { name: "Game result" });
  await expect(banner).toContainText("It’s a tie!");
  await expect(banner.getByAltText("Doug’s profile photo")).toBeVisible();
  await expect(banner.locator(".winner-crown")).toHaveCount(1);
  await page.getByRole("button", { name: "Share result", exact: true }).click();
  const badge = page.getByRole("dialog", { name: "Well played!" });
  await expect(badge.getByRole("link", { name: "Save image" })).toBeVisible();
  await expect(badge).toContainText("Doug");
  await expect(badge).toContainText("Erin");
});
