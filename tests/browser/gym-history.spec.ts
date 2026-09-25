import { test, expect } from "@playwright/test";
import type {
  GymWrite,
  GymHistory,
  GymSessionDetail,
} from "../../src/lib/gym-history-contract";
test("Gym queues offline help, recovers after reload, and retrieves profile history on another client", async ({
  page,
  context,
  browser,
}) => {
  const identity = {
    familyId: "a1111111-1111-4111-8111-111111111111",
    userId: "b1111111-1111-4111-8111-111111111111",
    playerId: "ada",
  };
  const received = new Map<string, GymWrite>();
  let offline = true;
  const install = async (c: typeof context) => {
    await c.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: {
          configured: true,
          user: { id: identity.userId, email: "ada@example.test" },
        },
      }),
    );
    await c.route("**/api/family/words", (route) =>
      route.fulfill({ json: { words: [] } }),
    );
    await c.route("**/api/family/gym**", async (route) => {
      if (route.request().method() === "POST") {
        if (offline)
          return route.fulfill({
            status: 503,
            json: { error: "Offline test: pending saves kept" },
          });
        const data = route.request().postDataJSON() as GymWrite;
        received.set(data.event.id, data);
        return route.fulfill({
          json: {
            eventId: data.event.id,
            sessionId: data.sessionId,
            sequence: data.event.sequence,
          },
        });
      }
      const rows = [...received.values()].sort(
          (a, b) => a.event.sequence - b.event.sequence,
        ),
        first = rows[0];
      if (new URL(route.request().url()).searchParams.has("sessionId"))
        return route.fulfill({
          json: {
            id: first.sessionId,
            puzzle: first.puzzle,
            replay: false,
            events: rows.map((r) => ({
              ...r.event,
              assisted: true,
              firstAttempt: false,
              receivedAt: r.event.occurredAt,
            })),
          } satisfies GymSessionDetail,
        });
      return route.fulfill({
        json: {
          identity,
          sessions: first
            ? [
                {
                  id: first.sessionId,
                  createdAt: first.event.occurredAt,
                  replay: false,
                  attempts: 0,
                  firstPoints: null,
                  assisted: true,
                },
              ]
            : [],
          nextCursor: null,
        } satisfies GymHistory,
      });
    });
  };
  await install(context);
  await page.goto("/gym-lab?from=family");
  await expect(
    page.getByRole("button", { name: "Start practice", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  await page.getByRole("button", { name: "Hint", exact: true }).click();
  await page.getByRole("button", { name: "Solve", exact: true }).click();
  await expect(
    page.getByText("Offline test: pending saves kept", { exact: true }),
  ).toBeVisible();
  await page.reload();
  offline = false;
  await page.getByRole("button", { name: "Retry sync", exact: true }).click();
  await expect.poll(() => received.size).toBe(2);
  expect([...received.values()].map((r) => r.event.payload.type)).toEqual([
    "hint",
    "solve",
  ]);
  const second = await browser.newContext({ viewport: page.viewportSize() });
  await install(second);
  const other = await second.newPage();
  try {
    await other.goto("/gym-lab?from=family");
    await other
      .getByRole("button", { name: "My practice history", exact: true })
      .click();
    await expect(
      other.getByRole("region", { name: "Practice history" }),
    ).toContainText("0 attempts");
    await other.getByRole("button", { name: /0 attempts/ }).click();
    await expect(
      other.getByRole("region", { name: "Saved practice review" }),
    ).toContainText("Hint 1 viewed");
    await expect(
      other.getByRole("region", { name: "Saved practice review" }),
    ).toContainText("Solution viewed");
    await expect(other.locator(".gym-history-board > span")).toHaveCount(225);
    await other.screenshot({
      path: test.info().outputPath("gym-history-review.png"),
      fullPage: true,
    });
  } finally {
    await second.close();
  }
});

test("standalone LAN practice does not require profile storage or secure-context UUIDs", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/gym-lab");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Solve", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".gym-preview-note")).toContainText(
    "Progress is not saved",
  );
  await expect(
    page.getByRole("button", { name: "My practice history", exact: true }),
  ).toHaveCount(0);
});
