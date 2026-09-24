import { describe, expect, it } from "vitest";
import { createBoard } from "../src/domain/board";
import {
  clearTiles,
  emptyDraft,
  placeTile,
  returnTile,
  selectSquare,
  shuffledOrder,
  undoTile,
} from "../src/domain/gym/placement";
import type { Physical } from "../src/domain/gym/model";
import type { Tile } from "../src/domain/types";
const rack: Physical[] = ["A", "A", "T", "E", "R", "S", "?"];
const board = createBoard();
describe("Gym owned-tile placement controls", () => {
  it("selects the start and toggles across/down with successive taps", () => {
    let d = selectSquare(emptyDraft(rack), board, { row: 7, col: 7 });
    expect(d.direction).toBe("across");
    d = selectSquare(d, board, { row: 7, col: 7 });
    expect(d.direction).toBe("down");
    d = selectSquare(d, board, { row: 7, col: 7 });
    expect(d.direction).toBe("across");
    d = placeTile(d, board, rack, 0);
    d = placeTile(d, board, rack, 1);
    expect(d.tiles.map((t) => [t.row, t.col, t.id])).toEqual([
      [7, 7, 0],
      [7, 8, 1],
    ]);
    expect(d.cursor).toEqual({ row: 7, col: 9 });
    expect(() => placeTile(d, board, rack, 0)).toThrow("already");
  });
  it("skips fixed letters and stops at the board edge without wrapping", () => {
    const fixed: (Tile | null)[][] = board.map((row) => [...row]);
    fixed[7][13] = { letter: "S", blank: false };
    let d = selectSquare(emptyDraft(rack), fixed, { row: 7, col: 12 });
    d = placeTile(d, fixed, rack, 0);
    expect(d.cursor).toEqual({ row: 7, col: 14 });
    d = placeTile(d, fixed, rack, 1);
    expect(d.cursor).toBeNull();
    expect(() => placeTile(d, fixed, rack, 2)).toThrow("Tap an empty");
    expect(clearTiles(d).cursor).toBeNull();
    expect(fixed[7][13]?.letter).toBe("S");
  });
  it("returns one physical tile per undo, retaining insertion direction and rack order", () => {
    let d = selectSquare(emptyDraft(rack), board, { row: 3, col: 3 });
    d = placeTile(d, board, rack, 0);
    d = placeTile(d, board, rack, 1);
    d = placeTile(d, board, rack, 2);
    d = returnTile(d, 1);
    d = undoTile(d);
    expect(d.tiles.map((t) => t.id)).toEqual([0]);
    expect(d.cursor).toEqual({ row: 3, col: 5 });
    d = undoTile(d);
    expect(d.tiles).toEqual([]);
    expect(d.cursor).toEqual({ row: 3, col: 3 });
    expect(d.order).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(undoTile(d)).toEqual(d);
  });
  it("moves a draft tile without duplicating its placement order or losing ownership", () => {
    let d = selectSquare(emptyDraft(rack), board, { row: 4, col: 4 });
    d = placeTile(d, board, rack, 0);
    d = placeTile(d, board, rack, 1);
    d = placeTile(d, board, rack, 0, undefined, { row: 4, col: 6 });
    expect(d.tiles.map((t) => t.id)).toEqual([0, 1]);
    expect(() =>
      placeTile(d, board, rack, 0, undefined, { row: 4, col: 5 }),
    ).toThrow("occupied");
    d = undoTile(d);
    expect(d.tiles[0]).toMatchObject({ id: 0, row: 4, col: 6 });
  });
  it("keeps blanks unconsumed until assigned and clears their assignment on return", () => {
    let d = selectSquare(emptyDraft(rack), board, { row: 7, col: 7 });
    expect(() => placeTile(d, board, rack, 6)).toThrow("blank");
    expect(d.tiles).toEqual([]);
    d = placeTile(d, board, rack, 6, "Z");
    expect(d.tiles[0].tile).toEqual({ letter: "Z", blank: true });
    d = undoTile(d);
    expect(() => placeTile(d, board, rack, 6)).toThrow("blank");
    d = placeTile(d, board, rack, 6, "Q");
    d = clearTiles(d);
    expect(d.tiles).toEqual([]);
    expect(rack[6]).toBe("?");
  });
  it("retargets and toggles without silently rearranging placed letters", () => {
    let d = selectSquare(emptyDraft(rack), board, { row: 7, col: 7 });
    d = placeTile(d, board, rack, 0);
    const original = d.tiles;
    d = selectSquare(d, board, { row: 8, col: 7 });
    expect(d.direction).toBe("down");
    d = selectSquare(d, board, { row: 8, col: 7 });
    expect(d.direction).toBe("across");
    d = selectSquare(d, board, { row: 8, col: 7 });
    expect(d.direction).toBe("down");
    expect(d.tiles).toEqual(original);
    d = placeTile(d, board, rack, 2);
    expect(d.cursor).toEqual({ row: 9, col: 7 });
    const resumed = JSON.parse(JSON.stringify(d));
    expect(undoTile(resumed)).toEqual(undoTile(d));
    expect(clearTiles(d)).toMatchObject({
      tiles: [],
      direction: "across",
      cursor: null,
      start: null,
      manualDirection: false,
    });
  });
});

it("infers edge direction but preserves manual overrides and an established line", () => {
  let d = selectSquare(emptyDraft(rack), board, { row: 5, col: 14 });
  expect(d.direction).toBe("down");
  d = placeTile(d, board, rack, 0);
  expect(d.cursor).toEqual({ row: 6, col: 14 });
  let manual = selectSquare(emptyDraft(rack), board, { row: 5, col: 14 });
  manual = selectSquare(manual, board, { row: 5, col: 14 });
  expect(manual.direction).toBe("across");
  expect(placeTile(manual, board, rack, 0).cursor).toBeNull();
  let line = selectSquare(emptyDraft(rack), board, { row: 5, col: 13 });
  line = placeTile(line, board, rack, 0);
  line = placeTile(line, board, rack, 1);
  expect(line.direction).toBe("across");
  expect(line.cursor).toBeNull();
});
it("infers a line from dragged tiles and nearby board letters", () => {
  let d = placeTile(emptyDraft(rack), board, rack, 0, undefined, {
    row: 4,
    col: 14,
  });
  expect(d.direction).toBe("down");
  d = placeTile(d, board, rack, 1, undefined, { row: 5, col: 14 });
  expect(d.cursor).toEqual({ row: 6, col: 14 });
  const fixed = createBoard().map((row) => [...row]);
  fixed[3][4] = { letter: "S", blank: false };
  expect(
    selectSquare(emptyDraft(rack), fixed, { row: 4, col: 4 }).direction,
  ).toBe("down");
});
it("Fisher-Yates can produce all orders without losing or duplicating physical IDs", () => {
  const permutations = new Set<string>();
  const original = [0, 1, 2];
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 2; b++) {
      const values = [(a + 0.1) / 3, (b + 0.1) / 2];
      const result = shuffledOrder(original, () => values.shift()!);
      permutations.add(result.join());
      expect([...result].sort()).toEqual(original);
    }
  expect(permutations.size).toBe(6);
  expect(original).toEqual([0, 1, 2]);
  expect(() => shuffledOrder(original, () => 1)).toThrow("Invalid random");
});

it("retargeting below a TENANTS hook releases the old manual direction and follows SKY", () => {
  const fixed = createBoard().map((row) => [...row]);
  for (const [col, letter] of [..."TENANT"].entries())
    fixed[5][col + 1] = { letter: letter as Tile["letter"], blank: false };
  const letters: Physical[] = ["S", "K", "Y"];
  let d = selectSquare(emptyDraft(letters), fixed, { row: 5, col: 7 });
  d = { ...d, manualDirection: true, direction: "across" };
  d = placeTile(d, fixed, letters, 0);
  d = selectSquare(d, fixed, { row: 6, col: 7 });
  expect(d.manualDirection).toBe(false);
  d = placeTile(d, fixed, letters, 1);
  d = placeTile(d, fixed, letters, 2);
  expect(d.direction).toBe("down");
  expect(d.cursor).toEqual({ row: 8, col: 7 });
  const cleared = clearTiles(d);
  expect(cleared).toMatchObject({
    tiles: [],
    start: null,
    cursor: null,
    manualDirection: false,
  });
  expect(() => placeTile(cleared, fixed, letters, 0)).toThrow("choose where");
});
