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

export function useGameSounds(
  game: SoundGame | null,
  connected = true,
  pending = false,
) {
  const previous = useRef<SoundFrame | null>(null);
  const audio = useRef<GameAudio | null>(null);
  const enabled = useRef(false);
  const alive = useRef(false);
  const attempt = useRef(0);
  const [mode, setMode] = useState<"off" | "loading" | "on" | "unavailable">(
    "off",
  );
  useEffect(() => {
    alive.current = true;
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
    const cues = soundsForTransition(previous.current, frame);
    if (
      previous.current?.id !== frame.id ||
      frame.status === "paused" ||
      frame.revision < (previous.current?.revision ?? 0)
    )
      audio.current?.stop();
    previous.current = frame;
    if (enabled.current && cues.length) audio.current?.play(cues);
  }, [game, connected, pending]);
  async function toggle() {
    const token = ++attempt.current;
    if (mode === "on" || mode === "loading") {
      enabled.current = false;
      audio.current?.disable();
      setMode("off");
      return;
    }
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
  const label =
    mode === "on"
      ? "Mute game sounds"
      : mode === "loading"
        ? "Cancel loading game sounds"
        : mode === "unavailable"
          ? "Retry game sounds"
          : "Enable game sounds";
  return (
    <button
      type="button"
      className="tabletop-tool game-sound-toggle"
      aria-label={label}
      title={`${label} · this device only`}
      aria-pressed={mode === "on"}
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
        {mode === "on" ? (
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
            : ""}
      </span>
    </button>
  );
}
