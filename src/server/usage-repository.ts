import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { VerifiedActor } from "../lib/shared-contract";
import {
  isUsagePulse,
  usageUuid,
  USAGE_AREAS,
  type UsageReport,
  type UsageRow,
} from "../lib/access-usage";
import { SharedRepositoryError } from "./shared-repository";
import { requireCurrentSchema } from "./schema-compatibility";

const fail = (code: string, message: string, status = 400): never => {
  throw new SharedRepositoryError(code, message, status);
};
export type UsageQuery = {
  from: string;
  to: string;
  actor?: string;
  area?: string;
  kind?: string;
  cursor?: string;
};
function parseQuery(q: UsageQuery) {
  const from = Date.parse(q.from),
    to = Date.parse(q.to);
  if (
    !/^\d{4}-\d{2}-\d{2}T/.test(q.from) ||
    !/^\d{4}-\d{2}-\d{2}T/.test(q.to) ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from ||
    to - from > 31 * 86400000
  )
    fail("INVALID_RANGE", "Choose a date range of up to 31 days.");
  if (q.actor && !usageUuid(q.actor))
    fail("INVALID_FILTER", "Choose a valid account.");
  if (q.area && !USAGE_AREAS.some((a) => a === q.area))
    fail("INVALID_FILTER", "Choose a valid area.");
  if (q.kind && !["visit", "view", "saved"].includes(q.kind))
    fail("INVALID_FILTER", "Choose a valid activity type.");
  let cursor: { at: string; id: string } | null = null;
  if (q.cursor) {
    try {
      if (q.cursor.length > 1000) throw new Error();
      cursor = JSON.parse(Buffer.from(q.cursor, "base64url").toString());
      if (
        !cursor ||
        typeof cursor.at !== "string" ||
        cursor.at.length > 64 ||
        !Number.isFinite(Date.parse(cursor.at)) ||
        typeof cursor.id !== "string" ||
        cursor.id.length > 300
      )
        throw new Error();
    } catch {
      fail("INVALID_CURSOR", "The report page is invalid.");
    }
  }
  return {
    ...q,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    cursor,
  };
}
export function createUsageRepository(sql: postgres.Sql) {
  async function transaction<T>(
    actor: VerifiedActor,
    familyId: string,
    admin: boolean,
    work: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    if (
      !usageUuid(actor.userId) ||
      !usageUuid(familyId) ||
      actor.emailVerified !== true
    )
      fail("FORBIDDEN", "Verified family access is required.", 403);
    return (await sql.begin(
      admin ? "isolation level repeatable read read only" : "",
      async (tx) => {
        await tx`set local role scrabble_runtime`;
        await requireCurrentSchema(tx);
        await tx`select set_config('scrabble.actor_id',${actor.userId},true),set_config('scrabble.family_id',${familyId},true),set_config('statement_timeout','15000',true),set_config('lock_timeout','5000',true)`;
        const [member] =
          await tx`select role from scrabble.memberships where family_id=${familyId}::uuid and user_id=${actor.userId}::uuid and active`;
        if (!member || (admin && member.role !== "superadmin"))
          fail(
            "FORBIDDEN",
            admin
              ? "Only superadmins can view access and usage."
              : "Active family access is required.",
            403,
          );
        const [schema] =
          await tx`select to_regclass('scrabble.usage_pulses') is not null as ready`;
        if (!schema.ready)
          fail(
            "USAGE_SCHEMA_REQUIRED",
            "Access and usage tracking needs the server update before it is available.",
            503,
          );
        return work(tx);
      },
    )) as T;
  }
  return {
    async record(actor: VerifiedActor, familyId: string, input: unknown) {
      if (!isUsagePulse(input))
        return fail("INVALID_PULSE", "Invalid activity receipt.");
      return transaction(actor, familyId, false, async (tx) => {
        // Serialize only this account. Overlapping devices/tabs cannot inflate time.
        await tx`select pg_advisory_xact_lock(hashtextextended(${familyId + ":" + actor.userId},0))`;
        const [duplicate] =
          await tx`select id from scrabble.usage_pulses where family_id=${familyId}::uuid and actor_id=${actor.userId}::uuid and id=${input.id}::uuid`;
        if (duplicate) return { accepted: true };
        const [last] =
          await tx`select visit_id,area,received_at from scrabble.usage_pulses where family_id=${familyId}::uuid and actor_id=${actor.userId}::uuid order by received_at desc limit 1`;
        const [clock] = await tx`select clock_timestamp() as at`;
        const at = new Date(clock.at);
        const elapsed = last
          ? Math.max(0, at.getTime() - new Date(last.received_at).getTime())
          : 0;
        // Bound write volume without queuing tracking work ahead of gameplay.
        if (last && elapsed < 1000) return { accepted: false };
        const newVisit = !last || elapsed >= 30 * 60000;
        const visit = newVisit ? randomUUID() : last.visit_id;
        const activeMs = newVisit
          ? 0
          : Math.min(input.activeMs, Math.floor(elapsed));
        await tx`insert into scrabble.usage_pulses(family_id,actor_id,id,visit_id,area,screen,is_view,active_ms,received_at) values(${familyId}::uuid,${actor.userId}::uuid,${input.id}::uuid,${visit}::uuid,${input.area},${input.area},${newVisit || last.area !== input.area},${activeMs},${at})`;
        return { accepted: true };
      });
    },
    async report(
      actor: VerifiedActor,
      familyId: string,
      query: UsageQuery,
      exporting = false,
    ): Promise<UsageReport> {
      const q = parseQuery(query);
      if (exporting && q.cursor)
        fail(
          "INVALID_CURSOR",
          "Export the complete filtered report without a page cursor.",
        );
      return transaction(actor, familyId, true, async (tx) => {
        const people =
          await tx`select m.user_id,m.email,m.active,p.name from scrabble.memberships m left join scrabble.players p on p.family_id=m.family_id and p.id=m.player_id where m.family_id=${familyId}::uuid order by coalesce(p.name,m.email),m.user_id`;
        const [coverage] =
          await tx`select min(received_at) at from scrabble.usage_pulses where family_id=${familyId}::uuid`;
        // All sources run under the restricted runtime role and current family.
        // No before/after contents, private notes, tokens, or puzzle payloads leave SQL.
        const base = tx`
          with pulses as (
            select actor_id,id,visit_id,area,screen,is_view,received_at,least(active_ms,greatest(0,floor(extract(epoch from (received_at-${q.from}::timestamptz))*1000))) as active_ms from scrabble.usage_pulses where family_id=${familyId}::uuid and received_at>=${q.from}::timestamptz and received_at<${q.to}::timestamptz
            ${q.actor ? tx`and actor_id=${q.actor}::uuid` : tx``}
            ${q.area ? tx`and area=${q.area}` : tx``}
          ), saved as (
            select 'audit:'||id::text id,recorded_at at,actor_id,
              case when action like 'crokinole:%' then 'crokinole' when action like 'game.%' or action='words.confirmed' then 'scrabble'
                when action like 'player.%' or action in ('create-player','update-player') then 'players'
                when action='equipment.updated' then 'settings' else 'administration' end area,
              case when action='crokinole:command' and after_value->'operation'->'command'->>'type' is not null
                then 'crokinole:'||(after_value->'operation'->'command'->>'type') else action end action,
              subject from scrabble.audit where family_id=${familyId}::uuid and action<>'game.commands' and recorded_at>=${q.from}::timestamptz and recorded_at<${q.to}::timestamptz
            union all
            select 'scrabble:'||game_id||':'||sequence::text,recorded_at,actor_id,'scrabble','scrabble:'||coalesce(event->'command'->>'type','action'),game_id
              from scrabble.game_events where family_id=${familyId}::uuid and recorded_at>=${q.from}::timestamptz and recorded_at<${q.to}::timestamptz
            union all
            select id,at,actor_id,'gym',action,subject
              from scrabble.usage_gym_actions(${q.from}::timestamptz,${q.to}::timestamptz)
          ), saved_filtered as (
            select * from saved where true ${q.actor ? tx`and actor_id=${q.actor}::uuid` : tx``} ${q.area ? tx`and area=${q.area}` : tx``}
          ), timeline as (
            select 'visit:'||visit_id::text||':'||area id,min(received_at) at,max(received_at) last_at,actor_id,area,'visit' kind,'visit' action,visit_id::text subject,sum(active_ms)::bigint active_ms
              from pulses group by visit_id,actor_id,area
            union all
            select 'view:'||id::text,received_at,received_at,actor_id,area,'view','view',screen,null::bigint from pulses where is_view
            union all
            select id,at,at,actor_id,area,'saved',action,subject,null::bigint from saved_filtered
          )`;
        const [summary] = await tx`${base}
          select (select count(distinct actor_id) from (select actor_id from pulses union select actor_id from saved_filtered) u) users,
          (select count(distinct visit_id) from pulses) visits,
          (select coalesce(sum(active_ms),0) from pulses) active_ms,
          (select count(*) from saved_filtered) saved_actions`;
        const limit = exporting ? 10000 : 40;
        const rows =
          await tx`${base} select *,at::text cursor_at from timeline where true
          ${q.kind ? tx`and kind=${q.kind}` : tx``}
          ${q.cursor ? tx`and (at,id)<(${q.cursor.at}::text::timestamptz,${q.cursor.id})` : tx``}
          order by at desc,id desc limit ${limit + 1}`;
        if (exporting && rows.length > limit)
          fail(
            "EXPORT_TOO_LARGE",
            "This export exceeds 10,000 rows. Narrow the dates or filters.",
            413,
          );
        const identities = new Map(people.map((p) => [p.user_id, p]));
        const mapped: UsageRow[] = rows.slice(0, limit).map((r) => ({
          id: r.id,
          at: new Date(r.at).toISOString(),
          lastAt: new Date(r.last_at).toISOString(),
          actorId: r.actor_id,
          name: identities.get(r.actor_id)?.name ?? "",
          email: identities.get(r.actor_id)?.email ?? "",
          area: r.area,
          kind: r.kind,
          action: r.action,
          subject: r.subject,
          activeMs: r.active_ms === null ? null : Number(r.active_ms),
        }));
        const last = rows[limit - 1];
        return {
          from: q.from,
          to: q.to,
          generatedAt: new Date().toISOString(),
          trackingSince: coverage.at
            ? new Date(coverage.at).toISOString()
            : null,
          summary: {
            users: Number(summary.users),
            visits: Number(summary.visits),
            activeMs: Number(summary.active_ms),
            savedActions: Number(summary.saved_actions),
          },
          people: people.map((p) => ({
            id: p.user_id,
            name: p.name ?? "",
            email: p.email,
            active: p.active,
          })),
          rows: mapped,
          nextCursor:
            rows.length > limit
              ? Buffer.from(
                  JSON.stringify({ at: last.cursor_at, id: last.id }),
                ).toString("base64url")
              : null,
        };
      });
    },
  };
}
