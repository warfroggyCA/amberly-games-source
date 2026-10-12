import { expect, test, type Page } from "@playwright/test";
import { applyCommand, createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { installFixture } from "./fixtures/crokinole";

async function setup(page: Page, scorer = true) {
  const f = await installFixture(page);
  const made = createGame({
    id: "word-buddy-game",
    wordBuddy: true,
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
test("private tiles never persist or publish; toggle clears; explicit promotion only shares a draft", async ({
  page,
}, info) => {
  const f = await setup(page);
  await page.getByRole("button", { name: "Test words", exact: true }).click();
  await letters(page);
  await expect(page.locator(".word-buddy-private .square.fresh")).toHaveCount(
    3,
  );
  await expect(page.locator(".word-buddy-private-label")).toBeVisible();
  const board = await page.getByRole("grid").boundingBox();
  expect(board!.width).toBeGreaterThanOrEqual(190);
  await page.screenshot({ path: info.outputPath("word-buddy-private.png") });
  await page.waitForTimeout(700);
  expect(f.posts).toHaveLength(0);
  await page.getByRole("button", { name: "Score game", exact: true }).click();
  await expect(page.locator(".square.fresh")).toHaveCount(0);
  await page.getByRole("button", { name: "Test words", exact: true }).click();
  await letters(page);
  await page
    .getByRole("button", { name: "Use this play", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Share test play" }),
  ).toContainText("Everyone will see");
  expect(f.posts).toHaveLength(0);
  await page
    .getByRole("button", { name: "Share as live draft", exact: true })
    .click();
  await expect
    .poll(() =>
      f.posts.some(
        (x) => (x as { placements?: unknown[] }).placements?.length === 3,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Review turn", exact: true }),
  ).toBeVisible();
  expect(f.requests.some((x) => x.includes('"type":"play"'))).toBe(false);
});
test("private checker is unlimited and does not send or store tentative words for a viewer", async ({
  page,
}) => {
  const f = await setup(page, false);
  await page.getByRole("button", { name: "Word Buddy · Check a word" }).click();
  await page
    .getByRole("textbox", { name: "Private word check" })
    .fill("QQBUDDYSECRET");
  await expect(
    page.getByRole("status").filter({ hasText: "Not in this game" }),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  expect(f.requests.some((x) => x.includes("QQBUDDYSECRET"))).toBe(false);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("QQBUDDYSECRET");
  await expect(
    page.getByRole("button", { name: "Use this play", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "Private word check" }).fill("CAT");
  await expect(
    page.getByRole("status").filter({ hasText: "Yes — accepted" }),
  ).toBeVisible();
});
test("parked live draft stays held across reload until explicit Resume", async ({
  page,
}) => {
  const f = await setup(page);
  await letters(page);
  await expect.poll(() => f.posts.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Test words", exact: true }).click();
  await expect(
    page.getByText("Your scoring draft is preserved.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume live draft" }),
  ).toBeVisible();
  const count = f.posts.length;
  await page.waitForTimeout(800);
  expect(f.posts).toHaveLength(count);
  await page.getByRole("button", { name: "Resume live draft" }).click();
  await expect.poll(() => f.posts.length).toBeGreaterThan(count);
});

async function failRecoveryStorage(page: Page, fail: boolean) {
  await page.evaluate((fail) => {
    const w = window as typeof window & {
      buddyStorageOriginal?: typeof Storage.prototype.setItem;
    };
    w.buddyStorageOriginal ??= Storage.prototype.setItem;
    Storage.prototype.setItem = fail
      ? function (this: Storage, key, value) {
          if (key === "amberly.word-buddy-sharing-holds.v1")
            throw new DOMException("Unavailable", "QuotaExceededError");
          return w.buddyStorageOriginal!.call(this, key, value);
        }
      : w.buddyStorageOriginal;
  }, fail);
}
for (const promote of [false, true])
  test(`storage failure keeps ${promote ? "promoted" : "parked"} draft held and Resume retryable`, async ({
    page,
  }) => {
    const f = await setup(page);
    if (!promote) await letters(page);
    await page.getByRole("button", { name: "Test words", exact: true }).click();
    if (promote) {
      await letters(page);
      await page
        .getByRole("button", { name: "Use this play", exact: true })
        .click();
      await failRecoveryStorage(page, true);
      await page
        .getByRole("button", { name: "Share as live draft", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Score game", exact: true })
        .click();
      await failRecoveryStorage(page, true);
      await page.getByRole("button", { name: "Resume live draft" }).click();
    }
    await expect(
      page.getByRole("alert").filter({ hasText: /sharing is still paused/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resume live draft" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review turn", exact: true }),
    ).toHaveCount(0);
    const count = f.posts.length;
    await page.waitForTimeout(800);
    expect(f.posts).toHaveLength(count);
    await failRecoveryStorage(page, false);
    await page.getByRole("button", { name: "Resume live draft" }).click();
    await expect.poll(() => f.posts.length).toBeGreaterThan(count);
    expect(f.requests.some((x) => x.includes('"type":"play"'))).toBe(false);
  });

test("unavailable recovery reads after reload keep sharing paused", async ({
  page,
}) => {
  const f = await setup(page);
  await letters(page);
  await expect.poll(() => f.posts.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Test words", exact: true }).click();
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === "amberly.word-buddy-sharing-holds.v1")
        throw new DOMException("Unavailable", "SecurityError");
      return get.call(this, key);
    };
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume live draft" }),
  ).toBeVisible();
  const count = f.posts.length;
  await page.waitForTimeout(800);
  expect(f.posts).toHaveLength(count);
  await page.getByRole("button", { name: "Resume live draft" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /sharing is still paused/i }),
  ).toBeVisible();
});
