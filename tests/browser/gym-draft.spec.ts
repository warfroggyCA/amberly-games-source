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
  const placed = await board.locator(".is-draft").getAttribute("aria-label");
  await page.getByRole("button", { name: "Hint", exact: true }).click();
  await expect(
    page.getByText("Practice saved on this device.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Resume practice", exact: true })
    .click();
  await expect(board.locator(".is-draft")).toHaveCount(1, { timeout: 25000 });
  expect(await board.locator(".is-draft").getAttribute("aria-label")).toBe(
    placed,
  );
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
