import type { SpectatorState } from "./shared-contract";

export type SoundGame = Pick<
  SpectatorState,
  | "id"
  | "revision"
  | "status"
  | "turns"
  | "currentPlayerId"
  | "result"
  | "pendingEnd"
>;
export type GameSound = "score" | "bingo" | "winner" | "crowd" | "tie" | "turn";
export type SoundFrame = {
  id: string;
  revision: number;
  status: SoundGame["status"];
  turnIds: string[];
  turns: string[];
  player: string;
  winners: string[] | null;
  pendingEnd: boolean;
  lastPlay: boolean;
  bingo: boolean;
};
export function soundFrame(game: SoundGame): SoundFrame {
  return {
    id: game.id,
    revision: game.revision ?? -1,
    status: game.status,
    turnIds: game.turns.map((t) => t.id),
    turns: game.turns.map((t) => JSON.stringify(t)),
    player: game.currentPlayerId,
    winners: game.result?.winnerIds ?? null,
    pendingEnd: !!game.pendingEnd,
    lastPlay: game.turns.at(-1)?.type === "play",
    bingo: !!game.turns.at(-1)?.bingo,
  };
}
/** Only contiguous committed transitions can make sound. Initial/history/catch-up is silent. */
export function soundsForTransition(
  before: SoundFrame | null,
  after: SoundFrame,
  listenerPlayerId: string | null = null,
): GameSound[] {
  if (
    !before ||
    before.id !== after.id ||
    before.revision < 0 ||
    after.revision !== before.revision + 1
  )
    return [];
  if (
    before.status !== "finalized" &&
    after.status === "finalized" &&
    after.winners?.length
  ) {
    return after.winners.length > 1 ? ["tie"] : ["winner", "crowd"];
  }
  if (
    before.status !== "active" ||
    after.status !== "active" ||
    after.turns.length !== before.turns.length + 1 ||
    !before.turns.every((turn, i) => turn === after.turns[i]) ||
    !after.lastPlay ||
    before.turnIds.includes(after.turnIds.at(-1)!)
  )
    return [];
  const cue: GameSound = after.bingo ? "bingo" : "score";
  return !after.pendingEnd &&
    before.player !== after.player &&
    after.player === listenerPlayerId
    ? [cue, "turn"]
    : [cue];
}
