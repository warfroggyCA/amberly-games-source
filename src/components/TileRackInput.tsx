"use client";
import { useId, useRef, useState } from "react";
import { LETTER_VALUES } from "../domain/board";
import type { Letter } from "../domain/types";
import { parseRackEntry, rackAvailabilityError } from "../lib/rack-entry";
import "./playersetup.css";

export function TileRackInput({
  label,
  value,
  onChange,
  readOnly = false,
  maxTiles = 7,
  availableTiles,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  maxTiles?: number;
  availableTiles?: Readonly<Record<string, number>>;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseRackEntry(value, maxTiles);
  const slotCount =
    Number.isInteger(maxTiles) && maxTiles >= 0 && maxTiles <= 7 ? maxTiles : 7;
  const tiles = parsed.ok ? [...parsed.value] : [];
  const message = error ?? (parsed.ok ? null : parsed.error);
  const remove = (index: number) => {
    if (readOnly || !parsed.ok) return;
    onChange(tiles.filter((_, position) => position !== index).join(""));
    setError(null);
  };
  return (
    <div className="tile-rack-field">
      <label htmlFor={inputId}>
        {label}
        <small>
          {tiles.length} / {maxTiles} tiles
        </small>
      </label>
      <div className="physical-rack" aria-label={`${label} tile rack`}>
        {Array.from({ length: slotCount }, (_, index) => {
          const letter = tiles[index];
          if (!letter)
            return (
              <button
                type="button"
                key={index}
                className="rack-empty-slot"
                aria-label={`Enter letters for ${label}, space ${index + 1}`}
                disabled={readOnly}
                onClick={() => inputRef.current?.focus()}
              />
            );
          const points = letter === "?" ? 0 : LETTER_VALUES[letter as Letter];
          return (
            <button
              type="button"
              key={index}
              className={`rack-letter ${letter === "?" ? "rack-blank" : ""}`}
              aria-label={`Remove ${letter === "?" ? "blank" : letter} tile ${index + 1} from ${label}`}
              disabled={readOnly}
              onClick={() => remove(index)}
              onKeyDown={(event) => {
                if (event.key === "Backspace" || event.key === "Delete") {
                  event.preventDefault();
                  remove(index);
                }
              }}
            >
              <b>{letter === "?" ? "?" : letter}</b>
              <small>{points}</small>
            </button>
          );
        })}
      </div>
      <input
        ref={inputRef}
        id={inputId}
        aria-label={label}
        aria-describedby={`${inputId}-hint${message ? ` ${inputId}-error` : ""}`}
        aria-invalid={!!message}
        value={value}
        readOnly={readOnly}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Type letters · ? for blank"
        onChange={(event) => {
          if (readOnly) return;
          const next = parseRackEntry(event.target.value, maxTiles);
          if (!next.ok) {
            setError(next.error);
            return;
          }
          const unavailable = availableTiles
            ? rackAvailabilityError(next.value, availableTiles)
            : null;
          if (unavailable) {
            setError(unavailable);
            return;
          }
          setError(null);
          onChange(next.value);
        }}
      />
      <small id={`${inputId}-hint`} className="rack-entry-hint">
        {readOnly
          ? "These tiles come from the recorded rack."
          : "Tap an empty rack space or the box below to type. Tap a letter to remove it. ? is a blank."}
      </small>
      {message && (
        <p id={`${inputId}-error`} className="rack-entry-error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
