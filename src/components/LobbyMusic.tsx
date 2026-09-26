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
  settingsTarget,
}: {
  active: boolean;
  track: LobbyMusicTrack | null;
  controlsTarget?: HTMLElement | null;
  settingsTarget?: HTMLElement | null;
}) {
  const audio = useRef<LobbyMusicAudio | null>(null);
  const [state, setState] = useState<LobbyMusicState>({
    mode: "off",
    volume: 0.2,
    muted: false,
  });
  useEffect(() => {
    const player = new LobbyMusicAudio(setState);
    audio.current = player;
    player.setVolume(readLobbyMusicVolume());
    const visibility = () =>
      player.setVisible(document.visibilityState === "visible");
    const hide = () => player.setVisible(false);
    const activate = (event: Event) => {
      // The mute button handles its own activation, without briefly starting audio.
      if (
        !event.isTrusted ||
        (event.target instanceof Element &&
          event.target.closest("[data-lobby-music-toggle]"))
      )
        return;
      void player.activate();
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("click", activate);
    document.addEventListener("keydown", activate);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("click", activate);
      document.removeEventListener("keydown", activate);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", visibility);
      player.dispose();
      if (audio.current === player) audio.current = null;
    };
  }, []);
  useEffect(() => {
    audio.current?.configure(track, active);
  }, [track, active]);
  if (!track) return null;
  const label = state.muted
    ? "Unmute background music"
    : "Mute background music";
  const controls = (
    <button
      type="button"
      className="lobby-music lobby-music-toggle"
      data-lobby-music-toggle
      data-playing={state.mode === "playing"}
      aria-label={label}
      aria-pressed={state.muted}
      title={label}
      onClick={() => {
        const player = audio.current;
        if (player) player.setMuted(!player.snapshot.muted);
      }}
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
        {state.muted && <path d="M3 3l18 18" />}
      </svg>
      <span className="lobby-music-label">
        {state.muted ? "Unmute" : "Mute"}
      </span>
      <span className="sr-only" role="status">
        {state.mode === "unavailable"
          ? "Background music unavailable. Mute and unmute to retry."
          : ""}
      </span>
    </button>
  );
  const settings = (
    <section
      className="lobby-music-settings"
      aria-label="Background music settings"
    >
      <h2>Background music</h2>
      <label className="lobby-music-volume">
        <span>Background music volume</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={Math.round(state.volume * 100)}
          aria-label="Background music volume"
          aria-valuetext={`${Math.round(state.volume * 100)} percent`}
          onChange={(event) =>
            audio.current?.setVolume(Number(event.target.value) / 100)
          }
        />
        <output>{Math.round(state.volume * 100)}%</output>
      </label>
      <p>Saved on this device. Use the music button to mute or unmute.</p>
      <a
        className="lobby-music-credits-link"
        href="/music/README.md"
        target="_blank"
        rel="noopener noreferrer"
      >
        Music credits
      </a>
    </section>
  );
  return (
    <>
      {active &&
        controlsTarget !== null &&
        (controlsTarget ? createPortal(controls, controlsTarget) : controls)}
      {settingsTarget && createPortal(settings, settingsTarget)}
    </>
  );
}
