import {
  gameReplay,
  getTileSupply,
  type GameState,
  type GameTurn,
} from "./game";
import type { Board, Lexicon } from "./types";
import { countUnplayed, type TileSupply } from "./board";
import type { VerifiedWord } from "./verified-words";

export type CoachingPosition = {
  gameId: string;
  revision: number;
  sequence: number;
  board: Board;
  turn: GameTurn;
  rackCount: number;
  lexicon: Pick<Lexicon, "id" | "edition" | "status">;
  verifiedWords: VerifiedWord[];
  tileSupply: TileSupply;
  corrected: boolean;
};

/** A scalar continuity marker; no journal commands or rack contents leave the server. */
export function rackContinuity(game: GameState): number {
  const harmless = new Set([
    "play",
    "pass",
    "exchange",
    "assisted-pass",
    "start-clock",
    "pause",
    "resume",
    "verify-words",
    "finalize",
  ]);
  return game.events.reduce(
    (epoch, event) =>
      harmless.has(event.command.type) ? epoch : event.sequence,
    0,
  );
}

/** Original position and original move are an inseparable pair. Never returns the journal. */
export function coachingPosition(
  game: GameState,
  turnId: string,
): CoachingPosition | null {
  if (!game.definition.coaching || !game.turns.some((t) => t.id === turnId))
    return null;
  const timeline = gameReplay(game);
  const event = game.events.find((e) => e.turn?.id === turnId);
  if (!timeline || !event?.turn) return null;
  const before = timeline.at(event.sequence - 1);
  if (before.assistance || event.turn.source !== "human") return null;
  const turn = event.turn;
  return structuredClone({
    gameId: game.id,
    revision: game.revision,
    sequence: event.sequence,
    board: before.board,
    turn: {
      id: turn.id,
      number: turn.number,
      round: turn.round,
      type: turn.type,
      playerId: turn.playerId,
      score: turn.score,
      words: turn.words,
      source: turn.source,
      placements: turn.placements,
      bingo: turn.bingo,
      newTileCount: turn.newTileCount,
      runningScores: turn.runningScores,
      ...(turn.exchangeCount === undefined
        ? {}
        : { exchangeCount: turn.exchangeCount }),
    },
    rackCount: before.expectedRackCounts[turn.playerId],
    lexicon: before.lexicon,
    verifiedWords: before.verifiedWords ?? [],
    tileSupply: getTileSupply(before),
    corrected: game.events
      .slice(event.sequence)
      .some(
        (e) =>
          !!e.correctedTurns ||
          !!e.undoneTurnId ||
          e.command.type === "reconcile",
      ),
  });
}

export function parsePrivateRack(input: string): string[] {
  const text = input.toUpperCase().replace(/\s/g, "");
  if (!/^[A-Z?]{0,7}$/.test(text))
    throw Error("Enter up to seven letters; use ? for each physical blank.");
  return [...text];
}
export function subtractTiles(
  rack: readonly string[],
  tiles: readonly string[],
): string[] {
  const remaining = [...rack];
  for (const tile of tiles) {
    const index = remaining.indexOf(tile);
    if (index < 0)
      throw Error(
        "The rack is incomplete or does not contain the physical tiles played.",
      );
    remaining.splice(index, 1);
  }
  return remaining;
}
export function playedTiles(turn: GameTurn): string[] {
  return turn.placements.map((p) => (p.tile.blank ? "?" : p.tile.letter));
}
export function validateReviewRack(
  position: CoachingPosition,
  rack: readonly string[],
) {
  if (rack.length !== position.rackCount)
    throw Error(
      `Enter all ${position.rackCount} tiles held before this turn, excluding refills.`,
    );
  subtractTiles(rack, playedTiles(position.turn));
  validateRackSupply(position.board, rack, position.tileSupply);
}

export function validateRackSupply(
  board: Board,
  rack: readonly string[],
  supply?: TileSupply,
) {
  const available = countUnplayed(board, supply);
  for (const tile of rack) {
    if (!(tile in available) || --available[tile] < 0)
      throw Error(
        "The rack contains more physical tiles than remain off this board.",
      );
  }
}
