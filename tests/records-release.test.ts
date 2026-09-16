import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createGame,
  applyCommand,
  hydrateGame,
  type GameState,
  type GameCommand,
} from "../src/domain/game";
import type { EnumerableLexicon } from "../src/domain/solver";
import type { GameAccess } from "../src/lib/shared-contract";
import {
  familyLexicon,
  releasedFamilyLexicon,
  resolveLexicon,
} from "../src/lib/lexicons";
import {
  buildPlayerRecords,
  competitiveResultEligible,
} from "../src/domain/records";
import { RecordsPage } from "../src/components/RecordsPage";
type Action<T = GameCommand> = T extends GameCommand
  ? Omit<T, "id" | "expectedRevision">
  : never;
function finished(lexicon: EnumerableLexicon) {
  const created = createGame({
    id: lexicon.id,
    players: [
      { id: "ada", name: "Ada", seat: 0 },
      { id: "ben", name: "Ben", seat: 2 },
    ],
    firstPlayerId: "ada",
    direction: "clockwise",
    lexicon,
  });
  if (!created.ok) throw new Error(created.error.message);
  let game = created.game;
  const run = (command: Action) => {
    const result = applyCommand(
      game,
      {
        ...command,
        id: `turn-${game.revision}`,
        expectedRevision: game.revision,
      } as GameCommand,
      lexicon,
    );
    if (!result.ok) throw new Error(result.error.message);
    game = result.game;
  };
  run({
    type: "play",
    placements: (["C", "A", "T"] as const).map((letter, index) => ({
      row: 7,
      col: 7 + index,
      tile: { letter, blank: false },
    })),
  });
  for (let i = 0; i < 4; i++) run({ type: "pass" });
  run({
    type: "finalize",
    reason: "blocked",
    racks: {
      ada: ["E", "E", "E", "E", "I", "I", "I"],
      ben: ["A", "A", "A", "A", "D", "O", "O"],
    },
  });
  return game;
}
const policy: GameAccess = {
  scorerUserId: "owner",
  deviceId: "device",
  generation: 1,
  mode: "confirmed",
  recordsEligible: true,
  protests: [],
  canScore: true,
  approvals: [],
};
function render(
  game: GameState,
  access: GameAccess | undefined = policy,
  hasMore = false,
) {
  return renderToStaticMarkup(
    createElement(RecordsPage, {
      games: [game],
      players: [{ id: "ada", name: "Ada" }],
      access: access ? { [game.id]: access } : undefined,
      hasMore,
      onLoadMore: () => {},
      onOpen: () => {},
      onHistory: () => {},
    }),
  );
}
it("new release games earn records while old beta games replay byte-for-byte without promotion", () => {
  const old = finished(familyLexicon),
    current = finished(releasedFamilyLexicon);
  const before = JSON.stringify(old);
  const replay = hydrateGame(JSON.parse(before), resolveLexicon(old.lexicon));
  expect(replay.ok).toBe(true);
  if (replay.ok) expect(replay.game).toEqual(old);
  expect(JSON.stringify(old)).toBe(before);
  expect(competitiveResultEligible(old)).toBe(false);
  expect(competitiveResultEligible(current)).toBe(true);
  expect(buildPlayerRecords([old, current], "ada").highestWords).toMatchObject([
    { word: "CAT", score: 10, gameId: current.id },
  ]);
  expect(render(current)).toContain("CAT");
  expect(render(old)).not.toContain("Highest scoring words");
});
it("record book excludes practice, concerns and local previews, and refuses partial rankings", () => {
  const game = finished(releasedFamilyLexicon);
  expect(render(game, { ...policy, mode: "practice" })).not.toContain(
    "Highest scoring words",
  );
  const concern = {
    id: "concern",
    reason: "Wrong score",
    reportedFor: null,
    reportedBy: "Ada",
    reportedAt: "2026-09-16T00:00:00Z",
    gameRevision: game.revision,
    resolution: null,
  };
  expect(render(game, { ...policy, protests: [concern] })).not.toContain(
    "Highest scoring words",
  );
  expect(
    renderToStaticMarkup(
      createElement(RecordsPage, {
        games: [game],
        players: [{ id: "ada", name: "Ada" }],
        hasMore: false,
        onLoadMore: () => {},
        onOpen: () => {},
        onHistory: () => {},
      }),
    ),
  ).not.toContain("Highest scoring words");
  expect(render(game, policy, true)).toContain("Load earlier games");
  expect(render(game, policy, true)).not.toContain("Highest scoring words");
});
