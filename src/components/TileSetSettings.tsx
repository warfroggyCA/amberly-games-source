"use client";
import { useRef, useState } from "react";
import {
  LETTER_COUNTS,
  LETTER_VALUES,
  MAX_TILE_TOTAL,
  type TileSupply,
} from "../domain/board";
import {
  EMPTY_EQUIPMENT,
  isEquipment,
  standardSupply,
  tileTotal,
  type Equipment,
  type TileSet,
} from "../domain/equipment";
import type { ScorerStore } from "../lib/scorer-store";
import { Modal } from "./Modal";
import "./tile-sets.css";

type Editing = {
  set: TileSet;
  revision: number;
  isDefault: boolean;
  counted: boolean;
  quantities: Record<string, string>;
};
export function TileSetSettings({
  store,
  equipment = EMPTY_EQUIPMENT,
  disabled,
  onClose,
}: {
  store: ScorerStore;
  equipment?: Equipment;
  disabled: boolean;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locked = disabled || busy;
  const counts = editing
    ? (Object.fromEntries(
        Object.entries(editing.quantities).map(([key, text]) => [
          key,
          /^\d+$/.test(text) ? Number(text) : NaN,
        ]),
      ) as TileSupply)
    : null;
  const total = counts ? tileTotal(counts) : 100;
  const valid =
    !!editing &&
    !!counts &&
    isEquipment({
      revision: editing.revision + 1,
      sets: [{ ...editing.set, name: editing.set.name.trim(), counts }],
      defaultSetId: null,
    });
  function begin(set?: TileSet) {
    const value = set ?? {
      id: crypto.randomUUID(),
      name: "",
      counts: { ...LETTER_COUNTS },
      checkedAt: null,
    };
    setEditing({
      set: structuredClone(value),
      revision: equipment.revision,
      isDefault: !set || equipment.defaultSetId === set.id,
      counted: false,
      quantities: Object.fromEntries(
        Object.entries(value.counts).map(([key, n]) => [key, String(n)]),
      ),
    });
    setError(null);
    setNotice(null);
  }
  async function save(next: Equipment) {
    if (working.current || disabled) return;
    working.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await store.update((data) => {
        if ((data.equipment?.revision ?? 0) !== next.revision - 1)
          throw new Error(
            "Tile sets changed while you were editing. Your edits are still here; discard them and reload to review the saved quantities.",
          );
        return { ...data, equipment: next };
      });
      setEditing(null);
      setNotice(
        "Tile sets saved. Existing games keep their original quantities.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save. Your changes are still here.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function quantity(letter: string, value: string) {
    setEditing((current) =>
      current
        ? { ...current, quantities: { ...current.quantities, [letter]: value } }
        : current,
    );
  }
  return (
    <Modal
      title="Settings"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
      className="tile-set-settings"
    >
      <h3>Tile sets</h3>
      <p>
        Count your complete set, including blanks, before dealing. New games
        automatically use your default.
      </p>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || !counts || locked) return;
            const changed = Object.entries(counts).some(
              ([letter, n]) =>
                n !== editing.set.counts[letter as keyof TileSupply],
            );
            const set: TileSet = {
              ...editing.set,
              name: editing.set.name.trim(),
              counts,
              checkedAt: editing.counted
                ? new Date().toISOString()
                : changed
                  ? null
                  : editing.set.checkedAt,
            };
            void save({
              revision: editing.revision + 1,
              sets: [...equipment.sets.filter((s) => s.id !== set.id), set],
              defaultSetId: editing.isDefault
                ? set.id
                : equipment.defaultSetId === set.id
                  ? null
                  : equipment.defaultSetId,
            });
          }}
        >
          <fieldset disabled={locked} className="tile-set-fields">
            <label className="field">
              Set name
              <input
                value={editing.set.name}
                maxLength={60}
                required
                autoComplete="off"
                placeholder="e.g. New living room set"
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    set: { ...editing.set, name: e.target.value },
                  })
                }
              />
            </label>
            <div className="tile-set-total" role="status">
              <strong>{Number.isFinite(total) ? total : "—"}</strong> tiles in
              this set{" "}
              <span>
                {counts && Number.isFinite(total) && standardSupply(counts)
                  ? "Standard quantities"
                  : "Custom quantities"}
              </span>
            </div>
            <div className="tile-set-grid">
              {Object.entries(LETTER_COUNTS).map(([letter, original]) => {
                const label = letter === "?" ? "Blank" : letter;
                const value = editing.quantities[letter];
                const number = /^\d+$/.test(value) ? Number(value) : 0;
                return (
                  <div className="tile-set-letter" key={letter}>
                    <span
                      className={`letter-tile equipment-tile ${letter === "?" ? "equipment-blank" : ""}`}
                      aria-hidden="true"
                    >
                      <b>{letter === "?" ? "" : letter}</b>
                      <small>
                        {letter === "?"
                          ? 0
                          : LETTER_VALUES[letter as keyof typeof LETTER_VALUES]}
                      </small>
                      {letter === "?" && <span>blank</span>}
                    </span>
                    <div className="tile-quantity-controls">
                      <button
                        type="button"
                        aria-label={`Remove one ${label}`}
                        disabled={number <= 0}
                        onClick={() => quantity(letter, String(number - 1))}
                      >
                        −
                      </button>
                      <input
                        aria-label={`${label} quantity`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MAX_TILE_TOTAL}
                        step={1}
                        required
                        value={value}
                        onChange={(e) => quantity(letter, e.target.value)}
                      />
                      <button
                        type="button"
                        aria-label={`Add one ${label}`}
                        disabled={number >= MAX_TILE_TOTAL}
                        onClick={() => quantity(letter, String(number + 1))}
                      >
                        +
                      </button>
                    </div>
                    <small>Standard: {original}</small>
                  </div>
                );
              })}
            </div>
            <div className="tile-set-checks">
              <label>
                <input
                  type="checkbox"
                  checked={editing.isDefault}
                  onChange={(e) =>
                    setEditing({ ...editing, isDefault: e.target.checked })
                  }
                />{" "}
                Use this set by default
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={editing.counted}
                  onChange={(e) =>
                    setEditing({ ...editing, counted: e.target.checked })
                  }
                />{" "}
                I’ve counted the tiles and confirmed these quantities
              </label>
            </div>
            <p className="muted">
              You can save 1–200 tiles. Starting a game requires seven tiles per
              player. Custom quantities stay in history and are excluded from
              standard player records.
            </p>
            <div className="dialog-actions">
              <button
                className="button light"
                type="button"
                onClick={() => {
                  setEditing(null);
                  setError(null);
                }}
              >
                Cancel edits
              </button>
              <button className="button primary" disabled={!valid}>
                {busy ? "Saving…" : "Save tile set"}
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <ul className="tile-set-list">
            <li>
              <div>
                <strong>Standard English set</strong>
                <span>
                  100 tiles · standard quantities
                  {equipment.defaultSetId === null ? " · Default" : ""}
                </span>
              </div>
              {equipment.defaultSetId !== null && (
                <button
                  className="button light"
                  disabled={locked}
                  onClick={() =>
                    void save({
                      ...equipment,
                      revision: equipment.revision + 1,
                      defaultSetId: null,
                    })
                  }
                >
                  Make default
                </button>
              )}
            </li>
            {equipment.sets.map((set) => (
              <li key={set.id}>
                <div>
                  <strong>
                    {set.name}
                    {equipment.defaultSetId === set.id ? " · Default" : ""}
                  </strong>
                  <span>
                    {tileTotal(set.counts)} tiles ·{" "}
                    {set.checkedAt
                      ? `Counted ${new Date(set.checkedAt).toLocaleDateString()}`
                      : "Counts not confirmed"}
                  </span>
                </div>
                <button
                  className="button light"
                  disabled={locked}
                  onClick={() => begin(set)}
                  aria-label={`Edit ${set.name}`}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
          <button
            className="button primary"
            disabled={locked || equipment.sets.length >= 20}
            onClick={() => begin()}
          >
            Add a tile set
          </button>
          <p className="muted">
            {store.mode === "shared"
              ? "Sets are shared with your family. Changes are recorded with the scorer’s account."
              : "Sets are saved on this device."}{" "}
            Changes apply to future games.
          </p>
        </>
      )}
      {notice && (
        <p role="status" className="inline-message">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="inline-message">
          <p>{error}</p>
          {store.refresh && (
            <button
              className="button light"
              disabled={locked}
              onClick={async () => {
                if (working.current) return;
                working.current = true;
                setBusy(true);
                try {
                  await store.refresh!();
                  setEditing(null);
                  setError(null);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Refresh failed. Your edits are retained.",
                  );
                } finally {
                  working.current = false;
                  setBusy(false);
                }
              }}
            >
              Discard edits and reload saved sets
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
