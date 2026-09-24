"use client";
import { useRouter, usePathname } from "next/navigation";
import { PlayerOnboarding } from "./PlayerOnboarding";
import { FamilyHub } from "./FamilyHub";
import { hasPermission } from "../lib/member-permissions";
import { MemberPermissions } from "./MemberPermissions";
import { DeletePracticeGame } from "./DeletePracticeGame";
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

export function FamilyApp({
  hubEnabled = false,
  gymEnabled = false,
}: {
  hubEnabled?: boolean;
  gymEnabled?: boolean;
}) {
  const path = usePathname();
  // The rollout flag changes the landing page. Direct routes retain access to
  // saved history; the repository flag separately gates every Crokinole write.
  const showHub = hubEnabled || path !== "/family";
  return (
    <FamilyAccess>
      {(user) => (
        <FamilyWorkspace
          key={user.id}
          user={user}
          hubEnabled={showHub}
          gymEnabled={gymEnabled}
        />
      )}
    </FamilyAccess>
  );
}
function FamilyWorkspace({
  user,
  hubEnabled,
  gymEnabled,
}: {
  user: FamilyUser;
  hubEnabled: boolean;
  gymEnabled: boolean;
}) {
  const router = useRouter();
  const [store] = useState(() => createSharedStore(user.id));
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const joinId = useRef<string | null>(null);
  const hubSignOutGuard = useRef<(() => Promise<void>) | null>(null);
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
      if (
        document.visibilityState !== "visible" ||
        current.pending ||
        current.unresolved ||
        refreshing
      )
        return;
      refreshing = true;
      void store.refresh!()
        .then(() => setRefreshError(null))
        .catch((e) => {
          setRefreshError(
            e instanceof Error ? e.message : "Shared view could not refresh.",
          );
        })
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
      const message =
        e instanceof Error ? e.message : "This action could not complete.";
      setError(store.getSnapshot().error === message ? null : message);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  const signOut = () =>
    act(async () => {
      await hubSignOutGuard.current?.();
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
  if (state.shared?.member.profileSetupPending)
    return (
      <PlayerOnboarding
        store={store}
        onSignOut={() => void signOut()}
        onComplete={() => router.replace("/family")}
      />
    );
  const renderScorer = (
    view: "Home" | "Play" | "History" | "Players" | "Records" = "Home",
    newGame = false,
  ) => (
    <ScorerApp
      key={`${view}-${newGame}`}
      initialView={view}
      initialNewGame={newGame}
      onHome={hubEnabled ? () => router.push("/family") : undefined}
      onNavigate={hubEnabled ? (path) => router.push(path) : undefined}
      store={store}
      liveContext={{
        userId: user.id,
        generation:
          state.shared!.gameAccess[state.data.activeGameId ?? ""]?.generation ??
          1,
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
            {(state.shared!.member.role === "superadmin" ||
              hasPermission(state.shared!.member, "inviteMembers")) && (
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
        state.shared!.gameAccess[state.data.activeGameId]?.mode !==
          "practice" &&
        hasPermission(state.shared!.member, "shareGames") &&
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
      renderGameItem={(game, content) => (
        <DeletePracticeGame
          game={game}
          store={store}
          disabled={!!state.pending || !!state.unresolved}
        >
          {content}
        </DeletePracticeGame>
      )}
      renderGameStatus={(game) => (
        <GameStatus key={game.id} game={game} store={store} working={working} />
      )}
    />
  );
  return (
    <>
      {(error || refreshError) && (
        <p className="error-banner" role="alert">
          {error ?? refreshError}
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
      {hubEnabled ? (
        <FamilyHub
          gymEnabled={gymEnabled}
          signOutGuardRef={hubSignOutGuard}
          sharedStore={store}
          shared={state.shared!}
          userId={user.id}
          renderScrabble={renderScorer}
          onAdmin={() => setAdmin(true)}
          onSignOut={signOut}
        />
      ) : (
        renderScorer()
      )}

      {admin &&
        (state.shared!.member.role === "superadmin" ||
          hasPermission(state.shared!.member, "inviteMembers")) && (
          <FamilyAdmin
            key={state.shared!.member.role}
            store={store}
            onClose={() => setAdmin(false)}
          />
        )}
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
    hasPermission(state.member, "takeOverScoring") &&
    hasPermission(state.member, "scoreGames");
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
            ? hasPermission(state.member, "scoreGames")
              ? "You are the scorer. Sign in with this account on any device to continue."
              : "Viewing only. Scoring is turned off for your account. Your unfinished entry is saved on this device."
            : "Viewing only. Another member is the designated scorer."}
        </p>
      )}
      {access.mode === "practice" && (
        <p className="muted">
          Private test · visible only to superadmins. It never counts toward
          records.
        </p>
      )}
      <GameConcerns game={game} store={store} />
      {transfer}
      <DeletePracticeGame
        game={game}
        store={store}
        disabled={
          working ||
          !!store.getSnapshot().pending ||
          !!store.getSnapshot().unresolved
        }
      />
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
  const [invitePlayerId, setInvitePlayerId] = useState("");
  const [working, setWorking] = useState(false);
  const ref = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<FamilyMember | null>(null);
  const [removingInvite, setRemovingInvite] = useState<string | null>(null);
  const run = async (operation?: SharedOperation) => {
    if (ref.current) return;
    ref.current = true;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      if (operation) await store.administer(operation);
      else {
        await store.retry!();
        await store.refresh!();
      }
      setNotice(
        "Family access updated. The original change remains in the audit history.",
      );
      if (operation?.type === "invite-member") {
        setEmail("");
        setInvitePlayerId("");
      }
      setEditing(null);
      setRemovingInvite(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The access change failed.");
    } finally {
      ref.current = false;
      setWorking(false);
    }
  };
  return (
    <Modal
      title={
        editing
          ? "Member permissions"
          : removingInvite
            ? "Remove this invitation?"
            : "Amberly access"
      }
      className={editing ? "member-permissions-dialog" : ""}
      onClose={() => {
        if (!working) onClose();
      }}
      wide
    >
      {state.unresolved && (
        <p role="status">
          A saved change needs confirmation.{" "}
          <button
            className="button light"
            disabled={working}
            onClick={() => void run()}
          >
            Retry saved change
          </button>
        </p>
      )}
      {(editing || removingInvite) && error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {removingInvite ? (
        <div className="access-removal-confirm">
          <p>
            <strong>{removingInvite}</strong> will no longer be able to join
            using this invitation.
          </p>
          <p>
            You can invite them again later. Existing games and player records
            stay unchanged.
          </p>
          <div className="dialog-actions">
            <button
              className="button light"
              disabled={working}
              onClick={() => setRemovingInvite(null)}
            >
              {state.unresolved ? "Close for now" : "Keep invitation"}
            </button>
            <button
              className="button danger-outline"
              disabled={
                working ||
                !!state.pending ||
                !!state.unresolved ||
                !state.shared!.invitations.some(
                  (i) => i.email === removingInvite && i.active,
                )
              }
              onClick={() =>
                void run({ type: "revoke-invitation", email: removingInvite })
              }
            >
              {working ? "Removing…" : "Remove invitation"}
            </button>
          </div>
        </div>
      ) : editing ? (
        <MemberPermissions
          key={editing.userId}
          member={editing}
          players={state.data.players}
          working={working || !!state.pending || !!state.unresolved}
          stale={
            state.shared!.members.find((m) => m.userId === editing.userId)
              ?.revision !== editing.revision
          }
          onSave={run}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <p>
            Add an email before that person joins. Share the app address with
            them yourself; adding access here does not send an email.
          </p>
          <form
            className="family-invite"
            onSubmit={(e) => {
              e.preventDefault();
              void run({
                type: "invite-member",
                email: email.trim(),
                ...(state.shared!.member.role === "superadmin"
                  ? { playerId: invitePlayerId || null }
                  : {}),
              });
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
            {state.shared!.member.role === "superadmin" && (
              <label className="field">
                Player profile for this invitation
                <select
                  value={invitePlayerId}
                  disabled={working}
                  onChange={(e) => setInvitePlayerId(e.target.value)}
                >
                  <option value="">Create their profile when they join</option>
                  {state.data.players
                    .filter(
                      (p) =>
                        !state.shared!.playerAccess[p.id]?.userId &&
                        !state.shared!.invitations.some(
                          (i) =>
                            i.active &&
                            i.playerId === p.id &&
                            i.email !== email.trim().toLowerCase(),
                        ),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nickname ? `${p.nickname} (${p.name})` : p.name}
                      </option>
                    ))}
                </select>
                <small>
                  Choose their existing player to keep all game history
                  together. They can confirm their name, nickname and photo when
                  they join.
                </small>
              </label>
            )}
            <button
              className="button primary"
              disabled={working || !!state.pending || !!state.unresolved}
            >
              Allow this person to join
            </button>
          </form>
          {error && (
            <p role="alert" className="error-banner">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {state.shared!.member.role === "superadmin" && (
            <ul className="family-members">
              {state.shared!.members.map((member) => (
                <li key={member.userId}>
                  <div>
                    <strong>{member.email}</strong>
                    <span>
                      {member.playerId
                        ? `Player: ${state.data.players.find((p) => p.id === member.playerId)?.name ?? member.playerId}`
                        : "No linked player — choose one in Permissions"}
                      {member.profileSetupPending
                        ? " · Profile setup pending"
                        : ""}
                    </span>
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
                    Permissions
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state
            .shared!.invitations.filter((i) => i.active)
            .map((invite) => (
              <div className="family-invitation" key={invite.email}>
                <span>
                  {invite.email} · Invitation available
                  <br />
                  {invite.playerId
                    ? `Player: ${state.data.players.find((p) => p.id === invite.playerId)?.name ?? invite.playerId}`
                    : "Creates a player profile when they join"}
                </span>
                <button
                  className="text-button"
                  disabled={working}
                  onClick={() => setRemovingInvite(invite.email)}
                >
                  Remove invitation…
                </button>
              </div>
            ))}

          <p className="muted">
            New invitations receive standard member permissions. Once they join,
            a superadmin can customize their switches. Only superadmins can
            change access levels or create, view and delete practice games. The
            last active superadmin cannot be removed.
          </p>
        </>
      )}
    </Modal>
  );
}
