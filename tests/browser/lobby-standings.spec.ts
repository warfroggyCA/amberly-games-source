import { expect, test } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import type { LeadStandings } from "../../src/lib/lead-standings";

async function setup(page: Parameters<typeof installFixture>[0]) {
  const fixture = await installFixture(page);
  await page.route("**/api/family/usage", (route) =>
    route.fulfill({ status: 204 }),
  );
  let leadReads = 0,
    denied = false;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/family") &&
      !request.url().includes("/api/family/usage") &&
      request.method() !== "GET"
    )
      writes.push(request.url());
  });
  const leads: LeadStandings = {
    completedGames: 1,
    eligibleGames: 1,
    unavailableGames: 0,
    excludedGames: 0,
    pendingGames: 0,
    rows: ["doug", "erin"].map((playerId, i) => ({
      playerId,
      completedGames: 1,
      eligibleGames: 1,
      eligibleTurns: 5,
      leads: i ? 0 : 1,
      regains: 0,
      turnsLed: i ? 0 : 5,
      tiedTurns: 0,
      longest: i ? null : 5,
      average: i ? null : 5,
      turnShare: i ? 0 : 1,
    })),
  };
  await page.route("**/api/family/games?*", (route) => {
    const lead = new URL(route.request().url()).searchParams.has("leadCounts");
    if (lead) leadReads++;
    if (denied)
      return route.fulfill({
        status: 403,
        json: { error: "Family access changed." },
      });
    return route.fulfill({
      json: {
        games: [],
        nextCursor: null,
        ...(lead
          ? { leadCounts: leads }
          : {
              standings: [
                {
                  playerId: "doug",
                  gameType: "scrabble",
                  played: 1,
                  wins: 1,
                  ties: 0,
                },
                {
                  playerId: "erin",
                  gameType: "scrabble",
                  played: 1,
                  wins: 0,
                  ties: 0,
                },
                {
                  playerId: "erin",
                  gameType: "crokinole",
                  played: 1,
                  wins: 1,
                  ties: 0,
                },
              ],
            }),
      },
    });
  });
  return {
    ...fixture,
    writes,
    leadReads: () => leadReads,
    deny: () => {
      denied = true;
    },
  };
}

test("lobby Standings buttons open the correct existing rankings in one tap without starting a game", async ({
  page,
}, info) => {
  const fixture = await setup(page);
  await page.goto("/family");
  for (const game of ["Scrabble", "Crokinole"]) {
    const panel = page.getByRole("region", { name: game, exact: true });
    const button = panel.getByRole("button", {
      name: `Standings for ${game}`,
      exact: true,
    });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("lobby-standings.png"),
    fullPage: true,
  });
  expect(fixture.leadReads()).toBe(0);
  // An accidental card-level click handler must never receive this action.
  await page
    .getByRole("region", { name: "Scrabble", exact: true })
    .evaluate((element) => {
      element.addEventListener("click", () => {
        document.documentElement.dataset.panelClick = "bubbled";
      });
    });
  await page
    .getByRole("button", { name: "Standings for Scrabble", exact: true })
    .click();
  await expect(page).toHaveURL(/\/family\/history\?standings=scrabble$/);
  await expect(
    page.getByRole("heading", { name: "Scrabble standings", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("region", { name: "Scrabble standings table", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Scrabble lead rankings table",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-panel-click",
    "bubbled",
  );
  expect(fixture.leadReads()).toBe(1);
  await page.waitForTimeout(5500);
  expect(fixture.leadReads()).toBe(1);
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("scrabble-standings.png"),
    fullPage: true,
  });
  await page.goBack();
  await expect(page).toHaveURL(/\/family$/);
  const crokinole = page.getByRole("button", {
    name: "Standings for Crokinole",
    exact: true,
  });
  await crokinole.focus();
  await expect(crokinole).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Crokinole standings", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("region", {
      name: "Crokinole standings table",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Scrabble lead rankings", exact: true }),
  ).toHaveCount(0);
  expect(fixture.leadReads()).toBe(1);
  await page
    .getByRole("button", { name: "Back to games", exact: true })
    .click();
  await expect(page).toHaveURL(/\/family$/);
  expect(fixture.writes).toEqual([]);
});

test("read-only members can open standings and invalidation never automatically reloads lead history", async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.family.member.role = "member";
  fixture.family.member.permissions = {
    startGames: false,
    scoreGames: false,
    addPlayers: false,
    manageEquipment: false,
    resolveConcerns: false,
  };
  await page.goto("/family");
  await expect(
    page
      .getByRole("region", { name: "Scrabble", exact: true })
      .getByRole("button", { name: "Start game", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Standings for Scrabble", exact: true })
    .focus();
  await page.keyboard.press("Space");
  const table = page.getByRole("region", {
    name: "Scrabble lead rankings table",
    exact: true,
  });
  await expect(table).toBeVisible();
  fixture.family.removedGameIds = ["older-removed-game"];
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(table).toHaveCount(0);
  await page.waitForTimeout(5500);
  expect(fixture.leadReads()).toBe(1);
  fixture.family.member.role = "superadmin";
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(5500);
  expect(fixture.leadReads()).toBe(1);
  await expect(table).toHaveCount(0);
  fixture.deny();
  await page
    .getByRole("button", { name: "Load Scrabble lead rankings", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Scrabble lead rankings", exact: true })
      .getByRole("alert"),
  ).toBeVisible();
  await expect(table).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});

test("direct standings links retain access errors without fabricated rankings", async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.deny();
  await page.goto("/family/history?standings=scrabble");
  await expect(
    page.getByRole("heading", { name: "Scrabble standings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: /standings table|lead rankings table/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: "Family access changed." }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Back to games", exact: true })
    .click();
  await expect(page).toHaveURL(/\/family$/);
  expect(fixture.writes).toEqual([]);
});
