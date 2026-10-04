import { expect, test } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import { replayFixture } from "../fixtures/replay";

for (const textSize of [100, 200])
  test(`finalized spectator tiles retain faces and corner values at ${textSize}% text sizing`, async ({
    page,
  }, info) => {
    const fixture = await installFixture(page);
    const { game } = replayFixture();
    fixture.family.games = [game];
    fixture.family.gameAccess[game.id] = {
      scorerUserId: fixture.family.member.userId,
      deviceId: "fixture",
      generation: 1,
      mode: "confirmed",
      recordsEligible: false,
      protests: [],
      canScore: false,
      approvals: [],
    };
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        /\/api\/family(?:\/draft)?(?:\?|$)/.test(request.url()) &&
        request.method() !== "GET"
      )
        writes.push(request.url());
    });
    // The internal recent-games route has an additional return action: it was
    // the narrowest saved-result board, despite the same synthetic game.
    await page.goto("/family/scrabble");
    await page.locator(".game-list button").first().click();
    await expect(
      page.getByRole("button", { name: "Back to leaderboard" }),
    ).toBeVisible();
    await page.addStyleTag({
      content: `html { font-size: ${textSize}%; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }`,
    });
    expect(
      await page
        .locator("html")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBe((16 * textSize) / 100);
    const board = page.locator(".spectator-board .board-grid");
    await expect(board).toBeVisible();
    await expect
      .poll(async () => (await board.boundingBox())!.width)
      .toBeGreaterThanOrEqual(280);
    const tiles = page.locator(".spectator-tile .letter-tile");
    await expect(tiles).toHaveCount(3);
    const geometry = await tiles.evaluateAll((elements) =>
      elements.map((tile) => {
        const letter = tile.querySelector("b")!,
          value = tile.querySelector("small")!;
        const face = tile.getBoundingClientRect(),
          digit = value.getBoundingClientRect();
        const style = getComputedStyle(tile);
        const matrix = new DOMMatrix(
          getComputedStyle(tile.closest(".board-grid")!).transform,
        ).multiply(new DOMMatrix(style.transform));
        return {
          letter: letter.textContent,
          value: value.textContent,
          blank: tile.classList.contains("blank-tile"),
          width: face.width,
          height: face.height,
          background: style.backgroundColor,
          colour: style.color,
          valueRight: (digit.right - face.left) / face.width,
          valueBottom: (digit.bottom - face.top) / face.height,
          digitSize: parseFloat(getComputedStyle(value).fontSize),
          letterSize: parseFloat(getComputedStyle(letter).fontSize),
          a: matrix.a,
          b: matrix.b,
          c: matrix.c,
          d: matrix.d,
        };
      }),
    );
    for (const tile of geometry) {
      expect(tile.width).toBeGreaterThanOrEqual(15);
      expect(tile.height).toBeGreaterThanOrEqual(15);
      expect(tile.letterSize).toBeLessThan(tile.width);
      expect(tile.digitSize).toBeLessThan(tile.letterSize);
      expect(tile.valueRight).toBeGreaterThan(0.65);
      expect(tile.valueRight).toBeLessThanOrEqual(1);
      expect(tile.valueBottom).toBeGreaterThan(0.65);
      expect(tile.valueBottom).toBeLessThanOrEqual(1);
      expect(tile.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(tile.a).toBeCloseTo(1);
      expect(tile.b).toBeCloseTo(0);
      expect(tile.c).toBeCloseTo(0);
      expect(tile.d).toBeCloseTo(1);
    }
    expect(geometry.find((tile) => tile.blank)).toMatchObject({
      letter: "C",
      value: "0",
      background: "rgb(220, 238, 255)",
    });
    expect(
      geometry.filter((tile) => !tile.blank).map((tile) => tile.value),
    ).toEqual(["1", "1"]);
    await fitsWidth(page);
    await page.screenshot({
      path: info.outputPath(`history-tiles-${textSize}.png`),
      fullPage: true,
    });
    expect(writes).toEqual([]);
    expect(fixture.family.games[0]).toEqual(game);
  });
