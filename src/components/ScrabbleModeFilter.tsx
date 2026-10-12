"use client";
import type { ScrabbleMode } from "../lib/scrabble-mode";
export function ScrabbleModeFilter({
  value,
  onChange,
}: {
  value: ScrabbleMode;
  onChange: (mode: ScrabbleMode) => void;
}) {
  return (
    <label className="book-context">
      Scrabble mode{" "}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ScrabbleMode)}
      >
        <option value="all">All games</option>
        <option value="classic">Classic</option>
        <option value="word-buddy">Word Buddy</option>
      </select>
    </label>
  );
}
