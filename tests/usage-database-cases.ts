import { createSharedRepository } from "../src/server/shared-repository";
import { testLexicon } from "../src/lib/test-lexicon";
import type { SharedOperation } from "../src/lib/shared-contract";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { describe, it, expect } from "vitest";
import { createUsageRepository } from "../src/server/usage-repository";
import type { VerifiedActor } from "../src/lib/shared-contract";
export function usageDatabaseCases(owner: postgres.Sql, runtime: postgres.Sql) {
  const repo = createUsageRepository(runtime);
  const actor = (name: string): VerifiedActor => ({
    userId: randomUUID(),
    email: name + "@example.test",
    emailVerified: true,
  });
  const range = () => ({
    from: new Date(Date.now() - 86400000).toISOString(),
    to: new Date(Date.now() + 86400000).toISOString(),
  });
  async function fixture() {
    const familyId = randomUUID(),
      admin = actor("admin"),
      member = actor("member");
    await owner`insert into scrabble.families(id,name) values(${familyId}::uuid,'Usage test')`;
    await owner`insert into scrabble.memberships(family_id,user_id,email,role) values(${familyId}::uuid,${admin.userId}::uuid,${admin.email},'superadmin'),(${familyId}::uuid,${member.userId}::uuid,${member.email},'member')`;
    return { familyId, admin, member };
  }
  describe("superadmin access and usage", () => {
    it("allows members to record themselves but rejects report/export and cross-family access", async () => {
      const f = await fixture(),
        other = await fixture();
      await repo.record(f.member, f.familyId, {
        id: randomUUID(),
        area: "games",
        activeMs: 0,
      });
      for (const exporting of [false, true])
        await expect(
          repo.report(f.member, f.familyId, range(), exporting),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        repo.report(other.admin, f.familyId, range()),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        repo.record(other.admin, f.familyId, {
          id: randomUUID(),
          area: "games",
          activeMs: 0,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (await repo.report(f.admin, f.familyId, range())).summary.visits,
      ).toBe(1);
      await owner`update scrabble.memberships set active=false where family_id=${f.familyId}::uuid and user_id=${f.admin.userId}::uuid`;
      await expect(
        repo.report(f.admin, f.familyId, range()),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("deduplicates retries and caps concurrent tabs to observed elapsed time", async () => {
      const f = await fixture(),
        pulse = { id: randomUUID(), area: "scrabble", activeMs: 15000 };
      await repo.record(f.member, f.familyId, pulse);
      await repo.record(f.member, f.familyId, pulse);
      let report = await repo.report(f.admin, f.familyId, range());
      expect(report.summary).toMatchObject({ visits: 1, activeMs: 0 });
      // Seed an older receipt as migration owner, never mutate retained production rows.
      await owner`insert into scrabble.usage_pulses(family_id,actor_id,id,visit_id,area,screen,is_view,active_ms,received_at) values(${f.familyId}::uuid,${f.admin.userId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,'games','games',true,0,clock_timestamp()-interval '10 seconds')`;
      await Promise.all([
        repo.record(f.admin, f.familyId, { ...pulse, id: randomUUID() }),
        repo.record(f.admin, f.familyId, { ...pulse, id: randomUUID() }),
      ]);
      report = await repo.report(f.admin, f.familyId, range());
      expect(report.summary.activeMs).toBeGreaterThanOrEqual(10000);
      expect(report.summary.activeMs).toBeLessThan(12000);
      expect(report.summary.visits).toBe(2);
    });
    it("starts a new visit after 30 minutes without fabricating elapsed active time", async () => {
      const f = await fixture();
      await owner`insert into scrabble.usage_pulses(family_id,actor_id,id,visit_id,area,screen,is_view,active_ms,received_at) values(${f.familyId}::uuid,${f.member.userId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,'games','games',true,0,clock_timestamp()-interval '31 minutes')`;
      await repo.record(f.member, f.familyId, {
        id: randomUUID(),
        area: "gym",
        activeMs: 15000,
      });
      const r = await repo.report(f.admin, f.familyId, range());
      expect(r.summary.visits).toBe(2);
      expect(r.summary.activeMs).toBe(0);
    });
    it("reports historical saved actions with actor identity, filters and lossless pagination", async () => {
      const f = await fixture();
      for (let n = 0; n < 45; n++)
        await owner`insert into scrabble.audit(family_id,id,actor_id,action,subject) values(${f.familyId}::uuid,${randomUUID()}::uuid,${f.member.userId}::uuid,'crokinole:command',${"match-" + n})`;
      const q = {
        ...range(),
        actor: f.member.userId,
        area: "crokinole",
        kind: "saved",
      };
      const first = await repo.report(f.admin, f.familyId, q);
      expect(first.rows).toHaveLength(40);
      expect(first.summary.savedActions).toBe(45);
      expect(first.trackingSince).toBeNull();
      expect(
        first.rows.every(
          (r) => r.activeMs === null && r.email === f.member.email,
        ),
      ).toBe(true);
      const second = await repo.report(f.admin, f.familyId, {
        ...q,
        cursor: first.nextCursor!,
      });
      expect(second.rows).toHaveLength(5);
      expect(
        new Set([...first.rows, ...second.rows].map((r) => r.id)).size,
      ).toBe(45);
      const csv = await repo.report(f.admin, f.familyId, q, true);
      expect(csv.rows).toHaveLength(45);
      expect(
        (await repo.report(f.admin, f.familyId, { ...q, area: "gym" })).rows,
      ).toHaveLength(0);
      await expect(
        repo.report(f.admin, f.familyId, { ...q, cursor: "broken" }),
      ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
      await expect(
        repo.report(f.admin, f.familyId, { ...q, to: q.from }),
      ).rejects.toMatchObject({ code: "INVALID_RANGE" });
    });
    it("counts a Scrabble command once rather than counting its audit envelope again", async () => {
      const f = await fixture();
      f.admin.deviceHash = "a".repeat(64);
      const shared = createSharedRepository(runtime, {
        defaultLexicon: testLexicon,
        resolveLexicon: () => testLexicon,
      });
      const mutate = (operation: SharedOperation) =>
        shared.mutate(f.admin, f.familyId, {
          requestId: randomUUID(),
          operation,
        });
      await mutate({ type: "create-player", id: "a", profile: { name: "A" } });
      await mutate({ type: "create-player", id: "b", profile: { name: "B" } });
      const gameId = randomUUID();
      await mutate({
        type: "create-game",
        id: gameId,
        mode: "confirmed",
        players: [
          { id: "a", seat: 0 },
          { id: "b", seat: 2 },
        ],
        firstPlayerId: "a",
        direction: "clockwise",
        deviceId: "usage-device",
      });
      await mutate({
        type: "game-commands",
        gameId,
        deviceId: "usage-device",
        generation: 1,
        commands: [{ type: "pass", id: randomUUID(), expectedRevision: 0 }],
      });
      const r = await repo.report(f.admin, f.familyId, {
        ...range(),
        area: "scrabble",
        kind: "saved",
      });
      expect(r.summary.savedActions).toBe(2);
      expect(r.rows.map((row) => row.action).sort()).toEqual([
        "game.created",
        "scrabble:pass",
      ]);
    });
    it("projects Gym action metadata without exposing another player's raw practice", async () => {
      const f = await fixture(),
        sessionId = randomUUID(),
        eventId = randomUUID();
      await owner`insert into scrabble.players(family_id,id,name) values(${f.familyId}::uuid,'learner','Learner')`;
      await owner`insert into scrabble.gym_sessions(family_id,player_id,id,actor_id,fingerprint,puzzle,replay) values(${f.familyId}::uuid,'learner',${sessionId}::uuid,${f.member.userId}::uuid,${"a".repeat(64)},'{"private":"puzzle"}'::jsonb,false)`;
      await owner`insert into scrabble.gym_events(family_id,player_id,session_id,id,sequence,payload_hash,event) values(${f.familyId}::uuid,'learner',${sessionId}::uuid,${eventId}::uuid,1,${"b".repeat(64)},'{"payload":{"type":"hint","level":1},"private":"details"}'::jsonb)`;
      const r = await repo.report(f.admin, f.familyId, {
        ...range(),
        area: "gym",
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({
        action: "gym:hint",
        actorId: f.member.userId,
        activeMs: null,
      });
      expect(JSON.stringify(r)).not.toContain("private");
      await runtime.begin(async (tx) => {
        await tx`set local role scrabble_runtime`;
        await tx`select set_config('scrabble.actor_id',${f.admin.userId},true),set_config('scrabble.family_id',${f.familyId},true)`;
        expect(
          await tx`select * from scrabble.gym_sessions where family_id=${f.familyId}::uuid`,
        ).toHaveLength(0);
        await tx`select set_config('scrabble.actor_id',${f.member.userId},true)`;
        expect(
          await tx`select * from scrabble.usage_gym_actions(now()-interval '1 day',now()+interval '1 day')`,
        ).toHaveLength(0);
      });
    });
    it("clips active time at the date boundary and refuses an oversized export", async () => {
      const f = await fixture(),
        at = new Date(),
        from = new Date(at.getTime() - 5000);
      await owner`insert into scrabble.usage_pulses(family_id,actor_id,id,visit_id,area,screen,is_view,active_ms,received_at) values(${f.familyId}::uuid,${f.member.userId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,'games','games',true,15000,${at})`;
      const r = await repo.report(f.admin, f.familyId, {
        from: from.toISOString(),
        to: new Date(at.getTime() + 1000).toISOString(),
      });
      expect(r.summary.activeMs).toBe(5000);
      await owner`insert into scrabble.audit(family_id,id,actor_id,action,subject) select ${f.familyId}::uuid,gen_random_uuid(),${f.member.userId}::uuid,'game.created','fixture-'||n::text from generate_series(1,10001) n`;
      await expect(
        repo.report(f.admin, f.familyId, { ...range(), kind: "saved" }, true),
      ).rejects.toMatchObject({ code: "EXPORT_TOO_LARGE" });
    });
    it("enforces RLS independently and grants no browser-role access", async () => {
      const f = await fixture();
      await repo.record(f.admin, f.familyId, {
        id: randomUUID(),
        area: "administration",
        activeMs: 0,
      });
      await runtime.begin(async (tx) => {
        await tx`set local role scrabble_runtime`;
        await tx`select set_config('scrabble.actor_id',${f.member.userId},true),set_config('scrabble.family_id',${f.familyId},true)`;
        expect(
          await tx`select * from scrabble.usage_pulses where family_id=${f.familyId}::uuid`,
        ).toHaveLength(0);
      });
      const [grants] =
        await owner`select has_table_privilege('anon','scrabble.usage_pulses','select') or has_table_privilege('authenticated','scrabble.usage_pulses','select') as exposed`;
      expect(grants.exposed).toBe(false);
    });
  });
}
