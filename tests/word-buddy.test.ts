import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createGame,
  hydrateGame,
  type GameResult,
  type GameState,
} from "../src/domain/game";
import {
  competitiveResultEligible,
  humanTurnEligible,
} from "../src/domain/records";
import { defaultLexicon } from "../src/lib/lexicons";
import { canPromoteWordBuddy } from "../src/lib/word-buddy";
import type { Draft } from "../src/lib/preview-store";

function ok(result: GameResult): GameState {
  if (!result.ok) throw Error(result.error.message);
  return result.game;
}
function game(wordBuddy?: boolean) {
  return ok(
    createGame({
      id: "buddy",
      players: [
        { id: "a", name: "A", seat: 0 },
        { id: "b", name: "B", seat: 2 },
      ],
      firstPlayerId: "a",
      direction: "clockwise",
      lexicon: defaultLexicon,
      ...(wordBuddy === undefined ? {} : { wordBuddy }),
    }),
  );
}
const draft: Draft = {
  revision: 0,
  row: 7,
  col: 7,
  direction: "across",
  placements: [..."CAT"].map((letter, i) => ({
    row: 7,
    col: 7 + i,
    tile: { letter: letter as "C" | "A" | "T", blank: false },
  })),
};
describe("Word Buddy", () => {
  it("preserves the setup choice through canonical hydration and leaves old definitions unchanged", () => {
    for (const enabled of [undefined, false, true]) {
      const g = game(enabled);
      expect(
        ok(hydrateGame(JSON.parse(JSON.stringify(g)), defaultLexicon)),
      ).toEqual(g);
      expect(g.definition.wordBuddy).toBe(enabled);
    }
    expect(
      createGame({
        ...game().definition,
        wordBuddy: "yes" as unknown as boolean,
      }).ok,
    ).toBe(false);
  });
  it("requires a valid current play, scorer authority, and an empty ordinary draft", () => {
    const g = game(true);
    expect(canPromoteWordBuddy(g, g, draft, undefined, true)).toBe(true);
    expect(canPromoteWordBuddy(g, g, draft, undefined, false)).toBe(false);
    expect(canPromoteWordBuddy(g, g, draft, draft, true)).toBe(false);
    expect(canPromoteWordBuddy(game(false), g, draft, undefined, true)).toBe(
      false,
    );
    expect(
      canPromoteWordBuddy({ ...g, revision: 1 }, g, draft, undefined, true),
    ).toBe(false);
    expect(
      canPromoteWordBuddy(
        { ...g, currentPlayerId: "b" },
        g,
        draft,
        undefined,
        true,
      ),
    ).toBe(false);
    expect(
      canPromoteWordBuddy(
        { ...g, status: "paused" },
        g,
        draft,
        undefined,
        true,
      ),
    ).toBe(false);
    expect(
      canPromoteWordBuddy(
        g,
        g,
        { ...draft, placements: [{ ...draft.placements[0], row: 0, col: 0 }] },
        undefined,
        true,
      ),
    ).toBe(false);
    expect(g.turns).toHaveLength(0);
    expect(g.scores).toEqual({ a: 0, b: 0 });
  });
  it("keeps normal competitive and human achievement eligibility", () => {
    for (const enabled of [false, true]) {
      let g = game(enabled);
      g = ok(
        applyCommand(
          g,
          {
            type: "play",
            placements: draft.placements,
            id: "play",
            expectedRevision: g.revision,
          },
          defaultLexicon,
        ),
      );
      for (let i = 0; i < 4; i++)
        g = ok(
          applyCommand(
            g,
            { type: "pass", id: `pass-${i}`, expectedRevision: g.revision },
            defaultLexicon,
          ),
        );
      g = ok(
        applyCommand(
          g,
          {
            type: "finalize",
            reason: "blocked",
            racks: {
              a: ["A", "B", "C", "D", "E", "F", "G"],
              b: ["H", "I", "J", "K", "L", "M", "N"],
            },
            id: "finish",
            expectedRevision: g.revision,
          },
          defaultLexicon,
        ),
      );
      expect(competitiveResultEligible(g)).toBe(true);
      expect(humanTurnEligible(g, g.turns[0])).toBe(true);
    }
  });
});
