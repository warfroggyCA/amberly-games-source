import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { installFixture } from "./fixtures/crokinole";

test("selected Crokinole refreshes resume, recover without stale hints and revoke cached scoring", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  const reads: { hint: string; unchanged: boolean }[] = [];
  let fail = false,
    revoked = false;
  await page.route("**/api/family/crokinole*", (route) => {
    const request = route.request(),
      id = new URL(request.url()).searchParams.get("gameId");
    if (request.method() !== "GET" || !id) return route.fallback();
    const hint = request.headers()["x-scrabble-refresh"] ?? "";
    if (fail) {
      fail = false;
      reads.push({ hint, unchanged: false });
      return route.abort();
    }
    if (revoked)
      return route.fulfill({
        status: 403,
        json: { error: "Fixture access revoked", code: "NOT_A_MEMBER" },
      });
    const state = {
      ...fixture.shared,
      games: fixture.shared.games.filter((g) => g.definition.id === id),
      access: { [id]: fixture.shared.access[id] },
      draft: null,
    };
    const version = createHash("md5")
      .update(JSON.stringify(state))
      .digest("hex");
    reads.push({ hint, unchanged: hint === version });
    return route.fulfill({
      json: {
        kind: "crokinole-game-refresh-v1",
        gameId: id,
        version,
        state: hint === version ? null : state,
      },
    });
  });
  const refresh = () =>
    page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.goto("/family/crokinole/new");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Round 1", exact: true }),
  ).toBeVisible();
  await expect.poll(() => reads.length).toBeGreaterThan(0);
  await refresh();
  await expect.poll(() => reads.at(-1)?.unchanged).toBe(true);
  await page.evaluate(() =>
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    }),
  );
  const count = reads.length;
  await page.waitForTimeout(5500);
  expect(reads).toHaveLength(count);
  const access = fixture.shared.access[fixture.game().definition.id];
  access.generation++;
  access.canScore = false;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => reads.length).toBeGreaterThan(count);
  expect(reads.at(-1)?.unchanged).toBe(false);
  await expect(
    page.getByRole("button", { name: "Add Round 1", exact: true }),
  ).toHaveCount(0);
  fail = true;
  await refresh();
  await expect(
    page.getByText(/connection was interrupted/i).first(),
  ).toBeVisible();
  const failedCount = reads.length;
  await refresh();
  await expect.poll(() => reads.length).toBeGreaterThan(failedCount);
  expect(reads.at(-1)?.hint).toBe("");
  await expect(page.getByText(/connection was interrupted/i)).toHaveCount(0);
  revoked = true;
  await refresh();
  await expect(page.getByText("Fixture access revoked").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add Round 1", exact: true }),
  ).toHaveCount(0);
});
