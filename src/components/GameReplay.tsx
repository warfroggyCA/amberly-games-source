"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useLayoutEffect,
  useRef,
} from "react";
import { gameReplay, type GameState } from "../domain/game";
import type { SavedPlayer } from "../lib/preview-store";
import { PlaybackClock } from "../lib/playback-clock";
import { replayStepLabel } from "../lib/game-replay";
import { SpectatorGame } from "./SpectatorGame";
import "./game-replay.css";

/** A local viewer only: no store, command, draft, audio or network dependency. */
export function GameReplay({
  game,
  profiles,
  viewerPlayerId,
  onClose,
}: {
  game: GameState;
  profiles: SavedPlayer[];
  viewerPlayerId?: string | null;
  onClose: () => void;
}) {
  const [record] = useState(game);
  const [speed, setSpeed] = useState(1);
  const rate = useRef(speed);
  const paceClock = useRef<PlaybackClock | null>(null);
  useLayoutEffect(() => {
    rate.current = speed;
    paceClock.current?.setRate(speed);
  }, [speed]);
  const timeline = useMemo(() => gameReplay(record), [record]);
  const [position, setPosition] = useState({
    index: 0,
    playing: false,
    arrival: false,
    scored: true,
    epoch: 0,
  });
  const frame = useMemo(
    () => timeline?.at(position.index) ?? null,
    [timeline, position.index],
  );
  const before = useMemo(
    () => timeline?.at(Math.max(0, position.index - 1)) ?? null,
    [timeline, position.index],
  );
  const event = record.events[position.index - 1];
  const turn =
    position.arrival && event?.turn?.type === "play"
      ? (frame?.turns.find((turn) => turn.id === event.turn!.id) ?? null)
      : null;
  const pause = useCallback(
    () =>
      setPosition((current) => ({
        ...current,
        playing: false,
        arrival: false,
        scored: true,
        epoch: current.epoch + 1,
      })),
    [],
  );
  const seek = useCallback(
    (index: number, animate: boolean, playing = false) => {
      if (!timeline) return;
      const next = Math.max(0, Math.min(timeline.length, index));
      const arrival = animate && record.events[next - 1]?.turn?.type === "play";
      setPosition((current) => ({
        index: next,
        playing,
        arrival,
        scored: !arrival,
        epoch: current.epoch + 1,
      }));
    },
    [timeline, record],
  );
  const epoch = position.epoch;
  const revealScore = useCallback(
    () =>
      setPosition((current) =>
        current.epoch === epoch ? { ...current, scored: true } : current,
      ),
    [epoch],
  );
  const finish = useCallback(
    () =>
      setPosition((current) =>
        current.epoch === epoch
          ? { ...current, arrival: false, scored: true }
          : current,
      ),
    [epoch],
  );
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", pause);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", pause);
    };
  }, [pause]);
  useEffect(() => {
    if (!position.playing || position.arrival || !timeline) return;
    if (position.index === timeline.length) {
      // End without leaving a live interval or an old animation callback.
      const timer = window.setTimeout(pause, 0);
      return () => window.clearTimeout(timer);
    }
    const clock = new PlaybackClock(rate.current);
    paceClock.current = clock;
    void clock.wait(1100).then(
      () => seek(position.index + 1, true, true),
      () => {}, // Pause, seek and unmount cancel this pending step.
    );
    return () => {
      clock.dispose();
      if (paceClock.current === clock) paceClock.current = null;
    };
  }, [position, timeline, pause, seek]);
  return (
    <main className="game-replay">
      <header className="replay-heading">
        <div>
          <span className="eyebrow">Scrabble history</span>
          <h1>Game replay</h1>
        </div>
        <button className="button light" onClick={onClose}>
          Close replay
        </button>
      </header>
      {!timeline || !frame || !before ? (
        <p role="status">
          Replay unavailable: this record has an incomplete or inconsistent
          journal. Its saved history has not been changed.
        </p>
      ) : (
        <>
          <section className="replay-controls" aria-label="Replay controls">
            <div className="replay-buttons">
              <button
                className="button light"
                onClick={() => seek(position.index - 1, false)}
                disabled={position.index === 0}
              >
                Previous
              </button>
              <button
                className="button primary"
                disabled={!timeline.length}
                onClick={() =>
                  position.playing || position.arrival
                    ? pause()
                    : seek(
                        position.index === timeline.length
                          ? 1
                          : position.index + 1,
                        true,
                        true,
                      )
                }
              >
                {position.playing || position.arrival
                  ? "Pause"
                  : position.index === timeline.length
                    ? "Replay again"
                    : "Play"}
              </button>
              <button
                className="button light"
                onClick={() => seek(position.index + 1, true)}
                disabled={position.index === timeline.length}
              >
                Next
              </button>
            </div>
            <label className="replay-speed">
              Playback speed
              <select
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                {[1, 2, 4, 8].map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
            <label className="replay-position">
              Step {position.index} of {timeline.length}
              <input
                aria-label="Replay position"
                type="range"
                min={0}
                max={timeline.length}
                value={position.index}
                onChange={(event) => seek(Number(event.target.value), false)}
              />
            </label>
            <p className="replay-caption" role="status" aria-live="polite">
              {replayStepLabel(record, event)}
            </p>
            <details className="replay-note">
              <summary>
                {record.events.some((event) => !event.command.timedAt)
                  ? "Read-only · some timing unavailable"
                  : "About this read-only replay"}
              </summary>
              <p>
                Read-only · playback uses a steady pace at {speed}× speed.{" "}
                {record.events.some((event) => !event.command.timedAt)
                  ? "Some original timing was not recorded. "
                  : ""}
                Rack draws and exchanged letters are not shown.
              </p>
            </details>
          </section>
          <SpectatorGame
            game={frame}
            profiles={profiles}
            viewerPlayerId={viewerPlayerId}
            assisted={!!frame.assistance}
            replayPlayback={{
              turn,
              playbackRate: speed,
              scores:
                turn && !position.scored
                  ? (before.result?.scores ?? before.scores)
                  : (frame.result?.scores ?? frame.scores),
              turns: turn && !position.scored ? before.turns : frame.turns,
              currentPlayerId: turn?.playerId ?? frame.currentPlayerId,
              revealScore,
              finish,
            }}
          />
        </>
      )}
    </main>
  );
}
