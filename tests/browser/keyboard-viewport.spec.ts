import { test, expect, type Page } from "@playwright/test";

async function keyboardViewport(page: Page, height: number, offsetTop = 0) {
  await page.evaluate(
    ({ height, offsetTop }) => {
      const viewport = window.visualViewport!;
      Object.defineProperties(viewport, {
        height: { configurable: true, value: height },
        offsetTop: { configurable: true, value: offsetTop },
      });
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
    },
    { height, offsetTop },
  );
}

test("software keyboard keeps the edited tiles and review above its edge through rotation", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /New preview game/ }).click();
  for (const name of ["Gauntlet Test A", "Gauntlet Test B"]) {
    await page.getByRole("textbox", { name: "Player name" }).fill(name);
    await page.getByRole("button", { name: "Add player", exact: true }).click();
  }
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByTestId("cell-H8").click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .pressSequentially("DOG");
  const review = page.getByRole("button", { name: "Review turn", exact: true });

  // Model iOS's smaller visual viewport, not a smaller layout viewport. These
  // browser checks do not substitute for installed-iPhone keyboard acceptance.
  for (const layout of [
    { name: "portrait", width: 390, height: 844, visible: 450, top: 0 },
    { name: "portrait-panned", width: 390, height: 844, visible: 450, top: 70 },
    { name: "landscape", width: 844, height: 390, visible: 190, top: 0 },
    { name: "portrait-return", width: 390, height: 844, visible: 450, top: 0 },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await keyboardViewport(page, layout.visible, layout.top);
    await expect(page.locator(".game-screen")).toHaveClass(/keyboard-open/);
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const scroller = document
            .querySelector(".board-scroll")!
            .getBoundingClientRect();
          const cursor = document
            .querySelector('[aria-selected="true"]')!
            .getBoundingClientRect();
          const lastTile = document
            .querySelector('[data-testid="cell-J8"]')!
            .getBoundingClientRect();
          const controls = document
            .querySelector(".persistent-entry-bar")!
            .getBoundingClientRect();
          const viewport = window.visualViewport!;
          return {
            cursorVisible:
              cursor.top >= scroller.top &&
              cursor.bottom <= scroller.bottom &&
              cursor.left >= scroller.left &&
              cursor.right <= scroller.right,
            lastTileVisible:
              lastTile.top >= scroller.top &&
              lastTile.bottom <= scroller.bottom &&
              lastTile.left >= scroller.left &&
              lastTile.right <= scroller.right,
            usableTile: cursor.width >= 28,
            controlsVisible:
              controls.top >= viewport.offsetTop &&
              controls.bottom <= viewport.offsetTop + viewport.height + 1,
            boardAboveKeyboard:
              scroller.top >= viewport.offsetTop &&
              scroller.bottom <= viewport.offsetTop + viewport.height + 1 &&
              (scroller.bottom <= controls.top + 1 ||
                scroller.right <= controls.left + 1),
          };
        });
      })
      .toEqual({
        cursorVisible: true,
        lastTileVisible: true,
        usableTile: true,
        controlsVisible: true,
        boardAboveKeyboard: true,
      });
    await page.screenshot({
      path: info.outputPath(`keyboard-${layout.name}.png`),
    });
  }

  await keyboardViewport(page, 844);
  await expect(page.locator(".game-screen")).not.toHaveClass(/keyboard-open/);
  await expect(page.getByRole("grid")).toBeInViewport({ ratio: 1 });
  await review.click();
  await expect(
    page.getByRole("button", { name: "Record 10 points", exact: true }),
  ).toBeEnabled();
});

test("vertical entry stays readable through short landscape rotation and accidental taps preserve entry without blocking", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /New preview game/ }).click();
  for (const name of ["Gauntlet Test A", "Gauntlet Test B"]) {
    await page.getByRole("textbox", { name: "Player name" }).fill(name);
    await page.getByRole("button", { name: "Add player", exact: true }).click();
  }
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page
    .getByRole("button", { name: "Begin play & timer", exact: true })
    .click();
  const input = page.getByRole("textbox", {
    name: "Type letters on the board",
  });
  const review = page.getByRole("button", { name: "Review turn", exact: true });
  await page.getByTestId("cell-H8").click();
  await input.pressSequentially("DOG");
  await review.click();
  await page
    .getByRole("button", { name: "Record 10 points", exact: true })
    .click();
  await page.getByTestId("cell-K8").click();
  await input.pressSequentially("S");
  await review.click();
  await page
    .getByRole("button", { name: "Record 6 points", exact: true })
    .click();
  await page.getByTestId("cell-H9").click();
  await input.pressSequentially("OG");
  // Include the installed app's extra top clearance in the short-height case.
  await page.evaluate(() =>
    document.documentElement.style.setProperty(
      "--installed-top-clearance",
      "24px",
    ),
  );
  await keyboardViewport(page, 450);
  await page.setViewportSize({ width: 844, height: 390 });
  await keyboardViewport(page, 170);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const bounds = document
          .querySelector(".board-scroll")!
          .getBoundingClientRect();
        return ["H8", "H9", "H10", "H11"].every((id) => {
          const cell = document
            .querySelector(`[data-testid="cell-${id}"]`)!
            .getBoundingClientRect();
          return (
            cell.width >= 28 &&
            cell.top >= bounds.top &&
            cell.bottom <= bounds.bottom &&
            cell.left >= bounds.left &&
            cell.right <= bounds.right
          );
        });
      }),
    )
    .toBe(true);
  await expect(page.getByLabel("Current turn elapsed time")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause game", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: info.outputPath("vertical-keyboard-landscape.png"),
  });

  // An accidental tap must never trap the scorer in a modal. Exercise native
  // touch hit testing while the keyboard viewport and orientation change.
  for (const orientation of ["portrait", "landscape"]) {
    const cell = page.getByTestId("cell-J10");
    if (info.project.name === "desktop-chromium") await cell.click();
    else await cell.tap();
    await expect(
      page.getByRole("region", { name: "Board workspace" }).getByRole("alert"),
    ).toContainText("Finish this word first");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`vertical-warning-${orientation}.png`),
    });
    await keyboardViewport(page, 390, 24);
    await page.setViewportSize({ width: 390, height: 844 });
    await keyboardViewport(page, 844);
    const button = page.getByRole("button", { name: "Dismiss entry message" });
    if (info.project.name === "desktop-chromium") await button.click();
    else await button.tap();
    await expect(input).toBeFocused();
    await expect(
      page.getByRole("region", { name: "Board workspace" }).getByRole("alert"),
    ).toHaveCount(0);
    await expect(page.getByTestId("cell-H9")).toHaveAccessibleName(
      "H9 O, 1 points",
    );
    await expect(page.getByTestId("cell-H10")).toHaveAccessibleName(
      "H10 G, 2 points",
    );
    await expect(page.getByTestId("cell-H11")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.screenshot({
      path: info.outputPath(`vertical-after-warning-${orientation}.png`),
    });
    await page.setViewportSize({ width: 844, height: 390 });
    await keyboardViewport(page, 170);
  }
  await keyboardViewport(page, 390);
  await review.click();
  await expect(
    page.getByRole("button", { name: "Record 5 points", exact: true }),
  ).toBeEnabled();
  const dialog = page.getByRole("dialog", { name: "Review this turn" });
  for (const size of [
    { width: 844, height: 390 },
    { width: 667, height: 320 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await keyboardViewport(page, size.height);
    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const actions = Array.from(
            element.querySelectorAll(".dialog-actions button"),
          );
          return (
            actions.length === 2 &&
            actions.every((button) => {
              const rect = button.getBoundingClientRect();
              return (
                rect.top >= Math.max(0, bounds.top) &&
                rect.bottom <= Math.min(window.innerHeight, bounds.bottom) &&
                rect.left >= bounds.left &&
                rect.right <= bounds.right
              );
            })
          );
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: info.outputPath(`review-actions-${size.width}-${size.height}.png`),
    });
  }
  await dialog
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("cell-H9")).toHaveAccessibleName(
    "H9 O, 1 points",
  );
  await expect(page.getByTestId("cell-H10")).toHaveAccessibleName(
    "H10 G, 2 points",
  );
  await input.pressSequentially("Q");
  await review.click();
  await expect(dialog).toContainText("This turn needs a correction");
  await page.setViewportSize({ width: 667, height: 320 });
  await keyboardViewport(page, 320);
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const button = element.querySelector(".dialog-actions button")!;
        const rect = button.getBoundingClientRect();
        return (
          rect.top >= Math.max(0, bounds.top) &&
          rect.bottom <= Math.min(window.innerHeight, bounds.bottom)
        );
      }),
    )
    .toBe(true);
  await dialog
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("cell-H11")).toHaveAccessibleName(
    "H11 Q, 10 points",
  );
});
