import { test, expect, type Page } from "@playwright/test";
import { installFixture } from "./fixtures/crokinole";
import { applyCommand, createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import type { SharedMutation } from "../../src/lib/shared-contract";

async function fixture(page: Page) {
  const f = await installFixture(page);
  const made = createGame({
    id: "connection-recovery",
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw Error(made.error.message);
  f.family.games.push(made.game);
  f.family.gameAccess[made.game.id] = {
    scorerUserId: f.family.member.userId,
    deviceId: "test-device",
    generation: 1,
    mode: "practice",
    recordsEligible: false,
    protests: [],
    canScore: true,
    approvals: [],
  };
  return f;
}

test("lost save acknowledgement retries once and clears only obsolete connection messages", async ({
  page,
}) => {
  const f = await fixture(page);
  let failPreview = true;
  const requests: SharedMutation[] = [];
  await page.route("**/api/family/draft*", (route) =>
    failPreview
      ? route.abort("internetdisconnected")
      : route.fulfill({ json: { accepted: true, draft: null } }),
  );
  await page.route(/\/api\/family(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    const mutation = route.request().postDataJSON() as SharedMutation;
    requests.push(mutation);
    if (mutation.operation.type !== "game-commands")
      throw Error("Unexpected mutation");
    if (requests.length === 1) {
      for (const command of mutation.operation.commands) {
        const result = applyCommand(f.family.games[0], command, testLexicon);
        if (!result.ok) throw Error(result.error.message);
        f.family.games[0] = result.game;
      }
      // The server committed, but the caller never received its acknowledgement.
      return route.abort("internetdisconnected");
    }
    expect(mutation).toEqual(requests[0]);
    return route.fulfill({
      json: {
        replayed: true,
        game: f.family.games[0],
        gameAccess: f.family.gameAccess[f.family.games[0].id],
      },
    });
  });
  await page.goto("/family");
  await page.getByRole("button", { name: "Resume game", exact: true }).click();
  await page.getByTestId("cell-H8").click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .pressSequentially("CAT");
  const previewWarning = page.getByText(
    "Viewer preview reconnecting · your entry is retained",
    { exact: true },
  );
  await expect(previewWarning).toBeVisible();
  await page.getByRole("button", { name: "Review turn", exact: true }).click();
  await page
    .getByRole("button", { name: "Record 10 points", exact: true })
    .click();
  const connectionWarning = page.getByText(
    "The connection was interrupted. Your entry is retained; retry the saved action before recording anything else.",
    { exact: true },
  );
  await expect(connectionWarning).toBeVisible();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await expect(connectionWarning).toHaveCount(0);
  await expect(previewWarning).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry saved action", exact: true }),
  ).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(f.family.games[0].revision).toBe(1);
  expect(f.family.games[0].turns).toHaveLength(1);
  expect(f.family.games[0].scores).toEqual({ doug: 10, erin: 0 });

  // A genuinely new failed preview still warns, and its successful retry clears it.
  await page.getByTestId("cell-K8").click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .pressSequentially("S");
  await expect(previewWarning).toBeVisible();
  failPreview = false;
  await expect(previewWarning).toHaveCount(0);
});

test("successful background refresh clears its failure without hiding local validation", async ({
  page,
}) => {
  await fixture(page);
  let failRefresh = false;
  let refreshCount = 0;
  await page.route(/\/api\/family(?:\?.*)?$/, (route) => {
    refreshCount++;
    return failRefresh ? route.abort("internetdisconnected") : route.fallback();
  });
  await page.goto("/family/players");
  await expect(
    page.getByRole("heading", { name: "The players" }),
  ).toBeVisible();
  failRefresh = true;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page
      .getByText(
        "The connection was interrupted. Your entry is retained; retry the saved action before recording anything else.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  failRefresh = false;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByText(
      "The connection was interrupted. Your entry is retained; retry the saved action before recording anything else.",
      { exact: true },
    ),
  ).toHaveCount(0);

  await page.getByRole("textbox", { name: "Player name" }).fill("Doug");
  await page.getByRole("button", { name: "Add player", exact: true }).click();
  const validation = page.getByText(
    "That name already exists in this preview. Choose the existing player or use a distinguishing name.",
    { exact: true },
  );
  await expect(validation).toBeVisible();
  const before = refreshCount;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect.poll(() => refreshCount).toBeGreaterThan(before);
  await expect(validation).toBeVisible();
});
