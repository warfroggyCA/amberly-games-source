import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createBoard } from "../src/domain/board";
import { scoreMove } from "../src/domain/scoring";
import {
  findMoves,
  verifyMoveExists,
  type EnumerableLexicon,
} from "../src/domain/solver";
import type { Board, Letter, Placement } from "../src/domain/types";
import { defaultLexicon } from "../src/lib/lexicons";
import { testLexicon } from "../src/lib/test-lexicon";

const full = defaultLexicon;
const placement = (
  word: string,
  row: number,
  col: number,
  down = false,
): Placement[] =>
  [...word].map((letter, index) => ({
    row: row + (down ? index : 0),
    col: col + (down ? 0 : index),
    tile: { letter: letter as Letter, blank: false },
  }));
function play(board: Board, tiles: Placement[]): Board {
  const result = scoreMove(board, tiles, full);
  if (!result.ok) throw new Error(result.error.message);
  return result.board;
}
function middleBoard(): Board {
  let board = play(createBoard(), placement("CAT", 7, 7));
  board = play(board, placement("S", 7, 10));
  board = play(board, placement("OW", 8, 7, true));
  return play(board, placement("ARS", 9, 8));
}

// This checks the bundled approved asset. Missing data cannot be mistaken for a passing test.
describe("full family-union solver acceptance and timing", () => {
  it("uses full-file words while preserving the legacy examples for historical games", () => {
    expect(full.words).toHaveLength(176_974);
    expect(full.has("BOTHER")).toBe(true);
    expect(testLexicon.has("BOTHER")).toBe(false);
    const all = findMoves(createBoard(), [..."BOTHER"], full, {
      limit: 100_000,
      maxNodes: 250_000,
    });
    expect(all.status).toBe("complete");
    expect(
      all.moves.some((move) =>
        move.words.some((word) => word.word === "BOTHER"),
      ),
    ).toBe(true);
    const old = findMoves(createBoard(), [..."BOTHER"], testLexicon, {
      limit: 100_000,
    });
    expect(old.status).toBe("complete");
    expect(
      old.moves.some((move) =>
        move.words.some((word) => word.word === "BOTHER"),
      ),
    ).toBe(false);
  }, 60_000);
  it("reports cold/warm timing and honest completion status for realistic and blank-heavy racks", () => {
    const scenarios = [
      { name: "opening typical", board: createBoard(), rack: [..."READING"] },
      {
        name: "opening two blanks",
        board: createBoard(),
        rack: [..."AEIRS??"],
      },
      { name: "midgame typical", board: middleBoard(), rack: [..."RETAINS"] },
      {
        name: "midgame two blanks",
        board: middleBoard(),
        rack: [..."AEIRS??"],
      },
    ];
    for (const scenario of scenarios) {
      const local: EnumerableLexicon = Object.freeze({ ...full });
      for (const temperature of ["cold", "warm"]) {
        const start = performance.now();
        const result = findMoves(scenario.board, scenario.rack, local, {
          maxNodes: 250_000,
        });
        console.info(
          JSON.stringify({
            solverBenchmark: scenario.name,
            temperature,
            elapsedMs: Math.round(performance.now() - start),
            status: result.status,
            ...("reason" in result ? { reason: result.reason } : {}),
            visitedNodes: result.visitedNodes,
            totalMoves: result.totalMoves,
            top: result.moves[0]?.words.map((word) => word.word).join("+"),
            score: result.moves[0]?.score,
          }),
        );
        expect(["complete", "incomplete"]).toContain(result.status);
        if (result.status === "incomplete")
          expect(result.reason).toBe("node-budget");
        for (const move of result.moves)
          expect(
            scoreMove(
              scenario.board,
              move.placements,
              full,
              scenario.rack.length,
            ),
          ).toMatchObject({ ok: true, score: move.score });
      }
      const started = performance.now();
      const existence = verifyMoveExists(scenario.board, scenario.rack, local, {
        maxNodes: 250_000,
      });
      console.info(
        JSON.stringify({
          solverExistenceBenchmark: scenario.name,
          elapsedMs: Math.round(performance.now() - started),
          status: existence.status,
          visitedNodes: existence.visitedNodes,
        }),
      );
      expect(existence.status).toBe("found");
    }
  }, 120_000);
  it("completes the representative two-blank racks within the worker budget", () => {
    for (const [name, board] of [
      ["opening", createBoard()],
      ["midgame", middleBoard()],
    ] as const) {
      const start = performance.now();
      const result = findMoves(board, [..."AEIRS??"], full, {
        maxNodes: 2_000_000,
      });
      console.info(
        JSON.stringify({
          expandedBudgetBenchmark: name,
          elapsedMs: Math.round(performance.now() - start),
          status: result.status,
          visitedNodes: result.visitedNodes,
          totalMoves: result.totalMoves,
        }),
      );
      expect(result.status).toBe("complete");
      expect(result.visitedNodes).toBeLessThan(2_000_000);
      for (const move of result.moves)
        expect(scoreMove(board, move.placements, full)).toMatchObject({
          ok: true,
          score: move.score,
        });
    }
  }, 120_000);
});
