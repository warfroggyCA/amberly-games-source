import { expect, it } from "vitest";
import {
  createLeadAssessor,
  createLeadCollection,
  MAX_LEAD_GAMES,
} from "../src/server/lead-standings";
import { createGame, applyCommand, type GameCommand } from "../src/domain/game";
import { releasedFamilyLexicon } from "../src/lib/lexicons";
function fixture(id = "cache-test") {
  const start = createGame({
    id,
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

it("retains progress across 65-game snapshots instead of evicting individual summaries", () => {
  const heads = Array.from({ length: 65 }, (_, i) => fixture(`game-${i}`));
  const actual = createLeadAssessor();
  let coldCalls = 0;
  const assess = new Proxy(actual, {
    apply(target, that, args) {
      if (!args[3]) coldCalls++;
      return Reflect.apply(target, that, args);
    },
  });
  const run = () => {
    const collection = createLeadCollection("family", assess, () => 0);
    heads.forEach((h) => collection.add(h, h.state.events));
    return collection.finish();
  };
  expect(run().eligibleGames).toBe(65);
  expect(coldCalls).toBe(65);
  coldCalls = 0;
  expect(run().eligibleGames).toBe(65);
  expect(coldCalls).toBe(0);
});
it("reports deferred verification separately and continues from verified summaries on explicit reload", () => {
  const assess = createLeadAssessor();
  const heads = [fixture("one"), fixture("two"), fixture("three")];
  let calls = 0;
  const first = createLeadCollection("family", assess, () =>
    calls++ < 2 ? 0 : 1001,
  );
  heads.forEach((h) => first.add(h, h.state.events));
  expect(first.finish()).toMatchObject({
    completedGames: 3,
    eligibleGames: 1,
    pendingGames: 2,
    unavailableGames: 0,
  });
  const second = createLeadCollection("family", assess, () => 0);
  heads.forEach((h) => second.add(h, h.state.events));
  const all = second.finish();
  expect(all).toMatchObject({
    completedGames: 3,
    eligibleGames: 3,
    pendingGames: 0,
  });
  expect(all.rows[0]).toMatchObject({ eligibleGames: 3, eligibleTurns: 12 });
});

it("reports a hard capacity boundary instead of promising endless partial verification", () => {
  const head = fixture();
  const collection = createLeadCollection(
    "capacity",
    createLeadAssessor(),
    () => 0,
  );
  for (let i = 0; i < MAX_LEAD_GAMES; i++)
    collection.add({ ...head, game_id: `capacity-${i}` }, head.state.events);
  expect(() =>
    collection.add({ ...head, game_id: "overflow" }, head.state.events),
  ).toThrow(/5,000/);
});

it("an unchanged invalid journal cannot starve later verification, and changed evidence is rechecked", () => {
  const assess = createLeadAssessor();
  const bad = structuredClone(fixture("bad")),
    good = fixture("good");
  bad.state.scores.a = 1;
  let clock = 0;
  const first = createLeadCollection("family", assess, () =>
    clock++ < 2 ? 0 : 1001,
  );
  for (const h of [bad, good]) first.add(h, h.state.events);
  expect(first.finish()).toMatchObject({
    unavailableGames: 1,
    pendingGames: 1,
    eligibleGames: 0,
  });
  const next = createLeadCollection("family", assess, () => 0);
  for (const h of [bad, good]) next.add(h, h.state.events);
  expect(next.finish()).toMatchObject({
    unavailableGames: 1,
    pendingGames: 0,
    eligibleGames: 1,
  });
  const repaired = fixture("bad");
  expect(assess("family", repaired, repaired.state.events).outcome).toBe(
    "eligible",
  );
});

it("an unavailable bundled dictionary cannot starve the next known-version game", () => {
  const assess = createLeadAssessor();
  const bad = structuredClone(fixture("unknown")),
    good = fixture("known");
  const lexicon = { ...bad.state.lexicon, id: "unavailable-version" };
  bad.definition = { ...bad.definition, lexicon };
  bad.state = { ...bad.state, lexicon, definition: bad.definition };
  let clock = 0;
  const first = createLeadCollection("family", assess, () =>
    clock++ < 2 ? 0 : 1001,
  );
  for (const h of [bad, good]) first.add(h, h.state.events);
  expect(first.finish()).toMatchObject({
    unavailableGames: 1,
    pendingGames: 1,
    eligibleGames: 0,
  });
  const next = createLeadCollection("family", assess, () => 0);
  for (const h of [bad, good]) next.add(h, h.state.events);
  expect(next.finish()).toMatchObject({
    unavailableGames: 1,
    pendingGames: 0,
    eligibleGames: 1,
  });
});
