import { expect, test, type Page } from "@playwright/test";
import {
  applyCommand,
  createGame,
  type GameCommand,
  type GameState,
} from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import type {
  SharedMutation,
  SharedState,
} from "../../src/lib/shared-contract";
import { installFixture, fitsWidth } from "./fixtures/crokinole";

function madeGame(timed = false): GameState {
  const made = createGame({
    id: "correction-recovery",
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw Error(made.error.message);
  const result = applyCommand(
    made.game,
    timed
      ? {
          type: "start-clock",
          id: "clock",
          expectedRevision: 0,
          timedAt: "2035-10-12T12:00:00Z",
        }
      : {
          type: "play",
          id: "cat",
          expectedRevision: 0,
          placements: (["C", "A", "T"] as const).map((letter, i) => ({
            row: 7,
            col: 7 + i,
            tile: { letter, blank: false },
          })),
        },
    testLexicon,
  );
  if (!result.ok) throw Error(result.error.message);
  return result.game;
}
async function fixture(page: Page, timed = false) {
  const f = await installFixture(page);
  const game = madeGame(timed);
  f.family.games = [game];
  f.family.gameAccess[game.id] = {
    scorerUserId: f.family.member.userId,
    deviceId: "original",
    generation: 1,
    mode: "confirmed",
    recordsEligible: true,
    protests: [],
    canScore: true,
    approvals: [],
  };
  const accepted: GameCommand[] = [];
  await connect(page, f.family, accepted);
  return { ...f, accepted };
}
async function connect(
  page: Page,
  family: SharedState,
  accepted: GameCommand[],
) {
  await page.route(/\/api\/family(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: family });
    const { operation } = route.request().postDataJSON() as SharedMutation;
    if (operation.type !== "game-commands")
      throw Error(`Unexpected operation ${operation.type}`);
    const access = family.gameAccess[operation.gameId];
    if (!access.canScore || operation.generation !== access.generation)
      return route.fulfill({
        status: 409,
        json: { code: "SCORER_CONFLICT", error: "Scorer access changed." },
      });
    let current = family.games.find((g) => g.id === operation.gameId)!;
    for (const command of operation.commands) {
      const result = applyCommand(current, command, testLexicon);
      if (!result.ok)
        return route.fulfill({
          status: 409,
          json: { code: result.error.code, error: result.error.message },
        });
      current = result.game;
      if (!result.replayed) accepted.push(command);
    }
    family.games = family.games.map((g) => (g.id === current.id ? current : g));
    return route.fulfill({ json: { game: current, gameAccess: access } });
  });
  await page.route("**/api/family/draft*", (route) =>
    route.fulfill({
      json:
        route.request().method() === "POST"
          ? { accepted: true }
          : { draft: null },
    }),
  );
}
async function openEdit(page: Page) {
  await page.goto("/family/scrabble?view=play");
  await page
    .getByRole("button", { name: "Expand score panel", exact: true })
    .click();
  await page.locator(".round-table button").first().click();
  await page
    .getByRole("button", { name: "Edit this play", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Turn 1 · Doug", exact: true });
}
async function refresh(page: Page) {
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
}

test("independent scorer corrections retain the original basis and require an explicit reload after another save", async ({
  page,
  browser,
}, info) => {
  const f = await fixture(page);
  const peerContext = await browser.newContext();
  try {
    const peer = await peerContext.newPage();
    await installFixture(peer);
    await connect(peer, f.family, f.accepted);
    const ours = await openEdit(page);
    const theirs = await openEdit(peer);
    await ours.getByRole("checkbox").nth(1).check();
    await ours
      .getByLabel("Reason for correction")
      .fill("My unsaved A blank correction");
    await theirs.getByRole("checkbox").nth(0).check();
    await theirs.getByLabel("Reason for correction").fill("C was a blank");
    await theirs
      .getByRole("button", { name: "Save correction", exact: true })
      .click();
    await expect(theirs).toHaveCount(0);
    expect(f.family.games[0].scores.doug).toBe(4);
    await refresh(page);
    await expect(ours.getByRole("alert")).toContainText(
      "game changed while this correction was open",
    );
    await expect(ours.getByRole("checkbox").nth(1)).toBeChecked();
    await expect(ours.getByRole("checkbox").nth(0)).not.toBeChecked();
    await expect(ours.getByLabel("Reason for correction")).toHaveValue(
      "My unsaved A blank correction",
    );
    await expect(
      ours.getByRole("button", { name: "Save correction", exact: true }),
    ).toBeDisabled();
    expect(f.accepted).toHaveLength(1);
    await fitsWidth(page);
    await page.screenshot({
      path: info.outputPath("retained-correction-conflict.png"),
      fullPage: true,
    });
    await ours
      .getByRole("button", {
        name: "Discard my edit and load latest play",
        exact: true,
      })
      .click();
    await ours
      .getByRole("button", { name: "Edit this play", exact: true })
      .click();
    await expect(ours.getByRole("checkbox").nth(0)).toBeChecked();
    await expect(ours.getByRole("checkbox").nth(1)).not.toBeChecked();
    await ours.getByRole("checkbox").nth(1).check();
    await ours.getByLabel("Reason for correction").fill("A was also a blank");
    await ours
      .getByRole("button", { name: "Save correction", exact: true })
      .click();
    await expect(ours).toHaveCount(0);
    expect(f.accepted).toHaveLength(2);
    expect(f.accepted.map((c) => c.expectedRevision)).toEqual([1, 2]);
    expect(f.family.games[0].scores.doug).toBe(2);
    expect(f.family.games[0].events[0].turn!.score).toBe(10);
  } finally {
    await peerContext.close();
  }
});

test("a scorer generation change or access loss retains an open correction and blocks saving", async ({
  page,
}) => {
  const f = await fixture(page);
  const dialog = await openEdit(page);
  await dialog.getByRole("checkbox").nth(1).check();
  await dialog
    .getByLabel("Reason for correction")
    .fill("Keep my typed explanation");
  f.family.gameAccess[f.family.games[0].id].generation++;
  await refresh(page);
  await expect(dialog.getByRole("alert")).toContainText(
    "Scorer access changed",
  );
  await expect(
    dialog.getByRole("button", { name: "Save correction", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByLabel("Reason for correction")).toHaveValue(
    "Keep my typed explanation",
  );
  const access = f.family.gameAccess[f.family.games[0].id];
  access.canScore = false;
  access.scorerUserId = "44444444-4444-4444-8444-444444444444";
  await refresh(page);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Discard my edit and load latest play",
    }),
  ).toHaveCount(0);
  await expect(dialog.getByLabel("Reason for correction")).toHaveValue(
    "Keep my typed explanation",
  );
  await expect(dialog.getByRole("checkbox").nth(1)).toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Save correction", exact: true }),
  ).toBeDisabled();
  expect(f.accepted).toHaveLength(0);
  expect(f.family.games[0].revision).toBe(1);
});

test("a future clock can be explicitly stopped without losing a draft, including reload and double taps", async ({
  page,
}, info) => {
  const f = await fixture(page, true);
  await page.goto("/family/scrabble?view=play");
  const checkpoint = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/family/draft") &&
      request.method() === "POST" &&
      request.postDataJSON()?.placements?.length === 3,
  );
  await page.getByTestId("cell-H8").click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .pressSequentially("CAT");
  await checkpoint;
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue without timing", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Timing statistics for this entire game will be unavailable",
  );
  await dialog
    .getByLabel("Reason for stopping timing")
    .fill("Device clock was in the future");
  // Two synchronous activations exercise the same gesture window.
  await dialog
    .getByRole("button", { name: "Continue without timing", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(dialog).toHaveCount(0);
  expect(f.accepted.filter((c) => c.type === "recover-clock")).toHaveLength(1);
  expect(f.family.games[0].events[0].command.timedAt).toBe(
    "2035-10-12T12:00:00Z",
  );
  await expect(
    page.getByText("Timing unavailable", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("cell-J8")).toHaveAccessibleName(
    "J8 T, 1 points",
  );
  await page.reload();
  await expect(page.getByTestId("cell-J8")).toHaveAccessibleName(
    "J8 T, 1 points",
  );
  await expect(
    page.getByText("Timing unavailable", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review turn", exact: true }).click();
  await page
    .getByRole("button", { name: "Record 10 points", exact: true })
    .click();
  await expect.poll(() => f.family.games[0].turns.length).toBe(1);
  expect(f.family.games[0].scores.doug).toBe(10);
  expect(f.accepted.at(-1)).toMatchObject({ type: "play" });
  expect(f.accepted.at(-1)).not.toHaveProperty("timedAt");
  await page.screenshot({
    path: info.outputPath("clock-recovered-with-score.png"),
    fullPage: true,
  });
});
