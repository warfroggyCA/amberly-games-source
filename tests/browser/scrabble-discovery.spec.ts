import { expect, test } from "@playwright/test";
import { applyCommand, createGame } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { installFixture } from "./fixtures/crokinole";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "44444444-4444-4444-8444-444444444444";

function game(id: string, date: string, name: string, paused = false) {
  const made = createGame({
    id,
    createdAt: date,
    players: [
      { id: "doug", name, seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw new Error(made.error.message);
  if (!paused) return made.game;
  const result = applyCommand(
    made.game,
    {
      type: "pause",
      id: `pause-${id}`,
      expectedRevision: 0,
    },
    testLexicon,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.game;
}

for (const viewerId of [ownerId, otherId]) {
  test(`home discovers a new Scrabble table while retaining paused games for ${viewerId}`, async ({
    page,
  }) => {
    const fixture = await installFixture(page);
    fixture.family.member = {
      ...fixture.family.member,
      userId: viewerId,
      role: "member",
      playerId: viewerId === ownerId ? "doug" : "erin",
    };
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: {
          configured: true,
          signInMethod: "google",
          user: {
            id: viewerId,
            email: fixture.family.member.email,
          },
        },
      }),
    );
    const old = game("old-paused", "2026-10-01T12:00:00Z", "Old table", true);
    const current = game("new-active", "2026-10-02T12:00:00Z", "New table");
    const privateGame = game(
      "private-test",
      "2026-10-03T12:00:00Z",
      "Secret table",
    );
    // Deliberately oldest-first, as merged store refreshes order games this way.
    fixture.family.games = [old, current, privateGame];
    for (const g of fixture.family.games)
      fixture.family.gameAccess[g.id] = {
        scorerUserId: g.id === old.id ? ownerId : otherId,
        deviceId: "test-device",
        generation: 1,
        mode: g.id === privateGame.id ? "practice" : "confirmed",
        recordsEligible: false,
        protests: [],
        approvals: [],
        canScore: false,
      };
    const allGames = [...fixture.family.games];
    fixture.family.games = [old, privateGame];
    const opened: string[] = [];
    await page.route(/\/api\/family(?:\?.*)?$/, (route) => {
      expect(route.request().method()).toBe("GET");
      const id = new URL(route.request().url()).searchParams.get("gameId");
      if (id) opened.push(id);
      return route.fulfill({ json: fixture.family });
    });
    await page.route("**/api/family/draft*", (route) =>
      route.fulfill({ json: { draft: null } }),
    );
    await page.goto("/family");
    const list = page.getByRole("region", {
      name: "Unfinished Scrabble games",
    });
    await expect(list.getByRole("button")).toHaveCount(1);
    await expect(list.getByRole("button")).toContainText("Paused");
    // Another signed-in scorer starts the next game while this viewer is
    // still on Home. The existing refresh must discover it without a link.
    fixture.family.games = allGames;
    const saved = JSON.stringify(fixture.family.games);
    await expect(list.getByRole("button")).toHaveCount(2);
    await expect(list.getByRole("button").first()).toContainText("New table");
    await expect(list.getByRole("button").last()).toContainText("Paused");
    await expect(page.getByText("Secret table", { exact: false })).toHaveCount(
      0,
    );
    const shortcut = page.locator(".hub-game").filter({
      has: page.getByRole("heading", { name: "Scrabble", exact: true }),
    });
    await shortcut
      .getByRole("button", {
        name: viewerId === otherId ? "Resume game" : "View current game",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/family\/scrabble\?view=play$/);
    expect(opened.at(-1)).toBe(current.id);
    await page.goto("/family");
    await list.getByRole("button", { name: /Old table/ }).click();
    await expect(page).toHaveURL(/\/family\/scrabble\?view=play$/);
    expect(opened.at(-1)).toBe(old.id);
    await page.goto("/family");
    await page.reload();
    await expect(list.getByRole("button")).toHaveCount(2);
    await expect(list.getByRole("button").first()).toContainText("New table");
    expect(JSON.stringify(fixture.family.games)).toBe(saved);
  });
}
