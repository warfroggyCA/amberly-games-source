import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { it } from "vitest";
import { generatePuzzle } from "../src/domain/gym/generator";
import { compareStrategy } from "../src/domain/gym/strategy";
import { makeBudget } from "../src/domain/gym/model";
import { defaultLexicon } from "../src/lib/lexicons";

it.skipIf(process.env.SCRABBLE_GYM_BENCHMARK !== "true")(
  "measures fresh generation and full-continuation strategy without excluding failures",
  () => {
    const count = Number(process.env.SCRABBLE_GYM_BENCHMARK_COUNT ?? 100);
    if (!Number.isInteger(count) || count < 1 || count > 1000)
      throw new Error("Invalid benchmark count");
    const rows: unknown[] = [];
    const strategyCases = Number(process.env.SCRABBLE_GYM_STRATEGY_CASES ?? 1);
    if (
      !Number.isInteger(strategyCases) ||
      strategyCases < 0 ||
      strategyCases > count
    )
      throw new Error("Invalid strategy case count");
    let strategyDone = 0;
    for (let i = 0; i < count; i++) {
      const seed = `gym-feasibility-v1-${i}`;
      const start = performance.now();
      try {
        const { puzzle, answer } = generatePuzzle(
          seed,
          defaultLexicon,
          makeBudget(),
        );
        const generationMs = performance.now() - start;
        const row: Record<string, unknown> = {
          seed,
          status: "complete",
          generationMs,
          setupTurns: puzzle.setup.length,
          moves: answer.totalMoves,
          maximum: answer.maximum,
          rootCandidates: answer.candidates.length,
        };
        if (
          strategyDone < strategyCases &&
          i % Math.ceil(count / strategyCases) === 0
        ) {
          strategyDone++;
          const strategyStart = performance.now();
          let completedContinuations = 0;
          try {
            const strategy = compareStrategy(
              puzzle.position,
              defaultLexicon,
              answer,
              { type: "play", placements: answer.best[0].placements },
              "feasibility-strategy-v1",
              makeBudget(),
              {
                progress: (n) => {
                  completedContinuations = n;
                },
              },
            );
            row.strategy = {
              ...strategy,
              elapsedMs: performance.now() - strategyStart,
            };
          } catch (e) {
            row.strategy = {
              status: "unavailable",
              reason: e instanceof Error ? e.message : String(e),
              elapsedMs: performance.now() - strategyStart,
              completedContinuations,
            };
          }
        }
        rows.push(row);
      } catch (e) {
        rows.push({
          seed,
          status: "unavailable",
          generationMs: performance.now() - start,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
      writeFileSync(
        process.env.SCRABBLE_GYM_BENCHMARK_REPORT ??
          "/tmp/scrabble-gym-benchmark.json",
        JSON.stringify(
          {
            reference: defaultLexicon.id,
            node: process.version,
            count,
            completed: rows.length,
            rows,
          },
          null,
          2,
        ),
      );
    }
  },
  1_800_000,
);
