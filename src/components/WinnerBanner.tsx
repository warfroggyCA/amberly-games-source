import { ResultBadge } from "./ResultBadge";
import { WinnerPortrait } from "./WinnerPortrait";
import type { SavedPlayer } from "../lib/preview-store";
import type { GameState } from "../domain/game";
function WinnerDetails({
  game,
  profiles,
}: {
  game: GameState;
  profiles: SavedPlayer[];
}) {
  if (!game.result) return null;
  // Solo results deliberately have no competitive winners.
  const featuredPlayers = game.players.filter(
    (p) => game.mode === "solo" || game.result!.winnerIds.includes(p.id),
  );
  const names = featuredPlayers.map((p) => p.name).join(" & ");
  return (
    <section className="winner-banner" aria-label="Game result">
      <div className="winner-portraits">
        {featuredPlayers.map((player) => (
          <WinnerPortrait
            key={player.id}
            name={player.name}
            photoDataUrl={
              profiles.find((profile) => profile.id === player.id)?.photoDataUrl
            }
          />
        ))}
      </div>
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

export function WinnerBanner({
  game,
  profiles = [],
}: {
  game: GameState;
  profiles?: SavedPlayer[];
}) {
  return (
    <>
      <ResultBadge
        key={game.id}
        result={
          game.result?.winnerIds.length
            ? {
                gameId: game.id,
                game: "Scrabble",
                winners: game.players
                  .filter((p) => game.result!.winnerIds.includes(p.id))
                  .map((p) => ({
                    name: p.name,
                    photoDataUrl: profiles.find(
                      (profile) => profile.id === p.id,
                    )?.photoDataUrl,
                    score: game.result!.scores[p.id],
                  })),
                note:
                  game.lexicon.status === "test"
                    ? "Practice game"
                    : game.result.reason === "early"
                      ? "Early finish"
                      : game.assistance
                        ? "Assisted result"
                        : game.tileSupply
                          ? "Nonstandard tile set"
                          : undefined,
              }
            : null
        }
      />
      <WinnerDetails game={game} profiles={profiles} />
    </>
  );
}
