"use client";
import { useRef, useState } from "react";
import {
  restoreDefaultColours,
  type PieceColour,
} from "../../domain/crokinole";
import { Modal } from "../Modal";
import { Disc } from "./Disc";
import "./crokinole.css";

export function ColourSettings({
  colours,
  revision,
  onSave,
  onClose,
  disabled = false,
}: {
  colours: PieceColour[];
  revision: number;
  onSave: (colours: PieceColour[], baseRevision: number) => Promise<void>;
  onClose: () => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState<PieceColour | null>(null);
  const [editRevision, setEditRevision] = useState(revision);
  const changed = !!editing && editRevision !== revision;
  function edit(colour: PieceColour) {
    setEditing({ ...colour });
    setEditRevision(revision);
    setError("");
  }
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const ordered = [...colours].sort((a, b) => a.sortOrder - b.sortOrder);
  async function save(next: PieceColour[], baseRevision = revision) {
    if (lock.current || disabled || changed) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave(
        next.map((c, sortOrder) => ({ ...c, sortOrder })),
        baseRevision,
      );
      setEditing(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save colours. Try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function move(index: number, direction: number) {
    const next = [...ordered];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    void save(next);
  }
  return (
    <Modal
      title="Piece colours"
      onClose={() => {
        if (!busy) onClose();
      }}
      className="crokinole-dialog"
    >
      <p className="crokinole-subtitle">
        Shared equipment for Crokinole. Existing games keep their original
        colours.
      </p>
      {error && (
        <p role="alert" className="crokinole-error">
          {error}
        </p>
      )}
      {changed && (
        <p role="alert">
          Piece colours changed while you were editing. Your entry is still
          here. Discard these changes and reopen the saved colour before editing
          again.
        </p>
      )}
      {ordered.map((colour, index) => (
        <div className="crokinole-palette-row" key={colour.id}>
          <div className="crokinole-identity">
            <Disc value={colour.value} label={colour.name} />
            <span>
              {colour.name}
              {!colour.isActive && <small> · Hidden</small>}
            </span>
          </div>
          <button
            className="button light"
            aria-label={`Move ${colour.name} earlier`}
            disabled={busy || disabled || !!editing || index === 0}
            onClick={() => move(index, -1)}
          >
            ↑
          </button>
          <button
            className="button light"
            aria-label={`Move ${colour.name} later`}
            disabled={
              busy || disabled || !!editing || index === ordered.length - 1
            }
            onClick={() => move(index, 1)}
          >
            ↓
          </button>
          {!colour.isDefault && (
            <button
              className="text-button"
              disabled={busy || disabled || !!editing}
              onClick={() => edit(colour)}
            >
              Edit {colour.name}
            </button>
          )}
          <button
            className="text-button"
            disabled={busy || disabled || !!editing}
            onClick={() =>
              void save(
                ordered.map((c) =>
                  c.id === colour.id ? { ...c, isActive: !c.isActive } : c,
                ),
              )
            }
          >
            {colour.isActive ? "Hide" : "Show"} {colour.name}
          </button>
        </div>
      ))}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editing.name.trim() && /^#[0-9a-f]{6}$/i.test(editing.value))
              void save(
                [
                  ...ordered.filter((c) => c.id !== editing.id),
                  { ...editing, name: editing.name.trim() },
                ].sort((a, b) => a.sortOrder - b.sortOrder),
                editRevision,
              );
          }}
        >
          <div className="crokinole-fields">
            <label className="crokinole-field">
              Colour name
              <input
                required
                maxLength={60}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label className="crokinole-field">
              Colour
              <input
                type="color"
                value={editing.value}
                onChange={(e) =>
                  setEditing({ ...editing, value: e.target.value })
                }
              />
            </label>
          </div>
          <div className="crokinole-actions">
            <button
              className="button primary"
              disabled={busy || disabled || changed || !editing.name.trim()}
            >
              Save colour
            </button>
            <button
              type="button"
              className="button light"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              {changed ? "Discard changes" : "Cancel"}
            </button>
          </div>
        </form>
      ) : (
        <div className="crokinole-actions">
          <button
            className="button primary"
            disabled={busy || disabled}
            onClick={() =>
              edit({
                id: crypto.randomUUID(),
                name: "",
                value: "#356a4e",
                isDefault: false,
                isActive: true,
                sortOrder: ordered.length,
              })
            }
          >
            Add colour
          </button>
          <button
            className="button light"
            disabled={busy || disabled}
            onClick={() => void save(restoreDefaultColours(ordered))}
          >
            Restore defaults
          </button>
        </div>
      )}
    </Modal>
  );
}
