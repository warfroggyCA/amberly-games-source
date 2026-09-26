import {
  countUnplayed,
  createBoard,
  isBoard,
  isLetter,
  LETTER_COUNTS,
  LETTER_VALUES,
} from "../board";
import { scoreMove } from "../scoring";
import type { EnumerableLexicon } from "../solver";
import type { Board, Letter, Placement } from "../types";

export const GYM_RULES = "amberly-two-player-v1" as const;
export type Physical = Letter | "?";
export type Seat = 0 | 1;
export type Action =
  | { type: "play"; placements: Placement[] }
  | { type: "exchange"; tiles: Physical[] }
  | { type: "pass" };
export interface Position {
  board: Board;
  rack: Physical[];
  scores: [number, number];
  opponentCount: number;
  bagCount: number;
  passes: number;
}
/** Synthetic full state stays inside generation/simulation, never in the coaching input. */
export interface World {
  board: Board;
  racks: [Physical[], Physical[]];
  scores: [number, number];
  bag: Physical[];
  turn: Seat;
  passes: number;
}
export interface SetupTurn {
  seat: Seat;
  action: Action;
  score: number;
}
export interface Puzzle {
  version: 1;
  generator: "legal-play-v1";
  rules: typeof GYM_RULES;
  seed: string;
  reference: {
    id: string;
    edition: string;
    status: EnumerableLexicon["status"];
  };
  position: Position;
  setup: SetupTurn[];
}
export class GymUnavailable extends Error {}
export interface Budget {
  deadline: number;
  maxNodes: number;
  signal?: AbortSignal;
}
export function checkBudget(budget: Budget) {
  if (budget.signal?.aborted) throw new GymUnavailable("Analysis cancelled.");
  if (performance.now() >= budget.deadline)
    throw new GymUnavailable("Analysis reached its time budget.");
}
export function makeBudget(
  milliseconds = 15_000,
  maxNodes = 2_000_000,
): Budget {
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds <= 0 ||
    milliseconds > 300_000 ||
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 1 ||
    maxNodes > 5_000_000
  )
    throw new Error("Invalid analysis budget.");
  return { deadline: performance.now() + milliseconds, maxNodes };
}
/** Versioned seeded PRNG; randomness is replayable, not used for security or IDs. */
export function random(seed: string): () => number {
  if (typeof seed !== "string" || !seed.length || seed.length > 160)
    throw new Error("Invalid generation seed.");
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), state | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(values: readonly T[], rng: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function fullBag(): Physical[] {
  return Object.entries(LETTER_COUNTS).flatMap(([letter, n]) =>
    Array<Physical>(n).fill(letter as Physical),
  );
}
export function initialWorld(seed: string): World {
  const bag = shuffle(fullBag(), random(seed));
  return {
    board: createBoard(),
    racks: [bag.splice(0, 7), bag.splice(0, 7)],
    scores: [0, 0],
    bag,
    turn: 0,
    passes: 0,
  };
}
export function publicPosition(world: World): Position {
  if (world.turn !== 0)
    throw new Error("A Gym puzzle must start on the human turn.");
  return {
    board: world.board,
    rack: [...world.racks[0]],
    scores: [...world.scores],
    bagCount: world.bag.length,
    opponentCount: world.racks[1].length,
    passes: world.passes,
  };
}
export function removeTiles(
  rack: readonly Physical[],
  consumed: readonly string[],
): Physical[] {
  const remaining = [...rack];
  for (const tile of consumed) {
    const index = remaining.indexOf(tile as Physical);
    if (index < 0)
      throw new Error(`The rack does not contain another ${tile} tile.`);
    remaining.splice(index, 1);
  }
  return remaining;
}
export function consumedTiles(action: Action): Physical[] {
  return action.type === "play"
    ? action.placements.map((p) => (p.tile.blank ? "?" : p.tile.letter))
    : action.type === "exchange"
      ? action.tiles
      : [];
}
export function rackValue(rack: readonly Physical[]): number {
  return rack.reduce((n, t) => n + (t === "?" ? 0 : LETTER_VALUES[t]), 0);
}
export function unseenTiles(position: Position): Physical[] {
  if (
    !position ||
    !isBoard(position.board) ||
    !Array.isArray(position.rack) ||
    position.rack.length > 7 ||
    Array.from(position.rack).some((t) => t !== "?" && !isLetter(t)) ||
    !Array.isArray(position.scores) ||
    position.scores.length !== 2 ||
    Array.from(position.scores).some(
      (n) => !Number.isSafeInteger(n) || Math.abs(n) > 10_000,
    ) ||
    !Number.isInteger(position.opponentCount) ||
    position.opponentCount < 0 ||
    position.opponentCount > 7 ||
    !Number.isInteger(position.bagCount) ||
    position.bagCount < 0 ||
    position.bagCount > 100 ||
    !Number.isInteger(position.passes) ||
    position.passes < 0 ||
    position.passes > 3
  )
    throw new Error("Invalid public training position.");
  const counts = countUnplayed(position.board);
  for (const t of position.rack)
    if (--counts[t] < 0)
      throw new Error("The board and rack exceed the tile set.");
  const unseen = Object.entries(counts).flatMap(([t, n]) =>
    Array<Physical>(n).fill(t as Physical),
  );
  if (unseen.length !== position.opponentCount + position.bagCount)
    throw new Error("The bag and rack counts do not conserve the tile set.");
  return unseen;
}
export function sampleWorld(position: Position, seed: string): World {
  const unseen = shuffle(unseenTiles(position), random(seed));
  const opponent = unseen.splice(0, position.opponentCount);
  return {
    board: position.board,
    racks: [[...position.rack], opponent],
    scores: [...position.scores],
    bag: unseen,
    turn: 0,
    passes: position.passes,
  };
}
export function validateWorld(world: World) {
  if (world.turn !== 0 && world.turn !== 1) throw new Error("Invalid seat.");
  const counts = countUnplayed(world.board);
  for (const rack of world.racks) {
    if (rack.length > 7) throw new Error("Rack exceeds seven tiles.");
    for (const t of rack)
      if (!Object.hasOwn(counts, t) || --counts[t] < 0)
        throw new Error("Impossible rack inventory.");
  }
  for (const t of world.bag)
    if (!Object.hasOwn(counts, t) || --counts[t] < 0)
      throw new Error("Impossible bag inventory.");
  if (Object.values(counts).some((n) => n !== 0))
    throw new Error("Missing physical tiles.");
}
export function validateAction(
  position: Position,
  action: Action,
  lexicon: EnumerableLexicon,
): number {
  unseenTiles(position);
  if (action.type === "play") {
    const scored = scoreMove(
      position.board,
      action.placements,
      lexicon,
      position.rack.length,
    );
    if (!scored.ok) throw new Error(scored.error.message);
    removeTiles(position.rack, consumedTiles(action));
    return scored.score;
  }
  if (action.type === "exchange") {
    if (
      !Array.isArray(action.tiles) ||
      !action.tiles.length ||
      action.tiles.length > position.bagCount ||
      action.tiles.length > 7
    )
      throw new Error(
        "The rack and bag must contain enough tiles for that exchange.",
      );
    removeTiles(position.rack, action.tiles);
    return 0;
  }
  if (action.type !== "pass") throw new Error("Unknown training action.");
  return 0;
}
export function advance(
  world: World,
  action: Action,
  lexicon: EnumerableLexicon,
  rng: () => number,
): World {
  if (terminalResult(world) !== null)
    throw new Error("This simulated game has ended.");
  const seat = world.turn;
  const view: Position = {
    board: world.board,
    rack: world.racks[seat],
    scores: [world.scores[seat], world.scores[1 - seat]],
    opponentCount: world.racks[1 - seat].length,
    bagCount: world.bag.length,
    passes: world.passes,
  };
  const points = validateAction(view, action, lexicon);
  const next: World = {
    ...world,
    racks: [[...world.racks[0]], [...world.racks[1]]],
    scores: [...world.scores],
    bag: [...world.bag],
    turn: seat === 0 ? 1 : 0,
    passes: action.type === "pass" ? world.passes + 1 : 0,
  };
  const consumed = consumedTiles(action);
  next.racks[seat] = removeTiles(next.racks[seat], consumed);
  if (action.type === "play") {
    const result = scoreMove(
      world.board,
      action.placements,
      lexicon,
      world.racks[seat].length,
    );
    if (!result.ok) throw new Error(result.error.message);
    next.board = result.board;
    next.scores[seat] += points;
  }
  if (action.type !== "pass") {
    const draw =
      action.type === "exchange"
        ? consumed.length
        : Math.min(7 - next.racks[seat].length, next.bag.length);
    next.racks[seat].push(...next.bag.splice(0, draw));
    // Draw first, then return and mix exchanged tiles; the same tile cannot be redrawn.
    if (action.type === "exchange")
      next.bag = shuffle([...next.bag, ...consumed], rng);
  }
  validateWorld(next);
  return next;
}
/** Full game ending, including family pre-adjustment tiebreak; null means unresolved. */
export function terminalResult(world: World): 0 | 0.5 | 1 | null {
  const out =
    world.bag.length === 0 ? world.racks.findIndex((r) => r.length === 0) : -1;
  if (out < 0 && world.passes < 4) return null;
  const values = world.racks.map(rackValue);
  const final = world.scores.map(
    (n, i) => n - values[i] + (i === out ? values[1 - i] : 0),
  );
  const difference = final[0] - final[1] || world.scores[0] - world.scores[1];
  return difference > 0 ? 1 : difference < 0 ? 0 : 0.5;
}
export function actionKey(action: Action): string {
  if (action.type === "pass") return "pass";
  if (action.type === "exchange")
    return `exchange:${[...action.tiles].sort().join("")}`;
  return `play:${[...action.placements]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((p) => `${p.row},${p.col},${p.tile.letter},${Number(p.tile.blank)}`)
    .join(";")}`;
}
