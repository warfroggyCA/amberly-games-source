import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createGame,
  hydrateGame,
  type GameCommand,
  type GameState,
} from "../src/domain/game";
import { turnTiming, timingEvents } from "../src/lib/turn-timing";
import { createBoard } from "../src/domain/board";
import { inferDirection } from "../src/lib/board-entry";
import type { Lexicon, Placement } from "../src/domain/types";
const lexicon: Lexicon = {
  id: "feedback",
  edition: "1",
  status: "test",
  has: (w) => ["CAT", "CATS", "AT"].includes(w),
};
function setup() {
  const r = createGame({
    id: "feedback",
    players: [
      { id: "a", name: "Alice", seat: 0 },
      { id: "b", name: "Bob", seat: 1 },
    ],
    firstPlayerId: "a",
    direction: "clockwise",
    lexicon,
    createdAt: "2026-09-25T12:00:00.000Z",
  });
  if (!r.ok) throw Error(r.error.message);
  return r.game;
}
function act(g: GameState, payload: Record<string, unknown>) {
  const r = applyCommand(
    g,
    {
      id: `c${g.revision}`,
      expectedRevision: g.revision,
      ...payload,
    } as GameCommand,
    lexicon,
  );
  if (!r.ok) throw Error(r.error.message);
  return r.game;
}
const cat: Placement[] = [..."CAT"].map((letter, col) => ({
  row: 7,
  col: 7 + col,
  tile: { letter: letter as "C" | "A" | "T", blank: false },
}));
const at = (seconds: number) =>
  new Date(Date.UTC(2026, 8, 25, 12, 0, seconds)).toISOString();
describe("recorded play corrections", () => {
  it("recalculates a later crossing, keeps IDs and original journal, and hydrates", () => {
    let g = act(setup(), { type: "play", placements: cat });
    g = act(g, {
      type: "play",
      placements: [{ row: 7, col: 10, tile: { letter: "S", blank: false } }],
    });
    const original = structuredClone(g);
    g = act(g, {
      type: "edit-turn",
      turnId: "c0",
      placements: cat.map((p, i) =>
        i === 0 ? { ...p, tile: { ...p.tile, blank: true } } : p,
      ),
      reason: "C was a blank",
    });
    expect(g.scores.a).toBe(original.scores.a - 6);
    expect(g.scores.b).toBe(original.scores.b - 3);
    expect(g.turns.map((t) => t.id)).toEqual(["c0", "c1"]);
    expect(g.events.slice(0, 2)).toEqual(original.events);
    expect(g.turns[1].runningScores).toEqual(g.scores);
    expect(hydrateGame(JSON.parse(JSON.stringify(g)), lexicon)).toMatchObject({
      ok: true,
      game: g,
    });
    g = act(g, {
      type: "edit-turn",
      turnId: "c0",
      placements: cat,
      reason: "Restore regular C",
    });
    expect(g.scores).toEqual(original.scores);
    expect(hydrateGame(g, lexicon).ok).toBe(true);
    g = act(g, { type: "undo", reason: "Undo latest" });
    expect(g.turns).toHaveLength(1);
    expect(hydrateGame(g, lexicon).ok).toBe(true);
  });
  it("rejects invalid corrections atomically and stale revisions", () => {
    let g = act(setup(), { type: "play", placements: cat });
    g = act(g, {
      type: "play",
      placements: [{ row: 7, col: 10, tile: { letter: "S", blank: false } }],
    });
    const command = {
      id: "edit",
      expectedRevision: g.revision,
      type: "edit-turn",
      turnId: "c0",
      placements: cat.slice(1),
      reason: "Remove C",
    } as GameCommand;
    expect(applyCommand(g, command, lexicon)).toMatchObject({
      ok: false,
      error: { code: "EDIT_CONFLICT" },
    });
    expect(
      applyCommand(g, { ...command, expectedRevision: 0 }, lexicon),
    ).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    expect(g.turns[0].placements).toEqual(cat);
  });
});
describe("turn clock", () => {
  it("counts sleep/refresh, excludes pauses and never invents legacy turn times", () => {
    let g = act(setup(), { type: "pass" });
    g = act(g, { type: "start-clock", timedAt: at(0) });
    g = act(g, { type: "pause", timedAt: at(10) });
    g = act(g, { type: "resume", timedAt: at(40) });
    g = act(g, { type: "play", placements: cat, timedAt: at(55) });
    const t = turnTiming(g, Date.parse(at(70)));
    expect(t.durations.c0).toBeUndefined();
    expect(t.durations.c4).toBe(25000);
    expect(t.currentMs).toBe(15000);
    expect(
      turnTiming({ timingEvents: timingEvents(g) }, Date.parse(at(70))),
    ).toEqual(t);
    expect(
      turnTiming(JSON.parse(JSON.stringify(g)), Date.parse(at(70))),
    ).toEqual(t);
    expect(hydrateGame(g, lexicon).ok).toBe(true);
  });
  it("keeps a paused clock paused during a historical correction", () => {
    let g = act(setup(), { type: "start-clock", timedAt: at(0) });
    g = act(g, { type: "play", placements: cat, timedAt: at(20) });
    g = act(g, { type: "pause", timedAt: at(30) });
    g = act(g, {
      type: "edit-turn",
      turnId: "c1",
      placements: cat.map((p, i) =>
        i === 0 ? { ...p, tile: { ...p.tile, blank: true } } : p,
      ),
      reason: "Blank",
      timedAt: at(50),
    });
    expect(turnTiming(g, Date.parse(at(90))).currentMs).toBe(10000);
    expect(
      turnTiming(
        { timingEvents: timingEvents(g).filter((e) => e.type !== "edit-turn") },
        Date.parse(at(90)),
      ).currentMs,
    ).toBe(10000);
    expect(hydrateGame(g, lexicon).ok).toBe(true);
    const tampered = JSON.parse(JSON.stringify(g));
    tampered.events.at(-1).correctedTurns[0].score++;
    expect(hydrateGame(tampered, lexicon).ok).toBe(false);
  });
  it("rejects backwards clock stamps", () => {
    const g = act(setup(), { type: "start-clock", timedAt: at(10) });
    expect(
      applyCommand(
        g,
        {
          id: "old",
          expectedRevision: g.revision,
          type: "pass",
          timedAt: at(0),
        },
        lexicon,
      ),
    ).toMatchObject({ ok: false, error: { code: "CLOCK_MOVED_BACK" } });
  });
});
it("uses the available axis at an empty edge without bending drafts", () => {
  const board = createBoard();
  expect(inferDirection(board, 5, 14, "across")).toBe("down");
  expect(inferDirection(board, 14, 5, "down")).toBe("across");
  expect(
    inferDirection(board, 5, 14, "down", [
      { row: 5, col: 13, tile: { letter: "A", blank: false } },
    ]),
  ).toBe("across");
});
