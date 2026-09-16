import type { Placement } from "../domain/types";
import type { LiveDraftInput } from "./live-draft";

/** Latest-value, serialized transport: never queue a keystroke backlog or retry an old draft. */
export function createLiveDraftPublisher(
  identity: Omit<LiveDraftInput, "sequence" | "placements" | "kind">,
  send: (input: LiveDraftInput, closing: boolean) => Promise<unknown>,
  onConnection: (connected: boolean) => void = () => {},
) {
  let latest: Placement[] = [];
  let sequence = 0;
  let dirty = false;
  let editing = false;
  let busy = false;
  let stopped = false;
  let published = false;
  let superseded = false;
  let lastSent = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryAfter = 0;
  function schedule() {
    if (stopped || busy || timer || !dirty) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        void flush();
      },
      Math.max(0, lastSent + 250 - Date.now(), retryAfter - Date.now()),
    );
  }
  async function flush() {
    if (stopped || busy || !dirty) return;
    busy = true;
    dirty = false;
    published = true;
    lastSent = Date.now();
    const input: LiveDraftInput = {
      ...identity,
      placements: latest,
      sequence: ++sequence,
      kind: !latest.length ? "clear" : editing ? "edit" : "heartbeat",
    };
    editing = false;
    try {
      const result = await send(input, false);
      if (
        !result ||
        typeof result !== "object" ||
        !("accepted" in result) ||
        typeof result.accepted !== "boolean"
      )
        throw new Error("Incomplete live-preview response");
      superseded = !result.accepted;
      if (!stopped) onConnection(true);
      retryAfter = 0;
    } catch {
      if (!stopped) {
        onConnection(false);
        dirty = true;
        // A retry is not new typing: keep only edits made while the request was in flight.
        retryAfter = Date.now() + 2000;
      }
    } finally {
      busy = false;
      schedule();
    }
  }
  return {
    update(placements: Placement[]) {
      if (stopped) return;
      if (JSON.stringify(latest) === JSON.stringify(placements)) return;
      latest = structuredClone(placements);
      editing = true;
      superseded = false;
      if (!placements.length && !published) return;
      dirty = true;
      schedule();
    },
    heartbeat() {
      if (stopped || superseded || !latest.length) return;
      dirty = true;
      schedule();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      if (published)
        void send(
          { ...identity, placements: [], sequence: ++sequence, kind: "clear" },
          true,
        ).catch(() => {});
    },
  };
}
