export type Letter =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z";

export interface Tile {
  readonly letter: Letter;
  readonly blank: boolean;
}
export type Board = readonly (readonly (Tile | null)[])[];
/** Zero-based canonical board coordinates: row 0 is the top, column 0 is the left. */
export interface Placement {
  readonly row: number;
  readonly col: number;
  readonly tile: Tile;
}
export type Direction = "across" | "down";
export interface Lexicon {
  readonly id: string;
  readonly edition: string;
  readonly status: "ready" | "unavailable" | "test";
  has(word: string): boolean;
}
export interface ScoredWord {
  readonly word: string;
  readonly score: number;
  readonly row: number;
  readonly col: number;
  readonly direction: Direction;
}
export type MoveResult =
  | {
      ok: true;
      board: Board;
      words: ScoredWord[];
      score: number;
      bingo: number;
      newTileCount: number;
      placements: Placement[];
    }
  | { ok: false; error: { code: string; message: string; words?: string[] } };
