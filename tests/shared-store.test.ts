import { LETTER_COUNTS } from "../src/domain/board";
import type { Equipment } from "../src/domain/equipment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createGame, applyCommand, type GameState } from "../src/domain/game";
import { testLexicon } from "../src/lib/test-lexicon";
import {
  createSharedStore,
  familyRequest,
  type SharedScorerStore,
} from "../src/lib/shared-store";
import type {
  SharedState,
  SharedMutation,
  SharedOperation,
  GameProtest,
} from "../src/lib/shared-contract";
import type { Draft } from "../src/lib/preview-store";

const userId = "user-1",
  familyId = "family-1",
  deviceId = "device-1";
const slot = `scrabble-device:${familyId}:${userId}`;
const key = `${familyId}:${userId}:${deviceId}`;
const databaseName = "family-scrabble-shared-workspaces";
let factory: IDBFactory;
let stores: SharedScorerStore[];
let fetchMock: ReturnType<typeof vi.fn>;
let storage: Map<string, string>;
let session: Map<string, string>;
let channels: Set<MockChannel>;
let deliverOwnershipMessages: boolean;
class MockChannel {
  onmessage: (() => void) | null = null;
  constructor(readonly name: string) {
    channels.add(this);
  }
  postMessage() {
    if (!deliverOwnershipMessages) return;
    for (const channel of channels)
      if (channel !== this && channel.name === this.name)
        queueMicrotask(() => channel.onmessage?.());
  }
  close() {
    this.onmessage = null;
    channels.delete(this);
  }
}
function makeGame(
  id = "game-1",
  createdAt = "2026-09-14T12:00:00Z",
): GameState {
  const result = createGame({
    id,
    players: [{ id: "player-1", name: "Ada", seat: 0 }],
    firstPlayerId: "player-1",
    direction: "clockwise",
    lexicon: {
      id: testLexicon.id,
      edition: testLexicon.edition,
      status: testLexicon.status,
    },
    createdAt,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.game;
}
function state(
  games = [makeGame()],
  nextCursor: string | null = null,
): SharedState {
  return {
    family: { id: familyId, name: "Family table" },
    member: {
      userId,
      email: "ada@example.com",
      role: "superadmin",
      active: true,
      playerId: "player-1",
    },
    members: [],
    invitations: [],
    players: [{ id: "player-1", name: "Ada" }],
    playerAccess: { "player-1": { revision: 0, userId } },
    games,
    gameAccess: Object.fromEntries(
      games.map((game) => [
        game.id,
        {
          scorerUserId: userId,
          deviceId,
          generation: 0,
          mode: "practice",
          approvals: [],
          protests: [],
          canScore: true,
          recordsEligible: false,
        },
      ]),
    ),
    verifiedWords: [],
    nextCursor,
  };
}
const draft = (): Draft => ({
  revision: 0,
  row: 7,
  col: 9,
  direction: "across",
  placements: [
    { row: 7, col: 7, tile: { letter: "A", blank: false } },
    { row: 7, col: 8, tile: { letter: "T", blank: false } },
  ],
});
function local(drafts: Record<string, Draft> = {}) {
  return { version: 1, activeGameId: "game-1", drafts, pending: null };
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function create() {
  const store = createSharedStore(userId);
  stores.push(store);
  return store;
}
async function connection(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(databaseName);
    open.onupgradeneeded = () => open.result.createObjectStore("workspaces");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
async function seed(value: unknown) {
  const db = await connection();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("workspaces", "readwrite");
    tx.objectStore("workspaces").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}
async function stored() {
  const db = await connection();
  const value = await new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      const request = db
        .transaction("workspaces", "readonly")
        .objectStore("workspaces")
        .get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    },
  );
  db.close();
  return value;
}
function storageApi(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  };
}
const addPlayer = (store: SharedScorerStore) =>
  store.update((data) => ({
    ...data,
    players: [...data.players, { id: "player-2", name: "Ben" }],
  }));
const addedPlayer = () => ({
  player: { id: "player-2", name: "Ben" },
  playerAccess: { revision: 0, userId: null },
});
const sent = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init.method === "POST")
    .map(([, init]) => JSON.parse(init.body) as SharedMutation);

beforeEach(() => {
  factory = new IDBFactory();
  stores = [];
  storage = new Map([[slot, deviceId]]);
  session = new Map();
  channels = new Set();
  deliverOwnershipMessages = true;
  vi.stubGlobal("BroadcastChannel", MockChannel);
  vi.stubGlobal("indexedDB", factory);
  vi.stubGlobal("localStorage", storageApi(storage));
  vi.stubGlobal("sessionStorage", storageApi(session));
  fetchMock = vi
    .fn()
    .mockImplementation(() => Promise.resolve(response(state())));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  stores.forEach((store) => store.close());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shared draft integrity and ownership", () => {
  it("loads a frozen snapshot and binds requests to the expected account", async () => {
    const store = create();
    await store.load();
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.canScore!("game-1")).toBe(true);
    expect(fetchMock.mock.calls[0][1].headers["X-Scrabble-User"]).toBe(userId);
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
    expect(() => {
      store.getSnapshot().data.players[0].name = "Changed";
    }).toThrow();
  });

  it("persists drafts with a durable device identity across tab closure", async () => {
    storage.clear();
    session.set(slot, deviceId);
    const first = create();
    await first.load();
    await first.update((data) => ({
      ...data,
      activeGameId: "game-1",
      drafts: { "game-1": draft() },
    }));
    first.close();
    session.clear();
    await Promise.resolve();
    expect(storage.get(slot)).toBe(deviceId);
    const second = create();
    await second.load();
    expect(second.getSnapshot().data.drafts["game-1"]).toEqual(draft());
    expect(second.canScore!("game-1")).toBe(true);
  });

  it("makes the new tab the writer and restores the first tab's saved letters", async () => {
    const first = create();
    await first.load();
    await first.update((data) => ({ ...data, drafts: { "game-1": draft() } }));
    const before = await stored();
    const second = create();
    await second.load();
    expect(second.canScore!("game-1")).toBe(true);
    expect(second.getSnapshot().data.drafts["game-1"]).toEqual(draft());
    await vi.waitFor(() => expect(first.canScore!("game-1")).toBe(false));
    expect(first.getSnapshot().scoringElsewhere).toBe(true);
    expect(await stored()).toEqual(before);
    await expect(addPlayer(first)).rejects.toThrow("closed");
    expect(sent()).toHaveLength(0);
  });

  it("fences old writes even if the sleeping tab has not received the takeover notification", async () => {
    const first = create();
    await first.load();
    deliverOwnershipMessages = false;
    const second = create();
    await second.load();
    await second.update((data) => ({ ...data, drafts: { "game-1": draft() } }));
    const checkpoint = await stored();
    await expect(addPlayer(first)).rejects.toThrow("another tab");
    expect(first.getSnapshot().scoringElsewhere).toBe(true);
    expect(second.canScore!("game-1")).toBe(true);
    expect(await stored()).toEqual(checkpoint);
    expect(sent()).toHaveLength(0);
  });

  it("retains an in-flight save for the new tab to confirm with the same request ID", async () => {
    const first = create();
    await first.load();
    let acknowledge!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const oldSave = addPlayer(first);
    const rejected = expect(oldSave).rejects.toThrow("closed");
    await vi.waitFor(() => expect(sent()).toHaveLength(1));
    const original = sent()[0];
    const second = create();
    await second.load();
    expect(second.getSnapshot().unresolved).toBe(true);
    expect(second.canScore!("game-1")).toBe(false);
    fetchMock.mockResolvedValueOnce(
      response({ ...addedPlayer(), replayed: true }),
    );
    await second.retry!();
    const checkpoint = await stored();
    acknowledge(response(addedPlayer()));
    await rejected;
    expect(sent()[1]).toEqual(original);
    expect((await stored()).pending).toBeNull();
    expect(await stored()).toEqual(checkpoint);
    expect(
      second.getSnapshot().data.players.filter((p) => p.id === "player-2"),
    ).toHaveLength(1);
    expect(second.canScore!("game-1")).toBe(true);
  });

  it("refreshes authority after takeover instead of using the earlier membership snapshot", async () => {
    const first = create();
    await first.load();
    const denied = state();
    denied.gameAccess["game-1"].canScore = false;
    fetchMock
      .mockResolvedValueOnce(response(state()))
      .mockResolvedValueOnce(response(denied));
    const second = create();
    await second.load();
    expect(second.canScore!("game-1")).toBe(false);
    await vi.waitFor(() => expect(first.canScore!("game-1")).toBe(false));
  });

  it("keeps one owner through repeated takeovers and rejects queued old work", async () => {
    const first = create();
    await first.load();
    const second = create();
    await second.load();
    const third = create();
    await third.load();
    await vi.waitFor(() =>
      expect([first, second, third].map((s) => s.canScore!("game-1"))).toEqual([
        false,
        false,
        true,
      ]),
    );
    await expect(addPlayer(first)).rejects.toThrow("closed");
    await expect(addPlayer(second)).rejects.toThrow("closed");
    expect(sent()).toHaveLength(0);
    first.close();
    second.close();
    expect(channels.size).toBe(1);
    expect(third.canScore!("game-1")).toBe(true);
  });

  it("keeps the same workspace even when local storage presents a competing device identity", async () => {
    const first = create();
    await first.load();
    await first.update((data) => ({ ...data, drafts: { "game-1": draft() } }));
    storage.set(slot, "racing-device-id");
    const second = create();
    await second.load();
    expect(storage.get(slot)).toBe(deviceId);
    expect(second.getSnapshot().data.drafts["game-1"]).toEqual(draft());
    await vi.waitFor(() => expect(first.canScore!("game-1")).toBe(false));
    expect(second.canScore!("game-1")).toBe(true);
  });

  it("resolves overlapping openings to one writer without dropping the checkpoint", async () => {
    await seed(local({ "game-1": draft() }));
    const tabs = [create(), create(), create()];
    await Promise.allSettled(tabs.map((tab) => tab.load()));
    await vi.waitFor(() =>
      expect(tabs.filter((tab) => tab.canScore!("game-1"))).toHaveLength(1),
    );
    const active = tabs.find((tab) => tab.canScore!("game-1"))!;
    expect(active.getSnapshot().data.drafts["game-1"]).toEqual(draft());
    expect(await stored()).toEqual(local({ "game-1": draft() }));
  });

  it("upgrades legacy storage without replacing saved workspaces and asks old clients to close", async () => {
    await seed(local({ "game-1": draft() }));
    const legacy = await connection();
    expect(legacy.version).toBe(1);
    const changed = vi.fn(() => legacy.close());
    legacy.onversionchange = changed;
    const store = create();
    await store.load();
    expect(changed).toHaveBeenCalledOnce();
    expect(store.getSnapshot().data.drafts["game-1"]).toEqual(draft());
    expect(await stored()).toEqual(local({ "game-1": draft() }));
    const upgraded = await connection();
    expect(upgraded.version).toBe(2);
    upgraded.close();
  });

  it("respects server scoring denial even when account and device identifiers match", async () => {
    const remote = state();
    remote.gameAccess["game-1"].canScore = false;
    fetchMock.mockResolvedValueOnce(response(remote));
    const store = create();
    await store.load();
    expect(store.canScore!("game-1")).toBe(false);
  });

  it("allows the designated account to score with a different local device identity", async () => {
    const remote = state();
    remote.gameAccess["game-1"].deviceId = "original-ipad";
    fetchMock.mockResolvedValueOnce(response(remote));
    const store = create();
    await store.load();
    expect(store.canScore!("game-1")).toBe(true);
    await store.update((data) => ({ ...data, drafts: { "game-1": draft() } }));
    expect(store.getSnapshot().data.drafts["game-1"]).toEqual(draft());
    expect(sent()).toHaveLength(0); // Opening/typing never transfers ownership.
  });

  it("keeps another designated account read-only despite matching device metadata", async () => {
    const remote = state();
    remote.gameAccess["game-1"].scorerUserId = "another-member";
    fetchMock.mockResolvedValueOnce(response(remote));
    const store = create();
    await store.load();
    expect(store.canScore!("game-1")).toBe(false);
  });

  it.each([
    { ...local(), version: 2 },
    { ...local(), drafts: [] },
    { ...local(), drafts: { "game-1": { ...draft(), row: -1 } } },
    {
      ...local(),
      drafts: {
        "game-1": {
          ...draft(),
          placements: [draft().placements[0], draft().placements[0]],
        },
      },
    },
    {
      ...local(),
      pending: {
        mutation: {
          requestId: "saved-id",
          operation: { type: "delete-everything" },
        },
        activeGameId: null,
        drafts: {},
      },
    },
    { ...local(), pending: {} },
    { ...local(), activeGameId: "__proto__" },
  ])(
    "blocks malformed stored workspaces without overwriting them",
    async (value) => {
      await seed(value);
      const store = create();
      await expect(store.load()).rejects.toThrow("recovery");
      expect(await stored()).toEqual(value);
      expect(store.getSnapshot().data.games).toEqual([]);
    },
  );

  it("validates a draft before touching IndexedDB", async () => {
    await seed(local());
    const store = create();
    await store.load();
    const before = await stored();
    await expect(
      store.update((data) => ({
        ...data,
        drafts: { "game-1": { ...draft(), direction: "diagonal" as "across" } },
      })),
    ).rejects.toThrow("draft");
    expect(await stored()).toEqual(before);
  });

  it("does not send anything if local persistence fails", async () => {
    const store = create();
    await store.load();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("Disk full", "QuotaExceededError");
    });
    await expect(addPlayer(store)).rejects.toThrow();
    expect(sent()).toHaveLength(0);
  });
});

describe("durable shared mutation retries", () => {
  it("retains and retries the exact request after an ambiguous connection loss and reload", async () => {
    const first = create();
    await first.load();
    fetchMock.mockRejectedValueOnce(new Error("connection lost"));
    await expect(addPlayer(first)).rejects.toThrow("interrupted");
    const original = sent()[0];
    expect(first.getSnapshot().unresolved).toBe(true);
    expect((await stored()).pending).toMatchObject({ mutation: original });
    first.close();
    await Promise.resolve();
    const second = create();
    await second.load();
    fetchMock.mockResolvedValueOnce(
      response({ ...addedPlayer(), replayed: true }),
    );
    await second.retry!();
    expect(sent()[1]).toEqual(original);
    expect(
      second
        .getSnapshot()
        .data.players.filter((player) => player.id === "player-2"),
    ).toHaveLength(1);
    expect((await stored()).pending).toBeNull();
  });

  it.each([408, 429, 500, 503])(
    "retains ambiguous HTTP %s requests",
    async (status) => {
      const store = create();
      await store.load();
      fetchMock.mockResolvedValueOnce(
        response({ error: "Retry later" }, status),
      );
      await expect(addPlayer(store)).rejects.toThrow();
      expect((await stored()).pending).not.toBeNull();
      expect(store.getSnapshot().unresolved).toBe(true);
    },
  );

  it("does not clear a pending save merely because a 200 body omitted the result", async () => {
    const store = create();
    await store.load();
    fetchMock.mockResolvedValueOnce(response({}));
    await expect(addPlayer(store)).rejects.toThrow("confirm");
    expect((await stored()).pending).not.toBeNull();
  });

  it("retains the exact request when the server succeeds but its local checkpoint fails", async () => {
    const store = create();
    await store.load();
    fetchMock.mockResolvedValueOnce(response(addedPlayer()));
    const originalPut = IDBObjectStore.prototype.put;
    let calls = 0;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore["put"]>
      ) {
        if (++calls === 2)
          throw new DOMException("Disk full", "QuotaExceededError");
        return originalPut.apply(this, args);
      });
    await expect(addPlayer(store)).rejects.toThrow();
    const original = sent()[0];
    expect((await stored()).pending).toMatchObject({ mutation: original });
    spy.mockRestore();
    fetchMock.mockResolvedValueOnce(
      response({ ...addedPlayer(), replayed: true }),
    );
    await store.retry!();
    expect(sent()[1]).toEqual(original);
  });

  it.each([400, 409, 422])(
    "clears a definitively rejected HTTP %s action while retaining entered letters",
    async (status) => {
      await seed(local({ "game-1": draft() }));
      const store = create();
      await store.load();
      fetchMock.mockResolvedValueOnce(
        response({ error: "Not recorded" }, status),
      );
      await expect(addPlayer(store)).rejects.toThrow("Not recorded");
      expect((await stored()).pending).toBeNull();
      expect((await stored()).drafts).toEqual({ "game-1": draft() });
      expect(store.getSnapshot().unresolved).toBe(false);
    },
  );

  it("blocks letter edits while the saved action's outcome is unresolved", async () => {
    await seed(local({ "game-1": draft() }));
    const store = create();
    await store.load();
    fetchMock.mockRejectedValueOnce(new Error());
    await expect(addPlayer(store)).rejects.toThrow();
    await expect(
      store.update((data) => ({ ...data, drafts: {} })),
    ).rejects.toThrow("Confirm");
    expect((await stored()).drafts).toEqual({ "game-1": draft() });
  });

  it("preserves navigation performed while a saved action awaits retry", async () => {
    const remote = state([makeGame(), makeGame("game-2")]);
    fetchMock.mockResolvedValueOnce(response(remote));
    const store = create();
    await store.load();
    fetchMock.mockRejectedValueOnce(new Error());
    await expect(addPlayer(store)).rejects.toThrow();
    await store.update((data) => ({ ...data, activeGameId: "game-2" }));
    fetchMock.mockResolvedValueOnce(response(addedPlayer()));
    await store.retry!();
    expect(store.getSnapshot().data.activeGameId).toBe("game-2");
  });
});

describe("account changes and closed-tab responses", () => {
  it.each([401, 403])(
    "hides previously loaded history on HTTP %s without deleting drafts or uncertain saves",
    async (status) => {
      await seed(local({ "game-1": draft() }));
      const store = create();
      await store.load();
      fetchMock.mockRejectedValueOnce(new Error());
      await expect(addPlayer(store)).rejects.toThrow();
      const before = await stored();
      fetchMock.mockResolvedValueOnce(
        response({ error: "Access changed" }, status),
      );
      await expect(store.retry!()).rejects.toThrow();
      expect(store.getSnapshot().shared).toBeUndefined();
      expect(store.getSnapshot().data.games).toEqual([]);
      expect(store.getSnapshot().data.drafts).toEqual({});
      expect(store.canScore!("game-1")).toBe(false);
      expect(await stored()).toEqual(before);
      await expect(store.update((data) => data)).rejects.toThrow("closed");
    },
  );

  it("hides history even when a 401 response body is malformed", async () => {
    const store = create();
    await store.load();
    fetchMock.mockResolvedValueOnce(
      new Response("Bad response", { status: 401 }),
    );
    await expect(store.refresh!()).rejects.toThrow();
    expect(store.getSnapshot().shared).toBeUndefined();
  });

  it.each(["account", "family", "revoked"])(
    "rejects a refresh with changed %s identity",
    async (kind) => {
      const store = create();
      await store.load();
      const remote = state();
      if (kind === "account") remote.member.userId = "other-user";
      if (kind === "family") remote.family.id = "another-family";
      if (kind === "revoked") remote.member.active = false;
      fetchMock.mockResolvedValueOnce(response(remote));
      await expect(store.refresh!()).rejects.toThrow("changed");
      expect(store.getSnapshot().shared).toBeUndefined();
    },
  );

  it("does not repopulate history from a response arriving after pagehide", async () => {
    const store = create();
    await store.load();
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const refreshing = store.refresh!();
    await Promise.resolve();
    store.close();
    resolve(response(state()));
    await expect(refreshing).rejects.toThrow("closed");
    expect(store.getSnapshot().data.games).toEqual([]);
    await expect(store.load()).rejects.toThrow("closed");
  });

  it("does not send a queued action after close", async () => {
    const store = create();
    await store.load();
    const pending = addPlayer(store);
    store.close();
    await expect(pending).rejects.toThrow("closed");
    expect(sent()).toHaveLength(0);
  });
});

describe("shared history refresh", () => {
  it("retains loaded older games and the next history cursor on refresh", async () => {
    fetchMock.mockResolvedValueOnce(
      response(state([makeGame()], "older-page")),
    );
    const store = create();
    await store.load();
    fetchMock.mockResolvedValueOnce(
      response(
        state([makeGame("older-game", "2026-09-12T12:00:00Z")], "oldest-page"),
      ),
    );
    await store.loadMore!();
    fetchMock.mockResolvedValueOnce(
      response(state([makeGame()], "older-page")),
    );
    await store.refresh!();
    expect(store.getSnapshot().shared?.nextCursor).toBe("oldest-page");
    expect(store.getSnapshot().data.games).toHaveLength(2);
  });

  it("refreshes the active older game even when it is outside the newest page", async () => {
    const older = makeGame("older-game", "2026-09-12T12:00:00Z");
    fetchMock.mockResolvedValueOnce(response(state([makeGame(), older])));
    const store = create();
    await store.load();
    await store.update((data) => ({ ...data, activeGameId: older.id }));
    fetchMock
      .mockResolvedValueOnce(response(state([makeGame()])))
      .mockResolvedValueOnce(response(state([older])));
    await store.refresh!();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      "/api/family?gameId=older-game",
    );
    expect(store.getSnapshot().data.activeGameId).toBe("older-game");
  });

  it("retains a stale draft and blocks scoring instead of silently erasing letters", async () => {
    await seed(local({ "game-1": draft() }));
    const store = create();
    await store.load();
    const old = makeGame();
    const result = applyCommand(
      old,
      {
        type: "pass",
        expectedRevision: old.revision,
        id: "pass-1",
      },
      testLexicon,
    );
    if (!result.ok) throw new Error(result.error.message);
    fetchMock.mockResolvedValueOnce(response(state([result.game])));
    await store.refresh!();
    expect(store.getSnapshot().status).toBe("error");
    expect(store.getSnapshot().data.drafts["game-1"]).toEqual(draft());
    expect(store.canScore!("game-1")).toBe(false);
    expect((await stored()).drafts).toEqual({ "game-1": draft() });
  });

  it("constructs a takeover from the durable device and current generation", async () => {
    const remote = state();
    remote.gameAccess["game-1"].generation = 7;
    fetchMock.mockResolvedValueOnce(response(remote));
    const store = create();
    await store.load();
    fetchMock.mockResolvedValueOnce(
      response({
        game: remote.games[0],
        gameAccess: remote.gameAccess["game-1"],
      }),
    );
    await store.takeOver("game-1", "Taking over as the scorer");
    expect(sent()[0].operation).toEqual({
      type: "take-over-scoring",
      gameId: "game-1",
      deviceId,
      expectedGeneration: 7,
      reason: "Taking over as the scorer",
    });
  });
});

it("marks malformed successful response JSON as ambiguous rather than success", async () => {
  fetchMock.mockResolvedValueOnce(new Response("not-json", { status: 200 }));
  await expect(familyRequest("/api/family", {})).rejects.toMatchObject({
    status: 0,
  });
});

describe("late acknowledgements", () => {
  it("does not roll a newer player profile backward on an idempotent replay", async () => {
    const first = create();
    await first.load();
    fetchMock.mockRejectedValueOnce(new Error());
    await expect(addPlayer(first)).rejects.toThrow();
    first.close();
    await Promise.resolve();
    const newer = state();
    newer.players.push({ id: "player-2", name: "Benjamin" });
    newer.playerAccess["player-2"] = { revision: 2, userId: null };
    fetchMock.mockImplementation(() => Promise.resolve(response(newer)));
    const second = create();
    await second.load();
    fetchMock.mockResolvedValueOnce(
      response({ ...addedPlayer(), replayed: true }),
    );
    await second.retry!();
    expect(
      second
        .getSnapshot()
        .data.players.find((player) => player.id === "player-2")?.name,
    ).toBe("Benjamin");
    expect(second.getSnapshot().shared?.playerAccess["player-2"].revision).toBe(
      2,
    );
  });

  it("does not strand the pending counter when a rejected action cannot be checkpointed", async () => {
    const store = create();
    await store.load();
    fetchMock.mockResolvedValueOnce(response({ error: "Rejected" }, 400));
    const put = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (++calls === 2)
        throw new DOMException("Disk full", "QuotaExceededError");
      return put.apply(this, args);
    });
    await expect(addPlayer(store)).rejects.toThrow();
    expect(store.getSnapshot().pending).toBe(0);
    expect(store.getSnapshot().unresolved).toBe(true);
  });

  it("keeps the latest loaded game revision when retry acknowledges an earlier committed state", async () => {
    const original = makeGame();
    const later = applyCommand(
      original,
      { type: "pass", id: "pass-1", expectedRevision: 0 },
      testLexicon,
    );
    if (!later.ok) throw new Error(later.error.message);
    await seed({
      ...local(),
      pending: {
        mutation: {
          requestId: "saved-create-game",
          operation: {
            type: "create-game",
            id: original.id,
            players: [{ id: "player-1", seat: 0 }],
            firstPlayerId: "player-1",
            direction: "clockwise",
            deviceId,
            mode: "practice",
          },
        },
        activeGameId: original.id,
        drafts: {},
      },
    });
    fetchMock.mockResolvedValueOnce(response(state([later.game])));
    const store = create();
    await store.load();
    fetchMock.mockResolvedValueOnce(
      response({
        game: original,
        gameAccess: state().gameAccess[original.id],
        replayed: true,
      }),
    );
    await store.retry!();
    expect(store.getSnapshot().data.games[0].revision).toBe(1);
    expect(store.getSnapshot().data.games[0].events).toHaveLength(1);
  });
});

it("keeps retry available when a lost turn acknowledgement explains the stale saved draft", async () => {
  const original = makeGame();
  const command = {
    type: "play" as const,
    id: "play-1",
    expectedRevision: 0,
    placements: draft().placements,
  };
  const played = applyCommand(original, command, testLexicon);
  if (!played.ok) throw new Error(played.error.message);
  await seed({
    ...local({ "game-1": draft() }),
    pending: {
      mutation: {
        requestId: "saved-play",
        operation: {
          type: "game-commands",
          gameId: original.id,
          commands: [command],
          deviceId,
          generation: 0,
        },
      },
      activeGameId: original.id,
      drafts: {},
    },
  });
  fetchMock.mockResolvedValueOnce(response(state([played.game])));
  const store = create();
  await store.load();
  expect(store.getSnapshot().status).toBe("ready");
  expect(store.getSnapshot().unresolved).toBe(true);
  expect(store.canScore!(original.id)).toBe(false);
  fetchMock.mockResolvedValueOnce(
    response({
      game: played.game,
      gameAccess: state().gameAccess[original.id],
      replayed: true,
    }),
  );
  await store.retry!();
  expect(store.getSnapshot().status).toBe("ready");
  expect(store.getSnapshot().unresolved).toBe(false);
  expect(store.getSnapshot().data.drafts).toEqual({});
});

const watchOperations = [
  { type: "create-watch-link", gameId: "game-1", token: "a".repeat(64) },
  { type: "revoke-watch-link", gameId: "game-1" },
] satisfies SharedOperation[];

describe("guest viewing action acknowledgements", () => {
  it.each(watchOperations)(
    "accepts an empty successful $type result and refreshes shared state",
    async (operation) => {
      const store = create();
      await store.load();
      fetchMock.mockResolvedValueOnce(response({}));
      await store.administer(operation);
      expect(sent()).toHaveLength(1);
      expect(sent()[0].operation).toEqual(operation);
      expect(fetchMock.mock.calls.at(-1)?.[1].method).toBe("GET");
      expect(store.getSnapshot().status).toBe("ready");
      expect(store.getSnapshot().unresolved).toBe(false);
      expect(store.getSnapshot().pending).toBe(0);
      expect(store.getSnapshot().data.games).toHaveLength(1);
      expect((await stored()).pending).toBeNull();
    },
  );

  it.each(watchOperations)(
    "retries an uncertain $type result with the exact saved request after reload",
    async (operation) => {
      const first = create();
      await first.load();
      fetchMock.mockRejectedValueOnce(
        new Error("Connection interrupted after commit"),
      );
      await expect(first.administer(operation)).rejects.toThrow("interrupted");
      const original = sent()[0];
      expect((await stored()).pending).toMatchObject({ mutation: original });
      expect(first.getSnapshot().unresolved).toBe(true);
      first.close();
      await Promise.resolve();

      const second = create();
      await second.load();
      fetchMock.mockResolvedValueOnce(response({ replayed: true }));
      await second.retry!();
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toEqual(original);
      expect(sent()[1].operation).toEqual(operation);
      expect(second.getSnapshot().unresolved).toBe(false);
      expect(second.getSnapshot().pending).toBe(0);
      expect((await stored()).pending).toBeNull();
    },
  );
});

function protest(): GameProtest {
  return {
    id: "protest-1",
    reason: "The leftover tile adjustment needs a second look.",
    reportedFor: "Ben",
    reportedBy: "Ada",
    reportedAt: "2026-09-14T12:30:00.000Z",
    gameRevision: 0,
    resolution: null,
  };
}
const protestOperations = [
  {
    type: "report-protest",
    gameId: "game-1",
    reason: "Please check the leftover tile adjustment.",
    reportedFor: "Ben",
  },
  {
    type: "resolve-protest",
    gameId: "game-1",
    protestId: "protest-1",
    outcome: "dismissed",
    reason: "The recorded adjustment matches the remaining tiles.",
  },
  {
    type: "resolve-protest",
    gameId: "game-1",
    protestId: "protest-1",
    outcome: "upheld",
    reason: "A correction is needed; retain the original score sheet.",
  },
] satisfies SharedOperation[];

describe("immediate scoring and retained protest history", () => {
  it("allows the owning scorer to start a family game with unlinked guests and no player approvals", async () => {
    const remote = state();
    remote.gameAccess["game-1"].mode = "confirmed";
    remote.gameAccess["game-1"].approvals = [
      {
        playerId: "player-1",
        userId: null,
        startApproved: false,
        resultApproved: false,
      },
    ];
    remote.playerAccess["player-1"].userId = null;
    fetchMock.mockResolvedValueOnce(response(remote));
    const store = create();
    await store.load();
    expect(store.canScore!("game-1")).toBe(true);
  });

  it("keeps scoring permissions independent of an open protest's record hold", async () => {
    const remote = state();
    remote.gameAccess["game-1"].mode = "confirmed";
    remote.gameAccess["game-1"].protests = [protest()];
    remote.gameAccess["game-1"].recordsEligible = false;
    fetchMock.mockResolvedValueOnce(response(remote));
    const store = create();
    await store.load();
    expect(store.canScore!("game-1")).toBe(true);
    expect(
      store.getSnapshot().shared?.gameAccess["game-1"].recordsEligible,
    ).toBe(false);
  });

  it.each(protestOperations)(
    "preserves an uncertain $type action exactly through reload and retry",
    async (operation) => {
      await seed(local({ "game-1": draft() }));
      const first = create();
      await first.load();
      fetchMock.mockRejectedValueOnce(
        new Error("Connection interrupted after commit"),
      );
      await expect(first.administer(operation)).rejects.toThrow("interrupted");
      const original = sent()[0];
      expect(original.operation).toEqual(operation);
      expect((await stored()).pending).toMatchObject({ mutation: original });
      first.close();
      await Promise.resolve();
      const second = create();
      await second.load();
      const remote = state();
      remote.gameAccess["game-1"].protests = [protest()];
      fetchMock.mockResolvedValueOnce(
        response({
          game: remote.games[0],
          gameAccess: remote.gameAccess["game-1"],
          replayed: true,
        }),
      );
      await second.retry!();
      expect(sent()[1]).toEqual(original);
      expect((await stored()).pending).toBeNull();
      expect((await stored()).drafts).toEqual({ "game-1": draft() });
      expect(
        second.getSnapshot().shared?.gameAccess["game-1"].protests,
      ).toEqual([protest()]);
    },
  );

  it("requires a game acknowledgement for a protest action before clearing its saved request", async () => {
    const store = create();
    await store.load();
    fetchMock.mockResolvedValueOnce(response({}));
    await expect(store.administer(protestOperations[0])).rejects.toThrow(
      "confirm",
    );
    expect((await stored()).pending).not.toBeNull();
    expect(store.getSnapshot().unresolved).toBe(true);
  });

  it("retains protest metadata when a separate player update is acknowledged", async () => {
    const remote = state();
    remote.gameAccess["game-1"].protests = [protest()];
    fetchMock.mockResolvedValueOnce(response(remote));
    const store = create();
    await store.load();
    fetchMock.mockResolvedValueOnce(response(addedPlayer()));
    await addPlayer(store);
    expect(store.getSnapshot().shared?.gameAccess["game-1"].protests).toEqual([
      protest(),
    ]);
  });

  it.each([false, true])(
    "uses the server's eligibility value %s after a dismissed protest",
    async (recordsEligible) => {
      const store = create();
      await store.load();
      const remote = state();
      remote.gameAccess["game-1"].recordsEligible = recordsEligible;
      remote.gameAccess["game-1"].protests = [
        {
          ...protest(),
          resolution: {
            outcome: "dismissed",
            reason: "The score was checked against the original turn.",
            resolvedBy: "Doug",
            resolvedAt: "2026-09-14T13:00:00.000Z",
          },
        },
      ];
      fetchMock
        .mockResolvedValueOnce(
          response({
            game: remote.games[0],
            gameAccess: remote.gameAccess["game-1"],
          }),
        )
        .mockResolvedValueOnce(response(remote));
      await store.administer(protestOperations[1]);
      expect(
        store.getSnapshot().shared?.gameAccess["game-1"].recordsEligible,
      ).toBe(recordsEligible);
    },
  );

  it("still confirms an older saved approval request without reviving its gameplay gate", async () => {
    await seed({
      ...local(),
      pending: {
        mutation: {
          requestId: "legacy-approval",
          operation: {
            type: "approve-game",
            gameId: "game-1",
            stage: "start",
            expectedRevision: 0,
          },
        },
        activeGameId: "game-1",
        drafts: {},
      },
    });
    const store = create();
    await store.load();
    const remote = state();
    remote.gameAccess["game-1"].mode = "confirmed";
    remote.gameAccess["game-1"].approvals = [
      {
        playerId: "player-1",
        userId: null,
        startApproved: false,
        resultApproved: false,
      },
    ];
    fetchMock.mockResolvedValueOnce(
      response({
        game: remote.games[0],
        gameAccess: remote.gameAccess["game-1"],
        replayed: true,
      }),
    );
    await store.retry!();
    expect((await stored()).pending).toBeNull();
    expect(store.canScore!("game-1")).toBe(true);
  });
});

describe("protest payload validation", () => {
  const malformedProtests = [
    { ...protest(), reason: "" },
    { ...protest(), reason: "x".repeat(2001) },
    { ...protest(), reportedBy: "x".repeat(121) },
    { ...protest(), reportedBy: "Ada\u0000" },
    { ...protest(), reportedFor: "x".repeat(61) },
    { ...protest(), reportedAt: "not-a-date" },
    { ...protest(), gameRevision: -1 },
    { ...protest(), reporterUserId: "private-actor-id" },
    { ...protest(), resolution: {} },
    {
      ...protest(),
      resolution: {
        outcome: "dismissed",
        reason: "Reviewed",
        resolvedBy: "x".repeat(121),
        resolvedAt: "2026-09-14T13:00:00.000Z",
      },
    },
    {
      ...protest(),
      resolution: {
        outcome: "dismissed",
        reason: "Reviewed",
        resolvedBy: "Doug",
        resolvedAt: "2026-09-14T12:00:00.000Z",
      },
    },
  ];
  it.each(malformedProtests)(
    "rejects malformed received protest metadata without discarding entered letters or the saved action",
    async (invalid) => {
      await seed(local({ "game-1": draft() }));
      const store = create();
      await store.load();
      const remote = state();
      remote.gameAccess["game-1"].protests = [invalid as GameProtest];
      fetchMock.mockResolvedValueOnce(
        response({
          game: remote.games[0],
          gameAccess: remote.gameAccess["game-1"],
        }),
      );
      await expect(store.administer(protestOperations[0])).rejects.toThrow(
        "incomplete",
      );
      expect((await stored()).drafts).toEqual({ "game-1": draft() });
      expect((await stored()).pending).not.toBeNull();
      expect(store.getSnapshot().shared?.gameAccess["game-1"].protests).toEqual(
        [],
      );
      expect(store.getSnapshot().unresolved).toBe(true);
    },
  );

  it.each([
    { protests: [protest(), protest()] },
    {
      protests: Array.from({ length: 101 }, (_, index) => ({
        ...protest(),
        id: `protest-${index}`,
      })),
    },
  ])(
    "rejects duplicated or excessive protest records without replacing the saved workspace",
    async ({ protests }) => {
      const before = local({ "game-1": draft() });
      await seed(before);
      const remote = state();
      remote.gameAccess["game-1"].protests = protests;
      fetchMock.mockResolvedValueOnce(response(remote));
      const store = create();
      await expect(store.load()).rejects.toThrow("incomplete");
      expect(await stored()).toEqual(before);
    },
  );

  it.each([
    { ...protestOperations[0], reason: "" },
    { ...protestOperations[0], reportedFor: "x".repeat(61) },
    { ...protestOperations[1], outcome: "deleted" },
    { ...protestOperations[1], reason: "x".repeat(2001) },
  ])(
    "rejects malformed outgoing protest details before persistence or sending",
    async (operation) => {
      const before = local({ "game-1": draft() });
      await seed(before);
      const store = create();
      await store.load();
      await expect(
        store.administer(operation as SharedOperation),
      ).rejects.toThrow("invalid details");
      expect(sent()).toHaveLength(0);
      expect(await stored()).toEqual(before);
    },
  );
});

it("accepts UUID-shaped profile and guest display names without treating them as identity fields", async () => {
  const displayName = "11111111-1111-4111-8111-111111111111";
  const captured: GameProtest = {
    ...protest(),
    reportedBy: displayName,
    reportedFor: displayName,
    resolution: {
      outcome: "dismissed",
      reason: "Reviewed against the retained score sheet.",
      resolvedBy: displayName,
      resolvedAt: "2026-09-14T13:00:00.000Z",
    },
  };
  const remote = state();
  remote.gameAccess["game-1"].protests = [captured];
  fetchMock.mockResolvedValueOnce(response(remote));
  const store = create();
  await store.load();
  expect(store.getSnapshot().status).toBe("ready");
  expect(store.getSnapshot().shared?.gameAccess["game-1"].protests).toEqual([
    captured,
  ]);

  fetchMock
    .mockResolvedValueOnce(
      response({
        game: remote.games[0],
        gameAccess: remote.gameAccess["game-1"],
      }),
    )
    .mockResolvedValueOnce(response(remote));
  await store.administer({
    type: "report-protest",
    gameId: "game-1",
    reason: "Please check the final adjustment.",
    reportedFor: displayName,
  });
  expect(store.getSnapshot().status).toBe("ready");
  expect(store.getSnapshot().unresolved).toBe(false);
  expect((await stored()).pending).toBeNull();
  expect(sent()[0].operation).toMatchObject({ reportedFor: displayName });
});

describe("shared equipment saves", () => {
  const equipment: Equipment = {
    revision: 1,
    defaultSetId: "home",
    sets: [
      {
        id: "home",
        name: "Home",
        counts: { ...LETTER_COUNTS, C: 1 },
        checkedAt: null,
      },
    ],
  };
  it("preserves a lost acknowledgement and retries the exact equipment action", async () => {
    const store = create();
    await store.load();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(
      store.update((data) => ({ ...data, equipment })),
    ).rejects.toThrow();
    const request = sent()[0];
    expect(request.operation).toMatchObject({
      type: "save-equipment",
      expectedRevision: 0,
    });
    expect(store.getSnapshot().unresolved).toBe(true);
    fetchMock.mockResolvedValueOnce(response({ equipment, replayed: true }));
    await store.retry!();
    expect(sent()[1]).toEqual(request);
    expect(store.getSnapshot().data.equipment).toEqual(equipment);
    expect(store.getSnapshot().unresolved).toBe(false);
  });
  it("rejects an incomplete equipment acknowledgement", async () => {
    const store = create();
    await store.load();
    fetchMock.mockResolvedValueOnce(response({}));
    await expect(
      store.update((data) => ({ ...data, equipment })),
    ).rejects.toThrow(/response/);
    expect(store.getSnapshot().unresolved).toBe(true);
  });
  it("does not replace a newer equipment snapshot with a delayed replay", async () => {
    const newer = {
      ...equipment,
      revision: 3,
      sets: [{ ...equipment.sets[0], name: "Recounted" }],
    };
    await seed({
      ...local(),
      pending: {
        mutation: {
          requestId: "equipment-retry",
          operation: { type: "save-equipment", equipment, expectedRevision: 0 },
        },
        activeGameId: "game-1",
        drafts: {},
      },
    });
    fetchMock.mockResolvedValueOnce(response({ ...state(), equipment: newer }));
    const store = create();
    await store.load();
    fetchMock.mockResolvedValueOnce(response({ equipment, replayed: true }));
    await store.retry!();
    expect(store.getSnapshot().data.equipment).toEqual(newer);
  });
});

describe("member permission changes and removed practice games", () => {
  it("removes deleted games from previously paginated caches and survives reopening their stored active ID", async () => {
    await seed(local({ "game-1": draft() }));
    const store = create();
    await store.load();
    const removed = { ...state([]), removedGameIds: ["game-1"] };
    fetchMock.mockResolvedValueOnce(response(removed));
    await store.refresh!();
    expect(store.getSnapshot().data.games).toEqual([]);
    expect(store.getSnapshot().data.activeGameId).toBeNull();
    expect(store.getSnapshot().shared?.gameAccess).toEqual({});
    expect(store.canScore!("game-1")).toBe(false);
    // Retain a device's unfinished letters without allowing it to restore the game.
    expect((await stored()).drafts).toEqual({ "game-1": draft() });
    store.close();
    fetchMock.mockImplementation(() => Promise.resolve(response(removed)));
    const reopened = create();
    await reopened.load();
    expect(reopened.getSnapshot().status).toBe("ready");
    expect(reopened.getSnapshot().data.games).toEqual([]);
  });

  it("discards a cached practice view after admin demotion without erasing drafts or blocking ordinary shared history", async () => {
    const store = create();
    await store.load();
    await store.update((data) => ({
      ...data,
      activeGameId: "game-1",
      drafts: { "game-1": draft() },
    }));
    const member = state([]);
    member.member.role = "member";
    fetchMock
      .mockResolvedValueOnce(response(member))
      .mockResolvedValueOnce(
        response(
          { code: "GAME_NOT_FOUND", error: "This game is unavailable" },
          404,
        ),
      );
    await store.refresh!();
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().data.games).toEqual([]);
    expect(store.getSnapshot().shared?.gameAccess).toEqual({});
    expect(store.getSnapshot().data.activeGameId).toBeNull();
    expect(store.canScore!("game-1")).toBe(false);
    expect((await stored()).drafts).toEqual({ "game-1": draft() });
  });

  it("permission denial refreshes capabilities and clears an uncommitted request while keeping the draft and account open", async () => {
    const allowed = state();
    allowed.member.role = "member";
    allowed.gameAccess["game-1"].mode = "confirmed";
    fetchMock.mockResolvedValueOnce(response(allowed));
    const store = create();
    await store.load();
    await store.update((data) => ({ ...data, drafts: { "game-1": draft() } }));
    const restricted = structuredClone(allowed);
    restricted.member.permissions = { addPlayers: false, scoreGames: false };
    restricted.gameAccess["game-1"].canScore = false;
    fetchMock
      .mockResolvedValueOnce(
        response({ error: "Ask a superadmin", code: "PERMISSION_DENIED" }, 403),
      )
      .mockResolvedValueOnce(response(restricted));
    await expect(addPlayer(store)).rejects.toThrow("Ask a superadmin");
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().unresolved).toBe(false);
    expect(store.getSnapshot().shared?.member.permissions?.addPlayers).toBe(
      false,
    );
    expect(store.canScore!("game-1")).toBe(false);
    expect((await stored()).drafts).toEqual({ "game-1": draft() });
    expect((await stored()).pending).toBeNull();
  });

  it("accepts deletion acknowledgement and rejects a mismatched deletion acknowledgement", async () => {
    const store = create();
    await store.load();
    const operation = {
      type: "delete-practice-game" as const,
      gameId: "game-1",
      expectedRevision: 0,
      reason: "Finished testing",
    };
    fetchMock.mockResolvedValueOnce(response({ removedGameId: "other-game" }));
    await expect(store.administer(operation)).rejects.toThrow("did not match");
    expect(store.getSnapshot().unresolved).toBe(true);
    fetchMock.mockResolvedValueOnce(
      response({ removedGameId: "game-1", replayed: true }),
    );
    await store.retry!();
    expect(store.getSnapshot().data.games).toEqual([]);
    expect(store.getSnapshot().unresolved).toBe(false);
  });
});
