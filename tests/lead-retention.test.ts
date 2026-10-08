import { expect, it, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import type postgres from "postgres";
import type { GameState } from "../src/domain/game";
import {
  createLeadAssessor,
  createLeadCollection,
  readLeadStandings,
} from "../src/server/lead-standings";

async function collect() {
  await setImmediate(); // WeakRefs keep targets alive until the current job ends.
  expect(global.gc).toBeTypeOf("function");
  global.gc!();
}

it("5,000 deferred games retain no full heads or embedded journals", async () => {
  const assess = Object.assign(
    vi.fn(() => null),
    {
      retain: vi.fn(),
      cooperatively: vi.fn(),
    },
  ) as unknown as ReturnType<typeof createLeadAssessor>;
  let clock = 0;
  const collection = createLeadCollection("retention", assess, () =>
    clock++ ? 1001 : 0,
  );
  const refs: WeakRef<object>[] = [];
  function populate() {
    for (let i = 0; i < 5000; i++) {
      const events = Array.from({ length: 100 }, (_, sequence) => ({
        sequence,
      }));
      const head = {
        game_id: `game-${i}`,
        revision: 100,
        disputed: false,
        definition: { players: [{ id: "a" }, { id: "b" }] },
        state: { events },
      } as unknown as Parameters<typeof collection.add>[0];
      refs.push(
        new WeakRef(head),
        new WeakRef(head.state),
        new WeakRef(events),
      );
      collection.add(head, events);
    }
  }
  populate();
  // Mock call records must not themselves retain the input heads.
  vi.mocked(assess).mockClear();
  await collect();
  expect(refs.filter((r) => r.deref())).toHaveLength(0);
  const reload = vi.fn(async () => {
    throw Error("Budget-expired work must not load heads");
  });
  expect(await collection.finishCooperatively(reload)).toMatchObject({
    completedGames: 5000,
    pendingGames: 5000,
    eligibleGames: 0,
  });
  expect(reload).not.toHaveBeenCalled();
});

function transaction(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `game-${i}`);
  const refs: WeakRef<object>[] = [];
  const batches: number[] = [];
  let selections = 0;
  const tx = async (
    parts: TemplateStringsArray | string[],
    ...values: unknown[]
  ) => {
    if (!("raw" in parts)) return parts;
    const query = parts.join("?");
    if (query.includes("limit 5001")) {
      selections++;
      expect(query.split("from scrabble.game_definitions")[0].trim()).toBe(
        "select d.game_id",
      );
      return ids.map((game_id) => ({ game_id }));
    }
    if (query.includes("select game_id,event")) return [];
    if (query.includes("select d.game_id,d.definition,h.state")) {
      const batch = (await values[1]) as string[];
      expect(batch.length).toBeLessThanOrEqual(25);
      await collect();
      // At a query boundary the previous batch may still be on its caller's
      // async stack, but older full states must be reclaimable.
      expect(refs.filter((r) => r.deref()).length).toBeLessThanOrEqual(25);
      batches.push(batch.length);
      return batch.map((game_id) => {
        const state = {
          events: Array.from({ length: 1000 }, (_, sequence) => ({ sequence })),
        } as unknown as GameState;
        refs.push(new WeakRef(state));
        return {
          game_id,
          definition: { players: [{ id: "a" }] },
          state,
          revision: 1000,
          disputed: true,
        };
      });
    }
    throw Error("Unexpected query");
  };
  return {
    tx: tx as unknown as postgres.TransactionSql,
    batches,
    refs,
    selections: () => selections,
  };
}

it("rejects 5,001 candidates before requesting any full states or journals", async () => {
  const db = transaction(5001);
  await expect(readLeadStandings(db.tx, "over-capacity")).rejects.toMatchObject(
    { code: "LEAD_CAPACITY" },
  );
  expect(db.selections()).toBe(1);
  expect(db.batches).toEqual([]);
});

it("5,000 candidate reads release old full-state batches", async () => {
  const db = transaction(5000);
  expect(await readLeadStandings(db.tx, "bounded-candidates")).toMatchObject({
    completedGames: 5000,
    excludedGames: 5000,
  });
  expect(db.batches).toHaveLength(200);
  await collect();
  expect(db.refs.filter((r) => r.deref())).toHaveLength(0);
}, 30000);

it("cold reloads stay batched and slow SQL does not starve continuation", async () => {
  let clock = 0;
  const assess = Object.assign(() => null, {
    retain: () => {},
    cooperatively: async (
      _family: string,
      head: { game_id: string; revision: number },
    ) => {
      clock += 600;
      return {
        gameId: head.game_id,
        revision: head.revision,
        playerIds: ["a"],
        outcome: "unavailable" as const,
      };
    },
  }) as unknown as ReturnType<typeof createLeadAssessor>;
  const collection = createLeadCollection("slow-reload", assess, () => clock);
  const make = (game_id: string) =>
    ({
      game_id,
      revision: 1,
      disputed: false,
      definition: { players: [{ id: "a" }] },
      state: { events: [] },
    }) as unknown as Parameters<typeof collection.add>[0];
  for (let i = 0; i < 5000; i++) collection.add(make(`game-${i}`), []);
  const reload = vi.fn(async (ids: string[]) => {
    expect(ids).toHaveLength(25);
    clock += 5000; // Database wait exceeds the validation budget.
    return ids.map(make);
  });
  expect(await collection.finishCooperatively(reload)).toMatchObject({
    completedGames: 5000,
    unavailableGames: 2,
    pendingGames: 4998,
  });
  expect(reload).toHaveBeenCalledTimes(1);
});
