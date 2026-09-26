import {
  calculateRoundAwards,
  type CrokinoleEntry,
  type CrokinoleEvent,
  type CrokinoleGame,
  type CrokinoleResult,
} from "../domain/crokinole";

type RecordedRound = { id: string; entries: CrokinoleEntry[] };
export type CrokinoleChange = {
  event: CrokinoleEvent;
  roundNumber: number | null;
  beforeEntries: CrokinoleEntry[] | null;
  afterEntries: CrokinoleEntry[] | null;
  beforeTotals: Record<string, number>;
  afterTotals: Record<string, number>;
  beforeResult: CrokinoleResult | null;
  beforeStatus: CrokinoleGame["status"];
  afterStatus: CrokinoleGame["status"];
  excluded: { number: number; entries: CrokinoleEntry[] }[];
};

/** Read-only journal projection. Reuse round awards; never alter the saved game. */
export function crokinoleChangeHistory(game: CrokinoleGame): CrokinoleChange[] {
  let rounds: RecordedRound[] = [];
  const totals = Object.fromEntries(
    game.definition.participants.map((participant) => [participant.id, 0]),
  );
  let previous: CrokinoleEvent | undefined;
  const changes: CrokinoleChange[] = [];
  const adjust = (entries: CrokinoleEntry[], direction: 1 | -1) => {
    const awards = calculateRoundAwards(game.definition.scoringMode, entries);
    for (const [id, points] of Object.entries(awards))
      totals[id] += direction * points;
  };
  let previousStatus: CrokinoleGame["status"] = "active";
  for (const event of game.events) {
    const command = event.command;
    const afterStatus: CrokinoleGame["status"] = event.result
      ? "completed"
      : command.type === "end_early" ||
          (previousStatus === "ended_early" &&
            (command.type === "correct_round_v2" ||
              command.type === "undo_round_v2"))
        ? "ended_early"
        : "active";
    if (command.type === "record_round") {
      rounds.push({ id: command.roundId, entries: command.entries });
      adjust(command.entries, 1);
    } else {
      const index =
        command.type === "correct_round" || command.type === "correct_round_v2"
          ? rounds.findIndex((round) => round.id === command.roundId)
          : command.type === "undo_round" || command.type === "undo_round_v2"
            ? rounds.length - 1
            : -1;
      const change: CrokinoleChange = {
        event,
        roundNumber: index >= 0 ? index + 1 : null,
        beforeEntries: rounds[index]?.entries ?? null,
        afterEntries:
          command.type === "correct_round" ||
          command.type === "correct_round_v2"
            ? command.entries
            : null,
        beforeTotals: { ...totals },
        afterTotals: {},
        beforeResult: previous?.result ?? null,
        beforeStatus: previousStatus,
        afterStatus,
        excluded: [],
      };
      if (
        command.type === "correct_round" ||
        command.type === "correct_round_v2"
      ) {
        adjust(rounds[index].entries, -1);
        rounds[index] = { id: command.roundId, entries: command.entries };
        adjust(command.entries, 1);
        const excluded = new Set(command.excludedRoundIds);
        rounds = rounds.filter((round, roundIndex) => {
          if (!excluded.has(round.id)) return true;
          change.excluded.push({
            number: roundIndex + 1,
            entries: round.entries,
          });
          adjust(round.entries, -1);
          return false;
        });
      } else if (
        command.type === "undo_round" ||
        command.type === "undo_round_v2"
      ) {
        adjust(rounds.pop()!.entries, -1);
      }
      change.afterTotals = { ...totals };
      changes.push(change);
    }
    previous = event;
    previousStatus = afterStatus;
  }
  return changes;
}
