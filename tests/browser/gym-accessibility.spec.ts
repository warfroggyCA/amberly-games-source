import { expect, test, type Page } from "@playwright/test";

async function tabUntil(page: Page, selector: string, backwards = false) {
  for (let i = 0; i < 35; i++) {
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
    if (
      await page
        .locator(selector)
        .evaluateAll((nodes) =>
          nodes.some((node) => node === document.activeElement),
        )
    )
      return;
  }
  throw new Error(`Keyboard could not reach ${selector}`);
}
async function settings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  return page.getByRole("checkbox", { name: "Reduced motion", exact: true });
}

test("Gym board uses one Tab stop with arrows, keyboard placement, return and undo", async ({
  page,
}) => {
  await page.goto("/gym-lab");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  const board = page.locator(".gym-board");
  await expect(board).toBeVisible({ timeout: 25000 });
  await expect(board.locator('[tabindex="0"]')).toHaveCount(1);
  await tabUntil(page, "[data-gym-square]");
  await expect(board.locator('[data-row="7"][data-col="7"]')).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(board.locator('[data-row="7"][data-col="8"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-gym-rack] button").first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(board.locator('[data-row="7"][data-col="8"]')).toBeFocused();
  // Traverse to an empty square entirely with arrows, including both boundaries.
  for (let i = 0; i < 16; i++) await page.keyboard.press("ArrowUp");
  for (let i = 0; i < 16; i++) await page.keyboard.press("ArrowLeft");
  await expect(board.locator('[data-row="0"][data-col="0"]')).toBeFocused();
  const empty = await board
    .locator("button:not(.has-tile)")
    .first()
    .evaluate((node) => ({
      row: Number(node.getAttribute("data-row")),
      col: Number(node.getAttribute("data-col")),
    }));
  for (let i = 0; i < empty.row; i++) await page.keyboard.press("ArrowDown");
  for (let i = 0; i < empty.col; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await tabUntil(
    page,
    '[data-gym-rack] button:not([disabled]):not([aria-label*="blank"])',
  );
  await page.keyboard.press("Enter");
  await expect(board.locator(".is-draft")).toHaveCount(1);
  await tabUntil(page, '[aria-label="Undo"]');
  await page.keyboard.press("Enter");
  await expect(board.locator(".is-draft")).toHaveCount(0);
  await tabUntil(page, "[data-gym-square]", true);
  const selected = board.locator(
    `[data-row="${empty.row}"][data-col="${empty.col}"]`,
  );
  await expect(selected).toBeFocused();
  await tabUntil(
    page,
    '[data-gym-rack] button:not([disabled]):not([aria-label*="blank"])',
  );
  await page.keyboard.press("Space");
  await expect(board.locator(".is-draft")).toHaveCount(1);
  await tabUntil(page, "[data-gym-square]", true);
  await page.keyboard.press("Space");
  await expect(board.locator(".is-draft")).toHaveCount(0);
  await expect(selected).toBeFocused();
});

test("motion follows OS live until a saved explicit choice, with a reset to OS", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/gym-lab");
  const image = page.locator(".gym-welcome img");
  await expect(image).toHaveAttribute("src", "/gym/scarlett-lift-still.png");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(image).toHaveAttribute("src", "/gym/scarlett-lift.webp");
  const checkbox = await settings(page);
  await checkbox.check();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(image).toHaveAttribute("src", "/gym/scarlett-lift-still.png");
  await settings(page);
  await checkbox.uncheck();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(checkbox).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(image).toHaveAttribute("src", "/gym/scarlett-lift.webp");
  await settings(page);
  await page
    .getByRole("button", { name: "Use device motion setting", exact: true })
    .click();
  await expect(checkbox).toBeChecked();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(image).toHaveAttribute("src", "/gym/scarlett-lift-still.png");
});

test("blocked or malformed motion storage safely follows OS; visit override still works", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("amberly-gym-motion-v1", "invalid legacy value");
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "amberly-gym-motion-v1") throw new Error("Storage blocked");
      return set.call(this, key, value);
    };
  });
  await page.goto("/gym-lab");
  await expect(page.locator(".gym-welcome img")).toHaveAttribute(
    "src",
    "/gym/scarlett-lift-still.png",
  );
  const checkbox = await settings(page);
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(checkbox).not.toBeChecked();
  await page
    .getByRole("button", { name: "Use device motion setting", exact: true })
    .click();
  await expect(checkbox).toBeChecked();
});

test("restoring a current draft follows the current OS motion preference", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/gym-lab");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  await expect(page.locator(".gym-board")).toBeVisible({ timeout: 25000 });
  await expect(
    page.getByText("Practice saved on this device.", { exact: true }),
  ).toBeVisible();
  // Leave before changing OS preference, keeping the saved effective false value.
  await page.goto("about:blank");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/gym-lab");
  await page
    .getByRole("button", { name: "Resume practice", exact: true })
    .click();
  await expect(page.locator(".gym-board")).toBeVisible({ timeout: 25000 });
  await expect(page.locator(".gym-lab")).toHaveClass(/gym-reduced-motion/);
  await expect(page.locator(".gym-companion-image")).toHaveAttribute(
    "src",
    "/gym/scarlett-lift-still.png",
  );
  await settings(page);
  await expect(
    page.getByText("Motion follows your device setting.", { exact: true }),
  ).toBeVisible();
});

for (const sample of [
  { legacy: false, os: "reduce" as const, saved: null, expected: true },
  { legacy: true, os: "no-preference" as const, saved: null, expected: true },
  {
    legacy: true,
    os: "no-preference" as const,
    saved: "full",
    expected: false,
  },
  {
    legacy: true,
    os: "no-preference" as const,
    saved: "system",
    expected: false,
  },
]) {
  test(`legacy motion ${sample.legacy}, OS ${sample.os}, new choice ${sample.saved} restores safely`, async ({
    page,
  }) => {
    await page.goto("/gym-lab");
    await page
      .getByRole("button", { name: "Start practice", exact: true })
      .click();
    await expect(page.locator(".gym-board")).toBeVisible({ timeout: 25000 });
    await expect(
      page.getByText("Practice saved on this device.", { exact: true }),
    ).toBeVisible();
    // The current component has unmounted, so it cannot rewrite this legacy fixture.
    await page.goto("/gym-lab/games");
    await page.evaluate(async ({ legacy, saved }) => {
      if (saved !== null) localStorage.setItem("amberly-gym-motion-v1", saved);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("amberly-gym-drafts");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("drafts", "readwrite");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          const store = tx.objectStore("drafts");
          const read = store.get("local");
          read.onsuccess = () => {
            const row = read.result;
            delete row.value.motionPreferenceVersion;
            row.value.reducedMotion = legacy;
            store.put(row);
          };
        };
      });
    }, sample);
    await page.emulateMedia({ reducedMotion: sample.os });
    await page.goto("/gym-lab");
    await page
      .getByRole("button", { name: "Resume practice", exact: true })
      .click();
    await expect(page.locator(".gym-board")).toBeVisible({ timeout: 25000 });
    await expect(page.locator(".gym-companion-image")).toHaveAttribute(
      "src",
      sample.expected
        ? "/gym/scarlett-lift-still.png"
        : "/gym/scarlett-lift.webp",
    );
  });
}
