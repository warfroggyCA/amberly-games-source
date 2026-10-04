"use client";
import { useEffect, useRef, useState } from "react";
import { GameAudio } from "../lib/game-audio";
import {
  soundFrame,
  soundsForTransition,
  type SoundFrame,
  type SoundGame,
} from "../lib/game-sounds";
import "./game-sounds.css";

const SOUND_PREFERENCE = "amberly-game-sounds";

export function useGameSounds(
  game: SoundGame | null,
  connected = true,
  pending = false,
  listenerPlayerId: string | null = null,
) {
  const previous = useRef<SoundFrame | null>(null);
  const audio = useRef<GameAudio | null>(null);
  const enabled = useRef(false);
  const preference = useRef(true);
  const alive = useRef(false);
  const attempt = useRef(0);
  const [mode, setMode] = useState<
    "off" | "waiting" | "loading" | "on" | "unavailable"
  >("waiting");
  useEffect(() => {
    alive.current = true;
    try {
      preference.current = localStorage.getItem(SOUND_PREFERENCE) !== "off";
    } catch {
      /* Storage denial must not prevent scoring or in-session choices. */
    }
    setMode(preference.current ? "waiting" : "off");
    audio.current = new GameAudio(() => {
      enabled.current = false;
      if (alive.current) setMode("unavailable");
    });
    const reset = () => {
      previous.current = null;
      audio.current?.stop();
    };
    document.addEventListener("visibilitychange", reset);
    window.addEventListener("offline", reset);
    window.addEventListener("online", reset);
    window.addEventListener("pageshow", reset);
    return () => {
      alive.current = false;
      enabled.current = false;
      audio.current?.dispose();
      audio.current = null;
      document.removeEventListener("visibilitychange", reset);
      window.removeEventListener("offline", reset);
      window.removeEventListener("online", reset);
      window.removeEventListener("pageshow", reset);
    };
  }, []);
  useEffect(() => {
    if (
      !game ||
      !connected ||
      document.visibilityState !== "visible" ||
      !navigator.onLine
    ) {
      previous.current = null;
      audio.current?.stop();
      return;
    }
    // A new state can publish just before its persistence/acknowledgement finishes.
    if (pending) return;
    const frame = soundFrame(game);
    const cues = soundsForTransition(previous.current, frame, listenerPlayerId);
    if (
      previous.current?.id !== frame.id ||
      frame.status === "paused" ||
      frame.revision < (previous.current?.revision ?? 0)
    )
      audio.current?.stop();
    previous.current = frame;
    if (enabled.current && cues.length) audio.current?.play(cues);
  }, [game, connected, pending, listenerPlayerId]);
  function remember(on: boolean) {
    preference.current = on;
    try {
      localStorage.setItem(SOUND_PREFERENCE, on ? "on" : "off");
    } catch {}
  }
  function mute() {
    ++attempt.current;
    remember(false);
    enabled.current = false;
    audio.current?.disable();
    setMode("off");
  }
  function unlock() {
    if (preference.current && !enabled.current) void enable();
  }
  async function enable() {
    const token = ++attempt.current;
    const player = audio.current;
    if (!player) return;
    setMode("loading");
    try {
      await player.enable();
      if (
        !alive.current ||
        audio.current !== player ||
        token !== attempt.current
      )
        return;
      enabled.current = true;
      setMode("on");
    } catch {
      if (
        !alive.current ||
        audio.current !== player ||
        token !== attempt.current
      )
        return;
      enabled.current = false;
      setMode("unavailable");
    }
  }
  function toggle() {
    if (mode === "on" || mode === "loading") mute();
    else {
      remember(true);
      void enable();
    }
  }
  const label =
    mode === "on"
      ? "Mute game sounds"
      : mode === "loading"
        ? "Cancel loading game sounds"
        : mode === "unavailable"
          ? "Retry game sounds"
          : mode === "waiting"
            ? "Activate game sounds"
            : "Enable game sounds";
  const control = (
    <>
      <button
        type="button"
        className="tabletop-tool game-sound-toggle"
        aria-label={label}
        title={`${label} · this device only`}
        aria-pressed={mode !== "off"}
        onClick={() => void toggle()}
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
          <path d="M4 9h4l5-4v14l-5-4H4z" />
          {mode !== "off" ? (
            <path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
          ) : (
            <path d="m17 9 5 6m0-6-5 6" />
          )}
        </svg>
        <span className="sr-only" role="status">
          {mode === "loading"
            ? "Loading sounds…"
            : mode === "unavailable"
              ? "Sound unavailable. Tap to retry; scoring is unaffected."
              : mode === "waiting"
                ? "Sound is on. Begin play or activate sounds on this device."
                : ""}
        </span>
      </button>
      {(mode === "waiting" || mode === "unavailable") && (
        <button
          type="button"
          className="tabletop-tool game-sound-toggle game-sound-mute"
          onClick={mute}
          aria-label="Mute game sounds"
          title="Mute game sounds · this device only"
        >
          Mute
        </button>
      )}
    </>
  );
  return { control, unlock };
}
