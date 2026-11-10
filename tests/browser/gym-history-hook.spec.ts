import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const webpack = require("next/dist/compiled/webpack/webpack");
let bundle: string;
const owner = {
  familyId: "a1111111-1111-4111-8111-111111111111",
  userId: "b1111111-1111-4111-8111-111111111111",
  playerId: "ada",
};
const list = { identity: owner, sessions: [], nextCursor: null };
test.beforeAll(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gym-hook-browser-"));
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack.webpack({
      mode: "development",
      entry: path.resolve("tests/fixtures/gym-history-hook.tsx"),
      output: { path: directory, filename: "hook.js" },
      devtool: false,
      resolve: { extensions: [".ts", ".tsx", ".js"] },
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            use: path.resolve("tests/fixtures/typescript-loader.cjs"),
          },
        ],
      },
    });
    compiler.run(
      (
        error: Error | null,
        stats: { hasErrors: () => boolean; toString: () => string },
      ) =>
        compiler.close(() =>
          error || stats.hasErrors()
            ? reject(error ?? new Error(stats.toString()))
            : resolve(),
        ),
    );
  });
  bundle = await readFile(path.join(directory, "hook.js"), "utf8");
});
async function mount(page: Page) {
  await page.addInitScript(
    ({ owner, list }) => {
      const original = fetch.bind(window);
      window.gymReads = [];
      window.fetch = (input, init) => {
        const url = String(input);
        if (url === "/api/auth/session")
          return Promise.resolve(Response.json({ user: { id: owner.userId } }));
        if (url === "/api/family/gym" && init?.method !== "POST")
          return Promise.resolve(Response.json(list));
        if (url.startsWith("/api/family/gym"))
          return new Promise((resolve, reject) =>
            window.gymReads.push({
              url,
              method: init?.method ?? "GET",
              body: init?.body as string | undefined,
              resolve,
              reject,
            }),
          );
        return original(input, init);
      };
    },
    { owner, list },
  );
  await page.route("**/__gym_hook", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/__gym_hook.js"></script>',
    }),
  );
  await page.route("**/__gym_hook.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: bundle }),
  );
  await page.goto("/__gym_hook");
  await expect(page.getByTestId("sync-status")).toHaveText("Profile connected");
}
async function count(page: Page, n: number) {
  await expect.poll(() => page.evaluate(() => window.gymReads.length)).toBe(n);
}
async function finish(page: Page, index: number, body: unknown, status = 200) {
  await page.evaluate(
    ({ index, body, status }) =>
      window.gymReads[index].resolve(Response.json(body, { status })),
    { index, body, status },
  );
}
async function rows(page: Page) {
  return page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open("amberly-gym-outbox", 1);
        open.onupgradeneeded = () =>
          open.result.createObjectStore("events", { keyPath: "key" });
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction("events").objectStore("events").getAll();
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
}
async function queue(page: Page) {
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await count(page, 1);
}
async function receipt(page: Page, index: number) {
  await page.evaluate((i) => {
    const p = JSON.parse(window.gymReads[i].body!);
    window.gymReads[i].resolve(
      Response.json({
        eventId: p.event.id,
        sessionId: p.sessionId,
        sequence: p.event.sequence,
      }),
    );
  }, index);
}

for (const result of ["receipt", "error", "denial"] as const)
  test(`read denial survives older background flush ${result}, close/reopen and lifecycle signals`, async ({
    page,
  }) => {
    await mount(page);
    await queue(page);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await count(page, 2);
    await finish(page, 1, { code: "NO_PROFILE" }, 403);
    await expect(page.getByTestId("state")).toHaveText("denied");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "List", exact: true }).click();
    if (result === "receipt") await receipt(page, 0);
    else
      await finish(
        page,
        0,
        { error: "Old flush failure" },
        result === "denial" ? 403 : 503,
      );
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    await expect(page.getByTestId("sync-status")).toContainText(
      "Reload to reconnect",
    );
    await expect(page.getByTestId("state")).toHaveText("denied");
    await expect(page.getByTestId("owner")).toHaveText("null");
    await expect(page.getByTestId("practice-owner")).toHaveText(
      JSON.stringify(owner),
    );
    await expect(
      page.getByRole("button", { name: "Sync", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await expect
      .poll(() => rows(page).then((r) => r.length))
      .toBe(result === "receipt" ? 0 : 1);
    expect(await page.evaluate(() => window.gymReads.length)).toBe(2);
  });

for (const next of ["close", "new-review", "disable", "unmount"] as const)
  test(`delayed prerequisite flush followed by ${next} never starts superseded list`, async ({
    page,
  }) => {
    await mount(page);
    await queue(page);
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByTestId("state")).toHaveText("loading");
    await page
      .getByRole("button", {
        name:
          next === "close"
            ? "Close"
            : next === "new-review"
              ? "Review"
              : next === "disable"
                ? "Toggle enabled"
                : "Toggle mount",
        exact: true,
      })
      .click();
    if (next === "new-review") {
      await count(page, 2);
      await finish(page, 1, { error: "Synthetic retryable" }, 503);
    }
    await receipt(page, 0);
    await expect.poll(() => rows(page).then((r) => r.length)).toBe(0);
    expect(await page.evaluate(() => window.gymReads.length)).toBe(
      next === "new-review" ? 2 : 1,
    );
    if (next === "unmount") {
      await page
        .getByRole("button", { name: "Toggle mount", exact: true })
        .click();
      await expect(page.getByTestId("sync-status")).toHaveText(
        "Profile connected",
      );
    }
    if (next === "disable") {
      await page
        .getByRole("button", { name: "Toggle enabled", exact: true })
        .click();
      await expect(page.getByTestId("owner")).toHaveText("null");
    }
  });

test("Strict Mode remount removes listeners and rejects old ignored-abort completion", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await count(page, 1);
  await page.getByRole("button", { name: "Toggle mount", exact: true }).click();
  await page.getByRole("button", { name: "Toggle mount", exact: true }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Profile connected");
  await finish(page, 0, { code: "PROFILE_CHANGED" }, 403);
  await expect(page.getByTestId("state")).toHaveText("closed");
  await expect(page.getByTestId("owner")).toHaveText(JSON.stringify(owner));
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await count(page, 2);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  expect(await page.evaluate(() => window.gymReads.length)).toBe(2);
  await receipt(page, 1);
  await expect.poll(() => rows(page).then((r) => r.length)).toBe(0);
});

for (const oldResult of ["success", "error", "denied"] as const)
  test(`late background account-check ${oldResult} cannot overwrite denial`, async ({
    page,
  }) => {
    await mount(page);
    await page.evaluate(() => {
      const previous = fetch.bind(window);
      window.fetch = (input, init) =>
        String(input) === "/api/auth/session"
          ? new Promise((resolve, reject) =>
              window.gymReads.push({
                url: String(input),
                method: "GET",
                resolve,
                reject,
              }),
            )
          : previous(input, init);
    });
    await page.getByRole("button", { name: "Sync", exact: true }).click();
    await count(page, 1);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await count(page, 2);
    await finish(page, 1, { code: "PROFILE_CHANGED" }, 403);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    if (oldResult === "success")
      await finish(page, 0, { user: { id: owner.userId } });
    else
      await finish(
        page,
        0,
        { error: "Old account-check failure" },
        oldResult === "denied" ? 403 : 503,
      );
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    await expect(page.getByTestId("state")).toHaveText("denied");
    await expect(page.getByTestId("sync-status")).toContainText(
      "Reload to reconnect",
    );
    expect(await page.evaluate(() => window.gymReads.length)).toBe(2);
  });

for (const auth of [null, {}, { user: {} }])
  test(`malformed successful auth ${JSON.stringify(auth)} is retryable and preserves original-owner queue`, async ({
    page,
  }) => {
    await mount(page);
    await page.evaluate((auth) => {
      const previous = fetch.bind(window);
      window.fetch = (input, init) =>
        String(input) === "/api/auth/session"
          ? Promise.resolve(Response.json(auth))
          : previous(input, init);
    }, auth);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await expect(page.getByTestId("sync-status")).toContainText(
      "Profile connection returned an invalid response",
    );
    await expect(page.getByTestId("owner")).toHaveText(JSON.stringify(owner));
    await expect(page.getByTestId("state")).toHaveText("closed");
    await expect(
      page.getByRole("button", { name: "Sync", exact: true }),
    ).toBeEnabled();
    await expect.poll(() => rows(page).then((r) => r.length)).toBe(1);
    expect(await page.evaluate(() => window.gymReads.length)).toBe(0);
  });
