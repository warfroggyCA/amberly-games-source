import { gameReplay, type GameState } from "./game";

export const LEAD_COUNT_VERSION = "corrected-turn-leads-v1";
export type LeadSpell = {
  firstTurn: number;
  lastTurn: number;
  turns: number;
  endedBy: "tie" | "overtaken" | "final-adjustment" | "game-ended";
};
export type PlayerLeadCounts = {
  playerId: string;
  spells: LeadSpell[];
  entries: number;
  regains: number;
  turnsLed: number;
  coLeadingTurns: number;
  longest: number | null;
  average: number | null;
};
export type LeadCounts =
  | { available: false; reason: string }
  | {
      available: true;
      version: typeof LEAD_COUNT_VERSION;
      completedTurns: number;
      players: PlayerLeadCounts[];
      finalLeadChanged: boolean;
    };

/** Zero at the start is not a lead; ties at the top are separate from sole leads. */
function leaders(order: readonly string[], scores: Record<string, number>) {
  const values = order.map((id) => scores[id]);
  if (values.every((score) => score === 0)) return [];
  const best = Math.max(...values);
  return order.filter((id) => scores[id] === best);
}
const sameScores = (
  order: readonly string[],
  first: Record<string, number>,
  second: Record<string, number>,
) => order.every((id) => first[id] === second[id]);

/**
 * Input must come through existing game hydration/authorization. Derive once from
 * the final effective journal, not raw turn events or each replay animation frame.
 * This function never applies commands, mutates a game, or fetches additional data.
 */
export function deriveLeadCounts(game: GameState): LeadCounts {
  const unavailable = (): LeadCounts => ({
    available: false,
    reason: "This record has an incomplete or inconsistent journal.",
  });
  try {
    if (game.order.length < 2 || game.mode === "solo")
      return {
        available: false,
        reason: "Lead counts need a multiplayer game.",
      };
    if (game.status !== "finalized" || !game.result)
      return {
        available: false,
        reason: "Lead counts are available after the game ends.",
      };
    const timeline = gameReplay(game);
    if (!timeline || new Set(game.order).size !== game.order.length)
      return unavailable();
    const effective = timeline.at(timeline.length);
    const players: PlayerLeadCounts[] = game.order.map((playerId) => ({
      playerId,
      spells: [],
      entries: 0,
      regains: 0,
      turnsLed: 0,
      coLeadingTurns: 0,
      longest: null,
      average: null,
    }));
    const byId = new Map(players.map((player) => [player.playerId, player]));
    const scores = Object.fromEntries(game.order.map((id) => [id, 0]));
    let current: PlayerLeadCounts | undefined;
    for (const [index, turn] of effective.turns.entries()) {
      const number = index + 1;
      if (
        turn.playerId !== game.order[index % game.order.length] ||
        turn.number !== number ||
        turn.round !== Math.floor(index / game.order.length) + 1 ||
        !Number.isSafeInteger(turn.score) ||
        turn.score < 0 ||
        (turn.type !== "play" && turn.score !== 0)
      )
        return unavailable();
      scores[turn.playerId] += turn.score;
      if (
        !Number.isSafeInteger(scores[turn.playerId]) ||
        !sameScores(game.order, scores, turn.runningScores)
      )
        return unavailable();
      const top = leaders(game.order, scores);
      const next = top.length === 1 ? byId.get(top[0]) : undefined;
      if (current && current !== next)
        current.spells.at(-1)!.endedBy = top.length > 1 ? "tie" : "overtaken";
      if (top.length > 1) top.forEach((id) => byId.get(id)!.coLeadingTurns++);
      if (next) {
        if (current !== next)
          next.spells.push({
            firstTurn: number,
            lastTurn: number,
            turns: 0,
            endedBy: "game-ended",
          });
        const spell = next.spells.at(-1)!;
        spell.lastTurn = number;
        spell.turns++;
        next.turnsLed++;
      }
      current = next;
    }
    const result = effective.result!;
    if (
      !sameScores(game.order, scores, effective.scores) ||
      !sameScores(game.order, scores, result.scoresBeforeAdjustments)
    )
      return unavailable();
    for (const id of game.order) {
      const adjustment = result.adjustments[id];
      if (
        !adjustment ||
        ![
          adjustment.deduction,
          adjustment.transfer,
          adjustment.finalScore,
        ].every(Number.isSafeInteger) ||
        adjustment.deduction < 0 ||
        adjustment.transfer < 0 ||
        scores[id] - adjustment.deduction + adjustment.transfer !==
          result.scores[id] ||
        adjustment.finalScore !== result.scores[id]
      )
        return unavailable();
    }
    const before = leaders(game.order, scores);
    const after = leaders(game.order, result.scores);
    const finalLeadChanged = before.join("\0") !== after.join("\0");
    if (current && finalLeadChanged)
      current.spells.at(-1)!.endedBy = "final-adjustment";
    for (const player of players) {
      player.entries = player.spells.length;
      player.regains = Math.max(0, player.entries - 1);
      if (player.entries) {
        player.longest = Math.max(...player.spells.map((spell) => spell.turns));
        player.average = player.turnsLed / player.entries;
      }
    }
    return {
      available: true,
      version: LEAD_COUNT_VERSION,
      completedTurns: effective.turns.length,
      players,
      finalLeadChanged,
    };
  } catch {
    return unavailable();
  }
}
