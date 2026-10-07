"use client";
import { useEffect, useRef, useState } from "react";
import { familyRequest } from "../lib/shared-store";
import { isGameSummaryPage } from "../lib/game-summary";
import type {
  LeadStanding,
  LeadStandings as Totals,
} from "../lib/lead-standings";
import {
  playerDisplayName,
  type PlayerProfileFields,
} from "../lib/player-profile";

const columns = [
  ["leads", "Leads taken"],
  ["turnsLed", "Turns led"],
  ["longest", "Longest streak"],
  ["average", "Average streak"],
  ["turnShare", "Turns led %"],
] as const;
type Sort = (typeof columns)[number][0];
export function LeadStandings({
  userId,
  players,
}: {
  userId: string;
  players: (PlayerProfileFields & { id: string })[];
}) {
  const [data, setData] = useState<Totals | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<Sort>("leads");
  const [ascending, setAscending] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const cancel = () => {
      generation.current++;
    };
    const invalidate = () => {
      cancel();
      setData(null);
      setLoading(false);
    };
    // Returning after access/removal changes requires a fresh authorized snapshot.
    window.addEventListener("focus", invalidate);
    document.addEventListener("visibilitychange", invalidate);
    return () => {
      cancel();
      window.removeEventListener("focus", invalidate);
      document.removeEventListener("visibilitychange", invalidate);
    };
  }, []);
  async function load() {
    const request = ++generation.current;
    setData(null);
    setError("");
    setLoading(true);
    try {
      const next = await familyRequest<unknown>(
        "/api/family/games?leadCounts=1",
        undefined,
        { expectedUserId: userId },
      );
      if (!isGameSummaryPage(next) || !next.leadCounts)
        throw Error(
          "Lead rankings returned an incomplete response. Try again.",
        );
      if (generation.current === request && !document.hidden)
        setData(next.leadCounts);
    } catch (e) {
      if (generation.current === request)
        setError(
          e instanceof Error ? e.message : "Could not load lead rankings.",
        );
    } finally {
      if (generation.current === request) setLoading(false);
    }
  }
  const name = (id: string) => {
    const p = players.find((p) => p.id === id);
    return p ? playerDisplayName(p) : "Former player";
  };
  const value = (r: LeadStanding, key: Sort) =>
    r.eligibleGames ? r[key] : null;
  const rows = [...(data?.rows ?? [])].sort((a, b) => {
    const x = value(a, sort),
      y = value(b, sort);
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    return (
      ((x ?? 0) - (y ?? 0)) * (ascending ? 1 : -1) ||
      name(a.playerId).localeCompare(name(b.playerId)) ||
      a.playerId.localeCompare(b.playerId)
    );
  });
  return (
    <section className="family-standings" aria-label="Scrabble lead rankings">
      <h3>Scrabble lead rankings</h3>
      <p>
        Separate measures across qualifying Scrabble games. These do not change
        win ranks or the main rating.
      </p>
      <button
        type="button"
        className="button light"
        disabled={loading}
        onClick={() => void load()}
      >
        {loading
          ? "Loading lead rankings…"
          : data
            ? "Refresh lead rankings"
            : "Load Scrabble lead rankings"}
      </button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p role="status">
            Coverage: {data.eligibleGames} qualifying of {data.completedGames}{" "}
            completed games · {data.unavailableGames} unavailable histories ·{" "}
            {data.excludedGames} excluded by ranking rules.
          </p>
          <div
            className="standings-scroll"
            role="region"
            aria-label="Scrabble lead rankings table"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  {columns.map(([key, label]) => (
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
                          setAscending(sort === key ? !ascending : false);
                        }}
                      >
                        {label}
                        {sort === key ? (ascending ? " ↑" : " ↓") : " ↕"}
                      </button>
                    </th>
                  ))}
                  <th scope="col">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.playerId}>
                    <th scope="row">{name(r.playerId)}</th>
                    {columns.map(([key]) => {
                      const n = value(r, key);
                      return (
                        <td key={key}>
                          {n === null
                            ? "—"
                            : key === "turnShare"
                              ? `${(n * 100).toFixed(1)}%`
                              : key === "average"
                                ? n.toFixed(1)
                                : n}
                        </td>
                      );
                    })}
                    <td>
                      {r.eligibleGames}/{r.completedGames} games ·{" "}
                      {r.eligibleTurns} eligible turns
                      <small className="standings-breakdown">
                        {r.eligibleGames
                          ? `${r.regains} regains · ${r.tiedTurns} tied-top turns`
                          : "No qualifying history"}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <p>No completed multiplayer history is available.</p>
          )}
        </>
      )}
      <details className="standings-rules">
        <summary>Lead ranking rules and coverage</summary>
        <p>
          Confirmed, completed competitive multiplayer games with complete
          verified journals. Private practice, early endings, assisted/custom
          games and disputed results are excluded, following the existing
          win-ranking rules. Missing or inconsistent history is unavailable,
          never zero. Coverage is independent of History filters.
        </p>
        <p>
          Each completed turn by any player counts, including passes and
          exchanges. A streak includes the turn gaining a sole lead and excludes
          the turn losing it. Ties end sole streaks and are counted separately;
          all-zero scores award no lead. Corrections and undo replace superseded
          history. Final rack adjustments add no turns.
        </p>
        <p>
          Average streak is total sole-leading turns divided by total leads
          taken, not an average of game averages. Turns led % divides
          sole-leading turns by every completed turn in qualifying games that
          player participated in. No qualifying turns or streaks shows —.
          Regains are counted within each game after its first lead. Players can
          have different game counts; coverage shows their qualifying games and
          turns.
        </p>
        <p>
          Loaded on demand. Refresh after changes; returning to this page or
          changes observed by the existing family refresh clear the snapshot.
        </p>
      </details>
    </section>
  );
}
