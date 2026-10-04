"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameState } from "../domain/game";
import type { SharedScorerStore } from "../lib/shared-store";
import { SwipeToDelete } from "./SwipeToDelete";
import { Modal } from "./Modal";

export function DeletePracticeGame({
  game,
  store,
  disabled,
  children,
  quit = false,
  onRemoved,
  initialOpen = false,
  onClose,
}: {
  game: GameState;
  store: SharedScorerStore;
  disabled: boolean;
  children?: ReactNode;
  quit?: boolean;
  onRemoved?: () => void;
  initialOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [confirmationReady, setConfirmationReady] = useState(false);
  useEffect(() => {
    if (!finalConfirm) return;
    const timer = setTimeout(() => setConfirmationReady(true), 500);
    return () => clearTimeout(timer);
  }, [finalConfirm]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const busy = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const state = store.getSnapshot();
  if (state.shared?.member.role !== "superadmin") return children ?? null;
  const practice = state.shared?.gameAccess[game.id]?.mode === "practice";
  if (
    quit &&
    (game.status === "finalized" || (!open && !store.canScore?.(game.id)))
  )
    return null;
  const action = quit
    ? "Quit game"
    : practice
      ? "Delete practice game"
      : game.status === "finalized"
        ? "Remove game"
        : "End and remove game";
  const remove = async (retry = false) => {
    if (busy.current || (!retry && (disabled || (!quit && !reason.trim()))))
      return;
    if (quit && !retry) {
      if (!finalConfirm || !confirmationReady) return;
      const latest = store.getSnapshot();
      const current = latest.data.games.find((item) => item.id === game.id);
      if (
        latest.shared?.member.role !== "superadmin" ||
        !store.canScore?.(game.id) ||
        !current ||
        current.status === "finalized" ||
        current.revision !== game.revision
      ) {
        setError(
          "This game or your scoring access changed. Keep playing or close this confirmation, then review the current game before trying again. Nothing was discarded.",
        );
        return;
      }
    }
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      if (retry) {
        await store.retry!();
        await store.refresh!();
      } else {
        await store.administer({
          type: practice ? "delete-practice-game" : "remove-game",
          gameId: game.id,
          expectedRevision: game.revision,
          reason: quit ? "Quit unfinished game" : reason.trim(),
        });
      }
      setOpen(false);
      onRemoved?.();
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
    <>
      {children ? (
        <SwipeToDelete
          actionLabel={`${action}…`}
          disabled={disabled || working}
          onDelete={() => setOpen(true)}
        >
          {children}
        </SwipeToDelete>
      ) : !initialOpen ? (
        <div className="game-delete-action">
          <button
            className={quit ? "button danger-outline" : "text-button"}
            disabled={disabled || working}
            onClick={() => setOpen(true)}
          >
            {quit ? action : `${action}…`}
          </button>
        </div>
      ) : null}
      {open && (
        <Modal
          key={finalConfirm ? "final" : "review"}
          title={
            quit
              ? finalConfirm
                ? "Are you sure?"
                : "Quit and discard this game?"
              : practice
                ? "Delete this practice game?"
                : `${action}?`
          }
          onClose={() => {
            if (!busy.current) {
              setOpen(false);
              onClose?.();
            }
          }}
          className="practice-delete-confirm"
          initialFocusRef={quit ? cancelRef : undefined}
        >
          <p>
            {quit
              ? "Discard this unfinished game? It will stop immediately and disappear from active games, History and the Record Book for everyone. It earns no awards or records, and you cannot resume it. Other games are kept."
              : "This stops further scoring and removes the game from Home, History and player records."}
          </p>
          <p className="muted">
            Saved scores and the removal reason stay in the internal audit
            archive. Unsent entries may remain on their original device for
            recovery, but cannot restore this game.
          </p>
          <strong>{game.players.map((p) => p.name).join(" · ")}</strong>
          <p>
            {game.turns.length} turns ·{" "}
            {new Date(game.definition.createdAt).toLocaleDateString()}
          </p>
          <p className="muted">Game ID: {game.id}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (quit && !finalConfirm) {
                setError(null);
                setConfirmationReady(false);
                setFinalConfirm(true);
              } else void remove();
            }}
          >
            {!quit && (
              <label className="field">
                {practice ? "Reason for deleting" : "Reason for removing"}
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  maxLength={240}
                  disabled={working || awaitingConfirmation}
                  placeholder="e.g. Duplicate or abandoned game"
                />
              </label>
            )}
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
                ref={cancelRef}
                disabled={working}
                onClick={() => {
                  setOpen(false);
                  onClose?.();
                }}
              >
                {awaitingConfirmation && state.unresolved
                  ? "Close for now"
                  : quit
                    ? finalConfirm
                      ? "Keep playing"
                      : "Cancel"
                    : "Keep game"}
              </button>
              {quit && finalConfirm && !awaitingConfirmation && (
                <button
                  type="button"
                  className="button light"
                  disabled={working}
                  onClick={() => {
                    setError(null);
                    setConfirmationReady(false);
                    setFinalConfirm(false);
                  }}
                >
                  Back
                </button>
              )}
              <button
                className="button danger-outline"
                disabled={
                  disabled ||
                  working ||
                  (!quit && !reason.trim()) ||
                  (quit && finalConfirm && !confirmationReady)
                }
              >
                {working
                  ? "Removing…"
                  : quit
                    ? finalConfirm
                      ? "Yes, quit this game"
                      : "Quit and discard"
                    : action}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
