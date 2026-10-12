import { describe, expect, it } from "vitest";
import { createGame, hydrateGame } from "../src/domain/game";
import {
  coachingPosition,
  rackContinuity,
  parsePrivateRack,
  playedTiles,
  subtractTiles,
  validateReviewRack,
} from "../src/domain/turn-coaching";
import { analyseCoaching } from "../src/domain/coaching-analysis";
import {
  advanceRack,
  completeExchange,
  emptyRackMemory,
} from "../src/lib/private-rack";
import { testLexicon } from "../src/lib/test-lexicon";
import { replayAction, replayCat } from "./fixtures/replay";

export function coachingFixture() {
  const created = createGame({
    id: "coach",
    coaching: true,
    players: [
      { id: "a", name: "Ada", seat: 0 },
      { id: "b", name: "Ben", seat: 2 },
    ],
    firstPlayerId: "a",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!created.ok) throw Error(created.error.message);
  const start = created.game;
  const played = replayAction(start, { type: "play", placements: replayCat });
  return { start, played };
}
describe("original turn coaching", () => {
  it("preserves opt-in without enabling legacy games or changing them", () => {
    const { start, played } = coachingFixture();
    const hydrated = hydrateGame(played, testLexicon);
    expect(hydrated.ok && hydrated.game.definition.coaching).toBe(true);
    expect(
      createGame({ ...start.definition, coaching: "yes" as unknown as boolean })
        .ok,
    ).toBe(false);
    expect(
      coachingPosition(
        { ...played, definition: { ...played.definition, coaching: false } },
        played.turns[0].id,
      ),
    ).toBeNull();
    expect(coachingPosition(start, "future")).toBeNull();
  });
  it("pairs original move and pre-turn board, never corrected score or future tiles", () => {
    const { played } = coachingFixture();
    const original = structuredClone(played);
    const corrected = replayAction(played, {
      type: "edit-turn",
      turnId: played.turns[0].id,
      placements: replayCat.map((p, i) =>
        i === 0 ? { ...p, tile: { ...p.tile, blank: true } } : p,
      ),
      reason: "Physical blank",
    });
    const position = coachingPosition(corrected, played.turns[0].id)!;
    expect(position.board.flat().every((t) => t === null)).toBe(true);
    expect(position.turn).toEqual(played.turns[0]);
    expect(position.turn.score).not.toBe(corrected.turns[0].score);
    expect(position.corrected).toBe(true);
    expect(position).not.toHaveProperty("events");
    expect(position).not.toHaveProperty("racks");
    expect(played).toEqual(original);
    const undone = replayAction(played, { type: "undo", reason: "Challenge" });
    expect(coachingPosition(undone, played.turns[0].id)).toBeNull();
    expect(
      coachingPosition({ ...played, events: [] }, played.turns[0].id),
    ).toBeNull();
  });
  it("checks full original rack and physical blanks", () => {
    const { played } = coachingFixture();
    const p = coachingPosition(played, played.turns[0].id)!;
    expect(() => validateReviewRack(p, [..."CAT"])).toThrow(/all 7/);
    expect(() => validateReviewRack(p, [..."?ATEIRS"])).toThrow(/physical/);
    expect(() => validateReviewRack(p, [..."CATEIRS"])).not.toThrow();
    expect(parsePrivateRack(" a ? t ")).toEqual(["A", "?", "T"]);
    expect(() => parsePrivateRack("ABCDEFGH")).toThrow();
    expect(subtractTiles(["?", "A", "A"], ["?", "A"])).toEqual(["A"]);
    expect(
      playedTiles({
        ...p.turn,
        placements: [{ row: 7, col: 7, tile: { letter: "C", blank: true } }],
      }),
    ).toEqual(["?"]);
  });
  it("certifies distinct tiers only after complete search, despite tied top moves", () => {
    const { played } = coachingFixture();
    const p = coachingPosition(played, played.turns[0].id)!;
    const answer = analyseCoaching(p, [..."CATEIRS"], testLexicon);
    expect(answer.status).toBe("complete");
    expect(answer.best.map((m) => m.score)).toEqual(
      answer.histogram.slice(0, 3).map((b) => b.score),
    );
    expect(answer.histogram[0].count).toBeGreaterThan(1);
    const partial = analyseCoaching(p, [..."CATEIRS"], testLexicon, 1);
    expect(partial.status).toBe("incomplete");
    expect(partial.best).toEqual([]);
  });
});
describe("private in-memory racks", () => {
  it("snapshots before subtraction, applies a refresh once, and keeps refills out", () => {
    const { start, played } = coachingFixture();
    const memory = {
      ...emptyRackMemory(start.revision, start.turns),
      rack: [..."CATEIRS"],
    };
    const next = advanceRack(memory, played.revision, played.turns, "a");
    expect(next.rack).toEqual([..."EIRS"]);
    expect(next.snapshots[played.turns[0].id]).toEqual([..."CATEIRS"]);
    expect(advanceRack(next, played.revision, played.turns, "a")).toBe(next);
    const refilled = { ...next, rack: [...next.rack!, ..."DOG"] };
    expect(refilled.snapshots[played.turns[0].id]).toEqual([..."CATEIRS"]);
    expect(memory.rack).toEqual([..."CATEIRS"]);
    expect(emptyRackMemory(played.revision, played.turns).rack).toBeNull();
  });
  it("requires exchange identities and exact count; unknown history clears tracking", () => {
    const { start } = coachingFixture();
    const exchanged = replayAction(start, { type: "exchange", count: 2 });
    const memory = advanceRack(
      { ...emptyRackMemory(0, []), rack: [..."?ATEIRS"] },
      1,
      exchanged.turns,
      "a",
    );
    expect(() => completeExchange(memory, ["?"], ["A"], 7)).toThrow();
    expect(() => completeExchange(memory, ["Z", "Q"], ["A", "B"], 7)).toThrow();
    const next = completeExchange(memory, ["?", "A"], ["D", "O"], 7);
    expect(next.rack).toEqual([..."TEIRSDO"]);
    expect(next.snapshots[exchanged.turns[0].id]).toEqual([..."?ATEIRS"]);
    const undone = replayAction(exchanged, {
      type: "undo",
      reason: "Challenge",
    });
    const invalid = advanceRack(next, undone.revision, undone.turns, "a");
    expect(invalid.rack).toBeNull();
    expect(invalid.snapshots).toEqual({});
  });
  it("does not save an incomplete rack after a missing refill", () => {
    const { played } = coachingFixture();
    let memory = advanceRack(
      { ...emptyRackMemory(0, []), rack: [..."CATEIRS"] },
      1,
      played.turns,
      "a",
    );
    const other = replayAction(played, { type: "pass" });
    memory = advanceRack(memory, other.revision, other.turns, "a");
    const own = replayAction(other, { type: "pass" });
    memory = advanceRack(memory, own.revision, own.turns, "a");
    expect(memory.snapshots[own.turns.at(-1)!.id]).toBeUndefined();
    expect(memory.rack).toBeNull();
  });
});

it("preserves rack snapshots across timer changes and a finalization batched with a play", () => {
  const { start, played } = coachingFixture();
  const memory = {
    ...emptyRackMemory(0, [], rackContinuity(start)),
    rack: [..."CATEIRS"],
  };
  const finalized = replayAction(played, {
    type: "finalize",
    reason: "early",
    racks: { a: [..."EIRSDOG"], b: [..."AEINORT"] },
  });
  expect(rackContinuity(finalized)).toBe(0);
  const next = advanceRack(
    memory,
    finalized.revision,
    finalized.turns,
    "a",
    rackContinuity(finalized),
    7,
  );
  expect(next.snapshots[played.turns[0].id]).toEqual([..."CATEIRS"]);
  const clock = replayAction(start, {
    type: "start-clock",
    timedAt: "2026-10-12T12:00:00Z",
  });
  const afterClock = advanceRack(
    memory,
    clock.revision,
    clock.turns,
    "a",
    rackContinuity(clock),
    7,
  );
  expect(afterClock.rack).toEqual([..."CATEIRS"]);
  const edited = replayAction(played, {
    type: "edit-turn",
    turnId: played.turns[0].id,
    placements: replayCat.map((p, i) =>
      i === 0 ? { ...p, tile: { ...p.tile, blank: true } } : p,
    ),
    reason: "Blank",
  });
  expect(rackContinuity(edited)).toBe(2);
  expect(
    advanceRack(
      next,
      edited.revision,
      edited.turns,
      "a",
      rackContinuity(edited),
      7,
    ).rack,
  ).toBeNull();
});
it("does not invent a refill for short endgame or played-out racks", () => {
  const { played } = coachingFixture();
  const short = advanceRack(
    { ...emptyRackMemory(0, [], 0), rack: [..."CATE"] },
    1,
    played.turns,
    "a",
    0,
    1,
  );
  expect(short.rack).toEqual(["E"]);
  expect(short.awaitingDraw).toBe(false);
  const out = advanceRack(
    { ...emptyRackMemory(0, [], 0), rack: [..."CAT"] },
    1,
    played.turns,
    "a",
    0,
    0,
  );
  expect(out.rack).toEqual([]);
  expect(out.awaitingDraw).toBe(false);
});

it("uses physical blanks and the historical custom supply without assuming standard tiles", () => {
  const { start, played } = coachingFixture();
  const blankGame = replayAction(start, {
    type: "play",
    placements: replayCat.map((p, i) =>
      i === 0 ? { ...p, tile: { ...p.tile, blank: true } } : p,
    ),
  });
  const blank = coachingPosition(blankGame, blankGame.turns[0].id)!;
  expect(() => validateReviewRack(blank, [..."CATEIRS"])).toThrow();
  expect(analyseCoaching(blank, [..."?ATEIRS"], testLexicon).status).toBe(
    "complete",
  );
  const position = coachingPosition(played, played.turns[0].id)!;
  expect(() => analyseCoaching(position, [..."CATQQQQ"], testLexicon)).toThrow(
    /physical/,
  );
  const custom = { ...position, tileSupply: { ...position.tileSupply, Q: 4 } };
  expect(analyseCoaching(custom, [..."CATQQQQ"], testLexicon).status).toBe(
    "complete",
  );
});

it("does not use final rack counts to invent an intervening refill across missed own turns", () => {
  const { played } = coachingFixture();
  const other = replayAction(played, { type: "pass" });
  const second = replayAction(other, {
    type: "play",
    placements: [{ row: 7, col: 10, tile: { letter: "S", blank: false } }],
  });
  const memory = { ...emptyRackMemory(0, [], 0), rack: [..."CATEIRS"] };
  const next = advanceRack(memory, second.revision, second.turns, "a", 0, 4);
  expect(next.snapshots[played.turns[0].id]).toEqual([..."CATEIRS"]);
  expect(next.snapshots[second.turns.at(-1)!.id]).toBeUndefined();
  expect(next.rack).toBeNull();
});
