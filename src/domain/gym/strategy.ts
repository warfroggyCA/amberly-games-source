import { findMoves, type EnumerableLexicon } from "../solver";
import { exchanges, leaveValue, type ScoreSummary } from "./analysis";
import {
  actionKey,
  advance,
  checkBudget,
  consumedTiles,
  GymUnavailable,
  random,
  removeTiles,
  sampleWorld,
  terminalResult,
  validateAction,
  type Action,
  type Budget,
  type Position,
  type World,
} from "./model";

export const POLICY = "experimental-score-leave-v1";
export interface StrategyComparison {
  status: "complete";
  policy: typeof POLICY;
  recommended: Action;
  requested: Action;
  recommendedEstimate: number;
  requestedEstimate: number;
  gap: number;
  /** Conservative 95% paired Hoeffding interval, in percentage points. */
  gapInterval: [number, number];
  discoverySamples: number;
  validationSamples: number;
  considered: number;
  available: number;
  completedContinuations: number;
  totalTurns: number;
}
export interface StrategyOptions {
  discoverySamples?: number;
  validationSamples?: number;
  maxTurns?: number;
  progress?: (completed: number) => void;
}
/** The policy sees only its own rack and public state, never the other rack/bag order. */
export function choosePolicy(
  view: Position,
  lexicon: EnumerableLexicon,
  budget: Budget,
): Action {
  checkBudget(budget);
  let selected: Action = { type: "pass" };
  let value = leaveValue(view.rack);
  const consider = (action: Action, rating: number) => {
    if (
      rating > value ||
      (rating === value && actionKey(action) < actionKey(selected))
    ) {
      selected = action;
      value = rating;
    }
  };
  for (const action of exchanges(view.rack, view.bagCount))
    consider(
      action,
      leaveValue(removeTiles(view.rack, consumedTiles(action))) - 2,
    );
  const result = findMoves(view.board, view.rack, lexicon, {
    limit: 1,
    maxNodes: budget.maxNodes,
    signal: budget.signal,
    onMove(move) {
      const action: Action = { type: "play", placements: move.placements };
      consider(
        action,
        move.score + leaveValue(removeTiles(view.rack, consumedTiles(action))),
      );
    },
  });
  checkBudget(budget);
  if (result.status !== "complete")
    throw new GymUnavailable("A simulated policy search did not complete.");
  return selected;
}
export function continueGame(
  world: World,
  lexicon: EnumerableLexicon,
  budget: Budget,
  seed: string,
  maxTurns = 160,
): { outcome: number; turns: number } {
  let current = world;
  for (let turn = 0; turn <= maxTurns; turn++) {
    checkBudget(budget);
    const outcome = terminalResult(current);
    if (outcome !== null) return { outcome, turns: turn };
    if (turn === maxTurns) break;
    const actor = current.turn;
    const view: Position = {
      board: current.board,
      rack: [...current.racks[actor]],
      scores: [current.scores[actor], current.scores[1 - actor]],
      opponentCount: current.racks[1 - actor].length,
      bagCount: current.bag.length,
      passes: current.passes,
    };
    current = advance(
      current,
      choosePolicy(view, lexicon, budget),
      lexicon,
      random(`${seed}:exchange:${turn}`),
    );
  }
  throw new GymUnavailable(
    "A simulated game did not reach a valid ending. No strategy estimate was issued.",
  );
}
/** Full continuations only. A capped world aborts the comparison; it is never omitted from an average. */
export function compareStrategy(
  position: Position,
  lexicon: EnumerableLexicon,
  summary: ScoreSummary,
  requested: Action,
  seed: string,
  budget: Budget,
  options: StrategyOptions = {},
): StrategyComparison {
  validateAction(position, requested, lexicon);
  const discoverySamples = options.discoverySamples ?? 4;
  const validationSamples = options.validationSamples ?? 16;
  const maxTurns = options.maxTurns ?? 160;
  if (
    ![discoverySamples, validationSamples].every(
      (n) => Number.isInteger(n) && n >= 2 && n <= 512,
    ) ||
    !Number.isInteger(maxTurns) ||
    maxTurns < 1 ||
    maxTurns > 256
  )
    throw new Error("Invalid simulation settings.");
  const candidates = new Map(summary.candidates.map((a) => [actionKey(a), a]));
  candidates.set(actionKey(requested), requested);
  let completedContinuations = 0;
  let totalTurns = 0;
  const run = (action: Action, phase: string, index: number) => {
    checkBudget(budget);
    const worldSeed = `${seed}:${phase}:${index}`;
    const world = sampleWorld(position, worldSeed);
    const started = advance(
      world,
      action,
      lexicon,
      random(`${worldSeed}:first-exchange`),
    );
    const result = continueGame(started, lexicon, budget, worldSeed, maxTurns);
    completedContinuations++;
    totalTurns += result.turns + 1;
    options.progress?.(completedContinuations);
    return result.outcome;
  };
  let recommended = requested;
  let best = -Infinity;
  for (const action of candidates.values()) {
    let sum = 0;
    for (let i = 0; i < discoverySamples; i++)
      sum += run(action, "discovery", i);
    if (
      sum > best ||
      (sum === best && actionKey(action) < actionKey(recommended))
    ) {
      best = sum;
      recommended = action;
    }
  }
  // Fresh paired worlds avoid reporting the discovery winner's lucky samples as its estimate.
  let recommendedSum = 0;
  let requestedSum = 0;
  const same = actionKey(recommended) === actionKey(requested);
  for (let i = 0; i < validationSamples; i++) {
    const a = run(recommended, "validation", i);
    recommendedSum += a;
    requestedSum += same ? a : run(requested, "validation", i);
  }
  const gap = (100 * (recommendedSum - requestedSum)) / validationSamples;
  const radius = same
    ? 0
    : 100 * Math.sqrt((2 * Math.log(2 / 0.05)) / validationSamples);
  return {
    status: "complete",
    policy: POLICY,
    recommended,
    requested,
    recommendedEstimate: (100 * recommendedSum) / validationSamples,
    requestedEstimate: (100 * requestedSum) / validationSamples,
    gap,
    gapInterval: [Math.max(-100, gap - radius), Math.min(100, gap + radius)],
    discoverySamples,
    validationSamples,
    considered: candidates.size,
    available: summary.candidateCount,
    completedContinuations,
    totalTurns,
  };
}
