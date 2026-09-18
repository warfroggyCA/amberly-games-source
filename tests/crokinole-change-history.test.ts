import { expect, it } from "vitest";
import {
  applyCrokinoleCommand,
  createCrokinoleGame,
  DEFAULT_PIECE_COLOURS,
  type CrokinoleCommand,
  type CrokinoleDefinition,
} from "../src/domain/crokinole";
import { crokinoleChangeHistory } from "../src/lib/crokinole-change-history";

type WithoutIdentity<T> = T extends unknown
  ? Omit<T, "id" | "expectedRevision">
  : never;

function fixture(
  scoringMode: CrokinoleDefinition["scoringMode"] = "cumulative_round_totals",
) {
  let game = createCrokinoleGame({
    schemaVersion: 1,
    rulesVersion: 1,
    id: "history",
    familyId: "family",
    createdAt: "2026-09-18T10:00:00Z",
    mode: "confirmed",
    format: "singles",
    scoringMode,
    endCondition: {
      type: "target",
      target: scoringMode === "nca_match_points" ? 5 : 100,
    },
    initialStartingPlayerId: "a",
    players: ["a", "b"].map((id, seatOrder) => ({ id, name: id, seatOrder })),
    participants: ["a", "b"].map((id, i) => ({
      id,
      name: id,
      playerIds: [id],
      colour: {
        id: DEFAULT_PIECE_COLOURS[i].id,
        name: DEFAULT_PIECE_COLOURS[i].name,
        value: DEFAULT_PIECE_COLOURS[i].value,
      },
    })),
  });
  function apply(command: WithoutIdentity<CrokinoleCommand>) {
    game = applyCrokinoleCommand(
      game,
      {
        ...command,
        id: `command-${game.revision}`,
        expectedRevision: game.revision,
      } as CrokinoleCommand,
      { actorId: "scorer-account", createdAt: "2026-09-18T11:00:00Z" },
    );
    return game;
  }
  function record(a: number, b: number) {
    return apply({
      type: "record_round",
      roundId: `round-${game.revision}`,
      entries: entries(a, b),
    });
  }
  return { apply, record, game: () => game };
}
const entries = (a: number, b: number) => [
  { participantId: "a", rawScore: a },
  { participantId: "b", rawScore: b },
];

it("retains the original result and excluded round entries when a correction ends a completed game earlier", () => {
  const f = fixture();
  f.record(40, 30);
  f.record(30, 80);
  const before = structuredClone(f.game());
  const corrected = f.apply({
    type: "correct_round",
    roundId: "round-0",
    entries: entries(100, 20),
    excludedRoundIds: ["round-1"],
    reason: "Missed pocketed twenties",
  });
  const frozen = JSON.stringify(corrected);
  const [change] = crokinoleChangeHistory(corrected);
  expect(change.beforeTotals).toEqual({ a: 70, b: 110 });
  expect(change.afterTotals).toEqual({ a: 100, b: 20 });
  expect(change.beforeResult).toEqual(before.result);
  expect(change.event.result?.winnerIds).toEqual(["a"]);
  expect(change.beforeResult?.winnerIds).toEqual(["b"]);
  expect(change.beforeEntries).toEqual(entries(40, 30));
  expect(change.excluded).toEqual([{ number: 2, entries: entries(30, 80) }]);
  expect(JSON.stringify(corrected)).toBe(frozen);
});

it.each([
  "traditional_differential",
  "nca_match_points",
  "net_winner_only",
  "cumulative_round_totals",
] as const)(
  "%s shows awarded totals, preserves successive corrections, and distinguishes undo from end early",
  (mode) => {
    const f = fixture(mode);
    f.record(40, 0);
    f.record(0, 25);
    const before = structuredClone(f.game());
    const corrected = f.apply({
      type: "correct_round",
      roundId: "round-0",
      entries: entries(20, 0),
      excludedRoundIds: [],
    });
    expect(crokinoleChangeHistory(corrected)[0].beforeTotals).toEqual(
      before.totals,
    );
    expect(crokinoleChangeHistory(corrected)[0].afterTotals).toEqual(
      corrected.totals,
    );
    const undone = f.apply({ type: "undo_round" });
    const ended = f.apply({ type: "end_early", reason: "Dinner" });
    const changes = crokinoleChangeHistory(ended);
    expect(changes).toHaveLength(3);
    expect(changes[1].roundNumber).toBe(2);
    expect(changes[1].beforeEntries).toEqual(entries(0, 25));
    expect(changes[1].afterTotals).toEqual(undone.totals);
    expect(changes[2].afterStatus).toBe("ended_early");
    expect(changes[2].beforeTotals).toEqual(changes[2].afterTotals);
    expect(changes[0].beforeEntries).toEqual(entries(40, 0));
  },
);

it("shows a tied result reopening after undo and records no changes for normal rounds", () => {
  const f = fixture();
  f.record(100, 100);
  expect(crokinoleChangeHistory(f.game())).toEqual([]);
  const undone = f.apply({ type: "undo_round", reason: "Round entered twice" });
  const [change] = crokinoleChangeHistory(undone);
  expect(change.beforeResult?.tied).toBe(true);
  expect(change.afterStatus).toBe("active");
  expect(change.afterTotals).toEqual({ a: 0, b: 0 });
});
