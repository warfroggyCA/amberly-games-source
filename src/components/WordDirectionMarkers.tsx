"use client";
import { useState } from "react";
import type { wordCellFeedback } from "../domain/word-feedback";
import { Modal } from "./Modal";
import "./word-direction.css";
type Cells = ReturnType<typeof wordCellFeedback>;
export function WordDirectionMarkers({
  feedback,
}: {
  feedback?: Cells[string];
}) {
  if (feedback?.state !== "mixed") return null;
  return (
    <span className="word-direction-markers" aria-hidden="true">
      {Object.entries(feedback.edges).map(([edge, valid]) => (
        <span
          key={edge}
          data-word-edge={edge}
          data-word-valid={String(valid)}
          className={`word-edge edge-${edge} ${valid ? "edge-valid" : "edge-invalid"}`}
        />
      ))}
    </span>
  );
}
export function WordFeedbackHelp({
  cells,
  compact = false,
}: {
  cells: Cells;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mixed = Object.entries(cells).filter(
    ([, cell]) => cell.state === "mixed",
  );
  if (!mixed.length) return null;
  return (
    <>
      <button
        type="button"
        className={compact ? "tabletop-tool" : "gym-word-help"}
        aria-label="Word feedback"
        title="Word feedback"
        onClick={() => setOpen(true)}
      >
        {compact ? "↔" : "Word feedback"}
      </button>
      {open && (
        <Modal title="Word feedback" onClose={() => setOpen(false)}>
          <p>
            A cream letter with coloured edges belongs to words with different
            results. Each marker points toward the connected letters: green is
            valid, red is invalid.
          </p>
          <ul>
            {mixed.map(([key, cell]) => {
              const [row, col] = key.split(",").map(Number);
              return (
                <li key={key}>
                  <strong>
                    {String.fromCharCode(65 + col)}
                    {row + 1}
                  </strong>
                  : {cell.label}
                </li>
              );
            })}
          </ul>
          <p>
            Valid words do not guarantee a legal move. All formed words and
            placement rules must pass before recording.
          </p>
        </Modal>
      )}
    </>
  );
}
