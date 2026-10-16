import { expect, test, type Page } from "@playwright/test";

type Status = "invalid" | "placement" | "valid" | "pending" | "unavailable";
declare global {
  interface Window {
    gymStatusMode: Status;
    gymStatusReply: (mode: Status) => void;
  }
}

// Synthetic worker responses isolate layout and interaction from dictionary/search
// timing. Existing Gym tests exercise the real scoring and validity workers.
async function start(page: Page) {
  await page.addInitScript(() => {
    window.gymStatusMode = "invalid";
    const Original = window.Worker;
    window.Worker = class extends Original {
      postMessage(message: { id: number; type?: string; position?: unknown }) {
        const reply = (data: object) =>
          this.dispatchEvent(new MessageEvent("message", { data }));
        if (message.type === "generate") {
          const board = Array.from({ length: 15 }, () => Array(15).fill(null));
          board[7][7] = { letter: "A", blank: false };
          setTimeout(
            () =>
              reply({
                id: message.id,
                type: "generate",
                elapsedMs: 0,
                puzzle: {
                  generator: "legal-play-v1",
                  rules: "amberly-two-player-v1",
                  seed: "status-layout-fixture",
                  reference: {
                    id: "fixture",
                    edition: "fixture",
                    status: "test",
                  },
                  position: {
                    board,
                    rack: ["A", "T", "E", "S", "R", "I", "N"],
                    scores: [0, 0],
                    opponentCount: 7,
                    bagCount: 85,
                    passes: 0,
                  },
                  setup: [],
                },
                answer: {
                  maximum: 4,
                  maximumCount: 1,
                  totalMoves: 1,
                  histogram: [{ score: 4, count: 1 }],
                  best: [],
                  candidates: [],
                  candidateCount: 0,
                  nodes: 0,
                },
              }),
            0,
          );
          return;
        }
        if (message.position) {
          window.gymStatusReply = (mode) => {
            if (mode === "pending") return;
            reply({
              id: message.id,
              words: [],
              tentativeScore: 4,
              result:
                mode === "unavailable"
                  ? null
                  : mode === "valid"
                    ? { ok: true, score: 4, words: [{ word: "AT" }] }
                    : {
                        ok: false,
                        error: {
                          code:
                            mode === "placement"
                              ? "NOT_IN_LINE"
                              : "INVALID_WORD",
                          message: "Synthetic validation message.",
                        },
                      },
            });
          };
          if (window.gymStatusMode !== "pending")
            setTimeout(() => window.gymStatusReply(window.gymStatusMode), 0);
          return;
        }
        super.postMessage(message);
      }
    };
  });
  await page.goto("/gym-lab");
  await page.getByRole("button", { name: /^Start (new )?practice$/ }).click();
  await expect(page.locator(".gym-board")).toBeVisible();
  const skip = page.getByRole("button", {
    name: "Skip animation",
    exact: true,
  });
  if (await skip.isVisible()) await skip.click();
}

const square = (page: Page, row: number, col: number) =>
  page.locator(`[data-gym-square][data-row="${row}"][data-col="${col}"]`);
const rack = (page: Page) =>
  page.locator("[data-gym-rack] button:not([disabled])");

async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return {
        // Browser focus/scrollIntoView may pan the intentionally scrollable board.
        x:
          r.x +
          (selector === ".gym-board"
            ? document.querySelector(".gym-board-scroll")!.scrollLeft
            : 0),
        y: r.y + scrollY,
        width: r.width,
        height: r.height,
      };
    };
    return {
      board: rect(".gym-board"),
      direction: rect(".gym-direction"),
      rack: rect(".gym-rack"),
    };
  });
}
async function outsideBoard(page: Page) {
  expect(
    await page.locator(".gym-move-badge").evaluate((badge) => {
      const b = badge.getBoundingClientRect();
      return [...document.querySelectorAll("[data-gym-square]")].every(
        (cell) => {
          const c = cell.getBoundingClientRect();
          return (
            b.right <= c.left ||
            b.left >= c.right ||
            b.bottom <= c.top ||
            b.top >= c.bottom
          );
        },
      );
    }),
  ).toBe(true);
  await expect(page.locator(".gym-board .gym-move-badge")).toHaveCount(0);
  await expect(page.locator(".gym-move-badge")).toHaveCSS("position", "static");
  expect(
    await page.locator(".gym-move-badge").evaluate((badge) => {
      const b = badge.getBoundingClientRect();
      const slot = badge.parentElement!.getBoundingClientRect();
      return (
        b.left >= slot.left &&
        b.right <= slot.right &&
        b.top >= slot.top &&
        b.bottom <= slot.bottom
      );
    }),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const enlarged of [false, true]) {
  test(`status stays outside cells without shifting controls${enlarged ? " at 200% text" : ""}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      info.project.name === "iphone-landscape"
        ? { width: 568, height: 320 }
        : { width: 320, height: 640 },
    );
    await start(page);
    if (enlarged)
      await page.addStyleTag({
        content: "html { font-size: 200% !important; }",
      });
    await square(page, 0, 6).click(); // G1, with H1 the actual next entry square.
    const before = await geometry(page);
    await rack(page).first().click();
    const badge = page.locator(".gym-move-badge");
    await expect(badge).toContainText("× 4 invalid");
    await expect(page.locator(".gym-direction")).toContainText("Next: H1");
    await page.locator(".gym-board").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("g1-h1.png"),
      fullPage: true,
    });
    await outsideBoard(page);
    expect(await geometry(page)).toEqual(before);
    await expect(page.locator(".gym-live-validity[role=status]")).toContainText(
      "Not valid yet",
    );
    // Entry through the rack must put the next tile in H1, not just update a label.
    await rack(page).first().click();
    await expect(square(page, 0, 7)).toHaveClass(/is-draft/);
    await expect(page.locator(".gym-direction")).toContainText("Next: I1");
    await expect(badge).toContainText("× 4 invalid");
    for (const mode of ["placement", "valid", "unavailable"] as const) {
      await page.evaluate((mode) => window.gymStatusReply(mode), mode);
      await expect(badge).toHaveClass(
        new RegExp(
          mode === "valid"
            ? "is-valid"
            : mode === "unavailable"
              ? "is-pending"
              : "is-invalid",
        ),
      );
      if (mode === "placement")
        await expect(badge).toContainText("Invalid placement");
      if (mode === "valid") {
        await expect(badge).toContainText("✓ 4");
        await expect(badge.locator(".gym-medal-badge")).toBeVisible();
        await expect(page.locator(".gym-live-validity")).toContainText(
          "Valid move: AT — 4 points.",
        );
      }
      await outsideBoard(page);
      expect(await geometry(page)).toEqual(before);
      await page.screenshot({
        path: info.outputPath(`${mode}.png`),
        fullPage: true,
      });
    }
    await page.evaluate(() => {
      window.gymStatusMode = "pending";
    });
    await rack(page).first().click();
    await expect(badge).toHaveText("…");
    await page.screenshot({
      path: info.outputPath("pending.png"),
      fullPage: true,
    });
    await expect(page.locator(".gym-live-validity")).toHaveText(
      "Checking word validity…",
    );
    await outsideBoard(page);
    expect(await geometry(page)).toEqual(before);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator(".gym-board .is-draft")).toHaveCount(2);
    await page.getByRole("button", { name: "Return all", exact: true }).click();
    await expect(badge).toHaveCount(0);
    expect(await geometry(page)).toEqual(before);
    // A late validity response after cancellation must not resurrect the badge.
    await page.evaluate(() => window.gymStatusReply("valid"));
    await expect(badge).toHaveCount(0);
  });
}

test("edge placements, across/down and pointer cancellation keep status off the board", async ({
  page,
}) => {
  await start(page);
  for (const [row, col] of [
    [0, 0],
    [0, 14],
    [14, 0],
    [14, 14],
  ]) {
    for (const direction of ["Across", "Down"]) {
      await square(page, row, col).click();
      const toggle = page.locator(".gym-direction button");
      if (!(await toggle.innerText()).includes(direction)) await toggle.click();
      await rack(page).first().click();
      await expect(page.locator(".gym-move-badge")).toContainText("invalid");
      await outsideBoard(page);
      const tile = rack(page).first();
      await tile.scrollIntoViewIfNeeded();
      await tile.evaluate((node) =>
        node.addEventListener(
          "pointerdown",
          (event) => {
            node.setAttribute(
              "data-test-pointer-id",
              String((event as PointerEvent).pointerId),
            );
          },
          { once: true },
        ),
      );
      const resting = await geometry(page);
      const box = (await tile.boundingBox())!;
      // A real pointer-down is required for browser pointer capture. Then replay
      // cancellation using that active pointer's id (supported in every profile).
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect(page.locator(".gym-drag-preview")).toBeVisible();
      await expect(page.locator(".gym-move-badge")).toHaveCount(0);
      expect(await geometry(page)).toEqual(resting);
      await page.mouse.move(box.x + 35, box.y - 50, { steps: 3 });
      const pointerId = Number(await tile.getAttribute("data-test-pointer-id"));
      await tile.dispatchEvent("pointercancel", {
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
      });
      await page.mouse.up();
      await expect(page.locator(".gym-drag-preview")).toHaveCount(0);
      expect(await geometry(page)).toEqual(resting);
      await expect(page.locator(".gym-board .is-draft")).toHaveCount(1);
      await expect(page.locator(".gym-move-badge")).toBeVisible();
      await outsideBoard(page);
      await page
        .getByRole("button", { name: "Return all", exact: true })
        .click();
    }
  }
});
