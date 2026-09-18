"use client";
import { playerDisplayName } from "../lib/player-profile";
import { PlayerName } from "./PlayerName";
import {
  hasPermission,
  type MemberPermission,
} from "../lib/member-permissions";
import "./live-draft.css";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  applyCommand,
  createGame,
  getTileSupply,
  getTileTotal,
  type GameCommand,
  type GameState,
  type GameTurn,
  type Racks,
} from "../domain/game";
import { isLetter } from "../domain/board";
import {
  defaultLexicon,
  lexiconDetails,
  resolveLexicon,
} from "../lib/lexicons";
import { solverContext, type PreviewData } from "../lib/preview-store";
import { localScorerStore, type ScorerStore } from "../lib/scorer-store";
import { searchMoves, SOLVER_VERSION } from "../lib/solver-client";
import type { ScoredMove } from "../domain/solver";
import { AnimatedBoardEditor } from "./AnimatedBoardEditor";
import { Modal } from "./Modal";
import { EMPTY_EQUIPMENT, snapshotTileSet } from "../domain/equipment";
import { TileSetSettings } from "./TileSetSettings";
import { PlayerSetup } from "./PlayerSetup";
import { TileRackInput } from "./TileRackInput";
import { TileBagButton } from "./TileBagButton";
import { ExtraTiles } from "./ExtraTiles";
import { WinnerBanner } from "./WinnerBanner";
import { WordReference } from "./WordReference";
import { PlayedWordDetails } from "./PlayedWordDetails";
import { OfficialWordSearch } from "./OfficialWordSearch";
import { PlayerProfileEditor } from "./PlayerProfileEditor";
import {
  saveVerifiedWords,
  syncVerifiedWords,
} from "../lib/verified-word-store";
import type { SavedPlayer } from "../lib/preview-store";
import { RoundTable } from "./RoundTable";
import { RecordsPage } from "./RecordsPage";
import type { Placement } from "../domain/types";
import type { GameAccess } from "../lib/shared-contract";
import "./scorer-refinements.css";
import "./amberly.css";
import "./game-screen.css";
import { GameScorePanel, useNarrowGameScreen } from "./GameScorePanel";
import { SpectatorGame } from "./SpectatorGame";
import { useLiveDraft, type LiveContext } from "./useLiveDraft";
import { AmberlyHeader, AmberlyNavigation } from "./AmberlyHeader";
import { PlayerAvatar } from "./PlayerAvatar";
import { TabletopIcon } from "./TabletopIcon";
import { CountCheck, CountCorrectionHistory } from "./CountCheck";
import { DraftConflictNotice } from "./DraftConflictNotice";

type View = "Home" | "Play" | "Records" | "History" | "Players";
type Action<T = GameCommand> = T extends GameCommand
  ? Omit<T, "id" | "expectedRevision">
  : never;
const NAV: View[] = ["Home", "Play", "Records", "History", "Players"];
const id = () => crypto.randomUUID();
const nameOf = (game: GameState, playerId: string) =>
  game.players.find((p) => p.id === playerId)?.name ?? "Player";
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Your saved history has been retained.";

export function ScorerApp({
  store = localScorerStore,
  renderGameStatus,
  renderGameItem,
  accountControls,
  shareControl,
  liveContext,
  initialView = "Home",
  initialNewGame = false,
  onHome,
  onNavigate,
}: {
  store?: ScorerStore;
  initialView?: View;
  initialNewGame?: boolean;
  onHome?: () => void;
  onNavigate?: (path: string) => void;
  liveContext?: LiveContext;
  accountControls?: ReactNode;
  shareControl?: ReactNode;
  renderGameStatus?: (game: GameState) => ReactNode;
  renderGameItem?: (game: GameState, content: ReactNode) => ReactNode;
} = {}) {
  const {
    subscribe,
    getSnapshot,
    getServerSnapshot,
    load: loadPreview,
    update: updatePreview,
    downloadBackup,
  } = store;
  const shared = store.mode === "shared";
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const allowed = (key: MemberPermission) =>
    !shared || hasPermission(state.shared?.member, key);
  const canStart = allowed("startGames") && allowed("scoreGames");
  const [creationMode, setCreationMode] = useState<"confirmed" | "practice">(
    "confirmed",
  );
  const [view, setView] = useState<View>(initialView);
  const [modal, setModal] = useState<
    | "settings"
    | "game-menu"
    | "setup"
    | "rematch"
    | "end"
    | "assist"
    | "exchange"
    | "undo"
    | "examples"
    | "suggestions"
    | "counts"
    | "extra-tiles"
    | null
  >(initialNewGame && canStart ? "setup" : null);
  const [countOrigin, setCountOrigin] = useState<"bag" | "end" | "assist">(
    "bag",
  );
  const [endingInputs, setEndingInputs] = useState<
    Record<string, Record<string, string>>
  >({});
  const [notice, setNotice] = useState<string | null>(null);
  const [viewerTools, setViewerTools] = useState<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(false);
  const narrowScreen = useNarrowGameScreen();
  const [panelWidth, setPanelWidth] = useState(320);
  const panelDrag = useRef<{ x: number; width: number } | null>(null);
  const [extraTiles, setExtraTiles] = useState<{
    gameId: string;
    revision: number;
    placements: Placement[];
  } | null>(null);
  const [tab, setTab] = useState<"Rounds" | "Turns">("Rounds");
  const [cumulative, setCumulative] = useState(false);
  const [officialQuery, setOfficialQuery] = useState<string | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<SavedPlayer | null>(null);
  const [selectedTurn, setSelectedTurn] = useState<GameTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [searchNote, setSearchNote] = useState("");
  const [suggestions, setSuggestions] = useState<{
    game: GameState;
    moves: ScoredMove[];
  } | null>(null);
  const game =
    state.data.games.find((g) => g.id === state.data.activeGameId) ?? null;
  const displayedReference =
    view === "Play" && game ? game.lexicon : defaultLexicon;
  const displayedWordList = lexiconDetails(displayedReference);
  useEffect(() => {
    void loadPreview().catch((e) => setError(errorText(e)));
    return () => {
      runningRef.current = false;
      controller.current?.abort();
    };
  }, [loadPreview]);

  async function mutate(change: (data: PreviewData) => PreviewData) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updatePreview(change);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function execute(
    action: Action,
    target: GameState = game!,
  ): Promise<GameState | null> {
    if (!target) return null;
    if (shared && !store.canScore?.(target.id)) {
      setError(
        "Scoring is unavailable. Use the designated scorer's account, or resolve the pending save before continuing.",
      );
      return null;
    }
    let next: GameState | null = null;
    const command = {
      ...action,
      id: id(),
      expectedRevision: target.revision,
    } as GameCommand;
    const success = await mutate((data) => {
      const current = data.games.find((g) => g.id === target.id);
      if (!current)
        throw new Error("The game could not be found. Reload to recover.");
      const result = applyCommand(
        current,
        command,
        resolveLexicon(current.lexicon),
        solverContext,
      );
      if (!result.ok) throw new Error(result.error.message);
      next =
        action.type === "resume"
          ? syncVerifiedWords(result.game, data.verifiedWords ?? [])
          : result.game;
      const drafts = { ...data.drafts };
      if (
        (action.type === "pause" ||
          action.type === "resume" ||
          action.type === "extend-supply") &&
        drafts[target.id]
      )
        drafts[target.id] = { ...drafts[target.id], revision: next.revision };
      else delete drafts[target.id];
      return {
        ...data,
        games: data.games.map((g) => (g.id === target.id ? next! : g)),
        drafts,
      };
    });
    if (success && shared)
      next =
        store.getSnapshot().data.games.find((g) => g.id === target.id) ?? null;
    if (success && (action.type === "play" || action.type === "pass"))
      promptDetectedEnding(next);
    if (success && action.type === "finalize")
      window.scrollTo({ top: 0, behavior: "instant" });
    return success ? next : null;
  }
  function openEnding(target: GameState | null = game) {
    if (!target) return;
    setError(null);
    if (target.assistance) setModal("end");
    else {
      setCountOrigin("end");
      setModal("counts");
    }
  }
  function promptDetectedEnding(target: GameState | null) {
    if (target?.pendingEnd && !target.assistance) openEnding(target);
  }
  function goHome() {
    if (onHome) {
      onHome();
      return;
    }
    setView("Home");
    setModal(null);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }
  async function openGame(gameId: string) {
    if (
      await mutate((data) => {
        const synced = shared ? data : saveVerifiedWords(data, [], gameId);
        return { ...synced, activeGameId: gameId };
      })
    )
      setView("Play");
  }
  async function addPlayer(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (
      !trimmed ||
      trimmed.length > 60 ||
      /[\u0000-\u001f\u007f]/.test(trimmed)
    ) {
      setError("Enter a name between 1 and 60 characters.");
      return null;
    }
    const playerId = id();
    const success = await mutate((data) => {
      if (
        data.players.some(
          (p) => p.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
        )
      )
        throw new Error(
          "That name already exists in this preview. Choose the existing player or use a distinguishing name.",
        );
      return {
        ...data,
        players: [...data.players, { id: playerId, name: trimmed }],
      };
    });
    return success ? playerId : null;
  }
  async function startGame(
    seats: string[],
    first: string,
    direction: "clockwise" | "counterclockwise",
    tileSetId: string | null,
    equipmentRevision: number,
  ) {
    store.setCreationMode?.(
      state.shared?.member.role === "superadmin" ? creationMode : "confirmed",
    );
    const success = await mutate((data) => {
      const players = seats.flatMap((playerId, seat) => {
        const p = data.players.find((p) => p.id === playerId);
        return p
          ? [
              {
                id: p.id,
                name: playerDisplayName(p),
                seat: seat as 0 | 1 | 2 | 3,
              },
            ]
          : [];
      });
      const equipment = data.equipment ?? EMPTY_EQUIPMENT;
      if (tileSetId !== null && equipment.revision !== equipmentRevision)
        throw new Error(
          "Tile sets changed while setup was open. Close setup and choose your set again.",
        );
      const tileSet = snapshotTileSet(equipment, tileSetId);
      const result = createGame({
        ...(tileSet ? { tileSet } : {}),
        id: id(),
        players,
        firstPlayerId: first,
        direction,
        lexicon: {
          id: defaultLexicon.id,
          edition: defaultLexicon.edition,
          status: defaultLexicon.status,
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      return {
        ...data,
        games: [
          ...data.games,
          syncVerifiedWords(result.game, data.verifiedWords ?? []),
        ],
        activeGameId: result.game.id,
      };
    });
    if (success) {
      setModal(null);
      setView("Play");
      if (initialNewGame) onNavigate?.("/family/scrabble?view=play");
    }
  }
  async function autoFinish(all: boolean) {
    if (!game?.assistance || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError(null);
    try {
      let current = game;
      let steps = 0;
      while (
        runningRef.current &&
        current.status === "active" &&
        !current.pendingEnd &&
        steps < 128
      ) {
        controller.current = new AbortController();
        setSearchNote(
          `Finding ${nameOf(current, current.currentPlayerId)}’s highest-scoring move in this game’s word list…`,
        );
        const search = await searchMoves(
          current.board,
          current.assistance!.racks[current.currentPlayerId],
          controller.current.signal,
          getTileSupply(current),
          current.lexicon,
          current.verifiedWords,
        );
        if (!runningRef.current) break;
        if (search.status !== "complete")
          throw new Error(
            "The move search did not complete. No move or pass was recorded; you can try again.",
          );
        const best = search.moves[0];
        const next = await execute(
          best
            ? { type: "play", placements: best.placements }
            : { type: "assisted-pass", solverVersion: SOLVER_VERSION },
          current,
        );
        if (!next) break;
        current = next;
        steps++;
        setSearchNote(
          best
            ? `${nameOf(current, current.turns.at(-1)!.playerId)} played ${best.words.map((w) => w.word).join(" + ")} for ${best.score}.`
            : "No legal placement in this game’s word list. Pass recorded.",
        );
        if (!all) break;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      if (current.pendingEnd && runningRef.current) setModal("end");
      if (steps === 128)
        throw new Error(
          "Automatic play paused at its safety limit. The saved sequence can be reviewed.",
        );
    } catch (e) {
      if (runningRef.current) setError(errorText(e));
    } finally {
      runningRef.current = false;
      setRunning(false);
      controller.current = null;
    }
  }
  async function showSuggestions() {
    if (!game?.assistance || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError(null);
    controller.current = new AbortController();
    try {
      const search = await searchMoves(
        game.board,
        game.assistance.racks[game.currentPlayerId],
        controller.current.signal,
        getTileSupply(game),
        game.lexicon,
        game.verifiedWords,
      );
      if (!runningRef.current) return;
      if (search.status !== "complete")
        throw new Error(
          "The search did not finish. No suggestions or pass were recorded.",
        );
      setSuggestions({ game, moves: search.moves });
      setModal("suggestions");
    } catch (e) {
      if (runningRef.current) setError(errorText(e));
    } finally {
      runningRef.current = false;
      setRunning(false);
      controller.current = null;
    }
  }
  const hasDraft = game
    ? !!state.data.drafts[game.id]?.placements.length
    : false;
  const readOnly = !!game && shared && !store.canScore?.(game.id);
  const livePreview = useLiveDraft(
    view === "Play" && shared ? game : null,
    game ? state.data.drafts[game.id] : undefined,
    !readOnly,
    liveContext,
  );
  const live = game?.status === "active" && !readOnly;
  const fitGame =
    view === "Play" &&
    !!game &&
    game.status !== "finalized" &&
    !readOnly &&
    state.status === "ready";
  const overlayPanel = fitGame && narrowScreen;
  const panelOpen = overlayPanel ? mobilePanel : panel;
  function togglePanel() {
    if (overlayPanel) setMobilePanel((value) => !value);
    else setPanel((value) => !value);
  }
  useEffect(() => {
    if (fitGame) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [fitGame]);
  const turnActions = game && (
    <div className="turn-actions">
      {game.status !== "finalized" && (
        <>
          <button
            className="tabletop-tool"
            aria-label="Pass turn"
            title="Pass turn"
            disabled={
              busy ||
              running ||
              hasDraft ||
              !!game.pendingEnd ||
              !!game.assistance ||
              !live
            }
            onClick={() => void execute({ type: "pass" })}
          >
            <TabletopIcon name="pass" />
          </button>
          <button
            className="tabletop-tool"
            aria-label="Exchange tiles"
            title="Exchange tiles"
            disabled={
              busy ||
              running ||
              hasDraft ||
              !!game.pendingEnd ||
              !!game.assistance ||
              !live
            }
            onClick={() => setModal("exchange")}
          >
            <TabletopIcon name="exchange" />
          </button>
          <button
            className="tabletop-tool"
            aria-label={game.status === "paused" ? "Resume game" : "Pause game"}
            title={game.status === "paused" ? "Resume game" : "Pause game"}
            disabled={busy || running || readOnly}
            onClick={() =>
              void execute({
                type: game.status === "paused" ? "resume" : "pause",
              })
            }
          >
            <TabletopIcon name={game.status === "paused" ? "play" : "pause"} />
          </button>
          {!fitGame && (
            <button
              className="tabletop-tool"
              aria-label="Undo last turn"
              title="Undo last turn"
              disabled={
                busy ||
                running ||
                readOnly ||
                hasDraft ||
                !game.turns.length ||
                !!game.assistance
              }
              onClick={() => setModal("undo")}
            >
              <TabletopIcon name="undo" />
            </button>
          )}
        </>
      )}
      <span className="save-state" role="status">
        {state.error
          ? "Not saved — review the message above"
          : state.pending
            ? shared
              ? "Saving to family history…"
              : "Saving on this device…"
            : shared
              ? "Shared history saved · live entry is provisional"
              : "Saved on this device"}
      </span>
    </div>
  );
  const gameActions = game && (
    <div className="game-actions">
      {shareControl}
      <TileBagButton
        key={game.id}
        remaining={game.expectedBagCount}
        board={game.board}
        tileSupply={game.tileSupply}
        assisted={!!game.assistance}
        checkCountsDisabled={busy || running || readOnly}
        onCheckCounts={
          game.status !== "finalized" && !game.assistance
            ? () => {
                setError(null);
                setCountOrigin("bag");
                setModal("counts");
              }
            : undefined
        }
      />
      {fitGame && (
        <button
          className="tabletop-tool"
          aria-label={panelOpen ? "Collapse score panel" : "Expand score panel"}
          title="Scores"
          aria-expanded={panelOpen}
          onClick={togglePanel}
        >
          <TabletopIcon name="scores" />
        </button>
      )}
      {!fitGame && game.status !== "finalized" && (
        <button
          className="tabletop-tool tabletop-end-game"
          aria-label="End game"
          title="End game"
          disabled={busy || running || readOnly}
          onClick={() => openEnding()}
        >
          <TabletopIcon name="finish" />
        </button>
      )}
    </div>
  );
  function renderMenu() {
    return modal === "settings" ? (
      <TileSetSettings
        store={store}
        equipment={state.data.equipment}
        disabled={
          busy ||
          !!state.pending ||
          !!state.unresolved ||
          !allowed("manageEquipment")
        }
        onClose={() => setModal("game-menu")}
      />
    ) : (
      modal === "game-menu" && (
        <Modal
          title="Amberly Games"
          className="tabletop-menu"
          onClose={() => setModal(null)}
        >
          {onNavigate && (
            <AmberlyNavigation
              onNavigate={(path) => {
                setModal(null);
                onNavigate(path);
              }}
            />
          )}
          <nav className="game-menu-nav" aria-label="Game navigation">
            {NAV.filter(
              (item) =>
                !onNavigate ||
                item === "Play" ||
                item === "Records" ||
                item === "History",
            ).map((item) => (
              <button
                className="button light"
                key={item}
                aria-current={view === item ? "page" : undefined}
                onClick={() => {
                  setModal(null);
                  if (item === "Home" && onHome) onHome();
                  else setView(item);
                }}
              >
                <TabletopIcon
                  name={
                    item === "Home"
                      ? "home"
                      : item === "Play"
                        ? "board"
                        : item === "Records"
                          ? "trophy"
                          : item === "History"
                            ? "history"
                            : "players"
                  }
                />
                {onNavigate && item === "History" ? "Scrabble history" : item}
              </button>
            ))}
            {!onNavigate && (
              <button
                className="button light"
                disabled={!allowed("manageEquipment")}
                onClick={() => setModal("settings")}
              >
                <TabletopIcon name="settings" />
                Settings
              </button>
            )}
          </nav>
          {(error || state.error) && (
            <p className="error-banner" role="alert">
              {error ?? state.error}
            </p>
          )}
          {accountControls}
          {game && (
            <div className="menu-game-details">
              {renderGameStatus?.(game)}
              {game.definition.tileSet && (
                <p>
                  Tile set: {game.definition.tileSet.name} ·{" "}
                  {getTileTotal(game)} tiles
                </p>
              )}
              <p>
                {game.tileSupply
                  ? `Nonstandard tile set · ${getTileTotal(game)} tiles · excluded from player records`
                  : game.mode === "solo"
                    ? "Solo practice"
                    : `${game.players.length} players · ${game.direction}`}
              </p>
              {fitGame && turnActions}
              {!readOnly && game.status !== "finalized" && (
                <button
                  className="button light tabletop-end-game"
                  disabled={busy || running}
                  onClick={() => openEnding()}
                >
                  <TabletopIcon name="finish" />
                  End game
                </button>
              )}
            </div>
          )}
          <p>
            <strong>{shared ? "Shared games" : "Local preview"}</strong> ·{" "}
            {shared
              ? "Shared history. Existing beta games keep their original record eligibility."
              : "Saved on this device only."}
          </p>
          <p>
            {displayedWordList.shortLabel} ·{" "}
            {displayedWordList.count.toLocaleString("en-US")} words
          </p>
          {!readOnly && (
            <div className="game-menu-nav">
              <button
                className="button light"
                onClick={() => setModal("examples")}
              >
                View word list
              </button>
              <button
                className="button light"
                onClick={() => {
                  setModal(null);
                  setOfficialQuery("");
                }}
              >
                Search official site
              </button>
              {!shared && (
                <a className="button light" href="/family">
                  Amberly sign-in →
                </a>
              )}
            </div>
          )}
        </Modal>
      )
    );
  }
  const playAgain = view === "Play" &&
    game?.status === "finalized" &&
    canStart && (
      <button
        className="button light"
        disabled={busy || !!state.unresolved}
        onClick={() => {
          setCreationMode(
            state.shared?.gameAccess[game.id]?.mode ?? "confirmed",
          );
          setError(null);
          setModal("rematch");
        }}
      >
        Play again
      </button>
    );
  const draftRecovery = view === "Play" &&
    game &&
    state.draftConflicts?.includes(game.id) &&
    store.discardDraftConflict && (
      <DraftConflictNotice
        key={game.id}
        gameId={game.id}
        revision={game.revision}
        draft={state.data.drafts[game.id]}
        pending={!!state.unresolved}
        onDiscard={store.discardDraftConflict}
        onExport={store.exportWorkspace}
      />
    );
  const setupDialog = (modal === "setup" || modal === "rematch") && (
    <PlayerSetup
      initialSetup={
        modal === "rematch" && game
          ? {
              seats: Array.from(
                { length: 4 },
                (_, seat) =>
                  game.players.find((player) => player.seat === seat)?.id ?? "",
              ),
              first: game.definition.firstPlayerId,
              direction: game.direction,
            }
          : undefined
      }
      equipment={state.data.equipment ?? EMPTY_EQUIPMENT}
      sharedMode={
        shared
          ? state.shared?.member.role === "superadmin"
            ? creationMode
            : "confirmed"
          : undefined
      }
      onSharedModeChange={setCreationMode}
      players={state.data.players}
      busy={busy || !canStart}
      canAddPlayers={allowed("addPlayers")}
      allowPractice={!shared || state.shared?.member.role === "superadmin"}
      onAdd={addPlayer}
      onStart={startGame}
      onClose={() => {
        setModal(null);
        if (initialNewGame) onHome?.();
      }}
      error={error}
    />
  );
  if (shared && view === "Play" && game && readOnly)
    return (
      <div
        className={`app-shell ${draftRecovery ? "draft-recovery-shell" : "spectator-shell"}`}
      >
        <AmberlyHeader
          onHome={goHome}
          onMenu={() => setModal("game-menu")}
          menuOpen={modal === "game-menu"}
          menuLabel="Open game menu"
        >
          <div className="spectator-header-actions">
            {shareControl}
            <div className="spectator-header-tools" ref={setViewerTools} />
          </div>
        </AmberlyHeader>
        <main>
          {(error || state.error) && (
            <p className="error-banner" role="alert">
              {error ?? state.error}
            </p>
          )}
          {playAgain}
          {draftRecovery}
          <SpectatorGame
            game={game}
            profiles={state.data.players}
            liveDraft={livePreview.draft}
            toolsTarget={draftRecovery ? undefined : viewerTools}
            assisted={!!game.assistance}
            confirmation={renderGameStatus?.(game)}
          />
        </main>
        {renderMenu()}
        {setupDialog}
      </div>
    );
  return (
    <div className={`app-shell ${fitGame ? "game-screen" : ""}`}>
      {livePreview.connectionFailed && (
        <span className="live-preview-connection" role="status">
          Viewer preview reconnecting · your entry is retained
        </span>
      )}
      <AmberlyHeader
        homeHref={shared ? "/family" : "/"}
        onHome={goHome}
        onMenu={() => setModal("game-menu")}
        menuOpen={modal === "game-menu"}
        menuLabel="Open game menu"
      >
        {fitGame && gameActions}
        {!fitGame && (
          <span className="local-label">
            <i />
            {shared ? "Shared games" : "Local preview"}
          </span>
        )}
      </AmberlyHeader>
      <main>
        {notice && (
          <p className="inline-message" role="status">
            {notice}
          </p>
        )}
        {(error || state.error) && (
          <div className="error-banner" role="alert">
            <span>{error ?? state.error}</span>
            {error && (
              <button
                aria-label="Dismiss message"
                onClick={() => setError(null)}
              >
                ×
              </button>
            )}
          </div>
        )}
        {state.status === "loading" ? (
          <div className="empty-state">
            <h1>Setting the table…</h1>
            <p>
              {shared
                ? "Opening your family’s shared history."
                : "Checking this device for saved preview games."}
            </p>
          </div>
        ) : state.status === "error" ? (
          <div className="recovery">
            <h1>Your saved copy is protected.</h1>
            <p>
              Automatic recovery stopped rather than replacing unreadable or
              conflicting history. Export the stored copy before further
              recovery.
            </p>
            <button
              className="button primary"
              onClick={() =>
                void downloadBackup().catch((e) => setError(errorText(e)))
              }
            >
              Export stored copy
            </button>
            <button className="button light" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        ) : (
          <>
            {view === "Home" && (
              <>
                <section className="home-intro amberly-welcome">
                  <div>
                    <span className="eyebrow">Scrabble scorekeeper</span>
                    <h1>
                      Game night
                      <br />
                      at Amberly.
                    </h1>
                    <p>
                      Set up a game, keep score, and look back on the words
                      worth remembering.
                    </p>
                    <div className="home-actions">
                      <button
                        className="button primary"
                        disabled={!canStart}
                        onClick={() => setModal("setup")}
                      >
                        {shared ? "New game" : "New preview game"}{" "}
                        <span>＋</span>
                      </button>
                      {game && (
                        <button
                          className="button light"
                          onClick={() => setView("Play")}
                        >
                          {game.status === "finalized"
                            ? "View last game"
                            : "Return to game"}
                        </button>
                      )}
                    </div>
                  </div>
                </section>
                <section className="section-heading">
                  <h2>At the table</h2>
                  <button
                    className="text-button"
                    onClick={() => setView("Players")}
                  >
                    {shared ? "Manage players →" : "Manage preview players →"}
                  </button>
                </section>
                {state.data.players.length ? (
                  <div className="player-strip">
                    {state.data.players.map((p, i) => (
                      <div key={p.id}>
                        <span className={`avatar colour-${i % 4}`}>
                          <PlayerAvatar
                            name={p.name}
                            photoDataUrl={p.photoDataUrl}
                          />
                        </span>
                        <strong>
                          <PlayerName player={p} profile={p} />
                        </strong>
                        <span className="muted">
                          {
                            state.data.games.filter((g) =>
                              g.players.some((x) => x.id === p.id),
                            ).length
                          }{" "}
                          {shared ? "games in this view" : "preview games"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-inline">
                    <div>
                      <h3>Who’s playing?</h3>
                      <p>
                        Add a player once, then pick them again for the next
                        game.
                      </p>
                    </div>
                    <button
                      className="button light"
                      onClick={() => setView("Players")}
                    >
                      Add your first player
                    </button>
                  </div>
                )}
                <section className="section-heading">
                  <h2>Recent games</h2>
                  <button
                    className="text-button"
                    onClick={() => setView("History")}
                  >
                    All history →
                  </button>
                </section>
                <GameList
                  gameAccess={state.shared?.gameAccess}
                  games={state.data.games.slice(-3).reverse()}
                  onOpen={openGame}
                  renderItem={renderGameItem}
                />
              </>
            )}
            {view === "Players" && (
              <>
                <div className="page-heading">
                  <span className="eyebrow">Familiar faces</span>
                  <h1>The players</h1>
                  <p>
                    {shared
                      ? "Family profiles are shared. You can edit your own linked profile; a superadmin manages account links."
                      : "These preview profiles stay on this device."}
                  </p>
                </div>
                {allowed("addPlayers") ? (
                  <AddPlayer onAdd={addPlayer} busy={busy} />
                ) : (
                  <p className="muted">
                    Adding players is disabled for your account.
                  </p>
                )}
                <div className="players-list">
                  {state.data.players.map((p, i) => (
                    <div key={p.id}>
                      <span className={`avatar colour-${i % 4}`}>
                        <PlayerAvatar
                          name={p.name}
                          photoDataUrl={p.photoDataUrl}
                        />
                      </span>
                      <div>
                        <h3>
                          <PlayerName player={p} profile={p} />
                        </h3>
                        <p>
                          {
                            state.data.games.filter((g) =>
                              g.players.some((x) => x.id === p.id),
                            ).length
                          }{" "}
                          {shared
                            ? "games in this view"
                            : "games in this preview"}
                        </p>
                        {p.bio && <p>{p.bio}</p>}
                        <button
                          className="text-button"
                          disabled={shared && !store.canEditPlayer?.(p.id)}
                          onClick={() => setEditingPlayer(p)}
                        >
                          Edit profile
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {view === "History" && (
              <>
                <div className="page-heading">
                  <span className="eyebrow">The games we remember</span>
                  <h1>Game history</h1>
                  <p>
                    {shared
                      ? "Shared games retain their original turn journal. Reported concerns and superadmin decisions stay with each game."
                      : "Preview games are retained here, including their original turn journal."}
                  </p>
                </div>
                <GameList
                  renderItem={renderGameItem}
                  gameAccess={state.shared?.gameAccess}
                  games={[...state.data.games].reverse()}
                  onOpen={openGame}
                />
                {state.shared?.nextCursor && (
                  <button
                    className="button light"
                    onClick={() =>
                      void store
                        .loadMore?.()
                        .catch((e) => setError(errorText(e)))
                    }
                  >
                    Load earlier games
                  </button>
                )}
                {allowed("exportHistory") && (
                  <button
                    className="button light"
                    onClick={() =>
                      void downloadBackup().catch((e) => setError(errorText(e)))
                    }
                  >
                    {shared
                      ? "Export shared history"
                      : "Export preview history"}
                  </button>
                )}
              </>
            )}
            {view === "Records" && (
              <RecordsPage
                games={state.data.games}
                players={state.data.players}
                access={state.shared?.gameAccess}
                hasMore={!!state.shared?.nextCursor}
                onLoadMore={() => {
                  void store.loadMore?.().catch((e) => setError(errorText(e)));
                }}
                onOpen={(gameId) => {
                  void openGame(gameId);
                }}
                onHistory={() => setView("History")}
              />
            )}
            {playAgain}
            {draftRecovery}
            {view === "Play" &&
              (!game ? (
                <div className="empty-state">
                  <span className="eyebrow">Ready when you are</span>
                  <h1>Let’s set the table.</h1>
                  <p>
                    Choose your players, arrange their seats, and decide who
                    starts.
                  </p>
                  <button
                    className="button primary"
                    disabled={!canStart}
                    onClick={() => setModal("setup")}
                  >
                    {shared ? "New game" : "New preview game"}
                  </button>
                </div>
              ) : readOnly ? (
                <SpectatorGame
                  game={game}
                  profiles={state.data.players}
                  liveDraft={livePreview.draft}
                  confirmation={renderGameStatus?.(game)}
                />
              ) : (
                <>
                  <div className="game-heading">
                    <div>
                      <span className="eyebrow">
                        {game.mode === "solo"
                          ? "Solo practice"
                          : `${game.players.length} at the table`}{" "}
                        · {game.direction}
                      </span>
                      <h1
                        className={
                          !game.result && game.status !== "paused"
                            ? "sr-only"
                            : undefined
                        }
                      >
                        {game.result
                          ? "Final results"
                          : game.status === "paused"
                            ? "Game paused"
                            : "Current game"}
                      </h1>
                    </div>
                    {gameActions}
                  </div>
                  <div className="game-notices">
                    {!fitGame && renderGameStatus?.(game)}
                    <WinnerBanner game={game} />
                    {!fitGame && game.tileSupply && (
                      <p className="nonstandard-banner">
                        Nonstandard tile set · {getTileTotal(game)} tiles · Kept
                        in history, excluded from player records
                      </p>
                    )}
                    {game.assistance && (
                      <div className="assistance-banner">
                        <div>
                          <strong>
                            {game.status === "finalized"
                              ? "Finished with assistance"
                              : "Assisted finishing"}{" "}
                            · current racks only
                          </strong>
                          <p>
                            {searchNote ||
                              "All play after assistance starts is excluded from human achievements."}
                          </p>
                        </div>
                        {live && !game.pendingEnd && (
                          <div className="game-actions">
                            {running ? (
                              <button
                                className="button light"
                                onClick={() => {
                                  runningRef.current = false;
                                  controller.current?.abort();
                                  setRunning(false);
                                }}
                              >
                                Pause automation
                              </button>
                            ) : (
                              <>
                                <button
                                  className="button light"
                                  disabled={busy}
                                  onClick={() => void showSuggestions()}
                                >
                                  Review suggestions
                                </button>
                                <button
                                  className="button light"
                                  disabled={busy}
                                  onClick={() => void autoFinish(false)}
                                >
                                  Next assisted turn
                                </button>
                                <button
                                  className="button primary"
                                  disabled={busy}
                                  onClick={() => void autoFinish(true)}
                                >
                                  Auto-finish
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {game.pendingEnd && !game.result && (
                      <div className="inline-message">
                        Play has reached its ending condition. Review leftover
                        tiles and confirm the result.{" "}
                        <button
                          className="text-button"
                          onClick={() => openEnding()}
                        >
                          Review ending →
                        </button>
                      </div>
                    )}
                  </div>
                  <div
                    className={`play-layout resizable-play ${panelOpen && !overlayPanel ? "" : "panel-hidden"}`}
                    style={
                      {
                        "--panel-size": `${panelWidth}px`,
                        "--panel-space":
                          panelOpen && !overlayPanel
                            ? `${panelWidth}px`
                            : "0px",
                      } as CSSProperties
                    }
                  >
                    {!fitGame && (
                      <button
                        className="panel-chevron"
                        aria-label={
                          panelOpen
                            ? "Collapse score panel"
                            : "Expand score panel"
                        }
                        aria-expanded={panelOpen}
                        aria-controls="score-drawer"
                        onClick={togglePanel}
                      >
                        <span aria-hidden="true">{panelOpen ? "›" : "‹"}</span>
                      </button>
                    )}
                    {panelOpen && !overlayPanel && (
                      <div
                        className="panel-resizer"
                        role="separator"
                        tabIndex={0}
                        aria-label="Score panel width"
                        aria-orientation="vertical"
                        aria-valuemin={250}
                        aria-valuemax={440}
                        aria-valuenow={panelWidth}
                        onPointerDown={(event) => {
                          panelDrag.current = {
                            x: event.clientX,
                            width: panelWidth,
                          };
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                        }}
                        onPointerMove={(event) => {
                          const drag = panelDrag.current;
                          if (drag)
                            setPanelWidth(
                              Math.max(
                                250,
                                Math.min(
                                  440,
                                  drag.width + drag.x - event.clientX,
                                ),
                              ),
                            );
                        }}
                        onPointerUp={() => {
                          panelDrag.current = null;
                        }}
                        onPointerCancel={() => {
                          panelDrag.current = null;
                        }}
                        onLostPointerCapture={() => {
                          panelDrag.current = null;
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === "ArrowLeft" ||
                            event.key === "ArrowRight"
                          ) {
                            event.preventDefault();
                            setPanelWidth((width) =>
                              Math.max(
                                250,
                                Math.min(
                                  440,
                                  width +
                                    (event.key === "ArrowLeft" ? 20 : -20),
                                ),
                              ),
                            );
                          }
                          if (event.key === "Home") setPanelWidth(250);
                          if (event.key === "End") setPanelWidth(440);
                        }}
                        onDoubleClick={() => setPanelWidth(320)}
                      />
                    )}
                    <div className="table-area">
                      <AnimatedBoardEditor
                        key={game.id}
                        game={game}
                        fitScreen={fitGame}
                        profiles={state.data.players}
                        onOfficialSearch={(query) => setOfficialQuery(query)}
                        savedDraft={state.data.drafts[game.id]}
                        onUndo={() => setModal("undo")}
                        undoDisabled={
                          busy ||
                          running ||
                          readOnly ||
                          !game.turns.length ||
                          !!game.assistance
                        }
                        onRequestExtraTiles={(placements) => {
                          setExtraTiles({
                            gameId: game.id,
                            revision: game.revision,
                            placements,
                          });
                          setError(null);
                          setModal("extra-tiles");
                        }}
                        locked={
                          busy || running || readOnly || !!game.assistance
                        }
                        onDraft={(draft) => {
                          void updatePreview((data) => ({
                            ...data,
                            drafts: { ...data.drafts, [game.id]: draft },
                          })).catch((e) => setError(errorText(e)));
                        }}
                        onRecord={async (placements) =>
                          !!(await execute({ type: "play", placements }))
                        }
                      />
                      {!fitGame && turnActions}
                    </div>
                    <GameScorePanel
                      open={panelOpen}
                      overlay={overlayPanel}
                      onClose={() => setMobilePanel(false)}
                    >
                      <aside className="score-panel">
                        <div className="panel-heading">
                          <h2>Score sheet</h2>
                          <span>{game.turns.length} turns</span>
                        </div>
                        <div className="segmented full">
                          {(["Rounds", "Turns"] as const).map((t) => (
                            <button
                              key={t}
                              aria-pressed={tab === t}
                              onClick={() => setTab(t)}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                        {tab === "Rounds" ? (
                          <>
                            <div
                              className="segmented score-mode"
                              aria-label="Score display"
                            >
                              <button
                                aria-pressed={!cumulative}
                                onClick={() => setCumulative(false)}
                              >
                                Round scores
                              </button>
                              <button
                                aria-pressed={cumulative}
                                onClick={() => setCumulative(true)}
                              >
                                Running totals
                              </button>
                            </div>
                            <p className="score-mode-description">
                              {cumulative
                                ? "Each player’s accumulated score through each round. Totals match round scores in the first round."
                                : "Points earned in each round. Select Running totals to see scores accumulate."}
                            </p>
                            <RoundTable
                              game={game}
                              cumulative={cumulative}
                              onTurn={setSelectedTurn}
                            />
                            <p className="table-legend">
                              — No turn · A = assisted · Pass / exchange: 0
                            </p>
                          </>
                        ) : (
                          <div className="turn-log">
                            {[...game.turns].reverse().map((t) => (
                              <button
                                key={t.id}
                                onClick={() => setSelectedTurn(t)}
                              >
                                <span className="turn-number">{t.number}</span>
                                <span>
                                  <strong>
                                    {t.type === "play"
                                      ? t.words.map((w) => w.word).join(" + ")
                                      : t.type === "pass"
                                        ? "Pass"
                                        : `Exchange ${t.exchangeCount}`}
                                  </strong>
                                  <small>
                                    {nameOf(game, t.playerId)}
                                    {t.source === "assisted"
                                      ? " · Assisted"
                                      : ""}
                                  </small>
                                </span>
                                <b>+{t.score}</b>
                              </button>
                            ))}
                            {!game.turns.length && (
                              <p className="empty-log">
                                Your first play starts the story.
                              </p>
                            )}
                          </div>
                        )}
                        {game.result && (
                          <div className="final-breakdown">
                            <h3>Final adjustments</h3>
                            {game.players.map((p) => (
                              <div key={p.id}>
                                <span>{p.name}</span>
                                <span>
                                  −{game.result!.adjustments[p.id].deduction}
                                  {game.result!.adjustments[p.id].transfer
                                    ? ` +${game.result!.adjustments[p.id].transfer}`
                                    : ""}
                                </span>
                              </div>
                            ))}
                            <p>
                              {game.result.assisted
                                ? "Assisted ending"
                                : game.result.reason === "early"
                                  ? "Ended early"
                                  : "Completed"}
                              {game.result.unequalTurns
                                ? " · Unequal turns"
                                : ""}
                              <br />
                              Development game · excluded from family records
                            </p>
                          </div>
                        )}
                        <CountCorrectionHistory game={game} />
                        {!!game.verifiedWords?.length && (
                          <details className="verified-word-history">
                            <summary>
                              Official word additions (
                              {game.verifiedWords.length})
                            </summary>
                            {game.verifiedWords.map((entry) => (
                              <p key={entry.word}>
                                <a
                                  href={entry.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {entry.word} ↗
                                </a>
                                <br />
                                <small>
                                  Verified{" "}
                                  {new Date(entry.verifiedAt).toLocaleString()}
                                </small>
                              </p>
                            ))}
                          </details>
                        )}
                        <div className="panel-footnote">
                          <strong>Every point has a story.</strong>
                          <p>
                            Tap a round score or a turn to see its words and
                            scoring breakdown.
                          </p>
                        </div>
                      </aside>
                    </GameScorePanel>
                  </div>
                </>
              ))}
          </>
        )}
      </main>
      {renderMenu()}
      <footer>
        <span>
          Amberly <span className="footer-dot">·</span> A scoring companion for
          the table.
        </span>
        <span>
          {shared
            ? "Shared games · connected history"
            : "Local preview · saved on this device"}
        </span>
      </footer>
      {modal === "suggestions" && suggestions && (
        <Modal title="Assisted suggestions" onClose={() => setModal(null)} wide>
          <p>
            {nameOf(suggestions.game, suggestions.game.currentPlayerId)} ·
            Ranked by complete turn score within{" "}
            {lexiconDetails(suggestions.game.lexicon).count.toLocaleString(
              "en-US",
            )}{" "}
            words in this game’s list. These are assisted moves.
          </p>
          <div className="suggestion-list">
            {suggestions.moves.map((move, i) => (
              <div key={move.key}>
                <div>
                  <strong>
                    {i + 1}. {move.words.map((w) => w.word).join(" + ")}
                  </strong>
                  <p>
                    {move.score} points · {move.newTileCount} tiles ·{" "}
                    {move.placements
                      .map(
                        (p) =>
                          `${p.tile.letter}${p.tile.blank ? " (blank)" : ""} at ${String.fromCharCode(65 + p.col)}${p.row + 1}`,
                      )
                      .join(", ")}
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await execute(
                        { type: "play", placements: move.placements },
                        suggestions.game,
                      )
                    ) {
                      setModal(null);
                      setSuggestions(null);
                    }
                  }}
                >
                  Play suggestion {i + 1}
                </button>
              </div>
            ))}
          </div>
          {!suggestions.moves.length && (
            <>
              <p>
                No legal placement was found after a complete search of the
                game’s word list.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  if (
                    await execute(
                      { type: "assisted-pass", solverVersion: SOLVER_VERSION },
                      suggestions.game,
                    )
                  ) {
                    setModal(null);
                    setSuggestions(null);
                  }
                }}
              >
                Record assisted pass
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="inline-message">
              {error}
            </p>
          )}
        </Modal>
      )}
      {setupDialog}
      {modal === "extra-tiles" && game && extraTiles && (
        <ExtraTiles
          game={game}
          placements={extraTiles.placements}
          busy={busy}
          error={error}
          onClose={() => setModal(null)}
          onSave={async (command) => {
            if (
              game.id !== extraTiles.gameId ||
              game.revision !== extraTiles.revision
            ) {
              setError(
                "The game changed. Return to the board and review the letters again.",
              );
              return;
            }
            if (await execute(command)) {
              setModal(null);
              setNotice(
                "Extra tiles recorded. Your letters are still on the board; enter the board to review your turn.",
              );
            }
          }}
        />
      )}
      {modal === "counts" && game && (
        <CountCheck
          key={`${game.id}-${game.revision}`}
          game={game}
          busy={busy}
          error={error}
          hasDraft={hasDraft}
          ending={countOrigin !== "bag"}
          onClose={() => setModal(null)}
          onConfirm={async (correction) => {
            const hadEnding = !!game.pendingEnd;
            const updated = correction ? await execute(correction) : game;
            if (!updated) return;
            if (countOrigin === "assist")
              setModal(updated.pendingEnd ? "end" : "assist");
            else if (
              countOrigin === "end" &&
              (!hadEnding || updated.pendingEnd)
            )
              setModal("end");
            else if (updated.pendingEnd) {
              setCountOrigin("end");
              setModal("end");
            } else {
              setModal(null);
              setNotice(
                correction
                  ? "Tile counts corrected and recorded. Play can continue."
                  : `Tile counts checked. Everything adds up to ${getTileTotal(updated)}.`,
              );
            }
          }}
        />
      )}
      {(modal === "end" || modal === "assist") && game && (
        <Ending
          game={game}
          mode={modal}
          busy={busy}
          error={error}
          hasDraft={hasDraft}
          onClose={() => setModal(null)}
          onAssist={() => setModal("assist")}
          input={
            game.assistance
              ? Object.fromEntries(
                  game.order.map((id) => [
                    id,
                    game.assistance!.racks[id].join(""),
                  ]),
                )
              : (endingInputs[game.id] ??
                Object.fromEntries(game.order.map((id) => [id, ""])))
          }
          setInput={(input) =>
            setEndingInputs((previous) => ({ ...previous, [game.id]: input }))
          }
          onCheckCounts={() => {
            setError(null);
            setCountOrigin(modal === "assist" ? "assist" : "end");
            setModal("counts");
          }}
          onAction={async (action) => {
            const next = await execute(action);
            if (next) setModal(null);
          }}
        />
      )}
      {modal === "exchange" && game && (
        <SimpleAction
          title="Exchange tiles"
          label="How many tiles?"
          type="number"
          initial="1"
          max={Math.min(
            game.expectedBagCount,
            game.expectedRackCounts[game.currentPlayerId],
          )}
          busy={busy}
          error={error}
          onClose={() => setModal(null)}
          onSubmit={async (value) => {
            if (await execute({ type: "exchange", count: Number(value) }))
              setModal(null);
          }}
          description="Set those tiles aside, draw the same number from the bag, then return the discards. This uses your turn and scores zero."
        />
      )}
      {modal === "undo" && (
        <SimpleAction
          title="Undo the last turn"
          label="Reason for the correction"
          type="text"
          initial="Entry correction"
          busy={busy}
          error={error}
          onClose={() => setModal(null)}
          onSubmit={async (reason) => {
            if (await execute({ type: "undo", reason })) setModal(null);
          }}
          description="The original turn remains in the journal. Board, score, tile counts, and play order will be restored together. Reconcile the physical board and any tiles already drawn."
        />
      )}
      {modal === "examples" && (
        <WordReference
          verifiedWords={
            view === "Play" && game
              ? game.verifiedWords
              : state.data.verifiedWords
          }
          reference={displayedReference}
          onClose={() => setModal(null)}
        />
      )}
      {officialQuery !== null && game && (
        <OfficialWordSearch
          initialQuery={officialQuery}
          onClose={() => setOfficialQuery(null)}
          onSave={(words) =>
            mutate((data) => saveVerifiedWords(data, words, game.id))
          }
        />
      )}
      {editingPlayer && (
        <PlayerProfileEditor
          key={editingPlayer.id}
          player={editingPlayer}
          onClose={() => setEditingPlayer(null)}
          onSave={async (updates) => {
            const saved = await mutate((data) => {
              if (
                data.players.some(
                  (player) =>
                    player.id !== editingPlayer.id &&
                    player.name.toLocaleLowerCase() ===
                      updates.name.toLocaleLowerCase(),
                )
              )
                throw new Error(
                  "Another player already uses that name. Add a distinguishing name.",
                );
              if (
                !data.players.some((player) => player.id === editingPlayer.id)
              )
                throw new Error(
                  "The player could not be found. Nothing was changed.",
                );
              return {
                ...data,
                players: data.players.map((player) =>
                  player.id === editingPlayer.id
                    ? { id: player.id, ...updates }
                    : player,
                ),
              };
            });
            if (saved) setEditingPlayer(null);
            return saved;
          }}
        />
      )}
      {selectedTurn && game && (
        <Modal
          title={`Turn ${selectedTurn.number} · ${nameOf(game, selectedTurn.playerId)}`}
          onClose={() => setSelectedTurn(null)}
        >
          <p>
            {selectedTurn.source === "assisted"
              ? "Assisted play · excluded from human achievements"
              : "Human play in a development game"}
          </p>
          <div className="score-breakdown">
            {selectedTurn.words.map((w) => (
              <div key={`${w.row}-${w.col}-${w.direction}`}>
                <strong>{w.word}</strong>
                <span>{w.score}</span>
              </div>
            ))}
            {selectedTurn.bingo && (
              <div>
                <strong>Seven-tile bonus</strong>
                <span>50</span>
              </div>
            )}
            <div className="total">
              <strong>
                {selectedTurn.type === "play"
                  ? "Turn total"
                  : selectedTurn.type === "pass"
                    ? "Pass"
                    : "Exchange"}
              </strong>
              <strong>{selectedTurn.score}</strong>
            </div>
          </div>
          <p>
            Running score: {selectedTurn.runningScores[selectedTurn.playerId]}
          </p>
          {!!selectedTurn.words.length && (
            <section
              className="turn-word-definitions"
              aria-label="Word meanings"
            >
              {selectedTurn.words.map((word) => (
                <PlayedWordDetails
                  key={`${word.row}-${word.col}-${word.direction}`}
                  word={word}
                  board={game.board}
                  placements={selectedTurn.placements}
                  playerName={nameOf(game, selectedTurn.playerId)}
                  round={selectedTurn.round}
                  source={selectedTurn.source}
                />
              ))}
            </section>
          )}
        </Modal>
      )}
    </div>
  );
}

function AddPlayer({
  onAdd,
  busy,
}: {
  onAdd: (name: string) => Promise<string | null>;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="add-player"
      onSubmit={async (e) => {
        e.preventDefault();
        const submitted = name;
        if (await onAdd(submitted))
          setName((current) => (current === submitted ? "" : current));
      }}
    >
      <label htmlFor="player-name">Player name</label>
      <div>
        <input
          id="player-name"
          disabled={busy}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="e.g. Doug"
          required
          autoComplete="off"
        />
        <button className="button primary" disabled={busy || !name.trim()}>
          Add player
        </button>
      </div>
    </form>
  );
}
function GameList({
  games,
  gameAccess,
  onOpen,
  renderItem,
}: {
  renderItem?: (game: GameState, content: ReactNode) => ReactNode;
  games: GameState[];
  gameAccess?: Record<string, GameAccess>;
  onOpen: (id: string) => Promise<void>;
}) {
  return games.length ? (
    <div className="game-list">
      {games.map((g) => {
        const content = (
          <div className="game-list-item">
            <button onClick={() => void onOpen(g.id)}>
              <span className="game-date">
                {new Date(g.definition.createdAt).toLocaleDateString(
                  undefined,
                  {
                    month: "short",
                    day: "numeric",
                  },
                )}
              </span>
              <span>
                <strong>{g.players.map((p) => p.name).join(" · ")}</strong>
                <small>
                  {gameAccess?.[g.id]?.mode === "practice"
                    ? "Private test · "
                    : ""}
                  {g.turns.length} turns · {g.assistance ? "Assisted · " : ""}
                  {g.status === "finalized"
                    ? g.result?.reason === "early"
                      ? "Ended early"
                      : "Finalized"
                    : g.status === "paused"
                      ? "Paused"
                      : "In progress"}{" "}
                  · {lexiconDetails(g.lexicon).historyLabel}
                </small>
                {gameAccess?.[g.id]?.protests.some((p) => !p.resolution) ? (
                  <small className="game-review-label">
                    Concern awaiting review
                  </small>
                ) : gameAccess?.[g.id]?.protests.some(
                    (p) => p.resolution?.outcome === "upheld",
                  ) ? (
                  <small className="game-review-label">
                    Concern upheld · excluded from records
                  </small>
                ) : null}
              </span>
              <span className="game-list-score">
                {g.players
                  .map((p) => g.result?.scores[p.id] ?? g.scores[p.id])
                  .join(" / ")}
              </span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        );
        return (
          <Fragment key={g.id}>
            {renderItem ? renderItem(g, content) : content}
          </Fragment>
        );
      })}
    </div>
  ) : (
    <div className="empty-inline">
      <div>
        <h3>A fresh score sheet.</h3>
        <p>Your games will appear here. Nothing has been pre-filled.</p>
      </div>
    </div>
  );
}
function Ending({
  game,
  mode,
  busy,
  error,
  hasDraft,
  onClose,
  onAssist,
  onCheckCounts,
  input,
  setInput,
  onAction,
}: {
  game: GameState;
  mode: "end" | "assist";
  busy: boolean;
  error: string | null;
  hasDraft: boolean;
  onClose: () => void;
  onAssist: () => void;
  onCheckCounts: () => void;
  input: Record<string, string>;
  setInput: (input: Record<string, string>) => void;
  onAction: (action: Action) => Promise<void>;
}) {
  const racks: Racks = {};
  let invalid = false;
  for (const p of game.order) {
    const text = input[p].toUpperCase().replace(/\s/g, "");
    if (!/^[A-Z?]*$/.test(text)) invalid = true;
    racks[p] = text
      .split("")
      .filter((t) => t === "?" || isLetter(t)) as Racks[string];
  }
  const action: Action =
    mode === "assist"
      ? { type: "assist", racks }
      : { type: "finalize", reason: game.pendingEnd ?? "early", racks };
  const checked = invalid
    ? null
    : applyCommand(
        game,
        {
          ...action,
          id: "preview-review",
          expectedRevision: game.revision,
        } as GameCommand,
        resolveLexicon(game.lexicon),
        solverContext,
      );
  const result = checked?.ok ? checked.game.result : null;
  return (
    <Modal
      title={mode === "assist" ? "Finish with assistance" : "Review the ending"}
      onClose={onClose}
      wide
    >
      {hasDraft ? (
        <>
          <p>
            A play is still in draft. Record or clear it on the board before
            ending the game.
          </p>
          <button className="button primary" onClick={onClose}>
            Return to the board
          </button>
        </>
      ) : (
        <>
          <p>
            {mode === "assist"
              ? "Enter each player’s actual rack. The app will continue in play order using these tiles only, with no new draws. Suggestions and all later play remain assisted."
              : game.pendingEnd
                ? "Play has reached its ending condition. Check the remaining racks and final adjustments before confirming."
                : "This game will be marked ended early. Remaining rack values are deducted, and the result stays outside normal competitive records."}
          </p>
          {mode === "assist" && (
            <p className="inline-message">
              Searches use this game’s saved word list (
              {lexiconDetails(game.lexicon).count.toLocaleString("en-US")}{" "}
              words). A search that cannot finish will pause without recording a
              move or pass. Bag tiles left unused do not earn a going-out
              transfer.
            </p>
          )}
          <div className="rack-fields">
            {game.order.map((p) => (
              <div key={p}>
                <TileRackInput
                  label={`${nameOf(game, p)} remaining tiles`}
                  value={input[p]}
                  onChange={(value) => setInput({ ...input, [p]: value })}
                  readOnly={!!game.assistance || busy}
                />
                <small className="rack-expected">
                  {game.expectedRackCounts[p]} tiles expected
                </small>
              </div>
            ))}
          </div>
          <p className="muted">
            Use ? for a physical blank. Spaces between letters are ignored.
          </p>
          {!game.assistance && (
            <button
              className="text-button"
              disabled={busy}
              onClick={onCheckCounts}
            >
              Check counts again
            </button>
          )}
          {result && (
            <div className="table-scroll">
              <table className="ending-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Score</th>
                    <th>Leftovers</th>
                    <th>Transfer</th>
                    <th>Final</th>
                  </tr>
                </thead>
                <tbody>
                  {game.order.map((p) => (
                    <tr key={p}>
                      <th>{nameOf(game, p)}</th>
                      <td>{game.scores[p]}</td>
                      <td>−{result.adjustments[p].deduction}</td>
                      <td>+{result.adjustments[p].transfer}</td>
                      <td>
                        <strong>{result.scores[p]}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(invalid || (checked && !checked.ok) || error) && (
            <p className="inline-message" role="status">
              {error ??
                (invalid
                  ? "Use only A–Z and ? for blanks."
                  : checked && !checked.ok
                    ? checked.error.message
                    : "")}
            </p>
          )}
          <div className="dialog-actions">
            <button className="button light" onClick={onClose}>
              Return to game
            </button>
            {mode === "end" && !game.assistance && !game.pendingEnd && (
              <button className="button light" onClick={onAssist}>
                Use assisted finish
              </button>
            )}
            <button
              className="button primary"
              disabled={busy || !checked?.ok || invalid}
              onClick={() => void onAction(action)}
            >
              {mode === "assist"
                ? "Confirm assisted mode"
                : "Confirm final results"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
function SimpleAction({
  title,
  label,
  description,
  type,
  initial,
  max,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  description: string;
  type: "number" | "text";
  initial: string;
  max?: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  async function submit(e: FormEvent) {
    e.preventDefault();
    await onSubmit(value);
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <p>{description}</p>
        <label className="field">
          {label}
          <input
            type={type}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            min={type === "number" ? 1 : undefined}
            max={max}
            maxLength={200}
            required
          />
        </label>
        {error && (
          <p className="inline-message" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button light" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !value.trim()}>
            Confirm
          </button>
        </div>
      </form>
    </Modal>
  );
}
