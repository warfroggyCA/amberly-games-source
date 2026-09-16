"use client";
import { useState } from "react";
import { getTileTotal, type GameCommand, type GameState } from "../domain/game";
import { Modal } from "./Modal";

type Correction = Omit<
  Extract<GameCommand, { type: "reconcile" }>,
  "id" | "expectedRevision"
>;

export function CountCheck({
  game,
  busy,
  error,
  hasDraft,
  ending,
  onClose,
  onConfirm,
}: {
  game: GameState;
  busy: boolean;
  error: string | null;
  hasDraft: boolean;
  ending: boolean;
  onClose: () => void;
  onConfirm: (correction: Correction | null) => Promise<void>;
}) {
  const [racks, setRacks] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      game.order.map((id) => [id, String(game.expectedRackCounts[id])]),
    ),
  );
  const [bag, setBag] = useState(String(game.expectedBagCount));
  const [reason, setReason] = useState("");
  const [scorer, setScorer] = useState("");
  const setSize = getTileTotal(game);
  const boardCount = game.board.flat().filter(Boolean).length;
  const integer = (value: string, max: number) =>
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) <= max;
  const valid =
    integer(bag, setSize) && game.order.every((id) => integer(racks[id], 7));
  const total = valid
    ? boardCount +
      Number(bag) +
      game.order.reduce((sum, id) => sum + Number(racks[id]), 0)
    : null;
  const changed =
    Number(bag) !== game.expectedBagCount ||
    game.order.some((id) => Number(racks[id]) !== game.expectedRackCounts[id]);
  const last = game.turns.at(-1);
  const out =
    last && last.type === "play"
      ? game.players.find((p) => p.id === last.playerId)
      : null;
  const textValid = (value: string, max: number) =>
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value);
  const canConfirm =
    valid &&
    total === setSize &&
    (!changed || (textValid(reason, 200) && textValid(scorer, 60)));
  return (
    <Modal title="Check the table" onClose={onClose} wide>
      {hasDraft ? (
        <>
          <p>
            A play is still in draft. Record or clear it before checking
            physical counts.
          </p>
          <button className="button primary" onClick={onClose}>
            Return to the board
          </button>
        </>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !canConfirm) return;
            await onConfirm(
              changed
                ? {
                    type: "reconcile",
                    rackCounts: Object.fromEntries(
                      game.order.map((id) => [id, Number(racks[id])]),
                    ),
                    bagCount: Number(bag),
                    reason: reason.trim(),
                    recordedBy: scorer.trim(),
                    recordedAt: new Date().toISOString(),
                  }
                : null,
            );
          }}
        >
          <p>
            {game.pendingEnd === "natural" && out
              ? `${out.name} appears to have played their last tile. Confirm the bag and rack counts before final scoring.`
              : game.pendingEnd === "blocked"
                ? "Everyone has passed twice. Check the table before reviewing the ending."
                : "Count the physical tiles in the bag and on each rack. The app’s expected counts are prefilled."}
          </p>
          <fieldset className="bag-check" disabled={busy}>
            <legend>Is the bag empty?</legend>
            <div className="segmented">
              <button
                type="button"
                aria-pressed={bag === "0"}
                onClick={() => setBag("0")}
              >
                Yes, it’s empty
              </button>
              <button
                type="button"
                aria-pressed={Number(bag) > 0}
                onClick={() => {
                  if (Number(bag) === 0) setBag("");
                }}
              >
                There are tiles left
              </button>
            </div>
            <label className="field">
              Tiles actually in the bag
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={setSize}
                required
                value={bag}
                onChange={(e) => setBag(e.target.value)}
              />
            </label>
            <p className="count-expected">
              App expects {game.expectedBagCount} in the bag.
            </p>
          </fieldset>
          <div className="rack-counts">
            <div className="count-row count-head">
              <span>On each rack</span>
              <span>Expected</span>
              <span>Actual</span>
            </div>
            {game.order.map((id) => {
              const player = game.players.find((p) => p.id === id)!;
              return (
                <div className="count-row" key={id}>
                  <label htmlFor={`rack-${id}`}>{player.name}</label>
                  <span>{game.expectedRackCounts[id]}</span>
                  <input
                    id={`rack-${id}`}
                    aria-label={`${player.name} actual rack count`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={7}
                    required
                    disabled={busy}
                    value={racks[id]}
                    onChange={(e) =>
                      setRacks({ ...racks, [id]: e.target.value })
                    }
                  />
                </div>
              );
            })}
          </div>
          <div
            className={`count-total ${total === setSize ? "counts-match" : ""}`}
            role="status"
          >
            <strong>
              {total === null
                ? "Enter whole-number counts."
                : `${boardCount} on the board + racks + bag = ${total} / ${setSize} tiles`}
            </strong>
            {total !== null && total !== setSize && (
              <p>
                {total < setSize
                  ? `${setSize - total} tiles are unaccounted for.`
                  : `There are ${total - setSize} extra tiles in these counts.`}{" "}
                Check the bag, racks, and recorded board.
              </p>
            )}
          </div>
          {changed && (
            <div className="count-correction">
              <p>
                The physical counts differ from the app’s expectations. Saving a
                correction updates the counts and checks whether play should
                continue.
              </p>
              <label className="field">
                Reason for the correction
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Missed a draw"
                  maxLength={200}
                  required
                  disabled={busy}
                />
              </label>
              <label className="field">
                Scorer name
                <input
                  value={scorer}
                  onChange={(e) => setScorer(e.target.value)}
                  placeholder="Your name"
                  maxLength={60}
                  required
                  disabled={busy}
                />
              </label>
              <p className="muted">
                The reason, counts, scorer name, and time stay in the game
                history. This local preview records the name you enter; family
                sign-in will identify the scorer in the shared app.
              </p>
            </div>
          )}
          <p className="muted">
            If the recorded board is wrong, return to correct the move. Rack and
            bag counts cannot change a word or its score.
            {changed &&
              " After saving these counts, this preview can only undo later turns."}
          </p>
          {error && (
            <p className="inline-message" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button light" onClick={onClose}>
              Return to game
            </button>
            <button className="button primary" disabled={busy || !canConfirm}>
              {changed
                ? "Save count correction"
                : ending
                  ? "Continue to ending review"
                  : "Confirm counts"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function CountCorrectionHistory({ game }: { game: GameState }) {
  const corrections = game.events.filter(
    (event) =>
      event.command.type === "reconcile" ||
      event.command.type === "extend-supply",
  );
  if (!corrections.length) return null;
  return (
    <details className="count-history">
      <summary>
        {game.tileSupply
          ? "Tile set & count history"
          : "Tile count corrections"}{" "}
        ({corrections.length})
      </summary>
      {corrections.map((event) => {
        const command = event.command;
        if (command.type !== "reconcile" && command.type !== "extend-supply")
          return null;
        return (
          <div key={event.sequence}>
            <strong>{command.reason}</strong>
            <p>
              {command.recordedBy} ·{" "}
              <time dateTime={command.recordedAt}>
                {new Date(command.recordedAt).toLocaleString()}
              </time>
            </p>
            <p>
              {command.type === "extend-supply" ? (
                `Nonstandard set: ${Object.entries(command.additions)
                  .map(
                    ([letter, count]) =>
                      `+${count} ${letter === "?" ? "blank" : letter}`,
                  )
                  .join(", ")}`
              ) : (
                <>
                  {game.order
                    .map(
                      (id) =>
                        `${game.players.find((p) => p.id === id)?.name}: ${command.rackCounts[id]}`,
                    )
                    .join(" · ")}{" "}
                  · Bag: {command.bagCount}
                </>
              )}
            </p>
          </div>
        );
      })}
    </details>
  );
}
