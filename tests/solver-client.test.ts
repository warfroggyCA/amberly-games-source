import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoard, LETTER_COUNTS } from "../src/domain/board";
import type { MoveSearchResult } from "../src/domain/solver";
import { testLexicon } from "../src/lib/test-lexicon";
import { searchMoves, SOLVER_VERSION } from "../src/lib/solver-client";

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  static failConstruction = false;
  static failPost = false;
  static onConstruct: (() => void) | undefined;
  terminate = vi.fn();
  postMessage = vi.fn((value: unknown) => {
    if (TestWorker.failPost) throw new Error("Data clone failed");
    this.request = value as { id: number };
  });
  request: { id: number } | undefined;
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    super();
    if (TestWorker.failConstruction) throw new Error("Worker denied");
    TestWorker.instances.push(this);
    TestWorker.onConstruct?.();
  }
  reply(result: unknown, id = this.request?.id) {
    this.dispatchEvent(new MessageEvent("message", { data: { id, result } }));
  }
}
const completed: MoveSearchResult = {
  status: "complete",
  moves: [],
  totalMoves: 0,
  visitedNodes: 450,
};
const budget: MoveSearchResult = {
  status: "incomplete",
  reason: "node-budget",
  moves: [],
  totalMoves: 0,
  visitedNodes: 250_000,
};
const firstWorker = () => TestWorker.instances[0];

beforeEach(() => {
  vi.useFakeTimers();
  TestWorker.instances = [];
  TestWorker.failConstruction = false;
  TestWorker.failPost = false;
  TestWorker.onConstruct = undefined;
  vi.stubGlobal("Worker", TestWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("background move-search lifecycle", () => {
  it("uses a module worker and terminates exactly once after the matching complete result", async () => {
    const board = createBoard();
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    const promise = searchMoves(board, ["A", "T"], controller.signal);
    const worker = firstWorker();
    expect(SOLVER_VERSION).toBe("trie-v1");
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.url.pathname).toMatch(/solver\.worker\.ts$/);
    expect(worker.postMessage).toHaveBeenCalledWith({
      id: expect.any(Number),
      board,
      rack: ["A", "T"],
      lexicon: {
        id: testLexicon.id,
        edition: testLexicon.edition,
        status: testLexicon.status,
      },
    });
    worker.reply(completed);
    expect(await promise).toEqual(completed);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    worker.reply(completed);
    vi.advanceTimersByTime(30_000);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves a node-budget result as incomplete, never a certified empty search", async () => {
    const promise = searchMoves(createBoard(), ["?", "?"]);
    firstWorker().reply(budget);
    expect(await promise).toEqual(budget);
    expect(firstWorker().terminate).toHaveBeenCalledTimes(1);
  });
  it("returns pre-aborted cancellation without creating a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await searchMoves(createBoard(), ["A"], controller.signal),
    ).toMatchObject({ status: "incomplete", reason: "cancelled" });
    expect(TestWorker.instances).toHaveLength(0);
  });
  it("aborts a running worker and clears its timer", async () => {
    const controller = new AbortController();
    const promise = searchMoves(createBoard(), ["A"], controller.signal);
    controller.abort();
    expect(await promise).toMatchObject({
      status: "incomplete",
      reason: "cancelled",
    });
    expect(firstWorker().terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("covers cancellation during worker construction before registering the listener", async () => {
    const controller = new AbortController();
    TestWorker.onConstruct = () => controller.abort();
    expect(
      await searchMoves(createBoard(), ["A"], controller.signal),
    ).toMatchObject({ status: "incomplete", reason: "cancelled" });
    expect(firstWorker().postMessage).not.toHaveBeenCalled();
    expect(firstWorker().terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("times out without converting an unfinished search to a pass", async () => {
    const promise = searchMoves(createBoard(), ["?"]);
    vi.advanceTimersByTime(29_999);
    expect(firstWorker().terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(await promise).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("timed out"),
    });
    expect(firstWorker().terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["error", "messageerror"])(
    "handles worker %s and removes all listeners",
    async (type) => {
      const promise = searchMoves(createBoard(), ["A"]);
      const worker = firstWorker();
      const removed = vi.spyOn(worker, "removeEventListener");
      worker.dispatchEvent(new Event(type, { cancelable: true }));
      expect(await promise).toMatchObject({ status: "unavailable" });
      expect(removed.mock.calls.map(([event]) => event).sort()).toEqual([
        "error",
        "message",
        "messageerror",
      ]);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("handles unsupported workers and construction failures without a sync throw", async () => {
    TestWorker.failConstruction = true;
    expect(await searchMoves(createBoard(), ["A"])).toMatchObject({
      status: "unavailable",
    });
    vi.stubGlobal("Worker", undefined);
    expect(await searchMoves(createBoard(), ["A"])).toMatchObject({
      status: "unavailable",
    });
    expect(TestWorker.instances).toHaveLength(0);
  });
  it("handles a failed structured clone and cleans up the worker", async () => {
    TestWorker.failPost = true;
    expect(await searchMoves(createBoard(), ["A"])).toMatchObject({
      status: "unavailable",
    });
    expect(firstWorker().terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects a response belonging to another request", async () => {
    const promise = searchMoves(createBoard(), ["A"]);
    firstWorker().reply(completed, firstWorker().request!.id + 1);
    expect(await promise).toMatchObject({ status: "unavailable" });
  });
  it.each([
    null,
    {},
    { ...completed, status: "finished" },
    { ...completed, moves: [{}] },
    { ...completed, visitedNodes: -1 },
    { ...completed, totalMoves: "0" },
    { ...budget, reason: "unknown" },
    { status: "unavailable", moves: [], totalMoves: 0, visitedNodes: 0 },
  ])(
    "rejects a malformed result without a false complete verdict: %j",
    async (result) => {
      const promise = searchMoves(createBoard(), ["A"]);
      firstWorker().reply(result);
      expect(await promise).toMatchObject({ status: "unavailable" });
      expect(firstWorker().terminate).toHaveBeenCalledTimes(1);
    },
  );
  it("accepts actual scored moves and preserves their blank identity", async () => {
    const promise = searchMoves(createBoard(), ["A", "?"]);
    const result: MoveSearchResult = {
      status: "complete",
      visitedNodes: 900,
      totalMoves: 1,
      moves: [
        {
          key: "07:07:A|07:07:A:0|07:08:T:1",
          score: 2,
          bingo: 0,
          newTileCount: 2,
          placements: [
            { row: 7, col: 7, tile: { letter: "A", blank: false } },
            { row: 7, col: 8, tile: { letter: "T", blank: true } },
          ],
          words: [
            { word: "AT", score: 2, row: 7, col: 7, direction: "across" },
          ],
        },
      ],
    };
    firstWorker().reply(result);
    expect(await promise).toEqual(result);
  });
  it("keeps concurrent calls isolated and cancellation cannot terminate the other search", async () => {
    const controller = new AbortController();
    const first = searchMoves(createBoard(), ["A"], controller.signal);
    const second = searchMoves(createBoard(), ["T"]);
    expect(TestWorker.instances[0].request!.id).not.toBe(
      TestWorker.instances[1].request!.id,
    );
    controller.abort();
    expect(await first).toMatchObject({
      status: "incomplete",
      reason: "cancelled",
    });
    expect(TestWorker.instances[1].terminate).not.toHaveBeenCalled();
    TestWorker.instances[1].reply(completed);
    expect(await second).toEqual(completed);
    expect(TestWorker.instances[1].terminate).toHaveBeenCalledTimes(1);
  });
});

describe("sparse worker-response rejection", () => {
  it("rejects a result with an unpopulated move slot", async () => {
    const promise = searchMoves(createBoard(), ["A"]);
    firstWorker().reply({ ...completed, moves: new Array(1), totalMoves: 1 });
    expect(await promise).toMatchObject({ status: "unavailable" });
    expect(firstWorker().terminate).toHaveBeenCalledTimes(1);
  });
  it.each(["placements", "words"])(
    "rejects a hole in a scored move %s array",
    async (field) => {
      const move = {
        key: "07:07:A|07:07:A:0|07:08:T:0",
        score: 4,
        bingo: 0,
        newTileCount: 2,
        placements: [
          { row: 7, col: 7, tile: { letter: "A", blank: false } },
          { row: 7, col: 8, tile: { letter: "T", blank: false } },
        ],
        words: [{ word: "AT", score: 4, row: 7, col: 7, direction: "across" }],
      };
      if (field === "placements") delete move.placements[1];
      else delete move.words[0];
      const promise = searchMoves(createBoard(), ["A", "T"]);
      firstWorker().reply({ ...completed, moves: [move], totalMoves: 1 });
      expect(await promise).toMatchObject({ status: "unavailable" });
      expect(firstWorker().terminate).toHaveBeenCalledTimes(1);
    },
  );
});

describe("custom supply worker request", () => {
  it("sends the full effective supply without changing request isolation", async () => {
    const board = createBoard();
    const tileSupply = { ...LETTER_COUNTS, Q: 2 };
    const pending = searchMoves(board, ["Q", "Q"], undefined, tileSupply);
    expect(firstWorker().postMessage).toHaveBeenCalledWith({
      id: expect.any(Number),
      board,
      rack: ["Q", "Q"],
      tileSupply,
      lexicon: {
        id: testLexicon.id,
        edition: testLexicon.edition,
        status: testLexicon.status,
      },
    });
    firstWorker().reply(completed);
    expect(await pending).toEqual(completed);
  });
});

describe("pinned game word-reference routing", () => {
  it("sends a game-specific reference without silently replacing it with the old list", async () => {
    const reference = {
      id: "snapshot-words",
      edition: "2026-09-14-sha",
      status: "test" as const,
    };
    const result = searchMoves(
      createBoard(),
      ["B", "O", "T", "H", "E", "R"],
      undefined,
      undefined,
      reference,
    );
    expect(firstWorker().postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ lexicon: reference }),
    );
    firstWorker().reply(completed);
    expect(await result).toEqual(completed);
  });
  it("preserves an unavailable response for an unknown pinned reference", async () => {
    const reference = {
      id: "missing-snapshot",
      edition: "unknown",
      status: "test" as const,
    };
    const pending = searchMoves(
      createBoard(),
      ["A", "T"],
      undefined,
      undefined,
      reference,
    );
    const unavailable = {
      status: "unavailable",
      reason: "Pinned word reference unavailable",
      moves: [],
      visitedNodes: 0,
      totalMoves: 0,
    };
    firstWorker().reply(unavailable);
    expect(await pending).toEqual(unavailable);
    expect(TestWorker.instances).toHaveLength(1);
    expect(firstWorker().postMessage).toHaveBeenCalledTimes(1);
  });
});

describe("verified additions worker routing", () => {
  it("sends the exact verified additions alongside the game's pinned reference", async () => {
    const verifiedWords = [
      {
        word: "ONYX",
        source: "merriam-webster" as const,
        sourceUrl: "https://scrabble.merriam.com/finder/onyx",
        verifiedAt: "2026-09-14T12:00:00.000Z",
      },
    ];
    const promise = searchMoves(
      createBoard(),
      [..."ONYX"],
      undefined,
      undefined,
      testLexicon,
      verifiedWords,
    );
    expect(firstWorker().postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ verifiedWords }),
    );
    firstWorker().reply(completed);
    expect(await promise).toEqual(completed);
  });
});
