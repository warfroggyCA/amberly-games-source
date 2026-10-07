import { test, expect } from "@playwright/test";
import { createGame, applyCommand } from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import { REFRESH_HEADER } from "../../src/lib/shared-refresh";
import { refreshFixture } from "../shared-refresh-fixture";
import { installFixture } from "./fixtures/crokinole";

test("small refreshes keep moves current, pause while hidden and recover on reconnect", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  const made = createGame({
    id: "refresh-game",
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw Error(made.error.message);
  const family = fixture.family;
  family.games = [made.game];
  family.gameAccess[made.game.id] = {
    scorerUserId: family.member.userId,
    deviceId: "test",
    generation: 1,
    mode: "confirmed",
    recordsEligible: true,
    protests: [],
    canScore: true,
    approvals: [],
  };
  const responses: { keys: string[]; bytes: number }[] = [];
  let fail = false;
  await page.route(/\/api\/family(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    if (fail) {
      fail = false;
      return route.abort();
    }
    const scope =
      new URL(route.request().url()).searchParams.get("gameId") ?? "";
    const body = refreshFixture(
      family,
      JSON.parse(route.request().headers()[REFRESH_HEADER] ?? "{}"),
      scope,
    );
    responses.push({
      keys: Object.keys(body.values),
      bytes: Buffer.byteLength(JSON.stringify(body)),
    });
    return route.fulfill({ json: body });
  });
  await page.route("**/api/family/draft*", (route) =>
    route.fulfill({ json: { draft: null } }),
  );
  await page.goto("/family/scrabble");
  await page.locator(".game-list button").first().click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => responses.at(-1)?.keys.length).toBe(0);
  const baseline = responses.length;
  await page.evaluate(() =>
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    }),
  );
  await page.waitForTimeout(5500);
  expect(responses).toHaveLength(baseline);
  const played = applyCommand(
    family.games[0],
    {
      type: "play",
      id: "remote-play",
      expectedRevision: 0,
      placements: ["C", "A", "T"].map((letter, i) => ({
        row: 7,
        col: 7 + i,
        tile: { letter: letter as "C" | "A" | "T", blank: false },
      })),
    },
    testLexicon,
  );
  if (!played.ok) throw Error(played.error.message);
  family.games = [played.game];
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("cell-H8")).toHaveAccessibleName(/H8 C/);
  expect(
    responses.some(
      (r) => r.keys.length === 1 && r.keys[0] === "g:refresh-game",
    ),
  ).toBe(true);
  fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByText(/connection was interrupted/i).first(),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/connection was interrupted/i)).toHaveCount(0);
  await expect(page.getByTestId("cell-H8")).toHaveAccessibleName(/H8 C/);
});
