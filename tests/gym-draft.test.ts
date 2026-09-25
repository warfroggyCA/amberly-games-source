import { describe, it, expect } from "vitest";
import { createBoard } from "../src/domain/board";
import { emptyDraft } from "../src/domain/gym/placement";
import {
  validGymDraft,
  gymDraftKey,
  type GymDraft,
} from "../src/lib/gym-draft";
const fixture = () =>
  ({
    version: 1,
    puzzle: {
      position: {
        board: createBoard(),
        rack: ["A", "A", "T", "E", "R", "S", "?"],
      },
    },
    draft: emptyDraft(["A", "A", "T", "E", "R", "S", "?"]),
    undo: [],
    referenceWords: [],
    hint: 2,
    pointToHint: true,
    reveal: false,
    solutionIndex: 0,
    help: false,
    reducedMotion: false,
    liveCoaching: true,
    petPaused: false,
  }) as unknown as GymDraft;
describe("saved Gym input validation (puzzle trace is separately verified in worker)", () => {
  it("keeps assigned blanks and tile identities", () => {
    const v = fixture();
    v.draft.tiles = [
      { id: 6, row: 1, col: 1, tile: { letter: "Z", blank: true } },
    ];
    expect(validGymDraft(v)).toBe(true);
    v.draft.tiles[0] = {
      ...v.draft.tiles[0],
      tile: { letter: "Z", blank: false },
    };
    expect(validGymDraft(v)).toBe(false);
  });
  it("rejects collisions, invented letters, invalid rack ordering and unknown versions", () => {
    const v = fixture();
    v.draft.tiles = [
      { id: 0, row: 1, col: 1, tile: { letter: "Z", blank: false } },
    ];
    expect(validGymDraft(v)).toBe(false);
    v.draft.tiles[0] = {
      ...v.draft.tiles[0],
      tile: { letter: "A", blank: false },
    };
    v.draft.tiles.push({
      id: 1,
      row: 1,
      col: 1,
      tile: { letter: "A", blank: false },
    });
    expect(validGymDraft(v)).toBe(false);
    const order = fixture();
    order.draft.order[0] = 1;
    expect(validGymDraft(order)).toBe(false);
    expect(validGymDraft({ ...fixture(), version: 2 })).toBe(false);
    expect(validGymDraft(null)).toBe(false);
  });
  it("separates local and signed-in profiles", () => {
    const owner = { userId: "u", familyId: "f", playerId: "p" };
    expect(gymDraftKey(owner)).not.toBe(gymDraftKey());
    expect(gymDraftKey(owner)).not.toBe(
      gymDraftKey({ ...owner, playerId: "q" }),
    );
  });
});
