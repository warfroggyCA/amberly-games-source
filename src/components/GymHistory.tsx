"use client";
import { premiumAt, LETTER_VALUES } from "../domain/board";
import type {
  GymHistory as History,
  GymSessionDetail,
} from "../lib/gym-history-contract";
export function GymHistory({
  page,
  detail,
  loading,
  onReview,
  onPage,
}: {
  page: History | null;
  detail: GymSessionDetail | null;
  loading: boolean;
  onReview: (id: string) => void;
  onPage: (cursor?: string) => void;
}) {
  if (detail)
    return (
      <section aria-label="Saved practice review">
        <button
          className="button light"
          onClick={() => onPage()}
          disabled={loading}
        >
          Back to practice history
        </button>
        <p>
          Saved review ·{" "}
          {detail.replay ? "Repeated board" : "First saved encounter"}.
          Reviewing does not change your recorded attempts.
        </p>
        <div className="gym-history-board" aria-label="Original practice board">
          {detail.puzzle.position.board.flatMap((row, r) =>
            row.map((tile, c) => (
              <span
                key={`${r}:${c}`}
                className={
                  tile ? "has-tile" : `premium-${premiumAt(r, c) ?? "plain"}`
                }
                aria-label={`${String.fromCharCode(65 + c)}${r + 1}${tile ? `: ${tile.letter}${tile.blank ? " blank" : ""}` : " empty"}`}
              >
                {tile?.letter ?? premiumAt(r, c) ?? ""}
                {tile && (
                  <small>{tile.blank ? 0 : LETTER_VALUES[tile.letter]}</small>
                )}
              </span>
            )),
          )}
        </div>
        <p>Original rack: {detail.puzzle.position.rack.join(" · ")}</p>
        <ol className="gym-history-events">
          {detail.events.map((e) => (
            <li key={e.id}>
              {e.payload.type === "attempt" ? (
                <>
                  <strong>{e.firstAttempt ? "First attempt" : "Retry"}</strong>{" "}
                  ·{" "}
                  {e.valid
                    ? `${e.verifiedPoints} points (verified)`
                    : `Invalid move: ${e.reason}`}{" "}
                  · {e.assisted ? "Assisted" : "No recorded help"}
                  {!!e.referenceWords?.length && (
                    <details>
                      <summary>
                        Verified additions used ({e.referenceWords.length})
                      </summary>
                      <p>{e.referenceWords.join(", ")}</p>
                    </details>
                  )}
                  <p>
                    {e.payload.action.type === "play" &&
                      e.payload.action.placements
                        .map(
                          (p) =>
                            `${p.tile.letter}${p.tile.blank ? " (blank)" : ""} at ${String.fromCharCode(65 + p.col)}${p.row + 1}`,
                        )
                        .join(", ")}
                  </p>
                </>
              ) : e.payload.type === "score" ? (
                <>
                  Browser-calculated score rank {e.payload.rank ?? "—"} ·{" "}
                  {e.payload.percentage === null
                    ? "—"
                    : Math.round(e.payload.percentage) + "% of maximum"}
                </>
              ) : e.payload.type === "strategy" ? (
                <>
                  Strategy estimate: {e.payload.verdict} · Your move:{" "}
                  {e.payload.requested}; alternative: {e.payload.recommended}.
                  Average replies: {e.payload.replyPoints.toFixed(1)} /{" "}
                  {e.payload.alternativeReplyPoints.toFixed(1)} points.{" "}
                  <small>
                    {e.payload.policy} · {e.payload.samples} samples · Browser
                    estimate
                  </small>
                </>
              ) : e.payload.type === "hint" ? (
                `Hint ${e.payload.level} viewed`
              ) : e.payload.type === "solve" ? (
                "Solution viewed"
              ) : e.payload.type === "all-moves" ? (
                "Move list viewed"
              ) : e.payload.type === "resume" ? (
                <span>Resumed practice from this device</span>
              ) : e.payload.type === "word-lookup" ? (
                "Official word lookup used"
              ) : e.payload.type === "strategy-request" ? (
                "Strategy comparison requested"
              ) : (
                "Live score coaching used"
              )}
            </li>
          ))}
        </ol>
      </section>
    );
  return (
    <section aria-label="Practice history">
      <p>
        Your personal practice, shared across signed-in devices. First attempts
        and retries stay separate; live coaching, word lookup, hints and
        solutions count as assistance.
      </p>
      {!page?.sessions.length ? (
        <p>No saved practice yet.</p>
      ) : (
        <ul className="gym-history-events">
          {page.sessions.map((s) => (
            <li key={s.id}>
              <button
                className="text-button"
                disabled={loading}
                onClick={() => onReview(s.id)}
              >
                {new Date(s.createdAt).toLocaleString()} · {s.attempts} attempt
                {s.attempts === 1 ? "" : "s"}
              </button>
              <p>
                {s.firstPoints === null
                  ? "No valid first-attempt score"
                  : `First attempt: ${s.firstPoints} points`}{" "}
                · {s.assisted ? "Assisted / viewed" : "No recorded help"}
                {s.replay ? " · Repeated board" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="gym-header-actions">
        <button
          className="button light"
          onClick={() => onPage()}
          disabled={loading}
        >
          Refresh history
        </button>
        {page?.nextCursor && (
          <button
            className="button light"
            disabled={loading}
            onClick={() => onPage(page.nextCursor!)}
          >
            Older practice
          </button>
        )}
      </div>
    </section>
  );
}
