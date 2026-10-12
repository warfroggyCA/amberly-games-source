import { expect, test, type Page, type Route } from "@playwright/test";
import { applyCommand, createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { installFixture } from "./fixtures/crokinole";

async function setup(page: Page) {
  const f = await installFixture(page);
  const created = createGame({
    id: "buddy-independent",
    wordBuddy: true,
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!created.ok) throw Error(created.error.message);
  const started = applyCommand(
    created.game,
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
  f.family.gameAccess[started.game.id] = {
    scorerUserId: f.family.member.userId,
    deviceId: "test",
    generation: 1,
    mode: "confirmed",
    recordsEligible: false,
    protests: [],
    canScore: true,
    approvals: [],
  };
  const posts: { kind: string; sequence: number; placements: unknown[] }[] = [];
  const requests: string[] = [];
  let delayed: Route | undefined;
  let delayNext = false;
  page.on("request", (r) => requests.push(r.url() + (r.postData() ?? "")));
  await page.route("**/api/family/draft*", async (route) => {
    if (route.request().method() !== "POST")
      return route.fulfill({ json: { draft: null } });
    const body = route.request().postDataJSON();
    posts.push(body);
    if (delayNext && body.placements.length) {
      delayNext = false;
      delayed = route;
      return;
    }
    await route.fulfill({ json: { accepted: true } });
  });
  await page.goto("/family/scrabble");
  await page.locator(".game-list button").first().click();
  await expect(page.getByRole("grid")).toBeVisible();
  return {
    ...f,
    posts,
    requests,
    delay: () => {
      delayNext = true;
    },
    release: async () => {
      expect(delayed).toBeDefined();
      await delayed!.fulfill({ json: { accepted: true } });
    },
  };
}
async function enter(page: Page, word = "CAT") {
  await page.getByTestId("cell-H8").click();
  await page.locator(".board-input").fill(word);
}
async function confirmation(page: Page) {
  await page.getByRole("button", { name: "Test words", exact: true }).click();
  await enter(page);
  await page
    .getByRole("button", { name: "Use this play", exact: true })
    .click();
}

test("independent: private board letters never enter persistence or requests", async ({
  page,
}) => {
  const f = await setup(page);
  await page.evaluate(() => {
    const w = window as typeof window & { buddyWrites: string[] };
    w.buddyWrites = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      w.buddyWrites.push(JSON.stringify(args[0]));
      return put.apply(this, args);
    };
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      w.buddyWrites.push(JSON.stringify(args[0]));
      return add.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Test words", exact: true }).click();
  await enter(page, "QAT");
  await expect(page.locator(".word-buddy-private .square.fresh")).toHaveCount(
    3,
  );
  await page.waitForTimeout(1300);
  expect(f.posts).toHaveLength(0);
  expect(f.requests.join("\n")).not.toContain('"letter":"Q"');
  const persisted = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      idb: (window as typeof window & { buddyWrites: string[] }).buddyWrites,
    }),
  );
  expect(persisted).not.toContain('\\"letter\\":\\"Q\\"');
  expect(persisted).not.toContain("QAT");
  await page.getByRole("button", { name: "Score game", exact: true }).click();
  await expect(page.locator(".square.fresh")).toHaveCount(0);
});

test("independent: late publication response cannot restart a held live draft", async ({
  page,
}) => {
  const f = await setup(page);
  f.delay();
  await enter(page);
  await expect.poll(() => f.posts.length).toBe(1);
  await page.getByRole("button", { name: "Test words", exact: true }).click();
  await expect.poll(() => f.posts.some((p) => p.kind === "clear")).toBe(true);
  const edit = f.posts[0];
  const clear = f.posts.find((p) => p.kind === "clear")!;
  expect(clear.sequence).toBeGreaterThan(edit.sequence);
  await enter(page, "QAT");
  await f.release();
  const count = f.posts.length;
  await page.waitForTimeout(4300);
  expect(f.posts).toHaveLength(count);
  expect(f.requests.join("\n")).not.toContain('"letter":"Q"');
});

for (const change of ["turn", "authority"] as const) {
  test(`independent: ${change} change invalidates open promotion confirmation`, async ({
    page,
  }) => {
    const f = await setup(page);
    await confirmation(page);
    if (change === "turn") {
      const current = f.family.games[0];
      const changed = applyCommand(
        current,
        {
          type: "pass",
          id: "other-turn",
          expectedRevision: current.revision,
          timedAt: new Date().toISOString(),
        },
        testLexicon,
      );
      if (!changed.ok) throw Error(changed.error.message);
      f.family.games = [changed.game];
    } else {
      const access = f.family.gameAccess[f.family.games[0].id];
      access.generation++;
      access.scorerUserId = "other";
      access.canScore = false;
    }
    await expect(
      page.getByRole("button", { name: "Share as live draft", exact: true }),
    ).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator(".word-buddy-private .square.fresh")).toHaveCount(
      0,
    );
    expect(f.posts.some((p) => p.placements.length)).toBe(false);
    expect(f.requests.some((r) => r.includes('"type":"play"'))).toBe(false);
  });
}

test("independent: repeated promotion shares once without recording", async ({
  page,
}) => {
  const f = await setup(page);
  await confirmation(page);
  await page
    .getByRole("button", { name: "Share as live draft", exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect
    .poll(() => f.posts.filter((p) => p.kind === "edit").length)
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "Review turn", exact: true }),
  ).toBeVisible();
  expect(f.requests.some((r) => r.includes('"type":"play"'))).toBe(false);
});

test("independent: leaving unconfirmed test clears it and preserves parked scoring draft", async ({
  page,
}) => {
  const f = await setup(page);
  await enter(page);
  await expect
    .poll(() => f.posts.some((p) => p.placements.length === 3))
    .toBe(true);
  await page.getByRole("button", { name: "Test words", exact: true }).click();
  await enter(page, "QAT");
  await page
    .getByRole("button", { name: "Back to leaderboard", exact: false })
    .click();
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
  await expect(page.locator(".square.fresh")).toHaveCount(3);
  await expect.poll(() => f.posts.length).toBeGreaterThan(count);
  expect(JSON.stringify(f.posts)).not.toContain('"letter":"Q"');
});
