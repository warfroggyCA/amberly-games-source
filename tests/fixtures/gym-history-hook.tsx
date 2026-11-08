// Real React mount for browser-only hook lifecycle tests. Never an app route.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useGymHistory } from "../../src/components/useGymHistory";
import { GymHistory } from "../../src/components/GymHistory";
import type { Puzzle } from "../../src/domain/gym/model";
const puzzle: Puzzle = {
  version: 1,
  generator: "legal-play-v1",
  rules: "amberly-two-player-v1",
  reference: { id: "synthetic", edition: "synthetic", status: "test" },
  setup: [],
  seed: "synthetic",
  position: {
    board: Array.from({ length: 15 }, () => Array(15).fill(null)),
    rack: ["A", "B", "C", "D", "E", "F", "G"],
    scores: [0, 0],
    opponentCount: 7,
    bagCount: 86,
    passes: 0,
  },
};
function Hook({ enabled }: { enabled: boolean }) {
  const h = useGymHistory(enabled);
  return (
    <main>
      <p data-testid="sync-status">{h.status}</p>
      <output data-testid="owner">{JSON.stringify(h.identity)}</output>
      <output data-testid="practice-owner">
        {JSON.stringify(h.practiceOwner)}
      </output>
      <output data-testid="state">{h.readState.kind}</output>
      <button onClick={() => void h.history()}>List</button>
      <button
        onClick={() => void h.review("c1111111-1111-4111-8111-111111111111")}
      >
        Review
      </button>
      <button onClick={h.close}>Close</button>
      <button onClick={h.retry} disabled={!h.canRetry}>
        Sync
      </button>
      <button onClick={() => h.start(puzzle)}>Start</button>
      <button onClick={() => h.record({ type: "hint", level: 1 })}>
        Record
      </button>
      <GymHistory
        state={h.readState}
        onPage={(cursor) => void h.history(cursor)}
        onReview={(id) => void h.review(id)}
        onRetry={h.retryHistory}
      />
    </main>
  );
}
function Harness() {
  const [enabled, setEnabled] = useState(true),
    [mounted, setMounted] = useState(true);
  return (
    <StrictMode>
      <button onClick={() => setEnabled((v) => !v)}>Toggle enabled</button>
      <button onClick={() => setMounted((v) => !v)}>Toggle mount</button>
      {mounted && <Hook enabled={enabled} />}
    </StrictMode>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
