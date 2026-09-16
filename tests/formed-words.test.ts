import { describe, expect, it, vi } from "vitest";
import { createBoard } from "../src/domain/board";
import { scoreMove } from "../src/domain/scoring";
import type { Board, Letter, Lexicon, Placement } from "../src/domain/types";
import { getFormedWords } from "../src/lib/formed-words";

const tile = (
  letter: Letter,
  row: number,
  col: number,
  blank = false,
): Placement => ({ row, col, tile: { letter, blank } });
const lexicon: Lexicon = {
  id: "outline-tests",
  edition: "1",
  status: "test",
  has: (word) =>
    new Set([
      "AT",
      "TA",
      "CAT",
      "CATS",
      "ON",
      "TON",
      "NOT",
      "TO",
      "SO",
      "AS",
      "QUIZ",
    ]).has(word),
};
function boardWith(placements: Placement[]): Board {
  const board = createBoard().map((row) => [...row]);
  for (const placement of placements)
    board[placement.row][placement.col] = placement.tile;
  return board;
}

describe("complete affected word outlines", () => {
  it("outlines NOTON as invalid and its ON crossing as valid, never its valid TON substring", () => {
    const board = boardWith([
      tile("N", 7, 5),
      tile("O", 7, 6),
      tile("O", 6, 9),
    ]);
    const draft = [tile("T", 7, 7), tile("O", 7, 8), tile("N", 7, 9)];
    const words = getFormedWords(board, draft, lexicon);
    expect(words).toEqual([
      {
        word: "ON",
        row: 6,
        col: 9,
        endRow: 7,
        endCol: 9,
        direction: "down",
        valid: true,
      },
      {
        word: "NOTON",
        row: 7,
        col: 5,
        endRow: 7,
        endCol: 9,
        direction: "across",
        valid: false,
      },
    ]);
    expect(
      words.some((word) => word.word === "TON" || word.word === "NOT"),
    ).toBe(false);
    const score = scoreMove(board, draft, lexicon);
    expect(score).toMatchObject({
      ok: false,
      error: { code: "INVALID_WORD", words: ["NOTON"] },
    });
  });
  it("discovers all three overlapping words and agrees with a valid turn scoring breakdown", () => {
    const board = boardWith([tile("A", 7, 7), tile("T", 7, 8)]);
    const draft = [tile("T", 8, 7), tile("A", 8, 8)];
    const words = getFormedWords(board, draft, lexicon);
    expect(words).toEqual([
      {
        word: "AT",
        row: 7,
        col: 7,
        endRow: 8,
        endCol: 7,
        direction: "down",
        valid: true,
      },
      {
        word: "TA",
        row: 7,
        col: 8,
        endRow: 8,
        endCol: 8,
        direction: "down",
        valid: true,
      },
      {
        word: "TA",
        row: 8,
        col: 7,
        endRow: 8,
        endCol: 8,
        direction: "across",
        valid: true,
      },
    ]);
    const score = scoreMove(board, draft, lexicon);
    expect(score.ok).toBe(true);
    if (score.ok) {
      expect(score.score).toBe(8);
      expect(
        score.words
          .map(
            (word) => `${word.row},${word.col},${word.direction},${word.word}`,
          )
          .sort(),
      ).toEqual(
        words
          .map(
            (word) => `${word.row},${word.col},${word.direction},${word.word}`,
          )
          .sort(),
      );
    }
  });
  it("finds both complete words from one tile without inventing a one-letter main word", () => {
    const board = boardWith([
      tile("A", 7, 7),
      tile("T", 7, 8),
      tile("O", 8, 8),
    ]);
    const words = getFormedWords(board, [tile("S", 8, 7)], lexicon);
    expect(words.map((word) => word.word)).toEqual(["AS", "SO"]);
  });
  it("uses a blank represented letter while preserving the physical blank and zero score", () => {
    const draft = [
      tile("Q", 7, 7),
      tile("U", 7, 8),
      tile("I", 7, 9),
      tile("Z", 7, 10, true),
    ];
    const original = structuredClone(draft);
    expect(getFormedWords(createBoard(), draft, lexicon)).toEqual([
      {
        word: "QUIZ",
        row: 7,
        col: 7,
        endRow: 7,
        endCol: 10,
        direction: "across",
        valid: true,
      },
    ]);
    expect(draft).toEqual(original);
    expect(scoreMove(createBoard(), draft, lexicon)).toMatchObject({
      ok: true,
      score: 24,
    });
  });
  it("checks all existing prefixes and suffixes around a new middle letter", () => {
    const board = boardWith([
      tile("C", 7, 6),
      tile("T", 7, 8),
      tile("S", 7, 9),
    ]);
    expect(getFormedWords(board, [tile("A", 7, 7)], lexicon)).toEqual([
      {
        word: "CATS",
        row: 7,
        col: 6,
        endRow: 7,
        endCol: 9,
        direction: "across",
        valid: true,
      },
    ]);
  });
  it("does not highlight unrelated existing words or one-letter partial input", () => {
    const board = boardWith([
      tile("A", 7, 7),
      tile("T", 7, 8),
      tile("C", 2, 1),
      tile("A", 2, 2),
      tile("T", 2, 3),
    ]);
    expect(
      getFormedWords(board, [tile("S", 7, 9)], lexicon).map(
        (word) => word.word,
      ),
    ).toEqual(["ATS"]);
    expect(getFormedWords(board, [], lexicon)).toEqual([]);
    expect(getFormedWords(createBoard(), [tile("A", 7, 7)], lexicon)).toEqual(
      [],
    );
  });
  it("does not confuse dictionary membership with a legal connected placement", () => {
    const board = boardWith([tile("A", 7, 7), tile("T", 7, 8)]);
    const draft = [tile("C", 0, 0), tile("A", 0, 1), tile("T", 0, 2)];
    expect(getFormedWords(board, draft, lexicon)[0]).toMatchObject({
      word: "CAT",
      valid: true,
    });
    expect(scoreMove(board, draft, lexicon)).toMatchObject({
      ok: false,
      error: { code: "DISCONNECTED" },
    });
  });
  it("has stable ordering regardless of the order in which draft tiles were entered", () => {
    const board = boardWith([tile("A", 7, 7), tile("T", 7, 8)]);
    const draft = [tile("T", 8, 7), tile("A", 8, 8)];
    expect(getFormedWords(board, draft, lexicon)).toEqual(
      getFormedWords(board, [...draft].reverse(), lexicon),
    );
  });
});

describe("safe draft geometry and unavailable word reference", () => {
  it("does not mutate frozen boards or drafts", () => {
    const board = createBoard();
    const draft = Object.freeze([
      Object.freeze(tile("A", 7, 7)),
      Object.freeze(tile("T", 7, 8)),
    ]);
    const before = structuredClone({ board, draft });
    expect(getFormedWords(board, draft, lexicon)).toHaveLength(1);
    expect({ board, draft }).toEqual(before);
  });
  it.each(
    [
      [tile("A", -1, 7)],
      [tile("A", 15, 7)],
      [tile("A", 7.5, 7)],
      [tile("A", 7, 7), tile("T", 7, 7)],
      new Array(2),
      [null],
      [{ row: 7, col: 7, tile: { letter: "é", blank: false } }],
      [{ row: 7, col: 7, tile: { letter: "A\n", blank: false } }],
      [{ row: 7, col: 7, tile: { letter: "A", blank: "false" } }],
    ].map((placements) => ({ placements })),
  )(
    "rejects malformed placements without throwing: $placements",
    ({ placements }) => {
      expect(() =>
        getFormedWords(createBoard(), placements as Placement[], lexicon),
      ).not.toThrow();
      expect(
        getFormedWords(createBoard(), placements as Placement[], lexicon),
      ).toEqual([]);
    },
  );
  it("rejects draft overlap with a committed tile, even when its letter matches", () => {
    expect(
      getFormedWords(
        boardWith([tile("A", 7, 7)]),
        [tile("A", 7, 7), tile("T", 7, 8)],
        lexicon,
      ),
    ).toEqual([]);
  });
  it("rejects missing board cells and malformed board dimensions", () => {
    const missing = createBoard().map((row) => [...row]);
    delete missing[14][14];
    expect(
      getFormedWords(missing, [tile("A", 7, 7), tile("T", 7, 8)], lexicon),
    ).toEqual([]);
    expect(getFormedWords([] as Board, [tile("A", 7, 7)], lexicon)).toEqual([]);
  });
  it("preserves geometric outlines with unavailable verdicts when the dictionary is missing", () => {
    const draft = [tile("A", 7, 7), tile("T", 7, 8)];
    const has = vi.fn(() => true);
    expect(
      getFormedWords(createBoard(), draft, {
        ...lexicon,
        status: "unavailable",
        has,
      })[0],
    ).toMatchObject({ word: "AT", valid: "unavailable" });
    expect(has).not.toHaveBeenCalled();
  });
  it("does not show partially trusted green verdicts if the dictionary fails during a crossing lookup", () => {
    const board = boardWith([tile("A", 7, 7), tile("T", 7, 8)]);
    const has = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockImplementation(() => {
        throw new Error("Unavailable");
      });
    const words = getFormedWords(board, [tile("T", 8, 7), tile("A", 8, 8)], {
      ...lexicon,
      has,
    });
    expect(words).toHaveLength(3);
    expect(words.every((word) => word.valid === "unavailable")).toBe(true);
  });
  it("treats malformed or asynchronous dictionary verdicts as unavailable", () => {
    const draft = [tile("A", 7, 7), tile("T", 7, 8)];
    for (const has of [() => undefined, () => Promise.resolve(true)]) {
      expect(
        getFormedWords(createBoard(), draft, {
          ...lexicon,
          has,
        } as unknown as Lexicon)[0].valid,
      ).toBe("unavailable");
    }
  });
});
