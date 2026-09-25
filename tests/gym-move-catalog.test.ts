import { describe, it, expect } from "vitest";
import { createBoard } from "../src/domain/board";
import {
  findMoves,
  type ScoredMove,
  type EnumerableLexicon,
} from "../src/domain/solver";
import {
  catalogueMoves,
  describeMove,
  groupMoves,
} from "../src/domain/gym/move-catalog";
import type { Position } from "../src/domain/gym/model";
const words = ["AT", "TA", "CAT", "ACT"];
const lexicon: EnumerableLexicon = {
  id: "catalogue-test",
  edition: "1",
  status: "test",
  words,
  has: (word) => words.includes(word),
};
const position: Position = {
  board: createBoard(),
  rack: ["A", "T", "?"],
  scores: [0, 0],
  opponentCount: 7,
  bagCount: 90,
  passes: 0,
};
describe("complete move catalogue", () => {
  it("retains every physical placement including blanks and groups repeated words", () => {
    const result = catalogueMoves(position, lexicon);
    const expected = findMoves(position.board, position.rack, lexicon, {
      limit: 100000,
    });
    expect(result.complete).toBe(true);
    expect(result.moves.map((m) => m.key).sort()).toEqual(
      expected.moves.map((m) => m.key).sort(),
    );
    expect(result.moves.length).toBeGreaterThan(8);
    expect(
      result.moves.some((m) => m.placements.some((p) => p.tile.blank)),
    ).toBe(true);
    expect(result.moves.map((m) => m.score)).toEqual(
      result.moves.map((m) => m.score).sort((a, b) => b - a),
    );
    const grouped = groupMoves(result.moves);
    expect(grouped.reduce((n, g) => n + g.placements.length, 0)).toBe(
      result.moves.length,
    );
    expect(grouped.some((g) => g.placements.length > 1)).toBe(true);
  });
  it("does not call capped or interrupted results exhaustive", () => {
    expect(catalogueMoves(position, lexicon, 12000, 2000000, 1)).toMatchObject({
      complete: false,
    });
    expect(catalogueMoves(position, lexicon, 12000, 1).complete).toBe(false);
    expect(catalogueMoves(position, lexicon, 0).complete).toBe(false);
  });
});

const paks: ScoredMove = {
  key: "paks",
  score: 24,
  bingo: 0,
  newTileCount: 3,
  placements: [
    { row: 2, col: 9, tile: { letter: "P", blank: false } },
    { row: 3, col: 9, tile: { letter: "A", blank: false } },
    { row: 5, col: 9, tile: { letter: "S", blank: false } },
  ],
  words: [
    { word: "PAKS", row: 2, col: 9, direction: "down", score: 12 },
    { word: "HA", row: 3, col: 8, direction: "across", score: 5 },
    { word: "DEES", row: 5, col: 6, direction: "across", score: 7 },
  ],
};
describe("move names follow the placed tiles", () => {
  it("names PAKS as the vertical play rather than its alphabetical-tie crossword", () => {
    expect(describeMove(paks)).toEqual({
      label: "PAKS",
      arrow: "↓",
      crosswords: paks.words.slice(1),
    });
    expect(groupMoves([paks])[0].word).toBe("PAKS");
  });
  it("names a horizontal play even when its crossword is longer", () => {
    const across: ScoredMove = {
      ...paks,
      placements: paks.placements.map((p) => ({
        ...p,
        row: p.col,
        col: p.row,
      })),
      words: paks.words.map((w, i) => ({
        ...w,
        word: i === 2 ? "LONGER" : w.word,
        row: w.col,
        col: w.row,
        direction: w.direction === "down" ? "across" : "down",
      })),
    };
    expect(describeMove(across).label).toBe("PAKS");
    expect(describeMove(across).arrow).toBe("→");
  });
  it("keeps both axes for one-tile crossings regardless of enumeration order", () => {
    const single = {
      ...paks,
      newTileCount: 1,
      placements: [paks.placements[2]],
      words: [paks.words[0], paks.words[2]],
    };
    expect(describeMove(single)).toEqual({
      label: "DEES + PAKS",
      arrow: "",
      crosswords: [],
    });
    expect(
      describeMove({ ...single, words: [...single.words].reverse() }),
    ).toEqual(describeMove(single));
    expect(describeMove({ ...single, words: [single.words[0]] })).toEqual({
      label: "PAKS",
      arrow: "↓",
      crosswords: [],
    });
  });
});
