import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  createCrokinoleStore,
  type CrokinoleStore,
} from "../src/lib/crokinole-store";
import {
  FamilyRequestError,
  type familyRequest,
} from "../src/lib/shared-store";
import {
  createCrokinoleGame,
  DEFAULT_PIECE_COLOURS,
} from "../src/domain/crokinole";
import type {
  CrokinoleSharedState,
  CrokinoleMutation,
} from "../src/lib/crokinole-contract";
const game = createCrokinoleGame({
  schemaVersion: 1,
  rulesVersion: 1,
  id: "game",
  familyId: "family",
  mode: "confirmed",
  createdAt: "2026-09-17T12:00:00Z",
  players: [
    { id: "a", name: "Ada", seatOrder: 0 },
    { id: "b", name: "Ben", seatOrder: 1 },
  ],
  participants: ["a", "b"].map((id, i) => ({
    id,
    name: id,
    playerIds: [id],
    colour: {
      id: DEFAULT_PIECE_COLOURS[i].id,
      name: DEFAULT_PIECE_COLOURS[i].name,
      value: DEFAULT_PIECE_COLOURS[i].value,
    },
  })),
  format: "singles",
  scoringMode: "cumulative_round_totals",
  endCondition: { type: "fixed_rounds", rounds: 4 },
  initialStartingPlayerId: "a",
});
const state = (): CrokinoleSharedState => ({
  games: [structuredClone(game)],
  access: {
    game: {
      scorerUserId: "user",
      generation: 1,
      canScore: true,
      mode: "confirmed",
      concerns: [],
    },
  },
  palette: { revision: 0, colours: structuredClone(DEFAULT_PIECE_COLOURS) },
  nextCursor: null,
  creationEnabled: true,
  draft: null,
});
let stores: CrokinoleStore[] = [];
let request: ReturnType<typeof vi.fn>;
function store() {
  const s = createCrokinoleStore(
    "family",
    "user",
    request as typeof familyRequest,
  );
  stores.push(s);
  return s;
}
async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 15));
}
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  request = vi.fn(async () => state());
  stores = [];
});
afterEach(async () => {
  stores.forEach((s) => s.close());
  await settled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("Crokinole retained workspace", () => {
  it.each([false, true])(
    "saving a round waits for draft sync and retains failed writes (failed=%s)",
    async (failed) => {
      const active = store();
      await active.load("game");
      active.setDraft("game", {
        values: { a: "65", b: "0" },
        editingRoundId: null,
      });
      await settled();
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      request.mockImplementation(
        async (_path: string, body: CrokinoleMutation) => {
          if (body.operation.type === "save-draft") {
            started();
            await gate;
            if (failed) throw new Error("Draft connection lost");
            return {
              draft: {
                revision: 1,
                baseRevision: 0,
                generation: 1,
                values: { a: "65", b: "0" },
                editingRoundId: null,
              },
            };
          }
          throw new Error("Round reached server");
        },
      );
      const syncing = active.syncDraft("game");
      const syncResult = failed
        ? expect(syncing).rejects.toThrow("Draft connection lost")
        : expect(syncing).resolves.toBeUndefined();
      await began;
      const saving = active.command("game", {
        id: "save-round",
        type: "record_round",
        expectedRevision: 0,
        roundId: "round-1",
        entries: [
          { participantId: "a", rawScore: 65 },
          { participantId: "b", rawScore: 0 },
        ],
      });
      const saveResult = expect(saving).rejects.toThrow(
        failed ? "Retry the interrupted action" : "Round reached server",
      );
      expect(
        request.mock.calls.filter(
          (call) => call[1]?.operation.type === "command",
        ),
      ).toHaveLength(0);
      release();
      await syncResult;
      await saveResult;
      const sent = request.mock.calls.filter(
        (call) => call[1]?.operation.type === "command",
      );
      expect(sent).toHaveLength(failed ? 0 : 1);
      if (!failed) expect(sent[0][1].operation.expectedDraftRevision).toBe(1);
      expect(active.getSnapshot().drafts.game.values.a).toBe("65");
    },
  );
  it.each([false, true])(
    "waits for a background read before a mutation and rechecks access (revoked=%s)",
    async (revoked) => {
      const active = store();
      await active.load("game");
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const readStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      request.mockImplementation(async (_path: string, body: unknown) => {
        if (body)
          return { palette: { revision: 1, colours: DEFAULT_PIECE_COLOURS } };
        started();
        await gate;
        if (revoked) throw new FamilyRequestError("Access revoked", 403);
        return state();
      });
      const refreshing = active.refresh("game");
      await readStarted;
      const saving = active.mutate({
        type: "save-palette",
        expectedRevision: 0,
        colours: DEFAULT_PIECE_COLOURS,
      });
      const outcome = revoked
        ? expect(saving).rejects.toThrow()
        : expect(saving).resolves.toBeUndefined();
      expect(request.mock.calls.filter((call) => call[1])).toHaveLength(0);
      release();
      await refreshing;
      await outcome;
      expect(request.mock.calls.filter((call) => call[1])).toHaveLength(
        revoked ? 0 : 1,
      );
    },
  );

  it("retains blank and invalid draft text across reload without treating blank as zero", async () => {
    const first = store();
    await first.load("game");
    first.setDraft("game", {
      values: { a: "", b: "12." },
      editingRoundId: null,
    });
    await settled();
    first.close();
    const second = store();
    await second.load("game");
    expect(second.getSnapshot().drafts.game.values).toEqual({
      a: "",
      b: "12.",
    });
    expect(second.getSnapshot().drafts.game.dirty).toBe(true);
  });
  it("retains edit target across reload", async () => {
    const first = store();
    await first.load("game");
    first.setDraft("game", {
      values: { a: "20", b: "30" },
      editingRoundId: "round-1",
    });
    await settled();
    first.close();
    const second = store();
    await second.load("game");
    expect(second.getSnapshot().drafts.game.editingRoundId).toBe("round-1");
  });
  it("unknown outcome survives reload and retries exact request ID", async () => {
    const first = store();
    await first.load("game");
    request.mockImplementation(async (_path: string, body: unknown) => {
      if (body) throw new Error("Network lost");
      return state();
    });
    await expect(
      first.mutate({
        type: "save-palette",
        expectedRevision: 0,
        colours: DEFAULT_PIECE_COLOURS,
      }),
    ).rejects.toThrow("Network lost");
    const original = request.mock.calls.find(
      (call) => call[1],
    )?.[1] as CrokinoleMutation;
    expect(first.getSnapshot().pending).toBe(true);
    first.close();
    request.mockImplementation(async (_path: string, body: unknown) =>
      body
        ? { palette: { revision: 1, colours: DEFAULT_PIECE_COLOURS } }
        : state(),
    );
    const second = store();
    await second.load();
    expect(second.getSnapshot().pending).toBe(true);
    await second.retry();
    expect(request.mock.calls.filter((call) => call[1]).at(-1)?.[1]).toEqual(
      original,
    );
    expect(second.getSnapshot().pending).toBe(false);
  });
  it("blocks duplicate actions while first request is in flight", async () => {
    const s = store();
    await s.load();
    let finish: (value: unknown) => void = () => {};
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = s.mutate({
      type: "save-palette",
      expectedRevision: 0,
      colours: DEFAULT_PIECE_COLOURS,
    });
    await vi.waitFor(() => expect(s.getSnapshot().pending).toBe(true));
    await expect(
      s.mutate({
        type: "save-palette",
        expectedRevision: 0,
        colours: DEFAULT_PIECE_COLOURS,
      }),
    ).rejects.toThrow(/still being saved/);
    finish({ palette: { revision: 1, colours: DEFAULT_PIECE_COLOURS } });
    await pending;
  });
  it("current tab owns writes and old tab cannot overwrite the retained entry", async () => {
    const first = store();
    await first.load("game");
    const second = store();
    await second.load("game");
    first.setDraft("game", { values: { a: "100" }, editingRoundId: null });
    await vi.waitFor(() => expect(first.getSnapshot().displaced).toBe(true));
    second.setDraft("game", { values: { a: "25" }, editingRoundId: null });
    await settled();
    second.close();
    const third = store();
    await third.load("game");
    expect(third.getSnapshot().drafts.game.values).toEqual({ a: "25" });
  });
  it("local and newer shared drafts require an explicit conflict choice", async () => {
    const s = store();
    await s.load("game");
    s.setDraft("game", { values: { a: "10", b: "20" }, editingRoundId: null });
    await settled();
    request.mockResolvedValue({
      ...state(),
      draft: {
        revision: 2,
        baseRevision: 0,
        generation: 1,
        values: { a: "50", b: "0" },
        editingRoundId: null,
      },
    });
    await s.refresh("game");
    expect(s.getSnapshot().conflicts.game.values.a).toBe("50");
    expect(s.getSnapshot().drafts.game.values.a).toBe("10");
    await s.resolveConflict("game", "shared");
    expect(s.getSnapshot().drafts.game.values.a).toBe("50");
    expect(s.getSnapshot().conflicts.game).toBeUndefined();
  });
  it("definite stale-write response keeps input and clears pending for review", async () => {
    const s = store();
    await s.load("game");
    s.setDraft("game", { values: { a: "10", b: "20" }, editingRoundId: null });
    await settled();
    request.mockRejectedValue(
      new FamilyRequestError("Game changed", 409, "REVISION_CONFLICT"),
    );
    await expect(s.syncDraft("game")).rejects.toThrow("Game changed");
    expect(s.getSnapshot().drafts.game.values).toEqual({ a: "10", b: "20" });
    expect(s.getSnapshot().pending).toBe(false);
  });
  it("failed local checkpoint never sends an accepted round to server", async () => {
    const s = store();
    await s.load();
    const calls = request.mock.calls.length;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Quota exhausted", "QuotaExceededError");
    });
    await expect(
      s.mutate({
        type: "save-palette",
        expectedRevision: 0,
        colours: DEFAULT_PIECE_COLOURS,
      }),
    ).rejects.toThrow();
    expect(s.getSnapshot().storageError).toBe(true);
    expect(request.mock.calls).toHaveLength(calls);
  });
  it("revoked access removes protected game and draft from the screen", async () => {
    const s = store();
    await s.load("game");
    s.setDraft("game", { values: { a: "10" }, editingRoundId: null });
    await settled();
    request.mockRejectedValue(new FamilyRequestError("Access removed", 403));
    await s.refresh("game");
    expect(s.getSnapshot().games).toEqual([]);
    expect(s.getSnapshot().drafts).toEqual({});
    expect(s.getSnapshot().access).toEqual({});
  });
  it("malformed successful response is not treated as a save acknowledgement", async () => {
    const s = store();
    await s.load();
    request.mockResolvedValue({
      game: { definition: { id: "game" }, revision: 1 },
    });
    await expect(
      s.mutate({
        type: "save-palette",
        expectedRevision: 0,
        colours: DEFAULT_PIECE_COLOURS,
      }),
    ).rejects.toThrow();
    expect(s.getSnapshot().pending).toBe(true);
  });
});

describe("Crokinole interruption regression cases", () => {
  it("keeps exact pending request after an acknowledgement checkpoint fails in the same session", async () => {
    const s = store();
    await s.load();
    const originalPut = IDBObjectStore.prototype.put;
    let failCheckpoint = false;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (failCheckpoint) throw new DOMException("Full", "QuotaExceededError");
      return originalPut.apply(this, args);
    });
    request.mockImplementation(async () => {
      failCheckpoint = true;
      return { palette: { revision: 1, colours: DEFAULT_PIECE_COLOURS } };
    });
    await expect(
      s.mutate({
        type: "save-palette",
        expectedRevision: 0,
        colours: DEFAULT_PIECE_COLOURS,
      }),
    ).rejects.toThrow();
    const first = request.mock.calls.at(-1)?.[1];
    expect(s.getSnapshot().pending).toBe(true);
    failCheckpoint = false;
    request.mockResolvedValue({
      palette: { revision: 1, colours: DEFAULT_PIECE_COLOURS },
      replayed: true,
    });
    await s.retry();
    expect(request.mock.calls.at(-1)?.[1]).toEqual(first);
    expect(s.getSnapshot().palette?.revision).toBe(1);
    expect(s.getSnapshot().pending).toBe(false);
  });
  it("rejects structurally valid but stale palette acknowledgement", async () => {
    const s = store();
    await s.load();
    request.mockResolvedValue({
      palette: { revision: 0, colours: DEFAULT_PIECE_COLOURS },
    });
    await expect(
      s.mutate({
        type: "save-palette",
        expectedRevision: 0,
        colours: DEFAULT_PIECE_COLOURS,
      }),
    ).rejects.toThrow();
    expect(s.getSnapshot().pending).toBe(true);
  });
  it("lost draft acknowledgement followed by a newer remote entry exposes both drafts", async () => {
    const s = store();
    await s.load("game");
    s.setDraft("game", { values: { a: "10", b: "0" }, editingRoundId: null });
    await settled();
    request.mockRejectedValue(new Error("Acknowledgement lost"));
    await expect(s.syncDraft("game")).rejects.toThrow();
    request.mockResolvedValue({
      draft: {
        revision: 2,
        baseRevision: 0,
        generation: 1,
        values: { a: "20", b: "0" },
        editingRoundId: null,
      },
      replayed: true,
    });
    await s.retry();
    expect(s.getSnapshot().drafts.game.values.a).toBe("10");
    expect(s.getSnapshot().conflicts.game.values.a).toBe("20");
    expect(s.getSnapshot().drafts.game.dirty).toBe(true);
  });
  it("changed scorer generation exposes a cleared remote entry instead of endlessly retrying a stale draft", async () => {
    const s = store();
    await s.load("game");
    s.setDraft("game", { values: { a: "10", b: "0" }, editingRoundId: null });
    await settled();
    const latest = state();
    latest.access.game.generation = 2;
    latest.draft = {
      revision: 0,
      baseRevision: 0,
      generation: 2,
      values: {},
      editingRoundId: null,
    };
    request.mockResolvedValue(latest);
    await s.refresh("game");
    expect(s.getSnapshot().conflicts.game.generation).toBe(2);
    const calls = request.mock.calls.length;
    await s.syncDraft("game");
    expect(request.mock.calls.length).toBe(calls);
  });
  it("permission denial on mutation removes existing conflicts as well as visible drafts", async () => {
    const s = store();
    await s.load("game");
    s.setDraft("game", { values: { a: "10" }, editingRoundId: null });
    await settled();
    request.mockResolvedValue({
      ...state(),
      draft: {
        revision: 2,
        baseRevision: 0,
        generation: 1,
        values: { a: "20" },
        editingRoundId: null,
      },
    });
    await s.refresh("game");
    expect(s.getSnapshot().conflicts.game).toBeDefined();
    request.mockRejectedValue(new FamilyRequestError("Access removed", 403));
    await expect(
      s.mutate({
        type: "save-palette",
        expectedRevision: 0,
        colours: DEFAULT_PIECE_COLOURS,
      }),
    ).rejects.toThrow();
    expect(s.getSnapshot().conflicts).toEqual({});
    expect(s.getSnapshot().drafts).toEqual({});
  });
});

describe("Crokinole acknowledgement evidence", () => {
  it("does not treat an unchanged valid game as proof a command was accepted", async () => {
    const s = store();
    await s.load("game");
    request.mockResolvedValue({
      game,
      access: state().access.game,
      draft: null,
    });
    await expect(
      s.command("game", {
        id: "record",
        expectedRevision: 0,
        type: "record_round",
        roundId: "round",
        entries: [
          { participantId: "a", rawScore: 5 },
          { participantId: "b", rawScore: 0 },
        ],
      }),
    ).rejects.toThrow(/not confirmed/);
    expect(s.getSnapshot().pending).toBe(true);
    expect(s.getSnapshot().games[0].rounds).toHaveLength(0);
  });
  it("preserves text typed while a draft acknowledgement checkpoint is committing", async () => {
    const s = store();
    await s.load("game");
    s.setDraft("game", { values: { a: "10", b: "0" }, editingRoundId: null });
    await settled();
    request.mockResolvedValue({
      draft: {
        revision: 1,
        baseRevision: 0,
        generation: 1,
        values: { a: "10", b: "0" },
        editingRoundId: null,
      },
    });
    const original = IDBObjectStore.prototype.put;
    let injected = false;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const row = args[0] as {
        workspace?: {
          pending: unknown;
          drafts?: Record<string, { serverRevision: number }>;
        };
      };
      if (
        !injected &&
        row.workspace?.pending === null &&
        row.workspace.drafts?.game?.serverRevision === 1
      ) {
        injected = true;
        s.setDraft("game", {
          values: { a: "15", b: "0" },
          editingRoundId: null,
        });
      }
      return original.apply(this, args);
    });
    await s.syncDraft("game");
    expect(injected).toBe(true);
    expect(s.getSnapshot().drafts.game.values.a).toBe("15");
    expect(s.getSnapshot().drafts.game.dirty).toBe(true);
    expect(s.getSnapshot().drafts.game.serverRevision).toBe(1);
    await settled();
    s.close();
    request.mockImplementation(async () => state());
    const next = store();
    await next.load("game");
    expect(next.getSnapshot().drafts.game.values.a).toBe("15");
  });
  it("does not resubmit a definitely rejected draft until the scorer edits or reviews it", async () => {
    const s = store();
    await s.load("game");
    s.setDraft("game", { values: { a: "10" }, editingRoundId: null });
    await settled();
    request.mockImplementation(async (_path: string, body: unknown) => {
      if (body) throw new FamilyRequestError("Changed", 409);
      return state();
    });
    await expect(s.syncDraft("game")).rejects.toThrow();
    const before = request.mock.calls.filter((c) => c[1]).length;
    await new Promise((resolve) => setTimeout(resolve, 725));
    await s.syncDraft("game");
    expect(request.mock.calls.filter((c) => c[1]).length).toBe(before);
  });
  it("denies retained workspace export after membership revocation", async () => {
    const s = store();
    await s.load();
    request.mockRejectedValue(new FamilyRequestError("Access removed", 403));
    await s.refresh();
    expect(() => s.exportWorkspace()).toThrow(/active family access/);
  });
});

it("a now-hidden private game disappears on 404 without erasing protected recovery data", async () => {
  const s = store();
  await s.load("game");
  s.setDraft("game", { values: { a: "10" }, editingRoundId: null });
  await settled();
  request.mockResolvedValue({
    ...state(),
    draft: {
      revision: 2,
      baseRevision: 0,
      generation: 1,
      values: { a: "20" },
      editingRoundId: null,
    },
  });
  await s.refresh("game");
  expect(s.getSnapshot().conflicts.game).toBeDefined();
  request.mockRejectedValue(new FamilyRequestError("Game not available", 404));
  await s.refresh("game");
  expect(s.getSnapshot().games).toEqual([]);
  expect(s.getSnapshot().drafts).toEqual({});
  expect(s.getSnapshot().conflicts).toEqual({});
  expect(s.getSnapshot().access).toEqual({});
  expect(() => s.exportWorkspace()).toThrow();
  s.close();
  request.mockImplementation(async () => state());
  const restored = store();
  await restored.load("game");
  expect(restored.getSnapshot().drafts.game.values.a).toBe("10");
});

it("full history refresh hides drafts whose game access is no longer present", async () => {
  const s = store();
  await s.load("game");
  s.setDraft("game", { values: { a: "10" }, editingRoundId: null });
  await settled();
  request.mockResolvedValue({ ...state(), games: [], access: {} });
  await s.refresh();
  expect(s.getSnapshot().games).toEqual([]);
  expect(s.getSnapshot().drafts).toEqual({});
  expect(s.getSnapshot().conflicts).toEqual({});
  expect(() => s.exportWorkspace()).toThrow();
});

it("initial missing-game response exits loading", async () => {
  const s = store();
  request.mockRejectedValue(new FamilyRequestError("Not available", 404));
  await s.load("private");
  expect(s.getSnapshot().status).toBe("error");
});
it("losing scorer permission hides rather than destroys retained text", async () => {
  const s = store();
  await s.load("game");
  s.setDraft("game", { values: { a: "35" }, editingRoundId: null });
  await settled();
  const observer = state();
  observer.access.game.canScore = false;
  request.mockResolvedValue(observer);
  await s.refresh("game");
  expect(s.getSnapshot().drafts).toEqual({});
  const restored = state();
  restored.access.game.generation = 2;
  request.mockResolvedValue(restored);
  await s.refresh("game");
  expect(s.getSnapshot().drafts.game.values.a).toBe("35");
  expect(s.getSnapshot().conflicts.game.generation).toBe(2);
});
async function localRows(seed?: unknown) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("amberly-crokinole-workspaces", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("workspaces");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return await new Promise<{ keys: IDBValidKey[]; values: unknown[] }>(
    (resolve, reject) => {
      const tx = database.transaction(
        "workspaces",
        seed === undefined ? "readonly" : "readwrite",
      );
      const table = tx.objectStore("workspaces");
      if (seed !== undefined) table.put(seed, "family:user");
      const keys = table.getAllKeys(),
        values = table.getAll();
      tx.oncomplete = () => {
        database.close();
        resolve({ keys: keys.result, values: values.result });
      };
      tx.onabort = () => {
        database.close();
        reject(tx.error);
      };
    },
  );
}
it("confirmed corrupt workspace recovery quarantines original atomically and reloads only shared games", async () => {
  const corrupt = {
    owner: "old",
    workspace: { version: 99, drafts: { private: "original" } },
  };
  await localRows(corrupt);
  const s = store();
  await s.load();
  expect(s.getSnapshot().recoveryNeeded).toBe(true);
  await expect(s.recoverLocalWorkspace(false)).rejects.toThrow(/Confirm/);
  expect((await localRows()).values).toEqual([corrupt]);
  await s.recoverLocalWorkspace(true);
  expect(s.getSnapshot().status).toBe("ready");
  expect(s.getSnapshot().recoveryNeeded).toBe(false);
  expect(s.getSnapshot().games[0].definition.id).toBe("game");
  const rows = await localRows();
  expect(
    rows.keys.some((key) => String(key).startsWith("recovery:family:user:")),
  ).toBe(true);
  expect(rows.values).toContainEqual(corrupt);
  expect(request.mock.calls.every((call) => call[1] === undefined)).toBe(true);
});
it("failed quarantine cannot overwrite the original corrupt workspace", async () => {
  const corrupt = { owner: "old", workspace: { version: 99 } };
  await localRows(corrupt);
  const s = store();
  await s.load();
  const original = IDBObjectStore.prototype.put;
  const put = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (String(args[1]).startsWith("recovery:"))
        throw new DOMException("Full", "QuotaExceededError");
      return original.apply(this, args);
    });
  await expect(s.recoverLocalWorkspace(true)).rejects.toThrow();
  put.mockRestore();
  expect((await localRows()).values).toEqual([corrupt]);
  expect(s.getSnapshot().recoveryNeeded).toBe(true);
});
