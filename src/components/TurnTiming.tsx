"use client";
import { useEffect, useState } from "react";
import type { GameState } from "../domain/game";
import { formatDuration, turnTiming, type TimedGame } from "../lib/turn-timing";

const TIMING_UNAVAILABLE =
  "Timing unavailable: recorded timestamps are incomplete or inconsistent.";

function useTiming(game: TimedGame) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    tick();
    return () => clearInterval(timer);
  }, []);
  return turnTiming(game, now);
}

export function GameClock({
  game,
  disabled,
  onStart,
}: {
  game: TimedGame & Pick<GameState, "status" | "turns">;
  disabled?: boolean;
  onStart?: () => void;
}) {
  const timing = useTiming(game);
  if (!timing.reliable) {
    return <span className="game-clock">{TIMING_UNAVAILABLE}</span>;
  }
  return timing.started ? (
    <span className="game-clock" aria-label="Total game time">
      {formatDuration(timing.totalMs)} · game time
      {game.status === "paused" ? " · Paused" : ""}
    </span>
  ) : (
    <TurnClock game={game} disabled={disabled} onStart={onStart} />
  );
}

export function TurnClock({
  game,
  disabled,
  onStart,
}: {
  game: TimedGame & Pick<GameState, "status" | "turns">;
  disabled?: boolean;
  onStart?: () => void;
}) {
  const timing = useTiming(game);
  if (game.status === "finalized") return null;
  if (!timing.reliable) {
    return <span className="turn-clock">{TIMING_UNAVAILABLE}</span>;
  }
  return timing.started ? (
    <span className="turn-clock" aria-label="Current turn elapsed time">
      {formatDuration(timing.currentMs)}
      {game.status === "paused" ? " · Paused" : " · this turn"}
    </span>
  ) : onStart ? (
    <button
      className="button light"
      disabled={disabled || game.status !== "active"}
      onClick={onStart}
    >
      Start timing
    </button>
  ) : (
    <span className="turn-clock">Timer not started</span>
  );
}
export function TimingSummary({
  game,
}: {
  game: TimedGame & Pick<GameState, "turns" | "players">;
}) {
  const timing = turnTiming(game, 0);
  if (!timing.started) return null;
  if (!timing.reliable) {
    return (
      <section className="timing-summary" aria-label="Turn timing statistics">
        <h3>Time at the table</h3>
        <p>{TIMING_UNAVAILABLE} Scores and recorded turns are unchanged.</p>
      </section>
    );
  }
  const { durations } = timing;
  const timed = game.turns.filter((t) => durations[t.id] !== undefined);
  const rounds = [...new Set(timed.map((t) => t.round))];
  return (
    <section className="timing-summary" aria-label="Turn timing statistics">
      <h3>Time at the table</h3>
      <p>
        Recorded turns only. Pauses excluded; time keeps counting while the
        device sleeps.
      </p>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Total</th>
            <th>Average / turn</th>
          </tr>
        </thead>
        <tbody>
          {game.players.map((p) => {
            const turns = timed.filter((t) => t.playerId === p.id);
            const total = turns.reduce((sum, t) => sum + durations[t.id], 0);
            return (
              <tr key={p.id}>
                <th>{p.name}</th>
                <td>{turns.length ? formatDuration(total) : "—"}</td>
                <td>
                  {turns.length ? formatDuration(total / turns.length) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <details>
        <summary>Longest turn in each round</summary>
        {rounds.map((round) => {
          const turns = timed.filter((t) => t.round === round);
          const max = Math.max(...turns.map((t) => durations[t.id]));
          const names = turns
            .filter((t) => durations[t.id] === max)
            .map((t) => game.players.find((p) => p.id === t.playerId)?.name)
            .join(" & ");
          return (
            <p key={round}>
              Round {round}: {names} · {formatDuration(max)}
            </p>
          );
        })}
      </details>
    </section>
  );
}

export function PlayerElapsedTime({
  game,
  playerId,
}: {
  game: TimedGame & Pick<GameState, "turns" | "currentPlayerId" | "status">;
  playerId: string;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  const timing = turnTiming(game, now);
  if (!timing.started) return null;
  if (!timing.reliable) {
    return <small className="player-elapsed">{TIMING_UNAVAILABLE}</small>;
  }
  const total =
    game.turns
      .filter((t) => t.playerId === playerId)
      .reduce((sum, t) => sum + (timing.durations[t.id] ?? 0), 0) +
    (game.currentPlayerId === playerId && game.status !== "finalized"
      ? timing.currentMs
      : 0);
  return (
    <small className="player-elapsed" aria-label="Player accrued time">
      {formatDuration(total)} total
    </small>
  );
}
