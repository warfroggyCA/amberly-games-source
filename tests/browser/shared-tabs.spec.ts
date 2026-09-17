import { test, expect } from "@playwright/test";
import { createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import type { SharedState } from "../../src/lib/shared-contract";

test("new scoring tab takes ownership and preserves the previous tab's letters", async ({
  page,
  context,
}) => {
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "ada@example.test",
  };
  const created = createGame({
    id: "shared-tab-game",
    players: [
      { id: "ada", name: "Ada", seat: 0 },
      { id: "ben", name: "Ben", seat: 2 },
    ],
    firstPlayerId: "ada",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!created.ok) throw new Error(created.error.message);
  const member = {
    userId: user.id,
    email: user.email,
    role: "superadmin" as const,
    active: true,
    playerId: "ada",
  };
  const shared: SharedState = {
    family: { id: "22222222-2222-4222-8222-222222222222", name: "Test family" },
    member,
    members: [member],
    invitations: [],
    players: [
      { id: "ada", name: "Ada" },
      { id: "ben", name: "Ben" },
    ],
    playerAccess: {
      ada: { revision: 0, userId: user.id },
      ben: { revision: 0, userId: null },
    },
    games: [created.game],
    gameAccess: {
      [created.game.id]: {
        scorerUserId: user.id,
        deviceId: "initial-device",
        generation: 1,
        mode: "practice",
        recordsEligible: false,
        protests: [],
        canScore: true,
        approvals: [],
      },
    },
    verifiedWords: [],
    nextCursor: null,
  };
  await context.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { configured: true, signInMethod: "google", user } }),
  );
  await context.route(/\/api\/family(?:\?.*)?$/, (route) => {
    if (route.request().method() !== "GET")
      throw new Error(
        "Unexpected confirmed mutation in a draft-only browser test",
      );
    return route.fulfill({ json: shared });
  });
  await context.route("**/api/family/draft*", (route) =>
    route.fulfill({
      json:
        route.request().method() === "POST"
          ? { accepted: true }
          : { draft: null },
    }),
  );
  await page.goto("/family/scrabble");
  await page.locator(".game-list button").first().click();
  await page.getByTestId("cell-H8").click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .pressSequentially("CAT");
  await expect(page.getByTestId("cell-J8")).toHaveAccessibleName(
    "J8 T, 1 points",
  );
  const second = await context.newPage();
  await second.goto("/family/scrabble");
  await second
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await expect(second.getByTestId("cell-J8")).toHaveAccessibleName(
    "J8 T, 1 points",
  );
  await expect(
    page.getByRole("heading", { name: "Scoring moved to another tab" }),
  ).toBeVisible();
  await expect(
    second.getByRole("textbox", { name: "Type letters on the board" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Use this tab", exact: true }).click();
  await page
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await expect(page.getByTestId("cell-J8")).toHaveAccessibleName(
    "J8 T, 1 points",
  );
  await expect(
    second.getByRole("heading", { name: "Scoring moved to another tab" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Type letters on the board" }),
  ).toBeEnabled();
  await second.close();
});
