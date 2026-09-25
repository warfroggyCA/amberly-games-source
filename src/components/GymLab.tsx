"use client";
import { GymMoves } from "./GymMoves";
import type { ScoredMove } from "../domain/solver";
import { WordDirectionMarkers, WordFeedbackHelp } from "./WordDirectionMarkers";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { LETTER_VALUES, premiumAt } from "../domain/board";
import { scoreMedal, scoreStrength } from "../domain/gym/score-strength";
import type { ScoreSummary } from "../domain/gym/analysis";
import {
  clearTiles,
  draftPlacements,
  emptyDraft,
  placeTile,
  returnTile,
  selectSquare,
  shuffledOrder,
  type Draft,
  type Square,
} from "../domain/gym/placement";
import {
  wordCellFeedback,
  type WordFeedback,
} from "../domain/gym/word-feedback";
import type { Puzzle } from "../domain/gym/model";
import type { StrategyCoaching } from "../domain/gym/coaching";
import type { Letter, Placement, MoveResult } from "../domain/types";
import type { LabRequest } from "../lib/gym-lab.worker";
import { Modal } from "./Modal";
import { useGymHistory } from "./useGymHistory";
import { OfficialWordSearch } from "./OfficialWordSearch";
import { gymWordCatalog } from "../lib/gym-word-catalog";
import type { VerifiedWord } from "../domain/verified-words";
import { GymHistory } from "./GymHistory";
import "./gym-lab.css";
import { useGymDraft } from "./useGymDraft";
import { gymDraftKey, type GymDraft } from "../lib/gym-draft";
interface Ready {
  puzzle: Puzzle;
  answer: ScoreSummary;
  elapsedMs: number;
}
interface Grade {
  points: number;
  rank: number | null;
  percentage: number | null;
}
export function GymLab({
  gamesHref = "/gym-lab/games",
  profileHistory = false,
}: {
  gamesHref?: string;
  profileHistory?: boolean;
}) {
  const router = useRouter();
  const [words, setWords] = useState<VerifiedWord[]>([]);
  const [catalog, setCatalog] = useState<VerifiedWord[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [referencePending, setReferencePending] = useState(false);
  const [officialQuery, setOfficialQuery] = useState<string | null>(null);
  const historySync = useGymHistory(
    profileHistory,
    words.map((entry) => entry.word),
  );
  const catalogUserId = historySync.identity?.userId;
  const lookupOwner = useRef(catalogUserId);
  useEffect(() => {
    lookupOwner.current = catalogUserId;
  }, [catalogUserId]);
  useEffect(() => {
    if (profileHistory && !catalogUserId) return;
    let cancelled = false;
    void gymWordCatalog(profileHistory ? catalogUserId : undefined).then(
      (entries) => {
        if (cancelled) return;
        setWords(entries);
        setCatalog(entries);
        setCatalogLoaded(true);
        setCatalogError("");
      },
      (error) => {
        if (!cancelled)
          setCatalogError(
            error instanceof Error
              ? error.message
              : "Word list unavailable. Please retry.",
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [profileHistory, catalogUserId, catalogRetry]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const savedAttempt = useRef<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft([]));
  const currentDraft = useRef(draft);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [strategy, setStrategy] = useState<StrategyCoaching | null>(null);
  const [help, setHelp] = useState(false);
  const [blank, setBlank] = useState<{ id: number; target: Square } | null>(
    null,
  );
  const [reveal, setReveal] = useState(false);
  const [movesOpen, setMovesOpen] = useState(false);
  const [exploredMove, setExploredMove] = useState<ScoredMove | null>(null);
  const [solutionIndex, setSolutionIndex] = useState(0);
  const [dragPreview, setDragPreview] = useState<{
    id: number;
    x: number;
    y: number;
    touch: boolean;
    size: number;
    target: (Square & { blocked: boolean }) | null;
  } | null>(null);
  const rackRef = useRef<HTMLDivElement>(null);
  const validityWorker = useRef<Worker | null>(null);
  const [live, setLive] = useState<{
    key: string;
    result: MoveResult | null;
    tentativeScore?: number;
    words?: WordFeedback[];
  }>({
    key: "",
    result: null,
  });
  const liveKey = JSON.stringify([
    ready?.puzzle.seed,
    words.map((entry) => entry.word),
    referencePending,
    draft.tiles,
  ]);
  const introSeed = [...(ready?.puzzle.seed ?? "")].reduce(
    (hash, ch) => (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0,
    0,
  );
  const wordCells = wordCellFeedback(
    !reveal && live.key === liveKey ? (live.words ?? []) : [],
  );
  const [hint, setHint] = useState(0);
  const [pointToHint, setPointToHint] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const reducedMotionRef = useRef(false);
  const [liveCoaching, setLiveCoaching] = useState(true);
  const [petPaused, setPetPaused] = useState(false);
  const [leavePrompt, setLeavePrompt] = useState(false);
  const history = useRef<Draft[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [undoSnapshots, setUndoSnapshots] = useState<Draft[]>([]);
  const [introduced, setIntroduced] = useState(true);
  const worker = useRef<Worker | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serial = useRef(0);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    time: number;
    pointer: number;
  } | null>(null);
  const suppressClick = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const recoveryKey = profileHistory
    ? historySync.identity
      ? gymDraftKey(historySync.identity)
      : null
    : gymDraftKey();
  const [draftOwner, setDraftOwner] = useState<string | null>(null);
  const recovery = useGymDraft(
    recoveryKey,
    ready && draftOwner === recoveryKey
      ? {
          version: 1,
          puzzle: ready.puzzle,
          draft,
          undo: undoSnapshots,
          referenceWords: words.map((w) => w.word),
          hint,
          pointToHint,
          reveal: reveal && !exploredMove,
          solutionIndex,
          help,
          reducedMotion,
          liveCoaching,
          petPaused,
        }
      : null,
  );
  const restoring = useRef<GymDraft | null>(null);
  function resumePractice() {
    if (!recovery.saved || busy || !catalogLoaded) return;
    const snapshot = recovery.saved;
    const reference = catalog.filter((w) =>
      snapshot.referenceWords.includes(w.word),
    );
    if (reference.length !== snapshot.referenceWords.length) {
      setMessage(
        "The saved word list is unavailable. Retry loading your word list before resuming.",
      );
      return;
    }
    restoring.current = snapshot;
    request({
      type: "restore",
      puzzle: snapshot.puzzle,
      snapshot,
      words: reference,
    });
  }
  function saveDraft(next: Draft) {
    currentDraft.current = next;
    setDraft(next);
    setGrade(null);
    savedAttempt.current = null;
    setStrategy(null);
    setMessage("");
  }
  function rememberDraft(next: Draft) {
    const previous = currentDraft.current;
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      history.current.push(previous);
      setUndoCount(history.current.length);
      setUndoSnapshots(history.current.slice(-100));
    }
  }
  function undoAction() {
    if (busy || !introduced || reveal || blank) return;
    const previous = history.current.pop();
    if (!previous) return;
    setUndoCount(history.current.length);
    setUndoSnapshots(history.current.slice(-100));
    saveDraft(previous);
  }
  function returnAll() {
    if (busy || !introduced || blank) return;
    const next = clearTiles(currentDraft.current);
    rememberDraft(next);
    saveDraft(next);
    setReveal(false);
    setExploredMove(null);
    setMovesOpen(false);
  }
  async function leavePractice() {
    await recovery.flush();
    stop();
    validityWorker.current?.terminate();
    validityWorker.current = null;
    if (timer.current) clearTimeout(timer.current);
    history.current = [];
    setUndoCount(0);
    setUndoSnapshots([]);
    saveDraft(emptyDraft([]));
    setReady(null);
    setReveal(false);
    setExploredMove(null);
    setMovesOpen(false);

    setHint(0);
    setPointToHint(false);
    setBlank(null);
    setDragPreview(null);
    gesture.current = null;
    setIntroduced(true);
    setLeavePrompt(false);
    router.push(gamesHref);
  }
  function edit(operation: (value: Draft) => Draft, remember = true) {
    if (busy || !introduced || reveal) return;
    try {
      const next = operation(currentDraft.current);
      if (next.tiles.length && liveCoaching)
        historySync.record({ type: "live-coaching" });
      if (remember) rememberDraft(next);
      saveDraft(next);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "The tile could not be placed.",
      );
    }
  }
  function stop() {
    worker.current?.terminate();
    worker.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    serial.current++;
    setBusy(null);
  }
  useEffect(
    () => () => {
      worker.current?.terminate();
      validityWorker.current?.terminate();
      if (timeout.current) clearTimeout(timeout.current);
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!ready || !draft.tiles.length || referencePending) return;
    let cancelled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const key = liveKey;
    const id = Math.random();
    const timer = setTimeout(() => {
      try {
        const instance =
          validityWorker.current ??
          new Worker(
            new URL("../lib/gym-validity.worker.ts", import.meta.url),
            { type: "module" },
          );
        validityWorker.current = instance;
        const unavailable = () => {
          if (cancelled) return;
          instance.terminate();
          validityWorker.current = null;
          setLive({ key, result: null });
        };
        deadline = setTimeout(unavailable, 8000);
        instance.onerror = unavailable;
        instance.onmessage = ({ data }) => {
          if (cancelled || data.id !== id) return;
          clearTimeout(deadline);
          setLive({
            key,
            result: data.result,
            tentativeScore: data.tentativeScore,
            words: data.words,
          });
        };
        instance.postMessage({
          id,
          position: ready.puzzle.position,
          words,
          placements: draft.tiles.map(({ row, col, tile }) => ({
            row,
            col,
            tile,
          })),
        });
      } catch {
        if (!cancelled) setLive({ key, result: null });
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(deadline);
    };
  }, [ready, draft.tiles, words, referencePending, liveKey]);

  function shuffleRack() {
    if (busy || !introduced || reveal || blank) return;
    const nodes = [
      ...(rackRef.current?.querySelectorAll<HTMLElement>("[data-rack-id]") ??
        []),
    ];
    for (const node of nodes)
      for (const animation of node.getAnimations()) animation.cancel();
    const positions = new Map(
      nodes.map((node) => [node.dataset.rackId, node.getBoundingClientRect()]),
    );
    // Reordering is presentation only: preserve the move, its grade and live validity.
    const next = {
      ...currentDraft.current,
      order: shuffledOrder(currentDraft.current.order),
    };
    rememberDraft(next);
    currentDraft.current = next;
    setDraft(next);
    requestAnimationFrame(() => {
      if (reducedMotionRef.current) return;
      for (const node of nodes) {
        const before = positions.get(node.dataset.rackId);
        const after = node.getBoundingClientRect();
        if (before)
          node.animate(
            [
              {
                transform: `translate(${before.x - after.x}px, ${before.y - after.y}px)`,
              },
              {
                transform: `translate(${(before.x - after.x) * 0.8}px, -20px) rotateX(-12deg) rotateZ(-3deg) scale(1.06)`,
                boxShadow: "0 14px 12px #0005, 0 4px 0 #382013",
                offset: 0.25,
              },
              {
                transform:
                  "translate(0, -20px) rotateX(-12deg) rotateZ(3deg) scale(1.06)",
                boxShadow: "0 14px 12px #0005, 0 4px 0 #382013",
                offset: 0.7,
              },
              { transform: "translate(0, 2px)", offset: 0.9 },
              { transform: "none" },
            ],
            { duration: 650, easing: "ease-in-out" },
          );
      }
    });
  }

  function request(
    input:
      | Omit<Extract<LabRequest, { type: "generate" }>, "id">
      | Omit<Extract<LabRequest, { type: "refresh" }>, "id">
      | Omit<Extract<LabRequest, { type: "restore" }>, "id">
      | Omit<Extract<LabRequest, { type: "check" | "strategy" }>, "id">,
  ) {
    if (
      worker.current ||
      (referencePending &&
        (input.type === "check" || input.type === "strategy"))
    )
      return;
    if (input.type === "check") {
      if (liveCoaching) historySync.record({ type: "live-coaching" });
      savedAttempt.current = historySync.record({
        type: "attempt",
        action: input.action,
      });
    } else if (input.type === "strategy")
      historySync.record({ type: "strategy-request" });
    const attemptId = savedAttempt.current;
    const id = ++serial.current;
    setBusy(
      input.type === "generate"
        ? "Preparing a fresh board…"
        : input.type === "refresh"
          ? "Refreshing scores and hints…"
          : input.type === "check"
            ? "Checking your move…"
            : "Thinking…",
    );
    setMessage("");
    const failureMessage = (text: string) =>
      input.type === "strategy"
        ? "Strategy comparison unavailable: the analysis could not finish within its limits. Your exact score and tiles are unchanged. You can keep practising."
        : text;
    const fail = (text: string) => {
      if (id !== serial.current) return;
      stop();
      setMessage(failureMessage(text));
    };
    try {
      const instance = new Worker(
        new URL("../lib/gym-lab.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = instance;
      timeout.current = setTimeout(
        () =>
          fail(
            "Analysis reached its time limit. Your current board and tiles have been kept.",
          ),
        18_000,
      );
      instance.onerror = () =>
        fail(
          "The analysis worker could not run. Your current board and tiles have been kept.",
        );
      instance.onmessage = ({ data }) => {
        if (id !== serial.current || data.id !== id) return;
        if (data.type === "progress") {
          setBusy("Thinking…");
          return;
        }
        stop();
        if (data.type === "error") {
          setMessage(failureMessage(data.message));
          return;
        }
        if (data.type === "restore") {
          const snapshot = restoring.current;
          if (!snapshot) return;
          restoring.current = null;
          setDraftOwner(recoveryKey);
          setWords(input.words ?? words);
          setReferencePending(false);
          setMovesOpen(false);
          setExploredMove(null);
          setReady({
            puzzle: snapshot.puzzle,
            answer: data.answer,
            elapsedMs: 0,
          });
          saveDraft(snapshot.draft);
          history.current = snapshot.undo;
          setUndoCount(snapshot.undo.length);
          setUndoSnapshots(snapshot.undo);
          setHint(snapshot.hint);
          setPointToHint(snapshot.pointToHint);
          setReveal(snapshot.reveal);
          setSolutionIndex(snapshot.solutionIndex);
          setHelp(snapshot.help);
          setReducedMotion(snapshot.reducedMotion);
          reducedMotionRef.current = snapshot.reducedMotion;
          setLiveCoaching(snapshot.liveCoaching);
          setPetPaused(snapshot.petPaused);
          setIntroduced(true);
          setStrategy(null);
          historySync.start(snapshot.puzzle);
          historySync.record({ type: "resume" });
          setMessage(
            "Practice restored. Your tiles and help state are kept; analysis has been refreshed.",
          );
        } else if (data.type === "generate") {
          setDraftOwner(recoveryKey);
          setWords(input.words ?? words);
          setReferencePending(false);
          const next = data as Ready;
          setReady(next);
          historySync.start(next.puzzle);
          history.current = [];
          setUndoCount(0);
          setUndoSnapshots([]);
          saveDraft(emptyDraft(next.puzzle.position.rack));
          setReveal(false);
          setExploredMove(null);
          setMovesOpen(false);

          setSolutionIndex(0);
          setDragPreview(null);
          setHint(0);
          setPointToHint(false);
          setStrategy(null);
          const reduce = reducedMotionRef.current;
          setIntroduced(reduce);
          if (timer.current) clearTimeout(timer.current);
          if (!reduce)
            timer.current = setTimeout(() => setIntroduced(true), 1600);
        } else if (data.type === "refresh") {
          setDraftOwner(recoveryKey);
          setWords(input.words ?? words);
          setReady((prior) =>
            prior ? { ...prior, answer: data.answer } : prior,
          );
          setReferencePending(false);
          setMovesOpen(false);
          setExploredMove(null);
          setMessage(
            "Word list updated. Scores, hints and solutions have been refreshed; your tiles are kept.",
          );
        } else if (data.type === "check") {
          setGrade(data.grade);
          if (attemptId)
            historySync.record({ type: "score", attemptId, ...data.grade });
          setMessage("Your move is legal.");
        } else if (data.type === "strategy") {
          setStrategy(data.strategy);
          if (attemptId) {
            const result = data.strategy as StrategyCoaching;
            historySync.record({
              type: "strategy",
              attemptId,
              policy: result.policy,
              verdict: result.verdict,
              requested: result.requested.label,
              recommended: result.recommended.label,
              replyPoints: result.requested.replyPoints,
              alternativeReplyPoints: result.recommended.replyPoints,
              gap: result.gap,
              samples: result.completedSamples,
            });
          }
          setMessage(
            "Strategy comparison ready. These are short-horizon estimates, not winning odds.",
          );
        }
      };
      instance.postMessage({ words, ...input, id });
    } catch {
      fail("This browser could not start the analysis worker. Please retry.");
    }
  }
  function generate() {
    if (busy || !catalogLoaded) return;
    const seed = [...crypto.getRandomValues(new Uint32Array(4))]
      .map((n) => n.toString(16).padStart(8, "0"))
      .join("");
    request({ type: "generate", seed, words: catalog });
  }
  async function saveLookup(entries: VerifiedWord[]) {
    const owner = lookupOwner.current;
    if (profileHistory && !owner)
      throw new Error("Reconnect your profile before saving words.");
    const saved = await gymWordCatalog(
      profileHistory ? owner : undefined,
      entries,
    );
    if (profileHistory && lookupOwner.current !== owner)
      throw new Error("Your account changed. Reload before continuing.");
    setCatalog(saved);
    if (
      JSON.stringify(saved.map((entry) => entry.word).sort()) !==
      JSON.stringify(words.map((entry) => entry.word).sort())
    ) {
      setGrade(null);
      savedAttempt.current = null;
      setStrategy(null);
      setReveal(false);
      setExploredMove(null);
      setMovesOpen(false);
      setHint(0);
      setPointToHint(false);
      setSolutionIndex(0);
      if (ready) {
        setReferencePending(true);
        request({ type: "refresh", puzzle: ready.puzzle, words: saved });
      } else setWords(saved);
    }
    return true;
  }
  function put(id: number, target = currentDraft.current.cursor) {
    if (!ready || busy || reveal || !introduced) return;
    if (
      ready.puzzle.position.rack[id] === "?" &&
      !currentDraft.current.tiles.some((t) => t.id === id)
    ) {
      if (!target) {
        setMessage("Tap a starting square first.");
        return;
      }
      setBlank({ id, target });
      return;
    }
    edit((d) =>
      placeTile(
        d,
        ready.puzzle.position.board,
        ready.puzzle.position.rack,
        id,
        undefined,
        target,
      ),
    );
  }
  function dragTarget(x: number, y: number) {
    return document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-gym-square]");
  }
  function gestureStart(event: PointerEvent<HTMLButtonElement>, id: number) {
    if (busy || reveal || !introduced) return;
    if (
      gesture.current ||
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    suppressClick.current = null;
    setDragPreview({
      id,
      target: null,
      x: event.clientX,
      y: event.clientY,
      touch: event.pointerType !== "mouse",
      size: Math.max(
        64,
        event.currentTarget.getBoundingClientRect().width * 1.15,
      ),
    });
    gesture.current = {
      id,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      pointer: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function gestureMove(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    if (!start || start.pointer !== event.pointerId) return;
    const square = dragTarget(event.clientX, event.clientY);
    const row = Number(square?.dataset.row),
      col = Number(square?.dataset.col);
    const target =
      square &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 12
        ? {
            row,
            col,
            blocked:
              !!ready?.puzzle.position.board[row][col] ||
              currentDraft.current.tiles.some(
                (t) => t.id !== start.id && t.row === row && t.col === col,
              ),
          }
        : null;
    setDragPreview((previous) =>
      previous
        ? { ...previous, x: event.clientX, y: event.clientY, target }
        : null,
    );
  }
  function gestureCancel() {
    if (gesture.current) suppressClick.current = gesture.current.id;
    gesture.current = null;
    setDragPreview(null);
  }
  function gestureEnd(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    if (!start || start.pointer !== event.pointerId) return;
    gesture.current = null;
    setDragPreview(null);
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < 12) return; // Native click handles a tap and keyboard activation.
    suppressClick.current = start.id;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const target = dragTarget(event.clientX, event.clientY);
    const fromBoard = currentDraft.current.tiles.some((t) => t.id === start.id);
    // A placed tile can be pulled off the board, including anywhere on the rack.
    // Only rack-origin gestures use the quick upward flick-to-cursor shortcut.
    if (fromBoard && !hit?.closest(".gym-board")) {
      edit((d) => returnTile(d, start.id));
      return;
    }
    if (
      !fromBoard &&
      dy < -24 &&
      Math.hypot(dx, dy) < 120 &&
      event.timeStamp - start.time < 300 &&
      !target
    ) {
      put(start.id);
      return;
    }
    if (target) {
      put(start.id, {
        row: Number(target.dataset.row),
        col: Number(target.dataset.col),
      });
      return;
    }
    if (
      currentDraft.current.tiles.some((t) => t.id === start.id) &&
      document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("[data-gym-rack]")
    )
      edit((d) => returnTile(d, start.id));
    else
      setMessage(
        "Tile kept in place. Tap it to use the highlighted square, or drag it onto an empty square.",
      );
  }
  const placed = ready ? draftPlacements(draft) : [];
  const placementInvalid =
    !reveal &&
    live.key === liveKey &&
    live.result &&
    !live.result.ok &&
    [
      "NOT_IN_LINE",
      "GAP",
      "DISCONNECTED",
      "CENTRE_REQUIRED",
      "OPENING_TOO_SHORT",
      "NO_WORD",
    ].includes(live.result.error.code);
  const strength =
    ready &&
    liveCoaching &&
    !reveal &&
    placed.length &&
    live.key === liveKey &&
    live.result?.ok
      ? scoreStrength(live.result.score, ready.answer)
      : null;
  const strengthBars = strength ? (
    <span className="gym-strength-bars" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <i
          key={n}
          className={n <= strength.bars ? "is-lit" : ""}
          style={{ height: 3 + n * 3 }}
        />
      ))}
    </span>
  ) : null;
  const best = ready?.answer.best[0];
  const solution = exploredMove ?? ready?.answer.best[solutionIndex] ?? best;
  const medal =
    reveal && solution && ready
      ? scoreMedal(solution.score, ready.answer)
      : strength?.medal;
  const solutionTone = exploredMove
    ? medal === "gold"
      ? 0
      : medal === "silver"
        ? 1
        : medal === "bronze"
          ? 2
          : "other"
    : solutionIndex;
  const overlay: Placement[] = reveal ? (solution?.placements ?? []) : placed;
  // Keep the nearby badge beyond the horizontal word, not on top of its letters.
  const lastPlaced = placed.at(-1);
  let scoreLocation = lastPlaced
    ? { row: lastPlaced.row, col: lastPlaced.col }
    : null;
  let scoreOnLeft = false;
  if (scoreLocation && ready) {
    const row = scoreLocation.row;
    const occupied = (col: number) =>
      ready.puzzle.position.board[row]?.[col] ||
      placed.some((p) => p.row === row && p.col === col);
    let right = scoreLocation.col;
    while (right < 14 && occupied(right + 1)) right++;
    if (right <= 10) scoreLocation = { row, col: right };
    else {
      let left = scoreLocation.col;
      while (left > 0 && occupied(left - 1)) left--;
      scoreOnLeft = left >= 3;
      scoreLocation = { row, col: scoreOnLeft ? left : right };
    }
  }

  const dragTile =
    dragPreview && ready
      ? (draft.tiles.find((t) => t.id === dragPreview.id)?.tile ?? {
          letter: ready.puzzle.position.rack[dragPreview.id],
          blank: ready.puzzle.position.rack[dragPreview.id] === "?",
        })
      : null;
  const hintSquare = best?.placements[0];
  const hintCoordinate = hintSquare
    ? `${String.fromCharCode(65 + hintSquare.col)}${hintSquare.row + 1}`
    : "";
  const hints = best
    ? [
        best.words.length > 1
          ? "Try making more than one word in the same move."
          : best.placements.some((p) => premiumAt(p.row, p.col))
            ? "Look for a move that reaches a premium square."
            : "Look for a way to build on the letters already on the board.",
        `One highest-scoring move uses ${best.newTileCount} rack tiles.`,
        `One highest-scoring move places a tile at ${hintCoordinate}.`,
      ]
    : [];
  const controlsDisabled = !!busy || !introduced || reveal || !!blank;
  return (
    <div className="app-shell gym-shell">
      <main
        className={`gym-lab${ready ? " gym-active" : ""}${reducedMotion ? " gym-reduced-motion" : ""}`}
      >
        <header className="gym-heading">
          <div>
            <p className="gym-eyebrow">AMBERLY · PRACTICE & TRAINING</p>
            <h1>Scrabble Gym</h1>
          </div>
          <div className="gym-header-actions">
            {!ready && (
              <Link className="button light" href={gamesHref}>
                Back to Games
              </Link>
            )}
            <button
              className="button light"
              onClick={() => setSettingsOpen(true)}
            >
              Settings
            </button>
            {ready && (
              <button
                className="button light"
                onClick={() => {
                  if (draft.tiles.length || grade || hint || reveal)
                    setLeavePrompt(true);
                  else leavePractice();
                }}
              >
                Back to Games
              </button>
            )}
            <button className="button light" onClick={() => setHelp(true)}>
              How to play
            </button>
          </div>
        </header>
        {profileHistory ? (
          <div className="gym-profile-status">
            <p role="status">{historySync.status}</p>
            <button
              className="text-button"
              onClick={() => {
                setHistoryOpen(true);
                void historySync.history();
              }}
              disabled={!historySync.identity}
            >
              My practice history
            </button>
            <button
              className="text-button"
              onClick={historySync.retry}
              disabled={!historySync.identity}
            >
              Retry sync
            </button>
          </div>
        ) : (
          <p className="gym-preview-note">
            Local preview · Draft recovery stays on this device; profile history
            is unavailable.
            {!ready && " Strategy coaching uses short-horizon estimates."}
          </p>
        )}

        <p className="gym-preview-note" role="status">
          {recovery.status}
        </p>
        {catalogError && (
          <p role="alert">
            {catalogError}{" "}
            <button
              className="text-button"
              onClick={() => setCatalogRetry((n) => n + 1)}
            >
              Retry word list
            </button>
          </p>
        )}
        {!catalogLoaded && !catalogError && (
          <p role="status">Loading word list…</p>
        )}
        {referencePending && !busy && (
          <p role="alert">
            Your additions are saved, but scores and hints need refreshing.{" "}
            <button
              className="button light"
              onClick={() =>
                ready &&
                request({
                  type: "refresh",
                  puzzle: ready.puzzle,
                  words: catalog,
                })
              }
            >
              Retry word list
            </button>
          </p>
        )}
        {!ready ? (
          <section className="gym-welcome">
            <div className="gym-welcome-copy">
              <h2>A fresh board. A better next move.</h2>
              <p>
                Practise on a randomly generated position. Find your word,
                compare its score, and explore what you missed.
              </p>
              <p>
                One practice mode for points and strategy. Get exact score
                feedback as you learn; optional strategy coaching compares
                likely replies and the tiles you keep.
              </p>
              <p>Two players · Untimed · Seven tiles</p>
              {recovery.saved && (
                <button
                  className="button primary"
                  disabled={!!busy || !catalogLoaded}
                  onClick={resumePractice}
                >
                  Resume practice
                </button>
              )}
              <button
                className={
                  recovery.saved
                    ? "button light gym-new-practice"
                    : "button primary"
                }
                disabled={
                  !!busy ||
                  !catalogLoaded ||
                  !recovery.loaded ||
                  (profileHistory && !historySync.identity)
                }
                onClick={generate}
              >
                {recovery.saved ? "Start new practice" : "Start practice"}
              </button>
            </div>
            <Image
              className="gym-mascot"
              src={
                reducedMotion || petPaused
                  ? "/gym/scarlett-lift-still.png"
                  : "/gym/scarlett-lift.webp"
              }
              unoptimized
              alt="A cheerful dog lifting weights made from Scrabble letter tiles"
              width={640}
              height={640}
              sizes="(max-width: 650px) 75vw, 420px"
              preload
            />
          </section>
        ) : (
          <>
            <div className="gym-context">
              <span>
                You <strong>{ready.puzzle.position.scores[0]}</strong>
              </span>
              <span>
                Opponent <strong>{ready.puzzle.position.scores[1]}</strong>
              </span>
              <span>{ready.puzzle.position.bagCount} in the bag</span>
              <span>Your turn</span>
            </div>
            <div className="gym-workspace">
              <section
                className="gym-playing"
                aria-label="Practice board and rack"
              >
                <div className="gym-seat">
                  Opponent · {ready.puzzle.position.opponentCount} tiles
                </div>
                <div className="gym-board-scroll">
                  <div
                    key={ready.puzzle.seed}
                    className={`gym-board${introduced ? "" : " gym-intro"}`}
                    ref={boardRef}
                    role="group"
                    aria-label="Scrabble practice board"
                  >
                    {ready.puzzle.position.board.flatMap((row, r) =>
                      row.map((fixed, c) => {
                        const moving = overlay.find(
                          (t) => t.row === r && t.col === c,
                        );
                        const tile = moving?.tile ?? fixed;
                        const selected =
                          draft.cursor?.row === r &&
                          draft.cursor.col === c &&
                          !reveal;
                        const hinted =
                          pointToHint &&
                          !reveal &&
                          hintSquare?.row === r &&
                          hintSquare.col === c;
                        const premium = premiumAt(r, c);
                        const draftTile = draft.tiles.find(
                          (t) => t.row === r && t.col === c,
                        );
                        const draggingSource =
                          draftTile?.id === dragPreview?.id && !!dragPreview;
                        const scoreAnchor =
                          !reveal &&
                          !dragPreview &&
                          scoreLocation?.row === r &&
                          scoreLocation?.col === c;
                        const setup = ready.puzzle.setup.findIndex(
                          (t) =>
                            t.action.type === "play" &&
                            t.action.placements.some(
                              (p) => p.row === r && p.col === c,
                            ),
                        );
                        const landing =
                          dragPreview?.target?.row === r &&
                          dragPreview.target.col === c
                            ? dragPreview.target
                            : null;
                        const wordFeedback = wordCells[`${r},${c}`];
                        // Stable per-puzzle scatter: re-renders never change a tile in flight.
                        const scatter = (r * 37 + c * 71 + introSeed) >>> 0;
                        const seat =
                          setup < 0 ? 0 : ready.puzzle.setup[setup].seat;
                        return (
                          <button
                            key={`${r}-${c}`}
                            type="button"
                            data-gym-square
                            data-drop-preview={
                              landing
                                ? landing.blocked
                                  ? "blocked"
                                  : "ready"
                                : undefined
                            }
                            data-row={r}
                            data-col={c}
                            className={`gym-square ${tile && introduced && !draggingSource ? "has-tile" : ""} ${draggingSource ? "is-drag-source" : ""} ${draftTile && placementInvalid && !draggingSource ? "is-placement-error" : ""} ${moving ? `is-draft${medal ? ` medal-${medal}` : ""}${reveal ? ` is-solution solution-${solutionTone}` : ""}` : ""} ${selected ? "is-cursor" : ""} ${hinted ? "is-hint-target" : ""} premium-${premium ?? "plain"}`}
                            style={
                              {
                                "--intro-delay": `${scatter % 480}ms`,
                                "--launch-x": `${(scatter % 61) - 30}vw`,
                                "--launch-turn": `${(scatter % 121) - 60}deg`,
                                "--drift-x": `${(scatter % 51) - 25}px`,
                                "--launch-y": seat === 0 ? "50vh" : "-50vh",
                              } as CSSProperties
                            }
                            aria-label={`${String.fromCharCode(65 + c)}${r + 1}${tile ? `: ${tile.letter}${tile.blank ? " blank" : ""}` : ` empty${premium ? `, ${premium}` : ""}`}${selected ? `, next tile ${draft.direction}` : ""}${hinted ? ", hint target" : ""}${moving && medal ? `, ${medal} score tier` : ""}${wordFeedback ? `, ${wordFeedback.label}` : ""}`}
                            aria-pressed={selected}
                            disabled={!!busy || !introduced || !!blank}
                            onClick={() => {
                              if (
                                draftTile &&
                                suppressClick.current === draftTile.id
                              ) {
                                suppressClick.current = null;
                                return;
                              }
                              if (draftTile) {
                                edit((d) => returnTile(d, draftTile.id));
                                return;
                              }
                              edit(
                                (d) =>
                                  selectSquare(d, ready.puzzle.position.board, {
                                    row: r,
                                    col: c,
                                  }),
                                false,
                              );
                            }}
                            onPointerDown={(e) => {
                              if (draftTile) gestureStart(e, draftTile.id);
                            }}
                            onPointerMove={gestureMove}
                            onPointerUp={gestureEnd}
                            onPointerCancel={gestureCancel}
                            onLostPointerCapture={gestureCancel}
                          >
                            {hinted && (
                              <span
                                className="gym-hint-pointer"
                                aria-hidden="true"
                              >
                                ↓
                              </span>
                            )}
                            <span
                              className="gym-square-mark"
                              aria-hidden="true"
                            >
                              {premium ?? (r === 7 && c === 7 ? "★" : "")}
                            </span>
                            {scoreAnchor && (
                              <span
                                className={`gym-move-badge ${live.key !== liveKey || !live.result ? "is-pending" : live.result.ok ? "is-valid" : "is-invalid"} ${scoreOnLeft ? "align-left" : ""}`}
                                aria-hidden="true"
                              >
                                {live.key !== liveKey
                                  ? "…"
                                  : !live.result
                                    ? "?"
                                    : live.result.ok
                                      ? `✓ ${live.result.score}`
                                      : placementInvalid
                                        ? "× Invalid placement"
                                        : live.tentativeScore !== undefined
                                          ? `× ${live.tentativeScore} invalid`
                                          : "× invalid"}
                                {strengthBars}
                                {strength?.medal && (
                                  <span
                                    className="gym-medal-badge"
                                    title={`${strength.medal} score tier`}
                                  >
                                    {
                                      {
                                        gold: "🥇",
                                        silver: "🥈",
                                        bronze: "🥉",
                                      }[strength.medal]
                                    }
                                  </span>
                                )}
                                {strength?.best && (
                                  <span
                                    key={liveKey}
                                    className="gym-best-star"
                                    aria-label="Maximum score"
                                  >
                                    ★<span className="gym-best-sparkle">✦</span>
                                  </span>
                                )}
                              </span>
                            )}
                            {moving && medal && !draggingSource && (
                              <span
                                key={`${liveKey}:${medal}:${reveal}`}
                                className="gym-medal-shimmer"
                                aria-hidden="true"
                              />
                            )}
                            {tile ? (
                              <span
                                className={`gym-tile${wordFeedback ? ` word-${wordFeedback.state} valid-${wordFeedback.validDirection ?? "across"}` : ""}`}
                                title={wordFeedback?.label}
                              >
                                <WordDirectionMarkers feedback={wordFeedback} />
                                <b>{tile.letter}</b>
                                <small>
                                  {tile.blank ? 0 : LETTER_VALUES[tile.letter]}
                                </small>
                              </span>
                            ) : selected ? (
                              <span
                                className="gym-cursor-arrow"
                                aria-hidden="true"
                              >
                                {draft.direction === "across" ? "→" : "↓"}
                              </span>
                            ) : null}
                          </button>
                        );
                      }),
                    )}
                  </div>
                </div>
                {!introduced && (
                  <button
                    className="button light gym-skip-intro"
                    onClick={() => {
                      if (timer.current) clearTimeout(timer.current);
                      setIntroduced(true);
                    }}
                  >
                    Skip animation
                  </button>
                )}
                <div className="gym-direction">
                  <span>
                    {draft.cursor
                      ? `Next: ${String.fromCharCode(65 + draft.cursor.col)}${draft.cursor.row + 1}`
                      : "Tap an empty starting square"}
                  </span>
                  {draft.cursor && (
                    <button
                      className="text-button"
                      disabled={controlsDisabled}
                      onClick={() =>
                        edit((d) => ({
                          ...d,
                          manualDirection: true,
                          direction:
                            d.direction === "across" ? "down" : "across",
                        }))
                      }
                    >
                      {draft.direction === "across" ? "→ Across" : "↓ Down"}
                    </button>
                  )}
                </div>
                <div
                  className="gym-rack"
                  ref={rackRef}
                  data-gym-rack
                  aria-label="Your rack"
                >
                  {draft.order.map((id) => {
                    const tile = ready.puzzle.position.rack[id];
                    const used = draft.tiles.some((t) => t.id === id);
                    return (
                      <button
                        key={id}
                        type="button"
                        data-rack-id={id}
                        className={`gym-rack-tile${used ? " is-used" : ""}${dragPreview?.id === id ? " is-drag-source" : ""}`}
                        disabled={controlsDisabled || used}
                        aria-label={`Rack tile ${id + 1}: ${tile === "?" ? "blank" : tile}${used ? ", placed" : ""}`}
                        onClick={() => {
                          if (suppressClick.current === id) {
                            suppressClick.current = null;
                            return;
                          }
                          put(id);
                        }}
                        onPointerDown={(e) => gestureStart(e, id)}
                        onPointerMove={gestureMove}
                        onPointerUp={gestureEnd}
                        onPointerCancel={gestureCancel}
                        onLostPointerCapture={gestureCancel}
                      >
                        <b>{used ? "" : tile === "?" ? "" : tile}</b>
                        {!used && (
                          <small>
                            {tile === "?" ? 0 : LETTER_VALUES[tile]}
                          </small>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="gym-controls">
                  <div
                    className="gym-edit-controls"
                    role="group"
                    aria-label="Rack controls"
                  >
                    <button
                      className="button light"
                      disabled={controlsDisabled || undoCount === 0}
                      aria-label="Undo"
                      title="Undo last action"
                      onClick={undoAction}
                    >
                      <span aria-hidden="true">↶</span>
                    </button>
                    <button
                      className="button light"
                      disabled={
                        !!busy ||
                        !introduced ||
                        !!blank ||
                        (!reveal && !draft.tiles.length && !draft.cursor)
                      }
                      aria-label="Return all"
                      title="Return all tiles to rack"
                      onClick={returnAll}
                    >
                      <span aria-hidden="true">⇊</span>
                    </button>
                    <button
                      className="button light"
                      disabled={controlsDisabled}
                      aria-label="Shuffle rack"
                      title="Shuffle rack"
                      onClick={shuffleRack}
                    >
                      <svg
                        aria-hidden="true"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 6h3c4 0 8 12 12 12h3M17 14l4 4-4 4M3 18h3c4 0 8-12 12-12h3M17 2l4 4-4 4" />
                      </svg>
                    </button>
                  </div>
                  <div className="gym-play-controls">
                    <button
                      className="button primary"
                      disabled={
                        controlsDisabled ||
                        referencePending ||
                        !draft.tiles.length
                      }
                      onClick={() =>
                        request({
                          type: "check",
                          puzzle: ready.puzzle,
                          action: { type: "play", placements: placed },
                        })
                      }
                    >
                      Check move
                    </button>
                    <button
                      className="button light"
                      disabled={
                        !!busy ||
                        referencePending ||
                        !introduced ||
                        reveal ||
                        hint === 3
                      }
                      onClick={() => {
                        historySync.record({
                          type: "hint",
                          level: Math.min(hint + 1, 3),
                        });
                        setHint((n) => Math.min(n + 1, 3));
                      }}
                    >
                      Hint{hint ? ` ${hint}/3` : ""}
                    </button>
                    <button
                      className="button light"
                      disabled={!!busy || referencePending || !introduced}
                      onClick={() => {
                        setMovesOpen(false);
                        setExploredMove(null);
                        if (!reveal) historySync.record({ type: "solve" });
                        setReveal(!reveal);

                        setSolutionIndex(0);
                        setHint(3);
                      }}
                    >
                      {reveal ? "My move" : "Solve"}
                    </button>
                    <button
                      className="button light"
                      disabled={
                        !!busy ||
                        referencePending ||
                        !introduced ||
                        !!blank ||
                        movesOpen
                      }
                      onClick={() => {
                        historySync.record({ type: "all-moves" });
                        setMovesOpen(true);
                      }}
                    >
                      All moves
                    </button>
                    <button
                      className="button light"
                      disabled={
                        !!busy || !introduced || !!blank || !catalogLoaded
                      }
                      onClick={() => {
                        historySync.record({ type: "word-lookup" });
                        setOfficialQuery(
                          (live.key === liveKey ? (live.words ?? []) : [])
                            .filter((word) => !word.valid)
                            .map((word) => word.word)
                            .join(", "),
                        );
                      }}
                    >
                      Word lookup
                    </button>
                  </div>
                </div>
              </section>
              <aside className="gym-feedback" aria-label="Practice feedback">
                {movesOpen && (
                  <GymMoves
                    puzzle={ready.puzzle}
                    words={words}
                    onPreview={(move) => {
                      setExploredMove(move);
                      setReveal(true);
                      setStrategy(null);
                      requestAnimationFrame(() =>
                        boardRef.current?.scrollIntoView({
                          block: "nearest",
                          behavior: reducedMotion ? "auto" : "smooth",
                        }),
                      );
                    }}
                    onClose={() => {
                      setReveal(false);
                      setExploredMove(null);
                      setMovesOpen(false);
                    }}
                    onStrategy={() =>
                      historySync.record({ type: "strategy-request" })
                    }
                  />
                )}
                <div
                  className={`gym-companion${petPaused ? " is-paused" : ""}`}
                  aria-label="Scarlett, your practice companion"
                >
                  <Image
                    className="gym-companion-image"
                    src={
                      reducedMotion || petPaused
                        ? "/gym/scarlett-lift-still.png"
                        : "/gym/scarlett-lift.webp"
                    }
                    unoptimized
                    alt="Scarlett watching your practice"
                    width={640}
                    height={640}
                    sizes="96px"
                  />
                  <h2>
                    {exploredMove
                      ? "Selected placement"
                      : reveal
                        ? solutionIndex === 0
                          ? "Highest-scoring placement"
                          : "Alternative scoring placement"
                        : grade
                          ? "Your move"
                          : "Find your next move"}
                  </h2>
                </div>
                {reveal && (
                  <p className="gym-solve-lock" role="status">
                    Viewing a solution · Choose My move to resume placing tiles,
                    or ⇊ Return all to clear your entry.
                  </p>
                )}
                {!grade && !reveal && (
                  <p>
                    Tap a start square, then tap or flick your rack tiles. You
                    can also drag tiles onto the board. Tap the start again to
                    switch direction.
                  </p>
                )}
                {grade && !reveal && (
                  <p className="gym-score">
                    <strong>{grade.points}</strong> points
                    <br />
                    <span>
                      {grade.rank === 1
                        ? "Maximum score"
                        : `Score rank #${grade.rank}`}
                      {grade.percentage !== null
                        ? ` · ${Math.round(grade.percentage)}% of maximum`
                        : ""}
                    </span>
                  </p>
                )}
                {grade && !reveal && (
                  <div className="gym-score-comparison">
                    <label htmlFor="gym-score-meter">
                      Your score compared with the maximum
                    </label>
                    <meter
                      id="gym-score-meter"
                      min={0}
                      max={ready.answer.maximum}
                      value={grade.points}
                      aria-valuetext={`${grade.points} out of ${ready.answer.maximum} points`}
                    />
                    <span>
                      {grade.points} / {ready.answer.maximum} points
                    </span>
                  </div>
                )}
                {!!placed.length && !reveal && (
                  <p
                    className={`gym-live-validity${placementInvalid ? " is-placement-error" : ""}`}
                    role="status"
                  >
                    {live.key !== liveKey
                      ? "Checking word validity…"
                      : !live.result
                        ? "Live validation unavailable. Use Check move to retry."
                        : live.result.ok
                          ? `Valid move: ${live.result.words.map((word) => word.word).join(" + ")} — ${live.result.score} points.`
                          : `${placementInvalid ? "Invalid placement" : "Not valid yet"}: ${live.result.error.message}${placementInvalid ? " Adjust the outlined tiles; green letters still mean valid words." : ""}`}
                  </p>
                )}
                {!reveal && live.key === liveKey && !!live.words?.length && (
                  <ul
                    className="gym-word-feedback"
                    aria-label="Words in your move"
                  >
                    {live.words.map((word, i) => (
                      <li
                        key={i}
                        className={word.valid ? "is-valid" : "is-invalid"}
                      >
                        {word.valid ? "✓" : "×"} {word.word} —{" "}
                        {word.valid ? "valid" : "invalid"}
                      </li>
                    ))}
                  </ul>
                )}
                {!reveal && <WordFeedbackHelp cells={wordCells} />}
                {strength && (
                  <details className="gym-live-coaching">
                    <summary>
                      {strengthBars}{" "}
                      <strong>
                        {strength.best
                          ? "★ Best possible score"
                          : "Score strength"}
                      </strong>{" "}
                      · {Math.round(strength.percentage)}%
                    </summary>
                    <p>
                      {live.result?.ok ? live.result.score : 0} points ·{" "}
                      {strength.tied ? "tied " : ""}#{strength.rank} of{" "}
                      {strength.total} legal placements ·{" "}
                      {Math.round(strength.percentage)}% of maximum.
                    </p>
                    <p>
                      Compared with every legal placement using this board and
                      your full rack. Bars show points relative to the maximum.
                    </p>
                    <p>
                      Exact strategy rank is not available; sampled analysis is
                      separate.
                    </p>
                  </details>
                )}
                {reveal && solution && !movesOpen && (
                  <>
                    <div
                      className="gym-solution-options"
                      role="group"
                      aria-label="Top scoring placements"
                    >
                      {ready.answer.best.slice(0, 3).map((move, index) => (
                        <button
                          key={index}
                          className={`button light solution-${index} medal-${scoreMedal(move.score, ready.answer)}`}
                          aria-pressed={solutionIndex === index}
                          onClick={() => setSolutionIndex(index)}
                        >
                          {scoreMedal(move.score, ready.answer)?.replace(
                            /^./,
                            (letter) => letter.toUpperCase(),
                          )}{" "}
                          · Option {index + 1} · {move.score} points
                          {index > 0 &&
                          move.score === ready.answer.best[index - 1].score
                            ? " (tied)"
                            : ""}
                        </button>
                      ))}
                    </div>
                    <p className="gym-score">
                      <strong>{solution.score}</strong> points
                    </p>
                    <p>
                      {solution.words
                        .map((w) => `${w.word} (${w.score})`)
                        .join(" + ")}
                      {solution.bingo ? ` + ${solution.bingo} bonus` : ""}
                    </p>
                    <p>
                      {ready.answer.maximumCount} maximum-scoring placements ·{" "}
                      {ready.answer.totalMoves} legal placements
                    </p>
                    <p>
                      Highlighted tiles show option {solutionIndex + 1}. Medals
                      mark the top three distinct scores; tied scores share a
                      medal. Existing board tiles stay dark. These are score
                      leaders; strategy may favour another move.
                    </p>
                  </>
                )}
                {!!hint && best && (
                  <section className="gym-hints" aria-label="Revealed hints">
                    <h3>Hints</h3>
                    <ol aria-live="polite" aria-relevant="additions">
                      {hints.slice(0, hint).map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ol>
                    {!reveal && (
                      <button
                        className="button light"
                        disabled={!!busy || referencePending || !introduced}
                        aria-pressed={pointToHint}
                        onClick={() => setPointToHint((shown) => !shown)}
                      >
                        {pointToHint
                          ? "Hide board pointer"
                          : "Point to a square"}
                      </button>
                    )}
                    {pointToHint && !reveal && (
                      <p role="status">
                        The arrow points to {hintCoordinate}, where one
                        highest-scoring move places a tile. It does not
                        necessarily start there.
                      </p>
                    )}
                  </section>
                )}
                {grade && (
                  <details className="gym-strategy-experiment">
                    <summary>About strategy coaching</summary>
                    <p>
                      Points rate this turn. Strategy also considers the letters
                      you keep and the chances you leave your opponent, to
                      compare how the rest of the game might go.
                    </p>
                    <p>
                      Compare points, retained tiles and likely opponent
                      replies. This samples hidden racks and uses approximate
                      rack values; it is not a prediction of who wins. The
                      15-second analysis limit keeps slow comparisons bounded.
                    </p>
                    <button
                      className="button light"
                      disabled={!!busy}
                      onClick={() =>
                        request({
                          type: "strategy",
                          puzzle: ready.puzzle,
                          action: { type: "play", placements: placed },
                        })
                      }
                    >
                      Compare strategy
                    </button>
                  </details>
                )}
                {strategy && (
                  <section
                    className="gym-strategy-result"
                    aria-label="Strategy comparison"
                  >
                    <h3>
                      {strategy.verdict === "same"
                        ? "Your move led the sampled shortlist"
                        : strategy.verdict === "favoured"
                          ? "An alternative was stronger in every fresh sample"
                          : "No clear strategic winner"}
                    </h3>
                    <p>Short-horizon estimate · Not an exact strategy rank.</p>
                    <p>
                      Your move: <strong>{strategy.requested.label}</strong>
                    </p>
                    {strategy.verdict !== "same" && (
                      <p>
                        Compared alternative:{" "}
                        <strong>{strategy.recommended.label}</strong>
                      </p>
                    )}
                    <table>
                      <caption>Points and estimated trade-offs</caption>
                      <thead>
                        <tr>
                          <th scope="col">Measure</th>
                          <th scope="col">Your move</th>
                          {strategy.verdict !== "same" && (
                            <th scope="col">Alternative</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th scope="row">Points now</th>
                          <td>{strategy.requested.points}</td>
                          {strategy.verdict !== "same" && (
                            <td>{strategy.recommended.points}</td>
                          )}
                        </tr>
                        <tr>
                          <th scope="row">Tiles kept</th>
                          <td>
                            {strategy.requested.retained.join(" ") || "None"}
                          </td>
                          {strategy.verdict !== "same" && (
                            <td>
                              {strategy.recommended.retained.join(" ") ||
                                "None"}
                            </td>
                          )}
                        </tr>
                        <tr>
                          <th scope="row">Average opponent reply</th>
                          <td>
                            {strategy.requested.replyPoints.toFixed(1)} points
                          </td>
                          {strategy.verdict !== "same" && (
                            <td>
                              {strategy.recommended.replyPoints.toFixed(1)}{" "}
                              points
                            </td>
                          )}
                        </tr>
                      </tbody>
                    </table>
                    <p>
                      A lower opponent reply can indicate a safer board.
                      Retained tiles and new draws also affect the comparison.
                    </p>
                    <details>
                      <summary>How this estimate was made</summary>
                      <p>
                        {strategy.considered} options considered from{" "}
                        {strategy.available} legal actions.
                      </p>
                      <p>
                        Each option used {strategy.discoverySamples} shared
                        hidden-rack samples. The selected option and your move
                        were then checked on {strategy.validationSamples} fresh
                        paired samples. The opponent uses a points-and-rack
                        policy and cannot see your rack or future draws.
                      </p>
                      <p>
                        The estimate combines immediate points minus reply
                        points plus an approximate rack-value difference after
                        drawing. Rack values are hand-written heuristics, not a
                        calibrated strength model. It does not model the rest of
                        the game or score-dependent risk.
                      </p>
                      <p>
                        Your estimate: {strategy.requested.estimate.toFixed(1)}.
                        Alternative minus yours: {strategy.gap.toFixed(1)}.
                        Observed sample differences:{" "}
                        {strategy.sampleGapRange
                          .map((n) => n.toFixed(1))
                          .join(" to ")}
                        . This observed range is not a confidence interval.
                      </p>
                    </details>
                  </section>
                )}
                <button
                  className="button light"
                  disabled={!!busy}
                  onClick={generate}
                >
                  Next random puzzle
                </button>
                <p className="gym-measurement">
                  Prepared in {(ready.elapsedMs / 1000).toFixed(2)}s · Fresh
                  legal game
                </p>
              </aside>
            </div>
          </>
        )}
        {historyOpen && (
          <Modal
            title="My practice history"
            onClose={() => setHistoryOpen(false)}
          >
            <GymHistory
              page={historySync.page}
              detail={historySync.detail}
              loading={historySync.loading}
              onReview={(id) => void historySync.review(id)}
              onPage={(cursor) => void historySync.history(cursor)}
            />
          </Modal>
        )}
        {settingsOpen && (
          <Modal
            title="Practice settings"
            onClose={() => setSettingsOpen(false)}
          >
            <label className="gym-setting">
              <input
                type="checkbox"
                checked={!petPaused}
                onChange={(e) => setPetPaused(!e.target.checked)}
              />{" "}
              Animate Scarlett
            </label>
            <label className="gym-setting">
              <input
                type="checkbox"
                checked={liveCoaching}
                onChange={(e) => {
                  if (e.target.checked && draft.tiles.length)
                    historySync.record({ type: "live-coaching" });
                  setLiveCoaching(e.target.checked);
                }}
              />{" "}
              Live score coaching
            </label>
            <p>
              Show score strength while experimenting. Turn it off to wait until
              Check move for rankings.
            </p>
            <label className="gym-setting">
              <input
                type="checkbox"
                checked={reducedMotion}
                onChange={(e) => {
                  const value = e.target.checked;
                  reducedMotionRef.current = value;
                  setReducedMotion(value);
                  if (value) {
                    setIntroduced(true);
                    if (timer.current) clearTimeout(timer.current);
                    for (const node of rackRef.current?.querySelectorAll(
                      "[data-rack-id]",
                    ) ?? [])
                      for (const animation of node.getAnimations())
                        animation.cancel();
                  }
                }}
              />{" "}
              Reduced motion
            </label>
            <p>
              Animations are on by default. These choices apply to this visit.
            </p>
          </Modal>
        )}
        {dragPreview && dragTile && (
          <div
            className={`gym-drag-preview${dragPreview.touch ? " is-touch" : ""}`}
            aria-hidden="true"
            style={{
              left: dragPreview.x,
              top: dragPreview.y,
              ...(dragPreview.touch
                ? { width: dragPreview.size, height: dragPreview.size }
                : {}),
            }}
          >
            {dragPreview.target?.blocked && (
              <span className="gym-drop-label is-blocked">× Occupied</span>
            )}
            <b>{dragTile.letter === "?" ? "" : dragTile.letter}</b>
            <small>
              {dragTile.blank ? 0 : LETTER_VALUES[dragTile.letter as Letter]}
            </small>
          </div>
        )}
        {(busy || message) && (
          <div className="gym-status" role={message ? "alert" : "status"}>
            <div className="gym-status-content">
              <span>{busy ?? message}</span>
              {busy === "Thinking…" && (
                <div
                  className="gym-thinking"
                  role="progressbar"
                  aria-label="Strategy analysis"
                >
                  <span />
                </div>
              )}
            </div>
            {busy && (
              <button
                className="text-button"
                onClick={() => {
                  stop();
                  setMessage("Cancelled. Your current board is unchanged.");
                }}
              >
                Cancel
              </button>
            )}
          </div>
        )}
        {leavePrompt && (
          <Modal
            title="Leave this puzzle?"
            onClose={() => setLeavePrompt(false)}
          >
            <p>
              {profileHistory
                ? "Saved attempts remain in your history. Your current practice is kept on this device when saving succeeds; choose Resume practice when you return."
                : "Your current practice is kept on this device when saving succeeds. Choose Resume practice when you return."}
            </p>
            <div className="gym-header-actions">
              <button
                className="button light"
                onClick={() => setLeavePrompt(false)}
              >
                Keep practising
              </button>
              <button className="button primary" onClick={leavePractice}>
                Leave practice
              </button>
            </div>
          </Modal>
        )}
        {officialQuery !== null && (
          <OfficialWordSearch
            initialQuery={officialQuery}
            storageScope={profileHistory ? "family" : "device"}
            onSave={saveLookup}
            onClose={() => setOfficialQuery(null)}
          />
        )}
        {help && (
          <Modal title="How to play" onClose={() => setHelp(false)}>
            <ol>
              <li>Start with a fresh random board and seven rack tiles.</li>
              <li>Tap an empty square. Tap it again to toggle across/down.</li>
              <li>
                Tap or flick rack tiles into the highlighted next square, or
                drag them directly onto the board. Direction is inferred when
                clear; tap again or use the direction control to override it.
                Existing letters are skipped.
              </li>
              <li>
                Undo reverses the last edit, including a moved tile, returned
                tiles or rack shuffle. Return all clears your draft. Tap a
                placed tile to return it, or drag it to adjust.
              </li>
              <li>
                Check move compares your score. Hint offers clues; Solve shows a
                highest-scoring placement.
              </li>
            </ol>
            <p>
              {profileHistory
                ? "Practice attempts and help are saved to your linked profile. Check the sync status before leaving; unfinished tile layouts are not restored after refresh."
                : "This standalone preview does not save practice history. Refresh clears the puzzle."}{" "}
              Shared word lookup and full-game strategy coaching are still
              planned; current strategy feedback uses short-horizon estimates.
            </p>
          </Modal>
        )}
        {blank && ready && (
          <Modal
            title="Choose your blank’s letter"
            onClose={() => setBlank(null)}
          >
            <div className="gym-blank-picker">
              {[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => (
                <button
                  className="button light"
                  key={letter}
                  onClick={() => {
                    edit((d) =>
                      placeTile(
                        d,
                        ready.puzzle.position.board,
                        ready.puzzle.position.rack,
                        blank.id,
                        letter as Letter,
                        blank.target,
                      ),
                    );
                    setBlank(null);
                  }}
                >
                  {letter}
                </button>
              ))}
            </div>
          </Modal>
        )}
      </main>
    </div>
  );
}
