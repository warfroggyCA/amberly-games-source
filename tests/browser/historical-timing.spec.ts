import { test, expect } from "@playwright/test";
import { hydrateGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { timingEvents } from "../../src/lib/turn-timing";
import fixture from "../fixtures/legacy-offset-clock.json" with { type: "json" };

test("historical clock uncertainty preserves the spectator board, scores and turns", async ({
  page,
}, testInfo) => {
  // This journal was captured under the historical engine. Hydrate the actual
  // fixture; do not synthesize impossible commands or rewrite its timestamps.
  const original = JSON.stringify(fixture);
  const loaded = hydrateGame(fixture, { ...testLexicon, id: "fixture" });
  if (!loaded.ok) throw new Error(loaded.error.message);
  expect(loaded.game.scores).toEqual({ a: 4, b: 0 });
  expect(loaded.game.turns).toEqual(fixture.turns);
  const game = {
    ...loaded.game,
    events: undefined,
    timingEvents: timingEvents(loaded.game),
    scorerGeneration: 1,
  };
  const methods: string[] = [];
  await page.route("**/api/watch", (route) => {
    methods.push(route.request().method());
    return route.fulfill({ json: { game } });
  });
  await page.route("**/api/watch/draft", (route) => {
    methods.push(route.request().method());
    return route.fulfill({
      json: { revision: game.revision, generation: 1, draft: null },
    });
  });
  await page.goto(`/watch#${"a".repeat(64)}`);
  await expect(
    page.getByRole("region", { name: "Live game viewer" }),
  ).toBeVisible();
  await expect(page.locator(".spectator-game-clock")).toContainText(
    "Timing unavailable",
  );
  await expect(
    page.locator(".spectator-game-clock .turn-clock"),
  ).toHaveAttribute(
    "title",
    "Timing unavailable: recorded timestamps are incomplete or inconsistent.",
  );
  await expect(page.getByLabel("Current turn elapsed time")).toHaveCount(0);
  await expect(page.getByLabel("Player accrued time")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /A, 4 points/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /B, 0 points, playing now/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /H8 A, 1 point.*View AT/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /I8 T, 1 point.*View AT/ }),
  ).toBeVisible();
  const noOverflow = async () => {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  };
  await noOverflow();
  await testInfo.attach("historical-clock-board", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: /^Scores\./ }).click();
  const dialog = page.getByRole("dialog", { name: "Scores", exact: true });
  await expect(dialog).toBeVisible();
  const statistics = dialog.getByRole("region", {
    name: "Turn timing statistics",
  });
  await expect(statistics).toContainText("Timing unavailable");
  await expect(statistics).toContainText(
    "Scores and recorded turns are unchanged.",
  );
  await expect(statistics.locator("table")).toHaveCount(0);
  await expect(dialog).not.toContainText(/NaN|61:00/);
  await dialog.getByText("Rounds and turn history", { exact: true }).click();
  await expect(dialog.locator(".spectator-history ol li")).toHaveCount(1);
  await expect(dialog.locator(".spectator-history ol li")).toHaveText(
    "A: AT (4) — 4 points",
  );
  await noOverflow();
  await testInfo.attach("historical-clock-scores", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(methods.length).toBeGreaterThan(0);
  expect(methods.every((method) => method === "GET")).toBe(true);
  expect(JSON.stringify(fixture)).toBe(original);
});
