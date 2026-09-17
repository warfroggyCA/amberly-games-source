import { crokinoleDatabaseCases } from "./crokinole-database-cases";
import {
  MEMBER_PERMISSIONS,
  type MemberPermissions,
} from "../src/lib/member-permissions";
import type { Equipment } from "../src/domain/equipment";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSharedRepository } from "../src/server/shared-repository";
import type { LiveDraftInput } from "../src/lib/live-draft";
import { testLexicon } from "../src/lib/test-lexicon";
import { LETTER_COUNTS, countUnplayed } from "../src/domain/board";
import type {
  SharedOperation,
  VerifiedActor,
} from "../src/lib/shared-contract";
import type { OfficialWordResult } from "../src/lib/official-word";

const socket = process.env.SCRABBLE_TEST_SOCKET;
const suite = socket ? describe : describe.skip;
const owner = postgres({
  host: socket ?? "/tmp/not-a-scrabble-test",
  database: "postgres",
  username: "scrabble_test_owner",
  max: 1,
  onnotice: () => undefined,
});
const runtime = postgres({
  host: socket ?? "/tmp/not-a-scrabble-test",
  database: "postgres",
  username: "scrabble_test_login",
  max: 5,
  onnotice: () => undefined,
});
let verifierCalls = 0;
const repository = createSharedRepository(runtime, {
  defaultLexicon: testLexicon,
  resolveLexicon: () => testLexicon,
  verifyWord: async (word): Promise<OfficialWordResult> => {
    verifierCalls++;
    return {
      word,
      playable: word === "ZZTEST",
      source: "merriam-webster",
      sourceUrl: `https://scrabble.merriam.com/finder/${word.toLowerCase()}`,
      verifiedAt: "2026-09-14T18:00:00.000Z",
    };
  },
});
const actor = (prefix: string): VerifiedActor => ({
  userId: randomUUID(),
  email: `${prefix}-${randomUUID()}@example.test`,
  emailVerified: true,
  deviceHash: createHash("sha256").update(randomUUID()).digest("hex"),
});
async function fixture(shared = repository) {
  const familyId = randomUUID();
  const admin = actor("admin");
  const guest = actor("member");
  await owner`insert into scrabble.families(id,name) values(${familyId}::uuid,'Test family')`;
  await owner`insert into scrabble.memberships(family_id,user_id,email,role) values(${familyId}::uuid,${admin.userId}::uuid,${admin.email},'superadmin'),(${familyId}::uuid,${guest.userId}::uuid,${guest.email},'member')`;
  const mutate = (
    operation: SharedOperation,
    as = admin,
    requestId = randomUUID(),
  ) => shared.mutate(as, familyId, { requestId, operation });
  await mutate({ type: "create-player", id: "ada", profile: { name: "Ada" } });
  await mutate({ type: "create-player", id: "ben", profile: { name: "Ben" } });
  await mutate({
    type: "update-member",
    userId: admin.userId,
    role: "superadmin",
    active: true,
    playerId: "ada",
    reason: "Link own player",
  });
  await mutate({
    type: "update-member",
    userId: guest.userId,
    role: "member",
    active: true,
    playerId: "ben",
    reason: "Link family player",
  });
  async function create(
    mode: "confirmed" | "practice" = "confirmed",
    id: string = randomUUID(),
  ) {
    return mutate({
      type: "create-game",
      id,
      mode,
      players: [
        { id: "ada", seat: 0 },
        { id: "ben", seat: 2 },
      ],
      firstPlayerId: "ada",
      direction: "clockwise",
      deviceId: "device-a",
    });
  }
  return { familyId, admin, guest, mutate, create };
}
async function setPermissions(
  f: Awaited<ReturnType<typeof fixture>>,
  permissions: MemberPermissions,
) {
  const member = (await repository.readState(f.admin, f.familyId)).members.find(
    (m) => m.userId === f.guest.userId,
  )!;
  return f.mutate({
    type: "update-member",
    userId: member.userId,
    role: member.role,
    active: member.active,
    playerId: member.playerId,
    reason: "Permission test",
    permissions,
    expectedRevision: member.revision!,
  });
}
const pass = (gameId: string, expectedRevision = 0) => ({
  type: "game-commands" as const,
  gameId,
  deviceId: "device-a",
  generation: 1,
  commands: [{ type: "pass" as const, id: randomUUID(), expectedRevision }],
});
const code = (value: Promise<unknown>, expected: string) =>
  expect(value).rejects.toMatchObject({ code: expected });

suite("isolated real PostgreSQL shared family repository", () => {
  crokinoleDatabaseCases(owner, runtime);
  beforeAll(async () => {
    const migrationDirectory = new URL(
      "../supabase/migrations/",
      import.meta.url,
    );
    const migrations = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    await owner`create role anon nologin`;
    await owner`create role authenticated nologin`;
    await owner`create role service_role nologin`;
    for (const name of migrations)
      await owner.unsafe(
        await readFile(new URL(name, migrationDirectory), "utf8"),
      );
    await owner`create schema auth`;
    await owner`create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz)`;
    await owner`create role scrabble_test_login login nosuperuser nocreatedb nocreaterole nobypassrls`;
    await owner`grant scrabble_runtime to scrabble_test_login`;
  }, 20000);
  it("validates permission keys, defaults and every delegated switch against real membership rows", async () => {
    const f = await fixture();
    const baseline = (await repository.readState(f.guest, f.familyId)).member;
    expect(baseline.permissions).toEqual({});
    expect(baseline.revision).toBe(1);
    for (const permissions of [
      { scoreGames: "yes" },
      { deleteHistory: true },
      [],
      null,
    ]) {
      await code(
        f.mutate({
          type: "update-member",
          userId: f.guest.userId,
          role: "member",
          active: true,
          playerId: "ben",
          reason: "invalid",
          permissions,
          expectedRevision: 1,
        } as unknown as SharedOperation),
        "INVALID_MEMBER",
      );
    }
    await code(
      setPermissions(
        { ...f, mutate: (op: SharedOperation) => f.mutate(op, f.guest) },
        { inviteMembers: true },
      ),
      "FORBIDDEN",
    );
    const allOff = Object.fromEntries(
      MEMBER_PERMISSIONS.map((p) => [p.key, false]),
    );
    await setPermissions(f, allOff);
    const saved = (await repository.readState(f.guest, f.familyId)).member;
    expect(saved.permissions).toEqual(allOff);
    const sqlPermissions = await runtime.begin(async (tx) => {
      await tx`set local role scrabble_runtime`;
      await tx`select set_config('scrabble.actor_id',${f.guest.userId},true),set_config('scrabble.family_id',${f.familyId},true)`;
      return tx`select p, scrabble.has_permission(${f.familyId}::uuid,p) allowed from unnest(${MEMBER_PERMISSIONS.map((p) => p.key)}::text[]) p`;
    });
    expect(sqlPermissions.every((p) => !p.allowed)).toBe(true);
    await code(
      f.mutate(
        { type: "create-player", id: "newbie", profile: { name: "New" } },
        f.guest,
      ),
      "PERMISSION_DENIED",
    );
    await code(
      f.mutate(
        {
          type: "update-player",
          id: "ben",
          expectedRevision: 0,
          profile: { name: "Ben changed" },
        },
        f.guest,
      ),
      "PERMISSION_DENIED",
    );
    await code(
      f.mutate(
        { type: "invite-member", email: "friend@example.test" },
        f.guest,
      ),
      "PERMISSION_DENIED",
    );
    await code(
      repository.exportHistory(f.guest, f.familyId),
      "PERMISSION_DENIED",
    );
    await code(
      f.mutate(
        {
          type: "save-equipment",
          expectedRevision: 0,
          equipment: { revision: 1, defaultSetId: null, sets: [] },
        },
        f.guest,
      ),
      "PERMISSION_DENIED",
    );
    const shared = (await f.create()).game!;
    await f.mutate(
      {
        type: "report-protest",
        gameId: shared.id,
        reason: "Always allowed to report",
        reportedFor: null,
      },
      f.guest,
    );
    // No member can bypass the role editor using SQL access.
    const result = await runtime.begin(async (tx) => {
      await tx`set local role scrabble_runtime`;
      await tx`select set_config('scrabble.actor_id',${f.guest.userId},true),set_config('scrabble.family_id',${f.familyId},true)`;
      return tx`update scrabble.memberships set permissions='{"inviteMembers":true}'::jsonb where family_id=${f.familyId}::uuid and user_id=${f.guest.userId}::uuid returning user_id`;
    });
    expect(result).toHaveLength(0);
  });

  it("grants extra trust without granting membership management or bypassing designated scoring", async () => {
    const f = await fixture();
    await setPermissions(f, {
      editAllProfiles: true,
      inviteMembers: true,
      resolveConcerns: true,
      exportHistory: true,
      takeOverScoring: true,
    });
    const game = (await f.create()).game!;
    await code(f.mutate(pass(game.id), f.guest), "SCORER_CONFLICT");
    await f.mutate(
      {
        type: "update-player",
        id: "ada",
        expectedRevision: 0,
        profile: { name: "Ada renamed" },
      },
      f.guest,
    );
    await f.mutate(
      { type: "invite-member", email: "newfriend@example.test" },
      f.guest,
    );
    const invited = actor("invited");
    invited.email = "newfriend@example.test";
    await repository.admit(invited, f.familyId, randomUUID());
    expect(
      (await repository.readState(invited, f.familyId)).member,
    ).toMatchObject({ role: "member", permissions: {} });
    await code(
      f.mutate(
        {
          type: "update-member",
          userId: invited.userId,
          role: "superadmin",
          active: true,
          playerId: null,
          reason: "Must fail",
        },
        f.guest,
      ),
      "FORBIDDEN",
    );
    const report = await f.mutate(
      {
        type: "report-protest",
        gameId: game.id,
        reason: "Review me",
        reportedFor: null,
      },
      f.guest,
    );
    await f.mutate(
      {
        type: "resolve-protest",
        gameId: game.id,
        protestId: report.gameAccess!.protests[0].id,
        outcome: "dismissed",
        reason: "Reviewed",
      },
      f.guest,
    );
    const takeover = await f.mutate(
      {
        type: "take-over-scoring",
        gameId: game.id,
        deviceId: "guest-device",
        expectedGeneration: 1,
        reason: "Scorer left",
      },
      f.guest,
    );
    expect(takeover.gameAccess).toMatchObject({
      scorerUserId: f.guest.userId,
      generation: 2,
      canScore: true,
    });
    await f.mutate({ ...pass(game.id), generation: 2 }, f.guest);
    await code(
      f.mutate({ ...pass(game.id, 1), generation: 2 }),
      "SCORER_CONFLICT",
    );
    const exported = (await repository.exportHistory(f.guest, f.familyId)) as {
      definitions: unknown[];
      audit: unknown[];
    };
    expect(exported.definitions).toHaveLength(1);
    expect(exported.audit).toHaveLength(0);
  });

  it("fences live entries and new writes after scoring permission revocation but acknowledges already committed retries", async () => {
    const f = await fixture();
    const createOp: SharedOperation = {
      type: "create-game",
      id: "member-game",
      mode: "confirmed",
      players: [{ id: "ben", seat: 0 }],
      firstPlayerId: "ben",
      direction: "clockwise",
      deviceId: "guest-device",
    };
    const game = (await f.mutate(createOp, f.guest)).game!;
    const op = pass(game.id),
      requestId = randomUUID();
    await f.mutate(op, f.guest, requestId);
    const token = randomBytes(32).toString("hex");
    await f.mutate(
      { type: "create-watch-link", gameId: game.id, token },
      f.guest,
    );
    const draft: LiveDraftInput = {
      gameId: game.id,
      revision: 1,
      generation: 1,
      streamId: randomUUID(),
      sequence: 1,
      kind: "edit",
      placements: [{ row: 7, col: 7, tile: { letter: "A", blank: false } }],
    };
    await repository.writeLiveDraft(f.guest, f.familyId, draft);
    await setPermissions(f, { scoreGames: false, shareGames: false });
    const replay = await f.mutate(op, f.guest, requestId);
    expect(replay).toMatchObject({
      replayed: true,
      gameAccess: { canScore: false },
      game: { revision: 1 },
    });
    await code(f.mutate(pass(game.id, 1), f.guest), "PERMISSION_DENIED");
    await code(
      f.mutate({ ...createOp, id: "blocked-new" }, f.guest),
      "PERMISSION_DENIED",
    );
    await code(
      f.mutate(
        {
          type: "verify-words",
          gameId: game.id,
          words: ["ZZTEST"],
          expectedRevision: 1,
          generation: 1,
          deviceId: "guest-device",
        },
        f.guest,
      ),
      "PERMISSION_DENIED",
    );
    await code(
      repository.writeLiveDraft(f.guest, f.familyId, { ...draft, sequence: 2 }),
      "PERMISSION_DENIED",
    );
    expect(
      await repository.readLiveDraft(f.admin, f.familyId, game.id),
    ).toBeNull();
    expect((await repository.readWatchDraft(token)).draft).toBeNull();
    expect((await repository.readWatch(token)).liveDraft).toBeNull();
    await code(
      f.mutate(
        {
          type: "create-watch-link",
          gameId: game.id,
          token: randomBytes(32).toString("hex"),
        },
        f.guest,
      ),
      "PERMISSION_DENIED",
    );
    await setPermissions(f, {});
    await f.mutate(pass(game.id, 1), f.guest);
    await setPermissions(f, { startGames: false });
    await code(
      f.mutate({ ...createOp, id: "no-new-games" }, f.guest),
      "PERMISSION_DENIED",
    );
  });

  it("rejects stale permission forms, serializes concurrent edits and makes permission retries idempotent", async () => {
    const f = await fixture();
    const member = (
      await repository.readState(f.admin, f.familyId)
    ).members.find((m) => m.userId === f.guest.userId)!;
    const op: SharedOperation = {
      type: "update-member",
      userId: f.guest.userId,
      role: "member",
      active: true,
      playerId: "ben",
      reason: "Restricted equipment",
      expectedRevision: member.revision!,
      permissions: { manageEquipment: false },
    };
    const id = randomUUID();
    const outcomes = await Promise.allSettled([
      f.mutate(op, f.admin, id),
      f.mutate({ ...op, permissions: { addPlayers: false } }),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "MEMBER_CHANGED" },
    });
    if (outcomes[0].status === "fulfilled")
      expect((await f.mutate(op, f.admin, id)).replayed).toBe(true);
    const rows =
      await owner`select * from scrabble.audit where family_id=${f.familyId}::uuid and action='member.updated' and after_value->>'reason'='Restricted equipment'`;
    expect(rows).toHaveLength(1);
  });

  it("keeps private tests invisible to members through lists, direct IDs, drafts, exports and old viewing links", async () => {
    const f = await fixture();
    const game = (await f.create("practice")).game!;
    const publicGame = (await f.create("confirmed")).game!;
    const token = randomBytes(32).toString("hex");
    await owner`insert into scrabble.watch_links(family_id,game_id,token_hash,created_by,expires_at) values(${f.familyId}::uuid,${game.id},${createHash("sha256").update(token).digest("hex")},${f.admin.userId}::uuid,now()+interval '1 day')`;
    await code(
      f.mutate({ type: "create-watch-link", gameId: game.id, token }),
      "PRIVATE_PRACTICE",
    );
    await code(repository.readWatch(token), "WATCH_LINK_UNAVAILABLE");
    await code(repository.readWatchDraft(token), "WATCH_LINK_UNAVAILABLE");
    const memberState = await repository.readState(f.guest, f.familyId);
    expect(memberState.games.map((g) => g.id)).toEqual([publicGame.id]);
    expect(memberState.gameAccess[game.id]).toBeUndefined();
    await code(
      repository.readState(f.guest, f.familyId, { gameId: game.id }),
      "GAME_NOT_FOUND",
    );
    expect(
      await repository.readLiveDraft(f.guest, f.familyId, game.id),
    ).toBeNull();
    await code(
      f.mutate(
        {
          type: "create-game",
          id: "forged-practice",
          mode: "practice",
          players: [{ id: "ben", seat: 0 }],
          firstPlayerId: "ben",
          direction: "clockwise",
          deviceId: "member-device",
        },
        f.guest,
      ),
      "FORBIDDEN",
    );
    await code(f.mutate(pass(game.id), f.guest), "GAME_NOT_FOUND");
    await code(
      f.mutate(
        {
          type: "report-protest",
          gameId: game.id,
          reason: "Guessed ID",
          reportedFor: null,
        },
        f.guest,
      ),
      "GAME_NOT_FOUND",
    );
    await setPermissions(
      f,
      Object.fromEntries(MEMBER_PERMISSIONS.map((p) => [p.key, true])),
    );
    const archive = (await repository.exportHistory(f.guest, f.familyId)) as {
      definitions: { game_id: string }[];
      audit: unknown[];
      removedPracticeGames: unknown[];
    };
    expect(archive.definitions.map((d) => d.game_id)).toEqual([publicGame.id]);
    expect(archive.audit).toEqual([]);
    expect(archive.removedPracticeGames).toEqual([]);
    // SQL visibility is restricted too, rather than relying on hidden buttons.
    const heads = await runtime.begin(async (tx) => {
      await tx`set local role scrabble_runtime`;
      await tx`select set_config('scrabble.actor_id',${f.guest.userId},true),set_config('scrabble.family_id',${f.familyId},true)`;
      return tx`select game_id from scrabble.game_heads where family_id=${f.familyId}::uuid`;
    });
    expect(heads.map((h) => h.game_id)).toEqual([publicGame.id]);
  });

  it("removes only practice games, closes legacy links, preserves original evidence and cannot resurrect games on retries", async () => {
    const f = await fixture();
    const game = (await f.create("practice")).game!;
    const command = pass(game.id),
      commandId = randomUUID();
    await f.mutate(command, f.admin, commandId);
    const sharedGame = (await f.create()).game!;
    const op: SharedOperation = {
      type: "delete-practice-game",
      gameId: game.id,
      expectedRevision: 1,
      reason: "Finished dev testing",
    };
    await code(f.mutate(op, f.guest), "FORBIDDEN");
    await code(
      f.mutate({ ...op, gameId: sharedGame.id, expectedRevision: 0 }),
      "PROTECTED_GAME",
    );
    await code(f.mutate({ ...op, expectedRevision: 0 }), "REVISION_CONFLICT");
    const token = randomBytes(32).toString("hex");
    await owner`insert into scrabble.watch_links(family_id,game_id,token_hash,created_by,expires_at) values(${f.familyId}::uuid,${game.id},${createHash("sha256").update(token).digest("hex")},${f.admin.userId}::uuid,now()+interval '1 day')`;
    const id = randomUUID();
    const results = await Promise.all([
      f.mutate(op, f.admin, id),
      f.mutate(op, f.admin, id),
    ]);
    expect(results.every((r) => r.removedGameId === game.id)).toBe(true);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    const state = await repository.readState(f.admin, f.familyId);
    expect(state.games.map((g) => g.id)).toEqual([sharedGame.id]);
    expect(state.removedGameIds).toEqual([game.id]);
    await code(
      repository.readState(f.admin, f.familyId, { gameId: game.id }),
      "GAME_NOT_FOUND",
    );
    await code(f.mutate(pass(game.id, 1)), "GAME_NOT_FOUND");
    expect(await f.mutate(command, f.admin, commandId)).toEqual({
      replayed: true,
      removedGameId: game.id,
    });
    const [original] =
      await owner`select state from scrabble.game_heads where family_id=${f.familyId}::uuid and game_id=${game.id}`;
    expect(original.state.revision).toBe(1);
    const [link] =
      await owner`select active from scrabble.watch_links where family_id=${f.familyId}::uuid and game_id=${game.id}`;
    expect(link.active).toBe(false);
    const archive = (await repository.exportHistory(f.admin, f.familyId)) as {
      removedPracticeGames: { game_id: string; reason: string }[];
    };
    expect(archive.removedPracticeGames).toMatchObject([
      { game_id: game.id, reason: op.reason },
    ]);
    await expect(
      owner`delete from scrabble.game_removals where family_id=${f.familyId}::uuid`,
    ).rejects.toThrow();
  });

  it("rolls back a failed practice deletion and keeps finalized results intact after a successful retry", async () => {
    const f = await fixture();
    const game = (await f.create("practice")).game!;
    const final = await f.mutate({
      type: "game-commands",
      gameId: game.id,
      deviceId: "device-a",
      generation: 1,
      commands: [
        {
          type: "finalize",
          id: randomUUID(),
          expectedRevision: 0,
          reason: "early",
          racks: {
            ada: ["A", "A", "A", "A", "A", "A", "A"],
            ben: ["E", "E", "E", "E", "E", "E", "E"],
          },
        },
      ],
    });
    expect(final.game!.status).toBe("finalized");
    const before =
      await owner`select * from scrabble.game_results where family_id=${f.familyId}::uuid and game_id=${game.id}`;
    const requestId = randomUUID();
    const op: SharedOperation = {
      type: "delete-practice-game",
      gameId: game.id,
      expectedRevision: 1,
      reason: "Finished final-result testing",
    };
    await owner.unsafe(
      `create function scrabble.test_fail_removal_audit() returns trigger language plpgsql as $$ begin raise exception 'Injected audit failure'; end $$`,
    );
    await owner.unsafe(
      `create trigger test_removal_audit_failure before insert on scrabble.audit for each row when(new.action='game.practice-deleted' and new.subject='${game.id}') execute function scrabble.test_fail_removal_audit()`,
    );
    try {
      await expect(f.mutate(op, f.admin, requestId)).rejects.toMatchObject({
        code: "P0001",
      });
      expect(
        (await repository.readState(f.admin, f.familyId)).games,
      ).toHaveLength(1);
      expect(
        await owner`select 1 from scrabble.game_removals where family_id=${f.familyId}::uuid`,
      ).toHaveLength(0);
      expect(
        await owner`select 1 from scrabble.requests where family_id=${f.familyId}::uuid and request_id=${requestId}`,
      ).toHaveLength(0);
    } finally {
      await owner`drop trigger test_removal_audit_failure on scrabble.audit`;
      await owner`drop function scrabble.test_fail_removal_audit()`;
    }
    await f.mutate(op, f.admin, requestId);
    expect(
      (await repository.readState(f.admin, f.familyId)).games,
    ).toHaveLength(0);
    expect(
      await owner`select * from scrabble.game_results where family_id=${f.familyId}::uuid and game_id=${game.id}`,
    ).toEqual(before);
    expect((await f.mutate(op, f.admin, requestId)).replayed).toBe(true);
  });

  it("saves shared equipment with retries, concurrent edits, immutable game snapshots and spectator supply", async () => {
    const f = await fixture();
    const equipment: Equipment = {
      revision: 1,
      defaultSetId: "home",
      sets: [
        {
          id: "home",
          name: "Home",
          counts: { ...LETTER_COUNTS, C: 1, "?": 1 },
          checkedAt: null,
        },
      ],
    };
    const requestId = randomUUID();
    const op = {
      type: "save-equipment" as const,
      equipment,
      expectedRevision: 0,
    };
    await f.mutate(op, f.guest, requestId);
    expect((await repository.readState(f.admin, f.familyId)).equipment).toEqual(
      equipment,
    );
    const newGame = {
      type: "create-game" as const,
      id: randomUUID(),
      players: [
        { id: "ada", seat: 0 as const },
        { id: "ben", seat: 2 as const },
      ],
      firstPlayerId: "ada",
      direction: "clockwise" as const,
      deviceId: "device-a",
      mode: "confirmed" as const,
      tileSet: { id: "home", revision: 1 },
    };
    const first = (await f.mutate(newGame)).game!;
    expect(first.expectedBagCount).toBe(84);
    expect(first.tileSupply?.C).toBe(1);
    expect(first.definition.tileSet?.name).toBe("Home");
    const next = {
      ...equipment,
      revision: 2,
      sets: [
        {
          ...equipment.sets[0],
          name: "After recount",
          counts: { ...LETTER_COUNTS, C: 1 },
        },
      ],
    };
    const competing = await Promise.allSettled([
      f.mutate({
        type: "save-equipment",
        expectedRevision: 1,
        equipment: next,
      }),
      f.mutate({
        type: "save-equipment",
        expectedRevision: 1,
        equipment: { ...next, defaultSetId: null },
      }),
    ]);
    expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(competing.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "STALE_EQUIPMENT" },
    });
    const replay = await f.mutate(op, f.guest, requestId);
    expect(replay.replayed).toBe(true);
    expect(replay.equipment?.revision).toBe(2);
    const state = await repository.readState(f.admin, f.familyId);
    expect(state.games.find((g) => g.id === first.id)).toEqual(first);
    await code(f.mutate({ ...newGame, id: randomUUID() }), "STALE_EQUIPMENT");
    await code(
      f.mutate({
        ...newGame,
        id: randomUUID(),
        tileSet: { id: "missing", revision: 2 },
      }),
      "INVALID_EQUIPMENT",
    );
    await code(
      f.mutate({
        ...newGame,
        id: randomUUID(),
        tileSet: { id: "home", revision: 2, counts: LETTER_COUNTS },
      } as never),
      "INVALID_EQUIPMENT",
    );
    const token = "f".repeat(64);
    await f.mutate({ type: "create-watch-link", gameId: first.id, token });
    const watch = await repository.readWatch(token);
    expect(watch?.tileSupply?.C).toBe(1);
    expect(JSON.stringify(watch)).not.toContain("After recount");
    const audit =
      await owner`select action from scrabble.audit where family_id=${f.familyId}::uuid and action='equipment.updated'`;
    expect(audit).toHaveLength(2);
    const exported = (await repository.exportHistory(f.admin, f.familyId)) as {
      equipment: Equipment;
    };
    expect(exported.equipment.revision).toBe(2);
  });
  it("rejects malformed equipment and keeps sets private to active family members", async () => {
    const f = await fixture();
    const equipment: Equipment = {
      revision: 1,
      defaultSetId: "home",
      sets: [
        {
          id: "home",
          name: "Home",
          counts: { ...LETTER_COUNTS },
          checkedAt: null,
        },
      ],
    };
    await code(
      f.mutate({
        type: "save-equipment",
        expectedRevision: 0,
        equipment: {
          ...equipment,
          sets: [{ ...equipment.sets[0], counts: { ...LETTER_COUNTS, C: -1 } }],
        },
      }),
      "INVALID_EQUIPMENT",
    );
    await code(
      f.mutate(
        { type: "save-equipment", expectedRevision: 0, equipment },
        actor("outsider"),
      ),
      "NOT_A_MEMBER",
    );
    await f.mutate({ type: "save-equipment", expectedRevision: 0, equipment });
    await code(
      f.mutate({
        type: "save-equipment",
        expectedRevision: 1,
        equipment: { revision: 2, sets: [], defaultSetId: null },
      }),
      "INVALID_EQUIPMENT",
    );
    const other = await fixture();
    expect(
      (await repository.readState(other.admin, other.familyId)).equipment?.sets,
    ).toEqual([]);
    await runtime.begin(async (tx) => {
      await tx`set local role scrabble_runtime`;
      await tx`select set_config('scrabble.actor_id',${other.admin.userId},true),set_config('scrabble.family_id',${other.familyId},true)`;
      expect(
        await tx`select * from scrabble.equipment where family_id=${f.familyId}::uuid`,
      ).toHaveLength(0);
    });
    const grants =
      await owner`select grantee from information_schema.role_table_grants where table_schema='scrabble' and table_name='equipment' and grantee in ('anon','authenticated','PUBLIC')`;
    expect(grants).toHaveLength(0);
  });
  afterAll(async () => {
    if (process.env.SCRABBLE_TEST_KEEP === "1") {
      const f = await fixture();
      const url = `postgres://scrabble_test_login@127.0.0.1:${process.env.SCRABBLE_TEST_PORT}/postgres`;
      await writeFile(
        `${process.env.SCRABBLE_TEST_FIXTURE_PREFIX ?? "/tmp/scrabble-shared-browser"}.env`,
        `SCRABBLE_DATABASE_URL='${url}'\nSCRABBLE_FAMILY_ID='${f.familyId}'\n`,
        { mode: 0o600 },
      );
      await writeFile(
        `${process.env.SCRABBLE_TEST_FIXTURE_PREFIX ?? "/tmp/scrabble-shared-browser"}-fixture.json`,
        JSON.stringify({
          familyId: f.familyId,
          admin: f.admin,
          member: f.guest,
          databaseUrl: url,
          directory: process.env.SCRABBLE_TEST_DIRECTORY,
        }),
        { mode: 0o600 },
      );
    }
    await Promise.all([runtime.end(), owner.end()]);
  });

  it("shares a server-scored provisional entry only with authorized readers and never changes recorded history", async () => {
    const f = await fixture();
    const created = await f.create();
    const g = created.game!;
    const streamId = randomUUID();
    const placements = (["C", "A", "T"] as const).map((letter, i) => ({
      row: 7,
      col: 7 + i,
      tile: { letter, blank: false },
    }));
    const input: LiveDraftInput = {
      gameId: g.id,
      revision: 0,
      generation: 1,
      streamId,
      sequence: 1,
      kind: "edit" as const,
      placements,
    };
    await code(
      repository.writeLiveDraft(f.guest, f.familyId, input),
      "NOT_SCORER",
    );
    const stranger = actor("stranger");
    await code(
      repository.readLiveDraft(stranger, f.familyId, g.id),
      "NOT_A_MEMBER",
    );
    expect(await repository.writeLiveDraft(f.admin, f.familyId, input)).toEqual(
      { accepted: true },
    );
    const draft = await repository.readLiveDraft(f.guest, f.familyId, g.id);
    expect(draft).toMatchObject({
      score: 10,
      valid: true,
      playerId: "ada",
      placements,
    });
    const fresh = await repository.readState(f.admin, f.familyId, {
      gameId: g.id,
    });
    expect(fresh.games[0].revision).toBe(0);
    expect(fresh.games[0].turns).toEqual([]);
    expect(fresh.games[0].board[7][7]).toBeNull();
    expect(fresh.games[0].scores).toEqual(g.scores);
    const token = "d".repeat(64);
    await f.mutate({ type: "create-watch-link", gameId: g.id, token });
    expect(await repository.readWatchDraft(token)).toMatchObject({
      revision: 0,
      draft: { score: 10 },
    });
    const view = await repository.readWatch(token);
    expect(view.liveDraft?.placements).toEqual(placements);
    expect(view.scores).toEqual(g.scores);
    expect(JSON.stringify(view.liveDraft)).not.toMatch(
      /email|scorerUserId|streamId/,
    );
    await f.mutate({ type: "revoke-watch-link", gameId: g.id });
    await code(repository.readWatchDraft(token), "WATCH_LINK_UNAVAILABLE");
    await code(repository.readWatchDraft("bad"), "WATCH_LINK_UNAVAILABLE");
    await expect(owner`set role anon`).resolves.toBeDefined();
    await expect(
      owner`select scrabble.read_watch_draft(${"d".repeat(64)})`,
    ).rejects.toMatchObject({ code: "42501" });
    await owner`reset role`;
  });

  it("fences stale draft revisions and scorer generations, and expires previews without erasing game data", async () => {
    const f = await fixture();
    const g = (await f.create()).game!;
    const input: LiveDraftInput = {
      gameId: g.id,
      revision: 0,
      generation: 1,
      streamId: randomUUID(),
      sequence: 1,
      kind: "edit" as const,
      placements: [{ row: 7, col: 7, tile: { letter: "Z", blank: false } }],
    };
    await repository.writeLiveDraft(f.admin, f.familyId, input);
    expect(
      await repository.readLiveDraft(f.guest, f.familyId, g.id),
    ).toMatchObject({ valid: false });
    await owner`update scrabble.live_drafts set expires_at=now()-interval '1 second' where family_id=${f.familyId}::uuid`;
    expect(
      await repository.readLiveDraft(f.guest, f.familyId, g.id),
    ).toBeNull();
    await repository.writeLiveDraft(f.admin, f.familyId, {
      ...input,
      sequence: 2,
    });
    await f.mutate(pass(g.id));
    expect(
      await repository.readLiveDraft(f.guest, f.familyId, g.id),
    ).toBeNull();
    await code(
      repository.writeLiveDraft(f.admin, f.familyId, { ...input, sequence: 3 }),
      "STALE_DRAFT",
    );
    await f.mutate({
      type: "take-over-scoring",
      gameId: g.id,
      deviceId: "different",
      expectedGeneration: 1,
      reason: "Transfer to same account for test",
    });
    await code(
      repository.writeLiveDraft(f.admin, f.familyId, {
        ...input,
        revision: 1,
        sequence: 4,
      }),
      "STALE_DRAFT",
    );
    await repository.writeLiveDraft(f.admin, f.familyId, {
      ...input,
      revision: 1,
      generation: 2,
      sequence: 5,
    });
    await owner`update scrabble.memberships set active=false where family_id=${f.familyId}::uuid and user_id=${f.admin.userId}::uuid`;
    expect(
      await repository.readLiveDraft(f.guest, f.familyId, g.id),
    ).toBeNull();
  });

  it("never lets delayed same-stream input or an idle different device overwrite the latest actual edit", async () => {
    const f = await fixture();
    const g = (await f.create()).game!;
    const a: LiveDraftInput = {
      gameId: g.id,
      revision: 0,
      generation: 1,
      streamId: randomUUID(),
      sequence: 1,
      kind: "edit" as const,
      placements: [{ row: 7, col: 7, tile: { letter: "A", blank: false } }],
    };
    const b: LiveDraftInput = {
      ...a,
      streamId: randomUUID(),
      placements: [{ row: 7, col: 7, tile: { letter: "B", blank: false } }],
    };
    await repository.writeLiveDraft(f.admin, f.familyId, a);
    await repository.writeLiveDraft(f.admin, f.familyId, {
      ...a,
      sequence: 3,
      placements: [{ row: 7, col: 7, tile: { letter: "C", blank: false } }],
    });
    expect(
      await repository.writeLiveDraft(f.admin, f.familyId, {
        ...a,
        sequence: 2,
      }),
    ).toEqual({ accepted: false });
    await repository.writeLiveDraft(f.admin, f.familyId, b);
    expect(
      await repository.writeLiveDraft(f.admin, f.familyId, {
        ...a,
        sequence: 4,
        kind: "heartbeat",
      }),
    ).toEqual({ accepted: false });
    expect(
      await repository.writeLiveDraft(f.admin, f.familyId, {
        ...a,
        sequence: 5,
        kind: "clear",
        placements: [],
      }),
    ).toEqual({ accepted: false });
    expect(
      (await repository.readLiveDraft(f.guest, f.familyId, g.id))!.placements[0]
        .tile.letter,
    ).toBe("B");
    await repository.writeLiveDraft(f.admin, f.familyId, {
      ...b,
      sequence: 2,
      kind: "clear",
      placements: [],
    });
    expect(
      (await repository.readLiveDraft(f.guest, f.familyId, g.id))!.placements,
    ).toEqual([]);
  });

  it("bootstraps only an explicitly chosen verified Auth identity and never elevates an existing family on rerun", async () => {
    const identity = actor("bootstrap"),
      familyId = randomUUID();
    await owner`insert into auth.users(id,email) values(${identity.userId}::uuid,${identity.email})`;
    const args = [
      "scripts/bootstrap-family.mjs",
      "--family-id",
      familyId,
      "--family-name",
      "Bootstrap family",
      "--owner-user-id",
      identity.userId,
      "--owner-email",
      identity.email,
      "--player-name",
      "Owner",
    ];
    const env = {
      ...process.env,
      SCRABBLE_OWNER_DATABASE_URL: `postgres://scrabble_test_owner@127.0.0.1:${process.env.SCRABBLE_TEST_PORT}/postgres`,
    };
    expect(() =>
      execFileSync(process.execPath, [...args, "--apply"], {
        env,
        stdio: "pipe",
      }),
    ).toThrow();
    expect(
      await owner`select 1 from scrabble.families where id=${familyId}::uuid`,
    ).toHaveLength(0);
    await owner`update auth.users set email_confirmed_at=now() where id=${identity.userId}::uuid`;
    await owner`update auth.users set banned_until='infinity'::timestamptz where id=${identity.userId}::uuid`;
    expect(() =>
      execFileSync(process.execPath, [...args, "--apply"], {
        env,
        stdio: "pipe",
      }),
    ).toThrow();
    await owner`update auth.users set banned_until=null where id=${identity.userId}::uuid`;
    execFileSync(process.execPath, args, { env, stdio: "pipe" });
    expect(
      await owner`select 1 from scrabble.families where id=${familyId}::uuid`,
    ).toHaveLength(0);
    execFileSync(process.execPath, [...args, "--apply"], {
      env,
      stdio: "pipe",
    });
    execFileSync(process.execPath, [...args, "--apply"], {
      env,
      stdio: "pipe",
    });
    const [membership] =
      await owner`select * from scrabble.memberships where family_id=${familyId}::uuid`;
    expect(membership).toMatchObject({
      user_id: identity.userId,
      role: "superadmin",
      active: true,
    });
    const [{ count }] =
      await owner`select count(*)::int count from scrabble.audit where family_id=${familyId}::uuid and action='family.bootstrapped'`;
    expect(count).toBe(1);
  });
  it("uses a private schema, RLS on every table and no runtime erasure privileges", async () => {
    const tables =
      await owner`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='scrabble' and c.relkind='r'`;
    expect(tables.length).toBeGreaterThanOrEqual(13);
    expect(tables.every((t) => t.relrowsecurity)).toBe(true);
    for (const t of tables) {
      const [rights] =
        await owner`select has_table_privilege('scrabble_runtime',${`scrabble.${t.relname}`},'delete') deleted,has_table_privilege('scrabble_runtime',${`scrabble.${t.relname}`},'truncate') truncated`;
      expect(rights).toMatchObject({ deleted: false, truncated: false });
    }
    const [functions] =
      await owner`select count(*)::int count from pg_proc p join pg_namespace n on n.oid=p.pronamespace, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='scrabble' and a.grantee=0 and a.privilege_type='EXECUTE'`;
    expect(functions.count).toBe(0);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [rights] =
        await owner`select has_schema_privilege(${role},'scrabble','usage') schema_access,has_function_privilege(${role},'scrabble.read_watch(text)','execute') watch_access`;
      expect(rights).toMatchObject({
        schema_access: false,
        watch_access: false,
      });
    }
  });
  it("separates family history and denies unknown, revoked and unverified actors", async () => {
    const f = await fixture();
    const other = await fixture();
    await f.create();
    expect(
      (await repository.readState(f.admin, f.familyId)).games,
    ).toHaveLength(1);
    await code(repository.readState(other.admin, f.familyId), "NOT_A_MEMBER");
    await code(
      repository.readState(
        { ...f.admin, emailVerified: false } as unknown as VerifiedActor,
        f.familyId,
      ),
      "UNAUTHENTICATED",
    );
    await f.mutate({
      type: "update-member",
      userId: f.guest.userId,
      role: "member",
      active: false,
      playerId: "ben",
      reason: "Revoke access",
    });
    await code(repository.readState(f.guest, f.familyId), "NOT_A_MEMBER");
    const rows = await runtime.begin(async (tx) => {
      await tx`set local role scrabble_runtime`;
      return tx`select * from scrabble.game_heads`;
    });
    expect(rows).toHaveLength(0);
  });
  it("requires allowlisted verified email, records admission once, never re-admits revoked users", async () => {
    const f = await fixture();
    const invited = actor("invite");
    await code(
      repository.admit(invited, f.familyId, randomUUID()),
      "NOT_INVITED",
    );
    await f.mutate({ type: "invite-member", email: invited.email });
    await Promise.all([
      repository.admit(invited, f.familyId, randomUUID()),
      repository.admit(invited, f.familyId, randomUUID()),
    ]);
    expect((await repository.readState(invited, f.familyId)).member.role).toBe(
      "member",
    );
    const [{ count }] =
      await owner`select count(*)::int count from scrabble.audit where family_id=${f.familyId}::uuid and action='member.admitted'`;
    expect(count).toBe(1);
    await f.mutate({
      type: "update-member",
      userId: invited.userId,
      role: "member",
      active: false,
      playerId: null,
      reason: "Access ended",
    });
    await code(
      repository.admit(invited, f.familyId, randomUUID()),
      "NOT_INVITED",
    );
  });
  it("allows self-linked profile edits and admin edits, rejects another profile and stale revision", async () => {
    const f = await fixture();
    await code(
      f.mutate(
        {
          type: "update-player",
          id: "ada",
          expectedRevision: 0,
          profile: { name: "Fake" },
        },
        f.guest,
      ),
      "PERMISSION_DENIED",
    );
    await f.mutate(
      {
        type: "update-player",
        id: "ben",
        expectedRevision: 0,
        profile: { name: "Benjamin", bio: "Family player" },
      },
      f.guest,
    );
    await code(
      f.mutate(
        {
          type: "update-player",
          id: "ben",
          expectedRevision: 0,
          profile: { name: "Stale" },
        },
        f.guest,
      ),
      "REVISION_CONFLICT",
    );
    const game = (await f.create()).game!;
    await f.mutate({
      type: "update-player",
      id: "ben",
      expectedRevision: 1,
      profile: { name: "Changed later" },
    });
    expect(
      (await repository.readState(f.admin, f.familyId)).games[0].players,
    ).toEqual(game.players);
  });
  it("decodes profile JPEGs on the server and rejects malformed images without changing the profile", async () => {
    const f = await fixture();
    const counterfeit = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 0, 255, 217]).toString("base64")}`;
    await code(
      f.mutate({
        type: "update-player",
        id: "ada",
        expectedRevision: 0,
        profile: { name: "Unchanged", photoDataUrl: counterfeit },
      }),
      "INVALID_PROFILE_PHOTO",
    );
    expect(
      (await repository.readState(f.admin, f.familyId)).players.find(
        (p) => p.id === "ada",
      )!.name,
    ).toBe("Ada");
  });
  it("rolls back journal inserts when projection persistence fails after validation", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    await owner.unsafe(
      `create function scrabble.test_fail_projection() returns trigger language plpgsql as $$ begin raise exception 'Injected storage failure'; end $$`,
    );
    await owner.unsafe(
      `create trigger test_projection_failure before update on scrabble.game_heads for each row when(new.game_id='${game.id}') execute function scrabble.test_fail_projection()`,
    );
    try {
      await expect(f.mutate(pass(game.id))).rejects.toMatchObject({
        code: "P0001",
      });
      const [{ count }] =
        await owner`select count(*)::int count from scrabble.game_events where family_id=${f.familyId}::uuid and game_id=${game.id}`;
      expect(count).toBe(0);
      expect(
        (await repository.readState(f.admin, f.familyId)).games[0].revision,
      ).toBe(0);
    } finally {
      await owner`drop trigger test_projection_failure on scrabble.game_heads`;
      await owner`drop function scrabble.test_fail_projection()`;
    }
  });
  it("makes concurrent duplicate retries exactly one game, rejects reused IDs", async () => {
    const f = await fixture();
    const requestId = randomUUID();
    const id = randomUUID();
    const op: SharedOperation = {
      type: "create-game",
      id,
      mode: "practice",
      players: [{ id: "ada", seat: 0 }],
      firstPlayerId: "ada",
      direction: "clockwise",
      deviceId: "device-a",
    };
    const results = await Promise.all([
      f.mutate(op, f.admin, requestId),
      f.mutate(op, f.admin, requestId),
    ]);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    expect(
      (await repository.readState(f.admin, f.familyId)).games,
    ).toHaveLength(1);
    await code(
      f.mutate({ ...op, id: randomUUID() }, f.admin, requestId),
      "REQUEST_ID_REUSED",
    );
  });
  it("serializes competing turns and atomically rolls back an invalid command batch", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    const outcomes = await Promise.allSettled([
      f.mutate(pass(game.id)),
      f.mutate(pass(game.id)),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("REVISION_CONFLICT");
    await code(
      f.mutate({
        type: "game-commands",
        gameId: game.id,
        deviceId: "device-a",
        generation: 1,
        commands: [
          { type: "pass", id: randomUUID(), expectedRevision: 1 },
          {
            type: "exchange",
            count: 99,
            id: randomUUID(),
            expectedRevision: 2,
          },
        ],
      }),
      "INVALID_COMMAND",
    );
    const state = await repository.readState(f.admin, f.familyId);
    expect(state.games[0].revision).toBe(1);
    const [{ count }] =
      await owner`select count(*)::int count from scrabble.game_events where family_id=${f.familyId}::uuid and game_id=${game.id}`;
    expect(count).toBe(1);
  });
  it("allows the designated person to score and verify words from another device without transfer", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    const chrome = { ...f.admin, deviceHash: "b".repeat(64) };
    const before = (await repository.readState(chrome, f.familyId)).gameAccess[
      game.id
    ];
    expect(before).toMatchObject({
      canScore: true,
      generation: 1,
      deviceId: "device-a",
    });
    const saved = await f.mutate(
      { ...pass(game.id), deviceId: "device-b" },
      chrome,
    );
    expect(saved.game!.revision).toBe(1);
    expect(saved.gameAccess).toMatchObject({ canScore: true, generation: 1 });
    const verified = await f.mutate(
      {
        type: "verify-words",
        gameId: game.id,
        words: ["ZZTEST"],
        deviceId: "device-b",
        generation: 1,
        expectedRevision: 1,
      },
      chrome,
    );
    expect(verified.game!.revision).toBe(2);
    expect((verified.game!.verifiedWords ?? []).map((w) => w.word)).toContain(
      "ZZTEST",
    );
    const [{ count }] =
      await owner`select count(*)::int count from scrabble.audit where family_id=${f.familyId}::uuid and action='game.scorer-transferred'`;
    expect(count).toBe(0);
    const [{ scorer_user_id, scorer_device_id, scorer_generation }] =
      await owner`select scorer_user_id,scorer_device_id,scorer_generation from scrabble.game_heads where family_id=${f.familyId}::uuid and game_id=${game.id}`;
    expect({ scorer_user_id, scorer_device_id, scorer_generation }).toEqual({
      scorer_user_id: f.admin.userId,
      scorer_device_id: "device-a",
      scorer_generation: 1,
    });
  });
  it("denies other accounts, including a superadmin with matching device metadata, and rejects stale scorer generations", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    await code(f.mutate(pass(game.id), f.guest), "SCORER_CONFLICT");
    await f.mutate({
      type: "update-member",
      userId: f.guest.userId,
      role: "superadmin",
      active: true,
      playerId: "ben",
      reason: "Delegate admin",
    });
    const other = { ...f.guest, deviceHash: f.admin.deviceHash };
    expect(
      (await repository.readState(other, f.familyId)).gameAccess[game.id]
        .canScore,
    ).toBe(false);
    await code(f.mutate(pass(game.id), other), "SCORER_CONFLICT");
    await code(
      f.mutate({ ...pass(game.id), generation: 2 }),
      "SCORER_CONFLICT",
    );
    const callsBefore = verifierCalls;
    await code(
      f.mutate(
        {
          type: "verify-words",
          gameId: game.id,
          words: ["ZZTEST"],
          expectedRevision: 0,
          generation: 1,
          deviceId: "device-a",
        },
        other,
      ),
      "SCORER_CONFLICT",
    );
    expect(verifierCalls).toBe(callsBefore);
    expect(
      (await repository.readState(f.admin, f.familyId)).games[0].revision,
    ).toBe(0);
  });
  it("serializes competing devices for the same scorer and acknowledges a retry without duplicating a turn", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    const chrome = { ...f.admin, deviceHash: "c".repeat(64) };
    const operations = [
      pass(game.id),
      { ...pass(game.id), deviceId: "device-b" },
    ];
    const requestIds = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled([
      f.mutate(operations[0], f.admin, requestIds[0]),
      f.mutate(operations[1], chrome, requestIds[1]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.code,
    ).toBe("REVISION_CONFLICT");
    const winner = results.findIndex((r) => r.status === "fulfilled");
    const retried = await f.mutate(
      operations[winner],
      chrome,
      requestIds[winner],
    );
    expect(retried).toMatchObject({
      replayed: true,
      gameAccess: { canScore: true },
    });
    expect(retried.game!.revision).toBe(1);
    const [{ count }] =
      await owner`select count(*)::int count from scrabble.game_events where family_id=${f.familyId}::uuid and game_id=${game.id}`;
    expect(count).toBe(1);
  });
  it("transfers scoring to a different person with an audit and fences every device of the former scorer", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    const operation = pass(game.id),
      requestId = randomUUID();
    await f.mutate(operation, f.admin, requestId);
    await f.mutate({
      type: "update-member",
      userId: f.guest.userId,
      role: "superadmin",
      active: true,
      playerId: "ben",
      reason: "Delegate admin",
    });
    const replacement = { ...f.guest, deviceHash: "b".repeat(64) };
    const transfer = await f.mutate(
      {
        type: "take-over-scoring",
        gameId: game.id,
        deviceId: "device-b",
        expectedGeneration: 1,
        reason: "Ben will score the rest of the game",
      },
      replacement,
    );
    expect(transfer.gameAccess).toMatchObject({
      generation: 2,
      canScore: true,
      scorerUserId: f.guest.userId,
    });
    for (const former of [
      f.admin,
      { ...f.admin, deviceHash: "c".repeat(64) },
    ]) {
      expect(
        (await repository.readState(former, f.familyId)).gameAccess[game.id]
          .canScore,
      ).toBe(false);
      await code(
        f.mutate({ ...pass(game.id, 1), generation: 2 }, former),
        "SCORER_CONFLICT",
      );
    }
    const acknowledged = await f.mutate(operation, f.admin, requestId);
    expect(acknowledged).toMatchObject({
      replayed: true,
      gameAccess: { canScore: false, generation: 2 },
    });
    // The new scorer can use a third device, too, but must use the new generation.
    await code(f.mutate(pass(game.id, 1), replacement), "SCORER_CONFLICT");
    await f.mutate(
      { ...pass(game.id, 1), deviceId: "device-c", generation: 2 },
      { ...replacement, deviceHash: "d".repeat(64) },
    );
    const [{ count }] =
      await owner`select count(*)::int count from scrabble.audit where family_id=${f.familyId}::uuid and action='game.scorer-transferred'`;
    expect(count).toBe(1);
    expect(
      JSON.stringify(await repository.readState(replacement, f.familyId)),
    ).not.toContain(replacement.deviceHash);
  });
  it("cannot remove the last superadmin, including racing demotions", async () => {
    const f = await fixture();
    await code(
      f.mutate({
        type: "update-member",
        userId: f.admin.userId,
        role: "member",
        active: true,
        playerId: "ada",
        reason: "Demote self",
      }),
      "LAST_SUPERADMIN",
    );
    await f.mutate({
      type: "update-member",
      userId: f.guest.userId,
      role: "superadmin",
      active: true,
      playerId: "ben",
      reason: "Delegate",
    });
    const outcomes = await Promise.allSettled([
      f.mutate({
        type: "update-member",
        userId: f.admin.userId,
        role: "member",
        active: true,
        playerId: "ada",
        reason: "Demote self",
      }),
      f.mutate(
        {
          type: "update-member",
          userId: f.guest.userId,
          role: "member",
          active: true,
          playerId: "ben",
          reason: "Demote self",
        },
        f.guest,
      ),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [{ count }] =
      await owner`select count(*)::int count from scrabble.memberships where family_id=${f.familyId}::uuid and active and role='superadmin'`;
    expect(count).toBe(1);
  });
  it("checks revocation in the same serialized transaction as scoring and denies replay after revocation", async () => {
    const f = await fixture();
    const requestId = randomUUID();
    const created = (await f.create()).game!;
    await f.mutate({
      type: "update-member",
      userId: f.guest.userId,
      role: "superadmin",
      active: true,
      playerId: "ben",
      reason: "Delegate",
    });
    const operation = pass(created.id);
    await f.mutate(operation, f.admin, requestId);
    await f.mutate(
      {
        type: "update-member",
        userId: f.admin.userId,
        role: "member",
        active: false,
        playerId: "ada",
        reason: "Revoke scorer",
      },
      f.guest,
    );
    await code(f.mutate(operation, f.admin, requestId), "NOT_A_MEMBER");
    expect(
      (await repository.readState(f.guest, f.familyId)).games[0].revision,
    ).toBe(1);
  });
  it("keeps legacy own-account approval history without requiring it before scoring", async () => {
    const f = await fixture();
    const created = await f.create("confirmed");
    const game = created.game!;
    const own = {
      type: "approve-game" as const,
      gameId: game.id,
      stage: "start" as const,
      expectedRevision: 0,
    };
    const requestId = randomUUID();
    await f.mutate(own, f.admin, requestId);
    expect((await f.mutate(own, f.admin, requestId)).replayed).toBe(true);
    await f.mutate(own); // a second request cannot add approval for another player
    const stranger = actor("stranger");
    await owner`insert into scrabble.memberships(family_id,user_id,email,role) values(${f.familyId}::uuid,${stranger.userId}::uuid,${stranger.email},'superadmin')`;
    await code(f.mutate(own, stranger), "NOT_A_PARTICIPANT");
    const next = await f.mutate(pass(game.id));
    expect(next.game!.revision).toBe(1);
    expect(
      next.gameAccess!.approvals.filter((p) => p.startApproved),
    ).toHaveLength(1);
  });
  it("freezes participant identity when a profile is re-linked and rejects forged SQL approvals", async () => {
    const f = await fixture();
    const game = (await f.create("confirmed")).game!;
    await f.mutate({
      type: "update-member",
      userId: f.guest.userId,
      role: "member",
      active: true,
      playerId: null,
      reason: "Unlink",
    });
    const replacement = actor("replacement");
    await owner`insert into scrabble.memberships(family_id,user_id,email,role,player_id) values(${f.familyId}::uuid,${replacement.userId}::uuid,${replacement.email},'member','ben')`;
    await code(
      f.mutate(
        {
          type: "approve-game",
          gameId: game.id,
          stage: "start",
          expectedRevision: 0,
        },
        replacement,
      ),
      "NOT_A_PARTICIPANT",
    );
    await f.mutate(
      {
        type: "approve-game",
        gameId: game.id,
        stage: "start",
        expectedRevision: 0,
      },
      f.guest,
    );
    await expect(
      runtime.begin(async (tx) => {
        await tx`set local role scrabble_runtime`;
        await tx`select set_config('scrabble.actor_id',${f.admin.userId},true),set_config('scrabble.family_id',${f.familyId},true)`;
        await tx`insert into scrabble.game_approvals(family_id,game_id,player_id,stage,revision,actor_id) values(${f.familyId}::uuid,${game.id},'ben','result',0,${f.admin.userId}::uuid)`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("binds result approval to final revision and retains original results", async () => {
    const f = await fixture();
    const game = (await f.create("confirmed")).game!;
    await f.mutate({
      type: "approve-game",
      gameId: game.id,
      stage: "start",
      expectedRevision: 0,
    });
    await f.mutate(
      {
        type: "approve-game",
        gameId: game.id,
        stage: "start",
        expectedRevision: 0,
      },
      f.guest,
    );
    await code(
      f.mutate({
        type: "approve-game",
        gameId: game.id,
        stage: "result",
        expectedRevision: 0,
      }),
      "RESULT_NOT_READY",
    );
    const final = await f.mutate({
      type: "game-commands",
      gameId: game.id,
      deviceId: "device-a",
      generation: 1,
      commands: [
        {
          type: "finalize",
          id: randomUUID(),
          expectedRevision: 0,
          reason: "early",
          racks: {
            ada: ["A", "A", "A", "A", "A", "A", "A"],
            ben: ["E", "E", "E", "E", "E", "E", "E"],
          },
        },
      ],
    });
    expect(final.game!.status).toBe("finalized");
    await code(
      f.mutate({
        type: "approve-game",
        gameId: game.id,
        stage: "result",
        expectedRevision: 0,
      }),
      "REVISION_CONFLICT",
    );
    await f.mutate({
      type: "approve-game",
      gameId: game.id,
      stage: "result",
      expectedRevision: 1,
    });
    const confirmed = await f.mutate(
      {
        type: "approve-game",
        gameId: game.id,
        stage: "result",
        expectedRevision: 1,
      },
      f.guest,
    );
    expect(confirmed.gameAccess!.approvals.every((p) => p.resultApproved)).toBe(
      true,
    );
    expect(confirmed.game!.result!.competitiveEligible).toBe(false); // test dictionary and early ending remain ineligible
    await code(f.mutate(pass(game.id, 1)), "GAME_FINALIZED");
    const [{ count }] =
      await owner`select count(*)::int count from scrabble.game_results where family_id=${f.familyId}::uuid and game_id=${game.id}`;
    expect(count).toBe(1);
  });
  it("does not trust browser word verification and persists positive server evidence idempotently", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    await code(
      f.mutate({
        type: "game-commands",
        gameId: game.id,
        deviceId: "device-a",
        generation: 1,
        commands: [
          {
            type: "verify-words",
            id: randomUUID(),
            expectedRevision: 0,
            words: [
              {
                word: "ZZTEST",
                source: "merriam-webster",
                sourceUrl: "https://scrabble.merriam.com/finder/zztest",
                verifiedAt: "2026-09-14T18:00:00.000Z",
              },
            ],
          },
        ],
      }),
      "WORD_UNVERIFIED",
    );
    const calls = verifierCalls,
      requestId = randomUUID();
    const operation = {
      type: "verify-words" as const,
      gameId: game.id,
      words: ["ZZTEST"],
      expectedRevision: 0,
      deviceId: "device-a",
      generation: 1,
    };
    const verified = await f.mutate(operation, f.admin, requestId);
    expect(verified.game!.verifiedWords?.[0].word).toBe("ZZTEST");
    await f.mutate(operation, f.admin, requestId);
    expect(verifierCalls - calls).toBe(1);
    const newGame = await f.create();
    expect(newGame.game!.verifiedWords?.[0].word).toBe("ZZTEST");
  });
  it("prevents update/delete/truncate of original definitions, events, results, approvals and audit", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    await f.mutate(pass(game.id));
    for (const table of [
      "game_definitions",
      "game_events",
      "game_results",
      "game_approvals",
      "game_protests",
      "game_protest_resolutions",
      "audit",
      "requests",
    ]) {
      for (const action of [
        `delete from scrabble.${table}`,
        `truncate scrabble.${table}`,
        `update scrabble.${table} set family_id=family_id`,
      ]) {
        await expect(
          runtime.begin(async (tx) => {
            await tx`set local role scrabble_runtime`;
            await tx`select set_config('scrabble.actor_id',${f.admin.userId},true),set_config('scrabble.family_id',${f.familyId},true)`;
            await tx.unsafe(action);
          }),
        ).rejects.toMatchObject({ code: "42501" });
      }
    }
    expect(
      (await repository.readState(f.admin, f.familyId)).games[0].revision,
    ).toBe(1);
  });
  it("paginates deterministically without duplicating or dropping games and exports permanent history", async () => {
    const f = await fixture();
    for (let i = 0; i < 23; i++)
      await f.create("practice", `game-${String(i).padStart(2, "0")}`);
    await owner`alter table scrabble.game_definitions disable trigger immutable_update`;
    try {
      await owner`update scrabble.game_definitions set created_at='2026-09-14T12:00:00.123000Z'::timestamptz + ((substring(game_id from 6))::int * interval '1 microsecond') where family_id=${f.familyId}::uuid`;
    } finally {
      await owner`alter table scrabble.game_definitions enable trigger immutable_update`;
    }
    const first = await repository.readState(f.admin, f.familyId);
    const second = await repository.readState(f.admin, f.familyId, {
      cursor: first.nextCursor!,
    });
    expect(first.games).toHaveLength(20);
    expect(second.games).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.games, ...second.games].map((g) => g.id)).size,
    ).toBe(23);
    expect(
      (
        await repository.readState(f.admin, f.familyId, { gameId: "game-00" })
      ).games.some((g) => g.id === "game-00"),
    ).toBe(true);
    await code(
      repository.exportHistory(f.guest, f.familyId),
      "PERMISSION_DENIED",
    );
    const archive = (await repository.exportHistory(f.admin, f.familyId)) as {
      definitions: unknown[];
      audit: unknown[];
    };
    expect(archive.definitions).toHaveLength(23);
    expect(archive.audit.length).toBeGreaterThan(23);
  });
  it("grants a bounded private read-only guest view without storing plaintext link tokens", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    const token = createHash("sha256").update(randomUUID()).digest("hex");
    const requestId = randomUUID();
    await code(
      f.mutate({ type: "create-watch-link", gameId: game.id, token }, f.guest),
      "FORBIDDEN",
    );
    await f.mutate(
      { type: "create-watch-link", gameId: game.id, token },
      f.admin,
      requestId,
    );
    await f.mutate(
      { type: "create-watch-link", gameId: game.id, token },
      f.admin,
      requestId,
    );
    const view = await repository.readWatch(token);
    expect(view).toMatchObject({
      id: game.id,
      status: "active",
      scores: { ada: 0, ben: 0 },
      expectedBagCount: 86,
      tileSupply: null,
      assisted: false,
    });
    expect(Object.keys(view).sort()).toEqual(
      [
        "id",
        "players",
        "board",
        "scores",
        "result",
        "turns",
        "order",
        "status",
        "pendingEnd",
        "currentPlayerId",
        "expectedBagCount",
        "tileSupply",
        "assisted",
        "revision",
        "scorerGeneration",
        "liveDraft",
      ].sort(),
    );
    const stored =
      await owner`select row_to_json(w) value from scrabble.watch_links w where family_id=${f.familyId}::uuid`;
    expect(JSON.stringify(stored)).not.toContain(token);
    const archive = JSON.stringify(
      await repository.exportHistory(f.admin, f.familyId),
    );
    expect(archive).not.toContain(token);
    expect(JSON.stringify(view)).not.toContain(f.admin.userId);
    expect(JSON.stringify(view)).not.toContain(f.admin.email);
    expect(JSON.stringify(view)).not.toContain(f.admin.deviceHash!);
    await f.mutate(pass(game.id));
    expect((await repository.readWatch(token)).turns).toHaveLength(1);
    await code(repository.readWatch("a".repeat(64)), "WATCH_LINK_UNAVAILABLE");
    await code(repository.readWatch("bad-token"), "WATCH_LINK_UNAVAILABLE");
  });
  it("keeps viewer tile totals current through play, undo, custom supply, reconciliation and assistance without exposing racks", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    const token = createHash("sha256").update(randomUUID()).digest("hex");
    await f.mutate({ type: "create-watch-link", gameId: game.id, token });
    const command = (
      commands: Extract<SharedOperation, { type: "game-commands" }>["commands"],
    ) =>
      f.mutate({
        type: "game-commands",
        gameId: game.id,
        deviceId: "device-a",
        generation: 1,
        commands,
      });
    await command([
      {
        type: "play",
        id: randomUUID(),
        expectedRevision: 0,
        placements: ["C", "A", "T"].map((letter, i) => ({
          row: 7,
          col: 7 + i,
          tile: { letter: letter as "C" | "A" | "T", blank: false },
        })),
      },
    ]);
    const played = await repository.readWatch(token);
    expect(played.expectedBagCount).toBe(83);
    expect(countUnplayed(played.board).C).toBe(1);
    await command([
      {
        type: "undo",
        id: randomUUID(),
        expectedRevision: 1,
        reason: "Correct the test placement",
      },
    ]);
    expect((await repository.readWatch(token)).expectedBagCount).toBe(86);
    await command([
      {
        type: "extend-supply",
        id: randomUUID(),
        expectedRevision: 2,
        additions: { Q: 1 },
        reason: "Extra physical tile in test set",
        recordedBy: "Test scorer",
        recordedAt: new Date().toISOString(),
      },
    ]);
    const custom = await repository.readWatch(token);
    expect(custom.expectedBagCount).toBe(87);
    expect(custom.tileSupply?.Q).toBe(2);
    expect(countUnplayed(custom.board, custom.tileSupply!).Q).toBe(2);
    await command([
      {
        type: "reconcile",
        id: randomUUID(),
        expectedRevision: 3,
        rackCounts: { ada: 6, ben: 7 },
        bagCount: 88,
        reason: "One undrawn tile",
        recordedBy: "Test scorer",
        recordedAt: new Date().toISOString(),
      },
    ]);
    expect((await repository.readWatch(token)).expectedBagCount).toBe(88);
    await command([
      {
        type: "assist",
        id: randomUUID(),
        expectedRevision: 4,
        racks: {
          ada: ["A", "A", "A", "A", "A", "A"],
          ben: ["E", "E", "E", "E", "E", "E", "E"],
        },
      },
    ]);
    const assisted = await repository.readWatch(token);
    expect(assisted.assisted).toBe(true);
    expect(assisted.expectedBagCount).toBe(88);
    expect(assisted).not.toHaveProperty("assistance");
    expect(assisted).not.toHaveProperty("racks");
    expect(assisted).not.toHaveProperty("expectedRackCounts");
    expect(assisted).not.toHaveProperty("events");
  });
  it("shows the final score adjustment summary to guests while withholding rack contents", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    const token = createHash("sha256").update(randomUUID()).digest("hex");
    await f.mutate({ type: "create-watch-link", gameId: game.id, token });
    await f.mutate({
      type: "game-commands",
      gameId: game.id,
      deviceId: "device-a",
      generation: 1,
      commands: [
        {
          type: "finalize",
          id: randomUUID(),
          expectedRevision: 0,
          reason: "early",
          racks: {
            ada: ["A", "A", "A", "A", "A", "A", "A"],
            ben: ["E", "E", "E", "E", "E", "E", "E"],
          },
        },
      ],
    });
    const view = await repository.readWatch(token);
    expect(view.result).toMatchObject({
      scores: { ada: -7, ben: -7 },
      scoresBeforeAdjustments: { ada: 0, ben: 0 },
      adjustments: { ada: { deduction: 7, transfer: 0, finalScore: -7 } },
      winnerIds: ["ada", "ben"],
    });
    expect(view.result).not.toHaveProperty("racks");
    expect(view).not.toHaveProperty("assistance");
    expect(view).not.toHaveProperty("events");
  });
  it("rotates, expires and revokes guest links and removes access when their issuer is revoked", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    const old = createHash("sha256").update(randomUUID()).digest("hex"),
      next = createHash("sha256").update(randomUUID()).digest("hex");
    await f.mutate({ type: "create-watch-link", gameId: game.id, token: old });
    await f.mutate({ type: "create-watch-link", gameId: game.id, token: next });
    await code(repository.readWatch(old), "WATCH_LINK_UNAVAILABLE");
    await owner`update scrabble.watch_links set expires_at=now()-interval '1 second' where family_id=${f.familyId}::uuid`;
    await code(repository.readWatch(next), "WATCH_LINK_UNAVAILABLE");
    await f.mutate({ type: "create-watch-link", gameId: game.id, token: old });
    await f.mutate({ type: "revoke-watch-link", gameId: game.id });
    await code(repository.readWatch(old), "WATCH_LINK_UNAVAILABLE");
    await f.mutate({ type: "create-watch-link", gameId: game.id, token: next });
    await f.mutate({
      type: "update-member",
      userId: f.guest.userId,
      role: "superadmin",
      active: true,
      playerId: "ben",
      reason: "Delegate",
    });
    await f.mutate(
      {
        type: "update-member",
        userId: f.admin.userId,
        role: "member",
        active: false,
        playerId: "ada",
        reason: "Revoke issuer",
      },
      f.guest,
    );
    await code(repository.readWatch(next), "WATCH_LINK_UNAVAILABLE");
  });
  it("records and finalizes a confirmed game with an unsigned guest immediately, without approval gates", async () => {
    const f = await fixture();
    await f.mutate({
      type: "create-player",
      id: "visitor",
      profile: { name: "Visiting cousin" },
    });
    const created = await f.mutate({
      type: "create-game",
      id: randomUUID(),
      mode: "confirmed",
      players: [
        { id: "ada", seat: 0 },
        { id: "visitor", seat: 2 },
      ],
      firstPlayerId: "ada",
      direction: "clockwise",
      deviceId: "device-a",
    });
    const game = created.game!;
    expect(
      created.gameAccess!.approvals.find((p) => p.playerId === "visitor")!
        .userId,
    ).toBeNull();
    const played = await f.mutate({
      type: "game-commands",
      gameId: game.id,
      deviceId: "device-a",
      generation: 1,
      commands: [
        {
          type: "play",
          id: randomUUID(),
          expectedRevision: 0,
          placements: [
            { row: 7, col: 7, tile: { letter: "A", blank: false } },
            { row: 7, col: 8, tile: { letter: "T", blank: false } },
          ],
        },
      ],
    });
    expect(played.game!.scores.ada).toBe(4);
    const final = await f.mutate({
      type: "game-commands",
      gameId: game.id,
      deviceId: "device-a",
      generation: 1,
      commands: [
        {
          type: "finalize",
          id: randomUUID(),
          expectedRevision: 1,
          reason: "early",
          racks: {
            ada: ["E", "E", "E", "E", "E", "E", "E"],
            visitor: ["A", "A", "A", "A", "A", "A", "A"],
          },
        },
      ],
    });
    expect(final.game!.status).toBe("finalized");
    expect(final.game!.result!.winnerIds).toEqual(["ada"]);
    expect(
      final.gameAccess!.approvals.every(
        (p) => !p.startApproved && !p.resultApproved,
      ),
    ).toBe(true);
    expect(final.gameAccess!.recordsEligible).toBe(false); // Early/test-word exclusions still apply.
    await code(f.mutate(pass(game.id), f.guest), "SCORER_CONFLICT");
    await code(
      repository.mutate({} as VerifiedActor, f.familyId, {
        requestId: randomUUID(),
        operation: pass(game.id),
      }),
      "UNAUTHENTICATED",
    );
  });
  it("holds genuinely eligible records for open and upheld protests while preserving original scores and decisions", async () => {
    const ready = Object.freeze({
      ...testLexicon,
      id: "trusted-ready-test",
      status: "ready" as const,
    });
    const shared = createSharedRepository(runtime, {
      defaultLexicon: ready,
      resolveLexicon: () => ready,
    });
    const f = await fixture(shared);
    const game = (await f.create("confirmed")).game!;
    const final = await f.mutate({
      type: "game-commands",
      gameId: game.id,
      deviceId: "device-a",
      generation: 1,
      commands: [
        ...Array.from({ length: 4 }, (_, index) => ({
          type: "pass" as const,
          id: randomUUID(),
          expectedRevision: index,
        })),
        {
          type: "finalize",
          id: randomUUID(),
          expectedRevision: 4,
          reason: "blocked",
          racks: {
            ada: ["A", "A", "A", "A", "A", "A", "A"],
            ben: ["E", "E", "E", "E", "E", "E", "E"],
          },
        },
      ],
    });
    expect(final.game!.result!.competitiveEligible).toBe(true);
    expect(final.gameAccess!.recordsEligible).toBe(true);
    expect(
      final.gameAccess!.approvals.every(
        (p) => !p.startApproved && !p.resultApproved,
      ),
    ).toBe(true);
    const requestId = randomUUID();
    const operation = {
      type: "report-protest" as const,
      gameId: game.id,
      reason: "The ending deduction may be wrong.\nPlease review the rack.",
      reportedFor: "Visiting cousin",
    };
    const submitted = await Promise.all([
      f.mutate(operation, f.guest, requestId),
      f.mutate(operation, f.guest, requestId),
    ]);
    expect(submitted.filter((r) => r.replayed)).toHaveLength(1);
    const report = submitted[0];
    expect(report.game).toEqual(final.game);
    expect(report.gameAccess!.recordsEligible).toBe(false);
    expect(report.gameAccess!.protests).toHaveLength(1);
    expect(report.gameAccess!.protests[0]).toMatchObject({
      reportedBy: "Ben",
      reportedFor: "Visiting cousin",
      gameRevision: 5,
      resolution: null,
    });
    const protestId = report.gameAccess!.protests[0].id;
    await code(f.mutate(operation, f.guest), "PROTEST_ALREADY_OPEN");
    await code(
      f.mutate(
        {
          type: "resolve-protest",
          gameId: game.id,
          protestId,
          outcome: "dismissed",
          reason: "I disagree",
        },
        f.guest,
      ),
      "PERMISSION_DENIED",
    );
    const resolutionId = randomUUID();
    const dismissal = {
      type: "resolve-protest" as const,
      gameId: game.id,
      protestId,
      outcome: "dismissed" as const,
      reason: "Checked the original rack.\nThe deduction is correct.",
    };
    const dismissed = await f.mutate(dismissal, f.admin, resolutionId);
    expect(dismissed.gameAccess!.recordsEligible).toBe(true);
    expect((await f.mutate(dismissal, f.admin, resolutionId)).replayed).toBe(
      true,
    );
    expect(
      (await f.mutate(operation, f.guest, requestId)).gameAccess!
        .recordsEligible,
    ).toBe(true);
    const another = await f.mutate({
      type: "report-protest",
      gameId: game.id,
      reason: "A physical play was incorrectly recorded.",
      reportedFor: null,
    });
    expect(another.gameAccess!.recordsEligible).toBe(false);
    const second = another.gameAccess!.protests.at(-1)!.id;
    const upheld = await f.mutate({
      type: "resolve-protest",
      gameId: game.id,
      protestId: second,
      outcome: "upheld",
      reason:
        "The recorded play differs from the physical board. Preserve the original game for amendment.",
    });
    expect(upheld.gameAccess!.recordsEligible).toBe(false);
    expect(upheld.game).toEqual(final.game);
    expect(upheld.game!.result!.competitiveEligible).toBe(true);
    await code(
      f.mutate({
        type: "resolve-protest",
        gameId: game.id,
        protestId: second,
        outcome: "dismissed",
        reason: "Overwrite it",
      }),
      "PROTEST_ALREADY_RESOLVED",
    );
    const archive = (await shared.exportHistory(f.admin, f.familyId)) as {
      protests: unknown[];
      protestResolutions: unknown[];
      results: unknown[];
    };
    expect(archive.protests).toHaveLength(2);
    expect(archive.protestResolutions).toHaveLength(2);
    expect(archive.results).toHaveLength(1);
  });
  it("does not promote a domain-ineligible game when a concern is dismissed", async () => {
    const f = await fixture();
    const game = (await f.create("confirmed")).game!;
    const report = await f.mutate(
      {
        type: "report-protest",
        gameId: game.id,
        reason: "Check this test game.",
        reportedFor: null,
      },
      f.guest,
    );
    const resolved = await f.mutate({
      type: "resolve-protest",
      gameId: game.id,
      protestId: report.gameAccess!.protests[0].id,
      outcome: "dismissed",
      reason: "Checked and dismissed.",
    });
    expect(resolved.gameAccess!.recordsEligible).toBe(false);
    expect(resolved.game!.revision).toBe(0);
  });
  it("serializes conflicting superadmin decisions and rejects cross-family and forged review writes", async () => {
    const f = await fixture();
    const other = await fixture();
    const game = (await f.create()).game!;
    await code(
      other.mutate({
        type: "report-protest",
        gameId: game.id,
        reason: "Foreign game",
        reportedFor: null,
      }),
      "GAME_NOT_FOUND",
    );
    const reported = await f.mutate(
      {
        type: "report-protest",
        gameId: game.id,
        reason: "Please review the score.",
        reportedFor: null,
      },
      f.guest,
    );
    const protestId = reported.gameAccess!.protests[0].id;
    await expect(
      runtime.begin(async (tx) => {
        await tx`set local role scrabble_runtime`;
        await tx`select set_config('scrabble.actor_id',${f.guest.userId},true),set_config('scrabble.family_id',${f.familyId},true)`;
        await tx`insert into scrabble.game_protest_resolutions(family_id,game_id,protest_id,outcome,reason,resolver_id,resolved_by) values(${f.familyId}::uuid,${game.id},${protestId}::uuid,'dismissed','Forged review',${f.guest.userId}::uuid,'Ben')`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.begin(async (tx) => {
        await tx`set local role scrabble_runtime`;
        await tx`select set_config('scrabble.actor_id',${f.guest.userId},true),set_config('scrabble.family_id',${f.familyId},true)`;
        await tx`insert into scrabble.game_protests(family_id,game_id,id,reason,reporter_id,reported_by,game_revision) values(${f.familyId}::uuid,${game.id},${randomUUID()}::uuid,'Forged reporter',${f.admin.userId}::uuid,'Ada',0)`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await f.mutate({
      type: "update-member",
      userId: f.guest.userId,
      role: "superadmin",
      active: true,
      playerId: "ben",
      reason: "Delegate review",
    });
    const results = await Promise.allSettled([
      f.mutate({
        type: "resolve-protest",
        gameId: game.id,
        protestId,
        outcome: "dismissed",
        reason: "Decision A",
      }),
      f.mutate(
        {
          type: "resolve-protest",
          gameId: game.id,
          protestId,
          outcome: "upheld",
          reason: "Decision B",
        },
        f.guest,
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.code,
    ).toBe("PROTEST_ALREADY_RESOLVED");
    const [{ count }] =
      await owner`select count(*)::int count from scrabble.game_protest_resolutions where family_id=${f.familyId}::uuid and game_id=${game.id}`;
    expect(count).toBe(1);
    expect(
      (await repository.readState(f.admin, f.familyId)).gameAccess[game.id]
        .protests,
    ).toHaveLength(1);
  });
  it("accepts the hundredth concern and rejects the next without producing an unreadable access DTO", async () => {
    const f = await fixture();
    const game = (await f.create()).game!;
    await owner`insert into scrabble.game_protests(family_id,game_id,id,reason,reporter_id,reported_by,game_revision) select ${f.familyId}::uuid,${game.id},gen_random_uuid(),'Historical concern '||i,${f.guest.userId}::uuid,'Ben',0 from generate_series(1,99) i`;
    await owner`insert into scrabble.game_protest_resolutions(family_id,game_id,protest_id,outcome,reason,resolver_id,resolved_by) select family_id,game_id,id,'dismissed','Historical review',${f.admin.userId}::uuid,'Ada' from scrabble.game_protests where family_id=${f.familyId}::uuid and game_id=${game.id}`;
    const last = await f.mutate(
      {
        type: "report-protest",
        gameId: game.id,
        reason: "Concern number one hundred.",
        reportedFor: null,
      },
      f.guest,
    );
    expect(last.gameAccess!.protests).toHaveLength(100);
    await code(
      f.mutate({
        type: "report-protest",
        gameId: game.id,
        reason: "Concern number one hundred and one.",
        reportedFor: null,
      }),
      "PROTEST_LIMIT",
    );
    expect(
      (await repository.readState(f.admin, f.familyId)).gameAccess[game.id]
        .protests,
    ).toHaveLength(100);
  });
  it("captures an encrypted operator backup and independently restores every table", async () => {
    const directory = process.env.SCRABBLE_TEST_DIRECTORY!;
    const keyFile = join(directory, "operator.key");
    const archive = join(directory, "operator.backup.enc");
    await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
    const environment = {
      ...process.env,
      PGHOST: socket!,
      PGPORT: process.env.SCRABBLE_TEST_PORT!,
      PGUSER: "scrabble_test_owner",
      PGDATABASE: "postgres",
      SCRABBLE_BACKUP_KEY_FILE: keyFile,
    };
    const args = ["scripts/backup-database.mjs"];
    execFileSync(process.execPath, [...args, "capture", archive], {
      env: environment,
    });
    const bytes = await readFile(archive);
    expect(bytes.subarray(0, 8).toString()).toBe("AMBERLY1");
    expect(bytes.includes(Buffer.from("CREATE TABLE"))).toBe(false);
    const restored = JSON.parse(
      execFileSync(process.execPath, [...args, "restore-check", archive], {
        env: environment,
      }).toString(),
    );
    expect(restored.restored).toBe(true);
    const tables =
      await owner`select tablename from pg_tables where schemaname='scrabble' order by tablename`;
    expect(Object.keys(restored.tables)).toEqual(
      tables.map((t) => t.tablename),
    );
    for (const { tablename } of tables) {
      const [before] = await owner.unsafe(
        `select count(*)::int rows, md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) digest from scrabble.${tablename} t`,
      );
      expect(restored.tables[tablename]).toEqual({
        rows: before.rows,
        digest: before.digest,
      });
    }
    const corrupt = join(directory, "corrupt.backup.enc");
    bytes[25] ^= 1;
    await writeFile(corrupt, bytes);
    expect(() =>
      execFileSync(process.execPath, [...args, "restore-check", corrupt], {
        env: environment,
        stdio: "pipe",
      }),
    ).toThrow();
    expect(() =>
      execFileSync(process.execPath, [...args, "capture", archive], {
        env: environment,
        stdio: "pipe",
      }),
    ).toThrow();
  }, 60000);
  it("restores an isolated logical backup into a separate database with identical permanent rows", async () => {
    const binary = process.env.SCRABBLE_PG_BIN!,
      directory = process.env.SCRABBLE_TEST_DIRECTORY!,
      backup = join(directory, "family-test.dump");
    execFileSync(join(binary, "pg_dump"), [
      "-h",
      socket!,
      "-U",
      "scrabble_test_owner",
      "-d",
      "postgres",
      "--schema=scrabble",
      "--format=custom",
      "--file",
      backup,
    ]);
    await owner`create database scrabble_restore_test`;
    execFileSync(join(binary, "pg_restore"), [
      "-h",
      socket!,
      "-U",
      "scrabble_test_owner",
      "-d",
      "scrabble_restore_test",
      "--exit-on-error",
      backup,
    ]);
    const restored = postgres({
      host: socket!,
      database: "scrabble_restore_test",
      username: "scrabble_test_owner",
      onnotice: () => undefined,
    });
    try {
      for (const table of [
        "game_definitions",
        "game_events",
        "game_results",
        "game_participants",
        "game_approvals",
        "game_protests",
        "game_protest_resolutions",
        "watch_links",
        "audit",
        "requests",
      ]) {
        const before = await owner.unsafe(
          `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) data from scrabble.${table} t`,
        );
        const after = await restored.unsafe(
          `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) data from scrabble.${table} t`,
        );
        expect(after[0].data).toEqual(before[0].data);
      }
    } finally {
      await restored.end();
    }
  }, 20000);
});
