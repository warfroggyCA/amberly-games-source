import { expect, it } from "vitest";
import { createLeadAssessor } from "../src/server/lead-standings";
import { createGame, applyCommand, type GameCommand } from "../src/domain/game";
import { releasedFamilyLexicon } from "../src/lib/lexicons";
function fixture() {
  const start = createGame({
    id: "cache-test",
    players: [
      { id: "a", name: "Same name", seat: 0 },
      { id: "b", name: "Same name", seat: 2 },
    ],
    firstPlayerId: "a",
    direction: "clockwise",
    lexicon: releasedFamilyLexicon,
  });
  if (!start.ok) throw Error(start.error.message);
  let game = start.game;
  for (let i = 0; i < 5; i++) {
    const command = {
      id: `c${i}`,
      expectedRevision: i,
      ...(i < 4
        ? { type: "pass" }
        : {
            type: "finalize",
            reason: "blocked",
            racks: { a: [..."READING"], b: [..."CATDOG?"] },
          }),
    } as GameCommand;
    const result = applyCommand(game, command, releasedFamilyLexicon);
    if (!result.ok) throw Error(result.error.message);
    game = result.game;
  }
  return {
    game_id: game.id,
    revision: game.revision,
    state: game,
    definition: game.definition,
    disputed: false,
  };
}
it("cached verified summaries require unchanged canonical bytes and cannot retain caller mutations", () => {
  const assess = createLeadAssessor(),
    head = fixture();
  const first = assess("family", head, head.state.events);
  expect(first.outcome).toBe("eligible");
  first.counts!.players[0].turnsLed = 999;
  expect(
    assess("family", head, head.state.events).counts!.players[0].turnsLed,
  ).toBe(0);
  const tampered = structuredClone(head);
  tampered.state.scores.a = 1;
  expect(assess("family", tampered, tampered.state.events).outcome).toBe(
    "unavailable",
  );
  expect(assess("family", head, []).outcome).toBe("unavailable");
  expect(
    assess("family", { ...head, disputed: true }, head.state.events).outcome,
  ).toBe("excluded");
  expect(assess("family", head, head.state.events).outcome).toBe("eligible");
});
it("returns independent stable player IDs despite equal display names", () => {
  const head = fixture();
  const result = createLeadAssessor()("family", head, head.state.events);
  expect(result.playerIds).toEqual(["a", "b"]);
  expect(result.counts!.players.map((p) => p.playerId)).toEqual(["a", "b"]);
});
