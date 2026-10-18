import { expect, test, type Page, type Locator } from "@playwright/test";
import { solidTextContrast } from "./fixtures/theme-contrast";
import { installFixture, fitsWidth } from "./fixtures/crokinole";

import { createGame, applyCommand } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";

function sampleGame() {
  const made = createGame({
    id: "theme-game",
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw new Error(made.error.message);
  const played = applyCommand(
    made.game,
    {
      type: "play",
      id: "theme-cat",
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
  return played.game;
}

const darkInk = "rgb(240, 234, 220)";
const lightInk = "rgb(35, 63, 51)";
async function scheme(page: Page, mode: "light" | "dark") {
  await page.emulateMedia({ colorScheme: mode });
  if (page.url() === "about:blank") return;
  await expect(page.locator("html")).toHaveCSS(
    "color",
    mode === "dark" ? darkInk : lightInk,
  );
}
async function screenshot(
  page: Page,
  name: string,
  info: import("@playwright/test").TestInfo,
) {
  if (name.startsWith("dark-"))
    expect(await solidTextContrast(page), name).toEqual([]);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
}
// WebKit can briefly return no box while React replaces the grid after Begin
// play. Capture the successful sample itself; a separate visible check followed
// by an unchecked measurement can race that replacement.
async function visibleBox(locator: Locator) {
  let box: Awaited<ReturnType<Locator["boundingBox"]>> = null;
  await expect
    .poll(async () => {
      box = await locator.boundingBox();
      return box !== null && box.width > 0 && box.height > 0;
    })
    .toBe(true);
  return box!;
}
async function localGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /New preview game/ }).click();
  for (const name of ["Ada", "Ben"]) {
    await page.getByRole("textbox", { name: "Player name" }).fill(name);
    await page.getByRole("button", { name: "Add player", exact: true }).click();
  }
  await page.getByLabel("Who plays first?").selectOption({ label: "Ada" });
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByRole("button", { name: "Begin play", exact: true }).click();
}

for (const mode of ["light", "dark"] as const) {
  test(`system ${mode} is styled before hydration and follows live preference without JavaScript`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      viewport: info.project.use.viewport,
      isMobile: info.project.use.isMobile,
      hasTouch: info.project.use.hasTouch,
      deviceScaleFactor: info.project.use.deviceScaleFactor,
      javaScriptEnabled: false,
      colorScheme: mode,
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "light dark",
    );
    await expect(page.locator("html")).toHaveCSS("color-scheme", "light dark");
    await expect(page.locator("html")).toHaveCSS(
      "color",
      mode === "dark" ? darkInk : lightInk,
    );
    // A real table photograph remains valid behind its dark overlay.
    await expect(page.locator("body")).not.toHaveCSS(
      "background-image",
      "none",
    );
    if (mode === "dark")
      await expect(page.locator("body")).toHaveCSS(
        "background-color",
        "rgb(20, 29, 25)",
      );
    await screenshot(page, `${mode}-before-hydration`, info);
    await scheme(page, mode === "dark" ? "light" : "dark");
    await context.close();
  });

  test(`system ${mode} preserves draft, dialog, board dimensions and reload`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await scheme(page, mode);
    await localGame(page);
    const board = page.getByRole("grid", { name: "Scrabble board, 15 by 15" });
    await expect(board).toBeVisible();
    const dimensions = await visibleBox(board);
    await page.getByTestId("cell-H8").click();
    await page
      .getByRole("textbox", { name: "Type letters on the board" })
      .pressSequentially("CAT");
    await expect(
      page.getByRole("status", { name: "10 potential points, valid turn" }),
    ).toBeVisible();
    await screenshot(page, `${mode}-scrabble-draft`, info);
    await page
      .getByRole("button", { name: "Review turn", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Review this turn" });
    await expect(dialog).toBeVisible();
    await screenshot(page, `${mode}-turn-dialog`, info);
    await scheme(page, mode === "dark" ? "light" : "dark");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Record 10 points", exact: true }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "Record 10 points", exact: true })
      .click();
    // On mobile the modal can hide the underlying board. Measure it once the
    // dialog closes, and wait for the local save before testing restoration.
    await expect(dialog).not.toBeVisible();
    await expect(board).toBeVisible();
    expect((await visibleBox(board)).width).toBeCloseTo(dimensions.width, 1);
    await scheme(page, mode);
    await expect(page.locator(".save-state")).toHaveText(
      "Saved on this device",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Return to game", exact: true })
      .click();
    await expect(page.getByTestId("cell-H8")).toHaveAccessibleName(
      "H8 C, 3 points",
    );
    await expect(page.locator("html")).toHaveCSS(
      "color",
      mode === "dark" ? darkInk : lightInk,
    );
    expect(errors).toEqual([]);
  });

  test(`system ${mode} covers shared routes and route-loaded styles`, async ({
    page,
  }, info) => {
    const fixture = await installFixture(page);
    const game = structuredClone(sampleGame());
    game.status = "finalized";
    game.lexicon = game.definition.lexicon = {
      id: "amberly-family-v1-2121ea84c411",
      edition: "Amberly family reference v1 (website 2026-09-14 + OSPD5)",
      status: "ready",
    };
    game.result = {
      scores: game.scores,
      scoresBeforeAdjustments: game.scores,
      adjustments: {
        doug: { deduction: 0, transfer: 0, finalScore: 10 },
        erin: { deduction: 0, transfer: 0, finalScore: 0 },
      },
      winnerIds: ["doug"],
      reason: "blocked",
      assisted: false,
      racks: { doug: [], erin: [] },
      actualBagCount: 83,
      competitiveEligible: true,
      eligibilityPolicy: 2,
      revision: game.revision,
      unequalTurns: false,
    };
    fixture.family.games.push(game);
    fixture.family.gameAccess[game.id] = {
      scorerUserId: fixture.family.member.userId,
      deviceId: "fixture",
      generation: 1,
      mode: "confirmed",
      recordsEligible: true,
      protests: [],
      canScore: true,
      approvals: [],
    };
    await page.route("**/api/family/games?*", (route) =>
      route.fulfill({
        json: {
          games: [
            {
              gameType: "scrabble",
              id: game.id,
              createdAt: game.definition.createdAt,
              status: "finalized",
              participants: game.players.map(({ id, name }) => ({ id, name })),
              totals: game.scores,
              winnerIds: ["doug"],
              mode: "confirmed",
              scorerUserId: fixture.family.member.userId,
              revision: game.revision,
            },
          ],
          nextCursor: null,
          standings: [],
        },
      }),
    );
    await scheme(page, mode);
    for (const path of [
      "/family",
      "/family/scrabble",
      "/family/players",
      "/family/history",
      "/family/records",
      "/family/settings",
      "/family/crokinole/new",
    ]) {
      await page.goto(path);
      await expect(
        page.locator(".family-hub, .app-shell, .crokinole-app").first(),
      ).toBeVisible();
      if (path === "/family/history")
        await expect(
          page.locator(".history-participant-score").first(),
        ).toHaveText("10 points");
      if (path === "/family/records")
        await expect(page.locator(".book-score")).toHaveText("10");
      await fitsWidth(page);
      await expect(page.locator("html")).toHaveCSS(
        "color",
        mode === "dark" ? darkInk : lightInk,
      );
      await screenshot(page, `${mode}-${path.replaceAll("/", "-")}`, info);
    }
  });

  test(`system ${mode} covers sign-in errors and missing spectator link`, async ({
    page,
  }, info) => {
    await scheme(page, mode);
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: { configured: true, user: null, signInMethod: "email" },
      }),
    );
    await page.route("**/api/auth/code", (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Connection interrupted. Please retry." },
      }),
    );
    await page.goto("/family");
    await page.getByLabel("Your email").fill("player@example.test");
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Connection interrupted" }),
    ).toBeVisible();
    await screenshot(page, `${mode}-signin-error`, info);
    await page.goto("/watch");
    await screenshot(page, `${mode}-watch-empty`, info);
    await page.goto("/no-such-theme-test-route");
    await expect(page.getByText("404", { exact: true })).toBeVisible();
    await screenshot(page, `${mode}-not-found`, info);
  });
}

for (const mode of ["light", "dark"] as const) {
  test(`system ${mode} keeps Crokinole entry and player colours through a live switch`, async ({
    page,
  }, info) => {
    const fixture = await installFixture(page);
    await scheme(page, mode);
    await page.goto("/family/crokinole/new");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Add Round 1", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Add Round 1", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Doug round total", { exact: true }).fill("65");
    const colours = await dialog
      .locator(".crokinole-disc")
      .evaluateAll((nodes) =>
        nodes.map((n) => getComputedStyle(n).backgroundColor),
      );
    await screenshot(page, `${mode}-crokinole-entry`, info);
    await scheme(page, mode === "dark" ? "light" : "dark");
    await expect(
      dialog.getByLabel("Doug round total", { exact: true }),
    ).toHaveValue("65");
    await scheme(page, mode);
    expect(
      await dialog
        .locator(".crokinole-disc")
        .evaluateAll((nodes) =>
          nodes.map((n) => getComputedStyle(n).backgroundColor),
        ),
    ).toEqual(colours);
    await dialog
      .getByRole("button", { name: "Save round", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add Round 2", exact: true }),
    ).toBeVisible();
    expect(fixture.game().totals).toEqual({ doug: 65, erin: 0 });
    await screenshot(page, `${mode}-crokinole-standings`, info);
  });

  test(`system ${mode} keeps full-size Gym, controls and game chooser readable`, async ({
    page,
  }, info) => {
    if (info.project.name === "desktop-chromium")
      await page.setViewportSize({ width: 1280, height: 800 });
    await scheme(page, mode);
    await page.goto("/gym-lab");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "Reduced motion", exact: true })
      .check();
    await screenshot(page, `${mode}-gym-settings`, info);
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.getByRole("button", { name: /^Start (new )?practice$/ }).click();
    await expect(page.locator(".gym-board")).toBeVisible({ timeout: 25000 });
    await expect(
      page.getByRole("button", { name: "Next random puzzle", exact: true }),
    ).toBeEnabled();
    const before = await visibleBox(page.locator(".gym-board"));
    await screenshot(page, `${mode}-gym-board`, info);
    await scheme(page, mode === "dark" ? "light" : "dark");
    const after = await visibleBox(page.locator(".gym-board"));
    expect(after.width).toBeCloseTo(before.width, 1);
    expect(after.height).toBeCloseTo(before.height, 1);
    if (info.project.name === "desktop-chromium") {
      expect(before.width).toBe(396);
      const check = await page
        .getByRole("button", { name: "Check move", exact: true })
        .boundingBox();
      expect(check!.y + check!.height).toBeLessThanOrEqual(800);
    }
    await scheme(page, mode);
    await page.goto("/gym-lab/games");
    await screenshot(page, `${mode}-gym-game-chooser`, info);
  });
}

for (const mode of ["light", "dark"] as const) {
  test(`system ${mode} styles the spectator board and word details`, async ({
    page,
  }, info) => {
    await scheme(page, mode);
    const game = sampleGame();
    await page.route("**/api/watch", (route) =>
      route.fulfill({
        json: {
          version: "theme-fixture",
          game: { ...game, events: undefined, scorerGeneration: 1 },
        },
      }),
    );
    await page.route("**/api/watch/draft", (route) =>
      route.fulfill({
        json: { revision: game.revision, generation: 1, draft: null },
      }),
    );
    await page.goto(`/watch#${"a".repeat(64)}`);
    await expect(
      page.getByRole("region", { name: "Live game viewer" }),
    ).toBeVisible();
    await screenshot(page, `${mode}-spectator`, info);
    await page
      .getByRole("button", { name: /H8 C, 3 points. View CAT/ })
      .click();
    await expect(
      page.getByRole("complementary", { name: "CAT word details" }),
    ).toBeVisible();
    await screenshot(page, `${mode}-spectator-word-details`, info);
    await scheme(page, mode === "dark" ? "light" : "dark");
    await expect(
      page.getByRole("region", { name: "Live game viewer" }),
    ).toBeVisible();
    await scheme(page, mode);
  });
}
