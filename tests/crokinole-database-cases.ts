import { createGameSummaryRepository } from "../src/server/game-summary-repository";
import { createSharedRepository } from "../src/server/shared-repository";
import { testLexicon } from "../src/lib/test-lexicon";
import { DEFAULT_CROKINOLE_SETTINGS } from "../src/domain/crokinole-defaults";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { describe, it, expect } from "vitest";
import { createCrokinoleRepository } from "../src/server/crokinole-repository";
import {
  DEFAULT_PIECE_COLOURS,
  type CrokinoleDefinition,
} from "../src/domain/crokinole";
import type { CrokinoleOperation } from "../src/lib/crokinole-contract";
import type { VerifiedActor } from "../src/lib/shared-contract";
export function crokinoleDatabaseCases(
  owner: postgres.Sql,
  runtime: postgres.Sql,
) {
  const repo = createCrokinoleRepository(runtime, { enabled: true });
  async function fixture() {
    const familyId = randomUUID();
    const actor = (prefix: string): VerifiedActor => ({
      userId: randomUUID(),
      email: prefix + "@example.test",
      emailVerified: true,
    });
    const admin = actor("owner"),
      member = actor("member");
    await owner`insert into scrabble.families(id,name) values(${familyId},'Crokinole test')`;
    await owner`insert into scrabble.memberships(family_id,user_id,email,role) values(${familyId},${admin.userId},${admin.email},'superadmin'),(${familyId},${member.userId},${member.email},'member')`;
    await owner`insert into scrabble.players(family_id,id,name) values(${familyId},'ada','Ada'),(${familyId},'ben','Ben')`;
    const definition: CrokinoleDefinition = {
      schemaVersion: 1,
      rulesVersion: 1,
      id: randomUUID(),
      familyId,
      mode: "confirmed",
      createdAt: new Date().toISOString(),
      players: [
        { id: "ada", name: "Ada", seatOrder: 0 },
        { id: "ben", name: "Ben", seatOrder: 1 },
      ],
      participants: ["ada", "ben"].map((id, i) => ({
        id,
        name: i ? "Ben" : "Ada",
        playerIds: [id],
        colour: {
          id: DEFAULT_PIECE_COLOURS[i].id,
          name: DEFAULT_PIECE_COLOURS[i].name,
          value: DEFAULT_PIECE_COLOURS[i].value,
        },
      })),
      format: "singles",
      scoringMode: "cumulative_round_totals",
      endCondition: { type: "fixed_rounds", rounds: 4 },
      initialStartingPlayerId: "ada",
    };
    const mutate = (
      operation: CrokinoleOperation,
      who = admin,
      requestId = randomUUID(),
    ) => repo.mutate(who, familyId, { requestId, operation });
    return { familyId, admin, member, definition, mutate };
  }
  describe("Crokinole shared PostgreSQL boundaries", () => {
    it("shares family defaults, protects permission and revisions, preserves old games and colours", async () => {
      const f = await fixture();
      const created = await f.mutate({
        type: "create-game",
        definition: f.definition,
        paletteRevision: 0,
      });
      const op = {
        type: "save-defaults" as const,
        expectedRevision: 0,
        defaults: DEFAULT_CROKINOLE_SETTINGS,
      };
      await owner`update scrabble.memberships set permissions='{"manageEquipment":false}'::jsonb where family_id=${f.familyId} and user_id=${f.member.userId}`;
      await expect(f.mutate(op, f.member)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      const requestId = randomUUID();
      await f.mutate(op, f.admin, requestId);
      expect((await f.mutate(op, f.admin, requestId)).replayed).toBe(true);
      await expect(f.mutate(op)).rejects.toMatchObject({
        code: "REVISION_CONFLICT",
      });
      const read = await repo.readState(f.member, f.familyId, {
        gameId: f.definition.id,
      });
      expect(read.palette.defaults).toEqual(DEFAULT_CROKINOLE_SETTINGS);
      expect(read.games[0].definition).toEqual(created.game!.definition);
      await f.mutate({
        type: "save-palette",
        expectedRevision: 1,
        colours: DEFAULT_PIECE_COLOURS,
      });
      expect(
        (await repo.readState(f.member, f.familyId, {})).palette.defaults,
      ).toEqual(DEFAULT_CROKINOLE_SETTINGS);
    });

    it("atomically records a round, retries once, checks revisions and restores shared history", async () => {
      const f = await fixture();
      await f.mutate({
        type: "create-game",
        definition: f.definition,
        paletteRevision: 0,
      });
      const operation: CrokinoleOperation = {
        type: "command",
        gameId: f.definition.id,
        generation: 1,
        expectedDraftRevision: 0,
        command: {
          id: randomUUID(),
          expectedRevision: 0,
          type: "record_round",
          roundId: randomUUID(),
          entries: [
            { participantId: "ada", rawScore: 65 },
            { participantId: "ben", rawScore: 40 },
          ],
        },
      };
      const requestId = randomUUID();
      const saved = await f.mutate(operation, f.admin, requestId);
      expect(saved.game?.totals).toEqual({ ada: 65, ben: 40 });
      expect((await f.mutate(operation, f.admin, requestId)).replayed).toBe(
        true,
      );
      expect(
        (
          await repo.readState(f.member, f.familyId, {
            gameId: f.definition.id,
          })
        ).games[0].rounds,
      ).toHaveLength(1);
      await expect(
        f.mutate({
          ...operation,
          command: { ...operation.command, id: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
      await expect(
        f.mutate({ ...operation, generation: 2 }, f.admin, requestId),
      ).rejects.toMatchObject({ code: "REQUEST_REUSED" });
    });
    it("keeps drafts private, detects competing drafts and retires saved drafts", async () => {
      const f = await fixture();
      await f.mutate({
        type: "create-game",
        definition: f.definition,
        paletteRevision: 0,
      });
      const op: CrokinoleOperation = {
        type: "save-draft",
        gameId: f.definition.id,
        generation: 1,
        expectedRevision: 0,
        expectedDraftRevision: 0,
        values: { ada: "65", ben: "" },
        editingRoundId: null,
      };
      const req = randomUUID();
      expect((await f.mutate(op, f.admin, req)).draft?.revision).toBe(1);
      expect((await f.mutate(op, f.admin, req)).draft?.values.ada).toBe("65");
      expect(
        (
          await repo.readState(f.member, f.familyId, {
            gameId: f.definition.id,
          })
        ).draft,
      ).toBeUndefined();
      await expect(f.mutate(op)).rejects.toMatchObject({
        code: "DRAFT_CONFLICT",
      });
      await expect(
        f.mutate({ ...op, expectedDraftRevision: 1 }, f.member),
      ).rejects.toMatchObject({ code: "SCORER_CONFLICT" });
      const saved = await f.mutate({
        type: "command",
        gameId: f.definition.id,
        generation: 1,
        expectedDraftRevision: 1,
        command: {
          id: randomUUID(),
          expectedRevision: 0,
          type: "record_round",
          roundId: randomUUID(),
          entries: [
            { participantId: "ada", rawScore: 0 },
            { participantId: "ben", rawScore: 0 },
          ],
        },
      });
      expect(saved.draft?.revision).toBe(2);
      expect(saved.draft?.values).toEqual({});
      await expect(
        f.mutate({ ...op, expectedDraftRevision: 1 }),
      ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    });
    it("protects private tests on lists, IDs, mutation retries and removal", async () => {
      const f = await fixture();
      f.definition.mode = "practice";
      await expect(
        f.mutate(
          { type: "create-game", definition: f.definition, paletteRevision: 0 },
          f.member,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await f.mutate({
        type: "create-game",
        definition: f.definition,
        paletteRevision: 0,
      });
      expect((await repo.readState(f.member, f.familyId)).games).toEqual([]);
      await expect(
        repo.readState(f.member, f.familyId, { gameId: f.definition.id }),
      ).rejects.toMatchObject({ code: "GAME_NOT_FOUND" });
      await f.mutate({
        type: "delete-practice",
        gameId: f.definition.id,
        expectedRevision: 0,
        reason: "Testing complete",
      });
      expect((await repo.readState(f.admin, f.familyId)).games).toEqual([]);
      expect(
        (
          await owner`select * from scrabble.crokinole_games where family_id=${f.familyId}`
        )[0].removed,
      ).toBe(true);
    });
    it("uses fresh permissions and account ownership, supports safe takeover", async () => {
      const f = await fixture();
      await f.mutate(
        { type: "create-game", definition: f.definition, paletteRevision: 0 },
        f.member,
      );
      const saved = await f.mutate(
        {
          type: "save-draft",
          gameId: f.definition.id,
          generation: 1,
          expectedRevision: 0,
          expectedDraftRevision: 0,
          values: { ada: "5" },
          editingRoundId: null,
        },
        f.member,
      );
      expect(saved.draft?.revision).toBe(1);
      const transferred = await f.mutate({
        type: "take-over",
        gameId: f.definition.id,
        expectedRevision: 0,
        generation: 1,
        reason: "Continue scoring",
      });
      expect(transferred.access?.generation).toBe(2);
      expect(transferred.draft).toBeNull();
      await f.mutate({
        type: "save-draft",
        gameId: f.definition.id,
        generation: 2,
        expectedRevision: 0,
        expectedDraftRevision: 0,
        values: { ada: "10" },
        editingRoundId: null,
      });
      await owner`update scrabble.memberships set permissions='{"scoreGames":false}'::jsonb where family_id=${f.familyId} and user_id=${f.member.userId}`;
      await expect(
        f.mutate(
          {
            type: "take-over",
            gameId: f.definition.id,
            expectedRevision: 0,
            generation: 2,
            reason: "Return",
          },
          f.member,
        ),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    });
    it("gates writes but keeps reads, prevents forged roster and palette data", async () => {
      const f = await fixture();
      await expect(
        createCrokinoleRepository(runtime, { enabled: false }).mutate(
          f.admin,
          f.familyId,
          {
            requestId: randomUUID(),
            operation: {
              type: "create-game",
              definition: f.definition,
              paletteRevision: 0,
            },
          },
        ),
      ).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
      f.definition.players[0].name = "Forged";
      await expect(
        f.mutate({
          type: "create-game",
          definition: f.definition,
          paletteRevision: 0,
        }),
      ).rejects.toMatchObject({ code: "ROSTER_CHANGED" });
      await expect(
        f.mutate({ type: "save-palette", expectedRevision: 0, colours: [] }),
      ).rejects.toMatchObject({ code: "INVALID_PALETTE" });
      expect(
        (
          await createCrokinoleRepository(runtime, {
            enabled: false,
          }).readState(f.admin, f.familyId)
        ).creationEnabled,
      ).toBe(false);
    });

    it("retains correction journals, reopens results and restores undone entry", async () => {
      const f = await fixture();
      f.definition.endCondition = { type: "target", target: 100 };
      await f.mutate({
        type: "create-game",
        definition: f.definition,
        paletteRevision: 0,
      });
      const round1 = randomUUID();
      const round2 = randomUUID();
      await f.mutate({
        type: "command",
        gameId: f.definition.id,
        generation: 1,
        expectedDraftRevision: 0,
        command: {
          id: randomUUID(),
          expectedRevision: 0,
          type: "record_round",
          roundId: round1,
          entries: [
            { participantId: "ada", rawScore: 60 },
            { participantId: "ben", rawScore: 10 },
          ],
        },
      });
      const done = await f.mutate({
        type: "command",
        gameId: f.definition.id,
        generation: 1,
        expectedDraftRevision: 1,
        command: {
          id: randomUUID(),
          expectedRevision: 1,
          type: "record_round",
          roundId: round2,
          entries: [
            { participantId: "ada", rawScore: 40 },
            { participantId: "ben", rawScore: 10 },
          ],
        },
      });
      expect(done.game?.status).toBe("completed");
      const corrected = await f.mutate({
        type: "command",
        gameId: f.definition.id,
        generation: 1,
        expectedDraftRevision: 2,
        amendmentReason: "Misread first round",
        command: {
          id: randomUUID(),
          expectedRevision: 2,
          type: "correct_round",
          roundId: round1,
          entries: [
            { participantId: "ada", rawScore: 20 },
            { participantId: "ben", rawScore: 10 },
          ],
          excludedRoundIds: [],
          reason: "Misread first round",
        },
      });
      expect(corrected.game?.status).toBe("active");
      expect(corrected.game?.totals.ada).toBe(60);
      const undone = await f.mutate({
        type: "command",
        gameId: f.definition.id,
        generation: 1,
        expectedDraftRevision: 3,
        command: { id: randomUUID(), expectedRevision: 3, type: "undo_round" },
      });
      expect(undone.draft?.values).toEqual({ ada: "40", ben: "10" });
      expect(undone.game?.rounds).toHaveLength(1);
      const journal =
        await owner`select * from scrabble.crokinole_events where family_id=${f.familyId}`;
      expect(journal).toHaveLength(4);
      expect(
        (await repo.readState(f.admin, f.familyId, { gameId: f.definition.id }))
          .games[0].totals.ada,
      ).toBe(20);
    });
    it("rejects malformed fields, stale palette, unauthorized exports and cross-family reads", async () => {
      const f = await fixture();
      await expect(
        f.mutate({
          type: "create-game",
          definition: f.definition,
          paletteRevision: 0,
          forged: true,
        } as unknown as CrokinoleOperation),
      ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
      await f.mutate({
        type: "create-game",
        definition: f.definition,
        paletteRevision: 0,
      });
      await expect(
        repo.exportHistory(f.member, f.familyId),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      const other = await fixture();
      await expect(
        repo.readState(f.admin, other.familyId, { gameId: f.definition.id }),
      ).rejects.toMatchObject({ code: "NOT_A_MEMBER" });
      await f.mutate({
        type: "save-palette",
        expectedRevision: 0,
        colours: DEFAULT_PIECE_COLOURS,
      });
      await expect(
        f.mutate({
          type: "save-palette",
          expectedRevision: 0,
          colours: DEFAULT_PIECE_COLOURS,
        }),
      ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      expect(
        (await repo.exportHistory(f.admin, f.familyId)).games,
      ).toHaveLength(1);
    });
    it("serializes competing saves and protects tables against anonymous reads and journal erasure", async () => {
      const f = await fixture();
      await f.mutate({
        type: "create-game",
        definition: f.definition,
        paletteRevision: 0,
      });
      const command = () =>
        f.mutate({
          type: "command",
          gameId: f.definition.id,
          generation: 1,
          expectedDraftRevision: 0,
          command: {
            id: randomUUID(),
            expectedRevision: 0,
            type: "record_round",
            roundId: randomUUID(),
            entries: [
              { participantId: "ada", rawScore: 5 },
              { participantId: "ben", rawScore: 10 },
            ],
          },
        });
      const results = await Promise.allSettled([command(), command()]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (await repo.readState(f.admin, f.familyId, { gameId: f.definition.id }))
          .games[0].rounds,
      ).toHaveLength(1);
      for (const table of [
        "crokinole_games",
        "crokinole_events",
        "crokinole_drafts",
        "crokinole_palette",
        "crokinole_concerns",
      ]) {
        const [grant] =
          await owner`select has_table_privilege('anon',${"scrabble." + table},'select') allowed`;
        expect(grant.allowed).toBe(false);
      }
      await expect(
        owner`delete from scrabble.crokinole_events where family_id=${f.familyId}`,
      ).rejects.toThrow();
      await expect(
        owner`update scrabble.crokinole_games set definition='{}'::jsonb where family_id=${f.familyId}`,
      ).rejects.toThrow();
    });
    it("records concerns with fresh review permission and preserves audit evidence", async () => {
      const f = await fixture();
      await f.mutate({
        type: "create-game",
        definition: f.definition,
        paletteRevision: 0,
      });
      const reported = await f.mutate(
        {
          type: "report-concern",
          gameId: f.definition.id,
          expectedRevision: 0,
          reason: "Wrong participants",
        },
        f.member,
      );
      const concern = reported.access!.concerns[0];
      await expect(
        f.mutate(
          {
            type: "report-concern",
            gameId: f.definition.id,
            expectedRevision: 0,
            reason: "Repeated",
          },
          f.member,
        ),
      ).rejects.toMatchObject({ code: "CONCERN_ALREADY_OPEN" });

      await expect(
        f.mutate(
          {
            type: "resolve-concern",
            gameId: f.definition.id,
            expectedRevision: 0,
            concernId: concern.id,
            outcome: "upheld",
            reason: "Confirmed",
          },
          f.member,
        ),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      const resolved = await f.mutate({
        type: "resolve-concern",
        gameId: f.definition.id,
        expectedRevision: 0,
        concernId: concern.id,
        outcome: "upheld",
        reason: "Confirmed",
      });
      expect(resolved.access!.concerns[0].resolution?.outcome).toBe("upheld");
      for (let i = 0; i < 99; i++) {
        const id = randomUUID();
        await owner`insert into scrabble.crokinole_concerns(family_id,game_id,id,concern) values(${f.familyId},${f.definition.id},${id},${owner.json({ ...resolved.access!.concerns[0], id })})`;
      }
      await expect(
        f.mutate(
          {
            type: "report-concern",
            gameId: f.definition.id,
            expectedRevision: 0,
            reason: "Another concern",
          },
          f.member,
        ),
      ).rejects.toMatchObject({ code: "CONCERN_LIMIT" });

      expect(
        await owner`select * from scrabble.audit where family_id=${f.familyId} and action='crokinole:resolve-concern'`,
      ).toHaveLength(1);
    });

    it("rematches preserved snapshots after roster and palette changes", async () => {
      const f = await fixture();
      f.definition.endCondition = { type: "fixed_rounds", rounds: 1 };
      await f.mutate({
        type: "create-game",
        definition: f.definition,
        paletteRevision: 0,
      });
      await f.mutate({
        type: "command",
        gameId: f.definition.id,
        generation: 1,
        expectedDraftRevision: 0,
        command: {
          id: randomUUID(),
          expectedRevision: 0,
          type: "record_round",
          roundId: randomUUID(),
          entries: [
            { participantId: "ada", rawScore: 5 },
            { participantId: "ben", rawScore: 10 },
          ],
        },
      });
      await owner`update scrabble.players set name='Ada Updated' where family_id=${f.familyId} and id='ada'`;
      await f.mutate({
        type: "save-palette",
        expectedRevision: 0,
        colours: DEFAULT_PIECE_COLOURS.map((c) => ({ ...c, isActive: false })),
      });
      const rematch = await f.mutate({
        type: "rematch",
        gameId: f.definition.id,
        newGameId: randomUUID(),
        expectedRevision: 1,
      });
      expect(rematch.game!.definition.players[0].name).toBe("Ada");
      expect(rematch.game!.definition.participants[0].colour).toEqual(
        f.definition.participants[0].colour,
      );
      expect(rematch.game!.definition.initialStartingPlayerId).toBe("ben");
      expect(rematch.game!.rounds).toHaveLength(0);
      expect(rematch.access!.generation).toBe(1);
      const forged = {
        ...f.definition,
        id: randomUUID(),
        players: f.definition.players.map((p) =>
          p.id === "ada" ? { ...p, name: "Ada Updated" } : p,
        ),
      };
      forged.participants = forged.participants.map((p) => ({
        ...p,
        name: "Forged",
      }));
      await f.mutate({
        type: "save-palette",
        expectedRevision: 1,
        colours: DEFAULT_PIECE_COLOURS,
      });
      await expect(
        f.mutate({
          type: "create-game",
          definition: forged,
          paletteRevision: 2,
        }),
      ).rejects.toMatchObject({ code: "ROSTER_CHANGED" });
    });
    it("paginates tied microsecond timestamps without skipping games", async () => {
      const f = await fixture();
      for (let i = 0; i < 31; i++)
        await f.mutate({
          type: "create-game",
          definition: {
            ...f.definition,
            id: "page-" + String(i).padStart(2, "0"),
          },
          paletteRevision: 0,
        });
      await owner`update scrabble.crokinole_games set created_at='2026-09-17T12:00:00.123456Z'::timestamptz where family_id=${f.familyId}`;
      const first = await repo.readState(f.admin, f.familyId);
      expect(first.games).toHaveLength(30);
      const second = await repo.readState(f.admin, f.familyId, {
        cursor: first.nextCursor!,
      });
      expect(second.games).toHaveLength(1);
      expect(
        new Set([...first.games, ...second.games].map((g) => g.definition.id))
          .size,
      ).toBe(31);
    });

    it("mixed history filters games and players while excluding private and removed games", async () => {
      const f = await fixture();
      const summary = createGameSummaryRepository(runtime);
      const scrabble = createSharedRepository(runtime, {
        defaultLexicon: testLexicon,
        resolveLexicon: () => testLexicon,
      });
      const makeScrabble = async (id: string, mode: "confirmed" | "practice") =>
        scrabble.mutate(
          { ...f.admin, deviceHash: "a".repeat(64) },
          f.familyId,
          {
            requestId: randomUUID(),
            operation: {
              type: "create-game",
              id,
              mode,
              players: [
                { id: "ada", seat: 0 },
                { id: "ben", seat: 2 },
              ],
              firstPlayerId: "ada",
              direction: "clockwise",
              deviceId: "test",
            },
          },
        );
      await makeScrabble("scrabble-public", "confirmed");
      await makeScrabble("scrabble-private", "practice");
      await f.mutate({
        type: "create-game",
        definition: { ...f.definition, id: "crok-public" },
        paletteRevision: 0,
      });
      await f.mutate({
        type: "create-game",
        definition: { ...f.definition, id: "crok-private", mode: "practice" },
        paletteRevision: 0,
      });
      await f.mutate({
        type: "create-game",
        definition: { ...f.definition, id: "crok-removed", mode: "practice" },
        paletteRevision: 0,
      });
      await f.mutate({
        type: "delete-practice",
        gameId: "crok-removed",
        expectedRevision: 0,
        reason: "Finished test",
      });
      const member = await summary.read(f.member, f.familyId);
      expect(member.games.map((g) => g.id).sort()).toEqual([
        "crok-public",
        "scrabble-public",
      ]);
      expect((await summary.read(f.admin, f.familyId)).games).toHaveLength(4);
      expect(
        (
          await summary.read(f.member, f.familyId, {
            gameType: "crokinole",
            playerId: "ada",
          })
        ).games.map((g) => g.id),
      ).toEqual(["crok-public"]);
      expect(
        (await summary.read(f.member, f.familyId, { playerId: "missing" }))
          .games,
      ).toEqual([]);
      await expect(
        summary.read(f.member, f.familyId, { gameType: "bogus" }),
      ).rejects.toMatchObject({ code: "INVALID_FILTER" });
      await owner`update scrabble.memberships set active=false where family_id=${f.familyId} and user_id=${f.member.userId}`;
      await expect(summary.read(f.member, f.familyId)).rejects.toMatchObject({
        code: "NOT_A_MEMBER",
      });
    });
    it("mixed summaries paginate stable game-type and ID ties at full timestamp precision", async () => {
      const f = await fixture();
      const summary = createGameSummaryRepository(runtime);
      const scrabble = createSharedRepository(runtime, {
        defaultLexicon: testLexicon,
        resolveLexicon: () => testLexicon,
      });
      const created = await scrabble.mutate(
        { ...f.admin, deviceHash: "a".repeat(64) },
        f.familyId,
        {
          requestId: randomUUID(),
          operation: {
            type: "create-game",
            id: "shared-id",
            mode: "confirmed",
            players: [
              { id: "ada", seat: 0 },
              { id: "ben", seat: 2 },
            ],
            firstPlayerId: "ada",
            direction: "clockwise",
            deviceId: "test",
          },
        },
      );
      for (let i = 0; i < 31; i++)
        await f.mutate({
          type: "create-game",
          definition: {
            ...f.definition,
            id: i === 0 ? "shared-id" : "mixed-" + i,
          },
          paletteRevision: 0,
        });
      const [scrabbleDate] =
        await owner`select created_at::text stamp from scrabble.game_definitions where family_id=${f.familyId} and game_id=${created.game!.id}`;
      await owner`update scrabble.crokinole_games set created_at=${scrabbleDate.stamp}::text::timestamptz where family_id=${f.familyId}`;
      const first = await summary.read(f.admin, f.familyId);
      expect(first.games).toHaveLength(30);
      const second = await summary.read(f.admin, f.familyId, {
        cursor: first.nextCursor!,
      });
      expect(second.games).toHaveLength(2);
      expect(
        new Set(
          [...first.games, ...second.games].map((g) => g.gameType + ":" + g.id),
        ).size,
      ).toBe(32);
    });
    it("exports version2 collections with fresh permissions without changing legacy v1", async () => {
      const f = await fixture();
      const summary = createGameSummaryRepository(runtime);
      const scrabble = createSharedRepository(runtime, {
        defaultLexicon: testLexicon,
        resolveLexicon: () => testLexicon,
      });
      await f.mutate({
        type: "create-game",
        definition: f.definition,
        paletteRevision: 0,
      });
      await f.mutate({
        type: "create-game",
        definition: { ...f.definition, id: randomUUID(), mode: "practice" },
        paletteRevision: 0,
      });
      await expect(
        summary.exportHistory(f.member, f.familyId),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await owner`update scrabble.memberships set permissions='{"exportHistory":true}'::jsonb where family_id=${f.familyId} and user_id=${f.member.userId}`;
      const exported = await summary.exportHistory(f.member, f.familyId);
      expect(exported.format).toBe("amberly-games-archive-v2");
      expect(exported.crokinole.games).toHaveLength(1);
      expect((exported.scrabble as { format: string }).format).toBe(
        "scrabble-family-archive-v1",
      );
      expect(
        (await summary.exportHistory(f.admin, f.familyId)).crokinole.games,
      ).toHaveLength(2);
      expect(
        (
          (await scrabble.exportHistory(f.admin, f.familyId)) as {
            format: string;
          }
        ).format,
      ).toBe("scrabble-family-archive-v1");
    });
  });
}
