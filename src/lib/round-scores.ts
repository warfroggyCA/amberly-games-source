import type { GameState, GameTurn } from "../domain/game";

/** Rows follow completed turns; missing turns carry an earlier total only in cumulative mode. */
export function buildRoundRows(
  game: Pick<GameState, "turns" | "order" | "status" | "pendingEnd">,
  cumulative: boolean,
) {
  const count = Math.max(
    1,
    Math.ceil(game.turns.length / game.order.length) +
      (game.status !== "finalized" &&
      !game.pendingEnd &&
      game.turns.length % game.order.length === 0
        ? 1
        : 0),
  );
  const turns = new Map(
    game.turns.map((turn) => [`${turn.round}:${turn.playerId}`, turn]),
  );
  const totals = new Map<string, number>();
  return Array.from({ length: count }, (_, index) => ({
    round: index + 1,
    cells: game.order.map((playerId) => {
      const turn: GameTurn | undefined = turns.get(`${index + 1}:${playerId}`);
      if (turn) totals.set(playerId, (totals.get(playerId) ?? 0) + turn.score);
      return {
        playerId,
        turn,
        value: cumulative
          ? (totals.get(playerId) ?? null)
          : (turn?.score ?? null),
      };
    }),
  }));
}
