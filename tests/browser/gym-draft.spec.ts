import { test, expect } from "@playwright/test";

test("refresh restores rack identity, draft, cursor, help and undo", async ({
  page,
}) => {
  await page.goto("/gym-lab");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  const board = page.getByRole("group", { name: "Scrabble practice board" });
  await expect(board).toBeVisible({ timeout: 25000 });
  const rack = page.locator("[data-gym-rack] [data-rack-id]");
  const before = await rack.allTextContents();
  await board.getByRole("button", { name: /empty/ }).first().click();
  const letter = rack.filter({ hasText: /[A-Z]/ }).first();
  await letter.click();
  await expect(board.locator(".is-draft")).toHaveCount(1);
  // Word-validation feedback is appended asynchronously; compare the saved
  // square/letter/blank identity, not the current analysis suffix.
  const draftIdentity = async () =>
    (await board.locator(".is-draft").getAttribute("aria-label"))?.split(
      ",",
    )[0];
  const placed = await draftIdentity();
  await page.getByRole("button", { name: "Hint", exact: true }).click();
  await expect(
    page.getByText("Practice saved on this device.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Resume practice", exact: true })
    .click();
  await expect(board.locator(".is-draft")).toHaveCount(1, { timeout: 25000 });
  await expect.poll(draftIdentity).toBe(placed);
  await expect(page.locator(".gym-hints")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(board.locator(".is-draft")).toHaveCount(0);
  expect(await rack.allTextContents()).toEqual(before);
  await page.getByRole("button", { name: "Solve", exact: true }).click();
  await expect(
    page.getByText("Practice saved on this device.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Resume practice", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "My move", exact: true }),
  ).toBeVisible({ timeout: 25000 });
});

test("storage failure is visible and does not prevent practice", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    Object.defineProperty(IDBFactory.prototype, "open", {
      configurable: true,
      value: (name: string, version?: number) => {
        if (name === "amberly-gym-drafts") throw new Error("Storage blocked");
        return version === undefined ? open(name) : open(name, version);
      },
    });
  });
  await page.goto("/gym-lab");
  await expect(page.getByText(/Draft recovery is unavailable/)).toBeVisible();
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Scrabble practice board" }),
  ).toBeVisible({ timeout: 25000 });
});

test("unresponsive draft storage times out and still allows practice", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    Object.defineProperty(IDBFactory.prototype, "open", {
      configurable: true,
      value: (name: string, version?: number) => {
        if (name === "amberly-gym-drafts") {
          document.documentElement.dataset.draftOpenPending = "true";
          return {} as IDBOpenDBRequest;
        }
        return version === undefined ? open(name) : open(name, version);
      },
    });
  });
  await page.goto("/gym-lab");
  await expect(page.locator("html")).toHaveAttribute(
    "data-draft-open-pending",
    "true",
  );
  const start = page.getByRole("button", {
    name: "Start practice",
    exact: true,
  });
  await expect(start).toBeDisabled();
  await page.clock.fastForward(15001);
  await expect(page.getByText(/Draft recovery is unavailable/)).toBeVisible();
  await start.click();
  await expect(
    page.getByRole("group", { name: "Scrabble practice board" }),
  ).toBeVisible({ timeout: 25000 });
});

test("a stalled draft save preserves the board and lets Back to Games finish", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/gym-lab");
  const start = page.getByRole("button", {
    name: "Start practice",
    exact: true,
  });
  // Let recovery read the existing draft before simulating a stalled save.
  await expect(start).toBeEnabled();
  await page.evaluate(() => {
    const open = indexedDB.open.bind(indexedDB);
    Object.defineProperty(IDBFactory.prototype, "open", {
      configurable: true,
      value: (name: string, version?: number) => {
        if (name === "amberly-gym-drafts") {
          document.documentElement.dataset.draftOpenPending = "true";
          return {} as IDBOpenDBRequest;
        }
        return version === undefined ? open(name) : open(name, version);
      },
    });
  });
  await start.click();
  const board = page.getByRole("group", { name: "Scrabble practice board" });
  await expect(board).toBeVisible({ timeout: 25000 });
  await expect(page.locator("html")).toHaveAttribute(
    "data-draft-open-pending",
    "true",
  );
  await board.getByRole("button", { name: /empty/ }).first().click();
  await page
    .locator("[data-gym-rack] [data-rack-id]")
    .filter({ hasText: /[A-Z]/ })
    .first()
    .click();
  await expect(board.locator(".is-draft")).toHaveCount(1);
  const draftIdentity = async () =>
    (await board.locator(".is-draft").getAttribute("aria-label"))?.split(
      ",",
    )[0];
  const placed = await draftIdentity();
  await page.clock.fastForward(15001);
  await expect(page.getByText(/storage did not respond/i)).toBeVisible();
  await expect(board.locator(".is-draft")).toHaveCount(1);
  await expect.poll(draftIdentity).toBe(placed);
  await page
    .getByRole("button", { name: "Back to Games", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Leave practice", exact: true })
    .click();
  await expect(page).toHaveURL(/\/gym-lab\/games$/);
});

test("another tab cannot overwrite a newer saved puzzle", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "One shared-storage concurrency check",
  );
  await page.goto("/gym-lab");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Scrabble practice board" }),
  ).toBeVisible({ timeout: 25000 });
  await expect(
    page.getByText("Practice saved on this device.", { exact: true }),
  ).toBeVisible();
  const other = await context.newPage();
  await other.goto("/gym-lab");
  await expect(
    other.getByRole("button", { name: "Resume practice", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hint", exact: true }).click();
  await expect(
    page.getByText("Practice saved on this device.", { exact: true }),
  ).toBeVisible();
  await other
    .getByRole("button", { name: "Resume practice", exact: true })
    .click();
  await expect(
    other.getByText(/Another tab updated this practice/),
  ).toBeVisible({ timeout: 25000 });
  await other.reload();
  await other
    .getByRole("button", { name: "Resume practice", exact: true })
    .click();
  await expect(other.locator(".gym-hints")).toBeVisible({ timeout: 25000 });
});
