"use client";
import { useRef, useState } from "react";
import {
  DEFAULT_CROKINOLE_SETTINGS,
  isCrokinoleDefaults,
  type CrokinoleDefaults,
} from "../../domain/crokinole-defaults";
import type { CrokinoleScoringMode } from "../../domain/crokinole";
import { SCORING_LABELS } from "./CrokinoleSetup";
import { CrokinoleRules } from "./CrokinoleRules";
import { Modal } from "../Modal";
export function CrokinoleDefaultsSettings({
  initial,
  onSave,
  onClose,
  busy,
  canEdit,
}: {
  initial?: CrokinoleDefaults;
  onSave: (settings: CrokinoleDefaults) => Promise<void>;
  onClose: () => void;
  busy: boolean;
  canEdit: boolean;
}) {
  const [settings, setSettings] = useState(
    initial ?? DEFAULT_CROKINOLE_SETTINGS,
  );
  const [length, setLength] = useState(
    String(
      settings.endCondition.type === "target"
        ? settings.endCondition.target
        : settings.endCondition.rounds,
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const disabled = busy || saving || !canEdit;
  const free = settings.format === "free_for_all";
  const candidate = {
    ...settings,
    endCondition:
      settings.endCondition.type === "target"
        ? { type: "target" as const, target: Number(length) }
        : { type: "fixed_rounds" as const, rounds: Number(length) },
  };
  async function save() {
    if (lock.current || disabled || !isCrokinoleDefaults(candidate)) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(candidate);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your choices are still here.",
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Crokinole rules & family defaults"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <p>
        Used for new games by everyone in Amberly. Existing games and rematches
        keep their rules.
      </p>
      {!canEdit && (
        <p>
          Your account can view these settings. Permission to manage equipment
          is required to change family defaults.
        </p>
      )}
      <div className="crokinole-fields">
        <label className="crokinole-field">
          Default play format
          <select
            disabled={disabled}
            value={`${settings.playerCount}:${settings.format}`}
            onChange={(e) => {
              const [n, f] = e.target.value.split(":");
              const format = f as CrokinoleDefaults["format"];
              const incompatible =
                format === "free_for_all" &&
                !["net_winner_only", "cumulative_round_totals"].includes(
                  settings.scoringMode,
                );
              setSettings({
                ...settings,
                playerCount: Number(n) as 2 | 3 | 4,
                format,
                ...(incompatible
                  ? {
                      scoringMode: "net_winner_only",
                      endCondition: { type: "target", target: 300 },
                    }
                  : {}),
              });
              if (incompatible) setLength("300");
            }}
          >
            <option value="2:singles">2 players · Singles</option>
            <option value="3:free_for_all">3 players · Individual</option>
            <option value="4:doubles">4 players · Doubles</option>
            <option value="4:free_for_all">4 players · Individual</option>
          </select>
        </label>
        <label className="crokinole-field">
          Default scoring method
          <select
            disabled={disabled}
            value={settings.scoringMode}
            onChange={(e) => {
              const scoringMode = e.target.value as CrokinoleScoringMode;
              const nca = scoringMode === "nca_match_points";
              setSettings({
                ...settings,
                scoringMode,
                endCondition: nca
                  ? { type: "fixed_rounds", rounds: 4 }
                  : { type: "target", target: 300 },
              });
              setLength(nca ? "4" : "300");
            }}
          >
            {Object.entries(SCORING_LABELS)
              .filter(
                ([v]) =>
                  !free ||
                  ["net_winner_only", "cumulative_round_totals"].includes(v),
              )
              .map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label className="crokinole-field">
          Default match length
          <select
            disabled={
              disabled || settings.scoringMode === "traditional_differential"
            }
            value={settings.endCondition.type}
            onChange={(e) => {
              const target = e.target.value === "target";
              const n = settings.scoringMode === "nca_match_points" ? 5 : 300;
              setSettings({
                ...settings,
                endCondition: target
                  ? { type: "target", target: n }
                  : { type: "fixed_rounds", rounds: 4 },
              });
              setLength(String(target ? n : 4));
            }}
          >
            <option value="target">First to a target</option>
            <option value="fixed_rounds">Fixed rounds</option>
          </select>
        </label>
        <label className="crokinole-field">
          {settings.endCondition.type === "target"
            ? "Default target"
            : "Default rounds"}
          <input
            disabled={disabled}
            type="number"
            inputMode="numeric"
            min="1"
            value={length}
            onChange={(e) => setLength(e.target.value)}
          />
        </label>
      </div>
      <CrokinoleRules mode={settings.scoringMode} />
      {!isCrokinoleDefaults(candidate) && (
        <p role="alert">
          Choose a positive target in multiples of five, or a valid round count.
          NCA-style games use four rounds or a target of 5, 7, 9 or 11.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="crokinole-actions">
        <button className="button light" disabled={saving} onClick={onClose}>
          Close
        </button>
        {canEdit && (
          <button
            className="button primary"
            disabled={disabled || !isCrokinoleDefaults(candidate)}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save family defaults"}
          </button>
        )}
      </div>
    </Modal>
  );
}
