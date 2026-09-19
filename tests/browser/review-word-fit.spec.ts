import { test, expect } from "@playwright/test";

for (const [opening, extension, start, next] of [
  ["READING", "S", "H8", "O8"],
  ["COUNTER", "POINT", "B8", "I8"],
]) {
  test(`review fits ${opening} and its ${opening + extension} extension`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await page.getByRole("button", { name: /New preview game/ }).click();
    for (const name of ["Ada", "Ben"]) {
      await page.getByRole("textbox", { name: "Player name" }).fill(name);
      await page
        .getByRole("button", { name: "Add player", exact: true })
        .click();
    }
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    for (const [letters, cell, wholeWord] of [
      [opening, start, opening],
      [extension, next, opening + extension],
    ]) {
      await page.getByTestId(`cell-${cell}`).click();
      await page
        .getByRole("textbox", { name: "Type letters on the board" })
        .pressSequentially(letters);
      await page
        .getByRole("button", { name: "Review turn", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Review this turn" });
      const strip = dialog.getByRole("list", {
        name: `${wholeWord} tile spaces`,
      });
      await expect(strip.locator("li")).toHaveCount(wholeWord.length);
      await expect(strip.locator(".is-existing .review-premium")).toHaveCount(
        0,
      );
      await expect(strip.locator(".review-premium")).toHaveCount(
        letters === opening ? 2 : 1,
      );
      const geometry = await strip.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const cells = [...element.children].map((cell) =>
          cell.getBoundingClientRect(),
        );
        return {
          fits: cells.every(
            (cell) =>
              cell.left >= box.left &&
              cell.right <= box.right &&
              cell.bottom <= box.bottom,
          ),
          rows: new Set(cells.map((cell) => Math.round(cell.top))).size,
          overflow: element.scrollWidth - element.clientWidth,
          tagsClearLetters: [
            ...element.querySelectorAll(".review-premium"),
          ].every((tag) => {
            const letter = tag.parentElement!.querySelector(".letter-tile b")!;
            return (
              tag.getBoundingClientRect().bottom <=
              letter.getBoundingClientRect().top + 1
            );
          }),
        };
      });
      expect(geometry.fits).toBe(true);
      expect(geometry.tagsClearLetters).toBe(true);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      if (wholeWord.length <= 8) expect(geometry.rows).toBe(1);
      const action = dialog.getByRole("button", {
        name: /^Record \d+ points$/,
      });
      await expect(action).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: info.outputPath(`${wholeWord}-review.png`),
      });
      await action.click();
      const dismiss = page.getByRole("button", {
        name: "Dismiss bingo celebration",
      });
      await expect(dismiss).toBeHidden({ timeout: 12000 });
    }
  });
}
