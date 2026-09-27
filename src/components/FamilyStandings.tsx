"use client";
import { useState } from "react";
import { PlayerPortrait } from "./PlayerPortrait";
import {
  rankStandings,
  type Standing,
  type StandingsView,
} from "../lib/standings";
import {
  type PlayerProfileFields,
  playerDisplayName,
} from "../lib/player-profile";
import "./family-standings.css";

type Sort = "rank" | "name" | "played" | "wins" | "ties" | "winRate";
const views = [
  ["overall", "Overall"],
  ["scrabble", "Scrabble"],
  ["crokinole", "Crokinole"],
] as const;
export function FamilyStandings({
  rows,
  players,
  gameFilter,
}: {
  rows: Standing[];
  players: (PlayerProfileFields & { id: string })[];
  gameFilter: string;
}) {
  const [selection, setSelection] = useState<{
    filter: string;
    view: StandingsView;
  } | null>(null);
  const view =
    selection?.filter === gameFilter
      ? selection.view
      : gameFilter === "scrabble" || gameFilter === "crokinole"
        ? gameFilter
        : "overall";
  const [sort, setSort] = useState<Sort>("rank");
  const [ascending, setAscending] = useState(true);
  const profiles = new Map(players.map((player) => [player.id, player]));
  const entries = rankStandings(rows, view).map((row) => ({
    ...row,
    name: profiles.has(row.playerId)
      ? playerDisplayName(profiles.get(row.playerId)!)
      : "Former player",
  }));
  entries.sort(
    (a, b) =>
      (sort === "name" ? a.name.localeCompare(b.name) : a[sort] - b[sort]) *
        (ascending ? 1 : -1) ||
      a.name.localeCompare(b.name) ||
      a.playerId.localeCompare(b.playerId),
  );
  const title = views.find(([key]) => key === view)![1];
  return (
    <section className="family-standings">
      <h2>Family standings</h2>
      <div className="standings-views" role="group" aria-label="Standings game">
        {views.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => setSelection({ filter: gameFilter, view: key })}
          >
            {label}
          </button>
        ))}
      </div>
      <p>
        {view === "overall"
          ? "Total wins across all games. "
          : "Ranked by wins. "}
        Equal wins share a rank.
      </p>
      {entries.length ? (
        <div
          className="standings-scroll"
          role="region"
          aria-label={`${title} standings table`}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                {(
                  [
                    ["rank", "Rank"],
                    ["name", "Player"],
                    ["played", "Played"],
                    ["wins", "Wins"],
                    ["ties", "Ties"],
                    ["winRate", "Win %"],
                  ] as const
                ).map(([key, label]) => (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={
                      sort === key
                        ? ascending
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSort(key);
                        setAscending(
                          sort === key
                            ? !ascending
                            : key === "name" || key === "rank",
                        );
                      }}
                    >
                      {label}
                      {sort === key ? (ascending ? " ↑" : " ↓") : " ↕"}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr key={row.playerId}>
                  <td>{row.rank}</td>
                  <th scope="row">
                    <span className="standings-player">
                      <span className="standings-portrait">
                        <PlayerPortrait
                          name={row.name}
                          photoDataUrl={
                            players.find((player) => player.id === row.playerId)
                              ?.photoDataUrl
                          }
                          lazy
                        />
                      </span>
                      {row.name}
                    </span>
                    {view === "overall" && (
                      <small className="standings-breakdown">
                        {views
                          .filter(([key]) => key !== "overall")
                          .map(([key, label]) => {
                            const game =
                              row.byGame[key as Standing["gameType"]];
                            return game
                              ? `${label}: ${game.wins} ${game.wins === 1 ? "win" : "wins"} / ${game.played} played`
                              : null;
                          })
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    )}
                  </th>
                  <td>{row.played}</td>
                  <td>
                    <strong>{row.wins}</strong>
                  </td>
                  <td>{row.ties}</td>
                  <td>
                    {row.played ? `${(row.winRate * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No eligible completed games yet.</p>
      )}
      <details className="standings-rules">
        <summary>How rankings work</summary>
        <p>
          Completed competitive games across the full history. Private tests,
          early finishes and disputed results are excluded. Ties are separate
          from wins; each doubles teammate receives the team result. Win % is
          wins divided by games played.
        </p>
      </details>
    </section>
  );
}
