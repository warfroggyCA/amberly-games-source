"use client";
import { useState } from "react";
import {
  getTileSupply,
  getTileTotal,
  type GameState,
  type GameCommand,
} from "../domain/game";
import type { Placement } from "../domain/types";
import { Modal } from "./Modal";
type Extension = Omit<
  Extract<GameCommand, { type: "extend-supply" }>,
  "id" | "expectedRevision"
>;
export function ExtraTiles({
  game,
  placements,
  busy,
  error,
  onClose,
  onSave,
}: {
  game: GameState;
  placements: Placement[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (command: Extension) => Promise<void>;
}) {
  const [reason, setReason] = useState("Our set contains extra tiles");
  const [scorer, setScorer] = useState("");
  const supply = getTileSupply(game);
  const used: Record<string, number> = {};
  for (const tile of [
    ...game.board.flat().filter((tile) => tile !== null),
    ...placements.map((p) => p.tile),
  ]) {
    const letter = tile.blank ? "?" : tile.letter;
    used[letter] = (used[letter] ?? 0) + 1;
  }
  const additions = Object.fromEntries(
    Object.entries(supply).flatMap(([letter, count]) =>
      (used[letter] ?? 0) > count ? [[letter, used[letter] - count]] : [],
    ),
  );
  const extra = Object.values(additions).reduce((sum, n) => sum + n, 0);
  return (
    <Modal title="Use extra tiles?" onClose={onClose}>
      <p>
        {Object.entries(additions)
          .map(
            ([letter, count]) =>
              `${count} extra ${letter === "?" ? "blank" : letter}`,
          )
          .join(" and ")}{" "}
        {extra === 1 ? "is" : "are"} needed for these letters.
      </p>
      <p>
        This changes this game’s set from{" "}
        <strong>
          {getTileTotal(game)} to {getTileTotal(game) + extra} tiles
        </strong>
        . Confirm your physical set contains those extra tiles. The bag estimate
        increases by {extra}; you can check the actual counts afterward.
      </p>
      <p className="inline-message">
        This game will be marked nonstandard and excluded from player records.
        The change and your reason stay in its history.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!busy && extra > 0)
            await onSave({
              type: "extend-supply",
              additions,
              reason: reason.trim(),
              recordedBy: scorer.trim(),
              recordedAt: new Date().toISOString(),
            });
        }}
      >
        <label className="field">
          Reason
          <input
            required
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          Scorer name
          <input
            required
            maxLength={60}
            value={scorer}
            onChange={(e) => setScorer(e.target.value)}
            disabled={busy}
          />
        </label>
        <p className="muted">
          This local preview records the name you enter. Check the board first:
          after changing the set, Undo can reverse later turns only.
        </p>
        {error && (
          <p className="inline-message" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="button light" type="button" onClick={onClose}>
            Keep standard set
          </button>
          <button
            className="button primary"
            disabled={
              busy ||
              !extra ||
              !scorer.trim() ||
              !reason.trim() ||
              getTileTotal(game) + extra > 200
            }
          >
            Use anyway · Add {extra} {extra === 1 ? "tile" : "tiles"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
