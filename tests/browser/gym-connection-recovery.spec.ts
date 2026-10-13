import { expect, test } from "@playwright/test";
import type { GymHistory } from "../../src/lib/gym-history-contract";

const identity = {
  familyId: "a1111111-1111-4111-8111-111111111111",
  userId: "b1111111-1111-4111-8111-111111111111",
  playerId: "ada",
};
const history = (owner = identity): GymHistory => ({
  identity: owner,
  sessions: [],
  nextCursor: null,
});

for (const [failure, recovery] of [
  ["session", "button"],
  ["history", "button"],
  ["history", "online"],
  ["history", "focus"],
] as const) {
  test(`Gym retries initial ${failure} failure through ${recovery} without reload or duplicate connections`, async ({
    page,
  }) => {
    let recovered = false;
    let historyReads = 0;
    let releaseHistory!: () => void;
    const waiting = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    await page.route("**/api/auth/session", (route) =>
      !recovered && failure === "session"
        ? route.fulfill({
            status: 503,
            json: { error: "Connection test unavailable" },
          })
        : route.fulfill({
            json: {
              configured: true,
              user: { id: identity.userId, email: "ada@example.test" },
            },
          }),
    );
    await page.route("**/api/family/words", (route) =>
      route.fulfill({ json: { words: [] } }),
    );
    await page.route("**/api/family/gym**", async (route) => {
      expect(route.request().method()).toBe("GET");
      historyReads += 1;
      if (!recovered)
        return route.fulfill({
          status: 503,
          json: { error: "Connection test unavailable" },
        });
      await waiting;
      return route.fulfill({ json: history() });
    });
    await page.goto("/gym-lab?from=family", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("Connection test unavailable", { exact: true }),
    ).toBeVisible();
    const retry = page.getByRole("button", {
      name: "Retry connection",
      exact: true,
    });
    const start = page.getByRole("button", {
      name: "Start practice",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await expect(start).toBeDisabled();
    await expect(
      page.getByText("Loading word list…", { exact: true }),
    ).toHaveCount(0);
    const before = historyReads;
    recovered = true;
    if (recovery === "button") await retry.click();
    else
      await page.evaluate(
        (event) => window.dispatchEvent(new Event(event)),
        recovery,
      );
    await expect.poll(() => historyReads).toBe(before + 1);
    await expect(retry).toBeDisabled();
    // Concurrent lifecycle signals must share the in-flight connection.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
    });
    releaseHistory();
    await expect(
      page.getByText("Profile connected", { exact: true }),
    ).toBeVisible();
    await expect(start).toBeEnabled();
    expect(historyReads).toBe(before + 1);
    await start.click();
    await expect(
      page.getByRole("group", { name: "Scrabble practice board" }),
    ).toBeVisible({ timeout: 25000 });
  });
}

test("Gym rejects a delayed previous-account connection and retains that account's queued saves", async ({
  page,
}) => {
  const nextIdentity = {
    ...identity,
    userId: "c1111111-1111-4111-8111-111111111111",
    playerId: "ben",
  };
  let user = identity;
  let historyReads = 0;
  const posts: string[] = [];
  const wordReaders: string[] = [];
  let releaseHistory!: () => void;
  const waiting = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        configured: true,
        user: { id: user.userId, email: "synthetic@example.test" },
      },
    }),
  );
  await page.route("**/api/family/words", (route) => {
    wordReaders.push(route.request().headers()["x-scrabble-user"]);
    return route.fulfill({ json: { words: [] } });
  });
  await page.route("**/api/family/gym**", async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().headers()["x-scrabble-user"]);
      return route.fulfill({
        status: 503,
        json: { error: "Unexpected pending save" },
      });
    }
    historyReads += 1;
    const owner = user;
    if (historyReads === 1) await waiting;
    return route.fulfill({ json: history(owner) });
  });
  await page.goto("/gym-lab?from=family", { waitUntil: "domcontentloaded" });
  await expect.poll(() => historyReads).toBe(1);
  const queued = {
    key:
      JSON.stringify([identity.familyId, identity.userId, identity.playerId]) +
      ":d1111111-1111-4111-8111-111111111111",
    owner: identity,
    data: {
      sessionId: "e1111111-1111-4111-8111-111111111111",
      playerId: identity.playerId,
      puzzle: {},
      event: {
        id: "d1111111-1111-4111-8111-111111111111",
        sequence: 1,
        occurredAt: "2026-10-13T00:00:00.000Z",
        payload: { type: "solve" },
      },
    },
  };
  await page.evaluate(
    (row) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("amberly-gym-outbox", 1);
        open.onupgradeneeded = () =>
          open.result.createObjectStore("events", { keyPath: "key" });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("events", "readwrite");
          tx.objectStore("events").add(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    queued,
  );
  user = nextIdentity;
  releaseHistory();
  await expect(
    page.getByText(
      "Your account changed while connecting. Retry to connect to your current profile.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "My practice history", exact: true }),
  ).toBeDisabled();
  expect(wordReaders).toEqual([]);
  expect(posts).toEqual([]);
  await page
    .getByRole("button", { name: "Retry connection", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start practice", exact: true }),
  ).toBeEnabled();
  expect(wordReaders).toEqual([nextIdentity.userId]);
  expect(posts).toEqual([]);
  const rows = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open("amberly-gym-outbox", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db
            .transaction("events", "readonly")
            .objectStore("events")
            .getAll();
          read.onsuccess = () => {
            db.close();
            resolve(read.result);
          };
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
        };
      }),
  );
  expect(rows).toEqual([queued]);
});
