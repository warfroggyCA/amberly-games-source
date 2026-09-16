import type { GameTurn, GameWord } from "../domain/game";
import type { SpectatorState } from "./shared-contract";

export type SpectatorWord = GameWord & {
  id: string;
  turnId: string;
  playerId: string;
  round: number;
  turnScore: number;
  source: GameTurn["source"];
  cells: string[];
};

/** Preserve each recorded word, including crosswords and later extensions. */
export function spectatorWords(turns: readonly GameTurn[]): SpectatorWord[] {
  return turns.flatMap((turn) =>
    turn.words.map((word, index) => ({
      ...word,
      id: `${turn.id}:${index}`,
      turnId: turn.id,
      playerId: turn.playerId,
      round: turn.round,
      turnScore: turn.score,
      source: turn.source,
      cells: Array.from(
        { length: word.word.length },
        (_, offset) =>
          `${word.row + (word.direction === "down" ? offset : 0)}:${word.col + (word.direction === "across" ? offset : 0)}`,
      ),
    })),
  );
}

/** Polling, first load, undo and replaced history must never replay old moves. */
export function newlyObservedPlay(
  previous: Pick<SpectatorState, "id" | "turns">,
  next: Pick<SpectatorState, "id" | "turns" | "status">,
): GameTurn | null {
  if (
    previous.id !== next.id ||
    next.status === "finalized" ||
    next.turns.length <= previous.turns.length ||
    !previous.turns.every((turn, index) => next.turns[index]?.id === turn.id)
  )
    return null;
  const latest = next.turns.at(-1);
  return latest?.type === "play" ? latest : null;
}
