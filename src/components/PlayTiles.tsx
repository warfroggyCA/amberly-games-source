"use client";
import { useState } from "react";
import "./play-tiles.css";

export function PlayTiles({
  loading = false,
  compact = false,
}: {
  loading?: boolean;
  compact?: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const rack = (
    <span
      className={`family-welcome-rack${loading && !paused ? " is-loading" : ""}`}
      aria-hidden="true"
    >
      {[
        ["P", 3],
        ["L", 1],
        ["A", 1],
        ["Y", 4],
      ].map(([letter, points]) => (
        <span className="family-welcome-tile" key={letter}>
          <b>{letter}</b>
          <small>{points}</small>
        </span>
      ))}
    </span>
  );
  return compact ? (
    <button
      type="button"
      className="hub-play-toggle"
      aria-label={paused ? "Resume PLAY animation" : "Pause PLAY animation"}
      title={paused ? "Resume PLAY animation" : "Pause PLAY animation"}
      onClick={() => setPaused(!paused)}
    >
      {rack}
    </button>
  ) : (
    rack
  );
}
