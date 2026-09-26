import { test, expect } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import { createGame, applyCommand } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";

test("stale Scrabble entry stays visible and recoverable while other games work", async ({
  page,
}, info) => {
  const f = await installFixture(page);
  const made = createGame({
    id: "stale-scrabble",
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw Error(made.error.message);
  f.family.games.push(made.game);
  f.family.gameAccess[made.game.id] = {
    scorerUserId: f.family.member.userId,
    deviceId: "test-device",
    generation: 1,
    mode: "confirmed",
    recordsEligible: true,
    protests: [],
    canScore: true,
    approvals: [],
  };
  await page.route("**/api/family/draft*", (route) =>
    route.fulfill({
      json:
        route.request().method() === "POST"
          ? { accepted: true }
          : { draft: null },
    }),
  );
  await page.goto("/family");
  await page.getByRole("button", { name: "Resume game", exact: true }).click();
  const checkpointed = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/family/draft") &&
      request.method() === "POST" &&
      request.postDataJSON()?.placements?.length === 3,
  );
  await page.getByTestId("cell-H8").click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .pressSequentially("CAT");
  await expect(page.getByTestId("cell-J8")).toHaveAccessibleName(
    "J8 T, 1 points",
  );
  await checkpointed; // Live publication only observes the durable workspace snapshot.
  const changed = applyCommand(
    made.game,
    { type: "pass", id: "other-device-pass", expectedRevision: 0 },
    testLexicon,
  );
  if (!changed.ok) throw Error(changed.error.message);
  f.family.games[0] = changed.game;
  await page.reload();
  const recovery = page.getByRole("region", {
    name: "Retained Scrabble draft",
  });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole("list")).toContainText("C · row 8, column 8");
  await fitsWidth(page);
  await page.screenshot({
    path: info.outputPath("retained-draft-recovery.png"),
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await recovery.getByRole("button", { name: "Export retained entry" }).click();
  await (await download).saveAs(info.outputPath("retained-entry.json"));
  await page.goto("/family/crokinole/new");
  await expect(
    page.getByRole("heading", { name: "New Crokinole game" }),
  ).toBeVisible();
  await page.goto("/family/scrabble?view=play");
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Discard retained draft…" })
    .click();
  await page.getByRole("button", { name: "Keep draft", exact: true }).click();
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Discard retained draft…" })
    .click();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(recovery).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Type letters on the board" }),
  ).toBeAttached();
  expect(f.family.games[0].revision).toBe(1);
  expect(f.family.games[0].turns).toHaveLength(1);
  await page.reload();
  await expect(recovery).toHaveCount(0);
});

test("review: complete Scrabble scoring journey through final deductions and another game", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New preview game/ }).click();
  for (const name of ["Ada", "Ben"]) {
    await page.getByRole("textbox", { name: "Player name" }).fill(name);
    await page.getByRole("button", { name: "Add player", exact: true }).click();
  }
  await page.getByLabel("Who plays first?").selectOption({ label: "Ada" });
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByTestId("cell-H8").click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .pressSequentially("CAT");
  await page.getByRole("button", { name: "Review turn", exact: true }).click();
  await page
    .getByRole("button", { name: "Record 10 points", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await page.getByRole("button", { name: "End game", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue to ending review", exact: true })
    .click();
  await page.getByLabel("Ada remaining tiles", { exact: true }).fill("AAAAAAA");
  await page.getByLabel("Ben remaining tiles", { exact: true }).fill("EEEEEEE");
  await expect(
    page.getByRole("button", { name: "Confirm final results" }),
  ).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("scrabble-ending.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Confirm final results" }).click();
  const badge = page.getByRole("dialog", { name: "Well played!" });
  if (await badge.count())
    await badge.getByRole("button", { name: "Close dialog" }).click();
  await page.screenshot({
    path: info.outputPath("scrabble-final.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("heading", { name: "Final results", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "View last game", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Final results", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("scrabble-next-game.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("dialog", { name: "Set the table" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Who plays first?").locator("option:checked"),
  ).toHaveText("Ada");
  await expect(
    page.getByRole("button", { name: "Start game", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Final results", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("Ada").first()).toBeVisible();
  await expect(page.getByText("Ben").first()).toBeVisible();
  const rows = page.locator(".game-list-score");
  await expect(rows).toHaveCount(2);
  await expect(rows).toContainText(["0 / 0", "3 / -7"]);
});

for (const accessLost of [false, true]) {
  test(`Crokinole ${accessLost ? "membership loss" : "capability denial"} keeps local input and permits safe signout`, async ({
    page,
  }, info) => {
    const f = await installFixture(page);
    await page.goto("/family/crokinole/new");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await page
      .getByRole("button", { name: "Add Round 1", exact: true })
      .click();
    f.shared.access[f.game().definition.id].canScore = false;
    let denied = 0;
    await page.route("**/api/family/crokinole*", async (route) => {
      if (route.request().method() === "POST" || accessLost) {
        denied++;
        return route.fulfill({
          status: 403,
          json: {
            code: accessLost ? "MEMBERSHIP_REVOKED" : "PERMISSION_DENIED",
            error: accessLost
              ? "Family access was removed."
              : "Your permissions do not allow this action.",
          },
        });
      }
      await route.fallback();
    });
    await page.getByLabel("Doug round total", { exact: true }).fill("65");
    await expect.poll(() => denied).toBeGreaterThan(0);
    await expect(
      page.getByRole("button", { name: "Save round", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(
        accessLost ? "membership-recovery.png" : "capability-recovery.png",
      ),
      fullPage: true,
    });
    if (!accessLost) {
      await expect(
        page.getByRole("button", { name: "Retry saved action", exact: true }),
      ).toHaveCount(0);
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Add Round 1", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".crokinole-standing").first()).toBeVisible();
      await fitsWidth(page);
    }
    await page.getByRole("button", { name: "Open Amberly menu" }).click();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeEnabled();
    await page.route("**/api/auth/signout", (route) =>
      route.fulfill({ json: { ok: true } }),
    );
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: { configured: true, signInMethod: "google", user: null },
      }),
    );
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Continue with Google", exact: true }),
    ).toBeVisible();
  });
}
