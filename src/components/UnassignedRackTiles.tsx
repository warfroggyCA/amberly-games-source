import type { GameState } from "../domain/game";
import { unassignedRackTiles } from "../lib/unassigned-rack-tiles";
import "./unassigned-rack-tiles.css";
export function UnassignedRackTiles({
  game,
  input,
}: {
  game: GameState;
  input: Record<string, string>;
}) {
  const pool = unassignedRackTiles(game, input);
  if (!pool.ok)
    return (
      <section className="unassigned-tiles" aria-label="Unassigned tiles">
        <h3>Unassigned tiles</h3>
        <p role="status">{pool.reason}</p>
      </section>
    );
  return (
    <section className="unassigned-tiles" aria-label="Unassigned tiles">
      <div className="unassigned-heading">
        <h3>Unassigned tiles</h3>
        <span role="status">
          {pool.unassigned} remaining · {pool.allocated} assigned
        </span>
      </div>
      <p>
        {pool.allRacks
          ? "The bag is empty. Allocate these remaining tiles to the players’ racks."
          : `Tiles not on the board or assigned below. Includes ${game.expectedBagCount} ${game.expectedBagCount === 1 ? "tile" : "tiles"} still in the bag; this is not a confirmed rack-only pool.`}
      </p>
      <div className="unassigned-pool">
        {Object.entries(pool.remaining)
          .filter(([, count]) => count > 0)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([letter, count]) => (
            <span
              className="unassigned-letter"
              key={letter}
              aria-label={`${letter === "?" ? "Blank" : letter}: ${count}`}
            >
              <strong>{letter === "?" ? "?" : letter}</strong>
              <small>×{count}</small>
            </span>
          ))}
        {pool.unassigned === 0 && (
          <strong>All remaining tiles allocated.</strong>
        )}
      </div>
    </section>
  );
}
