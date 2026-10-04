import { test, expect, type Page } from "@playwright/test";
import { installFixture } from "./fixtures/crokinole";
import { LETTER_COUNTS, type TileSupply } from "../../src/domain/board";
import {
  applyCommand,
  createGame,
  hydrateGame,
  type GameCommand,
  type GameState,
} from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import type { SharedMutation } from "../../src/lib/shared-contract";

// A deliberately small, valid custom set reaches a real rack-out without
// fabricating scores, boards, pendingEnd, or the game's event journal.
function timedRackOut() {
  const counts = Object.fromEntries(
    Object.keys(LETTER_COUNTS).map((letter) => [letter, 0]),
  ) as { -readonly [K in keyof TileSupply]: number };
  for (const tile of [..."READINGEEEEE??"] as (keyof TileSupply)[])
    counts[tile]++;
  const made = createGame({
    id: "timed-ending",
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
    createdAt: "2026-09-25T12:00:00.000Z",
    tileSet: {
      id: "ending-test-set",
      name: "Ending regression fixture",
      revision: 0,
      checkedAt: null,
      counts,
    },
  });
  if (!made.ok) throw Error(made.error.message);
  let game = made.game;
  for (const command of [
    {
      type: "start-clock",
      id: "start",
      expectedRevision: 0,
      timedAt: "2026-09-25T12:00:00.000Z",
    },
    {
      type: "play",
      id: "rack-out",
      expectedRevision: 1,
      timedAt: "2026-09-25T12:00:20.000Z",
      placements: ([..."READING"] as const).map((letter, index) => ({
        row: 7,
        col: 4 + index,
        tile: { letter, blank: false },
      })),
    },
  ] as GameCommand[]) {
    const result = applyCommand(game, command, testLexicon);
    if (!result.ok) throw Error(result.error.message);
    game = result.game;
  }
  expect(game.pendingEnd).toBe("natural");
  expect(game.expectedRackCounts).toEqual({ doug: 0, erin: 7 });
  expect(game.expectedBagCount).toBe(0);
  return game;
}

async function fixture(
  page: Page,
  options: {
    loseFinalAck?: boolean;
    corrected?: boolean;
    viewer?: boolean;
  } = {},
) {
  const f = await installFixture(page);
  let game = timedRackOut();
  if (options.corrected) {
    const corrected = applyCommand(
      game,
      {
        type: "reconcile",
        id: "mistaken-count",
        expectedRevision: game.revision,
        rackCounts: { doug: 1, erin: 6 },
        bagCount: 0,
        reason: "Fixture: one tile was attributed to the wrong rack",
        recordedBy: "Fixture scorer",
        recordedAt: "2026-09-25T12:00:21.000Z",
      },
      testLexicon,
    );
    if (!corrected.ok) throw Error(corrected.error.message);
    game = corrected.game;
    expect(game.pendingEnd).toBeNull();
  }
  f.family.games.push(game);
  f.family.gameAccess[game.id] = {
    scorerUserId: options.viewer
      ? "33333333-3333-4333-8333-333333333333"
      : f.family.member.userId,
    deviceId: "test-device",
    generation: 1,
    mode: "practice",
    recordsEligible: false,
    protests: [],
    canScore: !options.viewer,
    approvals: [],
  };
  const requests: SharedMutation[] = [];
  let finalAckLost = false;
  await page.route("**/api/family/draft*", (route) =>
    route.fulfill({ json: { accepted: true, draft: null } }),
  );
  await page.route(/\/api\/family(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    const mutation = route.request().postDataJSON() as SharedMutation;
    requests.push(mutation);
    if (mutation.operation.type !== "game-commands")
      throw Error("Unexpected ending-test mutation");
    for (const command of mutation.operation.commands) {
      const result = applyCommand(f.family.games[0], command, testLexicon);
      if (!result.ok) throw Error(result.error.message);
      f.family.games[0] = result.game;
    }
    if (
      options.loseFinalAck &&
      !finalAckLost &&
      mutation.operation.commands.some((c) => c.type === "finalize")
    ) {
      finalAckLost = true;
      return route.abort("internetdisconnected");
    }
    return route.fulfill({
      json: {
        game: f.family.games[0],
        gameAccess: f.family.gameAccess[game.id],
      },
    });
  });
  await page.goto("/family");
  await page
    .getByRole("button", {
      name: options.viewer ? "View current game" : "Resume game",
      exact: true,
    })
    .click();
  return { ...f, requests, game: () => f.family.games[0] };
}

async function openCounts(page: Page) {
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await page.getByRole("button", { name: "End game", exact: true }).click();
  return page.getByRole("dialog", { name: "Check the table" });
}

function assertNaturalResult(game: GameState) {
  expect(game.result?.reason).toBe("natural");
  expect(game.result?.adjustments).toEqual({
    doug: { deduction: 0, transfer: 5, finalScore: game.scores.doug + 5 },
    erin: { deduction: 5, transfer: 0, finalScore: -5 },
  });
  expect(game.result?.actualBagCount).toBe(0);
  expect(game.result?.racks).toEqual({ doug: [], erin: [..."EEEEE??"] });
  expect(game.events.filter((e) => e.command.type === "finalize")).toHaveLength(
    1,
  );
  expect(
    hydrateGame(JSON.parse(JSON.stringify(game)), testLexicon),
  ).toMatchObject({
    ok: true,
    game,
  });
}

test("timed rack-out validates letters, previews transfer, retries final save once and reloads", async ({
  page,
}) => {
  const f = await fixture(page, { loseFinalAck: true });
  const initialRevision = f.game().revision;
  await openCounts(page);
  await page
    .getByRole("button", { name: "Continue to ending review", exact: true })
    .click();
  const ending = page.getByRole("dialog", { name: "Review the ending" });
  const confirm = ending.getByRole("button", { name: "Confirm final results" });
  await expect(confirm).toBeDisabled();
  await ending.getByLabel("Erin remaining tiles", { exact: true }).fill("EEEE");
  await expect(confirm).toBeDisabled();
  await expect(ending).toContainText(/expected 7 tiles but entered 4/);
  await ending
    .getByLabel("Erin remaining tiles", { exact: true })
    .fill("EEEEE??");
  await expect(confirm).toBeEnabled();
  const emptyRack = ending.getByLabel("Doug remaining tiles", { exact: true });
  await emptyRack.fill("H");
  await expect(ending.getByRole("alert")).toContainText("Only 0 H tiles");
  await expect(emptyRack).toHaveValue("");
  await expect(emptyRack).toHaveAttribute("aria-invalid", "false");
  await ending.getByLabel("Erin remaining tiles", { exact: true }).focus();
  await expect(ending.getByRole("alert")).toHaveCount(0);
  await expect(confirm).toBeEnabled();
  const rows = ending.locator("tbody tr");
  await expect(rows.nth(0)).toContainText("+5");
  await expect(rows.nth(1)).toContainText("−5");
  await page.screenshot({
    path: test.info().outputPath("timed-natural-ending-review.png"),
    fullPage: true,
  });
  await confirm.click();
  const retry = page.getByRole("button", {
    name: "Retry saved action",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(retry).toHaveCount(0);
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]).toEqual(f.requests[0]);
  expect(f.game().revision).toBe(initialRevision + 1);
  const command = f.game().events.at(-1)!.command;
  expect(command.type).toBe("finalize");
  expect(command.timedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  assertNaturalResult(f.game());
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Final results", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm final results" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("timed-natural-ending-reloaded.png"),
    fullPage: true,
  });
  expect(f.requests).toHaveLength(2);
  assertNaturalResult(f.game());
});

test("timed ending count correction requires complete audited counts and restores rack-out", async ({
  page,
}) => {
  const f = await fixture(page, { corrected: true });
  const counts = await openCounts(page);
  await counts.getByLabel("Doug actual rack count").fill("0");
  await expect(counts).toContainText("1 tiles are unaccounted for");
  const save = counts.getByRole("button", { name: "Save count correction" });
  await expect(save).toBeDisabled();
  await counts.getByLabel("Erin actual rack count").fill("7");
  await expect(save).toBeDisabled();
  await counts
    .getByLabel("Reason for the correction")
    .fill("Recounted the physical racks");
  await expect(save).toBeDisabled();
  await counts.getByLabel("Scorer name").fill("Doug");
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => f.game().pendingEnd).toBe("natural");
  const ending = page.getByRole("dialog", { name: "Review the ending" });
  await ending
    .getByLabel("Erin remaining tiles", { exact: true })
    .fill("EEEEE??");
  const confirm = ending.getByRole("button", { name: "Confirm final results" });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect.poll(() => f.game().status).toBe("finalized");
  expect(f.requests).toHaveLength(2);
  expect(
    f.game().events.filter((e) => e.command.type === "reconcile"),
  ).toHaveLength(2);
  assertNaturalResult(f.game());
});

test("a viewer cannot open ending or send finalization for a timed rack-out", async ({
  page,
}) => {
  const f = await fixture(page, { viewer: true });
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "End game", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm final results" }),
  ).toHaveCount(0);
  expect(f.requests).toHaveLength(0);
  expect(f.game().status).toBe("active");
});

test("correcting a tile still in the bag clears natural ending and gives no going-out transfer", async ({
  page,
}) => {
  const f = await fixture(page);
  const counts = await openCounts(page);
  await counts.getByLabel("Tiles actually in the bag").fill("1");
  await counts.getByLabel("Erin actual rack count").fill("6");
  await counts
    .getByLabel("Reason for the correction")
    .fill("One E is still in the bag");
  await counts.getByLabel("Scorer name").fill("Doug");
  await counts.getByRole("button", { name: "Save count correction" }).click();
  await expect(counts).toHaveCount(0);
  expect(f.game().pendingEnd).toBeNull();
  expect(f.game().expectedBagCount).toBe(1);
  expect(f.game().status).toBe("active");
  expect(f.game().result).toBeNull();
  await openCounts(page);
  await page
    .getByRole("button", { name: "Continue to ending review", exact: true })
    .click();
  const ending = page.getByRole("dialog", { name: "Review the ending" });
  await expect(ending).toContainText("This game will be marked ended early");
  await ending
    .getByLabel("Erin remaining tiles", { exact: true })
    .fill("EEEE??");
  await expect(ending.locator("tbody tr").nth(0)).toContainText("+0");
  await ending.getByRole("button", { name: "Confirm final results" }).click();
  await expect.poll(() => f.game().status).toBe("finalized");
  expect(f.game().result).toMatchObject({
    reason: "early",
    actualBagCount: 1,
    adjustments: {
      doug: { deduction: 0, transfer: 0 },
      erin: { deduction: 4, transfer: 0 },
    },
  });
});
