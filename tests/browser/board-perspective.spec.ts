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

async function fixture(
  page: Page,
  scorer: boolean,
  playerId: string | null,
  game = timedGame(),
) {
  const fixture = await installFixture(page);
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
  return { family: fixture.family, game, saved: JSON.stringify(game) };
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

for (const [playerId, name, turns] of [
  ["doug", "Doug", "2"],
  ["erin", "Erin", "1"],
  ["nate", "Nate", "0"],
  ["cristine", "Cristine", "3"],
] as const)
  test(`viewer ${name} keeps canonical board and animated tiles with own seat below`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const { family, game, saved } = await fixture(page, false, playerId);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        /\/api\/family(?:\/draft)?(?:\?|$)/.test(request.url()) &&
        request.method() !== "GET"
      )
        writes.push(request.url());
    });
    const board = page.getByRole("region", { name: "Live game viewer" });
    await expect(board).toHaveAttribute("data-board-perspective", turns);
    await boardLayout(
      page,
      board,
      board.locator(".spectator-seat-2").filter({ hasText: name }),
    );
    await upright(board.getByRole("grid"));
    const cat = board.getByRole("button", { name: /^H8 C, 3 points/ });
    await upright(cat.locator(".letter-tile"));
    await upright(board.locator(".premium-label").first());
    const cells = await Promise.all(
      ["7:7", "7:8", "8:7"].map((cell) =>
        board.locator(`[data-turn-cell="${cell}"]`).boundingBox(),
      ),
    );
    expect(cells[1]!.x).toBeGreaterThan(cells[0]!.x);
    expect(cells[1]!.y).toBeCloseTo(cells[0]!.y, 0);
    expect(cells[2]!.y).toBeGreaterThan(cells[0]!.y);
    const next = applyCommand(
      game,
      {
        type: "play",
        id: "viewer-animation",
        timedAt: new Date().toISOString(),
        expectedRevision: game.revision,
        placements: [{ row: 7, col: 10, tile: { letter: "S", blank: false } }],
      },
      testLexicon,
    );
    if (!next.ok) throw new Error(next.error.message);
    family.games = [next.game];
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    const flying = page.locator(".turn-flying-tile").first();
    await expect(flying).toBeVisible();
    await upright(board.getByRole("grid"));
    await expect(page.locator(".turn-flying-tile")).toHaveCount(0);
    await upright(board.locator('[data-turn-cell="7:10"] .letter-tile'));
    expect(JSON.stringify(game)).toBe(saved);
    expect(family.games[0]).toEqual(next.game);
    expect(writes).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`viewer-${playerId}-upright.png`),
    });
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
  await upright(board.getByRole("grid"));
  await upright(board.locator(".premium-label").first());
  const [h8, i8, h9] = await Promise.all(
    ["7:7", "7:8", "8:7"].map((cell) =>
      board.locator(`[data-turn-cell="${cell}"]`).boundingBox(),
    ),
  );
  expect(i8!.x).toBeGreaterThan(h8!.x);
  expect(i8!.y).toBeCloseTo(h8!.y, 0);
  expect(h9!.y).toBeGreaterThan(h8!.y);
  await upright(
    board
      .getByRole("button", { name: /^H8 C, 3 points/ })
      .locator(".letter-tile"),
  );
});

test("viewer refresh preserves game while the scorer keeps an unsaved entry", async ({
  page,
  browser,
}) => {
  const game = timedGame();
  const scorer = await browser.newPage();
  let releaseSave!: () => void;
  const savePending = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saves = 0;
  try {
    await fixture(scorer, true, "doug", game);
    await scorer.route("**/api/family/draft*", async (route) => {
      if (route.request().method() === "POST") {
        saves++;
        await savePending;
        await route.fulfill({ json: { accepted: true } });
      } else await route.fulfill({ json: { draft: null } });
    });
    await scorer.getByTestId("cell-H7").click();
    const input = scorer.getByRole("textbox", {
      name: "Type letters on the board",
    });
    await input.pressSequentially("E");
    await expect(scorer.getByTestId("cell-H7")).toHaveAccessibleName(
      "H7 E, 1 points",
    );
    await expect.poll(() => saves).toBeGreaterThan(0);
    const viewer = await fixture(page, false, "erin", game);
    const board = page.getByRole("region", { name: "Live game viewer" });
    await upright(board.getByRole("grid"));
    const before = await board.locator("[data-turn-score]").allTextContents();
    await page.reload();
    await upright(board.getByRole("grid"));
    await expect(board.locator(".letter-tile")).toHaveCount(3);
    expect(await board.locator("[data-turn-score]").allTextContents()).toEqual(
      before,
    );
    await expect(
      page.getByLabel("Current turn elapsed time", { exact: true }),
    ).toBeVisible();
    await expect(scorer.getByTestId("cell-H7")).toHaveAccessibleName(
      "H7 E, 1 points",
    );
    expect(JSON.stringify(viewer.family.games[0])).toBe(viewer.saved);
    releaseSave();
  } finally {
    releaseSave();
    await scorer.close();
  }
});
