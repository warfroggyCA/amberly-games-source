import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBoard,
  LETTER_COUNTS,
  type TileSupply,
} from "../src/domain/board";
import type { MoveSearchResult } from "../src/domain/solver";
import { defaultLexicon } from "../src/lib/lexicons";
import { testLexicon } from "../src/lib/test-lexicon";

const reference = (lexicon: typeof testLexicon) => ({
  id: lexicon.id,
  edition: lexicon.edition,
  status: lexicon.status,
});
async function dispatch(
  lexicon: unknown,
  rack = ["A", "A"],
  tileSupply?: TileSupply,
  verifiedWords?: unknown,
) {
  vi.resetModules();
  let receive: ((event: MessageEvent<unknown>) => void) | undefined;
  const postMessage = vi.fn();
  const addEventListener = vi.fn(
    (_: string, handler: (event: MessageEvent<unknown>) => void) => {
      receive = handler;
    },
  );
  vi.stubGlobal("self", { addEventListener, postMessage });
  await import("../src/lib/solver.worker");
  expect(addEventListener).toHaveBeenCalledWith(
    "message",
    expect.any(Function),
    { once: true },
  );
  receive!({
    data: {
      id: 7,
      board: createBoard(),
      rack,
      lexicon,
      tileSupply,
      verifiedWords,
    },
  } as MessageEvent);
  expect(postMessage).toHaveBeenCalledTimes(1);
  return postMessage.mock.calls[0][0] as {
    id: number;
    result: MoveSearchResult;
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("worker uses the exact game word reference", () => {
  it("finds a new-list word that the historical example list does not contain", async () => {
    const current = await dispatch(reference(defaultLexicon));
    expect(current.id).toBe(7);
    expect(current.result.status).toBe("complete");
    expect(
      current.result.moves.some((move) =>
        move.words.some((word) => word.word === "AA"),
      ),
    ).toBe(true);
    const historical = await dispatch(reference(testLexicon));
    expect(historical.result).toMatchObject({
      status: "complete",
      totalMoves: 0,
      moves: [],
    });
  });
  it("preserves an audited custom tile supply through the worker boundary", async () => {
    const standard = await dispatch(reference(defaultLexicon), [..."QQI"]);
    expect(standard.result.status).toBe("invalid");
    const extended = await dispatch(reference(defaultLexicon), [..."QQI"], {
      ...LETTER_COUNTS,
      Q: 2,
    });
    expect(extended.result.status).toBe("complete");
    expect(
      extended.result.moves.some((move) =>
        move.words.some((word) => word.word === "QI"),
      ),
    ).toBe(true);
  });
  it("includes verified additions in enumeration without changing the pinned base list", async () => {
    const base = await dispatch(reference(testLexicon), [..."ONYX"]);
    expect(
      base.result.moves.some((move) =>
        move.words.some((word) => word.word === "ONYX"),
      ),
    ).toBe(false);
    const verified = [
      {
        word: "ONYX",
        source: "merriam-webster",
        sourceUrl: "https://scrabble.merriam.com/finder/onyx",
        verifiedAt: "2026-09-14T12:00:00.000Z",
      },
    ];
    const added = await dispatch(
      reference(testLexicon),
      [..."ONYX"],
      undefined,
      verified,
    );
    expect(added.result.status).toBe("complete");
    expect(
      added.result.moves.some((move) =>
        move.words.some((word) => word.word === "ONYX"),
      ),
    ).toBe(true);
    const corrupt = await dispatch(
      reference(testLexicon),
      [..."ONYX"],
      undefined,
      [{ ...verified[0], sourceUrl: "https://evil.test" }],
    );
    expect(corrupt.result.status).toBe("unavailable");
    expect(testLexicon.has("ONYX")).toBe(false);
  });
  it.each([
    undefined,
    { ...reference(defaultLexicon), id: "unknown-list" },
    { ...reference(defaultLexicon), edition: "wrong-edition" },
    { ...reference(defaultLexicon), status: "test" },
  ])(
    "does not substitute another word list for an unavailable reference: %j",
    async (lexicon) => {
      const response = await dispatch(lexicon);
      expect(response.result).toMatchObject({
        status: "unavailable",
        moves: [],
        totalMoves: 0,
      });
    },
  );
});
