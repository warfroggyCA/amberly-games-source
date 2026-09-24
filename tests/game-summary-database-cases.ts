import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { LETTER_COUNTS, type TileSupply } from "../src/domain/board";
import type { GameCommand, PhysicalTile } from "../src/domain/game";
import type { Letter } from "../src/domain/types";
import { isGameSummaryPage } from "../src/lib/game-summary";
import type { SharedOperation } from "../src/lib/shared-contract";
import { testLexicon } from "../src/lib/test-lexicon";
import { createGameSummaryRepository } from "../src/server/game-summary-repository";
import { createSharedRepository } from "../src/server/shared-repository";

export function gameSummaryDatabaseCases(
  owner: postgres.Sql,
  runtime: postgres.Sql,
) {
  const repository = createSharedRepository(runtime, {
    defaultLexicon: testLexicon,
    resolveLexicon: () => testLexicon,
  });
  const summary = createGameSummaryRepository(runtime);
  async function fixture(emptyBag = false) {
    const familyId = randomUUID();
    const actor = {
      userId: randomUUID(),
      email: "summary@example.test",
      emailVerified: true as const,
      deviceHash: "a".repeat(64),
    };
    await owner`insert into scrabble.families(id,name) values(${familyId}::uuid,'Summary fixtures')`;
    await owner`insert into scrabble.memberships(family_id,user_id,email,role) values(${familyId}::uuid,${actor.userId}::uuid,${actor.email},'superadmin')`;
    const mutate = (operation: SharedOperation) =>
      repository.mutate(actor, familyId, {
        requestId: randomUUID(),
        operation,
      });
    await mutate({
      type: "create-player",
      id: "alice",
      profile: { name: "Alice" },
    });
    await mutate({
      type: "create-player",
      id: "bob",
      profile: { name: "Bob" },
    });
    if (emptyBag) {
      const counts = Object.fromEntries(
        Object.keys(LETTER_COUNTS).map((letter) => [letter, 0]),
      ) as Record<PhysicalTile, number>;
      for (const letter of "READINGCATSOU?") counts[letter as PhysicalTile]++;
      await mutate({
        type: "save-equipment",
        expectedRevision: 0,
        equipment: {
          revision: 1,
          defaultSetId: "small",
          sets: [
            {
              id: "small",
              name: "Small fixture set",
              counts: counts as TileSupply,
              checkedAt: null,
            },
          ],
        },
      });
    }
    const created = await mutate({
      type: "create-game",
      id: randomUUID(),
      mode: "confirmed",
      players: [
        { id: "alice", seat: 0 },
        { id: "bob", seat: 2 },
      ],
      firstPlayerId: "alice",
      direction: "clockwise",
      deviceId: "summary-device",
      ...(emptyBag ? { tileSet: { id: "small", revision: 1 } } : {}),
    });
    let game = created.game!;
    type Action = GameCommand extends infer C
      ? C extends GameCommand
        ? Omit<C, "id" | "expectedRevision">
        : never
      : never;
    async function command(action: Action) {
      const saved = await mutate({
        type: "game-commands",
        gameId: game.id,
        deviceId: "summary-device",
        generation: 1,
        commands: [
          {
            ...action,
            id: randomUUID(),
            expectedRevision: game.revision,
          } as GameCommand,
        ],
      });
      game = saved.game!;
      return game;
    }
    return {
      familyId,
      actor,
      command,
      getGame: () => game,
      read: () => summary.read(actor, familyId),
    };
  }
  const rack = (letters: string) => letters.split("") as PhysicalTile[];
  const placements = (word: string) =>
    [...word].map((letter, index) => ({
      row: 7,
      col: 7 + index,
      tile: { letter: letter as Letter, blank: false },
    }));

  describe("combined Scrabble history scores", () => {
    it("shows rack deductions and the changed winner after an early ending", async () => {
      const f = await fixture();
      await f.command({ type: "play", placements: placements("AT") });
      const game = await f.command({
        type: "finalize",
        reason: "early",
        racks: { alice: rack("QZJXKFH"), bob: rack("EEEEEEE") },
      });
      expect(game.scores).toEqual({ alice: 4, bob: 0 });
      expect(game.result!.scores).toEqual({ alice: -45, bob: -7 });
      const page = await f.read();
      expect(isGameSummaryPage(page)).toBe(true);
      expect(page.games[0]).toMatchObject({
        totals: { alice: -45, bob: -7 },
        winnerIds: ["bob"],
        status: "finalized",
      });
    });
    it.each(["natural", "assisted"] as const)(
      "shows the %s rack-out result and applicable transfer",
      async (reason) => {
        const f = await fixture(reason === "natural");
        if (reason === "assisted")
          await f.command({
            type: "assist",
            racks: { alice: rack("READING"), bob: rack("CATSOU?") },
          });
        await f.command({ type: "play", placements: placements("READING") });
        const game = await f.command({
          type: "finalize",
          reason,
          racks: { alice: [], bob: rack("CATSOU?") },
        });
        const totals = { alice: reason === "natural" ? 78 : 70, bob: -8 };
        expect(game.result!.scores).toEqual(totals);
        expect((await f.read()).games[0]).toMatchObject({
          totals,
          winnerIds: ["alice"],
        });
      },
    );
    it("preserves tied final scores after a blocked ending", async () => {
      const f = await fixture();
      for (let index = 0; index < 4; index++) await f.command({ type: "pass" });
      const game = await f.command({
        type: "finalize",
        reason: "blocked",
        racks: { alice: rack("AAAAAAA"), bob: rack("EEEEEEE") },
      });
      expect(game.result!.scores).toEqual({ alice: -7, bob: -7 });
      expect((await f.read()).games[0]).toMatchObject({
        totals: { alice: -7, bob: -7 },
        winnerIds: ["alice", "bob"],
      });
    });
    it.each(["active", "paused"] as const)(
      "retains running totals for %s games without a final result",
      async (status) => {
        const f = await fixture();
        await f.command({ type: "play", placements: placements("AT") });
        if (status === "paused") await f.command({ type: "pause" });
        expect(f.getGame().result).toBeNull();
        expect((await f.read()).games[0]).toMatchObject({
          totals: { alice: 4, bob: 0 },
          winnerIds: [],
          status,
        });
      },
    );
    it("does not substitute running scores for a malformed finalized result", async () => {
      const f = await fixture();
      const game = await f.command({
        type: "finalize",
        reason: "early",
        racks: { alice: rack("AAAAAAA"), bob: rack("EEEEEEE") },
      });
      // Operator-only corruption fixture; normal commands never produce this state.
      await owner`update scrabble.game_heads set state=state #- '{result,scores}' where family_id=${f.familyId}::uuid and game_id=${game.id}`;
      const page = await f.read();
      expect(page.games[0].totals).toBeNull();
      expect(isGameSummaryPage(page)).toBe(false);
    });
  });
}
