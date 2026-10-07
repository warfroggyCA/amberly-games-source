import { describe, expect, it } from "vitest";
import { createGame, type GameState, type GameTurn } from "../src/domain/game";
import { deriveLeadCounts } from "../src/domain/lead-counts";
import { testLexicon } from "../src/lib/test-lexicon";
import { replayFixture } from "./fixtures/replay";

/** Projection-consistent score fixtures isolate accounting from board scoring.
 * The real command-generated correction/undo fixture is tested separately below. */
function scoreGame(
  points: number[],
  count = 2,
  deductions: number[] = [],
): GameState {
  const created = createGame({
    id: "lead-fixture",
    players: Array.from({ length: count }, (_, seat) => ({
      id: String(seat),
      name: `Player ${seat}`,
      seat: seat as 0 | 1 | 2 | 3,
    })),
    firstPlayerId: "0",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!created.ok) throw Error(created.error.message);
  const game = structuredClone(created.game);
  points.forEach((score, index) => {
    const playerId = game.order[index % count];
    game.scores[playerId] += score;
    const turn: GameTurn = {
      id: `t${index}`,
      number: index + 1,
      round: Math.floor(index / count) + 1,
      playerId,
      type: score ? "play" : "pass",
      score,
      words: [],
      source: "human",
      placements: [],
      bingo: false,
      newTileCount: 0,
      runningScores: { ...game.scores },
    };
    game.turns.push(turn);
    game.events.push({
      sequence: index + 1,
      fingerprint: "fixture",
      turn,
      command: score
        ? { id: turn.id, expectedRevision: index, type: "play", placements: [] }
        : { id: turn.id, expectedRevision: index, type: "pass" },
    });
  });
  const final = Object.fromEntries(
    game.order.map((id, index) => [
      id,
      game.scores[id] - (deductions[index] ?? 0),
    ]),
  );
  game.result = {
    reason: "early",
    assisted: false,
    scores: final,
    scoresBeforeAdjustments: { ...game.scores },
    adjustments: Object.fromEntries(
      game.order.map((id, i) => [
        id,
        { deduction: deductions[i] ?? 0, transfer: 0, finalScore: final[id] },
      ]),
    ),
    racks: Object.fromEntries(game.order.map((id) => [id, []])),
    actualBagCount: 0,
    winnerIds: game.order.filter(
      (id) => final[id] === Math.max(...Object.values(final)),
    ),
    unequalTurns: points.length % count !== 0,
    competitiveEligible: false,
    revision: points.length + 1,
  };
  game.events.push({
    sequence: points.length + 1,
    fingerprint: "fixture",
    command: {
      id: "end",
      expectedRevision: points.length,
      type: "finalize",
      reason: "early",
      racks: game.result.racks,
    },
    result: game.result,
  });
  game.revision = game.events.length;
  game.status = "finalized";
  game.currentPlayerId = game.order[points.length % count];
  return game;
}
function available(game: GameState) {
  const result = deriveLeadCounts(game);
  expect(result.available).toBe(true);
  if (!result.available) throw Error(result.reason);
  return result;
}

describe("corrected completed-turn lead counts", () => {
  it("counts each spell once, including its gaining turn and excluding the losing turn", () => {
    const result = available(scoreGame([10, 0, 0, 10, 1, 2, 0]));
    expect(result.completedTurns).toBe(7);
    expect(result.players[0]).toMatchObject({
      entries: 2,
      regains: 1,
      turnsLed: 4,
      longest: 3,
      average: 2,
      coLeadingTurns: 1,
    });
    expect(result.players[0].spells).toEqual([
      { firstTurn: 1, lastTurn: 3, turns: 3, endedBy: "tie" },
      { firstTurn: 5, lastTurn: 5, turns: 1, endedBy: "overtaken" },
    ]);
    expect(result.players[1]).toMatchObject({
      entries: 1,
      regains: 0,
      turnsLed: 2,
      coLeadingTurns: 1,
      longest: 2,
      average: 2,
    });
    expect(result.players[1].spells[0]).toMatchObject({
      firstTurn: 6,
      lastTurn: 7,
      endedBy: "game-ended",
    });
  });
  it.each([2, 3, 4])(
    "counts turns by every participant, not rounds or timer events (%i players)",
    (count) => {
      const game = scoreGame([10, ...Array(count * 2).fill(0)], count);
      const result = available(game);
      expect(result.completedTurns).toBe(count * 2 + 1);
      expect(result.players[0].turnsLed).toBe(count * 2 + 1);
      expect(result.players[0].entries).toBe(1);
      expect(
        result.players
          .slice(1)
          .every((p) => p.entries === 0 && p.average === null),
      ).toBe(true);
    },
  );
  it("does not award all-zero opening passes or empty games a lead", () => {
    for (const points of [[], [0, 0, 0, 0]]) {
      const result = available(scoreGame(points));
      expect(
        result.players.every(
          (p) =>
            p.turnsLed === 0 &&
            p.coLeadingTurns === 0 &&
            p.entries === 0 &&
            p.longest === null &&
            p.average === null,
        ),
      ).toBe(true);
    }
  });
  it("separates co-leading turns for two or more top scorers", () => {
    const result = available(scoreGame([5, 5, 5, 0], 3));
    expect(result.players.map((p) => p.coLeadingTurns)).toEqual([3, 3, 2]);
    expect(result.players.map((p) => p.turnsLed)).toEqual([1, 0, 0]);
  });
  it("counts exchanges as turns without a new lead entry", () => {
    const game = scoreGame([10, 0, 0]);
    const turn = game.turns[1];
    turn.type = "exchange";
    turn.exchangeCount = 2;
    game.events[1].command = {
      id: turn.id,
      expectedRevision: 1,
      type: "exchange",
      count: 2,
    };
    expect(available(game).players[0]).toMatchObject({
      entries: 1,
      turnsLed: 3,
    });
  });
  it("uses final corrected effective turns, excluding undone plays and non-turn events", () => {
    const { game } = replayFixture();
    const result = available(game);
    expect(game.events.length).toBe(7);
    expect(result.completedTurns).toBe(3);
    expect(result.players.find((p) => p.playerId === "doug")).toMatchObject({
      entries: 1,
      turnsLed: 3,
      regains: 0,
    });
    expect(result.players.find((p) => p.playerId === "erin")!.entries).toBe(0);
    // The original journal retains a scored turn that no longer contributes.
    expect(game.events[1].turn!.score).toBeGreaterThan(0);
    expect(game.turns.some((turn) => turn.id === game.events[1].turn!.id)).toBe(
      false,
    );
    expect(game.scores.doug).not.toBe(game.events[0].turn!.score);
  });
  it.each([
    [5, 0],
    [2, 0],
  ])(
    "final adjustments can change to another leader or a tie without adding turns (%j)",
    (deduction) => {
      const game = scoreGame([10, 8], 2, [deduction, 0]);
      const result = available(game);
      expect(result.completedTurns).toBe(2);
      expect(result.finalLeadChanged).toBe(true);
      expect(result.players[0].spells[0].endedBy).toBe("final-adjustment");
      expect(result.players[1].entries).toBe(0);
      expect(result.players[1].turnsLed).toBe(0);
    },
  );
  it("retains a lead through adjustments without inventing another spell", () => {
    const result = available(scoreGame([10, 5], 2, [1, 0]));
    expect(result.finalLeadChanged).toBe(false);
    expect(result.players[0].spells[0].endedBy).toBe("game-ended");
  });
  it("a correction can replace an apparent uninterrupted lead with two spells", () => {
    const game = scoreGame([5, 10, 7]);
    const originallyRecorded = scoreGame([15, 10, 7]);
    for (let i = 0; i < 3; i++)
      game.events[i].turn = originallyRecorded.turns[i];
    game.events.splice(3, 0, {
      sequence: 4,
      fingerprint: "correction",
      command: {
        id: "correct",
        type: "edit-turn",
        expectedRevision: 3,
        turnId: "t0",
        placements: [],
        reason: "Correct score",
      },
      correctedTurns: structuredClone(game.turns),
    });
    game.events[4].sequence = 5;
    game.revision = 5;
    expect(available(game).players[0]).toMatchObject({
      entries: 2,
      regains: 1,
      turnsLed: 2,
    });
    expect(available(originallyRecorded).players[0].entries).toBe(1);
  });
  it("undo erases a regained lead and its turn rather than counting an audit event", () => {
    const game = scoreGame([10, 11]);
    const extra = scoreGame([10, 11, 3]).events[2];
    game.events.splice(2, 0, extra, {
      sequence: 4,
      fingerprint: "undo",
      command: {
        id: "undo",
        type: "undo",
        expectedRevision: 3,
        reason: "Undo last play",
      },
      undoneTurnId: "t2",
    });
    game.events[4].sequence = 5;
    game.revision = 5;
    const result = available(game);
    expect(result.completedTurns).toBe(2);
    expect(result.players[0]).toMatchObject({
      entries: 1,
      regains: 0,
      turnsLed: 1,
    });
    expect(result.players[1].spells[0].endedBy).toBe("game-ended");
  });
  it("reports solo and unfinished records as unavailable", () => {
    const game = scoreGame([10, 5]);
    expect(deriveLeadCounts({ ...game, status: "active" }).available).toBe(
      false,
    );
    expect(deriveLeadCounts({ ...game, mode: "solo" }).available).toBe(false);
  });
  it.each(["missing", "gap", "scores", "running", "order", "adjustment"])(
    "rejects %s evidence instead of reporting fabricated zero counts",
    (kind) => {
      const game = scoreGame([10, 5]);
      if (kind === "missing") game.events = [];
      if (kind === "gap") game.events[0].sequence = 2;
      if (kind === "scores") game.scores["0"]++;
      if (kind === "running") game.turns[0].runningScores["0"]++;
      if (kind === "order") game.order.reverse();
      if (kind === "adjustment") game.result!.adjustments["0"].deduction++;
      expect(deriveLeadCounts(game).available).toBe(false);
    },
  );
  it("is repeatable, independent of names/timestamps, and never changes its source", () => {
    const game = scoreGame([10, 11, 3, 4, 5]);
    const before = structuredClone(game);
    const first = available(game);
    expect(available(game)).toEqual(first);
    expect(game).toEqual(before);
    game.players.forEach((p) => (p.name = "Same archived name"));
    game.events.forEach((e) => (e.command.timedAt = "unreliable"));
    expect(available(game)).toEqual(first);
    first.players[0].spells[0].turns = 999;
    expect(available(game).players[0].spells[0].turns).not.toBe(999);
  });
  it("keeps counting invariants over varied multiplayer score sequences", () => {
    for (const count of [2, 3, 4])
      for (let seed = 0; seed < 20; seed++) {
        const points = Array.from(
          { length: 1 + seed },
          (_, i) => (seed * 7 + i * 11) % 13,
        );
        const result = available(scoreGame(points, count));
        expect(
          result.players.reduce((n, p) => n + p.turnsLed, 0),
        ).toBeLessThanOrEqual(points.length);
        for (const p of result.players) {
          expect(p.spells.reduce((n, s) => n + s.turns, 0)).toBe(p.turnsLed);
          expect(
            p.spells.every((s) => s.turns === s.lastTurn - s.firstTurn + 1),
          ).toBe(true);
          expect(p.regains).toBe(Math.max(0, p.entries - 1));
        }
      }
  });
});
