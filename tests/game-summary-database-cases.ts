import { releasedFamilyLexicon } from "../src/lib/lexicons";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { LETTER_COUNTS, type TileSupply } from "../src/domain/board";
import type { GameCommand, PhysicalTile } from "../src/domain/game";
import type { Letter } from "../src/domain/types";
import { competitiveResultEligible } from "../src/domain/records";
import { readFileSync } from "node:fs";
import type { GameState } from "../src/domain/game";
import { isGameSummaryPage } from "../src/lib/game-summary";
import type { SharedOperation } from "../src/lib/shared-contract";
import { testLexicon } from "../src/lib/test-lexicon";
import { createGameSummaryRepository } from "../src/server/game-summary-repository";
import { createSharedRepository } from "../src/server/shared-repository";

export function gameSummaryDatabaseCases(
  owner: postgres.Sql,
  runtime: postgres.Sql,
) {
  const summary = createGameSummaryRepository(runtime);
  async function fixture(
    emptyBag = false,
    competitive = false,
    catalog: string[] = [],
    realLexicon = false,
    mode: "confirmed" | "practice" = "confirmed",
  ) {
    const reference = realLexicon
      ? releasedFamilyLexicon
      : competitive
        ? { ...testLexicon, status: "ready" as const }
        : testLexicon;
    const repository = createSharedRepository(runtime, {
      defaultLexicon: reference,
      resolveLexicon: () => reference,
    });
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
    for (const word of catalog) {
      const evidence = {
        word,
        source: "merriam-webster",
        sourceUrl: `https://scrabble.merriam.com/finder/${word.toLowerCase()}`,
        verifiedAt: "2026-09-28T00:00:00.000Z",
      };
      await owner`insert into scrabble.verified_words(family_id,word,evidence,verified_by) values(${familyId}::uuid,${word},${owner.json(evidence)},${actor.userId}::uuid)`;
    }
    const created = await mutate({
      type: "create-game",
      id: randomUUID(),
      mode,
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
      mutate,
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

  describe("authorized canonical lead standings", () => {
    async function completed(mode: "confirmed" | "practice" = "confirmed") {
      const f = await fixture(false, true, [], true, mode);
      const first = await f.command({
        type: "play",
        placements: placements("CAT"),
      });
      await f.command({ type: "undo", reason: "Correct setup" });
      await f.command({ type: "play", placements: placements("AT") });
      for (let i = 0; i < 4; i++) await f.command({ type: "pass" });
      await f.command({
        type: "finalize",
        reason: "blocked",
        racks: { alice: rack("READING"), bob: rack("CATDOG?") },
      });
      return {
        ...f,
        original: first,
        leads: () => summary.read(f.actor, f.familyId, { leadCounts: true }),
      };
    }
    it("counts verified canonical history once, including undo, with no paginated/filter denominator", async () => {
      const f = await completed();
      const page = await f.leads();
      expect(page.leadCounts).toMatchObject({
        completedGames: 1,
        eligibleGames: 1,
        unavailableGames: 0,
      });
      expect(
        page.leadCounts!.rows.find((r) => r.playerId === "alice"),
      ).toMatchObject({
        eligibleGames: 1,
        eligibleTurns: 5,
        turnsLed: 5,
        leads: 1,
      });
      expect(
        (
          await summary.read(f.actor, f.familyId, {
            leadCounts: true,
            playerId: "bob",
            gameType: "crokinole",
          })
        ).leadCounts,
      ).toEqual(page.leadCounts);
      expect((await f.leads()).leadCounts).toEqual(page.leadCounts);
      expect((await f.read()).leadCounts).toBeUndefined();
    });
    it("does not count tampered same-revision projections as reliable history", async () => {
      const f = await completed();
      await f.leads();
      await owner`update scrabble.game_heads set state=jsonb_set(state,'{events}','[]'::jsonb) where family_id=${f.familyId}::uuid`;
      expect((await f.leads()).leadCounts).toMatchObject({
        eligibleGames: 0,
        unavailableGames: 1,
      });
    });
    it("clears removed games and forbids a member after access revocation", async () => {
      const f = await completed();
      expect((await f.leads()).leadCounts!.eligibleGames).toBe(1);
      await f.mutate({
        type: "remove-game",
        gameId: f.getGame().id,
        expectedRevision: f.getGame().revision,
        reason: "Remove test game",
      });
      expect((await f.leads()).leadCounts).toMatchObject({
        completedGames: 0,
        eligibleGames: 0,
        rows: [],
      });
      await owner`update scrabble.memberships set active=false where family_id=${f.familyId}::uuid and user_id=${f.actor.userId}::uuid`;
      await expect(f.leads()).rejects.toMatchObject({ status: 403 });
    });
    it("manual full-history reads recheck old disputes even when the game revision is unchanged", async () => {
      const f = await completed();
      const initial = (await f.leads()).leadCounts!;
      const game = f.getGame();
      // The aggregate read is independent of the recent-game window and dates.
      await owner`update scrabble.game_heads set updated_at='2000-01-01' where family_id=${f.familyId}::uuid`;
      const reported = await f.mutate({
        type: "report-protest",
        gameId: game.id,
        reason: "Review an old recorded score",
        reportedFor: null,
      });
      expect((await f.leads()).leadCounts).toMatchObject({
        completedGames: 1,
        eligibleGames: 0,
        excludedGames: 1,
      });
      await f.mutate({
        type: "resolve-protest",
        gameId: game.id,
        protestId: reported.gameAccess!.protests[0].id,
        outcome: "dismissed",
        reason: "Original history confirmed",
      });
      expect((await f.leads()).leadCounts).toEqual(initial);
      expect(f.getGame().revision).toBe(game.revision);
    });
    it("rejects old finalized edits and refuses mismatched newer heads instead of warmed totals", async () => {
      const f = await completed();
      const game = f.getGame();
      const initial = (await f.leads()).leadCounts!;
      await expect(
        f.command({ type: "undo", reason: "Late undo" }),
      ).rejects.toMatchObject({ code: "GAME_FINALIZED" });
      await expect(
        f.command({
          type: "edit-turn",
          turnId: game.turns[0].id,
          placements: placements("CAT"),
          reason: "Late correction",
        }),
      ).rejects.toMatchObject({ code: "GAME_FINALIZED" });
      const changed = JSON.parse(JSON.stringify(game));
      changed.revision++;
      changed.scores.alice++;
      await owner`update scrabble.game_heads set state=${owner.json(changed)},revision=${changed.revision},updated_at='2000-01-01' where family_id=${f.familyId}::uuid and game_id=${game.id}`;
      expect((await f.leads()).leadCounts).toMatchObject({
        eligibleGames: 0,
        unavailableGames: 1,
      });
      await owner`update scrabble.game_heads set state=${owner.json(JSON.parse(JSON.stringify(game)))},revision=${game.revision} where family_id=${f.familyId}::uuid and game_id=${game.id}`;
      expect((await f.leads()).leadCounts).toEqual(initial);
    });
    it("aborted authorized lead reads reject and leave subsequent reads usable", async () => {
      const f = await completed();
      await expect(
        summary.read(f.actor, f.familyId, {
          leadCounts: true,
          signal: AbortSignal.abort(),
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect((await f.leads()).leadCounts!.eligibleGames).toBe(1);
    });
    it("excludes practice even for its admin, and cannot read another family", async () => {
      const f = await completed("practice");
      expect((await f.leads()).leadCounts!.completedGames).toBe(0);
      await expect(
        summary.read(f.actor, randomUUID(), { leadCounts: true }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("reports policy-excluded early games separately from unavailable journals", async () => {
      const f = await fixture(false, true, [], true);
      await f.command({
        type: "finalize",
        reason: "early",
        racks: { alice: rack("READING"), bob: rack("CATDOG?") },
      });
      expect(
        (await summary.read(f.actor, f.familyId, { leadCounts: true }))
          .leadCounts,
      ).toMatchObject({
        completedGames: 1,
        eligibleGames: 0,
        excludedGames: 1,
        unavailableGames: 0,
      });
    });
  });
  describe("combined Scrabble history scores", () => {
    it("persists historical corrections with later plays and original audit", async () => {
      const f = await fixture();
      const first = await f.command({
        type: "play",
        placements: placements("CAT"),
      });
      await f.command({
        type: "play",
        placements: [{ row: 7, col: 10, tile: { letter: "S", blank: false } }],
      });
      const corrected = await f.command({
        type: "edit-turn",
        turnId: first.turns[0].id,
        placements: placements("CAT").map((p, i) =>
          i === 0 ? { ...p, tile: { ...p.tile, blank: true } } : p,
        ),
        reason: "Blank correction",
      });
      expect(corrected.turns).toHaveLength(2);
      expect(corrected.events[0]).toEqual(first.events[0]);
      expect((await f.read()).games[0].totals).toEqual(corrected.scores);
    });
    it("counts completed competitive wins independently of history filters", async () => {
      const f = await fixture(false, true);
      for (let i = 0; i < 4; i++) await f.command({ type: "pass" });
      const g = await f.command({
        type: "finalize",
        reason: "blocked",
        racks: { alice: rack("CATDOG?"), bob: rack("READING") },
      });
      const result = await f.read();
      expect(result.standings).toHaveLength(2);
      for (const row of result.standings!) {
        expect(row.played).toBe(1);
        expect(row.wins).toBe(
          g.result!.winnerIds.includes(row.playerId) ? 1 : 0,
        );
      }
      expect(
        (await summary.read(f.actor, f.familyId, { playerId: "nobody" }))
          .standings,
      ).toEqual(result.standings);
    });
    it("counts qualifying games that inherit or play verified family additions", async () => {
      for (const play of [null, "TOAD"]) {
        const f = await fixture(false, true, ["ZAX", "TOAD"]);
        // Both non-base additions are imported into the journal at creation.
        expect(f.getGame().verifiedWords?.map((v) => v.word)).toEqual([
          "TOAD",
          "ZAX",
        ]);
        if (play)
          await f.command({ type: "play", placements: placements(play) });
        for (let i = 0; i < 4; i++) await f.command({ type: "pass" });
        const g = await f.command({
          type: "finalize",
          reason: "blocked",
          racks: { alice: rack("CATDOG?"), bob: rack("READING") },
        });
        expect(g.result!.competitiveEligible).toBe(true);
        // Domain eligibility and the standings query must agree.
        expect(competitiveResultEligible(g)).toBe(true);
        const result = await f.read();
        expect(result.standings).toHaveLength(2);
        for (const row of result.standings!) expect(row.played).toBe(1);
      }
    });
    it("applies each result's recorded eligibility rules to legacy journals", async () => {
      // Parent-commit journals, inserted as they would exist in older databases.
      const { games } = JSON.parse(
        readFileSync(
          new URL("./fixtures/legacy-finalized-games.json", import.meta.url),
          "utf8",
        ),
      ) as { games: Record<string, GameState> };
      const f = await fixture(false, true);
      for (const state of Object.values(games)) {
        await owner`insert into scrabble.game_definitions(family_id,game_id,mode,definition,created_by) values(${f.familyId}::uuid,${state.id},'confirmed',${owner.json(JSON.parse(JSON.stringify(state.definition)))},${f.actor.userId}::uuid)`;
        await owner`insert into scrabble.game_heads(family_id,game_id,revision,state,scorer_user_id,scorer_device_id,scorer_device_hash) values(${f.familyId}::uuid,${state.id},${state.revision},${owner.json(JSON.parse(JSON.stringify(state)))},${f.actor.userId}::uuid,'legacy-device',${"b".repeat(64)})`;
      }
      const counted = Object.values(games).filter(competitiveResultEligible);
      expect(counted.map((g) => g.id)).toEqual(["legacy-plain"]);
      const standings = (await f.read()).standings!;
      expect(standings.map((r) => [r.playerId, r.played])).toEqual([
        ["a", counted.length],
        ["b", counted.length],
      ]);
    });
    it("keeps standings aligned with domain eligibility for excluded games", async () => {
      const f = await fixture(false, true, ["ZAX"]);
      await f.command({ type: "play", placements: placements("AT") });
      const g = await f.command({
        type: "finalize",
        reason: "early",
        racks: { alice: rack("QZJXKFH"), bob: rack("EEEEEEE") },
      });
      expect(competitiveResultEligible(g)).toBe(false);
      expect((await f.read()).standings).toEqual([]);
    });
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
