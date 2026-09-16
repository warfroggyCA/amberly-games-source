"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FamilyAccess, type FamilyUser } from "./FamilyAccess";
import { FamilyWelcome } from "./FamilyWelcome";
import { ScorerApp } from "./ScorerApp";
import { Modal } from "./Modal";
import { GameWatchLink } from "./GameWatchLink";
import { GameConcerns } from "./GameConcerns";
import {
  createSharedStore,
  familyRequest,
  type SharedScorerStore,
} from "../lib/shared-store";
import type { FamilyMember, SharedOperation } from "../lib/shared-contract";
import type { GameState } from "../domain/game";
import "./family-shared.css";

export function FamilyApp() {
  return (
    <FamilyAccess>
      {(user) => <FamilyWorkspace key={user.id} user={user} />}
    </FamilyAccess>
  );
}
function FamilyWorkspace({ user }: { user: FamilyUser }) {
  const [store] = useState(() => createSharedStore(user.id));
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const joinId = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    void store.load().catch(() => {});
  }, [store]);
  // Strict Mode immediately remounts effects; a real unmount also retires the
  // writer so navigation does not leave a hidden owner or listeners behind.
  useEffect(() => {
    mounted.current = true;
    const close = () => store.close();
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) location.reload();
    };
    window.addEventListener("pagehide", close);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pagehide", close);
      window.removeEventListener("pageshow", restore);
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) store.close();
      });
    };
  }, [store]);
  useEffect(() => {
    if (state.status !== "ready") return;
    let refreshing = false;
    const refresh = () => {
      const current = store.getSnapshot();
      const active = current.data.activeGameId;
      const activeGame = current.data.games.find((game) => game.id === active);
      if (
        document.visibilityState !== "visible" ||
        current.pending ||
        current.unresolved ||
        refreshing ||
        (active &&
          store.canScore?.(active) &&
          activeGame?.status !== "finalized")
      )
        return;
      refreshing = true;
      void store.refresh!()
        .catch((e) =>
          setError(
            e instanceof Error ? e.message : "Shared view could not refresh.",
          ),
        )
        .finally(() => {
          refreshing = false;
        });
    };
    const timer = setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [state.status, store]);
  async function act(operation: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      await operation();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This action could not complete.",
      );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  const signOut = () =>
    act(async () => {
      if (state.pending || state.unresolved)
        throw new Error(
          "Confirm the saved action before signing out. Your entry is still retained on this device.",
        );
      await familyRequest("/api/auth/signout", {});
      store.close();
      location.reload();
    });
  if (state.scoringElsewhere)
    return (
      <FamilyWelcome title="Scoring moved to another tab">
        <p>
          Your saved letters and any unfinished save are available in the newer
          tab. You’re still signed in.
        </p>
        <button className="btn primary" onClick={() => location.reload()}>
          Use this tab
        </button>
      </FamilyWelcome>
    );

  if (state.status !== "ready")
    return (
      <FamilyWelcome
        title={state.status === "loading" ? "Welcome back." : "Amberly access"}
        loading={state.status === "loading"}
      >
        <div className="family-connection">
          {state.status === "loading" && (
            <p className="family-access-status" role="status">
              Opening shared history…
            </p>
          )}
          <p className="family-access-email">{user.email}</p>
          {state.error && (
            <p className="family-access-error" role="alert">
              {state.error}
            </p>
          )}
          {error && (
            <p className="family-access-error" role="alert">
              {error}
            </p>
          )}
          {state.status === "error" && (
            <>
              <p>
                If a superadmin has added your email, accept your invitation to
                join the family.
              </p>
              <button
                className="btn primary"
                disabled={working}
                onClick={() =>
                  void act(async () => {
                    joinId.current ??= crypto.randomUUID();
                    await familyRequest("/api/family/join", {
                      requestId: joinId.current,
                    });
                    location.reload();
                  })
                }
              >
                Accept family invitation
              </button>
              <button
                className="btn"
                disabled={working}
                onClick={() => location.reload()}
              >
                Retry connection
              </button>
              <button
                className="btn quiet"
                onClick={() => store.exportWorkspace()}
              >
                Export retained entry
              </button>
            </>
          )}
          <button
            className="btn quiet"
            disabled={working}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </FamilyWelcome>
    );
  return (
    <>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {state.unresolved && (
        <div className="family-pending" role="alert">
          <span>
            An interrupted save is awaiting confirmation. Retrying checks the
            same action; it won’t duplicate a score.
          </span>
          <button
            className="button primary"
            disabled={working || !!state.pending}
            onClick={() => void act(() => store.retry!())}
          >
            Retry saved action
          </button>
          <button
            className="text-button"
            onClick={() => store.exportWorkspace()}
          >
            Export retained entry
          </button>
        </div>
      )}
      <ScorerApp
        store={store}
        liveContext={{
          userId: user.id,
          generation:
            state.shared!.gameAccess[state.data.activeGameId ?? ""]
              ?.generation ?? 1,
        }}
        accountControls={
          <div className="family-menu-account">
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <span>
              <strong>{state.shared!.family.name}</strong> · {user.email}
            </span>
            <div>
              {state.data.activeGameId &&
                store.canScore?.(state.data.activeGameId) && (
                  <button
                    className="text-button"
                    disabled={working || !!state.pending}
                    onClick={() => void act(() => store.refresh!())}
                  >
                    Refresh shared history
                  </button>
                )}
              {state.shared!.member.role === "superadmin" && (
                <button className="text-button" onClick={() => setAdmin(true)}>
                  Family access
                </button>
              )}

              <button
                className="text-button"
                disabled={working || !!state.pending || state.unresolved}
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          </div>
        }
        shareControl={
          state.data.activeGameId &&
          (state.shared!.gameAccess[state.data.activeGameId]?.scorerUserId ===
            user.id ||
            state.shared!.member.role === "superadmin") && (
            <GameWatchLink
              key={state.data.activeGameId}
              gameId={state.data.activeGameId}
              store={store}
              disabled={!!state.pending || !!state.unresolved}
            />
          )
        }
        renderGameStatus={(game) => (
          <GameStatus
            key={game.id}
            game={game}
            store={store}
            working={working}
          />
        )}
      />
      {admin && <FamilyAdmin store={store} onClose={() => setAdmin(false)} />}
    </>
  );
}
function GameStatus({
  game,
  store,
  working,
}: {
  game: GameState;
  store: SharedScorerStore;
  working: boolean;
}) {
  const state = store.getSnapshot().shared!;
  const [moving, setMoving] = useState(false);
  const [reason, setReason] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const transferRef = useRef(false);
  const access = state.gameAccess[game.id];
  if (!access) return null;

  const canMove =
    game.status !== "finalized" &&
    access.scorerUserId !== state.member.userId &&
    state.member.role === "superadmin";
  const transfer = canMove && (
    <details className="family-transfer">
      <summary>Scoring ownership</summary>
      <div>
        {!moving ? (
          <button className="button light" onClick={() => setMoving(true)}>
            Become the scorer…
          </button>
        ) : (
          <>
            <p>
              Your account will become this game’s designated scorer on any
              device. The previous scorer will become a viewer. Their unfinished
              entry stays on their device and is not submitted automatically.
            </p>
            <label className="field">
              Reason for changing scorer
              <input
                value={reason}
                maxLength={240}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button className="button light" onClick={() => setMoving(false)}>
                Cancel
              </button>
              <button
                className="button primary"
                disabled={working || transferBusy || !reason.trim()}
                onClick={async () => {
                  if (transferRef.current) return;
                  transferRef.current = true;
                  setTransferBusy(true);
                  setTransferError(null);
                  try {
                    await store.takeOver(game.id, reason.trim());
                    setMoving(false);
                  } catch (error) {
                    setTransferError(
                      error instanceof Error
                        ? error.message
                        : "Scoring could not be transferred.",
                    );
                  } finally {
                    transferRef.current = false;
                    setTransferBusy(false);
                  }
                }}
              >
                Confirm — become scorer
              </button>
            </div>
          </>
        )}
        {transferError && <p role="alert">{transferError}</p>}
      </div>
    </details>
  );
  return (
    <section className="family-game-status" aria-label="Game review status">
      {game.status !== "finalized" && (
        <p className="muted">
          {access.scorerUserId === state.member.userId
            ? "You are the scorer. Sign in with this account on any device to continue."
            : "Viewing only. Another member is the designated scorer."}
        </p>
      )}
      {access.mode === "practice" && (
        <p className="muted">
          Practice game · retained in history, excluded from family records.
        </p>
      )}
      <GameConcerns game={game} store={store} />
      {transfer}
    </section>
  );
}

function FamilyAdmin({
  store,
  onClose,
}: {
  store: SharedScorerStore;
  onClose: () => void;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);
  const ref = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<FamilyMember | null>(null);
  const run = async (operation: SharedOperation) => {
    if (ref.current) return;
    ref.current = true;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await store.administer(operation);
      setNotice(
        "Family access updated. The original change remains in the audit history.",
      );
      if (operation.type === "invite-member") setEmail("");
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The access change failed.");
    } finally {
      ref.current = false;
      setWorking(false);
    }
  };
  return (
    <Modal title="Amberly access" onClose={onClose} wide>
      <p>
        Add an email before that person joins. Share the app address with them
        yourself; adding access here does not send an email.
      </p>
      <form
        className="family-invite"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ type: "invite-member", email: email.trim() });
        }}
      >
        <label className="field">
          Family member’s email
          <input
            type="email"
            autoComplete="email"
            value={email}
            required
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="button primary" disabled={working}>
          Allow this person to join
        </button>
      </form>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <ul className="family-members">
        {state.shared!.members.map((member) => (
          <li key={member.userId}>
            <div>
              <strong>{member.email}</strong>
              <span>
                {member.role === "superadmin" ? "Superadmin" : "Member"} ·{" "}
                {member.active ? "Active" : "Access revoked"}
              </span>
            </div>
            <button
              className="text-button"
              disabled={working}
              onClick={() => setEditing(member)}
            >
              Manage access
            </button>
          </li>
        ))}
      </ul>
      {state
        .shared!.invitations.filter((i) => i.active)
        .map((invite) => (
          <div className="family-invitation" key={invite.email}>
            <span>{invite.email} · Invitation available</span>
            <button
              className="text-button"
              disabled={working}
              onClick={() =>
                void run({ type: "revoke-invitation", email: invite.email })
              }
            >
              Revoke invitation
            </button>
          </div>
        ))}
      {editing && (
        <MemberEditor
          key={editing.userId}
          member={editing}
          store={store}
          working={working}
          onSave={run}
          onCancel={() => setEditing(null)}
        />
      )}
      <p className="muted">
        Superadmins manage membership and profile links. They cannot erase game
        history. They review game concerns and retain their decisions. The last
        active superadmin cannot be removed.
      </p>
    </Modal>
  );
}
function MemberEditor({
  member,
  store,
  working,
  onSave,
  onCancel,
}: {
  member: FamilyMember;
  store: SharedScorerStore;
  working: boolean;
  onSave: (op: SharedOperation) => Promise<void>;
  onCancel: () => void;
}) {
  const [role, setRole] = useState(member.role);
  const [active, setActive] = useState(member.active);
  const [playerId, setPlayerId] = useState(member.playerId ?? "");
  const [reason, setReason] = useState("");
  return (
    <form
      className="family-member-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          type: "update-member",
          userId: member.userId,
          role,
          active,
          playerId: playerId || null,
          reason: reason.trim(),
        });
      }}
    >
      <h3>{member.email}</h3>
      <label className="field">
        Role
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "member" | "superadmin")}
        >
          <option value="member">Member</option>
          <option value="superadmin">Superadmin</option>
        </select>
      </label>
      <label className="field">
        Player profile
        <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
          <option value="">No linked player</option>
          {store.getSnapshot().data.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />{" "}
        Active family access
      </label>
      <label className="field">
        Reason for change
        <input
          value={reason}
          required
          maxLength={240}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="dialog-actions">
        <button type="button" className="button light" onClick={onCancel}>
          Cancel change
        </button>
        <button className="button primary" disabled={working || !reason.trim()}>
          Save access change
        </button>
      </div>
    </form>
  );
}
