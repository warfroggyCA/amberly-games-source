import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDBDatabase,
  IDBFactory,
  IDBKeyRange,
  IDBObjectStore,
} from "fake-indexeddb";
import { createBoard } from "../src/domain/board";
import { emptyDraft } from "../src/domain/gym/placement";
import {
  readGymDraft,
  writeGymDraft,
  type GymDraft,
} from "../src/lib/gym-draft";
import {
  acknowledgeGymEvent,
  pendingGymEvents,
  queueGymEvent,
} from "../src/lib/gym-history-outbox";
import type { GymIdentity, GymWrite } from "../src/lib/gym-history-contract";

let factory: IDBFactory;
const owner: GymIdentity = {
  familyId: "family-1",
  userId: "user-1",
  playerId: "player-1",
};
function draft(): GymDraft {
  const rack = ["A", "A", "T", "E", "R", "S", "?"] as const;
  return {
    version: 1,
    puzzle: {
      version: 1,
      generator: "legal-play-v1",
      rules: "amberly-two-player-v1",
      seed: "storage-test",
      reference: { id: "test", edition: "1", status: "test" },
      position: {
        board: createBoard(),
        rack: [...rack],
        scores: [0, 0],
        opponentCount: 7,
        bagCount: 86,
        passes: 0,
      },
      setup: [],
    },
    draft: emptyDraft([...rack]),
    undo: [],
    referenceWords: [],
    hint: 0,
    pointToHint: false,
    reveal: false,
    solutionIndex: 0,
    help: false,
    reducedMotion: false,
    liveCoaching: false,
    petPaused: false,
  };
}
function event(sequence = 1, sessionId = "session-1"): GymWrite {
  return {
    sessionId,
    playerId: owner.playerId,
    puzzle: draft().puzzle,
    event: {
      id: `${sessionId}-event-${sequence}`,
      sequence,
      occurredAt: "2026-10-02T12:00:00.000Z",
      payload: { type: "hint", level: 1 },
    },
  };
}
function delayedOpen() {
  const db = { close: vi.fn(), createObjectStore: vi.fn() };
  const request = {
    result: db,
    transaction: { abort: vi.fn() },
    error: new DOMException("Storage unavailable", "UnknownError"),
    onsuccess: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    onblocked: null as ((event: Event) => void) | null,
    onupgradeneeded: null as ((event: Event) => void) | null,
  };
  const open = vi
    .spyOn(factory, "open")
    .mockReturnValue(request as unknown as IDBOpenDBRequest);
  return { request, db, open };
}
beforeEach(() => {
  factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Gym storage opening", () => {
  it.each([
    ["draft recovery", () => readGymDraft("local")],
    ["profile outbox", () => queueGymEvent(owner, event())],
  ] as const)("settles %s when IndexedDB is unresponsive", async (_, work) => {
    vi.useFakeTimers();
    const { request, db } = delayedOpen();
    let outcome: unknown;
    const pending = work().then(
      (value) => {
        outcome = { value };
      },
      (error: unknown) => {
        outcome = { error };
      },
    );
    try {
      await vi.advanceTimersByTimeAsync(15000);
      expect(outcome).toEqual({
        error: expect.objectContaining({
          message: expect.stringContaining("did not respond"),
        }),
      });
      expect(vi.getTimerCount()).toBe(0);
      request.onupgradeneeded?.(new Event("upgradeneeded"));
      expect(request.transaction.abort).toHaveBeenCalled();
      expect(db.createObjectStore).not.toHaveBeenCalled();
      request.onsuccess?.(new Event("success"));
      expect(db.close).toHaveBeenCalledOnce();
    } finally {
      request.onerror?.(new Event("error"));
      await pending;
    }
  });

  it("rejects a blocked opening and closes a late connection", async () => {
    vi.useFakeTimers();
    const { request, db } = delayedOpen();
    const rejected = expect(readGymDraft("local")).rejects.toThrow(
      "Close other Gym tabs",
    );
    request.onblocked?.(new Event("blocked"));
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    request.onupgradeneeded?.(new Event("upgradeneeded"));
    expect(request.transaction.abort).toHaveBeenCalled();
    expect(db.createObjectStore).not.toHaveBeenCalled();
    request.onsuccess?.(new Event("success"));
    expect(db.close).toHaveBeenCalledOnce();
  });

  it("clears the opening deadline on asynchronous failure", async () => {
    vi.useFakeTimers();
    const { request } = delayedOpen();
    const rejected = expect(pendingGymEvents(owner)).rejects.toThrow(
      "Storage unavailable",
    );
    request.onerror?.(new Event("error"));
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the opening deadline when opening throws synchronously", async () => {
    vi.useFakeTimers();
    vi.spyOn(factory, "open").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    await expect(readGymDraft("local")).rejects.toThrow("Storage blocked");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts and reports an upgrade failure", async () => {
    vi.useFakeTimers();
    const { request, db } = delayedOpen();
    db.createObjectStore.mockImplementation(() => {
      throw new Error("Upgrade failed");
    });
    const rejected = expect(readGymDraft("local")).rejects.toThrow(
      "Upgrade failed",
    );
    request.onupgradeneeded?.(new Event("upgradeneeded"));
    await rejected;
    expect(request.transaction.abort).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    request.onsuccess?.(new Event("success"));
    expect(db.close).toHaveBeenCalledOnce();
  });
});

describe("Gym storage data and connection lifecycle", () => {
  it("preserves a saved draft through an opening timeout and allows retry", async () => {
    const original = draft();
    await writeGymDraft("local", 0, original);
    vi.useFakeTimers();
    const { request, open, db } = delayedOpen();
    const changed = { ...original, hint: 3 };
    const rejected = expect(writeGymDraft("local", 1, changed)).rejects.toThrow(
      "did not respond",
    );
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    request.onsuccess?.(new Event("success"));
    expect(db.close).toHaveBeenCalledOnce();
    open.mockRestore();
    vi.useRealTimers();
    expect(await readGymDraft("local")).toEqual({
      key: "local",
      revision: 1,
      value: original,
    });
    await expect(writeGymDraft("local", 1, changed)).resolves.toBe(2);
    expect((await readGymDraft("local"))?.value).toEqual(changed);
  });

  it("keeps compare-and-write atomic and closes failed transaction connections", async () => {
    const original = draft();
    const close = vi.spyOn(IDBDatabase.prototype, "close");
    await writeGymDraft("local", 0, original);
    close.mockClear();
    await expect(
      writeGymDraft("local", 0, { ...original, hint: 3 }),
    ).rejects.toThrow("Another tab updated");
    expect(close).toHaveBeenCalledOnce();
    expect((await readGymDraft("local"))?.value).toEqual(original);
  });

  it("closes the connection if transaction creation throws", async () => {
    await readGymDraft("local");
    const close = vi.spyOn(IDBDatabase.prototype, "close");
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
      throw new DOMException("Database unavailable", "InvalidStateError");
    });
    await expect(readGymDraft("local")).rejects.toThrow("Database unavailable");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the outbox connection if creating a request throws", async () => {
    await pendingGymEvents(owner);
    const close = vi.spyOn(IDBDatabase.prototype, "close");
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => {
      throw new DOMException("Value cannot be cloned", "DataCloneError");
    });
    await expect(queueGymEvent(owner, event())).rejects.toThrow(
      "Value cannot be cloned",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps pending history separated by profile and acknowledges only the saved event", async () => {
    const other = { ...owner, playerId: "player-2" };
    await queueGymEvent(owner, event(2));
    await queueGymEvent(owner, event(1));
    await queueGymEvent(other, event(1));
    const pending = await pendingGymEvents(owner);
    expect(pending.map((item) => item.data.event.sequence)).toEqual([1, 2]);
    await acknowledgeGymEvent(pending[0].key);
    expect(
      (await pendingGymEvents(owner)).map((item) => item.data.event.sequence),
    ).toEqual([2]);
    expect(await pendingGymEvents(other)).toHaveLength(1);
  });
});
