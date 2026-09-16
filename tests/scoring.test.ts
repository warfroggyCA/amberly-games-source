import { describe, expect, it } from "vitest";
import {
  countUnplayed,
  createBoard,
  isLetter,
  LETTER_COUNTS,
  premiumAt,
  isTileSupply,
  type TileSupply,
} from "../src/domain/board";
import { scoreMove } from "../src/domain/scoring";
import type {
  Board,
  Letter,
  Lexicon,
  MoveResult,
  Placement,
} from "../src/domain/types";

// Small, explicit fixture reference; this is not an official dictionary asset.
const reference: Lexicon = {
  id: "scoring-fixtures",
  edition: "test-1",
  status: "test",
  has: (word) =>
    new Set([
      "CAT",
      "QUIZ",
      "CATS",
      "READ",
      "READING",
      "AT",
      "TA",
      "TO",
      "AS",
      "SO",
      "TIC",
      "CREEPER",
      "ETIC",
      "AAA",
      "QQ",
      "ZZ",
      "AB",
    ]).has(word),
};
function place(
  word: string,
  row = 7,
  col = 7,
  blanks: number[] = [],
  direction: "across" | "down" = "across",
): Placement[] {
  return [...word].map((letter, index) => ({
    row: row + (direction === "down" ? index : 0),
    col: col + (direction === "across" ? index : 0),
    tile: { letter: letter as Letter, blank: blanks.includes(index) },
  }));
}
function success(result: MoveResult): Extract<MoveResult, { ok: true }> {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}
function error(result: MoveResult, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}
function played(board: Board, placements: Placement[]) {
  return success(scoreMove(board, placements, reference)).board;
}

describe("independently calculated scoring fixtures", () => {
  it("scores opening CAT: (3 + 1 + 1) × 2 = 10", () => {
    const result = success(scoreMove(createBoard(), place("CAT"), reference));
    expect(result.score).toBe(10);
    expect(result.words).toEqual([
      { word: "CAT", score: 10, row: 7, col: 7, direction: "across" },
    ]);
  });
  it("scores opening QUIZ at 44 and blank Z at 24", () => {
    expect(
      success(scoreMove(createBoard(), place("QUIZ"), reference)).score,
    ).toBe(44);
    const blank = success(
      scoreMove(createBoard(), place("QUIZ", 7, 7, [3]), reference),
    );
    expect(blank.score).toBe(24);
    expect(blank.board[7][10]).toEqual({ letter: "Z", blank: true });
    expect(countUnplayed(blank.board).Z).toBe(1);
    expect(countUnplayed(blank.board)["?"]).toBe(1);
  });
  it("scores CATS extension at 6 without reusing the old centre bonus", () => {
    const board = played(createBoard(), place("CAT"));
    const result = success(scoreMove(board, place("S", 7, 10), reference));
    expect(result.score).toBe(6);
    expect(result.words[0].word).toBe("CATS");
    expect(result.newTileCount).toBe(1);
  });
  it("scores seven newly placed READING at 70, with a separate 50-point bingo", () => {
    const result = success(
      scoreMove(createBoard(), place("READING"), reference),
    );
    expect(result.words[0].score).toBe(20);
    expect(result.bingo).toBe(50);
    expect(result.score).toBe(70);
  });
  it("scores READ + ING at 10; a seven-letter word is not necessarily a bingo", () => {
    const board = played(createBoard(), place("READ"));
    const result = success(scoreMove(board, place("ING", 7, 11), reference));
    expect(result.words[0].word).toBe("READING");
    expect(result.score).toBe(10);
    expect(result.bingo).toBe(0);
    expect(result.newTileCount).toBe(3);
  });
  it("applies a letter premium to zero for a blank I in READING: 16 + 50 = 66", () => {
    expect(
      success(scoreMove(createBoard(), place("READING", 7, 7, [4]), reference))
        .score,
    ).toBe(66);
  });
  it("scores a legal two-blank opening at zero, retaining a placement", () => {
    const result = success(
      scoreMove(createBoard(), place("AT", 7, 7, [0, 1]), reference),
    );
    expect(result.score).toBe(0);
    expect(result.newTileCount).toBe(2);
    expect(result.words).toHaveLength(1);
    expect(countUnplayed(result.board)["?"]).toBe(0);
  });
});

describe("word discovery and connected histories", () => {
  it("discovers the main word and every crossing once, sharing a new DL between words", () => {
    const board = played(createBoard(), place("AT"));
    const result = success(scoreMove(board, place("TA", 8, 7), reference));
    // TA across: 1 + (1×2) = 3; AT down: 1+1 = 2; TA down: 1+(1×2) = 3.
    expect(result.words.map(({ word, score }) => [word, score])).toEqual([
      ["TA", 3],
      ["AT", 2],
      ["TA", 3],
    ]);
    expect(result.score).toBe(8);
  });
  it("scores a single new tile making horizontal and vertical words once each", () => {
    let board = played(createBoard(), place("AT"));
    board = played(board, place("O", 8, 8)); // TO down, new O on DL.
    const result = success(scoreMove(board, place("S", 8, 7), reference));
    expect(result.words.map(({ word, score }) => [word, score])).toEqual([
      ["SO", 2],
      ["AS", 2],
    ]);
    expect(result.score).toBe(4);
  });
  it("multiplies two new double-word squares; crosswords and bingo remain separate", () => {
    let board = played(createBoard(), place("CAT"));
    board = played(board, place("TI", 5, 7, [], "down")); // TIC, sharing the existing C.
    const result = success(scoreMove(board, place("CREEPER", 4, 4), reference));
    // CREEPER = 11×2×2=44. Its E also forms ETIC = 1+1+1+3=6. Seven tiles: +50.
    expect(result.words.map(({ word, score }) => [word, score])).toEqual([
      ["CREEPER", 44],
      ["ETIC", 6],
    ]);
    expect(result.score).toBe(100);
  });
  it("extends before an existing word, discovers the entire word, and leaves the old blank zero", () => {
    const board = played(createBoard(), place("AT", 7, 7, [0]));
    const result = success(scoreMove(board, place("C", 7, 6), reference));
    expect(result.words[0].word).toBe("CAT");
    expect(result.score).toBe(4);
    expect(result.board[7][7]).toEqual({ letter: "A", blank: true });
  });
  it("allows continuity through existing letters without submitting them again", () => {
    let board = played(createBoard(), place("AT", 7, 7, [], "down"));
    const result = success(
      scoreMove(board, [...place("C", 7, 6), ...place("T", 7, 8)], reference),
    );
    expect(result.words[0].word).toBe("CAT");
    expect(result.newTileCount).toBe(2);
    board = result.board;
    expect(countUnplayed(board).T).toBe(4);
  });
  it("reports an invalid crossing even when the main word is valid", () => {
    const board = played(createBoard(), place("AT"));
    const wordReference: Lexicon = {
      ...reference,
      has: (word) => word === "TA",
    };
    const result = scoreMove(board, place("TA", 8, 7), wordReference);
    error(result, "INVALID_WORD");
    if (!result.ok) expect(result.error.words).toEqual(["AT"]);
  });
});

describe("placement rejection", () => {
  it.each([
    ["CENTRE_REQUIRED", place("AT", 0, 0)],
    ["OPENING_TOO_SHORT", place("A")],
    ["EMPTY_PLACEMENT", []],
    ["TOO_MANY_TILES", place("READINGS")],
    ["DUPLICATE_SQUARE", [...place("A"), ...place("T")]],
    ["NOT_IN_LINE", [...place("A"), ...place("T", 8, 8)]],
    ["GAP", [...place("A"), ...place("T", 7, 9)]],
  ] as const)("rejects %s", (code, placements) => {
    error(scoreMove(createBoard(), placements, reference), code);
  });
  it("rejects isolated play and replacement of an old tile (even with an identical tile)", () => {
    const board = played(createBoard(), place("AT"));
    error(scoreMove(board, place("CAT", 0, 0), reference), "DISCONNECTED");
    error(scoreMove(board, place("A"), reference), "OCCUPIED_SQUARE");
  });
  it("rejects too many physical Q, Z, or blank tiles", () => {
    error(
      scoreMove(createBoard(), place("QQ"), reference),
      "INVALID_INVENTORY",
    );
    error(
      scoreMove(createBoard(), place("ZZ"), reference),
      "INVALID_INVENTORY",
    );
    error(
      scoreMove(createBoard(), place("AAA", 7, 7, [0, 1, 2]), reference),
      "INVALID_INVENTORY",
    );
    expect(
      success(scoreMove(createBoard(), place("QQ", 7, 7, [1]), reference))
        .score,
    ).toBe(20);
  });
  it("enforces the late-game rack count independently from the standard maximum", () => {
    error(
      scoreMove(createBoard(), place("CAT"), reference, 2),
      "TOO_MANY_TILES",
    );
    error(scoreMove(createBoard(), place("A"), reference, 0), "TOO_MANY_TILES");
    expect(
      success(scoreMove(createBoard(), place("AT"), reference, 2)).score,
    ).toBe(4);
  });
});

describe("untrusted input and dictionary availability", () => {
  it.each([-1, 8, 1.5, NaN, Infinity, "7", null])(
    "rejects malformed rack size %s",
    (count) => {
      error(
        scoreMove(createBoard(), place("AT"), reference, count as number),
        "INVALID_RACK_COUNT",
      );
    },
  );
  it.each([-1, 15, 7.5, NaN, Infinity, "7", null])(
    "rejects malformed coordinate %s",
    (row) => {
      error(
        scoreMove(
          createBoard(),
          [{ row, col: 7, tile: { letter: "A", blank: false } }] as Placement[],
          reference,
        ),
        "INVALID_PLACEMENT",
      );
    },
  );
  it.each([
    null,
    {},
    [],
    Array(15),
    Array.from({ length: 15 }, () => Array(15)),
    Array.from({ length: 14 }, () => Array(15).fill(null)),
    Array.from({ length: 15 }, () => Array(14).fill(null)),
  ])("rejects malformed boards without throwing", (board) => {
    error(scoreMove(board as Board, place("AT"), reference), "INVALID_BOARD");
  });
  it.each([
    null,
    undefined,
    { letter: "a", blank: false },
    { letter: "AA", blank: false },
    { letter: "É", blank: false },
    { letter: "?", blank: true },
    { letter: "A" },
    { letter: "A", blank: 0 },
    { letter: "A", blank: "false" },
  ])("rejects malformed tiles without normalizing a different word", (tile) => {
    error(
      scoreMove(
        createBoard(),
        [{ row: 7, col: 7, tile }] as Placement[],
        reference,
      ),
      "INVALID_PLACEMENT",
    );
  });
  it("rejects sparse or malformed placement arrays", () => {
    for (const placements of [Array(1), [null], {}, null]) {
      expect(() =>
        scoreMove(createBoard(), placements as Placement[], reference),
      ).not.toThrow();
      expect(
        scoreMove(createBoard(), placements as Placement[], reference).ok,
      ).toBe(false);
    }
  });
  it("reports unavailable reference, thrown failures, and non-boolean verdicts as unavailable", () => {
    for (const lexicon of [
      { ...reference, status: "unavailable" },
      {
        ...reference,
        has: () => {
          throw new Error("Asset corrupt");
        },
      },
      { ...reference, has: () => undefined },
      { ...reference, has: () => Promise.resolve(true) },
      null,
      {},
    ])
      error(
        scoreMove(createBoard(), place("AT"), lexicon as Lexicon),
        "DICTIONARY_UNAVAILABLE",
      );
  });
  it("distinguishes invalid words from unavailable verification", () => {
    const result = scoreMove(createBoard(), place("AB"), {
      ...reference,
      has: () => false,
    });
    error(result, "INVALID_WORD");
    if (!result.ok) expect(result.error.words).toEqual(["AB"]);
  });
  it("rejects an already impossible board inventory", () => {
    const board = createBoard().map((row) => [...row]);
    board[7][7] = { letter: "Q", blank: false };
    board[7][8] = { letter: "Q", blank: false };
    error(scoreMove(board, place("A", 7, 9), reference), "INVALID_INVENTORY");
    expect(() => countUnplayed(board)).toThrow(RangeError);
  });
});

describe("board integrity and conservation", () => {
  it("has the standard 100 physical tiles including two blanks", () => {
    expect(Object.values(LETTER_COUNTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(countUnplayed(createBoard())).toEqual(LETTER_COUNTS);
    expect(LETTER_COUNTS.Q).toBe(1);
    expect(LETTER_COUNTS.Z).toBe(1);
    expect(LETTER_COUNTS["?"]).toBe(2);
  });
  it("contains 8 TW, 17 DW including centre, 12 TL, and 24 DL squares with both-axis symmetry", () => {
    const counts: Record<string, number> = {};
    for (let row = 0; row < 15; row++)
      for (let col = 0; col < 15; col++) {
        const p = premiumAt(row, col);
        if (p) counts[p] = (counts[p] ?? 0) + 1;
        expect(p).toBe(premiumAt(14 - row, col));
        expect(p).toBe(premiumAt(row, 14 - col));
        expect(p).toBe(premiumAt(col, row));
      }
    expect(counts).toEqual({ TW: 8, DL: 24, DW: 17, TL: 12 });
    expect(premiumAt(7, 7)).toBe("DW");
    expect(() => premiumAt(15, 0)).toThrow(RangeError);
    expect(() => premiumAt(1.5, 0)).toThrow(RangeError);
  });
  it("uses fresh rows and preserves all inputs on success or rejection", () => {
    const board = createBoard();
    expect(board[0]).not.toBe(board[1]);
    const placements = place("CAT").reverse();
    const original = structuredClone({ board, placements });
    const result = success(scoreMove(board, placements, reference));
    expect({ board, placements }).toEqual(original);
    expect(result.board).not.toBe(board);
    expect(result.placements[0].col).toBe(7);
    error(
      scoreMove(board, [...placements, ...place("A")], reference),
      "DUPLICATE_SQUARE",
    );
    expect({ board, placements }).toEqual(original);
  });
  it("maintains conservation and exact total through a real connected sequence", () => {
    let board = createBoard();
    let placedCount = 0;
    let total = 0;
    for (const [placements, expected] of [
      [place("AT"), 4],
      [place("O", 8, 8), 3],
      [place("S", 8, 7), 4],
    ] as const) {
      const result = success(scoreMove(board, placements, reference));
      expect(result.score).toBe(expected);
      placedCount += placements.length;
      total += result.score;
      board = result.board;
      expect(
        Object.values(countUnplayed(board)).reduce((a, b) => a + b, 0) +
          placedCount,
      ).toBe(100);
    }
    expect(total).toBe(11);
  });
  it("only accepts a single canonical uppercase tile letter", () => {
    for (const value of ["A", "Z"]) expect(isLetter(value)).toBe(true);
    for (const value of ["a", "AA", "É", "?", "", null, 1, "A\n"])
      expect(isLetter(value)).toBe(false);
  });
});

describe("sparse-array boundary regressions", () => {
  it("rejects a hole in any new-placement position before scoring the other tiles", () => {
    for (const missing of [0, 1, 2]) {
      const placements = place("CAT");
      delete placements[missing];
      expect(placements.length).toBe(3);
      expect(missing in placements).toBe(false);
      let result: MoveResult | undefined;
      expect(() => {
        result = scoreMove(createBoard(), placements, reference);
      }).not.toThrow();
      error(result!, "INVALID_PLACEMENT");
      expect(missing in placements).toBe(false);
    }
  });
  it("rejects entirely sparse rack-sized placements instead of creating an empty bingo", () => {
    const placements = new Array<Placement>(7);
    error(scoreMove(createBoard(), placements, reference), "INVALID_PLACEMENT");
  });
  it("rejects a missing board row even when the remaining rows are otherwise valid", () => {
    const board = createBoard().map((row) => [...row]);
    delete board[14];
    expect(() => scoreMove(board, place("CAT"), reference)).not.toThrow();
    error(scoreMove(board, place("CAT"), reference), "INVALID_BOARD");
    expect(() => countUnplayed(board)).toThrow(TypeError);
  });
  it("rejects a missing square anywhere in an otherwise valid board before map/every operations", () => {
    for (const [row, col] of [
      [0, 0],
      [7, 8],
      [14, 14],
    ]) {
      const board = createBoard().map((line) => [...line]);
      delete board[row][col];
      expect(board[row].length).toBe(15);
      expect(() => scoreMove(board, place("CAT"), reference)).not.toThrow();
      error(scoreMove(board, place("CAT"), reference), "INVALID_BOARD");
      expect(() => countUnplayed(board)).toThrow(TypeError);
    }
  });
});

describe("custom physical supply and complete-word discovery", () => {
  it("scores a confirmed second Q and keeps its physical count separate from blanks", () => {
    const custom = { ...LETTER_COUNTS, Q: 2 };
    const first = success(scoreMove(createBoard(), place("QUIZ"), reference));
    const extra = [
      { row: 6, col: 7, tile: { letter: "Q" as const, blank: false } },
    ];
    const synthetic = { ...reference, has: (word: string) => word === "QQ" };
    error(scoreMove(first.board, extra, synthetic), "INVALID_INVENTORY");
    const second = success(scoreMove(first.board, extra, synthetic, 7, custom));
    expect(second.words).toEqual([
      { word: "QQ", score: 20, row: 6, col: 7, direction: "down" },
    ]);
    expect(countUnplayed(second.board, custom).Q).toBe(0);
    expect(countUnplayed(second.board, custom)["?"]).toBe(2);
    expect(() => countUnplayed(second.board)).toThrow();
    expect(custom.Q).toBe(2);
  });
  it("rejects incomplete, negative, sparse, accessor and excessive custom supply configurations", () => {
    const invalid: unknown[] = [
      { Q: 2 },
      { ...LETTER_COUNTS, Q: -1 },
      { ...LETTER_COUNTS, Q: 102 },
      { ...LETTER_COUNTS, XTRA: 1 },
      new Array(27),
    ];
    const accessor = { ...LETTER_COUNTS };
    Object.defineProperty(accessor, "Q", {
      get() {
        throw new Error("invalid access");
      },
      enumerable: true,
    });
    invalid.push(accessor);
    for (const supply of invalid) {
      expect(isTileSupply(supply)).toBe(false);
      error(
        scoreMove(
          createBoard(),
          place("CAT"),
          reference,
          7,
          supply as TileSupply,
        ),
        "INVALID_TILE_SUPPLY",
      );
    }
  });
  it("validates NOTON when TON touches an existing NO prefix, not isolated TON or ON", () => {
    const board = createBoard().map((row) => [...row]);
    board[5][13] = { letter: "N", blank: false };
    board[6][13] = { letter: "O", blank: false };
    const fixture = {
      ...reference,
      has: (word: string) => ["NO", "TON", "ON"].includes(word),
    };
    const result = scoreMove(board, place("TON", 7, 13, [], "down"), fixture);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_WORD", words: ["NOTON"] },
    });
    expect(board[7][13]).toBeNull();
    const fullReference = {
      ...fixture,
      has: (word: string) => word === "NOTON",
    };
    const full = success(
      scoreMove(board, place("TON", 7, 13, [], "down"), fullReference),
    );
    expect(full.words).toEqual([
      // The last new N is on the N10 triple-letter square.
      { word: "NOTON", score: 7, row: 5, col: 13, direction: "down" },
    ]);
  });
});
