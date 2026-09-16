import { describe, expect, it } from "vitest";
import {
  LETTER_COUNTS,
  isTileSupply,
  countUnplayed,
  type TileSupply,
} from "../src/domain/board";
import {
  EMPTY_EQUIPMENT,
  isEquipment,
  snapshotTileSet,
  validateEquipmentChange,
  type Equipment,
} from "../src/domain/equipment";
import {
  createGame,
  applyCommand,
  hydrateGame,
  getTileTotal,
  hasCustomTileSupply,
  type GameResult,
} from "../src/domain/game";
import {
  competitiveResultEligible,
  humanTurnEligible,
} from "../src/domain/records";
import { scoreMove } from "../src/domain/scoring";
import { testLexicon } from "../src/lib/test-lexicon";
import { draftInventory } from "../src/lib/draft-inventory";
const equipment = (): Equipment => ({
  revision: 1,
  defaultSetId: "home",
  sets: [
    {
      id: "home",
      name: "Home set",
      counts: { ...LETTER_COUNTS, C: 1, "?": 1 },
      checkedAt: "2026-09-16T12:00:00.000Z",
    },
  ],
});
function success(result: GameResult) {
  if (!result.ok) throw new Error(result.error.message);
  return result.game;
}
function start(counts = equipment().sets[0].counts) {
  const set = equipment();
  set.sets[0].counts = counts;
  return success(
    createGame({
      id: "custom-game",
      players: [
        { id: "a", name: "Ada", seat: 0 },
        { id: "b", name: "Ben", seat: 2 },
      ],
      firstPlayerId: "a",
      direction: "clockwise",
      lexicon: testLexicon,
      createdAt: "2026-09-16T13:00:00.000Z",
      tileSet: snapshotTileSet(set, "home"),
    }),
  );
}
describe("saved physical tile sets", () => {
  it("accepts missing letters, custom blanks and the standard fallback", () => {
    expect(isEquipment(equipment())).toBe(true);
    expect(isEquipment(EMPTY_EQUIPMENT)).toBe(true);
    expect(isTileSupply({ ...LETTER_COUNTS, Z: 0, "?": 0 })).toBe(true);
    expect(snapshotTileSet(equipment(), null)).toBeUndefined();
  });
  it.each([-1, 0.5, NaN, Infinity, "1", 201])(
    "rejects invalid quantities %s",
    (n) => expect(isTileSupply({ ...LETTER_COUNTS, C: n })).toBe(false),
  );
  it("rejects missing keys, all-zero sets, duplicate names, sparse sets, accessors and nonexistent defaults", () => {
    const allZero = Object.fromEntries(
      Object.keys(LETTER_COUNTS).map((k) => [k, 0]),
    );
    expect(isTileSupply(allZero)).toBe(false);
    expect(isTileSupply({ C: 1 })).toBe(false);
    const e = equipment();
    expect(isEquipment({ ...e, defaultSetId: "missing" })).toBe(false);
    expect(
      isEquipment({
        ...e,
        sets: [e.sets[0], { ...e.sets[0], id: "other", name: "HOME SET" }],
      }),
    ).toBe(false);
    expect(isEquipment({ ...e, sets: new Array(1) })).toBe(false);
    const counts = { ...LETTER_COUNTS };
    Object.defineProperty(counts, "C", {
      enumerable: true,
      get() {
        throw Error("getter");
      },
    });
    expect(isEquipment({ ...e, sets: [{ ...e.sets[0], counts }] })).toBe(false);
  });
  it("rejects stale saves and deletion of a saved set", () => {
    const e = equipment();
    expect(() => validateEquipmentChange(EMPTY_EQUIPMENT, e)).not.toThrow();
    expect(() => validateEquipmentChange(e, e)).toThrow(/changed elsewhere/);
    expect(() =>
      validateEquipmentChange(e, { revision: 2, sets: [], defaultSetId: null }),
    ).toThrow(/cannot be removed/);
  });
  it("copies starting quantities and rejects not enough tiles to deal", () => {
    const e = equipment();
    const captured = snapshotTileSet(e, "home")!;
    e.sets[0].counts = { ...LETTER_COUNTS };
    expect(captured.counts.C).toBe(1);
    const game = start();
    expect(getTileTotal(game)).toBe(98);
    expect(game.expectedBagCount).toBe(84);
    const tooSmall = {
      ...game.definition,
      tileSet: {
        ...captured,
        counts: Object.fromEntries(
          Object.keys(LETTER_COUNTS).map((k) => [k, k === "A" ? 13 : 0]),
        ) as TileSupply,
      },
    };
    expect(createGame(tooSmall)).toMatchObject({
      ok: false,
      error: { code: "INVALID_TILE_SET" },
    });
  });
  it("uses missing-letter supply for scoring, exhaustion and replay while preserving blanks", () => {
    const game = start();
    const placements = [
      { row: 7, col: 7, tile: { letter: "C" as const, blank: false } },
      { row: 7, col: 8, tile: { letter: "A" as const, blank: false } },
      { row: 7, col: 9, tile: { letter: "T" as const, blank: false } },
    ];
    const played = success(
      applyCommand(
        game,
        { id: "play", expectedRevision: 0, type: "play", placements },
        testLexicon,
      ),
    );
    expect(countUnplayed(played.board, played.tileSupply!).C).toBe(0);
    const extra = [
      { row: 8, col: 7, tile: { letter: "C" as const, blank: false } },
    ];
    expect(
      scoreMove(played.board, extra, testLexicon, 7, played.tileSupply).ok,
    ).toBe(false);
    expect(
      draftInventory(played.board, extra, played.tileSupply!).exhausted.map(
        (e) => e.tile.letter,
      ),
    ).toContain("C");
    expect(countUnplayed(played.board, played.tileSupply!)["?"]).toBe(1);
    expect(hydrateGame(played, testLexicon)).toMatchObject({
      ok: true,
      game: played,
    });
    const undone = success(
      applyCommand(
        played,
        {
          id: "undo",
          expectedRevision: 1,
          type: "undo",
          reason: "Correct turn",
        },
        testLexicon,
      ),
    );
    expect(getTileTotal(undone)).toBe(98);
    expect(undone.expectedBagCount).toBe(84);
    expect(undone.definition.tileSet).toEqual(game.definition.tileSet);
  });
  it("keeps named standard sets standard and marks changed distributions nonstandard even with 100 tiles", () => {
    const standard = start({ ...LETTER_COUNTS });
    expect(standard.tileSupply).toBeUndefined();
    expect(hasCustomTileSupply(standard)).toBe(false);
    const custom = start({ ...LETTER_COUNTS, C: 1, A: 10 });
    expect(getTileTotal(custom)).toBe(100);
    expect(hasCustomTileSupply(custom)).toBe(true);
    expect(competitiveResultEligible(custom)).toBe(false);
    const turn = { id: "t", source: "human" as const };
    expect(humanTurnEligible(custom, turn as never)).toBe(false);
    expect(hydrateGame(standard, testLexicon)).toEqual({
      ok: true,
      game: standard,
    });
  });
  it("refuses snapshot tampering during hydration", () => {
    const game = start();
    const altered = structuredClone(game);
    altered.tileSupply = { ...LETTER_COUNTS };
    expect(hydrateGame(altered, testLexicon).ok).toBe(false);
  });
});
