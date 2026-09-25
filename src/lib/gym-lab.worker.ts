import { catalogueMoves } from "../domain/gym/move-catalog";
import { validGymDraft, type GymDraft } from "./gym-draft";
import { extendLexicon, type VerifiedWord } from "../domain/verified-words";
import { analyseScore, gradeScore } from "../domain/gym/analysis";
import { generatePuzzle, verifyPuzzle } from "../domain/gym/generator";
import { makeBudget, type Action, type Puzzle } from "../domain/gym/model";
import { coachStrategy } from "../domain/gym/coaching";
import { defaultLexicon } from "./lexicons";
export type LabRequest = (
  | { id: number; type: "generate"; seed: string }
  | { id: number; type: "refresh"; puzzle: Puzzle }
  | { id: number; type: "all-moves"; puzzle: Puzzle }
  | { id: number; type: "restore"; puzzle: Puzzle; snapshot: GymDraft }
  | { id: number; type: "check" | "strategy"; puzzle: Puzzle; action: Action }
) & { words?: VerifiedWord[] };
const scope = self as unknown as {
  onmessage: (event: MessageEvent<LabRequest>) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data }) => {
  const start = performance.now();
  try {
    if (!Number.isSafeInteger(data.id) || data.id < 1)
      throw new Error("Invalid request.");
    const lexicon = extendLexicon(defaultLexicon, data.words ?? []);
    if (data.type === "generate") {
      const result = generatePuzzle(data.seed, defaultLexicon, makeBudget());
      scope.postMessage({
        id: data.id,
        type: data.type,
        ...result,
        answer: data.words?.length
          ? analyseScore(result.puzzle.position, lexicon, makeBudget())
          : result.answer,
        elapsedMs: performance.now() - start,
      });
      return;
    }
    if (
      data.type !== "check" &&
      data.type !== "strategy" &&
      data.type !== "refresh" &&
      data.type !== "restore" &&
      data.type !== "all-moves"
    )
      throw new Error("Unknown operation.");
    if (
      data.type === "restore" &&
      (!validGymDraft(data.snapshot) ||
        JSON.stringify(data.snapshot.puzzle) !== JSON.stringify(data.puzzle))
    )
      throw new Error(
        "Saved practice is invalid. Start a new puzzle when ready.",
      );
    verifyPuzzle(data.puzzle, defaultLexicon);
    if (data.type === "all-moves") {
      scope.postMessage({
        id: data.id,
        type: data.type,
        catalogue: catalogueMoves(data.puzzle.position, lexicon),
      });
      return;
    }
    const budget = makeBudget();
    const answer = analyseScore(data.puzzle.position, lexicon, budget);
    if (data.type === "refresh" || data.type === "restore") {
      scope.postMessage({ id: data.id, type: data.type, answer });
      return;
    }
    const grade = gradeScore(
      data.puzzle.position,
      data.action,
      lexicon,
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
        lexicon,
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
