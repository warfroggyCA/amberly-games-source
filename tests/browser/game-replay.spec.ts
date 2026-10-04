import { expect, test, type Page } from "@playwright/test";
import { installFixture, fitsWidth } from "./fixtures/crokinole";
import { replayAction, replayCat, replayFixture } from "../fixtures/replay";

async function setup(page: Page, recorded = replayFixture()) {
  const fixture = await installFixture(page);
  fixture.family.games = [recorded.game];
  fixture.family.playerAccess.erin = {
    revision: 1,
    userId: null,
    archived: true,
  };
  fixture.family.gameAccess[recorded.game.id] = {
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
  await page.goto("/family/scrabble");
  await page.getByRole("button", { name: /^Replay Doug and Erin/ }).click();
  await expect(
    page.getByRole("heading", { name: "Game replay", exact: true }),
  ).toBeVisible();
  return { ...fixture, ...recorded, writes };
}

async function seek(page: Page, index: number) {
  const slider = page.getByRole("slider", { name: "Replay position" });
  await slider.focus();
  await slider.press("Home");
  for (let i = 0; i < index; i++) await slider.press("ArrowRight");
  await expect(slider).toHaveValue(String(index));
}

test("recorded replay preserves corrections, blanks, undo, exchange and final totals without writes", async ({
  page,
}, testInfo) => {
  const fixture = await setup(page);
  const board = page.getByRole("region", { name: "Recorded game replay" });
  await expect(board.locator(".letter-tile")).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(board.locator('[data-turn-score="doug"]')).toHaveText(
    String(fixture.snapshots[1].scores.doug),
  );
  await expect(board.locator(".letter-tile")).toHaveCount(3);
  await seek(page, 3);
  await expect(
    page.getByRole("status").filter({ hasText: "Earlier play corrected" }),
  ).toBeVisible();
  await expect(board.locator('[data-turn-score="erin"]')).toHaveText(
    String(fixture.snapshots[3].scores.erin),
  );
  await expect(
    board.locator('[data-turn-cell="7:7"] .letter-tile'),
  ).toHaveClass(/blank/);
  const rotation = await board
    .locator('[data-turn-cell="7:7"] .letter-tile')
    .evaluate((tile) => {
      const board = tile.closest(".board-grid")!;
      const combined = new DOMMatrix(
        getComputedStyle(board).transform,
      ).multiply(new DOMMatrix(getComputedStyle(tile).transform));
      return { a: combined.a, b: combined.b, c: combined.c, d: combined.d };
    });
  expect(rotation.a).toBeCloseTo(1);
  expect(rotation.b).toBeCloseTo(0);
  expect(rotation.c).toBeCloseTo(0);
  expect(rotation.d).toBeCloseTo(1);
  await fitsWidth(page);
  if (testInfo.project.name === "iphone-webkit") {
    const box = await board.locator(".board-grid").boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(240);
    for (const player of ["Doug", "Erin"])
      await expect(
        board.getByText(player, { exact: true }).first(),
      ).toBeVisible();
  }
  await page.screenshot({
    path: testInfo.outputPath("replay-corrected-board.png"),
    fullPage: true,
  });
  await seek(page, 4);
  await expect(
    board.locator('[data-turn-cell="7:10"] .letter-tile'),
  ).toHaveCount(0);
  await seek(page, 5);
  await expect(
    page.getByRole("status").filter({ hasText: "Erin exchanged 3 tiles" }),
  ).toBeVisible();
  await expect(board.getByText("Erin", { exact: true }).first()).toBeVisible();
  await seek(page, 6);
  await expect(
    page.getByRole("status").filter({ hasText: "Doug passed" }),
  ).toBeVisible();
  await seek(page, 7);
  for (const player of ["doug", "erin"])
    await expect(board.locator(`[data-turn-score="${player}"]`)).toHaveText(
      String(fixture.game.result!.scores[player]),
    );
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("slider")).toHaveValue("6");
  await page
    .getByRole("button", { name: "Close replay", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Game replay", exact: true }),
  ).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.family.games[0]).toEqual(fixture.game);
});

test("same tile animation cancels on pause, rapid seek, background and close; replay can restart", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const fixture = await setup(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".turn-flying-tile").first()).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".turn-flying-tile")).toHaveCount(0);
  await expect(page.getByRole("slider")).toHaveValue("1");
  await seek(page, 7);
  await page.getByRole("button", { name: "Replay again", exact: true }).click();
  await expect(page.getByRole("slider")).toHaveValue("1");
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("slider")).toHaveValue("0");
  await expect(page.locator(".turn-flying-tile")).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".turn-flying-tile")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close replay", exact: true })
    .last()
    .click();
  await expect(page.locator(".turn-flying-tile")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});

test("removing a historical game while replaying closes its board", async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  fixture.family.games = [];
  fixture.family.removedGameIds = [fixture.game.id];
  delete fixture.family.gameAccess[fixture.game.id];
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("status").filter({ hasText: "no longer available" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Recorded game replay" }),
  ).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});

test("autoplay reveals the score overlay and reaches the recorded result without audio cues", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const start = AudioBufferSourceNode.prototype.start;
    (window as Window & { replayAudioStarts?: number }).replayAudioStarts = 0;
    AudioBufferSourceNode.prototype.start = function (
      ...args: Parameters<typeof start>
    ) {
      const state = window as Window & { replayAudioStarts?: number };
      state.replayAudioStarts = (state.replayAudioStarts ?? 0) + 1;
      return start.apply(this, args);
    };
  });
  const fixture = await setup(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".turn-points")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("replay-score-overlay.png"),
    fullPage: true,
  });
  await expect(page.getByRole("slider")).toHaveValue("7", { timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "Replay again", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { replayAudioStarts?: number }).replayAudioStarts,
    ),
  ).toBe(0);
  expect(fixture.writes).toEqual([]);
});

for (const speed of [1, 2, 4, 8]) {
  test(`replay at ${speed}x visits every recorded action and keeps manual stepping paused`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const fixture = await setup(page);
    const control = page.getByRole("combobox", { name: "Playback speed" });
    await expect(control).toHaveValue("1");
    await control.selectOption(String(speed));
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("slider")).toHaveValue("1");
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await page.evaluate(() => {
      const steps: string[] = [];
      Object.assign(window, { replaySteps: steps });
      const slider = document.querySelector<HTMLInputElement>(
        '[aria-label="Replay position"]',
      )!;
      new MutationObserver(() => {
        if (steps.at(-1) !== slider.value) steps.push(slider.value);
      }).observe(slider, { attributes: true, attributeFilter: ["value"] });
    });
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Replay again", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    expect(
      await page.evaluate(
        () => (window as Window & { replaySteps?: string[] }).replaySteps,
      ),
    ).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    for (const id of ["doug", "erin"])
      await expect(page.locator(`[data-turn-score="${id}"]`)).toHaveText(
        String(fixture.game.result!.scores[id]),
      );
    await expect(control).toHaveValue(String(speed));
    await fitsWidth(page);
    expect(fixture.writes).toEqual([]);
    expect(fixture.family.games[0]).toEqual(fixture.game);
  });
}

test("empty and incomplete journals stay explicit; short and long records finish at 8x", async ({
  page,
}) => {
  const recorded = replayFixture();
  const empty = await setup(page, { ...recorded, game: recorded.snapshots[0] });
  await expect(page.getByRole("slider")).toHaveValue("0");
  await expect(
    page.getByRole("button", { name: "Replay again", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Playback speed" })
    .selectOption("8");
  expect(empty.writes).toEqual([]);
  const legacy = await setup(page, {
    ...recorded,
    game: { ...recorded.game, events: [] },
  });
  await expect(
    page.getByRole("status").filter({ hasText: "Replay unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Playback speed" }),
  ).toHaveCount(0);
  expect(legacy.writes).toEqual([]);
  const short = await setup(page, { ...recorded, game: recorded.snapshots[1] });
  await page
    .getByRole("combobox", { name: "Playback speed" })
    .selectOption("8");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay again", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("slider")).toHaveValue("1");
  expect(short.writes).toEqual([]);
  let longGame = recorded.snapshots[1];
  for (let index = 0; index < 40; index++)
    longGame = replayAction(longGame, {
      type: "edit-turn",
      turnId: "replay-0",
      placements: replayCat.map((placement, i) =>
        i === 0
          ? {
              ...placement,
              tile: { ...placement.tile, blank: index % 2 === 0 },
            }
          : placement,
      ),
      reason: "Synthetic correction",
    });
  const long = await setup(page, { ...recorded, game: longGame });
  await page
    .getByRole("combobox", { name: "Playback speed" })
    .selectOption("8");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay again", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("slider")).toHaveValue("41");
  await expect(page.locator('[data-turn-score="doug"]')).toHaveText(
    String(longGame.scores.doug),
  );
  expect(long.writes).toEqual([]);
  expect(long.family.games[0]).toEqual(longGame);
});

test("speed changes preserve the active animation and cancel cleanly on pause and seek", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const fixture = await setup(page);
  const speed = page.getByRole("combobox", { name: "Playback speed" });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".turn-flying-tile").first()).toBeVisible();
  // Dispatch the selection without scrolling the viewport: scrolling deliberately
  // settles measured animation paths, a separate existing behavior.
  await speed.evaluate((select: HTMLSelectElement) => {
    const active = document
      .getAnimations()
      .filter(
        (a) =>
          (a.effect as KeyframeEffect)?.target instanceof Element &&
          ((a.effect as KeyframeEffect).target as Element).closest(
            ".turn-animation-layer",
          ),
      );
    Object.assign(window, { replayActiveAnimations: active });
    select.value = "2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = (
          window as Window & { replayActiveAnimations?: Animation[] }
        ).replayActiveAnimations!;
        return active.length > 0 && active.every((a) => a.playbackRate === 2);
      }),
    )
    .toBe(true);
  await expect(page.getByRole("slider")).toHaveValue("1");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await speed.selectOption("4");
  await expect(page.locator(".turn-animation-layer")).toHaveCount(0);
  await expect(page.getByRole("slider")).toHaveValue("1");
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await speed.selectOption("8");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay again", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".turn-animation-layer")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("replay-speed-8x.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Replay again", exact: true }).click();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("slider")).toHaveValue("0");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".turn-animation-layer")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});
