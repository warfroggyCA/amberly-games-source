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
    return collection.finish((id) => heads.find((h) => h.game_id === id)!);
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
  expect(
    first.finish((id) => heads.find((h) => h.game_id === id)!),
  ).toMatchObject({
    completedGames: 3,
    eligibleGames: 1,
    pendingGames: 2,
    unavailableGames: 0,
  });
  const second = createLeadCollection("family", assess, () => 0);
  heads.forEach((h) => second.add(h, h.state.events));
  const all = second.finish((id) => heads.find((h) => h.game_id === id)!);
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
  expect(
    first.finish((id) => [bad, good].find((h) => h.game_id === id)!),
  ).toMatchObject({
    unavailableGames: 1,
    pendingGames: 1,
    eligibleGames: 0,
  });
  const next = createLeadCollection("family", assess, () => 0);
  for (const h of [bad, good]) next.add(h, h.state.events);
  expect(
    next.finish((id) => [bad, good].find((h) => h.game_id === id)!),
  ).toMatchObject({
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
  expect(
    first.finish((id) => [bad, good].find((h) => h.game_id === id)!),
  ).toMatchObject({
    unavailableGames: 1,
    pendingGames: 1,
    eligibleGames: 0,
  });
  const next = createLeadCollection("family", assess, () => 0);
  for (const h of [bad, good]) next.add(h, h.state.events);
  expect(
    next.finish((id) => [bad, good].find((h) => h.game_id === id)!),
  ).toMatchObject({
    unavailableGames: 1,
    pendingGames: 0,
    eligibleGames: 1,
  });
});

it("cooperative assessments match exact synchronous results and cancellation cannot poison the cache", async () => {
  const assess = createLeadAssessor(),
    head = fixture("cooperative");
  const controller = new AbortController();
  const cancelled = assess.cooperatively(
    "family",
    head,
    head.state.events,
    controller.signal,
  );
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  expect(assess("family", head, head.state.events, true)).toBeNull();
  expect(await assess.cooperatively("family", head, head.state.events)).toEqual(
    createLeadAssessor()("family", head, head.state.events),
  );
  const changed = structuredClone(head);
  changed.state.scores.a = 999;
  expect(
    await assess.cooperatively("family", changed, changed.state.events),
  ).toMatchObject({ outcome: "unavailable" });
  expect(
    await assess.cooperatively("family", head, head.state.events),
  ).toMatchObject({ outcome: "eligible" });
});
it("cooperative collection preserves coverage and rejects aborted warm reads", async () => {
  const assess = createLeadAssessor();
  const heads = [fixture("first"), fixture("second")];
  let calls = 0;
  const partial = createLeadCollection("family", assess, () =>
    calls++ < 5 ? 0 : 1001,
  );
  heads.forEach((h) => partial.add(h, h.state.events));
  expect(
    await partial.finishCooperatively(async (ids) =>
      heads.filter((h) => ids.includes(h.game_id)),
    ),
  ).toMatchObject({
    eligibleGames: 1,
    pendingGames: 1,
  });
  const all = createLeadCollection("family", assess, () => 0);
  heads.forEach((h) => all.add(h, h.state.events));
  expect(
    await all.finishCooperatively(async (ids) =>
      heads.filter((h) => ids.includes(h.game_id)),
    ),
  ).toMatchObject({
    eligibleGames: 2,
    pendingGames: 0,
  });
  const cached = createLeadCollection("family", assess, () => 0);
  heads.forEach((h) => cached.add(h, h.state.events));
  await expect(
    cached.finishCooperatively(async () => {
      throw Error("Unexpected reload");
    }, AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("changed canonical revisions replace warmed metrics using corrected effective turns", async () => {
  const initial = fixture("older-corrected-game"),
    assess = createLeadAssessor();
  expect(
    (await assess.cooperatively("family", initial, initial.state.events)).counts
      ?.players[0].turnsLed,
  ).toBe(0);
  const created = createGame(initial.definition);
  if (!created.ok) throw Error(created.error.message);
  let game = created.game;
  const act = (payload: Record<string, unknown>) => {
    const next = applyCommand(
      game,
      {
        ...payload,
        id: `changed-${game.revision}`,
        expectedRevision: game.revision,
      } as GameCommand,
      releasedFamilyLexicon,
    );
    if (!next.ok) throw Error(next.error.message);
    game = next.game;
  };
  const cat = [..."CAT"].map((letter, i) => ({
    row: 7,
    col: 7 + i,
    tile: { letter, blank: false },
  }));
  act({ type: "play", placements: cat });
  act({
    type: "play",
    placements: [{ row: 7, col: 10, tile: { letter: "S", blank: false } }],
  });
  act({
    type: "edit-turn",
    turnId: "changed-0",
    placements: cat.map((p, i) =>
      i === 0 ? { ...p, tile: { ...p.tile, blank: true } } : p,
    ),
    reason: "Physical blank",
  });
  act({ type: "undo", reason: "Withdraw last play" });
  act({ type: "exchange", count: 2 });
  for (let i = 0; i < 4; i++) act({ type: "pass" });
  act({
    type: "finalize",
    reason: "blocked",
    racks: { a: [..."READING"], b: [..."CATDOG?"] },
  });
  const changed = { ...initial, state: game, revision: game.revision };
  const result = await assess.cooperatively("family", changed, game.events);
  expect(result).toMatchObject({
    outcome: "eligible",
    counts: { completedTurns: 6 },
  });
  expect(result.counts?.players[0]).toMatchObject({ entries: 1, turnsLed: 6 });
  expect(await assess.cooperatively("family", changed, game.events)).toEqual(
    result,
  );
});

it.each([undefined, null, {}, [null], [{ id: "a" }, null, { id: 7 }]])(
  "malformed definition players remain an unavailable history, not a failed collection (%j)",
  async (players) => {
    const head = fixture("malformed-players");
    head.definition = {
      ...head.definition,
      players: players as typeof head.definition.players,
    };
    head.state = { ...head.state, definition: head.definition };
    const assess = createLeadAssessor();
    const collection = createLeadCollection(
      "malformed-family",
      assess,
      () => 0,
    );
    expect(() => collection.add(head, head.state.events)).not.toThrow();
    expect(
      await collection.finishCooperatively(async () => [head]),
    ).toMatchObject({
      completedGames: 1,
      unavailableGames: 1,
      eligibleGames: 0,
    });
    const warm = createLeadCollection("malformed-family", assess, () => 0);
    warm.add(head, head.state.events);
    expect(
      await warm.finishCooperatively(async () => {
        throw Error("Unavailable cache should be reused");
      }),
    ).toMatchObject({ unavailableGames: 1 });
  },
);

it("missing or stale cold reloads fail without caching fabricated results", async () => {
  for (const missing of [true, false]) {
    const head = fixture("reload-guard");
    const assess = createLeadAssessor();
    const collection = createLeadCollection("reload-family", assess, () => 0);
    collection.add(head, head.state.events);
    await expect(
      collection.finishCooperatively(async () =>
        missing ? [] : [{ ...head, revision: head.revision + 1 }],
      ),
    ).rejects.toThrow("snapshot changed");
    expect(assess("reload-family", head, head.state.events, true)).toBeNull();
  }
});

it("abort during a cold reload cannot cache an unavailable assessment", async () => {
  const head = fixture("reload-abort");
  const assess = createLeadAssessor();
  const collection = createLeadCollection("abort-family", assess, () => 0);
  collection.add(head, head.state.events);
  const controller = new AbortController();
  await expect(
    collection.finishCooperatively(async () => {
      controller.abort();
      return [head];
    }, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(assess("abort-family", head, head.state.events, true)).toBeNull();
});
