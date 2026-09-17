"use client";
import { useRef, useState } from "react";
import type { GameState } from "../domain/game";
import type { SharedScorerStore } from "../lib/shared-store";
import { Modal } from "./Modal";

export function DeletePracticeGame({
  game,
  store,
  disabled,
}: {
  game: GameState;
  store: SharedScorerStore;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const busy = useRef(false);
  const state = store.getSnapshot();
  if (
    state.shared?.member.role !== "superadmin" ||
    state.shared?.gameAccess[game.id]?.mode !== "practice"
  )
    return null;
  const remove = async (retry = false) => {
    if (busy.current || (!retry && (disabled || !reason.trim()))) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      if (retry) {
        await store.retry!();
        await store.refresh!();
      } else {
        await store.administer({
          type: "delete-practice-game",
          gameId: game.id,
          expectedRevision: game.revision,
          reason: reason.trim(),
        });
      }
      setOpen(false);
    } catch (e) {
      setAwaitingConfirmation(!!store.getSnapshot().unresolved);
      setError(
        e instanceof Error ? e.message : "The game could not be deleted.",
      );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  };
  return (
    <div className="game-delete-action">
      <button
        className="text-button"
        disabled={disabled || working}
        onClick={() => setOpen(true)}
      >
        Delete practice game…
      </button>
      {open && (
        <Modal
          title="Delete this practice game?"
          onClose={() => {
            if (!busy.current) setOpen(false);
          }}
          className="practice-delete-confirm"
        >
          <p>
            This removes the test from the superadmin game list and history. Its
            original data and this deletion remain in the internal audit
            archive.
          </p>
          <strong>{game.players.map((p) => p.name).join(" · ")}</strong>
          <p>
            {game.turns.length} turns ·{" "}
            {new Date(game.definition.createdAt).toLocaleDateString()}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void remove();
            }}
          >
            <label className="field">
              Reason for deleting
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                maxLength={240}
                disabled={working || awaitingConfirmation}
                placeholder="e.g. Finished testing word entry"
              />
            </label>
            {error && (
              <p role="alert" className="error-banner">
                {error}
              </p>
            )}
            {awaitingConfirmation && state.unresolved && (
              <p role="status">
                Confirm the saved deletion before making another change.
                <button
                  type="button"
                  className="button light"
                  disabled={working || !!state.pending}
                  onClick={() => void remove(true)}
                >
                  Retry saved deletion
                </button>
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="button light"
                disabled={working}
                onClick={() => setOpen(false)}
              >
                {awaitingConfirmation && state.unresolved
                  ? "Close for now"
                  : "Keep game"}
              </button>
              <button
                className="button danger-outline"
                disabled={disabled || working || !reason.trim()}
              >
                {working ? "Deleting…" : "Delete practice game"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
