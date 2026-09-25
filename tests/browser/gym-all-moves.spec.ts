import { test, expect } from "@playwright/test";
test("all moves ranks placements and previews without changing my draft", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (event.data.type === "strategy") event.stopImmediatePropagation();
        });
      }
      postMessage(value: { type: string; seed?: string; action?: unknown }) {
        if (value.type === "generate")
          value = { ...value, seed: "gym-feasibility-v1-0" };
        if (value.type === "strategy")
          (
            window as unknown as { selectedStrategy: unknown }
          ).selectedStrategy = value.action;
        super.postMessage(value);
      }
    };
  });
  await page.goto("/gym-lab");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  const board = page.getByRole("group", { name: "Scrabble practice board" });
  await expect(board).toBeVisible({ timeout: 25000 });
  await board.getByRole("button", { name: /empty/ }).first().click();
  await page
    .getByRole("button", { name: /^Rack tile \d: [A-Z]$/ })
    .first()
    .click();
  await expect(board.locator(".is-draft")).toHaveCount(1);
  const original = await board.locator(".is-draft").getAttribute("aria-label");
  await page.getByRole("button", { name: "All moves", exact: true }).click();
  const explorer = page.getByRole("region", { name: "Move explorer" });
  await expect(
    explorer.getByRole("heading", { name: "All moves", exact: true }),
  ).toBeVisible({ timeout: 25000 });
  const summaries = await explorer.locator(".gym-move-main").allTextContents();
  const points = summaries.map((s) => Number(s.match(/· (\d+) points/)![1]));
  expect(points).toEqual([...points].sort((a, b) => b - a));
  await explorer.locator(".gym-move-main").first().click();
  await expect(explorer.getByText(/Preview:/)).toBeVisible();
  const previewCount = await board.locator(".is-draft").count();
  await explorer
    .getByRole("button", { name: "Compare strategy for this move" })
    .click();
  const action = await page.evaluate(
    () =>
      (window as unknown as { selectedStrategy: { placements: unknown[] } })
        .selectedStrategy,
  );
  expect(action.placements.length).toBe(previewCount);
  await expect(
    explorer.getByRole("button", { name: "Answer now" }),
  ).toBeEnabled({ timeout: 25000 });
  await explorer.getByRole("button", { name: "Answer now" }).click();
  await expect(
    explorer.getByText("Quick comparison", { exact: true }),
  ).toBeVisible();
  await explorer
    .getByRole("button", { name: "Compare strategy for this move" })
    .click();
  await explorer.getByRole("button", { name: "Cancel comparison" }).click();
  await explorer
    .getByRole("button", { name: "Compare strategy for this move" })
    .click();
  await expect(
    explorer.getByRole("button", { name: "Answer now" }),
  ).toBeEnabled({ timeout: 25000 });
  await explorer.getByRole("button", { name: "Answer now" }).click();
  await expect(explorer.getByText(/Think of this as advice/)).toBeVisible({
    timeout: 20000,
  });
  await page.screenshot({
    path: info.outputPath("all-moves-preview.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "My move", exact: true }).click();
  await expect(explorer).toHaveCount(0);
  await expect(board.locator(".is-draft")).toHaveCount(1);
  expect(await board.locator(".is-draft").getAttribute("aria-label")).toBe(
    original,
  );
});
test("incomplete search explicitly labels moves found", async ({ page }) => {
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      postMessage(value: { type: string; id: number }) {
        if (value.type === "all-moves") {
          setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: {
                    id: value.id,
                    type: "all-moves",
                    catalogue: { complete: false, moves: [] },
                  },
                }),
              ),
            0,
          );
          return;
        }
        super.postMessage(value);
      }
    };
  });
  await page.goto("/gym-lab");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  await page.getByRole("button", { name: "All moves", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Moves found", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/search incomplete/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry search", exact: true }),
  ).toBeVisible();
});
