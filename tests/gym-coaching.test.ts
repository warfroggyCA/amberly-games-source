import { expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { coachStrategy } from "../src/domain/gym/coaching";
import { generatePuzzle } from "../src/domain/gym/generator";
import { actionKey, makeBudget } from "../src/domain/gym/model";
import { defaultLexicon } from "../src/lib/lexicons";

it("compares fresh paired reply samples reproducibly without changing the puzzle", () => {
  const { puzzle, answer } = generatePuzzle(
    "coaching-regression",
    defaultLexicon,
    makeBudget(),
  );
  const before = JSON.stringify(puzzle);
  const requested = {
    type: "play" as const,
    placements: answer.best[0].placements,
  };
  const options = { discoverySamples: 2, validationSamples: 2 };
  const first = coachStrategy(
    puzzle.position,
    defaultLexicon,
    answer,
    requested,
    "paired",
    makeBudget(),
    options,
  );
  const second = coachStrategy(
    puzzle.position,
    defaultLexicon,
    answer,
    requested,
    "paired",
    makeBudget(),
    options,
  );
  expect(first).toEqual(second);
  expect(JSON.stringify(puzzle)).toBe(before);
  expect(first.requested.points).toBe(answer.maximum);
  expect(first.requested.estimate).toBeCloseTo(
    first.requested.points -
      first.requested.replyPoints +
      first.requested.rackBalance,
  );
  expect(first.gap).toBeCloseTo(
    first.recommended.estimate - first.requested.estimate,
  );
  const same =
    actionKey(first.requested.action) === actionKey(first.recommended.action);
  expect(first.completedSamples).toBe(first.considered * 2 + (same ? 2 : 4));
  expect(first.sampleGapRange[0]).toBeLessThanOrEqual(first.gap);
  expect(first.sampleGapRange[1]).toBeGreaterThanOrEqual(first.gap);
  expect(() =>
    coachStrategy(
      puzzle.position,
      defaultLexicon,
      answer,
      requested,
      "paired",
      { ...makeBudget(), deadline: 0 },
    ),
  ).toThrow("budget");
  expect(() =>
    coachStrategy(
      puzzle.position,
      defaultLexicon,
      answer,
      requested,
      "paired",
      makeBudget(),
      { validationSamples: 0 },
    ),
  ).toThrow("sample count");
  expect(() =>
    coachStrategy(
      puzzle.position,
      defaultLexicon,
      answer,
      requested,
      "paired",
      makeBudget(15000, 1),
    ),
  ).toThrow("search did not complete");
}, 30000);

it.skipIf(process.env.SCRABBLE_GYM_COACHING_BENCHMARK !== "true")(
  "benchmarks sampled coaching including failures",
  () => {
    const count = Number(process.env.SCRABBLE_GYM_COACHING_CASES ?? 10);
    if (!Number.isInteger(count) || count < 1 || count > 100)
      throw new Error("Invalid benchmark count");
    const rows: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const seed = `gym-feasibility-v1-${i}`;
      const start = performance.now();
      try {
        const { puzzle, answer } = generatePuzzle(
          seed,
          defaultLexicon,
          makeBudget(),
        );
        const generated = performance.now();
        try {
          const result = coachStrategy(
            puzzle.position,
            defaultLexicon,
            answer,
            { type: "play", placements: answer.best[0].placements },
            "coaching-benchmark",
            makeBudget(),
          );
          rows.push({
            seed,
            status: "complete",
            generationMs: generated - start,
            coachingMs: performance.now() - generated,
            result,
          });
        } catch (error) {
          rows.push({
            seed,
            status: "coaching-unavailable",
            coachingMs: performance.now() - generated,
            error: String(error),
          });
        }
      } catch (error) {
        rows.push({
          seed,
          status: "generation-unavailable",
          error: String(error),
        });
      }
      writeFileSync(
        "/tmp/gym-coaching-benchmark.json",
        JSON.stringify(
          { reference: defaultLexicon.id, node: process.version, count, rows },
          null,
          2,
        ),
      );
    }
  },
  1800000,
);

it("includes an off-shortlist user action and rejects incomplete or unsupported comparisons", () => {
  const { puzzle, answer } = generatePuzzle(
    "coaching-boundaries",
    defaultLexicon,
    makeBudget(),
  );
  const requested = {
    type: "play" as const,
    placements: answer.best.at(-1)!.placements,
  };
  const result = coachStrategy(
    puzzle.position,
    defaultLexicon,
    { ...answer, candidates: [] },
    requested,
    "boundaries",
    makeBudget(),
    { discoverySamples: 2, validationSamples: 2 },
  );
  expect(result.considered).toBe(1);
  expect(result.verdict).toBe("same");
  expect(result.gap).toBe(0);
  expect(result.sampleGapRange).toEqual([0, 0]);
  const budget = makeBudget();
  expect(() =>
    coachStrategy(
      puzzle.position,
      defaultLexicon,
      answer,
      requested,
      "boundaries",
      budget,
      {
        progress: () => {
          budget.deadline = 0;
        },
      },
    ),
  ).toThrow("budget");
  expect(() =>
    coachStrategy(
      { ...puzzle.position, passes: 1 },
      defaultLexicon,
      answer,
      requested,
      "boundaries",
      makeBudget(),
    ),
  ).toThrow("midgame");
  expect(() =>
    coachStrategy(
      puzzle.position,
      defaultLexicon,
      answer,
      { type: "play", placements: [] },
      "boundaries",
      makeBudget(),
    ),
  ).toThrow();
}, 30000);

it("handles varied racks, blanks, crosses, exchanges and pass without claiming odds", async () => {
  const { createBoard } = await import("../src/domain/board");
  const { analyseScore } = await import("../src/domain/gym/analysis");
  const dictionaryWords = Object.freeze([
    "AT",
    "TA",
    "ART",
    "RAT",
    "TAR",
    "ATE",
    "EAT",
    "TEA",
    "STAR",
    "RATS",
    "SAT",
    "AS",
    "IT",
    "IS",
    "QI",
    "ZA",
  ]);
  const dictionary = Object.freeze({
    id: "coaching-fixtures",
    edition: "1",
    status: "test" as const,
    words: dictionaryWords,
    has: (word: string) => dictionaryWords.includes(word),
  });
  for (const rack of [
    "AEINRST",
    "??AEIRS",
    "QAEIRST",
    "AEIOUAA",
    "RSTNNLL",
    "ZAEIRST",
    "SSAEIRT",
    "AAEIRST",
    "JAEIRST",
    "VAEIRST",
  ]) {
    const board = createBoard().map((row) => [...row]);
    board[7][7] = { letter: "A", blank: false };
    board[7][8] = { letter: "T", blank: false };
    const position = {
      board,
      rack: [...rack] as import("../src/domain/gym/model").Physical[],
      scores: [10, 20] as [number, number],
      opponentCount: 7,
      bagCount: 84,
      passes: 0,
    };
    const summary = analyseScore(position, dictionary, makeBudget());
    for (const action of [
      { type: "pass" as const },
      { type: "exchange" as const, tiles: [position.rack[0]] },
    ]) {
      const result = coachStrategy(
        position,
        dictionary,
        summary,
        action,
        "fixtures",
        makeBudget(),
        { discoverySamples: 2, validationSamples: 2 },
      );
      expect(result.requested.points).toBe(0);
      expect(result.requested.retained.length).toBe(
        action.type === "pass" ? 7 : 6,
      );
      expect(Number.isFinite(result.gap)).toBe(true);
      expect(result.considered).toBeGreaterThan(1);
      expect(result).not.toHaveProperty("requestedEstimate");
    }
  }
});
