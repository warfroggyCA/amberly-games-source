import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import type { SharedOperation } from "../../src/lib/shared-contract";

const identities = JSON.parse(
  process.env.AMBERLY_INTEGRATED_IDENTITIES!,
) as Record<"owner" | "member", { id: string; email: string }>;
const origin = process.env.AMBERLY_INTEGRATED_ORIGIN!;
const authOrigin = process.env.AMBERLY_INTEGRATED_AUTH_ORIGIN!;
async function signIn(page: Page, email: string) {
  await page.goto("/family");
  await page.getByLabel("Your email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Email me a code", exact: true })
    .click();
  await page.getByLabel("Email code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
async function mutate(request: APIRequestContext, operation: SharedOperation) {
  const response = await request.post("/api/family", {
    headers: { Origin: origin },
    data: { requestId: randomUUID(), operation },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test("real invitation/profile, persisted scoring, final history, and reduced permission stay consistent", async ({
  browser,
  page,
}, testInfo) => {
  // No route interception: browser traffic reaches the production Next server.
  const owner = page;
  await signIn(owner, identities.owner.email);
  await expect(
    owner.getByRole("heading", { name: "What are we playing?" }),
  ).toBeVisible();
  // Model elapsed time in the already-issued synthetic session. Keep its real
  // fixture credentials intact so the production SSR client must renew them.
  const authCookies = (await owner.context().cookies(origin)).filter((cookie) =>
    /^sb-.+-auth-token$/.test(cookie.name),
  );
  expect(authCookies).toHaveLength(1);
  const cookie = authCookies[0];
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.value.startsWith("base64-")).toBe(true);
  const before = JSON.parse(
    Buffer.from(cookie.value.slice(7), "base64url").toString(),
  );
  const observationBefore = await (
    await owner.request.get(`${authOrigin}/__fixture/observations`)
  ).json();
  await owner.context().addCookies([
    {
      ...cookie,
      value: `base64-${Buffer.from(JSON.stringify({ ...before, expires_at: Math.floor(Date.now() / 1000) - 60 })).toString("base64url")}`,
    },
  ]);
  await owner.reload();
  await expect(
    owner.getByRole("heading", { name: "What are we playing?" }),
  ).toBeVisible();
  const observationAfter = await (
    await owner.request.get(`${authOrigin}/__fixture/observations`)
  ).json();
  expect(observationAfter.refreshCalls[identities.owner.id]).toBeGreaterThan(
    observationBefore.refreshCalls[identities.owner.id] ?? 0,
  );
  const renewedCookie = (await owner.context().cookies(origin)).find(
    (candidate) => candidate.name === cookie.name,
  )!;
  expect(renewedCookie.httpOnly).toBe(true);
  const renewed = JSON.parse(
    Buffer.from(renewedCookie.value.slice(7), "base64url").toString(),
  );
  expect(renewed.expires_at).toBeGreaterThan(
    Math.floor(Date.now() / 1000) + 3000,
  );
  expect(renewed.access_token !== before.access_token).toBe(true);
  expect(renewed.refresh_token !== before.refresh_token).toBe(true);
  const authenticated = await owner.request.get("/api/auth/session");
  expect(authenticated.ok()).toBe(true);
  expect((await authenticated.json()).user.id).toBe(identities.owner.id);
  const continued = await owner.request.get("/api/family");
  expect(continued.ok()).toBe(true);
  expect((await continued.json()).member.userId).toBe(identities.owner.id);
  await mutate(owner.request, {
    type: "invite-member",
    email: identities.member.email,
  });
  const memberContext = await browser.newContext({ baseURL: origin });
  const member = await memberContext.newPage();
  try {
    await signIn(member, identities.member.email);
    await member
      .getByRole("button", { name: "Accept family invitation", exact: true })
      .click();
    await expect(
      member.getByRole("heading", { name: "Set up your player profile" }),
    ).toBeVisible();
    await member.getByLabel("Real name", { exact: true }).fill("Bob");
    await member
      .getByRole("button", { name: "Save & go to games", exact: true })
      .click();
    await expect(
      member.getByRole("heading", { name: "What are we playing?" }),
    ).toBeVisible();
    const family = await (await member.request.get("/api/family")).json();
    const bobId = family.member.playerId as string;
    expect(family.member.profileSetupPending).toBe(false);
    expect(
      family.players.filter((player: { id: string }) => player.id === bobId),
    ).toHaveLength(1);

    await member.goto("/family/crokinole/new");
    await member
      .getByRole("button", { name: "2 players", exact: true })
      .click();
    await member.locator("summary").filter({ hasText: "Game options" }).click();
    await member
      .getByRole("combobox", { name: "Scoring", exact: true })
      .selectOption("cumulative_round_totals");
    await member
      .getByRole("combobox", { name: "Match length", exact: true })
      .selectOption("fixed_rounds");
    await member.getByLabel("Rounds", { exact: true }).fill("1");
    await member
      .getByRole("button", { name: "Start game", exact: true })
      .click();
    await member
      .getByRole("button", { name: "Add Round 1", exact: true })
      .click();
    await member.getByLabel("Alice round total", { exact: true }).fill("65");
    await member.getByLabel("Bob round total", { exact: true }).fill("40");
    await member
      .getByRole("button", { name: "Keep draft & close", exact: true })
      .click();
    await member.reload();
    await member
      .getByRole("button", { name: "Continue entry", exact: true })
      .click();
    await expect(
      member.getByLabel("Alice round total", { exact: true }),
    ).toHaveValue("65");
    await member
      .getByRole("button", { name: "Save round", exact: true })
      .click();
    await member
      .getByRole("dialog", { name: "Well played!" })
      .getByRole("button", { name: "Close dialog" })
      .click();
    await expect(
      member.getByRole("heading", { name: "Alice wins", exact: true }),
    ).toBeVisible();
    const crokinoleId = member.url().split("/").at(-1)!;
    const saved = await (
      await member.request.get(`/api/family/crokinole?gameId=${crokinoleId}`)
    ).json();
    expect(saved.games[0].rounds).toHaveLength(1);
    expect(saved.games[0].totals).toEqual({ alice: 65, [bobId]: 40 });
    await member.screenshot({
      path: testInfo.outputPath("real-crokinole-result.png"),
      fullPage: true,
    });

    const created = await mutate(owner.request, {
      type: "create-game",
      id: randomUUID(),
      mode: "confirmed",
      players: [
        { id: "alice", seat: 0 },
        { id: bobId, seat: 2 },
      ],
      firstPlayerId: "alice",
      direction: "clockwise",
      deviceId: "integrated-owner",
    });
    const gameId = created.game.id;
    const operation: SharedOperation = {
      type: "game-commands",
      gameId,
      deviceId: "integrated-owner",
      generation: 1,
      commands: [
        {
          id: randomUUID(),
          type: "play",
          expectedRevision: 0,
          placements: [
            { row: 7, col: 7, tile: { letter: "A", blank: false } },
            { row: 7, col: 8, tile: { letter: "T", blank: false } },
          ],
        },
        {
          id: randomUUID(),
          type: "finalize",
          expectedRevision: 1,
          reason: "early",
          racks: {
            alice: ["Q", "Z", "J", "X", "K", "F", "H"],
            [bobId]: ["E", "E", "E", "E", "E", "E", "E"],
          },
        },
      ],
    };
    const request = { requestId: randomUUID(), operation };
    const response = await owner.request.post("/api/family", {
      headers: { Origin: origin },
      data: request,
    });
    expect(response.ok(), await response.text()).toBe(true);
    const final = await response.json();
    expect(final.game.result.scores).toEqual({ alice: -45, [bobId]: -7 });
    const replay = await owner.request.post("/api/family", {
      headers: { Origin: origin },
      data: request,
    });
    expect(replay.ok(), await replay.text()).toBe(true);
    expect((await replay.json()).replayed).toBe(true);
    await member.goto("/family/history");
    await expect(
      member.locator(".hub-recent-game").filter({ hasText: "scrabble" }),
    ).toContainText("Alice: -45");
    await expect(
      member.locator(".hub-recent-game").filter({ hasText: "scrabble" }),
    ).toContainText("Bob: -7");
    await member.screenshot({
      path: testInfo.outputPath("real-combined-history.png"),
      fullPage: true,
    });

    await member.goto(`/family/crokinole/${crokinoleId}`);
    await member
      .getByRole("button", { name: "Review round 1", exact: true })
      .click();
    await memberContext.setOffline(true);
    await member
      .getByRole("button", { name: "Edit round", exact: true })
      .click();
    await member.getByLabel("Alice round total", { exact: true }).fill("70");
    await member
      .getByRole("button", { name: "Keep draft & close", exact: true })
      .click();
    await expect(
      member.getByRole("button", { name: "Retry saved action", exact: true }),
    ).toBeVisible();

    const members = (await (await owner.request.get("/api/family")).json())
      .members;
    const current = members.find(
      (entry: { userId: string }) => entry.userId === identities.member.id,
    );
    await mutate(owner.request, {
      type: "update-member",
      userId: identities.member.id,
      role: "member",
      active: true,
      playerId: bobId,
      reason: "Integrated permission reduction",
      expectedRevision: current.revision,
      permissions: { ...current.permissions, scoreGames: false },
    });
    await memberContext.setOffline(false);
    const deniedResponse = member.waitForResponse(
      (response) =>
        response.url().includes("/api/family/crokinole") &&
        response.request().method() === "POST",
    );
    await member
      .getByRole("button", { name: "Retry saved action", exact: true })
      .click();
    const denied = await deniedResponse;
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe("PERMISSION_DENIED");
    await expect(
      member.getByRole("button", { name: "Retry saved action", exact: true }),
    ).toHaveCount(0);
    const retained = await member.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("amberly-crokinole-workspaces", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<
          {
            workspace: {
              pending: unknown;
              drafts: Record<string, { values: Record<string, string> }>;
            };
          }[]
        >((resolve, reject) => {
          const request = db
            .transaction("workspaces", "readonly")
            .objectStore("workspaces")
            .getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
    expect(retained[0].workspace.pending).toBeNull();
    expect(retained[0].workspace.drafts[crokinoleId].values.alice).toBe("70");
    const viewer = await member.request.get(
      `/api/family/crokinole?gameId=${crokinoleId}`,
    );
    expect(viewer.ok()).toBe(true);
    const viewing = await viewer.json();
    expect(viewing.access[crokinoleId].canScore).toBe(false);
    expect(viewing.games[0].rounds).toHaveLength(1);
    expect(viewing.games[0].totals).toEqual({ alice: 65, [bobId]: 40 });
    await member.reload();
    await expect(
      member.getByRole("heading", { name: "Alice wins", exact: true }),
    ).toBeVisible();
    await expect(
      member.getByRole("button", { name: "Save round", exact: true }),
    ).toHaveCount(0);
    await expect(
      member.getByRole("button", { name: "Retry saved action", exact: true }),
    ).toHaveCount(0);
  } finally {
    await memberContext.close();
  }
});
