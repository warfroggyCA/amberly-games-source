import type { GameState } from "../domain/game";

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
  const durations: Record<string, number> = {};
  for (const command of timingEvents(game)) {
    const at = command.timedAt ? Date.parse(command.timedAt) : null;
    if (command.type === "start-clock") {
      started = true;
      anchor = at;
      continue;
    }
    if (!started) continue;
    if (at !== null && anchor !== null) elapsed += Math.max(0, at - anchor);
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
  return { started, currentMs, durations };
}
export function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
