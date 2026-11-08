import { expect, test, type Page } from "@playwright/test";

const owner = {
  familyId: "a1111111-1111-4111-8111-111111111111",
  userId: "b1111111-1111-4111-8111-111111111111",
  playerId: "ada",
};
const sessionId = "c1111111-1111-4111-8111-111111111111";
const list = {
  identity: owner,
  sessions: [
    {
      id: sessionId,
      createdAt: "2026-11-08T10:00:00Z",
      attempts: 3,
      firstPoints: 12,
      assisted: false,
      replay: false,
    },
  ],
  nextCursor: null,
};
const detail = {
  id: sessionId,
  puzzle: {
    position: {
      board: Array.from({ length: 15 }, () => Array(15).fill(null)),
      rack: ["A", "B", "C", "D", "E", "F", "G"],
    },
  },
  events: [],
  replay: false,
};
type Pending = {
  url: string;
  method: string;
  body?: string;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
};
declare global {
  interface Window {
    gymReads: Pending[];
  }
}
async function setup(page: Page) {
  await page.addInitScript(
    ({ owner, list }) => {
      const original = window.fetch.bind(window);
      window.gymReads = [];
      let connected = false;
      window.fetch = (input, init) => {
        const url = String(input);
        if (url === "/api/auth/session")
          return Promise.resolve(
            Response.json({
              configured: true,
              user: { id: owner.userId, email: "synthetic@example.test" },
            }),
          );
        if (url.startsWith("/api/family/words"))
          return Promise.resolve(Response.json({ words: [] }));
        if (url.startsWith("/api/family/gym")) {
          if (!connected) {
            connected = true;
            return Promise.resolve(Response.json(list));
          }
          // Deliberately ignore AbortSignal. This exercises the real React hook's
          // generation/owner guards even when cancellation cannot stop delivery.
          return new Promise<Response>((resolve, reject) =>
            window.gymReads.push({
              url,
              method: init?.method ?? "GET",
              body: init?.body as string | undefined,
              resolve,
              reject,
            }),
          );
        }
        return original(input, init);
      };
    },
    { owner, list },
  );
  await page.goto("/gym-lab?from=family", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("Profile connected", { exact: true }),
  ).toBeVisible();
}
async function count(page: Page, n: number) {
  await expect.poll(() => page.evaluate(() => window.gymReads.length)).toBe(n);
}
async function finish(page: Page, index: number, body: unknown, status = 200) {
  await page.evaluate(
    ({ index, body, status }) =>
      window.gymReads[index].resolve(
        new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    { index, body, status },
  );
}
async function open(page: Page, n: number) {
  await page
    .getByRole("button", { name: "My practice history", exact: true })
    .click();
  await count(page, n);
}
async function close(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
}

for (const order of ["old-first", "new-first"] as const) {
  test(`latest list navigation wins over detail with ignored abort: ${order}`, async ({
    page,
  }) => {
    await setup(page);
    await open(page, 1);
    await finish(page, 0, list);
    await page.getByRole("button", { name: /3 attempts/ }).click();
    await count(page, 2);
    // This is the same visible navigation used by a person changing their mind.
    const back = page.getByRole("button", {
      name: "Back to practice history",
      exact: true,
    });
    // While a review loads, retained list controls remain usable.
    await page
      .getByRole("button", { name: "Refresh history", exact: true })
      .click();
    await count(page, 3);
    if (order === "old-first") {
      await finish(page, 1, detail);
      await expect(
        page.getByText("Loading practice history and progress…", {
          exact: true,
        }),
      ).toBeVisible();
      await finish(page, 2, { ...list, sessions: [] });
    } else {
      await finish(page, 2, { ...list, sessions: [] });
      await finish(page, 1, detail);
    }
    await expect(
      page.getByRole("region", { name: "Saved practice review" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("No saved practice yet.", { exact: true }),
    ).toBeVisible();
    await expect(back).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath(`list-wins-${order}.png`),
      fullPage: true,
    });
  });
}

test("close and reopen invalidates late detail success and error", async ({
  page,
}) => {
  await setup(page);
  await open(page, 1);
  await finish(page, 0, list);
  await page.getByRole("button", { name: /3 attempts/ }).click();
  await count(page, 2);
  await close(page);
  await open(page, 3);
  await finish(page, 1, detail);
  await expect(
    page.getByText("Loading practice history and progress…", { exact: true }),
  ).toBeVisible();
  await finish(page, 2, list);
  await page.getByRole("button", { name: /3 attempts/ }).click();
  await count(page, 4);
  await close(page);
  await open(page, 5);
  await finish(page, 4, list);
  await finish(
    page,
    3,
    { error: "Stale private error", code: "PROFILE_CHANGED" },
    403,
  );
  await expect(
    page.getByText("Stale private error", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry sync", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("region", { name: "Practice history" }),
  ).toContainText("3 attempts");
});

for (const [status, body] of [
  [401, ""],
  [403, "{"],
  [403, { error: "Denied" }],
  [409, { code: "NO_PROFILE" }],
  [409, { code: "PROFILE_CHANGED" }],
] as const) {
  test(`denied ${status} ${JSON.stringify(body)} clears profile history and stays denied after close/focus`, async ({
    page,
  }) => {
    await setup(page);
    await open(page, 1);
    await finish(page, 0, list);
    await page.getByRole("button", { name: /3 attempts/ }).click();
    await count(page, 2);
    await finish(page, 1, body, status);
    await expect(
      page.getByRole("region", { name: "Practice history access" }),
    ).toBeVisible();
    await expect(page.getByText(/3 attempts/)).toHaveCount(0);
    await close(page);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    await page
      .getByRole("button", { name: "My practice history", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Practice history access" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry connection", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Start practice", exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate(() => window.gymReads.length)).toBe(2);
    await page.screenshot({
      path: test.info().outputPath("denied-history.png"),
      fullPage: true,
    });
  });
}

for (const failure of [
  "503",
  "offline",
  "timeout",
  "wrong-detail",
  "malformed",
]) {
  test(`temporary ${failure} retains same-owner content and retries`, async ({
    page,
  }) => {
    await setup(page);
    await open(page, 1);
    await finish(page, 0, list);
    await page.getByRole("button", { name: /3 attempts/ }).click();
    await count(page, 2);
    if (failure === "offline" || failure === "timeout")
      await page.evaluate(
        (f) =>
          window.gymReads[1].reject(
            new DOMException(
              f,
              f === "timeout" ? "TimeoutError" : "NetworkError",
            ),
          ),
        failure,
      );
    else
      await finish(
        page,
        1,
        failure === "503"
          ? { error: "Service temporarily unavailable" }
          : failure === "wrong-detail"
            ? { ...detail, id: "other" }
            : "{",
        failure === "503" ? 503 : 200,
      );
    await expect(
      page.getByText("Previously loaded history · may be out of date.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry history", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Retry sync", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Retry history", exact: true })
      .click();
    await count(page, 3);
    await finish(page, 2, detail);
    await expect(
      page.getByRole("region", { name: "Saved practice review" }),
    ).toBeVisible();
  });
}

test("full owner mismatch fails closed", async ({ page }) => {
  await setup(page);
  await open(page, 1);
  await finish(page, 0, {
    ...list,
    identity: { ...owner, familyId: "other-family" },
  });
  await expect(
    page.getByRole("region", { name: "Practice history access" }),
  ).toBeVisible();
  await expect(page.getByText(/3 attempts/)).toHaveCount(0);
});

test("profile refresh and denial preserve puzzle, tile identity and original-owner persisted work", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  const board = page.getByRole("group", { name: "Scrabble practice board" });
  await expect(board).toBeVisible({ timeout: 25000 });
  const rack = page.locator("[data-gym-rack] [data-rack-id]");
  const rackIds = await rack.evaluateAll((nodes) =>
    nodes.map((n) => [n.getAttribute("data-rack-id"), n.textContent]),
  );
  await board.getByRole("button", { name: /empty/ }).first().click();
  await rack.filter({ hasText: /[A-Z]/ }).first().click();
  await expect(board.locator(".is-draft")).toHaveCount(1);
  const placed = (
    await board.locator(".is-draft").getAttribute("aria-label")
  )?.split(",")[0];
  await count(page, 1);
  await finish(page, 0, { error: "Synthetic offline" }, 503);
  await expect(
    page.getByText("Practice saved on this device.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "My practice history", exact: true })
    .click();
  await count(page, 2);
  await finish(page, 1, { error: "Synthetic offline" }, 503);
  await count(page, 3);
  await finish(page, 2, "", 401);
  await expect(
    page.getByRole("region", { name: "Practice history access" }),
  ).toBeVisible();
  await close(page);
  await expect(board.locator(".is-draft")).toHaveCount(1);
  expect(
    (await board.locator(".is-draft").getAttribute("aria-label"))?.split(
      ",",
    )[0],
  ).toBe(placed);
  const storage = await page.evaluate(() =>
    Promise.all(
      [...["amberly-gym-drafts", "amberly-gym-outbox"]].map(
        (name) =>
          new Promise<unknown[]>((resolve, reject) => {
            const req = indexedDB.open(name, 1);
            req.onsuccess = () => {
              const db = req.result;
              const read = db
                .transaction(name.endsWith("drafts") ? "drafts" : "events")
                .objectStore(name.endsWith("drafts") ? "drafts" : "events")
                .getAll();
              read.onsuccess = () => {
                db.close();
                resolve(read.result);
              };
              read.onerror = () => reject(read.error);
            };
            req.onerror = () => reject(req.error);
          }),
      ),
    ),
  );
  expect(storage[0]).toHaveLength(1);
  expect(storage[1]).toHaveLength(1);
  expect(storage[0][0]).toMatchObject({
    key: JSON.stringify([owner.familyId, owner.userId, owner.playerId]),
  });
  expect(storage[1][0]).toMatchObject({ owner });
  await page.screenshot({
    path: test.info().outputPath("denial-keeps-puzzle.png"),
    fullPage: true,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  // Reload is the explicit reconnection boundary. Initial flush may retry its
  // original owner's queue; the draft is still scoped to that same owner.
  await expect(
    page.getByRole("button", { name: "Resume practice", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Resume practice", exact: true })
    .click();
  await expect(board.locator(".is-draft")).toHaveCount(1, { timeout: 25000 });
  expect(
    (await board.locator(".is-draft").getAttribute("aria-label"))?.split(
      ",",
    )[0],
  ).toBe(placed);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(board.locator(".is-draft")).toHaveCount(0);
  expect(
    await rack.evaluateAll((nodes) =>
      nodes.map((n) => [n.getAttribute("data-rack-id"), n.textContent]),
    ),
  ).toEqual(rackIds);
  await page.screenshot({
    path: test.info().outputPath("profile-refresh-recovery.png"),
    fullPage: true,
  });
});

test("current account change during a read rejects old success and requires reload", async ({
  page,
}) => {
  await setup(page);
  await open(page, 1);
  await page.evaluate(() => {
    const previous = window.fetch;
    window.fetch = (url, init) =>
      String(url) === "/api/auth/session"
        ? Promise.resolve(Response.json({ user: { id: "different-account" } }))
        : previous(url, init);
    window.dispatchEvent(new Event("focus"));
  });
  await expect(
    page.getByRole("region", { name: "Practice history access" }),
  ).toBeVisible();
  await finish(page, 0, list);
  await expect(page.getByText(/3 attempts/)).toHaveCount(0);
  await close(page);
  await expect(
    page.getByRole("button", { name: "Retry connection", exact: true }),
  ).toBeDisabled();
});
