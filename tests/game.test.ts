import { describe, expect, it } from "vitest";
import { LETTER_COUNTS } from "../src/domain/board";
import {
  applyCommand,
  createGame,
  hydrateGame,
  MAX_GAME_EVENTS,
  getTileSupply,
  getTileTotal,
  hasCustomTileSupply,
  type GameCommand,
  type GameResult,
  type GameState,
  type PhysicalTile,
  type Racks,
} from "../src/domain/game";
import {
  buildPlayerRecords,
  competitiveResultEligible,
  deriveGameAwards,
  humanTurnEligible,
} from "../src/domain/records";
import type { Letter, Lexicon, Placement } from "../src/domain/types";

const lexicon: Lexicon = {
  id: "fixture",
  edition: "1",
  status: "test",
  has: (word) => ["CAT", "CATS", "READING", "READINGS", "QUIZ"].includes(word),
};
const ready: Lexicon = { ...lexicon, status: "ready" };
const seven = (text: string) => text.split("") as PhysicalTile[];
const racks: Racks = { a: seven("READING"), b: seven("CATSOU?") };
function success(result: GameResult): GameState {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.game;
}
function game(reference = lexicon): GameState {
  return success(
    createGame({
      id: "game-1",
      players: [
        { id: "a", name: "Doug", seat: 0 },
        { id: "b", name: "Emma", seat: 2 },
      ],
      firstPlayerId: "a",
      direction: "clockwise",
      lexicon: {
        id: reference.id,
        edition: reference.edition,
        status: reference.status,
      },
      createdAt: "2026-09-13T20:00:00.000Z",
    }),
  );
}
function command(
  state: GameState,
  payload:
    Omit<GameCommand, "id" | "expectedRevision"> | Record<string, unknown>,
  reference = lexicon,
): GameState {
  return success(
    applyCommand(
      state,
      {
        id: `c-${state.revision + 1}`,
        expectedRevision: state.revision,
        ...payload,
      } as GameCommand,
      reference,
    ),
  );
}
function place(
  word: string,
  row = 7,
  col = 7,
  blanks: number[] = [],
): Placement[] {
  return [...word].map((letter, index) => ({
    row,
    col: col + index,
    tile: { letter: letter as Letter, blank: blanks.includes(index) },
  }));
}
function error(
  state: GameState,
  payload: Record<string, unknown>,
  code: string,
  reference = lexicon,
): void {
  expect(
    applyCommand(
      state,
      {
        id: `c-${state.revision + 1}`,
        expectedRevision: state.revision,
        ...payload,
      } as GameCommand,
      reference,
    ),
  ).toMatchObject({ ok: false, error: { code } });
}
function early(
  state: GameState,
  remaining: Racks,
  reference = lexicon,
): GameState {
  return command(
    state,
    { type: "finalize", reason: "early", racks: remaining },
    reference,
  );
}

// Geometry/inventory stress reference, deliberately synthetic; never an official word fixture.
const geometryLexicon: Lexicon = {
  id: "geometry-fixture",
  edition: "1",
  status: "test",
  has: (word) => /^[A-Z]{2,15}$/.test(word),
};
function rackOutHistory(): { state: GameState; remaining: Racks } {
  let state = game(geometryLexicon);
  const pool = Object.entries(LETTER_COUNTS).flatMap(([letter, count]) =>
    Array<string>(count).fill(letter),
  );
  const segments: { row: number; cols: number[] }[] = [
    { row: 7, cols: [7, 8, 9, 10, 11, 12, 13] },
    { row: 7, cols: [0, 1, 2, 3, 4, 5, 6] },
    { row: 7, cols: [14] },
    ...[6, 5, 4, 3, 2, 1].flatMap((row) => [
      { row, cols: [0, 1, 2, 3, 4, 5, 6] },
      { row, cols: [7, 8, 9, 10, 11, 12, 13] },
      { row, cols: [14] },
    ]),
  ];
  let used = 0;
  for (const segment of segments) {
    let offset = 0;
    while (offset < segment.cols.length && !state.pendingEnd) {
      const count = Math.min(
        segment.cols.length - offset,
        state.expectedRackCounts[state.currentPlayerId],
      );
      const placements = segment.cols
        .slice(offset, offset + count)
        .map((col, index) => {
          const tile = pool[used + index];
          return {
            row: segment.row,
            col,
            tile: {
              letter: (tile === "?" ? "A" : tile) as Letter,
              blank: tile === "?",
            },
          };
        });
      state = command(state, { type: "play", placements }, geometryLexicon);
      used += count;
      offset += count;
      expect(state.expectedBagCount).toBeGreaterThanOrEqual(0);
      expect(
        Object.values(state.expectedRackCounts).every(
          (size) => size >= 0 && size <= 7,
        ),
      ).toBe(true);
    }
    if (state.pendingEnd) break;
  }
  const remaining: Racks = {};
  for (const id of state.order) {
    remaining[id] = pool.slice(
      used,
      used + state.expectedRackCounts[id],
    ) as PhysicalTile[];
    used += state.expectedRackCounts[id];
  }
  expect(used).toBe(100);
  expect(state.pendingEnd).toBe("natural");
  return { state, remaining };
}

describe("setup, frozen order, and commands", () => {
  it("orders sparse seats from the selected first player in either direction", () => {
    const input = {
      ...game().definition,
      players: [
        { id: "a", name: "A", seat: 0 as const },
        { id: "b", name: "B", seat: 1 as const },
        { id: "c", name: "C", seat: 3 as const },
      ],
      firstPlayerId: "b",
    };
    expect(success(createGame(input)).order).toEqual(["b", "c", "a"]);
    expect(
      success(createGame({ ...input, direction: "counterclockwise" })).order,
    ).toEqual(["b", "a", "c"]);
  });
  it("rejects duplicate profiles, duplicate seats, malformed names and reserved object keys", () => {
    const input = game().definition;
    expect(
      createGame({ ...input, players: [input.players[0], input.players[0]] })
        .ok,
    ).toBe(false);
    expect(
      createGame({
        ...input,
        players: [{ id: "__proto__", name: "A", seat: 0 }],
      }).ok,
    ).toBe(false);
    expect(
      createGame({ ...input, players: [{ id: "a", name: " ", seat: 0 }] }).ok,
    ).toBe(false);
  });
  it("does not start without a usable versioned word reference", () => {
    expect(
      createGame({
        ...game().definition,
        lexicon: { ...lexicon, status: "unavailable" },
      }),
    ).toMatchObject({ ok: false, error: { code: "LEXICON_UNAVAILABLE" } });
  });
  it("tracks scores, refill assumptions, player and rounds without changing the previous state", () => {
    const before = game();
    const played = command(before, { type: "play", placements: place("CAT") });
    expect(played.scores).toEqual({ a: 10, b: 0 });
    expect(played.expectedRackCounts).toEqual({ a: 7, b: 7 });
    expect(played.expectedBagCount).toBe(83);
    expect(played.currentPlayerId).toBe("b");
    const passed = command(played, { type: "pass" });
    const next = command(passed, {
      type: "play",
      placements: place("S", 7, 10),
    });
    expect(next.turns.map((turn) => turn.round)).toEqual([1, 1, 2]);
    expect(next.scores.a).toBe(16);
    expect(before.board[7][7]).toBeNull();
    expect(before.events).toHaveLength(0);
    expect(Object.isFrozen(next.events[0].turn)).toBe(true);
  });
  it("returns a duplicate receipt without replaying the action or reverting newer work", () => {
    const start = game();
    const playCommand: GameCommand = {
      id: "one",
      expectedRevision: 0,
      type: "play",
      placements: place("CAT"),
    };
    const played = success(applyCommand(start, playCommand, lexicon));
    const later = command(played, { type: "pass" });
    expect(applyCommand(later, playCommand, lexicon)).toMatchObject({
      ok: true,
      replayed: true,
      acceptedRevision: 1,
      game: { revision: 2 },
    });
    expect(
      applyCommand(
        later,
        { ...playCommand, placements: place("QUIZ") },
        lexicon,
      ),
    ).toMatchObject({ ok: false, error: { code: "COMMAND_ID_REUSED" } });
  });
  it("rejects stale revisions, injected scores, malformed exchange counts, and dictionary swaps", () => {
    const state = command(game(), { type: "pass" });
    error(state, { expectedRevision: 0, type: "pass" }, "REVISION_CONFLICT");
    error(
      state,
      { type: "play", placements: place("CAT"), score: 100 },
      "INVALID_COMMAND",
    );
    error(state, { type: "exchange", count: -1 }, "INVALID_COMMAND");
    error(state, { type: "pass" }, "LEXICON_MISMATCH", {
      ...lexicon,
      edition: "2",
    });
  });
  it("pauses without erasing a turn and requires resume before scoring", () => {
    const state = command(
      command(game(), { type: "play", placements: place("CAT") }),
      { type: "pause" },
    );
    error(state, { type: "pass" }, "GAME_PAUSED");
    const resumed = command(state, { type: "resume" });
    expect(resumed.currentPlayerId).toBe("b");
    expect(resumed.scores.a).toBe(10);
  });
});

describe("permanent journal and reconstruction", () => {
  it("undo restores blank supply, board, scores, bag, round and actor while retaining the original turn", () => {
    const state = command(game(), {
      type: "play",
      placements: place("QUIZ", 7, 7, [3]),
    });
    expect(state.scores.a).toBe(24);
    const undone = command(state, {
      type: "undo",
      reason: "Wrong physical board entry",
    });
    expect(undone.turns).toHaveLength(0);
    expect(undone.events).toHaveLength(2);
    expect(undone.events[0].turn!.placements[3].tile.blank).toBe(true);
    expect(undone.events[1].undoneTurnId).toBe("c-1");
    expect(undone.board[7][7]).toBeNull();
    expect(undone.scores).toEqual({ a: 0, b: 0 });
    expect(undone.expectedBagCount).toBe(86);
    expect(undone.currentPlayerId).toBe("a");
    const corrected = command(undone, {
      type: "play",
      placements: place("CAT"),
    });
    expect(corrected.turns[0].round).toBe(1);
    expect(corrected.events).toHaveLength(3);
  });
  it("restores only after verifying every event and the complete derived snapshot", () => {
    let state = command(game(), { type: "play", placements: place("CAT") });
    state = command(state, { type: "undo", reason: "Correction" });
    state = command(state, { type: "play", placements: place("QUIZ") });
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(state)), lexicon)),
    ).toEqual(state);
    const tampered = JSON.parse(JSON.stringify(state));
    tampered.scores.a = 999;
    expect(hydrateGame(tampered, lexicon).ok).toBe(false);
    const forged = JSON.parse(JSON.stringify(state));
    forged.events[0].turn.score = 999;
    expect(hydrateGame(forged, lexicon).ok).toBe(false);
    expect(hydrateGame({ ...state, version: "future" }, lexicon).ok).toBe(
      false,
    );
  });
});

describe("normal and early endings", () => {
  it("counts consecutive passes only; exchange resets them and its quantity preserves bag count", () => {
    let state = command(game(), { type: "pass" });
    state = command(state, { type: "exchange", count: 2 });
    expect(state.consecutivePasses).toBe(0);
    expect(state.expectedBagCount).toBe(86);
    for (let count = 0; count < 4; count += 1)
      state = command(state, { type: "pass" });
    expect(state.pendingEnd).toBe("blocked");
    error(state, { type: "pass" }, "END_REVIEW_REQUIRED");
    state = command(state, { type: "undo", reason: "Accidental final pass" });
    expect(state.consecutivePasses).toBe(3);
    expect(state.pendingEnd).toBeNull();
  });
  it("blocks false natural endings while bag tiles remain and requires all actual racks", () => {
    const state = command(game(), {
      type: "play",
      placements: place("READING"),
    });
    const remaining = { a: seven("DOGEAIN"), b: seven("CATSOU?") };
    error(
      state,
      { type: "finalize", reason: "natural", racks: remaining },
      "INVALID_NATURAL_END",
    );
    error(
      state,
      { type: "finalize", reason: "early", racks: { a: [] } },
      "INVALID_RACKS",
    );
    error(
      state,
      { type: "finalize", reason: "early", racks: { ...remaining, a: [] } },
      "RACK_COUNT_MISMATCH",
    );
    error(
      state,
      {
        type: "finalize",
        reason: "early",
        racks: { a: seven("QQAAAAA"), b: seven("CATSOU?") },
      },
      "IMPOSSIBLE_INVENTORY",
    );
  });
  it("deducts leftovers with blank zero and negative scores; equal turns do not create a normal result", () => {
    let state = game(ready);
    for (let count = 0; count < 4; count += 1)
      state = command(state, { type: "pass" }, ready);
    const blocked = command(
      state,
      { type: "finalize", reason: "blocked", racks },
      ready,
    );
    expect(blocked.result!.scores).toEqual({ a: -9, b: -8 });
    expect(blocked.result!.winnerIds).toEqual(["b"]);
    expect(blocked.result!.competitiveEligible).toBe(true);
    expect(blocked.result!.adjustments.b.transfer).toBe(0);
    const earlyGame = early(game(ready), racks, ready);
    expect(earlyGame.result!.unequalTurns).toBe(false);
    expect(earlyGame.result!.competitiveEligible).toBe(false);
  });
  it("finalizes unequal early turns once and rejects ordinary edits afterward", () => {
    const played = command(game(), {
      type: "play",
      placements: place("READING"),
    });
    const finalCommand: GameCommand = {
      id: "finish",
      expectedRevision: played.revision,
      type: "finalize",
      reason: "early",
      racks: { a: seven("DOGEAIN"), b: seven("CATSOU?") },
    };
    const ended = success(applyCommand(played, finalCommand, lexicon));
    expect(ended.result!.unequalTurns).toBe(true);
    expect(applyCommand(ended, finalCommand, lexicon)).toMatchObject({
      ok: true,
      replayed: true,
    });
    error(
      ended,
      { type: "undo", reason: "Too late for a live undo" },
      "GAME_FINALIZED",
    );
    expect(ended.events.filter((event) => event.result)).toHaveLength(1);
  });
  it("reconciles a complete generated geometry game, refills, rack-out transfers, and replay", () => {
    const { state, remaining } = rackOutHistory();
    const ended = command(
      state,
      { type: "finalize", reason: "natural", racks: remaining },
      geometryLexicon,
    );
    const out = state.turns.at(-1)!.playerId;
    const other = state.order.find((id) => id !== out)!;
    expect(ended.result!.actualBagCount).toBe(0);
    expect(ended.result!.adjustments[out].transfer).toBe(
      ended.result!.adjustments[other].deduction,
    );
    for (const id of state.order)
      expect(state.scores[id]).toBe(
        state.turns
          .filter((turn) => turn.playerId === id)
          .reduce((sum, turn) => sum + turn.score, 0),
      );
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(ended)), geometryLexicon)),
    ).toEqual(ended);
    expect(competitiveResultEligible(ended)).toBe(false); // Synthetic geometry word data is never an official record.
  });
});

describe("assisted no-draw lifecycle", () => {
  it("stamps the boundary before the first suggestion and prevents source spoofing or removing it", () => {
    const assisted = command(game(), { type: "assist", racks });
    expect(assisted.assistance!.startedAtRevision).toBe(1);
    expect(assisted.assistance!.humanTurnIds).toEqual([]);
    error(
      assisted,
      { type: "play", placements: place("READING"), source: "human" },
      "INVALID_COMMAND",
    );
    error(assisted, { type: "exchange", count: 1 }, "NO_ASSISTED_DRAWS");
    error(assisted, { type: "assist", racks }, "ALREADY_ASSISTED");
    const paused = command(assisted, { type: "pause" });
    const resumed = command(paused, { type: "resume" });
    expect(resumed.assistance).toEqual(assisted.assistance);
  });
  it("consumes recorded rack identities and stops on an emptied rack without drawing or transferring unused bag tiles", () => {
    let state = command(game(), { type: "assist", racks });
    error(
      state,
      { type: "play", placements: place("QUIZ") },
      "TILE_NOT_IN_RACK",
    );
    state = command(state, { type: "play", placements: place("READING") });
    expect(state.turns[0].source).toBe("assisted");
    expect(state.expectedRackCounts.a).toBe(0);
    expect(state.expectedBagCount).toBe(86);
    expect(state.pendingEnd).toBe("assisted");
    state = command(state, {
      type: "finalize",
      reason: "assisted",
      racks: { a: [], b: racks.b },
    });
    expect(state.result).toMatchObject({
      reason: "assisted",
      assistedTermination: "rack-out",
      competitiveEligible: false,
      scores: { a: 70, b: -8 },
    });
    expect(state.result!.adjustments.a.transfer).toBe(0);
  });
  it("requires a trusted completed no-move search, never converting failures or available moves to passes", () => {
    let state = command(game(), { type: "assist", racks });
    error(state, { type: "pass" }, "ASSISTED_SEARCH_REQUIRED");
    const cmd: GameCommand = {
      id: "search",
      expectedRevision: state.revision,
      type: "assisted-pass",
      solverVersion: "fixture-v1",
    };
    expect(applyCommand(state, cmd, lexicon).ok).toBe(false);
    expect(
      applyCommand(state, cmd, lexicon, { hasLegalMove: () => true }),
    ).toMatchObject({ ok: false, error: { code: "LEGAL_MOVE_AVAILABLE" } });
    expect(
      applyCommand(state, cmd, lexicon, {
        hasLegalMove: () => {
          throw new Error("timeout");
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "SOLVER_UNAVAILABLE" } });
    const noMoves: Lexicon = { ...lexicon, has: () => false };
    state = success(
      applyCommand(state, cmd, noMoves, { hasLegalMove: () => false }),
    );
    state = success(
      applyCommand(
        state,
        { ...cmd, id: "search2", expectedRevision: state.revision },
        noMoves,
        { hasLegalMove: () => false },
      ),
    );
    expect(state.pendingEnd).toBe("assisted");
    state = command(
      state,
      { type: "finalize", reason: "assisted", racks },
      noMoves,
    );
    expect(state.result!.assistedTermination).toBe("blocked");
    expect(
      success(
        hydrateGame(JSON.parse(JSON.stringify(state)), noMoves, {
          hasLegalMove: () => false,
        }),
      ),
    ).toEqual(state);
  });
  it("undoes the latest assisted move while retaining its evidence, original racks, and the human cutoff", () => {
    let state = command(game(), { type: "play", placements: place("READING") });
    const remaining = { a: seven("DOGEAIN"), b: seven("CATSOU?") };
    state = command(state, { type: "assist", racks: remaining });
    error(
      state,
      { type: "undo", reason: "Erase advice" },
      "ASSISTANCE_BOUNDARY_LOCKED",
    );
    state = command(state, { type: "play", placements: place("S", 7, 14) });
    expect(state.assistance!.racks.b).toEqual(seven("CATOU?"));
    state = command(state, {
      type: "undo",
      reason: "Misplaced suggested tile",
    });
    expect(state.assistance!.racks).toEqual(remaining);
    expect(state.turns.map((turn) => turn.source)).toEqual(["human"]);
    expect(state.events[2].turn!.source).toBe("assisted");
    expect(state.currentPlayerId).toBe("b");
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(state)), lexicon)),
    ).toEqual(state);
  });
});

describe("record eligibility and evidence", () => {
  it("retains human word/turn/bingo evidence before assistance, excludes all assisted outcomes and moves", () => {
    let state = command(
      game(ready),
      { type: "play", placements: place("READING") },
      ready,
    );
    state = command(
      state,
      { type: "assist", racks: { a: seven("DOGEAIN"), b: seven("CATSOU?") } },
      ready,
    );
    state = command(
      state,
      { type: "play", placements: place("S", 7, 14) },
      ready,
    );
    state = early(state, { a: seven("DOGEAIN"), b: seven("CATOU?") }, ready);
    const records = buildPlayerRecords([state, state], "a");
    expect(records.wordsFormed).toBe(1);
    expect(records.highestWords[0]).toMatchObject({
      word: "READING",
      score: 20,
      gameId: state.id,
      turnId: "c-1",
    });
    expect(records.highestTurns[0].score).toBe(70);
    expect(records.bingoCount).toBe(1);
    expect(records.competitiveGroups).toEqual([]);
    expect(records.bestClutch).toEqual([]);
    expect(buildPlayerRecords([state], "b").wordsFormed).toBe(0);
    expect(
      humanTurnEligible(state, { ...state.turns[1], source: "human" }),
    ).toBe(false);
  });
  it("keeps test-word sessions out of every family record and does not publish active provisional scores", () => {
    let state = command(game(), { type: "play", placements: place("READING") });
    expect(
      buildPlayerRecords([state], "a", { scope: "test" }).highestTurns,
    ).toEqual([]);
    state = early(state, { a: seven("DOGEAIN"), b: seven("CATSOU?") });
    expect(buildPlayerRecords([state], "a").wordsFormed).toBe(0);
    const testRecords = buildPlayerRecords([state], "a", { scope: "test" });
    expect(testRecords.bingoCount).toBe(1);
    expect(testRecords.competitiveGroups).toEqual([]);
  });
  it("keeps solo practice separate, with no multiplayer winners or assisted practice awards", () => {
    let state = success(
      createGame({
        ...game(ready).definition,
        players: [{ id: "a", name: "Doug", seat: 0 }],
        lexicon: { id: ready.id, edition: ready.edition, status: ready.status },
      }),
    );
    state = command(
      state,
      { type: "play", placements: place("READING") },
      ready,
    );
    state = early(state, { a: seven("DOGEAIN") }, ready);
    expect(state.result!.winnerIds).toEqual([]);
    expect(buildPlayerRecords([state], "a").wordsFormed).toBe(0);
    expect(
      buildPlayerRecords([state], "a", { scope: "practice" }).bingoCount,
    ).toBe(1);
    expect(deriveGameAwards(state)).toEqual({ clutch: [], comeback: null });
  });
  it("excludes voided turns and counts a finalized game only once", () => {
    let state = command(
      game(ready),
      { type: "play", placements: place("READING") },
      ready,
    );
    state = command(state, { type: "undo", reason: "Wrong entry" }, ready);
    state = command(state, { type: "play", placements: place("CAT") }, ready);
    state = early(state, { a: seven("DOGEAIN"), b: seven("CATSOU?") }, ready);
    const records = buildPlayerRecords([state, state], "a");
    expect(records.uniqueWords).toEqual(["CAT"]);
    expect(records.bingoCount).toBe(0);
    expect(records.highestTurns[0].score).toBe(10);
  });
});

describe("tie resolution and metric definitions", () => {
  it("resolves tied adjusted scores by pre-adjustment scores and preserves an unresolved tie", () => {
    const played = command(
      game(ready),
      { type: "play", placements: place("CAT") },
      ready,
    );
    const ended = early(
      played,
      { a: seven("BFHDAEG"), b: seven("AEINORS") },
      ready,
    );
    expect(ended.result!.scores).toEqual({ a: -7, b: -7 });
    expect(ended.result!.winnerIds).toEqual(["a"]);
    const tied = early(
      game(ready),
      { a: seven("AAAAAAA"), b: seven("EEEEEEE") },
      ready,
    );
    expect(tied.result!.winnerIds).toEqual(["a", "b"]);
  });

  // Direct score-ledger fixtures isolate metric arithmetic. They are not playable Scrabble boards.
  function ledger(
    points: number[],
    finalScores?: Record<string, number>,
  ): GameState {
    const state = structuredClone(game(ready));
    const scores: Record<string, number> = { a: 0, b: 0 };
    state.turns = points.map((score, index) => {
      const playerId = index % 2 === 0 ? "a" : "b";
      scores[playerId] += score;
      return {
        id: `turn-${index}`,
        number: index + 1,
        round: Math.floor(index / 2) + 1,
        type: "play" as const,
        playerId,
        score,
        words: [],
        source: "human" as const,
        placements: [],
        bingo: false,
        newTileCount: 1,
        runningScores: { ...scores },
      };
    });
    state.scores = scores;
    const final = finalScores ?? scores;
    const high = Math.max(...Object.values(final));
    state.result = {
      reason: "natural",
      assisted: false,
      scores: { ...final },
      scoresBeforeAdjustments: scores,
      adjustments: {},
      racks: {},
      actualBagCount: 0,
      winnerIds: state.order.filter((id) => final[id] === high),
      unequalTurns: points.length % 2 !== 0,
      competitiveEligible: true,
      revision: points.length + 1,
    };
    state.status = "finalized";
    state.revision = points.length + 1;
    return state;
  }
  it("finds the precisely defined late 24-point comeback and its 44-point clutch play", () => {
    const state = ledger([150, 174, 44, 16, 20, 0]);
    const awards = deriveGameAwards(state);
    expect(awards.clutch).toEqual([
      {
        gameId: "game-1",
        turnId: "turn-2",
        playerId: "a",
        round: 2,
        score: 44,
        deficitOvercome: 24,
      },
    ]);
    expect(awards.comeback).toEqual({
      gameId: "game-1",
      playerId: "a",
      deficit: 24,
      round: 1,
    });
  });
  it("rejects an earlier lost lead and excludes a clutch when final adjustments remove the sole lead", () => {
    const state = ledger([150, 174, 44, 47, 50, 0]);
    expect(deriveGameAwards(state).clutch.map((award) => award.turnId)).toEqual(
      ["turn-4"],
    );
    const tiedFinal = ledger([150, 174, 44, 16, 20, 0], { a: 190, b: 190 });
    tiedFinal.result!.winnerIds = ["a"]; // Tie-break may decide a win, but cannot establish a sole score lead.
    expect(deriveGameAwards(tiedFinal).clutch).toEqual([]);
    const latePassRounds = ledger([150, 174, 44, 16, 20, 0, 0, 0, 0, 0]);
    expect(deriveGameAwards(latePassRounds).clutch).toEqual([]);
  });
  it("does not call an unequal-turn temporary deficit an equal-opportunity comeback", () => {
    const state = ledger([100, 20, 0, 100, 50, 0]);
    expect(deriveGameAwards(state).comeback).toMatchObject({
      playerId: "a",
      deficit: 20,
      round: 2,
    });
  });
  it("groups competitive results by edition and count, reports sample sizes, and skips early games in streaks", () => {
    const first = ledger([10, 0]);
    const earlyGame = structuredClone(first);
    earlyGame.id = "game-2";
    earlyGame.definition.createdAt = "2026-09-14T20:00:00.000Z";
    earlyGame.result!.reason = "early";
    const third = structuredClone(first);
    third.id = "game-3";
    third.definition.createdAt = "2026-09-15T20:00:00.000Z";
    const different = structuredClone(first);
    different.id = "game-4";
    different.lexicon = { ...different.lexicon, edition: "2" };
    const records = buildPlayerRecords(
      [first, earlyGame, third, different, first],
      "a",
    );
    expect(records.competitiveGroups).toHaveLength(2);
    expect(
      records.competitiveGroups.find((group) => group.lexiconEdition === "1"),
    ).toMatchObject({
      games: 2,
      wins: 2,
      currentWinStreak: 2,
      averageFinalScore: 10,
      winRate: 1,
    });
  });
  it("never trusts a forged saved competitive flag", () => {
    const state = ledger([150, 174, 44, 16]);
    state.result!.reason = "early";
    expect(competitiveResultEligible(state)).toBe(false);
    expect(deriveGameAwards(state)).toEqual({ clutch: [], comeback: null });
  });
});

describe("review regressions: complete JSON journals and played-round clutch timing", () => {
  it("rejects sparse players without throwing or creating a malformed game", () => {
    const sparsePlayers: GameState["players"] = new Array(2);
    sparsePlayers[0] = game().players[0];
    let result: GameResult | undefined;
    expect(() => {
      result = createGame({ ...game().definition, players: sparsePlayers });
    }).not.toThrow();
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_SETUP" },
    });
  });
  it("rejects sparse final racks rather than accepting zero deductions that cannot survive JSON reload", () => {
    const state = game();
    const sparseRacks: Racks = {
      a: new Array<PhysicalTile>(7),
      b: seven("AAIINOR"),
    };
    const finish: GameCommand = {
      id: "sparse-final",
      expectedRevision: 0,
      type: "finalize",
      reason: "early",
      racks: sparseRacks,
    };
    let result: GameResult | undefined;
    expect(() => {
      result = applyCommand(state, finish, lexicon);
    }).not.toThrow();
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_COMMAND" },
    });
    expect(state.events).toHaveLength(0);
    const roundTrip = JSON.parse(JSON.stringify(finish)) as GameCommand;
    expect(applyCommand(state, roundTrip, lexicon).ok).toBe(false);
  });
  it("rejects sparse assistance racks, sparse placements, explicit undefined tiles and extra array properties", () => {
    const state = game();
    const sparsePlacements = new Array<Placement>(2);
    sparsePlacements[0] = place("C")[0];
    error(
      state,
      { type: "play", placements: sparsePlacements },
      "INVALID_COMMAND",
    );
    error(
      state,
      { type: "assist", racks: { a: new Array(7), b: racks.b } },
      "INVALID_COMMAND",
    );
    error(
      state,
      {
        type: "assist",
        racks: { a: [undefined, ...seven("EADING")], b: racks.b },
      },
      "INVALID_COMMAND",
    );
    const annotated = seven("READING") as PhysicalTile[] & { note?: string };
    annotated.note = "Would disappear from JSON";
    error(
      state,
      { type: "assist", racks: { a: annotated, b: racks.b } },
      "INVALID_COMMAND",
    );
  });
  it("rejects missing saved events and sparse saved projection arrays without throwing", () => {
    const state = command(game(), { type: "pass" });
    const missing = structuredClone(state);
    missing.events = new Array(1);
    expect(hydrateGame(missing, lexicon)).toMatchObject({
      ok: false,
      error: { code: "INVALID_SAVED_GAME" },
    });
    const malformed = structuredClone(state);
    malformed.turns = new Array(1);
    expect(hydrateGame(malformed, lexicon).ok).toBe(false);
  });
  it("returns validation errors for malformed setup and command accessors", () => {
    const malformed = { ...game().definition };
    Object.defineProperty(malformed, "players", {
      get() {
        throw new Error("bad input");
      },
    });
    expect(createGame(malformed).ok).toBe(false);
    const commandPayload = {
      id: "getter",
      expectedRevision: 0,
      type: "pass",
    } as GameCommand;
    Object.defineProperty(commandPayload, "type", {
      get() {
        throw new Error("bad input");
      },
    });
    expect(applyCommand(game(), commandPayload, lexicon).ok).toBe(false);
  });
  it("preserves the sustained clutch after terminal pass-only rounds in a replay-validated fixture", () => {
    // Synthetic lexicon deliberately includes CQ to isolate complete legal-placement arithmetic.
    const crossFixture: Lexicon = {
      ...ready,
      has: (word) => ["CAT", "QUIZ", "CQ", "AU", "TI"].includes(word),
    };
    let state = command(game(crossFixture), { type: "pass" }, crossFixture);
    state = command(
      state,
      { type: "play", placements: place("CAT") },
      crossFixture,
    );
    state = command(
      state,
      { type: "play", placements: place("QUIZ", 8, 7) },
      crossFixture,
    );
    expect(state.scores).toEqual({ a: 41, b: 10 });
    for (let index = 0; index < 4; index += 1)
      state = command(state, { type: "pass" }, crossFixture);
    state = command(
      state,
      {
        type: "finalize",
        reason: "blocked",
        racks: { a: seven("EEEEEEE"), b: seven("AAIINOR") },
      },
      crossFixture,
    );
    expect(state.result!.scores).toEqual({ a: 34, b: 3 });
    const replayed = success(
      hydrateGame(JSON.parse(JSON.stringify(state)), crossFixture),
    );
    expect(deriveGameAwards(replayed).clutch).toEqual([
      {
        gameId: state.id,
        turnId: "c-3",
        playerId: "a",
        round: 2,
        score: 41,
        deficitOvercome: 10,
      },
    ]);
  });
  it("uses two distinct placement rounds even when pass and exchange rounds separate them", () => {
    const crossFixture: Lexicon = {
      ...ready,
      has: (word) => ["CAT", "CATS"].includes(word),
    };
    let state = command(
      game(crossFixture),
      { type: "play", placements: place("CAT") },
      crossFixture,
    );
    state = command(state, { type: "pass" }, crossFixture);
    state = command(state, { type: "exchange", count: 1 }, crossFixture);
    state = command(state, { type: "exchange", count: 1 }, crossFixture);
    state = command(state, { type: "exchange", count: 1 }, crossFixture);
    state = command(state, { type: "exchange", count: 1 }, crossFixture);
    state = command(
      state,
      { type: "play", placements: place("S", 7, 10) },
      crossFixture,
    );
    for (let index = 0; index < 4; index += 1)
      state = command(state, { type: "pass" }, crossFixture);
    state = command(
      state,
      {
        type: "finalize",
        reason: "blocked",
        racks: { a: seven("EEEEEEE"), b: seven("AAIINOR") },
      },
      crossFixture,
    );
    expect(deriveGameAwards(state).clutch.map((award) => award.turnId)).toEqual(
      ["c-1"],
    );
    expect(
      deriveGameAwards(
        success(hydrateGame(JSON.parse(JSON.stringify(state)), crossFixture)),
      ),
    ).toEqual(deriveGameAwards(state));
  });
});

describe("journal capacity and finalization recovery", () => {
  it("allows final review confirmation while paused without reopening normal turn entry", () => {
    const paused = command(game(), { type: "pause" });
    error(paused, { type: "pass" }, "GAME_PAUSED");
    const finalized = early(paused, racks);
    expect(finalized.status).toBe("finalized");
    expect(finalized.result!.scores).toEqual({ a: -9, b: -8 });
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(finalized)), lexicon)),
    ).toEqual(finalized);
  });
  it("reserves the final action for ending, accepts identical retries, and restores the exact maximum-length journal", () => {
    // Synthesize valid alternating pause/resume receipts, avoiding quadratic command creation.
    const nearLimit = structuredClone(game());
    nearLimit.events = Array.from(
      { length: MAX_GAME_EVENTS - 1 },
      (_, index) => {
        const type = index % 2 === 0 ? ("pause" as const) : ("resume" as const);
        const id = `capacity-${index + 1}`;
        const expectedRevision = index;
        return {
          sequence: index + 1,
          command: { id, expectedRevision, type },
          fingerprint: JSON.stringify({ expectedRevision, id, type }),
        };
      },
    );
    nearLimit.revision = nearLimit.events.length;
    nearLimit.status = "paused";
    const before = JSON.stringify(nearLimit);
    error(nearLimit, { type: "resume" }, "HISTORY_LIMIT_REACHED");
    expect(JSON.stringify(nearLimit)).toBe(before);
    const previousCommand = nearLimit.events.at(-1)!.command;
    expect(applyCommand(nearLimit, previousCommand, lexicon)).toMatchObject({
      ok: true,
      replayed: true,
    });
    const finalCommand: GameCommand = {
      id: "capacity-final",
      expectedRevision: nearLimit.revision,
      type: "finalize",
      reason: "early",
      racks,
    };
    const finalized = success(applyCommand(nearLimit, finalCommand, lexicon));
    expect(finalized.events).toHaveLength(MAX_GAME_EVENTS);
    expect(applyCommand(finalized, finalCommand, lexicon)).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(finalized)), lexicon)),
    ).toEqual(finalized);
    const oversized = {
      ...finalized,
      events: [...finalized.events, finalized.events[0]],
    };
    expect(hydrateGame(oversized, lexicon)).toMatchObject({
      ok: false,
      error: { code: "INVALID_SAVED_GAME" },
    });
  }, 120_000);
});

describe("auditable physical tile-count reconciliation", () => {
  const audit = {
    reason: "Counted the physical racks and bag",
    recordedBy: "Doug",
    recordedAt: "2026-09-14T00:30:00.000Z",
  };
  const reconcile = (
    state: GameState,
    rackCounts: Record<string, number>,
    bagCount: number,
    reference = lexicon,
  ) =>
    command(
      state,
      { type: "reconcile", rackCounts, bagCount, ...audit },
      reference,
    );

  it("changes only expected physical counts and appends the scorer, reason and timestamp", () => {
    const before = command(game(), { type: "play", placements: place("CAT") });
    const state = reconcile(before, { a: 6, b: 7 }, 84);
    expect(state.expectedRackCounts).toEqual({ a: 6, b: 7 });
    expect(state.expectedBagCount).toBe(84);
    expect(state.board).toEqual(before.board);
    expect(state.scores).toEqual(before.scores);
    expect(state.turns).toEqual(before.turns);
    expect(state.order).toEqual(before.order);
    expect(state.currentPlayerId).toBe(before.currentPlayerId);
    expect(state.events.at(-1)!.command).toMatchObject({
      type: "reconcile",
      rackCounts: { a: 6, b: 7 },
      bagCount: 84,
      ...audit,
    });
    expect(state.events[0]).toEqual(before.events[0]);
    expect(before.expectedRackCounts.a).toBe(7);
    const ended = early(state, { a: seven("READIN"), b: seven("EOSLUT?") });
    expect(ended.result!.actualBagCount).toBe(84);
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(ended)), lexicon)),
    ).toEqual(ended);
  });
  it("requires board + actual racks + bag to equal 100, with exactly the participating player keys", () => {
    const state = command(game(), { type: "play", placements: place("CAT") });
    error(
      state,
      { type: "reconcile", rackCounts: { a: 6, b: 7 }, bagCount: 83, ...audit },
      "INVENTORY_COUNT_MISMATCH",
    );
    for (const rackCounts of [
      { a: 7 },
      { a: 7, b: 7, c: 0 },
      { a: 7.1, b: 7 },
      { a: -1, b: 7 },
      { a: 8, b: 7 },
      { a: "7", b: 7 },
    ]) {
      error(
        state,
        { type: "reconcile", rackCounts, bagCount: 83, ...audit },
        "INVALID_RACK_COUNTS",
      );
    }
    expect(state.events).toHaveLength(1);
  });
  it("rejects invalid bags, sparse/prototype-bearing maps, extra keys, and malformed audit data", () => {
    const state = game();
    const payload = {
      type: "reconcile",
      rackCounts: { a: 7, b: 7 },
      bagCount: 86,
      ...audit,
    };
    for (const bagCount of [-1, 101, 86.5, NaN, Infinity, "86"])
      error(state, { ...payload, bagCount }, "INVALID_COMMAND");
    error(state, { ...payload, rackCounts: new Array(2) }, "INVALID_COMMAND");
    error(
      state,
      {
        ...payload,
        rackCounts: Object.assign(Object.create({ b: 7 }), { a: 7 }),
      },
      "INVALID_COMMAND",
    );
    error(
      state,
      { ...payload, rackCounts: JSON.parse('{"a":7,"b":7,"__proto__":0}') },
      "INVALID_RACK_COUNTS",
    );
    error(
      state,
      { ...payload, rackCounts: { a: 7, b: undefined } },
      "INVALID_COMMAND",
    );
    error(state, { ...payload, unexpected: true }, "INVALID_COMMAND");
    for (const reason of ["", "   ", "x".repeat(201), "reason\n"])
      error(state, { ...payload, reason }, "INVALID_COMMAND");
    for (const recordedBy of ["", "  ", "x".repeat(61), "Doug\u0000"])
      error(state, { ...payload, recordedBy }, "INVALID_COMMAND");
    for (const recordedAt of [
      "September 14, 2026",
      "2026-09-14",
      "2026-09-14T00:30:00",
      "2026-02-30T00:30:00Z",
      "2025-02-29T00:30:00Z",
      "2026-09-14T24:00:00Z",
      "2026-09-14T00:30:00+14:30",
    ]) {
      error(state, { ...payload, recordedAt }, "INVALID_COMMAND");
    }
    expect(
      command(state, { ...payload, recordedAt: "2024-02-29T00:30:00-04:00" })
        .revision,
    ).toBe(1);
    expect(state.revision).toBe(0);
  });
  it("can reconcile a paused game and preserves pause, board, scores and turn order", () => {
    const before = command(
      command(game(), { type: "play", placements: place("CAT") }),
      { type: "pause" },
    );
    const state = reconcile(before, { a: 6, b: 6 }, 85);
    expect(state.status).toBe("paused");
    expect(state.currentPlayerId).toBe(before.currentPlayerId);
    expect(state.scores).toEqual(before.scores);
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(state)), lexicon)),
    ).toEqual(state);
  });
  it("never rewrites assisted or finalized inventories", () => {
    const payload = {
      type: "reconcile",
      rackCounts: { a: 7, b: 7 },
      bagCount: 86,
      ...audit,
    };
    const assisted = command(game(), { type: "assist", racks });
    error(assisted, payload, "ASSISTED_RECONCILIATION_LOCKED");
    const pausedAssisted = command(assisted, { type: "pause" });
    error(pausedAssisted, payload, "ASSISTED_RECONCILIATION_LOCKED");
    error(early(game(), racks), payload, "GAME_FINALIZED");
  });
  it("clears a false inferred rack-out and can detect the corrected missed rack-out without inventing another player as the finisher", () => {
    const { state: out, remaining } = rackOutHistory();
    const finisher = out.turns.at(-1)!.playerId;
    const other = out.order.find((id) => id !== finisher)!;
    const otherCount = out.expectedRackCounts[other];
    expect(otherCount).toBeGreaterThan(0);
    const corrected = reconcile(
      out,
      { [finisher]: 1, [other]: otherCount - 1 },
      0,
      geometryLexicon,
    );
    expect(corrected.pendingEnd).toBeNull();
    const missed = reconcile(
      corrected,
      { [finisher]: 0, [other]: otherCount },
      0,
      geometryLexicon,
    );
    expect(missed.pendingEnd).toBe("natural");
    expect(
      command(
        missed,
        { type: "finalize", reason: "natural", racks: remaining },
        geometryLexicon,
      ).status,
    ).toBe("finalized");
    const emptiedOther = reconcile(
      out,
      { [finisher]: otherCount, [other]: 0 },
      0,
      geometryLexicon,
    );
    expect(emptiedOther.pendingEnd).toBeNull();
    expect(emptiedOther.expectedRackCounts[other]).toBe(0);
    expect(
      success(
        hydrateGame(JSON.parse(JSON.stringify(emptiedOther)), geometryLexicon),
      ),
    ).toEqual(emptiedOther);
  });
  it("does not clear a valid household pass ending by changing the physical counts", () => {
    let state = game();
    for (let index = 0; index < 4; index += 1)
      state = command(state, { type: "pass" });
    state = reconcile(state, { a: 6, b: 7 }, 87);
    expect(state.pendingEnd).toBe("blocked");
    expect(state.consecutivePasses).toBe(4);
  });
  it("retains idempotency and conflict protection across reconciliation and later actions", () => {
    const state = game();
    const payload: GameCommand = {
      id: "counts",
      expectedRevision: 0,
      type: "reconcile",
      rackCounts: { a: 6, b: 7 },
      bagCount: 87,
      ...audit,
    };
    const reconciled = success(applyCommand(state, payload, lexicon));
    const later = command(reconciled, { type: "pass" });
    expect(applyCommand(later, payload, lexicon)).toMatchObject({
      ok: true,
      replayed: true,
      acceptedRevision: 1,
      game: { revision: 2 },
    });
    expect(
      applyCommand(
        later,
        { ...payload, reason: "Changed explanation" },
        lexicon,
      ),
    ).toMatchObject({ ok: false, error: { code: "COMMAND_ID_REUSED" } });
    expect(
      applyCommand(later, { ...payload, id: "other-counts" }, lexicon),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(later)), lexicon)),
    ).toEqual(later);
  });
  it("blocks undo across a physical-count boundary but safely undoes later turns", () => {
    const played = command(game(), { type: "play", placements: place("CAT") });
    let state = reconcile(played, { a: 6, b: 7 }, 84);
    error(
      state,
      { type: "undo", reason: "Change the older turn" },
      "RECONCILIATION_BOUNDARY_LOCKED",
    );
    state = command(state, { type: "pass" });
    state = command(state, { type: "play", placements: place("S", 7, 10) });
    expect(state.expectedRackCounts.a).toBe(7);
    expect(state.expectedBagCount).toBe(82);
    state = command(state, { type: "undo", reason: "Wrong S placement" });
    expect(state.expectedRackCounts).toEqual({ a: 6, b: 7 });
    expect(state.expectedBagCount).toBe(84);
    expect(state.board[7][10]).toBeNull();
    state = command(state, { type: "undo", reason: "Wrong pass" });
    expect(state.turns).toEqual(played.turns);
    expect(state.currentPlayerId).toBe("b");
    error(
      state,
      { type: "undo", reason: "Cannot cross counts" },
      "RECONCILIATION_BOUNDARY_LOCKED",
    );
    expect(
      state.events.some((event) => event.command.type === "reconcile"),
    ).toBe(true);
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(state)), lexicon)),
    ).toEqual(state);
  });
});

describe("explicit nonstandard physical tile supply", () => {
  const audit = {
    reason: "The physical set includes an additional Q",
    recordedBy: "Doug",
    recordedAt: "2026-09-14T12:00:00.000Z",
  };
  const qat: Lexicon = {
    id: "qat-fixture",
    edition: "1",
    status: "ready",
    has: (word) => word === "QAT",
  };
  const extraPlay: Placement[] = [
    { row: 6, col: 8, tile: { letter: "Q", blank: false } },
    { row: 8, col: 8, tile: { letter: "T", blank: false } },
  ];
  const extend = (
    state: GameState,
    additions: Record<string, number>,
    reference = lexicon,
  ) =>
    command(state, { type: "extend-supply", additions, ...audit }, reference);

  it("adds the confirmed physical tile to supply and bag while preserving prior words, board, scores and order", () => {
    const before = command(
      game(qat),
      { type: "play", placements: place("QAT") },
      qat,
    );
    error(
      before,
      { type: "play", placements: extraPlay },
      "INVALID_INVENTORY",
      qat,
    );
    const extended = extend(before, { Q: 1 }, qat);
    expect(getTileSupply(extended).Q).toBe(2);
    expect(getTileTotal(extended)).toBe(101);
    expect(extended.expectedBagCount).toBe(before.expectedBagCount + 1);
    expect(extended.board).toEqual(before.board);
    expect(extended.scores).toEqual(before.scores);
    expect(extended.currentPlayerId).toBe(before.currentPlayerId);
    expect(extended.events.at(-1)!.command).toMatchObject({
      type: "extend-supply",
      additions: { Q: 1 },
      ...audit,
    });
    const played = command(
      extended,
      { type: "play", placements: extraPlay },
      qat,
    );
    // Both new Q and T occupy double-letter squares: 20 + 1 + 2 = 23.
    expect(played.scores).toEqual({ a: 24, b: 23 });
    expect(
      played.expectedBagCount +
        Object.values(played.expectedRackCounts).reduce(
          (sum, count) => sum + count,
          0,
        ) +
        played.board.flat().filter(Boolean).length,
    ).toBe(101);
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(played)), qat)),
    ).toEqual(played);
    expect(before.tileSupply).toBeUndefined();
  });
  it("reconciles and finalizes against101 actual tiles with ordinary leftover arithmetic", () => {
    let state = command(
      game(qat),
      { type: "play", placements: place("QAT") },
      qat,
    );
    state = extend(state, { Q: 1 }, qat);
    state = command(state, { type: "play", placements: extraPlay }, qat);
    state = command(
      state,
      { type: "reconcile", rackCounts: { a: 7, b: 6 }, bagCount: 83, ...audit },
      qat,
    );
    expect(getTileTotal(state)).toBe(101);
    state = early(state, { a: seven("EEEEEEE"), b: seven("AINORS") }, qat);
    expect(state.result!.actualBagCount).toBe(83);
    expect(state.result!.scores).toEqual({ a: 17, b: 17 });
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(state)), qat)),
    ).toEqual(state);
  });
  it("permanently excludes every human achievement and competitive result after any extra supply is confirmed", () => {
    let state = command(
      game(qat),
      { type: "play", placements: place("QAT") },
      qat,
    );
    state = extend(state, { Q: 1 }, qat);
    state = command(state, { type: "play", placements: extraPlay }, qat);
    for (let index = 0; index < 4; index += 1)
      state = command(state, { type: "pass" }, qat);
    state = command(
      state,
      {
        type: "finalize",
        reason: "blocked",
        racks: { a: seven("EEEEEEE"), b: seven("AINORS?") },
      },
      qat,
    );
    expect(state.result!.reason).toBe("blocked");
    expect(state.result!.competitiveEligible).toBe(false);
    expect(competitiveResultEligible(state)).toBe(false);
    expect(humanTurnEligible(state, state.turns[0])).toBe(false);
    expect(buildPlayerRecords([state], "a").wordsFormed).toBe(0);
    expect(buildPlayerRecords([state], "a").competitiveGroups).toEqual([]);
    expect(deriveGameAwards(state)).toEqual({ clutch: [], comeback: null });
    const stripped = structuredClone(state);
    delete stripped.tileSupply;
    expect(hasCustomTileSupply(stripped)).toBe(true);
    expect(humanTurnEligible(stripped, stripped.turns[0])).toBe(false);
    expect(hydrateGame(stripped, qat).ok).toBe(false);
  });
  it("preserves standard saved snapshots without adding a tileSupply property", () => {
    const standard = early(
      command(game(), { type: "play", placements: place("CAT") }),
      { a: seven("READING"), b: seven("EOSLUT?") },
    );
    const saved = JSON.parse(JSON.stringify(standard));
    expect(Object.hasOwn(saved, "tileSupply")).toBe(false);
    const restored = success(hydrateGame(saved, lexicon));
    expect(Object.hasOwn(restored, "tileSupply")).toBe(false);
    expect(getTileTotal(restored)).toBe(100);
    expect(getTileSupply(restored)).toEqual(LETTER_COUNTS);
    expect(restored).toEqual(saved);
  });
  it("rejects malformed, decreasing, empty, unknown and excessively large additions without changing history", () => {
    const state = game();
    const payload = { type: "extend-supply", additions: { Q: 1 }, ...audit };
    for (const additions of [
      {},
      { Q: 0 },
      { Q: -1 },
      { Q: 1.1 },
      { q: 1 },
      { EXTRA: 1 },
      { Q: "1" },
      { Q: 101 },
    ])
      error(state, { ...payload, additions }, "INVALID_SUPPLY_ADDITIONS");
    error(state, { ...payload, additions: new Array(1) }, "INVALID_COMMAND");
    error(
      state,
      {
        ...payload,
        additions: Object.assign(Object.create({ Q: 1 }), { Z: 1 }),
      },
      "INVALID_COMMAND",
    );
    error(
      state,
      { ...payload, additions: { Q: undefined } },
      "INVALID_COMMAND",
    );
    error(
      state,
      { ...payload, recordedAt: "2026-02-30T12:00:00Z" },
      "INVALID_COMMAND",
    );
    const full = extend(state, { Q: 100 });
    expect(getTileTotal(full)).toBe(200);
    error(full, { ...payload, additions: { Z: 1 } }, "TILE_SUPPLY_LIMIT");
    expect(state.events).toHaveLength(0);
  });
  it("supports paused confirmation, protects retries, and rejects changes to assisted or finalized supply", () => {
    const paused = command(game(), { type: "pause" });
    const payload: GameCommand = {
      id: "extra",
      expectedRevision: paused.revision,
      type: "extend-supply",
      additions: { Q: 1 },
      ...audit,
    };
    const extended = success(applyCommand(paused, payload, lexicon));
    expect(extended.status).toBe("paused");
    expect(applyCommand(extended, payload, lexicon)).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(
      applyCommand(extended, { ...payload, additions: { Q: 2 } }, lexicon),
    ).toMatchObject({ ok: false, error: { code: "COMMAND_ID_REUSED" } });
    error(
      command(game(), { type: "assist", racks }),
      { type: "extend-supply", additions: { Q: 1 }, ...audit },
      "ASSISTED_SUPPLY_LOCKED",
    );
    error(
      early(game(), racks),
      { type: "extend-supply", additions: { Q: 1 }, ...audit },
      "GAME_FINALIZED",
    );
  });
  it("blocks undo across supply confirmation and restores later moves without removing the nonstandard classification", () => {
    const before = command(
      game(qat),
      { type: "play", placements: place("QAT") },
      qat,
    );
    let state = extend(before, { Q: 1 }, qat);
    error(
      state,
      { type: "undo", reason: "Earlier turn" },
      "RECONCILIATION_BOUNDARY_LOCKED",
      qat,
    );
    state = command(state, { type: "play", placements: extraPlay }, qat);
    state = command(state, { type: "undo", reason: "Later turn" }, qat);
    expect(state.board).toEqual(before.board);
    expect(getTileSupply(state).Q).toBe(2);
    expect(hasCustomTileSupply(state)).toBe(true);
    expect(state.expectedBagCount).toBe(before.expectedBagCount + 1);
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(state)), qat)),
    ).toEqual(state);
  });
  it("passes the full custom supply to trusted no-move verification and restores assisted histories with that supply", () => {
    let state = extend(game(), { Q: 1 });
    state = command(state, {
      type: "assist",
      racks: { a: seven("QQATERS"), b: seven("IENOULT") },
    });
    const context = {
      hasLegalMove(
        _board: unknown,
        _rack: unknown,
        _lexicon: unknown,
        supply: unknown,
      ) {
        expect(supply).toEqual({ ...LETTER_COUNTS, Q: 2 });
        return false;
      },
    };
    // Explicit stub tests trusted-context propagation, not an actual no-move claim for this rack.
    state = success(
      applyCommand(
        state,
        {
          id: "custom-search",
          expectedRevision: state.revision,
          type: "assisted-pass",
          solverVersion: "context-fixture",
        },
        lexicon,
        context,
      ),
    );
    expect(state.assistance!.bagCountAtStart).toBe(87);
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(state)), lexicon, context)),
    ).toEqual(state);
  });
});

describe("audited publisher word additions", () => {
  const dog = {
    word: "DOG",
    source: "merriam-webster" as const,
    sourceUrl: "https://scrabble.merriam.com/finder/dog",
    verifiedAt: "2026-09-14T17:00:00.000Z",
  };
  const verify = (state: GameState, reference = lexicon) =>
    command(state, { type: "verify-words", words: [dog] }, reference);
  it("records evidence before accepting a missing word and replays offline with the original definition", () => {
    const initial = game();
    error(initial, { type: "play", placements: place("DOG") }, "INVALID_WORD");
    const verified = verify(initial);
    expect(verified.definition).toEqual(initial.definition);
    expect(verified.lexicon).toEqual(initial.lexicon);
    expect(verified.verifiedWords).toEqual([dog]);
    expect(verified.turns).toEqual([]);
    expect(verified.currentPlayerId).toBe(initial.currentPlayerId);
    expect(verified.expectedBagCount).toBe(initial.expectedBagCount);
    const played = command(verified, {
      type: "play",
      placements: place("DOG"),
    });
    expect(played.scores.a).toBe(10);
    expect(played.turns[0].source).toBe("human");
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(played)), lexicon)),
    ).toEqual(played);
    const tampered = JSON.parse(JSON.stringify(played));
    tampered.verifiedWords[0].sourceUrl = "https://example.org";
    expect(hydrateGame(tampered, lexicon).ok).toBe(false);
    expect(initial).not.toHaveProperty("verifiedWords");
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(initial)), lexicon)),
    ).not.toHaveProperty("verifiedWords");
  });
  it("keeps verification evidence through turn undo and allows replaying the word", () => {
    const verified = verify(game());
    const played = command(verified, {
      type: "play",
      placements: place("DOG"),
    });
    const undone = command(played, {
      type: "undo",
      reason: "Wrong board position",
    });
    expect(undone.verifiedWords).toEqual([dog]);
    expect(undone.scores.a).toBe(0);
    expect(undone.events[0]).toEqual(verified.events[0]);
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(undone)), lexicon)),
    ).toEqual(undone);
    expect(
      command(undone, { type: "play", placements: place("DOG") }).scores.a,
    ).toBe(10);
    const cat = command(game(), { type: "play", placements: place("CAT") });
    const undoAcross = command(verify(cat), {
      type: "undo",
      reason: "Undo previous turn",
    });
    expect(undoAcross.turns).toHaveLength(0);
    expect(undoAcross.verifiedWords).toEqual([dog]);
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(undoAcross)), lexicon)),
    ).toEqual(undoAcross);
  });
  it("retains payload-safe retries while refusing duplicate or already accepted word audits", () => {
    const verified = verify(game());
    const replay = applyCommand(verified, verified.events[0].command, lexicon);
    expect(replay.ok && replay.replayed).toBe(true);
    expect(replay.ok && replay.game).toBe(verified);
    error(
      verified,
      {
        type: "verify-words",
        words: [{ ...dog, verifiedAt: "2026-09-15T12:00:00Z" }],
      },
      "WORD_ALREADY_AVAILABLE",
    );
    error(
      game(),
      { type: "verify-words", words: [dog, dog] },
      "INVALID_COMMAND",
    );
    error(
      game(),
      {
        type: "verify-words",
        words: [
          {
            ...dog,
            word: "CAT",
            sourceUrl: "https://scrabble.merriam.com/finder/cat",
          },
        ],
      },
      "WORD_ALREADY_AVAILABLE",
    );
    error(
      game(),
      { type: "verify-words", words: new Array(1) },
      "INVALID_COMMAND",
    );
    error(
      game(),
      {
        type: "verify-words",
        words: [{ ...dog, verifiedAt: "2026-02-30T10:00:00Z" }],
      },
      "INVALID_COMMAND",
    );
    error(
      game(),
      { type: "verify-words", words: [{ ...dog, playable: true }] },
      "INVALID_COMMAND",
    );
  });
  it("bounds verification batches and keeps failed actions atomic", () => {
    const entries = Array.from({ length: 33 }, (_, index) => {
      const word = `${index < 26 ? "X" : "Y"}${String.fromCharCode(65 + (index % 26))}`;
      return {
        ...dog,
        word,
        sourceUrl: `https://scrabble.merriam.com/finder/${word.toLowerCase()}`,
      };
    });
    const initial = game();
    error(initial, { type: "verify-words", words: entries }, "INVALID_COMMAND");
    const added = command(initial, {
      type: "verify-words",
      words: entries.slice(0, 32),
    });
    expect(added.verifiedWords).toHaveLength(32);
    expect(initial.events).toHaveLength(0);
    expect(initial).not.toHaveProperty("verifiedWords");
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(added)), lexicon)),
    ).toEqual(added);
  });
  it("permits verification only while active human play can continue", () => {
    error(
      command(game(), { type: "pause" }),
      { type: "verify-words", words: [dog] },
      "GAME_PAUSED",
    );
    error(
      command(game(), { type: "assist", racks }),
      { type: "verify-words", words: [dog] },
      "ASSISTED_LEXICON_LOCKED",
    );
    let blocked = game();
    for (let i = 0; i < 4; i++) blocked = command(blocked, { type: "pass" });
    error(
      blocked,
      { type: "verify-words", words: [dog] },
      "END_REVIEW_REQUIRED",
    );
    error(
      command(blocked, { type: "finalize", reason: "blocked", racks }),
      { type: "verify-words", words: [dog] },
      "GAME_FINALIZED",
    );
  });
  it("never bypasses center coverage, connected full crosswords or physical tile supply", () => {
    const verified = verify(game());
    expect(
      applyCommand(
        verified,
        {
          type: "play",
          placements: place("DOG", 0, 0),
          id: "edge",
          expectedRevision: verified.revision,
        },
        lexicon,
      ).ok,
    ).toBe(false);
    const cat = command(verified, { type: "play", placements: place("CAT") });
    error(
      cat,
      { type: "play", placements: place("DOG", 8, 7) },
      "INVALID_WORD",
    );
    const qq = command(game(), {
      type: "verify-words",
      words: [
        {
          ...dog,
          word: "QQ",
          sourceUrl: "https://scrabble.merriam.com/finder/qq",
        },
      ],
    });
    error(qq, { type: "play", placements: place("QQ") }, "INVALID_INVENTORY");
  });
  it("passes augmented membership to trusted assisted verification", () => {
    const assisted = command(verify(game()), { type: "assist", racks });
    let observed = false;
    const result = applyCommand(
      assisted,
      {
        type: "assisted-pass",
        solverVersion: "fixture",
        id: "pass-proof",
        expectedRevision: assisted.revision,
      },
      lexicon,
      {
        hasLegalMove: (_board, _rack, effective, _supply, evidence) => {
          expect(evidence).toEqual([dog]);
          observed = effective.has("DOG") && effective.has("CAT");
          return true;
        },
      },
    );
    expect(observed).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LEGAL_MOVE_AVAILABLE");
  });
  it("excludes competitive outcomes but retains human word credit in the correct scope", () => {
    let state = command(
      verify(game(ready), ready),
      { type: "play", placements: place("DOG") },
      ready,
    );
    for (let i = 0; i < 4; i++) state = command(state, { type: "pass" }, ready);
    state = command(
      state,
      {
        type: "finalize",
        reason: "blocked",
        racks: { a: seven("AAAAIII"), b: seven("EEEEERT") },
      },
      ready,
    );
    expect(state.result?.competitiveEligible).toBe(false);
    expect(competitiveResultEligible(state)).toBe(false);
    expect(deriveGameAwards(state)).toEqual({ clutch: [], comeback: null });
    expect(humanTurnEligible(state, state.turns[0])).toBe(true);
    const preview = command(verify(game()), {
      type: "play",
      placements: place("DOG"),
    });
    const finalized = command(preview, {
      type: "finalize",
      reason: "early",
      racks: { a: seven("AAAAIII"), b: seven("EEEEERT") },
    });
    expect(humanTurnEligible(finalized, finalized.turns[0])).toBe(false);
    expect(humanTurnEligible(finalized, finalized.turns[0], "test")).toBe(true);
  });
});
