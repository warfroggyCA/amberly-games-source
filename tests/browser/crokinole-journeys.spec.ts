import { expect, test, type Page } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";

async function enterRound(
  page: Page,
  round: number,
  names: string[],
  values: number[],
) {
  await page
    .getByRole("button", { name: `Add Round ${round}`, exact: true })
    .click();
  for (const [i, name] of names.entries())
    await page
      .getByLabel(`${name} round total`, { exact: true })
      .fill(String(values[i]));
  await page.getByRole("button", { name: "Save round", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save round", exact: true }),
  ).toHaveCount(0);
}

test("doubles NCA awards points, preserves names and rotates the rematch starter", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Game options" }).click();
  await page
    .getByRole("combobox", { name: "Scoring", exact: true })
    .selectOption("nca_match_points");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const names = ["Doug & Nate", "Erin & Cristine"];
  for (let round = 1; round <= 4; round++)
    await enterRound(page, round, names, round === 2 ? [40, 40] : [65, 40]);
  await expect(
    page.getByRole("heading", { name: "Doug & Nate wins", exact: true }),
  ).toBeVisible();
  expect(Object.values(fixture.game().totals)).toEqual([7, 1]);
  const previous = fixture.game().definition;
  // Hold the next background refresh while the scorer starts a rematch.
  let releaseRead!: () => void;
  let readStarted!: () => void;
  const heldRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const startedRead = new Promise<void>((resolve) => {
    readStarted = resolve;
  });
  await page.route("**/api/family/crokinole*", async (route) => {
    if (route.request().method() === "GET") {
      readStarted();
      await heldRead;
    }
    await route.fallback();
  });
  await startedRead;
  await page.getByRole("button", { name: "Rematch", exact: true }).click();
  releaseRead();
  await expect(
    page.getByRole("button", { name: "Add Round 1", exact: true }),
  ).toBeVisible();
  expect(fixture.game().definition.participants).toEqual(previous.participants);
  expect(fixture.game().definition.scoringMode).toBe("nca_match_points");
  expect(fixture.game().definition.initialStartingPlayerId).not.toBe(
    previous.initialStartingPlayerId,
  );
  expect(fixture.shared.games).toHaveLength(2);
});

test("four individual players resume an unfinished target round after reload", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await page.getByRole("button", { name: "Individual", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Game options" }).click();
  await page
    .getByRole("combobox", { name: "Match length", exact: true })
    .selectOption("target");
  await page.getByLabel("Target", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const names = ["Doug", "Erin", "Nate", "Cristine"];
  await enterRound(page, 1, names, [60, 50, 40, 30]);
  await page.getByRole("button", { name: "Add Round 2", exact: true }).click();
  await page.getByLabel("Doug round total", { exact: true }).fill("50");
  await page
    .getByRole("button", { name: "Keep draft & close", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Continue entry", exact: true })
    .click();
  await expect(
    page.getByLabel("Doug round total", { exact: true }),
  ).toHaveValue("50");
  for (const name of names.slice(1))
    await page.getByLabel(`${name} round total`, { exact: true }).fill("40");
  await page.getByRole("button", { name: "Save round", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Doug wins", exact: true }),
  ).toBeVisible();
  expect(fixture.game().totals).toEqual({
    doug: 110,
    erin: 90,
    nate: 80,
    cristine: 70,
  });
  await fitsWidth(page);
});

test("long cumulative score sheet retains early rounds and latest totals", async ({
  page,
}, testInfo) => {
  const fixture = await installFixture(page);
  await page.goto("/family/crokinole/new");
  await page.locator("summary").filter({ hasText: "Game options" }).click();
  await page.getByRole("spinbutton", { name: "Rounds", exact: true }).fill("8");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  for (let round = 1; round <= 8; round++)
    await enterRound(page, round, ["Doug", "Erin"], [25, 20]);
  await expect(
    page.getByRole("heading", { name: "Doug wins", exact: true }),
  ).toBeVisible();
  expect(fixture.game().totals).toEqual({ doug: 200, erin: 160 });
  const matrix = page.getByRole("button", {
    name: "Review round 1",
    exact: true,
  });
  if (await matrix.isVisible()) await matrix.click();
  else
    await page
      .locator(".crokinole-round")
      .filter({ hasText: "Round 1" })
      .click();
  await expect(page.getByRole("dialog")).toContainText("Round 1");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await fitsWidth(page);
  await page.screenshot({
    path: testInfo.outputPath("crokinole-eight-rounds.png"),
    fullPage: false,
  });
});

test("shared hub opens history, existing people and equipment without replacing a game", async ({
  page,
}, testInfo) => {
  const fixture = await installFixture(page);
  await page.route("**/api/family/games?*", (route) =>
    route.fulfill({
      json: {
        games: fixture.shared.games.map((g) => ({
          gameType: "crokinole",
          id: g.definition.id,
          createdAt: g.definition.createdAt,
          status: g.status,
          participants: g.definition.participants,
          totals: g.totals,
          winnerIds: g.result?.winnerIds ?? [],
          mode: g.definition.mode,
          scorerUserId: fixture.shared.access[g.definition.id].scorerUserId,
          revision: g.revision,
        })),
        nextCursor: null,
      },
    }),
  );
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Round 1", exact: true }),
  ).toBeVisible();
  const id = fixture.game().definition.id;
  await page
    .getByRole("link", { name: "Amberly Games — Home", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "What are we playing?", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("amberly-games-hub.png"),
    fullPage: false,
  });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Game history", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Doug vs Erin/ }).click();
  await expect(page).toHaveURL(new RegExp(`/family/crokinole/${id}$`));
  await page
    .getByRole("link", { name: "Amberly Games — Home", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Players", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Players|Your people/i }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: /Amberly Games.*Home/i }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Crokinole piece colours", exact: true }),
  ).toBeVisible();
  expect(fixture.shared.games).toHaveLength(1);
});

test("unreadable local Crokinole workspace requires confirmation and preserves the original", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto("/");
  const key =
    "22222222-2222-4222-8222-222222222222:11111111-1111-4111-8111-111111111111";
  await page.evaluate(async (key) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("amberly-crokinole-workspaces", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("workspaces");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("workspaces", "readwrite");
        tx.objectStore("workspaces").put(
          {
            owner: "old",
            workspace: { version: 999, retained: "unreadable-original" },
          },
          key,
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
    });
  }, key);
  await page.goto("/family/crokinole/new");
  await page
    .getByRole("button", {
      name: "Recover this device’s workspace",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Recover this device’s workspace",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Recover this device’s workspace",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Preserve copy and recover", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "New Crokinole game", exact: true }),
  ).toBeVisible();
  expect(fixture.shared.games).toHaveLength(0);
  const rows = await page.evaluate(
    async () =>
      new Promise<unknown[]>((resolve, reject) => {
        const req = indexedDB.open("amberly-crokinole-workspaces", 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("workspaces", "readonly");
          const get = tx.objectStore("workspaces").getAll();
          get.onsuccess = () => resolve(get.result);
          tx.oncomplete = () => db.close();
        };
        req.onerror = () => reject(req.error);
      }),
  );
  expect(JSON.stringify(rows)).toContain("unreadable-original");
});
