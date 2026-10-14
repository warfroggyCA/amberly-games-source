import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  CLOCK_RECOVERY_POLICY,
  createGame,
  gameReplay,
  hydrateGame,
  type GameCommand,
  type GameResult,
  type GameState,
} from "../src/domain/game";
import {
  GameClock,
  TurnClock,
  PlayerElapsedTime,
  TimingSummary,
} from "../src/components/TurnTiming";
import {
  commandTiming,
  timingEvents,
  turnTiming,
} from "../src/lib/turn-timing";
import { replayStepLabel } from "../src/lib/game-replay";
import type { Placement } from "../src/domain/types";
import legacy from "./fixtures/legacy-offset-clock.json";
import { rackContinuity } from "../src/domain/turn-coaching";
import { advanceRack, emptyRackMemory } from "../src/lib/private-rack";

const lexicon = {
  id: "fixture",
  edition: "1",
  status: "test",
  has: () => true,
} as const;
const past = "2026-10-12T12:00:00Z";
const future = "2035-10-12T12:00:00Z";
const reason = "Scorer device clock had the wrong year";
const cat: Placement[] = [..."CAT"].map((letter, col) => ({
  row: 7,
  col: 7 + col,
  tile: { letter: letter as "C" | "A" | "T", blank: false },
}));
function success(result: GameResult): GameState {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.game;
}
function setup() {
  return success(
    createGame({
      id: "clock-recovery",
      players: [
        { id: "a", name: "Alice", seat: 0 },
        { id: "b", name: "Bob", seat: 1 },
      ],
      firstPlayerId: "a",
      direction: "clockwise",
      lexicon,
      createdAt: past,
    }),
  );
}
function command(
  game: GameState,
  action: Record<string, unknown>,
): GameCommand {
  return {
    id: `action-${game.revision}`,
    expectedRevision: game.revision,
    ...action,
  } as GameCommand;
}
function act(game: GameState, action: Record<string, unknown>) {
  return success(applyCommand(game, command(game, action), lexicon));
}
const recovery = {
  type: "recover-clock",
  timingPolicy: CLOCK_RECOVERY_POLICY,
  reason,
  timedAt: past,
};

describe("explicit clock recovery", () => {
  it("recovers a future clock without changing historical events, turns, scores or ownership", () => {
    const started = act(setup(), { type: "start-clock", timedAt: future });
    const played = act(started, {
      type: "play",
      placements: cat,
      timedAt: "2035-10-12T12:01:00Z",
    });
    const original = structuredClone(played);
    expect(
      applyCommand(
        played,
        command(played, { type: "pass", timedAt: past }),
        lexicon,
      ),
    ).toMatchObject({ ok: false, error: { code: "CLOCK_MOVED_BACK" } });
    const recovered = act(played, recovery);
    expect(recovered.events.slice(0, original.events.length)).toEqual(
      original.events,
    );
    expect(recovered).toMatchObject({
      board: original.board,
      turns: original.turns,
      scores: original.scores,
      currentPlayerId: original.currentPlayerId,
      status: original.status,
    });
    expect(commandTiming(recovered, "pass", new Date(past))).toEqual({});
    const passed = act(recovered, { type: "pass" });
    expect(passed.turns).toHaveLength(2);
    expect(
      success(hydrateGame(JSON.parse(JSON.stringify(passed)), lexicon)),
    ).toEqual(passed);
    expect(gameReplay(passed)?.at(passed.revision)).toEqual(passed);
    expect(replayStepLabel(recovered, recovered.events.at(-1))).toContain(
      "Continued without timing",
    );
    expect(played).toEqual(original);
  });

  it("supports paused recovery, correction, undo and finalization without restarting timing", () => {
    let game = act(setup(), { type: "start-clock", timedAt: future });
    game = act(game, { type: "play", placements: cat, timedAt: future });
    const playId = game.turns[0].id;
    game = act(game, { type: "pause", timedAt: future });
    game = act(game, recovery);
    expect(game.status).toBe("paused");
    game = act(game, {
      type: "edit-turn",
      turnId: playId,
      placements: cat.map((p, i) =>
        i === 0 ? { ...p, tile: { ...p.tile, blank: true } } : p,
      ),
      reason: "C is a blank",
    });
    expect(game.scores.a).toBe(4);
    game = act(game, { type: "resume" });
    game = act(game, { type: "undo", reason: "Undo the corrected play" });
    expect(game.turns).toHaveLength(0);
    game = act(game, { type: "play", placements: cat });
    game = act(game, {
      type: "finalize",
      reason: "early",
      racks: {
        a: ["A", "A", "A", "A", "A", "A", "A"],
        b: ["E", "E", "E", "E", "E", "E", "E"],
      },
    });
    expect(game.status).toBe("finalized");
    expect(success(hydrateGame(game, lexicon))).toEqual(game);
    expect(turnTiming(game, Date.now())).toMatchObject({
      reliable: false,
      totalMs: null,
      durations: {},
    });
    expect(applyCommand(game, command(game, recovery), lexicon)).toMatchObject({
      ok: false,
      error: { code: "GAME_FINALIZED" },
    });
  });

  it("keeps the private rack, refill state and historical rack snapshots across timing recovery", () => {
    const game = act(act(setup(), { type: "start-clock", timedAt: future }), {
      type: "play",
      placements: cat,
      timedAt: future,
    });
    const memory = {
      ...emptyRackMemory(game.revision, game.turns, rackContinuity(game)),
      rack: [..."EIRS"],
      awaitingDraw: true,
      snapshots: { [game.turns[0].id]: [..."CATEIRS"] },
    };
    const recovered = act(game, recovery);
    expect(rackContinuity(recovered)).toBe(rackContinuity(game));
    const continued = advanceRack(
      memory,
      recovered.revision,
      recovered.turns,
      "a",
      rackContinuity(recovered),
      7,
    );
    expect(continued).toEqual({ ...memory, revision: recovered.revision });
    expect(JSON.stringify(recovered)).not.toContain("CATEIRS");
  });

  it("keeps legacy journal bytes and replay strictness when adding a recovery", () => {
    const original = JSON.stringify(legacy);
    const loaded = success(hydrateGame(legacy, lexicon));
    const game = act(loaded, recovery);
    expect(game.events.slice(0, loaded.events.length)).toEqual(loaded.events);
    expect(success(hydrateGame(game, lexicon))).toEqual(game);
    const tampered = structuredClone(game);
    tampered.events.at(-1)!.command.timedAt = future;
    expect(hydrateGame(tampered, lexicon)).toMatchObject({
      ok: false,
      error: { code: "INVALID_SAVED_GAME" },
    });
    expect(JSON.stringify(legacy)).toBe(original);
  });

  it("enforces idempotency and revision, disallows untimed recovery and a second recovery", () => {
    const unstarted = setup();
    expect(
      applyCommand(unstarted, command(unstarted, recovery), lexicon),
    ).toMatchObject({ ok: false, error: { code: "CLOCK_NOT_STARTED" } });
    const started = act(unstarted, { type: "start-clock", timedAt: future });
    const action = command(started, recovery);
    const recovered = success(applyCommand(started, action, lexicon));
    expect(applyCommand(recovered, action, lexicon)).toMatchObject({
      ok: true,
      replayed: true,
      game: recovered,
    });
    expect(
      applyCommand(
        recovered,
        { ...action, reason: "Different reason" } as GameCommand,
        lexicon,
      ),
    ).toMatchObject({ ok: false, error: { code: "COMMAND_ID_REUSED" } });
    expect(
      applyCommand(recovered, command(recovered, recovery), lexicon),
    ).toMatchObject({ ok: false, error: { code: "CLOCK_ALREADY_RECOVERED" } });
    expect(
      applyCommand(started, { ...action, expectedRevision: 0 }, lexicon),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    expect(
      applyCommand(
        recovered,
        command(recovered, { type: "start-clock", timedAt: past }),
        lexicon,
      ),
    ).toMatchObject({ ok: false, error: { code: "CLOCK_ALREADY_STARTED" } });
  });

  it.each([
    { timingPolicy: 2 },
    { timingPolicy: undefined },
    { reason: " " },
    { reason: "a".repeat(201) },
    { reason: "clock\nchanged" },
    { timedAt: "invalid" },
    { timedAt: undefined },
    { extra: true },
  ])("rejects malformed or unknown recovery policy: %j", (invalid) => {
    const game = act(setup(), { type: "start-clock", timedAt: future });
    expect(
      applyCommand(game, command(game, { ...recovery, ...invalid }), lexicon),
    ).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
  });

  it.each([undefined, 2])(
    "does not invent guest timing for an unknown recovery policy %j",
    (timingPolicy) => {
      expect(
        turnTiming(
          {
            timingEvents: [
              { type: "start-clock", timedAt: past },
              { type: "recover-clock", timedAt: past, timingPolicy },
            ],
          },
          Date.now(),
        ),
      ).toMatchObject({
        reliable: false,
        recovered: false,
        totalMs: null,
        currentMs: null,
        durations: {},
      });
    },
  );

  it("excludes the whole game from all timing surfaces and guest timing projections", () => {
    let game = act(setup(), { type: "start-clock", timedAt: past });
    game = act(game, {
      type: "play",
      placements: cat,
      timedAt: "2026-10-12T12:01:00Z",
    });
    expect(turnTiming(game, Date.parse(past)).durations[game.turns[0].id]).toBe(
      60_000,
    );
    game = act(game, recovery);
    const timing = turnTiming(game, Date.now());
    expect(timing).toEqual({
      started: true,
      reliable: false,
      recovered: true,
      currentMs: null,
      totalMs: null,
      durations: {},
    });
    const projected = timingEvents(game);
    expect(projected.at(-1)).toMatchObject({
      type: "recover-clock",
      timingPolicy: 1,
    });
    expect(JSON.stringify(projected)).not.toContain(reason);
    expect(turnTiming({ timingEvents: projected }, Date.now())).toEqual(timing);
    for (const view of [
      createElement(GameClock, { game }),
      createElement(TurnClock, { game }),
      createElement(PlayerElapsedTime, { game, playerId: "a" }),
      createElement(TimingSummary, { game }),
    ]) {
      const html = renderToStaticMarkup(view);
      expect(html).toContain("Timing unavailable");
      expect(html).not.toMatch(/1:00|0:00|Average|<table/);
    }
  });
});
