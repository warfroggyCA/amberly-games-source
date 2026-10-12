import { expect, test, type Page } from "@playwright/test";
import { applyCommand, createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { installFixture } from "../browser/fixtures/crokinole";

async function setup(page: Page, scorer = true) {
  const f = await installFixture(page);
  const made = createGame({
    id: "word-buddy-game",
    wordBuddy: true,
    coaching: true,
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw Error(made.error.message);
  const started = applyCommand(
    made.game,
    {
      type: "start-clock",
      id: "clock",
      expectedRevision: 0,
      timedAt: new Date().toISOString(),
    },
    testLexicon,
  );
  if (!started.ok) throw Error(started.error.message);
  f.family.games = [started.game];
  f.family.gameAccess[made.game.id] = {
    scorerUserId: scorer ? f.family.member.userId : "other",
    deviceId: "test",
    generation: 1,
    mode: "confirmed",
    recordsEligible: false,
    protests: [],
    canScore: scorer,
    approvals: [],
  };
  const posts: unknown[] = [];
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url() + (r.postData() ?? "")));
  await page.route("**/api/family/draft*", (route) => {
    if (route.request().method() === "POST")
      posts.push(route.request().postDataJSON());
    return route.fulfill({
      json:
        route.request().method() === "POST"
          ? { accepted: true }
          : { draft: null },
    });
  });
  await page.goto("/family/scrabble");
  await page.locator(".game-list button").first().click();
  await expect(page.getByRole("grid")).toBeVisible();
  return { ...f, posts, requests };
}
async function letters(page: Page, word = "CAT") {
  await page.getByTestId("cell-H8").click();
  await page.locator(".board-input").fill(word);
}
test("coaching fallback preserves existing game and Word Buddy while hiding coaching", async ({
  page,
}) => {
  const f = await setup(page);
  await expect(
    page.getByRole("button", { name: "Post-turn coaching", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Test words", exact: true }),
  ).toBeVisible();
  await letters(page);
  await expect(page.locator(".square.fresh")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Review turn", exact: true }),
  ).toBeVisible();
  await expect.poll(() => f.posts.length).toBeGreaterThan(0);
  expect(f.family.games[0].definition.coaching).toBe(true);
  expect(f.family.games[0].definition.wordBuddy).toBe(true);
  const denied = await page.request.get(
    "/api/watch/coaching?turnId=old-client",
    { headers: { Authorization: `Bearer ${"a".repeat(64)}` } },
  );
  expect(denied.status()).toBe(404);
  expect(await denied.json()).not.toHaveProperty("position");
});
test("fallback setup hides coaching without hiding Word Buddy", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New preview game/ }).click();
  await page.getByLabel("Player name").fill("Ada");
  await page.getByRole("button", { name: "Add player", exact: true }).click();
  await page.getByLabel("Player name").fill("Ben");
  await page.getByRole("button", { name: "Add player", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /Post-turn coaching/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: /Word Buddy/ }),
  ).toBeVisible();
});
