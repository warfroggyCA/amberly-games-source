import { test, expect } from "@playwright/test";
import { applyCommand, createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import type { Letter } from "../../src/domain/types";

function games() {
  const made = createGame({
    id: "bingo-banner-test",
    players: [
      { id: "ada", name: "Ada", seat: 0 },
      { id: "ben", name: "Ben", seat: 2 },
    ],
    firstPlayerId: "ada",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw Error(made.error.message);
  const result = applyCommand(
    made.game,
    {
      type: "play",
      id: "bingo-reading",
      expectedRevision: 0,
      placements: [..."READING"].map((letter, index) => ({
        row: 7,
        col: 7 + index,
        tile: { letter: letter as Letter, blank: false },
      })),
    },
    testLexicon,
  );
  if (!result.ok) throw Error(result.error.message);
  expect(result.game.turns[0].score).toBe(70);
  return { empty: made.game, played: result.game };
}

test("scorer celebrates a saved bingo, not a draft, and can dismiss it", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New preview game/ }).click();
  for (const name of ["Ada", "Ben"]) {
    await page.getByRole("textbox", { name: "Player name" }).fill(name);
    await page.getByRole("button", { name: "Add player", exact: true }).click();
  }
  await page.getByLabel("Who plays first?").selectOption({ label: "Ada" });
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByTestId("cell-H8").click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .pressSequentially("READING");
  const banner = page.getByRole("complementary", { name: "Bingo celebration" });
  await expect(banner).toHaveCount(0);
  await page.getByRole("button", { name: "Review turn", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await page
    .getByRole("button", { name: "Record 70 points", exact: true })
    .click();
  await expect(banner).toContainText("Ada played all seven tiles");
  await expect(banner.locator("p").first()).toHaveCSS(
    "color",
    "rgb(255, 249, 233)",
  );
  await expect(banner).toHaveCSS("animation-name", "none");
  await expect(banner).toContainText("70 points · includes the 50-point bonus");
  const box = await banner.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThan(viewport.height);
  await page.screenshot({ path: info.outputPath("bingo.png") });
  await banner.screenshot({ path: info.outputPath("banner.png") });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(banner.locator(".bingo-celebration-tile").first()).toHaveCSS(
    "animation-name",
    "bingo-tile-pop",
  );
  await expect(banner.locator(".bingo-celebration-tile").last()).toHaveCSS(
    "opacity",
    "1",
  );
  await page.getByRole("button", { name: "Dismiss bingo celebration" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await expect(banner).toHaveCount(0);
});

test("viewer celebrates once, removes an undone bingo, and never replays on refresh", async ({
  page,
}) => {
  const { empty, played } = games();
  let game = empty;
  await page.route("**/api/watch", (r) => r.fulfill({ json: { game } }));
  await page.route("**/api/watch/draft", (r) =>
    r.fulfill({ json: { draft: null } }),
  );
  await page.goto(`/watch#${"a".repeat(64)}`);
  await expect(
    page.getByRole("region", { name: "Live game viewer" }),
  ).toBeVisible();
  const banner = page.getByRole("complementary", { name: "Bingo celebration" });
  await expect(banner).toHaveCount(0);
  game = played;
  await expect(banner).toContainText("70 points");
  game = empty;
  await expect(banner).toHaveCount(0);
  game = played;
  await expect(page.getByLabel(/Ada, 70 points/).first()).toBeVisible();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Live game viewer" }),
  ).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test("a seven-letter word made with fewer than seven new tiles is not a bingo", async ({
  page,
}) => {
  const { empty } = games();
  const read = applyCommand(
    empty,
    {
      type: "play",
      id: "read",
      expectedRevision: 0,
      placements: [..."READ"].map((letter, index) => ({
        row: 7,
        col: 7 + index,
        tile: { letter: letter as Letter, blank: false },
      })),
    },
    testLexicon,
  );
  if (!read.ok) throw Error(read.error.message);
  const reading = applyCommand(
    read.game,
    {
      type: "play",
      id: "ing",
      expectedRevision: 1,
      placements: [..."ING"].map((letter, index) => ({
        row: 7,
        col: 11 + index,
        tile: { letter: letter as Letter, blank: false },
      })),
    },
    testLexicon,
  );
  if (!reading.ok) throw Error(reading.error.message);
  expect(reading.game.turns.at(-1)!.bingo).toBe(false);
  let game = read.game;
  await page.route("**/api/watch", (r) => r.fulfill({ json: { game } }));
  await page.route("**/api/watch/draft", (r) =>
    r.fulfill({ json: { draft: null } }),
  );
  await page.goto(`/watch#${"a".repeat(64)}`);
  await expect(
    page.getByRole("region", { name: "Live game viewer" }),
  ).toBeVisible();
  game = reading.game;
  await expect(page.getByLabel(/Ben, 10 points/).first()).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Bingo celebration" }),
  ).toHaveCount(0);
});

test("bingo celebration expires despite repeated viewer polls", async ({
  page,
}) => {
  const { empty, played } = games();
  let game = empty;
  await page.route("**/api/watch", (r) => r.fulfill({ json: { game } }));
  await page.route("**/api/watch/draft", (r) =>
    r.fulfill({ json: { draft: null } }),
  );
  await page.goto(`/watch#${"a".repeat(64)}`);
  await expect(
    page.getByRole("region", { name: "Live game viewer" }),
  ).toBeVisible();
  game = played;
  const banner = page.getByRole("complementary", { name: "Bingo celebration" });
  await expect(banner).toBeVisible();
  await expect(banner).toHaveCount(0, { timeout: 12000 });
});
