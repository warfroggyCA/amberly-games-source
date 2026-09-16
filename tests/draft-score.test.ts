import { describe, expect, it } from "vitest";
import { createBoard } from "../src/domain/board";
import { calculateDraftScore, scoreMove } from "../src/domain/scoring";
import type { Letter, Lexicon, Placement } from "../src/domain/types";

const reference: Lexicon = {
  id: "draft-fixture",
  edition: "1",
  status: "test",
  has: (word) => ["QUIZ", "READING", "AT"].includes(word),
};
function tiles(
  word: string,
  row = 7,
  col = 7,
  down = false,
  blanks: number[] = [],
): Placement[] {
  return [...word].map((letter, index) => ({
    row: row + (down ? index : 0),
    col: col + (down ? 0 : index),
    tile: { letter: letter as Letter, blank: blanks.includes(index) },
  }));
}
describe("provisional scoring without approving a turn", () => {
  it.each([false, true])(
    "accrues each QUIZ prefix with direction down=%s, while rejecting incomplete words",
    (down) => {
      const board = createBoard();
      for (const [index, points] of [20, 22, 24, 44].entries()) {
        const draft = tiles("QUIZ".slice(0, index + 1), 7, 7, down);
        expect(calculateDraftScore(board, draft)).toBe(points);
        expect(scoreMove(board, draft, reference).ok).toBe(index === 3);
      }
      expect(board).toEqual(createBoard());
    },
  );
  it("counts a zero-value singleton blank once, and preserves premiums and bingo", () => {
    expect(
      calculateDraftScore(createBoard(), tiles("Q", 7, 7, false, [0])),
    ).toBe(0);
    expect(
      calculateDraftScore(createBoard(), tiles("QUIZ", 7, 7, false, [3])),
    ).toBe(24);
    expect(calculateDraftScore(createBoard(), tiles("READING"))).toBe(70);
    expect(
      calculateDraftScore(createBoard(), tiles("READING", 7, 7, false, [4])),
    ).toBe(66);
  });
  it("includes invalid crosswords and applies a new letter premium to each word", () => {
    const first = scoreMove(createBoard(), tiles("AT"), reference);
    if (!first.ok) throw new Error("Fixture failed");
    const draft = tiles("TZ", 8, 7);
    // TZ across = 21; AT down = 2; TZ down = 21.
    expect(calculateDraftScore(first.board, draft)).toBe(44);
    const validated = scoreMove(first.board, draft, reference);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.error.code).toBe("INVALID_WORD");
    expect(calculateDraftScore(first.board, tiles("S", 7, 9))).toBe(3);
  });
  it("shows arithmetic before the opening reaches the centre, without permitting recording", () => {
    expect(calculateDraftScore(createBoard(), tiles("QU", 7, 5))).toBe(11);
    expect(scoreMove(createBoard(), tiles("QU", 7, 5), reference).ok).toBe(
      false,
    );
  });
  it("keeps invalid geometry and inventory unrecordable even with a numeric preview", () => {
    const draft = [...tiles("Q"), ...tiles("Q", 8, 8)];
    expect(calculateDraftScore(createBoard(), draft)).toBe(40);
    expect(scoreMove(createBoard(), draft, reference).ok).toBe(false);
  });
  it("rejects malformed or overlapping data and returns zero for cleared letters", () => {
    const board = createBoard();
    expect(calculateDraftScore(board, [])).toBe(0);
    expect(
      calculateDraftScore(board, [...tiles("Q"), ...tiles("Q")]),
    ).toBeNull();
    expect(calculateDraftScore(board, tiles("A", 15, 0))).toBeNull();
    expect(calculateDraftScore(board, tiles("ABCDEFGH"))).toBeNull();
    expect(calculateDraftScore(board, new Array(2))).toBeNull();
  });
});
