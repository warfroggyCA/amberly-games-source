import { expect, test } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import type { LeadStandings } from "../../src/lib/lead-standings";
// Two eligible games: Doug/Erin (10 checkpoints) and Doug/Cristine (100).
// Doug/Nate is unavailable; Doug/Cristine has one further policy-excluded game.
const totals = (): LeadStandings => ({
  completedGames: 4,
  eligibleGames: 2,
  unavailableGames: 1,
  excludedGames: 1,
  pendingGames: 0,
  rows: [
    {
      playerId: "doug",
      completedGames: 4,
      eligibleGames: 2,
      eligibleTurns: 110,
      leads: 3,
      regains: 1,
      turnsLed: 65,
      tiedTurns: 2,
      longest: 32,
      average: 65 / 3,
      turnShare: 65 / 110,
    },
    {
      playerId: "erin",
      completedGames: 1,
      eligibleGames: 1,
      eligibleTurns: 10,
      leads: 1,
      regains: 0,
      turnsLed: 9,
      tiedTurns: 0,
      longest: 9,
      average: 9,
      turnShare: 0.9,
    },
    {
      playerId: "cristine",
      completedGames: 2,
      eligibleGames: 1,
      eligibleTurns: 100,
      leads: 1,
      regains: 0,
      turnsLed: 34,
      tiedTurns: 2,
      longest: 34,
      average: 34,
      turnShare: 0.34,
    },
    {
      playerId: "nate",
      completedGames: 1,
      eligibleGames: 0,
      eligibleTurns: 0,
      leads: 0,
      regains: 0,
      turnsLed: 0,
      tiedTurns: 0,
      longest: null,
      average: null,
      turnShare: null,
    },
  ],
});
async function setup(page: Parameters<typeof installFixture>[0]) {
  const fixture = await installFixture(page);
  let reads = 0,
    forbidden = false;
  await page.route("**/api/family/games?*", (route) => {
    if (new URL(route.request().url()).searchParams.has("leadCounts")) {
      reads++;
      expect(route.request().method()).toBe("GET");
      return forbidden
        ? route.fulfill({
            status: 403,
            json: { error: { message: "Family access changed." } },
          })
        : route.fulfill({
            json: { games: [], nextCursor: null, leadCounts: totals() },
          });
    }
    return route.fulfill({
      json: { games: [], nextCursor: null, standings: [] },
    });
  });
  await page.goto("/family/history");
  await page
    .locator("summary")
    .filter({ hasText: /^Scrabble lead rankings$/ })
    .click();
  return {
    ...fixture,
    reads: () => reads,
    deny: () => {
      forbidden = true;
    },
  };
}
test("lead rankings are sortable, coverage-aware and on-demand without extra polling", async ({
  page,
}, info) => {
  const fixture = await setup(page);
  expect(fixture.reads()).toBe(0);
  await page
    .getByRole("button", { name: "Load Scrabble lead rankings", exact: true })
    .click();
  const table = page.getByRole("region", {
    name: "Scrabble lead rankings table",
    exact: true,
  });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  await expect(rows.nth(0)).toContainText("21.7");
  await expect(rows.nth(0)).toContainText("2/4 games · 110 eligible turns");
  await expect(rows.last()).toContainText("No qualifying history");
  await expect(rows.last().locator("td").first()).toHaveText("—");
  await table.getByRole("button", { name: /^Turns led %/ }).click();
  await expect(rows.nth(0)).toContainText("Erin");
  await expect(rows.last()).toContainText("Nate");
  await table.getByRole("button", { name: /^Turns led %/ }).click();
  await expect(rows.nth(0)).toContainText("Cristine");
  await expect(rows.last()).toContainText("Nate");
  await page.waitForTimeout(5500);
  expect(fixture.reads()).toBe(1);
  await expect(table).toBeVisible();
  await table.getByRole("button", { name: /^Leads taken/ }).click();
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("lead-rankings.png"),
    fullPage: true,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(table).toHaveCount(0);
  expect(fixture.reads()).toBe(1);
});
test("observed removal and access changes discard totals; errors cannot retain stale rankings", async ({
  page,
}) => {
  const fixture = await setup(page);
  const load = page.getByRole("button", {
    name: "Load Scrabble lead rankings",
    exact: true,
  });
  const table = page.getByRole("region", {
    name: "Scrabble lead rankings table",
    exact: true,
  });
  await load.click();
  await expect(table).toBeVisible();
  fixture.family.removedGameIds = ["removed-game"];
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(table).toHaveCount(0);
  expect(fixture.reads()).toBe(1);
  await load.click();
  await expect(table).toBeVisible();
  fixture.deny();
  await page
    .getByRole("button", { name: "Refresh lead rankings", exact: true })
    .click();
  await expect(table).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Scrabble lead rankings", exact: true })
      .getByRole("alert"),
  ).toBeVisible();
});

test("pending verification stays explicit and continues only when requested", async ({
  page,
}) => {
  await setup(page);
  let reads = 0;
  await page.route("**/api/family/games?leadCounts=1", (route) => {
    reads++;
    const result = totals();
    if (reads === 1) {
      result.pendingGames = 1;
      result.unavailableGames = 0;
    }
    return route.fulfill({
      json: { games: [], nextCursor: null, leadCounts: result },
    });
  });
  await page
    .getByRole("button", { name: "Load Scrabble lead rankings", exact: true })
    .click();
  await expect(page.getByText(/Partial coverage:/)).toBeVisible();
  expect(reads).toBe(1);
  await page
    .getByRole("button", { name: "Verify more histories", exact: true })
    .click();
  await expect(page.getByText(/Partial coverage:/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh lead rankings", exact: true }),
  ).toBeVisible();
  expect(reads).toBe(2);
});
test("an in-flight response cannot restore counts after focus invalidation", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  let requested = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/family/games?leadCounts=1", async (route) => {
    requested = true;
    await held;
    await route.fulfill({
      json: { games: [], nextCursor: null, leadCounts: totals() },
    });
  });
  await page
    .getByRole("button", { name: "Load Scrabble lead rankings", exact: true })
    .click();
  await expect.poll(() => requested).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const response = page.waitForResponse((r) =>
    r.url().includes("leadCounts=1"),
  );
  release();
  await response;
  await expect(
    page.getByRole("button", {
      name: "Load Scrabble lead rankings",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Scrabble lead rankings table",
      exact: true,
    }),
  ).toHaveCount(0);
});
