import type { GameState, GameTurn } from "../domain/game";
import { buildRoundRows } from "../lib/round-scores";
const nameOf = (game: GameState, playerId: string) =>
  game.players.find((p) => p.id === playerId)?.name ?? "Player";

export function RoundTable({
  game,
  cumulative,
  onTurn,
}: {
  game: GameState;
  cumulative: boolean;
  onTurn: (turn: GameTurn) => void;
}) {
  const rows = buildRoundRows(game, cumulative);
  return (
    <div className="table-scroll">
      <table className="round-table">
        <caption className="sr-only">
          {cumulative
            ? "Cumulative score through each round"
            : "Points scored in each round"}
        </caption>
        <thead>
          <tr>
            <th>Round</th>
            {game.order.map((p) => (
              <th key={p}>{nameOf(game, p)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.round}>
              <th>{row.round}</th>
              {row.cells.map(({ playerId, turn, value }) => (
                <td key={playerId}>
                  {turn ? (
                    <button
                      onClick={() => onTurn(turn)}
                      title={
                        turn.type === "play"
                          ? turn.words.map((w) => w.word).join(" + ")
                          : turn.type
                      }
                    >
                      {value}
                      {turn.source === "assisted" && <small> A</small>}
                      {turn.type !== "play" && (
                        <small className="turn-kind">{turn.type}</small>
                      )}
                    </button>
                  ) : (
                    <span>
                      {value ?? "—"}
                      {value !== null && (
                        <small className="turn-kind">
                          {game.status === "finalized" ? "No turn" : "Waiting"}
                        </small>
                      )}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>{game.result ? "Before adjustments" : "Total"}</th>
            {game.order.map((p) => (
              <td key={p}>{game.scores[p]}</td>
            ))}
          </tr>
          {game.result && (
            <tr>
              <th>Final</th>
              {game.order.map((p) => (
                <td key={p}>{game.result!.scores[p]}</td>
              ))}
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
