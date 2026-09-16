import { describe, expect, it } from "vitest";
import { createBoard, LETTER_COUNTS } from "../src/domain/board";
import {
  findMoves,
  verifyMoveExists,
  type EnumerableLexicon,
  type ScoredMove,
} from "../src/domain/solver";
import type { Board, Letter, Placement, Tile } from "../src/domain/types";

function lexicon(words: readonly string[]): EnumerableLexicon {
  const values = new Set(words);
  return {
    id: "solver-fixtures",
    edition: "test-only",
    status: "test",
    words,
    has: (word) => values.has(word),
  };
}
function boardWith(
  tiles: readonly [number, number, string, boolean?][],
): Board {
  const board = createBoard().map((row) => [...row]);
  for (const [row, col, letter, blank = false] of tiles)
    board[row][col] = { letter: letter as Letter, blank };
  return board;
}
function physicalKey(placements: readonly Placement[]): string {
  return [...placements]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map(
      ({ row, col, tile }) =>
        `${row},${col},${tile.letter},${tile.blank ? "?" : tile.letter}`,
    )
    .join(";");
}

/** Independent word-position brute force: no trie and no production scoring/validation calls. */
function bruteForce(
  board: Board,
  rack: readonly string[],
  wordList: readonly string[],
): Set<string> {
  const dictionary = new Set(wordList);
  const results = new Set<string>();
  const at = (r: number, c: number): Tile | null =>
    r >= 0 && r < 15 && c >= 0 && c < 15 ? board[r][c] : null;
  const empty = board.flat().every((tile) => tile === null);
  for (const word of dictionary)
    for (const vertical of [false, true]) {
      for (let r = 0; r < 15; r++)
        for (let c = 0; c < 15; c++) {
          const endR = r + (vertical ? word.length - 1 : 0);
          const endC = c + (vertical ? 0 : word.length - 1);
          if (
            endR >= 15 ||
            endC >= 15 ||
            at(r - (vertical ? 1 : 0), c - (vertical ? 0 : 1)) ||
            at(endR + (vertical ? 1 : 0), endC + (vertical ? 0 : 1))
          )
            continue;
          const needs: { row: number; col: number; letter: Letter }[] = [];
          let valid = true;
          for (let offset = 0; offset < word.length; offset++) {
            const row = r + (vertical ? offset : 0);
            const col = c + (vertical ? 0 : offset);
            const letter = word[offset] as Letter;
            if (board[row][col]) {
              if (board[row][col]!.letter !== letter) valid = false;
            } else needs.push({ row, col, letter });
          }
          if (!valid || needs.length === 0 || needs.length > rack.length)
            continue;
          if (empty) {
            if (
              needs.length < 2 ||
              !needs.some((square) => square.row === 7 && square.col === 7)
            )
              continue;
          } else if (
            !needs.some(
              ({ row, col }) =>
                at(row - 1, col) ||
                at(row + 1, col) ||
                at(row, col - 1) ||
                at(row, col + 1),
            )
          )
            continue;
          // Every new square's crossing is checked independently against the fixture set.
          for (const { row, col, letter } of needs) {
            let before = "";
            let after = "";
            if (vertical) {
              for (let x = col - 1; x >= 0 && board[row][x]; x--)
                before = board[row][x]!.letter + before;
              for (let x = col + 1; x < 15 && board[row][x]; x++)
                after += board[row][x]!.letter;
            } else {
              for (let y = row - 1; y >= 0 && board[y][col]; y--)
                before = board[y][col]!.letter + before;
              for (let y = row + 1; y < 15 && board[y][col]; y++)
                after += board[y][col]!.letter;
            }
            if ((before || after) && !dictionary.has(before + letter + after))
              valid = false;
          }
          if (!valid) continue;
          // Enumerate physical rack indices, then deduplicate identical physical placements.
          const used = new Set<number>();
          const placements: Placement[] = [];
          const assign = (index: number) => {
            if (index === needs.length) {
              results.add(physicalKey(placements));
              return;
            }
            const square = needs[index];
            for (let slot = 0; slot < rack.length; slot++) {
              if (
                used.has(slot) ||
                (rack[slot] !== square.letter && rack[slot] !== "?")
              )
                continue;
              used.add(slot);
              placements.push({
                row: square.row,
                col: square.col,
                tile: { letter: square.letter, blank: rack[slot] === "?" },
              });
              assign(index + 1);
              placements.pop();
              used.delete(slot);
            }
          };
          assign(0);
        }
    }
  return results;
}
function completeMoves(
  board: Board,
  rack: readonly string[],
  words: readonly string[],
): ScoredMove[] {
  const result = findMoves(board, rack, lexicon(words), {
    limit: 100_000,
    maxNodes: 2_000_000,
  });
  expect(result.status).toBe("complete");
  expect(result.totalMoves).toBe(result.moves.length);
  return result.moves;
}
function compareWithOracle(
  board: Board,
  rack: readonly string[],
  words: readonly string[],
) {
  const actual = completeMoves(board, rack, words);
  expect(new Set(actual.map((move) => physicalKey(move.placements)))).toEqual(
    bruteForce(board, rack, words),
  );
}

describe("exhaustive supplied-lexicon search", () => {
  it("matches a separate brute-force search on an opening with repeated letters and a blank", () => {
    compareWithOracle(
      createBoard(),
      ["A", "T", "?"],
      ["AT", "TA", "AA", "TAT", "TAA"],
    );
  });

  it("finds extensions, crossings, parallel words, existing blanks, and all physical blank choices", () => {
    const words = [
      "AT",
      "TA",
      "AA",
      "AAT",
      "ATA",
      "TAT",
      "TATA",
      "AAAT",
      "ATAT",
      "AAA",
      "AAAA",
    ];
    compareWithOracle(
      boardWith([
        [7, 7, "A", true],
        [7, 8, "T"],
      ]),
      ["A", "A", "?"],
      words,
    );
    compareWithOracle(
      boardWith([
        [7, 7, "A"],
        [7, 8, "T"],
      ]),
      ["?", "?"],
      words,
    );
  });

  it("matches the reference as deterministic legal fixture positions grow", () => {
    const words = [
      "AT",
      "TA",
      "AA",
      "TT",
      "AAT",
      "ATA",
      "TAT",
      "TAA",
      "AAA",
      "ATT",
      "TTA",
    ];
    let board = boardWith([
      [7, 7, "A"],
      [7, 8, "T"],
    ]);
    for (let step = 0; step < 4; step++) {
      const rack = step % 2 === 0 ? ["A", "T"] : ["A", "A"];
      compareWithOracle(board, rack, words);
      const moves = completeMoves(board, rack, words);
      const selected = moves[(step * 7) % moves.length];
      const next = board.map((row) => [...row]);
      for (const placement of selected.placements)
        next[placement.row][placement.col] = placement.tile;
      board = next;
    }
  });

  it("does not truncate or wrap words at a board edge", () => {
    compareWithOracle(
      boardWith([
        [0, 13, "A"],
        [0, 14, "T"],
      ]),
      ["A", "?"],
      ["AT", "TA", "AA", "ATA", "AAT"],
    );
    compareWithOracle(
      boardWith([
        [13, 0, "A"],
        [14, 0, "T"],
      ]),
      ["A", "?"],
      ["AT", "TA", "AA", "ATA", "AAT"],
    );
  });

  it("deduplicates a single new tile which forms words in both directions", () => {
    const moves = completeMoves(
      boardWith([
        [7, 6, "A"],
        [6, 7, "A"],
      ]),
      ["T"],
      ["AT"],
    );
    const target = moves.filter(
      (move) =>
        move.placements.length === 1 &&
        move.placements[0].row === 7 &&
        move.placements[0].col === 7,
    );
    expect(target).toHaveLength(1);
    expect(target[0].words.map((word) => word.word)).toEqual(["AT", "AT"]);
    expect(target[0].score).toBe(8); // Both AT words use the newly covered centre DW: 4 + 4.
  });

  it("preserves distinct blank placements even when the displayed word is identical", () => {
    const moves = completeMoves(createBoard(), ["A", "?"], ["AA"]);
    const horizontal = moves.filter(
      (move) =>
        move.placements.every((tile) => tile.row === 7) &&
        move.placements[0].col === 6 &&
        move.placements[1].col === 7,
    );
    expect(horizontal).toHaveLength(2);
    expect(
      new Set(
        horizontal.map(
          (move) => move.placements.find((p) => p.tile.blank)!.col,
        ),
      ),
    ).toEqual(new Set([6, 7]));
  });

  it("ranks whole-turn points, then used tiles, then stable keys regardless of input ordering", () => {
    const words = ["AT", "TA", "AA", "TAT", "ATA"];
    const first = completeMoves(createBoard(), ["A", "T", "?"], words);
    const second = completeMoves(
      createBoard(),
      ["?", "T", "A"],
      [...words].reverse(),
    );
    expect(first.map((move) => move.key)).toEqual(
      second.map((move) => move.key),
    );
    for (let index = 1; index < first.length; index++) {
      const prior = first[index - 1];
      const current = first[index];
      expect(prior.score >= current.score).toBe(true);
      if (prior.score === current.score) {
        expect(prior.newTileCount >= current.newTileCount).toBe(true);
        if (prior.newTileCount === current.newTileCount)
          expect(prior.key < current.key).toBe(true);
      }
    }
    const limited = findMoves(createBoard(), ["A", "T", "?"], lexicon(words), {
      limit: 2,
    });
    expect(limited.status).toBe("complete");
    expect(limited.moves).toEqual(first.slice(0, 2));
    expect(limited.totalMoves).toBe(first.length);
  });

  it("adds the bingo only for seven physical rack tiles and retains a known independent score", () => {
    const moves = completeMoves(
      createBoard(),
      ["T", "R", "A", "I", "N", "E", "R"],
      ["TRAINER"],
    );
    const target = moves.find(
      (move) =>
        move.placements[0].row === 7 &&
        move.placements[0].col === 4 &&
        move.placements[6].row === 7 &&
        move.placements[6].col === 10,
    );
    expect(target?.score).toBe(64); // Seven one-point tiles × centre DW + 50.
    expect(target?.bingo).toBe(50);
  });

  it("never mutates board, rack, word array, or previous results", () => {
    const board = boardWith([
      [7, 7, "A"],
      [7, 8, "T"],
    ]);
    const rack = Object.freeze(["A", "?"]);
    const words = Object.freeze(["AT", "TA", "AA", "ATA"]);
    const snapshot = JSON.stringify(board);
    const first = completeMoves(board, rack, words);
    const saved = JSON.stringify(first);
    completeMoves(board, rack, words);
    expect(JSON.stringify(board)).toBe(snapshot);
    expect(JSON.stringify(first)).toBe(saved);
  });
});

describe("honest search status and input boundaries", () => {
  it("certifies no move only after the available search completes", () => {
    const result = findMoves(createBoard(), ["Q"], lexicon(["AT"]));
    expect(result.status).toBe("complete");
    expect(result.totalMoves).toBe(0);
    expect(result.moves).toEqual([]);
  });

  it("a zero budget and an exhausted nonzero budget are incomplete, never no-move proof", () => {
    const zero = findMoves(createBoard(), ["A", "T"], lexicon(["AT"]), {
      maxNodes: 0,
    });
    expect(zero).toMatchObject({
      status: "incomplete",
      reason: "node-budget",
      visitedNodes: 0,
    });
    const small = findMoves(createBoard(), ["A", "T"], lexicon(["AT"]), {
      maxNodes: 1,
    });
    expect(small).toMatchObject({
      status: "incomplete",
      reason: "node-budget",
      visitedNodes: 1,
    });
  });

  it("honours cancellation without calling a cancelled result complete", () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      findMoves(createBoard(), ["A"], lexicon(["AA"]), {
        signal: controller.signal,
      }),
    ).toMatchObject({ status: "incomplete", reason: "cancelled" });
  });

  it("fails closed for unavailable, inconsistent, or throwing dictionaries", () => {
    const words = ["AT"];
    expect(findMoves(createBoard(), ["A", "T"], lexicon([])).status).toBe(
      "unavailable",
    );
    expect(
      findMoves(createBoard(), ["A", "T"], {
        ...lexicon(words),
        status: "unavailable",
      }).status,
    ).toBe("unavailable");
    expect(
      findMoves(createBoard(), ["A", "T"], {
        ...lexicon(words),
        has: () => false,
      }).status,
    ).toBe("unavailable");
    expect(
      findMoves(createBoard(), ["A", "T"], {
        ...lexicon(words),
        has: () => {
          throw new Error("offline");
        },
      }).status,
    ).toBe("unavailable");
  });

  it("rejects malformed boards, racks, impossible global supply, and options", () => {
    const words = lexicon(["AT"]);
    expect(findMoves([] as Board, ["A"], words).status).toBe("invalid");
    expect(findMoves(createBoard(), ["a"], words).status).toBe("invalid");
    expect(findMoves(createBoard(), ["??"], words).status).toBe("invalid");
    expect(findMoves(createBoard(), ["?", "?", "?"], words).status).toBe(
      "invalid",
    );
    expect(
      findMoves(createBoard(), Array<string>(8).fill("E"), words).status,
    ).toBe("invalid");
    expect(findMoves(boardWith([[7, 7, "Q"]]), ["Q"], words).status).toBe(
      "invalid",
    );
    expect(
      findMoves(createBoard(), ["A"], words, { maxNodes: -1 }).status,
    ).toBe("invalid");
    expect(
      findMoves(createBoard(), ["A"], words, { maxNodes: Infinity }).status,
    ).toBe("invalid");
    expect(findMoves(createBoard(), ["A"], words, { limit: 0 }).status).toBe(
      "invalid",
    );
    expect(findMoves(createBoard(), ["A"], words, { limit: 1.5 }).status).toBe(
      "invalid",
    );
  });

  it("rejects words outside the supplied-asset alphabet and 2–15 letter coverage", () => {
    for (const bad of ["A", "at", "CAFÉ", "A".repeat(16), "AT\n"]) {
      expect(findMoves(createBoard(), ["A", "T"], lexicon([bad])).status).toBe(
        "invalid",
      );
    }
  });
});

describe("custom supply move generation", () => {
  it("uses custom Q supply for rack checks and final candidate scoring", () => {
    const board = boardWith([
      [7, 7, "Q"],
      [7, 8, "A"],
      [7, 9, "T"],
    ]);
    const reference = lexicon(["QAT"]);
    expect(findMoves(board, ["Q", "T"], reference).status).toBe("invalid");
    const result = findMoves(board, ["Q", "T"], reference, {
      tileSupply: { ...LETTER_COUNTS, Q: 2 },
      limit: 1000,
    });
    expect(result.status).toBe("complete");
    expect(result.totalMoves).toBeGreaterThan(0);
    expect(
      result.moves.some(
        (move) =>
          move.score === 23 &&
          move.placements.some(
            (p) => p.row === 6 && p.col === 8 && p.tile.letter === "Q",
          ),
      ),
    ).toBe(true);
  });
});

describe("bounded legal-move existence checks", () => {
  it("returns a scored witness without pretending it searched for the highest move", () => {
    const reference = lexicon([
      "AT",
      "CAT",
      "CATS",
      "AS",
      "SAT",
      "ACT",
      "ACTS",
    ]);
    const board = createBoard();
    const exists = verifyMoveExists(board, [..."CATS"], reference);
    const exhaustive = findMoves(board, [..."CATS"], reference);
    expect(exists.status).toBe("found");
    expect(exhaustive.status).toBe("complete");
    if (exists.status === "found") {
      expect(exhaustive.moves.length).toBeGreaterThan(0);
      expect(exists.visitedNodes).toBeLessThan(exhaustive.visitedNodes);
      expect(exists.move.words.every((word) => reference.has(word.word))).toBe(
        true,
      );
    }
  });
  it("returns none only after completing an empty legal search", () => {
    expect(
      verifyMoveExists(createBoard(), ["Q"], lexicon(["AT"])),
    ).toMatchObject({ status: "none" });
    expect(verifyMoveExists(createBoard(), [], lexicon(["AT"]))).toMatchObject({
      status: "none",
      visitedNodes: 0,
    });
  });
  it("keeps exhausted, cancelled, unavailable, and invalid outcomes distinct from none", () => {
    const reference = lexicon(["AT"]);
    expect(
      verifyMoveExists(createBoard(), ["A", "T"], reference, { maxNodes: 0 }),
    ).toMatchObject({ status: "incomplete", reason: "node-budget" });
    const controller = new AbortController();
    controller.abort();
    expect(
      verifyMoveExists(createBoard(), ["A", "T"], reference, {
        signal: controller.signal,
      }),
    ).toMatchObject({ status: "incomplete", reason: "cancelled" });
    expect(
      verifyMoveExists(createBoard(), ["A", "T"], {
        ...reference,
        status: "unavailable",
      }),
    ).toMatchObject({ status: "unavailable" });
    expect(
      verifyMoveExists(createBoard(), ["?", "?", "?"], reference),
    ).toMatchObject({ status: "invalid" });
  });
});

describe("safe immutable lexicon reuse", () => {
  it("does not cache a mutable word array, even when its containing object is frozen", () => {
    const words = ["AT"];
    const reference = Object.freeze({
      ...lexicon(words),
      words,
      has: (word: string) => words.includes(word),
    });
    expect(findMoves(createBoard(), [..."QI"], reference).totalMoves).toBe(0);
    words.push("QI");
    expect(
      findMoves(createBoard(), [..."QI"], reference).totalMoves,
    ).toBeGreaterThan(0);
  });
  it("revalidates mutable references instead of trusting a previous lookup", () => {
    const reference = lexicon(["AT"]);
    expect(findMoves(createBoard(), [..."AT"], reference).status).toBe(
      "complete",
    );
    reference.has = () => false;
    expect(findMoves(createBoard(), [..."AT"], reference).status).toBe(
      "unavailable",
    );
  });
  it("still revalidates returned candidates against a frozen reference's lookup", () => {
    let available = true;
    const reference = Object.freeze({
      ...lexicon(["AT"]),
      words: Object.freeze(["AT"]),
      has: () => available,
    });
    expect(findMoves(createBoard(), [..."AT"], reference).status).toBe(
      "complete",
    );
    available = false;
    expect(findMoves(createBoard(), [..."AT"], reference).status).toBe(
      "unavailable",
    );
  });
  it("rejects newline-terminated assets rather than treating a control character as a tile", () => {
    expect(findMoves(createBoard(), [..."AT"], lexicon(["AT\n"])).status).toBe(
      "invalid",
    );
  });
});
