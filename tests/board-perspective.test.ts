import { describe, expect, it } from "vitest";
import {
  boardArrowStep,
  boardDirectionArrow,
  boardPerspective,
  displayedSeat,
} from "../src/lib/board-perspective";

describe("viewer-local board perspective", () => {
  const players = [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, seat }));
  it.each(players)(
    "puts $id at the bottom without changing any seats",
    (viewer) => {
      const before = structuredClone(players);
      const turns = boardPerspective(players, viewer.id);
      expect(displayedSeat(viewer.seat, turns)).toBe(2);
      expect(players).toEqual(before);
      // The clockwise relationship between neighbours stays intact.
      for (const player of players)
        expect(displayedSeat((player.seat + 1) % 4, turns)).toBe(
          (displayedSeat(player.seat, turns) + 1) % 4,
        );
    },
  );
  it("keeps the canonical view for guests and nonparticipants", () => {
    expect(boardPerspective(players)).toBe(0);
    expect(boardPerspective(players, "not-seated")).toBe(0);
  });
  it("shows entry direction arrows in the viewer's orientation", () => {
    expect([0, 1, 2, 3].map((q) => boardDirectionArrow("across", q))).toEqual([
      "→",
      "↓",
      "←",
      "↑",
    ]);
    expect([0, 1, 2, 3].map((q) => boardDirectionArrow("down", q))).toEqual([
      "↓",
      "←",
      "↑",
      "→",
    ]);
  });
  it.each([0, 1, 2, 3])(
    "maps visual arrows back to canonical at rotation %i",
    (turns) => {
      for (const [key, expected] of [
        ["ArrowRight", [0, 1]],
        ["ArrowDown", [1, 0]],
        ["ArrowLeft", [0, -1]],
        ["ArrowUp", [-1, 0]],
      ] as const) {
        let { row, col } = boardArrowStep(key, turns);
        // Rotate the canonical step back into the visual grid.
        for (let n = 0; n < turns; n++) [row, col] = [col, -row];
        expect([row || 0, col || 0]).toEqual(expected);
      }
    },
  );
});
