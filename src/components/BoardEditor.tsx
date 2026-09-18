"use client";
import { PlayerName } from "./PlayerName";
import { PlayerAvatar } from "./PlayerAvatar";
import { useEffect, useId, useRef, useState } from "react";
import { LETTER_VALUES, premiumAt } from "../domain/board";
import { calculateDraftScore, scoreMove } from "../domain/scoring";
import { getTileSupply, type GameState, type GameTurn } from "../domain/game";
import { liveLeader, LEADER_LABELS } from "../lib/live-leader";
import type { Placement } from "../domain/types";
import type { Draft, SavedPlayer } from "../lib/preview-store";
import { lexiconDetails, resolveLexicon } from "../lib/lexicons";
import {
  insertLetters,
  erasePrevious,
  eraseSelected,
  inferDirection,
  canSelectDraftSquare,
} from "../lib/board-entry";
import { draftInventory } from "../lib/draft-inventory";
import { spectatorWords } from "../lib/spectator-plays";
import { PlayedWordDetails } from "./PlayedWordDetails";
import { ReviewWord } from "./ReviewWord";
import { Modal } from "./Modal";
import { TabletopIcon } from "./TabletopIcon";
import "./persistent-board.css";
import { CrownIcon } from "./CrownIcon";
import { positionScoreBubble } from "../lib/score-bubble-position";
import { getFormedWords } from "../lib/formed-words";
import "./board-entry.css";
import "./tile-appearance.css";
import { extendLexicon } from "../domain/verified-words";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function revealEntry(
  workspace: HTMLElement | null,
  fitScreen: boolean,
  draft: Draft,
) {
  const tile = workspace?.querySelector<HTMLElement>('[aria-selected="true"]');
  const scroller = workspace?.querySelector<HTMLElement>(".board-scroll");
  if (!tile) return;
  if (!fitScreen || !scroller) {
    tile.scrollIntoView({ block: "nearest", inline: "nearest" });
    return;
  }
  // Scroll only the board. Scrolling ancestors can pan iOS's visual viewport
  // while its keyboard is opening and move the entire entry bar out of reach.
  const bounds = scroller.getBoundingClientRect();
  const cell = tile.getBoundingClientRect();
  const fresh = Array.from(
    workspace!.querySelectorAll<HTMLElement>(".square.fresh"),
    (element) => element.getBoundingClientRect(),
  );
  // Keep the entered letters and one preceding square for an existing prefix.
  // If a long word cannot fit, follow its end without shrinking the touch targets.
  const wordTop =
    Math.min(cell.top, ...fresh.map((rect) => rect.top)) -
    (draft.direction === "down" ? cell.height : 0);
  const wordBottom = Math.max(cell.bottom, ...fresh.map((rect) => rect.bottom));
  const targetTop = Math.max(wordTop, wordBottom - bounds.height + 4);
  const margin = cell.width + 4;
  const left =
    cell.left < bounds.left + margin
      ? cell.left - bounds.left - margin
      : cell.right > bounds.right - margin
        ? cell.right - bounds.right + margin
        : 0;
  scroller.scrollBy({
    left,
    top: (targetTop + wordBottom - bounds.top - bounds.bottom) / 2,
    behavior: "instant",
  });
}

export function BoardEditor({
  game,
  savedDraft,
  onDraft,
  onRecord,
  onUndo,
  undoDisabled = false,
  locked,
  onRequestExtraTiles,
  onOfficialSearch,
  profiles,
  fitScreen = false,
  displayScores,
  displayTurns = game.turns,
  displayCurrentPlayerId = game.currentPlayerId,
}: {
  game: GameState;
  displayScores?: Record<string, number>;
  displayTurns?: readonly GameTurn[];
  displayCurrentPlayerId?: string;
  fitScreen?: boolean;
  profiles: SavedPlayer[];
  onOfficialSearch: (query: string) => void;
  savedDraft?: Draft;
  onDraft: (draft: Draft) => void;
  onRecord: (placements: Placement[]) => Promise<boolean>;
  onUndo?: () => void;
  undoDisabled?: boolean;
  locked: boolean;
  onRequestExtraTiles?: (placements: Placement[]) => void;
}) {
  const initial: Draft =
    savedDraft?.revision === game.revision
      ? savedDraft
      : {
          revision: game.revision,
          placements: [],
          row: 7,
          col: 7,
          direction: "across",
        };
  const [draft, setDraft] = useState(initial);
  const current = useRef(initial);
  const input = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLDialogElement>(null);
  const focusButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const [manualDirection, setManualDirection] = useState(
    initial.placements.length > 0,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [blank, setBlank] = useState(false);
  const [officialQuery, setOfficialQuery] = useState("");
  const scoreBubble = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(false);
  const [entryOptions, setEntryOptions] = useState(false);
  const [review, setReview] = useState(false);
  const [inspectCell, setInspectCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [recordError, setRecordError] = useState(false);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const composing = useRef(false);
  const disabled =
    locked || recording || game.status !== "active" || !!game.pendingEnd;
  const lexicon = extendLexicon(
    resolveLexicon(game.lexicon),
    game.verifiedWords ?? [],
  );
  const wordReference = lexiconDetails(game.lexicon);
  const preview = draft.placements.length
    ? scoreMove(
        game.board,
        draft.placements,
        lexicon,
        game.expectedRackCounts[game.currentPlayerId],
        getTileSupply(game),
      )
    : null;
  const potentialScore = preview?.ok
    ? preview.score
    : calculateDraftScore(game.board, draft.placements);
  const formedWords = getFormedWords(game.board, draft.placements, lexicon);
  const player = game.players.find((p) => p.id === game.currentPlayerId)!;
  const displayedScores = displayScores ?? game.result?.scores ?? game.scores;
  const crown = liveLeader(game.order, displayedScores, displayTurns);
  const leaders =
    game.mode === "solo"
      ? []
      : (game.result?.winnerIds ?? (crown ? [crown.playerId] : []));
  const leaderLabel = game.result
    ? leaders.length > 1
      ? "Joint winner"
      : "Winner"
    : crown
      ? LEADER_LABELS[crown.reason]
      : "In the lead";

  let inventory: ReturnType<typeof draftInventory> | null = null;
  try {
    inventory = draftInventory(
      game.board,
      draft.placements,
      getTileSupply(game),
    );
  } catch {
    // Retain the draft; scoreMove explains malformed or unreconciled inventory.
  }
  const exhaustedTiles = inventory?.exhausted ?? [];
  const exhaustedTile =
    exhaustedTiles.find(
      (tile) => tile.row === draft.row && tile.col === draft.col,
    ) ?? exhaustedTiles.at(-1);
  const inventoryWarning =
    exhaustedTiles.length > 0 ||
    (preview && !preview.ok && preview.error.code === "INVALID_INVENTORY");
  const shortages = Object.entries(inventory?.remaining ?? {})
    .filter(([, count]) => count < 0)
    .map(([letter, count]) => ({ letter, count: -count }));
  const shortageLabel = exhaustedTile
    ? `No ${exhaustedTile.tile.blank ? "blank" : exhaustedTile.tile.letter} tiles left`
    : null;
  const canUseBlank =
    !!exhaustedTile &&
    !exhaustedTile.tile.blank &&
    (inventory?.remaining["?"] ?? 0) > 0;
  const inspectedWords = inspectCell
    ? spectatorWords(game.turns).filter((word) =>
        word.cells.includes(`${inspectCell.row}:${inspectCell.col}`),
      )
    : [];
  const validationMessage =
    preview && !preview.ok
      ? `${preview.error.message}${preview.error.code.includes("WORD") && wordReference.legacy ? " This saved game uses the original 500 example words." : ""}`
      : null;

  useEffect(() => {
    if (!focused || fitScreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const viewport = window.visualViewport;
    const measure = () => {
      workspace.current?.style.setProperty(
        "--entry-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      workspace.current?.style.setProperty(
        "--entry-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    measure();
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      document.body.style.overflow = previousOverflow;
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [focused, fitScreen]);
  useEffect(() => {
    if (!focused || blank || review) return;
    const frame = requestAnimationFrame(() =>
      revealEntry(workspace.current, fitScreen, current.current),
    );
    return () => cancelAnimationFrame(frame);
  }, [focused, draft.row, draft.col, zoom, blank, review, fitScreen]);
  useEffect(() => {
    const dialog = workspace.current;
    return () => {
      if (dialog?.matches(":modal")) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (!fitScreen) return;
    const shell = workspace.current?.closest<HTMLElement>(".game-screen");
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;
    let frame = 0;
    let dimensions = "";
    const measure = () => {
      if (viewport.scale !== 1) return;
      document.body.style.setProperty(
        "--usable-game-height",
        `${viewport.height}px`,
      );
      document.body.style.setProperty(
        "--usable-game-top",
        `${viewport.offsetTop}px`,
      );
      shell.classList.toggle(
        "keyboard-open",
        window.innerHeight - viewport.height > 120,
      );
      const nextDimensions = `${viewport.width}:${viewport.height}:${viewport.offsetTop}`;
      if (nextDimensions !== dimensions) {
        dimensions = nextDimensions;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (focusedRef.current)
            revealEntry(workspace.current, true, current.current);
        });
      }
    };
    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      document.body.style.removeProperty("--usable-game-height");
      document.body.style.removeProperty("--usable-game-top");
      shell.classList.remove("keyboard-open");
    };
  }, [fitScreen]);

  const lastPlacement = exhaustedTile ?? draft.placements.at(-1);
  useEffect(() => {
    if (!focused || !lastPlacement || review || blank || inspectCell) return;
    const dialog = workspace.current;
    const bubble = scoreBubble.current;
    const scroller = dialog?.querySelector(".board-scroll");
    const tile = dialog?.querySelector(
      `[data-testid="cell-${LETTERS[lastPlacement.col]}${lastPlacement.row + 1}"]`,
    );
    if (!bubble || !scroller || !tile) return;
    const anchorCol = lastPlacement.col;
    let frame = 0;
    function position() {
      if (!bubble || !tile || !scroller) return;
      const rect = tile.getBoundingClientRect();
      const bounds = scroller.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = Math.max(bounds.left, viewport?.offsetLeft ?? 0) + 4;
      const right =
        Math.min(
          bounds.right,
          (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth),
        ) - 4;
      const top = Math.max(bounds.top, viewport?.offsetTop ?? 0) + 4;
      const bottom =
        Math.min(
          bounds.bottom,
          (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
        ) - 4;
      const visible =
        rect.right > left &&
        rect.left < right &&
        rect.bottom > top &&
        rect.top < bottom;
      bubble.style.visibility = visible ? "visible" : "hidden";
      const width = bubble.offsetWidth;
      const height = bubble.offsetHeight;
      const obstacles = Array.from(
        dialog!.querySelectorAll(".square.occupied, .square.selected"),
        (element) => element.getBoundingClientRect(),
      ).filter(
        (obstacle) =>
          obstacle.right > left &&
          obstacle.left < right &&
          obstacle.bottom > top &&
          obstacle.top < bottom,
      );
      const vertical =
        draft.placements.length > 1
          ? draft.placements.every((placement) => placement.col === anchorCol)
          : draft.direction === "down";
      const placement = positionScoreBubble(
        rect,
        { width, height },
        { left, top, right, bottom },
        obstacles,
        vertical ? "down" : "across",
      );
      dialog!.dataset.scoreDocked = String(!placement);
      if (!placement && fitScreen) {
        bubble.style.visibility = "hidden";
        return;
      }
      // A crowded board may have no clear space. Reserve the existing footer
      // hint's area rather than ever laying the score over a tile.
      const dock = dialog!
        .querySelector(".entry-done-row .muted, .entry-board-status")
        ?.getBoundingClientRect();
      const point =
        placement ?? (dock ? { left: dock.left, top: dock.top } : null);
      if (!point) {
        bubble.style.visibility = "hidden";
        return;
      }
      bubble.style.left = `${point.left}px`;
      bubble.style.top = `${point.top}px`;
    }
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    observer.observe(tile);
    observer.observe(bubble);
    scroller.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      if (dialog) delete dialog.dataset.scoreDocked;
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [
    focused,
    lastPlacement,
    draft.placements,
    draft.direction,
    zoom,
    fitScreen,
    review,
    blank,
    inspectCell,
  ]);

  function openOfficial(query: string) {
    setReview(false);
    exitFocus();
    onOfficialSearch(query);
  }

  function change(next: Draft) {
    current.current = next;
    setDraft(next);
    setMessage(null);
    try {
      onDraft(next);
    } catch {
      setMessage(
        "These letters are still on screen, but could not be saved. Keep this page open to recover them.",
      );
    }
  }
  function focusInput() {
    input.current?.focus({ preventScroll: true });
  }
  function enterFocus() {
    if (disabled) return;
    if (!focusedRef.current && workspace.current) {
      const dialog = workspace.current;
      try {
        if (!fitScreen) {
          dialog.close();
          dialog.showModal();
        }
        focusedRef.current = true;
        setFocused(true);
      } catch {
        if (!dialog.open) dialog.show();
        setMessage(
          "The board could not enter full screen. Your letters are unchanged.",
        );
        return;
      }
    }
    focusInput();
  }
  function exitFocus() {
    input.current?.blur();
    if (!fitScreen && focusedRef.current && workspace.current) {
      workspace.current.close();
      workspace.current.show();
    }
    focusedRef.current = false;
    setFocused(false);
    if (fitScreen) setZoom(false);
    requestAnimationFrame(() =>
      focusButton.current?.focus({ preventScroll: true }),
    );
  }
  function selectSquare(row: number, col: number) {
    if (disabled) return;
    const d = current.current;
    if (!canSelectDraftSquare(d, game.board, row, col)) {
      setMessage(
        `Finish this word first. Your letters are kept. Review this turn, or ${fitScreen ? "clear letters in Letter tools" : "use Clear letters"} before starting elsewhere.`,
      );
      focusInput();
      return;
    }
    change({
      ...d,
      row,
      col,
      atEdge: false,
      direction: manualDirection
        ? d.direction
        : inferDirection(game.board, row, col, d.direction, d.placements),
    });
    enterFocus();
  }
  function insert(text: string, asBlank = false) {
    if (disabled) return;
    const result = insertLetters(
      current.current,
      game.board,
      text,
      asBlank,
      game.expectedRackCounts[game.currentPlayerId],
    );
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    change(result.draft);
    focusInput();
  }
  function useBlankForExhaustedTile() {
    if (disabled || !exhaustedTile) return;
    const d = current.current;
    try {
      const now = draftInventory(game.board, d.placements, getTileSupply(game));
      const target = now.exhausted.find(
        (p) => p.row === exhaustedTile.row && p.col === exhaustedTile.col,
      );
      if (!target || target.tile.blank || now.remaining["?"] < 1) return;
      change({
        ...d,
        placements: d.placements.map((p) =>
          p === target ? { ...p, tile: { ...p.tile, blank: true } } : p,
        ),
      });
      setReview(false);
      requestAnimationFrame(focusInput);
    } catch {
      setMessage("Check the tile inventory before using a blank.");
    }
  }
  function pickSquare(row: number, col: number) {
    if (
      game.board[row][col] &&
      !current.current.placements.length &&
      spectatorWords(game.turns).some((word) =>
        word.cells.includes(`${row}:${col}`),
      )
    ) {
      input.current?.blur();
      setInspectCell({ row, col });
      return;
    }
    selectSquare(row, col);
  }
  function backspace() {
    if (!disabled) change(erasePrevious(current.current));
  }
  function deleteSelected() {
    if (!disabled) change(eraseSelected(current.current));
  }
  function finishEntry() {
    if (disabled) return;
    input.current?.blur();
    if (preview) {
      setRecordError(false);
      setReview(true);
    } else {
      setMessage("Enter your letters on the board before reviewing this turn.");
    }
  }
  function direction(value: Draft["direction"] | "auto") {
    const d = current.current;
    setManualDirection(value !== "auto");
    change({
      ...d,
      atEdge: false,
      direction:
        value === "auto"
          ? inferDirection(game.board, d.row, d.col, d.direction, d.placements)
          : value,
    });
    if (focusedRef.current) focusInput();
  }
  function returnToLetters() {
    setReview(false);
    requestAnimationFrame(focusInput);
  }
  async function recordTurn() {
    if (recordingRef.current || disabled || !preview?.ok) return;
    recordingRef.current = true;
    setRecording(true);
    setRecordError(false);
    try {
      if (await onRecord(current.current.placements)) {
        setReview(false);
        exitFocus();
      } else setRecordError(true);
    } catch {
      setRecordError(true);
    } finally {
      recordingRef.current = false;
      setRecording(false);
    }
  }
  const tools = game.status !== "finalized" && (
    <div className="entry-tools">
      <div className="entry-direction">
        <div className="segmented" role="group" aria-label="Word direction">
          <button
            aria-pressed={!manualDirection}
            disabled={disabled}
            onClick={() => direction("auto")}
          >
            Auto
          </button>
          <button
            aria-pressed={manualDirection && draft.direction === "across"}
            disabled={disabled}
            onClick={() => direction("across")}
          >
            Across →
          </button>
          <button
            aria-pressed={manualDirection && draft.direction === "down"}
            disabled={disabled}
            onClick={() => direction("down")}
          >
            Down ↓
          </button>
        </div>
        <span className="direction-caption">
          {draft.direction === "across" ? "Across →" : "Down ↓"}
          {manualDirection ? " · chosen" : " · automatic"}
        </span>
      </div>
      <button
        className="button light"
        disabled={disabled}
        onClick={() => {
          if (!focusedRef.current) enterFocus();
          setBlank(true);
        }}
      >
        Blank <span className="keycap">space</span>
      </button>
      <button
        className="text-button"
        disabled={disabled || !draft.placements.length}
        onClick={() => {
          change({ ...current.current, placements: [], atEdge: false });
          if (focusedRef.current) focusInput();
        }}
      >
        Clear letters
      </button>
    </div>
  );

  return (
    <section className="board-editor" aria-label="Scrabble board and entry">
      <dialog
        ref={workspace}
        open
        className={`board-workspace ${focused && !fitScreen ? "entry-focused" : ""} ${fitScreen ? "persistent-board" : ""}`}
        role={focused && !fitScreen ? "dialog" : "region"}
        aria-modal={focused && !fitScreen ? true : undefined}
        aria-labelledby={focused && !fitScreen ? titleId : undefined}
        aria-label={focused && !fitScreen ? undefined : "Board workspace"}
        onCancel={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          if (!recordingRef.current) exitFocus();
        }}
      >
        {focused && !fitScreen && (
          <header className="entry-focus-header">
            <div>
              <span className="eyebrow">
                {game.assistance ? "Assisted play" : "Enter this turn"}
              </span>
              <h2 id={titleId}>{player.name}’s letters</h2>
            </div>
            <div
              className="entry-live-scores"
              aria-label="Current recorded scores"
            >
              {game.players.map((p) => (
                <span
                  key={p.id}
                  className={p.id === game.currentPlayerId ? "playing" : ""}
                  aria-label={`${p.name}, ${game.scores[p.id]} points${leaders.includes(p.id) ? `, ${leaderLabel}` : ""}`}
                >
                  {leaders.includes(p.id) && (
                    <CrownIcon className="entry-leader-crown" />
                  )}
                  <span>{p.name}</span>
                  <b>{game.scores[p.id]}</b>
                </span>
              ))}
            </div>
            <button
              className="button light entry-exit"
              onClick={exitFocus}
              disabled={recording}
            >
              Exit entry
            </button>
          </header>
        )}
        {!fitScreen && (
          <div className="board-controls">
            <span>
              {game.status === "finalized"
                ? "Recorded final board"
                : focused
                  ? "Tap to place the cursor. Type through existing letters."
                  : fitScreen
                    ? `${game.status === "paused" ? "Paused · " : ""}Round ${Math.floor(game.turns.length / game.order.length) + 1} · ${game.direction}`
                    : "Tap a square to enter your letters."}
            </span>
            <div className="board-view-actions">
              {!focused && game.status !== "finalized" && (
                <button
                  ref={focusButton}
                  className="text-button"
                  disabled={disabled}
                  onClick={enterFocus}
                >
                  {draft.placements.length
                    ? "Continue entry ↗"
                    : "Focus board ↗"}
                </button>
              )}
              <button
                className="text-button"
                aria-pressed={zoom}
                disabled={fitScreen && !focused && disabled}
                onClick={() => {
                  if (fitScreen && !focused) enterFocus();
                  setZoom((value) => !value);
                }}
              >
                {zoom ? "Fit board" : "Enlarge board"}
              </button>
            </div>
          </div>
        )}
        <div className="board-stage">
          <div className={`board-table ${zoom ? "is-zoomed" : ""}`}>
            {game.players.map((p) => (
              <div
                key={p.id}
                data-turn-player={p.id}
                className={`board-seat board-seat-${p.seat} ${p.id === displayCurrentPlayerId && game.status === "active" ? "is-current" : ""}`}
                aria-label={`${p.name}, ${displayedScores[p.id]} points${p.id === displayCurrentPlayerId && game.status === "active" ? ", current player" : ""}`}
              >
                <span className="board-seat-avatar">
                  <span className={`avatar colour-${p.seat}`}>
                    <PlayerAvatar
                      name={p.name}
                      photoDataUrl={
                        profiles.find((profile) => profile.id === p.id)
                          ?.photoDataUrl
                      }
                    />
                  </span>
                  {leaders.includes(p.id) && (
                    <span
                      className="board-seat-crown"
                      role="img"
                      aria-label={leaderLabel}
                      title={leaderLabel}
                    >
                      <CrownIcon />
                    </span>
                  )}
                </span>
                <span className="board-seat-details">
                  <span className="board-seat-summary">
                    <strong>
                      <PlayerName
                        player={p}
                        profile={profiles.find(
                          (profile) => profile.id === p.id,
                        )}
                        useNickname={game.status === "active"}
                      />
                    </strong>
                    <b className="board-seat-score" data-turn-score={p.id}>
                      {displayedScores[p.id]}
                      <span className="sr-only"> points</span>
                    </b>
                  </span>
                  <small
                    className="board-seat-turn"
                    aria-hidden={
                      p.id !== displayCurrentPlayerId ||
                      game.status !== "active"
                    }
                  >
                    Your turn
                  </small>
                </span>
              </div>
            ))}
            <div className="board-scroll">
              <div className={`board-frame ${zoom ? "is-zoomed" : ""}`}>
                <div
                  className="board-grid"
                  role="grid"
                  aria-label="Scrabble board, 15 by 15"
                >
                  {game.board.map((row, r) => (
                    <div key={r} className="board-row" role="row">
                      {row.map((tile, c) => {
                        const fresh = draft.placements.find(
                          (p) => p.row === r && p.col === c,
                        );
                        const shown = fresh?.tile ?? tile;
                        const exhausted = exhaustedTiles.some(
                          (p) => p.row === r && p.col === c,
                        );
                        const premium = premiumAt(r, c);
                        const selected =
                          draft.row === r && draft.col === c && !disabled;
                        const label = `${LETTERS[c]}${r + 1}${shown ? ` ${shown.letter}${shown.blank ? " blank, zero points" : `, ${LETTER_VALUES[shown.letter]} points`}` : ` empty${premium ? ` ${premium}` : ""}`}`;
                        return (
                          <button
                            key={c}
                            type="button"
                            role="gridcell"
                            aria-label={`${label}${exhausted ? ". No physical tiles left; use a blank or check tiles." : ""}`}
                            aria-invalid={exhausted || undefined}
                            aria-selected={selected}
                            tabIndex={selected ? 0 : -1}
                            data-testid={`cell-${LETTERS[c]}${r + 1}`}
                            data-turn-cell={`${r}:${c}`}
                            className={`square ${premium?.toLowerCase() ?? "plain"} ${shown ? "occupied" : ""} ${fresh ? "fresh" : ""} ${selected ? "selected" : ""} ${exhausted ? "tile-exhausted" : ""}`}
                            onClick={() => pickSquare(r, c)}
                          >
                            {shown ? (
                              <span
                                key={`${shown.letter}:${shown.blank}:${exhausted}`}
                                className={`letter-tile ${shown.blank ? "blank-tile" : ""}`}
                              >
                                <b>{shown.letter}</b>
                                <small>
                                  {shown.blank
                                    ? 0
                                    : LETTER_VALUES[shown.letter]}
                                </small>
                              </span>
                            ) : (
                              <span className="premium-label">
                                {r === 7 && c === 7
                                  ? "★"
                                  : premium
                                    ? premium
                                    : ""}
                              </span>
                            )}
                            {selected && (
                              <span
                                className="direction-caret"
                                aria-hidden="true"
                              >
                                {draft.direction === "across" ? "→" : "↓"}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {formedWords.length > 0 && (
                    <svg
                      className="formed-word-outlines"
                      viewBox="0 0 15 15"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      {formedWords.map((word) => {
                        const inset =
                          word.direction === "across" ? 0.055 : 0.12;
                        const validity =
                          word.valid === true
                            ? "valid"
                            : word.valid === false
                              ? "invalid"
                              : "unavailable";
                        return (
                          <rect
                            key={`${word.row}-${word.col}-${word.direction}`}
                            data-word={word.word}
                            data-validity={validity}
                            className={`word-outline word-${validity}`}
                            x={word.col + inset}
                            y={word.row + inset}
                            width={word.endCol - word.col + 1 - inset * 2}
                            height={word.endRow - word.row + 1 - inset * 2}
                            rx="0.08"
                            vectorEffect="non-scaling-stroke"
                          />
                        );
                      })}
                    </svg>
                  )}
                </div>
                <input
                  ref={input}
                  className="board-input"
                  aria-label="Type letters on the board"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  enterKeyHint="done"
                  value=""
                  disabled={disabled}
                  style={{
                    left: `calc(${(draft.col / 15) * 100}% + ${1 - draft.col / 15}px)`,
                    top: `calc(${(draft.row / 15) * 100}% + ${1 - draft.row / 15}px)`,
                  }}
                  onFocus={() => {
                    if (!focusedRef.current) enterFocus();
                  }}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={(event) => {
                    composing.current = false;
                    event.currentTarget.value = "";
                    if (event.data) insert(event.data);
                  }}
                  onChange={(event) => {
                    if (composing.current) return;
                    const text = event.currentTarget.value;
                    event.currentTarget.value = "";
                    if (text === " ") setBlank(true);
                    else if (text) insert(text);
                  }}
                  onBeforeInput={(event) => {
                    const native = event.nativeEvent as InputEvent;
                    if (composing.current || native.isComposing) return;
                    if (native.inputType === "deleteContentBackward") {
                      event.preventDefault();
                      backspace();
                    } else if (native.inputType === "deleteContentForward") {
                      event.preventDefault();
                      deleteSelected();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || composing.current)
                      return;
                    if (event.key === "Escape" && fitScreen) {
                      event.preventDefault();
                      exitFocus();
                    } else if (event.key === " ") {
                      event.preventDefault();
                      setBlank(true);
                    } else if (event.key === "Backspace") {
                      event.preventDefault();
                      backspace();
                    } else if (event.key === "Delete") {
                      event.preventDefault();
                      deleteSelected();
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      finishEntry();
                    } else if (
                      [
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(event.key)
                    ) {
                      event.preventDefault();
                      const d = current.current;
                      selectSquare(
                        Math.max(
                          0,
                          Math.min(
                            14,
                            d.row +
                              (event.key === "ArrowDown"
                                ? 1
                                : event.key === "ArrowUp"
                                  ? -1
                                  : 0),
                          ),
                        ),
                        Math.max(
                          0,
                          Math.min(
                            14,
                            d.col +
                              (event.key === "ArrowRight"
                                ? 1
                                : event.key === "ArrowLeft"
                                  ? -1
                                  : 0),
                          ),
                        ),
                      );
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        {focused && lastPlacement && !review && !blank && !inspectCell && (
          <div
            ref={scoreBubble}
            className={`tile-score-bubble ${preview?.ok ? "" : "needs-check"} ${exhaustedTile ? "tile-inventory-bubble" : ""}`}
            aria-label={
              shortageLabel ??
              `${potentialScore ?? "Unknown"} potential points${preview?.ok ? ", valid turn" : ", turn not yet valid"}`
            }
            role="status"
            aria-live="polite"
          >
            {exhaustedTile ? (
              <>
                <strong>{shortageLabel}</strong>
                <div className="tile-inventory-actions">
                  {canUseBlank && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={useBlankForExhaustedTile}
                    >
                      Use a blank
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={finishEntry}
                  >
                    Check tiles
                  </button>
                </div>
              </>
            ) : (
              <>
                <strong>{potentialScore ?? "—"}</strong>
                <span>{preview?.ok ? "pts" : "pts · check"}</span>
              </>
            )}
          </div>
        )}
        {fitScreen ? (
          <footer className="persistent-entry-bar">
            <span
              className="entry-board-status"
              aria-label={
                game.status === "paused"
                  ? "Game paused"
                  : `Round ${Math.floor(game.turns.length / game.order.length) + 1}`
              }
            >
              {game.status === "paused" ? (
                <strong>Paused</strong>
              ) : (
                <>
                  <span>Round</span>
                  <strong>
                    {Math.floor(game.turns.length / game.order.length) + 1}
                  </strong>
                </>
              )}
            </span>
            <button
              className="tabletop-tool entry-direction-toggle"
              disabled={disabled}
              title={`Direction: ${manualDirection ? "chosen" : "auto"} ${draft.direction}. Tap to change.`}
              aria-label={`Word direction: ${manualDirection ? "chosen" : "auto"} ${draft.direction}`}
              onClick={() =>
                direction(
                  !manualDirection
                    ? "across"
                    : draft.direction === "across"
                      ? "down"
                      : "auto",
                )
              }
            >
              <span aria-hidden="true">
                {draft.direction === "down" ? "↓" : "→"}
              </span>
              <small>{manualDirection ? "" : "AUTO"}</small>
            </button>
            <button
              className="tabletop-tool entry-blank-button"
              title="Blank tile"
              aria-label="Choose a blank tile"
              disabled={disabled}
              onClick={() => {
                setBlank(true);
              }}
            >
              <span className="blank-tool-face" aria-hidden="true">
                ?
              </span>
            </button>
            <button
              className="tabletop-tool"
              title="Backspace"
              aria-label="Erase letter"
              disabled={disabled || !draft.placements.length}
              onClick={() => {
                backspace();
                focusInput();
              }}
            >
              <TabletopIcon name="erase" />
            </button>
            {onUndo && (
              <button
                className="tabletop-tool entry-undo-button"
                title={
                  draft.placements.length
                    ? "Finish or clear your letters before undoing the last turn"
                    : "Undo last turn"
                }
                aria-label="Undo last turn"
                disabled={
                  undoDisabled || recording || !!draft.placements.length
                }
                onClick={() => {
                  input.current?.blur();
                  onUndo();
                }}
              >
                <TabletopIcon name="undo" />
              </button>
            )}
            <button
              className="tabletop-tool"
              title="Letter tools"
              aria-label="Open letter tools"
              disabled={recording}
              onClick={() => {
                input.current?.blur();
                setEntryOptions(true);
              }}
            >
              <TabletopIcon name="more" />
            </button>
            <button
              className={`button primary entry-review-button ${preview?.ok ? "" : "needs-check"} ${exhaustedTile ? "inventory-review" : ""}`}
              aria-label={
                shortageLabel ? `${shortageLabel}. Check tiles` : "Review turn"
              }
              disabled={disabled || !draft.placements.length}
              onClick={finishEntry}
            >
              <span className="entry-review-label">
                {exhaustedTile ? "Check tiles" : "Review"}
              </span>
              <span className="entry-docked-score" aria-hidden="true">
                {potentialScore ?? "—"} pts
              </span>{" "}
              <span aria-hidden="true">↵</span>
            </button>
            {message && (
              <div className="entry-message-overlay" role="alert">
                <span>{message}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss entry message"
                  onClick={() => {
                    setMessage(null);
                    focusInput();
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </footer>
        ) : (
          <footer className="entry-footer">
            {message && (
              <div className="entry-validation" role="alert">
                {message}
              </div>
            )}
            {tools}
            {!game.assistance && (
              <form
                className="official-board-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  openOfficial(officialQuery);
                }}
              >
                <label htmlFor={`${titleId}-official`}>
                  Search official site
                </label>
                <input
                  id={`${titleId}-official`}
                  value={officialQuery}
                  onChange={(event) => setOfficialQuery(event.target.value)}
                  placeholder="e.g. ONYX"
                  maxLength={15}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                <button className="button light" type="submit">
                  Search ↗
                </button>
              </form>
            )}
            {focused ? (
              <div className="entry-done-row">
                <span className="muted">Your total follows the last tile.</span>
                <button
                  className="button primary"
                  disabled={disabled || !draft.placements.length}
                  onClick={finishEntry}
                >
                  Done <span className="keycap">Enter ↵</span>
                </button>
              </div>
            ) : (
              <div className="turn-review-bar">
                <div>
                  <span className="eyebrow">
                    {game.status === "finalized"
                      ? "Game complete"
                      : `Round ${Math.floor(game.turns.length / game.order.length) + 1}`}
                  </span>
                  <h2>
                    {game.status === "finalized"
                      ? "The final board"
                      : `${player.name}’s turn`}
                  </h2>
                  <span className="muted">
                    {preview?.ok
                      ? `${preview.words.map((w) => w.word).join(" + ")} · ${preview.newTileCount} new tiles`
                      : game.status === "finalized"
                        ? "All recorded turns are available in the score sheet."
                        : "Your letters are kept until you record the turn."}
                  </span>
                </div>
                {game.status !== "finalized" && (
                  <button
                    className="button primary"
                    disabled={disabled || !draft.placements.length}
                    onClick={finishEntry}
                  >
                    Review {preview?.ok ? `${preview.score} points` : "turn"} →
                  </button>
                )}
              </div>
            )}
          </footer>
        )}
      </dialog>
      {entryOptions && (
        <Modal title="Letter tools" onClose={() => setEntryOptions(false)}>
          {tools}
          <div className="dialog-actions">
            <button
              className="button light"
              onClick={() => {
                setZoom((value) => !value);
                setEntryOptions(false);
              }}
            >
              {zoom ? "Fit board" : "Enlarge board"}
            </button>
            <button
              className="button light"
              onClick={() => {
                setEntryOptions(false);
                openOfficial("");
              }}
            >
              Search official site ↗
            </button>
          </div>
          <p className="muted">
            Tap a square and type. Space chooses a blank; Backspace erases a
            letter; Enter reviews the turn.
          </p>
        </Modal>
      )}
      {blank && (
        <Modal
          title="Which letter is your blank?"
          onClose={() => {
            setBlank(false);
            requestAnimationFrame(focusInput);
          }}
        >
          <p>
            A blank keeps its chosen letter and is always worth zero tile
            points.
          </p>
          <div className="blank-picker">
            {LETTERS.split("").map((letter) => (
              <button
                key={letter}
                onClick={() => {
                  setBlank(false);
                  insert(letter, true);
                  requestAnimationFrame(focusInput);
                }}
                className="letter-tile blank-tile"
              >
                <b>{letter}</b>
                <small>0</small>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {inspectCell && (
        <Modal
          title="Word details"
          className="played-words-modal"
          onClose={() => setInspectCell(null)}
        >
          {inspectedWords.map((word) => (
            <PlayedWordDetails
              key={word.id}
              word={word}
              board={game.board}
              placements={
                game.turns.find((turn) => turn.id === word.turnId)
                  ?.placements ?? []
              }
              playerName={
                game.players.find((p) => p.id === word.playerId)?.name ??
                "Player"
              }
              round={word.round}
              source={word.source}
            />
          ))}
          {!disabled && (
            <div className="dialog-actions">
              <button
                className="button primary"
                onClick={() => {
                  const cell = inspectCell;
                  setInspectCell(null);
                  requestAnimationFrame(() => selectSquare(cell.row, cell.col));
                }}
              >
                Enter letters here
              </button>
            </div>
          )}
        </Modal>
      )}
      {review && preview && !preview.ok && (
        <Modal
          title="Review this turn"
          className="turn-review-modal"
          onClose={returnToLetters}
        >
          <div className="turn-review-content">
            <p>This turn needs a correction before it can be recorded.</p>
            <div
              className={`entry-validation ${inventoryWarning ? "inventory-warning" : ""}`}
              role={inventoryWarning ? "alert" : "status"}
            >
              <span>
                {formedWords.length === 0 &&
                preview &&
                !preview.ok &&
                preview.error.words?.length ? (
                  <strong className="entry-rejected-words">
                    Check the complete word
                    {preview.error.words.length > 1 ? "s" : ""}:{" "}
                    {preview.error.words.join(", ")}
                  </strong>
                ) : null}
                {shortages.length > 0 ? (
                  <>
                    {shortages.map(({ letter, count }) => (
                      <strong className="inventory-shortfall" key={letter}>
                        {letter === "?" ? "Blank" : letter}: this play needs{" "}
                        {count} more physical{" "}
                        {letter === "?" ? "blank" : letter} tile
                        {count === 1 ? "" : "s"} than this set contains.
                      </strong>
                    ))}
                    <small className="inventory-blank-note">
                      If a letter is an actual blank tile, enter it with Blank
                      or Space. A blank uses the blank supply, not the letter it
                      represents.
                    </small>
                  </>
                ) : (
                  validationMessage
                )}
              </span>
              {inventoryWarning && onRequestExtraTiles && (
                <button
                  className="button light"
                  onClick={() => {
                    setReview(false);
                    exitFocus();
                    onRequestExtraTiles(current.current.placements);
                  }}
                >
                  Use anyway…
                </button>
              )}
            </div>
          </div>
          <div className="dialog-actions">
            {canUseBlank && (
              <button
                className="button primary"
                disabled={disabled}
                onClick={useBlankForExhaustedTile}
              >
                Use a blank for {exhaustedTile?.tile.letter}
              </button>
            )}
            <button className="button light" onClick={returnToLetters}>
              Keep editing
            </button>
            {!game.assistance &&
              formedWords.some((word) => word.valid === false) && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    openOfficial(
                      [
                        ...new Set(
                          formedWords
                            .filter((word) => word.valid === false)
                            .map((word) => word.word),
                        ),
                      ].join(", "),
                    )
                  }
                >
                  Check rejected words
                </button>
              )}
          </div>
        </Modal>
      )}
      {review && preview?.ok && (
        <Modal
          title="Review this turn"
          className="turn-review-modal"
          onClose={() => {
            if (!recordingRef.current) returnToLetters();
          }}
        >
          <div className="turn-review-content">
            <p className="muted">
              {player.name} · Checked against {wordReference.shortLabel}
            </p>
            <div className="score-breakdown">
              {preview.words.map((w) => (
                <ReviewWord
                  key={`${w.row}-${w.col}-${w.direction}`}
                  word={w}
                  board={preview.board}
                  placements={preview.placements}
                />
              ))}
              {preview.bingo > 0 && (
                <div>
                  <strong>Seven-tile bonus</strong>
                  <span>+{preview.bingo}</span>
                </div>
              )}
              <div className="total">
                <strong>Turn total</strong>
                <strong>{preview.score}</strong>
              </div>
            </div>
            <p className="review-tile-key">
              Outlined tiles are new. Faded multipliers marked “used” do not
              score again.
            </p>
            {recordError && (
              <p role="alert" className="inline-message">
                This turn could not be saved. Your letters are retained. Keep
                editing to see the recovery message.
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button
              className="button light"
              disabled={recording}
              onClick={returnToLetters}
            >
              Keep editing
            </button>
            <button
              className="button primary"
              disabled={locked || recording}
              onClick={() => void recordTurn()}
            >
              {recording ? "Recording…" : `Record ${preview.score} points`}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
