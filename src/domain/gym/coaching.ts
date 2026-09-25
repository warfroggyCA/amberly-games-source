import type { EnumerableLexicon } from "../solver";
import { scoreMove } from "../scoring";
import { leaveValue, type ScoreSummary } from "./analysis";
import { choosePolicy } from "./strategy";
import {
  actionKey,
  advance,
  checkBudget,
  consumedTiles,
  GymUnavailable,
  random,
  removeTiles,
  sampleWorld,
  validateAction,
  type Action,
  type Budget,
  type Physical,
  type Position,
} from "./model";

export const COACHING_POLICY = "sampled-reply-rack-v1";
export interface CoachingMove {
  action: Action;
  label: string;
  points: number;
  retained: Physical[];
  replyPoints: number;
  rackBalance: number;
  estimate: number;
}
export interface StrategyCoaching {
  policy: typeof COACHING_POLICY;
  horizon: "opponent-reply";
  requested: CoachingMove;
  recommended: CoachingMove;
  gap: number;
  /** Observed paired range only, not a confidence interval. */
  sampleGapRange: [number, number];
  verdict: "same" | "favoured" | "uncertain";
  considered: number;
  available: number;
  discoverySamples: number;
  validationSamples: number;
  completedSamples: number;
}
export interface CoachingProgress {
  phase: "discovery" | "validation";
  /** Work completed, not an estimate of time remaining. */
  percentage: number;
}
export interface CoachingOptions {
  discoverySamples?: number;
  validationSamples?: number;
  progress?: (completed: number, progress: CoachingProgress) => void;
}

/** Midgame heuristic, never a winning-odds estimator. No synthetic hidden state is accepted. */
export function coachStrategy(
  position: Position,
  lexicon: EnumerableLexicon,
  summary: ScoreSummary,
  requested: Action,
  seed: string,
  budget: Budget,
  options: CoachingOptions = {},
): StrategyCoaching {
  checkBudget(budget);
  validateAction(position, requested, lexicon);
  if (position.bagCount < 14 || position.passes !== 0)
    throw new GymUnavailable(
      "Short-horizon coaching requires a midgame position with at least fourteen tiles in the bag and no consecutive passes.",
    );
  const discoverySamples = options.discoverySamples ?? 4;
  const validationSamples = options.validationSamples ?? 12;
  if (
    ![discoverySamples, validationSamples].every(
      (n) => Number.isInteger(n) && n >= 2 && n <= 64,
    )
  )
    throw new Error("Invalid coaching sample count.");
  const candidates = new Map(
    summary.candidates.map((action) => [actionKey(action), action]),
  );
  candidates.set(actionKey(requested), requested);
  if (candidates.size > 32)
    throw new Error("Coaching shortlist exceeds its supported size.");
  const metadata = new Map(
    [...candidates].map(([key, action]) => [
      key,
      {
        label: describeAction(position, action, lexicon),
        points: validateAction(position, action, lexicon),
        retained: removeTiles(position.rack, consumedTiles(action)),
      },
    ]),
  );
  let completedSamples = 0;
  let validationWork = validationSamples * 2;
  const discoveryWork = candidates.size * discoverySamples;
  const report = (phase: CoachingProgress["phase"]) =>
    options.progress?.(completedSamples, {
      phase,
      percentage:
        phase === "discovery"
          ? (50 * completedSamples) / discoveryWork
          : 50 + (50 * (completedSamples - discoveryWork)) / validationWork,
    });
  report("discovery");
  const run = (
    action: Action,
    phase: CoachingProgress["phase"],
    index: number,
  ): CoachingMove => {
    checkBudget(budget);
    const worldSeed = `${seed}:${phase}:${index}`;
    const started = advance(
      sampleWorld(position, worldSeed),
      action,
      lexicon,
      random(`${worldSeed}:draw`),
    );
    const replyView: Position = {
      board: started.board,
      rack: started.racks[1],
      scores: [started.scores[1], started.scores[0]],
      opponentCount: started.racks[0].length,
      bagCount: started.bag.length,
      passes: started.passes,
    };
    // Policy receives only its own rack and public information.
    const reply = choosePolicy(replyView, lexicon, budget);
    const replied = advance(
      started,
      reply,
      lexicon,
      random(`${worldSeed}:reply`),
    );
    checkBudget(budget);
    const { points, retained, label } = metadata.get(actionKey(action))!;
    const replyPoints = replied.scores[1] - started.scores[1];
    const rackBalance =
      leaveValue(replied.racks[0]) - leaveValue(replied.racks[1]);
    completedSamples++;
    report(phase);
    checkBudget(budget);
    return {
      action,
      label,
      points,
      retained,
      replyPoints,
      rackBalance,
      estimate: points - replyPoints + rackBalance,
    };
  };
  let recommended = requested;
  let best = -Infinity;
  for (const action of candidates.values()) {
    let sum = 0;
    for (let i = 0; i < discoverySamples; i++)
      sum += run(action, "discovery", i).estimate;
    if (
      sum > best ||
      (sum === best && actionKey(action) < actionKey(recommended))
    ) {
      recommended = action;
      best = sum;
    }
  }
  const same = actionKey(recommended) === actionKey(requested);
  validationWork = validationSamples * (same ? 1 : 2);
  report("validation");
  const chosen: CoachingMove[] = [];
  const played: CoachingMove[] = [];
  for (let i = 0; i < validationSamples; i++) {
    const a = run(recommended, "validation", i);
    chosen.push(a);
    played.push(same ? a : run(requested, "validation", i));
  }
  const average = (moves: CoachingMove[]): CoachingMove => ({
    ...moves[0],
    replyPoints:
      moves.reduce((sum, m) => sum + m.replyPoints, 0) / moves.length,
    rackBalance:
      moves.reduce((sum, m) => sum + m.rackBalance, 0) / moves.length,
    estimate: moves.reduce((sum, m) => sum + m.estimate, 0) / moves.length,
  });
  const gaps = chosen.map((move, i) => move.estimate - played[i].estimate);
  const gap = gaps.reduce((sum, n) => sum + n, 0) / gaps.length;
  return {
    policy: COACHING_POLICY,
    horizon: "opponent-reply",
    requested: average(played),
    recommended: average(chosen),
    gap,
    sampleGapRange: [Math.min(...gaps), Math.max(...gaps)],
    verdict: same ? "same" : Math.min(...gaps) > 0 ? "favoured" : "uncertain",
    considered: candidates.size,
    available: summary.candidateCount,
    discoverySamples,
    validationSamples,
    completedSamples,
  };
}

function describeAction(
  position: Position,
  action: Action,
  lexicon: EnumerableLexicon,
): string {
  if (action.type === "pass") return "Pass";
  if (action.type === "exchange") return `Exchange ${action.tiles.join(" ")}`;
  const result = scoreMove(
    position.board,
    action.placements,
    lexicon,
    position.rack.length,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.words
    .map(
      (word) =>
        `${word.word} at ${String.fromCharCode(65 + word.col)}${word.row + 1} ${word.direction}`,
    )
    .join("; ");
}
