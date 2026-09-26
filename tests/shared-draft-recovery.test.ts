import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { createGame, applyCommand, type GameState } from "../src/domain/game";
import { testLexicon } from "../src/lib/test-lexicon";
import {
  createSharedStore,
  type SharedScorerStore,
} from "../src/lib/shared-store";
import type { SharedState } from "../src/lib/shared-contract";
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
function storageApi(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  };
}
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

it.each(["pass", "play"] as const)(
  "isolates a stale draft after another device %s and recovers only by explicit choice",
  async (type) => {
    await seed(local({ "game-1": draft() }));
    const active = create();
    await active.load();
    const changed = applyCommand(
      makeGame(),
      type === "pass"
        ? { type, expectedRevision: 0, id: "other-device" }
        : {
            type,
            expectedRevision: 0,
            id: "other-device",
            placements: draft().placements,
          },
      testLexicon,
    );
    if (!changed.ok) throw new Error(changed.error.message);
    const other = makeGame("game-2");
    fetchMock.mockImplementation(async () =>
      response(state([changed.game, other])),
    );
    await active.refresh!();
    expect(active.getSnapshot().status).toBe("ready");
    expect(active.getSnapshot().draftConflicts).toEqual(["game-1"]);
    expect(active.canScore!("game-1")).toBe(false);
    expect(active.canScore!("game-2")).toBe(true);
    await expect(
      active.update((data) => ({ ...data, drafts: {} })),
    ).rejects.toThrow("explicitly discard");
    await expect(active.discardDraftConflict!("game-1", 0)).rejects.toThrow(
      "changed again",
    );
    expect(active.getSnapshot().data.drafts["game-1"]).toEqual(draft());
    active.close();
    const reloaded = create();
    await reloaded.load();
    expect(reloaded.getSnapshot().status).toBe("ready");
    expect(reloaded.getSnapshot().data.drafts["game-1"]).toEqual(draft());
    await reloaded.openGame("game-2");
    await reloaded.update((data) => ({
      ...data,
      drafts: { ...data.drafts, "game-2": draft() },
    }));
    await reloaded.discardDraftConflict!("game-1", 1);
    expect(reloaded.getSnapshot().data.drafts["game-1"]).toBeUndefined();
    expect(reloaded.getSnapshot().data.drafts["game-2"]).toEqual(draft());
    expect(reloaded.getSnapshot().data.games[0]).toEqual(changed.game);
    expect(reloaded.canScore!("game-1")).toBe(true);
    reloaded.close();
    const final = create();
    await final.load();
    expect(final.getSnapshot().draftConflicts).toEqual([]);
    expect(final.getSnapshot().data.drafts["game-1"]).toBeUndefined();
    expect(final.getSnapshot().data.drafts["game-2"]).toEqual(draft());
  },
);

it("preserves retained letters when the explicit discard cannot be checkpointed", async () => {
  await seed(local({ "game-1": draft() }));
  const changed = applyCommand(
    makeGame(),
    { type: "pass", expectedRevision: 0, id: "other-device" },
    testLexicon,
  );
  if (!changed.ok) throw new Error(changed.error.message);
  fetchMock.mockImplementation(async () => response(state([changed.game])));
  const active = create();
  await active.load();
  vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
    throw new Error("Synthetic storage unavailable");
  });
  await expect(active.discardDraftConflict!("game-1", 1)).rejects.toThrow(
    "Synthetic storage unavailable",
  );
  expect(active.getSnapshot().data.drafts["game-1"]).toEqual(draft());
  expect(active.canScore!("game-1")).toBe(false);
});

it.each(["report-protest", "take-over-scoring"] as const)(
  "does not rebase retained letters after %s acknowledgement",
  async (type) => {
    await seed(local({ "game-1": draft() }));
    const changed = applyCommand(
      makeGame(),
      { type: "pass", expectedRevision: 0, id: "other-device" },
      testLexicon,
    );
    if (!changed.ok) throw new Error(changed.error.message);
    fetchMock.mockImplementation(async (_path, init) =>
      init?.method === "POST"
        ? response({
            game: changed.game,
            gameAccess: state().gameAccess["game-1"],
            replayed: false,
          })
        : response(state([changed.game])),
    );
    const active = create();
    await active.load();
    await active.administer(
      type === "report-protest"
        ? {
            type,
            gameId: "game-1",
            reason: "Review the last recorded play",
            reportedFor: null,
          }
        : {
            type,
            gameId: "game-1",
            deviceId,
            expectedGeneration: 0,
            reason: "Scoring from this device",
          },
    );
    expect(active.getSnapshot().data.drafts["game-1"]).toEqual(draft());
    expect(active.getSnapshot().draftConflicts).toEqual(["game-1"]);
    expect(active.canScore!("game-1")).toBe(false);
  },
);
