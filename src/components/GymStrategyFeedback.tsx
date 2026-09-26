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
      ? "Trying a few more replies…"
      : progress?.phase === "discovery"
        ? "Looking at your options…"
        : "Getting ready…";
  return (
    <div className="gym-strategy-progress">
      <span>{label}</span>
      <progress
        aria-label="Strategy comparison progress"
        max={100}
        value={progress?.percentage}
      />
      <small>Your tiles will stay put if you cancel.</small>
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
