import type { GameCommand, GameState } from "../domain/game";

/** Preview and save commands must use the same timed-game validation contract. */
export function commandTiming(
  game: Pick<GameState, "events">,
  type: GameCommand["type"],
  now = new Date(),
) {
  return type === "start-clock" ||
    game.events.some((event) => event.command.type === "start-clock")
    ? { timedAt: now.toISOString() }
    : {};
}

export type TimingEvent = {
  type: string;
  timedAt?: string | null;
  turnId?: string | null;
};
export type TimedGame = {
  events?: GameState["events"];
  timingEvents?: TimingEvent[];
};
export function timingEvents(game: TimedGame): TimingEvent[] {
  return (
    game.events?.map((e) => ({
      type: e.command.type,
      timedAt: e.command.timedAt,
      turnId: e.turn?.id,
    })) ??
    game.timingEvents ??
    []
  );
}
/** Scorer-device elapsed time; refresh/sleep keeps counting, explicit pauses do not. */
export function turnTiming(game: TimedGame, now: number) {
  let started = false;
  let anchor: number | null = null;
  let elapsed = 0;
  let totalMs = 0;
  const durations: Record<string, number> = {};
  let previousAt: number | null = null;
  for (const command of timingEvents(game)) {
    const at = command.timedAt ? Date.parse(command.timedAt) : null;
    // Old journals can contain timestamps accepted by the former lexical
    // comparison. Their real elapsed time cannot be reconstructed safely.
    // Validate across pauses too: a backward resume would corrupt later totals.
    const requiresTime = [
      "start-clock",
      "play",
      "pass",
      "exchange",
      "pause",
      "resume",
      "undo",
      "finalize",
      "assisted-pass",
    ].includes(command.type);
    if (
      (started || command.type === "start-clock") &&
      (requiresTime || command.timedAt != null)
    ) {
      if (
        at === null ||
        !Number.isFinite(at) ||
        (previousAt !== null && at < previousAt)
      ) {
        return {
          started: true,
          reliable: false as const,
          currentMs: null,
          totalMs: null,
          durations: {} as Record<string, number>,
        };
      }
      previousAt = at;
    }
    if (command.type === "start-clock") {
      started = true;
      anchor = at;
      continue;
    }
    if (!started) continue;
    if (at !== null && anchor !== null) {
      const interval = Math.max(0, at - anchor);
      elapsed += interval;
      totalMs += interval;
    }
    if (command.turnId) {
      if (at !== null) durations[command.turnId] = elapsed;
      elapsed = 0;
    }
    if (command.type === "undo") elapsed = 0;
    if (at !== null && anchor !== null) anchor = at;
    if (command.type === "pause" || command.type === "finalize") anchor = null;
    if (command.type === "resume") anchor = at;
  }
  const currentMs = elapsed + (anchor === null ? 0 : Math.max(0, now - anchor));
  totalMs += anchor === null ? 0 : Math.max(0, now - anchor);
  return { started, reliable: true as const, currentMs, totalMs, durations };
}
export function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
