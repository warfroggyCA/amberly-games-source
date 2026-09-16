import type { GameTurn } from "../domain/game";

export const LEADER_LABELS = {
  score: "In the lead",
  turns: "Tied on points · fewer turns played",
  order: "Tied on points and turns · first in play order",
};

/** A display-only crown; never changes rankings, recorded scores or final winners. */
export function liveLeader(
  order: readonly string[],
  scores: Readonly<Record<string, number>>,
  turns: readonly Pick<GameTurn, "playerId">[],
): { playerId: string; reason: keyof typeof LEADER_LABELS } | null {
  if (order.length < 2) return null;
  const players = order.filter((id) => Number.isFinite(scores[id]));
  const high = Math.max(...players.map((id) => scores[id]));
  if (high <= 0) return null;
  const tied = players.filter((id) => scores[id] === high);
  if (!tied.length) return null;
  if (tied.length === 1) return { playerId: tied[0], reason: "score" };
  const counts = new Map<string, number>();
  for (const turn of turns)
    counts.set(turn.playerId, (counts.get(turn.playerId) ?? 0) + 1);
  const fewest = Math.min(...tied.map((id) => counts.get(id) ?? 0));
  const inHand = tied.filter((id) => (counts.get(id) ?? 0) === fewest);
  return {
    playerId: inHand[0],
    reason: inHand.length === 1 ? "turns" : "order",
  };
}
