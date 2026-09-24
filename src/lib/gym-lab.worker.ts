import { analyseScore, gradeScore } from "../domain/gym/analysis";
import { generatePuzzle, verifyPuzzle } from "../domain/gym/generator";
import { makeBudget, type Action, type Puzzle } from "../domain/gym/model";
import { coachStrategy } from "../domain/gym/coaching";
import { defaultLexicon } from "./lexicons";
export type LabRequest =
  | { id: number; type: "generate"; seed: string }
  | { id: number; type: "check" | "strategy"; puzzle: Puzzle; action: Action };
const scope = self as unknown as {
  onmessage: (event: MessageEvent<LabRequest>) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data }) => {
  const start = performance.now();
  try {
    if (!Number.isSafeInteger(data.id) || data.id < 1)
      throw new Error("Invalid request.");
    if (data.type === "generate") {
      const result = generatePuzzle(data.seed, defaultLexicon, makeBudget());
      scope.postMessage({
        id: data.id,
        type: data.type,
        ...result,
        elapsedMs: performance.now() - start,
      });
      return;
    }
    if (data.type !== "check" && data.type !== "strategy")
      throw new Error("Unknown operation.");
    verifyPuzzle(data.puzzle, defaultLexicon);
    const budget = makeBudget();
    const answer = analyseScore(data.puzzle.position, defaultLexicon, budget);
    const grade = gradeScore(
      data.puzzle.position,
      data.action,
      defaultLexicon,
      answer,
    );
    if (data.type === "check")
      scope.postMessage({
        id: data.id,
        type: data.type,
        grade,
        elapsedMs: performance.now() - start,
      });
    else {
      const strategy = coachStrategy(
        data.puzzle.position,
        defaultLexicon,
        answer,
        data.action,
        "lab-coaching-v1",
        budget,
        {
          progress: (completed) =>
            scope.postMessage({ id: data.id, type: "progress", completed }),
        },
      );
      scope.postMessage({
        id: data.id,
        type: data.type,
        strategy,
        elapsedMs: performance.now() - start,
      });
    }
  } catch (error) {
    scope.postMessage({
      id: data.id,
      type: "error",
      message:
        error instanceof Error ? error.message : "Analysis is unavailable.",
      elapsedMs: performance.now() - start,
    });
  }
};
