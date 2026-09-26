import {
  expect,
  test,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";

async function startPractice(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/gym-lab");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Reduced motion", exact: true })
    .check();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: /^Start (new )?practice$/ }).click();
  const board = page.getByRole("group", {
    name: "Scrabble practice board",
    exact: true,
  });
  await expect(board).toBeVisible({ timeout: 25_000 });
  return board;
}

async function pickUp(page: Page, cdp: CDPSession, source?: Locator) {
  const rack =
    source ??
    page
      .locator(
        '[data-gym-rack] button:not([disabled]):not([aria-label*="blank"])',
      )
      .first();
  await rack.scrollIntoViewIfNeeded();
  const rect = (await rack.boundingBox())!;
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  const ghost = page.locator(".gym-drag-preview.is-touch");
  await expect(ghost).toBeVisible();
  const lifted = (await ghost.boundingBox())!;
  return {
    source: rack,
    lift: point.y - lifted.y - lifted.height / 2,
    start: point,
  };
}

async function moveTo(
  cdp: CDPSession,
  aim: { x: number; y: number },
  lift: number,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: aim.x, y: aim.y + lift }],
  });
}

async function visibleSquare(board: Locator, lift: number, occupied = false) {
  const square = await board
    .locator(
      occupied
        ? ".has-tile:not(.is-draft)"
        : "button:not(.has-tile):not(.is-draft)",
    )
    .evaluateAll((nodes, offset) => {
      const viewport = nodes[0]
        ?.closest(".gym-board-scroll")
        ?.getBoundingClientRect();
      return nodes
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            row: node.getAttribute("data-row"),
            col: node.getAttribute("data-col"),
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          };
        })
        .filter(
          (point) =>
            point.x > 10 &&
            point.x < innerWidth - 10 &&
            point.y > 12 &&
            point.y + offset < innerHeight - 12 &&
            viewport &&
            point.x > viewport.left &&
            point.x < viewport.right &&
            point.y > viewport.top &&
            point.y < viewport.bottom,
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - innerWidth / 2, a.y - innerHeight / 2) -
            Math.hypot(b.x - innerWidth / 2, b.y - innerHeight / 2),
        )[0];
    }, lift);
  expect(square).toBeTruthy();
  return {
    ...square,
    locator: board.locator(
      `[data-row="${square.row}"][data-col="${square.col}"]`,
    ),
  };
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Native multi-point touch injection uses Chromium CDP; physical Safari acceptance remains separate.",
  );
});

test("phone touch zoom preserves the shown drop square, blocked drops and Undo", async ({
  page,
  context,
}, info) => {
  const board = await startPractice(page);
  const cdp = await context.newCDPSession(page);
  const drag = await pickUp(page, cdp);
  const original = (await board.boundingBox())!;
  const square = await visibleSquare(board, drag.lift);
  await moveTo(cdp, square, drag.lift);
  await expect(page.locator('[data-gym-drag-zoom="active"]')).toBeVisible();
  expect((await board.boundingBox())!.width).toBeCloseTo(original.width * 2, 0);
  await expect(square.locator).toHaveAttribute("data-drop-preview", "ready");
  await page.screenshot({ path: info.outputPath("phone-drag-zoom.png") });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(square.locator).toHaveClass(/is-draft/);
  await expect(page.locator("[data-gym-drag-zoom]")).toHaveCount(0);
  await expect(page.locator(".gym-drag-preview")).toHaveCount(0);
  expect((await board.boundingBox())!.width).toBeCloseTo(original.width, 0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(board.locator(".is-draft")).toHaveCount(0);
  await expect(drag.source).toBeEnabled();

  const blockedDrag = await pickUp(page, cdp);
  const occupied = await visibleSquare(board, blockedDrag.lift, true);
  await moveTo(cdp, occupied, blockedDrag.lift);
  await expect(occupied.locator).toHaveAttribute(
    "data-drop-preview",
    "blocked",
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(board.locator(".is-draft")).toHaveCount(0);
  await expect(blockedDrag.source).toBeEnabled();
  await expect(page.locator("[data-gym-drag-zoom]")).toHaveCount(0);
});

test("phone drag pans to both board corners and releases into the last highlighted square", async ({
  page,
  context,
}) => {
  const board = await startPractice(page);
  const cdp = await context.newCDPSession(page);
  const drag = await pickUp(page, cdp);
  const original = (await board.boundingBox())!;
  const square = await visibleSquare(board, drag.lift);
  await moveTo(cdp, square, drag.lift);
  await expect(page.locator('[data-gym-drag-zoom="active"]')).toBeVisible();
  await moveTo(cdp, { x: original.x + 1, y: original.y + 1 }, drag.lift);
  await expect
    .poll(async () => Math.abs((await board.boundingBox())!.x - original.x))
    .toBeLessThan(1);
  await expect
    .poll(async () => Math.abs((await board.boundingBox())!.y - original.y))
    .toBeLessThan(1);
  await moveTo(
    cdp,
    { x: original.x + original.width - 1, y: original.y + original.height - 1 },
    drag.lift,
  );
  await expect
    .poll(async () =>
      Math.abs((await board.boundingBox())!.x - (original.x - original.width)),
    )
    .toBeLessThan(1);
  await expect
    .poll(async () =>
      Math.abs((await board.boundingBox())!.y - (original.y - original.height)),
    )
    .toBeLessThan(1);
  const target = await visibleSquare(board, drag.lift);
  await moveTo(cdp, target, drag.lift);
  const preview = board.locator('[data-drop-preview="ready"]');
  await expect(preview).toHaveCount(1);
  const row = await preview.getAttribute("data-row"),
    col = await preview.getAttribute("data-col");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    board.locator(`[data-row="${row}"][data-col="${col}"]`),
  ).toHaveClass(/is-draft/);
  await expect(board.locator(".is-draft")).toHaveCount(1);
  await expect(page.locator("[data-gym-drag-zoom]")).toHaveCount(0);
});

test("rotation, cancellation and a second touch restore the phone board without using tiles", async ({
  page,
  context,
}) => {
  const board = await startPractice(page);
  const cdp = await context.newCDPSession(page);
  const drag = await pickUp(page, cdp);
  await moveTo(cdp, await visibleSquare(board, drag.lift), drag.lift);
  await expect(page.locator('[data-gym-drag-zoom="active"]')).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("[data-gym-drag-zoom]")).toHaveCount(0);
  await expect(page.locator(".gym-drag-preview")).toHaveCount(0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(board.locator(".is-draft")).toHaveCount(0);

  const landscapeDrag = await pickUp(page, cdp);
  const landscapeTarget = await visibleSquare(board, landscapeDrag.lift);
  await moveTo(cdp, landscapeTarget, landscapeDrag.lift);
  await expect(page.locator('[data-gym-drag-zoom="active"]')).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(page.locator("[data-gym-drag-zoom]")).toHaveCount(0);
  await expect(board.locator(".is-draft")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const multi = await pickUp(page, cdp);
  const target = await visibleSquare(board, multi.lift);
  await moveTo(cdp, target, multi.lift);
  await expect(page.locator('[data-gym-drag-zoom="active"]')).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 0, x: target.x, y: target.y + multi.lift },
      { id: 1, x: target.x + 30, y: target.y + multi.lift },
    ],
  });
  await expect(page.locator("[data-gym-drag-zoom]")).toHaveCount(0);
  await expect(page.locator(".gym-drag-preview")).toHaveCount(0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(board.locator(".is-draft")).toHaveCount(0);
  await expect(
    page.locator("[data-gym-rack] button:not([disabled])"),
  ).toHaveCount(7);
});

test("animated phone zoom keeps a stationary target and restores before the next gesture", async ({
  page,
  context,
}) => {
  const board = await startPractice(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Reduced motion", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const cdp = await context.newCDPSession(page);
  const drag = await pickUp(page, cdp);
  const original = (await board.boundingBox())!;
  const square = await visibleSquare(board, drag.lift);
  await moveTo(cdp, square, drag.lift);
  await expect
    .poll(async () =>
      Math.abs((await board.boundingBox())!.width - original.width * 2),
    )
    .toBeLessThan(1);
  await expect(square.locator).toHaveAttribute("data-drop-preview", "ready");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(square.locator).toHaveClass(/is-draft/);
  const next = await pickUp(page, cdp);
  // A new pickup also interrupts any unfinished return animation before hit testing.
  await expect(page.locator("[data-gym-drag-zoom]")).toHaveCount(0);
  await moveTo(cdp, await visibleSquare(board, next.lift), next.lift);
  await expect(page.locator('[data-gym-drag-zoom="active"]')).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(page.locator("[data-gym-drag-zoom]")).toHaveCount(0);
  await expect(board.locator(".is-draft")).toHaveCount(1);
});

test("a previous pointer cannot cancel the next drag with a late capture event", async ({
  page,
  context,
}) => {
  const board = await startPractice(page);
  const cdp = await context.newCDPSession(page);
  const tiles = page.locator(
    '[data-gym-rack] button:not([disabled]):not([aria-label*="blank"])',
  );
  async function recordPointer(source: Locator) {
    await source.evaluate((node) => {
      node.addEventListener(
        "pointerdown",
        (event) => {
          node.setAttribute(
            "data-test-pointer-id",
            String((event as PointerEvent).pointerId),
          );
        },
        { once: true },
      );
    });
  }
  const sourceA = tiles.nth(0);
  await recordPointer(sourceA);
  const dragA = await pickUp(page, cdp, sourceA);
  const pointerA = Number(await sourceA.getAttribute("data-test-pointer-id"));
  await moveTo(cdp, await visibleSquare(board, dragA.lift), dragA.lift);
  await expect(page.locator('[data-gym-drag-zoom="active"]')).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(page.locator(".gym-drag-preview")).toHaveCount(0);

  const sourceB = tiles.nth(1);
  await recordPointer(sourceB);
  const dragB = await pickUp(page, cdp, sourceB);
  const pointerB = Number(await sourceB.getAttribute("data-test-pointer-id"));
  expect(pointerB).not.toBe(pointerA);
  await moveTo(cdp, await visibleSquare(board, dragB.lift), dragB.lift);
  await expect(page.locator('[data-gym-drag-zoom="active"]')).toBeVisible();
  // Replay a delayed notification from the retired pointer while B owns the gesture.
  for (const type of ["lostpointercapture", "pointercancel"]) {
    await sourceA.dispatchEvent(type, {
      pointerId: pointerA,
      pointerType: "touch",
      bubbles: true,
    });
    await expect(page.locator('[data-gym-drag-zoom="active"]')).toBeVisible();
    await expect(page.locator(".gym-drag-preview")).toBeVisible();
  }
  const target = board.locator('[data-drop-preview="ready"]');
  await expect(target).toHaveCount(1);
  const row = await target.getAttribute("data-row"),
    col = await target.getAttribute("data-col");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    board.locator(`[data-row="${row}"][data-col="${col}"]`),
  ).toHaveClass(/is-draft/);
  await expect(board.locator(".is-draft")).toHaveCount(1);
  await expect(page.locator("[data-gym-drag-zoom]")).toHaveCount(0);
});
