import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { createSharedRepository } from "../src/server/shared-repository";
import { createCrokinoleRepository } from "../src/server/crokinole-repository";
import {
  DEFAULT_PIECE_COLOURS,
  type CrokinoleDefinition,
} from "../src/domain/crokinole";
import type {
  SharedOperation,
  VerifiedActor,
} from "../src/lib/shared-contract";
import { testLexicon } from "../src/lib/test-lexicon";

export function playerArchiveDatabaseCases(
  owner: postgres.Sql,
  runtime: postgres.Sql,
) {
  const shared = createSharedRepository(runtime, {
    defaultLexicon: testLexicon,
    resolveLexicon: () => testLexicon,
  });
  const crokinole = createCrokinoleRepository(runtime, { enabled: true });
  async function fixture() {
    const familyId = randomUUID();
    const actor = (role: string): VerifiedActor => ({
      userId: randomUUID(),
      email: `${role}-${randomUUID()}@example.test`,
      emailVerified: true,
      deviceHash: "a".repeat(64),
    });
    const admin = actor("admin"),
      member = actor("member");
    await owner`insert into scrabble.families(id,name) values(${familyId}::uuid,'Disposable archive test')`;
    await owner`insert into scrabble.memberships(family_id,user_id,email,role,permissions) values(${familyId}::uuid,${admin.userId}::uuid,${admin.email},'superadmin','{}'),(${familyId}::uuid,${member.userId}::uuid,${member.email},'member','{"editAllProfiles":true}')`;
    const mutate = (
      operation: SharedOperation,
      as = admin,
      requestId = randomUUID(),
    ) => shared.mutate(as, familyId, { operation, requestId });
    const creation = {
      type: "create-player" as const,
      id: "unused",
      profile: { name: "Unused test", nickname: "Testy" },
    };
    const createRequest = randomUUID();
    await mutate(creation, admin, createRequest);
    await mutate({
      type: "create-player",
      id: "other",
      profile: { name: "Other" },
    });
    const archive = (
      expectedRevision = 0,
      archived = true,
      as = admin,
      requestId = randomUUID(),
    ) =>
      mutate(
        { type: "archive-player", id: "unused", archived, expectedRevision },
        as,
        requestId,
      );
    const remove = (
      expectedRevision = 1,
      as = admin,
      requestId = randomUUID(),
    ) =>
      mutate(
        { type: "delete-player", id: "unused", expectedRevision },
        as,
        requestId,
      );
    const create = () =>
      mutate({
        type: "create-game",
        id: randomUUID(),
        mode: "confirmed",
        players: [
          { id: "unused", seat: 0 },
          { id: "other", seat: 2 },
        ],
        firstPlayerId: "unused",
        direction: "clockwise",
        deviceId: "archive-test",
      });
    const definition: CrokinoleDefinition = {
      schemaVersion: 1,
      rulesVersion: 1,
      id: randomUUID(),
      familyId,
      mode: "confirmed",
      createdAt: new Date().toISOString(),
      players: [
        { id: "unused", name: "Testy", seatOrder: 0 },
        { id: "other", name: "Other", seatOrder: 1 },
      ],
      participants: ["unused", "other"].map((id, index) => ({
        id,
        name: index ? "Other" : "Testy",
        playerIds: [id],
        colour: {
          id: DEFAULT_PIECE_COLOURS[index].id,
          name: DEFAULT_PIECE_COLOURS[index].name,
          value: DEFAULT_PIECE_COLOURS[index].value,
        },
      })),
      format: "singles",
      scoringMode: "cumulative_round_totals",
      endCondition: { type: "fixed_rounds", rounds: 4 },
      initialStartingPlayerId: "unused",
    };
    return {
      familyId,
      admin,
      member,
      mutate,
      creation,
      createRequest,
      archive,
      remove,
      create,
      definition,
    };
  }
  async function direct(
    f: Awaited<ReturnType<typeof fixture>>,
    actor: VerifiedActor,
    work: (tx: postgres.TransactionSql) => Promise<unknown>,
  ) {
    return runtime.begin(async (tx) => {
      await tx`set local role scrabble_runtime`;
      await tx`select set_config('scrabble.actor_id',${actor.userId},true),set_config('scrabble.family_id',${f.familyId},true)`;
      return work(tx);
    });
  }
  describe("player archiving and safe deletion", () => {
    it("archives and restores without altering saved Scrabble history or linked access", async () => {
      const f = await fixture();
      await f.mutate({
        type: "update-member",
        userId: f.member.userId,
        role: "member",
        active: true,
        playerId: "unused",
        reason: "Link test member",
      });
      const game = (await f.create()).game!;
      const archived = await f.archive();
      expect(archived.playerAccess).toMatchObject({
        archived: true,
        revision: 1,
        userId: f.member.userId,
        deletionBlock: expect.stringContaining("linked account"),
      });
      const state = await shared.readState(f.member, f.familyId);
      expect(state.member).toMatchObject({ active: true, playerId: "unused" });
      expect(state.games.find((g) => g.id === game.id)).toEqual(game);
      expect(state.playerAccess.unused).not.toHaveProperty("deletionBlock");
      await expect(f.create()).rejects.toMatchObject({
        code: "INVALID_PLAYERS",
      });
      await expect(f.remove()).rejects.toMatchObject({ code: "PLAYER_IN_USE" });
      const restored = await f.archive(1, false);
      expect(restored.playerAccess).toMatchObject({
        archived: false,
        revision: 2,
        userId: f.member.userId,
      });
      await expect(f.create()).resolves.toHaveProperty("game");
    });
    it("retains deletion reasons after profile edits and current-state replay", async () => {
      const f = await fixture();
      await f.create();
      const request = randomUUID();
      const archived = await f.archive(0, true, f.admin, request);
      expect(archived.playerAccess?.deletionBlock).toContain(
        "saved game history",
      );
      const edited = await f.mutate({
        type: "update-player",
        id: "unused",
        expectedRevision: 1,
        profile: { name: "Renamed" },
      });
      expect(edited.playerAccess).toMatchObject({
        revision: 2,
        archived: true,
        deletionBlock: expect.stringContaining("saved game history"),
      });
      const replay = await f.archive(0, true, f.admin, request);
      expect(replay).toMatchObject({
        replayed: true,
        player: { name: "Renamed" },
        playerAccess: {
          revision: 2,
          archived: true,
          deletionBlock: expect.stringContaining("saved game history"),
        },
      });
    });
    it("rejects archive and delete for members, including edit-all-profiles permission, and outsiders", async () => {
      const f = await fixture(),
        other = await fixture();
      await expect(f.archive(0, true, f.member)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(f.archive(0, true, other.admin)).rejects.toMatchObject({
        code: "NOT_A_MEMBER",
      });
      await expect(
        direct(
          f,
          f.member,
          (tx) =>
            tx`update scrabble.players set archived=true where family_id=${f.familyId}::uuid and id='unused'`,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await f.archive();
      await expect(f.remove(1, f.member)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        direct(
          f,
          f.member,
          (tx) =>
            tx`delete from scrabble.players where family_id=${f.familyId}::uuid and id='unused'`,
        ),
      ).resolves.toHaveLength(0);
      expect(
        (await shared.readState(f.admin, f.familyId)).players.some(
          (p) => p.id === "unused",
        ),
      ).toBe(true);
    });
    it("deletes only unused archived profiles and prevents retry resurrection", async () => {
      const f = await fixture();
      await expect(f.remove(0)).rejects.toMatchObject({
        code: "ARCHIVE_REQUIRED",
      });
      await expect(
        direct(
          f,
          f.admin,
          (tx) =>
            tx`delete from scrabble.players where family_id=${f.familyId}::uuid and id='unused'`,
        ),
      ).resolves.toHaveLength(0);
      const archived = await f.archive();
      expect(archived.playerAccess?.deletionBlock).toBeNull();
      const request = randomUUID();
      expect(await f.remove(1, f.admin, request)).toEqual({
        removedPlayerId: "unused",
      });
      expect(await f.remove(1, f.admin, request)).toEqual({
        removedPlayerId: "unused",
        replayed: true,
      });
      expect(await f.mutate(f.creation, f.admin, f.createRequest)).toEqual({
        removedPlayerId: "unused",
        replayed: true,
      });
      await expect(f.mutate(f.creation)).rejects.toMatchObject({
        code: "PLAYER_DELETED",
      });
      await expect(
        direct(
          f,
          f.admin,
          (tx) =>
            tx`insert into scrabble.players(family_id,id,name) values(${f.familyId}::uuid,'unused','Resurrected')`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
      const rows =
        await owner`select * from scrabble.deleted_player_ids where family_id=${f.familyId}::uuid`;
      expect(rows).toHaveLength(1);
      expect(
        await owner`select * from scrabble.audit where family_id=${f.familyId}::uuid and action='player.deleted'`,
      ).toHaveLength(1);
      expect(
        (await shared.readState(f.admin, f.familyId)).players.map((p) => p.id),
      ).toEqual(["other"]);
    });
    it("blocks inactive invitation records and suspended account links", async () => {
      const invited = await fixture();
      await invited.mutate({
        type: "invite-member",
        email: "invited@example.test",
        playerId: "unused",
      });
      await invited.mutate({
        type: "revoke-invitation",
        email: "invited@example.test",
      });
      expect((await invited.archive()).playerAccess?.deletionBlock).toContain(
        "invitation record",
      );
      await expect(invited.remove()).rejects.toMatchObject({
        code: "PLAYER_IN_USE",
      });
      const linked = await fixture();
      await linked.mutate({
        type: "update-member",
        userId: linked.member.userId,
        role: "member",
        active: false,
        playerId: "unused",
        reason: "Suspend disposable account",
      });
      expect((await linked.archive()).playerAccess?.deletionBlock).toContain(
        "linked account",
      );
      await expect(linked.remove()).rejects.toMatchObject({
        code: "PLAYER_IN_USE",
      });
    });
    it("keeps Crokinole history and excludes archived players from new matches", async () => {
      const f = await fixture();
      await crokinole.mutate(f.admin, f.familyId, {
        requestId: randomUUID(),
        operation: {
          type: "create-game",
          definition: f.definition,
          paletteRevision: 0,
        },
      });
      const archived = await f.archive();
      expect(archived.playerAccess?.deletionBlock).toContain(
        "saved game history",
      );
      await expect(f.remove()).rejects.toMatchObject({ code: "PLAYER_IN_USE" });
      await expect(
        crokinole.mutate(f.admin, f.familyId, {
          requestId: randomUUID(),
          operation: {
            type: "create-game",
            definition: { ...f.definition, id: randomUUID() },
            paletteRevision: 0,
          },
        }),
      ).rejects.toMatchObject({ code: "ROSTER_CHANGED" });
      expect(
        (await crokinole.readState(f.admin, f.familyId)).games,
      ).toHaveLength(1);
    });
    it("retains private Gym references even when RLS hides them from the deleting admin", async () => {
      const f = await fixture();
      await owner`insert into scrabble.gym_sessions(family_id,player_id,id,actor_id,fingerprint,puzzle,replay) values(${f.familyId}::uuid,'unused',${randomUUID()}::uuid,${f.member.userId}::uuid,${"a".repeat(64)},'{}',false)`;
      await f.archive();
      await expect(f.remove()).rejects.toMatchObject({
        code: "PLAYER_IN_USE",
        status: 409,
      });
      expect(
        await owner`select * from scrabble.gym_sessions where family_id=${f.familyId}::uuid`,
      ).toHaveLength(1);
      expect(
        await owner`select * from scrabble.players where family_id=${f.familyId}::uuid and id='unused'`,
      ).toHaveLength(1);
      expect(
        await owner`select * from scrabble.deleted_player_ids where family_id=${f.familyId}::uuid`,
      ).toHaveLength(0);
    });
    it("serializes stale revisions and gives duplicate archive requests one receipt", async () => {
      const f = await fixture();
      const request = randomUUID();
      const replies = await Promise.all([
        f.archive(0, true, f.admin, request),
        f.archive(0, true, f.admin, request),
      ]);
      expect(replies.every((r) => r.playerAccess?.revision === 1)).toBe(true);
      await expect(f.archive(0, false)).rejects.toMatchObject({
        code: "REVISION_CONFLICT",
      });
      await f.archive(1, false);
      const replay = await f.archive(0, true, f.admin, request);
      expect(replay.playerAccess).toMatchObject({
        revision: 2,
        archived: false,
      });
      expect(
        await owner`select * from scrabble.audit where family_id=${f.familyId}::uuid and action='player.archived'`,
      ).toHaveLength(1);
    });
    it("serializes archive against game creation without dangling participants", async () => {
      const f = await fixture();
      const [archive, game] = await Promise.allSettled([
        f.archive(),
        f.create(),
      ]);
      expect(archive.status).toBe("fulfilled");
      const state = await shared.readState(f.admin, f.familyId);
      expect(state.playerAccess.unused.archived).toBe(true);
      if (game.status === "fulfilled") {
        expect(state.games).toHaveLength(1);
        await expect(f.remove()).rejects.toMatchObject({
          code: "PLAYER_IN_USE",
        });
      } else {
        expect(game.reason).toMatchObject({ code: "INVALID_PLAYERS" });
        expect(state.games).toHaveLength(0);
      }
      expect(state.players.some((p) => p.id === "unused")).toBe(true);
    });
  });
}
