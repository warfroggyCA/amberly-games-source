"use client";
import { useState } from "react";
import type { Draft } from "../lib/preview-store";
import { Modal } from "./Modal";

export function DraftConflictNotice({
  gameId,
  revision,
  draft,
  pending,
  onDiscard,
  onExport,
}: {
  gameId: string;
  revision: number;
  draft: Draft;
  pending: boolean;
  onDiscard: (gameId: string, expectedRevision: number) => Promise<void>;
  onExport?: () => void;
}) {
  const [confirmRevision, setConfirmRevision] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  return (
    <section
      className="draft-conflict-notice"
      aria-label="Retained Scrabble draft"
    >
      <h2>This game changed on another device</h2>
      <p>
        Your unrecorded tiles are kept below. The board shows the latest saved
        game. Review it before discarding this draft and entering a new play.
      </p>
      <ul aria-label="Retained tiles">
        {draft.placements.map(({ row, col, tile }) => (
          <li key={`${row}-${col}`}>
            {tile.letter}
            {tile.blank ? " (blank)" : ""} · row {row + 1}, column {col + 1}
          </li>
        ))}
      </ul>
      {pending && (
        <p>
          Confirm the interrupted save first. It may already include this entry.
        </p>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button className="button light" onClick={onExport}>
          Export retained entry
        </button>
        <button
          className="button light"
          disabled={pending || working}
          onClick={() => {
            setError("");
            setConfirmRevision(revision);
          }}
        >
          Discard retained draft…
        </button>
      </div>
      <p>You can leave this draft here and use other games or history.</p>
      {confirmRevision !== null && (
        <Modal
          title="Discard this retained draft?"
          onClose={() => {
            if (!working) setConfirmRevision(null);
          }}
        >
          <p>
            This removes only the unrecorded tiles listed above from this
            device. Saved turns and scores stay intact. Export the entry first
            if you want to keep a copy.
          </p>
          <div className="button-row">
            <button
              className="button light"
              disabled={working}
              onClick={() => setConfirmRevision(null)}
            >
              Keep draft
            </button>
            <button
              className="button primary"
              disabled={working}
              onClick={async () => {
                if (working) return;
                setWorking(true);
                try {
                  await onDiscard(gameId, confirmRevision);
                  setConfirmRevision(null);
                } catch (value) {
                  setError(
                    value instanceof Error
                      ? value.message
                      : "The draft could not be cleared. It is still retained.",
                  );
                  setConfirmRevision(null);
                } finally {
                  setWorking(false);
                }
              }}
            >
              Discard draft
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
