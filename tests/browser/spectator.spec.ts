import { test, expect } from "@playwright/test";
import { createGame, applyCommand } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import type { LiveDraft } from "../../src/lib/live-draft";

test("viewer keeps provisional points separate, reconnects, and clears word selection", async ({
  page,
}) => {
  const created = createGame({
    id: "viewer-regression",
    players: [
      { id: "ada", name: "Ada", seat: 0 },
      { id: "ben", name: "Ben", seat: 2 },
    ],
    firstPlayerId: "ada",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!created.ok) throw new Error(created.error.message);
  const played = applyCommand(
    created.game,
    {
      type: "play",
      id: "play-cat",
      expectedRevision: 0,
      placements: (["C", "A", "T"] as const).map((letter, index) => ({
        row: 7,
        col: 7 + index,
        tile: { letter, blank: false },
      })),
    },
    testLexicon,
  );
  if (!played.ok) throw new Error(played.error.message);
  const game = { ...played.game, scorerGeneration: 1 };
  let draft: LiveDraft | null = {
    gameId: game.id,
    revision: game.revision,
    generation: 1,
    playerId: "ben",
    placements: [{ row: 7, col: 10, tile: { letter: "S", blank: false } }],
    score: 6,
    valid: true,
    expiresAt: new Date(Date.now() + 11000).toISOString(),
  };
  let disconnected = false;
  await page.route("**/api/watch", (route) =>
    disconnected ? route.abort() : route.fulfill({ json: { game } }),
  );
  await page.route("**/api/watch/draft", (route) =>
    disconnected
      ? route.abort()
      : route.fulfill({
          json: { revision: game.revision, generation: 1, draft },
        }),
  );
  await page.goto(`/watch#${"a".repeat(64)}`);
  await expect(
    page.getByRole("region", { name: "Live game viewer" }),
  ).toBeVisible();
  await expect(
    page.getByText("Ben is placing tiles", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Ben, 0 points, playing now/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Provisional tile, not recorded. K8 S/ }),
  ).toBeVisible();
  draft = null;
  await expect(
    page.getByRole("button", { name: /Provisional tile, not recorded/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /H8 C, 3 points. View CAT/ }).click();
  await expect(
    page.getByRole("complementary", { name: "CAT word details" }),
  ).toBeVisible();
  await page.getByLabel("A1 empty", { exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "CAT word details" }),
  ).toHaveCount(0);
  disconnected = true;
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    /Reconnecting/,
    {
      timeout: 12000,
    },
  );
  await expect(
    page.getByRole("button", { name: /H8 C, 3 points. View CAT/ }),
  ).toBeVisible();
  disconnected = false;
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0, {
    timeout: 12000,
  });
  await expect(
    page.getByRole("button", { name: /Review turn|Undo last turn|End game/ }),
  ).toHaveCount(0);
});
