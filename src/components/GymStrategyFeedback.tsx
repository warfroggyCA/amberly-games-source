import type {
  CoachingProgress,
  StrategyCoaching,
} from "../domain/gym/coaching";
import { coachingTakeaways } from "../domain/gym/coaching-explanation";

export function GymStrategyProgress({
  progress,
}: {
  progress: CoachingProgress | null;
}) {
  const label =
    progress?.phase === "validation"
      ? "Checking the comparison with fresh racks…"
      : progress?.phase === "discovery"
        ? "Comparing moves and opponent replies…"
        : "Preparing the comparison…";
  return (
    <div className="gym-strategy-progress">
      <span>{label}</span>
      <progress
        aria-label="Strategy comparison progress"
        max={100}
        value={progress?.percentage}
      />
      <small>
        You can cancel and keep your tiles. Progress tracks completed samples,
        not time remaining.
      </small>
    </div>
  );
}

export function GymStrategyTakeaways({ result }: { result: StrategyCoaching }) {
  return (
    <ul className="gym-strategy-takeaways">
      {coachingTakeaways(result).map((text) => (
        <li key={text}>{text}</li>
      ))}
    </ul>
  );
}
