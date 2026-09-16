import { describe, expect, it } from "vitest";
import {
  createGame,
  applyCommand,
  type GameResult,
  type GameState,
} from "../src/domain/game";
import type { Letter, Lexicon } from "../src/domain/types";
import {
  playableArrival,
  scoresBeforeArrival,
  tileLaunchPoint,
  tumbleFrames,
} from "../src/lib/turn-playback";

const lexicon: Lexicon = {
  id: "test",
  edition: "1",
  status: "test",
  has: () => true,
};
const unwrap = (r: GameResult): GameState => {
  if (!r.ok) throw Error(r.error.message);
  return r.game;
};
const initial = unwrap(
  createGame({
    id: "g",
    players: [
      { id: "top", name: "Braeden", seat: 0 },
      { id: "right", name: "Erin", seat: 1 },
      { id: "bottom", name: "Cristine", seat: 2 },
      { id: "left", name: "Doug", seat: 3 },
    ],
    firstPlayerId: "left",
    direction: "clockwise",
    lexicon,
  }),
);
const played = unwrap(
  applyCommand(
    initial,
    {
      id: "remote",
      expectedRevision: initial.revision,
      type: "play",
      placements: [..."REMOTE"].map((letter, i) => ({
        row: 7,
        col: 7 + i,
        tile: { letter: letter as Letter, blank: false },
      })),
    },
    lexicon,
  ),
);

describe("confirmed turn presentation", () => {
  it("uses the recorded mover even after the game's current player advances", () => {
    const turn = playableArrival(initial, played, new Set());
    expect(turn?.playerId).toBe("left");
    expect(played.currentPlayerId).toBe("top");
    expect(turn?.score).toBe(18);
    expect(scoresBeforeArrival(played, turn!)).toEqual(initial.scores);
    expect(played.scores.left).toBe(18); // never mutates committed totals
  });
  it("does not animate initial load, polling, undo, or already-seen turns", () => {
    expect(
      playableArrival(played, structuredClone(played), new Set()),
    ).toBeNull();
    expect(playableArrival(played, initial, new Set())).toBeNull();
    expect(playableArrival(initial, played, new Set(["remote"]))).toBeNull();
    expect(
      playableArrival(initial, { ...played, id: "another" }, new Set()),
    ).toBeNull();
  });
  it("does not animate passes, paused/finalized snapshots or missing/replaced tiles", () => {
    const pass = unwrap(
      applyCommand(
        initial,
        { id: "pass", expectedRevision: initial.revision, type: "pass" },
        lexicon,
      ),
    );
    expect(playableArrival(initial, pass, new Set())).toBeNull();
    expect(
      playableArrival(initial, { ...played, status: "paused" }, new Set()),
    ).toBeNull();
    expect(
      playableArrival(initial, { ...played, status: "finalized" }, new Set()),
    ).toBeNull();
    const changed = {
      ...played,
      board: played.board.map((row) =>
        row.map((tile) => (tile ? { ...tile } : null)),
      ),
    };
    changed.board[7][7] = { letter: "X", blank: false };
    expect(playableArrival(initial, changed, new Set())).toBeNull();
  });
  it("retains blank identity and crosswords without adding them to the animation twice", () => {
    const blank = {
      ...played,
      board: played.board.map((row) =>
        row.map((tile) => (tile ? { ...tile } : null)),
      ),
      turns: played.turns.map((turn) => ({
        ...turn,
        placements: turn.placements.map((p) => ({ ...p, tile: { ...p.tile } })),
      })),
    };
    blank.board[7][7]!.blank = true;
    blank.turns[0].placements[0].tile.blank = true;
    expect(playableArrival(initial, blank, new Set())?.placements).toHaveLength(
      6,
    );
    blank.turns[0].placements.push(blank.turns[0].placements[0]);
    expect(playableArrival(initial, blank, new Set())).toBeNull();
  });
});
describe("seat-aware tile paths", () => {
  const board = { left: 200, top: 200, width: 600, height: 600 };
  it.each([
    [
      { left: 450, top: 100, width: 100, height: 60 },
      { x: 500, y: 160 },
    ],
    [
      { left: 840, top: 470, width: 100, height: 60 },
      { x: 840, y: 500 },
    ],
    [
      { left: 450, top: 840, width: 100, height: 60 },
      { x: 500, y: 840 },
    ],
    [
      { left: 60, top: 470, width: 100, height: 60 },
      { x: 160, y: 500 },
    ],
  ])(
    "launches from the inward edge of each actual rendered seat",
    (seat, point) => {
      expect(tileLaunchPoint(seat, board)).toEqual(point);
    },
  );
  it("keeps a single world origin for horizontal and vertical destinations of different sizes", () => {
    const origin = { x: 160, y: 500 };
    for (const [i, dest] of [
      { left: 400, top: 400, width: 40, height: 40 },
      { left: 600, top: 400, width: 40, height: 40 },
      { left: 400, top: 640, width: 30, height: 30 },
    ].entries()) {
      const frame = tumbleFrames(origin, dest, i)[0];
      const [, x, y] = String(frame.transform).match(
        /^translate\(([-\d.]+)px, ([-\d.]+)px\)/,
      )!;
      expect(dest.left + dest.width / 2 + Number(x)).toBeCloseTo(origin.x);
      expect(dest.top + dest.height / 2 + Number(y)).toBeCloseTo(origin.y);
      expect(frame.transform).toContain("rotateX(-235deg)");
      expect(tumbleFrames(origin, dest, i).at(-1)?.transform).toContain(
        "rotateX(0deg)",
      );
    }
  });
});
