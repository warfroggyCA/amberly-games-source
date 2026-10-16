import { expect, test, type Page } from "@playwright/test";

async function start(page: Page) {
  // Deterministic physical rack/board; validity and rendering still use the app.
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      postMessage(message: { id: number; type?: string }) {
        if (message.type !== "generate") return super.postMessage(message);
        const board = Array.from({ length: 15 }, () => Array(15).fill(null));
        board[7][7] = { letter: "A", blank: false };
        setTimeout(
          () =>
            this.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  id: message.id,
                  type: "generate",
                  elapsedMs: 0,
                  puzzle: {
                    generator: "legal-play-v1",
                    rules: "amberly-two-player-v1",
                    seed: "keyboard-entry-fixture",
                    reference: {
                      id: "fixture",
                      edition: "fixture",
                      status: "test",
                    },
                    position: {
                      board,
                      rack: ["A", "A", "T", "?", "E", "R", "S"],
                      scores: [0, 0],
                      opponentCount: 7,
                      bagCount: 85,
                      passes: 0,
                    },
                    setup: [],
                  },
                  answer: {
                    maximum: 4,
                    maximumCount: 1,
                    totalMoves: 1,
                    histogram: [{ score: 4, count: 1 }],
                    best: [],
                    candidates: [],
                    candidateCount: 0,
                    nodes: 0,
                  },
                },
              }),
            ),
          0,
        );
      }
    };
  });
  await page.goto("/gym-lab");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  await expect(page.locator(".gym-board")).toBeVisible();
  const skip = page.getByRole("button", {
    name: "Skip animation",
    exact: true,
  });
  if (await skip.isVisible()) await skip.click();
}
const square = (page: Page, row: number, col: number) =>
  page.locator(`[data-gym-square][data-row="${row}"][data-col="${col}"]`);
const draft = (page: Page) => page.locator(".gym-board .is-draft");

test("typed letters use available physical rack tiles and Backspace undoes placement", async ({
  page,
}) => {
  await start(page);
  await square(page, 0, 0).focus();
  await page.keyboard.press("a");
  await expect(draft(page)).toHaveCount(0); // A focused square is not yet a selected start.
  await square(page, 0, 0).click();
  await page.keyboard.type("aAA");
  await expect(draft(page)).toHaveCount(2);
  await expect(square(page, 0, 0)).toHaveAttribute("aria-label", /A/);
  await expect(square(page, 0, 1)).toHaveAttribute("aria-label", /A/);
  await expect(
    page.locator('[data-gym-rack] [data-rack-id="0"]'),
  ).toBeDisabled();
  await expect(
    page.locator('[data-gym-rack] [data-rack-id="1"]'),
  ).toBeDisabled();
  const rackT = page.getByRole("button", {
    name: "Rack tile 3: T",
    exact: true,
  });
  await rackT.focus();
  await page.keyboard.press("t");
  await expect(draft(page)).toHaveCount(3);
  await expect(square(page, 0, 3)).toBeFocused();
  await page.keyboard.press("z");
  await expect(draft(page)).toHaveCount(3); // Never silently spend a blank.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await expect(draft(page)).toHaveCount(2);
  await expect(rackT).toBeEnabled();
  await expect(square(page, 0, 2)).toBeFocused();
  await page.keyboard.press("t");
  await expect(draft(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(draft(page)).toHaveCount(2);
});

test("typing follows direction, skips fixed tiles and stops at the edge", async ({
  page,
}) => {
  await start(page);
  await square(page, 0, 0).click();
  await page.getByRole("button", { name: "→ Across", exact: true }).click();
  await page.keyboard.type("at");
  await expect(square(page, 0, 0)).toHaveClass(/is-draft/);
  await expect(square(page, 1, 0)).toHaveClass(/is-draft/);
  await page.getByRole("button", { name: "Return all", exact: true }).click();
  await square(page, 7, 6).click();
  await page.keyboard.type("at");
  await expect(square(page, 7, 6)).toHaveClass(/is-draft/);
  await expect(square(page, 7, 8)).toHaveClass(/is-draft/);
  await expect(square(page, 7, 7)).not.toHaveClass(/is-draft/);
  await page.getByRole("button", { name: "Return all", exact: true }).click();
  await square(page, 14, 14).click();
  await page.keyboard.type("at");
  await expect(draft(page)).toHaveCount(1);
  await page.keyboard.press("Backspace");
  await expect(draft(page)).toHaveCount(0);
  await expect(square(page, 14, 14)).toBeFocused();
});

test("typing continues after rack clicks and respects shuffled tile identity and Undo", async ({
  page,
}) => {
  await start(page);
  await square(page, 0, 0).click();
  await page
    .getByRole("button", { name: "Rack tile 1: A", exact: true })
    .click();
  await expect(square(page, 0, 1)).toBeFocused();
  await page.keyboard.press("a");
  await expect(draft(page)).toHaveCount(2);
  const rack = page.locator("[data-gym-rack] button");
  const order = await rack.evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-rack-id")),
  );
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  await page.getByRole("button", { name: "Shuffle rack", exact: true }).click();
  await square(page, 0, 2).focus();
  await page.keyboard.press("Backspace");
  // Undo follows the existing action history, including rack shuffle.
  await expect(draft(page)).toHaveCount(2);
  expect(
    await rack.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-rack-id")),
    ),
  ).toEqual(order);
  await page.keyboard.press("t");
  await expect(square(page, 0, 2)).toHaveClass(/is-draft/);
  await expect(
    page.getByRole("button", { name: "Rack tile 3: T, placed", exact: true }),
  ).toBeDisabled();
});

test("blank entry requires explicit choice and restores keyboard entry after cancel or choice", async ({
  page,
}) => {
  await start(page);
  await square(page, 0, 0).click();
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", {
    name: "Choose your blank’s letter",
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("a");
  await expect(draft(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(square(page, 0, 0)).toBeFocused();
  await page.keyboard.press("?");
  await dialog.getByRole("button", { name: "Z", exact: true }).click();
  await expect(square(page, 0, 0)).toHaveAttribute("aria-label", /Z blank/);
  await expect(square(page, 0, 0)).toBeFocused();
  await page.keyboard.press("t");
  await expect(square(page, 0, 1)).toHaveClass(/is-draft/);
  await page.keyboard.press("?");
  await expect(dialog).toHaveCount(0);
  await expect(draft(page)).toHaveCount(2);
});

test("typing is scoped and leaves shortcuts, composition, text fields and buttons alone", async ({
  page,
}) => {
  await start(page);
  const cell = square(page, 0, 0);
  await cell.click();
  // Native event flags model IME/shortcuts without invoking OS-wide shortcuts.
  const prevented = await cell.evaluate((node) =>
    [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
    ].map(
      (flags) =>
        !node.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "a",
            bubbles: true,
            cancelable: true,
            ...flags,
          }),
        ),
    ),
  );
  expect(prevented).toEqual([false, false, false, false, false, false]);
  await expect(draft(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).focus();
  await page.keyboard.press("a");
  await expect(draft(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Word lookup", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.locator("input").first();
  await input.fill("at");
  await input.press("Backspace");
  await expect(input).toHaveValue("a");
  await expect(draft(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await cell.focus();
  await page.keyboard.press("Space"); // Existing native board activation still works.
  await expect(page.locator(".gym-direction")).toContainText("Down");
  await page
    .getByRole("button", { name: "Rack tile 1: A", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await expect(draft(page)).toHaveCount(1);
});
