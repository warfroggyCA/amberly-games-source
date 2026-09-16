import { describe, expect, it } from "vitest";
import type { GameTurn } from "../src/domain/game";
import { newlyObservedPlay, spectatorWords } from "../src/lib/spectator-plays";

const turn = (id: string, overrides: Partial<GameTurn> = {}): GameTurn => ({
  id,
  number: 1,
  round: 1,
  type: "play",
  playerId: "doug",
  score: 6,
  words: [{ word: "CAT", score: 6, row: 7, col: 7, direction: "across" }],
  source: "human",
  placements: [],
  bingo: false,
  newTileCount: 3,
  runningScores: { doug: 6 },
  ...overrides,
});
const snapshot = (turns: GameTurn[], id = "game") => ({
  id,
  turns,
  status: "active" as const,
});

describe("viewer word attribution", () => {
  it("keeps original and extended words attached to their own player, turn, and score", () => {
    const initial = turn("cat");
    const extension = turn("cats", {
      playerId: "erin",
      score: 5,
      round: 2,
      words: [{ word: "CATS", score: 5, row: 7, col: 7, direction: "across" }],
    });
    const words = spectatorWords([initial, extension]);
    expect(words.map((w) => [w.word, w.playerId, w.score, w.round])).toEqual([
      ["CAT", "doug", 6, 1],
      ["CATS", "erin", 5, 2],
    ]);
    expect(words[0].cells).toEqual(["7:7", "7:8", "7:9"]);
    expect(words[1].cells).toEqual(["7:7", "7:8", "7:9", "7:10"]);
    expect(words[0].id).not.toBe(words[1].id);
  });
  it("indexes every crossword and preserves assisted labels and whole-turn scores", () => {
    const words = spectatorWords([
      turn("cross", {
        score: 12,
        source: "assisted",
        words: [
          { word: "CAT", score: 6, row: 7, col: 7, direction: "across" },
          { word: "AT", score: 6, row: 7, col: 8, direction: "down" },
        ],
      }),
    ]);
    expect(words.filter((w) => w.cells.includes("7:8"))).toHaveLength(2);
    expect(words[1].cells).toEqual(["7:8", "8:8"]);
    expect(
      words.every((w) => w.source === "assisted" && w.turnScore === 12),
    ).toBe(true);
    expect(spectatorWords([turn("pass", { type: "pass", words: [] })])).toEqual(
      [],
    );
  });
});
describe("viewer incoming-turn animation", () => {
  const a = turn("a"),
    b = turn("b"),
    c = turn("c");
  it("animates a newly appended play, using only the latest turn if several arrive", () => {
    expect(newlyObservedPlay(snapshot([a]), snapshot([a, b]))).toBe(b);
    expect(newlyObservedPlay(snapshot([]), snapshot([a, b, c]))).toBe(c);
  });
  it("does not replay first-loaded or repeatedly polled history", () => {
    expect(newlyObservedPlay(snapshot([a, b]), snapshot([a, b]))).toBeNull();
    expect(
      newlyObservedPlay(
        snapshot([a, b]),
        snapshot([structuredClone(a), structuredClone(b)]),
      ),
    ).toBeNull();
  });
  it("does not celebrate undo, replacement history, a different game, finalization, or a pass", () => {
    expect(newlyObservedPlay(snapshot([a, b]), snapshot([a]))).toBeNull();
    expect(newlyObservedPlay(snapshot([a]), snapshot([b, c]))).toBeNull();
    expect(
      newlyObservedPlay(snapshot([a]), snapshot([a, b], "other")),
    ).toBeNull();
    expect(
      newlyObservedPlay(snapshot([a]), {
        ...snapshot([a, b]),
        status: "finalized",
      }),
    ).toBeNull();
    expect(
      newlyObservedPlay(
        snapshot([a]),
        snapshot([a, turn("pass", { type: "pass", words: [] })]),
      ),
    ).toBeNull();
  });
});
