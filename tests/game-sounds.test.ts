import { describe, expect, it } from "vitest";
import { soundsForTransition, type SoundFrame } from "../src/lib/game-sounds";
const initial: SoundFrame = {
  id: "one",
  revision: 0,
  status: "active",
  turnIds: [],
  turns: [],
  player: "ada",
  winners: null,
  pendingEnd: false,
  lastPlay: false,
  bingo: false,
};
const played: SoundFrame = {
  ...initial,
  revision: 1,
  turnIds: ["cat"],
  turns: ["saved-cat"],
  player: "ben",
  lastPlay: true,
};
describe("committed game sound transitions", () => {
  it("keeps initial, historical, refreshed and duplicate state silent", () => {
    expect(soundsForTransition(null, played)).toEqual([]);
    expect(soundsForTransition(played, played)).toEqual([]);
    expect(soundsForTransition(played, initial)).toEqual([]);
    expect(soundsForTransition(initial, { ...played, id: "another" })).toEqual(
      [],
    );
  });
  it("plays score then the new turn tone for a saved play", () =>
    expect(soundsForTransition(initial, played)).toEqual(["score", "turn"]));
  it("uses bingo instead of also playing the normal score cue", () =>
    expect(soundsForTransition(initial, { ...played, bingo: true })).toEqual([
      "bingo",
      "turn",
    ]));
  it("does not announce another turn when the game needs to end", () =>
    expect(
      soundsForTransition(initial, { ...played, pendingEnd: true }),
    ).toEqual(["score"]));
  it("does not announce a new player in solo play", () =>
    expect(soundsForTransition(initial, { ...played, player: "ada" })).toEqual([
      "score",
    ]));
  it("keeps passes/exchanges and pause/resume silent", () => {
    expect(
      soundsForTransition(initial, { ...played, lastPlay: false }),
    ).toEqual([]);
    expect(
      soundsForTransition(initial, {
        ...initial,
        revision: 1,
        status: "paused",
      }),
    ).toEqual([]);
    expect(
      soundsForTransition(
        { ...initial, status: "paused" },
        { ...initial, revision: 1 },
      ),
    ).toEqual([]);
  });
  it("keeps corrections and undo silent", () => {
    expect(
      soundsForTransition(played, {
        ...played,
        revision: 2,
        turns: ["corrected"],
      }),
    ).toEqual([]);
    expect(soundsForTransition(played, { ...initial, revision: 2 })).toEqual(
      [],
    );
    expect(
      soundsForTransition(played, {
        ...played,
        revision: 2,
        turnIds: ["cat", "dog"],
        turns: ["corrected", "dog"],
      }),
    ).toEqual([]);
  });
  it("suppresses catch-up, batches and unknown revisions", () => {
    expect(soundsForTransition(initial, { ...played, revision: 4 })).toEqual(
      [],
    );
    expect(
      soundsForTransition(
        { ...initial, revision: -1 },
        { ...played, revision: 0 },
      ),
    ).toEqual([]);
  });
  it("celebrates a final winner only once", () => {
    const end: SoundFrame = {
      ...played,
      revision: 2,
      status: "finalized",
      winners: ["ada"],
    };
    expect(soundsForTransition(played, end)).toEqual(["winner", "crowd"]);
    expect(soundsForTransition(end, { ...end, revision: 3 })).toEqual([]);
    expect(soundsForTransition(null, end)).toEqual([]);
  });
  it("uses the selected tie cue instead of the winner fanfare", () =>
    expect(
      soundsForTransition(played, {
        ...played,
        revision: 2,
        status: "finalized",
        winners: ["ada", "ben"],
      }),
    ).toEqual(["tie"]));
});
