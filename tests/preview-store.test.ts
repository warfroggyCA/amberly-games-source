import { EMPTY_EQUIPMENT, type Equipment } from "../src/domain/equipment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore, IDBDatabase } from "fake-indexeddb";
import { createGame, applyCommand, type GameState } from "../src/domain/game";
import { testLexicon } from "../src/lib/test-lexicon";
import { defaultLexicon } from "../src/lib/lexicons";
import {
  saveVerifiedWords,
  syncVerifiedWords,
} from "../src/lib/verified-word-store";
import type { VerifiedWord } from "../src/domain/verified-words";
import { createBoard, LETTER_COUNTS } from "../src/domain/board";
import type { Letter, Lexicon } from "../src/domain/types";
import type { PreviewData, Draft } from "../src/lib/preview-store";

const DB_NAME = "family-scrabble-development";
let factory: IDBFactory;
async function freshStore() {
  vi.resetModules();
  return import("../src/lib/preview-store");
}
function dataWithGame(): PreviewData {
  const created = createGame({
    id: "game-1",
    players: [
      { id: "player-1", name: "Doug", seat: 0 },
      { id: "player-2", name: "Alex", seat: 1 },
    ],
    firstPlayerId: "player-1",
    direction: "clockwise",
    lexicon: {
      id: testLexicon.id,
      edition: testLexicon.edition,
      status: testLexicon.status,
    },
    createdAt: "2026-09-14T01:00:00.000Z",
  });
  if (!created.ok) throw new Error(created.error.message);
  return {
    version: 1,
    revision: 1,
    players: [
      { id: "player-1", name: "Doug" },
      { id: "player-2", name: "Alex" },
    ],
    games: [created.game],
    activeGameId: "game-1",
    drafts: {},
  };
}
function draft(): Draft {
  return {
    revision: 0,
    row: 7,
    col: 9,
    direction: "across",
    placements: [
      { row: 7, col: 7, tile: { letter: "A", blank: false } },
      { row: 7, col: 8, tile: { letter: "T", blank: true } },
    ],
  };
}
async function connection(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function seed(value: unknown) {
  const db = await connection();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put(value, "preview");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}
async function stored(): Promise<unknown> {
  const db = await connection();
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = db
      .transaction("state", "readonly")
      .objectStore("state")
      .get("preview");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

beforeEach(() => {
  factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
});

describe("verified additions and editable profile persistence", () => {
  const onyx: VerifiedWord = {
    word: "ONYX",
    source: "merriam-webster",
    sourceUrl: "https://scrabble.merriam.com/finder/onyx",
    verifiedAt: "2026-09-14T14:00:00.000Z",
  };
  it("atomically saves a sourced addition, preserves the draft, and restores it offline", async () => {
    const data = dataWithGame();
    data.drafts[data.games[0].id] = draft();
    await seed(data);
    const first = await freshStore();
    await first.loadPreview();
    await first.updatePreview((current) =>
      saveVerifiedWords(current, [onyx], data.games[0].id),
    );
    const saved = first.getSnapshot().data;
    expect(saved.verifiedWords).toEqual([onyx]);
    expect(saved.games[0].verifiedWords).toEqual([onyx]);
    expect(saved.games[0].turns).toEqual([]);
    expect(saved.games[0].lexicon).toEqual(data.games[0].lexicon);
    expect(saved.drafts[data.games[0].id]).toEqual({ ...draft(), revision: 1 });
    const second = await freshStore();
    await second.loadPreview();
    expect(second.getSnapshot().status).toBe("ready");
    expect(second.getSnapshot().data).toEqual(saved);
    await expect(
      second.updatePreview((current) => ({ ...current, verifiedWords: [] })),
    ).rejects.toThrow("cannot be removed");
    expect(await stored()).toEqual(saved);
  });
  it("deduplicates confirmation retries and makes saved words available to another game", async () => {
    const data = dataWithGame();
    const once = saveVerifiedWords(data, [onyx], data.games[0].id);
    const twice = saveVerifiedWords(once, [onyx], data.games[0].id);
    expect(twice.games[0].events).toEqual(once.games[0].events);
    expect(twice.verifiedWords).toEqual([onyx]);
    const newGame = syncVerifiedWords(
      dataWithGame().games[0],
      twice.verifiedWords!,
    );
    expect(newGame.verifiedWords).toEqual([onyx]);
  });
  it("edits a profile without changing any historical player snapshots or turns", async () => {
    const data = dataWithGame();
    await seed(data);
    const first = await freshStore();
    await first.loadPreview();
    await first.updatePreview((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.id === "player-1"
          ? { ...player, name: "Douglas", bio: "Always saving the Q." }
          : player,
      ),
    }));
    const saved = first.getSnapshot().data;
    expect(saved.players[0].name).toBe("Douglas");
    expect(saved.games).toEqual(data.games);
    const second = await freshStore();
    await second.loadPreview();
    expect(second.getSnapshot().data.players[0].bio).toBe(
      "Always saving the Q.",
    );
    await expect(
      second.updatePreview((current) => ({
        ...current,
        players: current.players.map((player) => ({
          ...player,
          photoDataUrl: "https://example.com/untrusted.svg",
        })),
      })),
    ).rejects.toThrow("player data");
    expect(await stored()).toEqual(saved);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("IndexedDB persistence and transactional ownership", () => {
  it("creates an empty view without inventing or writing a game", async () => {
    const store = await freshStore();
    await store.loadPreview();
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      pending: 0,
      data: { revision: 0, games: [], players: [] },
    });
    expect(await stored()).toBeUndefined();
  });
  it("persists players, complete game history, and blank draft identity across a fresh module load", async () => {
    const first = await freshStore();
    await first.loadPreview();
    await first.updatePreview(() => ({
      ...dataWithGame(),
      drafts: { "game-1": draft() },
    }));
    const second = await freshStore();
    await second.loadPreview();
    expect(second.getSnapshot().status).toBe("ready");
    expect(second.getSnapshot().data).toEqual(first.getSnapshot().data);
    expect(
      second.getSnapshot().data.drafts["game-1"].placements[1].tile,
    ).toEqual({ letter: "T", blank: true });
  });
  it("replays and restores a recorded scoring turn exactly", async () => {
    const data = dataWithGame();
    const played = applyCommand(
      data.games[0],
      {
        id: "turn-1",
        expectedRevision: 0,
        type: "play",
        placements: [
          { row: 7, col: 7, tile: { letter: "A", blank: false } },
          { row: 7, col: 8, tile: { letter: "T", blank: false } },
        ],
      },
      testLexicon,
    );
    if (!played.ok) throw new Error(played.error.message);
    data.games[0] = played.game;
    await seed(data);
    const store = await freshStore();
    await store.loadPreview();
    expect(store.getSnapshot().data.games[0]).toEqual(played.game);
    expect(store.getSnapshot().data.games[0].scores["player-1"]).toBe(4);
  });
  it("serializes queued mutations against the latest committed revision", async () => {
    const store = await freshStore();
    await store.loadPreview();
    const add = (id: string) =>
      store.updatePreview((data) => ({
        ...data,
        players: [...data.players, { id, name: id }],
      }));
    await Promise.all([add("player-1"), add("player-2"), add("player-3")]);
    expect(store.getSnapshot().data.revision).toBe(3);
    expect(store.getSnapshot().data.players.map((p) => p.id)).toEqual([
      "player-1",
      "player-2",
      "player-3",
    ]);
    expect(store.getSnapshot().pending).toBe(0);
    expect(await stored()).toEqual(store.getSnapshot().data);
  });
  it("rejects stale-tab changes, keeps the old view available, and prevents subsequent stale writes", async () => {
    const first = await freshStore();
    await first.loadPreview();
    const second = await freshStore();
    await second.loadPreview();
    await first.updatePreview((data) => ({
      ...data,
      players: [{ id: "player-1", name: "Doug" }],
    }));
    await expect(
      second.updatePreview((data) => ({
        ...data,
        players: [{ id: "player-2", name: "Alex" }],
      })),
    ).rejects.toThrow("Another tab");
    expect(second.getSnapshot()).toMatchObject({
      status: "ready",
      pending: 0,
      data: { players: [], revision: 0 },
    });
    expect(second.getSnapshot().error).toContain("Copy any unsaved input");
    expect(second.getSnapshot().error).not.toContain("still visible");
    await expect(second.updatePreview((data) => data)).rejects.toThrow(
      "Another tab",
    );
    expect(await stored()).toEqual(first.getSnapshot().data);
  });
  it("rejects replacement data with the same revision instead of overwriting it", async () => {
    await seed(dataWithGame());
    const store = await freshStore();
    await store.loadPreview();
    const externallyChanged = { ...dataWithGame(), players: new Array(2) };
    await seed(externallyChanged);
    await expect(
      store.updatePreview((data) => ({ ...data, activeGameId: null })),
    ).rejects.toThrow("Another tab");
    expect(await stored()).toEqual(externallyChanged);
  });
  it("freezes committed data so failed in-place mutations cannot corrupt the current snapshot", async () => {
    const store = await freshStore();
    await store.loadPreview();
    await expect(
      store.updatePreview((data) => {
        data.players.push({ id: "player-1", name: "Doug" });
        throw new Error("Interrupted");
      }),
    ).rejects.toThrow();
    expect(store.getSnapshot().data.players).toEqual([]);
    expect(await stored()).toBeUndefined();
    await store.updatePreview((data) => ({
      ...data,
      players: [{ id: "player-1", name: "Doug" }],
    }));
    expect(store.getSnapshot().data.players).toHaveLength(1);
  });
});

describe("storage failure and recovery states", () => {
  it("settles with a recovery error when indexedDB.open synchronously throws", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
    const store = await freshStore();
    await expect(store.loadPreview()).resolves.toBeUndefined();
    expect(store.getSnapshot()).toMatchObject({
      status: "error",
      error: expect.stringContaining("could not be opened"),
    });
  });
  it("settles with a recovery error when IndexedDB is absent", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const store = await freshStore();
    await store.loadPreview();
    expect(store.getSnapshot().status).toBe("error");
  });
  it("handles an asynchronous open error without remaining in loading", async () => {
    const request = {} as IDBOpenDBRequest;
    vi.stubGlobal("indexedDB", { open: () => request });
    const store = await freshStore();
    const pending = store.loadPreview();
    request.onerror?.(new Event("error"));
    await pending;
    expect(store.getSnapshot().status).toBe("error");
  });
  it("handles a blocked open, and closes a late connection without replacing the recovery state", async () => {
    const close = vi.fn();
    const request = { result: { close } } as unknown as IDBOpenDBRequest;
    vi.stubGlobal("indexedDB", { open: () => request });
    const store = await freshStore();
    const pending = store.loadPreview();
    request.onblocked?.(new Event("blocked") as IDBVersionChangeEvent);
    await pending;
    expect(store.getSnapshot()).toMatchObject({
      status: "error",
      error: expect.stringContaining("Close other"),
    });
    request.onsuccess?.(new Event("success"));
    expect(close).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().status).toBe("error");
  });
  it("times out an open request that never completes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("indexedDB", { open: () => ({}) });
    const store = await freshStore();
    const pending = store.loadPreview();
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(store.getSnapshot()).toMatchObject({
      status: "error",
      error: expect.stringContaining("did not respond"),
    });
  });
  it("reports a read transaction construction failure without hanging", async () => {
    await seed(dataWithGame());
    const failing = vi
      .spyOn(IDBDatabase.prototype, "transaction")
      .mockImplementation(() => {
        throw new DOMException("Unavailable");
      });
    const store = await freshStore();
    await store.loadPreview();
    expect(store.getSnapshot().status).toBe("error");
    failing.mockRestore();
  });
  it("retains the previous stored value and permits retry after a quota failure", async () => {
    const store = await freshStore();
    await store.loadPreview();
    await store.updatePreview((data) => ({
      ...data,
      players: [{ id: "player-1", name: "Doug" }],
    }));
    const original = await stored();
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Full", "QuotaExceededError");
      });
    await expect(
      store.updatePreview((data) => ({
        ...data,
        players: [...data.players, { id: "player-2", name: "Alex" }],
      })),
    ).rejects.toThrow("could not be saved");
    expect(store.getSnapshot()).toMatchObject({ status: "ready", pending: 0 });
    expect(store.getSnapshot().data).toEqual(original);
    expect(await stored()).toEqual(original);
    put.mockRestore();
    await store.updatePreview((data) => ({
      ...data,
      players: [...data.players, { id: "player-2", name: "Alex" }],
    }));
    expect(store.getSnapshot().data.players).toHaveLength(2);
  });
  it("does not report failed writes as committed when transaction creation throws", async () => {
    const store = await freshStore();
    await store.loadPreview();
    const transaction = vi
      .spyOn(IDBDatabase.prototype, "transaction")
      .mockImplementationOnce(() => {
        throw new DOMException("Closed");
      });
    await expect(
      store.updatePreview((data) => ({
        ...data,
        players: [{ id: "player-1", name: "Doug" }],
      })),
    ).rejects.toThrow("could not save");
    transaction.mockRestore();
    expect(store.getSnapshot().data.revision).toBe(0);
    expect(store.getSnapshot().pending).toBe(0);
    expect(await stored()).toBeUndefined();
  });
});

describe("corrupt stored input is retained for recovery", () => {
  const cases: Array<[string, (data: PreviewData) => void]> = [
    [
      "sparse players",
      (data) => {
        data.players = new Array(2);
      },
    ],
    [
      "sparse games",
      (data) => {
        data.games = new Array(1);
      },
    ],
    [
      "sparse draft placements",
      (data) => {
        data.drafts["game-1"] = { ...draft(), placements: new Array(2) };
      },
    ],
    [
      "array masquerading as drafts",
      (data) => {
        data.drafts = [] as unknown as PreviewData["drafts"];
      },
    ],
    [
      "draft revision mismatch",
      (data) => {
        data.drafts["game-1"] = { ...draft(), revision: -1 };
      },
    ],
    [
      "fractional draft position",
      (data) => {
        data.drafts["game-1"] = { ...draft(), col: 1.2 };
      },
    ],
    [
      "malformed blank flag",
      (data) => {
        const d = draft();
        d.placements[0] = {
          ...d.placements[0],
          tile: { letter: "A", blank: "true" as unknown as boolean },
        };
        data.drafts["game-1"] = d;
      },
    ],
    [
      "newline in tile letter",
      (data) => {
        const d = draft();
        d.placements[0] = {
          ...d.placements[0],
          tile: { letter: "A\n" as "A", blank: false },
        };
        data.drafts["game-1"] = d;
      },
    ],
    [
      "duplicate draft square",
      (data) => {
        const d = draft();
        d.placements.push(d.placements[0]);
        data.drafts["game-1"] = d;
      },
    ],
    [
      "unknown active game",
      (data) => {
        data.activeGameId = "missing";
      },
    ],
    [
      "missing player reference",
      (data) => {
        data.players.pop();
      },
    ],
    [
      "unsafe revision",
      (data) => {
        data.revision = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      "corrupted score projection",
      (data) => {
        data.games = structuredClone(data.games);
        data.games[0].scores["player-1"] = 999;
      },
    ],
  ];
  it.each(cases)(
    "rejects %s without writing a replacement",
    async (_, corrupt) => {
      const data = dataWithGame();
      corrupt(data);
      await seed(data);
      const store = await freshStore();
      await store.loadPreview();
      expect(store.getSnapshot().status).toBe("error");
      expect(await stored()).toEqual(data);
    },
  );
  it("rejects corrupt outgoing data before opening a write transaction", async () => {
    const store = await freshStore();
    await store.loadPreview();
    await expect(
      store.updatePreview((data) => ({ ...data, players: new Array(2) })),
    ).rejects.toThrow("recovery");
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().data.revision).toBe(0);
    expect(await stored()).toBeUndefined();
  });
  it("preserves a structurally valid unfinished draft even when its word is not yet legal", async () => {
    const data = dataWithGame();
    data.drafts["game-1"] = {
      ...draft(),
      placements: [{ row: 0, col: 0, tile: { letter: "Q", blank: false } }],
    };
    await seed(data);
    const store = await freshStore();
    await store.loadPreview();
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().data.drafts["game-1"]).toEqual(
      data.drafts["game-1"],
    );
  });
});

describe("persisted history cannot be silently replaced", () => {
  it("rejects removal of an existing game", async () => {
    await seed(dataWithGame());
    const store = await freshStore();
    await store.loadPreview();
    const original = await stored();
    await expect(
      store.updatePreview((data) => ({
        ...data,
        games: [],
        activeGameId: null,
      })),
    ).rejects.toThrow("cannot be removed");
    expect(await stored()).toEqual(original);
  });
  it("rejects a valid shorter journal for the same game identity", async () => {
    const data = dataWithGame();
    const initialGame = data.games[0];
    const passed = applyCommand(
      initialGame,
      { id: "turn-1", expectedRevision: 0, type: "pass" },
      testLexicon,
    );
    if (!passed.ok) throw new Error(passed.error.message);
    data.games[0] = passed.game;
    await seed(data);
    const store = await freshStore();
    await store.loadPreview();
    await expect(
      store.updatePreview((current) => ({ ...current, games: [initialGame] })),
    ).rejects.toThrow("cannot be removed");
    expect(await stored()).toEqual(data);
  });
});

describe("nonstandard supply persistence and trusted replay", () => {
  it("persists extra physical Qs and restores a real assisted no-move search against the same supply", async () => {
    const first = await freshStore();
    const data = dataWithGame();
    const extended = applyCommand(
      data.games[0],
      {
        id: "extra-q",
        expectedRevision: 0,
        type: "extend-supply",
        additions: { Q: 1 },
        reason: "Physical set has two Q tiles",
        recordedBy: "Doug",
        recordedAt: "2026-09-14T12:00:00.000Z",
      },
      testLexicon,
    );
    if (!extended.ok) throw new Error(extended.error.message);
    const assisted = applyCommand(
      extended.game,
      {
        id: "assist",
        expectedRevision: 1,
        type: "assist",
        racks: {
          "player-1": ["Q", "Q", "A", "A", "A", "A", "A"],
          "player-2": ["E", "E", "E", "I", "I", "I", "I"],
        },
      },
      testLexicon,
    );
    if (!assisted.ok) throw new Error(assisted.error.message);
    const passed = applyCommand(
      assisted.game,
      {
        id: "pass-search",
        expectedRevision: 2,
        type: "assisted-pass",
        solverVersion: "trie-v1",
      },
      testLexicon,
      first.solverContext,
    );
    if (!passed.ok) throw new Error(passed.error.message);
    data.games[0] = passed.game;
    await seed(data);
    const restored = await freshStore();
    await restored.loadPreview();
    expect(restored.getSnapshot().status).toBe("ready");
    expect(restored.getSnapshot().data.games[0]).toEqual(passed.game);
    expect(restored.getSnapshot().data.games[0].tileSupply?.Q).toBe(2);
    expect(restored.getSnapshot().data.games[0].expectedBagCount).toBe(87);
  });
});

describe("versioned historical word references", () => {
  function newOnlyWord(): string {
    const word = defaultLexicon.words.find(
      (candidate) =>
        candidate.length >= 2 &&
        candidate.length <= 7 &&
        !testLexicon.has(candidate) &&
        [...candidate].every(
          (letter) =>
            /^[A-Z]$/.test(letter) &&
            [...candidate].filter((value) => value === letter).length <=
              LETTER_COUNTS[letter as Letter],
        ),
    );
    if (!word)
      throw new Error(
        "The registered new snapshot must provide a playable word outside the legacy examples for this regression.",
      );
    return word;
  }
  function createRecordedGame(
    id: string,
    reference: Lexicon,
    word: string,
  ): GameState {
    const created = createGame({
      ...dataWithGame().games[0].definition,
      id,
      lexicon: {
        id: reference.id,
        edition: reference.edition,
        status: reference.status,
      },
    });
    if (!created.ok) throw new Error(created.error.message);
    const played = applyCommand(
      created.game,
      {
        id: `${id}-turn`,
        expectedRevision: 0,
        type: "play",
        placements: [...word].map((letter, index) => ({
          row: 7,
          col: 7 + index,
          tile: { letter: letter as Letter, blank: false },
        })),
      },
      reference,
    );
    if (!played.ok) throw new Error(played.error.message);
    return played.game;
  }
  function mixedGames(): PreviewData {
    const oldGame = createRecordedGame("game-old", testLexicon, "AT");
    const newGame = createRecordedGame(
      "game-new",
      defaultLexicon,
      newOnlyWord(),
    );
    const pending = (game: GameState): Draft => ({
      ...draft(),
      revision: game.revision,
      row: 8,
      col: 9,
      placements: [
        { row: 8, col: 7, tile: { letter: "A", blank: false } },
        { row: 8, col: 8, tile: { letter: "T", blank: true } },
      ],
    });
    return {
      ...dataWithGame(),
      games: [oldGame, newGame],
      activeGameId: newGame.id,
      drafts: {
        [oldGame.id]: pending(oldGame),
        [newGame.id]: pending(newGame),
      },
    };
  }

  it("restores old and new games using each pinned reference and preserves both journals and blank drafts", async () => {
    expect(defaultLexicon.id).not.toBe(testLexicon.id);
    expect(defaultLexicon.status).toBe("ready");
    const original = mixedGames();
    const serializedBefore = JSON.stringify(original);
    await seed(original);
    const first = await freshStore();
    await first.loadPreview();
    expect(first.getSnapshot().status).toBe("ready");
    expect(first.getSnapshot().data).toEqual(original);
    expect(JSON.stringify(await stored())).toBe(serializedBefore);
    expect(first.getSnapshot().data.games[0].definition.lexicon).toEqual({
      id: testLexicon.id,
      edition: testLexicon.edition,
      status: testLexicon.status,
    });
    expect(first.getSnapshot().data.games[1].definition.lexicon).toEqual({
      id: defaultLexicon.id,
      edition: defaultLexicon.edition,
      status: defaultLexicon.status,
    });
    await first.updatePreview((current) => ({
      ...current,
      activeGameId: "game-old",
    }));
    const reopened = await freshStore();
    await reopened.loadPreview();
    expect(reopened.getSnapshot().status).toBe("ready");
    expect(reopened.getSnapshot().data.games).toEqual(original.games);
    expect(reopened.getSnapshot().data.drafts).toEqual(original.drafts);
  });

  it.each([
    "unknown-id",
    "altered-edition",
    "altered-status",
    "missing-reference",
  ])(
    "rejects %s without migrating definitions, resetting data or dropping drafts",
    async (change) => {
      const original = structuredClone(mixedGames());
      const game = original.games[1];
      const changed =
        change === "unknown-id"
          ? { ...game.lexicon, id: "unknown-snapshot" }
          : change === "altered-edition"
            ? { ...game.lexicon, edition: `${game.lexicon.edition}-altered` }
            : change === "altered-status"
              ? { ...game.lexicon, status: "test" as const }
              : null;
      // Alter both copies to isolate registry rejection rather than a projection mismatch.
      game.lexicon = changed as GameState["lexicon"];
      game.definition.lexicon = changed as GameState["lexicon"];
      await seed(original);
      const before = JSON.stringify(await stored());
      const store = await freshStore();
      await store.loadPreview();
      expect(store.getSnapshot().status).toBe("error");
      expect(store.getSnapshot().error).toBeTruthy();
      expect(JSON.stringify(await stored())).toBe(before);
      await expect(store.updatePreview(() => dataWithGame())).rejects.toThrow();
      expect(JSON.stringify(await stored())).toBe(before);
    },
  );

  it("retains existing mixed history and drafts after a failed attempt to rewrite a saved reference", async () => {
    const original = mixedGames();
    await seed(original);
    const store = await freshStore();
    await store.loadPreview();
    const before = store.getSnapshot().data;
    await expect(
      store.updatePreview((current) => ({
        ...current,
        games: current.games.map((game) =>
          game.id !== "game-new"
            ? game
            : {
                ...game,
                lexicon: {
                  ...game.lexicon,
                  edition: "not-the-recorded-edition",
                },
                definition: {
                  ...game.definition,
                  lexicon: {
                    ...game.definition.lexicon,
                    edition: "not-the-recorded-edition",
                  },
                },
              },
        ),
      })),
    ).rejects.toThrow();
    expect(store.getSnapshot().data).toBe(before);
    expect(store.getSnapshot().data.games).toEqual(original.games);
    expect(store.getSnapshot().data.drafts).toEqual(original.drafts);
    expect(await stored()).toEqual(before);
    await store.updatePreview((current) => ({
      ...current,
      activeGameId: "game-old",
    }));
    expect(store.getSnapshot().data.games).toEqual(original.games);
  });

  it("uses the passed registered game reference for assisted search, never a caller-provided replacement checker", async () => {
    const sorted = (word: string) => [...word].sort().join("");
    const newPair = defaultLexicon.words.find(
      (word) =>
        word.length === 2 &&
        !testLexicon.words.some(
          (legacy) => legacy.length === 2 && sorted(legacy) === sorted(word),
        ) &&
        [...word].every(
          (letter) =>
            /^[A-Z]$/.test(letter) &&
            [...word].filter((value) => value === letter).length <=
              LETTER_COUNTS[letter as Letter],
        ),
    );
    if (!newPair)
      throw new Error(
        "A new-only two-letter rack is required to distinguish historical solver references.",
      );
    const store = await freshStore();
    const checker = store.solverContext.hasLegalMove!;
    const rack = [...newPair] as Letter[];
    expect(checker(createBoard(), rack, testLexicon)).toBe(false);
    expect(
      checker(createBoard(), rack, {
        ...defaultLexicon,
        has() {
          throw new Error("Untrusted substitute must not be invoked");
        },
      }),
    ).toBe(true);
    expect(() =>
      checker(createBoard(), rack, { ...defaultLexicon, edition: "unknown" }),
    ).toThrow();
  });
});

describe("trusted assisted-pass existence verdicts", () => {
  it("never converts a bounded or failed existence search into a no-move pass", async () => {
    const store = await freshStore();
    const solver = await import("../src/domain/solver");
    const verifier = vi.spyOn(solver, "verifyMoveExists");
    for (const result of [
      {
        status: "incomplete" as const,
        reason: "node-budget" as const,
        moves: [],
        visitedNodes: 250_000,
        totalMoves: 0,
      },
      {
        status: "unavailable" as const,
        reason: "Reference unavailable",
        moves: [] as [],
        visitedNodes: 0 as const,
        totalMoves: 0 as const,
      },
      {
        status: "invalid" as const,
        error: "Invalid rack",
        moves: [] as [],
        visitedNodes: 0 as const,
        totalMoves: 0 as const,
      },
    ]) {
      verifier.mockReturnValueOnce(result);
      expect(() =>
        store.solverContext.hasLegalMove!(
          createBoard(),
          ["A", "T"],
          testLexicon,
        ),
      ).toThrow("No pass was recorded");
    }
    verifier.mockReturnValueOnce({ status: "none", visitedNodes: 120 });
    expect(
      store.solverContext.hasLegalMove!(createBoard(), ["A", "T"], testLexicon),
    ).toBe(false);
  });
});

describe("equipment persistence", () => {
  it("saves a default set across reload and keeps old game definitions unchanged", async () => {
    const data = dataWithGame();
    await seed(data);
    const first = await freshStore();
    await first.loadPreview();
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
    await first.updatePreview((current) => ({ ...current, equipment }));
    expect(first.getSnapshot().data.games).toEqual(data.games);
    const second = await freshStore();
    await second.loadPreview();
    expect(second.getSnapshot().data.equipment).toEqual(equipment);
    await expect(
      second.updatePreview((current) => ({
        ...current,
        equipment: EMPTY_EQUIPMENT,
      })),
    ).rejects.toThrow();
    expect(((await stored()) as PreviewData).equipment).toEqual(equipment);
  });
});
