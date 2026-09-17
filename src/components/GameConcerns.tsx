"use client";
import { hasPermission } from "../lib/member-permissions";
import { useRef, useState, useSyncExternalStore } from "react";
import type { GameState } from "../domain/game";
import type { SharedScorerStore } from "../lib/shared-store";
import { Modal } from "./Modal";

export function GameConcerns({
  game,
  store,
}: {
  game: GameState;
  store: SharedScorerStore;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const [dialog, setDialog] = useState<"report" | "review" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportedFor, setReportedFor] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [outcome, setOutcome] = useState<"dismissed" | "upheld">("dismissed");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const access = state.shared?.gameAccess[game.id];
  if (!access) return null;
  const protests = access.protests;
  const pending = protests.filter((p) => !p.resolution);
  const upheld = protests.some((p) => p.resolution?.outcome === "upheld");
  const current = protests.find((p) => p.id === selected);
  const admin = hasPermission(state.shared?.member, "resolveConcerns");
  const disabled = working || !!state.pending || !!state.unresolved;
  const timestamp = (value: string) =>
    new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  async function submit() {
    if (busy.current || disabled || !dialog) return;
    if (dialog === "review" && (!current || current.resolution || !admin))
      return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      await store.administer(
        dialog === "report"
          ? {
              type: "report-protest",
              gameId: game.id,
              reason: reportReason.trim(),
              reportedFor: reportedFor.trim() || null,
            }
          : {
              type: "resolve-protest",
              gameId: game.id,
              protestId: current!.id,
              outcome,
              reason: reviewReason.trim(),
            },
      );
      setDialog(null);
      setReportReason("");
      setReportedFor("");
      setReviewReason("");
      setSelected(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The concern could not be saved. Your entry is kept.",
      );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  return (
    <div className="game-concerns">
      {(pending.length > 0 || upheld) && (
        <p className="game-concern-banner" role="status">
          <strong>
            {pending.length > 0 ? "Under review" : "Excluded from records"}
          </strong>
          {pending.length > 0
            ? " A concern is awaiting review. This game stays in history and is held out of records."
            : " A reviewer upheld a concern. The game and its original scores remain in history."}
        </p>
      )}
      {protests.length > 0 && (
        <details className="game-concern-history">
          <summary>Concerns and review history ({protests.length})</summary>
          <ol>
            {protests.map((p) => (
              <li key={p.id}>
                <p>
                  <strong>{p.reportedBy}</strong>
                  {p.reportedFor
                    ? ` · reporting a concern for ${p.reportedFor}`
                    : ""}
                  <span className="muted"> · {timestamp(p.reportedAt)}</span>
                </p>
                <p className="concern-text">{p.reason}</p>
                {p.resolution ? (
                  <div className="concern-decision">
                    <strong>
                      {p.resolution.outcome === "upheld"
                        ? "Concern upheld · excluded from records"
                        : "Concern cleared"}
                    </strong>
                    <p className="concern-text">{p.resolution.reason}</p>
                    <small>
                      {p.resolution.resolvedBy} ·{" "}
                      {timestamp(p.resolution.resolvedAt)}
                    </small>
                  </div>
                ) : (
                  <div className="concern-actions">
                    <span>Awaiting review</span>
                    {admin && (
                      <button
                        className="button light"
                        disabled={disabled}
                        onClick={() => {
                          setSelected(p.id);
                          setOutcome("dismissed");
                          setReviewReason("");
                          setError(null);
                          setDialog("review");
                        }}
                      >
                        Review concern
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      <button
        className="text-button"
        disabled={disabled}
        onClick={() => {
          setError(null);
          setDialog("report");
        }}
      >
        Report a concern
      </button>
      {dialog && (
        <Modal
          title={
            dialog === "report"
              ? "Report a game concern"
              : "Review this concern"
          }
          onClose={() => setDialog(null)}
        >
          <form
            className="concern-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {dialog === "report" ? (
              <>
                <p>
                  The game will remain in history, with records held until an
                  authorized reviewer resolves the concern. Scoring can
                  continue.
                </p>
                <label className="field">
                  Reporting for someone else? (optional)
                  <input
                    maxLength={60}
                    value={reportedFor}
                    onChange={(e) => setReportedFor(e.target.value)}
                    placeholder="Their name"
                    disabled={working}
                  />
                </label>
                <p className="muted">
                  You can record a guest’s concern without asking them to sign
                  in. It will show that you reported it on their behalf.
                </p>
                <label className="field">
                  What needs reviewing?
                  <textarea
                    required
                    maxLength={2000}
                    rows={4}
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    disabled={working}
                  />
                </label>
              </>
            ) : (
              <>
                <p className="concern-text">{current?.reason}</p>
                {current?.resolution && (
                  <p role="alert">
                    This concern has already been reviewed. Close this dialog to
                    read the decision.
                  </p>
                )}
                <label className="field">
                  Decision
                  <select
                    value={outcome}
                    onChange={(e) =>
                      setOutcome(e.target.value as "dismissed" | "upheld")
                    }
                    disabled={working}
                  >
                    <option value="dismissed">Clear concern</option>
                    <option value="upheld">
                      Uphold concern — exclude from records
                    </option>
                  </select>
                </label>
                <p className="muted">
                  Clearing a concern restores only the game’s normal
                  eligibility. Beta, assisted, practice and other excluded
                  results stay excluded. Original scores and review history are
                  retained.
                </p>
                <label className="field">
                  Reason for this decision
                  <textarea
                    required
                    maxLength={2000}
                    rows={4}
                    value={reviewReason}
                    onChange={(e) => setReviewReason(e.target.value)}
                    disabled={working}
                  />
                </label>
              </>
            )}
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="button light"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={
                  disabled ||
                  (dialog === "report"
                    ? !reportReason.trim()
                    : !reviewReason.trim() ||
                      !current ||
                      !!current.resolution ||
                      !admin)
                }
              >
                {working
                  ? "Saving…"
                  : dialog === "report"
                    ? "Submit concern"
                    : "Save review decision"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
