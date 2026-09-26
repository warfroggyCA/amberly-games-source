import { expect, test } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";

test("family standings combine games, share ranks and sort by nicknames and win rate", async ({
  page,
}, info) => {
  const fixture = await installFixture(page);
  fixture.family.players[0].nickname = "Froggy";
  fixture.family.players[1].nickname = "Zebra";
  fixture.family.players[2].nickname = "Aardvark";
  await page.route("**/api/family/games?*", (route) =>
    route.fulfill({
      json: {
        games: [],
        nextCursor: null,
        standings: [
          {
            playerId: "doug",
            gameType: "scrabble",
            played: 4,
            wins: 2,
            ties: 1,
          },
          {
            playerId: "doug",
            gameType: "crokinole",
            played: 6,
            wins: 2,
            ties: 0,
          },
          {
            playerId: "erin",
            gameType: "scrabble",
            played: 5,
            wins: 4,
            ties: 1,
          },
          {
            playerId: "nate",
            gameType: "crokinole",
            played: 4,
            wins: 1,
            ties: 1,
          },
        ],
      },
    }),
  );
  await page.goto("/family/history");
  await page
    .getByText("Family standings · wins & ranks", { exact: true })
    .click();
  const standings = page.locator(".family-standings");
  const views = standings.getByRole("group", { name: "Standings game" });
  await expect(
    views.getByRole("button", { name: "Overall", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const overall = standings.getByRole("region", {
    name: "Overall standings table",
  });
  const rows = overall.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator("th")).toContainText("Froggy");
  await expect(rows.nth(1).locator("th")).toContainText("Zebra");
  await expect(rows.nth(0).locator("td")).toHaveText([
    "1",
    "10",
    "4",
    "1",
    "40.0%",
  ]);
  await expect(rows.nth(1).locator("td")).toHaveText([
    "1",
    "5",
    "4",
    "1",
    "80.0%",
  ]);
  await expect(rows.nth(2).locator("td")).toHaveText([
    "3",
    "4",
    "1",
    "1",
    "25.0%",
  ]);
  await expect(rows.nth(0).locator(".standings-breakdown")).toHaveText(
    "Scrabble: 2 wins / 4 played · Crokinole: 2 wins / 6 played",
  );
  // Real-name order is Doug, Erin, Nate; nickname order must be Aardvark, Froggy, Zebra.
  await overall.getByRole("button", { name: /^Player / }).click();
  await expect(
    overall.getByRole("columnheader", { name: /^Player / }),
  ).toHaveAttribute("aria-sort", "ascending");
  await expect(rows.nth(0).locator("th")).toContainText("Aardvark");
  await expect(rows.nth(1).locator("th")).toContainText("Froggy");
  await expect(rows.nth(2).locator("th")).toContainText("Zebra");
  await overall.getByRole("button", { name: /^Win % / }).click();
  await expect(
    overall.getByRole("columnheader", { name: /^Win % / }),
  ).toHaveAttribute("aria-sort", "descending");
  await expect(rows.nth(0).locator("th")).toContainText("Zebra");
  await expect(rows.nth(0).locator("td").first()).toHaveText("1");

  await views.getByRole("button", { name: "Scrabble", exact: true }).click();
  const scrabble = standings.getByRole("region", {
    name: "Scrabble standings table",
  });
  await expect(scrabble.locator("tbody tr")).toHaveCount(2);
  await expect(scrabble.locator("tbody tr").nth(1).locator("td")).toHaveText([
    "2",
    "4",
    "2",
    "1",
    "50.0%",
  ]);
  await views.getByRole("button", { name: "Crokinole", exact: true }).click();
  const crokinole = standings.getByRole("region", {
    name: "Crokinole standings table",
  });
  await expect(crokinole.locator("tbody tr")).toHaveCount(2);
  await expect(crokinole.locator("tbody tr").first().locator("td")).toHaveText([
    "1",
    "6",
    "2",
    "0",
    "33.3%",
  ]);
  await views.getByRole("button", { name: "Overall", exact: true }).click();
  await overall.getByRole("button", { name: /^Rank / }).click();
  await expect(rows.locator("td:first-child")).toHaveText(["1", "1", "3"]);
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("family-overall-standings.png"),
  });
});
