import type { StrategyCoaching } from "../domain/gym/coaching";
import { GymStrategyTakeaways } from "./GymStrategyFeedback";
export type StrategyView = "requested" | "recommended";
export function GymStrategyComparison({
  result,
  view,
  onPreview,
  onClose,
}: {
  result: StrategyCoaching;
  view: StrategyView;
  onPreview: (view: StrategyView) => void;
  onClose: () => void;
}) {
  const same = result.verdict === "same";
  const name = (label: string) => label.split(" at ")[0];
  return (
    <section
      className="gym-strategy-result gym-comparison"
      aria-label="Strategy comparison"
    >
      <h2>
        {same
          ? `${name(result.requested.label)} looks good`
          : `${name(result.requested.label)} or ${name(result.recommended.label)}?`}
      </h2>
      <p>Tap a move to see it on the board.</p>
      <div className="gym-comparison-options">
        {(
          ["requested", ...(same ? [] : ["recommended"])] as StrategyView[]
        ).map((key) => {
          const move = result[key];
          return (
            <button
              key={key}
              className={`gym-comparison-option comparison-${key}`}
              aria-pressed={view === key}
              onClick={() => onPreview(key)}
            >
              <span>
                {key === "requested" ? "Your move" : "Another option"}
              </span>
              <strong>
                {name(move.label)} · {move.points} points
              </strong>
              <span>{view === key ? "Showing on board" : "Show on board"}</span>
            </button>
          );
        })}
      </div>
      <GymStrategyTakeaways result={result} />
      <details>
        <summary>Move details</summary>
        <p>
          <strong>Your move:</strong> {result.requested.label}
        </p>
        {!same && (
          <p>
            <strong>Another option:</strong> {result.recommended.label}
          </p>
        )}
        <p>
          <strong>Letters you keep:</strong>{" "}
          {result.requested.retained.join(" · ") || "None"}
        </p>
        {!same && (
          <p>
            <strong>Letters kept with {name(result.recommended.label)}:</strong>{" "}
            {result.recommended.retained.join(" · ") || "None"}
          </p>
        )}
        <p>
          Estimated opponent’s next score:{" "}
          {result.requested.replyPoints.toFixed(1)} after your move
          {!same &&
            `; ${result.recommended.replyPoints.toFixed(1)} after ${name(result.recommended.label)}`}
          .
        </p>
      </details>
      <details>
        <summary>How we compared them</summary>
        <p>
          We checked {result.considered} of {result.available} possible plays,
          exchanges and passes. We tried {result.discoverySamples} possible
          opponent racks, then checked the leading move and yours against{" "}
          {result.validationSamples} new racks.
        </p>
        <p>
          This looks just one turn ahead. We don’t know your opponent’s letters
          or what you’ll draw next.
        </p>
        <details>
          <summary>Analysis numbers</summary>
          <p>
            Your estimate: {result.requested.estimate.toFixed(1)}. Other move
            minus yours: {result.gap.toFixed(1)}. Observed differences:{" "}
            {result.sampleGapRange.map((n) => n.toFixed(1)).join(" to ")}. These
            are comparison values, not game points or chances of winning.
          </p>
        </details>
      </details>
      <button className="button light" onClick={onClose}>
        Back to my move
      </button>
    </section>
  );
}
