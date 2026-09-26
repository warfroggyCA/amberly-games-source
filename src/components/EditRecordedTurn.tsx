"use client";
import { useState } from "react";
import type { GameTurn } from "../domain/game";
import type { Letter, Placement } from "../domain/types";

export function EditRecordedTurn({
  turn,
  disabled,
  onSave,
}: {
  turn: GameTurn;
  disabled: boolean;
  onSave: (placements: Placement[], reason: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [placements, setPlacements] = useState(() =>
    structuredClone(turn.placements),
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  if (!editing)
    return (
      <button
        className="button light"
        disabled={disabled}
        onClick={() => setEditing(true)}
      >
        Edit this play
      </button>
    );
  return (
    <form
      className="recorded-turn-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        try {
          await onSave(placements, reason);
        } finally {
          setSaving(false);
        }
      }}
    >
      <p>
        Correct the placed tiles below. Later plays and totals are checked again
        before saving. The original entry is retained.
      </p>
      {placements.map((p, index) => (
        <div className="recorded-tile" key={index}>
          <label>
            Row
            <input
              type="number"
              min={1}
              max={15}
              required
              value={p.row + 1}
              disabled={saving || disabled}
              onChange={(e) =>
                setPlacements((ps) =>
                  ps.map((v, i) =>
                    i === index ? { ...v, row: Number(e.target.value) - 1 } : v,
                  ),
                )
              }
            />
          </label>
          <label>
            Column
            <input
              type="number"
              min={1}
              max={15}
              required
              value={p.col + 1}
              disabled={saving || disabled}
              onChange={(e) =>
                setPlacements((ps) =>
                  ps.map((v, i) =>
                    i === index ? { ...v, col: Number(e.target.value) - 1 } : v,
                  ),
                )
              }
            />
          </label>
          <label>
            Letter
            <input
              maxLength={1}
              pattern="[A-Za-z]"
              required
              value={p.tile.letter}
              disabled={saving || disabled}
              onChange={(e) =>
                setPlacements((ps) =>
                  ps.map((v, i) =>
                    i === index
                      ? {
                          ...v,
                          tile: {
                            ...v.tile,
                            letter: e.target.value.toUpperCase() as Letter,
                          },
                        }
                      : v,
                  ),
                )
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={p.tile.blank}
              disabled={saving || disabled}
              onChange={(e) =>
                setPlacements((ps) =>
                  ps.map((v, i) =>
                    i === index
                      ? { ...v, tile: { ...v.tile, blank: e.target.checked } }
                      : v,
                  ),
                )
              }
            />
            Blank · 0 points
          </label>
          <button
            type="button"
            className="text-button"
            disabled={saving || disabled || placements.length === 1}
            onClick={() =>
              setPlacements((ps) => ps.filter((_, i) => i !== index))
            }
          >
            Remove tile {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button light"
        disabled={saving || disabled || placements.length >= 7}
        onClick={() =>
          setPlacements((ps) => [
            ...ps,
            { row: 7, col: 7, tile: { letter: "A", blank: false } },
          ])
        }
      >
        Add tile
      </button>
      <label>
        Reason for correction
        <input
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={saving || disabled}
        />
      </label>
      <button
        type="submit"
        className="button primary"
        disabled={saving || disabled || !reason.trim()}
      >
        {saving ? "Checking & saving…" : "Save correction"}
      </button>
      <button
        type="button"
        className="button light"
        disabled={saving}
        onClick={() => setEditing(false)}
      >
        Cancel edit
      </button>
    </form>
  );
}
