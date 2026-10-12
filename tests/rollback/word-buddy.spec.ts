import { expect, test } from "@playwright/test";
import { applyCommand, createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { installFixture } from "../browser/fixtures/crokinole";

for (const held of [false, true]) {
  test(`compatible fallback keeps existing Word Buddy game and recovery hold=${held}`, async ({
    page,
  }, info) => {
    const f = await installFixture(page);
    const made = createGame({
      id: "rollback-buddy",
      wordBuddy: true,
      players: [
        { id: "doug", name: "Doug", seat: 0 },
        { id: "erin", name: "Erin", seat: 2 },
      ],
      firstPlayerId: "doug",
      direction: "clockwise",
      lexicon: testLexicon,
    });
    if (!made.ok) throw Error(made.error.message);
    const started = applyCommand(
      made.game,
      {
        type: "start-clock",
        id: "clock",
        expectedRevision: 0,
        timedAt: new Date().toISOString(),
      },
      testLexicon,
    );
    if (!started.ok) throw Error(started.error.message);
    f.family.games = [started.game];
    f.family.gameAccess[made.game.id] = {
      scorerUserId: f.family.member.userId,
      deviceId: "fixture",
      generation: 1,
      mode: "confirmed",
      recordsEligible: false,
      protests: [],
      canScore: true,
      approvals: [],
    };
    const posts: unknown[] = [];
    await page.route("**/api/family/draft*", (route) => {
      if (route.request().method() === "POST")
        posts.push(route.request().postDataJSON());
      return route.fulfill({
        json:
          route.request().method() === "POST"
            ? { accepted: true }
            : { draft: null },
      });
    });
    await page.goto("/family/scrabble");
    await page.locator(".game-list button").first().click();
    await expect(
      page.getByText("Word Buddy tools paused", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Test words", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Word Buddy ·/ }),
    ).toHaveCount(0);
    const board = await page.getByRole("grid").boundingBox();
    expect(board!.width).toBeGreaterThanOrEqual(190);
    await page.screenshot({ path: info.outputPath("compatible-fallback.png") });
    if (held) {
      await page.getByTestId("cell-H8").click();
      await page.locator(".board-input").fill("CAT");
      await expect.poll(() => posts.length).toBeGreaterThan(0);
      await page.evaluate(
        (scope) =>
          sessionStorage.setItem(
            "amberly.word-buddy-sharing-holds.v1",
            JSON.stringify([scope]),
          ),
        `${f.family.member.userId}:${made.game.id}`,
      );
      await page.reload();
      await page
        .getByRole("button", { name: "Return to game", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Resume live draft" }),
      ).toBeVisible();
      await expect(page.getByRole("grid")).toHaveCount(0);
      const count = posts.length;
      await page.waitForTimeout(800);
      expect(posts).toHaveLength(count);
      await page.getByRole("button", { name: "Resume live draft" }).click();
      await expect(page.locator(".square.fresh")).toHaveCount(3);
      await expect.poll(() => posts.length).toBeGreaterThan(count);
      expect(JSON.stringify(posts.at(-1))).toContain('"letter":"C"');
    }
    await expect(page.getByRole("grid")).toBeVisible();
    expect(f.family.games[0].definition.wordBuddy).toBe(true);
  });
}
