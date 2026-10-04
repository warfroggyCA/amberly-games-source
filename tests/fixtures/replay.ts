import {
  applyCommand,
  createGame,
  type GameCommand,
  type GameState,
} from "../../src/domain/game";
import { testLexicon } from "../../src/lib/test-lexicon";
import type { Placement } from "../../src/domain/types";

export const replayCat: Placement[] = [..."CAT"].map((letter, index) => ({
  row: 7,
  col: 7 + index,
  tile: { letter: letter as "C" | "A" | "T", blank: false },
}));
export function replayAction(
  game: GameState,
  payload: Record<string, unknown>,
): GameState {
  const result = applyCommand(
    game,
    {
      id: `replay-${game.revision}`,
      expectedRevision: game.revision,
      ...payload,
    } as GameCommand,
    testLexicon,
  );
  if (!result.ok) throw Error(result.error.message);
  return result.game;
}
export function replayFixture() {
  const created = createGame({
    id: "recorded-replay",
    createdAt: "2026-10-04T12:00:00.000Z",
    players: [
      { id: "doug", name: "Doug", seat: 0 },
      { id: "erin", name: "Erin", seat: 2 },
    ],
    firstPlayerId: "doug",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!created.ok) throw Error(created.error.message);
  const snapshots = [created.game];
  const act = (payload: Record<string, unknown>) =>
    snapshots.push(replayAction(snapshots.at(-1)!, payload));
  act({ type: "play", placements: replayCat });
  act({
    type: "play",
    placements: [{ row: 7, col: 10, tile: { letter: "S", blank: false } }],
  });
  act({
    type: "edit-turn",
    turnId: "replay-0",
    placements: replayCat.map((p, i) =>
      i === 0 ? { ...p, tile: { ...p.tile, blank: true } } : p,
    ),
    reason: "C was a physical blank",
  });
  act({ type: "undo", reason: "Remove the last play" });
  act({ type: "exchange", count: 3 });
  act({ type: "pass" });
  act({
    type: "finalize",
    reason: "early",
    racks: {
      doug: ["A", "E", "I", "O", "U", "N", "R"],
      erin: ["A", "E", "I", "O", "U", "N", "R"],
    },
  });
  return { game: snapshots.at(-1)!, snapshots };
}
