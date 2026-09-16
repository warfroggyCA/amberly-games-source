import { CrownIcon } from "./CrownIcon";
import type { GameState } from "../domain/game";
export function WinnerBanner({ game }: { game: GameState }) {
  if (!game.result) return null;
  // Solo results deliberately have no competitive winners.
  const featuredPlayers = game.players.filter(
    (p) => game.mode === "solo" || game.result!.winnerIds.includes(p.id),
  );
  const names = featuredPlayers.map((p) => p.name).join(" & ");
  return (
    <section className="winner-banner" aria-label="Game result">
      <CrownIcon className="winner-crown" />
      <div>
        <span className="eyebrow">
          {game.mode === "solo"
            ? "Solo practice complete"
            : game.assistance
              ? "Assisted result"
              : game.tileSupply
                ? "Nonstandard tile set"
                : game.result.reason === "early"
                  ? "Early finish"
                  : "Game complete"}
        </span>
        <h2>
          {game.mode === "solo"
            ? `${names}, nicely played!`
            : featuredPlayers.length > 1
              ? "It’s a tie!"
              : `${names} wins!`}
        </h2>
        <p>
          {featuredPlayers.length > 1 && <strong>{names} · </strong>}
          <strong>
            {featuredPlayers.length
              ? game.result.scores[featuredPlayers[0].id]
              : 0}{" "}
            points
          </strong>{" "}
          after final adjustments
        </p>
        <small>
          {game.lexicon.status === "test"
            ? "Preview game · Excluded from family records"
            : game.assistance ||
                game.tileSupply ||
                game.result.reason === "early"
              ? "Result kept in history · Excluded from competitive records"
              : "A game to remember."}
        </small>
      </div>
    </section>
  );
}
