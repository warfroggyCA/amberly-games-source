import { buildPlayerRecords } from "../domain/records";
import type { GameState } from "../domain/game";
import type { GameAccess } from "../lib/shared-contract";
import type { SavedPlayer } from "../lib/preview-store";

export function RecordsPage({
  games,
  players,
  access,
  hasMore,
  onLoadMore,
  onOpen,
  onHistory,
}: {
  games: GameState[];
  players: SavedPlayer[];
  access?: Record<string, GameAccess>;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: string) => void;
  onHistory: () => void;
}) {
  // Local practice, unresolved concerns and upheld concerns cannot enter shared records.
  const eligible = games.filter((game) => {
    const policy = access?.[game.id];
    return (
      policy?.mode === "confirmed" &&
      !policy.protests.some(
        (p) => !p.resolution || p.resolution.outcome === "upheld",
      )
    );
  });
  const records = hasMore
    ? []
    : players
        .map((player) => ({
          player,
          record: buildPlayerRecords(eligible, player.id),
        }))
        .filter(
          ({ record }) =>
            record.humanTurns > 0 || record.competitiveGroups.length > 0,
        );
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">Earned at the table</span>
        <h1>The family record book</h1>
        <p>Best words. Biggest turns. Memorable comebacks.</p>
      </div>
      {hasMore ? (
        <div className="record-empty">
          <h2>Bring the whole history to the table.</h2>
          <p>
            Records need every game. Load the remaining history before comparing
            achievements.
          </p>
          <button className="button primary" onClick={onLoadMore}>
            Load earlier games
          </button>
        </div>
      ) : records.length ? (
        <div className="player-cards">
          {records.map(({ player, record }) => (
            <section
              className="panel"
              key={player.id}
              aria-label={`${player.name} records`}
            >
              <h2>{player.name}</h2>
              <p>
                {record.wordsFormed} words · {record.bingoCount} seven-tile
                bonuses
              </p>
              <h3>Highest scoring words</h3>
              {record.highestWords.length ? (
                record.highestWords.map((word, index) => (
                  <button
                    className="button light"
                    key={`${word.turnId}-${index}`}
                    onClick={() => onOpen(word.gameId)}
                  >
                    {word.word} · {word.score} points
                  </button>
                ))
              ) : (
                <p>No recorded words yet.</p>
              )}
              <h3>Best turns</h3>
              {record.highestTurns.map((turn) => (
                <button
                  className="button light"
                  key={turn.turnId}
                  onClick={() => onOpen(turn.gameId)}
                >
                  {turn.score} points · Round {turn.round}
                </button>
              ))}
              {record.competitiveGroups.map((group) => (
                <div
                  key={`${group.rulesVersion}-${group.lexiconId}-${group.participantCount}`}
                >
                  <h3>{group.participantCount}-player games</h3>
                  <p>
                    {group.games} completed · {group.wins} wins · {group.ties}{" "}
                    ties
                  </p>
                  <p>
                    Average final score: {group.averageFinalScore.toFixed(1)} ·
                    Longest win streak: {group.longestWinStreak}
                  </p>
                  <small>{group.lexiconEdition}</small>
                </div>
              ))}
              {record.bestClutch.map((turn) => (
                <p key={turn.turnId}>
                  <button
                    className="text-button"
                    onClick={() => onOpen(turn.gameId)}
                  >
                    Clutch turn: {turn.score} points, overcoming a{" "}
                    {turn.deficitOvercome}-point deficit
                  </button>
                </p>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="record-empty">
          <h2>Your next game can make history.</h2>
          <p>
            New shared family games use Amberly’s record-eligible reference.
            Existing beta games, local previews, solo practice and custom tile
            quantities stay outside standard family records.
          </p>
          <button className="button light" onClick={onHistory}>
            Browse game history
          </button>
        </div>
      )}
      <p className="muted">
        Only finalized human turns contribute personal word records. Assisted
        turns never count. Wins, averages and clutch awards require an
        unassisted normal ending. Results stay separate by word reference and
        player count.
      </p>
    </>
  );
}
