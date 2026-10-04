import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  applyCommand,
  createGame,
  type GameCommand,
} from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { installFixture, fitsWidth } from "./fixtures/crokinole";

function timedGame() {
  const now = Date.now();
  const made = createGame({
    id: "perspective-game",
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 1 },
      { id: "nate", name: "Nate", seat: 2 },
      { id: "cristine", name: "Cristine", seat: 3 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
    createdAt: new Date(now - 120000).toISOString(),
  });
  if (!made.ok) throw new Error(made.error.message);
  let game = made.game;
  for (const command of [
    {
      type: "start-clock",
      id: "start",
      expectedRevision: 0,
      timedAt: new Date(now - 120000).toISOString(),
    },
    {
      type: "play",
      id: "cat",
      expectedRevision: 1,
      timedAt: new Date(now - 60000).toISOString(),
      placements: (["C", "A", "T"] as const).map((letter, index) => ({
        row: 7,
        col: 7 + index,
        tile: { letter, blank: false },
      })),
    },
  ] as GameCommand[]) {
    const result = applyCommand(game, command, testLexicon);
    if (!result.ok) throw new Error(result.error.message);
    game = result.game;
  }
  return game;
}

async function fixture(page: Page, scorer: boolean, playerId: string | null) {
  const fixture = await installFixture(page);
  const game = timedGame();
  fixture.family.member.playerId = playerId;
  fixture.family.games = [game];
  fixture.family.gameAccess[game.id] = {
    scorerUserId: scorer
      ? fixture.family.member.userId
      : "44444444-4444-4444-8444-444444444444",
    deviceId: "initial-device",
    generation: 1,
    mode: "confirmed",
    recordsEligible: false,
    protests: [],
    canScore: scorer,
    approvals: [],
  };
  await page.route("**/api/family/draft*", (route) =>
    route.fulfill({
      json:
        route.request().method() === "POST"
          ? { accepted: true }
          : { draft: null },
    }),
  );
  await page.goto("/family/scrabble?view=play");
  return { game, saved: JSON.stringify(game) };
}

async function upright(tile: Locator) {
  // Wait for any tile-entry animation to settle before checking orientation.
  await expect
    .poll(() =>
      tile.evaluate((element) => {
        let result = new DOMMatrix();
        for (
          let node: Element | null = element;
          node;
          node = node.parentElement
        ) {
          const transform = getComputedStyle(node).transform;
          if (transform !== "none")
            result = new DOMMatrix(transform).multiply(result);
        }
        return [result.a, result.b, result.c, result.d].map(
          (value) => Math.round(value * 1000) / 1000 || 0,
        );
      }),
    )
    .toEqual([1, 0, 0, 1]);
}

async function boardLayout(page: Page, board: Locator, seat: Locator) {
  const grid = board.getByRole("grid");
  await expect(seat).toBeVisible();
  const [gridBox, seatBox] = await Promise.all([
    grid.boundingBox(),
    seat.boundingBox(),
  ]);
  expect(gridBox).not.toBeNull();
  expect(seatBox).not.toBeNull();
  expect(seatBox!.y + seatBox!.height / 2).toBeGreaterThan(
    gridBox!.y + gridBox!.height / 2,
  );
  const clock = page.getByLabel("Current turn elapsed time", { exact: true });
  await expect(clock).toBeVisible();
  const clockBox = await clock.boundingBox();
  expect(clockBox!.y).toBeLessThan(gridBox!.y);
  expect(clockBox!.x).toBeLessThan(gridBox!.x + gridBox!.width / 2);
  await expect(
    board.locator(".is-current").getByLabel("Player accrued time"),
  ).toBeVisible();
  await expect(page.getByLabel("Current turn elapsed time")).toHaveCount(1);
  await fitsWidth(page);
}

test("signed-in spectator sees their seat below the board with upright canonical letters and separate timers", async ({
  page,
}) => {
  const { game, saved } = await fixture(page, false, "erin");
  const board = page.getByRole("region", { name: "Live game viewer" });
  await expect(board).toHaveAttribute("data-board-perspective", "1");
  await boardLayout(
    page,
    board,
    board.locator(".spectator-seat-2").filter({ hasText: "Erin" }),
  );
  await expect(board.getByText("You · seat 2", { exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("viewer-perspective.png"),
  });
  const cat = board.getByRole("button", { name: /^H8 C, 3 points/ });
  await expect(cat).toBeVisible();
  await upright(cat.locator(".letter-tile"));
  await cat.click();
  await expect(
    page.getByRole("complementary", { name: "CAT word details" }),
  ).toBeVisible();
  expect(JSON.stringify(game)).toBe(saved);
});

test("signed-in scorer has local arrow navigation and upright letters without rotating saved coordinates", async ({
  page,
}) => {
  const { game, saved } = await fixture(page, true, "doug");
  const board = page.getByRole("region", { name: "Scrabble board and entry" });
  await expect(board).toHaveAttribute("data-board-perspective", "2");
  await boardLayout(
    page,
    board,
    board.locator(".board-seat-2").filter({ hasText: "Doug" }),
  );
  await expect(board.getByText("You · seat 1", { exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("scorer-perspective.png"),
  });
  await expect(page.getByTestId("cell-H8")).toHaveAccessibleName(
    "H8 C, 3 points",
  );
  await upright(page.getByTestId("cell-H8").locator(".letter-tile"));
  await page.getByTestId("cell-H7").click();
  const input = page.getByRole("textbox", {
    name: "Type letters on the board",
  });
  await input.press("ArrowRight");
  await expect(page.getByTestId("cell-G7")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await input.press("ArrowDown");
  await expect(page.getByTestId("cell-G6")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await input.pressSequentially("E");
  await expect(page.getByTestId("cell-G6")).toHaveAccessibleName(
    "G6 E, 1 points",
  );
  await upright(page.getByTestId("cell-G6").locator(".letter-tile"));
  expect(JSON.stringify(game)).toBe(saved);
});

test("signed-in viewer without a linked seat retains the canonical perspective", async ({
  page,
}) => {
  await fixture(page, false, null);
  const board = page.getByRole("region", { name: "Live game viewer" });
  await expect(board).toHaveAttribute("data-board-perspective", "0");
  await expect(board.locator(".viewer-seat-label")).toHaveCount(0);
  await expect(board.locator(".spectator-seat-0")).toContainText("Doug");
  await upright(
    board
      .getByRole("button", { name: /^H8 C, 3 points/ })
      .locator(".letter-tile"),
  );
});
