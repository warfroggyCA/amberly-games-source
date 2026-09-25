import { expect, test, type Page } from "@playwright/test";

async function startPractice(page: Page, animate = false) {
  if (!animate) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "Reduced motion", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  }
  await page.getByRole("button", { name: /^Start (new )?practice$/ }).click();
}

test("fresh board, direction toggle, owned tile placement, undo, clear and solve", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Exercise the worker-limit UI deterministically; real simulation is benchmarked separately.
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      postMessage(message: { id: number; type: string }) {
        if (message.type === "strategy") {
          setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: {
                    id: message.id,
                    type: "error",
                    message: "Analysis reached its time budget.",
                  },
                }),
              ),
            0,
          );
        } else super.postMessage(message);
      }
    };
  });
  await page.goto("/gym-lab");
  await expect(
    page.getByRole("heading", { name: "Scrabble Gym", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "A cheerful dog lifting weights made from Scrabble letter tiles",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "How to play", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await startPractice(page);
  await expect(
    page.getByRole("group", { name: "Scrabble practice board", exact: true }),
  ).toBeVisible({ timeout: 25_000 });
  await expect(
    page.getByRole("button", { name: "Next random puzzle", exact: true }),
  ).toBeEnabled();
  const board = page.getByRole("group", {
    name: "Scrabble practice board",
    exact: true,
  });
  await expect(page.getByRole("radio")).toHaveCount(0);
  const initial = await board.locator(".has-tile").count();
  expect(initial).toBeGreaterThanOrEqual(4);
  const cells = await board.locator("button").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  expect(cells).toHaveLength(225);
  for (const cell of cells)
    expect(Math.abs(cell.width - cell.height)).toBeLessThan(1);
  // Fresh boards are random: use the first empty square with room below it.
  const square = await board
    .locator("button:not(.has-tile)")
    .evaluateAll((nodes) => {
      const node = nodes.find(
        (n) =>
          Number(n.getAttribute("data-row")) < 13 &&
          Number(n.getAttribute("data-col")) < 13,
      )!;
      return {
        row: node.getAttribute("data-row"),
        col: node.getAttribute("data-col"),
      };
    });
  const target = board.locator(
    `[data-row="${square.row}"][data-col="${square.col}"]`,
  );
  await target.click();
  const initialDirection = await page
    .locator(".gym-direction button")
    .innerText();
  await target.click();
  await expect(page.locator(".gym-direction button")).not.toHaveText(
    initialDirection,
  );
  if (await page.getByRole("button", { name: "→ Across", exact: true }).count())
    await page.getByRole("button", { name: "→ Across", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "↓ Down", exact: true }),
  ).toBeVisible();
  const usable = page.locator(
    '[data-gym-rack] button:not([disabled]):not([aria-label*="blank"])',
  );
  await usable.first().click();
  await usable.first().click();
  await expect(board.locator(".is-draft")).toHaveCount(2);
  await expect(page.locator(".gym-companion-image")).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(board.locator(".is-draft")).toHaveCount(1);
  await page.getByRole("button", { name: "Return all", exact: true }).click();
  await expect(board.locator(".is-cursor")).toHaveCount(0);
  await expect(board.locator(".is-draft")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Check move", exact: true }),
  ).toBeDisabled();
  expect(await board.locator(".has-tile").count()).toBe(initial);
  await expect(
    page.locator("[data-gym-rack] button:not([disabled])"),
  ).toHaveCount(7);
  await page.getByRole("button", { name: "Hint", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Hint 1/3", exact: true }),
  ).toBeVisible();
  const hints = page.getByRole("region", { name: "Revealed hints" });
  const firstHint = await hints.locator("li").first().innerText();
  await page.getByRole("button", { name: "Hint 1/3", exact: true }).click();
  await expect(hints.locator("li")).toHaveCount(2);
  await expect(hints.locator("li").first()).toHaveText(firstHint);
  await page
    .getByRole("button", { name: "Point to a square", exact: true })
    .click();
  await expect(board.locator(".is-hint-target")).toHaveCount(1);
  await expect(board.locator(".gym-hint-pointer")).toBeVisible();
  await expect(board.locator(".is-draft")).toHaveCount(0);
  await page.getByRole("button", { name: "Hint 2/3", exact: true }).click();
  await expect(hints.locator("li")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Hint 3/3", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Solve", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Highest-scoring placement",
      exact: true,
    }),
  ).toBeVisible();
  expect(await board.locator(".is-draft").count()).toBeGreaterThan(0);
  await expect(
    page
      .getByRole("group", { name: "Top scoring placements" })
      .getByRole("button"),
  ).toHaveCount(3);
  await page.getByRole("button", { name: /Silver · Option 2/ }).click();
  await expect(board.locator(".is-solution.solution-1")).not.toHaveCount(0);
  await page.getByRole("button", { name: /Bronze · Option 3/ }).click();
  await expect(board.locator(".is-solution.solution-2")).not.toHaveCount(0);
  await page.getByRole("button", { name: /Gold · Option 1/ }).click();
  const solution = await board.locator(".is-draft").evaluateAll((nodes) =>
    nodes.map((node) => ({
      row: node.getAttribute("data-row"),
      col: node.getAttribute("data-col"),
      letter: node.querySelector("b")!.textContent!,
      blank: node.querySelector("small")!.textContent === "0",
    })),
  );
  await page.getByRole("button", { name: "My move", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Shuffle rack", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /^Rack tile/ }).first(),
  ).toBeEnabled();
  await expect(board.locator(".is-draft")).toHaveCount(0);
  await expect(board.locator(".is-cursor")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Shuffle rack", exact: true }),
  ).toBeEnabled();

  for (const tile of solution) {
    await board
      .locator(`[data-row="${tile.row}"][data-col="${tile.col}"]`)
      .click();
    const name = new RegExp(
      `^Rack tile [1-7]: ${tile.blank ? "blank" : tile.letter}$`,
    );
    await page.getByRole("button", { name }).first().click();
    if (tile.blank)
      await page
        .getByRole("dialog")
        .getByRole("button", { name: tile.letter, exact: true })
        .click();
  }
  await expect(page.locator(".gym-move-badge")).toHaveClass(/is-valid/);
  await expect(
    page.locator(".gym-move-badge .gym-strength-bars .is-lit"),
  ).toHaveCount(5);
  await expect(page.locator(".gym-best-star")).toBeVisible();
  await expect(board.locator(".is-draft.medal-gold")).toHaveCount(
    solution.length,
  );
  await expect(page.locator(".gym-medal-badge")).toHaveText("🥇");
  const originalEntry = await board
    .locator(".is-draft")
    .evaluateAll((nodes) =>
      nodes.map((node) => [
        node.getAttribute("data-row"),
        node.getAttribute("data-col"),
        node.querySelector(".gym-tile")?.textContent,
      ]),
    );
  await page.getByRole("button", { name: "Solve", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Shuffle rack", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "My move", exact: true }).click();
  expect(
    await board
      .locator(".is-draft")
      .evaluateAll((nodes) =>
        nodes.map((node) => [
          node.getAttribute("data-row"),
          node.getAttribute("data-col"),
          node.querySelector(".gym-tile")?.textContent,
        ]),
      ),
  ).toEqual(originalEntry);
  await expect(
    page.getByRole("button", { name: "Check move", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Hint 3/3", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".gym-rack-tile.is-used").first()).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.locator(".gym-rack-tile.is-used").first()).toHaveCSS(
    "box-shadow",
    "none",
  );

  await page.locator(".gym-live-coaching summary").click();
  await expect(page.locator(".gym-live-coaching")).toContainText(
    /#1 of .* legal placements/,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Live score coaching", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator(".gym-strength-bars")).toHaveCount(0);
  await expect(board.locator(".is-draft.medal-gold")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Live score coaching", exact: true })
    .check();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator(".gym-tile.word-valid").first()).toBeVisible();
  await expect(page.locator(".gym-square.is-placement-error")).toHaveCount(0);
  await expect(
    page.locator(".gym-tile.word-invalid, .gym-tile.word-mixed"),
  ).toHaveCount(0);
  expect(
    await page.locator(".gym-rack-tile.is-used b").allTextContents(),
  ).toEqual(solution.map(() => ""));
  await expect(page.locator(".gym-live-validity")).toContainText(
    "Valid move:",
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: "Check move", exact: true }).click();
  await expect(page.getByText(/Maximum score · 100% of maximum/)).toBeVisible({
    timeout: 25_000,
  });
  await expect(
    page.getByRole("button", {
      name: "Compare strategy",
      exact: true,
    }),
  ).not.toBeVisible();
  await page.getByText("About strategy coaching", { exact: true }).click();
  await expect(page.getByText(/15-second analysis/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Compare strategy",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("meter")).toHaveAttribute(
    "value",
    (await page.getByRole("meter").getAttribute("max")) ?? "",
  );
  await page.getByRole("button", { name: "Shuffle rack", exact: true }).click();
  await expect(page.getByText(/Maximum score · 100% of maximum/)).toBeVisible();
  const draftCount = await board.locator(".is-draft").count();
  await page
    .getByRole("button", { name: "Compare strategy", exact: true })
    .click();
  await expect(page.locator(".gym-status[role=alert]")).toContainText(
    "Your exact score and tiles are unchanged",
  );
  await expect(page.getByText(/Maximum score · 100% of maximum/)).toBeVisible();
  await expect(board.locator(".is-draft")).toHaveCount(draftCount);
  const firstBoard = await board
    .locator(".has-tile:not(.is-draft)")
    .allTextContents();
  await page
    .getByRole("button", { name: "Next random puzzle", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Find your next move", exact: true }),
  ).toBeVisible({ timeout: 25_000 });
  const nextBoard = await board.locator(".has-tile").allTextContents();
  expect(nextBoard).not.toEqual(firstBoard);
  await expect(
    page.getByRole("region", { name: "Revealed hints" }),
  ).toHaveCount(0);
  await expect(board.locator(".is-hint-target")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("keyboard entry and help preserve an editable draft", async ({ page }) => {
  await page.goto("/gym-lab");
  await startPractice(page);
  const board = page.getByRole("group", {
    name: "Scrabble practice board",
    exact: true,
  });
  await expect(board).toBeVisible({ timeout: 25_000 });
  await board.locator("button:not(.has-tile)").first().press("Enter");
  const rack = page.locator(
    '[data-gym-rack] button:not([disabled]):not([aria-label*="blank"])',
  );
  await rack.first().press("Enter");
  await expect(board.locator(".is-draft")).toHaveCount(1);
  await page.getByRole("button", { name: "How to play", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(board.locator(".is-draft")).toHaveCount(1);
  await page.getByRole("button", { name: "Check move", exact: true }).click();
  // A random single tile may be legal or rejected, but the draft must survive either.
  await expect(
    page.getByRole("button", { name: "Check move", exact: true }),
  ).toBeEnabled({ timeout: 25_000 });
  await expect(board.locator(".is-draft")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).press("Enter");
  await expect(board.locator(".is-draft")).toHaveCount(0);
});

test("desktop board and rack controls fit the viewport", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Desktop height contract",
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/gym-lab");
  await startPractice(page, true);
  await expect(
    page.getByRole("group", { name: "Scrabble practice board" }),
  ).toBeVisible({ timeout: 25000 });
  const rect = await page
    .getByRole("button", { name: "Check move", exact: true })
    .boundingBox();
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(800);
  await expect(
    page.getByRole("img", { name: "Scarlett watching your practice" }),
  ).toBeVisible();
  await expect(page.locator(".gym-companion-image")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator(".gym-companion-image")).toHaveAttribute(
    "src",
    "/gym/scarlett-lift.webp",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Animate Scarlett", exact: true })
    .uncheck();
  await expect(page.locator(".gym-companion")).toHaveClass(/is-paused/);
  await expect(page.locator(".gym-companion-image")).toHaveAttribute(
    "src",
    "/gym/scarlett-lift-still.png",
  );
  await expect(page.locator(".gym-companion-image")).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("tile follows pointer during drag and invalid drops preserve the rack", async ({
  page,
}) => {
  await page.goto("/gym-lab");
  await startPractice(page);
  const board = page.getByRole("group", { name: "Scrabble practice board" });
  await expect(board).toBeVisible({ timeout: 25000 });
  const rack = page
    .locator('[data-gym-rack] button:not([aria-label*="blank"])')
    .first();
  await rack.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const source = (await rack.boundingBox())!;
  expect(Math.abs(source.width - source.height)).toBeLessThan(1);
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 30, source.y - 20, {
    steps: 5,
  });
  await expect(page.locator(".gym-drag-preview")).toBeVisible();
  await expect(rack.locator("b")).toBeHidden();
  await page.mouse.move(1, 1, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(".gym-drag-preview")).toHaveCount(0);
  await expect(board.locator(".is-draft")).toHaveCount(0);
  await expect(
    page.locator("[data-gym-rack] button:not([disabled])"),
  ).toHaveCount(7);
});

test("Undo restores moved tiles, Return all and shuffle; leaving has a safe way back", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Pointer action-history coverage",
  );
  await page.goto("/gym-lab");
  await startPractice(page);
  const board = page.getByRole("group", { name: "Scrabble practice board" });
  await expect(board).toBeVisible({ timeout: 25000 });
  const empty = board.locator("button:not(.has-tile)");
  const squares = await empty.evaluateAll((nodes) =>
    nodes.slice(0, 3).map((n) => ({
      row: n.getAttribute("data-row"),
      col: n.getAttribute("data-col"),
    })),
  );
  const at = (index: number) =>
    board.locator(
      `[data-row="${squares[index].row}"][data-col="${squares[index].col}"]`,
    );
  const available = page.locator(
    '[data-gym-rack] button:not([disabled]):not([aria-label*="blank"])',
  );
  await at(0).click();
  await available.first().click();
  await at(1).click();
  await available.first().click();
  await board.evaluate((n) => n.scrollIntoView({ block: "center" }));
  const start = (await at(0).boundingBox())!;
  const end = (await at(2).boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 8,
  });
  await expect(at(0).locator(".gym-tile")).toBeHidden();
  await expect(page.locator(".gym-drag-preview")).toBeVisible();
  await page.mouse.up();
  await expect(at(2)).toHaveClass(/is-draft/);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(at(0)).toHaveClass(/is-draft/);
  await expect(at(2)).not.toHaveClass(/is-draft/);
  await expect(board.locator(".is-draft")).toHaveCount(2);
  await page.getByRole("button", { name: "Return all", exact: true }).click();
  await expect(board.locator(".is-draft")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(board.locator(".is-draft")).toHaveCount(2);
  const order = await page
    .locator("[data-rack-id]")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-rack-id")));
  await expect(async () => {
    await page
      .getByRole("button", { name: "Shuffle rack", exact: true })
      .click();
    expect(
      await page
        .locator("[data-rack-id]")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-rack-id")),
        ),
    ).not.toEqual(order);
  }).toPass();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(
    await page
      .locator("[data-rack-id]")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-rack-id"))),
  ).toEqual(order);
  await page
    .getByRole("button", { name: "Back to Games", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Keep practising", exact: true })
    .click();
  await expect(board.locator(".is-draft")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Back to Games", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Leave practice", exact: true })
    .click();
  await expect(page).toHaveURL(/\/gym-lab\/games$/);
  await expect(board).toHaveCount(0);
  await page.getByRole("link", { name: "Open Gym", exact: true }).click();
  await startPractice(page);
  await expect(board).toBeVisible({ timeout: 25000 });
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
});

test("intro starts with clear squares and shuffle lifts tiles in depth", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Animation geometry coverage",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/gym-lab");
  await startPractice(page, true);
  const intro = page.locator(".gym-board.gym-intro");
  await expect(intro).toBeVisible({ timeout: 25000 });
  await expect(intro.locator(".has-tile")).toHaveCount(0);
  await expect(page.locator(".gym-board-scroll")).toHaveCSS("overflow", "clip");
  const colors = await intro.locator(".gym-tile").evaluateAll((nodes) =>
    nodes.map((n) => ({
      square: getComputedStyle(n.parentElement!).backgroundColor,
      tile: getComputedStyle(n).backgroundColor,
    })),
  );
  const flights = await intro.locator(".gym-tile").evaluateAll((nodes) =>
    nodes.map((n) => ({
      delay: getComputedStyle(n).animationDelay,
      x: getComputedStyle(n).getPropertyValue("--launch-x"),
    })),
  );
  expect(new Set(flights.map((f) => f.delay)).size).toBeGreaterThan(1);
  expect(new Set(flights.map((f) => f.x)).size).toBeGreaterThan(1);
  expect(colors.length).toBeGreaterThan(0);
  expect(colors.every((c) => c.square !== c.tile)).toBe(true);
  await page
    .getByRole("button", { name: "Skip animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Shuffle rack", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("[data-rack-id]")
        .evaluateAll((nodes) =>
          nodes.flatMap((n) =>
            n
              .getAnimations()
              .flatMap((a) =>
                (a.effect as KeyframeEffect)
                  .getKeyframes()
                  .map((f) => f.transform),
              ),
          ),
        ),
    )
    .toContainEqual(expect.stringContaining("rotateX(-12deg)"));
  await page
    .getByRole("button", { name: "Next random puzzle", exact: true })
    .click();
  await expect(intro).toBeVisible({ timeout: 25000 });
  await expect(intro.locator(".has-tile")).toHaveCount(0);
  await expect(page.locator(".gym-board-scroll")).toHaveCSS("overflow", "clip");
  await expect(intro).toHaveCount(0, { timeout: 4000 });
});

test("touch pickup clears the finger, and pulling a tile off the board returns it", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Chromium native touch injection",
  );
  await page.goto("/gym-lab");
  await startPractice(page);
  const board = page.getByRole("group", { name: "Scrabble practice board" });
  await expect(board).toBeVisible({ timeout: 25000 });
  const square = board.locator("button:not(.has-tile)").first();
  const rack = page
    .locator('[data-gym-rack] button:not([aria-label*="blank"])')
    .first();
  await square.click();
  await rack.click();
  const placed = board.locator(".is-draft");
  await expect(placed).toHaveCount(1);
  const source = (await placed.boundingBox())!;
  const x = source.x + source.width / 2,
    y = source.y + source.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  const ghost = page.locator(".gym-drag-preview.is-touch");
  await expect(ghost).toBeVisible();
  const box = (await ghost.boundingBox())!;
  expect(box.y + box.height).toBeLessThan(y);
  expect(box.width).toBeGreaterThan(source.width);
  const lift = y - (box.y + box.height / 2);
  expect(lift).toBeGreaterThan(40);
  // Touch hover previews the exact cell used on release, including blocked cells.
  const occupied = board.locator(".has-tile:not(.is-draft)").first();
  const occupiedBox = (await occupied.boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      {
        x: occupiedBox.x + occupiedBox.width / 2,
        y: occupiedBox.y + occupiedBox.height / 2 + lift,
      },
    ],
  });
  await expect(occupied).toHaveAttribute("data-drop-preview", "blocked");
  await expect(page.locator(".gym-drop-label")).toContainText("Occupied");
  const emptyDestination = board
    .locator("button:not(.has-tile):not(.is-draft)")
    .nth(2);
  const destination = board.locator(
    `[data-row="${await emptyDestination.getAttribute("data-row")}"][data-col="${await emptyDestination.getAttribute("data-col")}"]`,
  );
  const destinationBox = (await destination.boundingBox())!;
  const point = {
    x: destinationBox.x + destinationBox.width / 2,
    y: destinationBox.y + destinationBox.height / 2 + lift,
  };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point],
  });
  await expect(destination).toHaveAttribute("data-drop-preview", "ready");
  await expect(occupied).not.toHaveAttribute("data-drop-preview");
  await page.screenshot({
    path: testInfo.outputPath("touch-landing-preview.png"),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(destination).toHaveClass(/is-draft/);
  await expect(board.locator("[data-drop-preview]")).toHaveCount(0);
  await expect(ghost).toHaveCount(0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: point.x, y: point.y - lift }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 8, y: 180 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(placed).toHaveCount(0);
  await expect(ghost).toHaveCount(0);
  await expect(rack).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(placed).toHaveCount(1);
  // A direct rack return also works and remains undoable.
  const from = (await placed.boundingBox())!,
    to = (await page.locator("[data-gym-rack]").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(placed).toHaveCount(0);
});

test("placement errors wiggle continuously with a reduced-motion alternative", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Animation state coverage",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/gym-lab");
  await startPractice(page, true);
  const board = page.getByRole("group", { name: "Scrabble practice board" });
  await expect(board).toBeVisible({ timeout: 25000 });
  await page
    .getByRole("button", { name: "Skip animation", exact: true })
    .click();
  // Choose three empty corners, guaranteeing a non-collinear draft.
  const corners = await board.locator("button").evaluateAll((nodes) =>
    nodes
      .filter((n) => !n.classList.contains("has-tile"))
      .map((n) => ({
        row: Number(n.getAttribute("data-row")),
        col: Number(n.getAttribute("data-col")),
      })),
  );
  const a = corners[0],
    b = corners.find((p) => p.row === a.row && p.col !== a.col)!,
    c = corners.find((p) => p.row !== a.row)!;
  for (const p of [a, b, c]) {
    await board.locator(`[data-row="${p.row}"][data-col="${p.col}"]`).click();
    await page
      .locator(
        '[data-gym-rack] button:not([disabled]):not([aria-label*="blank"])',
      )
      .first()
      .click();
  }
  const warning = board.locator(".is-placement-error");
  await expect(warning).toHaveCount(3);
  await expect(page.locator(".gym-strength-bars")).toHaveCount(0);
  await expect(page.locator(".gym-move-badge")).toHaveText(
    "× Invalid placement",
  );
  await expect(warning.first().locator(".gym-tile")).toHaveCSS(
    "animation-iteration-count",
    "infinite",
  );
  await expect(
    board.locator(".has-tile:not(.is-draft).is-placement-error"),
  ).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(warning.first().locator(".gym-tile")).toHaveCSS(
    "animation-iteration-count",
    "infinite",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Reduced motion", exact: true })
    .check();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(warning.first().locator(".gym-tile")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(warning.first()).toHaveCSS("outline-style", "dashed");
  await page.getByRole("button", { name: "Return all", exact: true }).click();
  await expect(warning).toHaveCount(0);
});

test("local game chooser opens Gym and Back to Games returns to it", async ({
  page,
}) => {
  await page.goto("/gym-lab/games");
  await expect(
    page.getByRole("heading", { name: "Scrabble", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Crokinole", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Scrabble Gym", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open Gym", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Start (new )?practice$/ }),
  ).toBeVisible();
  await expect(page.locator(".gym-welcome img")).toHaveAttribute(
    "src",
    "/gym/scarlett-lift.webp",
  );
  await page.getByRole("link", { name: "Back to Games", exact: true }).click();
  await expect(page).toHaveURL(/\/gym-lab\/games$/);
});

test("family game selection offers Gym alongside existing games and returns correctly", async ({
  page,
}) => {
  const { installFixture } = await import("./fixtures/crokinole");
  await installFixture(page);
  await page.goto("/family");
  await expect(
    page.getByRole("heading", { name: "What are we playing?", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Scrabble Gym", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open Gym", exact: true }).click();
  await expect(page).toHaveURL(/\/gym-lab\?from=family$/);
  await page.getByRole("link", { name: "Back to Games", exact: true }).click();
  await expect(page).toHaveURL(/\/family$/);
  await expect(
    page.getByRole("heading", { name: "Crokinole", exact: true }),
  ).toBeVisible();
});

// Exercise the real worker separately from the injected timeout case above.
test("sampled strategy returns useful feedback and preserves the draft", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    let stalled = false;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          // Keep the real early result available long enough to exercise acceptance.
          if (event.data.type === "strategy") event.stopImmediatePropagation();
        });
      }
      postMessage(message: { id: number; type: string; seed?: string }) {
        // Keep this success-path check reproducible under concurrent browser load.
        // Random positions and budget exhaustion are covered separately.
        if (message.type === "generate")
          message = { ...message, seed: "gym-feasibility-v1-0" };
        if (message.type === "strategy" && !stalled) {
          stalled = true;
          setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: {
                    id: message.id,
                    type: "progress",
                    progress: { phase: "validation", percentage: 75 },
                  },
                }),
              ),
            50,
          );
          return;
        }
        super.postMessage(message);
      }
    };
  });
  await page.goto("/gym-lab");
  await startPractice(page);
  const board = page.getByRole("group", {
    name: "Scrabble practice board",
    exact: true,
  });
  await expect(board).toBeVisible({ timeout: 25000 });
  await page.getByRole("button", { name: "Solve", exact: true }).click();
  await page.getByRole("button", { name: /Bronze · Option/ }).click();
  const solution = await board.locator(".is-draft").evaluateAll((nodes) =>
    nodes.map((node) => ({
      row: node.getAttribute("data-row"),
      col: node.getAttribute("data-col"),
      letter: node.querySelector("b")!.textContent!,
      blank: node.querySelector("small")!.textContent === "0",
    })),
  );
  await page.getByRole("button", { name: "My move", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Shuffle rack", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /^Rack tile/ }).first(),
  ).toBeEnabled();
  await expect(board.locator(".is-draft")).toHaveCount(0);
  await expect(board.locator(".is-cursor")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Shuffle rack", exact: true }),
  ).toBeEnabled();

  for (const tile of solution) {
    await board
      .locator(`[data-row="${tile.row}"][data-col="${tile.col}"]`)
      .click();
    const name = new RegExp(
      `^Rack tile [1-7]: ${tile.blank ? "blank" : tile.letter}$`,
    );
    await page.getByRole("button", { name }).first().click();
    if (tile.blank)
      await page
        .getByRole("dialog")
        .getByRole("button", { name: tile.letter, exact: true })
        .click();
  }

  const readDraft = () =>
    board.locator(".is-draft").evaluateAll((nodes) =>
      nodes.map((node) => ({
        row: node.getAttribute("data-row"),
        col: node.getAttribute("data-col"),
        tile: node.querySelector(".gym-tile")?.textContent,
      })),
    );
  const draft = await readDraft();
  await page.getByRole("button", { name: "Check move", exact: true }).click();
  await page.getByText("About strategy coaching", { exact: true }).click();
  await page
    .getByRole("button", { name: "Compare strategy", exact: true })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "Strategy comparison progress" }),
  ).toBeVisible();
  await expect(page.locator(".gym-status")).toContainText("Thinking…");
  await expect(
    page.getByRole("progressbar", { name: "Strategy comparison progress" }),
  ).toHaveAttribute("value", "75");
  await expect(page.locator(".gym-status")).toContainText(
    "Trying a few more replies",
  );
  await expect(page.locator(".gym-status")).not.toContainText(
    "samples checked",
  );
  await expect(
    page.getByRole("button", { name: "Answer now", exact: true }),
  ).toBeDisabled();
  await page.clock.install();
  await page.clock.fastForward(19000);
  await expect(page.locator(".gym-status")).toContainText("Thinking…");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await readDraft()).toEqual(draft);
  await page
    .getByRole("button", { name: "Compare strategy", exact: true })
    .click();
  const answerNow = page.getByRole("button", {
    name: "Answer now",
    exact: true,
  });
  await expect(answerNow).toBeEnabled({ timeout: 25000 });
  await answerNow.click();
  const feedback = page.getByRole("region", {
    name: "Strategy comparison",
    exact: true,
  });
  await expect(feedback).toBeVisible({ timeout: 20000 });
  await expect(feedback).toContainText("Quick comparison");
  await expect(
    feedback.getByRole("button", { name: /Your move/ }),
  ).toBeVisible();
  await expect(
    feedback.getByRole("button", { name: /Another option/ }),
  ).toBeVisible();
  await expect(board.locator(".is-draft.comparison-requested")).toHaveCount(
    draft.length,
  );
  await feedback.getByRole("button", { name: /Another option/ }).click();
  await expect(board.locator(".comparison-recommended").first()).toBeVisible();
  await feedback.getByRole("button", { name: /Your move/ }).click();
  expect(await readDraft()).toEqual(draft);
  await expect(feedback.locator(".gym-strategy-takeaways")).toBeVisible();
  await feedback.screenshot({ path: info.outputPath("strategy-feedback.png") });
  await page.screenshot({
    path: info.outputPath("strategy-with-board.png"),
    fullPage: true,
  });
  expect(await readDraft()).toEqual(draft);
  await feedback
    .getByRole("button", { name: "Back to my move", exact: true })
    .click();
  expect(await readDraft()).toEqual(draft);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(feedback).toHaveCount(0);
});
