import { expect, test } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import type { LeadStandings } from "../../src/lib/lead-standings";
const totals = (): LeadStandings => ({
  completedGames: 4,
  eligibleGames: 2,
  unavailableGames: 1,
  excludedGames: 1,
  rows: [
    {
      playerId: "doug",
      completedGames: 4,
      eligibleGames: 2,
      eligibleTurns: 110,
      leads: 3,
      regains: 1,
      turnsLed: 98,
      tiedTurns: 1,
      longest: 90,
      average: 98 / 3,
      turnShare: 98 / 110,
    },
    {
      playerId: "erin",
      completedGames: 1,
      eligibleGames: 1,
      eligibleTurns: 10,
      leads: 1,
      regains: 0,
      turnsLed: 9,
      tiedTurns: 1,
      longest: 9,
      average: 9,
      turnShare: 0.9,
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
  await expect(rows.nth(0)).toContainText("32.7");
  await expect(rows.nth(0)).toContainText("2/4 games · 110 eligible turns");
  await expect(rows.nth(2)).toContainText("No qualifying history");
  await expect(rows.nth(2).locator("td").first()).toHaveText("—");
  await table.getByRole("button", { name: /^Turns led %/ }).click();
  await expect(rows.nth(0)).toContainText("Erin");
  await expect(rows.nth(2)).toContainText("Nate");
  await table.getByRole("button", { name: /^Turns led %/ }).click();
  await expect(rows.nth(0)).toContainText("Doug");
  await expect(rows.nth(2)).toContainText("Nate");
  await page.waitForTimeout(5500);
  expect(fixture.reads()).toBe(1);
  await expect(table).toBeVisible();
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
