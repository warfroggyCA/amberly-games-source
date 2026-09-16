import type { Board, Letter, Tile } from "./types";

export const BOARD_SIZE = 15;
export const LETTER_VALUES: Readonly<Record<Letter, number>> = Object.freeze({
  A: 1,
  B: 3,
  C: 3,
  D: 2,
  E: 1,
  F: 4,
  G: 2,
  H: 4,
  I: 1,
  J: 8,
  K: 5,
  L: 1,
  M: 3,
  N: 1,
  O: 1,
  P: 3,
  Q: 10,
  R: 1,
  S: 1,
  T: 1,
  U: 1,
  V: 4,
  W: 4,
  X: 8,
  Y: 4,
  Z: 10,
});
export const LETTER_COUNTS: Readonly<Record<Letter | "?", number>> =
  Object.freeze({
    A: 9,
    B: 2,
    C: 2,
    D: 4,
    E: 12,
    F: 2,
    G: 3,
    H: 2,
    I: 9,
    J: 1,
    K: 1,
    L: 4,
    M: 2,
    N: 6,
    O: 8,
    P: 2,
    Q: 1,
    R: 6,
    S: 4,
    T: 6,
    U: 4,
    V: 2,
    W: 2,
    X: 1,
    Y: 2,
    Z: 1,
    "?": 2,
  });
export type Premium = "TW" | "DW" | "TL" | "DL" | null;

// Canonical standard English board. Coordinates do not change with visual rotation.
const PREMIUM_ROWS = [
  "TW . . DL . . . TW . . . DL . . TW",
  ". DW . . . TL . . . TL . . . DW .",
  ". . DW . . . DL . DL . . . DW . .",
  "DL . . DW . . . DL . . . DW . . DL",
  ". . . . DW . . . . . DW . . . .",
  ". TL . . . TL . . . TL . . . TL .",
  ". . DL . . . DL . DL . . . DL . .",
  "TW . . DL . . . DW . . . DL . . TW",
  ". . DL . . . DL . DL . . . DL . .",
  ". TL . . . TL . . . TL . . . TL .",
  ". . . . DW . . . . . DW . . . .",
  "DL . . DW . . . DL . . . DW . . DL",
  ". . DW . . . DL . DL . . . DW . .",
  ". DW . . . TL . . . TL . . . DW .",
  "TW . . DL . . . TW . . . DL . . TW",
].map((row) =>
  row
    .split(" ")
    .map((cell) => (cell === "." ? null : (cell as Exclude<Premium, null>))),
);

export function isLetter(value: unknown): value is Letter {
  return (
    typeof value === "string" && value.length === 1 && /^[A-Z]$/.test(value)
  );
}
export function isTile(value: unknown): value is Tile {
  return (
    typeof value === "object" &&
    value !== null &&
    "letter" in value &&
    "blank" in value &&
    isLetter(value.letter) &&
    typeof value.blank === "boolean"
  );
}
export function isCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < BOARD_SIZE
  );
}
export function isBoard(value: unknown): value is Board {
  return (
    Array.isArray(value) &&
    value.length === BOARD_SIZE &&
    Array.from(value).every(
      (row: unknown) =>
        Array.isArray(row) &&
        row.length === BOARD_SIZE &&
        Array.from(row).every((tile: unknown) => tile === null || isTile(tile)),
    )
  );
}
export function createBoard(): Board {
  return Object.freeze(
    Array.from({ length: BOARD_SIZE }, () =>
      Object.freeze(Array<Tile | null>(BOARD_SIZE).fill(null)),
    ),
  );
}
export function premiumAt(row: number, col: number): Premium {
  if (!isCoordinate(row) || !isCoordinate(col))
    throw new RangeError("Board coordinates must be integers from 0 to 14.");
  return PREMIUM_ROWS[row][col];
}
export type TileSupply = Readonly<Record<Letter | "?", number>>;
export const MAX_TILE_TOTAL = 200;
/** Complete physical distribution, including missing letters; never unknown tile types. */
export function isTileSupply(value: unknown): value is TileSupply {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Object.keys(value);
    if (
      keys.length !== Object.keys(LETTER_COUNTS).length ||
      Reflect.ownKeys(value).length !== keys.length
    )
      return false;
    let total = 0;
    for (const letter of Object.keys(LETTER_COUNTS)) {
      const property = Object.getOwnPropertyDescriptor(value, letter);
      if (
        !property ||
        !Object.hasOwn(property, "value") ||
        !Number.isSafeInteger(property.value) ||
        property.value < 0 ||
        property.value > MAX_TILE_TOTAL
      )
        return false;
      total += property.value;
    }
    return total >= 1 && total <= MAX_TILE_TOTAL;
  } catch {
    return false;
  }
}
/** Unplayed means all tiles off the board, including tiles on players' racks. */
export function countUnplayed(
  board: Board,
  tileSupply: TileSupply = LETTER_COUNTS,
): Record<string, number> {
  if (!isTileSupply(tileSupply))
    throw new TypeError(
      "The tile supply must be a complete valid physical distribution.",
    );
  if (!isBoard(board))
    throw new TypeError(
      "Expected a 15 by 15 board containing valid tiles or null.",
    );
  const counts: Record<string, number> = { ...tileSupply };
  for (const row of board)
    for (const tile of row)
      if (tile !== null) {
        const physicalLetter = tile.blank ? "?" : tile.letter;
        counts[physicalLetter] -= 1;
        if (counts[physicalLetter] < 0)
          throw new RangeError(
            `The board uses more ${physicalLetter} tiles than the set contains.`,
          );
      }
  return counts;
}
