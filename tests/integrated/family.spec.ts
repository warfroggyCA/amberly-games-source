import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import type { GameState } from "../../src/domain/game";
import type {
  SharedMutation,
  SharedOperation,
} from "../../src/lib/shared-contract";

const identities = JSON.parse(
  process.env.AMBERLY_INTEGRATED_IDENTITIES!,
) as Record<"owner" | "member", { id: string; email: string }>;
const origin = process.env.AMBERLY_INTEGRATED_ORIGIN!;
const authOrigin = process.env.AMBERLY_INTEGRATED_AUTH_ORIGIN!;
const ownerHeaders = { Origin: origin, "x-scrabble-user": identities.owner.id };
const memberHeaders = { "x-scrabble-user": identities.member.id };
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
    headers: ownerHeaders,
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
  const missingAccount = await owner.request.get("/api/family");
  expect(missingAccount.status()).toBe(401);
  const wrongAccount = await owner.request.get("/api/family", {
    headers: memberHeaders,
  });
  expect(wrongAccount.status()).toBe(401);
  const continued = await owner.request.get("/api/family", {
    headers: ownerHeaders,
  });
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
    const family = await (
      await member.request.get("/api/family", { headers: memberHeaders })
    ).json();
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
      await member.request.get(`/api/family/crokinole?gameId=${crokinoleId}`, {
        headers: memberHeaders,
      })
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
      headers: ownerHeaders,
      data: request,
    });
    expect(response.ok(), await response.text()).toBe(true);
    const final = await response.json();
    expect(final.game.result.scores).toEqual({ alice: -45, [bobId]: -7 });
    const replay = await owner.request.post("/api/family", {
      headers: ownerHeaders,
      data: request,
    });
    expect(replay.ok(), await replay.text()).toBe(true);
    expect((await replay.json()).replayed).toBe(true);
    await member.goto("/family/history");
    await expect(
      member.locator(".hub-recent-game").filter({ hasText: "scrabble" }),
    ).toHaveAccessibleName(/Alice: -45 points/);
    await expect(
      member.locator(".hub-recent-game").filter({ hasText: "scrabble" }),
    ).toHaveAccessibleName(/Bob: -7 points/);
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

    const members = (
      await (
        await owner.request.get("/api/family", { headers: ownerHeaders })
      ).json()
    ).members;
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
      { headers: memberHeaders },
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

    // Real report API + database, with the same Auth boundary as gameplay.
    const usageQuery = new URLSearchParams({
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date(Date.now() + 86400000).toISOString(),
    });
    for (const format of ["", "&format=csv"]) {
      const blocked = await member.request.get(
        "/api/family/usage?" + usageQuery + format,
        { headers: memberHeaders },
      );
      expect(blocked.status()).toBe(403);
    }
    const usage = await owner.request.get("/api/family/usage?" + usageQuery, {
      headers: ownerHeaders,
    });
    expect(usage.status(), await usage.text()).toBe(200);
    const usageData = await usage.json();
    expect(usageData.summary.savedActions).toBeGreaterThan(0);
    expect(usageData.summary.visits).toBeGreaterThan(0);
    expect(
      usageData.rows.some((r: { kind: string }) => r.kind === "saved"),
    ).toBe(true);
    const csv = await owner.request.get(
      "/api/family/usage?" + usageQuery + "&format=csv",
      { headers: ownerHeaders },
    );
    expect(csv.status()).toBe(200);
    expect(csv.headers()["cache-control"]).toContain("no-store");
    expect(await csv.text()).toContain("Estimated active seconds");
    await owner.goto("/family");
    await owner
      .getByRole("button", { name: "Open Amberly menu", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Access & Usage", exact: true })
      .click();
    const usageDialog = owner.getByRole("dialog", {
      name: "Access & Usage",
      exact: true,
    });
    await expect(
      usageDialog.getByRole("button", { name: "Export filtered CSV" }),
    ).toBeVisible();
    await expect(usageDialog.getByRole("alert")).toHaveCount(0);
    await usageDialog.screenshot({
      path: testInfo.outputPath("real-access-usage.png"),
    });
  } finally {
    await memberContext.close();
  }
});

test("Word Buddy compiled availability protects creation and normal private promotion through real routes", async ({
  page,
}, info) => {
  await signIn(page, identities.owner.email);
  await expect(
    page.getByRole("heading", { name: "What are we playing?" }),
  ).toBeVisible();
  const family = await (
    await page.request.get("/api/family", { headers: ownerHeaders })
  ).json();
  const deviceId = await page.evaluate(
    ({ familyId, userId }) =>
      localStorage.getItem(`scrabble-device:${familyId}:${userId}`),
    { familyId: family.family.id, userId: identities.owner.id },
  );
  expect(deviceId).toBeTruthy();
  const bob = family.players.find((p: { id: string }) => p.id !== "alice");
  const operation: SharedOperation = {
    type: "create-game",
    id: randomUUID(),
    mode: "confirmed",
    wordBuddy: true,
    players: [
      { id: "alice", seat: 0 },
      { id: bob.id, seat: 2 },
    ],
    firstPlayerId: "alice",
    direction: "clockwise",
    deviceId: deviceId!,
  };
  if (process.env.NEXT_PUBLIC_AMBERLY_WORD_BUDDY_ENABLED === "false") {
    const rejected = await page.request.post("/api/family", {
      headers: ownerHeaders,
      data: { requestId: randomUUID(), operation },
    });
    expect(rejected.status()).toBe(409);
    expect(await rejected.json()).toMatchObject({
      code: "WORD_BUDDY_UNAVAILABLE",
    });
    const state = await (
      await page.request.get("/api/family", { headers: ownerHeaders })
    ).json();
    expect(state.games.some((g: { id: string }) => g.id === operation.id)).toBe(
      false,
    );
    const classic = await mutate(page.request, {
      ...operation,
      wordBuddy: false,
    });
    expect(classic.game.definition.wordBuddy).toBe(false);
    return;
  }
  const created = await mutate(page.request, operation);
  const gameId = created.game.id;
  await mutate(page.request, {
    type: "game-commands",
    gameId,
    deviceId: deviceId!,
    generation: 1,
    commands: [
      {
        type: "start-clock",
        id: randomUUID(),
        expectedRevision: 0,
        timedAt: new Date().toISOString(),
      },
    ],
  });
  await page.goto("/family/scrabble");
  await page.locator(".game-list button").first().click();
  await page.getByRole("button", { name: "Test words", exact: true }).click();
  await page.getByTestId("cell-H8").click();
  await page.locator(".board-input").fill("CAT");
  const read = async () =>
    (
      await (
        await page.request.get(`/api/family?gameId=${gameId}`, {
          headers: ownerHeaders,
        })
      ).json()
    ).games.find((g: { id: string }) => g.id === gameId);
  expect((await read()).turns).toHaveLength(0);
  await page
    .getByRole("button", { name: "Use this play", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Share as live draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Review turn", exact: true }).click();
  await page.getByRole("button", { name: /^Record \d+ points$/ }).click();
  await expect.poll(async () => (await read()).turns.length).toBe(1);
  const saved = await read();
  expect(saved.turns[0].placements).toHaveLength(3);
  expect(
    saved.events.filter(
      (e: { command: { type: string } }) => e.command.type === "play",
    ),
  ).toHaveLength(1);
  expect(saved.definition.wordBuddy).toBe(true);
  await page.screenshot({
    path: info.outputPath("real-word-buddy-recorded.png"),
  });
});

test("real guest coaching uses authorized original positions and never uploads racks", async ({
  browser,
  page,
}) => {
  await signIn(page, identities.owner.email);
  await expect(
    page.getByRole("heading", { name: "What are we playing?" }),
  ).toBeVisible();
  const firstId = randomUUID(),
    secondId = randomUUID(),
    gameId = randomUUID();
  await mutate(page.request, {
    type: "create-player",
    id: firstId,
    profile: { name: "Coaching Ada" },
  });
  await mutate(page.request, {
    type: "create-player",
    id: secondId,
    profile: { name: "Coaching Ben" },
  });
  const operation: SharedOperation = {
    type: "create-game",
    id: gameId,
    coaching: true,
    mode: "confirmed",
    players: [
      { id: firstId, seat: 0 },
      { id: secondId, seat: 2 },
    ],
    firstPlayerId: firstId,
    direction: "clockwise",
    deviceId: "integration",
  };
  if (process.env.NEXT_PUBLIC_AMBERLY_COACHING_ENABLED === "false") {
    const rejected = await page.request.post("/api/family", {
      headers: ownerHeaders,
      data: { requestId: randomUUID(), operation },
    });
    expect(rejected.status()).toBe(409);
    expect(await rejected.json()).toMatchObject({
      code: "COACHING_UNAVAILABLE",
    });
    const state = await (
      await page.request.get("/api/family", { headers: ownerHeaders })
    ).json();
    expect(state.games.some((g: { id: string }) => g.id === gameId)).toBe(
      false,
    );
    const denied = await page.request.get(
      "/api/watch/coaching?turnId=cached-turn",
      {
        headers: { Authorization: `Bearer ${"a".repeat(64)}` },
      },
    );
    expect(denied.status()).toBe(404);
    expect(await denied.json()).not.toHaveProperty("position");
    const classic = await mutate(page.request, {
      ...operation,
      coaching: false,
    });
    expect(classic.game.definition.coaching).toBe(false);
    return;
  }
  const created = await mutate(page.request, operation);
  const turnId = "coaching:original.turn";
  const recorded = await mutate(page.request, {
    type: "game-commands",
    gameId,
    deviceId: "integration",
    generation: created.gameAccess.generation,
    commands: [
      {
        type: "play",
        id: turnId,
        expectedRevision: created.game.revision,
        placements: [..."CAT"].map((letter, i) => ({
          row: 7,
          col: 7 + i,
          tile: { letter: letter as "C" | "A" | "T", blank: false },
        })),
      },
    ],
  });
  const token =
    randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  await mutate(page.request, { type: "create-watch-link", gameId, token });
  const context = await browser.newContext({ baseURL: origin });
  const guest = await context.newPage();
  const traffic: string[] = [];
  guest.on("request", (r) =>
    traffic.push(r.method() + " " + r.url() + " " + (r.postData() ?? "")),
  );
  try {
    const direct = await context.request.get(
      `/api/watch/coaching?turnId=${encodeURIComponent(turnId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(direct.status()).toBe(200);
    const { position } = await direct.json();
    expect(position.board.flat().every((tile: unknown) => tile === null)).toBe(
      true,
    );
    expect(position.turn).toEqual(recorded.game.turns[0]);
    expect(position).not.toHaveProperty("events");
    expect(position).not.toHaveProperty("racks");
    await guest.goto(`/watch#${token}`);
    await guest
      .getByRole("button", { name: "Post-turn coaching", exact: true })
      .click();
    await guest.getByLabel("Your seat").selectOption(firstId);
    await guest.getByLabel("Registered turn").selectOption(turnId);
    await guest.getByLabel(/^Full rack before/).fill("CATEIRS");
    await guest
      .getByRole("button", { name: "Review this turn", exact: true })
      .click();
    await expect(guest.getByRole("button", { name: /^gold ·/i })).toBeVisible({
      timeout: 35000,
    });
    expect(traffic.some((entry) => entry.includes("CATEIRS"))).toBe(false);
    expect(
      traffic.some(
        (entry) =>
          entry.startsWith("POST") && /\/api\/(family|watch)/.test(entry),
      ),
    ).toBe(false);
    await mutate(page.request, { type: "revoke-watch-link", gameId });
    const denied = await context.request.get(
      `/api/watch/coaching?turnId=${encodeURIComponent(turnId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(denied.status()).toBe(404);
    await expect(guest.getByRole("dialog")).toHaveCount(0, { timeout: 12000 });
  } finally {
    await context.close();
  }
});

test("real clock recovery preserves the draft and journal across retries, stale requests and reload", async ({
  page,
}, info) => {
  // No route interception: the scorer, retry receipt and reads use real Next + PostgreSQL.
  await signIn(page, identities.owner.email);
  await expect(
    page.getByRole("heading", { name: "What are we playing?" }),
  ).toBeVisible();
  const family = await (
    await page.request.get("/api/family", { headers: ownerHeaders })
  ).json();
  const deviceId = await page.evaluate(
    ({ familyId, userId }) =>
      localStorage.getItem(`scrabble-device:${familyId}:${userId}`),
    { familyId: family.family.id, userId: identities.owner.id },
  );
  expect(deviceId).toBeTruthy();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const firstName = `Clock Ada ${firstId.slice(0, 8)}`;
  await mutate(page.request, {
    type: "create-player",
    id: firstId,
    profile: { name: firstName },
  });
  await mutate(page.request, {
    type: "create-player",
    id: secondId,
    profile: { name: `Clock Ben ${secondId.slice(0, 8)}` },
  });
  const created = await mutate(page.request, {
    type: "create-game",
    id: randomUUID(),
    mode: "confirmed",
    players: [
      { id: firstId, seat: 0 },
      { id: secondId, seat: 2 },
    ],
    firstPlayerId: firstId,
    direction: "clockwise",
    deviceId: deviceId!,
  });
  const gameId = created.game.id as string;
  const generation = created.gameAccess.generation as number;
  const futureClock = new Date(Date.now() + 86400000).toISOString();
  const started = await mutate(page.request, {
    type: "game-commands",
    gameId,
    deviceId: deviceId!,
    generation,
    commands: [
      {
        type: "start-clock",
        id: randomUUID(),
        expectedRevision: 0,
        timedAt: futureClock,
      },
    ],
  });
  const read = async (): Promise<GameState> => {
    const response = await page.request.get(`/api/family?gameId=${gameId}`, {
      headers: ownerHeaders,
    });
    expect(response.ok(), await response.text()).toBe(true);
    const state = await response.json();
    const game = (state.games as GameState[]).find((g) => g.id === gameId);
    expect(game).toBeDefined();
    return game!;
  };
  const blocked = await page.request.post("/api/family", {
    headers: ownerHeaders,
    data: {
      requestId: randomUUID(),
      operation: {
        type: "game-commands",
        gameId,
        deviceId: deviceId!,
        generation,
        commands: [
          {
            type: "pass",
            id: randomUUID(),
            expectedRevision: 1,
            timedAt: new Date().toISOString(),
          },
        ],
      } satisfies SharedOperation,
    },
  });
  expect(blocked.status()).toBe(400);
  expect(await blocked.json()).toMatchObject({ code: "CLOCK_MOVED_BACK" });
  expect(await read()).toEqual(started.game);

  await page.goto("/family/scrabble");
  await page
    .locator(".game-list button")
    .filter({ hasText: firstName })
    .click();
  await expect(page.getByTestId("cell-H8")).toBeVisible();
  // Keep this game open in the URL as well as the device workspace for reloads.
  await page.goto("/family/scrabble?view=play");
  const draftSaved = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/family/draft" &&
      request.method() === "POST" &&
      request.postDataJSON()?.placements?.length === 3,
  );
  await page.getByTestId("cell-H8").click();
  await page
    .getByRole("textbox", { name: "Type letters on the board" })
    .pressSequentially("CAT");
  await draftSaved;
  await page
    .getByRole("button", { name: "Open game menu", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue without timing", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Continue without timing",
    exact: true,
  });
  await dialog
    .getByLabel("Reason for stopping timing")
    .fill("Synthetic device clock was a day ahead");
  const recoveryResponse = page.waitForResponse((response) => {
    const request = response.request();
    if (
      new URL(response.url()).pathname !== "/api/family" ||
      request.method() !== "POST"
    )
      return false;
    const body = request.postDataJSON() as SharedMutation;
    return (
      body.operation.type === "game-commands" &&
      body.operation.commands.some(
        (command) => command.type === "recover-clock",
      )
    );
  });
  await dialog
    .getByRole("button", { name: "Continue without timing", exact: true })
    .click();
  const recoveredResponse = await recoveryResponse;
  expect(recoveredResponse.ok(), await recoveredResponse.text()).toBe(true);
  const recovered = await recoveredResponse.json();
  await expect(dialog).toHaveCount(0);
  expect(recovered.game.revision).toBe(2);
  expect(recovered.game.events[0]).toEqual(started.game.events[0]);
  expect(recovered.game.turns).toEqual(started.game.turns);
  expect(recovered.game.board).toEqual(started.game.board);
  const recoveryRequest = recoveredResponse
    .request()
    .postDataJSON() as SharedMutation;
  if (recoveryRequest.operation.type !== "game-commands")
    throw Error("The scorer did not submit a recovery command.");
  const recoveryCommand = recoveryRequest.operation.commands.find(
    (command) => command.type === "recover-clock",
  );
  expect(recoveryCommand).toMatchObject({
    type: "recover-clock",
    timingPolicy: 1,
    expectedRevision: 1,
  });
  if (!recoveryCommand) throw Error("The recovery command is missing.");
  const duplicate = await page.request.post("/api/family", {
    headers: ownerHeaders,
    data: recoveryRequest,
  });
  expect(duplicate.ok(), await duplicate.text()).toBe(true);
  expect(await duplicate.json()).toMatchObject({
    replayed: true,
    game: { revision: 2 },
  });
  const stale = await page.request.post("/api/family", {
    headers: ownerHeaders,
    data: {
      requestId: randomUUID(),
      operation: {
        ...recoveryRequest.operation,
        commands: [
          { ...recoveryCommand, id: randomUUID(), expectedRevision: 1 },
        ],
      },
    },
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "REVISION_CONFLICT" });
  expect(await read()).toEqual(recovered.game);

  await page.reload();
  await expect(
    page.getByText("Timing unavailable", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("cell-J8")).toHaveAccessibleName(
    "J8 T, 1 points",
  );
  await page.getByRole("button", { name: "Review turn", exact: true }).click();
  await page
    .getByRole("button", { name: "Record 10 points", exact: true })
    .click();
  await expect.poll(async () => (await read()).turns.length).toBe(1);
  const saved = await read();
  expect(saved.revision).toBe(3);
  expect(saved.scores).toEqual({ [firstId]: 10, [secondId]: 0 });
  expect(saved.currentPlayerId).toBe(secondId);
  expect(saved.events.map((event) => event.command.type)).toEqual([
    "start-clock",
    "recover-clock",
    "play",
  ]);
  expect(saved.events[0]).toEqual(started.game.events[0]);
  expect(saved.events[1]).toEqual(recovered.game.events[1]);
  expect(saved.events[2].command).not.toHaveProperty("timedAt");
  await page.reload();
  await expect(
    page.getByText("Timing unavailable", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("cell-J8")).toHaveAccessibleName(
    "J8 T, 1 points",
  );
  expect(await read()).toEqual(saved);
  await page.screenshot({
    path: info.outputPath("real-clock-recovery-reloaded.png"),
  });
});
