import { describe, expect, it, vi } from "vitest";
import {
  applyCrokinoleCommand,
  colourForeground,
  calculateRoundAwards,
  createCrokinoleGame,
  createCrokinoleRematch,
  DEFAULT_PIECE_COLOURS,
  getStartingPlayer,
  hydrateCrokinoleGame,
  isCrokinoleDefinition,
  isCrokinoleCommand,
  previewCrokinoleCorrection,
  restoreDefaultColours,
  validateDefinition,
  type CrokinoleDefinition,
  type CrokinoleGame,
} from "../src/domain/crokinole";
const date = "2026-09-17T12:00:00.000Z";
function definition(count = 2, doubles = false): CrokinoleDefinition {
  const players = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i + 1}`,
    seatOrder: i,
  }));
  const groups = doubles
    ? [
        [0, 2],
        [1, 3],
      ]
    : players.map((_, i) => [i]);
  return {
    schemaVersion: 1,
    rulesVersion: 1,
    id: "match",
    familyId: "family",
    mode: "confirmed",
    createdAt: date,
    players,
    participants: groups.map((ids, i) => ({
      id: doubles ? `team${i}` : `p${i}`,
      name: ids.map((n) => players[n].name).join(" & "),
      playerIds: ids.map((n) => players[n].id),
      colour: {
        id: DEFAULT_PIECE_COLOURS[i].id,
        name: DEFAULT_PIECE_COLOURS[i].name,
        value: DEFAULT_PIECE_COLOURS[i].value,
      },
    })),
    format: doubles ? "doubles" : count === 2 ? "singles" : "free_for_all",
    scoringMode: "cumulative_round_totals",
    endCondition: { type: "fixed_rounds", rounds: 4 },
    initialStartingPlayerId: "p0",
  };
}
function entries(game: CrokinoleGame, scores: number[]) {
  return scores.map((rawScore, i) => ({
    participantId: game.definition.participants[i].id,
    rawScore,
  }));
}
function record(game: CrokinoleGame, scores: number[]) {
  return applyCrokinoleCommand(game, {
    type: "record_round",
    id: `cmd${game.revision}`,
    expectedRevision: game.revision,
    roundId: `round${game.revision}`,
    entries: entries(game, scores),
  });
}
describe("Crokinole calculations", () => {
  it.each([
    [65, 40, 25, 0],
    [40, 65, 0, 25],
    [45, 45, 0, 0],
    [0, 0, 0, 0],
  ])("traditional %i-%i awards %i-%i", (a, b, x, y) =>
    expect(
      calculateRoundAwards("traditional_differential", [
        { participantId: "a", rawScore: a },
        { participantId: "b", rawScore: b },
      ]),
    ).toEqual({ a: x, b: y }),
  );
  it.each([
    [65, 40, 2, 0],
    [40, 65, 0, 2],
    [0, 0, 1, 1],
  ])("NCA %i-%i awards %i-%i", (a, b, x, y) =>
    expect(
      calculateRoundAwards("nca_match_points", [
        { participantId: "a", rawScore: a },
        { participantId: "b", rawScore: b },
      ]),
    ).toEqual({ a: x, b: y }),
  );
  it.each([
    [2, false],
    [3, false],
    [4, false],
    [4, true],
  ] as const)("cumulative %i players doubles=%s", (count, doubles) => {
    let game = createCrokinoleGame(definition(count, doubles));
    const scores = game.definition.participants.map((_, i) => i * 5 + 5);
    game = record(record(game, scores), scores);
    expect(Object.values(game.totals)).toEqual(scores.map((n) => n * 2));
  });
  it("fixed rounds do not end at a big lead, tied result after full count", () => {
    let game = createCrokinoleGame({
      ...definition(),
      endCondition: { type: "fixed_rounds", rounds: 2 },
    });
    game = record(game, [200, 0]);
    expect(game.status).toBe("active");
    game = record(game, [0, 200]);
    expect(game.result?.tied).toBe(true);
    expect(game.result?.winnerIds).toEqual(["p0", "p1"]);
  });
  it.each([100, 105])("target reached or exceeded at %i", (score) => {
    const game = record(
      createCrokinoleGame({
        ...definition(),
        endCondition: { type: "target", target: 100 },
      }),
      [score, 50],
    );
    expect(game.result?.winnerIds).toEqual(["p0"]);
  });
  it("simultaneous target crossing chooses highest and NCA target ties are ties", () => {
    let game = record(
      createCrokinoleGame({
        ...definition(),
        endCondition: { type: "target", target: 100 },
      }),
      [105, 110],
    );
    expect(game.result?.winnerIds).toEqual(["p1"]);
    game = createCrokinoleGame({
      ...definition(),
      scoringMode: "nca_match_points",
      endCondition: { type: "target", target: 5 },
    });
    for (let i = 0; i < 5; i++) game = record(game, [0, 0]);
    expect(game.result?.tied).toBe(true);
  });
  it("clockwise doubles starter visits every player and rematch rotates", () => {
    const def = definition(4, true);
    expect([0, 1, 2, 3, 4].map((i) => getStartingPlayer(def, i).id)).toEqual([
      "p0",
      "p1",
      "p2",
      "p3",
      "p0",
    ]);
    const game = record(createCrokinoleGame(def), [10, 20]);
    const rematch = createCrokinoleRematch(game, "new", date);
    expect(rematch.definition.initialStartingPlayerId).toBe("p1");
    expect(rematch.rounds).toHaveLength(0);
    expect(game.rounds).toHaveLength(1);
  });
});
describe("journal and corrections", () => {
  it("recalculates every later total, keeps original event, and replays", () => {
    const initial = createCrokinoleGame(definition());
    const game = record(record(initial, [10, 20]), [30, 40]);
    const fixed = applyCrokinoleCommand(game, {
      id: "fix",
      expectedRevision: 2,
      type: "correct_round",
      roundId: "round0",
      entries: entries(game, [50, 0]),
      excludedRoundIds: [],
    });
    expect(fixed.rounds[1].totals).toEqual({ p0: 80, p1: 40 });
    expect(game.rounds[0].entries[0].rawScore).toBe(10);
    expect(fixed.events[0].command).toEqual(game.events[0].command);
    expect(hydrateCrokinoleGame(fixed.definition, fixed.events)).toEqual(fixed);
  });
  it("requires exact explicit excluded tail after earlier win, with no mutation on failure", () => {
    let game = createCrokinoleGame({
      ...definition(),
      endCondition: { type: "target", target: 100 },
    });
    game = record(record(game, [10, 20]), [10, 20]);
    const scores = entries(game, [100, 0]);
    expect(
      previewCrokinoleCorrection(game, "round0", scores).excludedRoundIds,
    ).toEqual(["round1"]);
    const command = {
      id: "fix",
      expectedRevision: 2,
      type: "correct_round" as const,
      roundId: "round0",
      entries: scores,
      excludedRoundIds: [],
    };
    expect(() => applyCrokinoleCommand(game, command)).toThrow(/exact later/);
    expect(game.rounds).toHaveLength(2);
    const fixed = applyCrokinoleCommand(game, {
      ...command,
      excludedRoundIds: ["round1"],
    });
    expect(fixed.rounds).toHaveLength(1);
    expect(fixed.events).toHaveLength(3);
    expect(fixed.status).toBe("completed");
  });
  it("completed correction and undo require reason and can reopen", () => {
    const game = record(
      createCrokinoleGame({
        ...definition(),
        endCondition: { type: "target", target: 100 },
      }),
      [100, 10],
    );
    const command = {
      id: "fix",
      expectedRevision: 1,
      type: "correct_round" as const,
      roundId: "round0",
      entries: entries(game, [5, 10]),
      excludedRoundIds: [],
    };
    expect(() => applyCrokinoleCommand(game, command)).toThrow(/reason/);
    const corrected = applyCrokinoleCommand(game, {
      ...command,
      reason: "Typo",
    });
    expect(corrected.status).toBe("active");
    const undone = applyCrokinoleCommand(game, {
      id: "undo",
      expectedRevision: 1,
      type: "undo_round",
      reason: "Wrong round",
    });
    expect(undone.status).toBe("active");
    expect(undone.totals).toEqual({ p0: 0, p1: 0 });
  });
  it("end early retains scores with no normal winner", () => {
    const game = record(createCrokinoleGame(definition()), [30, 10]);
    const ended = applyCrokinoleCommand(game, {
      id: "end",
      expectedRevision: 1,
      type: "end_early",
      reason: "Dinner",
    });
    expect(ended.status).toBe("ended_early");
    expect(ended.result).toBeNull();
    expect(ended.totals).toEqual(game.totals);
    expect(() => record(ended, [5, 5])).toThrow(/ended/);
  });
  it("retries same command idempotently, refuses modified ID and competing revision", () => {
    const initial = createCrokinoleGame(definition());
    const game = record(initial, [10, 20]);
    expect(applyCrokinoleCommand(game, game.events[0].command)).toEqual(game);
    expect(() =>
      applyCrokinoleCommand(game, {
        ...game.events[0].command,
        type: "record_round",
        roundId: "other",
        entries: entries(game, [5, 5]),
      }),
    ).toThrow(/different input/);
    expect(() =>
      applyCrokinoleCommand(game, {
        id: "new",
        type: "undo_round",
        expectedRevision: 0,
      }),
    ).toThrow(/changed/);
  });
  it("rejects forged result, sequence and reused round IDs", () => {
    const game = record(createCrokinoleGame(definition()), [10, 20]);
    expect(() =>
      hydrateCrokinoleGame(game.definition, [
        { ...game.events[0], sequence: 2 },
      ]),
    ).toThrow();
    expect(() =>
      hydrateCrokinoleGame(game.definition, [
        { ...game.events[0], result: { winnerIds: ["p0"] } },
      ]),
    ).toThrow();
    const undone = applyCrokinoleCommand(game, {
      id: "undo",
      expectedRevision: 1,
      type: "undo_round",
    });
    expect(() =>
      applyCrokinoleCommand(undone, {
        id: "new",
        expectedRevision: 2,
        type: "record_round",
        roundId: "round0",
        entries: entries(game, [5, 5]),
      }),
    ).toThrow(/new ID/);
  });
  it("high scores require explicit acknowledgement; safe sums reject overflow", () => {
    const game = createCrokinoleGame(definition());
    const command = {
      id: "huge",
      expectedRevision: 0,
      type: "record_round" as const,
      roundId: "huge",
      entries: entries(game, [245, 0]),
    };
    expect(() => applyCrokinoleCommand(game, command)).toThrow(/Confirm/);
    expect(
      applyCrokinoleCommand(game, { ...command, acknowledgedHighScores: true })
        .totals.p0,
    ).toBe(245);
    const max = 9007199254740990;
    const large = applyCrokinoleCommand(game, {
      ...command,
      entries: entries(game, [max, 0]),
      acknowledgedHighScores: true,
    });
    expect(() => record(large, [5, 0])).toThrow(/too large/);
  });
});
describe("configuration and malformed data", () => {
  it.each([
    null,
    {},
    [],
    { ...definition(), schemaVersion: 2 },
    { ...definition(), players: [] },
    { ...definition(), unexpected: true },
  ])("rejects malformed definition", (value) =>
    expect(isCrokinoleDefinition(value)).toBe(false),
  );
  it("requires names, unique players, unique colours and exact membership", () => {
    for (const mutate of [
      (d: CrokinoleDefinition) => {
        d.players[0].name = " ";
      },
      (d: CrokinoleDefinition) => {
        d.players[1].id = "p0";
      },
      (d: CrokinoleDefinition) => {
        d.participants[1].colour = d.participants[0].colour;
      },
      (d: CrokinoleDefinition) => {
        d.participants[0].playerIds = ["wrong"];
      },
    ]) {
      const d = definition();
      mutate(d);
      expect(() => validateDefinition(d)).toThrow();
    }
  });
  it("requires opposite doubles and cumulative FFA", () => {
    const doubles = definition(4, true);
    doubles.participants[0].playerIds = ["p0", "p1"];
    doubles.participants[1].playerIds = ["p2", "p3"];
    expect(() => validateDefinition(doubles)).toThrow();
    expect(
      isCrokinoleDefinition({
        ...definition(3),
        scoringMode: "nca_match_points",
      }),
    ).toBe(false);
  });
  it.each([
    { type: "target", target: 0 },
    { type: "target", target: 101 },
    { type: "fixed_rounds", rounds: 1.5 },
    { type: "fixed_rounds", rounds: 0 },
  ])("rejects invalid match length %j", (endCondition) =>
    expect(isCrokinoleDefinition({ ...definition(), endCondition })).toBe(
      false,
    ),
  );
  it.each([NaN, Infinity, -5, 1, 2.5, null, "5"])(
    "rejects invalid input %s",
    (rawScore) =>
      expect(
        isCrokinoleCommand({
          id: "x",
          expectedRevision: 0,
          type: "record_round",
          roundId: "r",
          entries: [
            { participantId: "p0", rawScore },
            { participantId: "p1", rawScore: 0 },
          ],
        }),
      ).toBe(false),
  );
  it("duplicate and unknown round participants rejected", () => {
    const game = createCrokinoleGame(definition());
    for (const ids of [
      ["p0", "p0"],
      ["p0", "unknown"],
    ])
      expect(() =>
        applyCrokinoleCommand(game, {
          id: "r",
          expectedRevision: 0,
          type: "record_round",
          roundId: "r",
          entries: ids.map((participantId) => ({ participantId, rawScore: 0 })),
        }),
      ).toThrow();
  });
  it("snapshots are copied; restoring defaults retains customs", () => {
    const def = definition();
    const game = createCrokinoleGame(def);
    def.participants[0].colour.value = "#ffffff";
    expect(game.definition.participants[0].colour.value).toBe("#252525");
    const custom = {
      id: "custom",
      name: "Pink",
      value: "#ff8888",
      isDefault: false,
      isActive: true,
      sortOrder: 20,
    };
    expect(restoreDefaultColours([custom])).toContainEqual({
      ...custom,
      sortOrder: 8,
    });
  });
});

describe("identifier and swatch safety", () => {
  it.each([
    "__proto__",
    "constructor",
    "prototype",
    "bad id",
    "a/b",
    "x".repeat(121),
  ])("rejects unsafe identity %s", (id) => {
    expect(isCrokinoleDefinition({ ...definition(), id })).toBe(false);
    expect(
      isCrokinoleCommand({ id, expectedRevision: 0, type: "undo_round" }),
    ).toBe(false);
    const def = definition();
    def.participants[0].colour.id = id;
    expect(isCrokinoleDefinition(def)).toBe(false);
  });
  it("chooses foreground with WCAG normal-text contrast for arbitrary valid swatches", () => {
    const luminance = (hex: string) =>
      [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    for (let red = 0; red <= 255; red += 15)
      for (let green = 0; green <= 255; green += 15)
        for (let blue = 0; blue <= 255; blue += 15) {
          const hex =
            "#" +
            [red, green, blue]
              .map((n) => n.toString(16).padStart(2, "0"))
              .join("");
          const a = luminance(hex),
            b = luminance(colourForeground(hex));
          expect(
            (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          ).toBeGreaterThanOrEqual(4.5);
        }
  });
});

describe("review regressions", () => {
  it("rejects array enum coercion", () => {
    expect(
      isCrokinoleDefinition({ ...definition(), mode: ["confirmed"] }),
    ).toBe(false);
    expect(
      isCrokinoleDefinition({
        ...definition(),
        scoringMode: ["cumulative_round_totals"],
      }),
    ).toBe(false);
  });
  it("correction traverses a long round history only once", () => {
    const game = createCrokinoleGame({
      ...definition(),
      endCondition: { type: "target", target: 1000000 },
    });
    let reads = 0;
    game.rounds = Array.from({ length: 5000 }, (_, i) => ({
      id: `r${i}`,
      number: i + 1,
      startingPlayerId: "p0",
      get entries() {
        reads++;
        return [
          { participantId: "p0", rawScore: 0 },
          { participantId: "p1", rawScore: 0 },
        ];
      },
      awards: { p0: 0, p1: 0 },
      totals: { p0: 0, p1: 0 },
    }));
    const cloneSpy = vi.spyOn(globalThis, "structuredClone");
    const preview = previewCrokinoleCorrection(game, "r0", [
      { participantId: "p0", rawScore: 5 },
      { participantId: "p1", rawScore: 0 },
    ]);
    expect(preview.rounds).toHaveLength(5000);
    expect(preview.totals.p0).toBe(5);
    expect(reads).toBe(4999);
    expect(cloneSpy.mock.calls.length).toBeLessThanOrEqual(5000);
    cloneSpy.mockRestore();
  });
});
