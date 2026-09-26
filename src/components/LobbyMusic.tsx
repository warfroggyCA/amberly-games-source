"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LobbyMusicAudio,
  readLobbyMusicVolume,
  type LobbyMusicState,
  type LobbyMusicTrack,
} from "../lib/lobby-music";
import "./lobby-music.css";

export function LobbyMusic({
  active,
  track,
  controlsTarget,
}: {
  active: boolean;
  track: LobbyMusicTrack | null;
  controlsTarget?: HTMLElement | null;
}) {
  const audio = useRef<LobbyMusicAudio | null>(null);
  const [state, setState] = useState<LobbyMusicState>({
    mode: "off",
    volume: 0.2,
  });
  useEffect(() => {
    const player = new LobbyMusicAudio(setState);
    audio.current = player;
    player.setVolume(readLobbyMusicVolume());
    const onHidden = () => {
      if (document.visibilityState !== "visible") player.interrupt();
    };
    const interrupt = () => player.interrupt();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", interrupt);
    window.addEventListener("pageshow", interrupt);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", interrupt);
      window.removeEventListener("pageshow", interrupt);
      player.dispose();
      if (audio.current === player) audio.current = null;
    };
  }, []);
  useEffect(() => {
    audio.current?.configure(track, active);
  }, [track, active]);

  if (!track || !active || controlsTarget === null) return null;
  const label =
    state.mode === "playing"
      ? "Turn off lobby music"
      : state.mode === "loading"
        ? "Cancel loading lobby music"
        : state.mode === "paused"
          ? "Resume lobby music"
          : state.mode === "unavailable"
            ? "Retry lobby music"
            : "Enable lobby music";
  const controls = (
    <details className="lobby-music">
      <summary
        className="lobby-music-toggle"
        aria-label="Lobby music controls"
        title="Lobby music on this device"
        data-playing={state.mode === "playing"}
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18V5l11-2v13M9 8l11-2" />
          <ellipse cx="6" cy="18" rx="3" ry="2" />
          <ellipse cx="17" cy="16" rx="3" ry="2" />
        </svg>
        <span>Music</span>
      </summary>
      <div
        className="lobby-music-panel"
        role="group"
        aria-label="Lobby music on this device"
      >
        <button
          type="button"
          className="lobby-music-toggle"
          aria-label={label}
          title={`${label} · this device only`}
          aria-pressed={state.mode === "playing"}
          onClick={() => {
            const player = audio.current;
            if (!player) return;
            if (
              player.snapshot.mode === "playing" ||
              player.snapshot.mode === "loading"
            )
              player.stop();
            else void player.enable();
          }}
        >
          <span>
            {state.mode === "playing"
              ? "Turn off music"
              : state.mode === "loading"
                ? "Cancel loading"
                : state.mode === "paused"
                  ? "Resume music"
                  : state.mode === "unavailable"
                    ? "Retry music"
                    : "Play music"}
          </span>
        </button>
        <label className="lobby-music-volume">
          <span>Music volume</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round(state.volume * 100)}
            aria-valuetext={`${Math.round(state.volume * 100)} percent`}
            onChange={(event) =>
              audio.current?.setVolume(Number(event.target.value) / 100)
            }
          />
        </label>
        <div className="lobby-music-credit">
          <strong>{track.title}</strong>
          <span>{track.credit}</span>
          <p>
            <a href={track.source} target="_blank" rel="noopener noreferrer">
              Source
            </a>{" "}
            ·{" "}
            <a
              href={track.licenseUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Licence
            </a>
          </p>
        </div>
        <span className="sr-only" role="status">
          {state.mode === "unavailable"
            ? "Music unavailable. Tap to retry."
            : state.mode === "paused"
              ? "Music is paused. Tap Resume music to listen again."
              : ""}
        </span>
      </div>
    </details>
  );
  return controlsTarget ? createPortal(controls, controlsTarget) : controls;
}
