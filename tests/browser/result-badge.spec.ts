import { expect, test } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";

test("winner badge pops up, downloads, shares without a private link, and remains available to members", async ({
  page,
}, testInfo) => {
  const fixture = await installFixture(page, {
    playerCount: 2,
    format: "singles",
    scoringMode: "cumulative_round_totals",
    endCondition: { type: "target", target: 100 },
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      value: () => true,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as unknown as { badgeShare: unknown }).badgeShare = {
          title: data.title,
          text: data.text,
          url: data.url,
          files: data.files?.map((f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
          })),
        };
      },
    });
  });
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByRole("button", { name: "Add Round 1", exact: true }).click();
  await page.getByLabel("Doug round total", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save round", exact: true }).click();
  const badge = page.getByRole("dialog", { name: "Well played!" });
  await expect(badge).toContainText("Doug");
  await expect(badge).toContainText("100 points");
  await fitsWidth(page);
  await page.screenshot({ path: testInfo.outputPath("winner-badge.png") });
  const download = page.waitForEvent("download");
  await badge.getByRole("link", { name: "Save image" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("amberly-winner.png");
  await saved.saveAs(testInfo.outputPath("shared-winner.png"));
  await badge.getByRole("button", { name: "Share badge" }).click();
  const shared = await page.evaluate(
    () =>
      (
        window as unknown as {
          badgeShare: {
            text: string;
            url?: string;
            files: { size: number; type: string }[];
          };
        }
      ).badgeShare,
  );
  expect(shared.text).toBe("Doug won at Crokinole!");
  expect(shared.url).toBeUndefined();
  expect(shared.files[0].type).toBe("image/png");
  expect(shared.files[0].size).toBeGreaterThan(1000);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    }),
  );
  await badge.getByRole("button", { name: "Share badge" }).click();
  await expect(badge.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new Error("Unavailable");
      },
    }),
  );
  await badge.getByRole("button", { name: "Share badge" }).click();
  await expect(badge.getByRole("alert")).toContainText("save the image");
  await expect(badge.getByRole("link", { name: "Save image" })).toBeVisible();
  await badge.getByRole("button", { name: "Close dialog" }).click();
  const id = fixture.game().definition.id;
  fixture.shared.access[id].canScore = false;
  fixture.shared.access[id].scorerUserId = "another-member";
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Well played!" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Share result" }).click();
  await expect(badge).toBeVisible();
});

test("other members see View current game instead of Resume scoring", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Round 1", exact: true }),
  ).toBeVisible();
  const id = fixture.game().definition.id;
  fixture.shared.access[id].canScore = false;
  fixture.shared.access[id].scorerUserId = "another-member";
  await page.goto("/family");
  await expect(
    page.getByRole("button", { name: "View current game", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume scoring", exact: true }),
  ).toHaveCount(0);
});

test("guest Scrabble results offer a tie badge and work without native sharing", async ({
  page,
}) => {
  const { createGame } = await import("../../src/domain/game");
  const { testLexicon } = await import("../../src/lib/test-lexicon");
  const created = createGame({
    id: "badge-watch",
    players: [
      { id: "a", name: "Ada", seat: 0 },
      { id: "b", name: "Ben", seat: 2 },
    ],
    firstPlayerId: "a",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!created.ok) throw new Error(created.error.message);
  const { LETTER_COUNTS } = await import("../../src/domain/board");
  const game = {
    ...created.game,
    tileSupply: { ...LETTER_COUNTS, C: 3 },
    status: "finalized",
    result: {
      scores: { a: 100, b: 100 },
      winnerIds: ["a", "b"],
      reason: "natural",
      assisted: false,
      unequalTurns: false,
      scoresBeforeAdjustments: { a: 100, b: 100 },
      adjustments: { a: 0, b: 0 },
    },
  };
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "canShare", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.route("**/api/watch", (route) =>
    route.fulfill({ json: { game } }),
  );
  await page.route("**/api/watch/draft", (route) =>
    route.fulfill({ json: { draft: null } }),
  );
  let artworkUnavailable = true;
  await page.route("**/results/scrabble-victory.webp", (route) =>
    artworkUnavailable
      ? route.fulfill({ status: 503, body: "Temporarily unavailable" })
      : route.continue(),
  );
  await page.goto(`/watch#${"a".repeat(64)}`);
  await page.getByRole("button", { name: "Share result" }).click();
  const badge = page.getByRole("dialog", { name: "Well played!" });
  await expect(badge).toContainText("Ada");
  await expect(badge).toContainText("Ben");
  await expect(badge).toContainText("Nonstandard tile set");
  await expect(badge.getByRole("alert")).toContainText("Could not prepare");
  await expect(badge.getByRole("link", { name: "Save image" })).toHaveCount(0);
  artworkUnavailable = false;
  await badge.getByRole("button", { name: "Try again" }).click();
  await expect(badge.getByRole("link", { name: "Save image" })).toBeVisible();
  await expect(badge.getByRole("button", { name: "Share badge" })).toHaveCount(
    0,
  );
});
