import { test, expect, type Page } from "@playwright/test";

async function startGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /New preview game/ }).click();
  for (const [name, seat] of [
    ["Ada", "Top"],
    ["Ben", "Bottom"],
  ]) {
    await page.getByRole("textbox", { name: "Player name" }).fill(name);
    await page.getByRole("button", { name: "Add player", exact: true }).click();
    // Adding a player seats them in the first free position. Move Ben to bottom.
    if (seat === "Bottom") {
      await page
        .getByRole("button", { name: `${name} Right seat`, exact: true })
        .click();
      await page
        .getByRole("button", { name: `${seat} seat: empty`, exact: true })
        .click();
    }
  }
  await page.getByLabel("Who plays first?").selectOption({ label: "Ada" });
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.getByRole("grid", { name: "Scrabble board, 15 by 15" }),
  ).toBeVisible();
}
async function enter(page: Page, cell: string, word: string) {
  await page.getByTestId(`cell-${cell}`).click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .pressSequentially(word);
}
async function review(page: Page, score: number) {
  await page.getByRole("button", { name: "Review turn", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review this turn" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: `Record ${score} points`, exact: true })
    .click();
  await expect(dialog).toBeHidden();
}

test("record, refresh, extend a word and undo preserve the board and scores", async ({
  page,
}) => {
  await startGame(page);
  await enter(page, "H8", "CAT");
  await expect(
    page.getByRole("status", { name: "10 potential points, valid turn" }),
  ).toBeVisible();
  await review(page, 10);
  await expect(
    page.getByLabel("Ada, 10 points", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await expect(page.getByTestId("cell-H8")).toHaveAccessibleName(
    "H8 C, 3 points",
  );
  await enter(page, "K8", "S");
  await review(page, 6);
  await page
    .getByRole("button", { name: "Undo last turn", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Undo the last turn" });
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByTestId("cell-K8")).toHaveAccessibleName(/K8 empty/);
  await expect(page.getByTestId("cell-H8")).toHaveAccessibleName(
    "H8 C, 3 points",
  );
  await expect(
    page.getByLabel("Ben, 0 points, current player", { exact: true }),
  ).toBeVisible();
});

test("draft survives refresh; distant entry is blocked and on-tile backspace works", async ({
  page,
}) => {
  await startGame(page);
  await enter(page, "H8", "CAT");
  await page.getByTestId("cell-M13").click();
  await expect(
    page.getByRole("region", { name: "Board workspace" }).getByRole("alert"),
  ).toContainText("Finish this word first");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss entry message" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await expect(page.getByTestId("cell-H8")).toHaveAccessibleName(
    "H8 C, 3 points",
  );
  await page.getByTestId("cell-J8").click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .press("Backspace");
  await expect(page.getByTestId("cell-J8")).toHaveAccessibleName(/J8 empty/);
  await expect(page.getByTestId("cell-I8")).toHaveAccessibleName(
    "I8 A, 1 points",
  );
});

test("board, seats and entry controls fit the viewport and the bag toggles", async ({
  page,
}) => {
  await startGame(page);
  for (const locator of [
    page.getByRole("grid"),
    page.getByLabel("Ada, 0 points, current player", { exact: true }),
    page.getByLabel("Ben, 0 points", { exact: true }),
    page.getByRole("button", { name: "Review turn", exact: true }),
  ]) {
    await expect(locator).toBeInViewport({ ratio: 1 });
  }
  const bag = page.locator("button.tile-bag-button").filter({ visible: true });
  await bag.click();
  await expect(bag).toHaveAttribute("aria-expanded", "true");
  await bag.click();
  await expect(bag).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("html")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("html").evaluate((el) => el.clientWidth),
  );
});

test("saved equipment survives reload and changes only future games", async ({
  page,
}) => {
  await startGame(page);
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Add a tile set", exact: true })
    .click();
  await page.getByLabel("Set name", { exact: true }).fill("Missing C set");
  await page
    .getByRole("spinbutton", { name: "C quantity", exact: true })
    .fill("0");
  await page.getByLabel("Use this set by default", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save tile set", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit Missing C set", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(
    page.locator("button.tile-bag-button").filter({ visible: true }),
  ).toHaveAccessibleName("Tiles remaining in bag: 86");
  await page.reload();
  await page.getByRole("button", { name: /New preview game/ }).click();
  await expect(
    page.getByText(/Missing C set · 98 tiles · Change set/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await expect(
    page.locator("button.tile-bag-button").filter({ visible: true }),
  ).toHaveAccessibleName("Tiles remaining in bag: 86");
});

test("typed crossings use directional word markers and retain invalid-turn checks", async ({
  page,
}, info) => {
  await startGame(page);
  await enter(page, "H8", "CAT");
  await review(page, 10);
  await enter(page, "I9", "A");
  await enter(page, "J9", "T");
  const crossing = page.getByTestId("cell-J9");
  await expect(crossing.locator(".letter-tile")).toHaveClass(/word-mixed/);
  await expect(crossing.locator('[data-word-edge="left"]')).toHaveAttribute(
    "data-word-valid",
    "true",
  );
  await expect(crossing.locator('[data-word-edge="top"]')).toHaveAttribute(
    "data-word-valid",
    "false",
  );
  await expect(
    crossing.locator('[data-word-edge="bottom"], [data-word-edge="right"]'),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("directional-word-feedback.png"),
  });
  await page
    .getByRole("button", { name: "Word feedback", exact: true })
    .click();
  const details = page.getByRole("dialog", { name: "Word feedback" });
  await expect(details).toContainText("AT: valid across");
  await expect(details).toContainText("TT: invalid down");
  await details.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Review turn", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Record \d+ points$/ }),
  ).toHaveCount(0);
});
