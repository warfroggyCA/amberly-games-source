"use client";
import { LeadStandings } from "./LeadStandings";
import { HistoryGameReplay } from "./HistoryGameReplay";
import { HistoryParticipants } from "./HistoryParticipants";
import { historyLabel } from "../lib/history-participants";
import { RecordsPage } from "./RecordsPage";
import { FamilyStandings } from "./FamilyStandings";
import { GymEntryCard } from "./GymEntryCard";
import { AmberlyHeader, AmberlyNavigation } from "./AmberlyHeader";
import {
  useEffect,
  useCallback,
  type RefObject,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createCrokinoleStore } from "../lib/crokinole-store";
import {
  familyRequest,
  FamilyRequestError,
  type SharedScorerStore,
} from "../lib/shared-store";
import type { SharedState } from "../lib/shared-contract";
import {
  isGameSummaryPage,
  type GameSummary,
  type GameSummaryPage,
} from "../lib/game-summary";
import type { CrokinoleOperation } from "../lib/crokinole-contract";
import { hasPermission } from "../lib/member-permissions";
import { CrokinoleApp } from "./crokinole/CrokinoleApp";
import { CrokinoleDefaultsSettings } from "./crokinole/CrokinoleDefaultsSettings";
import { ColourSettings } from "./crokinole/ColourSettings";
import { TileSetSettings } from "./TileSetSettings";
import { playerDisplayName } from "../lib/player-profile";
import { Modal } from "./Modal";
import { PlayTiles } from "./PlayTiles";
import { SwipeToDelete } from "./SwipeToDelete";
import "./family-hub.css";

export function FamilyHub({
  gymEnabled = false,
  sharedStore,
  shared,
  userId,
  renderScrabble,
  onAdmin,
  onUsage,
  onSignOut,
  signOutGuardRef,
}: {
  gymEnabled?: boolean;
  sharedStore: SharedScorerStore;
  shared: SharedState;
  userId: string;
  renderScrabble: (
    view?: "Home" | "Play" | "History" | "Players" | "Records",
    newGame?: boolean,
  ) => ReactNode;
  onAdmin: () => void;
  onUsage: () => void;
  onSignOut: () => Promise<void>;
  signOutGuardRef: RefObject<(() => Promise<void>) | null>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const initialLeadLoadClaimed = useRef(false);
  const claimInitialLeadLoad = useCallback(() => {
    if (initialLeadLoadClaimed.current) return false;
    initialLeadLoadClaimed.current = true;
    return true;
  }, []);
  const standingsDestination = search.get("standings");
  useEffect(() => {
    if (pathname !== "/family/history" || standingsDestination !== "scrabble")
      initialLeadLoadClaimed.current = false;
  }, [pathname, standingsDestination]);
  const [store] = useState(() =>
    createCrokinoleStore(shared.family.id, userId),
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const mounted = useRef(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [newGameConfirm, setNewGameConfirm] = useState(false);
  const [recoverConfirm, setRecoverConfirm] = useState(false);
  const [showDefaults, setShowDefaults] = useState(false);
  const [equipment, setEquipment] = useState<"tiles" | "colours" | null>(null);
  const [action, setAction] = useState<{
    title: string;
    message: string;
    operation: (reason: string) => CrokinoleOperation;
    after?: () => void;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const actionLock = useRef(false);
  const gameId =
    pathname.startsWith("/family/crokinole/") && !pathname.endsWith("/new")
      ? safeGameId(pathname.split("/").at(-1)!)
      : undefined;
  const isCrokinole = pathname.startsWith("/family/crokinole");
  const visibleGames = state.games.filter(
    (g) =>
      g.definition.mode !== "practice" || shared.member.role === "superadmin",
  );
  const game = visibleGames.find((g) => g.definition.id === gameId) ?? null;
  const crokinoleOpened = useRef(false);
  const access = gameId ? state.access[gameId] : undefined;
  const draft = gameId ? state.drafts[gameId] : undefined;
  const locked = state.busy || state.pending || state.displaced || working;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) store.close();
      });
    };
  }, [store]); // store lifetime spans game routes
  useEffect(() => {
    if (pathname === "/family/scrabble" || pathname === "/family/players")
      return;
    crokinoleOpened.current = true;
    void store.load(gameId);
  }, [store, gameId, pathname]);
  useEffect(() => {
    const refresh = () => {
      if (crokinoleOpened.current && document.visibilityState === "visible")
        void store.refresh(gameId, undefined, pathname === "/family/records");
    };
    const timer = setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [store, gameId, pathname]);
  useEffect(() => {
    const guard = async () => {
      await store.flush();
      if (store.getSnapshot().pending && !store.getSnapshot().accessLost)
        throw new Error(
          "Confirm the Crokinole saved action before signing out.",
        );
    };
    signOutGuardRef.current = guard;
    return () => {
      if (signOutGuardRef.current === guard) signOutGuardRef.current = null;
    };
  }, [store, signOutGuardRef]);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (store.getSnapshot().storageError) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [store]);
  async function navigate(path: string) {
    try {
      await store.flush();
      setMenu(false);
      router.push(path);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Save your entry before leaving.",
      );
    }
  }
  async function doAction() {
    if (!action || actionLock.current) return;
    actionLock.current = true;
    setWorking(true);
    setError("");
    try {
      await store.mutate(action.operation(reason.trim()));
      action.after?.();
      setAction(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The change could not be confirmed.",
      );
    } finally {
      actionLock.current = false;
      setWorking(false);
    }
  }
  function prompt(value: NonNullable<typeof action>) {
    setReason("");
    setAction(value);
  }
  async function openSummary(summary: GameSummary) {
    if (summary.gameType === "crokinole")
      return navigate(`/family/crokinole/${summary.id}`);
    try {
      await store.flush();
      await sharedStore.openGame(summary.id);
      router.push("/family/scrabble?view=play");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open this game.");
    }
  }
  async function download() {
    try {
      await store.flush();
      const data = await familyRequest<unknown>(
        "/api/family/games?export=1",
        undefined,
        { expectedUserId: userId },
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "amberly-games-history.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export history.");
    }
  }
  async function recoverDevice() {
    if (actionLock.current) return;
    actionLock.current = true;
    setWorking(true);
    setError("");
    try {
      await store.recoverLocalWorkspace(true);
      setRecoverConfirm(false);
      if (gameId) await store.refresh(gameId);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The original saved copy is still protected.",
      );
    } finally {
      actionLock.current = false;
      setWorking(false);
    }
  }
  const commonRecovery = (
    <>
      {(error || state.error) && (
        <p className="crokinole-error" role="alert">
          {error || state.error}
        </p>
      )}
      {state.recoveryNeeded && (
        <div className="crokinole-notice">
          This device’s Crokinole workspace cannot be read. Your shared games
          are still retained.
          <button
            className="button light"
            onClick={() => setRecoverConfirm(true)}
          >
            Recover this device’s workspace
          </button>
        </div>
      )}
      {recoverConfirm && (
        <Modal
          title="Recover this device’s workspace?"
          onClose={() => {
            if (!working) setRecoverConfirm(false);
          }}
        >
          <p>
            The unreadable local copy will be preserved for recovery. A fresh
            workspace will load your saved shared games.
          </p>
          <p>
            Unsent entries in the old copy will not be restored automatically.
            No shared games or scores will be deleted.
          </p>
          {error && (
            <p role="alert" className="crokinole-error">
              {error}
            </p>
          )}
          <div className="crokinole-actions">
            <button
              className="button light"
              disabled={working}
              onClick={() => setRecoverConfirm(false)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={working}
              onClick={() => void recoverDevice()}
            >
              Preserve copy and recover
            </button>
          </div>
        </Modal>
      )}
      {state.pending && (
        <div className="crokinole-notice" role="status">
          A saved action is waiting for confirmation. Retrying cannot duplicate
          its score.{" "}
          <button
            className="button light"
            disabled={state.busy}
            onClick={() => void store.retry().catch((e) => setError(e.message))}
          >
            Retry saved action
          </button>
        </div>
      )}
      {state.storageError && (
        <div className="crokinole-notice">
          Your latest entry has not been saved on this device. Keep this page
          open.{" "}
          <button
            className="button light"
            onClick={() => {
              try {
                store.exportWorkspace();
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not export this entry.",
                );
              }
            }}
          >
            Export retained entry
          </button>
          <button
            className="button light"
            onClick={() => void store.retry().catch((e) => setError(e.message))}
          >
            Retry storage
          </button>
        </div>
      )}
      {state.displaced &&
        pathname !== "/family/scrabble" &&
        pathname !== "/family/players" && (
          <div className="crokinole-notice">
            Scoring moved to another tab.{" "}
            <button className="button light" onClick={() => location.reload()}>
              Use this tab
            </button>
          </div>
        )}
    </>
  );
  if (pathname === "/family/scrabble")
    return (
      <>
        {commonRecovery}
        {renderScrabble(
          search.get("view") === "play"
            ? "Play"
            : search.get("view") === "records"
              ? "Records"
              : "Home",
          search.get("view") === "new",
        )}
      </>
    );
  if (pathname === "/family/players")
    return (
      <>
        {commonRecovery}
        {renderScrabble("Players")}
      </>
    );
  // Shared state is already scoped to this family. Keep every available
  // unfinished game discoverable; a paused game must not mask a newer table.
  const unfinishedScrabble = shared.games
    .filter(
      (g) =>
        g.status !== "finalized" &&
        shared.gameAccess[g.id] &&
        (shared.gameAccess[g.id].mode !== "practice" ||
          shared.member.role === "superadmin"),
    )
    .sort(
      (a, b) =>
        Number(a.status === "paused") - Number(b.status === "paused") ||
        b.definition.createdAt.localeCompare(a.definition.createdAt) ||
        b.id.localeCompare(a.id),
    );
  const resumeScrabble = unfinishedScrabble[0];
  const openScrabble = (id: string) =>
    sharedStore
      .openGame(id)
      .then(() => navigate("/family/scrabble?view=play"))
      .catch((e) => setError(e.message));
  const resumeCroke =
    visibleGames.find(
      (g) =>
        g.status === "active" &&
        state.access[g.definition.id]?.scorerUserId === userId,
    ) ?? visibleGames.find((g) => g.status === "active");
  return (
    <div className={`family-hub${gameId ? " hub-in-game" : ""}`}>
      <AmberlyHeader
        className="hub-header"
        onHome={() => void navigate("/family")}
        onMenu={() => setMenu(!menu)}
        menuOpen={menu}
      >
        {isCrokinole && (
          <span className="crokinole-save-status" role="status">
            {state.pending
              ? "Waiting to confirm save"
              : draft?.dirty
                ? "Unfinished entry"
                : "Saved"}
          </span>
        )}
      </AmberlyHeader>
      {!gameId && (
        <AmberlyNavigation
          variant="tabs"
          current={pathname}
          onNavigate={(path) => void navigate(path)}
        />
      )}
      {menu && (
        <Modal
          title="Amberly Games"
          className="tabletop-menu"
          onClose={() => setMenu(false)}
        >
          <AmberlyNavigation
            onNavigate={(path) => void navigate(path)}
            current={pathname}
          />
          <div className="hub-menu">
            {error && (
              <p role="alert" className="error-banner">
                {error}
              </p>
            )}
            <span>{shared.member.email}</span>
            {shared.member.role === "superadmin" && (
              <div>
                <strong>Administration</strong>
                <button
                  className="button light"
                  onClick={() => {
                    setMenu(false);
                    onUsage();
                  }}
                >
                  Access &amp; Usage
                </button>
              </div>
            )}
            {gameId && state.creationEnabled && (
              <button
                className="button light"
                onClick={() => {
                  setMenu(false);
                  setNewGameConfirm(true);
                }}
              >
                New Crokinole game
              </button>
            )}
            {(shared.member.role === "superadmin" ||
              hasPermission(shared.member, "inviteMembers")) && (
              <button
                className="button light"
                onClick={() => {
                  setMenu(false);
                  onAdmin();
                }}
              >
                Family access
              </button>
            )}
            <button
              className="button light"
              disabled={
                state.busy ||
                working ||
                state.displaced ||
                (state.pending && !state.accessLost)
              }
              onClick={() =>
                void store
                  .flush()
                  .then(() => {
                    if (
                      store.getSnapshot().pending &&
                      !store.getSnapshot().accessLost
                    )
                      throw new Error(
                        "Confirm the saved action before signing out.",
                      );
                    return onSignOut();
                  })
                  .catch((e) => setError(e.message))
              }
            >
              Sign out
            </button>
          </div>
        </Modal>
      )}
      <div className="hub-recovery">{commonRecovery}</div>
      {isCrokinole ? (
        state.status === "loading" ? (
          <p className="hub-content" role="status">
            Opening Crokinole…
          </p>
        ) : state.status === "error" ? (
          <div className="hub-content">
            <button
              className="button primary"
              onClick={() => void store.load(gameId)}
            >
              Retry Crokinole
            </button>
          </div>
        ) : gameId && !game ? (
          <div className="hub-content">
            <h1>Game unavailable</h1>
            <p>
              This game may have been removed or is not available to your
              account.
            </p>
          </div>
        ) : (
          <>
            {gameId && state.conflicts[gameId] && (
              <div className="hub-content crokinole-notice">
                <h2>Choose the entry to keep</h2>
                <p>
                  This device and the shared game have different unfinished
                  entries. Review both before saving.
                </p>
                <div className="hub-draft-choices">
                  {(["local", "shared"] as const).map((choice) => (
                    <div key={choice}>
                      <strong>
                        {choice === "local" ? "This device" : "Shared entry"}
                      </strong>
                      <ul>
                        {Object.entries(
                          choice === "local"
                            ? (draft?.values ?? {})
                            : state.conflicts[gameId].values,
                        ).map(([id, value]) => (
                          <li key={id}>
                            {game?.definition.participants.find(
                              (p) => p.id === id,
                            )?.name ?? id}
                            : {value || "Unset"}
                          </li>
                        ))}
                      </ul>
                      <button
                        className="button light"
                        onClick={() =>
                          void store
                            .resolveConflict(gameId, choice)
                            .catch((e) => setError(e.message))
                        }
                      >
                        Keep {choice === "local" ? "this device’s" : "shared"}{" "}
                        entry
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!state.creationEnabled && (
              <p role="status" className="crokinole-notice">
                Crokinole changes are paused. You can still view saved games and
                history.
              </p>
            )}
            {game && game.status !== "active" && (
              <nav
                className="game-return-navigation"
                aria-label="Return to game lists"
              >
                <button
                  className="button light"
                  onClick={() =>
                    void navigate("/family/history").catch((e) =>
                      setError(e.message),
                    )
                  }
                >
                  ← Back to history
                </button>
              </nav>
            )}
            <CrokinoleApp
              key={gameId ?? "new"}
              defaults={state.palette?.defaults}
              familyId={shared.family.id}
              players={
                game
                  ? shared.players
                  : shared.players.filter(
                      (p) => !shared.playerAccess[p.id]?.archived,
                    )
              }
              actorNames={Object.fromEntries(
                shared.players.flatMap((player) => {
                  const actorId = shared.playerAccess[player.id]?.userId;
                  return actorId ? [[actorId, playerDisplayName(player)]] : [];
                }),
              )}
              palette={state.palette?.colours ?? []}
              match={game}
              canScore={
                state.creationEnabled &&
                !!access?.canScore &&
                hasPermission(shared.member, "scoreGames") &&
                !state.displaced
              }
              canCreate={
                state.creationEnabled &&
                hasPermission(shared.member, "startGames") &&
                hasPermission(shared.member, "scoreGames")
              }
              canManageEquipment={
                state.creationEnabled &&
                hasPermission(shared.member, "manageEquipment")
              }
              canPractice={shared.member.role === "superadmin"}
              busy={locked}
              saveStatus={
                state.pending
                  ? "Waiting to confirm save"
                  : draft?.dirty
                    ? "Unfinished entry"
                    : "Saved"
              }
              draft={draft ?? null}
              onDraftChange={(entry) => {
                if (gameId) store.setDraft(gameId, entry);
              }}
              onCreate={async (definition) => {
                await store.mutate(
                  game && game.status !== "active"
                    ? {
                        type: "rematch",
                        gameId: game.definition.id,
                        newGameId: definition.id,
                        expectedRevision: game.revision,
                      }
                    : {
                        type: "create-game",
                        definition,
                        paletteRevision: state.palette!.revision,
                      },
                );
                router.push(`/family/crokinole/${definition.id}`);
              }}
              onCommand={(command) => store.command(gameId!, command)}
              onSavePalette={async (colours) => {
                await store.mutate({
                  type: "save-palette",
                  colours,
                  expectedRevision: state.palette!.revision,
                });
              }}
              onNewGame={() => void navigate("/family/crokinole/new")}
              onHome={() => void navigate("/family")}
              onMenu={() => setMenu(!menu)}
              onAddPlayer={
                hasPermission(shared.member, "addPlayers")
                  ? () => void navigate("/family/players")
                  : undefined
              }
            />
            {game && access && (
              <section className="hub-game-tools">
                <details>
                  <summary>Game administration</summary>
                  {state.creationEnabled &&
                    !access.canScore &&
                    hasPermission(shared.member, "takeOverScoring") &&
                    hasPermission(shared.member, "scoreGames") && (
                      <button
                        className="button light"
                        onClick={() =>
                          prompt({
                            title: "Become this game’s scorer?",
                            message:
                              "Your account can score from any device. The previous scorer becomes a viewer; their unsent entry is not submitted.",
                            operation: (reason) => ({
                              type: "take-over",
                              gameId: game.definition.id,
                              expectedRevision: game.revision,
                              generation: access.generation,
                              reason,
                            }),
                          })
                        }
                      >
                        Become scorer
                      </button>
                    )}
                  <button
                    className="text-button"
                    disabled={!state.creationEnabled}
                    onClick={() =>
                      prompt({
                        title: "Report a concern",
                        message:
                          "A family administrator can review this match. The recorded scores remain unchanged.",
                        operation: (reason) => ({
                          type: "report-concern",
                          gameId: game.definition.id,
                          expectedRevision: game.revision,
                          reason,
                        }),
                      })
                    }
                  >
                    Report a concern
                  </button>
                  {access.concerns.map((c) => (
                    <div key={c.id}>
                      <p>
                        {c.reason} ·{" "}
                        {c.resolution
                          ? c.resolution.outcome
                          : "Awaiting review"}
                      </p>
                      {state.creationEnabled &&
                        !c.resolution &&
                        hasPermission(shared.member, "resolveConcerns") &&
                        (["dismissed", "upheld"] as const).map((outcome) => (
                          <button
                            className="button light"
                            key={outcome}
                            onClick={() =>
                              prompt({
                                title: `${outcome === "upheld" ? "Uphold" : "Dismiss"} this concern?`,
                                message: c.reason,
                                operation: (reason) => ({
                                  type: "resolve-concern",
                                  gameId: game.definition.id,
                                  expectedRevision: game.revision,
                                  concernId: c.id,
                                  outcome,
                                  reason,
                                }),
                              })
                            }
                          >
                            {outcome === "upheld" ? "Uphold" : "Dismiss"}
                          </button>
                        ))}
                    </div>
                  ))}
                  {state.creationEnabled &&
                    shared.member.role === "superadmin" && (
                      <button
                        className="button danger-outline"
                        onClick={() =>
                          prompt({
                            title:
                              game.definition.mode === "practice"
                                ? "Delete this private test?"
                                : game.status === "active"
                                  ? "End and remove game?"
                                  : "Remove game?",
                            message:
                              "This stops further scoring and removes the game from Home, History and player records. Saved scores and the removal reason are retained in the internal audit archive. Unsent entries are not included.",
                            operation: (reason) => ({
                              type:
                                game.definition.mode === "practice"
                                  ? "delete-practice"
                                  : "remove-game",
                              gameId: game.definition.id,
                              expectedRevision: game.revision,
                              reason,
                            }),
                            after: () => router.push("/family"),
                          })
                        }
                      >
                        {game.definition.mode === "practice"
                          ? "Delete private test"
                          : game.status === "active"
                            ? "End and remove game"
                            : "Remove game"}
                      </button>
                    )}
                </details>
              </section>
            )}
          </>
        )
      ) : pathname === "/family/records" ? (
        <main className="hub-content">
          <RecordsPage
            games={shared.games}
            players={shared.players}
            access={shared.gameAccess}
            crokinole={state.games}
            crokinoleAccess={state.access}
            hasMore={!!shared.nextCursor || !!state.nextCursor}
            loading={state.status === "loading"}
            error={state.error}
            onLoadMore={() => {
              void Promise.all([
                shared.nextCursor
                  ? sharedStore.loadMore?.()
                  : Promise.resolve(),
                state.error
                  ? store.refresh(undefined, undefined, true)
                  : state.nextCursor
                    ? store.load(undefined, state.nextCursor)
                    : Promise.resolve(),
              ]).catch((e) =>
                setError(
                  e instanceof Error ? e.message : "Could not load records.",
                ),
              );
            }}
            onOpen={(id) => {
              void sharedStore
                .openGame(id)
                .then(() => navigate("/family/scrabble?view=play"))
                .catch((e) =>
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Could not open this game.",
                  ),
                );
            }}
            onOpenCrokinole={(id) => {
              void navigate(`/family/crokinole/${encodeURIComponent(id)}`);
            }}
            onHistory={() => {
              void navigate("/family/history");
            }}
          />
        </main>
      ) : pathname === "/family/history" ? (
        <HubHistory
          claimInitialLeadLoad={claimInitialLeadLoad}
          onBackToGames={() => void navigate("/family")}
          leadEpoch={JSON.stringify([
            userId,
            shared.family.id,
            shared.member,
            shared.removedGameIds,
            shared.games.map((g) => [g.id, g.revision]),
            shared.gameAccess,
          ])}
          key={shared.member.role}
          canPractice={shared.member.role === "superadmin"}
          userId={userId}
          familyId={shared.family.id}
          players={shared.players}
          onOpen={openSummary}
        />
      ) : pathname === "/family/settings" ? (
        <main className="hub-content">
          <h1>Settings</h1>
          <h2>Rules & defaults</h2>
          <button
            className="button light"
            disabled={!state.palette}
            onClick={() => setShowDefaults(true)}
          >
            Crokinole rules & family defaults
          </button>
          <h2>Equipment</h2>
          <p>
            Shared sets and colours for future games. Existing games keep their
            original equipment.
          </p>
          {hasPermission(shared.member, "manageEquipment") ? (
            <div className="hub-settings">
              <button
                className="button light"
                onClick={() => setEquipment("tiles")}
              >
                Scrabble tile sets
              </button>
              <button
                className="button light"
                disabled={!state.palette}
                onClick={() => setEquipment("colours")}
              >
                Crokinole piece colours
              </button>
            </div>
          ) : (
            <p>Your account cannot change shared equipment.</p>
          )}
          <h2>History</h2>
          <button
            className="button light"
            onClick={() => void navigate("/family/scrabble?view=records")}
          >
            Scrabble records
          </button>
          {hasPermission(shared.member, "exportHistory") && (
            <button className="button light" onClick={() => void download()}>
              Export shared history
            </button>
          )}
        </main>
      ) : (
        <main className="hub-content">
          <div className="hub-home-heading">
            <h1>What are we playing?</h1>
            <PlayTiles compact loading />
          </div>
          <div className="hub-games">
            <section
              className="hub-game"
              aria-labelledby="lobby-scrabble-title"
            >
              <div className="hub-board-art hub-scrabble" aria-hidden="true">
                {Array.from({ length: 49 }, (_, i) => (
                  <i
                    key={i}
                    className={
                      i % 8 === 0 ? "premium" : i % 5 === 0 ? "letter" : ""
                    }
                  />
                ))}
              </div>
              <div>
                <h2 id="lobby-scrabble-title">Scrabble</h2>
                <p>Words, rounds and family records.</p>
                <div className="hub-actions">
                  <button
                    type="button"
                    className="button light hub-standings-button"
                    aria-label="Standings for Scrabble"
                    onClickCapture={(event) => {
                      event.stopPropagation();
                      void navigate("/family/history?standings=scrabble");
                    }}
                  >
                    Standings
                  </button>
                  {resumeScrabble && (
                    <button
                      className="button primary"
                      onClick={() => void openScrabble(resumeScrabble.id)}
                    >
                      {shared.gameAccess[resumeScrabble.id]?.scorerUserId ===
                      userId
                        ? "Resume game"
                        : "View current game"}
                    </button>
                  )}
                  <button
                    className={`button ${resumeScrabble ? "light" : "primary"}`}
                    disabled={
                      !hasPermission(shared.member, "startGames") ||
                      !hasPermission(shared.member, "scoreGames")
                    }
                    onClick={() => void navigate("/family/scrabble?view=new")}
                  >
                    Start game
                  </button>
                </div>
              </div>
            </section>
            <section
              className="hub-game"
              aria-labelledby="lobby-crokinole-title"
            >
              <div className="hub-board-art hub-crokinole" aria-hidden="true">
                <i />
                <i />
                <i />
                <b />
                <span />
              </div>
              <div>
                <h2 id="lobby-crokinole-title">Crokinole</h2>
                <p>Singles, doubles and family rounds.</p>
                <div className="hub-actions">
                  <button
                    type="button"
                    className="button light hub-standings-button"
                    aria-label="Standings for Crokinole"
                    onClickCapture={(event) => {
                      event.stopPropagation();
                      void navigate("/family/history?standings=crokinole");
                    }}
                  >
                    Standings
                  </button>
                  {resumeCroke && (
                    <button
                      className="button primary"
                      onClick={() =>
                        void navigate(
                          `/family/crokinole/${resumeCroke.definition.id}`,
                        )
                      }
                    >
                      {state.access[resumeCroke.definition.id]?.scorerUserId ===
                      userId
                        ? "Resume game"
                        : "View current game"}
                    </button>
                  )}
                  {state.creationEnabled &&
                    hasPermission(shared.member, "startGames") &&
                    hasPermission(shared.member, "scoreGames") && (
                      <button
                        className={`button ${resumeCroke ? "light" : "primary"}`}
                        onClick={() =>
                          resumeCroke
                            ? setNewGameConfirm(true)
                            : void navigate("/family/crokinole/new")
                        }
                      >
                        Start game
                      </button>
                    )}
                  {!state.creationEnabled && (
                    <span>
                      Crokinole changes are paused. Saved games remain
                      available.
                    </span>
                  )}
                </div>
              </div>
            </section>
            {gymEnabled && (
              <GymEntryCard
                onOpen={() => void navigate("/gym-lab?from=family")}
              />
            )}
          </div>
          {unfinishedScrabble.length > 0 && (
            <section aria-label="Unfinished Scrabble games">
              <h2>Unfinished Scrabble games</h2>
              <div className="hub-recent">
                {unfinishedScrabble.map((g) => (
                  <button
                    key={g.id}
                    className="hub-recent-game"
                    onClick={() => void openScrabble(g.id)}
                  >
                    <strong>
                      {g.players.map((p) => playerDisplayName(p)).join(" vs ")}
                    </strong>
                    <span>
                      {g.status === "paused"
                        ? "Paused"
                        : g.pendingEnd
                          ? "Final review"
                          : "In progress"}
                      {" · "}
                      {shared.gameAccess[g.id]?.scorerUserId === userId
                        ? "You are the scorer"
                        : "View game"}
                      {shared.gameAccess[g.id]?.mode === "practice"
                        ? " · Private test"
                        : ""}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <button
            className="button light"
            onClick={() => void navigate("/family/history")}
          >
            All saved games
          </button>
          {visibleGames.length > 0 && (
            <>
              <h2>Recent Crokinole games</h2>
              <div className="hub-recent">
                {visibleGames.map((g) => {
                  const item = (
                    <button
                      className="hub-recent-game"
                      onClick={() =>
                        void navigate(`/family/crokinole/${g.definition.id}`)
                      }
                    >
                      <strong>
                        {g.definition.participants
                          .map((p) => p.name)
                          .join(" vs ")}
                      </strong>
                      <span>
                        {g.status.replaceAll("_", " ")} · {g.rounds.length}{" "}
                        rounds
                        {g.definition.mode === "practice"
                          ? " · Private test"
                          : ""}
                      </span>
                    </button>
                  );
                  return shared.member.role === "superadmin" &&
                    g.definition.mode === "practice" ? (
                    <SwipeToDelete
                      key={g.definition.id}
                      disabled={locked || !state.creationEnabled}
                      onDelete={() =>
                        prompt({
                          title: "Delete this private test?",
                          message:
                            "This test will disappear from game lists. Its internal audit stays retained.",
                          operation: (reason) => ({
                            type: "delete-practice",
                            gameId: g.definition.id,
                            expectedRevision: g.revision,
                            reason,
                          }),
                        })
                      }
                    >
                      {item}
                    </SwipeToDelete>
                  ) : (
                    <div key={g.definition.id}>{item}</div>
                  );
                })}
              </div>
              {state.nextCursor && (
                <button
                  className="button light"
                  onClick={() =>
                    void store.refresh(undefined, state.nextCursor!)
                  }
                >
                  More Crokinole games
                </button>
              )}
            </>
          )}
        </main>
      )}
      {equipment === "tiles" && (
        <TileSetSettings
          store={sharedStore}
          equipment={shared.equipment}
          disabled={locked}
          onClose={() => setEquipment(null)}
        />
      )}
      {equipment === "colours" && state.palette && (
        <ColourSettings
          colours={state.palette.colours}
          disabled={locked || !state.creationEnabled}
          onSave={async (colours) => {
            await store.mutate({
              type: "save-palette",
              expectedRevision: state.palette!.revision,
              colours,
            });
          }}
          onClose={() => setEquipment(null)}
        />
      )}
      {showDefaults && state.palette && (
        <CrokinoleDefaultsSettings
          initial={state.palette.defaults}
          busy={locked}
          canEdit={
            state.creationEnabled &&
            hasPermission(shared.member, "manageEquipment")
          }
          onClose={() => setShowDefaults(false)}
          onSave={async (defaults) => {
            await store.mutate({
              type: "save-defaults",
              expectedRevision: state.palette!.revision,
              defaults,
            });
          }}
        />
      )}
      {newGameConfirm && (
        <Modal
          title="Start another Crokinole game?"
          onClose={() => setNewGameConfirm(false)}
        >
          <p>Your unfinished game stays available to resume.</p>
          <div className="crokinole-actions">
            <button
              className="button light"
              onClick={() => setNewGameConfirm(false)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!state.creationEnabled}
              onClick={() => {
                setNewGameConfirm(false);
                void navigate("/family/crokinole/new");
              }}
            >
              Start another game
            </button>
          </div>
        </Modal>
      )}
      {action && (
        <Modal
          title={action.title}
          onClose={() => {
            if (!locked) setAction(null);
          }}
        >
          <p>{action.message}</p>
          <label className="crokinole-field">
            Reason
            <textarea
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="crokinole-error">
              {error}
            </p>
          )}
          <div className="crokinole-actions">
            <button
              className="button light"
              disabled={locked}
              onClick={() => setAction(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={locked || !state.creationEnabled || !reason.trim()}
              onClick={() => void doAction()}
            >
              Confirm
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function safeGameId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "invalid-route";
  }
}
function HubHistory({
  claimInitialLeadLoad,
  onBackToGames,
  leadEpoch,
  userId,
  familyId,
  players,
  onOpen,
  canPractice,
}: {
  userId: string;
  familyId: string;
  canPractice: boolean;
  leadEpoch: string;
  onBackToGames: () => void;
  claimInitialLeadLoad: () => boolean;
  players: SharedState["players"];
  onOpen: (summary: GameSummary) => Promise<void>;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const replayId = search.get("replay");
  const requestedStandings = search.get("standings");
  const standingsGame =
    requestedStandings === "scrabble" || requestedStandings === "crokinole"
      ? requestedStandings
      : null;
  const standingsTitle =
    standingsGame === "scrabble" ? "Scrabble" : "Crokinole";
  const standingsHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (standingsGame) standingsHeading.current?.focus();
  }, [standingsGame]);
  const returnPosition = useRef<{
    y: number;
    button: HTMLButtonElement;
  } | null>(null);
  useEffect(() => {
    if (replayId || !returnPosition.current) return;
    const { y, button } = returnPosition.current;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: "instant" });
      button.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [replayId]);
  function closeReplay() {
    if (returnPosition.current) router.back();
    else router.replace("/family/history", { scroll: false });
  }
  const [filter, setFilter] = useState("");
  const [player, setPlayer] = useState("");
  const [data, setData] = useState<GameSummaryPage>({
    games: [],
    nextCursor: null,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      const generation = ++request.current;
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams();
        if (filter) query.set("gameType", filter);
        if (player) query.set("playerId", player);
        if (cursor) query.set("cursor", cursor);
        const next = await familyRequest<unknown>(
          `/api/family/games?${query}`,
          undefined,
          { expectedUserId: userId },
        );
        if (!isGameSummaryPage(next))
          throw new Error(
            "History returned an incomplete response. Try again.",
          );
        if (generation === request.current)
          setData((old) => ({
            games: cursor ? [...old.games, ...next.games] : next.games,
            nextCursor: next.nextCursor,
            standings: next.standings ?? (cursor ? old.standings : undefined),
          }));
      } catch (e) {
        if (
          generation === request.current &&
          e instanceof FamilyRequestError &&
          [401, 403].includes(e.status)
        )
          setData({ games: [], nextCursor: null });
        if (generation === request.current)
          setError(e instanceof Error ? e.message : "Could not load history.");
      } finally {
        if (generation === request.current) setLoading(false);
      }
    },
    [filter, player, userId],
  );
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);
  if (standingsGame && !replayId)
    return (
      <main className="hub-content">
        <button type="button" className="button light" onClick={onBackToGames}>
          Back to games
        </button>
        <h1 ref={standingsHeading} tabIndex={-1}>
          {standingsTitle} standings
        </h1>
        {loading && <p role="status">Loading standings…</p>}
        {error && <p role="alert">{error}</p>}
        {data.standings && !error && (
          <FamilyStandings
            rows={data.standings}
            players={players}
            gameFilter={standingsGame}
          />
        )}
        {standingsGame === "scrabble" && (
          <LeadStandings
            key={leadEpoch}
            userId={userId}
            players={players}
            claimInitialLoad={claimInitialLeadLoad}
          />
        )}
      </main>
    );
  return (
    <>
      {replayId && (
        <HistoryGameReplay
          key={`${userId}:${familyId}:${replayId}`}
          gameId={replayId}
          userId={userId}
          familyId={familyId}
          onClose={closeReplay}
        />
      )}
      <div hidden={!!replayId}>
        <main className="hub-content">
          <h1>Game history</h1>
          {data.standings && !error && (
            <details className="standings-disclosure">
              <summary>Family standings · wins & ranks</summary>
              <FamilyStandings
                rows={data.standings}
                players={players}
                gameFilter={filter}
              />
            </details>
          )}
          <details className="standings-disclosure">
            <summary>Scrabble lead rankings</summary>
            <LeadStandings key={leadEpoch} userId={userId} players={players} />
          </details>
          <div className="crokinole-fields">
            <label className="crokinole-field">
              Game
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">All games</option>
                <option value="scrabble">Scrabble</option>
                <option value="crokinole">Crokinole</option>
              </select>
            </label>
            <label className="crokinole-field">
              Player
              <select
                value={player}
                onChange={(e) => setPlayer(e.target.value)}
              >
                <option value="">Everyone</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {playerDisplayName(p)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && (
            <p role="alert" className="crokinole-error">
              {error}
              <button className="text-button" onClick={() => void load()}>
                Retry
              </button>
            </p>
          )}
          {loading && <p role="status">Loading history…</p>}
          <div className="hub-recent">
            {data.games
              .filter((g) => canPractice || g.mode !== "practice")
              .map((g) => (
                <div className="hub-history-row" key={`${g.gameType}:${g.id}`}>
                  <button
                    aria-label={`${g.gameType} · ${g.mode === "practice" ? "Private test" : g.status.replaceAll("_", " ")} · ${historyLabel(g.participants, g.winnerIds, players, g.totals)}`}
                    className="hub-recent-game"
                    onClick={() =>
                      void onOpen(g).catch((e) => setError(e.message))
                    }
                  >
                    <span className="eyebrow">
                      {g.gameType} ·{" "}
                      {g.mode === "practice"
                        ? "Private test"
                        : g.status.replaceAll("_", " ")}
                    </span>
                    <HistoryParticipants
                      participants={g.participants}
                      winnerIds={g.winnerIds}
                      profiles={players}
                      totals={g.totals}
                    />
                  </button>
                  {g.gameType === "scrabble" && (
                    <button
                      className="button light hub-history-replay"
                      aria-label={`Replay ${historyLabel(g.participants, [], players, undefined, " and ")}`}
                      onClick={(event) => {
                        returnPosition.current = {
                          y: window.scrollY,
                          button: event.currentTarget,
                        };
                        router.push(
                          `/family/history?replay=${encodeURIComponent(g.id)}`,
                          { scroll: false },
                        );
                        window.scrollTo({ top: 0, behavior: "instant" });
                      }}
                    >
                      Replay
                    </button>
                  )}
                </div>
              ))}
          </div>
          {!loading && !error && !data.games.length && (
            <p>No games match these filters.</p>
          )}
          {data.nextCursor && (
            <button
              className="button light"
              disabled={loading}
              onClick={() => void load(data.nextCursor!)}
            >
              More games
            </button>
          )}
        </main>
      </div>
    </>
  );
}
