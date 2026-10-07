import { expect, test, type Page } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import { replayFixture } from "../fixtures/replay";

async function setup(page: Page, canScore = false) {
  const fixture = await installFixture(page);
  const game = structuredClone(replayFixture().game);
  fixture.family.gameAccess[game.id] = {
    scorerUserId: fixture.family.member.userId,
    deviceId: "fixture",
    generation: 1,
    mode: "confirmed",
    recordsEligible: false,
    protests: [],
    canScore,
    approvals: [],
  };
  let available = true;
  const reads: string[] = [],
    writes: string[] = [];
  await page.route(/\/api\/family(?:\?.*)?$/, (route) => {
    const id = new URL(route.request().url()).searchParams.get("gameId");
    if (id) reads.push(id);
    return route.fulfill({
      json: {
        ...fixture.family,
        games: available && id === game.id ? [game] : [],
      },
    });
  });
  await page.route("**/api/family/games?*", (route) =>
    route.fulfill({
      json: {
        games: [
          ...Array.from({ length: 12 }, (_, i) => ({
            gameType: "crokinole",
            id: `other-${i}`,
            createdAt: game.definition.createdAt,
            status: "completed",
            participants: game.players,
            totals: { doug: 2, erin: 0 },
            winnerIds: ["doug"],
            mode: "confirmed",
            scorerUserId: fixture.family.member.userId,
            revision: 0,
          })),
          {
            gameType: "scrabble",
            id: game.id,
            createdAt: game.definition.createdAt,
            status: game.status,
            participants: game.players,
            totals: game.result!.scores,
            winnerIds: game.result!.winnerIds,
            mode: "confirmed",
            scorerUserId: fixture.family.member.userId,
            revision: game.revision,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  page.on("request", (request) => {
    if (
      /\/api\/family(?:\/draft)?(?:\?|$)/.test(request.url()) &&
      request.method() !== "GET"
    )
      writes.push(request.url());
  });
  return {
    ...fixture,
    game,
    reads,
    writes,
    remove: () => {
      available = false;
    },
  };
}

test("main History replays an unhydrated Scrabble result and restores filters, focus and scroll without writes", async ({
  page,
}, info) => {
  const fixture = await setup(page);
  await page.goto("/family/history");
  await page
    .getByRole("combobox", { name: "Player", exact: true })
    .selectOption("doug");
  const replay = page.getByRole("button", { name: /^Replay Doug and Erin/ });
  await expect(replay).toHaveCount(1);
  await replay.scrollIntoViewIfNeeded();
  await replay.focus();
  const y = await page.evaluate(() => window.scrollY);
  await page.screenshot({
    path: info.outputPath("main-history-replay-entry.png"),
    fullPage: true,
  });
  await replay.press("Enter");
  await expect(
    page.getByRole("region", { name: "Recorded game replay" }),
  ).toBeVisible();
  expect(fixture.reads).toContain(fixture.game.id);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("slider")).toHaveValue("1");
  const board = await page.locator(".game-replay .board-grid").boundingBox();
  expect(board!.width).toBeGreaterThanOrEqual(200);
  expect(board!.height).toBeGreaterThanOrEqual(200);
  await page.screenshot({
    path: info.outputPath("main-history-replay-viewer.png"),
    fullPage: true,
  });
  await fitsWidth(page);
  await page.getByRole("button", { name: "Close replay", exact: true }).click();
  await expect(page).toHaveURL(/\/family\/history$/);
  await expect(
    page.getByRole("combobox", { name: "Player", exact: true }),
  ).toHaveValue("doug");
  await expect(replay).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeCloseTo(y, 0);
  expect(fixture.writes).toEqual([]);
});

test("lead counts describe corrected turns, stay stable while seeking and support keyboard disclosure without writes", async ({
  page,
}, info) => {
  const fixture = await setup(page);
  await page.goto("/family/history");
  await page.getByRole("button", { name: /^Replay Doug and Erin/ }).click();
  const disclosure = page
    .locator("summary")
    .filter({ hasText: /^Lead counts$/ });
  await disclosure.focus();
  await disclosure.press("Enter");
  const counts = page.getByRole("region", { name: "Lead counts", exact: true });
  await expect(counts).toBeVisible();
  await expect(
    counts.getByRole("heading", { name: "Completed game · 3 turns" }),
  ).toBeVisible();
  await expect(counts).toContainText("including passes and exchanges");
  await expect(counts).toContainText("not full rounds or time");
  await expect(
    counts.getByRole("list", { name: "Doug lead spells" }),
  ).toContainText("Turns 1–3 · 3 turns");
  await expect(
    counts.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Erin", exact: true }),
    }),
  ).toContainText("No sole-lead spells.");
  const original = await counts.innerText();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("slider")).toHaveValue("1");
  expect(await counts.innerText()).toBe(original);
  await fitsWidth(page);
  const viewport = page.viewportSize();
  if (
    viewport &&
    viewport.width >= 601 &&
    viewport.width <= 899 &&
    viewport.height >= 551
  ) {
    const board = await page.locator(".game-replay .board-grid").boundingBox();
    expect(board!.width).toBeGreaterThanOrEqual(320);
  }
  await page.screenshot({
    path: info.outputPath("lead-counts.png"),
    fullPage: true,
  });
  await disclosure.focus();
  await disclosure.press("Space");
  await expect(counts).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Close replay" }),
  ).toBeVisible();
  expect(fixture.writes).toEqual([]);
  fixture.remove();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByText(/This game is unavailable/)).toBeVisible();
  await expect(disclosure).toHaveCount(0);
});

for (const canScore of [false, true])
  test(`opened final result offers Replay and returns to the same result (scorer: ${canScore})`, async ({
    page,
  }, info) => {
    const fixture = await setup(page, canScore);
    await page.goto("/family/history");
    await page
      .locator(".hub-recent-game")
      .filter({ hasText: "scrabble" })
      .click();
    const back = page.getByRole("button", { name: "Back to history" });
    await expect(back).toBeVisible();
    const replay = page.getByRole("button", { name: "Replay", exact: true });
    await expect(replay).toBeVisible();
    await page.screenshot({
      path: info.outputPath("opened-result-replay-entry.png"),
    });
    await replay.focus();
    await replay.press("Enter");
    await expect(
      page.getByRole("region", { name: "Recorded game replay" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page
      .getByRole("button", { name: "Close replay", exact: true })
      .last()
      .click();
    await expect(back).toBeVisible();
    await expect(replay).toBeFocused();
    await fitsWidth(page);
    await back.click();
    await expect(page).toHaveURL(/\/family\/history$/);
    expect(fixture.writes).toEqual([]);
  });

test("removed replay snapshots disappear and direct links recover to History", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.goto(`/family/history?replay=${fixture.game.id}`);
  await expect(
    page.getByRole("region", { name: "Recorded game replay" }),
  ).toBeVisible();
  fixture.remove();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "unavailable" }),
  ).toContainText("unavailable");
  await expect(
    page.getByRole("region", { name: "Recorded game replay" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to history" }).click();
  await expect(page).toHaveURL(/\/family\/history$/);
  expect(fixture.writes).toEqual([]);
});

test("incomplete journals show a limitation instead of an invented replay", async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.game.events = [];
  await page.goto(`/family/history?replay=${fixture.game.id}`);
  await expect(page.getByText(/Replay unavailable: this record/)).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: /^Lead counts$/ })
    .click();
  await expect(
    page.getByRole("region", { name: "Lead counts", exact: true }),
  ).toContainText("Lead counts unavailable");
  await expect(page.getByRole("slider")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});

test("inaccessible games have no replay board", async ({ page }) => {
  const fixture = await setup(page);
  await page.route(/\/api\/family\?gameId=/, (route) =>
    route.fulfill({ status: 403, json: { error: "Not allowed" } }),
  );
  await page.goto(`/family/history?replay=${fixture.game.id}`);
  await expect(
    page.getByRole("alert").filter({ hasText: "unavailable" }),
  ).toContainText("unavailable");
  await expect(
    page.getByRole("region", { name: "Recorded game replay" }),
  ).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  await expect(
    page.locator("summary").filter({ hasText: /^Lead counts$/ }),
  ).toHaveCount(0);
});

test("a member cannot replay a private practice snapshot", async ({ page }) => {
  const fixture = await setup(page);
  fixture.family.member.role = "member";
  fixture.family.gameAccess[fixture.game.id].mode = "practice";
  await page.goto(`/family/history?replay=${fixture.game.id}`);
  await expect(
    page.getByRole("alert").filter({ hasText: "unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Recorded game replay" }),
  ).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  await expect(
    page.locator("summary").filter({ hasText: /^Lead counts$/ }),
  ).toHaveCount(0);
});
