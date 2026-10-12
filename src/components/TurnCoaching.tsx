"use client";
import { useEffect, useRef, useState } from "react";
import type { GameState } from "../domain/game";
import {
  coachingPosition,
  rackContinuity,
  parsePrivateRack,
  validateReviewRack,
  validateRackSupply,
  type CoachingPosition,
} from "../domain/turn-coaching";
import type { SpectatorState } from "../lib/shared-contract";
import { analyseTurn } from "../lib/coaching-client";
import type { CoachingAnswer } from "../lib/coaching.worker";
import {
  advanceRack,
  completeExchange,
  emptyRackMemory,
} from "../lib/private-rack";
import { lexiconDetails } from "../lib/lexicons";
import { scoreMedal } from "../domain/gym/score-strength";
import { LETTER_VALUES, premiumAt } from "../domain/board";
import type { Placement } from "../domain/types";
import { Modal } from "./Modal";
import "./turn-coaching.css";
import { coachingAvailable } from "../lib/coaching-availability";

export function TurnCoaching({
  game,
  onOpen,
}: {
  game: GameState | SpectatorState;
  onOpen?: () => void;
}) {
  const enabled =
    "definition" in game ? game.definition.coaching : game.coaching;
  return coachingAvailable && enabled ? (
    <PrivateCoaching key={game.id} game={game} onOpen={onOpen} />
  ) : null;
}

function PrivateCoaching({
  game,
  onOpen,
}: {
  game: GameState | SpectatorState;
  onOpen?: () => void;
}) {
  const epoch =
    "events" in game ? rackContinuity(game) : (game.coachingEpoch ?? undefined);
  const [open, setOpen] = useState(false);
  const [playerId, setPlayerId] = useState("");
  const [memory, setMemory] = useState(() =>
    emptyRackMemory(game.revision ?? 0, game.turns, epoch),
  );
  const [currentInput, setCurrentInput] = useState("");
  const [drawn, setDrawn] = useState("");
  const [returned, setReturned] = useState("");
  const [turnId, setTurnId] = useState("");
  const [position, setPosition] = useState<CoachingPosition | null>(null);
  const [reviewInput, setReviewInput] = useState("");
  const [answer, setAnswer] = useState<CoachingAnswer | null>(null);
  const [choice, setChoice] = useState(-1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const revision = game.revision ?? 0;
  const advanced = advanceRack(
    memory,
    revision,
    game.turns,
    playerId,
    epoch,
    game.expectedRackCounts?.[playerId],
  );
  if (advanced !== memory) setMemory(advanced);
  const turns = game.turns.filter((t) => t.playerId === playerId);
  const expected = game.expectedRackCounts?.[playerId];

  function cancel() {
    request.current?.abort();
    request.current = null;
    setBusy(false);
  }
  function clearReview() {
    cancel();
    setPosition(null);
    setAnswer(null);
    setReviewInput("");
    setTurnId("");
    setError("");
  }
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== "visible") request.current?.abort();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      request.current?.abort();
    };
  }, []);
  // A server revision change invalidates pending/results. Rack tracking has its own reconciliation.
  useEffect(() => {
    request.current?.abort();
  }, [revision]);
  const validPosition = position?.revision === revision ? position : null;

  async function chooseTurn(id: string) {
    clearReview();
    setTurnId(id);
    if (!id) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      let next: CoachingPosition | null;
      if ("events" in game) next = coachingPosition(game, id);
      else {
        const token = location.hash.slice(1);
        const response = await fetch(
          `/api/watch/coaching?turnId=${encodeURIComponent(id)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            credentials: "omit",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw Error(
            "This turn review is unavailable. Check that your viewing link is still active.",
          );
        next = (await response.json()).position;
      }
      if (controller.signal.aborted) return;
      if (
        !next ||
        next.gameId !== game.id ||
        next.turn.id !== id ||
        next.revision !== revision
      )
        throw Error(
          "The original position is unavailable or the game changed. Select the turn again.",
        );
      lexiconDetails(next.lexicon); // Fail closed with a readable error for unavailable historical references.
      setPosition(next);
      setReviewInput(
        next.corrected ? "" : (advanced.snapshots[id]?.join("") ?? ""),
      );
      setChoice(-1);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Review unavailable.");
    } finally {
      if (request.current === controller) setBusy(false);
    }
  }
  async function review() {
    if (!validPosition) return;
    cancel();
    setAnswer(null);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const rack = parsePrivateRack(reviewInput);
      validateReviewRack(validPosition, rack);
      setBusy(true);
      const next = await analyseTurn(validPosition, rack, controller.signal);
      if (!controller.signal.aborted) {
        setAnswer(next);
        setChoice(-1);
      }
    } catch (e) {
      if (request.current === controller && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Review unavailable.");
    } finally {
      if (request.current === controller) setBusy(false);
    }
  }
  function updateRack(action: () => void) {
    try {
      action();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the rack.");
    }
  }
  const selectedMove =
    validPosition && (choice < 0 ? validPosition.turn : answer?.best[choice]);
  return (
    <>
      <button
        className="button light coaching-launch"
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
      >
        Post-turn coaching
      </button>
      {open && (
        <Modal
          title="Private turn coaching"
          wide
          onClose={() => {
            cancel();
            setOpen(false);
          }}
        >
          <div className="turn-coaching">
            <p>
              Use your own device. Racks stay only in this page’s memory:
              reload, closing the page or changing devices loses them. Nothing
              is synchronized. A shared screen is not private.
            </p>
            <label className="field">
              Your seat
              <select
                value={playerId}
                onChange={(e) => {
                  clearReview();
                  setPlayerId(e.target.value);
                  setMemory(emptyRackMemory(revision, game.turns, epoch));
                  setCurrentInput("");
                  setDrawn("");
                  setReturned("");
                }}
              >
                <option value="">Choose your player</option>
                {game.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {playerId && (
              <>
                <details>
                  <summary>Optional private rack tracking</summary>
                  <p role="status">{advanced.notice}</p>
                  {advanced.rack && (
                    <p>
                      Tiles recorded here:{" "}
                      <strong>{advanced.rack.join(" ") || "Empty"}</strong>
                    </p>
                  )}
                  <label className="field">
                    Starting or current full rack
                    <input
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={14}
                      value={currentInput}
                      onChange={(e) => setCurrentInput(e.target.value)}
                    />
                  </label>
                  <button
                    className="button light"
                    onClick={() =>
                      updateRack(() => {
                        const rack = parsePrivateRack(currentInput);
                        if (expected === undefined || rack.length !== expected)
                          throw Error(
                            `Enter the current ${expected ?? "known"} tiles. Use ? for a blank.`,
                          );
                        validateRackSupply(
                          game.board,
                          rack,
                          game.tileSupply ?? undefined,
                        );
                        setMemory({
                          ...advanced,
                          rack,
                          exchange: null,
                          awaitingDraw: false,
                          notice: "Current rack recorded on this device.",
                        });
                        setCurrentInput("");
                      })
                    }
                  >
                    Confirm current rack
                  </button>
                  {advanced.rack && (
                    <>
                      {advanced.exchange && (
                        <label className="field">
                          Tiles returned in exchange
                          <input
                            autoComplete="off"
                            value={returned}
                            onChange={(e) => setReturned(e.target.value)}
                            maxLength={14}
                          />
                        </label>
                      )}
                      <label className="field">
                        Newly drawn tiles
                        <input
                          autoComplete="off"
                          value={drawn}
                          onChange={(e) => setDrawn(e.target.value)}
                          maxLength={14}
                        />
                      </label>
                      <button
                        className="button light"
                        onClick={() =>
                          updateRack(() => {
                            if (expected === undefined)
                              throw Error(
                                "The current rack count is unavailable.",
                              );
                            if (advanced.exchange) {
                              const next = completeExchange(
                                advanced,
                                parsePrivateRack(returned),
                                parsePrivateRack(drawn),
                                expected,
                              );
                              validateRackSupply(
                                game.board,
                                next.rack!,
                                game.tileSupply ?? undefined,
                              );
                              setMemory(next);
                            } else {
                              const rack = [
                                ...advanced.rack!,
                                ...parsePrivateRack(drawn),
                              ];
                              if (rack.length !== expected)
                                throw Error(
                                  `The completed rack must contain ${expected} tiles.`,
                                );
                              validateRackSupply(
                                game.board,
                                rack,
                                game.tileSupply ?? undefined,
                              );
                              setMemory({
                                ...advanced,
                                rack,
                                awaitingDraw: false,
                                notice: "Current rack recorded on this device.",
                              });
                            }
                            setDrawn("");
                            setReturned("");
                          })
                        }
                      >
                        Save drawn tiles
                      </button>
                    </>
                  )}
                </details>
                <label className="field">
                  Registered turn
                  <select
                    value={turnId}
                    onChange={(e) => void chooseTurn(e.target.value)}
                  >
                    <option value="">Choose a turn to review</option>
                    {turns.map((t) => (
                      <option key={t.id} value={t.id}>
                        Turn {t.number}:{" "}
                        {t.type === "play"
                          ? t.words.map((w) => w.word).join(" + ")
                          : t.type}{" "}
                        · {t.score} points
                      </option>
                    ))}
                  </select>
                </label>
                {!turns.length && (
                  <p>
                    Review becomes available after your first registered turn.
                  </p>
                )}
                {position && !validPosition && (
                  <p role="status">
                    The game changed. Select the turn again to refresh its
                    original position.
                  </p>
                )}
                {position && !validPosition && (
                  <button
                    className="button light"
                    onClick={() => void chooseTurn(turnId)}
                  >
                    Refresh turn review
                  </button>
                )}
                {validPosition && (
                  <>
                    {validPosition.corrected && (
                      <p role="status">
                        History changed after this turn. This shows the original
                        move and original board. Re-enter the rack you held
                        then; later corrections are not substituted.
                      </p>
                    )}
                    <p>
                      {lexiconDetails(validPosition.lexicon).label}.{" "}
                      {lexiconDetails(validPosition.lexicon).legacy
                        ? "Limited example dictionary; medals apply only to this recorded word list."
                        : "Uses the dictionary recorded for this turn."}
                    </p>
                    <label className="field">
                      Full rack before this turn ({validPosition.rackCount}{" "}
                      tiles)
                      <input
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={14}
                        value={reviewInput}
                        onChange={(e) => {
                          cancel();
                          setAnswer(null);
                          setReviewInput(e.target.value);
                        }}
                      />
                    </label>
                    <p>
                      Use ? for a physical blank. Exclude newly drawn tiles.
                      Results are based on the rack you entered.
                    </p>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => void review()}
                    >
                      Review this turn
                    </button>
                    {busy && (
                      <button className="button light" onClick={cancel}>
                        Cancel analysis
                      </button>
                    )}
                    <div
                      className="coaching-options"
                      aria-label="Move comparison"
                    >
                      <button
                        className="button light"
                        aria-pressed={choice === -1}
                        onClick={() => setChoice(-1)}
                      >
                        Actual {validPosition.turn.type} ·{" "}
                        {validPosition.turn.score} points
                      </button>
                      {answer?.status === "complete" &&
                        answer.best.map((move, i) => (
                          <button
                            key={move.key}
                            className="button light"
                            aria-pressed={choice === i}
                            onClick={() => setChoice(i)}
                          >
                            {scoreMedal(move.score, answer)} · {move.score}{" "}
                            points
                          </button>
                        ))}
                    </div>
                    {answer?.status === "complete" &&
                      validPosition.turn.type === "play" && (
                        <p>
                          {validPosition.turn.score === answer.best[0]?.score
                            ? "Your recorded move matched the highest placement score."
                            : `Highest placement: ${answer.best[0]?.score ?? 0} points. Your recorded move: ${validPosition.turn.score} points.`}
                        </p>
                      )}
                    {selectedMove && (
                      <>
                        <p>
                          {selectedMove.words
                            .map((w) => `${w.word} (${w.score})`)
                            .join(" + ")}
                          {selectedMove.bingo ? " + 50 bingo" : ""}
                        </p>
                        <ReviewBoard
                          position={validPosition}
                          placements={selectedMove.placements}
                        />
                      </>
                    )}
                    {answer && (
                      <p role="status">
                        {answer.status === "complete"
                          ? `${answer.totalMoves} legal placements checked. ${answer.best.length ? "Medals represent distinct score tiers; tied scores share a medal." : "No legal placement found."}`
                          : answer.message}
                      </p>
                    )}
                    <p>
                      These are score leaders, not proven strategic optima.
                      Passing or exchanging can be a strategic choice.
                    </p>
                  </>
                )}
              </>
            )}
            {busy && <p role="status">Preparing your private review…</p>}
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}

function ReviewBoard({
  position,
  placements,
}: {
  position: CoachingPosition;
  placements: Placement[];
}) {
  const placed = new Map(placements.map((p) => [`${p.row}:${p.col}`, p.tile]));
  return (
    <div
      className="coaching-board"
      role="img"
      aria-label={`Original board with ${placements.map((p) => `${p.tile.blank ? "blank " : ""}${p.tile.letter} at row ${p.row + 1}, column ${p.col + 1}`).join("; ") || "no tiles placed"}`}
    >
      {position.board.flatMap((row, r) =>
        row.map((old, c) => {
          const fresh = placed.get(`${r}:${c}`);
          const tile = fresh ?? old;
          return (
            <span
              key={`${r}:${c}`}
              className={`square ${(premiumAt(r, c) ?? "normal").toLowerCase()}${fresh ? " fresh" : ""}`}
              aria-hidden="true"
            >
              {tile ? (
                <span
                  className={`letter-tile${tile.blank ? " blank-tile" : ""}`}
                >
                  <b>{tile.letter}</b>
                  <small>{tile.blank ? 0 : LETTER_VALUES[tile.letter]}</small>
                </span>
              ) : (
                ""
              )}
            </span>
          );
        }),
      )}
    </div>
  );
}
