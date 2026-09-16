import { describe, expect, it } from "vitest";
import { createBoard } from "../src/domain/board";
import type { Board, Letter, Placement } from "../src/domain/types";
import {
  canSelectDraftSquare,
  FINISH_WORD_MESSAGE,
  erasePrevious,
  eraseSelected,
  inferDirection,
  insertLetters,
  type InsertResult,
} from "../src/lib/board-entry";
import type { Draft } from "../src/lib/preview-store";

type EdgeDraft = Draft & { atEdge?: boolean };
const draft = (overrides: Partial<EdgeDraft> = {}): EdgeDraft => ({
  revision: 3,
  placements: [],
  row: 7,
  col: 7,
  direction: "across",
  ...overrides,
});
const tile = (
  letter: Letter,
  row: number,
  col: number,
  blank = false,
): Placement => ({ row, col, tile: { letter, blank } });
function success(result: InsertResult): EdgeDraft {
  if (!result.ok) throw new Error(result.message);
  return result.draft as EdgeDraft;
}
function withTiles(placements: Placement[]): Board {
  const board = createBoard().map((row) => [...row]);
  for (const placement of placements)
    board[placement.row][placement.col] = placement.tile;
  return board;
}

describe("atomic board letter entry", () => {
  it("normalizes ASCII case and accepts repeated letters across the final two columns", () => {
    const result = success(
      insertLetters(draft({ col: 13 }), createBoard(), "oo", false, 7),
    );
    expect(result.placements).toEqual([tile("O", 7, 13), tile("O", 7, 14)]);
    expect(result).toMatchObject({
      revision: 3,
      row: 7,
      col: 14,
      atEdge: true,
    });
  });
  it("handles repeated rapid input calls from their latest draft state, without overwriting the last square", () => {
    const first = success(
      insertLetters(draft({ col: 13 }), createBoard(), "O", false, 7),
    );
    const second = success(insertLetters(first, createBoard(), "O", false, 7));
    expect(second.placements).toHaveLength(2);
    expect(insertLetters(second, createBoard(), "N", false, 7).ok).toBe(false);
    expect(second.placements[1].tile.letter).toBe("O");
  });
  it("advances down to the final row and keeps the caret on that row once full", () => {
    const result = success(
      insertLetters(
        draft({ direction: "down", row: 13, col: 13 }),
        createBoard(),
        "oo",
        false,
        7,
      ),
    );
    expect(result.placements).toEqual([tile("O", 13, 13), tile("O", 14, 13)]);
    expect(result).toMatchObject({ row: 14, col: 13, atEdge: true });
  });
  it("rejects a complete paste past the edge without committing its prefix", () => {
    const before = draft({ col: 13, placements: [tile("C", 7, 12)] });
    const snapshot = structuredClone(before);
    expect(insertLetters(before, createBoard(), "OON", false, 7).ok).toBe(
      false,
    );
    expect(before).toEqual(snapshot);
    expect(
      insertLetters(
        draft({ direction: "down", row: 14 }),
        createBoard(),
        "AT",
        false,
        7,
      ).ok,
    ).toBe(false);
  });
  it("does not mutate or share mutable output placements with an input draft", () => {
    const before = draft({ placements: [tile("C", 7, 6)] });
    Object.freeze(before.placements[0].tile);
    Object.freeze(before.placements[0]);
    Object.freeze(before.placements);
    Object.freeze(before);
    const result = success(
      insertLetters(before, createBoard(), "at", false, 7),
    );
    expect(before.placements).toEqual([tile("C", 7, 6)]);
    expect(result.placements[0]).not.toBe(before.placements[0]);
    expect(result.placements[0].tile).not.toBe(before.placements[0].tile);
  });
  it("rejects unsupported characters, empty data, and uppercase expansions without silently changing words", () => {
    for (const text of [
      "",
      "A T",
      "A\nT",
      "CAT\n",
      "CAT.",
      "É",
      "ß",
      "ﬀ",
      "🙂",
      "?",
    ]) {
      expect(
        insertLetters(draft(), createBoard(), text, false, 7).ok,
        text,
      ).toBe(false);
    }
  });
  it("checks the new-tile rack limit and rejects overflow atomically", () => {
    const before = draft();
    expect(insertLetters(before, createBoard(), "CATS", false, 3).ok).toBe(
      false,
    );
    expect(before.placements).toHaveLength(0);
    expect(insertLetters(before, createBoard(), "A", false, 0).ok).toBe(false);
    expect(insertLetters(before, createBoard(), "A", false, 8).ok).toBe(false);
  });
  it("replaces a draft tile selected explicitly without consuming an additional rack tile", () => {
    const before = draft({ placements: [tile("A", 7, 7)] });
    const result = success(insertLetters(before, createBoard(), "Z", true, 1));
    expect(result.placements).toEqual([tile("Z", 7, 7, true)]);
    expect(before.placements[0].tile).toEqual({ letter: "A", blank: false });
  });
  it("types through matching committed letters and only adds the extension", () => {
    const board = withTiles([
      tile("C", 7, 7),
      tile("A", 7, 8),
      tile("T", 7, 9),
    ]);
    const result = success(insertLetters(draft(), board, "cats", false, 1));
    expect(result.placements).toEqual([tile("S", 7, 10)]);
    expect(result).toMatchObject({ row: 7, col: 11, atEdge: false });
    expect(board[7][7]).toEqual({ letter: "C", blank: false });
  });
  it("requires matching committed letters and rejects even a matching blank replacement", () => {
    const board = withTiles([tile("C", 7, 7), tile("A", 7, 8, true)]);
    expect(insertLetters(draft(), board, "CAT", false, 1).ok).toBe(true);
    expect(insertLetters(draft(), board, "CAR", false, 1).ok).toBe(true);
    expect(insertLetters(draft(), board, "CO", false, 7).ok).toBe(false);
    expect(insertLetters(draft(), board, "C", true, 7).ok).toBe(false);
    expect(insertLetters(draft({ col: 8 }), board, "A", true, 7).ok).toBe(
      false,
    );
    expect(board[7][8]!.blank).toBe(true);
  });
  it("allows typing through committed letters with no rack tiles and rejects draft overlap with the board", () => {
    const board = withTiles([tile("C", 7, 7)]);
    expect(
      success(insertLetters(draft(), board, "C", false, 0)).placements,
    ).toHaveLength(0);
    expect(
      insertLetters(
        draft({ placements: [tile("C", 7, 7)] }),
        board,
        "C",
        false,
        7,
      ).ok,
    ).toBe(false);
  });
  it("requires one represented letter for a blank and preserves its physical identity", () => {
    expect(insertLetters(draft(), createBoard(), "AB", true, 7).ok).toBe(false);
    expect(
      success(insertLetters(draft(), createBoard(), "q", true, 7)).placements,
    ).toEqual([tile("Q", 7, 7, true)]);
  });
  it("can proceed after the UI explicitly selects another square and clears edge state", () => {
    const atEdge = success(
      insertLetters(draft({ col: 14 }), createBoard(), "A", false, 7),
    );
    const selected = { ...atEdge, row: 7, col: 13, atEdge: false };
    expect(
      success(insertLetters(selected, createBoard(), "T", false, 7)).placements,
    ).toEqual([tile("A", 7, 14), tile("T", 7, 13)]);
  });
});

describe("board entry backspace", () => {
  it("erases a selected downward blank and lets the scorer replace it in place", () => {
    const before = draft({
      row: 8,
      col: 7,
      direction: "down",
      placements: [tile("C", 7, 7), tile("A", 8, 7, true), tile("T", 9, 7)],
    });
    const after = erasePrevious(before);
    expect(after).toMatchObject({ row: 8, col: 7, atEdge: false });
    expect(after.placements).toEqual([tile("C", 7, 7), tile("T", 9, 7)]);
    expect(
      success(insertLetters(after, createBoard(), "O", false, 7)).placements,
    ).toContainEqual(tile("O", 8, 7));
    expect(before.placements[1].tile.blank).toBe(true);
  });
  it("removes the edge tile first, then the preceding draft tile", () => {
    const full = success(
      insertLetters(draft({ col: 13 }), createBoard(), "OO", false, 7),
    );
    const one = erasePrevious(full) as EdgeDraft;
    expect(one).toMatchObject({ col: 14, atEdge: false });
    expect(one.placements).toEqual([tile("O", 7, 13)]);
    const none = erasePrevious(one) as EdgeDraft;
    expect(none.col).toBe(13);
    expect(none.placements).toEqual([]);
    expect(full.placements).toHaveLength(2);
  });
  it("allows replacing the edge tile immediately after deleting it", () => {
    const full = success(
      insertLetters(draft({ col: 14 }), createBoard(), "O", false, 7),
    );
    const erased = erasePrevious(full);
    expect(
      success(insertLetters(erased, createBoard(), "N", false, 7)).placements,
    ).toEqual([tile("N", 7, 14)]);
  });
  it("moves upward when deleting downward input and keeps horizontal position", () => {
    const full = success(
      insertLetters(
        draft({ row: 12, col: 13, direction: "down" }),
        createBoard(),
        "AT",
        false,
        7,
      ),
    );
    const result = erasePrevious(full) as EdgeDraft;
    expect(result).toMatchObject({ row: 13, col: 13, atEdge: false });
    expect(result.placements).toEqual([tile("A", 12, 13)]);
  });
  it("moves over committed letters without deleting a different draft placement", () => {
    const before = draft({ col: 10, placements: [tile("S", 7, 11)] });
    const result = erasePrevious(before);
    expect(result.col).toBe(9);
    expect(result.placements).toEqual([tile("S", 7, 11)]);
  });
  it("deletes a selected origin tile without wrapping at the beginning of a row or column", () => {
    const across = erasePrevious(
      draft({ col: 0, placements: [tile("A", 7, 0)] }),
    );
    expect(across.col).toBe(0);
    expect(across.placements).toHaveLength(0);
    const down = erasePrevious(
      draft({ row: 0, direction: "down", placements: [tile("A", 0, 7)] }),
    );
    expect(down.row).toBe(0);
    expect(down.placements).toHaveLength(0);
  });
});

describe("Delete only removes the selected new letter", () => {
  it("deletes the selected middle letter without shifting or moving the other letters", () => {
    const before = draft({
      col: 8,
      placements: [tile("C", 7, 7), tile("A", 7, 8), tile("T", 7, 9)],
    });
    const after = eraseSelected(before);
    expect(after).toMatchObject({ row: 7, col: 8, atEdge: false });
    expect(after.placements).toEqual([tile("C", 7, 7), tile("T", 7, 9)]);
    expect(before.placements).toHaveLength(3);
    expect(
      success(insertLetters(after, createBoard(), "O", false, 7)).placements,
    ).toContainEqual(tile("O", 7, 8));
  });
  it("does not remove a neighbour when the selected square is empty or committed", () => {
    const before = draft({
      col: 8,
      placements: [tile("C", 7, 7), tile("T", 7, 9)],
    });
    expect(eraseSelected(before).placements).toEqual(before.placements);
    expect(eraseSelected(before).col).toBe(8);
    const board = withTiles([tile("A", 7, 8)]);
    expect(board[7][8]).toEqual({ letter: "A", blank: false });
    expect(
      success(insertLetters(eraseSelected(before), board, "A", false, 7))
        .placements,
    ).toEqual(before.placements);
  });
  it("deletes a selected blank at the board edge and permits its replacement", () => {
    const before = draft({
      row: 14,
      col: 3,
      direction: "down",
      atEdge: true,
      placements: [tile("Z", 14, 3, true)],
    });
    const after = eraseSelected(before);
    expect(after).toMatchObject({
      row: 14,
      col: 3,
      atEdge: false,
      placements: [],
    });
    expect(
      success(insertLetters(after, createBoard(), "A", false, 7)).placements,
    ).toEqual([tile("A", 14, 3)]);
  });
  it("both keys delete a selected letter; only Backspace moves backward from the resulting empty square", () => {
    const before = draft({
      col: 8,
      placements: [tile("C", 7, 7), tile("A", 7, 8), tile("T", 7, 9)],
    });
    const backspaced = erasePrevious(before);
    expect(backspaced.col).toBe(8);
    expect(backspaced.placements).toEqual([tile("C", 7, 7), tile("T", 7, 9)]);
    expect(erasePrevious(backspaced).placements).toEqual([tile("T", 7, 9)]);
    expect(eraseSelected(backspaced).placements).toEqual(backspaced.placements);
    expect(before.placements).toHaveLength(3);
    expect(eraseSelected(before).placements).toEqual([
      tile("C", 7, 7),
      tile("T", 7, 9),
    ]);
  });
});

describe("automatic board direction", () => {
  it("recognizes a horizontal prefix or extension even with an occupied square to the right", () => {
    const board = withTiles([tile("A", 7, 8), tile("T", 7, 9)]);
    const inferred = inferDirection(board, 7, 7, "down");
    expect(inferred).toBe("across");
    const result = success(
      insertLetters(draft({ direction: inferred }), board, "CAT", false, 7),
    );
    expect(result.placements).toEqual([tile("C", 7, 7)]);
    expect(inferDirection(board, 7, 10, "down")).toBe("across");
  });
  it("recognizes a vertical prefix or extension with an occupied square below or above", () => {
    const board = withTiles([tile("A", 8, 7), tile("T", 9, 7)]);
    expect(inferDirection(board, 7, 7, "across")).toBe("down");
    expect(inferDirection(board, 10, 7, "across")).toBe("down");
  });
  it("preserves the current choice when both axes connect, or neither has evidence", () => {
    const crossing = withTiles([tile("A", 7, 8), tile("T", 8, 7)]);
    expect(inferDirection(crossing, 7, 7, "down")).toBe("down");
    expect(inferDirection(crossing, 7, 7, "across")).toBe("across");
    expect(inferDirection(createBoard(), 7, 7, "down")).toBe("down");
  });
  it("keeps the draft axis stable instead of switching toward a new crossword neighbour", () => {
    const board = withTiles([tile("T", 8, 9)]);
    expect(
      inferDirection(board, 7, 9, "down", [tile("C", 7, 7), tile("A", 7, 8)]),
    ).toBe("across");
    expect(
      inferDirection(board, 9, 7, "across", [tile("C", 7, 7), tile("A", 8, 7)]),
    ).toBe("down");
  });
  it("supports an explicit contrary direction while protecting committed letters", () => {
    const board = withTiles([tile("A", 7, 8), tile("T", 7, 9)]);
    expect(inferDirection(board, 7, 7, "across")).toBe("across");
    const chosen = success(
      insertLetters(draft({ direction: "down" }), board, "TO", false, 7),
    );
    expect(chosen.placements).toEqual([tile("T", 7, 7), tile("O", 8, 7)]);
    expect(board[7][8]).toEqual({ letter: "A", blank: false });
  });
  it("rejects malformed direction evidence safely without changing the fallback", () => {
    expect(inferDirection(createBoard(), -1, 7, "down")).toBe("down");
    expect(inferDirection(createBoard(), 7, 7, "down", new Array(2))).toBe(
      "down",
    );
  });
});

describe("one word at a time", () => {
  const cat = () =>
    success(insertLetters(draft(), createBoard(), "CAT", false, 7));
  it("blocks a second word elsewhere and preserves the whole current word", () => {
    const original = cat();
    const before = structuredClone(original);
    for (const [row, col] of [
      [3, 3],
      [7, 12],
      [8, 9],
      [8, 7],
    ]) {
      expect(canSelectDraftSquare(original, createBoard(), row, col)).toBe(
        false,
      );
      expect(
        insertLetters(
          { ...original, row, col },
          createBoard(),
          "CONE",
          false,
          7,
        ),
      ).toEqual({ ok: false, message: FINISH_WORD_MESSAGE });
    }
    expect(original).toEqual(before);
  });
  it("allows correction, either end of the same line, and refilling a deleted gap", () => {
    const original = cat();
    for (const col of [6, 7, 8, 9, 10])
      expect(canSelectDraftSquare(original, createBoard(), 7, col)).toBe(true);
    const gap = eraseSelected({ ...original, col: 8 });
    expect(canSelectDraftSquare(gap, createBoard(), 7, 8)).toBe(true);
    expect(
      success(insertLetters(gap, createBoard(), "O", false, 7)).placements,
    ).toContainEqual(tile("O", 7, 8));
    expect(
      success(insertLetters(original, createBoard(), "S", false, 7)).placements,
    ).toContainEqual(tile("S", 7, 10));
  });
  it("allows a same-line committed bridge, but never a bridge through an empty square", () => {
    const initial = draft({ placements: [tile("C", 7, 7)] });
    const board = withTiles([tile("A", 7, 8), tile("T", 7, 9)]);
    expect(canSelectDraftSquare(initial, board, 7, 10)).toBe(true);
    expect(
      success(insertLetters({ ...initial, col: 10 }, board, "S", false, 7))
        .placements,
    ).toEqual([tile("C", 7, 7), tile("S", 7, 10)]);
    expect(canSelectDraftSquare(initial, board, 7, 11)).toBe(false);
    expect(canSelectDraftSquare(initial, board, 8, 9)).toBe(false);
    expect(
      canSelectDraftSquare(initial, withTiles([tile("T", 7, 9)]), 7, 10),
    ).toBe(false);
  });
  it("locks a vertical word to its column while allowing prefixes and committed bridges", () => {
    const current = success(
      insertLetters(
        draft({ direction: "down" }),
        createBoard(),
        "CAT",
        false,
        7,
      ),
    );
    const board = withTiles([tile("S", 10, 7)]);
    for (const row of [6, 7, 8, 9, 10, 11])
      expect(canSelectDraftSquare(current, board, row, 7)).toBe(true);
    expect(canSelectDraftSquare(current, board, 12, 7)).toBe(false);
    expect(canSelectDraftSquare(current, board, 9, 8)).toBe(false);
  });
  it("allows either axis after one tile, but rejects changing axis once a line is established", () => {
    const first = draft({ placements: [tile("C", 7, 7)] });
    expect(canSelectDraftSquare(first, createBoard(), 8, 7)).toBe(true);
    expect(canSelectDraftSquare(first, createBoard(), 7, 8)).toBe(true);
    const before = { ...cat(), row: 7, col: 8, direction: "down" as const };
    expect(insertLetters(before, createBoard(), "ON", false, 7)).toEqual({
      ok: false,
      message: FINISH_WORD_MESSAGE,
    });
    expect(before.placements).toContainEqual(tile("A", 7, 8));
  });
  it("unlocks a new location after clearing without forbidding committed-word cross plays", () => {
    const cleared = { ...cat(), placements: [], row: 3, col: 3 };
    expect(canSelectDraftSquare(cleared, createBoard(), 3, 3)).toBe(true);
    expect(
      success(insertLetters(cleared, createBoard(), "CONE", false, 7))
        .placements,
    ).toHaveLength(4);
    const board = withTiles([tile("A", 7, 7), tile("T", 7, 8)]);
    expect(
      success(
        insertLetters(
          draft({ row: 6, direction: "down" }),
          board,
          "CAT",
          false,
          7,
        ),
      ).placements,
    ).toEqual([tile("C", 6, 7), tile("T", 8, 7)]);
  });
  it("allows repairing an old disconnected draft without silently deleting it", () => {
    const old = draft({ placements: [tile("C", 7, 7), tile("O", 3, 3)] });
    expect(canSelectDraftSquare(old, createBoard(), 3, 3)).toBe(true);
    expect(canSelectDraftSquare(old, createBoard(), 7, 8)).toBe(false);
    expect(eraseSelected({ ...old, row: 3, col: 3 }).placements).toEqual([
      tile("C", 7, 7),
    ]);
    expect(old.placements).toHaveLength(2);
  });
  it("rejects malformed cursor destinations", () => {
    expect(canSelectDraftSquare(draft(), createBoard(), -1, 7)).toBe(false);
    expect(canSelectDraftSquare(draft(), createBoard(), 7, 15)).toBe(false);
    expect(canSelectDraftSquare(draft(), createBoard(), NaN, 7)).toBe(false);
  });
});
