import { expect, it } from "vitest";
import { gameReplay, hydrateGame } from "../src/domain/game";
import { testLexicon } from "../src/lib/test-lexicon";
import { replayAction, replayFixture } from "./fixtures/replay";

it("later corrections and Undo cannot mutate prior journal snapshots", () => {
  const { snapshots } = replayFixture();
  const prior = snapshots[2];
  const expected = structuredClone(prior);
  const corrected = snapshots[3];
  const undone = snapshots[4];
  expect(corrected.events).not.toBe(prior.events);
  expect(corrected.events[0]).toBe(prior.events[0]);
  expect(undone.events[0]).toBe(prior.events[0]);
  expect(() => {
    Object.assign(corrected.events[0].turn!.placements![0].tile, {
      blank: true,
    });
  }).toThrow(TypeError);
  expect(() => {
    corrected.events[2].correctedTurns![0].score++;
  }).toThrow(TypeError);
  expect(prior).toEqual(expected);
  expect(prior.board[7][7]?.blank).toBe(false);
  expect(corrected.board[7][7]?.blank).toBe(true);
  expect(undone.board[7][10]).toBeNull();
});

it.each([false, true])(
  "isolates mutable nested caller events, including shallow-frozen inputs (%s)",
  (shallowFrozen) => {
    const original = replayFixture().snapshots[2];
    const input = structuredClone(original);
    if (shallowFrozen) input.events.forEach(Object.freeze);
    const next = replayAction(input, { type: "pass" });
    const replay = gameReplay(input)!;
    const restored = hydrateGame(input, testLexicon);
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw Error(restored.error.message);
    const expected = structuredClone(next);
    // A caller still owns these nested objects even when the event is frozen.
    Object.assign(input.events[0].turn!.placements![0].tile, { blank: true });
    input.events[0].turn!.score = 999;
    input.events[0].command.expectedRevision = 999;
    expect(next).toEqual(expected);
    expect(restored.game).toEqual(original);
    expect(replay.at(2)).toEqual(original);
    expect(hydrateGame(input, testLexicon).ok).toBe(false);
    expect(hydrateGame(next, testLexicon).ok).toBe(true);
  },
);
