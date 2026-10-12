import type { CoachingPosition } from "../domain/turn-coaching";
import type { CoachingAnswer } from "./coaching.worker";

/** Rack bytes cross only the local worker boundary, never fetch/storage/diagnostics. */
export function analyseTurn(
  position: CoachingPosition,
  rack: string[],
  signal: AbortSignal,
): Promise<CoachingAnswer> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Review cancelled."));
      return;
    }
    const worker = new Worker(
      new URL("./coaching.worker.ts", import.meta.url),
      { type: "module" },
    );
    let settled = false;
    const finish = (answer?: CoachingAnswer, message = "Review cancelled.") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (answer) resolve(answer);
      else reject(new Error(message));
    };
    const abort = () => finish();
    const timer = setTimeout(
      () =>
        finish(
          undefined,
          "Search timed out. No medals or maximum are certified.",
        ),
      30_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => finish(event.data as CoachingAnswer);
    worker.onerror = () =>
      finish(undefined, "The review worker could not finish.");
    worker.onmessageerror = () =>
      finish(undefined, "The review response could not be read.");
    worker.postMessage({ position, rack });
  });
}
