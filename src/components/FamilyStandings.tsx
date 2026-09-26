"use client";
import { useState } from "react";
import type { Standing } from "../lib/standings";
type Sort = "rank" | "name" | "played" | "wins" | "ties";
export function FamilyStandings({
  rows,
  players,
  gameFilter,
}: {
  rows: Standing[];
  players: { id: string; name: string }[];
  gameFilter: string;
}) {
  const [sort, setSort] = useState<Sort>("rank");
  const [ascending, setAscending] = useState(true);
  return (
    <section className="family-standings">
      <h2>Family standings</h2>
      <p>
        Completed competitive games across the full history. Private tests,
        early finishes and disputed results are excluded. Ties are separate from
        wins; each doubles teammate receives the team result.
      </p>
      {(["scrabble", "crokinole"] as const)
        .filter((type) => !gameFilter || type === gameFilter)
        .map((type) => {
          const entries = rows
            .filter((r) => r.gameType === type)
            .map((r) => ({
              ...r,
              name:
                players.find((p) => p.id === r.playerId)?.name ??
                "Former player",
              rank:
                1 +
                rows.filter(
                  (other) => other.gameType === type && other.wins > r.wins,
                ).length,
            }));
          entries.sort(
            (a, b) =>
              (sort === "name"
                ? a.name.localeCompare(b.name)
                : a[sort] - b[sort]) * (ascending ? 1 : -1) ||
              a.name.localeCompare(b.name) ||
              a.playerId.localeCompare(b.playerId),
          );
          return (
            <div key={type}>
              <h3>{type === "scrabble" ? "Scrabble" : "Crokinole"}</h3>
              {entries.length ? (
                <div className="standings-scroll">
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
                          ] as const
                        ).map(([key, label]) => (
                          <th
                            key={key}
                            aria-sort={
                              sort === key
                                ? ascending
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                          >
                            <button
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
                      {entries.map((r) => (
                        <tr key={r.playerId}>
                          <td>{r.rank}</td>
                          <th scope="row">{r.name}</th>
                          <td>{r.played}</td>
                          <td>
                            <strong>{r.wins}</strong>
                          </td>
                          <td>{r.ties}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No eligible completed games yet.</p>
              )}
            </div>
          );
        })}
    </section>
  );
}
