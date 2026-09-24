import type { EnumerableLexicon } from "../solver";
import { analyseScore, type ScoreSummary } from "./analysis";
import {
  advance,
  checkBudget,
  GYM_RULES,
  initialWorld,
  publicPosition,
  random,
  terminalResult,
  validateWorld,
  type Budget,
  type Puzzle,
  type SetupTurn,
} from "./model";

export function generatePuzzle(
  seed: string,
  lexicon: EnumerableLexicon,
  budget: Budget,
): { puzzle: Puzzle; answer: ScoreSummary } {
  random(seed); // Validate even before retry-specific seed derivation.
  for (let attempt = 0; attempt < 6; attempt++) {
    checkBudget(budget);
    const replaySeed = `${seed}:try:${attempt}`;
    const choose = random(`${replaySeed}:choices`);
    let world = initialWorld(replaySeed);
    const setup: SetupTurn[] = [];
    const target = 2 * (2 + Math.floor(choose() * 4));
    for (let turn = 0; turn < target; turn++) {
      checkBudget(budget);
      const seat = world.turn;
      const view = {
        board: world.board,
        rack: world.racks[seat],
        scores: [world.scores[seat], world.scores[1 - seat]] as [
          number,
          number,
        ],
        opponentCount: world.racks[1 - seat].length,
        bagCount: world.bag.length,
        passes: world.passes,
      };
      const analysis = analyseScore(view, lexicon, budget);
      const moves = analysis.candidates.filter((a) => a.type === "play");
      const action = moves.length
        ? moves[Math.floor(choose() * moves.length)]
        : (analysis.candidates.find((a) => a.type === "exchange") ?? {
            type: "pass" as const,
          });
      const before = world.scores[seat];
      world = advance(
        world,
        action,
        lexicon,
        random(`${replaySeed}:exchange:${turn}`),
      );
      setup.push({ seat, action, score: world.scores[seat] - before });
      if (terminalResult(world) !== null || world.bag.length < 14) break;
    }
    if (
      world.turn !== 0 ||
      world.racks[0].length !== 7 ||
      world.bag.length < 14 ||
      terminalResult(world) !== null ||
      setup.filter((t) => t.action.type === "play").length < 2
    )
      continue;
    validateWorld(world);
    const position = publicPosition(world);
    const answer = analyseScore(position, lexicon, budget);
    if (answer.maximum <= 0) continue;
    const puzzle: Puzzle = {
      version: 1,
      generator: "legal-play-v1",
      rules: GYM_RULES,
      seed: replaySeed,
      reference: {
        id: lexicon.id,
        edition: lexicon.edition,
        status: lexicon.status,
      },
      position,
      setup,
    };
    verifyPuzzle(puzzle, lexicon);
    return { puzzle, answer };
  }
  throw new Error(
    "Could not prepare a suitable fresh position within six attempts. Please retry.",
  );
}
/** Replay all draws, scores and physical tiles, not just the final board's spelling. */
export function verifyPuzzle(puzzle: Puzzle, lexicon: EnumerableLexicon) {
  if (
    !puzzle ||
    puzzle.version !== 1 ||
    puzzle.generator !== "legal-play-v1" ||
    puzzle.rules !== GYM_RULES ||
    puzzle.reference?.id !== lexicon.id ||
    puzzle.reference.edition !== lexicon.edition ||
    puzzle.reference.status !== lexicon.status ||
    !Array.isArray(puzzle.setup) ||
    puzzle.setup.length < 2 ||
    puzzle.setup.length > 40
  )
    throw new Error("Unsupported puzzle or reference.");
  let world = initialWorld(puzzle.seed);
  for (const [i, turn] of puzzle.setup.entries()) {
    if (turn.seat !== world.turn) throw new Error("Setup seat/order mismatch.");
    const before = world.scores[turn.seat];
    world = advance(
      world,
      turn.action,
      lexicon,
      random(`${puzzle.seed}:exchange:${i}`),
    );
    if (turn.score !== world.scores[turn.seat] - before)
      throw new Error("Setup score mismatch.");
  }
  validateWorld(world);
  if (JSON.stringify(publicPosition(world)) !== JSON.stringify(puzzle.position))
    throw new Error("The puzzle does not match its legal generation trace.");
  if (
    world.bag.length < 14 ||
    world.racks[0].length !== 7 ||
    terminalResult(world) !== null ||
    puzzle.setup.filter((t) => t.action.type === "play").length < 2
  )
    throw new Error("Position does not meet first-release admission rules.");
  return true;
}
