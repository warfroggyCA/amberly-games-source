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
              scroller.bottom <= controls.top + 1,
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
