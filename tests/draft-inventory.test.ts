import { describe, expect, it } from "vitest";
import { createBoard, LETTER_COUNTS } from "../src/domain/board";
import type { Letter, Placement } from "../src/domain/types";
import { draftInventory } from "../src/lib/draft-inventory";
import { insertLetters, erasePrevious } from "../src/lib/board-entry";
import type { Draft } from "../src/lib/preview-store";
const tile = (letter: Letter, col: number, blank = false): Placement => ({
  row: 7,
  col,
  tile: { letter, blank },
});
function boardWith(...tiles: Placement[]) {
  const board = createBoard().map((row) => [...row]);
  for (const p of tiles) board[p.row][p.col] = p.tile;
  return board;
}
const draft = (placements: Placement[] = []): Draft => ({
  revision: 1,
  row: 7,
  col: 7,
  direction: "across",
  placements,
});
describe("draft physical tile feedback", () => {
  it("flags a third C while preserving the draft and committed tiles", () => {
    const board = boardWith(tile("C", 4), tile("C", 5));
    const placements = [tile("C", 7)];
    const snapshot = structuredClone({ board, placements });
    expect(draftInventory(board, placements)).toMatchObject({
      remaining: { C: -1 },
      exhausted: placements,
    });
    expect({ board, placements }).toEqual(snapshot);
  });
  it("marks only the excess letter in a multi-letter paste", () => {
    const board = boardWith(tile("C", 4));
    const result = insertLetters(draft(), board, "CCAT", false, 7);
    if (!result.ok) throw new Error(result.message);
    expect(draftInventory(board, result.draft.placements).exhausted).toEqual([
      tile("C", 8),
    ]);
    expect(result.draft.placements).toHaveLength(4);
  });
  it("uses physical blanks instead of their represented letters", () => {
    const board = boardWith(tile("C", 4, true), tile("C", 5));
    expect(draftInventory(board, [tile("C", 7)]).exhausted).toEqual([]);
    expect(draftInventory(board, [tile("C", 7, true)]).remaining).toMatchObject(
      { C: 1, "?": 0 },
    );
    expect(
      draftInventory(board, [tile("C", 7, true), tile("A", 8, true)]).exhausted,
    ).toEqual([tile("A", 8, true)]);
  });
  it("recomputes after replacement, blank correction and backspace", () => {
    const board = boardWith(tile("C", 4), tile("C", 5));
    const d = draft([tile("C", 7)]);
    expect(
      draftInventory(board, erasePrevious(d).placements).exhausted,
    ).toEqual([]);
    const replaced = insertLetters(d, board, "A", false, 7);
    if (!replaced.ok) throw new Error(replaced.message);
    expect(draftInventory(board, replaced.draft.placements).exhausted).toEqual(
      [],
    );
    expect(draftInventory(board, [tile("C", 7, true)]).exhausted).toEqual([]);
  });
  it("honors the game's custom supply", () => {
    const board = boardWith(tile("C", 4), tile("C", 5));
    expect(
      draftInventory(board, [tile("C", 7)], { ...LETTER_COUNTS, C: 3 })
        .exhausted,
    ).toEqual([]);
    expect(LETTER_COUNTS.C).toBe(2);
  });
  it("does not consume a tile for a committed letter reused during entry", () => {
    const board = boardWith(tile("C", 4), tile("C", 7));
    const result = insertLetters(draft(), board, "CAT", false, 7);
    if (!result.ok) throw new Error(result.message);
    expect(result.draft.placements).toEqual([tile("A", 8), tile("T", 9)]);
    expect(draftInventory(board, result.draft.placements).exhausted).toEqual(
      [],
    );
  });
  it("counts every draft tile even when the placement is not yet inline", () => {
    const board = boardWith(tile("C", 4));
    const extra = { ...tile("C", 9), row: 9 };
    expect(draftInventory(board, [tile("C", 7), extra]).exhausted).toEqual([
      extra,
    ]);
  });
  it("rejects corrupt inventory and overlapping placements instead of inventing counts", () => {
    expect(() =>
      draftInventory(boardWith(tile("C", 4), tile("C", 5), tile("C", 6)), []),
    ).toThrow();
    expect(() =>
      draftInventory(boardWith(tile("A", 7)), [tile("C", 7)]),
    ).toThrow();
    expect(() =>
      draftInventory(createBoard(), [tile("C", 7), tile("C", 7)]),
    ).toThrow();
    expect(() =>
      draftInventory(createBoard(), [{ ...tile("C", 7), row: -1 }]),
    ).toThrow();
  });
});
