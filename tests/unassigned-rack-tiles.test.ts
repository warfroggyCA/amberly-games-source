import { describe, it, expect } from "vitest";
import { createGame, type GameState } from "../src/domain/game";
import { LETTER_COUNTS } from "../src/domain/board";
import { testLexicon } from "../src/lib/test-lexicon";
import { unassignedRackTiles } from "../src/lib/unassigned-rack-tiles";
function ending(pool = "IIIIEU") {
  const made = createGame({
    id: "ending-pool",
    players: [
      { id: "erin", name: "Erin", seat: 0 },
      { id: "froggy", name: "Froggy", seat: 1 },
      { id: "braeden", name: "Braeden", seat: 2 },
      { id: "cici", name: "Cici", seat: 3 },
    ],
    firstPlayerId: "erin",
    direction: "clockwise",
    lexicon: testLexicon,
  });
  if (!made.ok) throw Error(made.error.message);
  const game: GameState = structuredClone(made.game);
  const left = { ...LETTER_COUNTS } as Record<string, number>;
  for (const letter of pool) left[letter]--;
  const board = game.board.map((row) => [...row]);
  let index = 0;
  for (const [letter, count] of Object.entries(left))
    for (let n = 0; n < count; n++) {
      board[Math.floor(index / 15)][index % 15] = {
        letter: (letter === "?" ? "A" : letter) as "A",
        blank: letter === "?",
      };
      index++;
    }
  game.board = board;
  game.expectedBagCount = 0;
  game.expectedRackCounts = {
    erin: 3,
    froggy: 2,
    braeden: 0,
    cici: pool.length - 5,
  };
  game.pendingEnd = "natural";
  return game;
}
describe("ending inventory presentation", () => {
  it("allocates Erin III, Froggy IE, Braeden empty and Cici U without losing multiplicities", () => {
    const game = ending();
    expect(unassignedRackTiles(game, {})).toMatchObject({
      ok: true,
      allRacks: true,
      total: 6,
      unassigned: 6,
      remaining: { I: 4, E: 1, U: 1 },
    });
    expect(
      unassignedRackTiles(game, {
        erin: "III",
        froggy: "IE",
        braeden: "",
        cici: "U",
      }),
    ).toMatchObject({ ok: true, allocated: 6, unassigned: 0 });
    expect(
      unassignedRackTiles(game, { erin: "II", froggy: "IE", cici: "U" }),
    ).toMatchObject({ ok: true, unassigned: 1, remaining: { I: 1 } });
  });
  it("counts a represented board blank as blank supply and leaves physical blanks distinct", () => {
    const game = ending("IIIIE?");
    expect(
      unassignedRackTiles(game, { erin: "III", froggy: "IE" }),
    ).toMatchObject({ ok: true, unassigned: 1, remaining: { "?": 1, A: 0 } });
    expect(
      unassignedRackTiles(game, { erin: "III", froggy: "IE", cici: "?" }),
    ).toMatchObject({ ok: true, unassigned: 0 });
  });
  it("rejects over-allocation, Unicode expansion, excessive racks and inconsistent counts", () => {
    const game = ending();
    for (const input of [
      { erin: "III", froggy: "II" },
      { erin: "ß" },
      { erin: "IIII" },
    ] as Record<string, string>[])
      expect(unassignedRackTiles(game, input).ok).toBe(false);
    game.expectedBagCount = 1;
    expect(unassignedRackTiles(game, {}).ok).toBe(false);
  });
  it("does not claim bag tiles are definitely in racks or infer a natural ending", () => {
    const game = ending();
    game.expectedBagCount = 1;
    game.expectedRackCounts.cici = 0;
    game.pendingEnd = null;
    expect(unassignedRackTiles(game, {})).toMatchObject({
      ok: true,
      allRacks: false,
      unassigned: 6,
    });
  });
  it("recomputes a restored or corrected draft without mutating game state", () => {
    const game = ending();
    const original = JSON.stringify(game);
    expect(
      unassignedRackTiles(game, { erin: "i i i", froggy: "i e", cici: "u" }),
    ).toMatchObject({ ok: true, unassigned: 0 });
    expect(
      unassignedRackTiles(game, { erin: "II", froggy: "IE", cici: "U" }),
    ).toMatchObject({ ok: true, unassigned: 1 });
    expect(JSON.stringify(game)).toBe(original);
  });
});
