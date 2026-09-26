import { describe, expect, it } from "vitest";
import { countUnplayed, createBoard, LETTER_COUNTS } from "../src/domain/board";
import { scoreMove } from "../src/domain/scoring";
import { findMoves, type EnumerableLexicon } from "../src/domain/solver";
import type { Board, Letter, Placement } from "../src/domain/types";
import {
  analyseScore,
  exchanges,
  gradeScore,
} from "../src/domain/gym/analysis";
import { generatePuzzle, verifyPuzzle } from "../src/domain/gym/generator";
import {
  actionKey,
  advance,
  initialWorld,
  makeBudget,
  publicPosition,
  random,
  sampleWorld,
  terminalResult,
  unseenTiles,
  validateAction,
  validateWorld,
  type Physical,
  type Position,
  type World,
} from "../src/domain/gym/model";
import { compareStrategy, continueGame } from "../src/domain/gym/strategy";
import { defaultLexicon } from "../src/lib/lexicons";
const lexicon = (words: string[]): EnumerableLexicon =>
  Object.freeze({
    id: "gym-fixture",
    edition: "1",
    status: "test" as const,
    words: Object.freeze([...words]),
    has: (word: string) => words.includes(word),
  });
const letters = (word: string, row = 7, col = 7, down = false): Placement[] =>
  [...word].map((letter, i) => ({
    row: row + (down ? i : 0),
    col: col + (down ? 0 : i),
    tile: { letter: letter as Letter, blank: false },
  }));
function world(
  rack: string,
  other = "EEEEEEE",
  board: Board = createBoard(),
): World {
  const counts = countUnplayed(board);
  for (const t of rack + other)
    if (--counts[t] < 0) throw new Error("Bad fixture");
  return {
    board,
    racks: [[...rack] as Physical[], [...other] as Physical[]],
    scores: [0, 0],
    turn: 0,
    passes: 0,
    bag: Object.entries(counts).flatMap(([t, n]) =>
      Array<Physical>(n).fill(t as Physical),
    ),
  };
}
function allLettersPosition(): Position {
  return publicPosition(world("READING"));
}

describe("Gym legal generation and exact scoring", () => {
  it("replays fresh legal games with the full reference, without exposing a hidden rack or draw order", () => {
    const first = generatePuzzle(
      "gym-fixture-1",
      defaultLexicon,
      makeBudget(30_000),
    );
    expect(verifyPuzzle(first.puzzle, defaultLexicon)).toBe(true);
    const repeat = generatePuzzle(
      "gym-fixture-1",
      defaultLexicon,
      makeBudget(30_000),
    );
    expect(repeat).toEqual(first);
    const different = generatePuzzle(
      "gym-fixture-2",
      defaultLexicon,
      makeBudget(30_000),
    );
    expect(different.puzzle.position).not.toEqual(first.puzzle.position);
    expect(first.puzzle.position.rack).toHaveLength(7);
    expect(first.puzzle.position.bagCount).toBeGreaterThanOrEqual(14);
    expect(
      first.puzzle.setup.filter((t) => t.action.type === "play").length,
    ).toBeGreaterThanOrEqual(2);
    expect(first.puzzle.position).not.toHaveProperty("bag");
    expect(first.puzzle.position).not.toHaveProperty("racks");
    expect(first.answer.maximum).toBeGreaterThan(0);
    const broken = structuredClone(first.puzzle);
    broken.setup[0].score++;
    expect(() => verifyPuzzle(broken, defaultLexicon)).toThrow(
      "score mismatch",
    );
  }, 60_000);
  it("counts the complete score distribution independently of the retained result count", () => {
    const dictionary = lexicon(["AT", "ATE", "TEA", "EAT", "TA", "ET"]);
    const position = publicPosition(
      world("ATE????".replace("????", "RRIN"), "OOOOOOO"),
    );
    const all = findMoves(position.board, position.rack, dictionary, {
      limit: 100_000,
    });
    expect(all.status).toBe("complete");
    const summary = analyseScore(position, dictionary, makeBudget());
    const histogram = new Map<number, number>();
    for (const move of all.moves)
      histogram.set(move.score, (histogram.get(move.score) ?? 0) + 1);
    expect(summary.histogram).toEqual(
      [...histogram]
        .map(([score, count]) => ({ score, count }))
        .sort((a, b) => b.score - a.score),
    );
    expect(summary.totalMoves).toBe(all.moves.length);
    expect(summary.best.map((move) => move.score)).toEqual(
      summary.histogram.slice(0, 3).map((bucket) => bucket.score),
    );
    expect(summary.histogram.reduce((n, b) => n + b.count, 0)).toBe(
      all.moves.length,
    );
    for (const move of all.moves) {
      const grade = gradeScore(
        position,
        { type: "play", placements: move.placements },
        dictionary,
        summary,
      );
      expect(grade.rank).toBe(
        1 + all.moves.filter((m) => m.score > move.score).length,
      );
    }
    expect(() =>
      analyseScore(position, dictionary, makeBudget(1000, 1)),
    ).toThrow("incomplete");
    expect(() =>
      analyseScore(position, dictionary, { ...makeBudget(), deadline: 0 }),
    ).toThrow("budget");
  });
  it("streams each unique placement once and preserves existing top-N search behavior", () => {
    const dictionary = lexicon(["AT", "ATE", "TEA", "EAT"]);
    const observed: string[] = [];
    const result = findMoves(createBoard(), ["A", "T", "E"], dictionary, {
      limit: 1,
      onMove: (m) => observed.push(m.key),
    });
    expect(result.moves).toHaveLength(1);
    expect(new Set(observed).size).toBe(result.totalMoves);
    expect(observed.length).toBeGreaterThan(1);
    expect(result).toEqual(
      findMoves(createBoard(), ["A", "T", "E"], dictionary, { limit: 1 }),
    );
  });
  it("rejects unavailable references and incomplete searches instead of claiming maxima", () => {
    const p = allLettersPosition();
    expect(() =>
      analyseScore(
        p,
        { ...defaultLexicon, status: "unavailable" },
        makeBudget(),
      ),
    ).toThrow("unavailable");
    expect(() =>
      analyseScore(p, defaultLexicon, {
        ...makeBudget(),
        signal: AbortSignal.abort(),
      }),
    ).toThrow("cancelled");
  });
  it("enforces exact physical rack ownership, including repeated letters and blanks", () => {
    const p = publicPosition(world("CAT?RST"));
    expect(
      validateAction(
        p,
        { type: "play", placements: letters("CAT") },
        defaultLexicon,
      ),
    ).toBe(10);
    expect(() =>
      validateAction(
        p,
        { type: "play", placements: letters("CATTT") },
        lexicon(["CATTT"]),
      ),
    ).toThrow("another T");
    const blank = letters("CATS");
    blank[3] = { ...blank[3], tile: { letter: "S", blank: true } };
    const played = advance(
      world("CAT?RST"),
      { type: "play", placements: blank },
      defaultLexicon,
      random("blank"),
    );
    expect(played.board[7][10]).toEqual({ letter: "S", blank: true });
    validateWorld(played);
    expect(() =>
      validateAction(
        publicPosition(world("CATRRST")),
        { type: "play", placements: blank },
        defaultLexicon,
      ),
    ).toThrow("another ?");
  });
  it("scores hooks, crosswords, used premiums and bingos with the shared scorer", () => {
    const first = scoreMove(createBoard(), letters("CAT"), defaultLexicon);
    if (!first.ok) throw new Error("fixture");
    const p = publicPosition(world("SRETAIN", "EEEEEEE", first.board));
    const action = { type: "play" as const, placements: letters("S", 7, 10) };
    expect(validateAction(p, action, defaultLexicon)).toBe(6);
    const bingo = {
      type: "play" as const,
      placements: letters("READING", 7, 4),
    };
    const normal = scoreMove(createBoard(), bingo.placements, defaultLexicon);
    expect(normal.ok && normal.bingo).toBe(50);
    expect(validateAction(allLettersPosition(), bingo, defaultLexicon)).toBe(
      normal.ok ? normal.score : -1,
    );
  });
});
describe("Gym physical simulation and information boundaries", () => {
  it("draws an exchange before returning discarded tiles and conserves the full set", () => {
    const before = world("CATRRST");
    const top = before.bag.slice(0, 2);
    const after = advance(
      before,
      { type: "exchange", tiles: ["C", "T"] },
      defaultLexicon,
      random("exchange"),
    );
    expect(after.racks[0]).toEqual(["A", "R", "R", "S", "T", ...top]);
    expect(after.bag.length).toBe(before.bag.length);
    expect(before.racks[0].join("")).toBe("CATRRST");
    validateWorld(after);
    expect(() =>
      advance(
        before,
        { type: "exchange", tiles: ["Z"] },
        defaultLexicon,
        random("x"),
      ),
    ).toThrow();
  });
  it("enumerates distinct legal exchange subsets and applies the family bag-count rule", () => {
    const options = exchanges(["A", "A", "?"], 1);
    expect(options.map(actionKey).sort()).toEqual(["exchange:?", "exchange:A"]);
    expect(exchanges(["A"], 0)).toEqual([]);
  });
  it("samples only from public unseen tiles; every world conserves all 100 tiles", () => {
    const original = initialWorld("information-boundary");
    const view = publicPosition(original);
    const a = sampleWorld(view, "evaluation-1");
    original.bag.reverse();
    original.racks[1].reverse();
    expect(sampleWorld(publicPosition(original), "evaluation-1")).toEqual(a);
    const b = sampleWorld(view, "evaluation-2");
    expect(b).not.toEqual(a);
    validateWorld(a);
    validateWorld(b);
    expect(unseenTiles(view).length).toBe(view.bagCount + view.opponentCount);
    expect(() =>
      sampleWorld({ ...view, bagCount: view.bagCount - 1 }, "bad"),
    ).toThrow("conserve");
    expect(() => sampleWorld({ ...view, rack: ["Z", "Z"] }, "bad")).toThrow(
      "tile set",
    );
    expect(Object.values(LETTER_COUNTS).reduce((n, v) => n + v, 0)).toBe(100);
  });
  it("ends only after four consecutive passes and applies rack deductions/pre-adjustment tiebreak", () => {
    let state = world("A", "BC");
    state.scores = [10, 15];
    for (let i = 0; i < 3; i++) {
      state = advance(state, { type: "pass" }, defaultLexicon, random("p"));
      expect(terminalResult(state)).toBeNull();
    }
    state = advance(state, { type: "pass" }, defaultLexicon, random("p"));
    // Both finish on 9; the pre-adjustment score of 15 beats 10.
    expect(terminalResult(state)).toBe(0);
    expect(() =>
      advance(state, { type: "pass" }, defaultLexicon, random("p")),
    ).toThrow("ended");
  });
  it("transfers the other rack value on a natural rack-out", () => {
    // Terminal arithmetic uses no lexicon; exact tile inventory is covered separately.
    const state = world("", "Z");
    state.bag = [];
    state.scores = [20, 25];
    expect(terminalResult(state)).toBe(1); // 30 versus 15
    state.scores = [0, 20];
    expect(terminalResult(state)).toBe(0); // 10-10, opponent wins tiebreak
  });
  it("uses complete continuations and fresh validation worlds; no capped-game averaging", () => {
    const dictionary = lexicon(["ZZ"]);
    const state = world("AEINRST", "AEINRST");
    const p = publicPosition(state);
    const summary = analyseScore(p, dictionary, makeBudget());
    const options = { discoverySamples: 2, validationSamples: 4 };
    const first = compareStrategy(
      p,
      dictionary,
      { ...summary, candidates: [{ type: "pass" }] },
      { type: "pass" },
      "comparison",
      makeBudget(),
      options,
    );
    const repeated = compareStrategy(
      p,
      dictionary,
      { ...summary, candidates: [{ type: "pass" }] },
      { type: "pass" },
      "comparison",
      makeBudget(),
      options,
    );
    expect(first).toEqual(repeated);
    expect(first.completedContinuations).toBe(6);
    expect(first.gap).toBe(0);
    expect(first.gapInterval).toEqual([0, 0]);
    expect(() =>
      continueGame(state, dictionary, makeBudget(), "capped", 1),
    ).toThrow("valid ending");
    expect(() =>
      compareStrategy(
        p,
        dictionary,
        summary,
        { type: "pass" },
        "timeout",
        { ...makeBudget(), deadline: 0 },
        options,
      ),
    ).toThrow("budget");
  });
});
