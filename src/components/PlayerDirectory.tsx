"use client";
import { useRef, useState, type ReactNode } from "react";
import type { SharedOperation, SharedState } from "../lib/shared-contract";
import type { SavedPlayer } from "../lib/preview-store";
import { hasPermission } from "../lib/member-permissions";
import { playerDisplayName } from "../lib/player-profile";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerName } from "./PlayerName";
import { Modal } from "./Modal";
import { SwipeToDelete } from "./SwipeToDelete";
import "./player-directory.css";

type Action = {
  player: SavedPlayer;
  revision: number;
  type: "archive" | "restore" | "delete";
};
type Undo = { player: SavedPlayer; revision: number; archived: boolean };

export function PlayerDirectory({
  shared,
  busy,
  canEdit,
  onEdit,
  onAccess,
  onOperation,
  onRetry,
}: {
  shared: SharedState;
  busy: boolean;
  canEdit: (id: string) => boolean;
  onEdit: (player: SavedPlayer) => void;
  onAccess?: (playerId?: string) => void;
  onOperation?: (operation: SharedOperation) => Promise<unknown>;
  onRetry: () => Promise<void>;
}) {
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Action | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const lock = useRef(false);
  const admin = shared.member.role === "superadmin";
  const manageAccess = admin || hasPermission(shared.member, "inviteMembers");
  const archivedCount = shared.players.filter(
    (p) => shared.playerAccess[p.id]?.archived,
  ).length;
  const viewingArchive = admin && archived;
  const shown = shared.players.filter(
    (p) =>
      !!shared.playerAccess[p.id]?.archived === viewingArchive &&
      `${p.name} ${p.nickname ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const undoAccess = undo && shared.playerAccess[undo.player.id];
  const canUndo =
    undo &&
    undoAccess?.revision === undo.revision &&
    !!undoAccess.archived !== undo.archived;

  async function run(action: Action) {
    if (lock.current || busy || !admin || !onOperation) return;
    lock.current = true;
    setWorking(true);
    setError(null);
    setNotice(null);
    setUndo(null);
    try {
      await onOperation(
        action.type === "delete"
          ? {
              type: "delete-player",
              id: action.player.id,
              expectedRevision: action.revision,
            }
          : {
              type: "archive-player",
              id: action.player.id,
              expectedRevision: action.revision,
              archived: action.type === "archive",
            },
      );
      const name = playerDisplayName(action.player);
      setNotice(
        action.type === "delete"
          ? `${name}’s unused profile was permanently deleted.`
          : action.type === "archive"
            ? `${name} archived. Past results and sign-in access are unchanged.`
            : `${name} restored to active players.`,
      );
      if (action.type !== "delete")
        setUndo({
          player: action.player,
          revision: action.revision + 1,
          archived: action.type !== "archive",
        });
      setDeleting(null);
      setOpenRow(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The change could not be confirmed. Check the saved action before trying again.",
      );
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }
  async function retry() {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setError(null);
    try {
      await onRetry();
      setNotice("Saved action checked. The player list is up to date.");
      setDeleting(null);
      setOpenRow(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The saved action could not be checked. Retry when connected.",
      );
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }
  function choose(player: SavedPlayer, type: Action["type"]) {
    const access = shared.playerAccess[player.id];
    if (!access || busy || working) return;
    const action = { player, type, revision: access.revision };
    if (type === "delete") {
      setConfirmation("");
      setError(null);
      setDeleting(action);
    } else void run(action);
  }
  const retryButton = (
    <button
      className="button light"
      disabled={working}
      onClick={() => void retry()}
    >
      {busy ? "Retry saved action" : "Refresh players"}
    </button>
  );
  return (
    <section className="player-directory" aria-label="Player management">
      <div className="player-directory-toolbar">
        <div
          className="player-directory-tabs"
          role="group"
          aria-label="Player list"
        >
          <button
            className="button light"
            aria-pressed={!viewingArchive}
            onClick={() => {
              setArchived(false);
              setOpenRow(null);
            }}
          >
            Active players ({shared.players.length - archivedCount})
          </button>
          {admin && (
            <button
              className="button light"
              aria-pressed={viewingArchive}
              onClick={() => {
                setArchived(true);
                setOpenRow(null);
              }}
            >
              Archived players ({archivedCount})
            </button>
          )}
        </div>
        {manageAccess && onAccess && (
          <button
            className="button secondary"
            disabled={busy || working}
            onClick={() => onAccess()}
          >
            Invitations & access
          </button>
        )}
      </div>
      <label className="field">
        Find a player
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpenRow(null);
          }}
          placeholder="Name or nickname"
        />
      </label>
      {viewingArchive ? (
        <p className="muted">
          Archived players remain in past results and keep their sign-in access.
          Restore them to select them for new games. Only unused profiles
          without account or invitation links can be permanently deleted.
        </p>
      ) : (
        admin && (
          <p className="muted player-directory-swipe-hint">
            Swipe left on a player to reveal Archive, or use their Actions
            button.
          </p>
        )
      )}
      {notice && (
        <div className="player-directory-notice">
          <p role="status">{notice}</p>
          {canUndo && (
            <button
              className="button light"
              disabled={busy || working}
              onClick={() =>
                void run({
                  player: undo.player,
                  revision: undo.revision,
                  type: undo.archived ? "archive" : "restore",
                })
              }
            >
              Undo
            </button>
          )}
        </div>
      )}
      {error && !deleting && (
        <div className="error-banner">
          <p role="alert">{error}</p>
          {retryButton}
        </div>
      )}
      {!shown.length && (
        <p>
          {query
            ? "No players match your search."
            : viewingArchive
              ? "No archived players."
              : "No active players. Add someone above or restore an archived player."}
        </p>
      )}
      <div className="players-list">
        {shown.map((player) => {
          const access = shared.playerAccess[player.id];
          const member = shared.members.find((m) => m.playerId === player.id);
          const invite = shared.invitations.find(
            (i) => i.active && i.playerId === player.id,
          );
          const status = member
            ? member.active
              ? "Can sign in"
              : "Sign-in suspended"
            : access?.userId
              ? "Linked account"
              : invite
                ? "Invited"
                : "No sign-in account";
          return (
            <PlayerRow
              key={player.id}
              player={player}
              admin={admin}
              archived={viewingArchive}
              disabled={busy || working || !onOperation}
              open={openRow === player.id}
              onOpen={(open) => setOpenRow(open ? player.id : null)}
              onArchive={() => choose(player, "archive")}
            >
              <div className="player-directory-person">
                <h3>
                  <PlayerName player={player} profile={player} />
                </h3>
                <p>
                  {status}
                  {member?.role === "superadmin" ? " · Superadmin" : ""}
                </p>
                {player.bio && <p>{player.bio}</p>}
                <div className="player-directory-actions">
                  <button
                    className="text-button"
                    disabled={busy || working || !canEdit(player.id)}
                    onClick={() => onEdit(player)}
                  >
                    Edit profile
                  </button>
                  {manageAccess && onAccess && (
                    <button
                      className="text-button"
                      disabled={busy || working}
                      onClick={() => onAccess(player.id)}
                    >
                      {access?.userId
                        ? "Sign-in & permissions"
                        : invite
                          ? "Manage invitation"
                          : "Invite to sign in"}
                    </button>
                  )}
                  {admin && viewingArchive && (
                    <button
                      className="text-button"
                      disabled={busy || working || !onOperation}
                      onClick={() => choose(player, "restore")}
                    >
                      Restore player
                    </button>
                  )}
                </div>
                {admin && viewingArchive && openRow === player.id && (
                  <div
                    className="player-directory-menu"
                    role="group"
                    aria-label={`Actions for ${playerDisplayName(player)}`}
                  >
                    {!viewingArchive ? (
                      <button
                        className="button light"
                        disabled={busy || working || !onOperation}
                        onClick={() => choose(player, "archive")}
                      >
                        Archive player
                      </button>
                    ) : (
                      <button
                        className="button light danger"
                        disabled={
                          busy ||
                          working ||
                          !onOperation ||
                          access?.deletionBlock !== null
                        }
                        onClick={() => choose(player, "delete")}
                      >
                        Permanently delete…
                      </button>
                    )}
                  </div>
                )}
                {admin && viewingArchive && (
                  <p className="muted">
                    {access?.deletionBlock ??
                      (access?.deletionBlock === null
                        ? "Permanent deletion is available from Actions."
                        : "Refresh Players to check whether this profile can be deleted.")}
                  </p>
                )}
              </div>
            </PlayerRow>
          );
        })}
      </div>
      {deleting && (
        <Modal
          title="Permanently delete player?"
          onClose={() => {
            if (!working) {
              setDeleting(null);
              setError(null);
            }
          }}
        >
          <p>
            <strong>{playerDisplayName(deleting.player)}</strong>
          </p>
          <p>
            Delete this unused archived profile, including its photo and bio.
            This cannot be undone. Saved games, account or invitation links, and
            Gym history block deletion. Administrative audit records are
            retained.
          </p>
          <label className="field">
            Type the player’s name to confirm
            <input
              value={confirmation}
              placeholder={playerDisplayName(deleting.player)}
              disabled={working}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          {error && (
            <p role="alert" className="error-banner">
              {error}
            </p>
          )}
          <div className="button-row">
            <button
              className="button light"
              disabled={working}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={
                busy ||
                working ||
                confirmation !== playerDisplayName(deleting.player)
              }
              onClick={() => void run(deleting)}
            >
              {working ? "Saving…" : "Permanently delete player"}
            </button>
            {error && retryButton}
          </div>
        </Modal>
      )}
    </section>
  );
}

function PlayerRow({
  player,
  admin,
  archived,
  disabled,
  open,
  onOpen,
  onArchive,
  children,
}: {
  player: SavedPlayer;
  admin: boolean;
  archived: boolean;
  disabled: boolean;
  open: boolean;
  onOpen: (open: boolean) => void;
  onArchive: () => void;
  children: ReactNode;
}) {
  const content = (
    <div className="player-directory-row-content">
      <span className="avatar">
        <PlayerAvatar name={player.name} photoDataUrl={player.photoDataUrl} />
      </span>
      {children}
      {admin && archived && (
        <button
          className="icon-button player-directory-more"
          aria-label={`Actions for ${playerDisplayName(player)}`}
          aria-expanded={open}
          disabled={disabled}
          onClick={() => onOpen(!open)}
        >
          •••
        </button>
      )}
    </div>
  );
  return (
    <article
      className="player-directory-row"
      aria-label={playerDisplayName(player)}
    >
      {admin && !archived ? (
        <SwipeToDelete
          action="archive"
          actionLabel="Archive player"
          toggleLabel={`Actions for ${playerDisplayName(player)}`}
          disabled={disabled}
          onDelete={onArchive}
        >
          {content}
        </SwipeToDelete>
      ) : (
        content
      )}
    </article>
  );
}
